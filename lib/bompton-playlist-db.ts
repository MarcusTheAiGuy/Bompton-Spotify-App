import { prisma } from "@/lib/prisma";
import type {
  SpotifyArtistRef,
  SpotifyImage,
  SpotifyPlaylistTrack,
  SpotifyTrack,
} from "@/lib/spotify";
import {
  BOMPTON_YEARS,
  matchesBomptonYear,
  type BomptonYear,
} from "@/lib/bompton";

export type BomptonPlaylistRow = {
  id: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  imageUrl: string | null;
  totalTracks: number;
  lastSyncAt: Date | null;
  lastSyncBy: string | null;
  snapshotId: string | null;
};

export type BomptonPlaylistByYear = {
  year: BomptonYear;
  playlist: BomptonPlaylistRow | null;
  tracks: SpotifyPlaylistTrack[];
};

// Load every Playlist + PlaylistTrack row relevant to the four Bompton
// seasons, match by name, and return results shaped for the existing
// tallyContributors / scoreSeason helpers.
export async function loadBomptonDataFromDb(): Promise<BomptonPlaylistByYear[]> {
  const playlists = await prisma.playlist.findMany({
    include: {
      tracks: {
        orderBy: { position: "asc" },
      },
    },
  });

  const results: BomptonPlaylistByYear[] = [];
  for (const year of BOMPTON_YEARS) {
    const match = playlists.find((p) => matchesBomptonYear(p.name, year));
    if (!match) {
      results.push({ year, playlist: null, tracks: [] });
      continue;
    }
    results.push({
      year,
      playlist: {
        id: match.id,
        name: match.name,
        ownerId: match.ownerId,
        ownerName: match.ownerName,
        imageUrl: match.imageUrl,
        totalTracks: match.totalTracks,
        lastSyncAt: match.lastSyncAt,
        lastSyncBy: match.lastSyncBy,
        snapshotId: match.snapshotId,
      },
      tracks: match.tracks.map((row) => serializeTrackRow(row)),
    });
  }
  return results;
}

type PlaylistTrackRow = {
  position: number;
  trackSpotifyId: string | null;
  trackName: string;
  trackUri: string;
  trackDurationMs: number;
  trackExplicit: boolean;
  trackPreviewUrl: string | null;
  albumName: string;
  albumImageUrl: string | null;
  artistsJson: unknown;
  addedAt: Date;
  addedBySpotifyId: string | null;
  isLocal: boolean;
};

function serializeTrackRow(row: PlaylistTrackRow): SpotifyPlaylistTrack {
  const artists = parseArtists(row.artistsJson);
  const albumImages: SpotifyImage[] = row.albumImageUrl
    ? [{ url: row.albumImageUrl, height: null, width: null }]
    : [];

  const track: SpotifyTrack | null =
    row.trackSpotifyId || row.trackUri
      ? {
          id: row.trackSpotifyId ?? "",
          name: row.trackName,
          uri: row.trackUri,
          href: row.trackSpotifyId
            ? `https://api.spotify.com/v1/tracks/${row.trackSpotifyId}`
            : "",
          external_urls: {
            spotify: row.trackSpotifyId
              ? `https://open.spotify.com/track/${row.trackSpotifyId}`
              : "",
          },
          duration_ms: row.trackDurationMs,
          popularity: 0,
          explicit: row.trackExplicit,
          preview_url: row.trackPreviewUrl,
          track_number: 0,
          disc_number: 0,
          is_local: row.isLocal,
          album: {
            id: "",
            name: row.albumName,
            uri: "",
            href: "",
            external_urls: { spotify: "" },
            album_type: "album",
            release_date: "",
            release_date_precision: "day",
            total_tracks: 0,
            images: albumImages,
            artists: artists,
            type: "album",
          },
          artists: artists,
          type: "track",
        }
      : null;

  return {
    added_at: row.addedAt.toISOString(),
    added_by: row.addedBySpotifyId ? { id: row.addedBySpotifyId } : null,
    is_local: row.isLocal,
    track,
  };
}

function parseArtists(raw: unknown): SpotifyArtistRef[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): SpotifyArtistRef[] => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : "";
    const name = typeof e.name === "string" ? e.name : "";
    const uri = typeof e.uri === "string" ? e.uri : "";
    if (!name) return [];
    return [
      {
        id,
        name,
        uri,
        href: id ? `https://api.spotify.com/v1/artists/${id}` : "",
        external_urls: {
          spotify: id ? `https://open.spotify.com/artist/${id}` : "",
        },
        type: "artist",
      },
    ];
  });
}
