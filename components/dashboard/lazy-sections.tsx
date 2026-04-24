"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  SpotifyArtist,
  SpotifyPaged,
  SpotifyTrack,
  SpotifyPlaybackState,
  SpotifyQueue,
  SpotifyDevice,
  SpotifyCursorPaged,
  SpotifyRecentlyPlayedItem,
  SpotifySavedTrackItem,
  SpotifySavedAlbumItem,
  SpotifySavedShowItem,
  SpotifySavedEpisodeItem,
  SpotifySavedAudiobookItem,
} from "@/lib/spotify";
import { TIME_RANGES } from "@/lib/spotify";
import { SectionHeader, SpotifyErrorBanner } from "@/components/spotify/section-header";
import { CollapsibleSection } from "@/components/spotify/collapsible-section";
import { NowPlaying } from "@/components/spotify/now-playing";
import { DeviceList } from "@/components/spotify/device-list";
import { QueueList } from "@/components/spotify/queue-list";
import { RecentlyPlayed } from "@/components/spotify/recently-played";
import { TrackList } from "@/components/spotify/track-list";
import { ArtistGrid } from "@/components/spotify/artist-grid";
import { SavedTracks } from "@/components/spotify/saved-tracks";
import { SavedAlbumGrid } from "@/components/spotify/album-grid";
import {
  AudiobookGrid,
  EpisodeList,
  ShowGrid,
} from "@/components/spotify/show-grid";
import {
  PopularityStats,
  OverlapStats,
  GenreDistribution,
  ReleaseDecadeDistribution,
} from "@/components/spotify/derived-stats";

type SectionState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: T }
  | { status: "error"; title: string; detail: string };

type StateByKind = Record<string, SectionState<unknown>>;

// Sections fetched in this order. Loaded sequentially after mount so we
// don't burst 15 calls at Spotify in one tick — each finishes (or fails)
// before the next starts, which is what avoided the 429s.
const LAZY_KINDS = [
  "playback",
  "queue",
  "devices",
  "recently-played",
  "top-tracks-short",
  "top-tracks-medium",
  "top-tracks-long",
  "top-artists-short",
  "top-artists-medium",
  "top-artists-long",
  "saved-tracks",
  "saved-albums",
  "saved-shows",
  "saved-episodes",
  "saved-audiobooks",
  "followed-artists",
] as const;

