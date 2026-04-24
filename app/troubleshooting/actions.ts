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
