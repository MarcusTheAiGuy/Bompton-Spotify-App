import { redirect } from "next/navigation";
import Link from "next/link";
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
  RevokeButton,
  TokenGenerator,
} from "./token-generator";

export const dynamic = "force-dynamic";

const RELEASE_URL =
  "https://github.com/marcustheaiguy/bompton-spotify-app/releases/latest";
const EXTENSION_CONNECTED_WINDOW_MS = 90 * 60 * 1000;

export default async function ExtensionSetupPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const [tokens, playlists] = await Promise.all([
    prisma.extensionToken.findMany({
      where: { userId: session.user.id },
      orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    }),
    prisma.playlist.findMany({
      include: {
        tracks: { select: { id: true }, take: 1 },
      },
    }),
  ]);

  const lastUsedAcrossTokens = tokens
    .filter((t) => t.revokedAt === null && t.lastUsedAt !== null)
    .map((t) => t.lastUsedAt!.getTime())
    .sort((a, b) => b - a)[0];
  const connected =
    typeof lastUsedAcrossTokens === "number" &&
    Date.now() - lastUsedAcrossTokens < EXTENSION_CONNECTED_WINDOW_MS;

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
          One-time setup
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight">
          Bompton playlist sync extension
        </h1>
        <p className="max-w-3xl text-sm text-spotify-subtext">
          The leaderboard needs full track data for the Bompton playlists, so
          we sync them via a small browser extension that pages through the
          Spotify API on your machine. Install it once per machine, paste an
          auth token, and the leaderboard starts working. The extension asks
          this backend for a Spotify access token, so you don't need to be
          signed into open.spotify.com separately — just the Bompton site.
        </p>
      </header>

      <StatusPanel
        connected={connected}
        lastUsedAt={
          typeof lastUsedAcrossTokens === "number"
            ? new Date(lastUsedAcrossTokens)
            : null
        }
        playlistByYear={playlistByYear}
        userById={userById}
      />

      <section className="flex flex-col gap-4 rounded-lg border border-spotify-border bg-spotify-elevated/30 p-6">
        <h2 className="text-2xl font-extrabold tracking-tight">
          Step 1 · Install the extension
        </h2>
        <ol className="flex flex-col gap-3 text-sm text-spotify-subtext">
          <li>
            <span className="text-spotify-text">
              Download the latest release zip:
            </span>{" "}
            <a
              href={RELEASE_URL}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-spotify-green hover:underline"
            >
              github.com/marcustheaiguy/bompton-spotify-app/releases/latest ↗
            </a>
            . Grab the <code className="font-mono">bompton-extension-vX.Y.Z.zip</code>{" "}
            asset and unzip it somewhere permanent (e.g.{" "}
            <code className="font-mono">~/bompton-extension/</code>).
          </li>
          <li>
            <span className="text-spotify-text">
              Open <code className="font-mono">chrome://extensions</code>
            </span>{" "}
            in a new tab. Flip the <em>Developer mode</em> toggle in the
            top-right on.
          </li>
          <li>
            <span className="text-spotify-text">Click "Load unpacked"</span> and
            pick the unzipped folder.
          </li>
          <li>
            The Bompton icon shows up in the toolbar. Pin it (the puzzle-piece
            menu → pin) so it's easy to find.
          </li>
          <li className="text-xs italic">
            The yellow "Disable developer mode extensions" banner at the top of
            the extensions page is cosmetic — nothing breaks. Chrome briefly
            experimented with auto-disabling these in 2024 and rolled it back.
            If it ever comes back, we'll publish to Edge Add-ons (free) and
            swap the install link.
          </li>
        </ol>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-spotify-border bg-spotify-elevated/30 p-6">
        <h2 className="text-2xl font-extrabold tracking-tight">
          Step 2 · Generate an auth token
        </h2>
        <p className="text-sm text-spotify-subtext">
          This token authenticates the extension's sync requests to our
          backend. One per machine is fine. Only the sha256 hash is stored
          server-side — if you lose the raw value, generate a new one and
          revoke the old.
        </p>
        <TokenGenerator />

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-spotify-subtext">
            Your tokens
          </h3>
          {tokens.length === 0 ? (
            <p className="text-xs text-spotify-subtext">
              No tokens yet. Generate one above.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-spotify-border/60 rounded-lg border border-spotify-border bg-spotify-base/40">
              {tokens.map((token) => {
                const isRevoked = token.revokedAt !== null;
                return (
                  <li
                    key={token.id}
                    className="flex items-start justify-between gap-4 px-4 py-3 text-sm"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold">
                        {token.label ?? "(no label)"}
                        {isRevoked ? (
                          <span className="ml-2 rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-red-300">
                            revoked
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-spotify-subtext">
                        Created{" "}
                        <time dateTime={token.createdAt.toISOString()}>
                          {token.createdAt.toLocaleString()}
                        </time>
                        {" · "}
                        {token.lastUsedAt
                          ? `last used ${token.lastUsedAt.toLocaleString()}`
                          : "never used"}
                        {isRevoked
                          ? ` · revoked ${token.revokedAt!.toLocaleString()}`
                          : ""}
                      </span>
                    </div>
                    {isRevoked ? null : <RevokeButton tokenId={token.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-spotify-border bg-spotify-elevated/30 p-6">
        <h2 className="text-2xl font-extrabold tracking-tight">
          Step 3 · Wire up the extension
        </h2>
        <ol className="flex list-decimal flex-col gap-2 pl-6 text-sm text-spotify-subtext">
          <li>Click the Bompton extension icon in your Chrome toolbar.</li>
          <li>
            In <strong>Backend origin</strong>, leave the default production
            URL — or set <code className="font-mono">http://localhost:3000</code>{" "}
            when running <code className="font-mono">npm run dev</code>.
          </li>
          <li>
            Paste your token into the <strong>Auth token</strong> field and
            click <strong>Save</strong>.
          </li>
          <li>
            Click <strong>Test connection</strong> — it should echo back your
            email.
          </li>
          <li>
            Click <strong>Sync now</strong>. The playlist data shows up on{" "}
            <Link
              href="/bompton-playlist"
              className="font-semibold text-spotify-green hover:underline"
            >
              /bompton-playlist
            </Link>
            . After that it syncs hourly in the background.
          </li>
        </ol>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-spotify-border bg-spotify-elevated/30 p-6">
        <h2 className="text-2xl font-extrabold tracking-tight">
          Troubleshooting · Reset sync state
        </h2>
        <p className="text-sm text-spotify-subtext">
          Clears every Playlist row's stored <code className="font-mono">snapshotId</code>{" "}
          and deletes all PlaylistTrack rows. The extension short-circuits its
          sync when the stored snapshot matches Spotify's current one, so if
          you ever end up with a Playlist row holding a current snapshotId but
          no (or wrong) tracks — e.g. after the v0.1.2 sync bug, or if the
          track table got out of sync with Spotify — click this, then hit{" "}
          <strong>Sync now</strong> in the extension to re-pull everything.
        </p>
        <ResetSyncButton />

        <div className="mt-6 flex flex-col gap-2 border-t border-spotify-border pt-6">
          <h3 className="text-base font-bold tracking-tight">
            One-shot · Initialize UserPlaylistLink table
          </h3>
          <p className="text-sm text-spotify-subtext">
            The dashboard now imports playlists into a shared Playlist/PlaylistTrack
            store per user; the join table <code className="font-mono">UserPlaylistLink</code>{" "}
            needs to exist in the prod DB before anyone clicks "Import". This
            project doesn&apos;t use Prisma migrations, so click this once after
            deploy to apply the DDL. Safe to click twice — it&apos;s idempotent.
          </p>
          <InitPlaylistLinkButton />
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t border-spotify-border pt-6">
          <h3 className="text-base font-bold tracking-tight">
            One-shot · Initialize CachedSpotifyResponse table
          </h3>
          <p className="text-sm text-spotify-subtext">
            Durable per-user cache for Spotify responses so we don&apos;t
            re-hit the API for slow-changing data (profile, devices,
            saved content, followed artists) — 24h TTL on those, 5 min
            on everything else. Click once after deploy.
          </p>
          <InitCachedResponseButton />
        </div>
      </section>
    </section>
  );
}

function StatusPanel({
  connected,
  lastUsedAt,
  playlistByYear,
  userById,
}: {
  connected: boolean;
  lastUsedAt: Date | null;
  playlistByYear: Map<BomptonYear, { id: string; name: string; lastSyncAt: Date | null; lastSyncBy: string | null; totalTracks: number; tracks: { id: string }[] }>;
  userById: Map<string, { id: string; name: string | null; email: string | null }>;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-spotify-border bg-spotify-elevated/50 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-spotify-subtext">
            Status
          </p>
          <h2 className="text-2xl font-extrabold tracking-tight">
            {connected ? "Extension connected" : "Extension not connected"}
          </h2>
          <p className="mt-1 text-sm text-spotify-subtext">
            {lastUsedAt
              ? `Last request from one of your tokens: ${lastUsedAt.toLocaleString()}.`
              : "None of your tokens have been used yet. Follow the steps below."}
          </p>
        </div>
        <span
          className={
            "shrink-0 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest " +
            (connected
              ? "bg-spotify-green/20 text-spotify-green"
              : "bg-spotify-highlight text-spotify-subtext")
          }
        >
          {connected ? "live" : "idle"}
        </span>
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
