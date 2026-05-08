import type { SpotifyPlaylistTrack } from "@/lib/spotify";
import type { BomptonPlaylistByYear } from "@/lib/bompton-playlist-db";
import type { BomptonYear, CrewMember } from "@/lib/bompton";
import {
  fridaysBetween,
  mostRecentFriday,
  seasonEnd,
  seasonStart,
} from "@/lib/bompton";

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

// ---------- Card 1: Playlist vitals ----------

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

// ---------- Card 2: All-time crew leaderboard ----------

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

// ---------- Card 5: Friday discipline across all seasons ----------

export type DisciplineEntry = {
  crewMember: CrewMember;
  onTime: number;
  late: number;
  missed: number;
  totalWeeks: number;
  onTimeRate: number;
};

export function getFridayDiscipline(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
  now: Date = new Date(),
): DisciplineEntry[] {
  const entries: DisciplineEntry[] = crew.map((c) => ({
    crewMember: c,
    onTime: 0,
    late: 0,
    missed: 0,
    totalWeeks: 0,
    onTimeRate: 0,
  }));
  const byId = new Map(entries.map((e) => [e.crewMember.id, e]));
  const dayMs = 1000 * 60 * 60 * 24;
  const weekMs = dayMs * 7;

  for (const season of data) {
    if (season.tracks.length === 0) continue;
    const start = seasonStart(season.year);
    const end = seasonEnd(season.year);
    const lastFriday = mostRecentFriday(now);
    const clamped = lastFriday.getTime() > end.getTime() ? end : lastFriday;
    const fridays =
      clamped.getTime() < start.getTime()
        ? []
        : fridaysBetween(start, clamped);

    const tsByMember = new Map<string, number[]>();
    for (const m of crew) tsByMember.set(m.id, []);
    for (const t of season.tracks) {
      if (!t.added_by?.id || !t.added_at) continue;
      const member = findCrewBySpotifyId(crew, t.added_by.id);
      if (!member) continue;
      tsByMember.get(member.id)?.push(new Date(t.added_at).getTime());
    }
    for (const [, arr] of tsByMember) arr.sort((a, b) => a - b);

    for (const member of crew) {
      const entry = byId.get(member.id);
      if (!entry) continue;
      const ts = tsByMember.get(member.id) ?? [];
      for (const friday of fridays) {
        entry.totalWeeks += 1;
        const fridayMs = friday.getTime();
        const inWeek = ts.filter(
          (t) => t >= fridayMs && t < fridayMs + weekMs,
        );
        if (inWeek.length === 0) {
          entry.missed += 1;
          continue;
        }
        const earliest = inWeek[0];
        if (earliest - fridayMs < dayMs) entry.onTime += 1;
        else entry.late += 1;
      }
    }
  }

  for (const e of entries) {
    e.onTimeRate = e.totalWeeks > 0 ? e.onTime / e.totalWeeks : 0;
  }
  return entries.sort((a, b) => b.onTimeRate - a.onTimeRate);
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
  vitals: PlaylistVitals;
  leaderboard: CrewLeaderboardEntry[];
  topArtists: ArtistCount[];
  topAlbums: AlbumCount[];
  discipline: DisciplineEntry[];
  timeOfDay: TimeOfDayEntry[];
  dayOfWeek: DayOfWeekDistribution;
  trackLength: TrackLengthStats;
  explicit: ExplicitEntry[];
  totalTracks: number;
};

export function buildBomptonStats(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
  now: Date = new Date(),
): BomptonStatsBundle {
  const flat = flattenAllSeasons(data);
  return {
    vitals: getPlaylistVitals(flat, data),
    leaderboard: getAllTimeLeaderboard(data, crew),
    topArtists: getTopArtists(flat),
    topAlbums: getTopAlbums(flat),
    discipline: getFridayDiscipline(data, crew, now),
    timeOfDay: getTimeOfDayDistribution(flat, crew),
    dayOfWeek: getDayOfWeekDistribution(flat),
    trackLength: getTrackLengthStats(flat),
    explicit: getExplicitContent(flat, crew),
    totalTracks: flat.length,
  };
}
