"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Server actions used by /troubleshooting buttons. Each requires a
// signed-in user. All idempotent so they're safe to invoke repeatedly.
//
// Add new troubleshooting/test actions here. Anything user-facing for
// normal app usage belongs elsewhere — this surface is intentionally
// scoped to operational + diagnostic helpers.

export type ResetSyncStateResult =
  | { ok: true; playlistsCleared: number; tracksDeleted: number }
  | { ok: false; error: string };

// Wipes every PlaylistTrack row and clears Playlist.snapshotId for every
// playlist. Use when stored sync data has gone wrong (snapshot matches
// upstream but tracks are missing/wrong). The next sync treats every
// playlist as changed and re-pulls everything from Spotify.
export async function resetPlaylistSyncState(): Promise<ResetSyncStateResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error: "Unauthorized: sign in with your Spotify account first.",
    };
  }
  try {
    const [deleted, updated] = await prisma.$transaction([
      prisma.playlistTrack.deleteMany({}),
      prisma.playlist.updateMany({ data: { snapshotId: null } }),
    ]);
    revalidatePath("/troubleshooting");
    return {
      ok: true,
      playlistsCleared: updated.count,
      tracksDeleted: deleted.count,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Database write failed while resetting sync state: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Check DATABASE_URL.`,
    };
  }
}

export type ResetArtistCacheResult =
  | { ok: true; rowsDeleted: number }
  | { ok: false; error: string };

// Wipes every Artist cache row. Use when the table has a bunch of
// stale rows from when /v1/artists was returning data (or, more
// recently, from when Spotify started 403'ing the call and we wrote
// rows with empty `genres`). After this, the next stats render
// re-fetches every artist from Last.fm.
export async function resetArtistCache(): Promise<ResetArtistCacheResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error: "Unauthorized: sign in with your Spotify account first.",
    };
  }
  try {
    const deleted = await prisma.artist.deleteMany({});
    revalidatePath("/troubleshooting");
    return { ok: true, rowsDeleted: deleted.count };
  } catch (error) {
    const message =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (/does not exist/i.test(message)) {
      return {
        ok: false,
        error:
          "Artist table doesn't exist yet — click 'Initialize Artist table' below first, then come back.",
      };
    }
    return {
      ok: false,
      error: `Database write failed while resetting artist cache: ${message}. Check DATABASE_URL.`,
    };
  }
}

export type InitPlaylistLinkTableResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

// One-shot DDL to create the UserPlaylistLink table in prod. The project
// uses `prisma db push` instead of migrations, so new tables need to be
// applied to the deployed DB somehow. Idempotent — safe to click twice.
export async function initUserPlaylistLinkTable(): Promise<InitPlaylistLinkTableResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error: "Unauthorized: sign in with your Spotify account first.",
    };
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "UserPlaylistLink" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "playlistId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "UserPlaylistLink_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UserPlaylistLink_userId_playlistId_key" ON "UserPlaylistLink"("userId", "playlistId")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "UserPlaylistLink_userId_idx" ON "UserPlaylistLink"("userId")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "UserPlaylistLink_playlistId_idx" ON "UserPlaylistLink"("playlistId")`,
    );
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserPlaylistLink_userId_fkey') THEN
          ALTER TABLE "UserPlaylistLink"
            ADD CONSTRAINT "UserPlaylistLink_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UserPlaylistLink_playlistId_fkey') THEN
          ALTER TABLE "UserPlaylistLink"
            ADD CONSTRAINT "UserPlaylistLink_playlistId_fkey"
            FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END
      $$
    `);
    revalidatePath("/troubleshooting");
    return {
      ok: true,
      message:
        "UserPlaylistLink table + indexes + FKs are present (created if missing). Safe to click again.",
    };
  } catch (error) {
    return {
      ok: false,
      error: `DDL failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Check DATABASE_URL and that the Prisma connection has CREATE TABLE privileges.`,
    };
  }
}

export type InitCachedResponseTableResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

// Same idempotent DDL pattern as initUserPlaylistLinkTable — see above.
export async function initCachedSpotifyResponseTable(): Promise<InitCachedResponseTableResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error: "Unauthorized: sign in with your Spotify account first.",
    };
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CachedSpotifyResponse" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "data" JSONB NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CachedSpotifyResponse_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "CachedSpotifyResponse_userId_kind_key" ON "CachedSpotifyResponse"("userId", "kind")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "CachedSpotifyResponse_userId_idx" ON "CachedSpotifyResponse"("userId")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "CachedSpotifyResponse_expiresAt_idx" ON "CachedSpotifyResponse"("expiresAt")`,
    );
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CachedSpotifyResponse_userId_fkey') THEN
          ALTER TABLE "CachedSpotifyResponse"
            ADD CONSTRAINT "CachedSpotifyResponse_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END
      $$
    `);
    revalidatePath("/troubleshooting");
    return {
      ok: true,
      message:
        "CachedSpotifyResponse table + indexes + FK are present (created if missing). Safe to click again.",
    };
  } catch (error) {
    return {
      ok: false,
      error: `DDL failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Check DATABASE_URL and that the Prisma connection has CREATE TABLE privileges.`,
    };
  }
}

export type InitArtistTableResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

// Backs the genre-tracker stats card. Cache of /v1/artists responses
// keyed by Spotify artist id, populated on demand by the stats page.
export async function initArtistTable(): Promise<InitArtistTableResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error: "Unauthorized: sign in with your Spotify account first.",
    };
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Artist" (
        "spotifyId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "genres" JSONB NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Artist_pkey" PRIMARY KEY ("spotifyId")
      )
    `);
    revalidatePath("/troubleshooting");
    return {
      ok: true,
      message:
        "Artist table is present (created if missing). Reload /bompton-playlist/stats to backfill genres.",
    };
  } catch (error) {
    return {
      ok: false,
      error: `DDL failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Check DATABASE_URL and that the Prisma connection has CREATE TABLE privileges.`,
    };
  }
}

export type InitListeningSnapshotTableResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

// Backs the longitudinal listening archive. One row per UTC day per
// (user, kind) holding a trimmed snapshot of a window-limited Spotify
// list endpoint (top tracks/artists per range, saved tracks, followed
// artists). Written by /api/archive-listening (daily cron) and by
// dashboard visits. Same idempotent DDL pattern as the others.
export async function initListeningSnapshotTable(): Promise<InitListeningSnapshotTableResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error: "Unauthorized: sign in with your Spotify account first.",
    };
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ListeningSnapshot" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "day" TIMESTAMP(3) NOT NULL,
        "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "itemCount" INTEGER NOT NULL DEFAULT 0,
        "data" JSONB NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ListeningSnapshot_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ListeningSnapshot_userId_kind_day_key" ON "ListeningSnapshot"("userId", "kind", "day")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "ListeningSnapshot_userId_idx" ON "ListeningSnapshot"("userId")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "ListeningSnapshot_userId_kind_idx" ON "ListeningSnapshot"("userId", "kind")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "ListeningSnapshot_userId_kind_day_idx" ON "ListeningSnapshot"("userId", "kind", "day")`,
    );
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ListeningSnapshot_userId_fkey') THEN
          ALTER TABLE "ListeningSnapshot"
            ADD CONSTRAINT "ListeningSnapshot_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END
      $$
    `);
    revalidatePath("/troubleshooting");
    return {
      ok: true,
      message:
        "ListeningSnapshot table + indexes + FK are present (created if missing). Snapshots start banking on the next dashboard visit or daily-sync cron run (or POST /api/archive-listening to backfill now).",
    };
  } catch (error) {
    return {
      ok: false,
      error: `DDL failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Check DATABASE_URL and that the Prisma connection has CREATE TABLE privileges.`,
    };
  }
}

export type InitLateAddNotificationTableResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

// Backs the late-add email nudge (POST /api/late-add-notifications).
// One row per Resend send attempt, successful or not. The 24h cooldown
// lookup reads from this table, so the table missing = no cooldown =
// risk of duplicate sends, so we hard-error rather than silently skip.
export async function initLateAddNotificationTable(): Promise<InitLateAddNotificationTableResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error: "Unauthorized: sign in with your Spotify account first.",
    };
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "LateAddNotification" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "bomptonYear" TEXT NOT NULL,
        "weeksBehind" INTEGER NOT NULL,
        "missedFridays" JSONB NOT NULL,
        "ccEmails" JSONB NOT NULL,
        "emailSubject" TEXT NOT NULL,
        "resendId" TEXT,
        "errorMessage" TEXT,
        CONSTRAINT "LateAddNotification_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "LateAddNotification_userId_idx" ON "LateAddNotification"("userId")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "LateAddNotification_userId_sentAt_idx" ON "LateAddNotification"("userId", "sentAt")`,
    );
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LateAddNotification_userId_fkey') THEN
          ALTER TABLE "LateAddNotification"
            ADD CONSTRAINT "LateAddNotification_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END
      $$
    `);
    revalidatePath("/troubleshooting");
    return {
      ok: true,
      message:
        "LateAddNotification table + indexes + FK are present (created if missing). Set RESEND_API_KEY and RESEND_FROM_EMAIL env vars, then visit /dashboard to fire the first round of nudges.",
    };
  } catch (error) {
    return {
      ok: false,
      error: `DDL failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Check DATABASE_URL and that the Prisma connection has CREATE TABLE privileges.`,
    };
  }
}

export type InitFridayReminderTableResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

// Backs the crew-wide Friday reminder (GET|POST /api/friday-reminder).
// One row per weekly send attempt, successful or not. The per-week dedupe
// lookup reads from this table keyed on `weekOf`, so if it's missing the
// route hard-errors rather than risk a duplicate crew-wide blast. No FK —
// this is a broadcast email, not per-user. Idempotent — safe to click twice.
export async function initFridayReminderTable(): Promise<InitFridayReminderTableResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error: "Unauthorized: sign in with your Spotify account first.",
    };
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "FridayReminderNotification" (
        "id" TEXT NOT NULL,
        "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "bomptonYear" TEXT NOT NULL,
        "weekOf" TIMESTAMP(3) NOT NULL,
        "personaKey" TEXT NOT NULL,
        "recipients" JSONB NOT NULL,
        "resendId" TEXT,
        "errorMessage" TEXT,
        CONSTRAINT "FridayReminderNotification_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "FridayReminderNotification_weekOf_idx" ON "FridayReminderNotification"("weekOf")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "FridayReminderNotification_sentAt_idx" ON "FridayReminderNotification"("sentAt")`,
    );
    revalidatePath("/troubleshooting");
    return {
      ok: true,
      message:
        "FridayReminderNotification table + indexes are present (created if missing). Set RESEND_API_KEY and RESEND_FROM_EMAIL env vars; the Friday-noon Vercel cron (or POST /api/friday-reminder) will fire the first hype email.",
    };
  } catch (error) {
    return {
      ok: false,
      error: `DDL failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Check DATABASE_URL and that the Prisma connection has CREATE TABLE privileges.`,
    };
  }
}

