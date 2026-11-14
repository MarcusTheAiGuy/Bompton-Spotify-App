import { prisma } from "@/lib/prisma";
import {
  BOMPTON_YEARS,
  CREW_TIME_ZONE,
  CURRENT_BOMPTON_YEAR,
  matchesBomptonYear,
  type CrewMember,
} from "@/lib/bompton";
import { loadCrew } from "@/lib/crew";
import { FRIDAY_REMINDER_PERSONA_KEYS } from "@/lib/friday-reminder-email";
import {
  LATE_ADD_PERSONA_KEYS,
  lateAddPersonaKeysForSubject,
} from "@/lib/late-add-email";
import {
  loadFridayPersonaHistory,
  loadLateAddPersonaHistory,
  rotationQueue,
  type PersonaHistory,
} from "@/lib/persona-rotation";
import {
  displayCrewName,
  displaySpotifyUserName,
} from "@/lib/spotify-user-names";

// Everything the app knows about the crew's listening, as one JSON document:
// every Bompton add, each member's archived plays and daily Spotify
// snapshots, and the reminder emails sent so far. It is the source material
// for writing the reminder personas (lib/friday-reminder-email.ts,
// lib/late-add-email.ts) against what the crew actually does. Read-only.
//
// Raw rows rather than pre-chewed stats, on purpose: whoever writes the jokes
// can then check the context of a fact (was that burst of adds a catch-up
// after weeks of nothing?) instead of trusting a bare aggregate.
//
// Email addresses and tokens are left out.

// Spotify's "top" lists drift slowly and its "saved" lists are windows onto
// the newest 50 items, so one snapshot a week is enough to follow both.
const SNAPSHOT_SAMPLE_EVERY_DAYS = 7;
const SNAPSHOT_SAMPLE_LIMIT = 80;
const TOP_HISTORY_SIZE = 10;
const TOP_KINDS = [
  "top-tracks-short",
  "top-tracks-medium",
  "top-tracks-long",
  "top-artists-short",
  "top-artists-medium",
  "top-artists-long",
];
const SAVED_KINDS = [
  "saved-tracks",
  "saved-albums",
  "saved-shows",
  "saved-episodes",
  "saved-audiobooks",
];

// ListeningPlay grows forever, so one export doesn't read it without bound.
// Past this the oldest plays are dropped and `problems` says so.
const PLAY_LIMIT = 200_000;

const DAY_MS = 24 * 60 * 60 * 1000;

type Item = Record<string, unknown>;

type SnapshotExport = {
  capturedDays: number;
  firstDay: string;
  lastDay: string;
  // The most recent snapshot, as stored (at most 50 items).
  latest?: Item[];
  // Top kinds: the top of the list on each sampled day, oldest first.
  history?: { day: string; top: string[] }[];
  // Saved kinds: every item seen across the sampled days, newest save first.
  everSeen?: Item[];
};

type MemberListening = {
  // [Spotify track id, name, first artist, duration ms]
  tracks: [string, string, string, number][];
  // [index into `tracks`, played at (epoch seconds, UTC)], oldest first.
  plays: [number, number][];
  snapshots: Record<string, SnapshotExport>;
  devices: { name: string; type: string }[];
};

