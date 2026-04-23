"use client";

import { useActionState } from "react";
import {
  testPlaylistFetch,
  type ProbeResult,
  type TestPlaylistResult,
} from "./actions";

export function TestPlaylistForm() {
  const [result, action, pending] = useActionState<
    TestPlaylistResult | null,
    FormData
  >(testPlaylistFetch, null);

  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-spotify-subtext sm:flex-1">
          Playlist URL, URI, or ID
          <input
            name="playlistInput"
            required
            placeholder="https://open.spotify.com/playlist/... or 22-char id"
            className="rounded border border-spotify-border bg-spotify-base px-3 py-2 text-sm text-spotify-text placeholder:text-spotify-subtext/60 focus:border-spotify-green focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="btn-spotify disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Probing…" : "Run probe"}
        </button>
      </form>

      {result && result.ok === false ? (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-200 whitespace-pre-wrap">
          {result.message}
        </div>
      ) : null}

      {result && result.ok ? <ResultPanel result={result} /> : null}
    </div>
  );
}

function ResultPanel({
  result,
}: {
  result: Extract<TestPlaylistResult, { ok: true }>;
}) {
  const ownershipBadge = result.callerIsOwner ? (
    <span className="rounded bg-spotify-green/20 px-2 py-0.5 text-xs font-bold uppercase tracking-widest text-spotify-green">
      caller is owner
    </span>
  ) : (
    <span className="rounded bg-yellow-500/20 px-2 py-0.5 text-xs font-bold uppercase tracking-widest text-yellow-300">
      caller is NOT owner
    </span>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">{result.playlistName ?? "(no name)"}</h2>
          {ownershipBadge}
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs text-spotify-subtext">
          <dt>Playlist id</dt>
          <dd className="font-mono text-spotify-text">{result.playlistId}</dd>
          <dt>Snapshot id</dt>
          <dd className="font-mono text-spotify-text">{result.snapshotId ?? "(null)"}</dd>
          <dt>Owner</dt>
          <dd className="text-spotify-text">
            {result.ownerDisplayName ?? "(unknown)"}{" "}
            <span className="font-mono text-spotify-subtext">({result.ownerId ?? "?"})</span>
          </dd>
          <dt>Caller</dt>
          <dd className="text-spotify-text">
            {result.callerDisplayName ?? "(unknown)"}{" "}
            <span className="font-mono text-spotify-subtext">({result.callerSpotifyId})</span>
          </dd>
          <dt>Metadata-reported total tracks</dt>
          <dd className="text-spotify-text">{result.totalTracks ?? "(null)"}</dd>
        </dl>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
          Endpoint probes
        </h3>
        {result.probes.map((probe) => (
          <ProbeCard key={probe.path} probe={probe} />
        ))}
      </div>

      {result.sampleTrackNames.length > 0 ? (
        <div className="card flex flex-col gap-2">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Sample tracks returned
          </h3>
          <ul className="flex list-disc flex-col gap-1 pl-6 text-sm text-spotify-text">
            {result.sampleTrackNames.map((name, i) => (
              <li key={i}>{name}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border border-spotify-border bg-spotify-base/50 p-4 text-xs text-spotify-subtext">
        <p className="font-bold text-spotify-text">What this tells us</p>
        <p className="mt-1">
          If the caller is the owner and at least one of <code>/items</code> or <code>/tracks</code>
          {" "}returned 200 with items, server-side sync using this user&apos;s token is viable.
          If the caller is NOT the owner and both endpoints return 403 or an empty items array,
          that&apos;s the Feb-2026 Dev-Mode ownership restriction (fix: only sync playlists the
          authed user owns, or request Extended Quota Mode).
        </p>
      </div>
    </div>
  );
}

function ProbeCard({ probe }: { probe: ProbeResult }) {
  const statusClass = probe.ok
    ? "text-spotify-green"
    : probe.status >= 400
      ? "text-red-300"
      : "text-yellow-300";
  return (
    <div className="rounded-lg border border-spotify-border bg-spotify-elevated p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`text-sm font-bold ${statusClass}`}>
          HTTP {probe.status}
        </span>
        <span className="text-sm text-spotify-text">{probe.endpoint}</span>
      </div>
      <p className="mt-1 font-mono text-xs text-spotify-subtext break-all">{probe.path}</p>
      {probe.parsedSummary ? (
        <p className="mt-1 text-xs text-spotify-text">{probe.parsedSummary}</p>
      ) : null}
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 font-mono text-[11px] text-spotify-text">
        {probe.body || "(empty body)"}
      </pre>
    </div>
  );
}
