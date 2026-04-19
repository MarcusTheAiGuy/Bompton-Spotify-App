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
    if (error.status === 403 && error.path.startsWith("/audio-features")) {
      return {
        title: "/audio-features is deprecated for this app",
        detail:
          "Spotify deprecated /audio-features (and /audio-analysis) for apps created after late 2024. This isn't fixable client-side — Spotify's docs even list it as withdrawn. If they ever grant this app the legacy allowlist, this section will start working automatically.",
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
