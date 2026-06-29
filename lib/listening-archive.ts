import { prisma } from "@/lib/prisma";
import { appendRecentPlays } from "@/lib/listening-history";
import {
  getFollowedArtists,
  getPlaylists,
  getRecentlyPlayed,
  getSavedAlbums,
  getSavedAudiobooks,
  getSavedEpisodes,
  getSavedShows,
  getSavedTracks,
  getSpotifyProfile,
  getTopArtists,
  getTopTracks,
  SpotifyAccountMissingError,
  SpotifyReauthRequiredError,
  type SpotifyArtist,
  type SpotifyCursorPaged,
  type SpotifyPaged,
  type SpotifyPlaylist,
  type SpotifyProfile,
  type SpotifySavedAlbumItem,
  type SpotifySavedAudiobookItem,
  type SpotifySavedEpisodeItem,
  type SpotifySavedShowItem,
  type SpotifySavedTrackItem,
  type SpotifyTrack,
} from "@/lib/spotify";

// Durable archival of Spotify's window-limited endpoints so the crew
// builds a longitudinal picture Spotify itself doesn't offer.
//
// Two mechanisms live here:
//   1. Recently-played -> ListeningPlay (append-only; reuses
//      appendRecentPlays). Spotify only returns the last 50 plays, so
//      this fills as we capture over time.
//   2. Daily snapshots of every "current state" endpoint we can cheaply
//      pull -> ListeningSnapshot, one row per UTC day per (user, kind):
//      top tracks/artists (all three ranges), the full saved library
//      (tracks, albums, shows, episodes, audiobooks), followed artists,
//      playlists, and the profile (follower count / product tier). The
//      goal is to archive as much as possible each day so we accumulate a
//      rich database to work with over time.
//
// Both are driven by /api/archive-listening (the daily-sync cron) for
// every linked account, and snapshots are also taken opportunistically
// on dashboard visits via recordDailySnapshot().

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist/i.test(message);
}

function utcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

// A trimmed, queryable projection of one Spotify list response. We store
// these (not the raw blob) because snapshot rows accumulate forever.
type SnapshotItem = Record<string, unknown>;

type SnapshotSource = {
  kind: string;
  fetch: (userId: string) => Promise<unknown>;
  project: (raw: unknown) => SnapshotItem[];
};

function projectTopTracks(raw: unknown): SnapshotItem[] {
  const paged = raw as SpotifyPaged<SpotifyTrack> | undefined;
  return (paged?.items ?? []).map((track, index) => ({
    rank: index + 1,
    id: track.id,
    name: track.name,
    artists: (track.artists ?? []).map((a) => a.name).join(", "),
    popularity: track.popularity ?? null,
  }));
}

function projectTopArtists(raw: unknown): SnapshotItem[] {
  const paged = raw as SpotifyPaged<SpotifyArtist> | undefined;
  return (paged?.items ?? []).map((artist, index) => ({
    rank: index + 1,
    id: artist.id,
    name: artist.name,
    popularity: artist.popularity ?? null,
    genres: artist.genres ?? [],
  }));
}

function projectSavedTracks(raw: unknown): SnapshotItem[] {
  const paged = raw as SpotifyPaged<SpotifySavedTrackItem> | undefined;
  return (paged?.items ?? []).map((item) => ({
    id: item.track?.id ?? null,
    name: item.track?.name ?? null,
    artists: (item.track?.artists ?? []).map((a) => a.name).join(", "),
    addedAt: item.added_at,
  }));
}

function projectFollowedArtists(raw: unknown): SnapshotItem[] {
  const resp = raw as { artists?: SpotifyCursorPaged<SpotifyArtist> } | undefined;
  return (resp?.artists?.items ?? []).map((artist) => ({
    id: artist.id,
    name: artist.name,
    genres: artist.genres ?? [],
  }));
}

function projectSavedAlbums(raw: unknown): SnapshotItem[] {
  const paged = raw as SpotifyPaged<SpotifySavedAlbumItem> | undefined;
  return (paged?.items ?? []).map((item) => ({
    id: item.album?.id ?? null,
    name: item.album?.name ?? null,
    artists: (item.album?.artists ?? []).map((a) => a.name).join(", "),
    addedAt: item.added_at,
  }));
}

function projectSavedShows(raw: unknown): SnapshotItem[] {
  const paged = raw as SpotifyPaged<SpotifySavedShowItem> | undefined;
  return (paged?.items ?? []).map((item) => ({
    id: item.show?.id ?? null,
    name: item.show?.name ?? null,
    publisher: item.show?.publisher ?? null,
    addedAt: item.added_at,
  }));
}

