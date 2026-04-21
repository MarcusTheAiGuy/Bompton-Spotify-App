import type { SpotifyPlaylist, SpotifyPlaylistTrack } from "@/lib/spotify";
import { pickImage } from "@/lib/spotify";
import type {
  BomptonYear,
  ContributorCount,
  CrewMember,
} from "@/lib/bompton";
import { tallyContributors } from "@/lib/bompton";
import { SpotifyEmbed } from "@/components/spotify/spotify-embed";

function shortYear(year: BomptonYear): string {
  const [start, end] = year.split("-");
  return `${start}-${end.slice(-2)}`;
}

export function BomptonColumn({
  year,
  playlist,
  crew,
  tracks,
  isCurrent,
  lastSyncAt,
}: {
  year: BomptonYear;
  playlist: SpotifyPlaylist | null;
  crew: CrewMember[];
  tracks: SpotifyPlaylistTrack[] | null;
  isCurrent: boolean;
  lastSyncAt: Date | null;
}) {
  if (!playlist) {
    return (
      <article className="flex flex-col gap-3 rounded-lg border border-spotify-border bg-spotify-elevated/30 p-4">
        <div className="aspect-square w-full rounded bg-spotify-highlight" />
        <h3 className="text-lg font-extrabold tracking-tight">
          Bompton {year}
        </h3>
        <p className="text-xs text-spotify-subtext">
          The extension hasn't synced a playlist for {year} yet. Either
          no Bompton {year} playlist exists in the syncing user's library, or
          the extension hasn't run. Visit{" "}
          <a href="/extension-setup" className="font-semibold text-spotify-green hover:underline">
            /extension-setup
          </a>
          , click Sync now, and reload. The matcher accepts any of these name
          suffixes: <code className="font-mono">{year}</code>,{" "}
          <code className="font-mono">{shortYear(year)}</code>, plus the same
          with a slash instead of a hyphen, as long as the name also
          contains "Bompton".
        </p>
      </article>
    );
  }

  const cover = pickImage(playlist.images, 300);
  const hasRealTracks = Array.isArray(tracks) && tracks.length > 0;
  const { perCrew, outsiders, unattributed } = hasRealTracks
    ? tallyContributors(tracks, crew)
    : { perCrew: crew.map((m) => ({ crewMember: m, count: 0 })), outsiders: 0, unattributed: 0 };

  return (
    <article
      className={
        "flex flex-col gap-3 rounded-lg border p-4 " +
        (isCurrent
          ? "border-spotify-green/60 bg-spotify-elevated/60"
          : "border-spotify-border bg-spotify-elevated/30")
      }
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover}
          alt=""
          className="aspect-square w-full rounded object-cover"
        />
      ) : (
        <div className="aspect-square w-full rounded bg-spotify-highlight" />
      )}
      <div>
        <p
          className={
            "text-[10px] font-bold uppercase tracking-widest " +
            (isCurrent ? "text-spotify-green" : "text-spotify-subtext/60")
          }
        >
          {isCurrent ? "Current season" : "Past season"}
        </p>
        <h3 className="text-lg font-extrabold tracking-tight">
          {playlist.name}
        </h3>
        <p className="text-xs text-spotify-subtext">
          {playlist.tracks?.total ?? 0} songs
          {playlist.owner?.display_name
            ? ` · owned by ${playlist.owner.display_name}`
            : ""}
        </p>
      </div>

      <ContributorPanel
        perCrew={perCrew}
        outsiders={outsiders}
        unattributed={unattributed}
        hasRealData={hasRealTracks}
        lastSyncAt={lastSyncAt}
      />

      <SpotifyEmbed
        type="playlist"
        id={playlist.id}
        height={embedHeightForTrackCount(playlist.tracks?.total ?? 0)}
        note="Spotify's embedded player caps at 100 tracks. Open in Spotify to see the rest of the playlist."
      />
    </article>
  );
}

// Spotify's embed renders ~56px per track row on top of a ~160px
// header, and caps the visible list at 100 tracks regardless of
// iframe height. Size to exactly 100 rows' worth so we don't leave
// blank space below the last row on the bigger playlists.
function embedHeightForTrackCount(_trackCount: number): number {
  const base = 160;
  const perRow = 56;
  return base + 100 * perRow;
}

function ContributorPanel({
  perCrew,
  outsiders,
  unattributed,
  hasRealData,
  lastSyncAt,
}: {
  perCrew: ContributorCount[];
  outsiders: number;
  unattributed: number;
  hasRealData: boolean;
  lastSyncAt: Date | null;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-spotify-base/50 p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
        Contributions by crew member
      </p>
      <ul className="flex flex-col gap-2">
        {perCrew.map(({ crewMember, count }) => {
          const label = crewMember.name ?? crewMember.email ?? "Unknown";
          return (
            <li
              key={crewMember.id}
              className="flex items-center gap-2 text-sm"
            >
              {crewMember.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={crewMember.image}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-spotify-highlight text-[10px] font-bold">
                  {label.slice(0, 1).toUpperCase()}
                </div>
              )}
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="font-mono text-xs text-spotify-subtext">
                {hasRealData ? count : "—"}
              </span>
            </li>
          );
        })}
      </ul>
      {hasRealData ? (
        <p className="text-[10px] text-spotify-subtext">
          {outsiders > 0 ? `${outsiders} from non-crew · ` : ""}
          {unattributed > 0 ? `${unattributed} unattributed · ` : ""}
          {lastSyncAt
            ? `synced ${lastSyncAt.toLocaleString()}`
            : "never synced"}
        </p>
      ) : (
        <p className="text-[10px] text-spotify-subtext">
          Counts populate once the sync extension has pushed track data for
          this season.{" "}
          <a href="/extension-setup" className="font-semibold text-spotify-green hover:underline">
            /extension-setup
          </a>
        </p>
      )}
    </div>
  );
}
