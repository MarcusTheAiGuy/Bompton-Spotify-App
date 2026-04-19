import { pickImage, type SpotifyPlaylist } from "@/lib/spotify";

export function PlaylistGrid({ playlists }: { playlists: SpotifyPlaylist[] }) {
  const valid = playlists.filter((p) => p);
  if (valid.length === 0) {
    return (
      <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
        No playlists.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {valid.map((playlist) => {
        const image = pickImage(playlist.images, 200);
        const url = playlist.external_urls?.spotify ?? "#";
        const ownerLabel =
          playlist.owner?.display_name ?? playlist.owner?.id ?? "Unknown";
        return (
          <li key={playlist.id} className="card flex flex-col gap-2">
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
              title={playlist.name}
            >
              {playlist.name}
            </a>
            <p className="truncate text-xs text-spotify-subtext">
              by {ownerLabel}
            </p>
            <p className="text-[10px] uppercase tracking-widest text-spotify-subtext">
              {playlist.tracks?.total ?? 0} tracks
              {playlist.collaborative ? " · collab" : ""}
              {playlist.public === true ? " · public" : ""}
              {playlist.public === false ? " · private" : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