export async function buildCrewExport() {
  const crew = await loadCrew();
  const nameOf = new Map(crew.map((m) => [m.id, displayCrewName(m)]));
  const problems: string[] = [];

  // One section failing (a table that was never initialized, say) shouldn't
  // cost the rest of the export, so each is built on its own and a failure
  // is reported in `problems` with the underlying error.
  async function section<T>(
    name: string,
    build: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await build();
    } catch (error) {
      const message =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      console.error("[crew-export.section-failed]", { section: name, message });
      problems.push(`${name} could not be read — ${message}`);
      return null;
    }
  }

  const [playlists, plays, snapshots, devices, emails, artistGenres] =
    await Promise.all([
      section("playlists", () => exportPlaylists(nameOf)),
      section("plays", () => exportPlays(problems)),
      section("snapshots", exportSnapshots),
      section("devices", exportDevices),
      section("emails", () => exportEmails(crew, nameOf)),
      section("artistGenres", exportArtistGenres),
    ]);

  const listening: Record<string, MemberListening> = {};
  for (const member of crew) {
    listening[displayCrewName(member)] = {
      tracks: plays?.get(member.id)?.tracks ?? [],
      plays: plays?.get(member.id)?.plays ?? [],
      snapshots: snapshots?.get(member.id) ?? {},
      devices: devices?.get(member.id) ?? [],
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    // Every timestamp in the export is UTC; this is the zone the crew lives
    // in, for turning one into a local time.
    timeZone: CREW_TIME_ZONE,
    currentSeason: CURRENT_BOMPTON_YEAR,
    problems,
    crew: crew.map((m) => ({
      name: displayCrewName(m),
      spotifyUserId: m.spotifyUserId,
    })),
    seasons: playlists?.seasons ?? [],
    otherPlaylists: playlists?.others ?? [],
    listening,
    emails,
    artistGenres: artistGenres ?? {},
  };
}

function artistNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const name = (entry as Item | null)?.name;
    return typeof name === "string" && name ? [name] : [];
  });
}

async function exportPlaylists(nameOf: Map<string, string>) {
  const playlists = await prisma.playlist.findMany({
    select: {
      id: true,
      name: true,
      ownerName: true,
      totalTracks: true,
      lastSyncAt: true,
      links: { select: { userId: true } },
    },
  });
  const bompton = BOMPTON_YEARS.flatMap((season) => {
    const playlist = playlists.find((p) => matchesBomptonYear(p.name, season));
    return playlist ? [{ season, playlist }] : [];
  });
  const bomptonIds = new Set(bompton.map((b) => b.playlist.id));

  const tracks = await prisma.playlistTrack.findMany({
    where: { playlistId: { in: [...bomptonIds] } },
    orderBy: { position: "asc" },
    select: {
      playlistId: true,
      position: true,
      trackSpotifyId: true,
      trackName: true,
      artistsJson: true,
      albumName: true,
      trackDurationMs: true,
      trackExplicit: true,
      addedAt: true,
      addedBySpotifyId: true,
    },
  });

  return {
    seasons: bompton.map(({ season, playlist }) => ({
      season,
      playlistName: playlist.name,
      lastSyncAt: playlist.lastSyncAt?.toISOString() ?? null,
      tracks: tracks
        .filter((t) => t.playlistId === playlist.id)
        .map((t) => ({
          position: t.position,
          id: t.trackSpotifyId,
          name: t.trackName,
          artists: artistNames(t.artistsJson),
          album: t.albumName,
          durationMs: t.trackDurationMs,
          explicit: t.trackExplicit,
          addedAt: t.addedAt.toISOString(),
          addedBy: displaySpotifyUserName(t.addedBySpotifyId),
        })),
    })),
    // Playlists a crew member has put on their dashboard that aren't a
    // Bompton season. Names and sizes only.
    others: playlists
      .filter((p) => !bomptonIds.has(p.id))
      .map((p) => ({
        name: p.name,
        owner: p.ownerName,
        totalTracks: p.totalTracks,
        onDashboardOf: p.links.flatMap((l) => nameOf.get(l.userId) ?? []),
      })),
  };
}

