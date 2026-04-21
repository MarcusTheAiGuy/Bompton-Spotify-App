import { prisma } from "@/lib/prisma";

// Raw SQL that mirrors `prisma db push` for the three tables added in the
// extension sync feature. Every statement is idempotent so running this
// twice is a no-op.
//
// This exists so a crew member can initialize the schema by clicking a
// button on /extension-setup instead of needing CLI + DATABASE_URL access.
// Once the tables exist in every environment, the button and this module
// should be removed.
const SETUP_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "Playlist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerName" TEXT,
    "snapshotId" TEXT,
    "imageUrl" TEXT,
    "totalTracks" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "PlaylistTrack" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "trackSpotifyId" TEXT,
    "trackName" TEXT NOT NULL,
    "trackUri" TEXT NOT NULL,
    "trackDurationMs" INTEGER NOT NULL,
    "trackExplicit" BOOLEAN NOT NULL DEFAULT false,
    "trackPreviewUrl" TEXT,
    "albumName" TEXT NOT NULL,
    "albumImageUrl" TEXT,
    "artistsJson" JSONB NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL,
    "addedBySpotifyId" TEXT,
    "isLocal" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PlaylistTrack_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PlaylistTrack_playlistId_position_key"
    ON "PlaylistTrack"("playlistId", "position")`,
  `CREATE INDEX IF NOT EXISTS "PlaylistTrack_playlistId_idx"
    ON "PlaylistTrack"("playlistId")`,
  `CREATE INDEX IF NOT EXISTS "PlaylistTrack_addedBySpotifyId_idx"
    ON "PlaylistTrack"("addedBySpotifyId")`,
  `DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'PlaylistTrack_playlistId_fkey'
    ) THEN
      ALTER TABLE "PlaylistTrack" ADD CONSTRAINT "PlaylistTrack_playlistId_fkey"
        FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
  `CREATE TABLE IF NOT EXISTS "ExtensionToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ExtensionToken_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ExtensionToken_tokenHash_key"
    ON "ExtensionToken"("tokenHash")`,
  `CREATE INDEX IF NOT EXISTS "ExtensionToken_userId_idx"
    ON "ExtensionToken"("userId")`,
  `DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'ExtensionToken_userId_fkey'
    ) THEN
      ALTER TABLE "ExtensionToken" ADD CONSTRAINT "ExtensionToken_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];

export async function runExtensionSchemaSetup(): Promise<void> {
  // $transaction guarantees all-or-nothing. Every statement is idempotent
  // so re-running is safe if the button gets clicked twice.
  await prisma.$transaction(
    SETUP_STATEMENTS.map((sql) => prisma.$executeRawUnsafe(sql)),
  );
}

export async function extensionTablesExist(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ ready: boolean }[]>(
    `SELECT (
      to_regclass('public."Playlist"') IS NOT NULL
      AND to_regclass('public."PlaylistTrack"') IS NOT NULL
      AND to_regclass('public."ExtensionToken"') IS NOT NULL
    ) AS ready`,
  );
  return Boolean(rows[0]?.ready);
}
