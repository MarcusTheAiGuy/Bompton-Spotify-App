import type { SpotifyPlaylistTrack } from "@/lib/spotify";
import { formatDuration } from "@/lib/spotify";
import { displaySpotifyUserName } from "@/lib/spotify-user-names";

// Renders a Bompton season's tracks as a sortable-looking table, the
// same shape as the dashboard's StoredTable but sourced from the DB
// rows loaded by loadBomptonDataFromDb (shape: SpotifyPlaylistTrack[]).
export function BomptonTrackTable({
  tracks,
}: {
  tracks: SpotifyPlaylistTrack[];
}) {
  if (tracks.length === 0) {
    return (
      <p className="rounded-lg border border-spotify-border bg-spotify-highlight/30 px-4 py-3 text-sm text-spotify-subtext">
        No tracks stored yet for this season.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded border border-spotify-border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-spotify-highlight/40 text-xs uppercase tracking-widest text-spotify-subtext">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Track</th>
            <th className="px-3 py-2">Artist(s)</th>
            <th className="px-3 py-2">Album</th>
            <th className="px-3 py-2">Duration</th>
            <th className="px-3 py-2">Added by</th>
            <th className="px-3 py-2">Added at</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((item, index) => {
            const track = item.track;
            const albumImage = track?.album?.images?.[0]?.url ?? null;
            return (
              <tr
                key={`${index}-${track?.id ?? track?.uri ?? index}`}
                className="border-t border-spotify-border/60 align-top"
              >
                <td className="px-3 py-2 font-mono text-xs text-spotify-subtext">
                  {index + 1}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {albumImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={albumImage}
                        alt=""
                        className="h-8 w-8 rounded object-cover"
                      />
                    ) : null}
                    <span>{track?.name ?? "(unavailable)"}</span>
                    {track?.explicit ? (
                      <span className="rounded bg-spotify-highlight px-1 text-[10px] font-bold text-spotify-subtext">
                        E
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2 text-spotify-subtext">
                  {(track?.artists ?? []).map((a) => a.name).join(", ")}
                </td>
                <td className="px-3 py-2 text-spotify-subtext">
                  {track?.album?.name ?? ""}
                </td>
                <td className="px-3 py-2 text-spotify-subtext">
                  {formatDuration(track?.duration_ms ?? 0)}
                </td>
                <td className="px-3 py-2 text-xs text-spotify-subtext">
                  {displaySpotifyUserName(item.added_by?.id ?? null)}
                </td>
                <td className="px-3 py-2 text-xs text-spotify-subtext">
                  {new Date(item.added_at).toLocaleDateString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
