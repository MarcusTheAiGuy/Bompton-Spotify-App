import { prisma } from "@/lib/prisma";
import {
  getArtistTags,
  isLastfmConfigured,
  LastfmConfigError,
  LastfmError,
  normalizeGenreTags,
} from "@/lib/lastfm";
import type { SpotifyArtistRef } from "@/lib/spotify";

// Per-(spotifyId) cache of artist tag data. Used by the genre-tracker
// stats card. The "genres" we store are now Last.fm tags (Spotify's
// /v1/artists endpoint is 403'd for our dev-quota app under the
// Feb-2026 rules), but the schema name stays "genres" so we don't
// need a Prisma migration.
//
// Strategy:
//  - Bulk-load every artist id we need from the Artist table.
//  - For ids we don't have OR rows older than 60 days, fetch from
//    Last.fm by artist NAME (Last.fm doesn't know Spotify ids and
//    has no batch endpoint, so we serial-fetch with a small gap to
//    stay under their 5-req/s rate limit).
//  - To avoid a 60-second server render when 300 artists are
//    uncached on a fresh deploy, cap each render at FETCH_BUDGET
//    fetches. Subsequent renders fill in the rest.
//  - Upsert results so future renders skip the network entirely.

const STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000;
const FETCH_GAP_MS = 250;
const DEFAULT_FETCH_BUDGET = 30;

export type ArtistGenres = { name: string; genres: string[] };

// Result of a genre lookup. `tableMissing` flags the case where the
// Artist table doesn't exist in the DB at all (a fresh deploy that
// hasn't clicked "Initialize Artist table" on /troubleshooting yet),
// so the genre card can show an actionable empty state instead of
// the generic "no data yet" hint. `fetchError` carries the most
// recent Last.fm failure so the empty state can show the actual
// cause when nothing came back.
export type ArtistGenresLookup = {
  artists: Map<string, ArtistGenres>;
  tableMissing: boolean;
  fetchError: ArtistGenresFetchError | null;
  // How many Last.fm artist calls we attempted on this render and
  // how many failed. Renamed from "batches" to keep the existing UI
  // copy ("X/Y batches failed") accurate without a type rename.
  batchesAttempted: number;
  batchesFailed: number;
  // Was the LASTFM_API_KEY env var configured at all? When false we
  // never even try to fetch — the card tells the user to register
  // for a free key.
  apiKeyConfigured: boolean;
  // How many uncached artists remained when we hit the per-render
  // fetch budget. Surfaced so the empty state can say "we filled in
  // X of Y artists this render — reload to fill in the rest." Must
  // be 0 on early-returns that don't run the fetch loop (everything
  // already cached, missing table, no API key, etc.) — reporting
  // the budget capacity here is what made the "N pending (reload)"
  // counter stick at the same number forever.
  fetchBudgetRemaining: number;
};

export type ArtistGenresFetchError = {
  status: number;
  path: string;
  bodyPreview: string;
  message: string;
};

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist/i.test(message);
}

