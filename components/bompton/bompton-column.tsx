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
  diagnostic,
}: {
  year: BomptonYear;
  playlist: SpotifyPlaylist | null;
  crew: CrewMember[];
  tracks: SpotifyPlaylistTrack[] | null;
  isCurrent: boolean;
  diagnostic?: BomptonColumnDiagnostic;
}) {
  if (!playlist) {
    return (
      <article className="flex flex-col gap-3 rounded-lg border border-spotify-border bg-spotify-elevated/30 p-4">
        <div className="aspect-square w-full rounded bg-spotify-highlight" />
        <h3 className="text-lg font-extrabold tracking-tight">
          Bompton {year}
        </h3>
        <p className="text-xs text-spotify-subtext">
          Couldn't find a Bompton playlist for {year} in the signed-in user's
          library. The matcher accepts any of these name suffixes:{" "}
          <code className="font-mono">{year}</code>,{" "}
          <code className="font-mono">{shortYear(year)}</code>, plus the same
          with a slash instead of a hyphen — as long as the name also
          contains "Bompton". Make sure the signed-in user owns or follows
          (or is a collaborator on) the playlist.
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
      />

      {diagnostic ? <DiagnosticPanel data={diagnostic} /> : null}

      <SpotifyEmbed
        type="playlist"
        id={playlist.id}
        height={embedHeightForTrackCount(playlist.tracks?.total ?? 0)}
      />
    </article>
  );
}

export type BomptonColumnDiagnostic = {
  playlistId: string;
  public: boolean | null;
  collaborative: boolean;
  owner: { id: string; display_name: string | null } | null;
  totalTracks: number;
  itemsReturned: number;
  itemsWithTrack: number;
  fetchSource: "tracks" | "playlist" | "failed";
  fetchError?: { title: string; detail: string };
};

function DiagnosticPanel({ data }: { data: BomptonColumnDiagnostic }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
      <p className="font-bold uppercase tracking-widest">API diagnostic</p>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[11px]">
        <dt className="text-amber-300/70">collaborative</dt>
        <dd>{String(data.collaborative)}</dd>
        <dt className="text-amber-300/70">public</dt>
        <dd>{data.public === null ? "null" : String(data.public)}</dd>
        <dt className="text-amber-300/70">owner.id</dt>
        <dd className="truncate" title={data.owner?.id ?? "—"}>
          {data.owner?.id ?? "—"}
        </dd>
        <dt className="text-amber-300/70">tracks.total</dt>
        <dd>{data.totalTracks}</dd>
        <dt className="text-amber-300/70">items returned</dt>
        <dd>{data.itemsReturned}</dd>
        <dt className="text-amber-300/70">items with track</dt>
        <dd>{data.itemsWithTrack}</dd>
        <dt className="text-amber-300/70">fetch source</dt>
        <dd>{data.fetchSource}</dd>
      </dl>
      {data.fetchError ? (
        <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-amber-300/80">
          {data.fetchError.title}: {data.fetchError.detail}
        </p>
      ) : null}
    </div>
  );
}

// Spotify's embed renders ~56px per track row on top of a ~152px
// header (cover + playback controls). Compute a height that fits the
// whole playlist with a generous minimum for very short lists.
function embedHeightForTrackCount(trackCount: number): number {
  const base = 160;
  const perRow = 56;
  const min = 480;
  return Math.max(min, base + trackCount * perRow);
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
