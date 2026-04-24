"use client";

import { useMemo, useState } from "react";
import type { SpotifyPlaylistTrack } from "@/lib/spotify";
import { formatDuration } from "@/lib/spotify";
import type { CrewMember } from "@/lib/bompton";
import { displaySpotifyUserName } from "@/lib/spotify-user-names";

// Compressed-by-default track list rendered inside a Bompton season
// column. Three visible cells per row in compressed mode: track name,
// position, and an avatar for the contributor (Spotify-style — pulls
// the image from the matching crew member's NextAuth profile so each
// crew member shows up as their face). Expand toggle reveals
// artist(s) / album / duration / added-at.

export function BomptonTrackList({
  tracks,
  crew,
}: {
  tracks: SpotifyPlaylistTrack[];
  crew: CrewMember[];
}) {
  const [expanded, setExpanded] = useState(false);

  const crewBySpotifyId = useMemo(() => {
    const m = new Map<string, CrewMember>();
    for (const c of crew) {
      if (c.spotifyUserId) m.set(c.spotifyUserId, c);
    }
    return m;
  }, [crew]);

  if (tracks.length === 0) {
    return (
      <p className="rounded-lg border border-spotify-border bg-spotify-highlight/30 px-3 py-2 text-xs text-spotify-subtext">
        No tracks stored yet for this season.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-spotify-subtext">
          Tracks · {tracks.length}
        </p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-semibold text-spotify-subtext transition hover:text-spotify-text"
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      </div>

      <div className="overflow-x-auto rounded border border-spotify-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-spotify-highlight/40 text-[10px] uppercase tracking-widest text-spotify-subtext">
            <tr>
              <th className="px-2 py-1.5 w-8">#</th>
              <th className="px-2 py-1.5">Track</th>
              {expanded ? <th className="px-2 py-1.5">Artist(s)</th> : null}
              {expanded ? <th className="px-2 py-1.5">Album</th> : null}
              {expanded ? <th className="px-2 py-1.5">Duration</th> : null}
              <th className="px-2 py-1.5 w-12 text-center">By</th>
              {expanded ? <th className="px-2 py-1.5">Added</th> : null}
            </tr>
          </thead>
          <tbody>
            {tracks.map((item, index) => {
              const track = item.track;
              const albumImage = track?.album?.images?.[0]?.url ?? null;
              const addedById = item.added_by?.id ?? null;
              return (
                <tr
                  key={`${index}-${track?.id ?? track?.uri ?? index}`}
                  className="border-t border-spotify-border/60 align-middle"
                >
                  <td className="px-2 py-1.5 font-mono text-[10px] text-spotify-subtext">
                    {index + 1}
                  </td>
                  <td className="min-w-0 px-2 py-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      {albumImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={albumImage}
                          alt=""
                          className="h-6 w-6 shrink-0 rounded object-cover"
                        />
                      ) : null}
                      <span className="truncate">
                        {track?.name ?? "(unavailable)"}
                      </span>
                      {track?.explicit ? (
                        <span className="rounded bg-spotify-highlight px-1 text-[9px] font-bold text-spotify-subtext">
                          E
                        </span>
                      ) : null}
                    </div>
                  </td>
                  {expanded ? (
                    <td className="px-2 py-1.5 text-spotify-subtext">
                      {(track?.artists ?? []).map((a) => a.name).join(", ")}
                    </td>
                  ) : null}
                  {expanded ? (
                    <td className="px-2 py-1.5 text-spotify-subtext">
                      {track?.album?.name ?? ""}
                    </td>
                  ) : null}
                  {expanded ? (
                    <td className="px-2 py-1.5 text-spotify-subtext">
                      {formatDuration(track?.duration_ms ?? 0)}
                    </td>
                  ) : null}
                  <td className="px-2 py-1.5 text-center">
                    <ContributorAvatar
                      addedBySpotifyId={addedById}
                      crewMember={
                        addedById ? crewBySpotifyId.get(addedById) ?? null : null
                      }
                    />
                  </td>
                  {expanded ? (
                    <td className="px-2 py-1.5 text-[10px] text-spotify-subtext">
                      {new Date(item.added_at).toLocaleDateString()}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContributorAvatar({
  addedBySpotifyId,
  crewMember,
}: {
  addedBySpotifyId: string | null;
  crewMember: CrewMember | null;
}) {
  if (!addedBySpotifyId) {
    return <span className="text-[10px] text-spotify-subtext">—</span>;
  }
  const friendlyName = displaySpotifyUserName(addedBySpotifyId);
  const title = crewMember?.name ?? friendlyName;
  if (crewMember?.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={crewMember.image}
        alt={title}
        title={title}
        className="mx-auto h-6 w-6 rounded-full object-cover"
      />
    );
  }
  // No crew image (non-crew contributor, or crew member without
  // NextAuth-stored image). Fall back to an initial bubble.
  const initial = friendlyName.slice(0, 1).toUpperCase();
  return (
    <span
      title={title}
      className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-spotify-highlight text-[10px] font-bold text-spotify-text"
    >
      {initial}
    </span>
  );
}
