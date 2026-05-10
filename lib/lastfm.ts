// Last.fm Web Services 2.0 fetcher. Used by the genre tracker stats
// card now that Spotify's /v1/artists endpoint is 403'd for our
// dev-quota app. Last.fm crowdsources tags rather than curating
// genres, so the labels are messier ("alternative rock" vs "indie
// rock" vs "alt") but coverage is much better than what Spotify
// currently returns.
//
// API ref: https://www.last.fm/api/show/artist.getTopTags
//
// Auth model: a single API key passed as a query-string param. No
// signing, no per-user OAuth — we use the same key for every lookup.
// Set LASTFM_API_KEY in env. Without it, getArtistTags throws
// LastfmConfigError on the first call.
//
// Rate limit: documented as 5 requests/second per IP. We don't
// parallelize calls anywhere in this codebase, but if you ever do,
// keep at least 250ms between requests to stay well under.

const LASTFM_API_BASE = "https://ws.audioscrobbler.com/2.0/";

export class LastfmConfigError extends Error {
  constructor() {
    super(
      "LASTFM_API_KEY is not set. Register at https://www.last.fm/api/account/create and add LASTFM_API_KEY to Vercel env (and .env.local for local dev).",
    );
    this.name = "LastfmConfigError";
  }
}

// Last.fm replies with HTTP 200 even on application errors; the body
// carries a numeric `error` field. We model both shapes in one error
// class so callers can branch on `status` (HTTP) and `lastfmCode`
// (Last.fm's documented error code, 0 if the failure was at the HTTP
// layer).
//
// Common Last.fm codes:
//   2  Invalid service
//   3  Invalid Method
//   4  Authentication Failed
//   6  Invalid parameters / not found (most often: artist with that name)
//   8  Operation failed
//  10  Invalid API key
//  11  Service Offline
//  16  The service is temporarily unavailable
//  26  Suspended API key
//  29  Rate limit exceeded
export class LastfmError extends Error {
  constructor(
    message: string,
    public status: number,
    public lastfmCode: number,
    public path: string,
    public body: string,
  ) {
    super(message);
    this.name = "LastfmError";
  }
}

export type LastfmTopTagsResponse = {
  toptags?: {
    tag?: { name: string; count: number; url: string }[];
    "@attr"?: { artist: string };
  };
  error?: number;
  message?: string;
};

export type LastfmTags = {
  // Artist name as Last.fm canonicalized it (matches the input most of
  // the time, but Last.fm sometimes corrects spelling/casing).
  artist: string;
  // Tags ranked by Last.fm `count` desc. Each `count` is a 0–100
  // Last.fm popularity score for that tag on that artist; we surface
  // the names only and let callers decide on a threshold.
  tags: { name: string; count: number }[];
};

function getApiKey(): string {
  const key = process.env.LASTFM_API_KEY?.trim() ?? "";
  if (!key) throw new LastfmConfigError();
  return key;
}

// Discard tags Last.fm sometimes returns that aren't musical genre
// signals at all. Two buckets:
//  - Listener meta tags ("seen live", "favorites").
//  - Bare nationality / country tags ("american", "british",
//    "japanese"). Last.fm crowdsources these aggressively and they
//    tend to outrank actual genres on widely-known artists. We only
//    block the standalone adjective — compound tags that happen to
//    contain a nationality (e.g. "british invasion", "k-pop",
//    "americana") survive because they don't match the exact string.
const TAG_BLOCKLIST = new Set([
  // Listener meta
  "seen live",
  "favorites",
  "favourite",
  "favorite",
  "favourites",
  "favorite artists",
  "favourite artists",
  // Nationality / country / region (standalone form only)
  "american",
  "british",
  "english",
  "irish",
  "scottish",
  "welsh",
  "canadian",
  "australian",
  "new zealand",
  "kiwi",
  "french",
  "german",
  "spanish",
  "italian",
  "portuguese",
  "dutch",
  "belgian",
  "swiss",
  "swedish",
  "norwegian",
  "danish",
  "finnish",
  "icelandic",
  "japanese",
  "korean",
  "chinese",
  "indian",
  "russian",
  "ukrainian",
  "polish",
  "czech",
  "greek",
  "turkish",
  "brazilian",
  "mexican",
  "argentine",
  "argentinian",
  "colombian",
  "chilean",
  "south african",
  "nigerian",
  "israeli",
  "usa",
  "uk",
  "us",
]);

