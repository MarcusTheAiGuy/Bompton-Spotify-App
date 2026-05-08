import { prisma } from "@/lib/prisma";
import type { SpotifyRecentlyPlayedItem } from "@/lib/spotify";

// Append-only mirror of /me/player/recently-played in the ListeningPlay
// table. Spotify only ever returns the last 50 plays per request, so
// the table fills as users hit the dashboard over time. We dedupe on
// (userId, trackSpotifyId, playedAt) so re-fetching is idempotent.

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist/i.test(message);
}

export async function appendRecentPlays(
  userId: string,
  items: SpotifyRecentlyPlayedItem[],
): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };

  const rows = items
    .map((item) => {
      const trackId = item.track?.id;
      const playedAt = item.played_at;
      if (!trackId || !playedAt) return null;
      return {
        userId,
        trackSpotifyId: trackId,
        trackName: item.track.name,
        trackArtist: item.track.artists?.[0]?.name ?? "",
        trackDurationMs: item.track.duration_ms ?? 0,
        playedAt: new Date(playedAt),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return { inserted: 0, skipped: 0 };

  try {
    const result = await prisma.listeningPlay.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return {
      inserted: result.count,
      skipped: rows.length - result.count,
    };
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn(
        "[listening-history] ListeningPlay table missing — run `npm run db:push` to create it. Skipping recent-plays capture.",
      );
      return { inserted: 0, skipped: rows.length };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[listening-history.append-failed]", {
      userId,
      count: rows.length,
      message,
    });
    return { inserted: 0, skipped: rows.length };
  }
}
