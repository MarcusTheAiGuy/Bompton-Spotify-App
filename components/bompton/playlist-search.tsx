"use client";

import { useMemo, useState } from "react";
import type { SearchableTrack } from "@/lib/bompton-stats";
import { formatDuration } from "@/lib/spotify";

// Live search box that sits above the Playlist Stats block. The user
// picks a category (song / artist / album / genre) and types; the
// results list fills with every matching track across all four Bompton
// seasons, each row showing which season's playlist it's on, when it
// was added, and by who.
//
// Matching is client-side over the pre-built index the page hands us
// (a few hundred rows at most — one per track occurrence per season),
// so every keystroke re-filters with no network round-trip. Genre rows
// are searchable by the cached Last.fm tags the genre tracker uses, so
// "surf-rock" surfaces every track by an artist tagged "surf rock".

type Category = "song" | "artist" | "album" | "genre";

const CATEGORIES: {
  key: Category;
  label: string;
  placeholder: string;
  noun: string;
}[] = [
  {
    key: "song",
    label: "Song",
    placeholder: "Search song titles… e.g. Wipe Out",
    noun: "song title",
  },
  {
    key: "artist",
    label: "Artist",
    placeholder: "Search artists… e.g. The Beach Boys",
    noun: "artist",
  },
  {
    key: "album",
    label: "Album",
    placeholder: "Search albums… e.g. Surfin' USA",
    noun: "album",
  },
  {
    key: "genre",
    label: "Genre",
    placeholder: "Search genres… e.g. surf rock",
    noun: "genre",
  },
];

const MAX_RESULTS = 60;

// Lowercase and collapse separators so "surf-rock", "Surf Rock", and
// "surf_rock" all match the cached tag "surf rock". Mirrors the
// cleanTagName logic in lib/lastfm.ts so genre queries line up with how
// tags are stored.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldValues(track: SearchableTrack, category: Category): string[] {
  switch (category) {
    case "song":
      return [track.trackName];
    case "artist":
      return track.artists;
    case "album":
      return [track.album];
    case "genre":
      return track.genres;
  }
}

type Result = {
  track: SearchableTrack;
  // 2 = a field value starts with the query, 1 = it only contains it.
  score: number;
  // The specific value(s) that matched — shown as badges for the
  // artist / genre categories where the matched term isn't already the
  // row's title.
  matched: string[];
};

