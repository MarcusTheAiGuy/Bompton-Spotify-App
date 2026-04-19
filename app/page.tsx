import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ConnectButton } from "@/components/connect-button";

type SearchParams = Promise<{ error?: string }>;

export default async function LandingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const { error } = await searchParams;

  return (
    <section className="flex flex-col items-center gap-10 py-20 text-center">
      <div className="flex flex-col items-center gap-4">
        <span className="rounded-full bg-spotify-highlight px-4 py-1 text-xs font-semibold uppercase tracking-widest text-spotify-green">
          Bompton crew · members only
        </span>
        <h1 className="text-5xl font-extrabold tracking-tight sm:text-6xl">
          What&apos;s <span className="text-spotify-green">everyone</span> listening to?
        </h1>
        <p className="max-w-xl text-lg text-spotify-subtext">
          Connect your Spotify and see what the Bompton crew is spinning — top
          tracks, top artists, recently played, and the Bompton Playlist.
        </p>
      </div>

      {error ? <AuthErrorBanner error={error} /> : null}

      <div className="flex flex-col items-center gap-3">
        <ConnectButton />
        <p className="text-xs text-spotify-subtext">
          Sign-in is limited to the crew&apos;s email allowlist.
        </p>
      </div>

      <div className="mt-8 grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-3">
        <FeatureCard
          title="Your dashboard"
          body="See your top tracks, artists, and what's spinning right now."
        />
        <FeatureCard
          title="Friends"
          body="Peek at what everyone else in the crew is listening to."
        />
        <FeatureCard
          title={
            <Link href="/bompton-playlist" className="hover:text-spotify-green">
              Bompton Playlist →
            </Link>
          }
          body="The shared playlist. Coming soon."
        />
      </div>
    </section>
  );
}

function AuthErrorBanner({ error }: { error: string }) {
  const message =
    error === "AccessDenied"
      ? "That Spotify account isn't on the Bompton allowlist. Ask the crew to add your email."
      : "Something went wrong signing you in. Try again, or ping the crew if it keeps happening.";

  return (
    <div
      role="alert"
      className="w-full max-w-md rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
    >
      {message}
    </div>
  );
}

function FeatureCard({ title, body }: { title: React.ReactNode; body: string }) {
  return (
    <div className="card">
      <h3 className="mb-2 text-lg font-bold">{title}</h3>
      <p className="text-sm text-spotify-subtext">{body}</p>
    </div>
  );
}
