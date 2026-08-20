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
  sachin221: "Sachin",
  sam55silver: "Sam",
  n8mrhp1paen9qp80qhdwv4oc2: "Evan",
};

// Display names for the DB `name` field. Crew members signed up with
// their full names ("Sachin Mohandas") or with handles ("SamuelSmooth",
// "evanperry") that don't follow a single rule, so a hardcoded map
// is more reliable than a generic "first word, capitalize" heuristic
// (which would mangle "SamuelSmooth" → "Samuelsmooth"). Add a row
// here whenever a new crew member is onboarded.
const CREW_DISPLAY_NAMES: Record<string, string> = {
  "Ben Silver": "Ben",
  SamuelSmooth: "Sam",
  evanperry: "Evan",
  "Sachin Mohandas": "Sachin",
};

const SPOTIFY_USER_DISPLAY_NAMES_LOWER: Record<string, string> =
  Object.fromEntries(
    Object.entries(SPOTIFY_USER_DISPLAY_NAMES).map(([id, name]) => [
      id.toLowerCase(),
      name,
    ]),
  );

// Matched case-insensitively on purpose. The map keys used to be capitalised
// ("Sachin221" / "Sam55Silver") while the real Spotify ids are lower-case, so
// two of the four crew members fell through to their raw id in every track
// list and playlist grid in the app. Normalising on read means a casing slip
// in the table above can't reintroduce that.
export function displaySpotifyUserName(
  spotifyUserId: string | null | undefined,
): string {
  if (!spotifyUserId) return "—";
  return (
    SPOTIFY_USER_DISPLAY_NAMES[spotifyUserId] ??
    SPOTIFY_USER_DISPLAY_NAMES_LOWER[spotifyUserId.toLowerCase()] ??
    spotifyUserId
  );
}

// Resolve a friendly display name for a crew member. Resolution order:
//   1. Hardcoded crew-name map keyed on the stored `name`
//   2. Hardcoded Spotify-id map (covers members whose stored name is
//      missing or whose handle changes upstream)
//   3. First word of the stored name, with leading char uppercased —
//      good enough for "John Smith"-style inputs we don't know about
//   4. Email local-part, capitalized
//   5. "Unknown"
export function displayCrewName(member: {
  name?: string | null;
  email?: string | null;
  spotifyUserId?: string | null;
}): string {
  const trimmedName = member.name?.trim();
  if (trimmedName && CREW_DISPLAY_NAMES[trimmedName]) {
    return CREW_DISPLAY_NAMES[trimmedName];
  }
  if (member.spotifyUserId && SPOTIFY_USER_DISPLAY_NAMES[member.spotifyUserId]) {
    return SPOTIFY_USER_DISPLAY_NAMES[member.spotifyUserId];
  }
  if (trimmedName) {
    const first = trimmedName.split(/\s+/)[0];
    if (first) return first.charAt(0).toUpperCase() + first.slice(1);
  }
  const email = member.email?.trim();
  if (email) {
    const local = email.split("@")[0] ?? "";
    if (local) return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return "Unknown";
}
