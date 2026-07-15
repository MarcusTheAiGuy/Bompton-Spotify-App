import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { syncAllPlaylists } from "@/lib/sync-all-playlists";
import { runLateAddNotifications } from "@/lib/late-add-notifications";
import { captureAllListeningArchives } from "@/lib/listening-archive";

export const dynamic = "force-dynamic";
// The three steps run sequentially in a single invocation. Give the
// function headroom over the default so a slow crew-wide Spotify sync
// doesn't get killed mid-run (60s is within both the Hobby and Pro limits).
export const maxDuration = 60;

// Vercel cron entry point. Hits this URL once per day at the schedule
// configured in vercel.json (currently 17:00 UTC = 2pm Atlantic Daylight
// Time / 1pm Atlantic Standard Time — Vercel cron is evaluated in UTC
// and does not observe DST, so the local hour drifts by 1 twice a year).
//
// Job:
//   1. Sync every UserPlaylistLink whose Playlist.lastSyncAt is older
//      than ~14 hours (via lib/sync-all-playlists). The 14h staleness
//      window means a dashboard visit earlier in the same day (after
//      midnight Atlantic) is enough to skip the cron's sync work.
//   2. Run the late-add notification check (via lib/late-add-notifications),
//      which fires roast emails to anyone >3 days late on a Bompton add.
//      It already enforces a per-user 24h cooldown, so duplicate cron
//      firings won't double-send.
//   3. Capture every linked account's listening data via
//      captureAllListeningArchives — recently-played into ListeningPlay and
//      a daily snapshot into ListeningSnapshot. Runs for everyone regardless
//      of who opened the dashboard. Idempotent per UTC day.
//
// IMPORTANT: each step is invoked IN-PROCESS via a direct function call,
// NOT by fetching /api/sync-all-playlists, /api/late-add-notifications, or
// /api/archive-listening. An earlier version fetched those sub-routes and
// tried to authorize the calls by forwarding an `x-vercel-cron: 1` header —
// but Vercel strips client-supplied `x-vercel-*` headers at the edge (see
// lib/cron-auth.ts), and an internal fetch is client-supplied from the
// edge's point of view. With CRON_SECRET unset (it's documented as
// optional) those sub-calls all 401'd, so the daily cron silently did
// nothing: no sync, no roast email, no archive. The late-add email only
// ever went out when a human opened the dashboard, whose session-authed
// auto-sync chain runs the same steps. Calling the logic directly removes
// the whole auth round-trip and makes the cron self-sufficient.
//
// Auth: gated by isAuthorizedCron() which requires either the
// `x-vercel-cron: 1` header (Vercel attaches it automatically to this
// direct cron invocation and strips any client-supplied copy at the edge)
// or `Authorization: Bearer $CRON_SECRET` (only useful if CRON_SECRET is
// set, e.g. for curl-based testing).
const FOURTEEN_HOURS_MS = 14 * 60 * 60_000;

export async function POST(request: NextRequest) {
  return handle(request);
}

// Vercel's cron uses GET by default. Accept both so the same route works
// whether the schedule is changed to POST or kept on GET.
export async function GET(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message:
          "Daily-sync cron rejected: missing `x-vercel-cron: 1` header and no matching `Authorization: Bearer $CRON_SECRET`. This URL is only callable by a Vercel cron (see vercel.json) or by something presenting CRON_SECRET.",
      },
      { status: 401 },
    );
  }

  // Step 1: crew-wide playlist sync.
  let syncStatus = 0;
  let syncBody: unknown = null;
  try {
    const r = await syncAllPlaylists({
      force: false,
      staleMs: FOURTEEN_HOURS_MS,
      callerId: "vercel-cron",
    });
    syncStatus = r.status;
    syncBody = r.body;
  } catch (error) {
    const name = error instanceof Error ? error.name : "SyncError";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron.daily-sync.sync-all.failed]", { name, message });
    return NextResponse.json(
      {
        error: name,
        message: `Daily cron step 1 (syncAllPlaylists) threw before returning: ${message}. This is almost always DATABASE_URL being unreachable from this Vercel function — per-playlist Spotify failures are captured in the step's outcomes, not thrown.`,
      },
      { status: 500 },
    );
  }

  // Step 2: late-add roast emails.
  let notifyStatus = 0;
  let notifyBody: unknown = null;
  try {
    const r = await runLateAddNotifications({
      thresholdDays: 3,
      dryRun: false,
      callerId: "vercel-cron",
    });
    notifyStatus = r.status;
    notifyBody = r.body;
  } catch (error) {
    const name = error instanceof Error ? error.name : "NotifyError";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron.daily-sync.notify.failed]", { name, message });
    return NextResponse.json(
      {
        error: name,
        message: `Daily cron step 2 (runLateAddNotifications) threw before returning: ${message}. Check that RESEND_API_KEY + RESEND_FROM_EMAIL are set and DATABASE_URL is reachable. Per-offender send failures are captured in the step's outcomes, not thrown.`,
        syncStatus,
        syncBody,
      },
      { status: 500 },
    );
  }

  // Step 3: daily listening archive for everyone.
  let archiveStatus = 0;
  let archiveBody: unknown = null;
  try {
    const { users, results } = await captureAllListeningArchives();
    let playsInserted = 0;
    let snapshotsSaved = 0;
    let needsReauth = 0;
    for (const res of results) {
      if ("inserted" in res.recentPlays) playsInserted += res.recentPlays.inserted;
      snapshotsSaved += res.snapshots.filter((s) => s.status === "saved").length;
      if (res.needsReauth) needsReauth += 1;
    }
    console.log("[archive-listening]", {
      callerId: "vercel-cron",
      users,
      playsInserted,
      snapshotsSaved,
      needsReauth,
    });
    archiveStatus = 200;
    archiveBody = {
      ok: true,
      callerId: "vercel-cron",
      users,
      playsInserted,
      snapshotsSaved,
      needsReauth,
      results,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "ArchiveError";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron.daily-sync.archive.failed]", { name, message });
    return NextResponse.json(
      {
        error: name,
        message: `Daily cron step 3 (captureAllListeningArchives) threw before returning: ${message}. Per-user Spotify failures don't throw here — they're reported in the results array — so a throw means the DB or the archive code itself is down. Check DATABASE_URL and that the Account table exists.`,
        syncStatus,
        syncBody,
        notifyStatus,
        notifyBody,
      },
      { status: 500 },
    );
  }

  const ok = syncStatus < 400 && notifyStatus < 400 && archiveStatus < 400;
  console.log("[cron.daily-sync]", {
    ok,
    syncStatus,
    notifyStatus,
    archiveStatus,
  });

  return NextResponse.json(
    {
      ok,
      syncStatus,
      syncBody,
      notifyStatus,
      notifyBody,
      archiveStatus,
      archiveBody,
    },
    { status: ok ? 200 : 500 },
  );
}
