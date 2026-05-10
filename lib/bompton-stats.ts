import type { SpotifyPlaylistTrack } from "@/lib/spotify";
import type { BomptonPlaylistByYear } from "@/lib/bompton-playlist-db";
import type { BomptonYear, CrewMember } from "@/lib/bompton";
import {
  CURRENT_BOMPTON_YEAR,
  fridaysBetween,
  mostRecentFriday,
  seasonEnd,
  seasonStart,
} from "@/lib/bompton";
import {
  getArtistGenresForIds,
  type ArtistGenres,
  type ArtistGenresFetchError,
} from "@/lib/artist-genres";
import { umbrellaOf } from "@/lib/genre-taxonomy";
import { prisma } from "@/lib/prisma";
import {
  displayCrewName,
  displaySpotifyUserName,
} from "@/lib/spotify-user-names";

// Aggregations over the four-season Bompton dataset for the deep-stats
// page. Every function is a pure transform of what loadBomptonDataFromDb
// returns + the crew list, so the same data shape that drives the main
// page also feeds these analyses without an extra DB round-trip.

export type FlattenedTrack = {
  track: SpotifyPlaylistTrack;
  year: BomptonYear;
};

// Track shape the stats-card detail pages render — every field a row
// might need (track metadata, who-added crew member, when-added) is
// pre-resolved so each detail component can stay a thin presentation
// layer. Built from FlattenedTrack[] + crew[].
export type EnrichedTrack = {
  year: BomptonYear;
  trackId: string | null;
  trackName: string;
  trackUri: string;
  trackOpenUrl: string | null;
  artistsLabel: string;
  albumName: string;
  albumImageUrl: string | null;
  durationMs: number;
  explicit: boolean;
  isLocal: boolean;
  addedAt: Date | null;
  addedAtLabel: string;
  addedBy: CrewMember | null;
  addedByLabel: string;
  addedByImage: string | null;
};

export function enrichTracks(
  flat: FlattenedTrack[],
  crew: CrewMember[],
): EnrichedTrack[] {
  return flat.flatMap(({ track, year }): EnrichedTrack[] => {
    if (!track.track) return [];
    const t = track.track;
    const member = findCrewBySpotifyId(crew, track.added_by?.id);
    const addedAt = track.added_at ? new Date(track.added_at) : null;
    const addedAtMs = addedAt?.getTime();
    return [
      {
        year,
        trackId: t.id || null,
        trackName: t.name,
        trackUri: t.uri,
        trackOpenUrl: t.id ? `https://open.spotify.com/track/${t.id}` : null,
        artistsLabel: (t.artists ?? [])
          .map((a) => a.name)
          .filter(Boolean)
          .join(", "),
        albumName: t.album?.name ?? "",
        albumImageUrl: t.album?.images?.[0]?.url ?? null,
        durationMs: t.duration_ms ?? 0,
        explicit: Boolean(t.explicit),
        isLocal: Boolean(track.is_local),
        addedAt,
        addedAtLabel:
          addedAtMs !== undefined && !Number.isNaN(addedAtMs)
            ? addedAt!.toISOString()
            : "",
        addedBy: member,
        addedByLabel: member
          ? displayCrewName(member)
          : displaySpotifyUserName(track.added_by?.id),
        addedByImage: member?.image ?? null,
      },
    ];
  });
}

export function flattenAllSeasons(
  data: BomptonPlaylistByYear[],
): FlattenedTrack[] {
  const out: FlattenedTrack[] = [];
  for (const season of data) {
    for (const t of season.tracks) {
      out.push({ track: t, year: season.year });
    }
  }
  return out;
}

function findCrewBySpotifyId(
  crew: CrewMember[],
  spotifyId: string | null | undefined,
): CrewMember | null {
  if (!spotifyId) return null;
  return crew.find((m) => m.spotifyUserId === spotifyId) ?? null;
}

// ---------- Repeated tracks across all four seasons ----------

export type RepeatedTrackOccurrence = {
  year: BomptonYear;
  playlistName: string;
  position: number;
  addedAt: string;
  addedBySpotifyId: string | null;
  addedByCrew: CrewMember | null;
  addedByLabel: string;
  addedByImage: string | null;
};

export type RepeatedTrack = {
  key: string;
  trackName: string;
  artist: string;
  albumImageUrl: string | null;
  occurrences: RepeatedTrackOccurrence[];
};

function trackDedupeKey(
  trackId: string | null | undefined,
  trackName: string,
  artistName: string,
): string {
  if (trackId) return `id:${trackId}`;
  const n = (trackName ?? "").trim().toLowerCase();
  const a = (artistName ?? "").trim().toLowerCase();
  if (!n) return "";
  return `na:${n}|||${a}`;
}

export function findRepeatedTracks(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
): RepeatedTrack[] {
  const map = new Map<string, RepeatedTrack>();
  for (const season of data) {
    const playlistName = season.playlist?.name ?? `Bompton ${season.year}`;
    season.tracks.forEach((t, position) => {
      if (!t.track) return;
      const trackName = t.track.name;
      const artist = t.track.artists?.[0]?.name ?? "";
      const key = trackDedupeKey(t.track.id, trackName, artist);
      if (!key) return;
      const member = findCrewBySpotifyId(crew, t.added_by?.id);
      const occ: RepeatedTrackOccurrence = {
        year: season.year,
        playlistName,
        position: position + 1,
        addedAt: t.added_at,
        addedBySpotifyId: t.added_by?.id ?? null,
        addedByCrew: member,
        addedByLabel: member
          ? displayCrewName(member)
          : displaySpotifyUserName(t.added_by?.id),
        addedByImage: member?.image ?? null,
      };
      const existing = map.get(key);
      if (existing) {
        existing.occurrences.push(occ);
        return;
      }
      map.set(key, {
        key,
        trackName,
        artist,
        albumImageUrl: t.track.album?.images?.[0]?.url ?? null,
        occurrences: [occ],
      });
    });
  }
  return [...map.values()]
    .filter((r) => r.occurrences.length > 1)
    .sort((a, b) => b.occurrences.length - a.occurrences.length);
}

