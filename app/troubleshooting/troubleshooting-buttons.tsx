"use client";

import { useState, useTransition } from "react";
import {
  createCrewExportLink,
  initArtistTable,
  initCachedSpotifyResponseTable,
  initFridayReminderTable,
  initLateAddNotificationTable,
  initListeningPlayTable,
  initListeningSnapshotTable,
  initUserPlaylistLinkTable,
  resetArtistCache,
  resetPlaylistSyncState,
  type CreateCrewExportLinkResult,
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

export function CrewExportLinkButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateCrewExportLinkResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  function onCreate() {
    setResult(null);
    setCopied(false);
    setCopyError(null);
    startTransition(async () => {
      setResult(await createCrewExportLink());
    });
  }

  const url = result?.ok ? `${window.location.origin}${result.path}` : null;

  // Copying gets its own click. iOS Safari drops the clipboard permission
  // when writeText() runs after an await, so it can't share one with the
  // request that creates the link.
  function onCopy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      (error: unknown) =>
        setCopyError(
          `Clipboard write failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Select the link in the box above and copy it by hand.`,
        ),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onCreate}
        disabled={pending}
        className="btn-spotify self-start disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create export link"}
      </button>
      {result && !result.ok ? (
        <p className="whitespace-pre-wrap text-xs text-red-300">
          {result.error}
        </p>
      ) : null}
      {result?.ok && url ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-spotify-green">
            Link created. It works without signing in until{" "}
            {new Date(result.expiresAt).toLocaleString()}.
          </p>
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-lg border border-spotify-border bg-black/40 p-3 font-mono text-[11px] text-spotify-subtext"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onCopy} className="btn-spotify">
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            <a
              href={`${url}&download=1`}
              className="text-sm text-spotify-subtext underline"
            >
              or download the file
            </a>
          </div>
          {copyError ? (
            <p className="whitespace-pre-wrap text-xs text-red-300">
              {copyError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
