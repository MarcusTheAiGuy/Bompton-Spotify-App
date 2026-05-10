import Link from "next/link";
import { formatLongDuration } from "@/lib/spotify";
import type { BomptonStatsBundle } from "@/lib/bompton-stats";
import { displayCrewName } from "@/lib/spotify-user-names";

// Compact stats overview that appears on the main /bompton-playlist
// page above the season columns. The "See more" button at the bottom
// links to the deep-dive /bompton-playlist/stats page.

export function PlaylistStatsSummary({
  stats,
}: {
  stats: BomptonStatsBundle;
}) {
  const hasData = stats.totalTracks > 0;
  const mostDedicated = dedicationLeader(stats);
  const onTimeWinner = onTimeLeader(stats);
  const topArtist = stats.topArtists[0] ?? null;
  const topAlbum = stats.topAlbums[0] ?? null;

  return (
    <section className="flex flex-col gap-5 rounded-lg border border-spotify-border bg-spotify-elevated/50 p-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-widest text-spotify-subtext">
          Playlist stats
        </p>
        <h2 className="text-2xl font-extrabold tracking-tight">
          Bompton, by the numbers
        </h2>
        <p className="text-sm text-spotify-subtext">
          A snapshot across all four seasons. Hit{" "}
          <span className="font-semibold text-spotify-text">See more</span> for
          the full breakdown.
        </p>
      </header>

      {hasData ? (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Vital
              label="Tracks"
              value={stats.vitals.totalTracks.toLocaleString()}
              hint={`${stats.vitals.uniqueTracks.toLocaleString()} unique`}
            />
            <Vital
              label="Total runtime"
              value={formatLongDuration(stats.vitals.totalDurationMs)}
              hint={
                stats.vitals.totalTracks > 0
                  ? `${formatLongDuration(
                      stats.vitals.totalDurationMs / stats.vitals.totalTracks,
                    )} avg`
                  : ""
              }
            />
            <Vital
              label="Unique artists"
              value={stats.vitals.uniqueArtists.toLocaleString()}
              hint={`${stats.vitals.uniqueAlbums.toLocaleString()} albums`}
            />
            <Vital
              label="Seasons synced"
              value={`${stats.vitals.seasonsWithData} / ${stats.vitals.totalSeasons}`}
            />
          </dl>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Highlight
              label="Most dedicated"
              primary={mostDedicated?.name ?? "—"}
              secondary={
                mostDedicated
                  ? `${mostDedicated.listenCount} play${
                      mostDedicated.listenCount === 1 ? "" : "s"
                    }`
                  : "no plays yet"
              }
            />
            <Highlight
              label="Always on Time"
              primary={onTimeWinner?.name ?? "—"}
              secondary={
                onTimeWinner
                  ? onTimeWinner.lateDays === 0
                    ? "0 late days"
                    : `${onTimeWinner.lateDays} late day${
                        onTimeWinner.lateDays === 1 ? "" : "s"
                      }`
                  : "no on-time data yet"
              }
            />
            <Highlight
              label="Most-added artist"
              primary={topArtist?.name ?? "—"}
              secondary={
                topArtist
                  ? `${topArtist.count} track${topArtist.count === 1 ? "" : "s"}`
                  : "no tracks yet"
              }
            />
            <Highlight
              label="Most-added album"
              primary={topAlbum?.name ?? "—"}
              secondary={
                topAlbum
                  ? `${topAlbum.artist || "—"} · ${topAlbum.count} track${
                      topAlbum.count === 1 ? "" : "s"
                    }`
                  : "no tracks yet"
              }
            />
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-spotify-border bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
          <p className="font-semibold text-spotify-text">
            No track data synced yet.
          </p>
          <p className="mt-1">
            Hit the Refresh button at the top of this page to pull from
            Spotify. Once track-level data for at least one Bompton season
            has been synced, the stats overview and the deep-dive page
            populate automatically.
          </p>
        </div>
      )}

      <div className="flex justify-center">
        <Link
          href="/bompton-playlist/stats"
          className="inline-flex items-center gap-2 rounded-full bg-spotify-green px-6 py-2.5 text-sm font-bold uppercase tracking-wide text-black transition hover:bg-spotify-green-hover hover:scale-[1.03] active:scale-[0.98]"
        >
          See more
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}

function Vital({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
        {label}
      </dt>
      <dd className="text-2xl font-extrabold tracking-tight">{value}</dd>
      {hint ? (
        <span className="text-[11px] text-spotify-subtext">{hint}</span>
      ) : null}
    </div>
  );
}

function Highlight({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-spotify-base/50 p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
        {label}
      </p>
      <p className="truncate font-bold">{primary}</p>
      <p className="text-xs text-spotify-subtext">{secondary}</p>
    </div>
  );
}

function onTimeLeader(
  stats: BomptonStatsBundle,
): { name: string; lateDays: number } | null {
  if (!stats.onTime.hasData) return null;
  const sorted = [...stats.onTime.totals].sort(
    (a, b) => a.lateDays - b.lateDays,
  );
  const winner = sorted[0];
  if (!winner) return null;
  return {
    name: displayCrewName(winner.crewMember),
    lateDays: winner.lateDays,
  };
}

// Top of the dedication leaderboard (by listen count of others' added tracks).
// Returns null when no qualifying plays have been recorded yet.
function dedicationLeader(
  stats: BomptonStatsBundle,
): { name: string; listenCount: number } | null {
  const winner = stats.dedication[0];
  if (!winner || winner.listenCount === 0) return null;
  return {
    name: displayCrewName(winner.crewMember),
    listenCount: winner.listenCount,
  };
}
