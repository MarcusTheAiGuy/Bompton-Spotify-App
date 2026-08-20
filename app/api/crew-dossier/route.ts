import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildCrewDossier } from "@/lib/crew-dossier";

export const dynamic = "force-dynamic";

// TEMPORARY — see the header comment in lib/crew-dossier.ts for what this is
// and how to remove it.
//
// GET /api/crew-dossier
// Returns a markdown dump of every Bompton playlist track grouped by who
// added it, plus per-member outlier stats. Read-only. Signed-in crew only —
// the data is harmless but there's no reason to serve it anonymously.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message:
          "Not signed in. /api/crew-dossier needs a Spotify session — sign in at / and retry.",
      },
      { status: 401 },
    );
  }

  try {
    const { markdown, playlistCount, trackCount } = await buildCrewDossier();
    if (trackCount === 0) {
      return NextResponse.json(
        {
          error: "NoTracks",
          message:
            "Found no Bompton playlist tracks in the database. Either the playlists have never been synced (open /bompton-playlist as the playlist owner to trigger a sync) or the Playlist rows don't match a name in BOMPTON_YEARS.",
        },
        { status: 422 },
      );
    }
    console.log("[crew-dossier]", {
      callerId: session.user.id,
      playlistCount,
      trackCount,
      bytes: markdown.length,
    });
    return new NextResponse(markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": 'attachment; filename="bompton-dossier.md"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[crew-dossier.failed]", {
      callerId: session.user.id,
      name,
      message,
    });
    return NextResponse.json(
      {
        error: name,
        message: `Failed to build the crew dossier: ${message}. Check DATABASE_URL and that Playlist/PlaylistTrack are populated (visit /bompton-playlist to trigger a sync).`,
      },
      { status: 500 },
    );
  }
}
