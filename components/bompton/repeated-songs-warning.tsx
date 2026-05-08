"use client";

import { useEffect, useState } from "react";
import type { RepeatedTrack } from "@/lib/bompton-stats";

// Renders the red warning banner only if there's at least one duplicate
// across the four Bompton seasons. Clicking opens a modal listing every
// occurrence with the contributor's profile image, song/artist, and
// playlist source. If the array is empty the component renders nothing.

export function RepeatedSongsWarning({
  repeats,
}: {
  repeats: RepeatedTrack[];
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

  if (repeats.length === 0) return null;

  const totalDupes = repeats.reduce(
    (acc, r) => acc + (r.occurrences.length - 1),
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
        <span>
          !Warning: there are repeated songs on the playlist, click to see!
        </span>
        <span className="rounded-full bg-red-500/30 px-2 py-0.5 font-mono text-xs text-red-100">
          {repeats.length} song{repeats.length === 1 ? "" : "s"} ·{" "}
          {totalDupes} dup{totalDupes === 1 ? "" : "s"}
        </span>
      </button>

      {open ? (
        <RepeatedSongsModal
          repeats={repeats}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function RepeatedSongsModal({
  repeats,
  onClose,
}: {
  repeats: RepeatedTrack[];
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Repeated songs across Bompton playlists"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close repeated songs dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      {/* Panel */}
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border-2 border-red-500/60 bg-spotify-elevated shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-red-500/40 bg-red-500/15 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-red-300">
              Cross-season duplicates
            </p>
            <h2 className="text-xl font-extrabold tracking-tight">
              Repeated songs on the Bompton playlists
            </h2>
            <p className="mt-1 text-xs text-red-200/80">
              {repeats.length} song{repeats.length === 1 ? "" : "s"} appear in
              more than one place. Each row shows every occurrence — who
              added it and which playlist it landed in.
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
          {repeats.map((repeat) => (
            <article
              key={repeat.key}
              className="flex flex-col gap-3 rounded-lg border border-spotify-border bg-spotify-base/60 p-3"
            >
              <div className="flex items-center gap-3">
                {repeat.albumImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={repeat.albumImageUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 shrink-0 rounded bg-spotify-highlight" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{repeat.trackName}</p>
                  <p className="truncate text-xs text-spotify-subtext">
                    {repeat.artist || "Unknown artist"}
                  </p>
                </div>
                <span className="rounded-full bg-red-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-red-200">
                  {repeat.occurrences.length}×
                </span>
              </div>

              <ul className="flex flex-col gap-2">
                {repeat.occurrences.map((occ, idx) => (
                  <li
                    key={`${occ.year}-${idx}`}
                    className="flex items-center gap-2 rounded bg-spotify-highlight/60 px-2 py-1.5 text-xs"
                  >
                    {occ.addedByImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={occ.addedByImage}
                        alt=""
                        title={occ.addedByLabel}
                        className="h-7 w-7 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span
                        title={occ.addedByLabel}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-spotify-base text-[10px] font-bold"
                      >
                        {occ.addedByLabel.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate font-semibold">
                        {occ.addedByLabel}
                      </span>
                      <span className="truncate text-[10px] text-spotify-subtext">
                        {occ.playlistName} · pos #{occ.position} ·{" "}
                        {occ.addedAt
                          ? new Date(occ.addedAt).toLocaleDateString()
                          : "no date"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
