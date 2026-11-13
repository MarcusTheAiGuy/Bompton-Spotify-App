import { StoryFrame } from "@/components/wrapped/wrapped-story";

// Shown while the guess is put together: the archive reads plus up to six
// calls to Spotify can take a few seconds.
export default function WrappedLoading() {
  return (
    <section className="-mt-6">
      <StoryFrame className="flex flex-col justify-center gap-4 bg-[#1ED760] px-7 text-black">
        <p className="text-sm font-bold uppercase tracking-[0.2em]">
          Bompton guesses
        </p>
        <p className="animate-pulse text-5xl font-black leading-[0.95] tracking-tighter">
          Putting the Wrapped together…
        </p>
      </StoryFrame>
    </section>
  );
}
