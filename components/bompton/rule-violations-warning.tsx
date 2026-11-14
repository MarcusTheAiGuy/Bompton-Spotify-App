"use client";

import { useState, type ReactNode } from "react";

// One collapsed red button that stands in for every playlist rule
// warning (repeated songs, past-season counts, current-season pace).
// Clicking it expands the individual warning banners, each of which
// still opens its own detail modal. Renders nothing when there are no
// violations at all.
export function RuleViolationsWarning({
  violationCount,
  children,
}: {
  violationCount: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  if (violationCount === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="rule-violations-list"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-red-500 bg-red-500/15 px-4 py-3 text-sm font-bold uppercase tracking-wide text-red-300 transition hover:bg-red-500/25 hover:text-red-100"
      >
        <span aria-hidden="true">⚠</span>
        <span>
          Warning: Playlist Rule Violations Detected. Click To See Them.
        </span>
        <span className="rounded-full bg-red-500/30 px-2 py-0.5 font-mono text-xs text-red-100">
          {violationCount}
        </span>
        <span
          aria-hidden="true"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open ? (
        <div
          id="rule-violations-list"
          className="flex flex-col gap-3 rounded-lg border border-red-500/40 bg-red-500/5 p-3"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
