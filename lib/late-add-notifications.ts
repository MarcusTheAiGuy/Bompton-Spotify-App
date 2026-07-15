import { prisma } from "@/lib/prisma";
import { CURRENT_BOMPTON_YEAR, type CrewMember } from "@/lib/bompton";
import { loadBomptonDataFromDb } from "@/lib/bompton-playlist-db";
import { findLateAdders } from "@/lib/late-add-detection";
import {
  LATE_ADD_PERSONA_COUNT,
  LateAddEmailConfigError,
  LateAddEmailSendError,
  sendLateAddEmail,
} from "@/lib/late-add-email";

// Core of POST /api/late-add-notifications, extracted so it can run either
// behind the route (session- or cron-authed HTTP call) OR directly
// in-process from the daily-sync cron. The cron used to reach this by
// fetching the route with a self-set `x-vercel-cron: 1` header, which is
// stripped at the edge (see lib/cron-auth.ts), so the call 401'd and no
// late-add roast email was ever sent by the cron — only a human opening
// the dashboard (session auth) triggered it. Calling this directly fixes
// that.
//
// Detects crew members more than `thresholdDays` (default 3) late on a
// Bompton add for the current season, then for each offender: checks the
// 24h LateAddNotification cooldown, sends a Resend email CCing the crew,
// and records the attempt.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export type RunLateAddNotificationsResult = {
  status: number;
  body: Record<string, unknown>;
};

