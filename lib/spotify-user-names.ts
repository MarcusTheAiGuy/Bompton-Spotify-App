// Maps raw Spotify user ids to friendly display names for the crew. The
// Spotify API returns added_by as whatever id the user picked (or was
// assigned) at account creation — sometimes it's a legible handle like
// "ben.silver-ca", sometimes it's a random base62 id like
// "n8mrhp1paen9qp80qhdwv4oc2". We'd rather show "Ben" / "Evan".
//
// Add new crew members here as they're onboarded. Unmapped ids fall
// through to their raw form so nothing silently disappears.

const SPOTIFY_USER_DISPLAY_NAMES: Record<string, string> = {
  "ben.silver-ca": "Ben",
  Sachin221: "Sachin",
  Sam55Silver: "Sam",
  n8mrhp1paen9qp80qhdwv4oc2: "Evan",
};

export function displaySpotifyUserName(
  spotifyUserId: string | null | undefined,
): string {
  if (!spotifyUserId) return "—";
  return SPOTIFY_USER_DISPLAY_NAMES[spotifyUserId] ?? spotifyUserId;
}
