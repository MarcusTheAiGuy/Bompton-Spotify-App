import type { SpotifyPlaylistTrack } from "@/lib/spotify";
import type { BomptonPlaylistByYear } from "@/lib/bompton-playlist-db";
import type { BomptonYear, CrewMember } from "@/lib/bompton";
import {
  CURRENT_BOMPTON_YEAR,
  fridaysBetween,
  mostRecentFriday,
  seasonEnd,
  seasonStart,
} from "@/lib/bompton";
import {
  getArtistGenresForIds,
  type ArtistGenres,
} from "@/lib/artist-genres";
import { prisma } from "@/lib/prisma";

// Aggregations over the four-season Bompton dataset for the deep-stats
// page. Every function is a pure transform of what loadBomptonDataFromDb
// returns + the crew list, so the same data shape that drives the main
// page also feeds these analyses without an extra DB round-trip.

export type FlattenedTrack = {
  track: SpotifyPlaylistTrack;
  year: BomptonYear;
};

export function flattenAllSeasons(
  data: BomptonPlaylistByYear[],
): FlattenedTrack[] {
  const out: FlattenedTrack[] = [];
  for (const season of data) {
    for (const t of season.tracks) {
      out.push({ track: t, year: season.year });
    }
  }
  return out;
}

function findCrewBySpotifyId(
  crew: CrewMember[],
  spotifyId: string | null | undefined,
): CrewMember | null {
  if (!spotifyId) return null;
  return crew.find((m) => m.spotifyUserId === spotifyId) ?? null;
}

// ---------- Repeated tracks across all four seasons ----------

export type RepeatedTrackOccurrence = {
  year: BomptonYear;
  playlistName: string;
  position: number;
  addedAt: string;
  addedBySpotifyId: string | null;
  addedByCrew: CrewMember | null;
  addedByLabel: string;
  addedByImage: string | null;
};

export type RepeatedTrack = {
  key: string;
  trackName: string;
  artist: string;
  albumImageUrl: string | null;
  occurrences: RepeatedTrackOccurrence[];
};

function trackDedupeKey(
  trackId: string | null | undefined,
  trackName: string,
  artistName: string,
): string {
  if (trackId) return `id:${trackId}`;
  const n = (trackName ?? "").trim().toLowerCase();
  const a = (artistName ?? "").trim().toLowerCase();
  if (!n) return "";
  return `na:${n}|||${a}`;
}

export function findRepeatedTracks(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
): RepeatedTrack[] {
  const map = new Map<string, RepeatedTrack>();
  for (const season of data) {
    const playlistName = season.playlist?.name ?? `Bompton ${season.year}`;
    season.tracks.forEach((t, position) => {
      if (!t.track) return;
      const trackName = t.track.name;
      const artist = t.track.artists?.[0]?.name ?? "";
      const key = trackDedupeKey(t.track.id, trackName, artist);
      if (!key) return;
      const member = findCrewBySpotifyId(crew, t.added_by?.id);
      const occ: RepeatedTrackOccurrence = {
        year: season.year,
        playlistName,
        position: position + 1,
        addedAt: t.added_at,
        addedBySpotifyId: t.added_by?.id ?? null,
        addedByCrew: member,
        addedByLabel:
          member?.name ?? member?.email ?? t.added_by?.id ?? "Unknown",
        addedByImage: member?.image ?? null,
      };
      const existing = map.get(key);
      if (existing) {
        existing.occurrences.push(occ);
        return;
      }
      map.set(key, {
        key,
        trackName,
        artist,
        albumImageUrl: t.track.album?.images?.[0]?.url ?? null,
        occurrences: [occ],
      });
    });
  }
  return [...map.values()]
    .filter((r) => r.occurrences.length > 1)
    .sort((a, b) => b.occurrences.length - a.occurrences.length);
}

// ---------- Stat helpers shared across cards ----------

// Lightweight summary used by the main page's PlaylistStatsSummary block.
// Computed alongside the full bundle but not surfaced as a card on the
// stats page itself.
export type PlaylistVitals = {
  totalTracks: number;
  totalDurationMs: number;
  uniqueArtists: number;
  uniqueAlbums: number;
  uniqueTracks: number;
  seasonsWithData: number;
  totalSeasons: number;
  perSeasonCounts: { year: BomptonYear; count: number }[];
};

