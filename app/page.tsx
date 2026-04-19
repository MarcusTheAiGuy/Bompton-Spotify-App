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

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "That Spotify account isn't on the Bompton allowlist. Ask the crew to add your email.",
  Configuration:
    "Auth is misconfigured on the server. Check that SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, NEXTAUTH_SECRET, and DATABASE_URL are all set.",
  OAuthSignin:
    "Couldn't start the Spotify sign-in. Usually a missing client ID/secret.",
  OAuthCallback:
    "Spotify rejected the callback. Most often the redirect URI for this domain isn't registered in the Spotify dashboard.",
  OAuthCreateAccount:
    "Couldn't save your account. The database is probably unreachable or the schema hasn't been pushed (`npm run db:push`).",
  OAuthAccountNotLinked:
    "This email is already linked to a different sign-in. Use the original Spotify account.",
  Callback:
    "The OAuth callback failed. Check the server logs for details.",
  SessionRequired:
    "You need to be signed in to view that page.",
};

function AuthErrorBanner({ error }: { error: string }) {
  const message =
    ERROR_MESSAGES[error] ??
    "Something went wrong signing you in. Try again, or ping the crew if it keeps happening.";

  return (
    <div
      role="alert"
      className="w-full max-w-md rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-left text-sm text-red-200"
    >
      <p>{message}</p>
      <p className="mt-2 text-xs text-red-300/80">
        Error code: <code className="font-mono">{error}</code>
      </p>
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
