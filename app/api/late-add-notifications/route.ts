import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CURRENT_BOMPTON_YEAR, type CrewMember } from "@/lib/bompton";
import { loadBomptonDataFromDb } from "@/lib/bompton-playlist-db";
import { findLateAdders } from "@/lib/late-add-detection";
import {
  LateAddEmailConfigError,
  LateAddEmailSendError,
  sendLateAddEmail,
} from "@/lib/late-add-email";

export const dynamic = "force-dynamic";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// POST /api/late-add-notifications
// Body (optional): { thresholdDays?: number, dryRun?: boolean }
//
// Detects crew members who are more than `thresholdDays` (default 3) late
// on a Bompton add for the current season, then for each offender:
//   1. Checks LateAddNotification for any send in the last 24h.
//   2. If none, sends a Resend email to the offender, CCing the rest of
//      the crew.
//   3. Records the attempt (success or failure) into LateAddNotification.
//
// Designed to fire from the dashboard auto-sync chain, AFTER the
// per-user playlist sync has run, so we're working off fresh data.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message:
          "Not signed in. /api/late-add-notifications requires an authenticated session.",
      },
      { status: 401 },
    );
  }
  const callerId = session.user.id;

  let body: { thresholdDays?: unknown; dryRun?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const thresholdDays =
    typeof body.thresholdDays === "number" && Number.isFinite(body.thresholdDays)
      ? body.thresholdDays
      : 3;
  const dryRun = Boolean(body.dryRun);

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
    return NextResponse.json(
      {
        error: name,
        message: `Failed to load crew + Bompton data: ${message}. Check DATABASE_URL and that the schema is migrated.`,
      },
      { status: 500 },
    );
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
  };

  const outcomes: Outcome[] = [];

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
      });
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

  return NextResponse.json({
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
  });
}
