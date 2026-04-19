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

// A Bompton season starts on the third Friday of March of its first year.
// E.g. 2026-2027 starts Mar 20 2026 (third Fri). The season runs until the
// Friday before the next season starts — so 2026-2027's last add day is
// Mar 12 2027, one week before 2027-2028 starts on Mar 19 2027.
export function parseBomptonYear(year: BomptonYear): { startYear: number; endYear: number } {
  const [start, end] = year.split("-").map((s) => parseInt(s, 10));
  return { startYear: start, endYear: end };
}

function thirdFridayOfMarch(year: number): Date {
  const march1 = new Date(Date.UTC(year, 2, 1));
  const firstFriday = nextOrSameFriday(march1);
  const third = new Date(firstFriday);
  third.setUTCDate(third.getUTCDate() + 14);
  return third;
}

export function seasonStart(year: BomptonYear): Date {
  const { startYear } = parseBomptonYear(year);
  return thirdFridayOfMarch(startYear);
}

export function seasonEnd(year: BomptonYear): Date {
  // Friday one week before the next season's start.
  const { endYear } = parseBomptonYear(year);
  const nextStart = thirdFridayOfMarch(endYear);
  const end = new Date(nextStart);
  end.setUTCDate(end.getUTCDate() - 7);
  return end;
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

function yearVariants(year: BomptonYear): string[] {
  const { startYear, endYear } = parseBomptonYear(year);
  const startShort = String(startYear).slice(-2);
  const endShort = String(endYear).slice(-2);
  // Accept any combination of full vs 2-digit years, with a hyphen,
  // en-dash, em-dash, or slash between them, and optional whitespace.
  return [
    `${startYear}-${endYear}`,
    `${startYear}-${endShort}`,
    `${startShort}-${endYear}`,
    `${startShort}-${endShort}`,
    `${startYear}/${endYear}`,
    `${startYear}/${endShort}`,
    `${startShort}/${endYear}`,
    `${startShort}/${endShort}`,
  ].map((v) => v.toLowerCase());
}

function normalizeYearSeparators(s: string): string {
  // Collapse en-dash, em-dash, and any surrounding whitespace into a
  // plain hyphen so "2023 – 24" and "2023—24" both match "2023-24".
  return s.replace(/\s*[\u2013\u2014]\s*/g, "-").replace(/\s+/g, " ");
}

export function findBomptonPlaylist(
  playlists: SpotifyPlaylist[],
  year: BomptonYear,
): SpotifyPlaylist | null {
  const variants = yearVariants(year);
  const match =
    playlists.find((p) => {
      const name = normalizeYearSeparators(p.name.toLowerCase());
      if (!name.includes("bompton")) return false;
      return variants.some((v) => name.includes(v));
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
  const seasonEndAt = seasonEnd(year);
  const rawLastFriday = mostRecentFriday(now);
  // Clamp: don't count Fridays past the season end, and if we're before
  // the season has started at all, show an empty week list.
  const clampedLastFriday =
    rawLastFriday.getTime() > seasonEndAt.getTime()
      ? seasonEndAt
      : rawLastFriday;
  const fridays =
    clampedLastFriday.getTime() < seasonStartAt.getTime()
      ? []
      : fridaysBetween(seasonStartAt, clampedLastFriday);
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
