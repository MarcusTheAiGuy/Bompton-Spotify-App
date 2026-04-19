export default function BomptonPlaylistPage() {
  return (
    <section className="flex flex-col items-center gap-6 py-20 text-center">
      <span className="rounded-full bg-spotify-highlight px-4 py-1 text-xs font-semibold uppercase tracking-widest text-spotify-green">
        Coming soon
      </span>
      <h1 className="text-5xl font-extrabold tracking-tight">Bompton Playlist</h1>
      <p className="max-w-lg text-lg text-spotify-subtext">
        This is where the crew&apos;s shared playlist will live. We&apos;ll wire
        this up once we decide how we want it to work — embed, collaborative
        queue, or something weirder.
      </p>
      <div className="card mt-6 w-full max-w-md">
        <p className="text-sm text-spotify-subtext">
          Ideas are welcome. For now, the page is here so the nav stays honest.
        </p>
      </div>
    </section>
  );
}
