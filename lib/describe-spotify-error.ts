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
