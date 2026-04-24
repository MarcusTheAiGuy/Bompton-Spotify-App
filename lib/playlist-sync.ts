import { prisma } from "@/lib/prisma";
import {
  SpotifyError,
  getFreshAccessToken,
  spotifyFetch,
  type SpotifyProfile,
} from "@/lib/spotify";
import type { ExtensionSyncPayload, ExtensionSyncTrackItem } from "@/lib/extension-sync";
import { applyExtensionSync } from "@/lib/extension-sync";

const API_BASE = "https://api.spotify.com/v1";

// Server-side playlist sync. Fetches playlist metadata + all items via
// /playlists/{id}/items (the new Feb-2026 endpoint — the old /tracks route
// is permanently gated) using the signed-in user's OAuth grant, and writes
// into Playlist/PlaylistTrack via the shared applyExtensionSync path.

export class PlaylistSyncError extends Error {
  constructor(
    message: string,
    public code:
      | "NOT_OWNER"
      | "NOT_FOUND"
      | "SPOTIFY_ERROR"
      | "NO_ACCOUNT"
      | "INVALID_INPUT",
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PlaylistSyncError";
  }
}

export function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z0-9]{22}$/.test(trimmed)) return trimmed;
  const uriMatch = trimmed.match(/spotify:playlist:([A-Za-z0-9]{22})/);
  if (uriMatch) return uriMatch[1];
  const urlMatch = trimmed.match(
    /open\.spotify\.com\/(?:[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})/,
  );
  if (urlMatch) return urlMatch[1];
  return null;
}

type SpotifyPlaylistItem = {
  added_at: string;
  added_by: { id: string | null } | null;
  is_local: boolean;
  // Spotify's Feb-2026 rename of /tracks → /items also renamed the inner
  // track field to `item` (so the field name stays accurate when the row
  // is an episode). The old /tracks endpoint is dead; we only read `item`.
  item: {
    id: string | null;
    name: string;
    uri: string;
    duration_ms: number;
    explicit: boolean;
    preview_url: string | null;
    album: {
      name: string;
      images: { url: string }[];
    };
    artists: { id: string | null; name: string; uri: string | null }[];
  } | null;
};

type SpotifyPlaylistDetail = {
  id: string;
  name: string;
  snapshot_id: string;
  owner: { id: string; display_name: string | null };
  images: { url: string }[];
  // Feb-2026 rename: the detail endpoint's `tracks` sub-object is now
  // `items`. We ask for `items(total)` in the fields filter.
  items: { total: number };
};

export type SyncPlaylistResult = {
  playlistId: string;
  playlistName: string;
  tracksWritten: number;
  snapshotChanged: boolean;
  linkCreated: boolean;
  skipped?: boolean;
};

export type SyncPlaylistOptions = {
  // When true, always paginate /items and rewrite stored tracks even if
  // Spotify's snapshot_id matches what we have on file. Use for the
  // user-triggered Resync button — the escape hatch when stored data is
  // bad but the snapshot looks current (the Party-import regression).
  force?: boolean;
};

