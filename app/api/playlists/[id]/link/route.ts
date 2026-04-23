import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// DELETE /api/playlists/[id]/link
// Removes the signed-in user's UserPlaylistLink for this playlist.
// Playlist + PlaylistTrack rows are left alone in case other users still
// have the playlist linked.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message: "Not signed in.",
      },
      { status: 401 },
    );
  }
  const { id: playlistId } = await params;
  const userId = session.user.id;

  try {
    const deleted = await prisma.userPlaylistLink.deleteMany({
      where: { userId, playlistId },
    });
    console.log("[playlists.link.deleted]", {
      userId,
      playlistId,
      count: deleted.count,
    });
    return NextResponse.json({ ok: true, removed: deleted.count });
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[playlists.link.delete.failed]", {
      userId,
      playlistId,
      name,
      message,
    });
    return NextResponse.json(
      {
        error: name,
        message: `Failed to remove link for playlist ${playlistId}: ${message}.`,
      },
      { status: 500 },
    );
  }
}
