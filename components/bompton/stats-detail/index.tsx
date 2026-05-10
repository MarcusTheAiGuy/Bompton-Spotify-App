// Drill-down detail components for each /bompton-playlist/stats card.
// Each one is a thin presentation layer over the same data the deep-stats
// grid already renders — the card on the main grid is a one-line summary,
// the detail page lists every underlying row.

import type {
  BomptonPlaylistByYear,
} from "@/lib/bompton-playlist-db";
import {
  BOMPTON_YEARS,
  CURRENT_BOMPTON_YEAR,
  fridaysBetween,
  mostRecentFriday,
  seasonEnd,
  seasonStart,
  type BomptonYear,
  type CrewMember,
} from "@/lib/bompton";
import {
  greedyAssignAdds,
  ON_TIME_COLORS,
  type DedicationPlayDetail,
  type EnrichedTrack,
  type FlattenedTrack,
  type OnTimeStats,
} from "@/lib/bompton-stats";
import type { ArtistGenres } from "@/lib/artist-genres";
import { formatDuration, formatLongDuration } from "@/lib/spotify";
import { displayCrewName } from "@/lib/spotify-user-names";

// ---------- Shared bits ----------

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function CrewBadge({ member }: { member: CrewMember | null }) {
  const label = member ? displayCrewName(member) : "Unknown";
  const initial = label.slice(0, 1).toUpperCase();
  return (
    <span className="inline-flex items-center gap-2">
      {member?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.image}
          alt=""
          className="h-5 w-5 rounded-full object-cover"
        />
      ) : (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-spotify-highlight text-[10px] font-bold">
          {initial}
        </span>
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

function DetailSection({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-spotify-border bg-spotify-elevated/40 p-5">
      {title || subtitle ? (
        <header className="flex flex-col gap-0.5">
          {subtitle ? (
            <p className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
              {subtitle}
            </p>
          ) : null}
          {title ? (
            <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-spotify-border bg-spotify-highlight/30 px-3 py-2 text-xs text-spotify-subtext">
      {children}
    </p>
  );
}

function TrackRow({
  track,
  trailing,
}: {
  track: EnrichedTrack;
  trailing?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 rounded border border-spotify-border bg-spotify-base/40 px-3 py-2 text-sm">
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
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
          {track.albumName ? ` · ${track.albumName}` : ""}
          {track.explicit ? " · E" : ""}
        </span>
      </div>
      <div className="hidden min-w-0 flex-none flex-col items-end gap-0.5 text-xs text-spotify-subtext sm:flex">
        <CrewBadge member={track.addedBy} />
        <span className="font-mono">
          {track.addedAt ? track.addedAt.toLocaleDateString() : "—"} ·{" "}
          {track.year}
        </span>
      </div>
      <span className="hidden flex-none font-mono text-xs text-spotify-subtext md:inline">
        {formatDuration(track.durationMs)}
      </span>
      {trailing ? <div className="flex-none">{trailing}</div> : null}
    </li>
  );
}

// ---------- Card 1: Genre tracker ----------

export function GenreDetail({
  flat,
  crew,
  artistGenres,
  artistTableMissing,
}: {
  flat: FlattenedTrack[];
  crew: CrewMember[];
  artistGenres: Map<string, ArtistGenres>;
  artistTableMissing: boolean;
}) {
  type ArtistRow = {
    id: string;
    name: string;
    genres: string[];
    trackCount: number;
    addedBySpotifyIds: Set<string>;
  };
  const artistRows = new Map<string, ArtistRow>();
  // genre → set of artist ids
  const genreToArtists = new Map<string, Set<string>>();
  // genre → number of tracks tagged with that genre
  const genreCounts = new Map<string, number>();

  for (const { track } of flat) {
    if (!track.track) continue;
    const trackGenreSet = new Set<string>();
    for (const ref of track.track.artists ?? []) {
      const id = ref?.id;
      if (!id) continue;
      const data = artistGenres.get(id);
      if (!data) continue;
      let row = artistRows.get(id);
      if (!row) {
        row = {
          id,
          name: data.name || ref.name || id,
          genres: data.genres,
          trackCount: 0,
          addedBySpotifyIds: new Set(),
        };
        artistRows.set(id, row);
      }
      row.trackCount += 1;
      if (track.added_by?.id) row.addedBySpotifyIds.add(track.added_by.id);
      for (const g of data.genres) {
        trackGenreSet.add(g);
        let aSet = genreToArtists.get(g);
        if (!aSet) {
          aSet = new Set();
          genreToArtists.set(g, aSet);
        }
        aSet.add(id);
      }
    }
    for (const g of trackGenreSet) {
      genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
    }
  }

  const sortedGenres = [...genreCounts.entries()]
    .map(([genre, count]) => ({
      genre,
      count,
      artists: [...(genreToArtists.get(genre) ?? new Set<string>())]
        .map((id) => artistRows.get(id))
        .filter((a): a is ArtistRow => !!a)
        .sort((a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));

  const sortedArtists = [...artistRows.values()].sort(
    (a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name),
  );

  if (artistTableMissing) {
    return (
      <DetailSection title="Genre data unavailable">
        <EmptyHint>
          The <code className="font-mono">Artist</code> cache table is
          missing in prod. Initialize it from /troubleshooting and reload.
        </EmptyHint>
      </DetailSection>
    );
  }
  if (sortedGenres.length === 0) {
    return (
      <DetailSection title="No genre tags found">
        <EmptyHint>
          We looked up {artistGenres.size} artist
          {artistGenres.size === 1 ? "" : "s"} from Spotify and got zero
          genre tags back. See the empty-state hint on the main stats
          page for why.
        </EmptyHint>
      </DetailSection>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <DetailSection
        title="Every genre · ranked"
        subtitle={`${sortedGenres.length} genre${sortedGenres.length === 1 ? "" : "s"}`}
      >
        <ol className="flex flex-col gap-2">
          {sortedGenres.map((g, idx) => (
            <li
              key={g.genre}
              className="flex flex-col gap-2 rounded border border-spotify-border bg-spotify-base/40 px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <span className="w-6 text-center font-mono text-xs text-spotify-subtext">
                  {idx + 1}
                </span>
                <span className="flex-1 truncate font-semibold capitalize">
                  {g.genre}
                </span>
                <span className="font-mono text-xs text-spotify-subtext">
                  {g.count} track{g.count === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="flex flex-wrap gap-1.5 pl-9 text-[11px]">
                {g.artists.slice(0, 12).map((a) => (
                  <li
                    key={a.id}
                    className="rounded-full bg-spotify-highlight px-2 py-0.5 text-spotify-subtext"
                  >
                    {a.name}{" "}
                    <span className="font-mono">({a.trackCount})</span>
                  </li>
                ))}
                {g.artists.length > 12 ? (
                  <li className="rounded-full bg-spotify-highlight px-2 py-0.5 text-spotify-subtext">
                    +{g.artists.length - 12} more
                  </li>
                ) : null}
              </ul>
            </li>
          ))}
        </ol>
      </DetailSection>

      <DetailSection
        title="Every artist · ranked"
        subtitle={`${sortedArtists.length} artist${sortedArtists.length === 1 ? "" : "s"}`}
      >
        <ul className="flex flex-col gap-1.5">
          {sortedArtists.map((a, idx) => {
            const addedByMembers = [...a.addedBySpotifyIds]
              .map((sid) => crew.find((c) => c.spotifyUserId === sid))
              .filter((m): m is CrewMember => !!m);
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-3 rounded border border-spotify-border bg-spotify-base/40 px-3 py-2 text-sm"
              >
                <span className="w-8 text-center font-mono text-xs text-spotify-subtext">
                  {idx + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {a.name}
                </span>
                <span className="font-mono text-xs text-spotify-subtext">
                  {a.trackCount} track{a.trackCount === 1 ? "" : "s"}
                </span>
                <span className="basis-full pl-11 text-[11px] text-spotify-subtext">
                  {a.genres.length === 0
                    ? "no genres"
                    : a.genres.slice(0, 6).join(" · ")}
                  {a.genres.length > 6 ? ` · +${a.genres.length - 6}` : ""}
                </span>
                {addedByMembers.length > 0 ? (
                  <span className="basis-full pl-11 text-[11px] text-spotify-subtext">
                    Added by:{" "}
                    {addedByMembers.map((m) => displayCrewName(m)).join(", ")}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </DetailSection>
    </div>
  );
}

// ---------- Card 2: Listening dedication ----------

export function DedicationDetail({
  plays,
  tableMissing,
  crew,
}: {
  plays: DedicationPlayDetail[];
  tableMissing: boolean;
  crew: CrewMember[];
}) {
  if (tableMissing) {
    return (
      <DetailSection title="ListeningPlay table missing">
        <EmptyHint>
          Click <em>Initialize ListeningPlay table</em> on /troubleshooting,
          then have each crew member visit /dashboard so the recently-played
          fetch can append plays.
        </EmptyHint>
      </DetailSection>
    );
  }
  if (plays.length === 0) {
    return (
      <DetailSection title="No qualifying plays yet">
        <EmptyHint>
          We have no captured plays of Bompton tracks that someone else
          added before the play. See the dedication card on the main
          stats page for the most likely reason.
        </EmptyHint>
      </DetailSection>
    );
  }

  // Group by listener.
  const byMember = new Map<string, DedicationPlayDetail[]>();
  for (const p of plays) {
    const arr = byMember.get(p.member.id) ?? [];
    arr.push(p);
    byMember.set(p.member.id, arr);
  }
  const sortedMembers = crew
    .map((m) => ({ member: m, list: byMember.get(m.id) ?? [] }))
    .sort((a, b) => b.list.length - a.list.length);

  return (
    <div className="flex flex-col gap-6">
      <DetailSection
        title={`Every qualifying play · ${plays.length}`}
        subtitle="Listener · Track · Played · Added by · Added"
      >
        <ul className="flex flex-col gap-1">
          {plays.map((p) => (
            <li
              key={`${p.member.id}-${p.trackSpotifyId}-${p.playedAt.toISOString()}`}
              className="grid grid-cols-1 gap-1 rounded border border-spotify-border bg-spotify-base/40 px-3 py-2 text-sm md:grid-cols-[1fr_2fr_1fr_1fr_1fr]"
            >
              <CrewBadge member={p.member} />
              <span className="min-w-0 truncate">
                <a
                  href={`https://open.spotify.com/track/${p.trackSpotifyId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold hover:text-spotify-green hover:underline"
                >
                  {p.trackName}
                </a>
                <span className="text-xs text-spotify-subtext">
                  {" "}
                  · {p.trackArtist}
                </span>
              </span>
              <span className="font-mono text-xs text-spotify-subtext">
                played {p.playedAt.toLocaleDateString()}{" "}
                {p.playedAt.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <CrewBadge member={p.addedBy} />
              <span className="font-mono text-xs text-spotify-subtext">
                added {p.addedAt.toLocaleDateString()} · {p.season ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      </DetailSection>

      <DetailSection title="Per crew member">
        <ul className="flex flex-col gap-3">
          {sortedMembers.map(({ member, list }) => (
            <li key={member.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <CrewBadge member={member} />
                <span className="font-mono text-xs text-spotify-subtext">
                  {list.length} qualifying play
                  {list.length === 1 ? "" : "s"} ·{" "}
                  {new Set(list.map((p) => p.trackSpotifyId)).size} unique
                  tracks ·{" "}
                  {formatLongDuration(
                    list.reduce((acc, p) => acc + p.trackDurationMs, 0),
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </DetailSection>
    </div>
  );
}

// ---------- Card 3: Top artists ----------

export function TopArtistsDetail({
  enriched,
  crew,
}: {
  enriched: EnrichedTrack[];
  crew: CrewMember[];
}) {
  // Group by every artist name that appears across the artistsLabel.
  // We use names rather than ids because not every track has artist
  // ids on file (depends on sync shape) and the main top-artists card
  // counts by name as well.
  type Group = {
    name: string;
    tracks: EnrichedTrack[];
  };
  const byName = new Map<string, Group>();
  for (const t of enriched) {
    const names = t.artistsLabel.split(",").map((s) => s.trim()).filter(Boolean);
    for (const n of names) {
      let g = byName.get(n);
      if (!g) {
        g = { name: n, tracks: [] };
        byName.set(n, g);
      }
      g.tracks.push(t);
    }
  }
  const sorted = [...byName.values()].sort(
    (a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name),
  );
  void crew;

  if (sorted.length === 0) {
    return (
      <DetailSection title="No artists yet">
        <EmptyHint>Sync a Bompton playlist and reload.</EmptyHint>
      </DetailSection>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {sorted.map((g, idx) => (
        <DetailSection
          key={g.name}
          title={`#${idx + 1} · ${g.name}`}
          subtitle={`${g.tracks.length} track${g.tracks.length === 1 ? "" : "s"}`}
        >
          <ul className="flex flex-col gap-1.5">
            {g.tracks.map((t) => (
              <TrackRow
                key={`${t.trackId ?? t.trackUri}-${t.year}-${t.addedAtLabel}`}
                track={t}
              />
            ))}
          </ul>
        </DetailSection>
      ))}
    </div>
  );
}

// ---------- Card 4: Top albums ----------

export function TopAlbumsDetail({
  enriched,
  crew,
}: {
  enriched: EnrichedTrack[];
  crew: CrewMember[];
}) {
  type Group = {
    key: string;
    name: string;
    artist: string;
    imageUrl: string | null;
    tracks: EnrichedTrack[];
  };
  const groups = new Map<string, Group>();
  for (const t of enriched) {
    const album = t.albumName.trim();
    if (!album) continue;
    const artist = (t.artistsLabel.split(",")[0] ?? "").trim();
    const key = `${album.toLowerCase()}|||${artist.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name: album,
        artist,
        imageUrl: t.albumImageUrl,
        tracks: [],
      };
      groups.set(key, g);
    }
    g.tracks.push(t);
    if (!g.imageUrl && t.albumImageUrl) g.imageUrl = t.albumImageUrl;
  }
  const sorted = [...groups.values()].sort(
    (a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name),
  );
  void crew;

  if (sorted.length === 0) {
    return (
      <DetailSection title="No albums yet">
        <EmptyHint>Sync a Bompton playlist and reload.</EmptyHint>
      </DetailSection>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {sorted.map((g, idx) => (
        <DetailSection
          key={g.key}
          title={`#${idx + 1} · ${g.name}`}
          subtitle={`${g.artist || "—"} · ${g.tracks.length} track${g.tracks.length === 1 ? "" : "s"}`}
        >
          <ul className="flex flex-col gap-1.5">
            {g.tracks.map((t) => (
              <TrackRow
                key={`${t.trackId ?? t.trackUri}-${t.year}-${t.addedAtLabel}`}
                track={t}
              />
            ))}
          </ul>
        </DetailSection>
      ))}
    </div>
  );
}

// ---------- Card 5: On-time stats ----------

export function OnTimeDetail({
  onTime,
  bomptonData,
  crew,
}: {
  onTime: OnTimeStats;
  bomptonData: BomptonPlaylistByYear[];
  crew: CrewMember[];
}) {
  if (!onTime.hasData) {
    return (
      <DetailSection title="No on-time data yet">
        <EmptyHint>
          The current season&apos;s playlist has no timestamped adds we
          could attribute to a crew member yet.
        </EmptyHint>
      </DetailSection>
    );
  }

  // Build a per-crew Friday ledger for the current season.
  const seasonStartAt = seasonStart(onTime.year);
  const seasonEndAt = seasonEnd(onTime.year);
  const recentFriday = mostRecentFriday(new Date());
  const through =
    recentFriday.getTime() < seasonStartAt.getTime()
      ? seasonStartAt
      : recentFriday;
  const cutoff =
    through.getTime() < seasonEndAt.getTime() ? through : seasonEndAt;
  const fridays = fridaysBetween(seasonStartAt, cutoff);

  const seasonData = bomptonData.find((d) => d.year === onTime.year);
  type AddRow = { addedAt: Date; addedBySpotifyId: string };
  const addsByCrew = new Map<string, AddRow[]>();
  for (const c of crew) addsByCrew.set(c.id, []);
  if (seasonData) {
    for (const t of seasonData.tracks) {
      const sid = t.added_by?.id;
      if (!sid || !t.added_at) continue;
      const member = crew.find((c) => c.spotifyUserId === sid);
      if (!member) continue;
      const d = new Date(t.added_at);
      if (Number.isNaN(d.getTime())) continue;
      addsByCrew.get(member.id)?.push({ addedAt: d, addedBySpotifyId: sid });
    }
  }
  for (const arr of addsByCrew.values()) {
    arr.sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());
  }

  // Greedy-assign each member's adds to the season's Fridays, same
  // algorithm getOnTimeStats uses, so the table cells, the
  // cumulative-late ledger, and the line graph all agree.
  const fridaysMs = fridays.map((f) => f.getTime());
  const greedyByCrew = new Map<string, (number | null)[]>();
  for (const c of crew) {
    const memberAdds = (addsByCrew.get(c.id) ?? []).map((a) =>
      a.addedAt.getTime(),
    );
    greedyByCrew.set(c.id, greedyAssignAdds(memberAdds, fridaysMs));
  }
  const dayMs = 24 * 60 * 60 * 1000;

  return (
    <div className="flex flex-col gap-6">
      <DetailSection
        title={`Per crew member · ${onTime.year}`}
        subtitle="Cumulative late days, ranked"
      >
        <ul className="flex flex-col gap-2">
          {[...onTime.totals]
            .sort((a, b) => a.lateDays - b.lateDays)
            .map((row, idx) => (
              <li
                key={row.crewMember.id}
                className="flex items-center gap-3 rounded border border-spotify-border bg-spotify-base/40 px-3 py-2 text-sm"
              >
                <span className="w-6 text-center font-mono text-xs text-spotify-subtext">
                  {idx + 1}
                </span>
                <span
                  className="h-3 w-3 flex-none rounded-full"
                  style={{ backgroundColor: row.color }}
                />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {displayCrewName(row.crewMember)}
                </span>
                <span className="font-mono text-xs text-spotify-subtext">
                  {row.lateDays} late day{row.lateDays === 1 ? "" : "s"} ·{" "}
                  {row.weeksBehind} week{row.weeksBehind === 1 ? "" : "s"}{" "}
                  behind
                </span>
              </li>
            ))}
        </ul>
      </DetailSection>

      <DetailSection
        title="Friday-by-Friday timeline"
        subtitle={`${fridays.length} Friday${fridays.length === 1 ? "" : "s"} elapsed`}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-y-1 text-xs">
            <thead className="text-spotify-subtext">
              <tr>
                <th className="px-2 text-left font-semibold">Friday</th>
                {crew.map((c, i) => (
                  <th
                    key={c.id}
                    className="px-2 text-left font-semibold"
                    style={{
                      color: ON_TIME_COLORS[i % ON_TIME_COLORS.length],
                    }}
                  >
                    {displayCrewName(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fridays.map((friday, fIdx) => {
                const fridayMs = friday.getTime();
                return (
                  <tr key={friday.toISOString()}>
                    <td className="rounded-l bg-spotify-base/40 px-2 py-1 font-mono">
                      Wk {fIdx + 1} · {friday.toLocaleDateString()}
                    </td>
                    {crew.map((c, i) => {
                      const sat = greedyByCrew.get(c.id)?.[fIdx] ?? null;
                      const isUnsatisfied = sat === null;
                      const lateDays = isUnsatisfied
                        ? null
                        : Math.floor(Math.max(0, sat - fridayMs) / dayMs);
                      return (
                        <td
                          key={c.id}
                          className="bg-spotify-base/40 px-2 py-1 font-mono"
                          style={{
                            color: isUnsatisfied
                              ? "#fca5a5"
                              : ON_TIME_COLORS[i % ON_TIME_COLORS.length],
                          }}
                        >
                          {isUnsatisfied
                            ? "missed"
                            : `${new Date(sat).toLocaleDateString()} (+${lateDays}d)`}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DetailSection>
    </div>
  );
}

// ---------- Card 6: Time of day ----------

const TIME_BUCKETS: { label: string; range: string; test: (h: number) => boolean }[] = [
  { label: "Morning", range: "05–11 UTC", test: (h) => h >= 5 && h < 12 },
  { label: "Afternoon", range: "12–16 UTC", test: (h) => h >= 12 && h < 17 },
  { label: "Evening", range: "17–21 UTC", test: (h) => h >= 17 && h < 22 },
  { label: "Night", range: "22–04 UTC", test: (h) => h >= 22 || h < 5 },
];

export function TimeOfDayDetail({
  enriched,
  crew,
}: {
  enriched: EnrichedTrack[];
  crew: CrewMember[];
}) {
  // bucket → memberId → tracks
  const grid = new Map<string, Map<string, EnrichedTrack[]>>();
  for (const b of TIME_BUCKETS) grid.set(b.label, new Map());
  for (const t of enriched) {
    if (!t.addedAt || !t.addedBy) continue;
    const h = t.addedAt.getUTCHours();
    const bucket = TIME_BUCKETS.find((b) => b.test(h))?.label;
    if (!bucket) continue;
    const arr = grid.get(bucket)!.get(t.addedBy.id) ?? [];
    arr.push(t);
    grid.get(bucket)!.set(t.addedBy.id, arr);
  }

  if (enriched.every((t) => !t.addedAt || !t.addedBy)) {
    return (
      <DetailSection title="No timestamped adds yet">
        <EmptyHint>
          Sync hasn&apos;t persisted added_at / added_by data yet.
        </EmptyHint>
      </DetailSection>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {TIME_BUCKETS.map((b) => {
        const memberMap =
          grid.get(b.label) ?? new Map<string, EnrichedTrack[]>();
        const total = [...memberMap.values()].reduce(
          (acc, arr) => acc + arr.length,
          0,
        );
        return (
          <DetailSection
            key={b.label}
            title={`${b.label} · ${total} add${total === 1 ? "" : "s"}`}
            subtitle={b.range}
          >
            {total === 0 ? (
              <p className="text-xs text-spotify-subtext">
                Nothing in this bucket.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {crew.map((c) => {
                  const list = memberMap.get(c.id) ?? [];
                  if (list.length === 0) return null;
                  return (
                    <div key={c.id} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <CrewBadge member={c} />
                        <span className="font-mono text-xs text-spotify-subtext">
                          {list.length} add{list.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-1">
                        {list
                          .sort(
                            (a, b) =>
                              (b.addedAt?.getTime() ?? 0) -
                              (a.addedAt?.getTime() ?? 0),
                          )
                          .map((t) => (
                            <TrackRow
                              key={`${t.trackId ?? t.trackUri}-${t.year}-${t.addedAtLabel}`}
                              track={t}
                            />
                          ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </DetailSection>
        );
      })}
    </div>
  );
}

// ---------- Card 7: Day of week ----------

export function DayOfWeekDetail({
  enriched,
}: {
  enriched: EnrichedTrack[];
}) {
  const buckets: EnrichedTrack[][] = DAY_LABELS.map(() => []);
  for (const t of enriched) {
    if (!t.addedAt) continue;
    const d = t.addedAt.getUTCDay();
    buckets[d].push(t);
  }
  const total = buckets.reduce((acc, b) => acc + b.length, 0);

  if (total === 0) {
    return (
      <DetailSection title="No timestamped adds yet">
        <EmptyHint>
          Nothing in the synced data has an{" "}
          <code className="font-mono">added_at</code> we can bucket.
        </EmptyHint>
      </DetailSection>
    );
  }

  const max = Math.max(...buckets.map((b) => b.length), 1);

  return (
    <div className="flex flex-col gap-6">
      <DetailSection title="By weekday (UTC)">
        <ul className="flex flex-col gap-1">
          {buckets.map((bucket, i) => (
            <li
              key={DAY_LABELS[i]}
              className="flex items-center gap-3 rounded border border-spotify-border bg-spotify-base/40 px-3 py-2 text-sm"
            >
              <span className="w-12 font-semibold">{DAY_LABELS[i]}</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded bg-spotify-highlight">
                <div
                  className="absolute inset-y-0 left-0 bg-spotify-green"
                  style={{ width: `${(bucket.length / max) * 100}%` }}
                />
              </div>
              <span className="w-20 text-right font-mono text-xs text-spotify-subtext">
                {bucket.length} ·{" "}
                {((bucket.length / total) * 100).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </DetailSection>

      {buckets.map((bucket, i) =>
        bucket.length === 0 ? null : (
          <DetailSection
            key={DAY_LABELS[i]}
            title={DAY_LABELS[i]}
            subtitle={`${bucket.length} add${bucket.length === 1 ? "" : "s"}`}
          >
            <ul className="flex flex-col gap-1.5">
              {bucket
                .sort(
                  (a, b) =>
                    (b.addedAt?.getTime() ?? 0) -
                    (a.addedAt?.getTime() ?? 0),
                )
                .map((t) => (
                  <TrackRow
                    key={`${t.trackId ?? t.trackUri}-${t.year}-${t.addedAtLabel}`}
                    track={t}
                  />
                ))}
            </ul>
          </DetailSection>
        ),
      )}
    </div>
  );
}

// ---------- Card 8: Track length ----------

const LENGTH_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "< 2:00", min: 0, max: 120_000 },
  { label: "2:00–2:59", min: 120_000, max: 180_000 },
  { label: "3:00–3:59", min: 180_000, max: 240_000 },
  { label: "4:00–4:59", min: 240_000, max: 300_000 },
  { label: "5:00–5:59", min: 300_000, max: 360_000 },
  { label: "6:00–7:59", min: 360_000, max: 480_000 },
  { label: "≥ 8:00", min: 480_000, max: Number.POSITIVE_INFINITY },
];

export function TrackLengthDetail({
  enriched,
}: {
  enriched: EnrichedTrack[];
}) {
  const tracks = enriched.filter((t) => t.durationMs > 0);
  if (tracks.length === 0) {
    return (
      <DetailSection title="No durations on file">
        <EmptyHint>
          The synced data has no track durations to bucket.
        </EmptyHint>
      </DetailSection>
    );
  }

  const buckets: { label: string; tracks: EnrichedTrack[] }[] =
    LENGTH_BUCKETS.map((b) => ({ label: b.label, tracks: [] }));
  for (const t of tracks) {
    const idx = LENGTH_BUCKETS.findIndex(
      (b) => t.durationMs >= b.min && t.durationMs < b.max,
    );
    if (idx >= 0) buckets[idx].tracks.push(t);
  }

  const sorted = [...tracks].sort((a, b) => a.durationMs - b.durationMs);
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2].durationMs
        : Math.round(
            (sorted[sorted.length / 2 - 1].durationMs +
              sorted[sorted.length / 2].durationMs) /
              2,
          );
  const total = tracks.reduce((acc, t) => acc + t.durationMs, 0);
  const avg = Math.round(total / tracks.length);
  const shortest = sorted[0];
  const longest = sorted[sorted.length - 1];

  const max = Math.max(...buckets.map((b) => b.tracks.length), 1);

  return (
    <div className="flex flex-col gap-6">
      <DetailSection title="Summary">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
              Median
            </dt>
            <dd className="font-mono">{formatDuration(median)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
              Average
            </dt>
            <dd className="font-mono">{formatDuration(avg)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
              Shortest
            </dt>
            <dd className="truncate text-xs">
              {formatDuration(shortest.durationMs)} ·{" "}
              <span className="text-spotify-subtext">
                {shortest.trackName}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
              Longest
            </dt>
            <dd className="truncate text-xs">
              {formatDuration(longest.durationMs)} ·{" "}
              <span className="text-spotify-subtext">
                {longest.trackName}
              </span>
            </dd>
          </div>
        </dl>
      </DetailSection>

      <DetailSection title="Histogram">
        <ul className="flex flex-col gap-1">
          {buckets.map((b) => (
            <li
              key={b.label}
              className="flex items-center gap-3 rounded border border-spotify-border bg-spotify-base/40 px-3 py-2 text-sm"
            >
              <span className="w-24 font-mono">{b.label}</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded bg-spotify-highlight">
                <div
                  className="absolute inset-y-0 left-0 bg-spotify-green"
                  style={{ width: `${(b.tracks.length / max) * 100}%` }}
                />
              </div>
              <span className="w-20 text-right font-mono text-xs text-spotify-subtext">
                {b.tracks.length}
              </span>
            </li>
          ))}
        </ul>
      </DetailSection>

      {buckets.map((b) =>
        b.tracks.length === 0 ? null : (
          <DetailSection
            key={b.label}
            title={b.label}
            subtitle={`${b.tracks.length} track${b.tracks.length === 1 ? "" : "s"}`}
          >
            <ul className="flex flex-col gap-1.5">
              {b.tracks
                .sort((a, b) => a.durationMs - b.durationMs)
                .map((t) => (
                  <TrackRow
                    key={`${t.trackId ?? t.trackUri}-${t.year}-${t.addedAtLabel}`}
                    track={t}
                  />
                ))}
            </ul>
          </DetailSection>
        ),
      )}
    </div>
  );
}

// ---------- Card 9: Explicit ----------

export function ExplicitDetail({
  enriched,
  crew,
}: {
  enriched: EnrichedTrack[];
  crew: CrewMember[];
}) {
  type Row = {
    member: CrewMember;
    explicit: EnrichedTrack[];
    clean: EnrichedTrack[];
  };
  const rows: Row[] = crew.map((c) => ({ member: c, explicit: [], clean: [] }));
  const byId = new Map(rows.map((r) => [r.member.id, r]));
  for (const t of enriched) {
    if (!t.addedBy) continue;
    const row = byId.get(t.addedBy.id);
    if (!row) continue;
    (t.explicit ? row.explicit : row.clean).push(t);
  }

  const totalExplicit = rows.reduce((acc, r) => acc + r.explicit.length, 0);
  if (totalExplicit === 0 && rows.every((r) => r.clean.length === 0)) {
    return (
      <DetailSection title="No attributed tracks yet">
        <EmptyHint>
          Sync hasn&apos;t produced added_by data we could attribute.
        </EmptyHint>
      </DetailSection>
    );
  }

  const sorted = [...rows].sort((a, b) => {
    const aRate =
      a.explicit.length / Math.max(1, a.explicit.length + a.clean.length);
    const bRate =
      b.explicit.length / Math.max(1, b.explicit.length + b.clean.length);
    return bRate - aRate;
  });

  return (
    <div className="flex flex-col gap-6">
      <DetailSection title="Per crew member · explicit-rate">
        <ul className="flex flex-col gap-2">
          {sorted.map((r, idx) => {
            const total = r.explicit.length + r.clean.length;
            const rate = total > 0 ? r.explicit.length / total : 0;
            return (
              <li
                key={r.member.id}
                className="flex items-center gap-3 rounded border border-spotify-border bg-spotify-base/40 px-3 py-2 text-sm"
              >
                <span className="w-6 text-center font-mono text-xs text-spotify-subtext">
                  {idx + 1}
                </span>
                <CrewBadge member={r.member} />
                <span className="ml-auto font-mono text-xs text-spotify-subtext">
                  {r.explicit.length} explicit / {total} total ·{" "}
                  {(rate * 100).toFixed(1)}%
                </span>
              </li>
            );
          })}
        </ul>
      </DetailSection>

      {sorted.map((r) =>
        r.explicit.length === 0 ? null : (
          <DetailSection
            key={r.member.id}
            title={displayCrewName(r.member)}
            subtitle={`${r.explicit.length} explicit add${r.explicit.length === 1 ? "" : "s"}`}
          >
            <ul className="flex flex-col gap-1.5">
              {r.explicit
                .sort(
                  (a, b) =>
                    (b.addedAt?.getTime() ?? 0) -
                    (a.addedAt?.getTime() ?? 0),
                )
                .map((t) => (
                  <TrackRow
                    key={`${t.trackId ?? t.trackUri}-${t.year}-${t.addedAtLabel}`}
                    track={t}
                  />
                ))}
            </ul>
          </DetailSection>
        ),
      )}
    </div>
  );
}