export function getPlaylistVitals(
  flat: FlattenedTrack[],
  data: BomptonPlaylistByYear[],
): PlaylistVitals {
  let totalDurationMs = 0;
  const artists = new Set<string>();
  const albums = new Set<string>();
  const trackKeys = new Set<string>();
  for (const { track } of flat) {
    if (!track.track) continue;
    totalDurationMs += track.track.duration_ms;
    for (const a of track.track.artists ?? []) {
      const name = a.name?.trim();
      if (name) artists.add(name.toLowerCase());
    }
    const albumName = track.track.album?.name?.trim();
    if (albumName) albums.add(albumName.toLowerCase());
    const key = track.track.id || track.track.uri || track.track.name;
    if (key) trackKeys.add(key);
  }
  return {
    totalTracks: flat.length,
    totalDurationMs,
    uniqueArtists: artists.size,
    uniqueAlbums: albums.size,
    uniqueTracks: trackKeys.size,
    seasonsWithData: data.filter((d) => d.tracks.length > 0).length,
    totalSeasons: data.length,
    perSeasonCounts: data.map((d) => ({ year: d.year, count: d.tracks.length })),
  };
}

// All-time crew leaderboard (used by the main page summary block; the
// stats page replaces this slot with the listening dedication card).
export type CrewLeaderboardEntry = {
  crewMember: CrewMember;
  totalAdds: number;
  bySeasonCount: { year: BomptonYear; count: number }[];
};

export function getAllTimeLeaderboard(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
): CrewLeaderboardEntry[] {
  const entries: CrewLeaderboardEntry[] = crew.map((c) => ({
    crewMember: c,
    totalAdds: 0,
    bySeasonCount: data.map((d) => ({ year: d.year, count: 0 })),
  }));
  const byId = new Map(entries.map((e) => [e.crewMember.id, e]));
  for (const season of data) {
    for (const t of season.tracks) {
      const member = findCrewBySpotifyId(crew, t.added_by?.id);
      if (!member) continue;
      const entry = byId.get(member.id);
      if (!entry) continue;
      entry.totalAdds += 1;
      const yr = entry.bySeasonCount.find((s) => s.year === season.year);
      if (yr) yr.count += 1;
    }
  }
  return entries.sort((a, b) => b.totalAdds - a.totalAdds);
}

// ---------- Card 1: Genre tracker ----------

export type GenreCount = { genre: string; count: number };

export type GenreBreakdownPerCrew = {
  crewMember: CrewMember;
  topGenres: GenreCount[];
  totalGenreHits: number;
};

export type GenreBreakdown = {
  perCrew: GenreBreakdownPerCrew[];
  overall: GenreCount[];
  totalArtistsLookedUp: number;
  totalArtistsWithGenres: number;
  // Bubbled up from getArtistGenresForIds so the genre card can show
  // "click Initialize Artist table on /troubleshooting" when the
  // backing table simply doesn't exist yet.
  artistTableMissing: boolean;
};

