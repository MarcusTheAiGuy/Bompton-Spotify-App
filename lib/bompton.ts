import type { SpotifyPlaylist, SpotifyPlaylistTrack } from "@/lib/spotify";

// All Bompton seasons we render on the page, in chronological order.
// Each season name is the suffix matched against the Spotify playlist name.
export const BOMPTON_YEARS = [
  "2023-2024",
  "2024-2025",
  "2025-2026",
  "2026-2027",
] as const;

export type BomptonYear = (typeof BOMPTON_YEARS)[number];

// The current season. The rule ("one song every Friday") applies to this one;
// earlier seasons are just history.
export const CURRENT_BOMPTON_YEAR: BomptonYear = "2026-2027";

// A Bompton season starts on the first Friday of September of its first year.
// That's the convention this crew uses; change the month/day if they ever
// decide otherwise.
const SEASON_START_MONTH = 8; // September (JS months are 0-indexed)
const SEASON_START_DAY_OF_MONTH = 1; // Start from first Friday on or after this date

export function parseBomptonYear(year: BomptonYear): { startYear: number; endYear: number } {
  const [start, end] = year.split("-").map((s) => parseInt(s, 10));
  return { startYear: start, endYear: end };
}

export function seasonStart(year: BomptonYear): Date {
  const { startYear } = parseBomptonYear(year);
  const earliest = new Date(
    Date.UTC(startYear, SEASON_START_MONTH, SEASON_START_DAY_OF_MONTH),
  );
  return nextOrSameFriday(earliest);
}

export function seasonEnd(year: BomptonYear): Date {
  const { endYear } = parseBomptonYear(year);
  return new Date(Date.UTC(endYear, SEASON_START_MONTH, SEASON_START_DAY_OF_MONTH));
}

function nextOrSameFriday(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 = Sun, 5 = Fri
  const delta = (5 - day + 7) % 7;
  d.setUTCDate(d.getUTCDate() + delta);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function mostRecentFriday(now: Date = new Date()): Date {
  const d = new Date(now);
  const day = d.getUTCDay();
  const delta = (day - 5 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - delta);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function fridaysBetween(startFriday: Date, endInclusive: Date): Date[] {
  const out: Date[] = [];
  const cursor = new Date(startFriday);
  while (cursor.getTime() <= endInclusive.getTime()) {
    out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return out;
}

export function findBomptonPlaylist(
  playlists: SpotifyPlaylist[],
  year: BomptonYear,
): SpotifyPlaylist | null {
  const needle = year.toLowerCase();
  const match =
    playlists.find((p) => {
      const name = p.name.toLowerCase();
      return name.includes("bompton") && name.includes(needle);
    }) ?? null;
  return match;
}

// ---------- Analyses that require track-level data ----------
// These run only when Spotify returns tracks with their added_at / added_by
// metadata. With the current app quota the results are empty; once Extended
// Quota is granted, the same code paths populate automatically.

export type CrewMember = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  spotifyUserId: string | null;
};

export type ContributorCount = {
  crewMember: CrewMember;
  count: number;
  outsidersCount?: number;
};

export function tallyContributors(
  tracks: SpotifyPlaylistTrack[],
  crew: CrewMember[],
): { perCrew: ContributorCount[]; outsiders: number; unattributed: number } {
  const perCrew = new Map<string, ContributorCount>();
  for (const member of crew) {
    perCrew.set(member.id, { crewMember: member, count: 0 });
  }
  let outsiders = 0;
  let unattributed = 0;
  for (const item of tracks) {
    if (!item.track) continue;
    const spotifyUserId = item.added_by?.id ?? null;
    if (!spotifyUserId) {
      unattributed += 1;
      continue;
    }
    const match = crew.find((m) => m.spotifyUserId === spotifyUserId);
    if (match) {
      const existing = perCrew.get(match.id);
      if (existing) existing.count += 1;
    } else {
      outsiders += 1;
    }
  }
  return {
    perCrew: [...perCrew.values()].sort((a, b) => b.count - a.count),
    outsiders,
    unattributed,
  };
}

export type SeasonScore = {
  crewMember: CrewMember;
  addedCount: number;
  expectedCount: number;
  behind: number;
  weeksOnTime: number;
  weeksLate: number;
  weeksMissed: number;
  firstByCount: number;
};

export function scoreSeason(
  tracks: SpotifyPlaylistTrack[],
  crew: CrewMember[],
  year: BomptonYear,
  now: Date = new Date(),
): { scores: SeasonScore[]; fridays: Date[]; seasonStartAt: Date } {
  const seasonStartAt = seasonStart(year);
  const lastFriday = mostRecentFriday(now);
  const fridays = fridaysBetween(seasonStartAt, lastFriday);
  const expectedCount = fridays.length;

  const perMember = new Map<string, SeasonScore>();
  for (const member of crew) {
    perMember.set(member.id, {
      crewMember: member,
      addedCount: 0,
      expectedCount,
      behind: expectedCount,
      weeksOnTime: 0,
      weeksLate: 0,
      weeksMissed: expectedCount,
      firstByCount: 0,
    });
  }

  const addedTimestamps = new Map<string, Date[]>();
  for (const member of crew) addedTimestamps.set(member.id, []);
  for (const item of tracks) {
    if (!item.track || !item.added_by || !item.added_at) continue;
    const match = crew.find((m) => m.spotifyUserId === item.added_by?.id);
    if (!match) continue;
    const row = addedTimestamps.get(match.id);
    if (row) row.push(new Date(item.added_at));
  }

  for (const member of crew) {
    const score = perMember.get(member.id);
    if (!score) continue;
    const timestamps = (addedTimestamps.get(member.id) ?? []).sort(
      (a, b) => a.getTime() - b.getTime(),
    );
    score.addedCount = timestamps.length;
    score.behind = Math.max(0, expectedCount - score.addedCount);

    let missed = 0;
    let onTime = 0;
    let late = 0;
    for (const friday of fridays) {
      const deadline = new Date(friday);
      deadline.setUTCDate(deadline.getUTCDate() + 7);
      const inWeek = timestamps.filter((ts) => {
        return (
          ts.getTime() >= friday.getTime() && ts.getTime() < deadline.getTime()
        );
      });
      if (inWeek.length === 0) {
        missed += 1;
      } else {
        const earliest = inWeek[0];
        const diff = earliest.getTime() - friday.getTime();
        if (diff < 1000 * 60 * 60 * 24) {
          // Added on Friday itself
          onTime += 1;
        } else {
          late += 1;
        }
      }
    }
    score.weeksMissed = missed;
    score.weeksOnTime = onTime;
    score.weeksLate = late;
  }

  for (const friday of fridays) {
    const deadline = new Date(friday);
    deadline.setUTCDate(deadline.getUTCDate() + 7);
    let bestMemberId: string | null = null;
    let bestTs: number = Infinity;
    for (const member of crew) {
      const ts = (addedTimestamps.get(member.id) ?? []).find((t) => {
        return t.getTime() >= friday.getTime() && t.getTime() < deadline.getTime();
      });
      if (ts && ts.getTime() < bestTs) {
        bestTs = ts.getTime();
        bestMemberId = member.id;
      }
    }
    if (bestMemberId) {
      const score = perMember.get(bestMemberId);
      if (score) score.firstByCount += 1;
    }
  }

  return {
    scores: [...perMember.values()].sort((a, b) => a.behind - b.behind),
    fridays,
    seasonStartAt,
  };
}
