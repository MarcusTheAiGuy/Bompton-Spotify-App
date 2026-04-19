import {
  SpotifyAccountMissingError,
  SpotifyError,
  SpotifyRefreshFailedError,
} from "@/lib/spotify";

export type DescribedError = { title: string; detail: string };

export function describeSpotifyError(error: unknown): DescribedError {
  if (error instanceof SpotifyAccountMissingError) {
    return {
      title: "No Spotify account linked for this user",
      detail: `userId=${error.userId}. They need to visit the site and click Connect Spotify at least once.`,
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
    if (
      error.status === 403 &&
      /^\/playlists\/[^/]+\/tracks/.test(error.path)
    ) {
      return {
        title: "Spotify blocks track-listing for this playlist",
        detail:
          "Spotify returned 403 Forbidden. Known causes (no client-side fix for any of them):\n\n" +
          "1. The playlist is algorithmic or editorial (owner 'spotify' — Daily Mix, Discover Weekly, Today's Top Hits, etc.). Nov 2024 API deprecation.\n" +
          "2. It's a Blend or collaborative playlist with restricted track-listing.\n" +
          "3. This Spotify app is in development mode and hasn't been granted extended-quota access — Spotify restricts /playlists/{id}/tracks for dev apps created after Nov 2024.\n\n" +
          "If #3 is it, apply for quota extension in the Spotify developer dashboard. Open in Spotify to see the songs in the meantime.",
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
