import { pickImage, type SpotifyArtist } from "@/lib/spotify";

export function ArtistGrid({ artists }: { artists: SpotifyArtist[] }) {
  if (artists.length === 0) {
    return (
      <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
        No artists to show.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {artists.map((artist, index) => (
        <ArtistCard key={artist.id} artist={artist} rank={index + 1} />
      ))}
    </ul>
  );
}

function ArtistCard({ artist, rank }: { artist: SpotifyArtist; rank: number }) {
  const image = pickImage(artist.images, 200);
  const genres = artist.genres ?? [];
  const followers = artist.followers?.total ?? 0;
  return (
    <li className="card flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-spotify-subtext">
        <span className="font-mono">#{rank}</span>
        <span className="font-mono">pop {artist.popularity ?? 0}</span>
      </div>
      <a
        href={artist.external_urls?.spotify ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="group block"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            className="aspect-square w-full rounded-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="aspect-square w-full rounded-full bg-spotify-highlight" />
        )}
      </a>
      <a
        href={artist.external_urls?.spotify ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="truncate text-center font-bold hover:text-spotify-green"
        title={artist.name}
      >
        {artist.name}
      </a>
      <p className="text-center text-xs text-spotify-subtext">
        {followers.toLocaleString()} followers
      </p>
      {genres.length > 0 ? (
        <ul className="flex flex-wrap justify-center gap-1">
          {genres.slice(0, 3).map((genre) => (
            <li
              key={genre}
              className="rounded-full bg-spotify-highlight px-2 py-0.5 text-[10px] uppercase tracking-wide text-spotify-subtext"
            >
              {genre}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
