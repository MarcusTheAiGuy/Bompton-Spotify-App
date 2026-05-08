import type { CrewMember } from "@/lib/bompton";
import { formatDuration, formatLongDuration } from "@/lib/spotify";
import type {
  AlbumCount,
  ArtistCount,
  BomptonStatsBundle,
  CrewLeaderboardEntry,
  DayOfWeekDistribution,
  DisciplineEntry,
  ExplicitEntry,
  PlaylistVitals,
  TimeOfDayEntry,
  TrackLengthStats,
} from "@/lib/bompton-stats";

// Each card is self-contained, takes only the data it needs, and
// degrades cleanly when there's nothing synced yet. Tailwind grid in
// the parent page handles the 3-per-row desktop layout.

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function StatCardShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-spotify-border bg-spotify-elevated/50 p-5">
      <header className="flex flex-col gap-0.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
          {subtitle}
        </p>
        <h3 className="text-lg font-extrabold tracking-tight">{title}</h3>
      </header>
      {children}
    </article>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-spotify-border bg-spotify-highlight/30 px-3 py-2 text-xs text-spotify-subtext">
      {children}
    </p>
  );
}

// ---------- Card 1: Playlist vitals ----------

export function VitalsCard({ vitals }: { vitals: PlaylistVitals }) {
  if (vitals.totalTracks === 0) {
    return (
      <StatCardShell title="Playlist vitals" subtitle="Card 1 · Overview">
        <EmptyHint>
          No tracks synced yet — vitals populate as soon as the extension
          pushes data for any season.
        </EmptyHint>
      </StatCardShell>
    );
  }
  const avgMs =
    vitals.totalTracks > 0 ? vitals.totalDurationMs / vitals.totalTracks : 0;
  const maxSeasonCount = Math.max(
    1,
    ...vitals.perSeasonCounts.map((s) => s.count),
  );
  return (
    <StatCardShell title="Playlist vitals" subtitle="Card 1 · Overview">
      <dl className="grid grid-cols-2 gap-3">
        <Stat label="Total tracks" value={vitals.totalTracks.toLocaleString()} />
        <Stat
          label="Total runtime"
          value={formatLongDuration(vitals.totalDurationMs)}
        />
        <Stat
          label="Unique artists"
          value={vitals.uniqueArtists.toLocaleString()}
        />
        <Stat
          label="Unique albums"
          value={vitals.uniqueAlbums.toLocaleString()}
        />
        <Stat label="Unique tracks" value={vitals.uniqueTracks.toLocaleString()} />
        <Stat
          label="Avg track length"
          value={avgMs > 0 ? formatDuration(avgMs) : "—"}
        />
      </dl>
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
          Tracks per season
        </p>
        <ul className="flex flex-col gap-1">
          {vitals.perSeasonCounts.map((season) => (
            <li
              key={season.year}
              className="flex items-center gap-2 text-xs"
            >
              <span className="w-20 shrink-0 font-mono text-spotify-subtext">
                {season.year}
              </span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-spotify-highlight">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-spotify-green"
                  style={{
                    width: `${(season.count / maxSeasonCount) * 100}%`,
                  }}
                />
              </div>
              <span className="w-8 shrink-0 text-right font-mono text-spotify-subtext">
                {season.count}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </StatCardShell>
  );
}

// ---------- Card 2: All-time leaderboard ----------

export function LeaderboardCard({
  leaderboard,
}: {
  leaderboard: CrewLeaderboardEntry[];
}) {
  const totalAddsAll = leaderboard.reduce((acc, e) => acc + e.totalAdds, 0);
  if (totalAddsAll === 0) {
    return (
      <StatCardShell
        title="All-time leaderboard"
        subtitle="Card 2 · Crew"
      >
        <EmptyHint>
          No attributed adds yet. Once tracks have added_by data the crew
          ranking shows up here.
        </EmptyHint>
      </StatCardShell>
    );
  }
  const max = Math.max(1, ...leaderboard.map((e) => e.totalAdds));
  return (
    <StatCardShell title="All-time leaderboard" subtitle="Card 2 · Crew">
      <p className="text-xs text-spotify-subtext">
        Cumulative adds across every Bompton season.
      </p>
      <ol className="flex flex-col gap-3">
        {leaderboard.map((entry, index) => (
          <li
            key={entry.crewMember.id}
            className="flex items-center gap-3 text-sm"
          >
            <span className="w-5 text-center font-mono text-xs text-spotify-subtext">
              {index + 1}
            </span>
            <CrewAvatar crewMember={entry.crewMember} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">
                  {entry.crewMember.name ??
                    entry.crewMember.email ??
                    "Unknown"}
                </span>
                <span className="font-mono text-xs text-spotify-subtext">
                  {entry.totalAdds}
                </span>
              </div>
              <div className="relative h-1.5 overflow-hidden rounded-full bg-spotify-highlight">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-spotify-green"
                  style={{ width: `${(entry.totalAdds / max) * 100}%` }}
                />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </StatCardShell>
  );
}

// ---------- Card 3: Top artists ----------

export function TopArtistsCard({ artists }: { artists: ArtistCount[] }) {
  if (artists.length === 0) {
    return (
      <StatCardShell title="Most-added artists" subtitle="Card 3 · Catalog">
        <EmptyHint>No artists yet — sync a season first.</EmptyHint>
      </StatCardShell>
    );
  }
  const max = Math.max(1, ...artists.map((a) => a.count));
  return (
    <StatCardShell title="Most-added artists" subtitle="Card 3 · Catalog">
      <p className="text-xs text-spotify-subtext">
        Counted across every track in every Bompton season.
      </p>
      <ol className="flex flex-col gap-2">
        {artists.map((artist, index) => (
          <li
            key={artist.name}
            className="flex items-center gap-3 text-sm"
          >
            <span className="w-5 text-center font-mono text-xs text-spotify-subtext">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">
              {artist.name}
            </span>
            <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-spotify-highlight">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-spotify-green"
                style={{ width: `${(artist.count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-xs text-spotify-subtext">
              {artist.count}
            </span>
          </li>
        ))}
      </ol>
    </StatCardShell>
  );
}

// ---------- Card 4: Top albums ----------

export function TopAlbumsCard({ albums }: { albums: AlbumCount[] }) {
  if (albums.length === 0) {
    return (
      <StatCardShell title="Most-added albums" subtitle="Card 4 · Catalog">
        <EmptyHint>No albums yet — sync a season first.</EmptyHint>
      </StatCardShell>
    );
  }
  return (
    <StatCardShell title="Most-added albums" subtitle="Card 4 · Catalog">
      <p className="text-xs text-spotify-subtext">
        Albums that show up most often across the four seasons.
      </p>
      <ul className="flex flex-col gap-3">
        {albums.map((album) => (
          <li
            key={`${album.name}-${album.artist}`}
            className="flex items-center gap-3 text-sm"
          >
            {album.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={album.imageUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="h-12 w-12 shrink-0 rounded bg-spotify-highlight" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{album.name}</p>
              <p className="truncate text-xs text-spotify-subtext">
                {album.artist || "Unknown artist"}
              </p>
            </div>
            <span className="font-mono text-xs text-spotify-subtext">
              {album.count}×
            </span>
          </li>
        ))}
      </ul>
    </StatCardShell>
  );
}

// ---------- Card 5: Friday discipline ----------

export function DisciplineCard({
  discipline,
}: {
  discipline: DisciplineEntry[];
}) {
  const counted = discipline.filter((d) => d.totalWeeks > 0);
  if (counted.length === 0) {
    return (
      <StatCardShell title="Friday discipline" subtitle="Card 5 · Habits">
        <EmptyHint>
          Discipline scores need synced track timestamps. Run the extension
          for at least one season.
        </EmptyHint>
      </StatCardShell>
    );
  }
  return (
    <StatCardShell title="Friday discipline" subtitle="Card 5 · Habits">
      <p className="text-xs text-spotify-subtext">
        Per crew member: how often you actually added on Friday vs. late vs.
        skipped, across every Friday in every season.
      </p>
      <ul className="flex flex-col gap-3">
        {discipline.map((entry) => {
          const total = Math.max(1, entry.totalWeeks);
          const onPct = (entry.onTime / total) * 100;
          const latePct = (entry.late / total) * 100;
          const missPct = (entry.missed / total) * 100;
          return (
            <li
              key={entry.crewMember.id}
              className="flex flex-col gap-1.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <CrewAvatar crewMember={entry.crewMember} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {entry.crewMember.name ??
                    entry.crewMember.email ??
                    "Unknown"}
                </span>
                <span className="font-mono text-spotify-subtext">
                  {(entry.onTimeRate * 100).toFixed(0)}% on time
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-spotify-highlight">
                <div
                  className="bg-spotify-green"
                  style={{ width: `${onPct}%` }}
                  title={`On time: ${entry.onTime}`}
                />
                <div
                  className="bg-yellow-500"
                  style={{ width: `${latePct}%` }}
                  title={`Late: ${entry.late}`}
                />
                <div
                  className="bg-red-500"
                  style={{ width: `${missPct}%` }}
                  title={`Missed: ${entry.missed}`}
                />
              </div>
              <p className="text-[10px] text-spotify-subtext">
                {entry.onTime} on time · {entry.late} late · {entry.missed}{" "}
                missed · {entry.totalWeeks} weeks
              </p>
            </li>
          );
        })}
      </ul>
      <Legend
        items={[
          { color: "bg-spotify-green", label: "On Friday" },
          { color: "bg-yellow-500", label: "Late (same week)" },
          { color: "bg-red-500", label: "Missed" },
        ]}
      />
    </StatCardShell>
  );
}

// ---------- Card 6: Time-of-day per crew ----------

export function TimeOfDayCard({
  timeOfDay,
}: {
  timeOfDay: TimeOfDayEntry[];
}) {
  const counted = timeOfDay.filter((e) => e.total > 0);
  if (counted.length === 0) {
    return (
      <StatCardShell title="Adds by time of day" subtitle="Card 6 · Habits">
        <EmptyHint>
          Time-of-day patterns appear once tracks have added_at timestamps in
          the database.
        </EmptyHint>
      </StatCardShell>
    );
  }
  return (
    <StatCardShell title="Adds by time of day" subtitle="Card 6 · Habits">
      <p className="text-xs text-spotify-subtext">
        UTC hour buckets — morning (5a–12p), afternoon (12–5p), evening
        (5–10p), night (10p–5a).
      </p>
      <ul className="flex flex-col gap-3">
        {timeOfDay.map((entry) => {
          const total = Math.max(1, entry.total);
          const m = (entry.morning / total) * 100;
          const a = (entry.afternoon / total) * 100;
          const e = (entry.evening / total) * 100;
          const n = (entry.night / total) * 100;
          return (
            <li
              key={entry.crewMember.id}
              className="flex flex-col gap-1.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <CrewAvatar crewMember={entry.crewMember} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {entry.crewMember.name ??
                    entry.crewMember.email ??
                    "Unknown"}
                </span>
                <span className="font-mono text-spotify-subtext">
                  {entry.total} adds
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-spotify-highlight">
                <div
                  className="bg-amber-400"
                  style={{ width: `${m}%` }}
                  title={`Morning: ${entry.morning}`}
                />
                <div
                  className="bg-orange-500"
                  style={{ width: `${a}%` }}
                  title={`Afternoon: ${entry.afternoon}`}
                />
                <div
                  className="bg-pink-500"
                  style={{ width: `${e}%` }}
                  title={`Evening: ${entry.evening}`}
                />
                <div
                  className="bg-indigo-500"
                  style={{ width: `${n}%` }}
                  title={`Night: ${entry.night}`}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <Legend
        items={[
          { color: "bg-amber-400", label: "Morning" },
          { color: "bg-orange-500", label: "Afternoon" },
          { color: "bg-pink-500", label: "Evening" },
          { color: "bg-indigo-500", label: "Night" },
        ]}
      />
    </StatCardShell>
  );
}

// ---------- Card 7: Day of week ----------

export function DayOfWeekCard({
  dayOfWeek,
}: {
  dayOfWeek: DayOfWeekDistribution;
}) {
  if (dayOfWeek.total === 0) {
    return (
      <StatCardShell title="Day of the week" subtitle="Card 7 · Habits">
        <EmptyHint>
          No timestamps to plot yet. Sync a season and the day-of-week
          histogram fills in.
        </EmptyHint>
      </StatCardShell>
    );
  }
  const max = Math.max(1, ...dayOfWeek.counts);
  return (
    <StatCardShell title="Day of the week" subtitle="Card 7 · Habits">
      <p className="text-xs text-spotify-subtext">
        How often songs actually land on each weekday (UTC). Friday should
        dominate — if it doesn't, somebody's slipping.
      </p>
      <ul className="flex items-end justify-between gap-1.5 pt-2">
        {DAY_LABELS.map((label, idx) => {
          const value = dayOfWeek.counts[idx] ?? 0;
          const heightPct = (value / max) * 100;
          const isFriday = idx === 5;
          const isTop = idx === dayOfWeek.topDayIndex;
          return (
            <li
              key={label}
              className="flex w-full flex-1 flex-col items-center gap-1"
            >
              <span className="font-mono text-[10px] text-spotify-subtext">
                {value}
              </span>
              <div className="flex h-24 w-full items-end">
                <div
                  className={`w-full rounded-t ${
                    isFriday
                      ? "bg-spotify-green"
                      : isTop
                      ? "bg-spotify-green/60"
                      : "bg-spotify-highlight"
                  }`}
                  style={{ height: `${Math.max(2, heightPct)}%` }}
                />
              </div>
              <span
                className={`text-[10px] font-bold uppercase tracking-widest ${
                  isFriday
                    ? "text-spotify-green"
                    : "text-spotify-subtext"
                }`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-spotify-subtext">
        Friday share:{" "}
        <span className="font-mono text-spotify-text">
          {(dayOfWeek.fridayRate * 100).toFixed(0)}%
        </span>{" "}
        ({dayOfWeek.fridayCount} of {dayOfWeek.total} adds)
      </p>
    </StatCardShell>
  );
}

// ---------- Card 8: Track length ----------

export function TrackLengthCard({
  trackLength,
}: {
  trackLength: TrackLengthStats;
}) {
  if (trackLength.totalCount === 0) {
    return (
      <StatCardShell title="Track length profile" subtitle="Card 8 · Catalog">
        <EmptyHint>
          Track durations populate once any season has tracks with non-zero
          duration_ms in the DB.
        </EmptyHint>
      </StatCardShell>
    );
  }
  return (
    <StatCardShell title="Track length profile" subtitle="Card 8 · Catalog">
      <dl className="grid grid-cols-2 gap-3">
        <Stat
          label="Average"
          value={formatDuration(trackLength.averageMs)}
        />
        <Stat label="Median" value={formatDuration(trackLength.medianMs)} />
      </dl>
      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
          Shortest
        </p>
        <TrackLine track={trackLength.shortest} />
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
          Longest
        </p>
        <TrackLine track={trackLength.longest} />
      </div>
      <p className="text-[11px] text-spotify-subtext">
        Across {trackLength.totalCount.toLocaleString()} tracks ·{" "}
        {formatLongDuration(trackLength.totalMs)} of music total.
      </p>
    </StatCardShell>
  );
}

function TrackLine({
  track,
}: {
  track: { name: string; artist: string; durationMs: number } | null;
}) {
  if (!track) return <p className="text-xs text-spotify-subtext">—</p>;
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-semibold">{track.name}</p>
        <p className="truncate text-xs text-spotify-subtext">
          {track.artist || "Unknown artist"}
        </p>
      </div>
      <span className="font-mono text-xs text-spotify-subtext">
        {formatDuration(track.durationMs)}
      </span>
    </div>
  );
}

// ---------- Card 9: Explicit content ----------

export function ExplicitCard({
  explicit,
}: {
  explicit: ExplicitEntry[];
}) {
  const counted = explicit.filter((e) => e.total > 0);
  if (counted.length === 0) {
    return (
      <StatCardShell title="Explicit ratio" subtitle="Card 9 · Vibes">
        <EmptyHint>
          Explicit ratios show up once we have attributed track adds with the
          explicit flag.
        </EmptyHint>
      </StatCardShell>
    );
  }
  const totalExplicit = explicit.reduce((acc, e) => acc + e.explicit, 0);
  const totalAll = explicit.reduce((acc, e) => acc + e.total, 0);
  const overallRate = totalAll > 0 ? (totalExplicit / totalAll) * 100 : 0;
  return (
    <StatCardShell title="Explicit ratio" subtitle="Card 9 · Vibes">
      <p className="text-xs text-spotify-subtext">
        Explicit-tagged tracks per crew member. Overall:{" "}
        <span className="font-mono text-spotify-text">
          {overallRate.toFixed(0)}%
        </span>{" "}
        of attributed adds.
      </p>
      <ul className="flex flex-col gap-3">
        {explicit.map((entry) => {
          const total = Math.max(1, entry.total);
          const ePct = (entry.explicit / total) * 100;
          const cPct = (entry.clean / total) * 100;
          return (
            <li
              key={entry.crewMember.id}
              className="flex flex-col gap-1.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <CrewAvatar crewMember={entry.crewMember} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {entry.crewMember.name ??
                    entry.crewMember.email ??
                    "Unknown"}
                </span>
                <span className="font-mono text-spotify-subtext">
                  {(entry.explicitRate * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-spotify-highlight">
                <div
                  className="bg-rose-500"
                  style={{ width: `${ePct}%` }}
                  title={`Explicit: ${entry.explicit}`}
                />
                <div
                  className="bg-emerald-500"
                  style={{ width: `${cPct}%` }}
                  title={`Clean: ${entry.clean}`}
                />
              </div>
              <p className="text-[10px] text-spotify-subtext">
                {entry.explicit} explicit · {entry.clean} clean ·{" "}
                {entry.total} total
              </p>
            </li>
          );
        })}
      </ul>
      <Legend
        items={[
          { color: "bg-rose-500", label: "Explicit" },
          { color: "bg-emerald-500", label: "Clean" },
        ]}
      />
    </StatCardShell>
  );
}

// ---------- Shared subcomponents ----------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
        {label}
      </dt>
      <dd className="text-xl font-extrabold tracking-tight">{value}</dd>
    </div>
  );
}

function Legend({
  items,
}: {
  items: { color: string; label: string }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-spotify-subtext">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${item.color}`} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function CrewAvatar({
  crewMember,
  size = "md",
}: {
  crewMember: CrewMember;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  const initial = (crewMember.name ?? crewMember.email ?? "?")
    .slice(0, 1)
    .toUpperCase();
  if (crewMember.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={crewMember.image}
        alt=""
        className={`${dim} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <span
      className={`${dim} flex shrink-0 items-center justify-center rounded-full bg-spotify-highlight font-bold`}
    >
      {initial}
    </span>
  );
}

export function StatsCardGrid({ stats }: { stats: BomptonStatsBundle }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <VitalsCard vitals={stats.vitals} />
      <LeaderboardCard leaderboard={stats.leaderboard} />
      <TopArtistsCard artists={stats.topArtists} />
      <TopAlbumsCard albums={stats.topAlbums} />
      <DisciplineCard discipline={stats.discipline} />
      <TimeOfDayCard timeOfDay={stats.timeOfDay} />
      <DayOfWeekCard dayOfWeek={stats.dayOfWeek} />
      <TrackLengthCard trackLength={stats.trackLength} />
      <ExplicitCard explicit={stats.explicit} />
    </div>
  );
}
