import Link from "next/link";
import { auth } from "@/auth";
import { SignOutButton } from "@/components/sign-out-button";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/friends", label: "Friends" },
  { href: "/recap", label: "Recap" },
  { href: "/bompton-playlist", label: "Bompton Playlist" },
];

export async function Nav() {
  const session = await auth();

  return (
    <header className="sticky top-0 z-50 border-b border-spotify-border bg-spotify-base/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-extrabold tracking-tight">
          <span className="inline-block h-3 w-3 rounded-full bg-spotify-green" />
          <span className="text-lg">Bompton</span>
        </Link>
        <div className="flex items-center gap-6">
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
          {session?.user ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-spotify-subtext sm:inline">
                {session.user.name ?? session.user.email}
              </span>
              <SignOutButton />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
