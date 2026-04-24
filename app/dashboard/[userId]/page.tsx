import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  getSpotifyProfile,
  type SpotifyProfile,
} from "@/lib/spotify";
import { settleSpotify } from "@/lib/describe-spotify-error";
import {
  captureErrorDetail,
  isNextControlFlowError,
} from "@/lib/next-control-flow";
import { CrashCard } from "@/components/crash-card";
import { UserTabs, type TabUser } from "@/components/user-tabs";
import { SpotifyErrorBanner } from "@/components/spotify/section-header";
import { LazyDashboardSections } from "@/components/dashboard/lazy-sections";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  try {
    return await renderDashboard(userId);
  } catch (error) {
    if (isNextControlFlowError(error)) throw error;
    return (
      <section className="flex flex-col gap-6 py-6">
        <CrashCard
          title="Dashboard crashed before render"
          subtitle="Caught while fetching auth, Prisma, or Spotify data. Message is unredacted because we caught it before Next.js did."
          detail={captureErrorDetail(error)}
        />
      </section>
    );
  }
}

async function renderDashboard(userId: string) {
  const session = await auth();
  if (!session?.user) redirect("/");

  // Only fetch the must-have-immediately stuff server-side:
  //  - viewedUser: for the profile header
  //  - crew: for the user tabs
  //  - playlistLinks: for the bottom Playlists section (DB-backed, no Spotify)
  //  - profile: for the "Connected as" line; /me is 5-min cached per user
  // Everything else (top tracks/artists, saved content, playback, queue,
  // devices, recently-played, followed artists) is fetched client-side
  // by LazyDashboardSections so the page renders immediately and sections
  // fill in one-at-a-time in the background.
  const [viewedUser, crew, playlistLinks, profileResult] = await Promise.all([
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
    prisma.userPlaylistLink
      .findMany({
        where: { userId },
        select: {
          playlistId: true,
          playlist: {
            include: {
              tracks: { orderBy: { position: "asc" } },
            },
          },
        },
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/does not exist/i.test(message)) {
          console.warn(
            "[dashboard] UserPlaylistLink table missing — visit /extension-setup and click 'Initialize UserPlaylistLink table'.",
            { userId, message },
          );
          return [];
        }
        throw error;
      }),
    settleSpotify(getSpotifyProfile(userId)),
  ]);

  if (!viewedUser) notFound();

  const tabUsers: TabUser[] = crew;
  const profile = profileResult.value;
  const profileError = profileResult.error;
  const isSelf = session.user.id === userId;

  return (
    <section className="flex flex-col gap-12 py-6">
      <UserTabs users={tabUsers} activeUserId={userId} />

      <ProfileHeader
        session={session}
        profile={profile}
        viewedUser={viewedUser}
      />
      {profileError ? (
        <SpotifyErrorBanner
          title={profileError.title}
          detail={profileError.detail}
        />
      ) : null}
      {profile ? <ProfileStats profile={profile} /> : null}

      {/* Every Spotify-backed section (including Playlists) loads
          client-side sequentially after the page renders. The server
          component does zero Spotify calls on the critical path, which
          is what guarantees an instant paint even under a 429 cooldown. */}
      <LazyDashboardSections
        forUserId={userId}
        isSelf={isSelf}
        callerSpotifyId={isSelf ? (profile?.id ?? null) : null}
        preloadedLinks={buildPreloadedLinks(playlistLinks)}
      />
    </section>
  );
}

type DbPlaylistTrackRow = {
  position: number;
  trackSpotifyId: string | null;
  trackName: string;
  trackUri: string;
  trackDurationMs: number;
  trackExplicit: boolean;
  trackPreviewUrl: string | null;
  albumName: string;
  albumImageUrl: string | null;
  artistsJson: unknown;
  addedAt: Date;
  addedBySpotifyId: string | null;
  isLocal: boolean;
};

type DbPlaylistLinkRow = {
  playlistId: string;
  playlist: {
    lastSyncAt: Date | null;
    totalTracks: number;
    tracks: DbPlaylistTrackRow[];
  } | null;
};

function buildPreloadedLinks(rows: DbPlaylistLinkRow[]) {
  return rows.map((l) => ({
    playlistId: l.playlistId,
    lastSyncAt: l.playlist?.lastSyncAt?.toISOString() ?? null,
    totalTracks: l.playlist?.totalTracks ?? 0,
    tracks: (l.playlist?.tracks ?? []).map((t) => ({
      position: t.position,
      trackSpotifyId: t.trackSpotifyId,
      trackName: t.trackName,
      trackUri: t.trackUri,
      trackDurationMs: t.trackDurationMs,
      trackExplicit: t.trackExplicit,
      trackPreviewUrl: t.trackPreviewUrl,
      albumName: t.albumName,
      albumImageUrl: t.albumImageUrl,
      artists: (t.artistsJson ?? []) as {
        id: string | null;
        name: string;
        uri: string | null;
      }[],
      addedAt: t.addedAt.toISOString(),
      addedBySpotifyId: t.addedBySpotifyId,
      isLocal: t.isLocal,
    })),
  }));
}

function ProfileHeader({
  session,
  profile,
  viewedUser,
}: {
  session: { user: { id: string } };
  profile: SpotifyProfile | null;
  viewedUser: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
}) {
  const imageSrc = profile?.images?.[0]?.url ?? viewedUser.image ?? null;
  const isSelf = viewedUser.id === session.user.id;
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
      {imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt=""
          className="h-20 w-20 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="h-20 w-20 shrink-0 rounded-full bg-spotify-highlight" />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs uppercase tracking-widest text-spotify-subtext">
          {isSelf ? "Your dashboard" : `${viewedUser.name ?? viewedUser.email}'s dashboard`}
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {profile?.display_name ?? viewedUser.name ?? viewedUser.email ?? "Unknown"}
        </h1>
        <p className="truncate text-sm text-spotify-subtext">
          {profile?.email ?? viewedUser.email ?? ""}
          {profile?.country ? ` · ${profile.country}` : ""}
          {profile?.product ? ` · ${profile.product}` : ""}
        </p>
      </div>
    </header>
  );
}

function ProfileStats({ profile }: { profile: SpotifyProfile }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <Stat label="Followers" value={profile.followers?.total ?? 0} />
      <Stat label="Country" value={profile.country ?? "—"} />
      <Stat label="Plan" value={profile.product ?? "—"} />
      <Stat
        label="Explicit filter"
        value={
          profile.explicit_content?.filter_enabled ? "on" : "off"
        }
      />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-spotify-border bg-spotify-elevated/40 p-3">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
        {label}
      </dt>
      <dd className="mt-1 text-base font-semibold text-spotify-text">
        {value}
      </dd>
    </div>
  );
}
