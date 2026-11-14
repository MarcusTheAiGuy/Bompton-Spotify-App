// Shown the moment someone clicks "Bompton Playlist" in the nav. The page
// is force-dynamic and does a Spotify call, DB reads, Last.fm genre
// lookups and the stats crunch before it can render. Without this
// boundary, a client navigation shows nothing at all until that finishes,
// so the nav link looked like it did nothing.
export default function BomptonPlaylistLoading() {
  return (
    <section className="flex flex-col gap-10 py-6" aria-busy="true">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-spotify-subtext">
          The Bompton Playlist
        </p>
        <h1 className="animate-pulse text-4xl font-extrabold tracking-tight">
          Loading the four seasons…
        </h1>
        <p className="max-w-3xl text-sm text-spotify-subtext">
          Pulling the playlists, the leaderboard and the stats. This can take
          a few seconds when the genre cache is cold.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-64 animate-pulse rounded-lg border border-spotify-border bg-spotify-highlight/40"
          />
        ))}
      </div>
    </section>
  );
}
