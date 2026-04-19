"use client";

import { useState } from "react";
import {
  pickImage,
  type SpotifyPlaylist,
  type SpotifyPlaylistTrack,
  type SpotifyTrack,
} from "@/lib/spotify";
import { TrackList } from "@/components/spotify/track-list";

type TracksState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "loaded";
      items: SpotifyPlaylistTrack[];
      total: number;
      truncated: boolean;
    }
  | { status: "error"; title: string; detail: string };

export function PlaylistGrid({
  playlists,
  forUserId,
}: {
  playlists: SpotifyPlaylist[];
  forUserId: string;
}) {
  const valid = playlists.filter((p) => p);
  if (valid.length === 0) {
    return (
      <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
        No playlists.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {valid.map((playlist) => (
        <PlaylistRow
          key={playlist.id}
          playlist={playlist}
          forUserId={forUserId}
        />
      ))}
    </ul>
  );
}

function PlaylistRow({
  playlist,
  forUserId,
}: {
  playlist: SpotifyPlaylist;
  forUserId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tracksState, setTracksState] = useState<TracksState>({ status: "idle" });

  const image = pickImage(playlist.images, 200);
  const url = playlist.external_urls?.spotify ?? "#";
  const ownerLabel =
    playlist.owner?.display_name ?? playlist.owner?.id ?? "Unknown";
  const trackCount = playlist.tracks?.total ?? 0;

  async function toggle() {
    const nextOpen = !expanded;
    setExpanded(nextOpen);
    if (nextOpen && tracksState.status === "idle") {
      await loadTracks();
    }
  }

  async function loadTracks() {
    setTracksState({ status: "loading" });
    try {
      const response = await fetch(
        `/api/spotify/playlists/${encodeURIComponent(playlist.id)}/tracks?forUserId=${encodeURIComponent(forUserId)}`,
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setTracksState({
          status: "error",
          title:
            body?.error?.title ?? `HTTP ${response.status} ${response.statusText}`,
          detail:
            body?.error?.detail ??
            `Unexpected response from /api/spotify/playlists/${playlist.id}/tracks.`,
        });
        return;
      }
      setTracksState({
        status: "loaded",
        items: body.items ?? [],
        total: body.total ?? 0,
        truncated: Boolean(body.truncated),
      });
    } catch (error) {
      setTracksState({
        status: "error",
        title: "Couldn't load playlist tracks",
        detail:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
      });
    }
  }

  return (
    <li className="rounded-lg border border-spotify-border bg-spotify-elevated/40">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-spotify-highlight/40"
      >
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
          <p className="truncate font-bold">{playlist.name}</p>
          <p className="truncate text-xs text-spotify-subtext">
            by {ownerLabel}
            <span className="mx-1 text-spotify-border">·</span>
            {trackCount} tracks
            {playlist.collaborative ? " · collab" : ""}
            {playlist.public === true ? " · public" : ""}
            {playlist.public === false ? " · private" : ""}
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
        <Chevron open={expanded} />
      </button>
      {expanded ? (
        <div className="border-t border-spotify-border px-3 pb-4 pt-3">
          <PlaylistTracksView state={tracksState} onRetry={loadTracks} />
        </div>
      ) : null}
    </li>
  );
}

function PlaylistTracksView({
  state,
  onRetry,
}: {
  state: TracksState;
  onRetry: () => void;
}) {
  if (state.status === "loading") {
    return (
      <p className="text-sm text-spotify-subtext">Loading tracks…</p>
    );
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
  if (state.status === "loaded") {
    const tracks = state.items
      .map((item) => item.track)
      .filter((t): t is SpotifyTrack => Boolean(t));
    if (tracks.length === 0) {
      return (
        <p className="text-sm text-spotify-subtext">
          No playable tracks in this playlist.
        </p>
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