export async function runLateAddNotifications({
  thresholdDays = 3,
  dryRun = false,
  callerId,
}: {
  thresholdDays?: number;
  dryRun?: boolean;
  // For log lines only — "vercel-cron" for the cron, the user id otherwise.
  callerId: string;
}): Promise<RunLateAddNotificationsResult> {
  let crewRecords: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    accounts: { providerAccountId: string }[];
  }[];
  let data;
  try {
    [crewRecords, data] = await Promise.all([
      prisma.user.findMany({
        where: { accounts: { some: { provider: "spotify" } } },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          accounts: {
            where: { provider: "spotify" },
            select: { providerAccountId: true },
            take: 1,
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      loadBomptonDataFromDb(),
    ]);
  } catch (error) {
    const name = error instanceof Error ? error.name : "PrismaError";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[late-add-notifications.load.failed]", { callerId, message });
    return {
      status: 500,
      body: {
        error: name,
        message: `Failed to load crew + Bompton data: ${message}. Check DATABASE_URL and that the schema is migrated.`,
      },
    };
  }

  const crew: CrewMember[] = crewRecords.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    spotifyUserId: u.accounts[0]?.providerAccountId ?? null,
  }));

  const detection = findLateAdders(
    data,
    crew,
    new Date(),
    thresholdDays,
    CURRENT_BOMPTON_YEAR,
  );

  const standings = detection.perMemberSummary.map((s) => ({
    member: s.member,
    missedCount: s.missedFridayCount,
  }));

  const currentSeason = data.find((d) => d.year === CURRENT_BOMPTON_YEAR);
  const playlistUrl = currentSeason?.playlist?.id
    ? `https://open.spotify.com/playlist/${currentSeason.playlist.id}`
    : null;

  type Outcome = {
    userId: string;
    userLabel: string;
    weeksBehind: number;
    status:
      | "emailed"
      | "skipped-cooldown"
      | "skipped-no-email"
      | "skipped-dry-run"
      | "config-error"
      | "send-error";
    cooldownUntil?: string;
    error?: { name: string; message: string };
    resendId?: string | null;
    subject?: string;
    ccEmails?: string[];
    personaKey?: string;
  };

  const outcomes: Outcome[] = [];

  // Round-robin roast rotation. The persona index for the next send is
  // the count of successful sends so far modulo the persona list length.
  // Counting successful (resendId IS NOT NULL) rows means failed sends
  // do NOT burn a slot — the next try gets the same persona. We then
  // increment locally per successful send so a batch hitting 2+ offenders
  // walks the rotation forward correctly without a fresh DB read each time.
  let rotationCursor: number;
  try {
    rotationCursor = await prisma.lateAddNotification.count({
      where: { resendId: { not: null } },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "PrismaError";
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist/i.test(message)) {
      // Table not initialized — let the per-offender cooldown lookup raise
      // the user-actionable config-error with the troubleshooting link.
      rotationCursor = 0;
    } else {
      console.error("[late-add-notifications.rotation-count.failed]", {
        callerId,
        name,
        message,
      });
      return {
        status: 500,
        body: {
          error: name,
          message: `Failed to read LateAddNotification count for persona rotation: ${message}. Check DATABASE_URL.`,
        },
      };
    }
  }

  for (const offender of detection.offenders) {
    const userLabel = offender.member.name ?? offender.member.email ?? offender.member.id;
    const email = offender.member.email;

    if (!email) {
      outcomes.push({
        userId: offender.member.id,
        userLabel,
        weeksBehind: offender.weeksBehind,
        status: "skipped-no-email",
        error: {
          name: "NoEmailOnFile",
          message: `Crew member ${userLabel} has no email column set in the User table. Sign them out and back in via Spotify so Auth.js writes their email, or update prisma User.email manually.`,
        },
      });
      continue;
    }

    // 24h cooldown lookup. Reads the most recent send for this user; if
    // it's inside the window, skip. Done inside the loop instead of a
    // batched query because we expect at most ~4 offenders per call.
    let recent: { id: string; sentAt: Date } | null = null;
    try {
      recent = await prisma.lateAddNotification.findFirst({
        where: {
          userId: offender.member.id,
          sentAt: { gte: new Date(Date.now() - ONE_DAY_MS) },
        },
        select: { id: true, sentAt: true },
        orderBy: { sentAt: "desc" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/does not exist/i.test(message)) {
        outcomes.push({
          userId: offender.member.id,
          userLabel,
          weeksBehind: offender.weeksBehind,
          status: "config-error",
          error: {
            name: "MissingTable",
            message:
              "LateAddNotification table doesn't exist yet. Visit /troubleshooting and click 'Initialize LateAddNotification table'.",
          },
        });
        continue;
      }
      throw error;
    }

    if (recent) {
      const cooldownUntilMs = recent.sentAt.getTime() + ONE_DAY_MS;
      outcomes.push({
        userId: offender.member.id,
        userLabel,
        weeksBehind: offender.weeksBehind,
        status: "skipped-cooldown",
        cooldownUntil: new Date(cooldownUntilMs).toISOString(),
      });
      continue;
    }

    if (dryRun) {
      outcomes.push({
        userId: offender.member.id,
        userLabel,
        weeksBehind: offender.weeksBehind,
        status: "skipped-dry-run",
      });
      continue;
    }

    const personaIndex = rotationCursor % LATE_ADD_PERSONA_COUNT;
    try {
      const result = await sendLateAddEmail({
        offender: offender.member,
        offenderEmail: email,
        crew,
        weeksBehind: offender.weeksBehind,
        missedFridays: offender.missedFridays,
        standings,
        bomptonYear: CURRENT_BOMPTON_YEAR,
        playlistUrl,
        personaIndex,
      });
      rotationCursor += 1;
      try {
        await prisma.lateAddNotification.create({
          data: {
            userId: offender.member.id,
            bomptonYear: CURRENT_BOMPTON_YEAR,
            weeksBehind: offender.weeksBehind,
            missedFridays: offender.missedFridays.map((d) => d.toISOString()),
            ccEmails: result.ccEmails,
            emailSubject: result.subject,
            resendId: result.resendId,
          },
        });
      } catch (dbError) {
        console.error("[late-add-notifications.record.failed]", {
          callerId,
          userId: offender.member.id,
          resendId: result.resendId,
          message:
            dbError instanceof Error ? dbError.message : String(dbError),
        });
      }
      outcomes.push({
        userId: offender.member.id,
        userLabel,
        weeksBehind: offender.weeksBehind,
        status: "emailed",
        resendId: result.resendId,
        subject: result.subject,
        ccEmails: result.ccEmails,
        personaKey: result.personaKey,
      });
    } catch (error) {
      if (error instanceof LateAddEmailConfigError) {
        outcomes.push({
          userId: offender.member.id,
          userLabel,
          weeksBehind: offender.weeksBehind,
          status: "config-error",
          error: { name: error.name, message: error.message },
        });
        // Config errors apply to ALL offenders. No point trying the rest.
        console.error("[late-add-notifications.config-error]", {
          callerId,
          message: error.message,
        });
        break;
      }
      const name = error instanceof Error ? error.name : "UnknownError";
      const message = error instanceof Error ? error.message : String(error);
      const status =
        error instanceof LateAddEmailSendError ? error.status : 0;
      const errBody =
        error instanceof LateAddEmailSendError ? error.body : "";
      try {
        await prisma.lateAddNotification.create({
          data: {
            userId: offender.member.id,
            bomptonYear: CURRENT_BOMPTON_YEAR,
            weeksBehind: offender.weeksBehind,
            missedFridays: offender.missedFridays.map((d) => d.toISOString()),
            ccEmails: [],
            emailSubject: "(failed to send)",
            errorMessage: `${name}: ${message}`,
          },
        });
      } catch (dbError) {
        console.error("[late-add-notifications.record-failure.failed]", {
          callerId,
          userId: offender.member.id,
          message:
            dbError instanceof Error ? dbError.message : String(dbError),
        });
      }
      console.error("[late-add-notifications.send.failed]", {
        callerId,
        userId: offender.member.id,
        name,
        message,
        resendStatus: status,
        resendBody: errBody.slice(0, 500),
      });
      outcomes.push({
        userId: offender.member.id,
        userLabel,
        weeksBehind: offender.weeksBehind,
        status: "send-error",
        error: { name, message },
      });
    }
  }

  const emailed = outcomes.filter((o) => o.status === "emailed").length;
  const skippedCooldown = outcomes.filter(
    (o) => o.status === "skipped-cooldown",
  ).length;
  const errors = outcomes.filter(
    (o) => o.status === "send-error" || o.status === "config-error",
  ).length;

  console.log("[late-add-notifications]", {
    callerId,
    thresholdDays,
    dryRun,
    offenderCount: detection.offenders.length,
    emailed,
    skippedCooldown,
    errors,
  });

  return {
    status: 200,
    body: {
      ok: errors === 0,
      year: detection.year,
      thresholdDays,
      dryRun,
      offenderCount: detection.offenders.length,
      emailed,
      skippedCooldown,
      errors,
      outcomes,
      perMemberSummary: detection.perMemberSummary.map((s) => ({
        userId: s.member.id,
        userLabel: s.member.name ?? s.member.email ?? s.member.id,
        missedFridayCount: s.missedFridayCount,
      })),
    },
  };
}
