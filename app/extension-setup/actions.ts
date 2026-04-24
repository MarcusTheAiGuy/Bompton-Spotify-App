"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateRawToken, hashToken } from "@/lib/extension-auth";

export type GenerateTokenResult =
  | { ok: true; raw: string; tokenId: string }
  | { ok: false; error: string };

export async function generateExtensionToken(
  formData: FormData,
): Promise<GenerateTokenResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error:
        "Unauthorized: sign in with your Spotify account first, then reload /extension-setup.",
    };
  }
  const labelInput = formData.get("label");
  const label =
    typeof labelInput === "string" && labelInput.trim().length > 0
      ? labelInput.trim().slice(0, 120)
      : null;

  const raw = generateRawToken();
  try {
    const token = await prisma.extensionToken.create({
      data: { userId: session.user.id, tokenHash: hashToken(raw), label },
      select: { id: true },
    });
    revalidatePath("/extension-setup");
    return { ok: true, raw, tokenId: token.id };
  } catch (error) {
    return {
      ok: false,
      error: `Database write failed while creating ExtensionToken: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Check DATABASE_URL and that \`npm run db:push\` has been run against the current schema.`,
    };
  }
}

export type RevokeTokenResult =
  | { ok: true; alreadyRevoked: boolean }
  | { ok: false; error: string };

export async function revokeExtensionToken(
  tokenId: string,
): Promise<RevokeTokenResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized: sign in first." };
  }
  const token = await prisma.extensionToken.findUnique({
    where: { id: tokenId },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!token) {
    return { ok: false, error: `No extension token with id ${tokenId}.` };
  }
  if (token.userId !== session.user.id) {
    return {
      ok: false,
      error: `Token ${tokenId} belongs to a different user. You can only revoke your own tokens.`,
    };
  }
  if (token.revokedAt) {
    return { ok: true, alreadyRevoked: true };
  }
  await prisma.extensionToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/extension-setup");
  return { ok: true, alreadyRevoked: false };
}

export type InitPlaylistLinkTableResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type InitCachedResponseTableResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

// Same idempotent DDL pattern as initUserPlaylistLinkTable. Click once
// after deploy so the CachedSpotifyResponse table exists in prod.
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
    revalidatePath("/extension-setup");
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

// One-shot DDL to create the UserPlaylistLink table in prod. The project
// uses `prisma db push` instead of migrations, so new tables need to be
// applied to the deployed DB somehow; this button is the same pattern PR
// #34 used for the ExtensionToken table. Idempotent — safe to click twice.
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
    revalidatePath("/extension-setup");
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

export type ResetSyncStateResult =
  | { ok: true; playlistsCleared: number; tracksDeleted: number }
  | { ok: false; error: string };

// Clears Playlist.snapshotId (and any already-stored PlaylistTrack rows) so
// the next extension sync treats every Bompton playlist as changed and
// re-fetches its full track list. Needed after the v0.1.2 bug that wrote
// current snapshotIds with 0 tracks — without this, v0.1.3 sees snapshot
// unchanged and skips every playlist.
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
    revalidatePath("/extension-setup");
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

