import { prisma } from "@/lib/prisma";
import { getArtistGenresForIds } from "@/lib/artist-genres";
import { umbrellaOf } from "@/lib/genre-taxonomy";
import { recordDailySnapshot } from "@/lib/listening-archive";
import {
  getTopArtists,
  getTopTracks,
  pickImage,
  SpotifyAccountMissingError,
  SpotifyReauthRequiredError,
  type SpotifyArtist,
  type SpotifyPaged,
  type SpotifyTrack,
} from "@/lib/spotify";

// "Guess Spotify Wrapped": a guess at a crew member's Wrapped for the
// current year, built from what the listening archive has collected since
// 1 January plus a fresh pull of their current top lists.
//
// Spotify ranks Wrapped by streams over the year. We can't see those, so
// each song or artist earns points from three sources:
//   - every daily snapshot of the top-50 lists this year, per range, with
//     the long range (about a year) counting most and the short range
//     (about four weeks) least, averaged over the days we have, so
//     something that topped the charts in the spring still counts;
//   - the plays we caught this year (ListeningPlay), relative to the most
//     played song or artist;
//   - the current top lists, which join the snapshots as today's entry.

const RANGES = ["short", "medium", "long"] as const;
type Range = (typeof RANGES)[number];

const RANGE_PARAM = {
  short: "short_term",
  medium: "medium_term",
  long: "long_term",
} as const;

// Weight of each source in a score. They add up to 1.
const RANGE_WEIGHT: Record<Range, number> = {
  short: 0.1,
  medium: 0.3,
  long: 0.4,
};
const PLAY_WEIGHT = 0.2;
const LIST_LENGTH = 50;

// Skip the live pull for a list snapshotted within this window, so
// reopening the page doesn't call Spotify six times each visit.
const FRESH_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const TOP_N = 5;

type ListKind = { kind: string; what: "tracks" | "artists"; range: Range };

const LIST_KINDS: ListKind[] = RANGES.flatMap((range) => [
  { kind: `top-tracks-${range}`, what: "tracks" as const, range },
  { kind: `top-artists-${range}`, what: "artists" as const, range },
]);

export type WrappedItem = {
  name: string;
  // The artists, for a song. Null for an artist.
  subtitle: string | null;
  imageUrl: string | null;
  spotifyUrl: string | null;
  // What we caught this year: a floor, since Spotify only shows us the
  // last 50 plays each time we look.
  plays: number;
  minutes: number;
};

export type WrappedGuess = {
  year: number;
  topTracks: WrappedItem[];
  topArtists: WrappedItem[];
  topGenres: string[];
  minutes: {
    caught: number;
    estimate: number;
    // "Oct 14": the day of the first play we caught this year.
    trackedSince: string;
    extrapolated: boolean;
  } | null;
  basis: {
    snapshotDays: number;
    firstSnapshotDay: string | null;
    playsCaught: number;
    // Lists pulled from Spotify for this page; the rest came from the
    // archive.
    livePulled: number;
    // Why the live pull failed, verbatim, when it did.
    liveError: string | null;
  };
};

// One ranked list: a day's snapshot of one top list, or the live pull.
export type RankedList = {
  range: Range;
  entries: { key: string; rank: number }[];
};

// The score behind the guess. Each range's points are averaged over that
// range's lists, so a range we have one day of counts as much as a range
// we have a hundred days of.
export function guessScores(
  lists: RankedList[],
  playCounts: Map<string, number>,
): Map<string, number> {
  const scores = new Map<string, number>();
  const add = (key: string, points: number) =>
    scores.set(key, (scores.get(key) ?? 0) + points);

  for (const range of RANGES) {
    const ofRange = lists.filter((list) => list.range === range);
    for (const list of ofRange) {
      for (const { key, rank } of list.entries) {
        const points = Math.max(0, (LIST_LENGTH + 1 - rank) / LIST_LENGTH);
        add(key, (RANGE_WEIGHT[range] * points) / ofRange.length);
      }
    }
  }

  let maxPlays = 0;
  for (const count of playCounts.values()) maxPlays = Math.max(maxPlays, count);
  if (maxPlays > 0) {
    for (const [key, count] of playCounts) {
      add(key, (PLAY_WEIGHT * count) / maxPlays);
    }
  }
  return scores;
}

function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist/i.test(message);
}

