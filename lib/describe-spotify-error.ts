import {
  SpotifyAccountMissingError,
  SpotifyError,
  SpotifyReauthRequiredError,
  SpotifyRefreshFailedError,
} from "@/lib/spotify";

// `reauthRequired` lets callers (e.g. the dashboard API route) turn this
// into a 401 + sign-in prompt rather than a generic error banner.
export type DescribedError = {
  title: string;
  detail: string;
  reauthRequired?: boolean;
};

export function describeSpotifyError(error: unknown): DescribedError {
  if (error instanceof SpotifyReauthRequiredError) {
    return {
      title: "Your Spotify session expired — sign in again",
      detail:
        `${error.message}\n\n` +
        "Spotify refresh tokens expire after six months (change effective July 20, 2026). " +
        "The dead token has been discarded automatically, so this won't retry in a loop. " +
        "Click Connect Spotify (or sign out and back in) to reauthorize and issue a fresh token.",
      reauthRequired: true,
    };
  }
  if (error instanceof SpotifyAccountMissingError) {
    return {
      title: "No Spotify account linked for this user",
      detail: `userId=${error.userId}. They need to visit the site and click Connect Spotify at least once.`,
      reauthRequired: true,
    };
  }
  if (error instanceof SpotifyRefreshFailedError) {
    return {
      title: "Couldn't refresh this user's Spotify token",
      detail: `Status ${error.status}. ${error.message}\n\nResponse body: ${error.body}`,
    };
  }
  if (error instanceof SpotifyError) {
    if (
      error.status === 403 &&
      /Insufficient client scope/i.test(error.body)
    ) {
      return {
        title: `Missing OAuth scope for ${error.path}`,
        detail:
          `Spotify returned 403 "Insufficient client scope". The stored access token predates a scope we added to the app.\n\nFix: sign out (top-right button), then click Connect Spotify again so Spotify re-issues a token with the new scopes.\n\nRaw response: ${error.body}`,
      };
    }
    if (error.status === 403 && /^\/playlists\/[^/]+/.test(error.path)) {
      return {
        title: "Spotify blocks this playlist for our app",
        detail:
          "Spotify returned 403 Forbidden on both /playlists/{id}/tracks and /playlists/{id}. Since every playlist 403s (not just one), this is an app-level restriction, not a per-playlist issue.\n\n" +
          "Most likely: the Spotify app was created after Nov 27 2024 and its playlist-read endpoints require Extended Quota Mode approval. Apply at:\n" +
          "https://developer.spotify.com/dashboard → your app → Settings → User Management / Extensions → Request extension.\n\n" +
          "Less likely: the stored access token is stale and doesn't have playlist-read-private / playlist-read-collaborative despite the consent screen. Try signing out and connecting Spotify again.\n\n" +
          "Until that's resolved, use the 'open in Spotify ↗' link on each row.",
      };
    }
    return {
      title: `Spotify API returned ${error.status} on ${error.path}`,
      detail: `${error.message}\n\nResponse body: ${error.body}`,
    };
  }
  if (error instanceof Error) {
    return {
      title: error.name,
      detail: `${error.message}\n\n${error.stack ?? ""}`,
    };
  }
  return { title: "Unknown error", detail: String(error) };
}

export async function settleSpotify<T>(
  promise: Promise<T>,
): Promise<{ value: T; error: null } | { value: null; error: DescribedError }> {
  try {
    return { value: await promise, error: null };
  } catch (error) {
    return { value: null, error: describeSpotifyError(error) };
  }
}
