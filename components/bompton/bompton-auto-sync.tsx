"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BomptonYear } from "@/lib/bompton";

type Target = { year: BomptonYear; playlistId: string };

type SyncState =
  | { status: "idle" }
  | { status: "running"; done: number; total: number; current: BomptonYear }
  | { status: "done"; errors: string[] };

// Fires one /api/playlists/sync POST per Bompton playlist id the caller
// has in /me/playlists, sequentially, on mount. After the loop finishes
// we router.refresh() so the server component pulls the fresh DB data.
// Runs once per full mount — if the caller navigates away and back, it
// runs again, which is what the user asked for ("auto-sync on load").
export function BomptonAutoSync({ targets }: { targets: Target[] }) {
  const router = useRouter();
  const [state, setState] = useState<SyncState>({ status: "idle" });
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    if (targets.length === 0) {
      setState({ status: "done", errors: [] });
      return;
    }
    hasRun.current = true;

    (async () => {
      const errors: string[] = [];
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        setState({
          status: "running",
          done: i,
          total: targets.length,
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
      setState({ status: "done", errors });
      router.refresh();
    })();
  }, [targets, router]);

  if (state.status === "idle") return null;
  if (state.status === "running") {
    return (
      <div className="rounded-lg border border-spotify-green/40 bg-spotify-green/10 px-4 py-3 text-sm text-spotify-text">
        <p className="font-semibold">
          Auto-syncing Bompton playlists ({state.done}/{state.total})…
        </p>
        <p className="mt-1 text-xs text-spotify-subtext">
          Current: {state.current}. Tables below will refresh when done.
        </p>
      </div>
    );
  }
  if (state.errors.length > 0) {
    return (
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
    );
  }
  return null;
}
