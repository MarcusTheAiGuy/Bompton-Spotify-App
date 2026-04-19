import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPlaylistTracks } from "@/lib/spotify";
import { describeSpotifyError } from "@/lib/describe-spotify-error";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      {
        error: {
          title: "Not signed in",
          detail: "Sign in before requesting playlist tracks.",
        },
      },
      { status: 401 },
    );
  }

  const forUserId = request.nextUrl.searchParams.get("forUserId");
  if (!forUserId) {
    return NextResponse.json(
      {
        error: {
          title: "Missing forUserId",
          detail:
            "Pass ?forUserId=<crew-member-id>. That controls whose Spotify token we use to fetch the tracks.",
        },
      },
      { status: 400 },
    );
  }

  const { id } = await params;

  try {
    const result = await getPlaylistTracks(forUserId, id);
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: describeSpotifyError(error) },
      { status: 500 },
    );
  }
}