export type InitListeningPlayTableResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

// Backs the listening-dedication stats card. Append-only mirror of
// /me/player/recently-played per crew member; populated each time
// someone visits /dashboard.
export async function initListeningPlayTable(): Promise<InitListeningPlayTableResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error: "Unauthorized: sign in with your Spotify account first.",
    };
  }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ListeningPlay" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "trackSpotifyId" TEXT NOT NULL,
        "trackName" TEXT NOT NULL,
        "trackArtist" TEXT NOT NULL,
        "trackDurationMs" INTEGER NOT NULL,
        "playedAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ListeningPlay_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ListeningPlay_userId_trackSpotifyId_playedAt_key" ON "ListeningPlay"("userId", "trackSpotifyId", "playedAt")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "ListeningPlay_userId_idx" ON "ListeningPlay"("userId")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "ListeningPlay_userId_playedAt_idx" ON "ListeningPlay"("userId", "playedAt")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "ListeningPlay_trackSpotifyId_idx" ON "ListeningPlay"("trackSpotifyId")`,
    );
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ListeningPlay_userId_fkey') THEN
          ALTER TABLE "ListeningPlay"
            ADD CONSTRAINT "ListeningPlay_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END
      $$
    `);
    revalidatePath("/troubleshooting");
    return {
      ok: true,
      message:
        "ListeningPlay table + indexes + FK are present (created if missing). Visit /dashboard for each crew member to start banking plays.",
    };
  } catch (error) {
    return {
      ok: false,
      error: `DDL failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Check DATABASE_URL and that the Prisma connection has CREATE TABLE privileges.`,
    };
  }
}
