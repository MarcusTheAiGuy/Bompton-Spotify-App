"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SyncOutcome = {
  userId: string;
  userLabel: string;
  playlistId: string;
  playlistName: string | null;
  status: "synced" | "skipped" | "error";
  tracksWritten?: number;
  snapshotChanged?: boolean;
  error?: { name: string; code?: string; message: string };
};

type SyncResponse = {
  ok: boolean;
  totalLinks: number;
  attempted: number;
  synced: number;
  errors: number;
  skippedFresh: number;
  outcomes: SyncOutcome[];
};

type State =
  | { status: "idle" }
  | { status: "running"; force: boolean }
  | { status: "done"; result: SyncResponse; force: boolean }
  | { status: "failed"; title: string; detail: string; force: boolean };

// Mounts on the dashboard and fires POST /api/sync-all-playlists once.
// That endpoint iterates over EVERY UserPlaylistLink in the DB and resyncs
// each one with the owning user's stored OAuth token. So whoever opens
// their dashboard ends up nudging the whole crew's data fresh.
//
// Auto-run on mount uses the server-side 1h staleness filter (no force).
// The "Force resync everyone" button sends { force: true } to bypass the
// filter for cases where the stored data is wrong but the snapshot looks
// current.
export function DashboardAutoSyncAll() {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });
  const hasAutoRun = useRef(false);

  async function run(force: boolean) {
    setState({ status: "running", force });
    try {
      const response = await fetch("/api/sync-all-playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<
        SyncResponse & { error?: string; message?: string }
      >;
      if (!response.ok) {
        setState({
          status: "failed",
          title:
            (body as { error?: string }).error ?? `HTTP ${response.status}`,
          detail:
            (body as { message?: string }).message ??
            `POST /api/sync-all-playlists returned ${response.status}.`,
          force,
        });
        return;
      }
      setState({
        status: "done",
        result: body as SyncResponse,
        force,
      });
      // Pull fresh DB rows into the page so any synced playlist tracks
      // appear without a hard reload.
      router.refresh();
    } catch (error) {
      setState({
        status: "failed",
        title: error instanceof Error ? error.name : "NetworkError",
        detail:
          error instanceof Error
            ? `${error.message}. Check the network tab and server logs for /api/sync-all-playlists.`
            : String(error),
        force,
      });
    }
  }

  useEffect(() => {
    if (hasAutoRun.current) return;
    hasAutoRun.current = true;
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = state.status === "running";

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-spotify-border bg-spotify-elevated/40 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-widest text-spotify-subtext">
          Crew-wide sync
        </span>
        <button
          type="button"
          onClick={() => {
            if (running) return;
            void run(true);
          }}
          disabled={running}
          className="btn-ghost disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running
            ? state.force
              ? "Force-resyncing everyone…"
              : "Syncing everyone…"
            : "Force resync everyone"}
        </button>
        <p className="text-xs text-spotify-subtext">
          Auto-runs on dashboard open and resyncs every UserPlaylistLink whose
          last sync is older than 1 hour. Each link is synced with its
          owner&apos;s own Spotify token. Click to force a resync of every link
          regardless of staleness.
        </p>
      </div>

      {state.status === "running" ? (
        <p className="text-xs text-spotify-subtext">
          Iterating links sequentially — this may take a few seconds per
          stale playlist. Page data refreshes when done.
        </p>
      ) : null}

      {state.status === "done" ? (
        <SyncSummary result={state.result} />
      ) : null}

      {state.status === "failed" ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <p className="font-semibold">
            Crew sync request failed: {state.title}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{state.detail}</p>
        </div>
      ) : null}
    </section>
  );
}

function SyncSummary({ result }: { result: SyncResponse }) {
  const failed = result.outcomes.filter((o) => o.status === "error");
  const synced = result.outcomes.filter((o) => o.status === "synced");

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-spotify-subtext">
        Attempted <strong>{result.attempted}</strong> of{" "}
        <strong>{result.totalLinks}</strong> links · synced{" "}
        <strong className="text-spotify-green">{result.synced}</strong> ·
        skipped (fresh){" "}
        <strong>{result.skippedFresh}</strong> · errors{" "}
        <strong className={result.errors > 0 ? "text-red-400" : ""}>
          {result.errors}
        </strong>
      </p>

      {synced.length > 0 ? (
        <details className="text-xs text-spotify-subtext">
          <summary className="cursor-pointer">
            Show {synced.length} synced link
            {synced.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-4">
            {synced.map((o) => (
              <li key={`${o.userId}-${o.playlistId}`}>
                <span className="text-spotify-text">{o.userLabel}</span> ·{" "}
                {o.playlistName ?? o.playlistId} ·{" "}
                {o.snapshotChanged ? `${o.tracksWritten ?? 0} tracks rewritten` : "snapshot unchanged"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {failed.length > 0 ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <p className="font-semibold">
            {failed.length} link{failed.length === 1 ? "" : "s"} failed to
            sync:
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {failed.map((o) => (
              <li
                key={`${o.userId}-${o.playlistId}`}
                className="whitespace-pre-wrap"
              >
                <strong>{o.userLabel}</strong> ·{" "}
                {o.playlistName ?? o.playlistId}: {o.error?.name}
                {o.error?.code ? ` (${o.error.code})` : ""} —{" "}
                {o.error?.message ?? "unknown error"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
