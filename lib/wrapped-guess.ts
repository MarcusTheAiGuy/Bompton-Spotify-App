import { prisma } from "@/lib/prisma";
import { getArtistGenresForIds } from "@/lib/artist-genres";
import {
  describeSpotifyError,
  type DescribedError,
} from "@/lib/describe-spotify-error";
import { umbrellaOf } from "@/lib/genre-taxonomy";
import {
  captureSnapshot,
  isMissingTableError,
  utcMidnight,
} from "@/lib/listening-archive";
import {
  pickImage,
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
//   - the snapshots of the top-50 lists this year (one a week), per range,
//     with the long range (about a year) counting most and the short range
//     (about four weeks) least, averaged over the weeks we have, so
//     something that topped the charts in the spring still counts;
//   - the plays we caught this year (ListeningPlay), relative to the most
//     played song or artist;
//   - the current top lists, which stand in for this week's snapshot.

const RANGES = ["short", "medium", "long"] as const;
type Range = (typeof RANGES)[number];

// Weight of each source in a score. They add up to 1.
const RANGE_WEIGHT: Record<Range, number> = {
  short: 0.1,
  medium: 0.3,
  long: 0.4,
};
const PLAY_WEIGHT = 0.2;
const LIST_LENGTH = 50;

// Skip the live pull for a list snapshotted within this window: a few
// hours make no difference to a year's guess, and the dashboard and the
// daily cron snapshot the lists anyway.
const FRESH_MS = 6 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;
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
  // What we caught this year: a floor, since Spotify only shows us the
  // last 50 plays each time we look. Minutes are counted for artists.
  plays: number;
  minutes?: number;
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
    // Why the live pull stopped, described the way the dashboard does.
    liveError: DescribedError | null;
  };
};

// One ranked list: a snapshot of one top list, or the live pull.
type RankedList = {
  range: Range;
  entries: { key: string; rank: number }[];
};

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

// The score behind the guess. Each range's points are averaged over that
// range's lists, so a range we have one week of counts as much as a range
// we have forty weeks of. An empty list (a failed or blank snapshot) is
// left out rather than averaged in as a zero.
function guessScores(
  lists: RankedList[],
  playCounts: Map<string, number>,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const range of RANGES) {
    const ofRange = lists.filter(
      (list) => list.range === range && list.entries.length > 0,
    );
    for (const list of ofRange) {
      for (const { key, rank } of list.entries) {
        const points = Math.max(0, (LIST_LENGTH + 1 - rank) / LIST_LENGTH);
        bump(scores, key, (RANGE_WEIGHT[range] * points) / ofRange.length);
      }
    }
  }
  // Every count is at least 1, so maxPlays is positive whenever the loop
  // below runs.
  let maxPlays = 0;
  for (const count of playCounts.values()) maxPlays = Math.max(maxPlays, count);
  for (const [key, count] of playCounts) {
    bump(scores, key, (PLAY_WEIGHT * count) / maxPlays);
  }
  return scores;
}

