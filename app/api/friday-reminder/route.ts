import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CURRENT_BOMPTON_YEAR } from "@/lib/bompton";
import { loadBomptonDataFromDb } from "@/lib/bompton-playlist-db";
import { isAuthorizedCron } from "@/lib/cron-auth";
import {
  FRIDAY_REMINDER_PERSONA_COUNT,
  FridayReminderEmailConfigError,
  FridayReminderEmailSendError,
  scheduledPersonaFor,
  sendFridayReminderEmail,
} from "@/lib/friday-reminder-email";

export const dynamic = "force-dynamic";

// GET|POST /api/friday-reminder
// Body (optional, POST only): { dryRun?: boolean }
//
// Sends ONE crew-wide "it's Friday, add a song" hype email, rotating
// through the personas in lib/friday-reminder-email.ts. This is the
// direct target of the Friday-noon Vercel cron (see vercel.json), which
// fires via GET, so we accept both verbs.
//
// Per-week dedupe: we key on the Friday this reminder is *for* (UTC
// midnight of the most recent Friday on/before now). If a successful send
// already exists for that Friday we skip — so a duplicate cron firing, or
// a manual click after the cron ran, won't double-blast the crew. Failed
// sends do NOT count, so a transient Resend error can be retried.
//
// Persona rotation: index = count of prior successful sends % persona count.
// Failed sends don't burn a slot, so the next successful send reuses the
// same persona rather than skipping one.
export async function POST(request: NextRequest) {
  return handle(request);
}