// ---------- Stat helpers shared across cards ----------

// Lightweight summary used by the main page's PlaylistStatsSummary block.
// Computed alongside the full bundle but not surfaced as a card on the
// stats page itself.
export type PlaylistVitals = {
  totalTracks: number;
  totalDurationMs: number;
  uniqueArtists: number;
  uniqueAlbums: number;
  uniqueTracks: number;
  seasonsWithData: number;
  totalSeasons: number;
  perSeasonCounts: { year: BomptonYear; count: number }[];
};

export function getPlaylistVitals(
  flat: FlattenedTrack[],
  data: BomptonPlaylistByYear[],
): PlaylistVitals {
  let totalDurationMs = 0;
  const artists = new Set<string>();
  const albums = new Set<string>();
  const trackKeys = new Set<string>();
  for (const { track } of flat) {
    if (!track.track) continue;
    totalDurationMs += track.track.duration_ms;
    for (const a of track.track.artists ?? []) {
      const name = a.name?.trim();
      if (name) artists.add(name.toLowerCase());
    }
    const albumName = track.track.album?.name?.trim();
    if (albumName) albums.add(albumName.toLowerCase());
    const key = track.track.id || track.track.uri || track.track.name;
    if (key) trackKeys.add(key);
  }
  return {
    totalTracks: flat.length,
    totalDurationMs,
    uniqueArtists: artists.size,
    uniqueAlbums: albums.size,
    uniqueTracks: trackKeys.size,
    seasonsWithData: data.filter((d) => d.tracks.length > 0).length,
    totalSeasons: data.length,
    perSeasonCounts: data.map((d) => ({ year: d.year, count: d.tracks.length })),
  };
}

// All-time crew leaderboard (used by the main page summary block; the
// stats page replaces this slot with the listening dedication card).
export type CrewLeaderboardEntry = {
  crewMember: CrewMember;
  totalAdds: number;
  bySeasonCount: { year: BomptonYear; count: number }[];
};

export function getAllTimeLeaderboard(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
): CrewLeaderboardEntry[] {
  const entries: CrewLeaderboardEntry[] = crew.map((c) => ({
    crewMember: c,
    totalAdds: 0,
    bySeasonCount: data.map((d) => ({ year: d.year, count: 0 })),
  }));
  const byId = new Map(entries.map((e) => [e.crewMember.id, e]));
  for (const season of data) {
    for (const t of season.tracks) {
      const member = findCrewBySpotifyId(crew, t.added_by?.id);
      if (!member) continue;
      const entry = byId.get(member.id);
      if (!entry) continue;
      entry.totalAdds += 1;
      const yr = entry.bySeasonCount.find((s) => s.year === season.year);
      if (yr) yr.count += 1;
    }
  }
  return entries.sort((a, b) => b.totalAdds - a.totalAdds);
}

// ---------- Card 1: Genre tracker ----------

export type GenreCount = { genre: string; count: number };

// Per-crew genre summary. We surface two slots instead of a free
// top-3 list: an umbrella (Rap / Rock / Pop / …, resolved via
// lib/genre-taxonomy) and the strongest sub-genre tag inside that
// umbrella. `subGenre` is null when the member's only tags inside
// the top umbrella ARE the umbrella itself (e.g. only "rap" with
// no further qualifier). `umbrella` is null when the member has no
// genre tags at all in our cache.
export type GenreBreakdownPerCrew = {
  crewMember: CrewMember;
  umbrella: GenreCount | null;
  subGenre: GenreCount | null;
  totalGenreHits: number;
};

export type GenreBreakdown = {
  perCrew: GenreBreakdownPerCrew[];
  overall: GenreCount[];
  totalArtistsLookedUp: number;
  totalArtistsWithGenres: number;
  // Bubbled up from getArtistGenresForIds so the genre card can show
  // "click Initialize Artist table on /troubleshooting" when the
  // backing table simply doesn't exist yet.
  artistTableMissing: boolean;
  // Diagnostic: how many of the playlist's tracks have at least one
  // artist with a Spotify id on file. When this is 0 with tracksTotal
  // > 0, the stored PlaylistTrack rows lack artist ids — the user
  // needs to Reset + re-sync (the Refresh button short-circuits on
  // snapshot match and won't repull stale rows).
  tracksTotal: number;
  tracksWithAnyArtistId: number;
  // The most recent Last.fm fetch failure (HTTP + Last.fm code +
  // body preview) and how many artist calls we attempted vs failed
  // on this render. The empty state surfaces these so users see the
  // real cause when the lookup returns nothing.
  artistLookupFetchError: ArtistGenresFetchError | null;
  artistLookupBatchesAttempted: number;
  artistLookupBatchesFailed: number;
  // Diagnostic surface: did we even try Last.fm, and how many
  // artists are still uncached after the per-render fetch budget?
  artistLookupApiKeyConfigured: boolean;
  artistLookupFetchBudgetRemaining: number;
};

// Minimum absolute count for a sub-genre tag to be eligible for
// "most distinctive" share-based selection. Below this floor, share
// numbers get noisy — a tag with member count 1 / overall 1 has 100%
// share but tells you nothing. Tags below the floor still compete
// in the absolute-count fallback so a member with sparse tagging
// isn't left with an empty sub slot.
const SUBGENRE_MIN_COUNT = 2;

