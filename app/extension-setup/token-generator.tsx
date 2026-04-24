"use client";

import { useState, useTransition } from "react";
import {
  generateExtensionToken,
  initCachedSpotifyResponseTable,
  initUserPlaylistLinkTable,
  resetPlaylistSyncState,
  revokeExtensionToken,
  type GenerateTokenResult,
  type InitCachedResponseTableResult,
  type InitPlaylistLinkTableResult,
  type ResetSyncStateResult,
} from "./actions";

export function TokenGenerator() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<GenerateTokenResult | null>(null);
  const [copied, setCopied] = useState(false);

  function onSubmit(formData: FormData) {
    setCopied(false);
    startTransition(async () => {
      const r = await generateExtensionToken(formData);
      setResult(r);
    });
  }

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-spotify-subtext sm:flex-1">
          Label (optional)
          <input
            name="label"
            placeholder="e.g. Marcus's laptop"
            className="rounded border border-spotify-border bg-spotify-base px-3 py-2 text-sm text-spotify-text placeholder:text-spotify-subtext/60 focus:border-spotify-green focus:outline-none"
            maxLength={120}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="btn-spotify disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Generating…" : "Generate token"}
        </button>
      </form>

      {result && result.ok ? (
        <div className="flex flex-col gap-2 rounded-lg border border-spotify-green/50 bg-spotify-green/10 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-spotify-green">
            New token (copy this now — it won't be shown again)
          </p>
          <div className="flex items-stretch gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-spotify-base/70 px-3 py-2 font-mono text-sm">
              {result.raw}
            </code>
            <button
              type="button"
              onClick={() => copyToClipboard(result.raw)}
              className="btn-ghost shrink-0"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-spotify-subtext">
            Paste this into the extension popup's "Auth token" field and click
            Save. If you lose it, generate a new one — the hash is what's
            stored server-side, not the raw value.
          </p>
        </div>
      ) : null}

      {result && !result.ok ? (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm">
          <p className="font-bold text-red-300">Token generation failed</p>
          <p className="mt-1 whitespace-pre-wrap text-red-200">{result.error}</p>
        </div>
      ) : null}
    </div>
  );
}

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
          deleted {result.tracksDeleted} PlaylistTrack row(s). Open the
          extension popup and click <strong>Sync now</strong>.
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

export function RevokeButton({ tokenId }: { tokenId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await revokeExtensionToken(tokenId);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-xs font-semibold text-red-300 hover:text-red-200 disabled:opacity-60"
      >
        {pending ? "Revoking…" : "Revoke"}
      </button>
      {error ? (
        <p className="max-w-[200px] text-right text-[10px] text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
