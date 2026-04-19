import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  TIME_RANGES,
  getAudioFeaturesBatch,
  getDevices,
  getFollowedArtists,
  getPlaybackState,
  getPlaylists,
  getRecentlyPlayed,
  getSavedAlbums,
  getSavedAudiobooks,
  getSavedEpisodes,
  getSavedShows,
  getSavedTracks,
  getSpotifyProfile,
  getTopArtists,
  getTopTracks,
  type SpotifyArtist,
  type SpotifyPaged,
  type SpotifyProfile,
  type SpotifyTrack,
} from "@/lib/spotify";
import { settleSpotify } from "@/lib/describe-spotify-error";
import {
  captureErrorDetail,
  isNextControlFlowError,
} from "@/lib/next-control-flow";
import { CrashCard } from "@/components/crash-card";
import { UserTabs, type TabUser } from "@/components/user-tabs";
import { ArtistGrid } from "@/components/spotify/artist-grid";
import { TrackList } from "@/components/spotify/track-list";
import {
  SectionHeader,
  SpotifyErrorBanner,
} from "@/components/spotify/section-header";
import { NowPlaying } from "@/components/spotify/now-playing";
import { DeviceList } from "@/components/spotify/device-list";
import { RecentlyPlayed } from "@/components/spotify/recently-played";
import { SavedTracks } from "@/components/spotify/saved-tracks";
import { SavedAlbumGrid } from "@/components/spotify/album-grid";
import {
  AudiobookGrid,
  EpisodeList,
  ShowGrid,
} from "@/components/spotify/show-grid";
import { PlaylistGrid } from "@/components/spotify/playlist-grid";
import { CollapsibleSection } from "@/components/spotify/collapsible-section";
import {
  AudioFeatureAverages,
  GenreDistribution,
  PopularityStats,
  ReleaseDecadeDistribution,
} from "@/components/spotify/derived-stats";

export const dynamic = "force-dynamic";