function projectSavedEpisodes(raw: unknown): SnapshotItem[] {
  const paged = raw as SpotifyPaged<SpotifySavedEpisodeItem> | undefined;
  return (paged?.items ?? []).map((item) => ({
    id: item.episode?.id ?? null,
    name: item.episode?.name ?? null,
    show: item.episode?.show?.name ?? null,
    addedAt: item.added_at,
  }));
}

function projectSavedAudiobooks(raw: unknown): SnapshotItem[] {
  const paged = raw as SpotifyPaged<SpotifySavedAudiobookItem> | undefined;
  return (paged?.items ?? []).map((item) => ({
    id: item.audiobook?.id ?? null,
    name: item.audiobook?.name ?? null,
    authors: (item.audiobook?.authors ?? []).map((a) => a.name).join(", "),
    addedAt: item.added_at,
  }));
}

function projectPlaylists(raw: unknown): SnapshotItem[] {
  const paged = raw as SpotifyPaged<SpotifyPlaylist> | undefined;
  return (paged?.items ?? []).map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    owner: playlist.owner?.display_name ?? playlist.owner?.id ?? null,
    totalTracks: playlist.tracks?.total ?? null,
    public: playlist.public,
    collaborative: playlist.collaborative,
    snapshotId: playlist.snapshot_id ?? null,
  }));
}

// Profile is a single object, not a list — we store it as a one-row
// snapshot so follower count / product tier / country are tracked over
// time alongside everything else. itemCount is therefore always 1.
function projectProfile(raw: unknown): SnapshotItem[] {
  const profile = raw as SpotifyProfile | undefined;
  if (!profile) return [];
  return [
    {
      id: profile.id,
      displayName: profile.display_name,
      followers: profile.followers?.total ?? null,
      product: profile.product,
      country: profile.country,
    },
  ];
}

// The set of list endpoints we snapshot daily. The `kind` strings match
// the dashboard route's kinds so the dashboard can opportunistically
// record a snapshot from data it already fetched.
const SNAPSHOT_SOURCES: SnapshotSource[] = [
  {
    kind: "top-tracks-short",
    fetch: (userId) => getTopTracks(userId, "short_term"),
    project: projectTopTracks,
  },
  {
    kind: "top-tracks-medium",
    fetch: (userId) => getTopTracks(userId, "medium_term"),
    project: projectTopTracks,
  },
  {
    kind: "top-tracks-long",
    fetch: (userId) => getTopTracks(userId, "long_term"),
    project: projectTopTracks,
  },
  {
    kind: "top-artists-short",
    fetch: (userId) => getTopArtists(userId, "short_term"),
    project: projectTopArtists,
  },
  {
    kind: "top-artists-medium",
    fetch: (userId) => getTopArtists(userId, "medium_term"),
    project: projectTopArtists,
  },
  {
    kind: "top-artists-long",
    fetch: (userId) => getTopArtists(userId, "long_term"),
    project: projectTopArtists,
  },
  {
    kind: "saved-tracks",
    fetch: (userId) => getSavedTracks(userId),
    project: projectSavedTracks,
  },
  {
    kind: "saved-albums",
    fetch: (userId) => getSavedAlbums(userId),
    project: projectSavedAlbums,
  },
  {
    kind: "saved-shows",
    fetch: (userId) => getSavedShows(userId),
    project: projectSavedShows,
  },
  {
    kind: "saved-episodes",
    fetch: (userId) => getSavedEpisodes(userId),
    project: projectSavedEpisodes,
  },
  {
    kind: "saved-audiobooks",
    fetch: (userId) => getSavedAudiobooks(userId),
    project: projectSavedAudiobooks,
  },
  {
    kind: "followed-artists",
    fetch: (userId) => getFollowedArtists(userId),
    project: projectFollowedArtists,
  },
  {
    kind: "playlists",
    fetch: (userId) => getPlaylists(userId),
    project: projectPlaylists,
  },
  {
    kind: "me",
    fetch: (userId) => getSpotifyProfile(userId),
    project: projectProfile,
  },
];

const SOURCE_BY_KIND = new Map(SNAPSHOT_SOURCES.map((s) => [s.kind, s]));

// Dashboard kinds that have a daily-snapshot source. The dashboard route
// checks this before calling recordDailySnapshot with already-fetched data.
export const SNAPSHOT_KINDS: ReadonlySet<string> = new Set(
  SNAPSHOT_SOURCES.map((s) => s.kind),
);

export type SnapshotResult = {
  status: "saved" | "skipped";
  itemCount: number;
  reason?: string;
};

