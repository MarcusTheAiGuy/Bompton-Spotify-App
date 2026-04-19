import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const { name, email, image } = session.user;

  return (
    <section className="flex flex-col gap-10 py-10">
      <header className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt=""
              className="h-14 w-14 rounded-full border border-spotify-border"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-spotify-highlight text-lg font-bold">
              {(name ?? email ?? "?").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-widest text-spotify-subtext">
              Signed in
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight">
              {name ?? email}
            </h1>
            {email && name ? (
              <p className="text-sm text-spotify-subtext">{email}</p>
            ) : null}
          </div>
        </div>
        <SignOutButton />
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PlaceholderCard
          title="Top tracks"
          body="Your most-played tracks land here once we wire up the Spotify API."
        />
        <PlaceholderCard
          title="Top artists"
          body="A leaderboard of who you can't stop listening to."
        />
        <PlaceholderCard
          title="Recently played"
          body="The last things spinning in your ears."
        />
      </div>

      <div className="card">
        <h2 className="mb-2 text-lg font-bold">What's next</h2>
        <p className="text-sm text-spotify-subtext">
          PR 3 fills these cards with real data from the Spotify Web API. PR 4
          adds the friends view so you can see what the rest of the crew is
          spinning.
        </p>
      </div>
    </section>
  );
}

function PlaceholderCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card">
      <h3 className="mb-2 text-lg font-bold">{title}</h3>
      <p className="text-sm text-spotify-subtext">{body}</p>
    </div>
  );
}
