import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { TestPlaylistForm } from "./form";

// Temporary diagnostic page to validate whether the authed user's OAuth token
// can read a playlist's items under Spotify's Feb-2026 Dev-Mode rules. Drop
// the whole app/test-playlist-sync directory once the sync-as-owner plan is
// validated and implemented server-side.

export const dynamic = "force-dynamic";
export const metadata = { title: "Test playlist sync · Bompton" };

export default async function TestPlaylistSyncPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-spotify-subtext">
          Temporary diagnostic
        </p>
        <h1 className="text-3xl font-bold">Test playlist sync</h1>
        <p className="text-sm text-spotify-subtext">
          Paste a Spotify playlist URL, URI, or id that <em>you own</em>. This page will
          probe three endpoints with your refreshed OAuth token and show what each returns.
          Goal: confirm that running sync as a playlist owner reads tracks successfully
          under the Feb-2026 Dev-Mode rules — before we pivot the Bompton sync to use
          Evan&apos;s token server-side.
        </p>
        <p className="text-xs text-spotify-subtext">
          Signed in as{" "}
          <span className="text-spotify-text">
            {session.user.name ?? session.user.email ?? session.user.id}
          </span>
          . No data is written; read-only probe.
        </p>
        <Link href="/" className="text-xs text-spotify-green hover:underline">
          ← back to home
        </Link>
      </header>

      <TestPlaylistForm />
    </main>
  );
}
