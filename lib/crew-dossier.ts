import { prisma } from "@/lib/prisma";
import { BOMPTON_YEARS, matchesBomptonYear } from "@/lib/bompton";
import { displaySpotifyUserName } from "@/lib/spotify-user-names";

// ---------------------------------------------------------------------------
// TEMPORARY — crew dossier export.
//
// Builds a markdown dump of every Bompton playlist track, grouped by the crew
// member who added it, plus the outlier stats that make usable material for
// the Friday reminder personas (lib/friday-reminder-email.ts). Read-only:
// nothing here writes to the database.
//
// This exists so the crew's actual listening history can be mined once for
// specific, true jokes instead of recycling the same four genre gags. It is
// meant to be deleted once that data has been pulled. To remove it:
//   rm lib/crew-dossier.ts app/api/crew-dossier/route.ts \
//      app/troubleshooting/crew-dossier-button.tsx
// then drop the CrewDossierButton section from app/troubleshooting/page.tsx.
// ---------------------------------------------------------------------------

type Row = {
  season: string;
  position: number;
  trackName: string;
  artists: string;
  album: string;
  durationMs: number;
  explicit: boolean;
  addedAt: Date;
  addedBy: string;
};

export type CrewDossierResult = {
  markdown: string;
  playlistCount: number;
  trackCount: number;
};

