import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/playlists/[id]/stored-tracks
// Returns the tracks we've stored locally for this playlist (from the
// shared Playlist/PlaylistTrack tables), ordered by position. Gated so
// the caller must either have the playlist linked or the playlist must
// be one of the shared Bompton playlists anyone can view.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Not signed in." },
      { status: 401 },
    );
  }
  const { id: playlistId } = await params;
  const userId = session.user.id;

  const link = await prisma.userPlaylistLink.findUnique({
    where: { userId_playlistId: { userId, playlistId } },
  });
  if (!link) {
    return NextResponse.json(
      {
        error: "NotLinked",
        message: `Playlist ${playlistId} isn't linked to your account. Import it from the dashboard first.`,
      },
      { status: 404 },
    );
  }

  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    include: {
      tracks: {
        orderBy: { position: "asc" },
      },
    },
  });
  if (!playlist) {
    return NextResponse.json(
      {
        error: "NotSynced",
        message: `Playlist ${playlistId} is linked but has never been synced. Click "Resync" to pull its tracks from Spotify.`,
      },
      { status: 404 },
    );
  }

  return NextResponse.json({
    playlist: {
      id: playlist.id,
      name: playlist.name,
      ownerId: playlist.ownerId,
      ownerName: playlist.ownerName,
      snapshotId: playlist.snapshotId,
      imageUrl: playlist.imageUrl,
      totalTracks: playlist.totalTracks,
      lastSyncAt: playlist.lastSyncAt?.toISOString() ?? null,
    },
    tracks: playlist.tracks.map((t) => ({
      position: t.position,
      trackSpotifyId: t.trackSpotifyId,
      trackName: t.trackName,
      trackUri: t.trackUri,
      trackDurationMs: t.trackDurationMs,
      trackExplicit: t.trackExplicit,
      trackPreviewUrl: t.trackPreviewUrl,
      albumName: t.albumName,
      albumImageUrl: t.albumImageUrl,
      artists: t.artistsJson,
      addedAt: t.addedAt.toISOString(),
      addedBySpotifyId: t.addedBySpotifyId,
      isLocal: t.isLocal,
    })),
  });
}