export default async function UserDashboardPage({
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

  const [
    profileResult,
    playbackResult,
    devicesResult,
    recentResult,
    topTracksShort,
    topTracksMedium,
    topTracksLong,
    topArtistsShort,
    topArtistsMedium,
    topArtistsLong,
    savedTracksResult,
    savedAlbumsResult,
    savedShowsResult,
    savedEpisodesResult,
    savedAudiobooksResult,
    followedArtistsResult,
    playlistsResult,
  ] = await Promise.all([
    settleSpotify(getSpotifyProfile(userId)),
    settleSpotify(getPlaybackState(userId)),
    settleSpotify(getDevices(userId)),
    settleSpotify(getRecentlyPlayed(userId)),
    settleSpotify(getTopTracks(userId, "short_term")),
    settleSpotify(getTopTracks(userId, "medium_term")),
    settleSpotify(getTopTracks(userId, "long_term")),
    settleSpotify(getTopArtists(userId, "short_term")),
    settleSpotify(getTopArtists(userId, "medium_term")),
    settleSpotify(getTopArtists(userId, "long_term")),
    settleSpotify(getSavedTracks(userId)),
    settleSpotify(getSavedAlbums(userId)),
    settleSpotify(getSavedShows(userId)),
    settleSpotify(getSavedEpisodes(userId)),
    settleSpotify(getSavedAudiobooks(userId)),
    settleSpotify(getFollowedArtists(userId)),
    settleSpotify(getPlaylists(userId)),
  ]);

  const profile = profileResult.value;
  const profileError = profileResult.error;

  const topTracksByRange = {
    short_term: topTracksShort,
    medium_term: topTracksMedium,
    long_term: topTracksLong,
  };
  const topArtistsByRange = {
    short_term: topArtistsShort,
    medium_term: topArtistsMedium,
    long_term: topArtistsLong,
  };

  const mediumTracks = topTracksMedium.value?.items ?? [];
  const unionArtists: SpotifyArtist[] = [];
  const seenArtistIds = new Set<string>();
  for (const paged of [
    topArtistsShort.value,
    topArtistsMedium.value,
    topArtistsLong.value,
  ]) {
    for (const a of paged?.items ?? []) {
      if (!seenArtistIds.has(a.id)) {
        seenArtistIds.add(a.id);
        unionArtists.push(a);
      }
    }
  }
  const unionTracks: SpotifyTrack[] = [];
  const seenTrackIds = new Set<string>();
  for (const paged of [
    topTracksShort.value,
    topTracksMedium.value,
    topTracksLong.value,
  ]) {
    for (const t of paged?.items ?? []) {
      if (!seenTrackIds.has(t.id)) {
        seenTrackIds.add(t.id);
        unionTracks.push(t);
      }
    }
  }

  const audioFeaturesResult = await settleSpotify(
    getAudioFeaturesBatch(
      userId,
      mediumTracks.slice(0, 50).map((t) => t.id),
    ),
  );

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

      <div className="flex flex-col gap-4">
        <SectionHeader
          eyebrow="Right now"
          title="What's spinning"
          subtitle="Live playback state from /me/player."
        />
        {playbackResult.error ? (
          <SpotifyErrorBanner
            title={playbackResult.error.title}
            detail={playbackResult.error.detail}
          />
        ) : (
          <NowPlaying state={playbackResult.value} />
        )}
      </div>

      <CollapsibleSection
        eyebrow="Devices"
        title="Available devices"
        subtitle="Anything Spotify currently sees online for this account."
      >
        {devicesResult.error ? (
          <SpotifyErrorBanner
            title={devicesResult.error.title}
            detail={devicesResult.error.detail}
          />
        ) : (
          <DeviceList devices={devicesResult.value.devices} />
        )}
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="History"
        title="Recently played"
        subtitle="Last 50 tracks Spotify has on record for this account."
      >
        {recentResult.error ? (
          <SpotifyErrorBanner
            title={recentResult.error.title}
            detail={recentResult.error.detail}
          />
        ) : (
          <RecentlyPlayed items={recentResult.value.items} />
        )}
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Listening"
        title="Top tracks"
        subtitle="Up to 50 per time range, straight from /me/top/tracks."
      >
        {TIME_RANGES.map(({ key, label }) => (
          <RangeSection
            key={`tracks-${key}`}
            label={label}
            result={topTracksByRange[key]}
            renderValue={(paged: SpotifyPaged<SpotifyTrack>) => (
              <TrackList tracks={paged.items} />
            )}
            emptyFallbackTitle="Top tracks unavailable"
          />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Listening"
        title="Top artists"
        subtitle="Up to 50 per time range, with Spotify-assigned genres and popularity."
      >
        {TIME_RANGES.map(({ key, label }) => (
          <RangeSection
            key={`artists-${key}`}
            label={label}
            result={topArtistsByRange[key]}
            renderValue={(paged: SpotifyPaged<SpotifyArtist>) => (
              <ArtistGrid artists={paged.items} />
            )}
            emptyFallbackTitle="Top artists unavailable"
          />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Derived"
        title="Listening patterns"
        subtitle="Aggregates computed locally from the top-items responses above."
      >
        <PopularityStats tracks={unionTracks} artists={unionArtists} />
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Genre mix (from top artists, dedupe'd across time ranges)
          </h3>
          <GenreDistribution artists={unionArtists} />
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Release decade distribution (from top tracks)
          </h3>
          <ReleaseDecadeDistribution tracks={unionTracks} />
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Audio feature averages (medium-term top tracks)
          </h3>
          {audioFeaturesResult.error ? (
            <SpotifyErrorBanner
              title={audioFeaturesResult.error.title}
              detail={`${audioFeaturesResult.error.detail}\n\n(Note: Spotify deprecated /audio-features for new apps in late 2024. If this 403s, that's why — we can't fix it from the client side.)`}
            />
          ) : (
            <AudioFeatureAverages features={audioFeaturesResult.value} />
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Library"
        title="Saved content"
        subtitle="First 50 items of each saved collection."
      >
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Saved tracks
          </h3>
          {savedTracksResult.error ? (
            <SpotifyErrorBanner
              title={savedTracksResult.error.title}
              detail={savedTracksResult.error.detail}
            />
          ) : (
            <SavedTracks items={savedTracksResult.value.items} />
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Saved albums
          </h3>
          {savedAlbumsResult.error ? (
            <SpotifyErrorBanner
              title={savedAlbumsResult.error.title}
              detail={savedAlbumsResult.error.detail}
            />
          ) : (
            <SavedAlbumGrid items={savedAlbumsResult.value.items} />
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Saved podcasts
          </h3>
          {savedShowsResult.error ? (
            <SpotifyErrorBanner
              title={savedShowsResult.error.title}
              detail={savedShowsResult.error.detail}
            />
          ) : (
            <ShowGrid items={savedShowsResult.value.items} />
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Saved episodes
          </h3>
          {savedEpisodesResult.error ? (
            <SpotifyErrorBanner
              title={savedEpisodesResult.error.title}
              detail={savedEpisodesResult.error.detail}
            />
          ) : (
            <EpisodeList items={savedEpisodesResult.value.items} />
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Saved audiobooks
          </h3>
          {savedAudiobooksResult.error ? (
            <SpotifyErrorBanner
              title={savedAudiobooksResult.error.title}
              detail={savedAudiobooksResult.error.detail}
            />
          ) : (
            <AudiobookGrid items={savedAudiobooksResult.value.items} />
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Following"
        title="Followed artists"
        subtitle="Up to 50 artists, fetched from /me/following."
      >
        {followedArtistsResult.error ? (
          <SpotifyErrorBanner
            title={followedArtistsResult.error.title}
            detail={followedArtistsResult.error.detail}
          />
        ) : (
          <ArtistGrid artists={followedArtistsResult.value.artists.items} />
        )}
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Library"
        title="Playlists"
        subtitle="Owned and followed playlists (up to 50)."
      >
        {playlistsResult.error ? (
          <SpotifyErrorBanner
            title={playlistsResult.error.title}
            detail={playlistsResult.error.detail}
          />
        ) : (
          <PlaylistGrid playlists={playlistsResult.value.items} />
        )}
      </CollapsibleSection>
    </section>
  );
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
    <header className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
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
            {isSelf ? "Your dashboard" : "Viewing"}
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
  );
}

function ProfileStats({ profile }: { profile: SpotifyProfile }) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        label="Followers"
        value={profile.followers.total.toLocaleString()}
      />
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

function RangeSection<T>({
  label,
  result,
  renderValue,
  emptyFallbackTitle,
}: {
  label: string;
  result:
    | { value: T; error: null }
    | { value: null; error: { title: string; detail: string } };
  renderValue: (value: T) => React.ReactNode;
  emptyFallbackTitle: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
        {label}
      </h3>
      {result.error ? (
        <SpotifyErrorBanner
          title={`${emptyFallbackTitle} for ${label.toLowerCase()}`}
          detail={`${result.error.title}\n\n${result.error.detail}`}
        />
      ) : (
        renderValue(result.value)
      )}
    </div>
  );
}
