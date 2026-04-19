import {
  pickImage,
  type SpotifySavedEpisodeItem,
  type SpotifySavedShowItem,
  type SpotifySavedAudiobookItem,
} from "@/lib/spotify";

export function ShowGrid({ items }: { items: SpotifySavedShowItem[] }) {
  if (items.length === 0) {
    return <Empty message="No saved podcasts." />;
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {items.map((item, index) => {
        const image = pickImage(item.show.images, 200);
        return (
          <li key={item.show.id + index} className="card flex flex-col gap-2">
            <a
              href={item.show.external_urls.spotify}
              target="_blank"
              rel="noreferrer"
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt=""
                  className="aspect-square w-full rounded object-cover"
                />
              ) : (
                <div className="aspect-square w-full rounded bg-spotify-highlight" />
              )}
            </a>
            <a
              href={item.show.external_urls.spotify}
              target="_blank"
              rel="noreferrer"
              className="truncate font-bold hover:text-spotify-green"
              title={item.show.name}
            >
              {item.show.name}
            </a>
            <p className="truncate text-xs text-spotify-subtext">
              {item.show.publisher}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-spotify-subtext">
              {item.show.total_episodes} episodes
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function EpisodeList({ items }: { items: SpotifySavedEpisodeItem[] }) {
  if (items.length === 0) {
    return <Empty message="No saved podcast episodes." />;
  }
  return (
    <ul className="flex flex-col">
      {items.map((item, index) => {
        const image = pickImage(item.episode.images, 64);
        return (
          <li
            key={item.episode.id + index}
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
                href={item.episode.external_urls.spotify}
                target="_blank"
                rel="noreferrer"
                className="block truncate font-semibold hover:text-spotify-green"
              >
                {item.episode.name}
              </a>
              <p className="truncate text-xs text-spotify-subtext">
                {item.episode.show?.name ?? "Episode"}
                <span className="mx-1 text-spotify-border">·</span>
                {item.episode.release_date}
              </p>
            </div>
            <span className="shrink-0 font-mono text-xs text-spotify-subtext">
              saved{" "}
              {new Date(item.added_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function AudiobookGrid({
  items,
}: {
  items: SpotifySavedAudiobookItem[];
}) {
  if (items.length === 0) {
    return <Empty message="No saved audiobooks." />;
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {items.map((item, index) => {
        const image = pickImage(item.audiobook.images, 200);
        const authors = item.audiobook.authors.map((a) => a.name).join(", ");
        return (
          <li
            key={item.audiobook.id + index}
            className="card flex flex-col gap-2"
          >
            <a
              href={item.audiobook.external_urls.spotify}
              target="_blank"
              rel="noreferrer"
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt=""
                  className="aspect-square w-full rounded object-cover"
                />
              ) : (
                <div className="aspect-square w-full rounded bg-spotify-highlight" />
              )}
            </a>
            <a
              href={item.audiobook.external_urls.spotify}
              target="_blank"
              rel="noreferrer"
              className="truncate font-bold hover:text-spotify-green"
              title={item.audiobook.name}
            >
              {item.audiobook.name}
            </a>
            <p className="truncate text-xs text-spotify-subtext" title={authors}>
              {authors}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-spotify-subtext">
              {item.audiobook.total_chapters} chapters
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
      {message}
    </p>
  );
}
