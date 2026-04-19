import type { CrewMember, SeasonScore } from "@/lib/bompton";
import { CURRENT_BOMPTON_YEAR } from "@/lib/bompton";

export function FridayLeaderboard({
  scores,
  seasonStartAt,
  lastFridayAt,
  weeksElapsed,
  hasRealData,
  missingDataReason,
}: {
  scores: SeasonScore[];
  seasonStartAt: Date | null;
  lastFridayAt: Date | null;
  weeksElapsed: number;
  hasRealData: boolean;
  missingDataReason?: string;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-spotify-border bg-spotify-elevated/50 p-6">
      <header className="flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-spotify-subtext">
            Current season
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight">
            Bompton {CURRENT_BOMPTON_YEAR} · Friday standings
          </h2>
          <p className="mt-1 text-sm text-spotify-subtext">
            Every crew member is supposed to add one song per Friday. Behind =
            how many Fridays you've missed since the season started.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 text-xs sm:text-right">
          <dt className="text-spotify-subtext">Season started</dt>
          <dd className="font-mono">{formatDate(seasonStartAt)}</dd>
          <dt className="text-spotify-subtext">Most recent Friday</dt>
          <dd className="font-mono">{formatDate(lastFridayAt)}</dd>
          <dt className="text-spotify-subtext">Fridays elapsed</dt>
          <dd className="font-mono">{weeksElapsed}</dd>
        </dl>
      </header>

      {!hasRealData ? (
        <div className="rounded-lg border border-spotify-border bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
          <p className="font-semibold text-spotify-text">
            Scores populate automatically once Spotify starts returning track
            data again.
          </p>
          <p className="mt-1">
            {missingDataReason ??
              "Right now /playlists/{id}/tracks is blocked for this app's quota tier. Apply for Extended Quota Mode in the Spotify developer dashboard; once granted, this leaderboard backfills from the real added_at / added_by timestamps."}
          </p>
        </div>
      ) : null}

      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {scores.map((score, index) => (
          <ScoreCard
            key={score.crewMember.id}
            score={score}
            rank={index + 1}
            hasRealData={hasRealData}
          />
        ))}
      </ol>
    </section>
  );
}

function ScoreCard({
  score,
  rank,
  hasRealData,
}: {
  score: SeasonScore;
  rank: number;
  hasRealData: boolean;
}) {
  const { crewMember } = score;
  const label = crewMember.name ?? crewMember.email ?? "Unknown";
  return (
    <li className="flex flex-col gap-2 rounded-lg bg-spotify-base/50 p-4">
      <div className="flex items-center gap-3">
        <AvatarBadge
          crewMember={crewMember}
          rank={rank}
          highlight={hasRealData && score.behind === 0}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{label}</p>
          <p className="text-xs text-spotify-subtext">
            {hasRealData
              ? score.behind === 0
                ? "caught up"
                : `${score.behind} week${score.behind === 1 ? "" : "s"} behind`
              : "standings pending"}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Row label="Added" value={hasRealData ? score.addedCount : "—"} />
        <Row label="Expected" value={score.expectedCount} />
        <Row
          label="On-time"
          value={hasRealData ? score.weeksOnTime : "—"}
          hint="within 24h of Friday"
        />
        <Row
          label="Late"
          value={hasRealData ? score.weeksLate : "—"}
          hint="after Fri but before next Fri"
        />
        <Row
          label="Missed"
          value={hasRealData ? score.weeksMissed : "—"}
          hint="didn't add at all"
        />
        <Row
          label="First that week"
          value={hasRealData ? score.firstByCount : "—"}
        />
      </dl>
    </li>
  );
}

function AvatarBadge({
  crewMember,
  rank,
  highlight,
}: {
  crewMember: CrewMember;
  rank: number;
  highlight: boolean;
}) {
  const initial = (crewMember.name ?? crewMember.email ?? "?")
    .slice(0, 1)
    .toUpperCase();
  const ringCls = highlight
    ? "ring-2 ring-spotify-green"
    : "ring-1 ring-spotify-border";
  return (
    <div className="relative shrink-0">
      {crewMember.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={crewMember.image}
          alt=""
          className={`h-12 w-12 rounded-full object-cover ${ringCls}`}
        />
      ) : (
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-full bg-spotify-highlight text-lg font-bold ${ringCls}`}
        >
          {initial}
        </div>
      )}
      <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-spotify-green text-[10px] font-bold text-black">
        {rank}
      </span>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <>
      <dt
        className="text-spotify-subtext"
        title={hint}
      >
        {label}
      </dt>
      <dd className="text-right font-mono">{value}</dd>
    </>
  );
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
