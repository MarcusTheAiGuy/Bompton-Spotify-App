import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { InitListeningSnapshotButton } from "./troubleshooting-buttons";

export const dynamic = "force-dynamic";

// /troubleshooting is the catch-all surface for diagnostic and testing
// affordances on this app.
//
// The operational buttons (reset sync state, reset artist cache, and the
// one-shot DDL inits for new Prisma tables) used to live here but were
// removed once every table had been initialized — they were one-shot
// helpers and didn't need to linger. The server actions backing them
// still exist in ./actions.ts and the button components in
// ./troubleshooting-buttons.tsx, so re-adding any of them is just a
// matter of dropping the component back into this page.
//
// New temporary diagnostics, ad-hoc test buttons, and one-shot operational
// utilities should land here. Anything user-facing for normal usage belongs
// on /dashboard or /bompton-playlist instead.

export default async function TroubleshootingPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <section className="flex flex-col gap-10 py-6">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-spotify-subtext">
          Internal
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight">
          Troubleshooting &amp; testing
        </h1>
        <p className="max-w-3xl text-sm text-spotify-subtext">
          Diagnostic and testing surface for the Bompton app. Per-playlist
          sync state, one-shot DDL for new Prisma tables, and a reset button
          for when stored playlist data has gone bad. Drop ad-hoc test
          buttons and temporary diagnostics here so they have a stable home.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Listening archive</h2>
        <p className="max-w-3xl text-sm text-spotify-subtext">
          One-shot DDL for the <code>ListeningSnapshot</code> table that backs
          the daily listening archive (top tracks/artists, saved library, and
          followed artists snapshotted once per UTC day per crew member). Click
          once after deploy; then snapshots accrue on every dashboard visit and
          on the daily-sync cron.
        </p>
        <InitListeningSnapshotButton />
      </section>
    </section>
  );
}
