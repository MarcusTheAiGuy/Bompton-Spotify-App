import Link from "next/link";

export function ConnectButton() {
  return (
    <Link href="/api/auth/signin" className="btn-spotify">
      <SpotifyGlyph />
      Connect Spotify
    </Link>
  );
}

function SpotifyGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="currentColor"
    >
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0Zm5.503 17.314a.748.748 0 0 1-1.03.248c-2.82-1.724-6.37-2.115-10.553-1.158a.749.749 0 1 1-.333-1.46c4.577-1.046 8.506-.594 11.666 1.339.354.216.464.679.25 1.031Zm1.47-3.267a.936.936 0 0 1-1.287.308c-3.227-1.984-8.147-2.559-11.963-1.4a.936.936 0 1 1-.543-1.79c4.36-1.323 9.776-.683 13.485 1.596.44.27.58.847.308 1.286Zm.127-3.403C15.28 8.4 8.793 8.186 5.07 9.317a1.123 1.123 0 1 1-.652-2.148c4.276-1.298 11.43-1.047 15.933 1.625a1.122 1.122 0 1 1-1.151 1.85Z" />
    </svg>
  );
}