export function LazyDashboardSections() {
  const [state, setState] = useState<StateByKind>(() => {
    const initial: StateByKind = {};
    for (const kind of LAZY_KINDS) initial[kind] = { status: "idle" };
    return initial;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const kind of LAZY_KINDS) {
        if (cancelled) return;
        setState((prev: StateByKind) => ({ ...prev, [kind]: { status: "loading" } }));
        try {
          const response = await fetch(`/api/dashboard/${kind}`);
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            if (!cancelled) {
              setState((prev: StateByKind) => ({
                ...prev,
                [kind]: {
                  status: "error",
                  title: body?.error ?? `HTTP ${response.status}`,
                  detail: body?.message ?? `Failed to load ${kind}`,
                },
              }));
            }
          } else if (!cancelled) {
            setState((prev: StateByKind) => ({
              ...prev,
              [kind]: { status: "loaded", data: body.data },
            }));
          }
        } catch (error) {
          if (!cancelled) {
            setState((prev: StateByKind) => ({
              ...prev,
              [kind]: {
                status: "error",
                title: "Network error",
                detail:
                  error instanceof Error
                    ? `${error.name}: ${error.message}`
                    : String(error),
              },
            }));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const topTracksByRange = useMemo(
    () => ({
      short_term: state["top-tracks-short"] as SectionState<
        SpotifyPaged<SpotifyTrack>
      >,
      medium_term: state["top-tracks-medium"] as SectionState<
        SpotifyPaged<SpotifyTrack>
      >,
      long_term: state["top-tracks-long"] as SectionState<
        SpotifyPaged<SpotifyTrack>
      >,
    }),
    [state],
  );
  const topArtistsByRange = useMemo(
    () => ({
      short_term: state["top-artists-short"] as SectionState<
        SpotifyPaged<SpotifyArtist>
      >,
      medium_term: state["top-artists-medium"] as SectionState<
        SpotifyPaged<SpotifyArtist>
      >,
      long_term: state["top-artists-long"] as SectionState<
        SpotifyPaged<SpotifyArtist>
      >,
    }),
    [state],
  );

  // Derived: dedup union of top tracks/artists across ranges. Populated
  // as each range's data arrives — stats render progressively.
  const unionTracks: SpotifyTrack[] = [];
  const seenTrackIds = new Set<string>();
  for (const s of [
    topTracksByRange.short_term,
    topTracksByRange.medium_term,
    topTracksByRange.long_term,
  ]) {
    if (s.status === "loaded") {
      for (const t of s.data.items ?? []) {
        if (!seenTrackIds.has(t.id)) {
          seenTrackIds.add(t.id);
          unionTracks.push(t);
        }
      }
    }
  }
  const unionArtists: SpotifyArtist[] = [];
  const seenArtistIds = new Set<string>();
  for (const s of [
    topArtistsByRange.short_term,
    topArtistsByRange.medium_term,
    topArtistsByRange.long_term,
  ]) {
    if (s.status === "loaded") {
      for (const a of s.data.items ?? []) {
        if (!seenArtistIds.has(a.id)) {
          seenArtistIds.add(a.id);
          unionArtists.push(a);
        }
      }
    }
  }
  const mediumTracks =
    topTracksByRange.medium_term.status === "loaded"
      ? topTracksByRange.medium_term.data.items
      : [];
  const mediumArtists =
    topArtistsByRange.medium_term.status === "loaded"
      ? topArtistsByRange.medium_term.data.items
      : [];

  return (
    <>
      <div className="flex flex-col gap-4">
        <SectionHeader
          eyebrow="Right now"
          title="What's spinning"
          subtitle="Live playback state from /me/player."
        />
        <LoadedOrBanner
          state={
            state["playback"] as SectionState<SpotifyPlaybackState | undefined>
          }
          render={(data) => <NowPlaying state={data ?? null} />}
        />
      </div>

      <CollapsibleSection
        eyebrow="Up next"
        title="Queue"
        subtitle="What's lined up after the current track, via /me/player/queue."
      >
        <LoadedOrBanner
          state={state["queue"] as SectionState<SpotifyQueue>}
          render={(data) => <QueueList items={data.queue} />}
        />
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Devices"
        title="Available devices"
        subtitle="Anything Spotify currently sees online for this account."
      >
        <LoadedOrBanner
          state={
            state["devices"] as SectionState<{ devices: SpotifyDevice[] }>
          }
          render={(data) => <DeviceList devices={data.devices} />}
        />
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="History"
        title="Recently played"
        subtitle="Last 50 tracks Spotify has on record for this account."
      >
        <LoadedOrBanner
          state={
            state["recently-played"] as SectionState<
              SpotifyCursorPaged<SpotifyRecentlyPlayedItem>
            >
          }
          render={(data) => <RecentlyPlayed items={data.items} />}
        />
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Listening"
        title="Top tracks"
        subtitle="Up to 50 per time range, straight from /me/top/tracks."
      >
        {TIME_RANGES.map(({ key, label }) => (
          <RangeSection<SpotifyTrack>
            key={`tracks-${key}`}
            label={label}
            state={topTracksByRange[key]}
            render={(data) => <TrackList tracks={data.items} />}
            emptyFallbackTitle="Top tracks unavailable"
          />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Listening"
        title="Top artists"
        subtitle="Up to 50 per time range, with Spotify-assigned genres and popularity."
      >
        {TIME_RANGES.map(({ key, label }) => (
          <RangeSection<SpotifyArtist>
            key={`artists-${key}`}
            label={label}
            state={topArtistsByRange[key]}
            render={(data) => <ArtistGrid artists={data.items} />}
            emptyFallbackTitle="Top artists unavailable"
          />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Derived"
        title="Listening patterns"
        subtitle="Aggregates computed locally from the top-items responses above."
      >
        {unionTracks.length === 0 && unionArtists.length === 0 ? (
          <p className="text-xs text-spotify-subtext">
            Waiting on top tracks / artists to finish loading…
          </p>
        ) : (
          <>
            <PopularityStats tracks={unionTracks} artists={unionArtists} />
            <TopItemOverlapClient
              mediumTracks={mediumTracks}
              mediumArtists={mediumArtists}
            />
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
                Genre mix (from top artists, dedupe&apos;d across time ranges)
              </h3>
              <GenreDistribution artists={unionArtists} />
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
                Release decade distribution (from top tracks)
              </h3>
              <ReleaseDecadeDistribution tracks={unionTracks} />
            </div>
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Library"
        title="Saved content"
        subtitle="First 50 items of each saved collection."
      >
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Saved tracks
          </h3>
          <LoadedOrBanner
            state={
              state["saved-tracks"] as SectionState<
                SpotifyPaged<SpotifySavedTrackItem>
              >
            }
            render={(data) => <SavedTracks items={data.items} />}
          />
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Saved albums
          </h3>
          <LoadedOrBanner
            state={
              state["saved-albums"] as SectionState<
                SpotifyPaged<SpotifySavedAlbumItem>
              >
            }
            render={(data) => <SavedAlbumGrid items={data.items} />}
          />
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Saved podcasts
          </h3>
          <LoadedOrBanner
            state={
              state["saved-shows"] as SectionState<
                SpotifyPaged<SpotifySavedShowItem>
              >
            }
            render={(data) => <ShowGrid items={data.items} />}
          />
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Saved episodes
          </h3>
          <LoadedOrBanner
            state={
              state["saved-episodes"] as SectionState<
                SpotifyPaged<SpotifySavedEpisodeItem>
              >
            }
            render={(data) => <EpisodeList items={data.items} />}
          />
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
            Saved audiobooks
          </h3>
          <LoadedOrBanner
            state={
              state["saved-audiobooks"] as SectionState<
                SpotifyPaged<SpotifySavedAudiobookItem>
              >
            }
            render={(data) => <AudiobookGrid items={data.items} />}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        eyebrow="Following"
        title="Followed artists"
        subtitle="Up to 50 artists, fetched from /me/following."
      >
        <LoadedOrBanner
          state={
            state["followed-artists"] as SectionState<{
              artists: SpotifyCursorPaged<SpotifyArtist>;
            }>
          }
          render={(data) => <ArtistGrid artists={data.artists.items} />}
        />
      </CollapsibleSection>
    </>
  );
}

function LoadedOrBanner<T>({
  state,
  render,
}: {
  state: SectionState<T>;
  render: (data: T) => ReactNode;
}) {
  if (state.status === "idle") {
    return (
      <p className="text-xs text-spotify-subtext">Queued — will load soon.</p>
    );
  }
  if (state.status === "loading") {
    return <p className="text-xs text-spotify-subtext">Loading…</p>;
  }
  if (state.status === "error") {
    return <SpotifyErrorBanner title={state.title} detail={state.detail} />;
  }
  return <>{render(state.data)}</>;
}

function RangeSection<T>({
  label,
  state,
  render,
  emptyFallbackTitle,
}: {
  label: string;
  state: SectionState<SpotifyPaged<T>>;
  render: (data: SpotifyPaged<T>) => ReactNode;
  emptyFallbackTitle: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-bold uppercase tracking-widest text-spotify-subtext">
        {label}
      </h3>
      {state.status === "idle" || state.status === "loading" ? (
        <p className="text-xs text-spotify-subtext">Loading {label}…</p>
      ) : state.status === "error" ? (
        <SpotifyErrorBanner
          title={emptyFallbackTitle}
          detail={`${state.title} · ${state.detail}`}
        />
      ) : (
        render(state.data)
      )}
    </div>
  );
}

// Follow-up fetch: given the medium-range top tracks / artists loaded above,
// fire two /api/dashboard/{check} calls to compute the overlap counters.
// Deferred so it only runs after the top items have loaded.
function TopItemOverlapClient({
  mediumTracks,
  mediumArtists,
}: {
  mediumTracks: SpotifyTrack[];
  mediumArtists: SpotifyArtist[];
}) {
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [followedCount, setFollowedCount] = useState<number | null>(null);

  const trackIds = mediumTracks.slice(0, 50).map((t) => t.id).join(",");
  const artistIds = mediumArtists.slice(0, 50).map((a) => a.id).join(",");

  useEffect(() => {
    let cancelled = false;
    const trackIdList = trackIds.split(",").filter(Boolean);
    const artistIdList = artistIds.split(",").filter(Boolean);
    if (trackIdList.length === 0 && artistIdList.length === 0) return;

    (async () => {
      if (trackIdList.length > 0) {
        const qs = trackIdList.map((id) => `id=${encodeURIComponent(id)}`).join("&");
        try {
          const res = await fetch(
            `/api/dashboard/saved-top-track-check?${qs}`,
          );
          const body = await res.json();
          if (!cancelled && res.ok && Array.isArray(body.data)) {
            setSavedCount(body.data.filter(Boolean).length);
          }
        } catch {
          // leave null
        }
      }
      if (artistIdList.length > 0) {
        const qs = artistIdList.map((id) => `id=${encodeURIComponent(id)}`).join("&");
        try {
          const res = await fetch(
            `/api/dashboard/followed-top-artist-check?${qs}`,
          );
          const body = await res.json();
          if (!cancelled && res.ok && Array.isArray(body.data)) {
            setFollowedCount(body.data.filter(Boolean).length);
          }
        } catch {
          // leave null
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trackIds, artistIds]);

  return (
    <OverlapStats
      savedTopTrackCount={savedCount}
      totalTopTracks={mediumTracks.slice(0, 50).length}
      followedTopArtistCount={followedCount}
      totalTopArtists={mediumArtists.slice(0, 50).length}
    />
  );
}