// Vercel cron uses GET by default.
export async function GET(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const session = await auth();
  const cron = isAuthorizedCron(request);
  if (!session?.user?.id && !cron) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message:
          "Not signed in. /api/friday-reminder requires either a Spotify session or a Vercel cron invocation (x-vercel-cron header) or Authorization: Bearer $CRON_SECRET.",
      },
      { status: 401 },
    );
  }
  const callerId = session?.user?.id ?? "vercel-cron";

  // Only POST carries a body; GET (the cron's default verb) never does.
  let dryRun = false;
  if (request.method === "POST") {
    try {
      const body = (await request.json()) as { dryRun?: unknown };
      dryRun = Boolean(body?.dryRun);
    } catch {
      dryRun = false;
    }
  }

  const fridayDate = currentFridayUtc(new Date());

  let crewRecords: { email: string | null }[];
  let data;
  try {
    [crewRecords, data] = await Promise.all([
      prisma.user.findMany({
        where: { accounts: { some: { provider: "spotify" } } },
        select: { email: true },
        orderBy: { createdAt: "asc" },
      }),
      loadBomptonDataFromDb(),
    ]);
  } catch (error) {
    const name = error instanceof Error ? error.name : "PrismaError";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[friday-reminder.load.failed]", { callerId, message });
    return NextResponse.json(
      {
        error: name,
        message: `Failed to load crew + Bompton data: ${message}. Check DATABASE_URL and that the schema is migrated.`,
      },
      { status: 500 },
    );
  }

  const recipients = crewRecords
    .map((u) => u.email)
    .filter((e): e is string => typeof e === "string" && e.length > 0);

  if (recipients.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "NoRecipients",
        message:
          "No crew member has an email on their User row, so there's nobody to send the Friday reminder to. Sign someone in via Spotify so Auth.js writes their email, or set prisma User.email manually.",
      },
      { status: 422 },
    );
  }

  const currentSeason = data.find((d) => d.year === CURRENT_BOMPTON_YEAR);
  const playlistUrl = currentSeason?.playlist?.id
    ? `https://open.spotify.com/playlist/${currentSeason.playlist.id}`
    : null;

  // Per-week dedupe + rotation cursor, both read from the table. Handle the
  // "table not initialized" case with a user-actionable message pointing at
  // the /troubleshooting init button (this project uses db push, not
  // migrations, so a new table needs a one-shot DDL pass in prod).
  let alreadySentThisWeek: { sentAt: Date; personaKey: string } | null;
  let rotationCursor: number;
  try {
    [alreadySentThisWeek, rotationCursor] = await Promise.all([
      prisma.fridayReminderNotification.findFirst({
        where: { weekOf: fridayDate, resendId: { not: null } },
        select: { sentAt: true, personaKey: true },
        orderBy: { sentAt: "desc" },
      }),
      prisma.fridayReminderNotification.count({
        where: { resendId: { not: null } },
      }),
    ]);
  } catch (error) {
    const name = error instanceof Error ? error.name : "PrismaError";
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist/i.test(message)) {
      return NextResponse.json(
        {
          ok: false,
          error: "MissingTable",
          message:
            "FridayReminderNotification table doesn't exist yet. Visit /troubleshooting and click 'Initialize FridayReminderNotification table', then retry. (This project uses `prisma db push`, not migrations, so new tables need a one-shot DDL pass in prod.)",
        },
        { status: 500 },
      );
    }
    console.error("[friday-reminder.dedupe.failed]", { callerId, name, message });
    return NextResponse.json(
      {
        error: name,
        message: `Failed to read FridayReminderNotification for dedupe/rotation: ${message}. Check DATABASE_URL.`,
      },
      { status: 500 },
    );
  }

  if (alreadySentThisWeek) {
    return NextResponse.json({
      ok: true,
      status: "skipped-already-sent",
      weekOf: fridayDate.toISOString(),
      bomptonYear: CURRENT_BOMPTON_YEAR,
      sentAt: alreadySentThisWeek.sentAt.toISOString(),
      personaKey: alreadySentThisWeek.personaKey,
      message: `Friday reminder for ${fridayDate.toISOString().slice(0, 10)} was already sent (persona '${alreadySentThisWeek.personaKey}'). Skipping to avoid a duplicate crew-wide blast.`,
    });
  }

  if (dryRun) {
    // A scheduled one-off pinned to this Friday overrides the rotation; report
    // it so an operator can confirm the right email is queued for the week.
    const scheduled = scheduledPersonaFor(fridayDate);
    const personaIndex = rotationCursor % FRIDAY_REMINDER_PERSONA_COUNT;
    return NextResponse.json({
      ok: true,
      status: "skipped-dry-run",
      weekOf: fridayDate.toISOString(),
      bomptonYear: CURRENT_BOMPTON_YEAR,
      scheduledPersonaKey: scheduled?.key ?? null,
      personaIndex,
      recipients,
      playlistUrl,
    });
  }

  const personaIndex = rotationCursor % FRIDAY_REMINDER_PERSONA_COUNT;
  try {
    const result = await sendFridayReminderEmail({
      recipients,
      bomptonYear: CURRENT_BOMPTON_YEAR,
      playlistUrl,
      fridayDate,
      personaIndex,
    });
    try {
      await prisma.fridayReminderNotification.create({
        data: {
          bomptonYear: CURRENT_BOMPTON_YEAR,
          weekOf: fridayDate,
          personaKey: result.personaKey,
          recipients: result.recipients,
          resendId: result.resendId,
        },
      });
    } catch (dbError) {
      console.error("[friday-reminder.record.failed]", {
        callerId,
        resendId: result.resendId,
        message: dbError instanceof Error ? dbError.message : String(dbError),
      });
    }
    console.log("[friday-reminder]", {
      callerId,
      weekOf: fridayDate.toISOString(),
      personaKey: result.personaKey,
      recipientCount: result.recipients.length,
      resendId: result.resendId,
    });
    return NextResponse.json({
      ok: true,
      status: "sent",
      weekOf: fridayDate.toISOString(),
      bomptonYear: CURRENT_BOMPTON_YEAR,
      personaKey: result.personaKey,
      subject: result.subject,
      recipients: result.recipients,
      resendId: result.resendId,
    });
  } catch (error) {
    if (error instanceof FridayReminderEmailConfigError) {
      console.error("[friday-reminder.config-error]", {
        callerId,
        message: error.message,
      });
      return NextResponse.json(
        {
          ok: false,
          status: "config-error",
          error: error.name,
          message: error.message,
        },
        { status: 500 },
      );
    }
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error instanceof FridayReminderEmailSendError ? error.status : 0;
    const errBody =
      error instanceof FridayReminderEmailSendError ? error.body : "";
    // Log the failure so we can see why a send refused without logging into
    // Resend. resendId stays null, so this row doesn't count as "sent" — the
    // dedupe check ignores it and the next run can retry the same week.
    try {
      await prisma.fridayReminderNotification.create({
        data: {
          bomptonYear: CURRENT_BOMPTON_YEAR,
          weekOf: fridayDate,
          personaKey: "(failed to send)",
          recipients,
          errorMessage: `${name}: ${message}`,
        },
      });
    } catch (dbError) {
      console.error("[friday-reminder.record-failure.failed]", {
        callerId,
        message: dbError instanceof Error ? dbError.message : String(dbError),
      });
    }
    console.error("[friday-reminder.send.failed]", {
      callerId,
      name,
      message,
      resendStatus: status,
      resendBody: errBody.slice(0, 500),
    });
    return NextResponse.json(
      {
        ok: false,
        status: "send-error",
        error: name,
        message,
      },
      { status: 502 },
    );
  }
}

// UTC midnight of the most recent Friday on or before `now`. The cron fires
// Friday ~15:00 UTC (noon Atlantic Daylight Time), so during a real cron run
// this returns today's date at 00:00 UTC. Manual runs on other days resolve
// to the most recent past Friday, which is the sensible "this week" anchor.
function currentFridayUtc(now: Date): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dow = d.getUTCDay(); // 0 Sun … 5 Fri … 6 Sat
  const daysSinceFriday = (dow - 5 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceFriday);
  return d;
}
