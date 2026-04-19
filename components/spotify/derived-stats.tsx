import type { SpotifyArtist, SpotifyTrack } from "@/lib/spotify";
import { formatLongDuration } from "@/lib/spotify";

export function GenreDistribution({
  artists,
}: {
  artists: SpotifyArtist[];
}) {
  const counts = new Map<string, number>();
  for (const artist of artists) {
    for (const genre of artist.genres ?? []) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return (
      <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
        Spotify didn't attach any genres to the top artists.
      </p>
    );
  }

  const max = entries[0][1];

  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {entries.slice(0, 30).map(([genre, count]) => (
        <li key={genre} className="card flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="truncate font-semibold" title={genre}>
              {genre}
            </span>
            <span className="font-mono text-xs text-spotify-subtext">
              {count}×
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-spotify-border">
            <div
              className="h-full bg-spotify-green"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReleaseDecadeDistribution({
  tracks,
}: {
  tracks: SpotifyTrack[];
}) {
  const counts = new Map<number, number>();
  for (const track of tracks) {
    const releaseDate = track.album?.release_date;
    if (!releaseDate) continue;
    const year = parseInt(releaseDate.slice(0, 4), 10);
    if (Number.isNaN(year)) continue;
    const decade = Math.floor(year / 10) * 10;
    counts.set(decade, (counts.get(decade) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);

  if (entries.length === 0) {
    return (
      <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
        Not enough release-date info to chart.
      </p>
    );
  }

  const max = Math.max(...entries.map(([, c]) => c));

  return (
    <div className="card">
      <ul className="flex items-end gap-2">
        {entries.map(([decade, count]) => (
          <li
            key={decade}
            className="flex flex-1 flex-col items-center gap-1"
          >
            <span className="font-mono text-xs text-spotify-subtext">
              {count}
            </span>
            <div
              className="w-full rounded bg-spotify-green"
              style={{ height: `${(count / max) * 120 + 8}px` }}
              aria-label={`${count} tracks from the ${decade}s`}
            />
            <span className="text-xs font-semibold">{`${decade}s`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OverlapStats({
  savedTopTrackCount,
  totalTopTracks,
  followedTopArtistCount,
  totalTopArtists,
}: {
  savedTopTrackCount: number | null;
  totalTopTracks: number;
  followedTopArtistCount: number | null;
  totalTopArtists: number;
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <li className="card">
        <p className="text-xs uppercase tracking-widest text-spotify-subtext">
          Top tracks you've saved
        </p>
        <p className="mt-1 text-xl font-bold tracking-tight">
          {savedTopTrackCount == null
            ? "—"
            : `${savedTopTrackCount} / ${totalTopTracks}`}
          {savedTopTrackCount != null && totalTopTracks > 0 ? (
            <span className="ml-2 text-sm text-spotify-subtext">
              (
              {Math.round((savedTopTrackCount / totalTopTracks) * 100)}
              %)
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-xs text-spotify-subtext">
          Of the medium-term top-tracks list, how many are in your saved
          library (<code className="font-mono">/me/tracks/contains</code>).
        </p>
      </li>
      <li className="card">
        <p className="text-xs uppercase tracking-widest text-spotify-subtext">
          Top artists you follow
        </p>
        <p className="mt-1 text-xl font-bold tracking-tight">
          {followedTopArtistCount == null
            ? "—"
            : `${followedTopArtistCount} / ${totalTopArtists}`}
          {followedTopArtistCount != null && totalTopArtists > 0 ? (
            <span className="ml-2 text-sm text-spotify-subtext">
              (
              {Math.round((followedTopArtistCount / totalTopArtists) * 100)}
              %)
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-xs text-spotify-subtext">
          Of the medium-term top-artists list, how many you actually follow
          (<code className="font-mono">/me/following/contains?type=artist</code>).
        </p>
      </li>
    </ul>
  );
}

export function PopularityStats({
  tracks,
  artists,
}: {
  tracks: SpotifyTrack[];
  artists: SpotifyArtist[];
}) {
  const avgTrack =
    tracks.length > 0
      ? tracks.reduce((sum, t) => sum + (t.popularity ?? 0), 0) / tracks.length
      : 0;
  const avgArtist =
    artists.length > 0
      ? artists.reduce((sum, a) => sum + (a.popularity ?? 0), 0) /
        artists.length
      : 0;
  const totalFollowers = artists.reduce(
    (sum, a) => sum + (a.followers?.total ?? 0),
    0,
  );
  const totalMs = tracks.reduce((sum, t) => sum + (t.duration_ms ?? 0), 0);

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile
        label="Avg track popularity"
        value={avgTrack.toFixed(1)}
        suffix="/ 100"
      />
      <StatTile
        label="Avg artist popularity"
        value={avgArtist.toFixed(1)}
        suffix="/ 100"
      />
      <StatTile
        label="Top artists' followers"
        value={totalFollowers.toLocaleString()}
      />
      <StatTile
        label="Top tracks, total runtime"
        value={formatLongDuration(totalMs)}
      />
    </ul>
  );
}

function StatTile({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <li className="card">
      <p className="text-xs uppercase tracking-widest text-spotify-subtext">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold tracking-tight">
        {value}
        {suffix ? (
          <span className="ml-1 text-sm text-spotify-subtext">{suffix}</span>
        ) : null}
      </p>
    </li>
  );
}