async function exportPlays(problems: string[]) {
  const rows = await prisma.listeningPlay.findMany({
    select: {
      userId: true,
      trackSpotifyId: true,
      trackName: true,
      trackArtist: true,
      trackDurationMs: true,
      playedAt: true,
    },
    orderBy: { playedAt: "desc" },
    take: PLAY_LIMIT,
  });
  if (rows.length === PLAY_LIMIT) {
    problems.push(
      `plays were cut off at the newest ${PLAY_LIMIT.toLocaleString("en-US")} (oldest kept: ${rows[rows.length - 1].playedAt.toISOString()}). Raise PLAY_LIMIT in lib/crew-export.ts, or add a date filter, if older plays are needed.`,
    );
  }
  rows.reverse();

  // A track is written out once per member and each play points at it, which
  // roughly halves the size of the export.
  const byUser = new Map<
    string,
    Pick<MemberListening, "tracks" | "plays"> & { index: Map<string, number> }
  >();
  for (const row of rows) {
    let member = byUser.get(row.userId);
    if (!member) {
      member = { tracks: [], plays: [], index: new Map() };
      byUser.set(row.userId, member);
    }
    let trackIndex = member.index.get(row.trackSpotifyId);
    if (trackIndex === undefined) {
      trackIndex = member.tracks.length;
      member.index.set(row.trackSpotifyId, trackIndex);
      member.tracks.push([
        row.trackSpotifyId,
        row.trackName,
        row.trackArtist,
        row.trackDurationMs,
      ]);
    }
    member.plays.push([trackIndex, Math.floor(row.playedAt.getTime() / 1000)]);
  }
  return byUser;
}

function items(data: unknown): Item[] {
  return Array.isArray(data)
    ? data.filter((d): d is Item => typeof d === "object" && d !== null)
    : [];
}

