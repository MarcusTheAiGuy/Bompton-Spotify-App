"use client";

import { useState, useTransition } from "react";
import {
  initArtistTable,
  initCachedSpotifyResponseTable,
  initFridayReminderTable,
  initLateAddNotificationTable,
  initListeningPlayTable,
  initListeningSnapshotTable,
  initUserPlaylistLinkTable,
  resetArtistCache,
  resetPlaylistSyncState,
  type InitArtistTableResult,
  type InitCachedResponseTableResult,
  type InitFridayReminderTableResult,
  type InitLateAddNotificationTableResult,
  type InitListeningPlayTableResult,
  type InitListeningSnapshotTableResult,
  type InitPlaylistLinkTableResult,
  type ResetArtistCacheResult,
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

export function InitArtistButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<InitArtistTableResult | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await initArtistTable();
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
        {pending ? "Creating…" : "Initialize Artist table"}
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

export function InitListeningPlayButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<InitListeningPlayTableResult | null>(
    null,
  );

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await initListeningPlayTable();
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
        {pending ? "Creating…" : "Initialize ListeningPlay table"}
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

export function InitListeningSnapshotButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<InitListeningSnapshotTableResult | null>(
    null,
  );

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await initListeningSnapshotTable();
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
        {pending ? "Creating…" : "Initialize ListeningSnapshot table"}
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

export function InitLateAddNotificationButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] =
    useState<InitLateAddNotificationTableResult | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await initLateAddNotificationTable();
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
        {pending ? "Creating…" : "Initialize LateAddNotification table"}
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

export function InitFridayReminderButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] =
    useState<InitFridayReminderTableResult | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await initFridayReminderTable();
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
        {pending ? "Creating…" : "Initialize FridayReminderNotification table"}
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

export function ResetArtistCacheButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ResetArtistCacheResult | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await resetArtistCache();
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
        {pending ? "Wiping…" : "Reset Artist genre cache"}
      </button>
      {result && result.ok ? (
        <p className="text-xs text-spotify-green">
          Deleted {result.rowsDeleted} cached artist row
          {result.rowsDeleted === 1 ? "" : "s"}. Reload
          /bompton-playlist/stats — the next render starts re-fetching
          tags from Last.fm (capped at 30 artists per render to stay
          under the rate limit).
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
