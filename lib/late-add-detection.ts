import type { BomptonPlaylistByYear } from "@/lib/bompton-playlist-db";
import {
  CURRENT_BOMPTON_YEAR,
  fridaysBetween,
  mostRecentFriday,
  seasonStart,
  seasonEnd,
  type BomptonYear,
  type CrewMember,
} from "@/lib/bompton";

const DAY_MS = 24 * 60 * 60 * 1000;

export type LateAdder = {
  member: CrewMember;
  // Trailing Fridays under greedy chronological pairing that the
  // member's adds didn't reach. Sorted oldest-first. Length always
  // equals weeksBehind.
  missedFridays: Date[];
  // weeksBehind = max(0, elapsedFridays - addCount). A late add still
  // catches the member up, so weeksBehind never exceeds (expected
  // adds for the season so far) - (actual adds for the season).
  weeksBehind: number;
  // Days since the OLDEST missed Friday's Saturday deadline. Greedy
  // pairing puts adds against earliest Fridays first, so the trailing
  // unpaired Fridays are the most recent; the oldest of those is what
  // crossed the threshold. Always >= thresholdDays since we filter
  // there.
  maxDaysLate: number;
};

export type LateAddDetection = {
  year: BomptonYear;
  thresholdDays: number;
  // Members past the threshold. Sorted by weeksBehind desc.
  offenders: LateAdder[];
  // Diagnostic: every member's weeksBehind (clamped at 0), including 0.
  // Surfaced in the dashboard banner so we can see "no one's late" with
  // full context.
  perMemberSummary: {
    member: CrewMember;
    missedFridayCount: number;
  }[];
};

// "weeksBehind" follows the same math as scoreSeason() in lib/bompton.ts
// and getOnTimeStats() in lib/bompton-stats.ts:
//
//   weeksBehind = max(0, elapsedFridays - addCount)
//
// i.e. a late add COUNTS toward catching the member up. If they have
// N adds and N elapsed Fridays they're caught up, regardless of which
// specific weeks the adds were timestamped for. This matches user
// intuition ("I added that song two weeks late, so I'm only 1 behind
// now, not 2") and the existing standings card behavior.
//
// Missed Fridays under greedy chronological pairing: sort adds asc,
// pair the i-th add with the i-th Friday. The trailing Fridays with
// no pair are the "missed" set (always the most-recent Fridays under
// chronological pairing).
//
// We DON'T penalize a member for the most-recent missed Friday alone
// being inside the grace window — if they're behind by 2 and the
// older missed Friday is 8 days late, we still want to email even
// if the more recent one is only 1 day late. So the threshold check
// uses the OLDEST missed Friday, not the most recent.
//
// Lateness time *after* an eventual add still flows through the
// on-time stats card via getOnTimeStats(), which uses the same
// greedy pairing but contributes (addTs - fridayTs) days per paired
// Friday. That card is unaffected by this change.
export function findLateAdders(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
  now: Date = new Date(),
  thresholdDays = 3,
  year: BomptonYear = CURRENT_BOMPTON_YEAR,
): LateAddDetection {
  const seasonStartAt = seasonStart(year);
  const seasonEndAt = seasonEnd(year);
  const todayMs = Math.min(now.getTime(), seasonEndAt.getTime());
  const empty: LateAddDetection = {
    year,
    thresholdDays,
    offenders: [],
    perMemberSummary: crew.map((m) => ({ member: m, missedFridayCount: 0 })),
  };

  if (todayMs < seasonStartAt.getTime()) return empty;

  const recentFriday = mostRecentFriday(new Date(todayMs));
  if (recentFriday.getTime() < seasonStartAt.getTime()) return empty;

  const fridays = fridaysBetween(seasonStartAt, recentFriday);

  // elapsedFridays = every Friday in the season up to and including
  // today's Friday. Matches scoreSeason()'s expectedCount semantics:
  // today's Friday counts toward "expected" even before its Saturday
  // deadline. The threshold check below on the oldest missed Friday's
  // days-since-Saturday is what gates emailing — a Friday whose Saturday
  // hasn't even passed yet has negative daysLate and is correctly
  // skipped from the email trigger, but still contributes to the
  // weeksBehind count so the dashboard banner and the leaderboard
  // agree on "you're 1 behind".
  const elapsedFridays = fridays;
  if (elapsedFridays.length === 0) return empty;

  const lateThresholdMs = thresholdDays * DAY_MS;

  const season = data.find((d) => d.year === year);
  const tracks = season?.tracks ?? [];

  // member id → ascending add timestamps in this season.
  const addsByMember = new Map<string, number[]>();
  for (const c of crew) addsByMember.set(c.id, []);
  for (const t of tracks) {
    const addedBySpotifyId = t.added_by?.id;
    const addedAt = t.added_at;
    if (!addedBySpotifyId || !addedAt) continue;
    const member = crew.find((c) => c.spotifyUserId === addedBySpotifyId);
    if (!member) continue;
    const tsMs = new Date(addedAt).getTime();
    if (Number.isNaN(tsMs)) continue;
    addsByMember.get(member.id)?.push(tsMs);
  }
  for (const arr of addsByMember.values()) arr.sort((a, b) => a - b);

  const offenders: LateAdder[] = [];
  const perMemberSummary: LateAddDetection["perMemberSummary"] = [];
  for (const member of crew) {
    const adds = addsByMember.get(member.id) ?? [];
    const behindCount = Math.max(0, elapsedFridays.length - adds.length);
    perMemberSummary.push({ member, missedFridayCount: behindCount });
    if (behindCount === 0) continue;

    // Trailing N unpaired Fridays under greedy chronological pairing.
    // elapsedFridays is ascending, so slice(-N) is the most recent N.
    const missedFridays = elapsedFridays.slice(-behindCount);
    const oldestMissed = missedFridays[0];
    const maxDaysLate = Math.floor(
      (todayMs - (oldestMissed.getTime() + DAY_MS)) / DAY_MS,
    );
    if (todayMs - (oldestMissed.getTime() + DAY_MS) < lateThresholdMs) {
      // They're behind, but even the oldest missed Friday is still
      // inside the grace window. No email yet — they might add today.
      continue;
    }

    offenders.push({
      member,
      missedFridays,
      weeksBehind: behindCount,
      maxDaysLate,
    });
  }
  offenders.sort((a, b) => b.weeksBehind - a.weeksBehind);

  return { year, thresholdDays, offenders, perMemberSummary };
}
