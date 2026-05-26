import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import {
  PlaylistSyncError,
  syncPlaylistForUser,
} from "@/lib/playlist-sync";

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
// Sequential: links are processed one-at-a-time so we don't burst
// Spotify with N parallel requests and trip 429s. The page that calls
// this should expect a multi-second response.
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

  let links: {
    userId: string;
    playlistId: string;
    playlist: { lastSyncAt: Date | null; name: string } | null;
    user: { name: string | null; email: string | null };
  }[];
  try {
    links = await prisma.userPlaylistLink.findMany({
      select: {
        userId: true,
        playlistId: true,
        playlist: { select: { lastSyncAt: true, name: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: [{ userId: "asc" }, { createdAt: "asc" }],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync-all-playlists.findMany.failed]", {
      callerId,
      message,
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.name : "PrismaError",
        message: `Failed to list UserPlaylistLink rows: ${message}. If the table is missing, visit /troubleshooting and click 'Initialize UserPlaylistLink table'.`,
      },
      { status: 500 },
    );
  }

  const now = Date.now();
  const targets = links.filter((l) => {
    if (force) return true;
    const last = l.playlist?.lastSyncAt;
    if (!last) return true;
    return now - last.getTime() >= staleMs;
  });

  type SyncOutcome = {
    userId: string;
    userLabel: string;
    playlistId: string;
    playlistName: string | null;
    status: "synced" | "skipped" | "error";
    tracksWritten?: number;
    snapshotChanged?: boolean;
    error?: { name: string; code?: string; message: string };
  };

  const outcomes: SyncOutcome[] = [];
  let synced = 0;
  let errors = 0;
  let skippedFresh = 0;

  for (const link of links) {
    const userLabel = link.user.name ?? link.user.email ?? link.userId;
    const isTarget = targets.some(
      (t) => t.userId === link.userId && t.playlistId === link.playlistId,
    );
    if (!isTarget) {
      skippedFresh++;
      outcomes.push({
        userId: link.userId,
        userLabel,
        playlistId: link.playlistId,
        playlistName: link.playlist?.name ?? null,
        status: "skipped",
      });
      continue;
    }
    try {
      const result = await syncPlaylistForUser(link.userId, link.playlistId);
      synced++;
      outcomes.push({
        userId: link.userId,
        userLabel,
        playlistId: link.playlistId,
        playlistName: result.playlistName,
        status: "synced",
        tracksWritten: result.tracksWritten,
        snapshotChanged: result.snapshotChanged,
      });
    } catch (error) {
      errors++;
      if (error instanceof PlaylistSyncError) {
        outcomes.push({
          userId: link.userId,
          userLabel,
          playlistId: link.playlistId,
          playlistName: link.playlist?.name ?? null,
          status: "error",
          error: {
            name: error.name,
            code: error.code,
            message: error.message,
          },
        });
        console.warn("[sync-all-playlists.link.refused]", {
          callerId,
          userId: link.userId,
          playlistId: link.playlistId,
          code: error.code,
          details: error.details,
          message: error.message,
        });
      } else {
        const name = error instanceof Error ? error.name : "UnknownError";
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        outcomes.push({
          userId: link.userId,
          userLabel,
          playlistId: link.playlistId,
          playlistName: link.playlist?.name ?? null,
          status: "error",
          error: { name, message },
        });
        console.error("[sync-all-playlists.link.failed]", {
          callerId,
          userId: link.userId,
          playlistId: link.playlistId,
          name,
          message,
          stack,
        });
      }
    }
  }

  console.log("[sync-all-playlists]", {
    callerId,
    totalLinks: links.length,
    attempted: targets.length,
    synced,
    errors,
    skippedFresh,
    force,
    staleMs,
  });

  return NextResponse.json({
    ok: errors === 0,
    callerId,
    totalLinks: links.length,
    attempted: targets.length,
    synced,
    errors,
    skippedFresh,
    outcomes,
  });
}
