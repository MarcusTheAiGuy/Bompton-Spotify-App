"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BomptonYear } from "@/lib/bompton";

export type SyncTarget = {
  year: BomptonYear;
  playlistId: string;
  lastSyncAt: string | null;
};

type SyncState =
  | { status: "idle" }
  | { status: "running"; done: number; total: number; current: BomptonYear }
  | { status: "done"; errors: string[]; ranCount: number };

// On mount: sync each Bompton playlist whose last sync is >= staleMs old.
// Playlists that are fresher are skipped entirely — no API call. A
// refresh button is also rendered that re-syncs EVERY target
// (regardless of lastSyncAt) for when the user wants to force an update.
export function BomptonAutoSync({
  targets,
  staleMs = 60 * 60_000, // 1 hour default; caller override via prop
}: {
  targets: SyncTarget[];
  staleMs?: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<SyncState>({ status: "idle" });
  const hasAutoRun = useRef(false);

  async function runSyncOnSet(set: SyncTarget[]) {
    if (set.length === 0) {
      setState({ status: "done", errors: [], ranCount: 0 });
      return;
    }
    const errors: string[] = [];
    for (let i = 0; i < set.length; i++) {
      const target = set[i];
      setState({
        status: "running",
        done: i,
        total: set.length,
        current: target.year,
      });
      try {
        const response = await fetch("/api/playlists/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playlistInput: target.playlistId }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          errors.push(
            `${target.year}: ${body?.error ?? "SyncError"} ${response.status} — ${body?.message ?? "unknown"}`,
          );
        }
      } catch (error) {
        errors.push(
          `${target.year}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    setState({ status: "done", errors, ranCount: set.length });
    router.refresh();
  }

  useEffect(() => {
    if (hasAutoRun.current) return;
    hasAutoRun.current = true;
    const now = Date.now();
    const stale = targets.filter((t) => {
      if (!t.lastSyncAt) return true;
      return now - new Date(t.lastSyncAt).getTime() >= staleMs;
    });
    if (stale.length === 0) {
      setState({ status: "done", errors: [], ranCount: 0 });
      return;
    }
    void runSyncOnSet(stale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = state.status === "running";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (running) return;
            hasAutoRun.current = true;
            void runSyncOnSet(targets);
          }}
          disabled={running || targets.length === 0}
          className="btn-ghost self-start disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running
            ? `Refreshing ${state.done + 1}/${state.total}…`
            : `Refresh all ${targets.length} Bompton playlists`}
        </button>
        <p className="text-xs text-spotify-subtext">
          Auto-syncs on page open only if a playlist hasn&apos;t been updated
          in over an hour. Click to force a fresh pull regardless.
        </p>
      </div>

      {state.status === "running" ? (
        <p className="text-xs text-spotify-subtext">
          Current: {state.current}. Tables below will refresh when done.
        </p>
      ) : null}

      {state.status === "done" && state.ranCount > 0 && state.errors.length === 0 ? (
        <p className="text-xs text-spotify-green">
          Synced {state.ranCount} playlist{state.ranCount === 1 ? "" : "s"}.
        </p>
      ) : null}

      {state.status === "done" && state.errors.length > 0 ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <p className="font-semibold">
            Sync finished with {state.errors.length} error(s).
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-xs">
            {state.errors.map((err, i) => (
              <li key={i} className="whitespace-pre-wrap">
                {err}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
