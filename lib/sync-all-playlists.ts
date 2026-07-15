import { prisma } from "@/lib/prisma";
import { PlaylistSyncError, syncPlaylistForUser } from "@/lib/playlist-sync";

// Core of POST /api/sync-all-playlists, extracted so it can run either
// behind the route (session- or cron-authed HTTP call) OR directly
// in-process from the daily-sync cron. The cron used to reach this by
// fetching the route and forwarding an `x-vercel-cron: 1` header, but
// that header is stripped at the edge on an internal fetch (see
// lib/cron-auth.ts), so the sub-call 401'd and no sync ran. Calling this
// function directly avoids the whole auth round-trip.
//
// Resyncs every UserPlaylistLink in the DB, each with that user's own
// stored OAuth token — we never piggyback one caller's token onto another
// user's playlist. Sequential to avoid bursting Spotify into 429s.

export type SyncAllPlaylistsResult = {
  status: number;
  body: Record<string, unknown>;
};

export async function syncAllPlaylists({
  force,
  staleMs,
  callerId,
}: {
  // Skip links whose Playlist.lastSyncAt is fresher than staleMs. Pass
  // force to resync every link regardless of freshness.
  force: boolean;
  staleMs: number;
  // For log lines only — "vercel-cron" for the cron, the user id otherwise.
  callerId: string;
}): Promise<SyncAllPlaylistsResult> {
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
    return {
      status: 500,
      body: {
        error: error instanceof Error ? error.name : "PrismaError",
        message: `Failed to list UserPlaylistLink rows: ${message}. If the table is missing, visit /troubleshooting and click 'Initialize UserPlaylistLink table'.`,
      },
    };
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

  return {
    status: 200,
    body: {
      ok: errors === 0,
      callerId,
      totalLinks: links.length,
      attempted: targets.length,
      synced,
      errors,
      skippedFresh,
      outcomes,
    },
  };
}
