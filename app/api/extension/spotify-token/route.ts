import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ExtensionAuthError,
  extensionAuthErrorResponse,
  requireExtensionToken,
} from "@/lib/extension-auth";
import {
  SpotifyAccountMissingError,
  SpotifyRefreshFailedError,
  getFreshAccessToken,
} from "@/lib/spotify";

export const dynamic = "force-dynamic";

// Mints a Spotify access token for the extension caller.
//
// Why: Spotify rolled out TOTP-based anti-scraping on
// open.spotify.com/get_access_token (the old web-player endpoint returns 403
// "URL Blocked" / error 54113 via their Fastly edge). The extension used to
// scrape that endpoint; now it asks us to hand it a token instead. We refresh
// the user's stored NextAuth OAuth grant, which already has
// playlist-read-private + playlist-read-collaborative scopes.
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

  try {
    const accessToken = await getFreshAccessToken(userId);
    const account = await prisma.account.findFirst({
      where: { userId, provider: "spotify" },
      select: { expires_at: true, scope: true },
    });
    const expiresAt =
      typeof account?.expires_at === "number" ? account.expires_at : null;
    return NextResponse.json({
      accessToken,
      expiresAt,
      scope: account?.scope ?? null,
    });
  } catch (error) {
    if (error instanceof SpotifyAccountMissingError) {
      console.error("[extension.spotify-token.missing-account]", {
        userId,
        message: error.message,
      });
      return NextResponse.json(
        {
          error: error.name,
          message: `${error.message} Fix: visit the site, sign out, sign in with Spotify, then retry.`,
        },
        { status: 409 },
      );
    }
    if (error instanceof SpotifyRefreshFailedError) {
      console.error("[extension.spotify-token.refresh-failed]", {
        userId,
        status: error.status,
        body: error.body,
      });
      return NextResponse.json(
        {
          error: error.name,
          message: `${error.message} Fix: visit the site, sign out, sign in with Spotify again so NextAuth stores a fresh refresh_token.`,
          upstreamStatus: error.status,
          upstreamBody: error.body?.slice(0, 500) ?? "",
        },
        { status: 502 },
      );
    }
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[extension.spotify-token.failed]", {
      userId,
      name,
      message,
      stack,
    });
    return NextResponse.json(
      {
        error: name,
        message: `Couldn't mint a Spotify access token for user ${userId}: ${message}. Check /api/extension/spotify-token server logs.`,
      },
      { status: 500 },
    );
  }
}
