import { prisma } from "@/lib/prisma";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

export class SpotifyError extends Error {
  constructor(
    message: string,
    public status: number,
    public path: string,
    public body: string,
  ) {
    super(message);
    this.name = "SpotifyError";
  }
}

export class SpotifyAccountMissingError extends Error {
  constructor(public userId: string) {
    super(
      `No Spotify account linked for user ${userId}. They need to sign in at least once.`,
    );
    this.name = "SpotifyAccountMissingError";
  }
}

export class SpotifyRefreshFailedError extends Error {
  constructor(
    public userId: string,
    public status: number,
    public body: string,
  ) {
    super(
      `Spotify token refresh failed for user ${userId} (HTTP ${status}): ${body}. They likely need to sign out and sign in again.`,
    );
    this.name = "SpotifyRefreshFailedError";
  }
}

async function getFreshAccessToken(userId: string): Promise<string> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "spotify" },
  });
  if (!account) throw new SpotifyAccountMissingError(userId);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = account.expires_at ?? 0;

  if (account.access_token && expiresAt > nowSeconds + 60) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    throw new SpotifyRefreshFailedError(
      userId,
      0,
      "No refresh_token stored on the Account row.",
    );
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new SpotifyRefreshFailedError(
      userId,
      0,
      "SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is not set on the server.",
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refresh_token,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: params,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new SpotifyRefreshFailedError(userId, response.status, text);
  }

  const data = JSON.parse(text) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
    token_type?: string;
  };

  await prisma.account.update({
    where: { id: account.id },
    data: {
      access_token: data.access_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      refresh_token: data.refresh_token ?? account.refresh_token,
      scope: data.scope ?? account.scope,
      token_type: data.token_type ?? account.token_type,
    },
  });

  return data.access_token;
}

export async function spotifyFetch<T>(
  userId: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getFreshAccessToken(userId);
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!response.ok) {
    throw new SpotifyError(
      `Spotify API ${response.status} ${response.statusText} on ${path}`,
      response.status,
      path,
      text,
    );
  }

  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export type SpotifyImage = {
  url: string;
  height: number | null;
  width: number | null;
};

export type SpotifyProfile = {
  id: string;
  display_name: string | null;
  email: string;
  country: string;
  product: "premium" | "free" | "open";
  followers: { total: number; href: string | null };
  images: SpotifyImage[];
  external_urls: { spotify: string };
  uri: string;
  href: string;
  type: "user";
  explicit_content: { filter_enabled: boolean; filter_locked: boolean };
};

export async function getSpotifyProfile(userId: string): Promise<SpotifyProfile> {
  return spotifyFetch<SpotifyProfile>(userId, "/me");
}

export type SpotifyExternalUrls = { spotify: string };

export type SpotifyArtistRef = {
  id: string;
  name: string;
  uri: string;
  href: string;
  external_urls: SpotifyExternalUrls;
  type: "artist";
};

export type SpotifyArtist = SpotifyArtistRef & {
  images: SpotifyImage[];
  genres: string[];
  popularity: number;
  followers: { total: number; href: string | null };
};

export type SpotifyAlbum = {
  id: string;
  name: string;
  uri: string;
  href: string;
  external_urls: SpotifyExternalUrls;
  album_type: "album" | "single" | "compilation";
  release_date: string;
  release_date_precision: "year" | "month" | "day";
  total_tracks: number;
  images: SpotifyImage[];
  artists: SpotifyArtistRef[];
  type: "album";
};

export type SpotifyTrack = {
  id: string;
  name: string;
  uri: string;
  href: string;
  external_urls: SpotifyExternalUrls;
  duration_ms: number;
  popularity: number;
  explicit: boolean;
  preview_url: string | null;
  track_number: number;
  disc_number: number;
  is_local: boolean;
  album: SpotifyAlbum;
  artists: SpotifyArtistRef[];
  type: "track";
};

export type SpotifyPaged<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  href: string;
  next: string | null;
  previous: string | null;
};

export type SpotifyTimeRange = "short_term" | "medium_term" | "long_term";

export const TIME_RANGES: {
  key: SpotifyTimeRange;
  label: string;
  sublabel: string;
}[] = [
  { key: "short_term", label: "Last 4 weeks", sublabel: "short_term" },
  { key: "medium_term", label: "Last 6 months", sublabel: "medium_term" },
  { key: "long_term", label: "All time", sublabel: "long_term" },
];

export async function getTopTracks(
  userId: string,
  timeRange: SpotifyTimeRange,
  limit = 50,
): Promise<SpotifyPaged<SpotifyTrack>> {
  return spotifyFetch<SpotifyPaged<SpotifyTrack>>(
    userId,
    `/me/top/tracks?time_range=${timeRange}&limit=${limit}`,
  );
}

