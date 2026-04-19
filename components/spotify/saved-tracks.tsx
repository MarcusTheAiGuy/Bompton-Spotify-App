import {
  formatDuration,
  pickImage,
  type SpotifySavedTrackItem,
} from "@/lib/spotify";

export function SavedTracks({ items }: { items: SpotifySavedTrackItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
        No saved tracks.
      </p>
    );
  }
  return (
    <ol className="flex flex-col">
      {items.map((item, index) => {
        const image = pickImage(item.track.album.images, 64);
        const artists = item.track.artists.map((a) => a.name).join(", ");
        return (
          <li
            key={item.track.id + index}
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
                href={item.track.external_urls.spotify}
                target="_blank"
                rel="noreferrer"
                className="block truncate font-semibold hover:text-spotify-green"
              >
                {item.track.name}
              </a>
              <p className="truncate text-xs text-spotify-subtext">
                {artists}
                <span className="mx-1 text-spotify-border">·</span>
                {item.track.album.name}
              </p>
            </div>
            <span
              className="shrink-0 font-mono text-xs text-spotify-subtext"
              title={new Date(item.added_at).toLocaleString()}
            >
              saved {new Date(item.added_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <span className="hidden w-14 shrink-0 text-right font-mono text-xs text-spotify-subtext sm:inline">
              {formatDuration(item.track.duration_ms)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
