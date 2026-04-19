import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  SpotifyAccountMissingError,
  SpotifyError,
  SpotifyRefreshFailedError,
  getSpotifyProfile,
  type SpotifyProfile,
} from "@/lib/spotify";
import { UserTabs, type TabUser } from "@/components/user-tabs";

export const dynamic = "force-dynamic";

export default async function UserDashboardPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const { userId } = await params;

  const [viewedUser, crew] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
      },
    }),
    prisma.user.findMany({
      where: { accounts: { some: { provider: "spotify" } } },
      select: { id: true, name: true, email: true, image: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!viewedUser) notFound();

  const tabUsers: TabUser[] = crew;

  let profile: SpotifyProfile | null = null;
  let profileError: { title: string; detail: string } | null = null;
  try {
    profile = await getSpotifyProfile(userId);
  } catch (error) {
    profileError = describeSpotifyError(error);
  }

  return (
    <section className="flex flex-col gap-8 py-6">
      <UserTabs users={tabUsers} activeUserId={userId} />

      <header className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {profile?.images?.[0]?.url ?? viewedUser.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile?.images?.[0]?.url ?? viewedUser.image ?? ""}
              alt=""
              className="h-20 w-20 rounded-full border border-spotify-border object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-spotify-highlight text-2xl font-bold">
              {(viewedUser.name ?? viewedUser.email ?? "?")
                .slice(0, 1)
                .toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-widest text-spotify-subtext">
              {viewedUser.id === session.user.id ? "Your dashboard" : "Viewing"}
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight">
              {profile?.display_name ?? viewedUser.name ?? viewedUser.email}
            </h1>
            {viewedUser.email ? (
              <p className="text-sm text-spotify-subtext">{viewedUser.email}</p>
            ) : null}
          </div>
        </div>
      </header>

      {profileError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          <p className="font-semibold">{profileError.title}</p>
          <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-red-300/80">
            {profileError.detail}
          </p>
        </div>
      ) : null}

      {profile ? (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Followers" value={profile.followers.total.toLocaleString()} />
          <StatCard
            label="Plan"
            value={
              profile.product === "premium"
                ? "Premium"
                : profile.product === "free"
                  ? "Free"
                  : profile.product
            }
          />
          <StatCard label="Country" value={profile.country} />
          <StatCard label="Spotify ID" value={profile.id} mono />
          <StatCard
            label="Explicit filter"
            value={
              profile.explicit_content?.filter_enabled ? "Enabled" : "Disabled"
            }
          />
          <StatCard
            label="Profile URL"
            value={
              <a
                href={profile.external_urls.spotify}
                target="_blank"
                rel="noreferrer"
                className="text-spotify-green hover:underline"
              >
                open.spotify.com →
              </a>
            }
          />
        </section>
      ) : null}

      <section className="card">
        <h2 className="mb-2 text-lg font-bold">What's next</h2>
        <p className="text-sm text-spotify-subtext">
          Next PRs fill this page out: top tracks &amp; artists (3 time
          ranges), recently played, what's spinning right now, saved library,
          playlists, and derived listening stats. Switch between crew members
          with the tabs above.
        </p>
      </section>
    </section>
  );
}

function StatCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-widest text-spotify-subtext">
        {label}
      </p>
      <p
        className={
          mono
            ? "mt-1 truncate font-mono text-sm"
            : "mt-1 text-xl font-bold tracking-tight"
        }
      >
        {value}
      </p>
    </div>
  );
}

function describeSpotifyError(error: unknown): { title: string; detail: string } {
  if (error instanceof SpotifyAccountMissingError) {
    return {
      title: "No Spotify account linked for this user",
      detail: `userId=${error.userId}. They need to visit the site and click Connect Spotify at least once.`,
    };
  }
  if (error instanceof SpotifyRefreshFailedError) {
    return {
      title: "Couldn't refresh this user's Spotify token",
      detail: `Status ${error.status}. ${error.message}\n\nResponse body: ${error.body}`,
    };
  }
  if (error instanceof SpotifyError) {
    return {
      title: `Spotify API returned ${error.status} on ${error.path}`,
      detail: `${error.message}\n\nResponse body: ${error.body}`,
    };
  }
  if (error instanceof Error) {
    return { title: error.name, detail: `${error.message}\n\n${error.stack ?? ""}` };
  }
  return { title: "Unknown error", detail: String(error) };
}
