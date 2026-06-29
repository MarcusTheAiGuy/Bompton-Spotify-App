import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { captureAllListeningArchives } from "@/lib/listening-archive";

export const dynamic = "force-dynamic";

// POST|GET /api/archive-listening
//
// Walks every user with a linked Spotify account and banks as much of
// their listening data as we can each day into durable tables, so we
// accumulate a picture over time that Spotify's point-in-time endpoints
// don't give us:
//   - recently-played -> ListeningPlay (append-only; Spotify only ever
//     returns the last 50 plays)
//   - top tracks/artists (each time range), the full saved library
//     (tracks/albums/shows/episodes/audiobooks), followed artists,
//     playlists, and the profile -> ListeningSnapshot (one row per UTC
//     day per kind)
//
// Each user is processed with their OWN stored OAuth token — we never reuse
// the caller's token against another user's account. Sequential to avoid
// bursting Spotify into 429s; expect a multi-second response. Best-effort:
// a dead token, a user needing reauth, or a not-yet-initialized table is
// reported in `results`, never fatal.
//
// Auth: a signed-in crew member OR a Vercel cron / CRON_SECRET caller
// (same gate as /api/sync-all-playlists). Called once a day by
// /api/cron/daily-sync; also safe to hit manually for a backfill.

export async function POST(request: NextRequest) {
  return handle(request);
}

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
          "Not signed in. /api/archive-listening requires either a Spotify session or a Vercel cron invocation (x-vercel-cron header) or Authorization: Bearer $CRON_SECRET.",
      },
      { status: 401 },
    );
  }
  const callerId = session?.user?.id ?? "vercel-cron";

  try {
    const { users, results } = await captureAllListeningArchives();

    let playsInserted = 0;
    let snapshotsSaved = 0;
    let needsReauth = 0;
    for (const r of results) {
      if ("inserted" in r.recentPlays) playsInserted += r.recentPlays.inserted;
      snapshotsSaved += r.snapshots.filter((s) => s.status === "saved").length;
      if (r.needsReauth) needsReauth += 1;
    }

    console.log("[archive-listening]", {
      callerId,
      users,
      playsInserted,
      snapshotsSaved,
      needsReauth,
    });

    return NextResponse.json({
      ok: true,
      callerId,
      users,
      playsInserted,
      snapshotsSaved,
      needsReauth,
      results,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[archive-listening.failed]", { callerId, name, message });
    return NextResponse.json(
      {
        error: name,
        message: `Failed to capture listening archives: ${message}. This is usually DATABASE_URL being unreachable (the per-user Spotify failures are caught and reported in results, not thrown). Check the DB connection and that the Account table exists.`,
      },
      { status: 500 },
    );
  }
}
