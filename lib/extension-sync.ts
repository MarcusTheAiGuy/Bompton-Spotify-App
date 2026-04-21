import { prisma } from "@/lib/prisma";

export type ExtensionSyncArtist = {
  id: string | null;
  name: string;
  uri: string | null;
};

export type ExtensionSyncTrackItem = {
  position: number;
  addedAt: string;
  addedBySpotifyId: string | null;
  isLocal: boolean;
  track: {
    id: string | null;
    name: string;
    uri: string;
    durationMs: number;
    explicit: boolean;
    previewUrl: string | null;
    albumName: string;
    albumImageUrl: string | null;
    artists: ExtensionSyncArtist[];
  } | null;
};

export type ExtensionSyncPayload = {
  playlist: {
    id: string;
    name: string;
    ownerId: string | null;
    ownerName: string | null;
    snapshotId: string | null;
    imageUrl: string | null;
    totalTracks: number;
  };
  // When `tracks` is omitted, the extension is telling us "snapshot matched,
  // no work to do" — we just bump lastSyncAt.
  tracks?: ExtensionSyncTrackItem[];
};

export class ExtensionSyncValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionSyncValidationError";
  }
}

export function validateExtensionSyncPayload(
  body: unknown,
): ExtensionSyncPayload {
  if (!body || typeof body !== "object") {
    throw new ExtensionSyncValidationError(
      `Body must be a JSON object. Got: ${typeof body}.`,
    );
  }
  const b = body as Record<string, unknown>;
  const p = b.playlist;
  if (!p || typeof p !== "object") {
    throw new ExtensionSyncValidationError(
      "Body.playlist is required and must be an object.",
    );
  }
  const pl = p as Record<string, unknown>;
  if (typeof pl.id !== "string" || pl.id.length === 0) {
    throw new ExtensionSyncValidationError(
      "Body.playlist.id is required (Spotify playlist ID).",
    );
  }
  if (typeof pl.name !== "string") {
    throw new ExtensionSyncValidationError("Body.playlist.name is required.");
  }
  if (typeof pl.totalTracks !== "number") {
    throw new ExtensionSyncValidationError(
      "Body.playlist.totalTracks must be a number.",
    );
  }
  const tracks = b.tracks;
  if (tracks !== undefined && !Array.isArray(tracks)) {
    throw new ExtensionSyncValidationError(
      "Body.tracks must be an array if present.",
    );
  }
  return body as ExtensionSyncPayload;
}

export type ExtensionSyncResult = {
  ok: true;
  snapshotChanged: boolean;
  tracksWritten: number;
};

// Upserts the Playlist row. If snapshotId matches what we have stored, skips
// track writes entirely and just bumps lastSyncAt. Otherwise replaces the
// playlist's tracks atomically.
export async function applyExtensionSync(
  payload: ExtensionSyncPayload,
  actingUserId: string,
): Promise<ExtensionSyncResult> {
  const { playlist, tracks } = payload;

  const existing = await prisma.playlist.findUnique({
    where: { id: playlist.id },
    select: { snapshotId: true },
  });

  const snapshotChanged =
    !existing ||
    existing.snapshotId !== playlist.snapshotId ||
    playlist.snapshotId == null;

  if (!snapshotChanged || tracks === undefined) {
    await prisma.playlist.upsert({
      where: { id: playlist.id },
      create: {
        id: playlist.id,
        name: playlist.name,
        ownerId: playlist.ownerId,
        ownerName: playlist.ownerName,
        snapshotId: playlist.snapshotId,
        imageUrl: playlist.imageUrl,
        totalTracks: playlist.totalTracks,
        lastSyncAt: new Date(),
        lastSyncBy: actingUserId,
      },
      update: {
        name: playlist.name,
        ownerId: playlist.ownerId,
        ownerName: playlist.ownerName,
        imageUrl: playlist.imageUrl,
        totalTracks: playlist.totalTracks,
        lastSyncAt: new Date(),
        lastSyncBy: actingUserId,
      },
    });
    return {
      ok: true,
      snapshotChanged: false,
      tracksWritten: 0,
    };
  }

  const rows = (tracks ?? []).map((item) => ({
    playlistId: playlist.id,
    position: item.position,
    trackSpotifyId: item.track?.id ?? null,
    trackName: item.track?.name ?? "(unavailable)",
    trackUri: item.track?.uri ?? "",
    trackDurationMs: item.track?.durationMs ?? 0,
    trackExplicit: item.track?.explicit ?? false,
    trackPreviewUrl: item.track?.previewUrl ?? null,
    albumName: item.track?.albumName ?? "",
    albumImageUrl: item.track?.albumImageUrl ?? null,
    artistsJson: item.track?.artists ?? [],
    addedAt: new Date(item.addedAt),
    addedBySpotifyId: item.addedBySpotifyId,
    isLocal: item.isLocal,
  }));

  await prisma.$transaction([
    prisma.playlist.upsert({
      where: { id: playlist.id },
      create: {
        id: playlist.id,
        name: playlist.name,
        ownerId: playlist.ownerId,
        ownerName: playlist.ownerName,
        snapshotId: playlist.snapshotId,
        imageUrl: playlist.imageUrl,
        totalTracks: playlist.totalTracks,
        lastSyncAt: new Date(),
        lastSyncBy: actingUserId,
      },
      update: {
        name: playlist.name,
        ownerId: playlist.ownerId,
        ownerName: playlist.ownerName,
        snapshotId: playlist.snapshotId,
        imageUrl: playlist.imageUrl,
        totalTracks: playlist.totalTracks,
        lastSyncAt: new Date(),
        lastSyncBy: actingUserId,
      },
    }),
    prisma.playlistTrack.deleteMany({ where: { playlistId: playlist.id } }),
    prisma.playlistTrack.createMany({ data: rows }),
  ]);

  return {
    ok: true,
    snapshotChanged: true,
    tracksWritten: rows.length,
  };
}
