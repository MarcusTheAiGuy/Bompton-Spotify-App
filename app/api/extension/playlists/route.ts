import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ExtensionAuthError,
  extensionAuthErrorResponse,
  requireExtensionToken,
} from "@/lib/extension-auth";
import { getPlaylists } from "@/lib/spotify";
import {
  BOMPTON_YEARS,
  findBomptonPlaylist,
  type BomptonYear,
} from "@/lib/bompton";
import { describeSpotifyError } from "@/lib/describe-spotify-error";

export const dynamic = "force-dynamic";

type PlaylistDescriptor = {
  id: string;
  name: string;
  year: BomptonYear;
  // The snapshot_id we have stored for this playlist, if any. The extension
  // uses this to short-circuit syncs when the upstream Spotify snapshot_id
  // still matches.
  storedSnapshotId: string | null;
};

export async function GET(request: NextRequest) {
  let userId: string;
  try {
    const auth = await requireExtensionToken(request);
    userId = auth.userId;
  } catch (error) {
    if (error instanceof ExtensionAuthError) {
      return extensionAuthErrorResponse(error);
    }
    throw error;
  }

  let spotifyPlaylists;
  try {
    const response = await getPlaylists(userId, 50);
    spotifyPlaylists = response.items;
  } catch (error) {
    const described = describeSpotifyError(error);
    return NextResponse.json(
      {
        error: "SpotifyError",
        message: `Couldn't list the token-owner's Spotify playlists: ${described.title}. ${described.detail}`,
      },
      { status: 502 },
    );
  }

  const stored = await prisma.playlist.findMany({
    select: { id: true, snapshotId: true },
  });
  const snapshotByPlaylistId = new Map(
    stored.map((p) => [p.id, p.snapshotId] as const),
  );

  const descriptors: PlaylistDescriptor[] = [];
  for (const year of BOMPTON_YEARS) {
    const match = findBomptonPlaylist(spotifyPlaylists, year);
    if (!match) continue;
    descriptors.push({
      id: match.id,
      name: match.name,
      year,
      storedSnapshotId: snapshotByPlaylistId.get(match.id) ?? null,
    });
  }

  return NextResponse.json({ playlists: descriptors });
}