export async function syncPlaylistForUser(
  userId: string,
  playlistId: string,
  options: SyncPlaylistOptions = {},
): Promise<SyncPlaylistResult> {
  // 1. Verify we can mint a token for this user.
  try {
    await getFreshAccessToken(userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PlaylistSyncError(
      `Couldn't refresh your Spotify token: ${message}. Sign out and sign in again to re-issue a refresh_token.`,
      "NO_ACCOUNT",
    );
  }

  // 2. Fetch /me so we know the caller's Spotify id for ownership check.
  let profile: SpotifyProfile;
  try {
    profile = await spotifyFetch<SpotifyProfile>(userId, "/me");
  } catch (error) {
    if (error instanceof SpotifyError) {
      throw new PlaylistSyncError(
        `Couldn't fetch /me (${error.status}): ${error.body.slice(0, 300)}. This usually means the OAuth token is invalid — sign out and sign in again.`,
        "SPOTIFY_ERROR",
        { status: error.status, body: error.body },
      );
    }
    throw error;
  }

  // 3. Fetch playlist detail to check ownership + capture snapshot/metadata.
  let detail: SpotifyPlaylistDetail;
  try {
    detail = await spotifyFetch<SpotifyPlaylistDetail>(
      userId,
      `/playlists/${playlistId}?fields=${encodeURIComponent("id,name,snapshot_id,owner(id,display_name),images,items(total)")}`,
    );
  } catch (error) {
    if (error instanceof SpotifyError && error.status === 404) {
      throw new PlaylistSyncError(
        `Spotify returned 404 for playlist ${playlistId}. Double-check the URL/ID.`,
        "NOT_FOUND",
        { playlistId },
      );
    }
    if (error instanceof SpotifyError) {
      throw new PlaylistSyncError(
        `Spotify rejected the playlist metadata fetch (${error.status} on ${error.path}): ${error.body.slice(0, 300)}.`,
        "SPOTIFY_ERROR",
        { status: error.status, body: error.body, path: error.path },
      );
    }
    throw error;
  }

  // Note: we intentionally do NOT pre-flight owner.id === profile.id.
  // Spotify's Feb-2026 Dev-Mode docs say non-owners get only metadata
  // and items are absent. But collaborator access appears to be an
  // exception worth testing empirically: if Spotify returns the items
  // for a collaborator, we accept the sync. If it returns fewer items
  // than tracks(total), we throw a post-fetch error with the owner
  // context so the UI can fall back to the embed.
  const callerIsOwner = detail.owner.id === profile.id;

  // 3b. Smart-skip: if the stored snapshot_id matches and we already have
  // tracks on file, the playlist hasn't changed upstream — no need to
  // paginate /items. Saves ~ceil(N/100) API calls per unchanged playlist
  // on every Sync / Refresh burst, which is the main source of 429s.
  // Skipped when force=true so the per-row Resync button still fixes
  // cases where stored data is junk but snapshot happens to match.
  if (!options.force) {
    const stored = await prisma.playlist.findUnique({
      where: { id: playlistId },
      select: {
        snapshotId: true,
        _count: { select: { tracks: true } },
      },
    });
    const snapshotMatch =
      stored?.snapshotId !== null &&
      stored?.snapshotId === detail.snapshot_id;
    const hasStoredTracks = (stored?._count.tracks ?? 0) > 0;
    if (stored && snapshotMatch && hasStoredTracks) {
      await prisma.playlist.update({
        where: { id: playlistId },
        data: {
          name: detail.name,
          ownerId: detail.owner.id,
          ownerName: detail.owner.display_name,
          imageUrl: detail.images?.[0]?.url ?? null,
          totalTracks: detail.items?.total ?? 0,
          lastSyncAt: new Date(),
          lastSyncBy: userId,
        },
      });
      const link = await prisma.userPlaylistLink.upsert({
        where: { userId_playlistId: { userId, playlistId } },
        create: { userId, playlistId },
        update: {},
        select: { createdAt: true },
      });
      // linkCreated when createdAt is within the last few ms (freshly
      // created by this upsert) — close enough for the UI.
      const linkCreated = Date.now() - link.createdAt.getTime() < 2000;
      return {
        playlistId: detail.id,
        playlistName: detail.name,
        tracksWritten: 0,
        snapshotChanged: false,
        linkCreated,
        skipped: true,
      };
    }
  }

  // 4. Paginate /items. Spotify's new endpoint caps at limit=100.
  type ItemsPage = { items: SpotifyPlaylistItem[]; next: string | null };
  const items: SpotifyPlaylistItem[] = [];
  let nextPath: string | null = `/playlists/${playlistId}/items?limit=100&additional_types=track,episode`;
  while (nextPath !== null) {
    const page: ItemsPage = await spotifyFetch<ItemsPage>(userId, nextPath);
    items.push(...(page.items ?? []));
    if (!page.next) break;
    const nextUrl = new URL(page.next);
    nextPath = `${nextUrl.pathname.replace(/^\/v1/, "")}${nextUrl.search}`;
  }

  // Post-fetch sanity check. Spotify's Feb-2026 Dev-Mode rules restrict
  // items reads to owners in most cases; if we paginated cleanly but got
  // fewer items than the playlist says it contains, it's almost always
  // that restriction kicking in (e.g. a collaborator trying to sync).
  // Fail hard with context instead of writing a half-empty row.
  const expectedTotal = detail.items?.total ?? 0;
  if (!callerIsOwner && items.length < expectedTotal) {
    throw new PlaylistSyncError(
      `"${detail.name}" is owned by ${detail.owner.display_name ?? detail.owner.id}, not you. Spotify returned ${items.length} items but the playlist has ${expectedTotal}. Under Feb-2026 Dev-Mode rules, non-owners generally can't read playlist items via the API even as collaborators. Ask the owner to import it from their dashboard, or use the Spotify embed fallback.`,
      "NOT_OWNER",
      {
        playlistId,
        playlistName: detail.name,
        ownerId: detail.owner.id,
        ownerDisplayName: detail.owner.display_name,
        callerSpotifyId: profile.id,
        returnedItems: items.length,
        expectedTotal,
      },
    );
  }

  // 5. Normalize into the shape applyExtensionSync expects. Our internal
  // shape still uses `track` for the nested object because that's what the
  // DB layer and existing Bompton code keys off of; only the Spotify API
  // response uses `item`.
  const normalized: ExtensionSyncTrackItem[] = items.map((raw, index) => ({
    position: index,
    addedAt: raw.added_at,
    addedBySpotifyId: raw.added_by?.id ?? null,
    isLocal: Boolean(raw.is_local),
    track: raw.item
      ? {
          id: raw.item.id ?? null,
          name: raw.item.name ?? "(unavailable)",
          uri: raw.item.uri ?? "",
          durationMs: raw.item.duration_ms ?? 0,
          explicit: Boolean(raw.item.explicit),
          previewUrl: raw.item.preview_url ?? null,
          albumName: raw.item.album?.name ?? "",
          albumImageUrl: raw.item.album?.images?.[0]?.url ?? null,
          artists: (raw.item.artists ?? []).map((a) => ({
            id: a.id ?? null,
            name: a.name ?? "",
            uri: a.uri ?? null,
          })),
        }
      : null,
  }));

  const payload: ExtensionSyncPayload = {
    playlist: {
      id: detail.id,
      name: detail.name,
      ownerId: detail.owner.id,
      ownerName: detail.owner.display_name,
      snapshotId: detail.snapshot_id,
      imageUrl: detail.images?.[0]?.url ?? null,
      totalTracks: detail.items?.total ?? items.length,
    },
    tracks: normalized,
  };

  // applyExtensionSync short-circuits when the stored snapshot_id matches
  // the incoming one — an extension-era optimization to skip track writes
  // when nothing changed upstream. Our user-triggered sync path needs the
  // opposite: always rewrite, because the stored data might be stale for
  // reasons besides an upstream snapshot change (e.g. the first v0.1.0
  // import of this path wrote every row as "(unavailable)" with 0ms due
  // to the raw.track/raw.item rename bug, yet captured the current
  // snapshot_id, so the skip path would refuse to ever fix itself).
  // Clearing stored snapshotId first forces the rewrite branch.
  await prisma.playlist.updateMany({
    where: { id: detail.id },
    data: { snapshotId: null },
  });

  const syncResult = await applyExtensionSync(payload, userId);

  // 6. Ensure the link exists so this playlist appears on the user's dashboard.
  const existingLink = await prisma.userPlaylistLink.findUnique({
    where: { userId_playlistId: { userId, playlistId } },
  });
  if (!existingLink) {
    await prisma.userPlaylistLink.create({
      data: { userId, playlistId },
    });
  }

  return {
    playlistId: detail.id,
    playlistName: detail.name,
    tracksWritten: syncResult.tracksWritten,
    snapshotChanged: syncResult.snapshotChanged,
    linkCreated: !existingLink,
  };
}

// Cheap snapshot-only check used by the dashboard render path to decide
// whether to trigger a resync. Returns null if Spotify says the playlist
// no longer exists or the caller can no longer see it.
export async function fetchPlaylistSnapshotId(
  userId: string,
  playlistId: string,
): Promise<{ snapshotId: string; totalTracks: number } | null> {
  try {
    const detail = await spotifyFetch<{
      snapshot_id: string;
      items: { total: number };
    }>(
      userId,
      `/playlists/${playlistId}?fields=${encodeURIComponent("snapshot_id,items(total)")}`,
    );
    return {
      snapshotId: detail.snapshot_id,
      totalTracks: detail.items?.total ?? 0,
    };
  } catch (error) {
    if (error instanceof SpotifyError && error.status === 404) return null;
    throw error;
  }
}
