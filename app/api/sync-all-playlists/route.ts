import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { syncAllPlaylists } from "@/lib/sync-all-playlists";

export const dynamic = "force-dynamic";

// POST /api/sync-all-playlists
// Body (optional): { staleMs?: number, force?: boolean }
//
// Resyncs every UserPlaylistLink in the DB, regardless of which user is
// calling. Each link is synced with that user's own stored OAuth token
// — we never piggyback the caller's token onto another user's playlist.
//
// Default behavior: skip links whose Playlist.lastSyncAt is fresher than
// `staleMs` (1 hour by default). Pass { force: true } to ignore freshness
// and resync every link unconditionally.
//
// The actual work lives in lib/sync-all-playlists.ts so the daily-sync
// cron can call it in-process instead of re-fetching this route (that
// path 401'd — the forwarded x-vercel-cron header is stripped at the edge).
export async function POST(request: NextRequest) {
  const session = await auth();
  const cron = isAuthorizedCron(request);
  if (!session?.user?.id && !cron) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message:
          "Not signed in. /api/sync-all-playlists requires either a Spotify session or a Vercel cron invocation (x-vercel-cron header) or Authorization: Bearer $CRON_SECRET.",
      },
      { status: 401 },
    );
  }
  const callerId = session?.user?.id ?? "vercel-cron";

  // Body is optional — if it's missing or malformed, fall back to defaults
  // rather than 400-ing the auto-sync trigger.
  let body: { staleMs?: unknown; force?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const force = Boolean(body.force);
  const staleMs =
    typeof body.staleMs === "number" && Number.isFinite(body.staleMs)
      ? body.staleMs
      : 60 * 60_000;

  const { status, body: resBody } = await syncAllPlaylists({
    force,
    staleMs,
    callerId,
  });
  return NextResponse.json(resBody, { status });
}
