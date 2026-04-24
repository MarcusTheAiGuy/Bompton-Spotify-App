"use client";

import { useState, useTransition } from "react";
import {
  initCachedSpotifyResponseTable,
  initUserPlaylistLinkTable,
  resetPlaylistSyncState,
  type InitCachedResponseTableResult,
  type InitPlaylistLinkTableResult,
  type ResetSyncStateResult,
} from "./actions";

// Buttons rendered on /troubleshooting. Each one wraps a server action
// that does some one-shot operational thing — clearing stored sync
// state, applying DDL for a newly-added Prisma table. All idempotent.

export function ResetSyncButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ResetSyncStateResult | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await resetPlaylistSyncState();
      setResult(r);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="btn-spotify self-start disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Resetting…" : "Reset sync state"}
      </button>
      {result && result.ok ? (
        <p className="text-xs text-spotify-green">
          Cleared snapshotId on {result.playlistsCleared} playlist row(s) and
          deleted {result.tracksDeleted} PlaylistTrack row(s). Reload
          /bompton-playlist or /dashboard to re-sync.
        </p>
      ) : null}
      {result && !result.ok ? (
        <p className="whitespace-pre-wrap text-xs text-red-300">
          {result.error}
        </p>
      ) : null}
    </div>
  );
}

export function InitPlaylistLinkButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<InitPlaylistLinkTableResult | null>(
    null,
  );

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await initUserPlaylistLinkTable();
      setResult(r);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="btn-ghost self-start disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Creating…" : "Initialize UserPlaylistLink table"}
      </button>
      {result && result.ok ? (
        <p className="text-xs text-spotify-green">{result.message}</p>
      ) : null}
      {result && !result.ok ? (
        <p className="whitespace-pre-wrap text-xs text-red-300">{result.error}</p>
      ) : null}
    </div>
  );
}

export function InitCachedResponseButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<InitCachedResponseTableResult | null>(
    null,
  );

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await initCachedSpotifyResponseTable();
      setResult(r);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="btn-ghost self-start disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Creating…" : "Initialize CachedSpotifyResponse table"}
      </button>
      {result && result.ok ? (
        <p className="text-xs text-spotify-green">{result.message}</p>
      ) : null}
      {result && !result.ok ? (
        <p className="whitespace-pre-wrap text-xs text-red-300">{result.error}</p>
      ) : null}
    </div>
  );
}
