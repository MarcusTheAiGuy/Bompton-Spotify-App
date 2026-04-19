import {
  pickImage,
  type SpotifyAlbum,
  type SpotifySavedAlbumItem,
} from "@/lib/spotify";

export function SavedAlbumGrid({ items }: { items: SpotifySavedAlbumItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
        No saved albums.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {items.map((item, index) => (
        <AlbumTile
          key={item.album.id + index}
          album={item.album}
          savedAt={item.added_at}
        />
      ))}
    </ul>
  );
}

function AlbumTile({
  album,
  savedAt,
}: {
  album: SpotifyAlbum;
  savedAt?: string;
}) {
  const image = pickImage(album.images, 200);
  const artists = album.artists.map((a) => a.name).join(", ");
  return (
    <li className="card flex flex-col gap-2">
      <a
        href={album.external_urls.spotify}
        target="_blank"
        rel="noreferrer"
        className="block"
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
        href={album.external_urls.spotify}
        target="_blank"
        rel="noreferrer"
        className="truncate font-bold hover:text-spotify-green"
        title={album.name}
      >
        {album.name}
      </a>
      <p className="truncate text-xs text-spotify-subtext" title={artists}>
        {artists}
      </p>
      <p className="text-[10px] uppercase tracking-widest text-spotify-subtext">
        {album.album_type} · {album.release_date.slice(0, 4)} ·{" "}
        {album.total_tracks} tracks
      </p>
      {savedAt ? (
        <p className="text-[10px] text-spotify-subtext">
          saved{" "}
          {new Date(savedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      ) : null}
    </li>
  );
}