export function getGenreBreakdown(
  flat: FlattenedTrack[],
  crew: CrewMember[],
  artistGenres: Map<string, ArtistGenres>,
  artistTableMissing: boolean,
): GenreBreakdown {
  const perCrewCounts = new Map<string, Map<string, number>>();
  const perCrewTotals = new Map<string, number>();
  for (const c of crew) {
    perCrewCounts.set(c.id, new Map());
    perCrewTotals.set(c.id, 0);
  }
  const overallCounts = new Map<string, number>();

  for (const { track } of flat) {
    if (!track.track) continue;
    // Union of every genre across every artist on this track. A genre
    // shared by multiple credited artists still only contributes +1
    // for the track — e.g. a feature where artist A is tagged
    // {rock, alt rock} and artist B is tagged {rock, rap} adds +1 to
    // rock, +1 to alt rock, +1 to rap.
    const trackGenres = new Set<string>();
    for (const artistRef of track.track.artists ?? []) {
      const id = artistRef?.id;
      if (!id) continue;
      const data = artistGenres.get(id);
      if (!data) continue;
      for (const g of data.genres) trackGenres.add(g);
    }
    if (trackGenres.size === 0) continue;
    const member = findCrewBySpotifyId(crew, track.added_by?.id);
    const memberCounts = member ? perCrewCounts.get(member.id) : null;
    for (const g of trackGenres) {
      overallCounts.set(g, (overallCounts.get(g) ?? 0) + 1);
      if (memberCounts && member) {
        memberCounts.set(g, (memberCounts.get(g) ?? 0) + 1);
        perCrewTotals.set(
          member.id,
          (perCrewTotals.get(member.id) ?? 0) + 1,
        );
      }
    }
  }

  const perCrew: GenreBreakdownPerCrew[] = crew.map((c) => {
    const counts = perCrewCounts.get(c.id) ?? new Map<string, number>();
    return {
      crewMember: c,
      topGenres: [...counts.entries()]
        .map(([genre, count]) => ({ genre, count }))
        .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
        .slice(0, 3),
      totalGenreHits: perCrewTotals.get(c.id) ?? 0,
    };
  });

  const overall: GenreCount[] = [...overallCounts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
    .slice(0, 3);

  let totalWithGenres = 0;
  for (const a of artistGenres.values()) {
    if (a.genres.length > 0) totalWithGenres += 1;
  }

  return {
    perCrew,
    overall,
    totalArtistsLookedUp: artistGenres.size,
    totalArtistsWithGenres: totalWithGenres,
    artistTableMissing,
  };
}

// ---------- Card 2: Listening dedication ----------

export type DedicationEntry = {
  crewMember: CrewMember;
  listenCount: number;
  listenedMs: number;
  uniqueTracks: number;
  isCrown: boolean;
};

// `tableMissing` flags the case where the ListeningPlay table doesn't
// exist in the DB yet (a fresh deploy that hasn't clicked "Initialize
// ListeningPlay table" on /troubleshooting). The dedication card uses
// it to show an actionable empty state instead of telling users to
// "visit the dashboard" when no amount of dashboard-visiting will help.
export type DedicationResult = {
  entries: DedicationEntry[];
  tableMissing: boolean;
  // How many ListeningPlay rows exist for crew members on tracks that
  // are in *some* Bompton playlist (regardless of who added them or
  // when). Used by the empty-state copy to disambiguate "no plays
  // captured yet" from "plays captured but none qualify (own-adds
  // only / pre-add plays)".
  totalCandidatePlays: number;
};

// "How many times has user U played a track that someone else added to a
// Bompton playlist after that track was added?" Reads from the
// ListeningPlay table populated by the dashboard's recently-played
// fetch path. Returns one entry per crew member with the crown flag set
// on the leader.
export async function getListeningDedication(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
): Promise<DedicationResult> {
  // Map track id → list of (added_by spotify id, addedAt) entries
  // across every season so a play counts as soon as ANY non-self crew
  // member had added it before the play.
  const trackAdds = new Map<
    string,
    { addedBySpotifyId: string; addedAtMs: number }[]
  >();
  for (const season of data) {
    for (const t of season.tracks) {
      const tid = t.track?.id;
      const addedBy = t.added_by?.id;
      if (!tid || !addedBy || !t.added_at) continue;
      const addedAtMs = new Date(t.added_at).getTime();
      if (Number.isNaN(addedAtMs)) continue;
      let arr = trackAdds.get(tid);
      if (!arr) {
        arr = [];
        trackAdds.set(tid, arr);
      }
      arr.push({ addedBySpotifyId: addedBy, addedAtMs });
    }
  }

  const entries: DedicationEntry[] = crew.map((c) => ({
    crewMember: c,
    listenCount: 0,
    listenedMs: 0,
    uniqueTracks: 0,
    isCrown: false,
  }));
  if (trackAdds.size === 0 || crew.length === 0) {
    return { entries, tableMissing: false, totalCandidatePlays: 0 };
  }

  let plays: {
    userId: string;
    trackSpotifyId: string;
    trackDurationMs: number;
    playedAt: Date;
  }[] = [];
  try {
    plays = await prisma.listeningPlay.findMany({
      where: {
        userId: { in: crew.map((c) => c.id) },
        trackSpotifyId: { in: [...trackAdds.keys()] },
      },
      select: {
        userId: true,
        trackSpotifyId: true,
        trackDurationMs: true,
        playedAt: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist/i.test(message)) {
      console.warn(
        "[bompton-stats] ListeningPlay table missing — click 'Initialize ListeningPlay table' on /troubleshooting (or run `npm run db:push`). Dedication card will stay empty until a dashboard recently-played fetch runs against an existing table.",
      );
      return { entries, tableMissing: true, totalCandidatePlays: 0 };
    }
    throw error;
  }

  const byUser = new Map(entries.map((e) => [e.crewMember.id, e]));
  const uniqueTracksByUser = new Map<string, Set<string>>();
  for (const c of crew) uniqueTracksByUser.set(c.id, new Set());

  for (const play of plays) {
    const adds = trackAdds.get(play.trackSpotifyId);
    if (!adds || adds.length === 0) continue;
    const member = crew.find((c) => c.id === play.userId);
    if (!member) continue;
    const playMs = play.playedAt.getTime();
    const validAdd = adds.find(
      (a) =>
        a.addedBySpotifyId !== member.spotifyUserId && a.addedAtMs <= playMs,
    );
    if (!validAdd) continue;
    const entry = byUser.get(member.id);
    if (!entry) continue;
    entry.listenCount += 1;
    entry.listenedMs += play.trackDurationMs ?? 0;
    uniqueTracksByUser.get(member.id)?.add(play.trackSpotifyId);
  }
  for (const e of entries) {
    e.uniqueTracks = uniqueTracksByUser.get(e.crewMember.id)?.size ?? 0;
  }

  entries.sort((a, b) => b.listenCount - a.listenCount);
  if (entries[0] && entries[0].listenCount > 0) entries[0].isCrown = true;
  return { entries, tableMissing: false, totalCandidatePlays: plays.length };
}

// ---------- Card 3: Top artists ----------

export type ArtistCount = { name: string; count: number };

export function getTopArtists(
  flat: FlattenedTrack[],
  limit = 6,
): ArtistCount[] {
  const counts = new Map<string, number>();
  for (const { track } of flat) {
    if (!track.track) continue;
    for (const a of track.track.artists ?? []) {
      const name = a.name?.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ---------- Card 4: Top albums ----------

export type AlbumCount = {
  name: string;
  artist: string;
  imageUrl: string | null;
  count: number;
};

export function getTopAlbums(
  flat: FlattenedTrack[],
  limit = 5,
): AlbumCount[] {
  const counts = new Map<string, AlbumCount>();
  for (const { track } of flat) {
    if (!track.track) continue;
    const name = track.track.album?.name?.trim();
    if (!name) continue;
    const artist =
      track.track.album?.artists?.[0]?.name?.trim() ||
      track.track.artists?.[0]?.name?.trim() ||
      "";
    const key = `${name.toLowerCase()}|||${artist.toLowerCase()}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, {
        name,
        artist,
        imageUrl: track.track.album?.images?.[0]?.url ?? null,
        count: 1,
      });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ---------- Card 5: On-time stats (cumulative late days over time) ----------

// One late day = one calendar day that has elapsed past a Friday for
// which the crew member has not yet added a song. If a member is X
// weeks behind, each new day adds X to their total. The card renders
// this as a line graph (X = date, Y = cumulative late days), with the
// crown going to the member with the fewest late days at the latest
// point. The series covers a single season (current by default).

export type OnTimeSeriesPoint = {
  // ISO date string (UTC date midnight) for the X axis tick.
  date: string;
  // crewMember.id → cumulative late days at this date.
  perCrew: Record<string, number>;
};

export type OnTimeMemberTotal = {
  crewMember: CrewMember;
  lateDays: number;
  weeksBehind: number;
  color: string;
  isCrown: boolean;
};

export type OnTimeStats = {
  year: BomptonYear;
  series: OnTimeSeriesPoint[];
  totals: OnTimeMemberTotal[];
  hasData: boolean;
};

// Distinct, color-blind friendly palette for line + ring colors.
// Indexed by crew sort order so the colors are stable across renders.
export const ON_TIME_COLORS = [
  "#1DB954", // Spotify green
  "#3B82F6", // blue
  "#F59E0B", // amber
  "#EC4899", // pink
  "#A855F7", // purple
  "#14B8A6", // teal
];

export function getOnTimeStats(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
  year: BomptonYear = CURRENT_BOMPTON_YEAR,
  now: Date = new Date(),
): OnTimeStats {
  const totals: OnTimeMemberTotal[] = crew.map((c, idx) => ({
    crewMember: c,
    lateDays: 0,
    weeksBehind: 0,
    color: ON_TIME_COLORS[idx % ON_TIME_COLORS.length] ?? "#ffffff",
    isCrown: false,
  }));
  if (crew.length === 0) {
    return { year, series: [], totals, hasData: false };
  }

  const seasonStartAt = seasonStart(year);
  const seasonEndAt = seasonEnd(year);
  const todayMs = Math.min(now.getTime(), seasonEndAt.getTime());
  const today = new Date(todayMs);
  today.setUTCHours(0, 0, 0, 0);
  if (today.getTime() < seasonStartAt.getTime()) {
    return { year, series: [], totals, hasData: false };
  }

  const season = data.find((d) => d.year === year);
  const tracks = season?.tracks ?? [];

  // member id → sorted list of add timestamps for the chosen season
  const addsByMember = new Map<string, number[]>();
  for (const c of crew) addsByMember.set(c.id, []);
  for (const t of tracks) {
    const addedBy = t.added_by?.id;
    if (!addedBy || !t.added_at) continue;
    const member = findCrewBySpotifyId(crew, addedBy);
    if (!member) continue;
    const ts = new Date(t.added_at).getTime();
    if (!Number.isNaN(ts)) addsByMember.get(member.id)?.push(ts);
  }
  for (const [, arr] of addsByMember) arr.sort((a, b) => a - b);

  // Pre-compute, for each Friday in the season so far, when each
  // member satisfied that Friday (the first add inside [F, F+7d)).
  // null = never satisfied.
  const fridays = fridaysBetween(
    seasonStartAt,
    mostRecentFriday(today).getTime() < seasonStartAt.getTime()
      ? seasonStartAt
      : mostRecentFriday(today),
  );
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const fridaySatisfaction = fridays.map((friday) => {
    const fMs = friday.getTime();
    const sat = new Map<string, number | null>();
    for (const c of crew) {
      const adds = addsByMember.get(c.id) ?? [];
      const found = adds.find((a) => a >= fMs && a < fMs + weekMs);
      sat.set(c.id, found ?? null);
    }
    return { fridayMs: fMs, satisfied: sat };
  });

  const cumulative = new Map<string, number>();
  for (const c of crew) cumulative.set(c.id, 0);
  const series: OnTimeSeriesPoint[] = [];

  for (
    let dt = seasonStartAt.getTime();
    dt <= today.getTime();
    dt += dayMs
  ) {
    for (const fd of fridaySatisfaction) {
      const deadline = fd.fridayMs + dayMs; // first late day = day after Friday (UTC)
      if (dt < deadline) continue;
      for (const c of crew) {
        const sat = fd.satisfied.get(c.id);
        const stillUnsatisfiedAtDayStart =
          sat === null || sat === undefined || sat > dt;
        if (stillUnsatisfiedAtDayStart) {
          cumulative.set(c.id, (cumulative.get(c.id) ?? 0) + 1);
        }
      }
    }
    series.push({
      date: new Date(dt).toISOString(),
      perCrew: Object.fromEntries(cumulative),
    });
  }

  // Compute weeks-behind right now (count of un-satisfied past Fridays).
  const todayDt = today.getTime();
  for (const fd of fridaySatisfaction) {
    if (todayDt < fd.fridayMs + dayMs) continue;
    for (const total of totals) {
      const sat = fd.satisfied.get(total.crewMember.id);
      const open = sat === null || sat === undefined || sat > todayDt;
      if (open) total.weeksBehind += 1;
    }
  }

  const last = series[series.length - 1]?.perCrew ?? {};
  for (const total of totals) {
    total.lateDays = last[total.crewMember.id] ?? 0;
  }
  const sorted = [...totals].sort((a, b) => a.lateDays - b.lateDays);
  if (sorted[0]) {
    const winner = totals.find(
      (t) => t.crewMember.id === sorted[0].crewMember.id,
    );
    if (winner) winner.isCrown = true;
  }

  return {
    year,
    series,
    totals,
    hasData: tracks.length > 0,
  };
}

// ---------- Card 6: Time-of-day distribution per crew (UTC) ----------

export type TimeOfDayEntry = {
  crewMember: CrewMember;
  morning: number;
  afternoon: number;
  evening: number;
  night: number;
  total: number;
};

export function getTimeOfDayDistribution(
  flat: FlattenedTrack[],
  crew: CrewMember[],
): TimeOfDayEntry[] {
  const entries: TimeOfDayEntry[] = crew.map((c) => ({
    crewMember: c,
    morning: 0,
    afternoon: 0,
    evening: 0,
    night: 0,
    total: 0,
  }));
  const byId = new Map(entries.map((e) => [e.crewMember.id, e]));
  for (const { track } of flat) {
    if (!track.added_at || !track.added_by?.id) continue;
    const member = findCrewBySpotifyId(crew, track.added_by.id);
    if (!member) continue;
    const entry = byId.get(member.id);
    if (!entry) continue;
    const hr = new Date(track.added_at).getUTCHours();
    entry.total += 1;
    if (hr >= 5 && hr < 12) entry.morning += 1;
    else if (hr >= 12 && hr < 17) entry.afternoon += 1;
    else if (hr >= 17 && hr < 22) entry.evening += 1;
    else entry.night += 1;
  }
  return entries;
}

// ---------- Card 7: Day-of-week distribution ----------

export type DayOfWeekDistribution = {
  // Index 0 = Sunday, 6 = Saturday (UTC).
  counts: number[];
  total: number;
  fridayCount: number;
  fridayRate: number;
  topDayIndex: number;
};

export function getDayOfWeekDistribution(
  flat: FlattenedTrack[],
): DayOfWeekDistribution {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const { track } of flat) {
    if (!track.added_at) continue;
    const day = new Date(track.added_at).getUTCDay();
    counts[day] = (counts[day] ?? 0) + 1;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  let topDayIndex = 0;
  for (let i = 1; i < counts.length; i += 1) {
    if (counts[i] > counts[topDayIndex]) topDayIndex = i;
  }
  return {
    counts,
    total,
    fridayCount: counts[5] ?? 0,
    fridayRate: total > 0 ? (counts[5] ?? 0) / total : 0,
    topDayIndex,
  };
}

// ---------- Card 8: Track length stats ----------

export type TrackDescriptor = {
  name: string;
  artist: string;
  durationMs: number;
};

export type TrackLengthStats = {
  shortest: TrackDescriptor | null;
  longest: TrackDescriptor | null;
  averageMs: number;
  medianMs: number;
  totalMs: number;
  totalCount: number;
};

export function getTrackLengthStats(
  flat: FlattenedTrack[],
): TrackLengthStats {
  let shortest: TrackDescriptor | null = null;
  let longest: TrackDescriptor | null = null;
  const durations: number[] = [];
  for (const { track } of flat) {
    if (!track.track) continue;
    const dur = track.track.duration_ms;
    if (!dur || dur <= 0) continue;
    durations.push(dur);
    const desc: TrackDescriptor = {
      name: track.track.name,
      artist: track.track.artists?.[0]?.name ?? "",
      durationMs: dur,
    };
    if (!shortest || dur < shortest.durationMs) shortest = desc;
    if (!longest || dur > longest.durationMs) longest = desc;
  }
  const totalMs = durations.reduce((a, b) => a + b, 0);
  const sorted = [...durations].sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : Math.round(
          (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
        );
  return {
    shortest,
    longest,
    averageMs: durations.length > 0 ? Math.round(totalMs / durations.length) : 0,
    medianMs: median,
    totalMs,
    totalCount: durations.length,
  };
}

// ---------- Card 9: Explicit vs clean per crew ----------

export type ExplicitEntry = {
  crewMember: CrewMember;
  explicit: number;
  clean: number;
  total: number;
  explicitRate: number;
};

export function getExplicitContent(
  flat: FlattenedTrack[],
  crew: CrewMember[],
): ExplicitEntry[] {
  const entries: ExplicitEntry[] = crew.map((c) => ({
    crewMember: c,
    explicit: 0,
    clean: 0,
    total: 0,
    explicitRate: 0,
  }));
  const byId = new Map(entries.map((e) => [e.crewMember.id, e]));
  for (const { track } of flat) {
    if (!track.track || !track.added_by?.id) continue;
    const member = findCrewBySpotifyId(crew, track.added_by.id);
    if (!member) continue;
    const entry = byId.get(member.id);
    if (!entry) continue;
    entry.total += 1;
    if (track.track.explicit) entry.explicit += 1;
    else entry.clean += 1;
  }
  for (const e of entries) {
    e.explicitRate = e.total > 0 ? e.explicit / e.total : 0;
  }
  return entries.sort((a, b) => b.explicitRate - a.explicitRate);
}

// ---------- Bundle for the page ----------

export type BomptonStatsBundle = {
  // Used by the main-page summary block
  vitals: PlaylistVitals;
  leaderboard: CrewLeaderboardEntry[];
  // Used by the deep-stats grid
  genres: GenreBreakdown;
  dedication: DedicationEntry[];
  // Diagnostic flag for the dedication card's empty state. Mirrors the
  // genre card's `genres.artistTableMissing` so callers can render a
  // "click Initialize on /troubleshooting" hint when the backing table
  // doesn't exist yet.
  dedicationTableMissing: boolean;
  // Total ListeningPlay rows the dedication query saw (before the
  // own-add / pre-add filter). Lets the empty state distinguish "no
  // plays captured" from "plays captured but none qualify".
  dedicationCandidatePlays: number;
  topArtists: ArtistCount[];
  topAlbums: AlbumCount[];
  onTime: OnTimeStats;
  timeOfDay: TimeOfDayEntry[];
  dayOfWeek: DayOfWeekDistribution;
  trackLength: TrackLengthStats;
  explicit: ExplicitEntry[];
  totalTracks: number;
};

// Builds every bundle field. Genres require a Spotify lookup against
// /v1/artists for any artist id we haven't cached yet, so this is async
// and must be passed the caller's Spotify-linked user id. If we can't
// reach Spotify (token expired, etc.) the genre card just degrades to
// whatever we have cached — the rest of the bundle is unaffected.
export async function buildBomptonStats(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
  callerUserId: string,
  now: Date = new Date(),
): Promise<BomptonStatsBundle> {
  const flat = flattenAllSeasons(data);

  const artistIds = new Set<string>();
  for (const { track } of flat) {
    for (const a of track.track?.artists ?? []) {
      if (a?.id) artistIds.add(a.id);
    }
  }
  let artistGenres = new Map<string, ArtistGenres>();
  let artistTableMissing = false;
  try {
    const lookup = await getArtistGenresForIds(callerUserId, [...artistIds]);
    artistGenres = lookup.artists;
    artistTableMissing = lookup.tableMissing;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bompton-stats.genres-failed]", {
      callerUserId,
      message,
    });
  }

  const dedicationResult = await getListeningDedication(data, crew);

  return {
    vitals: getPlaylistVitals(flat, data),
    leaderboard: getAllTimeLeaderboard(data, crew),
    genres: getGenreBreakdown(flat, crew, artistGenres, artistTableMissing),
    dedication: dedicationResult.entries,
    dedicationTableMissing: dedicationResult.tableMissing,
    dedicationCandidatePlays: dedicationResult.totalCandidatePlays,
    topArtists: getTopArtists(flat),
    topAlbums: getTopAlbums(flat),
    onTime: getOnTimeStats(data, crew, CURRENT_BOMPTON_YEAR, now),
    timeOfDay: getTimeOfDayDistribution(flat, crew),
    dayOfWeek: getDayOfWeekDistribution(flat),
    trackLength: getTrackLengthStats(flat),
    explicit: getExplicitContent(flat, crew),
    totalTracks: flat.length,
  };
}
