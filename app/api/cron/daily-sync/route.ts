import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// Vercel cron entry point. Hits this URL once per day at the schedule
// configured in vercel.json (currently 17:00 UTC = 2pm Atlantic Daylight
// Time / 1pm Atlantic Standard Time — Vercel cron is evaluated in UTC
// and does not observe DST, so the local hour drifts by 1 twice a year).
//
// Job:
//   1. Sync every UserPlaylistLink whose Playlist.lastSyncAt is older
//      than ~14 hours, calling the existing /api/sync-all-playlists
//      route. The 14h staleness window means a dashboard visit earlier
//      in the same day (after midnight Atlantic) is enough to skip the
//      cron's sync work.
//   2. Run the late-add notification check via /api/late-add-notifications,
//      which fires roast emails to anyone >3 days late on a Bompton add.
//      That route already enforces a per-user 24h cooldown, so duplicate
//      cron firings won't double-send.
//
// Auth: gated by isAuthorizedCron() which requires either the
// `x-vercel-cron: 1` header (Vercel attaches it automatically and strips
// any client-supplied copy at the edge) or `Authorization: Bearer
// $CRON_SECRET` (only useful if CRON_SECRET env var is set). No manual
// env var setup needed for the cron to work — the secret is just an
// optional escape hatch for curl-based testing.
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

  const origin = request.nextUrl.origin;
  const cronHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-vercel-cron": "1",
  };
  if (process.env.CRON_SECRET) {
    cronHeaders.Authorization = `Bearer ${process.env.CRON_SECRET}`;
  }

  let syncStatus = 0;
  let syncBody: unknown = null;
  try {
    const r = await fetch(`${origin}/api/sync-all-playlists`, {
      method: "POST",
      headers: cronHeaders,
      body: JSON.stringify({ force: false, staleMs: FOURTEEN_HOURS_MS }),
    });
    syncStatus = r.status;
    syncBody = await r.json().catch(() => null);
  } catch (error) {
    const name = error instanceof Error ? error.name : "FetchError";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron.daily-sync.sync-all.failed]", { name, message });
    return NextResponse.json(
      {
        error: name,
        message: `Daily cron step 1 (sync-all-playlists) threw before responding: ${message}. Check that /api/sync-all-playlists is deployed and DATABASE_URL is reachable from this Vercel function.`,
      },
      { status: 500 },
    );
  }

  let notifyStatus = 0;
  let notifyBody: unknown = null;
  try {
    const r = await fetch(`${origin}/api/late-add-notifications`, {
      method: "POST",
      headers: cronHeaders,
      body: JSON.stringify({}),
    });
    notifyStatus = r.status;
    notifyBody = await r.json().catch(() => null);
  } catch (error) {
    const name = error instanceof Error ? error.name : "FetchError";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron.daily-sync.notify.failed]", { name, message });
    return NextResponse.json(
      {
        error: name,
        message: `Daily cron step 2 (late-add-notifications) threw before responding: ${message}. Check that /api/late-add-notifications is deployed, RESEND_API_KEY + RESEND_FROM_EMAIL are set, and DATABASE_URL is reachable.`,
        syncStatus,
        syncBody,
      },
      { status: 500 },
    );
  }

  const ok = syncStatus < 400 && notifyStatus < 400;
  console.log("[cron.daily-sync]", { ok, syncStatus, notifyStatus });

  return NextResponse.json(
    { ok, syncStatus, syncBody, notifyStatus, notifyBody },
    { status: ok ? 200 : 500 },
  );
}
