import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  checkFollowedArtists,
  checkSavedTracks,
  getDevices,
  getFollowedArtists,
  getPlaybackState,
  getPlaylists,
  getQueue,
  getRecentlyPlayed,
  getSavedAlbums,
  getSavedAudiobooks,
  getSavedEpisodes,
  getSavedShows,
  getSavedTracks,
  getSpotifyProfile,
  getTopArtists,
  getTopTracks,
  SpotifyError,
} from "@/lib/spotify";

export const dynamic = "force-dynamic";

// Single dispatch route for the dashboard's client-side lazy loading.
// The client fires one GET per kind, sequentially, after the page mounts.

// TTL policy:
//  - 24h for data that almost never changes in a day (profile / devices
//    / saved content / followed artists). User's explicit choice — a
//    reload within 24h should not retouch Spotify for these.
//  - 5 min for everything else (top items, playback state, queue,
//    recently played, playlists) — still cheap, still fresh enough.
// The durable cache lives in CachedSpotifyResponse. An in-memory
// per-process cache stays layered on top so the same serverless
// instance can return without even a DB roundtrip.
const HOUR_MS = 60 * 60_000;
const TTL_MS_BY_KIND: Record<string, number> = {
  me: 24 * HOUR_MS,
  devices: 24 * HOUR_MS,
  "saved-tracks": 24 * HOUR_MS,
  "saved-albums": 24 * HOUR_MS,
  "saved-shows": 24 * HOUR_MS,
  "saved-episodes": 24 * HOUR_MS,
  "saved-audiobooks": 24 * HOUR_MS,
  "followed-artists": 24 * HOUR_MS,
};
const DEFAULT_TTL_MS = 5 * 60_000;

type CacheEntry = { data: unknown; expiresAt: number };
const memoryCache = new Map<string, CacheEntry>();

const VALID_KINDS = new Set([
  "me",
  "playback",
  "queue",
  "devices",
  "recently-played",
  "top-tracks-short",
  "top-tracks-medium",
  "top-tracks-long",
  "top-artists-short",
  "top-artists-medium",
  "top-artists-long",
  "saved-tracks",
  "saved-albums",
  "saved-shows",
  "saved-episodes",
  "saved-audiobooks",
  "followed-artists",
  "playlists",
  "saved-top-track-check",
  "followed-top-artist-check",
]);

// Kinds that carry query-string params (the overlap checks) use a
// composite cache key that includes the params. The rest cache by
// (userId, kind) directly.
function cacheKey(userId: string, kind: string, search: string): string {
  if (kind === "saved-top-track-check" || kind === "followed-top-artist-check") {
    return `${userId}:${kind}:${search}`;
  }
  return `${userId}:${kind}`;
}

function ttlMs(kind: string): number {
  return TTL_MS_BY_KIND[kind] ?? DEFAULT_TTL_MS;
}

