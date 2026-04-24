import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  BOMPTON_YEARS,
  matchesBomptonYear,
  type BomptonYear,
} from "@/lib/bompton";
import {
  InitCachedResponseButton,
  InitPlaylistLinkButton,
  ResetSyncButton,
} from "./troubleshooting-buttons";

export const dynamic = "force-dynamic";

// /troubleshooting is the catch-all surface for diagnostic and testing
// affordances on this app.
//
// Use this page when you want to:
//   - Inspect per-Bompton-playlist sync state (last synced when, by whom)
//   - Reset stored playlist sync state if local data has gone wrong
//   - Apply one-shot DDL when adding a new Prisma table (this project
//     uses `prisma db push` instead of migrations, so new tables need a
//     button-triggered DDL pass against the prod DB)
//
// New temporary diagnostics, ad-hoc test buttons, and one-shot operational
// utilities should land here. Anything user-facing for normal usage belongs
// on /dashboard or /bompton-playlist instead.

export default async function TroubleshootingPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const playlists = await prisma.playlist.findMany({
    include: {
      tracks: { select: { id: true }, take: 1 },
    },
  });

  const lastSyncByUserIds = [
    ...new Set(playlists.map((p) => p.lastSyncBy).filter((v): v is string => !!v)),
  ];
  const syncUsers = lastSyncByUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: lastSyncByUserIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userById = new Map(syncUsers.map((u) => [u.id, u]));

  const playlistByYear = new Map<BomptonYear, (typeof playlists)[number]>();
  for (const year of BOMPTON_YEARS) {
    const match = playlists.find((p) => matchesBomptonYear(p.name, year));
    if (match) playlistByYear.set(year, match);
  }

  return (
    <section className="flex flex-col gap-10 py-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-spotify-subtext">
          Internal
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight">
          Troubleshooting &amp; testing
        </h1>
        <p className="max-w-3xl text-sm text-spotify-subtext">
          Diagnostic and testing surface for the Bompton app. Per-playlist
          sync state, one-shot DDL for new Prisma tables, and a reset button
          for when stored playlist data has gone bad. Drop ad-hoc test
          buttons and temporary diagnostics here so they have a stable home.
        </p>
      </header>

      <BomptonSyncStatusPanel
        playlistByYear={playlistByYear}
        userById={userById}
      />

      <section className="flex flex-col gap-3 rounded-lg border border-spotify-border bg-spotify-elevated/30 p-6">
        <h2 className="text-2xl font-extrabold tracking-tight">
          Reset stored playlist sync state
        </h2>
        <p className="text-sm text-spotify-subtext">
          Clears every Playlist row&apos;s stored{" "}
          <code className="font-mono">snapshotId</code> and deletes all
          PlaylistTrack rows. The sync code short-circuits when stored
          snapshot matches Spotify&apos;s current one, so if a Playlist row
          is holding a current snapshotId but the wrong/missing tracks,
          click this and re-run a sync to re-pull everything from scratch.
        </p>
        <ResetSyncButton />

        <div className="mt-6 flex flex-col gap-2 border-t border-spotify-border pt-6">
          <h3 className="text-base font-bold tracking-tight">
            One-shot · Initialize UserPlaylistLink table
          </h3>
          <p className="text-sm text-spotify-subtext">
            Per-user → playlist join table powering the dashboard&apos;s
            imported-playlist set. This project doesn&apos;t use Prisma
            migrations, so click this once after deploy if the table is
            missing. Idempotent — safe to re-click.
          </p>
          <InitPlaylistLinkButton />
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t border-spotify-border pt-6">
          <h3 className="text-base font-bold tracking-tight">
            One-shot · Initialize CachedSpotifyResponse table
          </h3>
          <p className="text-sm text-spotify-subtext">
            Durable per-user cache for Spotify responses (24h TTL on
            profile / devices / saved content / followed artists; 5 min on
            everything else). Click once after deploy. Idempotent.
          </p>
          <InitCachedResponseButton />
        </div>
      </section>
    </section>
  );
}

function BomptonSyncStatusPanel({
  playlistByYear,
  userById,
}: {
  playlistByYear: Map<
    BomptonYear,
    {
      id: string;
      name: string;
      lastSyncAt: Date | null;
      lastSyncBy: string | null;
      totalTracks: number;
      tracks: { id: string }[];
    }
  >;
  userById: Map<string, { id: string; name: string | null; email: string | null }>;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-spotify-border bg-spotify-elevated/50 p-6">
      <header>
        <p className="text-xs uppercase tracking-widest text-spotify-subtext">
          Bompton playlist sync state
        </p>
        <h2 className="text-2xl font-extrabold tracking-tight">
          Per-season status
        </h2>
        <p className="mt-1 text-sm text-spotify-subtext">
          What we have stored locally for each Bompton season. Empty rows
          mean no one has synced that season yet from /bompton-playlist.
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {BOMPTON_YEARS.map((year) => {
          const match = playlistByYear.get(year);
          const hasTracks = match && match.tracks.length > 0;
          const syncedBy =
            match?.lastSyncBy && userById.get(match.lastSyncBy);
          return (
            <li
              key={year}
              className="flex flex-col gap-1 rounded-lg bg-spotify-base/50 p-3 text-xs"
            >
              <p className="font-bold uppercase tracking-widest text-spotify-subtext">
                {year}
              </p>
              {!match ? (
                <p className="text-spotify-subtext">
                  Never synced. No Playlist row yet.
                </p>
              ) : (
                <>
                  <p className="truncate font-semibold text-spotify-text">
                    {match.name}
                  </p>
                  <p className="text-spotify-subtext">
                    {match.totalTracks} tracks
                    {hasTracks ? "" : " · metadata only"}
                  </p>
                  <p className="text-spotify-subtext">
                    {match.lastSyncAt
                      ? `Synced ${match.lastSyncAt.toLocaleString()}`
                      : "Never synced"}
                  </p>
                  {syncedBy ? (
                    <p className="text-spotify-subtext">
                      by {syncedBy.name ?? syncedBy.email ?? syncedBy.id}
                    </p>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
