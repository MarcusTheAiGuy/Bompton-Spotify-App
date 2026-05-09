import type { CrewMember } from "@/lib/bompton";
import { formatDuration, formatLongDuration } from "@/lib/spotify";
import type {
  AlbumCount,
  ArtistCount,
  BomptonStatsBundle,
  DayOfWeekDistribution,
  DedicationEntry,
  ExplicitEntry,
  GenreBreakdown,
  OnTimeStats,
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

// ---------- Card 1: Genre tracker ----------

export function GenreCard({ genres }: { genres: GenreBreakdown }) {
  const hasOverall = genres.overall.length > 0;
  const hasAnyPerCrew = genres.perCrew.some((c) => c.topGenres.length > 0);
  if (!hasOverall && !hasAnyPerCrew) {
    return (
      <StatCardShell title="Genre tracker" subtitle="Card 1 · Catalog">
        <EmptyHint>
          No genre data yet. Genres come from Spotify's /v1/artists endpoint
          — we cache them in the Artist table on first lookup. If this stays
          empty, the caller's Spotify token may be expired (sign out and
          back in) or the Artist table needs `npm run db:push`.
        </EmptyHint>
      </StatCardShell>
    );
  }
  return (
    <StatCardShell title="Genre tracker" subtitle="Card 1 · Catalog">
      <p className="text-xs text-spotify-subtext">
        Top three genres for each crew member, plus the top three across the
        playlist as a whole. Each genre tag on an artist counts once per
        track.
      </p>

      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
          Bompton overall
        </p>
        {hasOverall ? (
          <ol className="flex flex-col gap-1.5">
            {genres.overall.map((g, idx) => (
              <li
                key={g.genre}
                className="flex items-center gap-2 text-sm"
              >
                <span className="w-4 text-center font-mono text-xs text-spotify-subtext">
                  {idx + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold capitalize">
                  {g.genre}
                </span>
                <span className="font-mono text-xs text-spotify-subtext">
                  {g.count}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-spotify-subtext">
            No artist genres have been cached yet.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
          By crew member
        </p>
        <ul className="flex flex-col gap-3">
          {genres.perCrew.map((entry) => (
            <li
              key={entry.crewMember.id}
              className="flex flex-col gap-1.5"
            >
              <div className="flex items-center gap-2">
                <CrewAvatar crewMember={entry.crewMember} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {entry.crewMember.name ??
                    entry.crewMember.email ??
                    "Unknown"}
                </span>
                <span className="font-mono text-[10px] text-spotify-subtext">
                  {entry.totalGenreHits} tags
                </span>
              </div>
              {entry.topGenres.length > 0 ? (
                <ol className="flex flex-col gap-1 pl-8 text-xs">
                  {entry.topGenres.map((g, idx) => (
                    <li
                      key={g.genre}
                      className="flex items-center gap-2"
                    >
                      <span className="w-4 text-center font-mono text-[10px] text-spotify-subtext">
                        {idx + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate capitalize">
                        {g.genre}
                      </span>
                      <span className="font-mono text-spotify-subtext">
                        {g.count}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="pl-8 text-[10px] text-spotify-subtext">
                  No genres yet — this member's added artists aren't in our
                  Artist cache.
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[10px] text-spotify-subtext">
        Cached genres for {genres.totalArtistsWithGenres} of{" "}
        {genres.totalArtistsLookedUp} artists referenced by Bompton tracks.
      </p>
    </StatCardShell>
  );
}

// ---------- Card 2: Listening dedication ----------

export function DedicationCard({
  dedication,
}: {
  dedication: DedicationEntry[];
}) {
  const totalListens = dedication.reduce((acc, e) => acc + e.listenCount, 0);
  if (totalListens === 0) {
    return (
      <StatCardShell title="Listening dedication" subtitle="Card 2 · Crew">
        <EmptyHint>
          No qualifying listens recorded yet. We capture plays from
          /me/player/recently-played each time someone hits the dashboard
          and append them to the ListeningPlay table. Hit /dashboard for
          each crew member to seed history, then come back.
        </EmptyHint>
      </StatCardShell>
    );
  }
  const max = Math.max(1, ...dedication.map((e) => e.listenCount));
  return (
    <StatCardShell title="Listening dedication" subtitle="Card 2 · Crew">
      <p className="text-xs text-spotify-subtext">
        How many times each member has played a Bompton track that someone
        else added — counting only plays after the add date. Banked from
        each dashboard recently-played fetch, so this fills as the crew
        keeps using the app.
      </p>
      <ul className="flex flex-col gap-3">
        {dedication.map((entry) => (
          <li
            key={entry.crewMember.id}
            className="flex items-center gap-3 text-sm"
          >
            <CrownAvatar
              crewMember={entry.crewMember}
              isCrown={entry.isCrown}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">
                  {entry.crewMember.name ??
                    entry.crewMember.email ??
                    "Unknown"}
                </span>
                <span className="font-mono text-xs text-spotify-subtext">
                  {entry.listenCount} plays
                </span>
              </div>
              <div className="relative h-1.5 overflow-hidden rounded-full bg-spotify-highlight">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-spotify-green"
                  style={{ width: `${(entry.listenCount / max) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-spotify-subtext">
                {entry.uniqueTracks} unique tracks ·{" "}
                {formatLongDuration(entry.listenedMs)} listened
              </p>
            </div>
          </li>
        ))}
      </ul>
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

// ---------- Card 5: On-time stats (line graph) ----------

export function OnTimeCard({ onTime }: { onTime: OnTimeStats }) {
  if (!onTime.hasData || onTime.series.length === 0) {
    return (
      <StatCardShell title="On-time stats" subtitle="Card 5 · Habits">
        <EmptyHint>
          No timestamped adds yet for the current season ({onTime.year}). The
          line graph fills in once tracks have added_at / added_by data
          synced from Spotify (hit Refresh on /bompton-playlist).
        </EmptyHint>
      </StatCardShell>
    );
  }
  return (
    <StatCardShell title="On-time stats" subtitle="Card 5 · Habits">
      <p className="text-xs text-spotify-subtext">
        Cumulative late days per member for the current season ({onTime.year}).
        Each day past Friday without an add costs +1, and X weeks behind
        means +X per day. Lowest line wins.
      </p>
      <OnTimeLineGraph onTime={onTime} />
      <ul className="flex flex-col gap-2">
        {[...onTime.totals]
          .sort((a, b) => a.lateDays - b.lateDays)
          .map((total) => (
            <li
              key={total.crewMember.id}
              className="flex items-center gap-3 text-sm"
            >
              <CrownAvatar
                crewMember={total.crewMember}
                isCrown={total.isCrown}
                ringColor={total.color}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">
                  {total.crewMember.name ??
                    total.crewMember.email ??
                    "Unknown"}
                </span>
                <span className="text-[10px] text-spotify-subtext">
                  {total.weeksBehind} week
                  {total.weeksBehind === 1 ? "" : "s"} behind right now
                </span>
              </div>
              <span
                className="font-mono text-xs"
                style={{ color: total.color }}
              >
                {total.lateDays} late {total.lateDays === 1 ? "day" : "days"}
              </span>
            </li>
          ))}
      </ul>
    </StatCardShell>
  );
}

function OnTimeLineGraph({ onTime }: { onTime: OnTimeStats }) {
  const width = 360;
  const height = 180;
  const paddingL = 32;
  const paddingR = 12;
  const paddingT = 12;
  const paddingB = 28;
  const innerW = width - paddingL - paddingR;
  const innerH = height - paddingT - paddingB;

  const series = onTime.series;
  const lastIndex = series.length - 1;
  const maxLate = Math.max(
    1,
    ...series.flatMap((p) => Object.values(p.perCrew)),
  );

  // Y-axis ticks: 0, 25%, 50%, 75%, 100% rounded to nice integers
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxLate));
  // X-axis ticks: first, ~middle, last
  const xTickIndices =
    lastIndex < 1
      ? [0]
      : lastIndex < 3
      ? [0, lastIndex]
      : [0, Math.floor(lastIndex / 2), lastIndex];

  const xCoord = (i: number) =>
    lastIndex === 0
      ? paddingL + innerW / 2
      : paddingL + (i / lastIndex) * innerW;
  const yCoord = (v: number) =>
    paddingT + innerH - (v / maxLate) * innerH;

  const formatXTick = (idx: number) => {
    const iso = series[idx]?.date;
    if (!iso) return "";
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="rounded-lg bg-spotify-base/50 p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Cumulative late days over time per crew member"
        className="h-44 w-full"
      >
        {/* Y-axis grid + labels */}
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              x1={paddingL}
              x2={width - paddingR}
              y1={yCoord(tick)}
              y2={yCoord(tick)}
              stroke="#2a2a2a"
              strokeDasharray="2 3"
            />
            <text
              x={paddingL - 6}
              y={yCoord(tick) + 3}
              fontSize="9"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fill="#b3b3b3"
              textAnchor="end"
            >
              {tick}
            </text>
          </g>
        ))}
        {/* X-axis tick labels */}
        {xTickIndices.map((idx) => (
          <text
            key={`x-${idx}`}
            x={xCoord(idx)}
            y={height - paddingB + 14}
            fontSize="9"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            fill="#b3b3b3"
            textAnchor="middle"
          >
            {formatXTick(idx)}
          </text>
        ))}
        {/* Axis */}
        <line
          x1={paddingL}
          x2={paddingL}
          y1={paddingT}
          y2={height - paddingB}
          stroke="#2a2a2a"
        />
        <line
          x1={paddingL}
          x2={width - paddingR}
          y1={height - paddingB}
          y2={height - paddingB}
          stroke="#2a2a2a"
        />
        {/* Lines per crew member */}
        {onTime.totals.map((total) => {
          const path = series
            .map((point, i) => {
              const v = point.perCrew[total.crewMember.id] ?? 0;
              const x = xCoord(i);
              const y = yCoord(v);
              return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(" ");
          return (
            <path
              key={total.crewMember.id}
              d={path}
              fill="none"
              stroke={total.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
    </div>
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

// Avatar variant used by Card 2 + Card 5: shows a 👑 emoji at the
// top-right of the leader's avatar and supports an optional colored
// ring (used by the on-time graph to tie each member to their line).
function CrownAvatar({
  crewMember,
  isCrown,
  ringColor,
}: {
  crewMember: CrewMember;
  isCrown: boolean;
  ringColor?: string;
}) {
  const initial = (crewMember.name ?? crewMember.email ?? "?")
    .slice(0, 1)
    .toUpperCase();
  const ringStyle = ringColor
    ? { boxShadow: `0 0 0 2px ${ringColor}` }
    : undefined;
  return (
    <span className="relative inline-flex shrink-0">
      {crewMember.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={crewMember.image}
          alt=""
          className="h-10 w-10 rounded-full object-cover"
          style={ringStyle}
        />
      ) : (
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full bg-spotify-highlight text-sm font-bold"
          style={ringStyle}
        >
          {initial}
        </span>
      )}
      {isCrown ? (
        <span
          className="absolute -right-1 -top-2 text-base"
          aria-label="Leader"
          title="Leader"
        >
          👑
        </span>
      ) : null}
    </span>
  );
}

export function StatsCardGrid({ stats }: { stats: BomptonStatsBundle }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <GenreCard genres={stats.genres} />
      <DedicationCard dedication={stats.dedication} />
      <TopArtistsCard artists={stats.topArtists} />
      <TopAlbumsCard albums={stats.topAlbums} />
      <OnTimeCard onTime={stats.onTime} />
      <TimeOfDayCard timeOfDay={stats.timeOfDay} />
      <DayOfWeekCard dayOfWeek={stats.dayOfWeek} />
      <TrackLengthCard trackLength={stats.trackLength} />
      <ExplicitCard explicit={stats.explicit} />
    </div>
  );
}