async function readCache(
  userId: string,
  kind: string,
  search: string,
): Promise<unknown | null> {
  const key = cacheKey(userId, kind, search);
  const mem = memoryCache.get(key);
  if (mem && mem.expiresAt > Date.now()) return mem.data;
  // Query-string-keyed kinds only hit the in-memory cache; the DB cache
  // only makes sense for the fixed (userId, kind) keys.
  if (kind === "saved-top-track-check" || kind === "followed-top-artist-check") {
    return null;
  }
  try {
    const row = await prisma.cachedSpotifyResponse.findUnique({
      where: { userId_kind: { userId, kind } },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    memoryCache.set(key, {
      data: row.data,
      expiresAt: row.expiresAt.getTime(),
    });
    return row.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist/i.test(message)) {
      console.warn(
        "[dashboard.kind] CachedSpotifyResponse table missing — click 'Initialize CachedSpotifyResponse table' on /extension-setup. Falling back to in-memory cache only.",
        { userId, kind },
      );
      return null;
    }
    throw error;
  }
}

async function writeCache(
  userId: string,
  kind: string,
  search: string,
  data: unknown,
): Promise<void> {
  const expiresAt = Date.now() + ttlMs(kind);
  memoryCache.set(cacheKey(userId, kind, search), { data, expiresAt });
  if (kind === "saved-top-track-check" || kind === "followed-top-artist-check") {
    return;
  }
  try {
    await prisma.cachedSpotifyResponse.upsert({
      where: { userId_kind: { userId, kind } },
      create: {
        userId,
        kind,
        data: data as object,
        expiresAt: new Date(expiresAt),
      },
      update: {
        data: data as object,
        expiresAt: new Date(expiresAt),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist/i.test(message)) {
      // Already warned on read; skip DB write. In-memory cache still works.
      return;
    }
    console.error("[dashboard.kind.cache-write-failed]", {
      userId,
      kind,
      message,
    });
  }
}

async function fetchKind(
  userId: string,
  kind: string,
  request: NextRequest,
): Promise<unknown> {
  switch (kind) {
    case "me":
      return getSpotifyProfile(userId);
    case "playback":
      return getPlaybackState(userId);
    case "queue":
      return getQueue(userId);
    case "devices":
      return getDevices(userId);
    case "recently-played":
      return getRecentlyPlayed(userId);
    case "top-tracks-short":
      return getTopTracks(userId, "short_term");
    case "top-tracks-medium":
      return getTopTracks(userId, "medium_term");
    case "top-tracks-long":
      return getTopTracks(userId, "long_term");
    case "top-artists-short":
      return getTopArtists(userId, "short_term");
    case "top-artists-medium":
      return getTopArtists(userId, "medium_term");
    case "top-artists-long":
      return getTopArtists(userId, "long_term");
    case "saved-tracks":
      return getSavedTracks(userId);
    case "saved-albums":
      return getSavedAlbums(userId);
    case "saved-shows":
      return getSavedShows(userId);
    case "saved-episodes":
      return getSavedEpisodes(userId);
    case "saved-audiobooks":
      return getSavedAudiobooks(userId);
    case "followed-artists":
      return getFollowedArtists(userId);
    case "playlists":
      return getPlaylists(userId);
    case "saved-top-track-check": {
      const ids = request.nextUrl.searchParams.getAll("id").slice(0, 50);
      return checkSavedTracks(userId, ids);
    }
    case "followed-top-artist-check": {
      const ids = request.nextUrl.searchParams.getAll("id").slice(0, 50);
      return checkFollowedArtists(userId, ids);
    }
    default:
      throw new Error(`Unknown kind: ${kind}`);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Not signed in." },
      { status: 401 },
    );
  }
  const { kind } = await params;
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json(
      { error: "BadRequest", message: `Unknown dashboard kind: ${kind}.` },
      { status: 400 },
    );
  }

  const userId = session.user.id;
  const search = request.nextUrl.search;

  const cached = await readCache(userId, kind, search);
  if (cached !== null) {
    return NextResponse.json({ data: cached, cached: true });
  }

  try {
    const data = await fetchKind(userId, kind, request);
    await writeCache(userId, kind, search, data);
    return NextResponse.json({ data, cached: false });
  } catch (error) {
    if (error instanceof SpotifyError) {
      console.warn("[dashboard.kind]", {
        userId,
        kind,
        status: error.status,
        path: error.path,
        body: error.body.slice(0, 300),
      });
      return NextResponse.json(
        {
          error: error.name,
          message: `Spotify returned ${error.status} on ${error.path}: ${error.body.slice(0, 300)}`,
          status: error.status,
        },
        { status: error.status >= 500 ? 502 : error.status },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[dashboard.kind.failed]", { userId, kind, message });
    return NextResponse.json(
      { error: "InternalError", message: `Failed to load ${kind}: ${message}.` },
      { status: 500 },
    );
  }
}