export function PlaylistSearch({ index }: { index: SearchableTrack[] }) {
  const [category, setCategory] = useState<Category>("song");
  const [query, setQuery] = useState("");

  const active = CATEGORIES.find((c) => c.key === category) ?? CATEGORIES[0];

  // Dataset summary for the idle (no-query) state, plus a flag for
  // whether any genre tags exist at all — genres depend on the Last.fm
  // backed artist cache, which may be empty on a fresh deploy.
  const summary = useMemo(() => {
    const seasons = new Set<string>();
    let genreTags = 0;
    const genreSet = new Set<string>();
    for (const t of index) {
      seasons.add(t.year);
      for (const g of t.genres) genreSet.add(g);
    }
    genreTags = genreSet.size;
    return { total: index.length, seasons: seasons.size, genreTags };
  }, [index]);

  const { rows, total } = useMemo(() => {
    const q = normalize(query);
    if (!q) return { rows: [] as Result[], total: 0 };
    const scored: Result[] = [];
    for (const track of index) {
      let best = 0;
      const matched: string[] = [];
      for (const value of fieldValues(track, category)) {
        if (!value) continue;
        const nv = normalize(value);
        if (nv.includes(q)) {
          matched.push(value);
          best = Math.max(best, nv.startsWith(q) ? 2 : 1);
        }
      }
      if (best > 0) scored.push({ track, score: best, matched });
    }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const at = a.track.addedAt ? Date.parse(a.track.addedAt) : 0;
      const bt = b.track.addedAt ? Date.parse(b.track.addedAt) : 0;
      if (bt !== at) return bt - at;
      return a.track.trackName.localeCompare(b.track.trackName);
    });
    return { rows: scored.slice(0, MAX_RESULTS), total: scored.length };
  }, [index, category, query]);

  const trimmed = query.trim();
  const genreUnavailable = category === "genre" && summary.genreTags === 0;

  return (
    <section className="flex flex-col gap-5 rounded-lg border border-spotify-border bg-spotify-elevated/50 p-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-widest text-spotify-subtext">
          Playlist search
        </p>
        <h2 className="text-2xl font-extrabold tracking-tight">
          Find any song across every season
        </h2>
        <p className="text-sm text-spotify-subtext">
          Pick a category and start typing. Matches show which Bompton
          playlist the song is on, when it was added, and by who — across
          all four seasons at once.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <div
          role="group"
          aria-label="Search category"
          className="inline-flex flex-wrap gap-1 self-start rounded-full border border-spotify-border bg-spotify-base/60 p-1"
        >
          {CATEGORIES.map((c) => {
            const selected = c.key === category;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setCategory(c.key)}
                className={
                  selected
                    ? "whitespace-nowrap rounded-full bg-spotify-green px-3 py-1.5 text-xs font-bold text-black sm:px-4 sm:text-sm"
                    : "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold text-spotify-subtext transition hover:text-spotify-text sm:px-4 sm:text-sm"
                }
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={active.placeholder}
            aria-label={`Search by ${active.noun} on the Bompton playlists`}
            className="w-full rounded-lg border border-spotify-border bg-spotify-base px-4 py-2.5 pr-20 text-sm text-spotify-text placeholder:text-spotify-subtext focus:border-spotify-green focus:outline-none"
          />
          {trimmed ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-spotify-highlight px-3 py-1 text-xs font-semibold text-spotify-subtext transition hover:text-spotify-text"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {genreUnavailable ? (
        <div className="rounded-lg border border-spotify-border bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
          <p className="font-semibold text-spotify-text">
            No genre tags are cached yet.
          </p>
          <p className="mt-1">
            Genres come from the Last.fm-backed artist cache that powers the
            genre tracker. They fill in as that lookup runs — set{" "}
            <code className="font-mono">LASTFM_API_KEY</code> in env, then open{" "}
            <span className="font-semibold text-spotify-text">
              Playlist stats → See more
            </span>{" "}
            so the genre card primes the cache. Song, artist, and album search
            already work below.
          </p>
        </div>
      ) : !trimmed ? (
        <p className="rounded-lg border border-spotify-border bg-spotify-base/40 px-4 py-3 text-sm text-spotify-subtext">
          Searching {summary.total.toLocaleString()} track
          {summary.total === 1 ? "" : "s"} across {summary.seasons} season
          {summary.seasons === 1 ? "" : "s"} by {active.noun}. Start typing to
          see matches.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-spotify-border bg-spotify-base/40 px-4 py-3 text-sm text-spotify-subtext">
          No tracks match{" "}
          <span className="font-semibold text-spotify-text">
            &ldquo;{trimmed}&rdquo;
          </span>{" "}
          by {active.noun}. Try a different spelling or category.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-spotify-subtext">
            <span>
              {total.toLocaleString()} match{total === 1 ? "" : "es"} by{" "}
              {active.noun}
            </span>
            {total > rows.length ? (
              <span className="font-mono">
                showing first {rows.length.toLocaleString()}
              </span>
            ) : null}
          </div>
          <ul className="flex max-h-[28rem] flex-col gap-1.5 overflow-y-auto pr-1">
            {rows.map((r, idx) => (
              <ResultRow
                key={`${r.track.trackId ?? r.track.trackOpenUrl ?? r.track.trackName}-${r.track.year}-${r.track.addedAt ?? idx}`}
                result={r}
                category={category}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ResultRow({
  result,
  category,
}: {
  result: Result;
  category: Category;
}) {
  const { track } = result;
  const addedDate = track.addedAt
    ? new Date(track.addedAt).toLocaleDateString()
    : null;
  // Only the artist / genre categories benefit from a "matched" badge —
  // for song / album the matched value is already the row's title.
  // Dedupe so a value credited twice on one track can't collide on the
  // React key.
  const matched = [...new Set(result.matched)];
  const showMatched =
    (category === "artist" || category === "genre") && matched.length > 0;

  return (
    <li className="flex flex-col gap-2 rounded border border-spotify-border bg-spotify-base/40 px-3 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {track.albumImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.albumImageUrl}
            alt=""
            className="h-10 w-10 flex-none rounded object-cover"
          />
        ) : (
          <span className="h-10 w-10 flex-none rounded bg-spotify-highlight" />
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-semibold">
            {track.trackOpenUrl ? (
              <a
                href={track.trackOpenUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-spotify-green hover:underline"
              >
                {track.trackName}
              </a>
            ) : (
              track.trackName
            )}
          </span>
          <span className="truncate text-xs text-spotify-subtext">
            {track.artistsLabel || "—"}
            {track.album ? ` · ${track.album}` : ""}
            {track.explicit ? " · E" : ""}
            {track.durationMs > 0
              ? ` · ${formatDuration(track.durationMs)}`
              : ""}
          </span>
          {showMatched ? (
            <span className="flex flex-wrap items-center gap-1 pt-0.5">
              <span className="text-[10px] uppercase tracking-widest text-spotify-subtext">
                {category === "genre" ? "Tagged" : "Matched"}
              </span>
              {matched.slice(0, 4).map((m) => (
                <span
                  key={m}
                  className={`rounded-full bg-spotify-highlight px-2 py-0.5 text-[11px] text-spotify-subtext${
                    category === "genre" ? " capitalize" : ""
                  }`}
                >
                  {m}
                </span>
              ))}
              {matched.length > 4 ? (
                <span className="text-[11px] text-spotify-subtext">
                  +{matched.length - 4}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 pl-[3.25rem] text-xs text-spotify-subtext sm:flex-col sm:items-end sm:gap-1 sm:pl-0">
        <span className="rounded-full bg-spotify-highlight px-2 py-0.5 font-mono text-[10px]">
          {track.playlistName || track.year}
        </span>
        <span className="font-mono">
          {addedDate ? `added ${addedDate}` : "add date unknown"}
        </span>
        <AddedBy label={track.addedByLabel} image={track.addedByImage} />
      </div>
    </li>
  );
}

function AddedBy({
  label,
  image,
}: {
  label: string;
  image: string | null;
}) {
  const initial = label.slice(0, 1).toUpperCase();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-spotify-subtext">by</span>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          className="h-5 w-5 rounded-full object-cover"
        />
      ) : (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-spotify-highlight text-[10px] font-bold text-spotify-text">
          {initial}
        </span>
      )}
      <span className="font-semibold text-spotify-text">{label}</span>
    </span>
  );
}
