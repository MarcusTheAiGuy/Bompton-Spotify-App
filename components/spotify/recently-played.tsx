import {
  formatDuration,
  pickImage,
  type SpotifyRecentlyPlayedItem,
} from "@/lib/spotify";

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function RecentlyPlayed({ items }: { items: SpotifyRecentlyPlayedItem[] }) {
  const playable = items.filter((i) => i.track && i.track.album);
  if (playable.length === 0) {
    return (
      <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
        No recent plays reported by Spotify.
      </p>
    );
  }
  return (
    <ol className="flex flex-col">
      {playable.map((item, index) => {
        const track = item.track;
        const image = pickImage(track.album?.images, 64);
        const artists = (track.artists ?? []).map((a) => a.name).join(", ");
        return (
          <li
            key={`${track.id}-${item.played_at}-${index}`}
            className="flex items-center gap-3 border-b border-spotify-border/50 py-2 last:border-b-0"
          >
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt=""
                className="h-10 w-10 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded bg-spotify-highlight" />
            )}
            <div className="min-w-0 flex-1">
              <a
                href={track.external_urls?.spotify ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="block truncate font-semibold hover:text-spotify-green"
              >
                {track.name ?? "(unknown track)"}
              </a>
              <p className="truncate text-xs text-spotify-subtext">
                {artists || "Unknown artist"}
                <span className="mx-1 text-spotify-border">·</span>
                {track.album?.name ?? ""}
              </p>
            </div>
            <span
              className="shrink-0 font-mono text-xs text-spotify-subtext"
              title={new Date(item.played_at).toLocaleString()}
            >
              {timeAgo(item.played_at)}
            </span>
            <span className="hidden w-14 shrink-0 text-right font-mono text-xs text-spotify-subtext sm:inline">
              {formatDuration(track.duration_ms ?? 0)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
