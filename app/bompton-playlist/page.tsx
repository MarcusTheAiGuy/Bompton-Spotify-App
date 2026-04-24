import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadBomptonDataFromDb } from "@/lib/bompton-playlist-db";
import {
  BOMPTON_YEARS,
  CURRENT_BOMPTON_YEAR,
  findBomptonPlaylist,
  scoreSeason,
  seasonStart,
  type BomptonYear,
  type CrewMember,
} from "@/lib/bompton";
import { getPlaylists } from "@/lib/spotify";
import { settleSpotify } from "@/lib/describe-spotify-error";
import { BomptonColumn } from "@/components/bompton/bompton-column";
import { BomptonAutoSync } from "@/components/bompton/bompton-auto-sync";
import { BomptonTrackTable } from "@/components/bompton/bompton-track-table";
import { FridayLeaderboard } from "@/components/bompton/friday-leaderboard";

export const dynamic = "force-dynamic";

export default async function BomptonPlaylistPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const [crewRecords, bomptonData, callerPlaylistsResult] = await Promise.all([
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
    loadBomptonDataFromDb(),
    // Match the caller's Bompton playlist ids from their /me/playlists
    // so BomptonAutoSync can re-sync them on mount. settleSpotify means
    // a token issue on this user doesn't crash the page — we just skip
    // the auto-sync and render whatever's in the DB.
    settleSpotify(getPlaylists(session.user.id, 50)),
  ]);

  const crew: CrewMember[] = crewRecords.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    spotifyUserId: u.accounts[0]?.providerAccountId ?? null,
  }));

  const dataByYear = new Map(bomptonData.map((d) => [d.year, d]));

  // Find which Bompton playlists the caller has in their library, and
  // pass lastSyncAt so BomptonAutoSync can skip auto-syncing freshly
  // synced ones. The refresh button on the page lets the user force a
  // sync regardless of staleness.
  const autoSyncTargets: {
    year: BomptonYear;
    playlistId: string;
    lastSyncAt: string | null;
  }[] = [];
  const callerPlaylists = callerPlaylistsResult.value?.items ?? [];
  for (const year of BOMPTON_YEARS) {
    const match = findBomptonPlaylist(callerPlaylists, year);
    if (!match) continue;
    const storedLastSync = dataByYear.get(year)?.playlist?.lastSyncAt ?? null;
    autoSyncTargets.push({
      year,
      playlistId: match.id,
      lastSyncAt: storedLastSync?.toISOString() ?? null,
    });
  }
  const anyDataAtAll = bomptonData.some((d) => d.tracks.length > 0);

  const currentSeason = dataByYear.get(CURRENT_BOMPTON_YEAR);
  const currentTracks = currentSeason?.tracks ?? [];
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

      <BomptonAutoSync targets={autoSyncTargets} />

      {!anyDataAtAll && autoSyncTargets.length === 0 ? (
        <div className="rounded-lg border border-spotify-border bg-spotify-highlight/40 px-4 py-3 text-sm">
          <p className="font-semibold text-spotify-text">
            No sync data yet and no Bompton playlists found in your Spotify
            library.
          </p>
          <p className="mt-1 text-spotify-subtext">
            Follow the Bompton season playlists on Spotify so they show up
            in your library, then reload this page — the sync runs
            automatically on load for whoever has them in their library.
          </p>
        </div>
      ) : null}

      <FridayLeaderboard
        scores={seasonResult.scores}
        seasonStartAt={seasonStart(CURRENT_BOMPTON_YEAR)}
        lastFridayAt={
          seasonResult.fridays[seasonResult.fridays.length - 1] ?? null
        }
        weeksElapsed={seasonResult.fridays.length}
        hasRealData={hasRealDataForCurrent}
        missingDataReason={
          hasRealDataForCurrent
            ? undefined
            : "No tracks in the database for this season yet. Install the extension and click Sync now — the leaderboard will populate from the real added_at / added_by data the web player returns."
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BOMPTON_YEARS.map((year) => {
          const data = dataByYear.get(year);
          return (
            <BomptonColumn
              key={year}
              year={year}
              playlist={
                data?.playlist
                  ? {
                      id: data.playlist.id,
                      name: data.playlist.name,
                      description: null,
                      public: null,
                      collaborative: false,
                      owner: {
                        id: data.playlist.ownerId ?? "",
                        display_name: data.playlist.ownerName,
                        uri: "",
                      },
                      tracks: {
                        total: data.playlist.totalTracks,
                        href: "",
                      },
                      images: data.playlist.imageUrl
                        ? [
                            {
                              url: data.playlist.imageUrl,
                              height: null,
                              width: null,
                            },
                          ]
                        : [],
                      external_urls: {
                        spotify: `https://open.spotify.com/playlist/${data.playlist.id}`,
                      },
                      uri: `spotify:playlist:${data.playlist.id}`,
                      href: "",
                      snapshot_id: data.playlist.snapshotId ?? "",
                      type: "playlist",
                    }
                  : null
              }
              tracks={data?.tracks ?? null}
              crew={crew}
              isCurrent={year === CURRENT_BOMPTON_YEAR}
              lastSyncAt={data?.playlist?.lastSyncAt ?? null}
            />
          );
        })}
      </div>

      <div className="flex flex-col gap-8">
        {BOMPTON_YEARS.map((year) => {
          const data = dataByYear.get(year);
          if (!data?.playlist) return null;
          return (
            <section key={year} className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xl font-bold tracking-tight">
                  {data.playlist.name}
                </h2>
                <span className="text-xs text-spotify-subtext">
                  {data.tracks.length} of {data.playlist.totalTracks} tracks
                  {data.playlist.lastSyncAt
                    ? ` · synced ${data.playlist.lastSyncAt.toLocaleString()}`
                    : ""}
                </span>
              </div>
              <BomptonTrackTable tracks={data.tracks} />
            </section>
          );
        })}
      </div>
    </section>
  );
}