// Re-normalize cached genres at read time. The Artist row was written
// when the artist was last fetched (up to STALE_AFTER_MS ago), so
// rows from before the normalization rules expanded still hold raw
// strings like "Hip-Hop" or "American". Running them through
// normalizeGenreTags here means the genre tracker reflects the
// current rules immediately, without waiting for a 60-day re-fetch
// or a one-shot DB migration.
function parseGenres(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const strings = raw.filter((g): g is string => typeof g === "string");
  return normalizeGenreTags(strings);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Inputs accepted: either a list of bare Spotify artist ids (the old
// shape — we'd need to look up names separately, which we don't have a
// path for) or a list of {id, name} pairs from playlist data. The
// stats page calls us with the second shape; we fall back to "id only"
// if just strings are passed.
export type ArtistInput =
  | string
  | Pick<SpotifyArtistRef, "id" | "name">;

export async function getArtistGenresForIds(
  _callerUserId: string,
  artistInputs: ArtistInput[],
  options: { fetchBudget?: number } = {},
): Promise<ArtistGenresLookup> {
  const fetchBudget = options.fetchBudget ?? DEFAULT_FETCH_BUDGET;
  const result = new Map<string, ArtistGenres>();
  let fetchError: ArtistGenresFetchError | null = null;
  let batchesAttempted = 0;
  let batchesFailed = 0;

  // Normalize inputs to {id, name} and dedupe by id.
  const normalized = new Map<string, string>();
  for (const input of artistInputs) {
    if (typeof input === "string") {
      if (input) normalized.set(input, "");
      continue;
    }
    if (!input?.id) continue;
    if (!normalized.has(input.id) || (input.name && !normalized.get(input.id))) {
      normalized.set(input.id, input.name ?? "");
    }
  }
  if (normalized.size === 0) {
    return {
      artists: result,
      tableMissing: false,
      fetchError: null,
      batchesAttempted: 0,
      batchesFailed: 0,
      apiKeyConfigured: isLastfmConfigured(),
      fetchBudgetRemaining: 0,
    };
  }

  const ids = [...normalized.keys()];
  let cached: Awaited<ReturnType<typeof prisma.artist.findMany>> = [];
  try {
    cached = await prisma.artist.findMany({
      where: { spotifyId: { in: ids } },
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn(
        "[artist-genres] Artist table missing — click 'Initialize Artist table' on /troubleshooting (or run `npm run db:push`). Returning no genre data for now.",
      );
      return {
        artists: result,
        tableMissing: true,
        fetchError: null,
        batchesAttempted: 0,
        batchesFailed: 0,
        apiKeyConfigured: isLastfmConfigured(),
        fetchBudgetRemaining: 0,
      };
    }
    throw error;
  }

  const cachedById = new Map(cached.map((a) => [a.spotifyId, a]));
  const now = Date.now();
  const stale: { id: string; name: string }[] = [];
  for (const id of ids) {
    const row = cachedById.get(id);
    const name = normalized.get(id) || row?.name || "";
    if (!row) {
      if (name) stale.push({ id, name });
      continue;
    }
    if (now - row.updatedAt.getTime() > STALE_AFTER_MS && name) {
      stale.push({ id, name });
    }
    result.set(id, { name: row.name, genres: parseGenres(row.genres) });
  }

  if (stale.length === 0) {
    return {
      artists: result,
      tableMissing: false,
      fetchError: null,
      batchesAttempted: 0,
      batchesFailed: 0,
      apiKeyConfigured: isLastfmConfigured(),
      fetchBudgetRemaining: 0,
    };
  }

  // Hit Last.fm for the stale set, capped by the per-render budget.
  if (!isLastfmConfigured()) {
    return {
      artists: result,
      tableMissing: false,
      fetchError: {
        status: 0,
        path: "lib/lastfm.ts:getArtistTags",
        bodyPreview: "",
        message:
          "LASTFM_API_KEY is not set — register at https://www.last.fm/api/account/create and add LASTFM_API_KEY to env.",
      },
      batchesAttempted: 0,
      batchesFailed: 0,
      apiKeyConfigured: false,
      fetchBudgetRemaining: 0,
    };
  }

  const toFetch = stale.slice(0, fetchBudget);
  const fetchBudgetRemaining = Math.max(0, stale.length - toFetch.length);

  for (let i = 0; i < toFetch.length; i += 1) {
    const { id, name } = toFetch[i];
    batchesAttempted += 1;
    try {
      const lookup = await getArtistTags(name);
      const tagNames = lookup.tags.map((t) => t.name);
      result.set(id, { name, genres: tagNames });
      try {
        await prisma.artist.upsert({
          where: { spotifyId: id },
          create: { spotifyId: id, name, genres: tagNames },
          update: { name, genres: tagNames },
        });
      } catch (error) {
        if (isMissingTableError(error)) {
          console.warn(
            "[artist-genres] Artist table missing on upsert — click 'Initialize Artist table' on /troubleshooting.",
          );
          return {
            artists: result,
            tableMissing: true,
            fetchError,
            batchesAttempted,
            batchesFailed,
            apiKeyConfigured: true,
            fetchBudgetRemaining,
          };
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error("[artist-genres.upsert-failed]", { spotifyId: id, message });
      }
    } catch (error) {
      batchesFailed += 1;
      if (error instanceof LastfmConfigError) {
        // Shouldn't happen after the isLastfmConfigured check but
        // handle defensively.
        if (!fetchError) {
          fetchError = {
            status: 0,
            path: "lib/lastfm.ts",
            bodyPreview: "",
            message: error.message,
          };
        }
        break;
      }
      if (error instanceof LastfmError) {
        console.warn(
          `[artist-genres] Last.fm artist.gettoptags("${name}") failed (HTTP ${error.status}, lastfm-code ${error.lastfmCode}): ${error.body.slice(
            0,
            200,
          )}.`,
        );
        if (!fetchError) {
          fetchError = {
            status: error.status,
            path: error.path,
            bodyPreview: error.body.slice(0, 300),
            message:
              error.lastfmCode > 0
                ? `Last.fm code ${error.lastfmCode}: ${error.message}`
                : error.message,
          };
        }
        // Codes 10 (invalid key) and 26 (suspended key) are fatal:
        // every subsequent call will fail the same way. Bail out
        // without caching anything so a fresh render after the key
        // is fixed can retry from scratch.
        if (error.lastfmCode === 10 || error.lastfmCode === 26) break;
        // Codes 11 (offline) and 16 (temporarily unavailable) are
        // platform-side outages. 29 is rate limit. All transient
        // — break this render and retry next time without writing
        // a misleading empty cache row.
        if (
          error.lastfmCode === 11 ||
          error.lastfmCode === 16 ||
          error.lastfmCode === 29
        ) {
          break;
        }
        // Everything else (code 6 not-found, code 8 operation
        // failed, HTTP 4xx/5xx that didn't surface a known Last.fm
        // code, weird name encoding issues that consistently fail,
        // etc.) is treated as "we tried this artist, no tags
        // available". Without this we'd retry the same set of
        // failing artists every render — that's the bug that
        // freezes the "N pending" counter on the genre card.
        // STALE_AFTER_MS (60 days) gives us another shot in case
        // the underlying problem clears.
        result.set(id, { name, genres: [] });
        try {
          await prisma.artist.upsert({
            where: { spotifyId: id },
            create: { spotifyId: id, name, genres: [] },
            update: { name, genres: [] },
          });
        } catch (upsertError) {
          if (isMissingTableError(upsertError)) {
            console.warn(
              "[artist-genres] Artist table missing on not-found upsert — click 'Initialize Artist table' on /troubleshooting.",
            );
            return {
              artists: result,
              tableMissing: true,
              fetchError,
              batchesAttempted,
              batchesFailed,
              apiKeyConfigured: true,
              fetchBudgetRemaining,
            };
          }
          const upsertMessage =
            upsertError instanceof Error
              ? upsertError.message
              : String(upsertError);
          console.error("[artist-genres.upsert-not-found-failed]", {
            spotifyId: id,
            name,
            lastfmCode: error.lastfmCode,
            httpStatus: error.status,
            message: upsertMessage,
          });
        }
        // Keep going — a single artist failing shouldn't kill the
        // whole batch.
      } else {
        const message = error instanceof Error ? error.message : String(error);
        if (!fetchError) {
          fetchError = {
            status: 0,
            path: `getArtistTags(${name})`,
            bodyPreview: "",
            message,
          };
        }
        break;
      }
    }
    // Throttle.
    if (i < toFetch.length - 1) await delay(FETCH_GAP_MS);
  }

  return {
    artists: result,
    tableMissing: false,
    fetchError,
    batchesAttempted,
    batchesFailed,
    apiKeyConfigured: true,
    fetchBudgetRemaining,
  };
}