// Upsert one daily snapshot from an already-fetched Spotify list response.
// Idempotent within a UTC day via the (userId, kind, day) unique index, so
// a cron capture and a dashboard visit on the same day collapse to one row
// (last write wins). Never throws — a missing table or bad shape is logged
// and reported, so callers can fire-and-await without a try/catch.
export async function recordDailySnapshot(
  userId: string,
  kind: string,
  raw: unknown,
): Promise<SnapshotResult> {
  const source = SOURCE_BY_KIND.get(kind);
  if (!source) {
    return {
      status: "skipped",
      itemCount: 0,
      reason: `No snapshot source registered for kind "${kind}".`,
    };
  }

  let items: SnapshotItem[];
  try {
    items = source.project(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[listening-archive.project-failed]", { userId, kind, message });
    return {
      status: "skipped",
      itemCount: 0,
      reason: `Projecting ${kind} response failed: ${message}`,
    };
  }

  const day = utcMidnight(new Date());
  const capturedAt = new Date();
  try {
    await prisma.listeningSnapshot.upsert({
      where: { userId_kind_day: { userId, kind, day } },
      create: {
        userId,
        kind,
        day,
        capturedAt,
        itemCount: items.length,
        data: items as object,
      },
      update: {
        capturedAt,
        itemCount: items.length,
        data: items as object,
      },
    });
    return { status: "saved", itemCount: items.length };
  } catch (error) {
    if (isMissingTableError(error)) {
      console.warn(
        "[listening-archive] ListeningSnapshot table missing — click 'Initialize ListeningSnapshot table' on /troubleshooting (or run `npm run db:push`). Skipping snapshot.",
        { userId, kind },
      );
      return {
        status: "skipped",
        itemCount: items.length,
        reason: "ListeningSnapshot table missing",
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[listening-archive.snapshot-failed]", { userId, kind, message });
    return { status: "skipped", itemCount: items.length, reason: message };
  }
}

export type UserArchiveResult = {
  userId: string;
  recentPlays:
    | { inserted: number; skipped: number }
    | { error: string };
  snapshots: ({ kind: string } & (
    | SnapshotResult
    | { status: "error"; itemCount: 0; reason: string }
  ))[];
  needsReauth?: boolean;
};

// Capture everything for one user: recently-played plus every daily
// snapshot. Each source is isolated so one failure doesn't sink the rest.
// A dead refresh token (invalid_grant) is terminal for this user — every
// subsequent call would fail the same way — so we short-circuit and flag
// needsReauth rather than hammering Spotify eight more times.
export async function captureUserListeningArchive(
  userId: string,
): Promise<UserArchiveResult> {
  const result: UserArchiveResult = {
    userId,
    recentPlays: { inserted: 0, skipped: 0 },
    snapshots: [],
  };

  try {
    const recent = await getRecentlyPlayed(userId);
    result.recentPlays = await appendRecentPlays(userId, recent.items ?? []);
  } catch (error) {
    if (
      error instanceof SpotifyReauthRequiredError ||
      error instanceof SpotifyAccountMissingError
    ) {
      result.needsReauth = true;
      result.recentPlays = { error: error.message };
      return result;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[listening-archive.recent-failed]", { userId, message });
    result.recentPlays = { error: message };
  }

  for (const source of SNAPSHOT_SOURCES) {
    try {
      const raw = await source.fetch(userId);
      const snap = await recordDailySnapshot(userId, source.kind, raw);
      result.snapshots.push({ kind: source.kind, ...snap });
    } catch (error) {
      if (error instanceof SpotifyReauthRequiredError) {
        result.needsReauth = true;
        result.snapshots.push({
          kind: source.kind,
          status: "error",
          itemCount: 0,
          reason: error.message,
        });
        break;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error("[listening-archive.source-failed]", {
        userId,
        kind: source.kind,
        message,
      });
      result.snapshots.push({
        kind: source.kind,
        status: "error",
        itemCount: 0,
        reason: message,
      });
    }
  }

  return result;
}

// Walk every user with a linked Spotify account and capture their archive,
// each with that user's own stored token. Sequential on purpose: a burst of
// parallel users would multiply the per-user fan-out and trip Spotify 429s.
export async function captureAllListeningArchives(): Promise<{
  users: number;
  results: UserArchiveResult[];
}> {
  const accounts = await prisma.account.findMany({
    where: { provider: "spotify" },
    select: { userId: true },
    distinct: ["userId"],
  });

  const results: UserArchiveResult[] = [];
  for (const account of accounts) {
    results.push(await captureUserListeningArchive(account.userId));
  }
  return { users: accounts.length, results };
}
