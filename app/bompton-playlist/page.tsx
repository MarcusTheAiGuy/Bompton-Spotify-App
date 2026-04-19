import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPlaylists, getPlaylistTracks } from "@/lib/spotify";
import { settleSpotify } from "@/lib/describe-spotify-error";
import {
  BOMPTON_YEARS,
  CURRENT_BOMPTON_YEAR,
  findBomptonPlaylist,
  mostRecentFriday,
  scoreSeason,
  seasonStart,
  type BomptonYear,
  type CrewMember,
} from "@/lib/bompton";
import { BomptonColumn } from "@/components/bompton/bompton-column";
import { FridayLeaderboard } from "@/components/bompton/friday-leaderboard";
import { SpotifyErrorBanner } from "@/components/spotify/section-header";

export const dynamic = "force-dynamic";

export default async function BomptonPlaylistPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const [crewRecords, playlistsResult] = await Promise.all([
    prisma.user.findMany({
      where: { accounts: { some: { provider: "spotify" } } },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        accounts: {
          where: { provider: "spotify" },
          select: { providerAccountId: true },
          take: 1,
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    settleSpotify(getPlaylists(session.user.id, 50)),
  ]);

  const crew: CrewMember[] = crewRecords.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    spotifyUserId: u.accounts[0]?.providerAccountId ?? null,
  }));

  const playlists = playlistsResult.value?.items ?? [];

  const playlistByYear = new Map<BomptonYear, ReturnType<typeof findBomptonPlaylist>>();
  for (const year of BOMPTON_YEARS) {
    playlistByYear.set(year, findBomptonPlaylist(playlists, year));
  }

  const trackResults = await Promise.all(
    BOMPTON_YEARS.map(async (year) => {
      const playlist = playlistByYear.get(year);
      if (!playlist) return { year, tracks: null, error: null };
      const result = await settleSpotify(
        getPlaylistTracks(session.user.id, playlist.id),
      );
      if (result.error) {
        return {
          year,
          tracks: null,
          error: result.error,
        };
      }
      const playableTracks = result.value.items.filter((i) => Boolean(i.track));
      return {
        year,
        tracks: playableTracks,
        error: null,
      };
    }),
  );
  const tracksByYear = new Map(
    trackResults.map((r) => [r.year, r.tracks]),
  );
  const firstTrackError = trackResults.find((r) => r.error)?.error ?? null;

  const currentTracks = tracksByYear.get(CURRENT_BOMPTON_YEAR) ?? [];
  const hasRealDataForCurrent = currentTracks.length > 0;
  const seasonResult = scoreSeason(
    hasRealDataForCurrent ? currentTracks : [],
    crew,
    CURRENT_BOMPTON_YEAR,
  );

  return (
    <section className="flex flex-col gap-10 py-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-spotify-subtext">
          The Bompton Playlist
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight">
          Four seasons, one song per Friday
        </h1>
        <p className="max-w-3xl text-sm text-spotify-subtext">
          One playlist per Bompton year. Every Friday each of the four of you
          is supposed to add a song to the current season. Fall behind and
          the leaderboard will notice.
        </p>
      </header>

      {playlistsResult.error ? (
        <SpotifyErrorBanner
          title={playlistsResult.error.title}
          detail={playlistsResult.error.detail}
        />
      ) : null}

      <FridayLeaderboard
        scores={seasonResult.scores}
        seasonStartAt={seasonStart(CURRENT_BOMPTON_YEAR)}
        lastFridayAt={mostRecentFriday()}
        weeksElapsed={seasonResult.fridays.length}
        hasRealData={hasRealDataForCurrent}
        missingDataReason={
          hasRealDataForCurrent
            ? undefined
            : "Spotify's current quota tier for this app isn't returning added_at / added_by track metadata, so we can't tell who added what or when. Apply for Extended Quota Mode in the Spotify developer dashboard."
        }
      />

      {firstTrackError && !hasRealDataForCurrent ? (
        <SpotifyErrorBanner
          title={firstTrackError.title}
          detail={firstTrackError.detail}
          tone="muted"
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BOMPTON_YEARS.map((year) => (
          <BomptonColumn
            key={year}
            year={year}
            playlist={playlistByYear.get(year) ?? null}
            tracks={tracksByYear.get(year) ?? null}
            crew={crew}
            isCurrent={year === CURRENT_BOMPTON_YEAR}
          />
        ))}
      </div>
    </section>
  );
}
