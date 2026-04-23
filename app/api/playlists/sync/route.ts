import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  PlaylistSyncError,
  extractPlaylistId,
  syncPlaylistForUser,
} from "@/lib/playlist-sync";

export const dynamic = "force-dynamic";

// POST /api/playlists/sync
// Body: { playlistInput: string } — a URL, URI, or bare 22-char id.
// Imports (or resyncs) a playlist owned by the signed-in user, writes
// it into the shared Playlist/PlaylistTrack tables, and ensures a
// UserPlaylistLink row exists for (user, playlist).
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message: "Not signed in. Sign in with Spotify and retry.",
      },
      { status: 401 },
    );
  }
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: "BadRequest",
        message: `Request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
      },
      { status: 400 },
    );
  }

  const playlistInput =
    typeof (body as { playlistInput?: unknown })?.playlistInput === "string"
      ? (body as { playlistInput: string }).playlistInput
      : "";
  const playlistId = extractPlaylistId(playlistInput);
  if (!playlistId) {
    return NextResponse.json(
      {
        error: "BadRequest",
        message: `Couldn't find a 22-char Spotify playlist id in ${JSON.stringify(playlistInput)}. Paste a playlist share URL (https://open.spotify.com/playlist/...), a spotify:playlist:... URI, or the bare id.`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await syncPlaylistForUser(userId, playlistId);
    console.log("[playlists.sync]", {
      userId,
      playlistId: result.playlistId,
      tracksWritten: result.tracksWritten,
      snapshotChanged: result.snapshotChanged,
      linkCreated: result.linkCreated,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PlaylistSyncError) {
      console.warn("[playlists.sync.refused]", {
        userId,
        playlistId,
        code: error.code,
        details: error.details,
        message: error.message,
      });
      const statusByCode: Record<PlaylistSyncError["code"], number> = {
        NOT_OWNER: 403,
        NOT_FOUND: 404,
        SPOTIFY_ERROR: 502,
        NO_ACCOUNT: 401,
        INVALID_INPUT: 400,
      };
      return NextResponse.json(
        {
          error: error.name,
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
        { status: statusByCode[error.code] ?? 500 },
      );
    }
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[playlists.sync.failed]", {
      userId,
      playlistId,
      name,
      message,
      stack,
    });
    return NextResponse.json(
      {
        error: name,
        message: `Sync failed for playlist ${playlistId}: ${message}. Check /api/playlists/sync server logs.`,
      },
      { status: 500 },
    );
  }
}
