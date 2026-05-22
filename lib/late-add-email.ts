import type { CrewMember } from "@/lib/bompton";
import { displayCrewName } from "@/lib/spotify-user-names";

const RESEND_API = "https://api.resend.com/emails";

export class LateAddEmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LateAddEmailConfigError";
  }
}

export class LateAddEmailSendError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
    this.name = "LateAddEmailSendError";
  }
}

export type LateAddEmailInput = {
  offender: CrewMember;
  offenderEmail: string;
  crew: CrewMember[]; // every crew member, including the offender
  weeksBehind: number;
  missedFridays: Date[];
  // For composing standings copy. One entry per crew member, including
  // the offender themselves. Sorted oldest miss first by caller.
  standings: { member: CrewMember; missedCount: number }[];
  bomptonYear: string;
  playlistUrl: string | null;
};

export type LateAddEmailResult = {
  ok: boolean;
  resendId: string | null;
  subject: string;
  ccEmails: string[];
  error?: { name: string; message: string };
};

// Sends one roast email via Resend's /emails endpoint. CCs every other
// crew member with a known email. Throws LateAddEmailConfigError when
// RESEND_API_KEY / RESEND_FROM_EMAIL are missing so the caller's
// error message names exactly what to fix.
export async function sendLateAddEmail(
  input: LateAddEmailInput,
): Promise<LateAddEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new LateAddEmailConfigError(
      "RESEND_API_KEY env var is not set on the server. Add it in Vercel/wherever this is deployed, then redeploy. Get the key from https://resend.com/api-keys.",
    );
  }
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) {
    throw new LateAddEmailConfigError(
      "RESEND_FROM_EMAIL env var is not set on the server. Set it to a verified sender on your Resend account (e.g. bompton@yourdomain.com). The domain has to be verified at https://resend.com/domains first.",
    );
  }

  const ccEmails = input.crew
    .filter((m) => m.id !== input.offender.id)
    .map((m) => m.email)
    .filter((e): e is string => typeof e === "string" && e.length > 0);

  const subject = composeSubject(input);
  const text = composePlainText(input);
  const html = composeHtml(input);

  const response = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [input.offenderEmail],
      cc: ccEmails,
      subject,
      text,
      html,
      // Reply-to set to the crew so a "stop emailing me" reply hits
      // everyone with context. If you want a single owner, override
      // by adding a RESEND_REPLY_TO env var and reading it here.
      reply_to: ccEmails.length > 0 ? ccEmails : undefined,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new LateAddEmailSendError(
      `Resend rejected the email (HTTP ${response.status}): ${body.slice(0, 500)}. Common fixes: verify the sender domain at https://resend.com/domains, re-check RESEND_API_KEY isn't revoked, confirm RESEND_FROM_EMAIL matches a verified address.`,
      response.status,
      body,
    );
  }

  const data = (await response.json().catch(() => ({}))) as {
    id?: string;
  };

  return {
    ok: true,
    resendId: data.id ?? null,
    subject,
    ccEmails,
  };
}

// ---------------------------------------------------------------------------
// Email composition. Roast tone (per crew choice), Bompton-flavored.
// ---------------------------------------------------------------------------

function composeSubject(input: LateAddEmailInput): string {
  const name = displayCrewName(input.offender);
  if (input.weeksBehind === 1) {
    return `${name}, where's your Bompton song? (1 Friday missed)`;
  }
  return `${name} is ${input.weeksBehind} Fridays behind on Bompton`;
}

