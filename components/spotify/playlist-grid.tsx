"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  pickImage,
  formatDuration,
  type SpotifyPlaylist,
  type SpotifyPlaylistTrack,
  type SpotifyTrack,
} from "@/lib/spotify";
import { TrackList } from "@/components/spotify/track-list";
import { SpotifyEmbed } from "@/components/spotify/spotify-embed";

type LiveTracksState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "loaded";
      items: SpotifyPlaylistTrack[];
      total: number;
      truncated: boolean;
    }
  | { status: "error"; title: string; detail: string };

type StoredTrack = {
  position: number;
  trackSpotifyId: string | null;
  trackName: string;
  trackUri: string;
  trackDurationMs: number;
  trackExplicit: boolean;
  trackPreviewUrl: string | null;
  albumName: string;
  albumImageUrl: string | null;
  artists: { id: string | null; name: string; uri: string | null }[];
  addedAt: string;
  addedBySpotifyId: string | null;
  isLocal: boolean;
};

type StoredState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "loaded";
      tracks: StoredTrack[];
      lastSyncAt: string | null;
      totalTracks: number;
    }
  | { status: "error"; title: string; detail: string };

export type PreloadedLink = {
  playlistId: string;
  lastSyncAt: string | null;
  totalTracks: number;
  tracks: StoredTrack[];
};

