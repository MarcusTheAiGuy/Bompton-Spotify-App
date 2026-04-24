import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
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
// We cache responses per (userId, kind) for 5 minutes so reloads within
// that window don't retouch Spotify at all — the big cost-reduction
// win for the 429 scenario.

type CacheEntry = { data: unknown; expiresAt: number };
const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60_000;

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

  // Parameter-carrying kinds (the top-item overlap checks) mix ids into
  // the cache key so different id sets don't clobber each other.
  const extraKey = request.nextUrl.search;
  const cacheKey = `${session.user.id}:${kind}:${extraKey}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ data: cached.data, cached: true });
  }

  try {
    const data = await fetchKind(session.user.id, kind, request);
    responseCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return NextResponse.json({ data, cached: false });
  } catch (error) {
    if (error instanceof SpotifyError) {
      console.warn("[dashboard.kind]", {
        userId: session.user.id,
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
    console.error("[dashboard.kind.failed]", {
      userId: session.user.id,
      kind,
      message,
    });
    return NextResponse.json(
      { error: "InternalError", message: `Failed to load ${kind}: ${message}.` },
      { status: 500 },
    );
  }
}
