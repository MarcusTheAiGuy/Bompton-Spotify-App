import {
  formatDuration,
  pickImage,
  type SpotifyPlaybackState,
} from "@/lib/spotify";

export function NowPlaying({ state }: { state: SpotifyPlaybackState | null }) {
  if (!state || !state.item) {
    return (
      <div className="card text-sm text-spotify-subtext">
        Nothing playing right now.
      </div>
    );
  }

  const item = state.item;
  const isTrack = "album" in item;
  const image = isTrack
    ? pickImage(item.album?.images, 128)
    : pickImage(item.images, 128);
  const subtitle = isTrack
    ? (item.artists ?? []).map((a) => a.name).join(", ")
    : item.show?.name ?? "Episode";
  const contextLabel = isTrack
    ? item.album?.name ?? ""
    : item.show?.publisher ?? "";

  const progressMs = state.progress_ms ?? 0;
  const durationMs = item.duration_ms ?? 0;
  const progressPct = durationMs
    ? Math.min(100, (progressMs / durationMs) * 100)
    : 0;

  return (
    <div className="card flex flex-col gap-4 sm:flex-row sm:items-center">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          className="h-24 w-24 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-24 w-24 shrink-0 rounded bg-spotify-highlight" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={
              state.is_playing
                ? "inline-flex items-center gap-1 rounded-full bg-spotify-green px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black"
                : "inline-flex items-center gap-1 rounded-full bg-spotify-highlight px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-spotify-subtext"
            }
          >
            {state.is_playing ? "Playing" : "Paused"}
          </span>
          <span className="text-xs uppercase tracking-widest text-spotify-subtext">
            {state.currently_playing_type}
          </span>
        </div>
        <a
          href={item.external_urls?.spotify ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="mt-1 block truncate text-xl font-bold hover:text-spotify-green"
        >
          {item.name ?? "(unknown)"}
        </a>
        <p className="truncate text-sm text-spotify-subtext">
          {subtitle}
          {contextLabel ? (
            <>
              <span className="mx-1 text-spotify-border">·</span>
              {contextLabel}
            </>
          ) : null}
        </p>
        <div className="mt-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-spotify-border">
            <div
              className="h-full bg-spotify-green"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-xs text-spotify-subtext">
            <span>{formatDuration(progressMs)}</span>
            <span>{formatDuration(durationMs)}</span>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 text-xs text-spotify-subtext sm:grid-cols-4">
          <DetailRow
            label="Device"
            value={
              state.device
                ? `${state.device.name} (${state.device.type})`
                : "—"
            }
          />
          <DetailRow
            label="Volume"
            value={
              state.device?.volume_percent != null
                ? `${state.device.volume_percent}%`
                : "—"
            }
          />
          <DetailRow
            label="Shuffle"
            value={state.shuffle_state ? "On" : "Off"}
          />
          <DetailRow label="Repeat" value={state.repeat_state ?? "off"} />
        </dl>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-widest">{label}</dt>
      <dd className="font-semibold text-spotify-text">{value}</dd>
    </div>
  );
}