export function PlaylistGrid({
  playlists,
  forUserId,
  isSelf,
  callerSpotifyId,
  preloadedLinks,
}: {
  playlists: SpotifyPlaylist[];
  forUserId: string;
  isSelf: boolean;
  callerSpotifyId: string | null;
  preloadedLinks: PreloadedLink[];
}) {
  const router = useRouter();
  const [syncAllPending, setSyncAllPending] = useState(false);
  const [syncAllError, setSyncAllError] = useState<string | null>(null);
  const [syncAllProgress, setSyncAllProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const valid = playlists.filter((p) => p);
  const preloadedById = new Map(preloadedLinks.map((l) => [l.playlistId, l]));
  // Every playlist in the caller's /me/playlists that they actually own —
  // these are the ones the "Sync all" button can operate on (import if
  // unlinked, resync if linked). Playlists they only follow are excluded
  // because non-owner syncs would hit NOT_OWNER 403. Spotify-curated ones
  // (owner.id === "spotify") are also excluded — Nov-2024 deprecation
  // blocks their items for new apps regardless of ownership.
  const ownedPlaylists =
    callerSpotifyId === null
      ? []
      : valid.filter(
          (p) =>
            p.owner?.id === callerSpotifyId && p.owner?.id !== "spotify",
        );

  async function syncAllOwned() {
    if (ownedPlaylists.length === 0) return;
    setSyncAllPending(true);
    setSyncAllError(null);
    setSyncAllProgress({ done: 0, total: ownedPlaylists.length });
    const errors: string[] = [];
    for (let i = 0; i < ownedPlaylists.length; i++) {
      const playlist = ownedPlaylists[i];
      try {
        const response = await fetch("/api/playlists/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playlistInput: playlist.id }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          errors.push(
            `${playlist.name} (${playlist.id}): ${body?.error ?? "err"} ${response.status} ${body?.message ?? ""}`,
          );
        }
      } catch (error) {
        errors.push(
          `${playlist.name} (${playlist.id}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      setSyncAllProgress({ done: i + 1, total: ownedPlaylists.length });
    }
    setSyncAllPending(false);
    if (errors.length) {
      setSyncAllError(
        `Sync finished with ${errors.length} error(s):\n${errors.join("\n")}`,
      );
    } else {
      setSyncAllProgress(null);
    }
    router.refresh();
  }

  if (valid.length === 0) {
    return (
      <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
        No playlists.
      </p>
    );
  }

  const importedCount = preloadedLinks.length;
  const unimportedOwnedCount = ownedPlaylists.filter(
    (p) => !preloadedById.has(p.id),
  ).length;

  return (
    <div className="flex flex-col gap-3">
      {isSelf && ownedPlaylists.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={syncAllOwned}
            disabled={syncAllPending}
            className="btn-ghost self-start disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncAllPending && syncAllProgress
              ? `Syncing ${syncAllProgress.done}/${syncAllProgress.total}…`
              : `Sync all ${ownedPlaylists.length} owned playlist${ownedPlaylists.length === 1 ? "" : "s"}`}
          </button>
          <p className="text-xs text-spotify-subtext">
            {unimportedOwnedCount > 0
              ? `${unimportedOwnedCount} new to import, ${importedCount} to resync`
              : `all ${importedCount} already imported; click to resync`}
          </p>
          {syncAllError ? (
            <p className="whitespace-pre-wrap text-xs text-red-300">
              {syncAllError}
            </p>
          ) : null}
        </div>
      ) : null}
      <ul className="flex flex-col gap-3">
        {valid.map((playlist) => (
          <PlaylistRow
            key={playlist.id}
            playlist={playlist}
            forUserId={forUserId}
            isSelf={isSelf}
            callerSpotifyId={callerSpotifyId}
            preloaded={preloadedById.get(playlist.id) ?? null}
          />
        ))}
      </ul>
    </div>
  );
}

function EmbedFallback({
  playlistId,
  note,
}: {
  playlistId: string;
  note?: string;
}) {
  return (
    <SpotifyEmbed
      type="playlist"
      id={playlistId}
      note={
        note ??
        "Showing Spotify's embedded player. Import this playlist (only works if you own it under Spotify's Dev-Mode rules) to get our own track table with per-song metadata."
      }
    />
  );
}

function PlaylistRow({
  playlist,
  forUserId,
  isSelf,
  callerSpotifyId,
  preloaded,
}: {
  playlist: SpotifyPlaylist;
  forUserId: string;
  isSelf: boolean;
  callerSpotifyId: string | null;
  preloaded: PreloadedLink | null;
}) {
  const router = useRouter();
  const linked = preloaded !== null;
  // Linked rows default to expanded so the custom table shows up on page
  // load without the user clicking every row.
  const [expanded, setExpanded] = useState(linked);
  const [liveState, setLiveState] = useState<LiveTracksState>({ status: "idle" });
  const [storedState, setStoredState] = useState<StoredState>(
    preloaded
      ? {
          status: "loaded",
          tracks: preloaded.tracks,
          lastSyncAt: preloaded.lastSyncAt,
          totalTracks: preloaded.totalTracks,
        }
      : { status: "idle" },
  );
  // When the server re-renders with fresh preloaded data (e.g. after a
  // "Resync all" triggered router.refresh), pull the new tracks into
  // local state. Keyed on lastSyncAt so we don't thrash on every render.
  useEffect(() => {
    if (preloaded) {
      setStoredState({
        status: "loaded",
        tracks: preloaded.tracks,
        lastSyncAt: preloaded.lastSyncAt,
        totalTracks: preloaded.totalTracks,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preloaded?.lastSyncAt]);
  const [viewMode, setViewMode] = useState<"stored" | "embed">("stored");
  const [syncPending, setSyncPending] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [removePending, setRemovePending] = useState(false);

  const image = pickImage(playlist.images, 200);
  const url = playlist.external_urls?.spotify ?? "#";
  const ownerLabel =
    playlist.owner?.display_name ?? playlist.owner?.id ?? "Unknown";
  const trackCount = playlist.tracks?.total ?? 0;
  const spotifyOwned = playlist.owner?.id === "spotify";
  const callerIsOwner =
    callerSpotifyId !== null && playlist.owner?.id === callerSpotifyId;
  // Only the dashboard's owner can import/resync/remove playlists on their
  // own dashboard — we don't let a visitor mutate someone else's linked list.
  const canMutate = isSelf;

  const loadStored = useCallback(async () => {
    setStoredState({ status: "loading" });
    try {
      const response = await fetch(
        `/api/playlists/${encodeURIComponent(playlist.id)}/stored-tracks`,
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStoredState({
          status: "error",
          title:
            body?.error ?? `HTTP ${response.status} ${response.statusText}`,
          detail:
            body?.message ??
            `Couldn't fetch stored tracks for ${playlist.id}.`,
        });
        return;
      }
      setStoredState({
        status: "loaded",
        tracks: body.tracks ?? [],
        lastSyncAt: body.playlist?.lastSyncAt ?? null,
        totalTracks: body.playlist?.totalTracks ?? 0,
      });
    } catch (error) {
      setStoredState({
        status: "error",
        title: "Couldn't load stored tracks",
        detail:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
      });
    }
  }, [playlist.id]);

  const loadLive = useCallback(async () => {
    setLiveState({ status: "loading" });
    try {
      const response = await fetch(
        `/api/spotify/playlists/${encodeURIComponent(playlist.id)}/tracks?forUserId=${encodeURIComponent(forUserId)}`,
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLiveState({
          status: "error",
          title:
            body?.error?.title ?? `HTTP ${response.status} ${response.statusText}`,
          detail:
            body?.error?.detail ??
            `Unexpected response from /api/spotify/playlists/${playlist.id}/tracks.`,
        });
        return;
      }
      setLiveState({
        status: "loaded",
        items: body.items ?? [],
        total: body.total ?? 0,
        truncated: Boolean(body.truncated),
      });
    } catch (error) {
      setLiveState({
        status: "error",
        title: "Couldn't load playlist tracks",
        detail:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
      });
    }
  }, [playlist.id, forUserId]);

  async function toggle() {
    if (spotifyOwned) return;
    const nextOpen = !expanded;
    setExpanded(nextOpen);
    if (nextOpen) {
      if (linked && storedState.status === "idle") await loadStored();
      else if (!linked && liveState.status === "idle") await loadLive();
    }
  }

  async function runSync() {
    setSyncPending(true);
    setSyncError(null);
    try {
      const response = await fetch("/api/playlists/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistInput: playlist.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSyncError(
          `${body?.error ?? "SyncError"} (HTTP ${response.status}): ${body?.message ?? "unknown"}`,
        );
        return;
      }
      await loadStored();
      // If this was a fresh import (row was unlinked before the click),
      // auto-expand so the user sees the new table without another tap.
      if (!linked) setExpanded(true);
      // Server state changed (new UserPlaylistLink), re-render the page so
      // the preloadedLinks prop includes this playlist next render.
      router.refresh();
    } catch (error) {
      setSyncError(
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      );
    } finally {
      setSyncPending(false);
    }
  }

  async function removeLink() {
    setRemovePending(true);
    try {
      const response = await fetch(
        `/api/playlists/${encodeURIComponent(playlist.id)}/link`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSyncError(
          `${body?.error ?? "RemoveError"} (HTTP ${response.status}): ${body?.message ?? "unknown"}`,
        );
        return;
      }
      setStoredState({ status: "idle" });
      router.refresh();
    } catch (error) {
      setSyncError(
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      );
    } finally {
      setRemovePending(false);
    }
  }

  const showImportButton = canMutate && callerIsOwner && !linked && !spotifyOwned;
  // Allow attempting an import on non-owned playlists too — Spotify's Feb-2026
  // Dev-Mode rules say non-owners can't read items, but collaborator access
  // is worth testing empirically. The server returns NOT_OWNER if it confirms
  // the restriction, and the UI surfaces the error. Gated on callerSpotifyId
  // being known (i.e. self-view) and excluding Spotify-curated playlists
  // (Nov-2024 deprecation blocks those regardless of ownership).
  const showNonOwnerImportButton =
    canMutate && !callerIsOwner && !linked && !spotifyOwned && callerSpotifyId !== null;

  const header = (
    <>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          className="h-14 w-14 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-14 w-14 shrink-0 rounded bg-spotify-highlight" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">
          {playlist.name}
          {linked ? (
            <span className="ml-2 rounded bg-spotify-green/20 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-widest text-spotify-green">
              imported
            </span>
          ) : null}
        </p>
        <p className="truncate text-xs text-spotify-subtext">
          by {ownerLabel}
          <span className="mx-1 text-spotify-border">·</span>
          {trackCount} tracks
          {playlist.collaborative ? " · collab" : ""}
          {playlist.public === true ? " · public" : ""}
          {playlist.public === false ? " · private" : ""}
          {spotifyOwned ? " · spotify-curated" : ""}
          {callerIsOwner ? " · you own this" : ""}
        </p>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 text-xs text-spotify-subtext hover:text-spotify-green"
        onClick={(event) => event.stopPropagation()}
      >
        open in Spotify ↗
      </a>
      {spotifyOwned ? null : <Chevron open={expanded} />}
    </>
  );

  return (
    <li className="rounded-lg border border-spotify-border bg-spotify-elevated/40">
      {spotifyOwned ? (
        <div
          className="flex w-full items-center gap-3 p-3 text-left opacity-80"
          title="Spotify-curated playlist — Spotify's API no longer exposes tracks for these to new apps."
        >
          {header}
        </div>
      ) : (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-spotify-highlight/40"
        >
          {header}
        </button>
      )}

      {spotifyOwned ? (
        <p className="border-t border-spotify-border px-3 py-2 text-xs text-spotify-subtext">
          Spotify-curated (algorithmic or editorial). Spotify&apos;s Nov 2024
          API deprecation blocks track-listing for these; open in Spotify to
          see the songs.
        </p>
      ) : null}

      {expanded && !spotifyOwned ? (
        <div className="flex flex-col gap-3 border-t border-spotify-border px-3 pb-4 pt-3">
          {/* Row-level action bar */}
          <div className="flex flex-wrap items-center gap-2">
            {linked ? (
              <>
                <button
                  type="button"
                  onClick={() => setViewMode("stored")}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    viewMode === "stored"
                      ? "border-spotify-green bg-spotify-green/20 text-spotify-green"
                      : "border-spotify-border text-spotify-subtext hover:bg-spotify-highlight"
                  }`}
                >
                  Our table
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("embed")}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    viewMode === "embed"
                      ? "border-spotify-green bg-spotify-green/20 text-spotify-green"
                      : "border-spotify-border text-spotify-subtext hover:bg-spotify-highlight"
                  }`}
                >
                  Spotify embed
                </button>
                {canMutate ? (
                  <>
                    <button
                      type="button"
                      onClick={runSync}
                      disabled={syncPending}
                      className="rounded-full border border-spotify-border px-3 py-1 text-xs font-semibold text-spotify-subtext transition hover:bg-spotify-highlight disabled:opacity-60"
                    >
                      {syncPending ? "Resyncing…" : "Resync"}
                    </button>
                    <button
                      type="button"
                      onClick={removeLink}
                      disabled={removePending}
                      className="rounded-full border border-red-500/40 px-3 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-60"
                    >
                      {removePending ? "Removing…" : "Remove"}
                    </button>
                  </>
                ) : null}
              </>
            ) : (
              <>
                {showImportButton ? (
                  <button
                    type="button"
                    onClick={runSync}
                    disabled={syncPending}
                    className="rounded-full bg-spotify-green px-3 py-1 text-xs font-bold text-black transition hover:bg-spotify-green-hover disabled:opacity-60"
                  >
                    {syncPending ? "Importing…" : "Import to dashboard"}
                  </button>
                ) : null}
                {showNonOwnerImportButton ? (
                  <button
                    type="button"
                    onClick={runSync}
                    disabled={syncPending}
                    className="rounded-full border border-yellow-500/50 bg-yellow-500/10 px-3 py-1 text-xs font-semibold text-yellow-200 transition hover:bg-yellow-500/20 disabled:opacity-60"
                    title="Spotify Dev-Mode usually blocks non-owners from reading playlist items; this tries anyway and will show an error if it fails."
                  >
                    {syncPending
                      ? "Trying…"
                      : "⚠ Try import (non-owner, experimental)"}
                  </button>
                ) : null}
              </>
            )}
            {storedState.status === "loaded" && storedState.lastSyncAt ? (
              <span className="text-xs text-spotify-subtext">
                last synced {new Date(storedState.lastSyncAt).toLocaleString()}
              </span>
            ) : null}
          </div>

          {syncError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 whitespace-pre-wrap"
            >
              {syncError}
            </div>
          ) : null}

          {/* Body */}
          {linked ? (
            viewMode === "stored" ? (
              <StoredTracksView
                state={storedState}
                onRetry={loadStored}
                playlistId={playlist.id}
              />
            ) : (
              <EmbedFallback
                playlistId={playlist.id}
                note="Showing Spotify's embed on request. Switch back to 'Our table' for sortable columns backed by our DB."
              />
            )
          ) : (
            <LiveTracksView
              state={liveState}
              onRetry={loadLive}
              playlistId={playlist.id}
              showImportHint={showImportButton}
            />
          )}
        </div>
      ) : null}
    </li>
  );
}

