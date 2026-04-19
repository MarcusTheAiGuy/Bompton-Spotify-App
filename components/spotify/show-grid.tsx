import {
  pickImage,
  type SpotifySavedEpisodeItem,
  type SpotifySavedShowItem,
  type SpotifySavedAudiobookItem,
} from "@/lib/spotify";

export function ShowGrid({ items }: { items: SpotifySavedShowItem[] }) {
  const valid = items.filter((i) => i.show);
  if (valid.length === 0) {
    return <Empty message="No saved podcasts." />;
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {valid.map((item, index) => {
        const show = item.show;
        const image = pickImage(show.images, 200);
        const url = show.external_urls?.spotify ?? "#";
        return (
          <li key={show.id + index} className="card flex flex-col gap-2">
            <a href={url} target="_blank" rel="noreferrer">
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
              href={url}
              target="_blank"
              rel="noreferrer"
              className="truncate font-bold hover:text-spotify-green"
              title={show.name}
            >
              {show.name}
            </a>
            <p className="truncate text-xs text-spotify-subtext">
              {show.publisher ?? ""}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-spotify-subtext">
              {show.total_episodes ?? 0} episodes
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function EpisodeList({ items }: { items: SpotifySavedEpisodeItem[] }) {
  const valid = items.filter((i) => i.episode);
  if (valid.length === 0) {
    return <Empty message="No saved podcast episodes." />;
  }
  return (
    <ul className="flex flex-col">
      {valid.map((item, index) => {
        const episode = item.episode;
        const image = pickImage(episode.images, 64);
        const url = episode.external_urls?.spotify ?? "#";
        return (
          <li
            key={episode.id + index}
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
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block truncate font-semibold hover:text-spotify-green"
              >
                {episode.name ?? "(unknown episode)"}
              </a>
              <p className="truncate text-xs text-spotify-subtext">
                {episode.show?.name ?? "Episode"}
                <span className="mx-1 text-spotify-border">·</span>
                {episode.release_date ?? ""}
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
  const valid = items.filter((i) => i.audiobook);
  if (valid.length === 0) {
    return <Empty message="No saved audiobooks." />;
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {valid.map((item, index) => {
        const book = item.audiobook;
        const image = pickImage(book.images, 200);
        const authors = (book.authors ?? []).map((a) => a.name).join(", ");
        const url = book.external_urls?.spotify ?? "#";
        return (
          <li key={book.id + index} className="card flex flex-col gap-2">
            <a href={url} target="_blank" rel="noreferrer">
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
              href={url}
              target="_blank"
              rel="noreferrer"
              className="truncate font-bold hover:text-spotify-green"
              title={book.name}
            >
              {book.name}
            </a>
            <p className="truncate text-xs text-spotify-subtext" title={authors}>
              {authors}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-spotify-subtext">
              {book.total_chapters ?? 0} chapters
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
