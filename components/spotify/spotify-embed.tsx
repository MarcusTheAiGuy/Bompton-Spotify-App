export type SpotifyEmbedType =
  | "playlist"
  | "track"
  | "album"
  | "artist"
  | "episode"
  | "show";

export function SpotifyEmbed({
  type,
  id,
  height = 380,
  compact = false,
  note,
}: {
  type: SpotifyEmbedType;
  id: string;
  height?: number;
  compact?: boolean;
  note?: string;
}) {
  const src = `https://open.spotify.com/embed/${type}/${id}?utm_source=generator&theme=0`;
  return (
    <div className="flex flex-col gap-2">
      <iframe
        src={src}
        width="100%"
        height={compact ? 152 : height}
        loading="lazy"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        className="rounded-lg"
        title={`Spotify ${type} embed`}
      />
      {note ? (
        <p className="text-xs text-spotify-subtext">{note}</p>
      ) : null}
    </div>
  );
}
