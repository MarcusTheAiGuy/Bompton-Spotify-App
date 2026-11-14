import { prisma } from "@/lib/prisma";
import type { CrewMember } from "@/lib/bompton";
import { lateAddPersonaKeysForSubject } from "@/lib/late-add-email";

// Which persona an email list sends next.
//
// A persona that has never gone out beats one that has, so a batch appended
// to a list is used straight away — even when the list had already wrapped
// and was partway through repeating its old ones. Once every persona has gone
// out, the one that has waited longest goes next, which is an ordinary
// round-robin.
//
// Both lists work out their place from what was actually sent rather than
// from a count of sends, so adding, removing or reordering personas never
// throws the rotation off.

// Persona key -> time (ms) of its most recent successful send.
export type PersonaHistory = Map<string, number>;

export function nextPersonaIndex(
  keys: readonly string[],
  history: ReadonlyMap<string, number>,
): number {
  let longestWaiting = 0;
  let longestWaitingSince = Infinity;
  for (let i = 0; i < keys.length; i++) {
    const lastSentAt = history.get(keys[i]);
    if (lastSentAt === undefined) return i;
    if (lastSentAt < longestWaitingSince) {
      longestWaiting = i;
      longestWaitingSince = lastSentAt;
    }
  }
  return longestWaiting;
}

export type QueuedPersona = { key: string; lastSentAt: number | null };

// Every persona in the order it will go out from here, assuming each send
// succeeds. `lastSentAt` is null for one that has never been sent.
export function rotationQueue(
  keys: readonly string[],
  history: ReadonlyMap<string, number>,
): QueuedPersona[] {
  const simulated = new Map(history);
  let clock = Math.max(Date.now(), ...simulated.values());
  const queue: QueuedPersona[] = [];
  while (queue.length < keys.length) {
    const key = keys[nextPersonaIndex(keys, simulated)];
    queue.push({ key, lastSentAt: history.get(key) ?? null });
    simulated.set(key, ++clock);
  }
  return queue;
}

export async function loadFridayPersonaHistory(): Promise<PersonaHistory> {
  const rows = await prisma.fridayReminderNotification.groupBy({
    by: ["personaKey"],
    where: { resendId: { not: null } },
    _max: { sentAt: true },
  });
  const history: PersonaHistory = new Map();
  for (const row of rows) {
    if (row._max.sentAt) history.set(row.personaKey, row._max.sentAt.getTime());
  }
  return history;
}

// Far more than one lap of the list, so a persona missing from this window
// really is one that hasn't been sent.
const LATE_ADD_HISTORY_ROWS = 500;

// LateAddNotification predates the roast rotation and has no personaKey
// column, so which roast a row used is read back from its subject line (see
// lateAddPersonaKeysForSubject). A row whose subject matches nothing — the
// pre-rotation template, or a subject that has since been reworded — is
// skipped, which at worst lets one old roast come round early.
export async function loadLateAddPersonaHistory(
  crew: CrewMember[],
): Promise<PersonaHistory> {
  const rows = await prisma.lateAddNotification.findMany({
    where: { resendId: { not: null } },
    select: {
      userId: true,
      weeksBehind: true,
      bomptonYear: true,
      emailSubject: true,
      sentAt: true,
    },
    orderBy: { sentAt: "desc" },
    take: LATE_ADD_HISTORY_ROWS,
  });
  const history: PersonaHistory = new Map();
  for (const row of rows) {
    const offender = crew.find((m) => m.id === row.userId);
    if (!offender) continue;
    const keys = lateAddPersonaKeysForSubject(row.emailSubject, {
      offender,
      weeksBehind: row.weeksBehind,
      bomptonYear: row.bomptonYear,
    });
    // Rows arrive newest first, so the first hit for a key is its latest send.
    for (const key of keys) {
      if (!history.has(key)) history.set(key, row.sentAt.getTime());
    }
  }
  return history;
}
