import type { SpotifyDevice } from "@/lib/spotify";

export function DeviceList({ devices }: { devices: SpotifyDevice[] }) {
  if (devices.length === 0) {
    return (
      <p className="rounded-lg bg-spotify-highlight/40 px-4 py-3 text-sm text-spotify-subtext">
        No devices reported. Open Spotify on any phone, computer, or speaker
        and it should show up here.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {devices.map((device) => (
        <li
          key={device.id ?? device.name}
          className="card flex flex-col gap-1"
        >
          <div className="flex items-center justify-between">
            <p className="font-semibold">{device.name}</p>
            {device.is_active ? (
              <span className="rounded-full bg-spotify-green px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">
                Active
              </span>
            ) : null}
          </div>
          <p className="text-xs text-spotify-subtext">
            {device.type}
            {device.is_private_session ? " · private" : ""}
            {device.is_restricted ? " · restricted" : ""}
          </p>
          <p className="text-xs text-spotify-subtext">
            Volume:{" "}
            {device.volume_percent != null ? `${device.volume_percent}%` : "—"}
            {device.supports_volume ? "" : " (fixed)"}
          </p>
        </li>
      ))}
    </ul>
  );
}
