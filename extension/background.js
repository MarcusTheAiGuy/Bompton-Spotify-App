// Bompton sync service worker.
//
// Responsibilities:
//   1. Ask the Bompton backend for a Spotify access token, which the backend
//      mints by refreshing the caller's stored NextAuth Spotify OAuth grant.
//      We used to scrape open.spotify.com/get_access_token directly, but
//      Spotify rolled out TOTP-based anti-scraping on that endpoint and it
//      now returns 403 "URL Blocked" / error 54113 at the Fastly edge.
//   2. Page through /v1/playlists/{id}/tracks for each Bompton playlist.
//   3. POST sanitized track rows to the Bompton app's /api/extension/sync.
//   4. Run on a chrome.alarms cadence plus on manual trigger from the popup.

const DEFAULT_BACKEND_ORIGIN = "https://bompton.vercel.app";
const SYNC_ALARM = "bompton-sync";
const SYNC_PERIOD_MINUTES = 60;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, {
    periodInMinutes: SYNC_PERIOD_MINUTES,
    delayInMinutes: 1,
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, {
    periodInMinutes: SYNC_PERIOD_MINUTES,
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  await runSync("alarm");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message?.type === "sync-now") {
        const result = await runSync("manual");
        sendResponse({ ok: true, result });
      } else if (message?.type === "test-connection") {
        const result = await testConnection();
        sendResponse({ ok: true, result });
      } else if (message?.type === "get-status") {
        const status = await readStatus();
        sendResponse({ ok: true, status });
      } else {
        sendResponse({ ok: false, error: `Unknown message ${message?.type}` });
      }
    } catch (error) {
      sendResponse({
        ok: false,
        error: formatError(error),
      });
    }
  })();
  return true; // keep the message channel open for the async response
});

async function readConfig() {
  const { backendOrigin, bearerToken } = await chrome.storage.local.get([
    "backendOrigin",
    "bearerToken",
  ]);
  return {
    backendOrigin: backendOrigin || DEFAULT_BACKEND_ORIGIN,
    bearerToken: bearerToken || null,
  };
}

async function readStatus() {
  const { lastSyncAt, lastSyncResult, lastError, lastRunAt } =
    await chrome.storage.local.get([
      "lastSyncAt",
      "lastSyncResult",
      "lastError",
      "lastRunAt",
    ]);
  const config = await readConfig();
  return {
    backendOrigin: config.backendOrigin,
    hasToken: Boolean(config.bearerToken),
    lastSyncAt: lastSyncAt ?? null,
    lastSyncResult: lastSyncResult ?? null,
    lastError: lastError ?? null,
    lastRunAt: lastRunAt ?? null,
    version: chrome.runtime.getManifest().version,
  };
}

async function writeStatus(patch) {
  await chrome.storage.local.set(patch);
}

async function getSpotifyAccessToken(backendOrigin, bearerToken) {
  const cached = await chrome.storage.session.get(["spotifyToken"]);
  const now = Date.now();
  if (cached.spotifyToken && cached.spotifyToken.expiresAt > now + 60_000) {
    return cached.spotifyToken.accessToken;
  }
  const response = await fetch(`${backendOrigin}/api/extension/spotify-token`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const detail =
      json?.message ?? text ?? `HTTP ${response.status} ${response.statusText}`;
    throw new Error(
      `GET ${backendOrigin}/api/extension/spotify-token → ${response.status}: ${detail}`,
    );
  }
  if (!json?.accessToken) {
    throw new Error(
      `Backend returned no accessToken. Body: ${text.slice(0, 300)}`,
    );
  }
  // Backend returns expiresAt as unix seconds (from the NextAuth Account row).
  // Fall back to a conservative 30-minute TTL if absent.
  const expiresAtMs =
    typeof json.expiresAt === "number"
      ? json.expiresAt * 1000
      : now + 30 * 60_000;
  const record = { accessToken: json.accessToken, expiresAt: expiresAtMs };
  await chrome.storage.session.set({ spotifyToken: record });
  return record.accessToken;
}