// Canonicalize a raw Last.fm tag so different stylings of the same
// genre collapse to one bucket. Last.fm users tag freely, so the
// same genre arrives as "Hip Hop", "Hip-Hop", "hip_hop", and
// "  hip  hop  " — all become "hip hop". Applied at fetch time
// (so the DB cache is clean going forward) and again at read time
// in lib/artist-genres.ts (so already-cached rows benefit without
// a re-fetch).
function cleanTagName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Shared by getArtistTags and the DB-read path in artist-genres.ts:
// run a list of raw tag names through cleanTagName, drop blocklisted
// + empty entries, and dedupe (multiple raw tags can normalize to
// the same canonical name — e.g. "Hip Hop" and "Hip-Hop").
export function normalizeGenreTags(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const name = cleanTagName(r);
    if (!name || TAG_BLOCKLIST.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export async function getArtistTags(
  artistName: string,
  options: { minCount?: number; signal?: AbortSignal } = {},
): Promise<LastfmTags> {
  const key = getApiKey();
  const trimmed = artistName.trim();
  if (!trimmed) {
    return { artist: "", tags: [] };
  }
  const url = new URL(LASTFM_API_BASE);
  url.searchParams.set("method", "artist.gettoptags");
  url.searchParams.set("artist", trimmed);
  url.searchParams.set("autocorrect", "1");
  url.searchParams.set("api_key", key);
  url.searchParams.set("format", "json");

  const path = `${url.pathname}?method=artist.gettoptags&artist=${encodeURIComponent(trimmed)}`;
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { "User-Agent": "bompton-spotify-app/1.0" },
      signal: options.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LastfmError(`Network error: ${message}`, 0, 0, path, "");
  }
  const body = await response.text();
  if (!response.ok) {
    throw new LastfmError(
      `Last.fm HTTP ${response.status} on ${path}: ${body.slice(0, 200)}`,
      response.status,
      0,
      path,
      body.slice(0, 500),
    );
  }
  let parsed: LastfmTopTagsResponse;
  try {
    parsed = JSON.parse(body) as LastfmTopTagsResponse;
  } catch (error) {
    throw new LastfmError(
      `Last.fm returned non-JSON on ${path}: ${body.slice(0, 200)}`,
      response.status,
      0,
      path,
      body.slice(0, 500),
    );
  }
  if (typeof parsed.error === "number" && parsed.error > 0) {
    throw new LastfmError(
      `Last.fm error ${parsed.error} on ${path}: ${parsed.message ?? "unknown"}`,
      response.status,
      parsed.error,
      path,
      body.slice(0, 500),
    );
  }

  // Normalize first (so "Hip Hop" and "Hip-Hop" collapse), apply
  // minCount on the raw count, then drop blocklisted + dedupe by
  // canonical name. When two raw tags collapse to the same canonical
  // name we keep the highest count.
  const minCount = options.minCount ?? 0;
  const byName = new Map<string, { name: string; count: number }>();
  for (const t of parsed.toptags?.tag ?? []) {
    if (t.count < minCount) continue;
    const name = cleanTagName(t.name);
    if (!name || TAG_BLOCKLIST.has(name)) continue;
    const existing = byName.get(name);
    if (!existing || t.count > existing.count) {
      byName.set(name, { name, count: t.count });
    }
  }
  return {
    artist: parsed.toptags?.["@attr"]?.artist ?? trimmed,
    tags: [...byName.values()],
  };
}

export function isLastfmConfigured(): boolean {
  return Boolean(process.env.LASTFM_API_KEY?.trim());
}