// Reduce a member's data to (top umbrella, top sub-genre).
//
// Umbrella selection uses TRACK counts per umbrella (each track
// votes once per umbrella it touches, capped at one vote per
// umbrella per track). Summing tag counts would bias toward
// genres whose artists carry more sub-tags on Last.fm — rap
// artists routinely have 5+ canonical sub-tags after our merge,
// so summing gives rap a 3-5x edge over rock per track even
// when the member's listening is balanced.
//
// Sub-genre selection picks the tag with the highest "personal
// share" inside the chosen umbrella — share = (member's count
// for the tag) / (playlist's overall count for the tag). This
// surfaces what's DISTINCTIVE about the member rather than
// re-surfacing whatever Last.fm tag is most universally applied
// (without this, "underground rap" wins for everyone, since
// Last.fm tags it on nearly every rap artist). The bare umbrella
// name is excluded — its sub slot would be redundant with the
// umbrella line. Tags below SUBGENRE_MIN_COUNT are excluded from
// share ranking to avoid noise; if the share-ranked set is empty
// we fall back to highest absolute count among any sub-tag.
//
// When no tag in the member's set maps to any known umbrella,
// surface the highest-count tag as the umbrella line so the slot
// isn't empty (subGenre stays null).
function pickUmbrellaAndSubGenre(
  tagCounts: Map<string, number>,
  umbrellaTrackCounts: Map<string, number>,
  overallTagCounts: Map<string, number>,
): { umbrella: GenreCount | null; subGenre: GenreCount | null } {
  if (tagCounts.size === 0) return { umbrella: null, subGenre: null };

  if (umbrellaTrackCounts.size === 0) {
    const top = [...tagCounts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    return {
      umbrella: { genre: top[0], count: top[1] },
      subGenre: null,
    };
  }

  const [topUmbName, topUmbCount] = [...umbrellaTrackCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];

  const subInUmbrella: { tag: string; count: number; share: number }[] = [];
  for (const [tag, count] of tagCounts) {
    if (tag === topUmbName) continue;
    if (umbrellaOf(tag) !== topUmbName) continue;
    const overall = overallTagCounts.get(tag) ?? count;
    const share = overall > 0 ? count / overall : 0;
    subInUmbrella.push({ tag, count, share });
  }

  let subGenre: GenreCount | null = null;
  if (subInUmbrella.length > 0) {
    const eligible = subInUmbrella.filter((s) => s.count >= SUBGENRE_MIN_COUNT);
    const pool = eligible.length > 0 ? eligible : subInUmbrella;
    const ranked = pool.slice().sort((a, b) => {
      // Share-distinctive tags first; ties broken by raw count then
      // alpha so output is deterministic.
      if (eligible.length > 0) {
        if (b.share !== a.share) return b.share - a.share;
        if (b.count !== a.count) return b.count - a.count;
      } else {
        if (b.count !== a.count) return b.count - a.count;
      }
      return a.tag.localeCompare(b.tag);
    });
    const top = ranked[0];
    subGenre = { genre: top.tag, count: top.count };
  }

  return {
    umbrella: { genre: topUmbName, count: topUmbCount },
    subGenre,
  };
}

export function getGenreBreakdown(
  flat: FlattenedTrack[],
  crew: CrewMember[],
  artistGenres: Map<string, ArtistGenres>,
  artistTableMissing: boolean,
  artistLookupFetchError: ArtistGenresFetchError | null = null,
  artistLookupBatchesAttempted = 0,
  artistLookupBatchesFailed = 0,
  artistLookupApiKeyConfigured = false,
  artistLookupFetchBudgetRemaining = 0,
): GenreBreakdown {
  const perCrewCounts = new Map<string, Map<string, number>>();
  const perCrewUmbrellaTrackCounts = new Map<string, Map<string, number>>();
  const perCrewTotals = new Map<string, number>();
  for (const c of crew) {
    perCrewCounts.set(c.id, new Map());
    perCrewUmbrellaTrackCounts.set(c.id, new Map());
    perCrewTotals.set(c.id, 0);
  }
  const overallCounts = new Map<string, number>();

  let tracksTotal = 0;
  let tracksWithAnyArtistId = 0;

  for (const { track } of flat) {
    if (!track.track) continue;
    tracksTotal += 1;
    const hasAnyArtistId = (track.track.artists ?? []).some(
      (a) => typeof a?.id === "string" && a.id.length > 0,
    );
    if (hasAnyArtistId) tracksWithAnyArtistId += 1;

    // Union of every genre across every artist on this track. A genre
    // shared by multiple credited artists still only contributes +1
    // for the track — e.g. a feature where artist A is tagged
    // {rock, alt rock} and artist B is tagged {rock, rap} adds +1 to
    // rock, +1 to alt rock, +1 to rap.
    const trackGenres = new Set<string>();
    for (const artistRef of track.track.artists ?? []) {
      const id = artistRef?.id;
      if (!id) continue;
      const data = artistGenres.get(id);
      if (!data) continue;
      for (const g of data.genres) trackGenres.add(g);
    }
    if (trackGenres.size === 0) continue;

    // Set of umbrellas this track touches. We accumulate per-umbrella
    // TRACK counts (1 vote per umbrella per track, regardless of how
    // many sub-tags the artist carries) so the umbrella picker isn't
    // biased toward genres whose artists tend to have more sub-tags
    // on Last.fm — rap artists are tagged with {rap, underground rap,
    // conscious rap, trap, …} so summing tag counts gives rap a 3-5x
    // advantage over rock per track. Track-count fixes that.
    const trackUmbrellas = new Set<string>();
    for (const g of trackGenres) {
      const u = umbrellaOf(g);
      if (u) trackUmbrellas.add(u);
    }

    const member = findCrewBySpotifyId(crew, track.added_by?.id);
    const memberCounts = member ? perCrewCounts.get(member.id) : null;
    const memberUmbrellaCounts = member
      ? perCrewUmbrellaTrackCounts.get(member.id)
      : null;
    for (const g of trackGenres) {
      overallCounts.set(g, (overallCounts.get(g) ?? 0) + 1);
      if (memberCounts && member) {
        memberCounts.set(g, (memberCounts.get(g) ?? 0) + 1);
        perCrewTotals.set(
          member.id,
          (perCrewTotals.get(member.id) ?? 0) + 1,
        );
      }
    }
    if (memberUmbrellaCounts) {
      for (const u of trackUmbrellas) {
        memberUmbrellaCounts.set(u, (memberUmbrellaCounts.get(u) ?? 0) + 1);
      }
    }
  }

  const perCrew: GenreBreakdownPerCrew[] = crew.map((c) => {
    const counts = perCrewCounts.get(c.id) ?? new Map<string, number>();
    const umbrellaTracks =
      perCrewUmbrellaTrackCounts.get(c.id) ?? new Map<string, number>();
    return {
      crewMember: c,
      ...pickUmbrellaAndSubGenre(counts, umbrellaTracks, overallCounts),
      totalGenreHits: perCrewTotals.get(c.id) ?? 0,
    };
  });

  const overall: GenreCount[] = [...overallCounts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
    .slice(0, 3);

  let totalWithGenres = 0;
  for (const a of artistGenres.values()) {
    if (a.genres.length > 0) totalWithGenres += 1;
  }

  return {
    perCrew,
    overall,
    totalArtistsLookedUp: artistGenres.size,
    totalArtistsWithGenres: totalWithGenres,
    artistTableMissing,
    tracksTotal,
    tracksWithAnyArtistId,
    artistLookupFetchError,
    artistLookupBatchesAttempted,
    artistLookupBatchesFailed,
    artistLookupApiKeyConfigured,
    artistLookupFetchBudgetRemaining,
  };
}

// ---------- Card 2: Listening dedication ----------

export type DedicationEntry = {
  crewMember: CrewMember;
  listenCount: number;
  listenedMs: number;
  uniqueTracks: number;
  isCrown: boolean;
};

// `tableMissing` flags the case where the ListeningPlay table doesn't
// exist in the DB yet (a fresh deploy that hasn't clicked "Initialize
// ListeningPlay table" on /troubleshooting). The dedication card uses
// it to show an actionable empty state instead of telling users to
// "visit the dashboard" when no amount of dashboard-visiting will help.
export type DedicationResult = {
  entries: DedicationEntry[];
  tableMissing: boolean;
  // How many ListeningPlay rows exist for crew members on tracks that
  // are in *some* Bompton playlist (regardless of who added them or
  // when). Used by the empty-state copy to disambiguate "no plays
  // captured yet" from "plays captured but none qualify (own-adds
  // only / pre-add plays)".
  totalCandidatePlays: number;
};

// "How many times has user U played a track that someone else added to a
// Bompton playlist after that track was added?" Reads from the
// ListeningPlay table populated by the dashboard's recently-played
// fetch path. Returns one entry per crew member with the crown flag set
// on the leader.
export async function getListeningDedication(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
): Promise<DedicationResult> {
  // Map track id → list of (added_by spotify id, addedAt) entries
  // across every season so a play counts as soon as ANY non-self crew
  // member had added it before the play.
  const trackAdds = new Map<
    string,
    { addedBySpotifyId: string; addedAtMs: number }[]
  >();
  for (const season of data) {
    for (const t of season.tracks) {
      const tid = t.track?.id;
      const addedBy = t.added_by?.id;
      if (!tid || !addedBy || !t.added_at) continue;
      const addedAtMs = new Date(t.added_at).getTime();
      if (Number.isNaN(addedAtMs)) continue;
      let arr = trackAdds.get(tid);
      if (!arr) {
        arr = [];
        trackAdds.set(tid, arr);
      }
      arr.push({ addedBySpotifyId: addedBy, addedAtMs });
    }
  }

  const entries: DedicationEntry[] = crew.map((c) => ({
    crewMember: c,
    listenCount: 0,
    listenedMs: 0,
    uniqueTracks: 0,
    isCrown: false,
  }));
  if (trackAdds.size === 0 || crew.length === 0) {
    return { entries, tableMissing: false, totalCandidatePlays: 0 };
  }

  let plays: {
    userId: string;
    trackSpotifyId: string;
    trackDurationMs: number;
    playedAt: Date;
  }[] = [];
  try {
    plays = await prisma.listeningPlay.findMany({
      where: {
        userId: { in: crew.map((c) => c.id) },
        trackSpotifyId: { in: [...trackAdds.keys()] },
      },
      select: {
        userId: true,
        trackSpotifyId: true,
        trackDurationMs: true,
        playedAt: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist/i.test(message)) {
      console.warn(
        "[bompton-stats] ListeningPlay table missing — click 'Initialize ListeningPlay table' on /troubleshooting (or run `npm run db:push`). Dedication card will stay empty until a dashboard recently-played fetch runs against an existing table.",
      );
      return { entries, tableMissing: true, totalCandidatePlays: 0 };
    }
    throw error;
  }

  const byUser = new Map(entries.map((e) => [e.crewMember.id, e]));
  const uniqueTracksByUser = new Map<string, Set<string>>();
  for (const c of crew) uniqueTracksByUser.set(c.id, new Set());

  for (const play of plays) {
    const adds = trackAdds.get(play.trackSpotifyId);
    if (!adds || adds.length === 0) continue;
    const member = crew.find((c) => c.id === play.userId);
    if (!member) continue;
    const playMs = play.playedAt.getTime();
    const validAdd = adds.find(
      (a) =>
        a.addedBySpotifyId !== member.spotifyUserId && a.addedAtMs <= playMs,
    );
    if (!validAdd) continue;
    const entry = byUser.get(member.id);
    if (!entry) continue;
    entry.listenCount += 1;
    entry.listenedMs += play.trackDurationMs ?? 0;
    uniqueTracksByUser.get(member.id)?.add(play.trackSpotifyId);
  }
  for (const e of entries) {
    e.uniqueTracks = uniqueTracksByUser.get(e.crewMember.id)?.size ?? 0;
  }

  entries.sort((a, b) => b.listenCount - a.listenCount);
  if (entries[0] && entries[0].listenCount > 0) entries[0].isCrown = true;
  return { entries, tableMissing: false, totalCandidatePlays: plays.length };
}

// Detail-page builder for the dedication card. Returns every qualifying
// play with the track, who played it, when, who added the track, and
// when the add happened — i.e. everything you'd need to drill into the
// counts the dedication card surfaces.
export type DedicationPlayDetail = {
  member: CrewMember;
  trackSpotifyId: string;
  trackName: string;
  trackArtist: string;
  trackDurationMs: number;
  playedAt: Date;
  addedBy: CrewMember | null;
  addedBySpotifyId: string;
  addedAt: Date;
  // Which Bompton season the matching add lives in. If the same track
  // was added in multiple seasons, this is the earliest one that
  // qualified (other-added + before the play).
  season: BomptonYear | null;
};

export type DedicationDetails = {
  plays: DedicationPlayDetail[];
  tableMissing: boolean;
};

export async function getDedicationDetails(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
): Promise<DedicationDetails> {
  // Mirror getListeningDedication's prep but keep the per-season
  // metadata so we can attribute each qualifying play.
  type AddRecord = {
    addedBySpotifyId: string;
    addedAtMs: number;
    addedAt: Date;
    season: BomptonYear;
  };
  const trackAdds = new Map<string, AddRecord[]>();
  for (const season of data) {
    for (const t of season.tracks) {
      const tid = t.track?.id;
      const addedBy = t.added_by?.id;
      if (!tid || !addedBy || !t.added_at) continue;
      const addedAt = new Date(t.added_at);
      const addedAtMs = addedAt.getTime();
      if (Number.isNaN(addedAtMs)) continue;
      let arr = trackAdds.get(tid);
      if (!arr) {
        arr = [];
        trackAdds.set(tid, arr);
      }
      arr.push({
        addedBySpotifyId: addedBy,
        addedAtMs,
        addedAt,
        season: season.year,
      });
    }
  }

  if (trackAdds.size === 0 || crew.length === 0) {
    return { plays: [], tableMissing: false };
  }

  let plays: {
    userId: string;
    trackSpotifyId: string;
    trackName: string;
    trackArtist: string;
    trackDurationMs: number;
    playedAt: Date;
  }[] = [];
  try {
    plays = await prisma.listeningPlay.findMany({
      where: {
        userId: { in: crew.map((c) => c.id) },
        trackSpotifyId: { in: [...trackAdds.keys()] },
      },
      select: {
        userId: true,
        trackSpotifyId: true,
        trackName: true,
        trackArtist: true,
        trackDurationMs: true,
        playedAt: true,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist/i.test(message)) {
      return { plays: [], tableMissing: true };
    }
    throw error;
  }

  const out: DedicationPlayDetail[] = [];
  for (const play of plays) {
    const adds = trackAdds.get(play.trackSpotifyId);
    if (!adds || adds.length === 0) continue;
    const member = crew.find((c) => c.id === play.userId);
    if (!member) continue;
    const playMs = play.playedAt.getTime();
    // Pick the earliest qualifying add (other-added + before the play).
    const qualifying = adds
      .filter(
        (a) =>
          a.addedBySpotifyId !== member.spotifyUserId &&
          a.addedAtMs <= playMs,
      )
      .sort((a, b) => a.addedAtMs - b.addedAtMs);
    const validAdd = qualifying[0];
    if (!validAdd) continue;
    out.push({
      member,
      trackSpotifyId: play.trackSpotifyId,
      trackName: play.trackName,
      trackArtist: play.trackArtist,
      trackDurationMs: play.trackDurationMs,
      playedAt: play.playedAt,
      addedBy: findCrewBySpotifyId(crew, validAdd.addedBySpotifyId),
      addedBySpotifyId: validAdd.addedBySpotifyId,
      addedAt: validAdd.addedAt,
      season: validAdd.season,
    });
  }
  out.sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime());
  return { plays: out, tableMissing: false };
}

// ---------- Card 3: Top artists ----------

export type ArtistCount = { name: string; count: number };

export function getTopArtists(
  flat: FlattenedTrack[],
  limit = 10,
): ArtistCount[] {
  const counts = new Map<string, number>();
  for (const { track } of flat) {
    if (!track.track) continue;
    for (const a of track.track.artists ?? []) {
      const name = a.name?.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ---------- Card 4: Top albums ----------

export type AlbumCount = {
  name: string;
  artist: string;
  imageUrl: string | null;
  count: number;
};

export function getTopAlbums(
  flat: FlattenedTrack[],
  limit = 7,
): AlbumCount[] {
  const counts = new Map<string, AlbumCount>();
  for (const { track } of flat) {
    if (!track.track) continue;
    const name = track.track.album?.name?.trim();
    if (!name) continue;
    const artist =
      track.track.album?.artists?.[0]?.name?.trim() ||
      track.track.artists?.[0]?.name?.trim() ||
      "";
    const key = `${name.toLowerCase()}|||${artist.toLowerCase()}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, {
        name,
        artist,
        imageUrl: track.track.album?.images?.[0]?.url ?? null,
        count: 1,
      });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ---------- Card 5: On-time stats (cumulative late days over time) ----------

// One late day = one calendar day that has elapsed past a Friday for
// which the crew member has not yet added a song. If a member is X
// weeks behind, each new day adds X to their total. The card renders
// this as a line graph (X = date, Y = cumulative late days), with the
// crown going to the member with the fewest late days at the latest
// point. The series covers a single season (current by default).

export type OnTimeSeriesPoint = {
  // ISO date string (UTC date midnight) for the X axis tick.
  date: string;
  // crewMember.id → cumulative late days at this date.
  perCrew: Record<string, number>;
};

export type OnTimeMemberTotal = {
  crewMember: CrewMember;
  lateDays: number;
  weeksBehind: number;
  color: string;
  isCrown: boolean;
};

export type OnTimeStats = {
  year: BomptonYear;
  series: OnTimeSeriesPoint[];
  totals: OnTimeMemberTotal[];
  hasData: boolean;
};

// Distinct, color-blind friendly palette for line + ring colors.
// Indexed by crew sort order so the colors are stable across renders.
export const ON_TIME_COLORS = [
  "#1DB954", // Spotify green
  "#3B82F6", // blue
  "#F59E0B", // amber
  "#EC4899", // pink
  "#A855F7", // purple
  "#14B8A6", // teal
];

export function getOnTimeStats(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
  year: BomptonYear = CURRENT_BOMPTON_YEAR,
  now: Date = new Date(),
): OnTimeStats {
  const totals: OnTimeMemberTotal[] = crew.map((c, idx) => ({
    crewMember: c,
    lateDays: 0,
    weeksBehind: 0,
    color: ON_TIME_COLORS[idx % ON_TIME_COLORS.length] ?? "#ffffff",
    isCrown: false,
  }));
  if (crew.length === 0) {
    return { year, series: [], totals, hasData: false };
  }

  const seasonStartAt = seasonStart(year);
  const seasonEndAt = seasonEnd(year);
  const todayMs = Math.min(now.getTime(), seasonEndAt.getTime());
  const today = new Date(todayMs);
  today.setUTCHours(0, 0, 0, 0);
  if (today.getTime() < seasonStartAt.getTime()) {
    return { year, series: [], totals, hasData: false };
  }

  const season = data.find((d) => d.year === year);
  const tracks = season?.tracks ?? [];

  // member id → sorted list of add timestamps for the chosen season
  const addsByMember = new Map<string, number[]>();
  for (const c of crew) addsByMember.set(c.id, []);
  for (const t of tracks) {
    const addedBy = t.added_by?.id;
    if (!addedBy || !t.added_at) continue;
    const member = findCrewBySpotifyId(crew, addedBy);
    if (!member) continue;
    const ts = new Date(t.added_at).getTime();
    if (!Number.isNaN(ts)) addsByMember.get(member.id)?.push(ts);
  }
  for (const [, arr] of addsByMember) arr.sort((a, b) => a - b);

  // Pre-compute, for each Friday in the season so far, when each
  // member satisfied that Friday (the first add inside [F, F+7d)).
  // null = never satisfied.
  const fridays = fridaysBetween(
    seasonStartAt,
    mostRecentFriday(today).getTime() < seasonStartAt.getTime()
      ? seasonStartAt
      : mostRecentFriday(today),
  );
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const fridaySatisfaction = fridays.map((friday) => {
    const fMs = friday.getTime();
    const sat = new Map<string, number | null>();
    for (const c of crew) {
      const adds = addsByMember.get(c.id) ?? [];
      const found = adds.find((a) => a >= fMs && a < fMs + weekMs);
      sat.set(c.id, found ?? null);
    }
    return { fridayMs: fMs, satisfied: sat };
  });

  const cumulative = new Map<string, number>();
  for (const c of crew) cumulative.set(c.id, 0);
  const series: OnTimeSeriesPoint[] = [];

  for (
    let dt = seasonStartAt.getTime();
    dt <= today.getTime();
    dt += dayMs
  ) {
    for (const fd of fridaySatisfaction) {
      const deadline = fd.fridayMs + dayMs; // first late day = day after Friday (UTC)
      if (dt < deadline) continue;
      for (const c of crew) {
        const sat = fd.satisfied.get(c.id);
        const stillUnsatisfiedAtDayStart =
          sat === null || sat === undefined || sat > dt;
        if (stillUnsatisfiedAtDayStart) {
          cumulative.set(c.id, (cumulative.get(c.id) ?? 0) + 1);
        }
      }
    }
    series.push({
      date: new Date(dt).toISOString(),
      perCrew: Object.fromEntries(cumulative),
    });
  }

  // Compute weeks-behind right now (count of un-satisfied past Fridays).
  const todayDt = today.getTime();
  for (const fd of fridaySatisfaction) {
    if (todayDt < fd.fridayMs + dayMs) continue;
    for (const total of totals) {
      const sat = fd.satisfied.get(total.crewMember.id);
      const open = sat === null || sat === undefined || sat > todayDt;
      if (open) total.weeksBehind += 1;
    }
  }

  const last = series[series.length - 1]?.perCrew ?? {};
  for (const total of totals) {
    total.lateDays = last[total.crewMember.id] ?? 0;
  }
  const sorted = [...totals].sort((a, b) => a.lateDays - b.lateDays);
  if (sorted[0]) {
    const winner = totals.find(
      (t) => t.crewMember.id === sorted[0].crewMember.id,
    );
    if (winner) winner.isCrown = true;
  }

  return {
    year,
    series,
    totals,
    hasData: tracks.length > 0,
  };
}

// ---------- Card 6: Time-of-day distribution per crew (UTC) ----------

export type TimeOfDayEntry = {
  crewMember: CrewMember;
  morning: number;
  afternoon: number;
  evening: number;
  night: number;
  total: number;
};

export function getTimeOfDayDistribution(
  flat: FlattenedTrack[],
  crew: CrewMember[],
): TimeOfDayEntry[] {
  const entries: TimeOfDayEntry[] = crew.map((c) => ({
    crewMember: c,
    morning: 0,
    afternoon: 0,
    evening: 0,
    night: 0,
    total: 0,
  }));
  const byId = new Map(entries.map((e) => [e.crewMember.id, e]));
  for (const { track } of flat) {
    if (!track.added_at || !track.added_by?.id) continue;
    const member = findCrewBySpotifyId(crew, track.added_by.id);
    if (!member) continue;
    const entry = byId.get(member.id);
    if (!entry) continue;
    const hr = new Date(track.added_at).getUTCHours();
    entry.total += 1;
    if (hr >= 5 && hr < 12) entry.morning += 1;
    else if (hr >= 12 && hr < 17) entry.afternoon += 1;
    else if (hr >= 17 && hr < 22) entry.evening += 1;
    else entry.night += 1;
  }
  return entries;
}

// ---------- Card 7: Day-of-week distribution ----------

export type DayOfWeekDistribution = {
  // Index 0 = Sunday, 6 = Saturday (UTC).
  counts: number[];
  total: number;
  fridayCount: number;
  fridayRate: number;
  topDayIndex: number;
};

export function getDayOfWeekDistribution(
  flat: FlattenedTrack[],
): DayOfWeekDistribution {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const { track } of flat) {
    if (!track.added_at) continue;
    const day = new Date(track.added_at).getUTCDay();
    counts[day] = (counts[day] ?? 0) + 1;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  let topDayIndex = 0;
  for (let i = 1; i < counts.length; i += 1) {
    if (counts[i] > counts[topDayIndex]) topDayIndex = i;
  }
  return {
    counts,
    total,
    fridayCount: counts[5] ?? 0,
    fridayRate: total > 0 ? (counts[5] ?? 0) / total : 0,
    topDayIndex,
  };
}

// ---------- Card 8: Track length stats ----------

export type TrackDescriptor = {
  name: string;
  artist: string;
  durationMs: number;
};

export type TrackLengthStats = {
  shortest: TrackDescriptor | null;
  longest: TrackDescriptor | null;
  averageMs: number;
  medianMs: number;
  totalMs: number;
  totalCount: number;
};

export function getTrackLengthStats(
  flat: FlattenedTrack[],
): TrackLengthStats {
  let shortest: TrackDescriptor | null = null;
  let longest: TrackDescriptor | null = null;
  const durations: number[] = [];
  for (const { track } of flat) {
    if (!track.track) continue;
    const dur = track.track.duration_ms;
    if (!dur || dur <= 0) continue;
    durations.push(dur);
    const desc: TrackDescriptor = {
      name: track.track.name,
      artist: track.track.artists?.[0]?.name ?? "",
      durationMs: dur,
    };
    if (!shortest || dur < shortest.durationMs) shortest = desc;
    if (!longest || dur > longest.durationMs) longest = desc;
  }
  const totalMs = durations.reduce((a, b) => a + b, 0);
  const sorted = [...durations].sort((a, b) => a - b);
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : Math.round(
          (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
        );
  return {
    shortest,
    longest,
    averageMs: durations.length > 0 ? Math.round(totalMs / durations.length) : 0,
    medianMs: median,
    totalMs,
    totalCount: durations.length,
  };
}

// ---------- Card 9: Explicit vs clean per crew ----------

export type ExplicitEntry = {
  crewMember: CrewMember;
  explicit: number;
  clean: number;
  total: number;
  explicitRate: number;
};

export function getExplicitContent(
  flat: FlattenedTrack[],
  crew: CrewMember[],
): ExplicitEntry[] {
  const entries: ExplicitEntry[] = crew.map((c) => ({
    crewMember: c,
    explicit: 0,
    clean: 0,
    total: 0,
    explicitRate: 0,
  }));
  const byId = new Map(entries.map((e) => [e.crewMember.id, e]));
  for (const { track } of flat) {
    if (!track.track || !track.added_by?.id) continue;
    const member = findCrewBySpotifyId(crew, track.added_by.id);
    if (!member) continue;
    const entry = byId.get(member.id);
    if (!entry) continue;
    entry.total += 1;
    if (track.track.explicit) entry.explicit += 1;
    else entry.clean += 1;
  }
  for (const e of entries) {
    e.explicitRate = e.total > 0 ? e.explicit / e.total : 0;
  }
  return entries.sort((a, b) => b.explicitRate - a.explicitRate);
}

// ---------- Bundle for the page ----------

export type BomptonStatsBundle = {
  // Used by the main-page summary block
  vitals: PlaylistVitals;
  leaderboard: CrewLeaderboardEntry[];
  // Used by the deep-stats grid
  genres: GenreBreakdown;
  dedication: DedicationEntry[];
  // Diagnostic flag for the dedication card's empty state. Mirrors the
  // genre card's `genres.artistTableMissing` so callers can render a
  // "click Initialize on /troubleshooting" hint when the backing table
  // doesn't exist yet.
  dedicationTableMissing: boolean;
  // Total ListeningPlay rows the dedication query saw (before the
  // own-add / pre-add filter). Lets the empty state distinguish "no
  // plays captured" from "plays captured but none qualify".
  dedicationCandidatePlays: number;
  topArtists: ArtistCount[];
  topAlbums: AlbumCount[];
  onTime: OnTimeStats;
  timeOfDay: TimeOfDayEntry[];
  dayOfWeek: DayOfWeekDistribution;
  trackLength: TrackLengthStats;
  explicit: ExplicitEntry[];
  totalTracks: number;
};

// Builds every bundle field. Genres require a Spotify lookup against
// /v1/artists for any artist id we haven't cached yet, so this is async
// and must be passed the caller's Spotify-linked user id. If we can't
// reach Spotify (token expired, etc.) the genre card just degrades to
// whatever we have cached — the rest of the bundle is unaffected.
export async function buildBomptonStats(
  data: BomptonPlaylistByYear[],
  crew: CrewMember[],
  callerUserId: string,
  now: Date = new Date(),
): Promise<BomptonStatsBundle> {
  const flat = flattenAllSeasons(data);

  // Collect {id, name} pairs for the genre lookup. Last.fm's API
  // doesn't know Spotify ids, so we look up by name and key the cache
  // by Spotify id (which is stable). Dedup by id; first non-empty
  // name wins.
  const artistInputs = new Map<string, string>();
  for (const { track } of flat) {
    for (const a of track.track?.artists ?? []) {
      if (!a?.id) continue;
      const existing = artistInputs.get(a.id);
      if (!existing && a.name) artistInputs.set(a.id, a.name);
      else if (!existing) artistInputs.set(a.id, "");
    }
  }
  let artistGenres = new Map<string, ArtistGenres>();
  let artistTableMissing = false;
  let artistLookupFetchError: ArtistGenresFetchError | null = null;
  let artistLookupBatchesAttempted = 0;
  let artistLookupBatchesFailed = 0;
  let artistLookupApiKeyConfigured = false;
  let artistLookupFetchBudgetRemaining = 0;
  try {
    const lookup = await getArtistGenresForIds(
      callerUserId,
      [...artistInputs.entries()].map(([id, name]) => ({ id, name })),
    );
    artistGenres = lookup.artists;
    artistTableMissing = lookup.tableMissing;
    artistLookupFetchError = lookup.fetchError;
    artistLookupBatchesAttempted = lookup.batchesAttempted;
    artistLookupBatchesFailed = lookup.batchesFailed;
    artistLookupApiKeyConfigured = lookup.apiKeyConfigured;
    artistLookupFetchBudgetRemaining = lookup.fetchBudgetRemaining;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[bompton-stats.genres-failed]", {
      callerUserId,
      message,
    });
    // Surface the unexpected throw too so the empty state can show it
    // instead of looking like a normal "no data" case.
    artistLookupFetchError = {
      status: 0,
      path: "lib/artist-genres.ts:getArtistGenresForIds",
      bodyPreview: "",
      message,
    };
  }

  const dedicationResult = await getListeningDedication(data, crew);

  return {
    vitals: getPlaylistVitals(flat, data),
    leaderboard: getAllTimeLeaderboard(data, crew),
    genres: getGenreBreakdown(
      flat,
      crew,
      artistGenres,
      artistTableMissing,
      artistLookupFetchError,
      artistLookupBatchesAttempted,
      artistLookupBatchesFailed,
      artistLookupApiKeyConfigured,
      artistLookupFetchBudgetRemaining,
    ),
    dedication: dedicationResult.entries,
    dedicationTableMissing: dedicationResult.tableMissing,
    dedicationCandidatePlays: dedicationResult.totalCandidatePlays,
    topArtists: getTopArtists(flat),
    topAlbums: getTopAlbums(flat),
    onTime: getOnTimeStats(data, crew, CURRENT_BOMPTON_YEAR, now),
    timeOfDay: getTimeOfDayDistribution(flat, crew),
    dayOfWeek: getDayOfWeekDistribution(flat),
    trackLength: getTrackLengthStats(flat),
    explicit: getExplicitContent(flat, crew),
    totalTracks: flat.length,
  };
}

// ---------- Card metadata (used by /bompton-playlist/stats/[card]) ----------

export const STATS_CARD_SLUGS = [
  "genres",
  "dedication",
  "top-artists",
  "top-albums",
  "on-time",
  "time-of-day",
  "day-of-week",
  "track-length",
  "explicit",
] as const;

export type StatsCardSlug = (typeof STATS_CARD_SLUGS)[number];

export const STATS_CARD_META: Record<
  StatsCardSlug,
  { title: string; subtitle: string; blurb: string }
> = {
  genres: {
    title: "Genre tracker",
    subtitle: "Card 1 · Catalog",
    blurb:
      "Every genre tag from Spotify's /v1/artists endpoint, with the artists carrying that tag and the tracks they appear on.",
  },
  dedication: {
    title: "Listening dedication",
    subtitle: "Card 2 · Crew",
    blurb:
      "Every play that counted toward the dedication leaderboard — track, who played it, when, who added it to a Bompton playlist, and when.",
  },
  "top-artists": {
    title: "Most-added artists",
    subtitle: "Card 3 · Catalog",
    blurb:
      "All artists ranked by track count across the four Bompton seasons, with every track they appear on and who added each.",
  },
  "top-albums": {
    title: "Most-added albums",
    subtitle: "Card 4 · Catalog",
    blurb:
      "Albums ranked by track count, with every Bompton track from each album and who added it.",
  },
  "on-time": {
    title: "On-time stats",
    subtitle: "Card 5 · Habits",
    blurb:
      "The current season's Friday-by-Friday timeline per crew member, with cumulative late days and the late-week ledger that drives the line graph.",
  },
  "time-of-day": {
    title: "Time-of-day distribution",
    subtitle: "Card 9 · Habits",
    blurb:
      "Every add bucketed into morning / afternoon / evening / night (UTC), per crew member, with the underlying tracks.",
  },
  "day-of-week": {
    title: "Day-of-week distribution",
    subtitle: "Card 7 · Habits",
    blurb:
      "Every add bucketed by weekday (UTC), with the underlying tracks per day.",
  },
  "track-length": {
    title: "Track length",
    subtitle: "Card 8 · Catalog",
    blurb:
      "Track durations across all four seasons, the median + average + total, plus a histogram by 30-second bucket with the actual tracks per bucket.",
  },
  explicit: {
    title: "Explicit vs clean",
    subtitle: "Card 6 · Crew",
    blurb:
      "Per-crew-member explicit-rate, plus the actual explicit tracks each member added.",
  },
};
