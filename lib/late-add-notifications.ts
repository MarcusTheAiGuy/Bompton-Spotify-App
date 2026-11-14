import { prisma } from "@/lib/prisma";
import { CURRENT_BOMPTON_YEAR, type CrewMember } from "@/lib/bompton";
import { loadBomptonDataFromDb } from "@/lib/bompton-playlist-db";
import type { SpotifyPlaylistTrack } from "@/lib/spotify";
import { loadCrew } from "@/lib/crew";
import { findLateAdders } from "@/lib/late-add-detection";
import {
  LATE_ADD_PERSONA_KEYS,
  LateAddEmailConfigError,
  LateAddEmailSendError,
  sendLateAddEmail,
  type LateAddEmailInput,
} from "@/lib/late-add-email";
import {
  loadLateAddPersonaHistory,
  nextPersonaIndex,
  type PersonaHistory,
} from "@/lib/persona-rotation";

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

type OffenderActivity = Pick<
  LateAddEmailInput,
  "roastNumber" | "lastAdd" | "listening"
>;

// What the offender has been up to, for the personas that quote it (see
// LateAddEmailInput). Read fresh for each send so it is true on the day.
// Whatever can't be read comes back null and is logged — the roast still
// goes out, just without that detail.
async function loadOffenderActivity(
  offender: CrewMember,
  oldestMissedFriday: Date,
  seasonTracks: SpotifyPlaylistTrack[],
  callerId: string,
): Promise<OffenderActivity> {
  // Their latest add that still has a title (a song Spotify has since pulled
  // comes back blank).
  let lastAdd: OffenderActivity["lastAdd"] = null;
  for (const item of seasonTracks) {
    if (!item.track?.name || item.added_by?.id !== offender.spotifyUserId) {
      continue;
    }
    const addedAt = new Date(item.added_at);
    if (Number.isNaN(addedAt.getTime())) continue;
    if (!lastAdd || addedAt > lastAdd.addedAt) {
      lastAdd = {
        title: item.track.name,
        artist: item.track.artists?.[0]?.name ?? "",
        addedAt,
      };
    }
  }

  let roastNumber: OffenderActivity["roastNumber"] = null;
  try {
    const earlier = await prisma.lateAddNotification.count({
      where: {
        userId: offender.id,
        bomptonYear: CURRENT_BOMPTON_YEAR,
        resendId: { not: null },
      },
    });
    roastNumber = earlier + 1;
  } catch (error) {
    console.error("[late-add-notifications.roast-count.failed]", {
      callerId,
      userId: offender.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  let listening: OffenderActivity["listening"] = null;
  try {
    const plays = await prisma.listeningPlay.findMany({
      where: { userId: offender.id, playedAt: { gte: oldestMissedFriday } },
      select: { trackName: true, trackArtist: true, playedAt: true },
      orderBy: { playedAt: "asc" },
    });
    const last = plays[plays.length - 1];
    if (last) {
      const artists = new Map<string, { name: string; plays: number }>();
      const tracks = new Map<
        string,
        { title: string; artist: string; plays: number }
      >();
      for (const play of plays) {
        const artist = artists.get(play.trackArtist) ?? {
          name: play.trackArtist,
          plays: 0,
        };
        artist.plays += 1;
        artists.set(play.trackArtist, artist);
        const trackKey = JSON.stringify([play.trackArtist, play.trackName]);
        const track = tracks.get(trackKey) ?? {
          title: play.trackName,
          artist: play.trackArtist,
          plays: 0,
        };
        track.plays += 1;
        tracks.set(trackKey, track);
      }
      const mostPlayed = <T extends { plays: number }>(all: Iterable<T>): T =>
        [...all].sort((a, b) => b.plays - a.plays)[0];
      listening = {
        plays: plays.length,
        topArtist: mostPlayed(artists.values()),
        topTrack: mostPlayed(tracks.values()),
        lastPlayed: {
          title: last.trackName,
          artist: last.trackArtist,
          at: last.playedAt,
        },
      };
    }
  } catch (error) {
    console.error("[late-add-notifications.listening.failed]", {
      callerId,
      userId: offender.id,
      since: oldestMissedFriday.toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return { roastNumber, lastAdd, listening };
}

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
  let crew: CrewMember[];
  let data;
  try {
    [crew, data] = await Promise.all([loadCrew(), loadBomptonDataFromDb()]);
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

  // Roast rotation: see lib/persona-rotation.ts. Roasts that have never been
  // sent go first, then whichever has waited longest. Only successful sends
  // count, so a failed send is retried with the same roast. The history is
  // read once and updated as each send goes out, so a run with 2+ offenders
  // gives each of them a different roast.
  let personaHistory: PersonaHistory;
  try {
    personaHistory = await loadLateAddPersonaHistory(crew);
  } catch (error) {
    const name = error instanceof Error ? error.name : "PrismaError";
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist/i.test(message)) {
      // Table not initialized — let the per-offender cooldown lookup raise
      // the user-actionable config-error with the troubleshooting link.
      personaHistory = new Map();
    } else {
      console.error("[late-add-notifications.persona-history.failed]", {
        callerId,
        name,
        message,
      });
      return {
        status: 500,
        body: {
          error: name,
          message: `Failed to read LateAddNotification for the roast rotation: ${message}. Check DATABASE_URL.`,
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

    const personaIndex = nextPersonaIndex(
      LATE_ADD_PERSONA_KEYS,
      personaHistory,
    );
    const personaKey = LATE_ADD_PERSONA_KEYS[personaIndex];

    if (dryRun) {
      // Report the roast this offender would get, and count it as sent so the
      // next offender in the run is shown the one after it.
      personaHistory.set(personaKey, Date.now());
      outcomes.push({
        userId: offender.member.id,
        userLabel,
        weeksBehind: offender.weeksBehind,
        status: "skipped-dry-run",
        personaKey,
      });
      continue;
    }

    try {
      const activity = await loadOffenderActivity(
        offender.member,
        offender.missedFridays[0],
        currentSeason?.tracks ?? [],
        callerId,
      );
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
        ...activity,
      });
      personaHistory.set(personaKey, Date.now());
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