function LiveTracksView({
  state,
  onRetry,
  playlistId,
  showImportHint,
}: {
  state: LiveTracksState;
  onRetry: () => void;
  playlistId: string;
  showImportHint: boolean;
}) {
  if (state.status === "loading") {
    return <p className="text-sm text-spotify-subtext">Loading tracks…</p>;
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-3">
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
        >
          <p className="font-semibold">{state.title}</p>
          <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-red-300/80">
            {state.detail}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-full border border-red-500/40 px-3 py-1 text-xs font-semibold hover:bg-red-500/20"
          >
            Retry
          </button>
        </div>
        <EmbedFallback
          playlistId={playlistId}
          note={
            showImportHint
              ? "Spotify's API refused track data for this playlist. Click 'Import to dashboard' above to pull the items via your OAuth grant (works because you own it)."
              : undefined
          }
        />
      </div>
    );
  }
  if (state.status === "loaded") {
    const tracks = state.items
      .map((item) => item.track)
      .filter((t): t is SpotifyTrack => Boolean(t));
    if (tracks.length === 0) {
      return (
        <EmbedFallback
          playlistId={playlistId}
          note={
            showImportHint
              ? "Spotify returned 0 tracks for this playlist via the public endpoint. Click 'Import to dashboard' above to pull the full track list via your OAuth grant."
              : undefined
          }
        />
      );
    }
    return (
      <div className="flex flex-col gap-2">
        <TrackList tracks={tracks} />
        {state.truncated ? (
          <p className="text-xs text-spotify-subtext">
            Showing the first {state.items.length} of {state.total} tracks.
            Open in Spotify to see the rest.
          </p>
        ) : null}
      </div>
    );
  }
  return null;
}