class SpotifyHttpError extends Error {
  constructor(status, path, body, { afterRetry = false } = {}) {
    const suffix = afterRetry ? " after retry" : "";
    super(
      `Spotify API ${status} on ${path}${suffix}. Body: ${String(body).slice(0, 300)}`,
    );
    this.name = "SpotifyHttpError";
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

async function spotifyGet(path) {
  const { backendOrigin, bearerToken } = await readConfig();
  if (!bearerToken) {
    throw new Error(
      "Extension is not configured. Paste an auth token (generated at /extension-setup) into the popup and click Save.",
    );
  }
  const token = await getSpotifyAccessToken(backendOrigin, bearerToken);
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    // Token expired mid-flight. Drop session cache and retry once.
    await chrome.storage.session.remove("spotifyToken");
    const fresh = await getSpotifyAccessToken(backendOrigin, bearerToken);
    const retry = await fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${fresh}` },
    });
    if (!retry.ok) {
      const body = await retry.text().catch(() => "");
      throw new SpotifyHttpError(retry.status, path, body, { afterRetry: true });
    }
    return retry.json();
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new SpotifyHttpError(response.status, path, body);
  }
  return response.json();
}

async function fetchPlaylistSnapshot(playlistId) {
  const fields = "snapshot_id,name,owner(id,display_name),images,tracks(total)";
  const data = await spotifyGet(
    `/playlists/${playlistId}?fields=${encodeURIComponent(fields)}`,
  );
  return {
    snapshotId: data.snapshot_id ?? null,
    name: data.name ?? "",
    ownerId: data.owner?.id ?? null,
    ownerName: data.owner?.display_name ?? null,
    imageUrl: data.images?.[0]?.url ?? null,
    totalTracks: data.tracks?.total ?? 0,
  };
}

async function fetchPlaylistTracks(playlistId, expectedTotal) {
  try {
    const items = await fetchPlaylistTracksViaTracksEndpoint(playlistId);
    if (items.length === 0 && expectedTotal > 0) {
      // Primary 200 OK with empty items — Spotify sometimes returns this
      // when the token can reach the endpoint but isn't authorized to read
      // the track list (app not in Extended Quota Mode, user not listed
      // under User Management, etc). Retry via the detail endpoint.
      return fetchPlaylistTracksViaDetail(
        playlistId,
        expectedTotal,
        `/playlists/${playlistId}/tracks returned 200 with 0 items (snapshot reported ${expectedTotal} total)`,
      );
    }
    return items;
  } catch (error) {
    if (error instanceof SpotifyHttpError && error.status === 403) {
      // Known Spotify quirk: /playlists/{id}/tracks 403s on some app
      // configurations even when /playlists/{id} itself is readable (the
      // snapshot call at fetchPlaylistSnapshot proves that worked, or we
      // wouldn't be here). Mirror the server-side fallback in
      // lib/spotify.ts:fetchFromPlaylistEndpoint: read the inline tracks
      // from the detail endpoint.
      return fetchPlaylistTracksViaDetail(
        playlistId,
        expectedTotal,
        `/playlists/${playlistId}/tracks returned 403`,
      );
    }
    throw error;
  }
}

async function fetchPlaylistTracksViaTracksEndpoint(playlistId) {
  const fields =
    "items(added_at,added_by.id,is_local,track(id,name,uri,duration_ms,explicit,preview_url,album(name,images),artists(id,name,uri))),next,total";
  const items = [];
  let url = `/playlists/${playlistId}/tracks?limit=100&fields=${encodeURIComponent(fields)}&additional_types=track`;
  let position = 0;
  while (url) {
    const page = await spotifyGet(url);
    for (const raw of page.items ?? []) {
      items.push(normalizeTrackItem(raw, position));
      position += 1;
    }
    if (!page.next) break;
    const nextUrl = new URL(page.next);
    url = `${nextUrl.pathname.replace(/^\/v1/, "")}${nextUrl.search}`;
  }
  return items;
}

async function fetchPlaylistTracksViaDetail(playlistId, expectedTotal, reason) {
  // Mirror lib/spotify.ts:fetchFromPlaylistEndpoint exactly — no `fields`
  // filter, just fetch the full playlist object and read tracks.items. The
  // detail endpoint inlines up to 100 tracks and does not accept offset/limit
  // for the embedded tracks, so we refuse to overwrite stored data if
  // total > 100 and surface the remediation inline.
  const detail = await spotifyGet(
    `/playlists/${playlistId}?additional_types=track`,
  );
  const inline = detail?.tracks;
  const items = [];
  let position = 0;
  for (const raw of inline?.items ?? []) {
    items.push(normalizeTrackItem(raw, position));
    position += 1;
  }
  const total =
    typeof inline?.total === "number" ? inline.total : items.length;
  if (total > items.length) {
    throw new Error(
      `${reason}, and the fallback via /playlists/${playlistId} only exposes the first ${items.length} of ${total} tracks. ` +
        `Fix in the Spotify Developer Dashboard (https://developer.spotify.com/dashboard → this app → Settings): ` +
        `either request Extended Quota Mode, or (if the app is in Development Mode) add every crew member as a user under User Management. ` +
        `Refusing to sync partial data.`,
    );
  }
  if (items.length === 0 && expectedTotal > 0) {
    throw new Error(
      `${reason}, and the fallback via /playlists/${playlistId} also returned 0 tracks (snapshot reported ${expectedTotal} total). ` +
        `Most likely the Spotify app lacks Extended Quota Mode or this user isn't listed under the app's User Management. ` +
        `Fix at https://developer.spotify.com/dashboard → this app → Settings.`,
    );
  }
  return items;
}

function normalizeTrackItem(raw, position) {
  const track = raw.track
    ? {
        id: raw.track.id ?? null,
        name: raw.track.name ?? "(unavailable)",
        uri: raw.track.uri ?? "",
        durationMs: raw.track.duration_ms ?? 0,
        explicit: Boolean(raw.track.explicit),
        previewUrl: raw.track.preview_url ?? null,
        albumName: raw.track.album?.name ?? "",
        albumImageUrl: raw.track.album?.images?.[0]?.url ?? null,
        artists: (raw.track.artists ?? []).map((a) => ({
          id: a.id ?? null,
          name: a.name ?? "",
          uri: a.uri ?? null,
        })),
      }
    : null;
  return {
    position,
    addedAt: raw.added_at,
    addedBySpotifyId: raw.added_by?.id ?? null,
    isLocal: Boolean(raw.is_local),
    track,
  };
}

async function pushSync(backendOrigin, bearerToken, payload) {
  const response = await fetch(`${backendOrigin}/api/extension/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const detail =
      json?.message ?? text ?? `HTTP ${response.status} ${response.statusText}`;
    throw new Error(
      `POST ${backendOrigin}/api/extension/sync → ${response.status}: ${detail}`,
    );
  }
  return json;
}

async function runSync(trigger) {
  const startedAt = new Date().toISOString();
  await writeStatus({ lastRunAt: startedAt, lastError: null });

  const { backendOrigin, bearerToken } = await readConfig();
  if (!bearerToken) {
    const error =
      "Extension is not configured. Paste an auth token (generated at /extension-setup) into the popup and click Save.";
    await writeStatus({ lastError: error });
    throw new Error(error);
  }

  // 1. Ask backend which playlists to sync + last-known snapshots.
  const descriptorsResponse = await fetch(
    `${backendOrigin}/api/extension/playlists`,
    { headers: { Authorization: `Bearer ${bearerToken}` } },
  );
  if (!descriptorsResponse.ok) {
    const body = await descriptorsResponse.text().catch(() => "");
    const error = `GET ${backendOrigin}/api/extension/playlists → ${descriptorsResponse.status}: ${body.slice(0, 500)}`;
    await writeStatus({ lastError: error });
    throw new Error(error);
  }
  const { playlists } = await descriptorsResponse.json();

  const perPlaylist = [];
  for (const descriptor of playlists) {
    try {
      const snapshot = await fetchPlaylistSnapshot(descriptor.id);
      const snapshotChanged = snapshot.snapshotId !== descriptor.storedSnapshotId;
      const tracks = snapshotChanged
        ? await fetchPlaylistTracks(descriptor.id, snapshot.totalTracks)
        : undefined;
      const result = await pushSync(backendOrigin, bearerToken, {
        playlist: {
          id: descriptor.id,
          name: snapshot.name || descriptor.name,
          ownerId: snapshot.ownerId,
          ownerName: snapshot.ownerName,
          snapshotId: snapshot.snapshotId,
          imageUrl: snapshot.imageUrl,
          totalTracks: snapshot.totalTracks,
        },
        tracks,
      });
      perPlaylist.push({
        id: descriptor.id,
        year: descriptor.year,
        name: descriptor.name,
        snapshotChanged: result?.snapshotChanged ?? false,
        tracksWritten: result?.tracksWritten ?? 0,
      });
    } catch (error) {
      const msg = formatError(error);
      perPlaylist.push({
        id: descriptor.id,
        year: descriptor.year,
        name: descriptor.name,
        error: msg,
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const firstError = perPlaylist.find((p) => p.error)?.error ?? null;
  const result = { trigger, startedAt, finishedAt, perPlaylist };
  await writeStatus({
    lastSyncAt: finishedAt,
    lastSyncResult: result,
    lastError: firstError,
  });
  if (firstError) {
    throw new Error(firstError);
  }
  return result;
}

async function testConnection() {
  const { backendOrigin, bearerToken } = await readConfig();
  if (!bearerToken) {
    throw new Error("No auth token saved. Paste one and click Save first.");
  }
  const response = await fetch(`${backendOrigin}/api/extension/whoami`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(
      `GET ${backendOrigin}/api/extension/whoami → ${response.status}: ${json?.message ?? text}`,
    );
  }
  return json;
}

function formatError(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
