import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { CREW_TIME_ZONE } from "@/lib/bompton";
import { loadCrew } from "@/lib/crew";
import { FRIDAY_REMINDER_PERSONA_KEYS } from "@/lib/friday-reminder-email";
import { LATE_ADD_PERSONA_KEYS } from "@/lib/late-add-email";
import {
  loadFridayPersonaHistory,
  loadLateAddPersonaHistory,
  rotationQueue,
  type QueuedPersona,
} from "@/lib/persona-rotation";
import {
  CrewExportLinkButton,
  InitListeningSnapshotButton,
} from "./troubleshooting-buttons";

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

// How many upcoming personas to list per email. Enough to see a freshly
// added batch sitting at the front of the queue.
const UP_NEXT_COUNT = 8;

type EmailRotation = { email: string; queue: QueuedPersona[] };

async function loadEmailRotations(): Promise<
  { ok: true; rotations: EmailRotation[] } | { ok: false; error: string }
> {
  try {
    const crew = await loadCrew();
    const [friday, lateAdd] = await Promise.all([
      loadFridayPersonaHistory(),
      loadLateAddPersonaHistory(crew),
    ]);
    return {
      ok: true,
      rotations: [
        {
          email: "Friday reminder",
          queue: rotationQueue(FRIDAY_REMINDER_PERSONA_KEYS, friday),
        },
        {
          email: "Late-add roast",
          queue: rotationQueue(LATE_ADD_PERSONA_KEYS, lateAdd),
        },
      ],
    };
  } catch (error) {
    const message =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error("[troubleshooting.email-rotation.failed]", { message });
    return {
      ok: false,
      error: `Couldn't read the send history — ${message}. If it says a table "does not exist", FridayReminderNotification or LateAddNotification was never initialized in this database; otherwise check DATABASE_URL.`,
    };
  }
}

function formatSentDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: CREW_TIME_ZONE,
  });
}

export default async function TroubleshootingPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const emailRotations = await loadEmailRotations();

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

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Email rotation</h2>
        <p className="max-w-3xl text-sm text-spotify-subtext">
          Which persona each email sends next. One that has never been sent
          goes ahead of any that has, so a newly added batch is used straight
          away; after that it&apos;s whichever has waited longest. A Friday
          with a pinned one-off sends that instead and the queue waits a week.
        </p>
        {emailRotations.ok ? (
          <div className="grid gap-6 sm:grid-cols-2">
            {emailRotations.rotations.map(({ email, queue }) => {
              const neverSent = queue.filter((p) => p.lastSentAt === null);
              return (
                <div key={email} className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{email}</h3>
                  <p className="text-xs text-spotify-subtext">
                    {queue.length} personas ·{" "}
                    {neverSent.length === 0
                      ? "all sent at least once, so every send is now a repeat"
                      : `${neverSent.length} never sent`}
                  </p>
                  <ol className="list-decimal pl-5 text-sm">
                    {queue.slice(0, UP_NEXT_COUNT).map((p) => (
                      <li key={p.key}>
                        <code>{p.key}</code>{" "}
                        <span className="text-xs text-spotify-subtext">
                          {p.lastSentAt === null
                            ? "never sent"
                            : `last sent ${formatSentDate(p.lastSentAt)}`}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-xs text-red-300">
            {emailRotations.error}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Crew data export</h2>
        <p className="max-w-3xl text-sm text-spotify-subtext">
          Everything the app has on the crew&apos;s listening as one JSON
          file: every Bompton add, each member&apos;s archived plays and daily
          Spotify snapshots (top tracks and artists, saved library, playlists),
          and the reminder emails sent so far. It&apos;s the source material
          for writing new reminder personas. No emails or tokens are included.
          The link works without signing in for 24 hours, so it can be pasted
          to whoever is writing them.
        </p>
        <CrewExportLinkButton />
      </section>
    </section>
  );
}