function composePlainText(input: LateAddEmailInput): string {
  const name = displayCrewName(input.offender);
  const lines: string[] = [];
  lines.push(`Look who fell behind.`);
  lines.push("");
  lines.push(
    `${name}, you've ghosted ${input.weeksBehind} Friday${
      input.weeksBehind === 1 ? "" : "s"
    } on Bompton ${input.bomptonYear}. The other three are CC'd on this email so they can see exactly how many weeks you're in arrears.`,
  );
  lines.push("");
  lines.push("Missed Fridays:");
  for (const f of input.missedFridays) {
    lines.push(`  - ${formatFriday(f)}`);
  }
  lines.push("");
  lines.push("Current standings:");
  for (const row of standingsSorted(input.standings)) {
    const tag =
      row.member.id === input.offender.id
        ? " <-- this email is about you"
        : row.missedCount === 0
          ? " (caught up)"
          : "";
    lines.push(
      `  - ${displayCrewName(row.member)}: ${row.missedCount} missed${tag}`,
    );
  }
  lines.push("");
  if (input.playlistUrl) {
    lines.push(`Fix it: ${input.playlistUrl}`);
  } else {
    lines.push(
      "Fix it: open your Spotify, find the Bompton playlist for this season, add a song.",
    );
  }
  lines.push("");
  lines.push(
    "This email was auto-generated because someone opened the Bompton dashboard. You'll get one more every 24 hours until you actually add a song. Reply-all to defend yourself, your crewmates are watching.",
  );
  return lines.join("\n");
}

function composeHtml(input: LateAddEmailInput): string {
  const name = displayCrewName(input.offender);
  const missedItems = input.missedFridays
    .map((f) => `<li>${escapeHtml(formatFriday(f))}</li>`)
    .join("");
  const standingsItems = standingsSorted(input.standings)
    .map((row) => {
      const isOffender = row.member.id === input.offender.id;
      const label = displayCrewName(row.member);
      const tag = isOffender
        ? ` &mdash; <strong style="color:#ef4444">that's you</strong>`
        : row.missedCount === 0
          ? ` &mdash; <span style="color:#1DB954">caught up</span>`
          : "";
      return `<li>${escapeHtml(label)}: ${row.missedCount} missed${tag}</li>`;
    })
    .join("");
  const playlistLink = input.playlistUrl
    ? `<p><a href="${escapeHtml(input.playlistUrl)}" style="display:inline-block;background:#1DB954;color:#000;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open the Bompton ${escapeHtml(input.bomptonYear)} playlist</a></p>`
    : `<p style="color:#a3a3a3">No playlist link on file. Find it in your Spotify library yourself.</p>`;

  return `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#121212;color:#fff;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#181818;border-radius:12px;padding:24px;border:1px solid #282828">
      <p style="text-transform:uppercase;letter-spacing:.2em;font-size:11px;color:#a3a3a3;margin:0 0 6px">Bompton accountability bot</p>
      <h1 style="margin:0 0 12px;font-size:24px">Look who fell behind.</h1>
      <p>${escapeHtml(name)}, you've ghosted <strong>${input.weeksBehind} Friday${input.weeksBehind === 1 ? "" : "s"}</strong> on Bompton ${escapeHtml(input.bomptonYear)}. The other three are CC'd so they can see exactly how many weeks you're in arrears.</p>
      <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.15em;color:#a3a3a3;margin-top:24px">Missed Fridays</h2>
      <ul style="margin:8px 0 0;padding-left:20px">${missedItems}</ul>
      <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.15em;color:#a3a3a3;margin-top:24px">Current standings</h2>
      <ul style="margin:8px 0 0;padding-left:20px">${standingsItems}</ul>
      <div style="margin-top:24px">${playlistLink}</div>
      <p style="margin-top:24px;color:#a3a3a3;font-size:12px">This email was auto-generated because someone opened the Bompton dashboard. You'll get one more every 24 hours until you actually add a song. Reply-all to defend yourself &mdash; your crewmates are watching.</p>
    </div>
  </body>
</html>`;
}

function standingsSorted(
  standings: LateAddEmailInput["standings"],
): LateAddEmailInput["standings"] {
  return [...standings].sort((a, b) => {
    if (a.missedCount !== b.missedCount) return a.missedCount - b.missedCount;
    return displayCrewName(a.member).localeCompare(displayCrewName(b.member));
  });
}

function formatFriday(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
