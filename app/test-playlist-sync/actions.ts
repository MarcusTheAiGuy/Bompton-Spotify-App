"use server";

import { auth } from "@/auth";
import {
  SpotifyError,
  getFreshAccessToken,
  getSpotifyProfile,
} from "@/lib/spotify";

// Temporary diagnostic route to validate the "owner reads own playlist"
// hypothesis under Spotify's Feb-2026 Dev-Mode rules before asking Evan to
// run any sync. Probes a playlist via three different endpoints and reports
// each one's status + body so we can see exactly what succeeds or 403s.

const API_BASE = "https://api.spotify.com/v1";

export type ProbeResult = {
  endpoint: string;
  path: string;
  status: number;
  ok: boolean;
  body: string; // raw response body, truncated
  parsedSummary: string | null; // e.g. "items: 42, total: 208"
};

export type TestPlaylistResult =
  | {
      ok: true;
      playlistId: string;
      callerSpotifyId: string;
      callerDisplayName: string | null;
      playlistName: string | null;
      ownerId: string | null;
      ownerDisplayName: string | null;
      callerIsOwner: boolean;
      totalTracks: number | null;
      snapshotId: string | null;
      probes: ProbeResult[];
      sampleTrackNames: string[]; // up to 5 names from whichever probe returned tracks
    }
  | { ok: false; message: string };

function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Accept bare id, spotify: URI, or open.spotify.com URL.
  const directMatch = trimmed.match(/^[A-Za-z0-9]{22}$/);
  if (directMatch) return trimmed;
  const uriMatch = trimmed.match(/spotify:playlist:([A-Za-z0-9]{22})/);
  if (uriMatch) return uriMatch[1];
  const urlMatch = trimmed.match(/open\.spotify\.com\/(?:[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})/);
  if (urlMatch) return urlMatch[1];
  return null;
}

async function probe(
  token: string,
  path: string,
  endpointLabel: string,
): Promise<ProbeResult> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.text();
  let parsedSummary: string | null = null;
  try {
    const json = body ? JSON.parse(body) : null;
    if (json) {
      if (Array.isArray(json.items)) {
        parsedSummary = `items.length=${json.items.length}, total=${json.total ?? "(absent)"}`;
      } else if (json.tracks && typeof json.tracks === "object") {
        const t = json.tracks as { items?: unknown[]; total?: number };
        parsedSummary = `tracks.items.length=${Array.isArray(t.items) ? t.items.length : "(absent)"}, tracks.total=${t.total ?? "(absent)"}`;
      }
    }
  } catch {
    // fall through; parsedSummary stays null
  }
  return {
    endpoint: endpointLabel,
    path,
    status: response.status,
    ok: response.ok,
    body: body.slice(0, 600),
    parsedSummary,
  };
}

export async function testPlaylistFetch(
  _prev: TestPlaylistResult | null,
  formData: FormData,
): Promise<TestPlaylistResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      ok: false,
      message:
        "Not signed in. Sign in with Spotify via the landing page, then retry.",
    };
  }
  const userId = session.user.id;

  const raw = String(formData.get("playlistInput") ?? "");
  const playlistId = extractPlaylistId(raw);
  if (!playlistId) {
    return {
      ok: false,
      message: `Couldn't find a 22-char Spotify playlist id in ${JSON.stringify(raw)}. Paste a playlist share URL (https://open.spotify.com/playlist/...), a spotify:playlist:... URI, or the bare id.`,
    };
  }

  let token: string;
  try {
    token = await getFreshAccessToken(userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[test-playlist-sync.token-failed]", { userId, message });
    return {
      ok: false,
      message: `Couldn't refresh your Spotify OAuth token: ${message}. Sign out and sign back in.`,
    };
  }

  let profile;
  try {
    profile = await getSpotifyProfile(userId);
  } catch (error) {
    if (error instanceof SpotifyError) {
      console.error("[test-playlist-sync.profile-failed]", {
        userId,
        status: error.status,
        path: error.path,
        body: error.body,
      });
      return {
        ok: false,
        message: `Couldn't fetch /me to identify the caller: ${error.status} on ${error.path}. Body: ${error.body.slice(0, 300)}`,
      };
    }
    throw error;
  }

  // Probe #1: playlist snapshot/metadata. Should succeed even for non-owned
  // playlists — it's the same call background.js makes as `fetchPlaylistSnapshot`.
  const snapshotProbe = await probe(
    token,
    `/playlists/${playlistId}?fields=${encodeURIComponent("id,name,snapshot_id,owner(id,display_name),tracks(total)")}`,
    "snapshot (/playlists/{id} with fields)",
  );

  // Parse owner info from the snapshot probe if we can.
  let playlistName: string | null = null;
  let ownerId: string | null = null;
  let ownerDisplayName: string | null = null;
  let totalTracks: number | null = null;
  let snapshotId: string | null = null;
  if (snapshotProbe.ok) {
    try {
      const json = JSON.parse(snapshotProbe.body);
      playlistName = json.name ?? null;
      ownerId = json.owner?.id ?? null;
      ownerDisplayName = json.owner?.display_name ?? null;
      totalTracks = json.tracks?.total ?? null;
      snapshotId = json.snapshot_id ?? null;
    } catch {
      // leave nulls
    }
  }

  // Probe #2: the NEW Feb-2026 items endpoint.
  const itemsProbe = await probe(
    token,
    `/playlists/${playlistId}/items?limit=5&additional_types=track,episode`,
    "new /items (post-Feb-2026)",
  );

  // Probe #3: the OLD /tracks endpoint — was removed in Feb 2026 per the
  // migration guide, but Spotify may still route it. Test it to see.
  const tracksProbe = await probe(
    token,
    `/playlists/${playlistId}/tracks?limit=5&additional_types=track,episode`,
    "old /tracks (pre-Feb-2026, officially removed)",
  );

  const callerIsOwner = ownerId !== null && profile.id === ownerId;

  // Gather sample track names from whichever probe returned tracks.
  const sampleTrackNames: string[] = [];
  for (const probeResult of [itemsProbe, tracksProbe]) {
    if (sampleTrackNames.length > 0) break;
    if (!probeResult.ok) continue;
    try {
      const json = JSON.parse(probeResult.body);
      const items = Array.isArray(json.items) ? json.items : [];
      for (const item of items) {
        const name = item?.track?.name;
        if (typeof name === "string") sampleTrackNames.push(name);
      }
    } catch {
      // ignore
    }
  }

  console.log("[test-playlist-sync]", {
    userId,
    callerSpotifyId: profile.id,
    playlistId,
    ownerId,
    callerIsOwner,
    snapshotStatus: snapshotProbe.status,
    itemsStatus: itemsProbe.status,
    tracksStatus: tracksProbe.status,
    totalTracks,
  });

  return {
    ok: true,
    playlistId,
    callerSpotifyId: profile.id,
    callerDisplayName: profile.display_name ?? null,
    playlistName,
    ownerId,
    ownerDisplayName,
    callerIsOwner,
    totalTracks,
    snapshotId,
    probes: [snapshotProbe, itemsProbe, tracksProbe],
    sampleTrackNames,
  };
}
