import Link from "next/link";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/friends", label: "Friends" },
  { href: "/recap", label: "Recap" },
  { href: "/bompton-playlist", label: "Bompton Playlist" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-spotify-border bg-spotify-base/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-extrabold tracking-tight">
          <span className="inline-block h-3 w-3 rounded-full bg-spotify-green" />
          <span className="text-lg">Bompton</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-semibold text-spotify-subtext sm:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition hover:text-spotify-text"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