// A table that hasn't been created yet reads as empty; anything else
// is a real failure and propagates to the page's crash card.
function emptyIfMissingTable<T>(error: unknown): T[] {
  if (isMissingTableError(error)) return [];
  throw error;
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

type SnapshotEntry = {
  rank?: unknown;
  id?: unknown;
  name?: unknown;
  artists?: unknown;
};

function asEntries(data: unknown): SnapshotEntry[] {
  return Array.isArray(data) ? (data as SnapshotEntry[]) : [];
}

// The same projection the archive stores, so a live list and a stored
// snapshot read alike.
function entriesFromLive(
  what: ListKind["what"],
  raw: unknown,
): SnapshotEntry[] {
  const items =
    (raw as SpotifyPaged<SpotifyTrack | SpotifyArtist> | undefined)?.items ??
    [];
  return items.map((item, index) => ({
    rank: index + 1,
    id: item.id,
    name: item.name,
    artists:
      what === "tracks"
        ? ((item as SpotifyTrack).artists ?? []).map((a) => a.name).join(", ")
        : undefined,
  }));
}

type Candidate = {
  name: string;
  subtitle: string | null;
  spotifyId: string | null;
};

function artistKey(name: string): string {
  return name.trim().toLowerCase();
}

// Pull the current top lists that weren't snapshotted within FRESH_MS,
// banking each as today's snapshot like a dashboard visit does. A dead
// token stops the pull: every further call would fail the same way.
async function pullStaleLists(
  userId: string,
  lastCapturedAt: Map<string, number>,
): Promise<{ raw: Map<string, unknown>; error: string | null }> {
  const raw = new Map<string, unknown>();
  let error: string | null = null;
  for (const list of LIST_KINDS) {
    if (Date.now() - (lastCapturedAt.get(list.kind) ?? 0) < FRESH_MS) continue;
    try {
      const data =
        list.what === "tracks"
          ? await getTopTracks(userId, RANGE_PARAM[list.range])
          : await getTopArtists(userId, RANGE_PARAM[list.range]);
      raw.set(list.kind, data);
      await recordDailySnapshot(userId, list.kind, data);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      error ??= `${list.kind}: ${message}`;
      if (
        caught instanceof SpotifyReauthRequiredError ||
        caught instanceof SpotifyAccountMissingError
      ) {
        break;
      }
    }
  }
  return { raw, error };
}

export async function buildWrappedGuess(userId: string): Promise<WrappedGuess> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const kinds = LIST_KINDS.map((l) => l.kind);

  const [plays, snapshots, cachedResponses] = await Promise.all([
    prisma.listeningPlay
      .findMany({
        where: { userId, playedAt: { gte: yearStart } },
        select: {
          trackSpotifyId: true,
          trackName: true,
          trackArtist: true,
          trackDurationMs: true,
          playedAt: true,
        },
      })
      .catch(emptyIfMissingTable<never>),
    prisma.listeningSnapshot
      .findMany({
        where: { userId, kind: { in: kinds }, day: { gte: yearStart } },
        select: { kind: true, day: true, capturedAt: true, data: true },
      })
      .catch(emptyIfMissingTable<never>),
    // The dashboard's cache of raw Spotify responses: the only stored
    // copy with album art and artist photos, used when the live pull
    // fails.
    prisma.cachedSpotifyResponse
      .findMany({
        where: { userId, kind: { in: kinds } },
        select: { kind: true, data: true },
      })
      .catch(emptyIfMissingTable<never>),
  ]);

  const lastCapturedAt = new Map<string, number>();
  for (const snap of snapshots) {
    const at = snap.capturedAt.getTime();
    if (at > (lastCapturedAt.get(snap.kind) ?? 0))
      lastCapturedAt.set(snap.kind, at);
  }
  const live = await pullStaleLists(userId, lastCapturedAt);

  // One list per (kind, day). A live pull replaces today's snapshot, which
  // it has just overwritten in the database anyway.
  const todayKey = now.toISOString().slice(0, 10);
  const listsByKindDay = new Map<
    string,
    { list: ListKind; entries: SnapshotEntry[] }
  >();
  const snapshotDays = new Set<string>();
  for (const snap of snapshots) {
    const list = LIST_KINDS.find((l) => l.kind === snap.kind);
    if (!list) continue;
    const dayKey = snap.day.toISOString().slice(0, 10);
    snapshotDays.add(dayKey);
    listsByKindDay.set(`${snap.kind}|${dayKey}`, {
      list,
      entries: asEntries(snap.data),
    });
  }
  for (const list of LIST_KINDS) {
    const raw = live.raw.get(list.kind);
    if (raw === undefined) continue;
    snapshotDays.add(todayKey);
    listsByKindDay.set(`${list.kind}|${todayKey}`, {
      list,
      entries: entriesFromLive(list.what, raw),
    });
  }

  // Images and links: the live pull first, then the dashboard's cache.
  const trackArt = new Map<
    string,
    { image: string | null; url: string | null }
  >();
  const artistArt = new Map<
    string,
    { image: string | null; url: string | null }
  >();
  const rawSources: [string, unknown][] = [
    ...live.raw.entries(),
    ...cachedResponses.map((row): [string, unknown] => [row.kind, row.data]),
  ];
  for (const [kind, raw] of rawSources) {
    const items = (
      raw as SpotifyPaged<SpotifyTrack | SpotifyArtist> | undefined
    )?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item?.id) continue;
      if (kind.startsWith("top-tracks")) {
        const track = item as SpotifyTrack;
        if (!trackArt.has(track.id)) {
          trackArt.set(track.id, {
            image: pickImage(track.album?.images, 300),
            url: track.external_urls?.spotify ?? null,
          });
        }
      } else {
        const artist = item as SpotifyArtist;
        const key = artistKey(artist.name ?? "");
        if (key && !artistArt.has(key)) {
          artistArt.set(key, {
            image: pickImage(artist.images, 300),
            url: artist.external_urls?.spotify ?? null,
          });
        }
      }
    }
  }

  // Candidates and ranked lists, keyed by track id and by artist name
  // (plays only record the first artist's name, not its id).
  const tracks = new Map<string, Candidate>();
  const artists = new Map<string, Candidate>();
  const trackLists: RankedList[] = [];
  const artistLists: RankedList[] = [];
  for (const { list, entries } of listsByKindDay.values()) {
    const ranked: RankedList = { range: list.range, entries: [] };
    for (const entry of entries) {
      const id = typeof entry.id === "string" ? entry.id : null;
      const name = typeof entry.name === "string" ? entry.name : null;
      const rank = typeof entry.rank === "number" ? entry.rank : null;
      if (!name || rank === null) continue;
      if (list.what === "tracks") {
        if (!id) continue;
        if (!tracks.has(id)) {
          tracks.set(id, {
            name,
            subtitle: typeof entry.artists === "string" ? entry.artists : null,
            spotifyId: id,
          });
        }
        ranked.entries.push({ key: id, rank });
      } else {
        const key = artistKey(name);
        if (!artists.has(key))
          artists.set(key, { name, subtitle: null, spotifyId: id });
        ranked.entries.push({ key, rank });
      }
    }
    (list.what === "tracks" ? trackLists : artistLists).push(ranked);
  }

  const trackPlays = new Map<string, number>();
  const trackMs = new Map<string, number>();
  const artistPlays = new Map<string, number>();
  const artistMs = new Map<string, number>();
  let caughtMs = 0;
  let firstPlay: Date | null = null;
  for (const play of plays) {
    caughtMs += play.trackDurationMs;
    if (!firstPlay || play.playedAt < firstPlay) firstPlay = play.playedAt;
    trackPlays.set(
      play.trackSpotifyId,
      (trackPlays.get(play.trackSpotifyId) ?? 0) + 1,
    );
    trackMs.set(
      play.trackSpotifyId,
      (trackMs.get(play.trackSpotifyId) ?? 0) + play.trackDurationMs,
    );
    if (!tracks.has(play.trackSpotifyId)) {
      tracks.set(play.trackSpotifyId, {
        name: play.trackName,
        subtitle: play.trackArtist || null,
        spotifyId: play.trackSpotifyId,
      });
    }
    const key = artistKey(play.trackArtist);
    if (!key) continue;
    artistPlays.set(key, (artistPlays.get(key) ?? 0) + 1);
    artistMs.set(key, (artistMs.get(key) ?? 0) + play.trackDurationMs);
    if (!artists.has(key)) {
      artists.set(key, {
        name: play.trackArtist,
        subtitle: null,
        spotifyId: null,
      });
    }
  }

  const rankedKeys = (
    lists: RankedList[],
    counts: Map<string, number>,
    limit: number,
  ) =>
    [...guessScores(lists, counts).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, score]) => ({ key, score }));

  const topTrackKeys = rankedKeys(trackLists, trackPlays, TOP_N);
  // More artists than we show, so genres reflect more than the top five.
  const artistRanking = rankedKeys(artistLists, artistPlays, 15);

  // Songs that never showed up in a top list can still have art: the
  // Bompton playlists store it.
  const missingArt = topTrackKeys
    .map((t) => t.key)
    .filter((id) => !trackArt.get(id)?.image);
  if (missingArt.length > 0) {
    const rows = await prisma.playlistTrack
      .findMany({
        where: {
          trackSpotifyId: { in: missingArt },
          albumImageUrl: { not: null },
        },
        select: { trackSpotifyId: true, albumImageUrl: true },
      })
      .catch(emptyIfMissingTable<never>);
    for (const row of rows) {
      if (!row.trackSpotifyId || trackArt.get(row.trackSpotifyId)?.image)
        continue;
      trackArt.set(row.trackSpotifyId, {
        image: row.albumImageUrl,
        url: `https://open.spotify.com/track/${row.trackSpotifyId}`,
      });
    }
  }

  const minutesOf = (ms: number) => Math.round(ms / 60_000);
  const topTracks: WrappedItem[] = topTrackKeys.map(({ key }) => {
    const track = tracks.get(key)!;
    return {
      name: track.name,
      subtitle: track.subtitle,
      imageUrl: trackArt.get(key)?.image ?? null,
      spotifyUrl:
        trackArt.get(key)?.url ?? `https://open.spotify.com/track/${key}`,
      plays: trackPlays.get(key) ?? 0,
      minutes: minutesOf(trackMs.get(key) ?? 0),
    };
  });
  const topArtists: WrappedItem[] = artistRanking
    .slice(0, TOP_N)
    .map(({ key }) => {
      const artist = artists.get(key)!;
      return {
        name: artist.name,
        subtitle: null,
        imageUrl: artistArt.get(key)?.image ?? null,
        spotifyUrl:
          artistArt.get(key)?.url ??
          (artist.spotifyId
            ? `https://open.spotify.com/artist/${artist.spotifyId}`
            : null),
        plays: artistPlays.get(key) ?? 0,
        minutes: minutesOf(artistMs.get(key) ?? 0),
      };
    });

  // Genres: the Last.fm tags the genre tracker already caches per
  // artist, weighted by each artist's score. Only tags that map to a
  // genre family count, which drops tags like "british" or "seen live".
  const withIds = artistRanking.flatMap(({ key, score }) => {
    const artist = artists.get(key)!;
    return artist.spotifyId
      ? [{ id: artist.spotifyId, name: artist.name, score }]
      : [];
  });
  const genreWeights = new Map<string, number>();
  if (withIds.length > 0) {
    const lookup = await getArtistGenresForIds(userId, withIds, {
      fetchBudget: 5,
    });
    for (const artist of withIds) {
      for (const tag of lookup.artists.get(artist.id)?.genres ?? []) {
        if (!umbrellaOf(tag)) continue;
        genreWeights.set(tag, (genreWeights.get(tag) ?? 0) + artist.score);
      }
    }
  }
  const topGenres = [...genreWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([tag]) => titleCase(tag));

  // Minutes: what we caught, spread over the days since our first catch
  // and stretched to the whole year so far.
  let minutes: WrappedGuess["minutes"] = null;
  if (firstPlay && caughtMs > 0) {
    const firstDay = Date.UTC(
      firstPlay.getUTCFullYear(),
      firstPlay.getUTCMonth(),
      firstPlay.getUTCDate(),
    );
    const daysTracked = Math.max(
      1,
      Math.ceil((now.getTime() - firstDay) / DAY_MS),
    );
    const daysSoFar = Math.max(
      1,
      Math.ceil((now.getTime() - yearStart.getTime()) / DAY_MS),
    );
    const caught = minutesOf(caughtMs);
    minutes = {
      caught,
      estimate: Math.round((caught * daysSoFar) / daysTracked),
      trackedSince: dayLabel(firstPlay),
      extrapolated: daysTracked < daysSoFar,
    };
  }

  const sortedDays = [...snapshotDays].sort();
  return {
    year,
    topTracks,
    topArtists,
    topGenres,
    minutes,
    basis: {
      snapshotDays: snapshotDays.size,
      firstSnapshotDay: sortedDays[0]
        ? dayLabel(new Date(sortedDays[0]))
        : null,
      playsCaught: plays.length,
      livePulled: live.raw.size,
      liveError: live.error,
    },
  };
}

// "indie rock" -> "Indie Rock", "r&b" -> "R&B", "drum and bass" -> "Drum and Bass".
function titleCase(tag: string): string {
  if (tag === "r&b") return "R&B";
  return tag
    .split(" ")
    .map((word, i) =>
      i > 0 && word === "and"
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}
