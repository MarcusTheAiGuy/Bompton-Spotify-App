// Read-only dump of every Bompton playlist track, grouped by crew member,
// plus the outlier stats that actually make good material for the Friday
// reminder emails (lib/friday-reminder-email.ts).
//
// Nothing is written to the database. Output goes to stdout; redirect it
// to a file. The output contains playlist track data and crew display
// names only — no emails, tokens, or Spotify credentials.
//
// Run from the repo root against your local env:
//
//   node --env-file=.env.local scripts/dump-crew-dossier.mjs > dossier.md
//
// Requires DATABASE_URL (Neon) and a generated Prisma client (npm install
// runs `prisma generate` via postinstall).

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Same map as lib/spotify-user-names.ts. Duplicated so this script stays
// runnable without a TS toolchain.
const CREW = {
  "ben.silver-ca": "Ben",
  Sachin221: "Sachin",
  Sam55Silver: "Sam",
  n8mrhp1paen9qp80qhdwv4oc2: "Evan",
};

const who = (id) => (id ? (CREW[id] ?? `(unmapped:${id})`) : "(unknown)");
const mins = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;
const artistsOf = (t) =>
  (Array.isArray(t.artistsJson) ? t.artistsJson : [])
    .map((a) => a?.name)
    .filter(Boolean)
    .join(", ") || "(unknown artist)";

function tally(items) {
  const m = new Map();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const playlists = await prisma.playlist.findMany({
  where: { name: { contains: "ompton" } },
  include: { tracks: { orderBy: { position: "asc" } } },
  orderBy: { name: "asc" },
});

const all = [];
for (const p of playlists) {
  for (const t of p.tracks) {
    all.push({
      season: p.name,
      pos: t.position,
      name: t.trackName,
      artists: artistsOf(t),
      album: t.albumName,
      ms: t.trackDurationMs,
      explicit: t.trackExplicit,
      addedAt: t.addedAt,
      by: who(t.addedBySpotifyId),
    });
  }
}

const out = [];
const say = (s = "") => out.push(s);

say(`# Bompton crew dossier`);
say(`Generated ${new Date().toISOString()} · ${playlists.length} playlists · ${all.length} tracks`);
say(`Timestamps are UTC (crew is Atlantic, so subtract 3-4h for local time).`);
say();

say(`## Playlists found`);
for (const p of playlists) {
  say(`- **${p.name}** — ${p.tracks.length} tracks, last synced ${p.lastSyncAt?.toISOString() ?? "never"}`);
}
say();

const members = [...new Set(all.map((t) => t.by))].sort();

say(`## Per-member stats`);
for (const m of members) {
  const ts = all.filter((t) => t.by === m).sort((a, b) => a.addedAt - b.addedAt);
  if (!ts.length) continue;
  const longest = ts.reduce((a, b) => (b.ms > a.ms ? b : a));
  const shortest = ts.reduce((a, b) => (b.ms < a.ms ? b : a));
  const byArtist = tally(ts.flatMap((t) => t.artists.split(", ")));
  const byAlbum = tally(ts.map((t) => t.album));
  const byHour = tally(ts.map((t) => t.addedAt.getUTCHours()));
  const byDow = tally(ts.map((t) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][t.addedAt.getUTCDay()]));
  const bySeason = tally(ts.map((t) => t.season));

  // Longest silence between two consecutive adds.
  let gap = { days: 0, from: null, to: null };
  for (let i = 1; i < ts.length; i++) {
    const d = (ts[i].addedAt - ts[i - 1].addedAt) / 86400000;
    if (d > gap.days) gap = { days: d, from: ts[i - 1], to: ts[i] };
  }
  // Most adds crammed into a single UTC day.
  const byDay = tally(ts.map((t) => t.addedAt.toISOString().slice(0, 10)));

  say(`### ${m} — ${ts.length} adds`);
  say(`- Per season: ${bySeason.map(([s, c]) => `${s}: ${c}`).join(" · ")}`);
  say(`- Longest track: **${longest.artists} — ${longest.name}** (${mins(longest.ms)})`);
  say(`- Shortest track: **${shortest.artists} — ${shortest.name}** (${mins(shortest.ms)})`);
  say(`- Explicit: ${ts.filter((t) => t.explicit).length}/${ts.length}`);
  say(`- Top artists: ${byArtist.slice(0, 8).map(([a, c]) => `${a} (${c})`).join(", ")}`);
  say(`- Albums hit more than once: ${byAlbum.filter(([, c]) => c > 1).slice(0, 6).map(([a, c]) => `${a} (${c})`).join(", ") || "none"}`);
  say(`- Add day-of-week: ${byDow.map(([d, c]) => `${d} ${c}`).join(", ")}`);
  say(`- Add hour (UTC): ${byHour.slice(0, 6).map(([h, c]) => `${h}:00 ×${c}`).join(", ")}`);
  say(`- Biggest single-day binge: ${byDay[0][0]} — ${byDay[0][1]} tracks`);
  if (gap.to) {
    say(`- Longest silence: **${Math.round(gap.days)} days**, ${gap.from.addedAt.toISOString().slice(0, 10)} → ${gap.to.addedAt.toISOString().slice(0, 10)} (broke it with ${gap.to.artists} — ${gap.to.name})`);
  }
  say();
}

// Same track added more than once, anywhere across all four seasons.
say(`## Duplicate adds (same track, more than once)`);
const dupes = tally(all.map((t) => `${t.artists} — ${t.name}`)).filter(([, c]) => c > 1);
if (!dupes.length) say(`_none_`);
for (const [key, c] of dupes.slice(0, 40)) {
  const rows = all.filter((t) => `${t.artists} — ${t.name}` === key);
  say(`- **${key}** ×${c} — ${rows.map((r) => `${r.by} on ${r.addedAt.toISOString().slice(0, 10)}`).join("; ")}`);
}
say();

say(`## Extremes across all seasons`);
const longestAll = [...all].sort((a, b) => b.ms - a.ms).slice(0, 8);
const shortestAll = [...all].sort((a, b) => a.ms - b.ms).slice(0, 8);
say(`Longest: ${longestAll.map((t) => `${t.artists} — ${t.name} (${mins(t.ms)}, ${t.by})`).join(" · ")}`);
say(`Shortest: ${shortestAll.map((t) => `${t.artists} — ${t.name} (${mins(t.ms)}, ${t.by})`).join(" · ")}`);
say();

// The full list last, so the stats above stay skimmable.
say(`## Full track list`);
for (const p of playlists) {
  say(`### ${p.name}`);
  for (const t of all.filter((x) => x.season === p.name)) {
    say(`${String(t.pos).padStart(3)}. ${t.artists} — ${t.name} · _${t.album}_ · ${mins(t.ms)}${t.explicit ? " · E" : ""} · **${t.by}** · ${t.addedAt.toISOString().replace("T", " ").slice(0, 16)}`);
  }
  say();
}

console.log(out.join("\n"));
await prisma.$disconnect();