function parseArtistNames(raw: unknown): string {
  if (!Array.isArray(raw)) return "(unknown artist)";
  const names = raw
    .map((entry) =>
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>).name
        : null,
    )
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  return names.length ? names.join(", ") : "(unknown artist)";
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Descending count of each distinct value.
function tally<T>(items: T[]): [T, number][] {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function buildCrewDossier(): Promise<CrewDossierResult> {
  const playlists = await prisma.playlist.findMany({
    include: { tracks: { orderBy: { position: "asc" } } },
  });

  // Order by season so the dump reads chronologically; anything that doesn't
  // match a known Bompton season is dropped rather than silently mixed in.
  const seasons = BOMPTON_YEARS.map((year) => ({
    year,
    playlist: playlists.find((p) => matchesBomptonYear(p.name, year)) ?? null,
  })).filter((s) => s.playlist !== null);

  const rows: Row[] = [];
  for (const { year, playlist } of seasons) {
    for (const t of playlist!.tracks) {
      rows.push({
        season: year,
        position: t.position,
        trackName: t.trackName,
        artists: parseArtistNames(t.artistsJson),
        album: t.albumName,
        durationMs: t.trackDurationMs,
        explicit: t.trackExplicit,
        addedAt: t.addedAt,
        addedBy: displaySpotifyUserName(t.addedBySpotifyId),
      });
    }
  }

  const out: string[] = [];
  const say = (s = "") => out.push(s);

  say(`# Bompton crew dossier`);
  say(
    `Generated ${new Date().toISOString()} · ${seasons.length} playlists · ${rows.length} tracks`,
  );
  say(
    `All timestamps UTC. The crew is Atlantic time, so subtract 3-4h for local.`,
  );
  say();

  say(`## Playlists`);
  for (const { year, playlist } of seasons) {
    say(
      `- **${year}** — "${playlist!.name}", ${playlist!.tracks.length} tracks, last synced ${playlist!.lastSyncAt?.toISOString() ?? "never"}`,
    );
  }
  say();

  const members = [...new Set(rows.map((r) => r.addedBy))].sort();

  say(`## Per-member`);
  for (const member of members) {
    const mine = rows
      .filter((r) => r.addedBy === member)
      .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());
    if (!mine.length) continue;

    const longest = mine.reduce((a, b) => (b.durationMs > a.durationMs ? b : a));
    const shortest = mine.reduce((a, b) => (b.durationMs < a.durationMs ? b : a));
    const artistCounts = tally(mine.flatMap((r) => r.artists.split(", ")));
    const albumCounts = tally(mine.map((r) => r.album));
    const hourCounts = tally(mine.map((r) => r.addedAt.getUTCHours()));
    const dowCounts = tally(mine.map((r) => DOW[r.addedAt.getUTCDay()]));
    const seasonCounts = tally(mine.map((r) => r.season));
    const dayCounts = tally(mine.map((r) => r.addedAt.toISOString().slice(0, 10)));

    // Longest stretch between two consecutive adds, and what broke it.
    let gapDays = 0;
    let gapFrom: Row | null = null;
    let gapTo: Row | null = null;
    for (let i = 1; i < mine.length; i++) {
      const days =
        (mine[i].addedAt.getTime() - mine[i - 1].addedAt.getTime()) / 86_400_000;
      if (days > gapDays) {
        gapDays = days;
        gapFrom = mine[i - 1];
        gapTo = mine[i];
      }
    }

    say(`### ${member} — ${mine.length} adds`);
    say(`- Per season: ${seasonCounts.map(([s, c]) => `${s}: ${c}`).join(" · ")}`);
    say(
      `- Longest: **${longest.artists} — ${longest.trackName}** (${formatDuration(longest.durationMs)})`,
    );
    say(
      `- Shortest: **${shortest.artists} — ${shortest.trackName}** (${formatDuration(shortest.durationMs)})`,
    );
    say(`- Explicit: ${mine.filter((r) => r.explicit).length}/${mine.length}`);
    say(
      `- Top artists: ${artistCounts.slice(0, 10).map(([a, c]) => `${a} (${c})`).join(", ")}`,
    );
    say(
      `- Repeat albums: ${albumCounts.filter(([, c]) => c > 1).slice(0, 8).map(([a, c]) => `${a} (${c})`).join(", ") || "none"}`,
    );
    say(`- Day of week: ${dowCounts.map(([d, c]) => `${d} ${c}`).join(", ")}`);
    say(
      `- Busiest hours (UTC): ${hourCounts.slice(0, 6).map(([h, c]) => `${String(h).padStart(2, "0")}:00 ×${c}`).join(", ")}`,
    );
    say(`- Biggest single day: ${dayCounts[0][0]} — ${dayCounts[0][1]} tracks`);
    if (gapFrom && gapTo) {
      say(
        `- Longest silence: **${Math.round(gapDays)} days** (${gapFrom.addedAt.toISOString().slice(0, 10)} → ${gapTo.addedAt.toISOString().slice(0, 10)}), broken by ${gapTo.artists} — ${gapTo.trackName}`,
      );
    }
    say();
  }

  say(`## Duplicate adds (same track more than once, any season)`);
  const dupes = tally(rows.map((r) => `${r.artists} — ${r.trackName}`)).filter(
    ([, c]) => c > 1,
  );
  if (!dupes.length) say(`_none_`);
  for (const [key, count] of dupes.slice(0, 50)) {
    const hits = rows.filter((r) => `${r.artists} — ${r.trackName}` === key);
    say(
      `- **${key}** ×${count} — ${hits.map((h) => `${h.addedBy} ${h.addedAt.toISOString().slice(0, 10)}`).join("; ")}`,
    );
  }
  say();

  say(`## Extremes`);
  const byLength = [...rows].sort((a, b) => b.durationMs - a.durationMs);
  say(
    `Longest overall: ${byLength.slice(0, 10).map((r) => `${r.artists} — ${r.trackName} (${formatDuration(r.durationMs)}, ${r.addedBy})`).join(" · ")}`,
  );
  say(
    `Shortest overall: ${byLength.slice(-10).reverse().map((r) => `${r.artists} — ${r.trackName} (${formatDuration(r.durationMs)}, ${r.addedBy})`).join(" · ")}`,
  );
  say();

  // Full list last so the aggregates above stay skimmable.
  say(`## Full track list`);
  for (const { year } of seasons) {
    say(`### ${year}`);
    for (const r of rows.filter((x) => x.season === year)) {
      say(
        `${String(r.position).padStart(3)}. ${r.artists} — ${r.trackName} · _${r.album}_ · ${formatDuration(r.durationMs)}${r.explicit ? " · E" : ""} · **${r.addedBy}** · ${r.addedAt.toISOString().replace("T", " ").slice(0, 16)}`,
      );
    }
    say();
  }

  return {
    markdown: out.join("\n"),
    playlistCount: seasons.length,
    trackCount: rows.length,
  };
}
