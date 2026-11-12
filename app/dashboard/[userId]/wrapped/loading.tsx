// Shown while the guess is put together: the archive reads plus up to six
// calls to Spotify can take a few seconds.
export default function WrappedLoading() {
  return (
    <section className="-mt-6">
      <div className="mx-auto flex h-[calc(100dvh-8rem)] max-h-[760px] min-h-[540px] w-full max-w-[420px] flex-col justify-center gap-4 overflow-hidden rounded-3xl bg-[#1ED760] px-7 text-black shadow-card">
        <p className="text-sm font-bold uppercase tracking-[0.2em]">
          Bompton guesses
        </p>
        <p className="animate-pulse text-5xl font-black leading-[0.95] tracking-tighter">
          Putting the Wrapped together…
        </p>
      </div>
    </section>
  );
}