// A table that hasn't been created yet reads as empty; anything else
// is a real failure and propagates to the page's crash card.
function emptyIfMissingTable(error: unknown): never[] {
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

function artistKey(name: string): string {
  return name.trim().toLowerCase();
}

// Pull the current top lists that weren't snapshotted within FRESH_MS,
// banking each as today's snapshot like a dashboard visit does. The first
// failure stops the pull: a dead token or a rate limit (which spotifyFetch
// already waited out once) would hit every further call the same way, and
// the stored lists stand in.
async function pullStaleLists(
  userId: string,
  lastCapturedAt: Map<string, number>,
): Promise<{
  lists: Map<string, { raw: unknown; items: unknown[] }>;
  error: DescribedError | null;
}> {
  const lists = new Map<string, { raw: unknown; items: unknown[] }>();
  for (const { kind } of LIST_KINDS) {
    if (Date.now() - (lastCapturedAt.get(kind) ?? 0) < FRESH_MS) continue;
    try {
      const { raw, items } = await captureSnapshot(userId, kind);
      lists.set(kind, { raw, items });
    } catch (caught) {
      const described = describeSpotifyError(caught);
      return {
        lists,
        error: {
          ...described,
          detail: `While pulling ${kind}: ${described.detail}`,
        },
      };
    }
  }
  return { lists, error: null };
}

export async function buildWrappedGuess(userId: string): Promise<WrappedGuess> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const kinds = LIST_KINDS.map((l) => l.kind);
  const weekOf = (date: Date) =>
    Math.floor((date.getTime() - yearStart.getTime()) / WEEK_MS);
  const daysSince = (from: Date) =>
    Math.max(1, Math.ceil((now.getTime() - from.getTime()) / DAY_MS));

  // The snapshot reads and the live pull run alongside the plays read; the
  // pull only needs to know when each list was last captured. One
  // snapshot per list per week is plenty for a year-long average and
  // keeps each visit's read small as the archive grows: the latest of
  // each week, read in full only for those.
  const snapshotsAndPull = (async () => {
    const index = await prisma.listeningSnapshot
      .findMany({
        where: { userId, kind: { in: kinds }, day: { gte: yearStart } },
        select: { id: true, kind: true, day: true, capturedAt: true },
      })
      .catch(emptyIfMissingTable);
    const lastCapturedAt = new Map<string, number>();
    const weekly = new Map<string, { id: string; day: Date }>();
    for (const snap of index) {
      lastCapturedAt.set(
        snap.kind,
        Math.max(snap.capturedAt.getTime(), lastCapturedAt.get(snap.kind) ?? 0),
      );
      const key = `${snap.kind}|${weekOf(snap.day)}`;
      const kept = weekly.get(key);
      if (!kept || snap.day > kept.day) weekly.set(key, snap);
    }
    const [snapshots, live] = await Promise.all([
      weekly.size === 0
        ? []
        : prisma.listeningSnapshot.findMany({
            where: { id: { in: [...weekly.values()].map((s) => s.id) } },
            select: { kind: true, day: true, data: true },
          }),
      pullStaleLists(userId, lastCapturedAt),
    ]);
    return { index, snapshots, live };
  })();

  const [plays, { index: snapshotIndex, snapshots, live }] = await Promise.all([
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
      .catch(emptyIfMissingTable),
    snapshotsAndPull,
  ]);

  // One list per (kind, week). A live pull stands in for this week's
  // snapshot: it is the newest look at the same list.
  const listsByKindWeek = new Map<
    string,
    { list: ListKind; entries: SnapshotEntry[] }
  >();
  for (const snap of snapshots) {
    const list = LIST_KINDS.find((l) => l.kind === snap.kind);
    if (!list) continue;
    listsByKindWeek.set(`${snap.kind}|${weekOf(snap.day)}`, {
      list,
      entries: asEntries(snap.data),
    });
  }
  for (const list of LIST_KINDS) {
    const pulled = live.lists.get(list.kind);
    if (!pulled) continue;
    listsByKindWeek.set(`${list.kind}|${weekOf(now)}`, {
      list,
      entries: asEntries(pulled.items),
    });
  }
  // What the summary reports: every day the archive covers, sampled or not.
  const snapshotDays = new Set(
    snapshotIndex.map((snap) => snap.day.toISOString().slice(0, 10)),
  );
  if (live.lists.size > 0) snapshotDays.add(now.toISOString().slice(0, 10));

  // Candidates and ranked lists, keyed by track id and by artist name
  // (plays only record the first artist's name, not its id).
  const tracks = new Map<string, { name: string; subtitle: string | null }>();
  const artists = new Map<string, { name: string; spotifyId: string | null }>();
  const trackLists: RankedList[] = [];
  const artistLists: RankedList[] = [];
  for (const { list, entries } of listsByKindWeek.values()) {
    const ranked: RankedList = { range: list.range, entries: [] };
    for (const entry of entries) {
      const id = typeof entry.id === "string" ? entry.id : null;
      const name = typeof entry.name === "string" ? entry.name : null;
      const rank = typeof entry.rank === "number" ? entry.rank : null;
      if (!name || rank === null) continue;
      if (list.what === "tracks") {
        if (!id) continue;
        if (!tracks.has(id)) {
          const subtitle =
            typeof entry.artists === "string" ? entry.artists : null;
          tracks.set(id, { name, subtitle });
        }
        ranked.entries.push({ key: id, rank });
      } else {
        const key = artistKey(name);
        if (!artists.has(key)) artists.set(key, { name, spotifyId: id });
        ranked.entries.push({ key, rank });
      }
    }
    (list.what === "tracks" ? trackLists : artistLists).push(ranked);
  }

  const trackPlays = new Map<string, number>();
  const artistPlays = new Map<string, number>();
  const artistMs = new Map<string, number>();
  let caughtMs = 0;
  let firstPlay: Date | null = null;
  for (const play of plays) {
    caughtMs += play.trackDurationMs;
    if (!firstPlay || play.playedAt < firstPlay) firstPlay = play.playedAt;
    bump(trackPlays, play.trackSpotifyId);
    if (!tracks.has(play.trackSpotifyId)) {
      tracks.set(play.trackSpotifyId, {
        name: play.trackName,
        subtitle: play.trackArtist || null,
      });
    }
    const key = artistKey(play.trackArtist);
    if (!key) continue;
    bump(artistPlays, key);
    bump(artistMs, key, play.trackDurationMs);
    if (!artists.has(key)) {
      artists.set(key, { name: play.trackArtist, spotifyId: null });
    }
  }

  const ranking = (lists: RankedList[], counts: Map<string, number>) =>
    [...guessScores(lists, counts)].sort((a, b) => b[1] - a[1]);
  const topTrackKeys = ranking(trackLists, trackPlays)
    .slice(0, TOP_N)
    .map(([key]) => key);
  // More artists than we show, so genres reflect more than the top five.
  const artistRanking = ranking(artistLists, artistPlays).slice(0, 15);
  const topArtistKeys = artistRanking.slice(0, TOP_N).map(([key]) => key);

  // Art: the live pull first, then the dashboard's cache of raw Spotify
  // responses (snapshots store no images), then the Bompton playlists
  // for songs. The cache is read only when a top item still lacks art.
  const trackArt = new Map<string, string | null>();
  const artistArt = new Map<string, string | null>();
  const collectArt = (kind: string, raw: unknown) => {
    const items = (
      raw as SpotifyPaged<SpotifyTrack | SpotifyArtist> | undefined
    )?.items;
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item?.id) continue;
      if (kind.startsWith("top-tracks")) {
        if (!trackArt.get(item.id)) {
          trackArt.set(
            item.id,
            pickImage((item as SpotifyTrack).album?.images, 300),
          );
        }
      } else {
        const key = artistKey(item.name ?? "");
        if (key && !artistArt.get(key)) {
          artistArt.set(key, pickImage((item as SpotifyArtist).images, 300));
        }
      }
    }
  };
  for (const [kind, { raw }] of live.lists) collectArt(kind, raw);
  const tracksLackingArt = topTrackKeys.filter((key) => !trackArt.get(key));
  const lacksArt =
    tracksLackingArt.length > 0 ||
    topArtistKeys.some((key) => !artistArt.get(key));

  // Genres: the Last.fm tags the genre tracker already caches per
  // artist, weighted by each artist's score. Only tags that map to a
  // genre family count, which drops tags like "british" or "seen live".
  const withIds = artistRanking.flatMap(([key, score]) => {
    const { name, spotifyId } = artists.get(key)!;
    return spotifyId ? [{ id: spotifyId, name, score }] : [];
  });

  const [cachedResponses, playlistArt, genreLookup] = await Promise.all([
    lacksArt
      ? prisma.cachedSpotifyResponse
          .findMany({
            where: { userId, kind: { in: kinds } },
            select: { kind: true, data: true },
          })
          .catch(emptyIfMissingTable)
      : [],
    tracksLackingArt.length > 0
      ? prisma.playlistTrack
          .findMany({
            where: {
              trackSpotifyId: { in: tracksLackingArt },
              albumImageUrl: { not: null },
            },
            select: { trackSpotifyId: true, albumImageUrl: true },
          })
          .catch(emptyIfMissingTable)
      : [],
    withIds.length > 0
      ? getArtistGenresForIds(userId, withIds, { fetchBudget: 5 })
      : null,
  ]);
  for (const row of cachedResponses) collectArt(row.kind, row.data);
  for (const row of playlistArt) {
    if (row.trackSpotifyId && !trackArt.get(row.trackSpotifyId)) {
      trackArt.set(row.trackSpotifyId, row.albumImageUrl);
    }
  }

  const genreWeights = new Map<string, number>();
  for (const artist of withIds) {
    for (const tag of genreLookup?.artists.get(artist.id)?.genres ?? []) {
      if (umbrellaOf(tag)) bump(genreWeights, tag, artist.score);
    }
  }
  const topGenres = [...genreWeights]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([tag]) => titleCase(tag));

  const minutesOf = (ms: number) => Math.round(ms / 60_000);
  const topTracks: WrappedItem[] = topTrackKeys.map((key) => ({
    ...tracks.get(key)!,
    imageUrl: trackArt.get(key) ?? null,
    plays: trackPlays.get(key) ?? 0,
  }));
  const topArtists: WrappedItem[] = topArtistKeys.map((key) => ({
    name: artists.get(key)!.name,
    subtitle: null,
    imageUrl: artistArt.get(key) ?? null,
    plays: artistPlays.get(key) ?? 0,
    minutes: minutesOf(artistMs.get(key) ?? 0),
  }));

  // Minutes: what we caught, spread over the days since our first catch
  // and stretched to the whole year so far.
  let minutes: WrappedGuess["minutes"] = null;
  if (firstPlay && caughtMs > 0) {
    const daysTracked = daysSince(utcMidnight(firstPlay));
    const daysSoFar = daysSince(yearStart);
    const caught = minutesOf(caughtMs);
    minutes = {
      caught,
      estimate: Math.round((caught * daysSoFar) / daysTracked),
      trackedSince: dayLabel(firstPlay),
      extrapolated: daysTracked < daysSoFar,
    };
  }

  const firstDay = [...snapshotDays].sort()[0];
  return {
    year,
    topTracks,
    topArtists,
    topGenres,
    minutes,
    basis: {
      snapshotDays: snapshotDays.size,
      firstSnapshotDay: firstDay ? dayLabel(new Date(firstDay)) : null,
      playsCaught: plays.length,
      livePulled: live.lists.size,
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