function StoredTracksView({
  state,
  onRetry,
  playlistId,
}: {
  state: StoredState;
  onRetry: () => void;
  playlistId: string;
}) {
  // Auto-load on first render if still idle (e.g. after an import action
  // reset the state).
  useEffect(() => {
    if (state.status === "idle") {
      onRetry();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  if (state.status === "idle" || state.status === "loading") {
    return <p className="text-sm text-spotify-subtext">Loading stored tracks…</p>;
  }
  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
      >
        <p className="font-semibold">{state.title}</p>
        <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-red-300/80">
          {state.detail}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-full border border-red-500/40 px-3 py-1 text-xs font-semibold hover:bg-red-500/20"
        >
          Retry
        </button>
      </div>
    );
  }
  if (state.tracks.length === 0) {
    return (
      <EmbedFallback
        playlistId={playlistId}
        note="No tracks stored yet for this playlist. Click 'Resync' to pull the latest items."
      />
    );
  }
  return <StoredTable tracks={state.tracks} />;
}

function StoredTable({ tracks }: { tracks: StoredTrack[] }) {
  return (
    <div className="overflow-x-auto rounded border border-spotify-border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-spotify-highlight/40 text-xs uppercase tracking-widest text-spotify-subtext">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Track</th>
            <th className="px-3 py-2">Artist(s)</th>
            <th className="px-3 py-2">Album</th>
            <th className="px-3 py-2">Duration</th>
            <th className="px-3 py-2">Added by</th>
            <th className="px-3 py-2">Added at</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((t) => (
            <tr
              key={`${t.position}-${t.trackSpotifyId ?? t.trackUri}`}
              className="border-t border-spotify-border/60 align-top"
            >
              <td className="px-3 py-2 font-mono text-xs text-spotify-subtext">
                {t.position + 1}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  {t.albumImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.albumImageUrl}
                      alt=""
                      className="h-8 w-8 rounded object-cover"
                    />
                  ) : null}
                  <span>{t.trackName}</span>
                  {t.trackExplicit ? (
                    <span className="rounded bg-spotify-highlight px-1 text-[10px] font-bold text-spotify-subtext">
                      E
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-2 text-spotify-subtext">
                {t.artists.map((a) => a.name).join(", ")}
              </td>
              <td className="px-3 py-2 text-spotify-subtext">{t.albumName}</td>
              <td className="px-3 py-2 text-spotify-subtext">
                {formatDuration(t.trackDurationMs)}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-spotify-subtext">
                {t.addedBySpotifyId ?? "—"}
              </td>
              <td className="px-3 py-2 text-xs text-spotify-subtext">
                {new Date(t.addedAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`h-4 w-4 shrink-0 transition-transform ${
        open ? "rotate-180" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
