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
  // Every Friday they're behind on (deadline > 3 days ago, no add for
  // that week). Sorted oldest-first.
  missedFridays: Date[];
  // Convenience: missedFridays.length.
  weeksBehind: number;
  // Days since the most recent missed Friday's deadline (Saturday).
  // Always >= 3 since we threshold there.
  maxDaysLate: number;
};

export type LateAddDetection = {
  year: BomptonYear;
  thresholdDays: number;
  // Members who are past the threshold for at least one Friday.
  // Members who are caught up (or behind by less than threshold) are
  // omitted. Sorted by weeksBehind desc.
  offenders: LateAdder[];
  // Diagnostic: every member's missed-Friday count, including 0. Lets
  // the response surface "no one's late" with full context.
  perMemberSummary: {
    member: CrewMember;
    missedFridayCount: number;
  }[];
};

// "More than 3 days late" = the Saturday after a Friday has passed,
// and now's been >=3 days since that Saturday, and the member has no
// added_at timestamp in the [Friday, nextFriday) window.
//
// We anchor on the Saturday (Friday + 1 day) because that's when an
// add stops being on-time. The threshold counts days since Saturday,
// not days since Friday, so "3 days late" means the Tuesday after the
// missed Friday at the earliest.
//
// Greedy assignment (consume earliest adds first against earliest
// Fridays) is intentionally NOT used here — that's the on-time stats
// approach which works back-fills retroactively. Late-add emails
// should fire on the *literal* missed Friday week, so we filter adds
// strictly to [Friday, Friday+7day) and an add for "this week
// retroactively counts for last week" doesn't apply.
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

  if (todayMs < seasonStartAt.getTime()) {
    return {
      year,
      thresholdDays,
      offenders: [],
      perMemberSummary: crew.map((m) => ({ member: m, missedFridayCount: 0 })),
    };
  }

  const recentFriday = mostRecentFriday(new Date(todayMs));
  if (recentFriday.getTime() < seasonStartAt.getTime()) {
    return {
      year,
      thresholdDays,
      offenders: [],
      perMemberSummary: crew.map((m) => ({ member: m, missedFridayCount: 0 })),
    };
  }

  const fridays = fridaysBetween(seasonStartAt, recentFriday);

  // Only consider Fridays whose Saturday-deadline is >= thresholdDays old.
  // A Friday whose deadline is only 2 days old isn't "more than 3 days
  // late" yet — it might become late tomorrow.
  const lateThresholdMs = thresholdDays * DAY_MS;
  const eligibleFridays = fridays.filter(
    (f) => todayMs - (f.getTime() + DAY_MS) >= lateThresholdMs,
  );
  if (eligibleFridays.length === 0) {
    return {
      year,
      thresholdDays,
      offenders: [],
      perMemberSummary: crew.map((m) => ({ member: m, missedFridayCount: 0 })),
    };
  }

  const season = data.find((d) => d.year === year);
  const tracks = season?.tracks ?? [];

  // member id → set of Friday ms they have at least one add for.
  const satisfiedFridaysByMember = new Map<string, Set<number>>();
  for (const c of crew) satisfiedFridaysByMember.set(c.id, new Set<number>());
  for (const t of tracks) {
    const addedBySpotifyId = t.added_by?.id;
    const addedAt = t.added_at;
    if (!addedBySpotifyId || !addedAt) continue;
    const member = crew.find((c) => c.spotifyUserId === addedBySpotifyId);
    if (!member) continue;
    const tsMs = new Date(addedAt).getTime();
    if (Number.isNaN(tsMs)) continue;
    // Match the add to its Friday bucket: [Friday, Friday+7day).
    for (const f of fridays) {
      const fMs = f.getTime();
      if (tsMs >= fMs && tsMs < fMs + 7 * DAY_MS) {
        satisfiedFridaysByMember.get(member.id)?.add(fMs);
        break;
      }
    }
  }

  const offenders: LateAdder[] = [];
  const perMemberSummary: LateAddDetection["perMemberSummary"] = [];
  for (const member of crew) {
    const satisfied = satisfiedFridaysByMember.get(member.id) ?? new Set();
    const missed = eligibleFridays.filter((f) => !satisfied.has(f.getTime()));
    perMemberSummary.push({ member, missedFridayCount: missed.length });
    if (missed.length === 0) continue;
    const mostRecentMissed = missed[missed.length - 1];
    const maxDaysLate = Math.floor(
      (todayMs - (mostRecentMissed.getTime() + DAY_MS)) / DAY_MS,
    );
    offenders.push({
      member,
      missedFridays: missed,
      weeksBehind: missed.length,
      maxDaysLate,
    });
  }
  offenders.sort((a, b) => b.weeksBehind - a.weeksBehind);

  return { year, thresholdDays, offenders, perMemberSummary };
}
