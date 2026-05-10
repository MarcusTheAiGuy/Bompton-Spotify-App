"use client";

import { useEffect, useState } from "react";
import type { SongCountViolation } from "@/lib/bompton-stats";
import { displayCrewName } from "@/lib/spotify-user-names";

// Red warning banner for song-count rule violations. Two flavors:
//   - "past": every member should have exactly 52 songs in each
//     finished season. Triggered if any member-season is off.
//   - "current": every member should be at exactly the count of
//     Fridays elapsed in the current season. Triggered if anyone
//     is over or under.
//
// Renders nothing when violations is empty. Click opens a modal
// listing each violation with the member's actual adds for that
// season (date + song name) so the crew can tell which weeks were
// missed or where the over-add came from.

type Variant = "past" | "current";

const VARIANT_COPY: Record<
  Variant,
  {
    bannerText: string;
    modalTitle: string;
    modalKicker: string;
    modalSubtitle: (violationCount: number) => string;
  }
> = {
  past: {
    bannerText:
      "!Warning: previous-season song counts are off, click to see!",
    modalTitle: "Previous-season song count violations",
    modalKicker: "52 expected per member per season",
    modalSubtitle: (n) =>
      `${n} member-season${n === 1 ? "" : "s"} don't have exactly 52 songs.`,
  },
  current: {
    bannerText:
      "!Warning: someone is off-pace this season, click to see!",
    modalTitle: "Current-season song count is off",
    modalKicker: "One song per Friday elapsed",
    modalSubtitle: (n) =>
      `${n} member${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} off the expected count for the in-flight season.`,
  },
};

export function SongCountWarning({
  violations,
  variant,
}: {
  violations: SongCountViolation[];
  variant: Variant;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (violations.length === 0) return null;

  const copy = VARIANT_COPY[variant];
  const totalDelta = violations.reduce(
    (acc, v) => acc + Math.abs(v.delta),
    0,
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-red-500 bg-red-500/15 px-4 py-3 text-sm font-bold uppercase tracking-wide text-red-300 transition hover:bg-red-500/25 hover:text-red-100"
      >
        <span aria-hidden="true">⚠</span>
        <span>{copy.bannerText}</span>
        <span className="rounded-full bg-red-500/30 px-2 py-0.5 font-mono text-xs text-red-100">
          {violations.length} violation{violations.length === 1 ? "" : "s"} ·{" "}
          {totalDelta} song{totalDelta === 1 ? "" : "s"} off
        </span>
      </button>

      {open ? (
        <SongCountModal
          violations={violations}
          variant={variant}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function SongCountModal({
  violations,
  variant,
  onClose,
}: {
  violations: SongCountViolation[];
  variant: Variant;
  onClose: () => void;
}) {
  const copy = VARIANT_COPY[variant];

  // Group violations by member when both flavors of past-season
  // mismatches stack (same member off in multiple seasons).
  const sorted = [...violations].sort((a, b) => {
    const yearCmp = a.year.localeCompare(b.year);
    if (yearCmp !== 0) return yearCmp;
    return displayCrewName(a.member).localeCompare(displayCrewName(b.member));
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={copy.modalTitle}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close warning dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border-2 border-red-500/60 bg-spotify-elevated shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-red-500/40 bg-red-500/15 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-red-300">
              {copy.modalKicker}
            </p>
            <h2 className="text-xl font-extrabold tracking-tight">
              {copy.modalTitle}
            </h2>
            <p className="mt-1 text-xs text-red-200/80">
              {copy.modalSubtitle(violations.length)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-red-400/40 px-3 py-1 text-xs font-bold uppercase tracking-widest text-red-200 transition hover:bg-red-500/30"
          >
            Close
          </button>
        </header>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          {sorted.map((v) => (
            <ViolationRow
              key={`${v.year}::${v.member.id}`}
              violation={v}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ViolationRow({ violation }: { violation: SongCountViolation }) {
  const name = displayCrewName(violation.member);
  const deltaSign = violation.delta > 0 ? "+" : "";
  const deltaLabel = `${deltaSign}${violation.delta}`;
  const deltaClass =
    violation.delta < 0
      ? "bg-red-500/25 text-red-100"
      : "bg-amber-500/25 text-amber-100";
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-spotify-border bg-spotify-base/60 p-3">
      <div className="flex items-center gap-3">
        {violation.member.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={violation.member.image}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-spotify-highlight text-sm font-bold">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">
            {name} · {violation.year}
          </p>
          <p className="truncate text-xs text-spotify-subtext">
            {violation.actual} song{violation.actual === 1 ? "" : "s"} added ·
            expected {violation.expected}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-bold ${deltaClass}`}
        >
          {deltaLabel}
        </span>
      </div>

      {violation.adds.length === 0 ? (
        <p className="rounded bg-spotify-highlight/40 px-2 py-1.5 text-xs text-spotify-subtext">
          No adds attributed to {name} for {violation.year} at all.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 max-h-60 overflow-y-auto pr-1">
          {violation.adds.map((a, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded bg-spotify-highlight/60 px-2 py-1 text-xs"
            >
              <span className="w-7 shrink-0 text-center font-mono text-[10px] text-spotify-subtext">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">
                {a.trackName}
              </span>
              <span className="hidden min-w-0 shrink truncate text-spotify-subtext sm:inline">
                {a.artist}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-spotify-subtext">
                {a.addedAt.toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
