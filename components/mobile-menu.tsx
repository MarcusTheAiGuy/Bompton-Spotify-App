"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLink = { href: string; label: string };

export function MobileMenu({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close on route change so tapping a link doesn't leave the
  // overlay hanging on the destination page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="sm:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-spotify-border text-spotify-text transition hover:bg-spotify-highlight"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {open ? (
            <>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </>
          ) : (
            <>
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </>
          )}
        </svg>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 border-b border-spotify-border bg-spotify-base/95 shadow-xl backdrop-blur">
          <nav className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-6 py-3">
            {links.map((link) => {
              const active =
                pathname === link.href ||
                pathname?.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded px-3 py-2 text-sm font-semibold transition ${
                    active
                      ? "bg-spotify-highlight text-spotify-text"
                      : "text-spotify-subtext hover:bg-spotify-highlight/60 hover:text-spotify-text"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