export async function getTopArtists(
  userId: string,
  timeRange: SpotifyTimeRange,
  limit = 50,
): Promise<SpotifyPaged<SpotifyArtist>> {
  return spotifyFetch<SpotifyPaged<SpotifyArtist>>(
    userId,
    `/me/top/artists?time_range=${timeRange}&limit=${limit}`,
  );
}

export function pickImage(
  images: SpotifyImage[] | undefined,
  minSize = 64,
): string | null {
  if (!images || images.length === 0) return null;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  for (const img of sorted) {
    if ((img.width ?? 0) >= minSize) return img.url;
  }
  return sorted[sorted.length - 1].url;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatLongDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export type SpotifyDevice = {
  id: string | null;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number | null;
  supports_volume: boolean;
};

export type SpotifyContext = {
  type: "album" | "artist" | "playlist" | "show" | "collection";
  href: string;
  external_urls: SpotifyExternalUrls;
  uri: string;
} | null;

export type SpotifyEpisode = {
  id: string;
  name: string;
  description: string;
  duration_ms: number;
  explicit: boolean;
  release_date: string;
  release_date_precision: "year" | "month" | "day";
  images: SpotifyImage[];
  external_urls: SpotifyExternalUrls;
  uri: string;
  href: string;
  type: "episode";
  show?: SpotifyShow;
};

export type SpotifyShow = {
  id: string;
  name: string;
  publisher: string;
  description: string;
  media_type: "audio" | "mixed";
  total_episodes: number;
  images: SpotifyImage[];
  external_urls: SpotifyExternalUrls;
  uri: string;
  href: string;
  type: "show";
  explicit: boolean;
};

export type SpotifyAudiobook = {
  id: string;
  name: string;
  authors: { name: string }[];
  narrators: { name: string }[];
  publisher: string;
  description: string;
  total_chapters: number;
  images: SpotifyImage[];
  external_urls: SpotifyExternalUrls;
  uri: string;
  href: string;
  type: "audiobook";
  explicit: boolean;
};

export type SpotifyPlaybackState = {
  device: SpotifyDevice;
  repeat_state: "off" | "track" | "context";
  shuffle_state: boolean;
  context: SpotifyContext;
  timestamp: number;
  progress_ms: number;
  is_playing: boolean;
  item: SpotifyTrack | SpotifyEpisode | null;
  currently_playing_type: "track" | "episode" | "ad" | "unknown";
};

export type SpotifyRecentlyPlayedItem = {
  track: SpotifyTrack;
  played_at: string;
  context: SpotifyContext;
};

export type SpotifyCursorPaged<T> = {
  items: T[];
  total?: number;
  limit: number;
  href: string;
  next: string | null;
  previous: string | null;
  cursors?: { after: string | null; before: string | null };
};

export type SpotifySavedTrackItem = { added_at: string; track: SpotifyTrack };
export type SpotifySavedAlbumItem = { added_at: string; album: SpotifyAlbum };
export type SpotifySavedShowItem = { added_at: string; show: SpotifyShow };
export type SpotifySavedEpisodeItem = {
  added_at: string;
  episode: SpotifyEpisode;
};
export type SpotifySavedAudiobookItem = {
  added_at: string;
  audiobook: SpotifyAudiobook;
};

export type SpotifyPlaylist = {
  id: string;
  name: string;
  description: string | null;
  public: boolean | null;
  collaborative: boolean;
  owner: { id: string; display_name: string | null; uri: string };
  tracks: { total: number; href: string };
  images: SpotifyImage[];
  external_urls: SpotifyExternalUrls;
  uri: string;
  href: string;
  snapshot_id: string;
  type: "playlist";
};

export type SpotifyAudioFeatures = {
  id: string;
  uri: string;
  track_href: string;
  analysis_url: string;
  type: "audio_features";
  duration_ms: number;
  key: number;
  mode: 0 | 1;
  time_signature: number;
  tempo: number;
  acousticness: number;
  danceability: number;
  energy: number;
  instrumentalness: number;
  liveness: number;
  loudness: number;
  speechiness: number;
  valence: number;
};

export async function getPlaybackState(
  userId: string,
): Promise<SpotifyPlaybackState | null> {
  const result = await spotifyFetch<SpotifyPlaybackState | undefined>(
    userId,
    "/me/player",
  );
  return result ?? null;
}

export async function getDevices(
  userId: string,
): Promise<{ devices: SpotifyDevice[] }> {
  return spotifyFetch<{ devices: SpotifyDevice[] }>(userId, "/me/player/devices");
}

export type SpotifyQueueItem = SpotifyTrack | SpotifyEpisode;

export type SpotifyQueue = {
  currently_playing: SpotifyQueueItem | null;
  queue: SpotifyQueueItem[];
};

export async function getQueue(userId: string): Promise<SpotifyQueue> {
  const result = await spotifyFetch<SpotifyQueue | undefined>(
    userId,
    "/me/player/queue",
  );
  return result ?? { currently_playing: null, queue: [] };
}

export async function getRecentlyPlayed(
  userId: string,
  limit = 50,
): Promise<SpotifyCursorPaged<SpotifyRecentlyPlayedItem>> {
  return spotifyFetch<SpotifyCursorPaged<SpotifyRecentlyPlayedItem>>(
    userId,
    `/me/player/recently-played?limit=${limit}`,
  );
}

export async function getSavedTracks(
  userId: string,
  limit = 50,
): Promise<SpotifyPaged<SpotifySavedTrackItem>> {
  return spotifyFetch<SpotifyPaged<SpotifySavedTrackItem>>(
    userId,
    `/me/tracks?limit=${limit}`,
  );
}

export async function getSavedAlbums(
  userId: string,
  limit = 50,
): Promise<SpotifyPaged<SpotifySavedAlbumItem>> {
  return spotifyFetch<SpotifyPaged<SpotifySavedAlbumItem>>(
    userId,
    `/me/albums?limit=${limit}`,
  );
}

export async function getSavedShows(
  userId: string,
  limit = 50,
): Promise<SpotifyPaged<SpotifySavedShowItem>> {
  return spotifyFetch<SpotifyPaged<SpotifySavedShowItem>>(
    userId,
    `/me/shows?limit=${limit}`,
  );
}

export async function getSavedEpisodes(
  userId: string,
  limit = 50,
): Promise<SpotifyPaged<SpotifySavedEpisodeItem>> {
  return spotifyFetch<SpotifyPaged<SpotifySavedEpisodeItem>>(
    userId,
    `/me/episodes?limit=${limit}`,
  );
}

export async function getSavedAudiobooks(
  userId: string,
  limit = 50,
): Promise<SpotifyPaged<SpotifySavedAudiobookItem>> {
  return spotifyFetch<SpotifyPaged<SpotifySavedAudiobookItem>>(
    userId,
    `/me/audiobooks?limit=${limit}`,
  );
}

export async function getFollowedArtists(
  userId: string,
  limit = 50,
): Promise<{ artists: SpotifyCursorPaged<SpotifyArtist> }> {
  return spotifyFetch<{ artists: SpotifyCursorPaged<SpotifyArtist> }>(
    userId,
    `/me/following?type=artist&limit=${limit}`,
  );
}

export async function getPlaylists(
  userId: string,
  limit = 50,
): Promise<SpotifyPaged<SpotifyPlaylist>> {
  return spotifyFetch<SpotifyPaged<SpotifyPlaylist>>(
    userId,
    `/me/playlists?limit=${limit}`,
  );
}

async function containsBatch(
  userId: string,
  path: string,
  ids: string[],
  batchSize = 50,
): Promise<boolean[]> {
  if (ids.length === 0) return [];
  const out: boolean[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    const separator = path.includes("?") ? "&" : "?";
    const response = await spotifyFetch<boolean[]>(
      userId,
      `${path}${separator}ids=${chunk.join(",")}`,
    );
    out.push(...response);
  }
  return out;
}

export function checkSavedTracks(userId: string, ids: string[]) {
  return containsBatch(userId, "/me/tracks/contains", ids);
}

export function checkSavedAlbums(userId: string, ids: string[]) {
  return containsBatch(userId, "/me/albums/contains", ids, 20);
}

export function checkSavedShows(userId: string, ids: string[]) {
  return containsBatch(userId, "/me/shows/contains", ids);
}

export function checkSavedEpisodes(userId: string, ids: string[]) {
  return containsBatch(userId, "/me/episodes/contains", ids);
}

export function checkSavedAudiobooks(userId: string, ids: string[]) {
  return containsBatch(userId, "/me/audiobooks/contains", ids);
}

export function checkFollowedArtists(userId: string, ids: string[]) {
  return containsBatch(userId, "/me/following/contains?type=artist", ids);
}

export async function getAudioFeaturesBatch(
  userId: string,
  trackIds: string[],
): Promise<SpotifyAudioFeatures[]> {
  if (trackIds.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < trackIds.length; i += 100) {
    chunks.push(trackIds.slice(i, i + 100));
  }
  const results: SpotifyAudioFeatures[] = [];
  for (const chunk of chunks) {
    const response = await spotifyFetch<{
      audio_features: (SpotifyAudioFeatures | null)[];
    }>(userId, `/audio-features?ids=${chunk.join(",")}`);
    for (const item of response.audio_features) {
      if (item) results.push(item);
    }
  }
  return results;
}
