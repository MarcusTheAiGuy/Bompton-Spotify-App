import {
  formatDuration,
  pickImage,
  type SpotifyQueueItem,
} from "@/lib/spotify";

export function QueueList({ items }: { items: SpotifyQueueItem[] }) {
  const valid = items.filter((i) => i);
  if (valid.length === 0) {
    return (
      <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
        Queue is empty. Start playing something in Spotify and what's next will
        show up here.
      </p>
    );
  }
  return (
    <ol className="flex flex-col">
      {valid.map((item, index) => (
        <QueueRow
          key={`${item.id}-${index}`}
          item={item}
          position={index + 1}
        />
      ))}
    </ol>
  );
}

function QueueRow({
  item,
  position,
}: {
  item: SpotifyQueueItem;
  position: number;
}) {
  const isTrack = "album" in item;
  const image = isTrack
    ? pickImage(item.album?.images, 64)
    : pickImage(item.images, 64);
  const subtitle = isTrack
    ? (item.artists ?? []).map((a) => a.name).join(", ")
    : item.show?.name ?? "Episode";
  const contextLabel = isTrack ? item.album?.name ?? "" : item.show?.publisher ?? "";
  const url = item.external_urls?.spotify ?? "#";
  return (
    <li className="flex items-center gap-3 border-b border-spotify-border/50 py-2 last:border-b-0">
      <span className="w-8 text-right font-mono text-xs text-spotify-subtext">
        {position}
      </span>
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
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block truncate font-semibold hover:text-spotify-green"
          title={item.name}
        >
          {item.name ?? "(unknown)"}
        </a>
        <p className="truncate text-xs text-spotify-subtext">
          {subtitle || "Unknown"}
          {contextLabel ? (
            <>
              <span className="mx-1 text-spotify-border">·</span>
              {contextLabel}
            </>
          ) : null}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-spotify-highlight px-2 py-0.5 text-[10px] uppercase tracking-wider text-spotify-subtext">
        {isTrack ? "track" : "episode"}
      </span>
      <span className="hidden w-14 shrink-0 text-right font-mono text-xs text-spotify-subtext sm:inline">
        {formatDuration(item.duration_ms ?? 0)}
      </span>
    </li>
  );
}