function dayString(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function topLabel(item: Item): string {
  const name = typeof item.name === "string" ? item.name : "(unnamed)";
  return typeof item.artists === "string" && item.artists
    ? `${name} — ${item.artists}`
    : name;
}

async function exportSnapshots() {
  const groups = await prisma.listeningSnapshot.groupBy({
    by: ["userId", "kind"],
    _count: { _all: true },
    _min: { day: true },
    _max: { day: true },
  });
  const byUser = new Map<string, Record<string, SnapshotExport>>();
  const latestDays: { userId: string; kind: string; day: Date }[] = [];
  for (const g of groups) {
    if (!g._min.day || !g._max.day) continue;
    const kinds = byUser.get(g.userId) ?? {};
    byUser.set(g.userId, kinds);
    kinds[g.kind] = {
      capturedDays: g._count._all,
      firstDay: dayString(g._min.day),
      lastDay: dayString(g._max.day),
    };
    latestDays.push({ userId: g.userId, kind: g.kind, day: g._max.day });
  }
  if (latestDays.length === 0) return byUser;

  const newest = Math.max(...latestDays.map((l) => l.day.getTime()));
  const oldest = Math.min(...groups.map((g) => g._min.day?.getTime() ?? newest));
  const sampleDays: Date[] = [];
  for (
    let day = newest;
    day >= oldest && sampleDays.length < SNAPSHOT_SAMPLE_LIMIT;
    day -= SNAPSHOT_SAMPLE_EVERY_DAYS * DAY_MS
  ) {
    sampleDays.push(new Date(day));
  }

  const select = { userId: true, kind: true, day: true, data: true } as const;
  const [latestRows, sampledRows] = await Promise.all([
    prisma.listeningSnapshot.findMany({ where: { OR: latestDays }, select }),
    prisma.listeningSnapshot.findMany({
      where: {
        kind: { in: [...TOP_KINDS, ...SAVED_KINDS] },
        day: { in: sampleDays },
      },
      select,
      orderBy: { day: "asc" },
    }),
  ]);

  for (const row of sampledRows) {
    const snapshot = byUser.get(row.userId)?.[row.kind];
    if (!snapshot) continue;
    if (TOP_KINDS.includes(row.kind)) {
      (snapshot.history ??= []).push({
        day: dayString(row.day),
        top: items(row.data).slice(0, TOP_HISTORY_SIZE).map(topLabel),
      });
    } else {
      (snapshot.everSeen ??= []).push(...items(row.data));
    }
  }
  for (const row of latestRows) {
    const snapshot = byUser.get(row.userId)?.[row.kind];
    if (!snapshot) continue;
    if (SAVED_KINDS.includes(row.kind)) {
      (snapshot.everSeen ??= []).push(...items(row.data));
    } else {
      snapshot.latest = items(row.data);
    }
  }
  // The same save shows up in every snapshot until 50 newer ones push it
  // out of the window, so keep one copy of each.
  for (const kinds of byUser.values()) {
    for (const snapshot of Object.values(kinds)) {
      if (!snapshot.everSeen) continue;
      const seen = new Map<unknown, Item>();
      for (const item of snapshot.everSeen) seen.set(item.id, item);
      snapshot.everSeen = [...seen.values()].sort((a, b) =>
        String(b.addedAt ?? "").localeCompare(String(a.addedAt ?? "")),
      );
    }
  }
  return byUser;
}

// The devices each member's Spotify last reported, from the dashboard's
// response cache. Only as fresh as their last dashboard visit.
async function exportDevices() {
  const rows = await prisma.cachedSpotifyResponse.findMany({
    where: { kind: "devices" },
    select: { userId: true, data: true },
  });
  const byUser = new Map<string, MemberListening["devices"]>();
  for (const row of rows) {
    const devices = items((row.data as Item | null)?.devices);
    byUser.set(
      row.userId,
      devices.map((d) => ({ name: String(d.name), type: String(d.type) })),
    );
  }
  return byUser;
}

function queueExport(keys: readonly string[], history: PersonaHistory) {
  return rotationQueue(keys, history).map((p) => ({
    persona: p.key,
    lastSentAt: p.lastSentAt ? new Date(p.lastSentAt).toISOString() : null,
  }));
}

async function exportEmails(crew: CrewMember[], nameOf: Map<string, string>) {
  const [fridaySends, lateAddSends, fridayHistory, lateAddHistory] =
    await Promise.all([
      prisma.fridayReminderNotification.findMany({
        select: {
          weekOf: true,
          sentAt: true,
          personaKey: true,
          resendId: true,
          errorMessage: true,
        },
        orderBy: { sentAt: "asc" },
      }),
      prisma.lateAddNotification.findMany({
        select: {
          userId: true,
          sentAt: true,
          bomptonYear: true,
          weeksBehind: true,
          emailSubject: true,
          resendId: true,
          errorMessage: true,
        },
        orderBy: { sentAt: "asc" },
      }),
      loadFridayPersonaHistory(),
      loadLateAddPersonaHistory(crew),
    ]);
  return {
    friday: {
      // Every persona, in the order the rotation will send them from here.
      queue: queueExport(FRIDAY_REMINDER_PERSONA_KEYS, fridayHistory),
      sends: fridaySends.map((s) => ({
        weekOf: dayString(s.weekOf),
        sentAt: s.sentAt.toISOString(),
        persona: s.personaKey,
        delivered: s.resendId !== null,
        error: s.errorMessage,
      })),
    },
    lateAdd: {
      queue: queueExport(LATE_ADD_PERSONA_KEYS, lateAddHistory),
      sends: lateAddSends.map((s) => {
        const offender = crew.find((m) => m.id === s.userId);
        return {
          to: nameOf.get(s.userId) ?? s.userId,
          sentAt: s.sentAt.toISOString(),
          season: s.bomptonYear,
          weeksBehind: s.weeksBehind,
          subject: s.emailSubject,
          persona:
            (offender &&
              lateAddPersonaKeysForSubject(s.emailSubject, {
                offender,
                weeksBehind: s.weeksBehind,
                bomptonYear: s.bomptonYear,
              })[0]) ??
            null,
          delivered: s.resendId !== null,
          error: s.errorMessage,
        };
      }),
    },
  };
}

// Last.fm tags for every artist the genre tracker has looked up, by name.
async function exportArtistGenres() {
  const artists = await prisma.artist.findMany({
    select: { name: true, genres: true },
  });
  const byName: Record<string, string[]> = {};
  for (const artist of artists) {
    const genres = Array.isArray(artist.genres)
      ? artist.genres.filter((g): g is string => typeof g === "string")
      : [];
    if (genres.length > 0) byName[artist.name] = genres;
  }
  return byName;
}
