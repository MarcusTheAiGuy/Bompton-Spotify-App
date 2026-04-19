import {
  formatDuration,
  pickImage,
  type SpotifyTrack,
} from "@/lib/spotify";

export function TrackList({ tracks }: { tracks: SpotifyTrack[] }) {
  const playable = tracks.filter((t) => t && t.album);
  if (playable.length === 0) {
    return <EmptyState message="No tracks to show." />;
  }
  return (
    <ol className="flex flex-col">
      {playable.map((track, index) => (
        <TrackRow key={track.id + index} track={track} rank={index + 1} />
      ))}
    </ol>
  );
}

function TrackRow({ track, rank }: { track: SpotifyTrack; rank: number }) {
  const image = pickImage(track.album?.images, 64);
  const artistNames = (track.artists ?? []).map((a) => a.name).join(", ");

  return (
    <li className="flex items-center gap-3 border-b border-spotify-border/50 py-2 last:border-b-0">
      <span className="w-8 text-right font-mono text-xs text-spotify-subtext">
        {rank}
      </span>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          className="h-12 w-12 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded bg-spotify-highlight" />
      )}
      <div className="min-w-0 flex-1">
        <a
          href={track.external_urls?.spotify ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="block truncate font-semibold hover:text-spotify-green"
          title={track.name}
        >
          {track.name ?? "(unknown track)"}
          {track.explicit ? (
            <span className="ml-2 rounded bg-spotify-highlight px-1 text-[10px] uppercase text-spotify-subtext">
              E
            </span>
          ) : null}
        </a>
        <p
          className="truncate text-sm text-spotify-subtext"
          title={`${artistNames} · ${track.album?.name ?? ""}`}
        >
          {artistNames || "Unknown artist"}
          <span className="mx-1 text-spotify-border">·</span>
          {track.album?.name ?? ""}
        </p>
      </div>
      <span className="hidden w-16 text-right font-mono text-xs text-spotify-subtext sm:inline">
        pop {track.popularity ?? 0}
      </span>
      <span className="w-14 text-right font-mono text-xs text-spotify-subtext">
        {formatDuration(track.duration_ms ?? 0)}
      </span>
    </li>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
      {message}
    </p>
  );
}
