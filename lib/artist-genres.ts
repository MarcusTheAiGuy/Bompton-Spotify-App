import { prisma } from "@/lib/prisma";
import { spotifyFetch, SpotifyError, type SpotifyArtist } from "@/lib/spotify";

// Cache of /v1/artists data, keyed by spotify artist id. Used by the
// genre-tracker stats card. We don't get genres back from playlist or
// recently-played responses — they live on the artist object.
//
// Strategy:
//  - Bulk-load every artist id we need from the Artist table.
//  - For ids we don't have OR rows older than 60 days, batch-fetch
//    from Spotify using a caller-authenticated token (the /artists
//    endpoint accepts up to 50 ids per call).
//  - Upsert results so subsequent renders are free.
//
// If the Artist table doesn't exist yet (fresh DB before db push),
// every code path returns the cached map we already have without
// throwing — the genre card just shows "no data yet".

const STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;

export type ArtistGenres = { name: string; genres: string[] };

// Result of a genre lookup. `tableMissing` flags the case where the
// Artist table doesn't exist in the DB at all (a fresh deploy that
// hasn't clicked "Initialize Artist table" on /troubleshooting yet),
// so the genre card can show an actionable empty state instead of the
// generic "no data yet" hint.
export type ArtistGenresLookup = {
  artists: Map<string, ArtistGenres>;
  tableMissing: boolean;
};

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist/i.test(message);
}

function parseGenres(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => (typeof g === "string" ? g.trim() : ""))
    .filter((g): g is string => g.length > 0);
}

export async function getArtistGenresForIds(
  callerUserId: string,
  artistIds: string[],
): Promise<ArtistGenresLookup> {
  const result = new Map<string, ArtistGenres>();
  const unique = [...new Set(artistIds.filter((id) => id))];
  if (unique.length === 0) return { artists: result, tableMissing: false };

  let cached: Awaited<ReturnType<typeof prisma.artist.findMany>> = [];
  try {
    cached = await prisma.artist.findMany({
      where: { spotifyId: { in: unique } },
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn(
        "[artist-genres] Artist table missing — click 'Initialize Artist table' on /troubleshooting (or run `npm run db:push`). Returning no genre data for now.",
      );
      return { artists: result, tableMissing: true };
    }
    throw error;
  }

  const cachedById = new Map(cached.map((a) => [a.spotifyId, a]));
  const now = Date.now();
  const stale: string[] = [];
  for (const id of unique) {
    const row = cachedById.get(id);
    if (!row) {
      stale.push(id);
      continue;
    }
    if (now - row.updatedAt.getTime() > STALE_AFTER_MS) {
      stale.push(id);
    }
    result.set(id, { name: row.name, genres: parseGenres(row.genres) });
  }

  if (stale.length === 0) return { artists: result, tableMissing: false };

  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    const batch = stale.slice(i, i + BATCH_SIZE);
    let response: { artists: (SpotifyArtist | null)[] } | null = null;
    try {
      response = await spotifyFetch<{ artists: (SpotifyArtist | null)[] }>(
        callerUserId,
        `/artists?ids=${batch.join(",")}`,
      );
    } catch (error) {
      if (error instanceof SpotifyError) {
        console.warn(
          `[artist-genres] /artists?ids=... batch failed (HTTP ${error.status}): ${error.body.slice(
            0,
            200,
          )}. Falling back to cached genres only for this batch.`,
        );
        continue;
      }
      throw error;
    }
    if (!response?.artists) continue;
    for (const artist of response.artists) {
      if (!artist || !artist.id) continue;
      const genres = parseGenres(artist.genres);
      const name = artist.name ?? "";
      result.set(artist.id, { name, genres });
      try {
        await prisma.artist.upsert({
          where: { spotifyId: artist.id },
          create: { spotifyId: artist.id, name, genres },
          update: { name, genres },
        });
      } catch (error) {
        if (isMissingTableError(error)) {
          console.warn(
            "[artist-genres] Artist table missing on upsert — click 'Initialize Artist table' on /troubleshooting.",
          );
          return { artists: result, tableMissing: true };
        }
        // Don't crash the whole stats page on a single upsert hiccup —
        // we already have the genre data in memory for this render.
        const message = error instanceof Error ? error.message : String(error);
        console.error("[artist-genres.upsert-failed]", {
          artistId: artist.id,
          message,
        });
      }
    }
  }

  return { artists: result, tableMissing: false };
}
