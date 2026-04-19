import type { SpotifyPlaylist, SpotifyPlaylistTrack } from "@/lib/spotify";
import { pickImage } from "@/lib/spotify";
import type {
  BomptonYear,
  ContributorCount,
  CrewMember,
} from "@/lib/bompton";
import { tallyContributors } from "@/lib/bompton";
import { SpotifyEmbed } from "@/components/spotify/spotify-embed";

export function BomptonColumn({
  year,
  playlist,
  crew,
  tracks,
  isCurrent,
}: {
  year: BomptonYear;
  playlist: SpotifyPlaylist | null;
  crew: CrewMember[];
  tracks: SpotifyPlaylistTrack[] | null;
  isCurrent: boolean;
}) {
  if (!playlist) {
    return (
      <article className="flex flex-col gap-3 rounded-lg border border-spotify-border bg-spotify-elevated/30 p-4">
        <div className="aspect-square w-full rounded bg-spotify-highlight" />
        <h3 className="text-lg font-extrabold tracking-tight">
          Bompton {year}
        </h3>
        <p className="text-xs text-spotify-subtext">
          Couldn't find a playlist named "Bompton {year}" in your Spotify
          library. Make sure the signed-in user follows or owns it and the
          name includes "Bompton" + "{year}".
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
        {isCurrent ? (
          <p className="text-[10px] font-bold uppercase tracking-widest text-spotify-green">
            Current season
          </p>
        ) : null}
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
      />

      <SpotifyEmbed type="playlist" id={playlist.id} height={420} />
    </article>
  );
}

function ContributorPanel({
  perCrew,
  outsiders,
  unattributed,
  hasRealData,
}: {
  perCrew: ContributorCount[];
  outsiders: number;
  unattributed: number;
  hasRealData: boolean;
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
          {unattributed > 0 ? `${unattributed} unattributed` : ""}
        </p>
      ) : (
        <p className="text-[10px] text-spotify-subtext">
          Counts populate once Spotify returns track-level data for this
          app. Extended Quota Mode pending.
        </p>
      )}
    </div>
  );
}
