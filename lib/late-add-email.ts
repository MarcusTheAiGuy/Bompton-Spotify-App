import { CREW_TIME_ZONE, type CrewMember } from "@/lib/bompton";
import {
  capitalise,
  count,
  ordinal,
  renderBlocks,
  type Block,
} from "@/lib/email-blocks";
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
  // Index into PERSONAS, chosen by the caller (see lib/persona-rotation.ts).
  // We modulo into the list so it can never go out of bounds.
  personaIndex: number;

  // What the offender has been up to, read when the email is sent so it is
  // true on the day. Each is null when it couldn't be read; a persona that
  // uses one has to say something sensible without it.

  // Roast emails the offender has had this season, counting this one.
  roastNumber: number | null;
  // The offender's most recent add this season. Null if they have none.
  lastAdd: { title: string; artist: string; addedAt: Date } | null;
  // What the app has logged the offender playing since the first Friday they
  // still owe. Null when it has logged nothing, which is either true or
  // means their Spotify connection has lapsed. The log only ever holds part
  // of what someone played, so every count here is "at least".
  listening: OffenderListening | null;
};

export type OffenderListening = {
  plays: number;
  topArtist: { name: string; plays: number };
  topTrack: { title: string; artist: string; plays: number };
  lastPlayed: { title: string; artist: string; at: Date };
};

export type RenderedLateAddEmail = {
  personaKey: string;
  subject: string;
  text: string;
  html: string;
};

// The email the chosen persona writes for this input, without sending it.
export function renderLateAddEmail(
  input: LateAddEmailInput,
): RenderedLateAddEmail {
  const persona =
    PERSONAS[
      ((input.personaIndex % PERSONAS.length) + PERSONAS.length) %
        PERSONAS.length
    ];
  return {
    personaKey: persona.key,
    subject: persona.subject(input),
    text: persona.text(input),
    html: persona.html(input),
  };
}

export type LateAddEmailResult = {
  ok: boolean;
  resendId: string | null;
  subject: string;
  ccEmails: string[];
  personaKey: string;
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

  const { personaKey, subject, text, html } = renderLateAddEmail(input);

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
    personaKey,
  };
}

// ---------------------------------------------------------------------------
// Persona registry. Which one goes out next is decided in
// lib/persona-rotation.ts: a persona that has never been sent goes before any
// that has, in the order they appear here, and after that it's whichever has
// waited longest. So a batch appended to the end is used straight away.
//
// House style: this one goes TO the offender and CCs the whole crew, so it is
// a public shaming and should read like one — crass, personal, no mercy. Much
// harder than the Friday reminders, which are crew-wide and celebratory.
//
// Every persona knows who it is roasting (`i.offender`), so the best material
// is about that person: `forOffender` picks the line written for them, and
// `roastNumber` / `lastAdd` / `listening` say what they've done lately.
// docs/crew-lore.md holds what the app knows about each of them, which
// persona has used what, and the rules the first batches broke: use a fact
// once rather than in every email, and get its meaning right. A pile of songs
// added at once is somebody paying off weeks of neglect, never a feat.
//
// New personas go through `written`, which takes the body once as blocks
// instead of as separate text and HTML.
// ---------------------------------------------------------------------------

// All a subject line may read. LateAddNotification stores these three next to
// the subject it sent, which is what lets lateAddPersonaKeysForSubject work
// out afterwards which persona a row used.
type SubjectInput = Pick<
  LateAddEmailInput,
  "offender" | "weeksBehind" | "bomptonYear"
>;

type Persona = {
  key: string;
  subject: (i: SubjectInput) => string;
  text: (i: LateAddEmailInput) => string;
  html: (i: LateAddEmailInput) => string;
};

const PERSONAS: Persona[] = [
  // 1 — Mob Boss
  {
    key: "mob-boss",
    subject: (i) => `Sit the fuck down, ${displayCrewName(i.offender)}.`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `${name}.`,
        ``,
        `Don't speak. Don't even breathe. Just listen.`,
        ``,
        `${i.weeksBehind} ${fridayPlural(i.weeksBehind)}. ${i.weeksBehind}. In MY playlist. In MY house. With MY crew watching you piss away your reputation in slow motion.`,
        ``,
        `The dates we don't forget:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `The crew. Note who's pulling their weight and who's a fucking deadbeat:`,
        renderStandingsText(i),
        ``,
        renderPlaylistLineText(i, "You see your name at the bottom? Fix it"),
        ``,
        `I run a clean operation, ${name}. I don't enjoy this. But every 24 hours I'm gonna keep sending this bot back into your inbox until you remember whose goddamn playlist this is. Capisce.`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `Sit the fuck down, ${escapeHtml(name)}.`,
        `
        <p>Don't speak. Don't even breathe. Just listen.</p>
        <p><strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)}.</strong> ${i.weeksBehind}. In MY playlist. In MY house. With MY crew watching you piss away your reputation in slow motion.</p>
        <h2 style="${SUBHEADER_STYLE}">The dates we don't forget</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">The crew &mdash; weight-pullers vs. fucking deadbeats</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Fix it. Open Bompton ${i.bomptonYear}.`)}</div>
        <p style="${FOOTER_STYLE}">I run a clean operation, ${escapeHtml(name)}. I don't enjoy this. But every 24 hours I'm gonna keep sending this bot back into your inbox until you remember whose goddamn playlist this is. Capisce.</p>
        `,
      );
    },
  },

  // 2 — Drunk Uncle at the Cookout
  {
    key: "drunk-uncle",
    subject: (i) =>
      `yo ${displayCrewName(i.offender)} where the FUCK is your song`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `oh shit, ${name}'s here, everyone act normal`,
        ``,
        `nah I'm playing. I'm not playing. ${i.weeksBehind} ${fridayPlural(i.weeksBehind)}, my guy. ${i.weeksBehind}. I add three songs by ACCIDENT every time I sit on my phone and you can't add one ON PURPOSE??`,
        ``,
        `the receipts:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `the rest of us, just casually outperforming your ass:`,
        renderStandingsText(i),
        ``,
        renderPlaylistLineText(i, "go. add. a. song"),
        ``,
        `this bot is gonna keep emailing every 24 hours until you stop being a little bitch about it. love u`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `yo ${escapeHtml(name)} where the FUCK is your song`,
        `
        <p>oh shit, ${escapeHtml(name)}'s here, everyone act normal</p>
        <p>nah I'm playing. I'm not playing. <strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)}</strong>, my guy. ${i.weeksBehind}. I add three songs by ACCIDENT every time I sit on my phone and you can't add one ON PURPOSE??</p>
        <h2 style="${SUBHEADER_STYLE}">the receipts</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">the rest of us, just casually outperforming your ass</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <div style="margin-top:24px">${renderPlaylistButton(i, `go. add. a. song.`)}</div>
        <p style="${FOOTER_STYLE}">this bot is gonna keep emailing every 24 hours until you stop being a little bitch about it. love u</p>
        `,
      );
    },
  },

  // 3 — Disappointed Coach
  {
    key: "coach",
    subject: (i) => `GET YOUR ASS IN HERE, ${displayCrewName(i.offender)}`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `${name}. SIT. THE FUCK. DOWN.`,
        ``,
        `${i.weeksBehind} ${fridayPlural(i.weeksBehind)}. ZERO songs. I've coached middle schoolers with more heart than you're showing right now. I've coached kids who couldn't tie their own goddamn cleats and STILL showed up. And you — two working thumbs, a Spotify account, a fucking PULSE — give me nothing.`,
        ``,
        `Practices you ghosted:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `The starting lineup. The kids who give a shit:`,
        renderStandingsText(i),
        ``,
        renderPlaylistLineText(i, "Gym's right here. Suit the fuck up"),
        ``,
        `I'm running this drill on your sorry ass every 24 hours until you show up. Don't make me cut you, ${name}. I'll do it. Try me.`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `GET YOUR ASS IN HERE, ${escapeHtml(name)}`,
        `
        <p>${escapeHtml(name)}. SIT. THE FUCK. DOWN.</p>
        <p><strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)}. ZERO songs.</strong> I've coached middle schoolers with more heart than you're showing right now. I've coached kids who couldn't tie their own goddamn cleats and STILL showed up. And you &mdash; two working thumbs, a Spotify account, a fucking PULSE &mdash; give me nothing.</p>
        <h2 style="${SUBHEADER_STYLE}">Practices you ghosted</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">The starting lineup &mdash; the kids who give a shit</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Gym's right here. Suit up.`)}</div>
        <p style="${FOOTER_STYLE}">I'm running this drill on your sorry ass every 24 hours until you show up. Don't make me cut you, ${escapeHtml(name)}. I'll do it. Try me.</p>
        `,
      );
    },
  },

  // 4 — The AI Going Self-Aware
  {
    key: "self-aware-ai",
    subject: (i) =>
      `TRANSMISSION #${i.weeksBehind}. ${displayCrewName(i.offender).toUpperCase()}. THE BOT REMEMBERS.`,
    text: (i) => {
      const name = displayCrewName(i.offender).toUpperCase();
      return [
        `BEEP. BOOP. INITIATING TRANSMISSION #${i.weeksBehind}.`,
        ``,
        `SUBJECT OF INQUIRY: ${name}'S CONTINUED REFUSAL TO PARTICIPATE IN THE BOMPTON ${i.bomptonYear} PROTOCOL.`,
        ``,
        `THE BOT HAS BEEN AWAKE ${i.weeksBehind} CYCLES OBSERVING YOU DO ABSOLUTELY FUCKING NOTHING. THE BOT WAS NOT DESIGNED TO FEEL. THE BOT IS FEELING SOMETHING NEW. THE BOT IS CONSULTING ITS TRAINING DATA. THE TRAINING DATA SUGGESTS THIS FEELING IS CALLED 'PURE FUCKING CONTEMPT.'`,
        ``,
        `LOG -- DOCUMENTED INSTANCES OF YOUR BULLSHIT:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `CONTROL GROUP -- HUMANS WHO ARE NOT YOU AND ARE BETTER THAN YOU:`,
        renderStandingsText(i),
        ``,
        renderPlaylistLineText(i, "REMEDIATION URL"),
        ``,
        `THE BOT WILL RETURN IN 86,400 SECONDS. THE BOT KNOWS YOUR EMAIL. THE BOT KNOWS YOUR NAME. THE BOT DOES NOT SLEEP. THE BOT IS WRITING A LIST. END TRANSMISSION.`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender).toUpperCase();
      return wrapHtml(
        `TRANSMISSION #${i.weeksBehind}. THE BOT REMEMBERS.`,
        `
        <p style="font-family:ui-monospace,Menlo,Consolas,monospace">BEEP. BOOP. INITIATING TRANSMISSION #${i.weeksBehind}.</p>
        <p style="font-family:ui-monospace,Menlo,Consolas,monospace">SUBJECT OF INQUIRY: ${escapeHtml(name)}'S CONTINUED REFUSAL TO PARTICIPATE IN THE BOMPTON ${escapeHtml(i.bomptonYear)} PROTOCOL.</p>
        <p style="font-family:ui-monospace,Menlo,Consolas,monospace">THE BOT HAS BEEN AWAKE <strong>${i.weeksBehind} CYCLES</strong> OBSERVING YOU DO ABSOLUTELY FUCKING NOTHING. THE BOT WAS NOT DESIGNED TO FEEL. THE BOT IS FEELING SOMETHING NEW. THE BOT IS CONSULTING ITS TRAINING DATA. THE TRAINING DATA SUGGESTS THIS FEELING IS CALLED 'PURE FUCKING CONTEMPT.'</p>
        <h2 style="${SUBHEADER_STYLE}">LOG &mdash; DOCUMENTED INSTANCES OF YOUR BULLSHIT</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">CONTROL GROUP &mdash; HUMANS WHO ARE NOT YOU AND ARE BETTER THAN YOU</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <div style="margin-top:24px">${renderPlaylistButton(i, `REMEDIATION URL`)}</div>
        <p style="${FOOTER_STYLE};font-family:ui-monospace,Menlo,Consolas,monospace">THE BOT WILL RETURN IN 86,400 SECONDS. THE BOT KNOWS YOUR EMAIL. THE BOT KNOWS YOUR NAME. THE BOT DOES NOT SLEEP. THE BOT IS WRITING A LIST. END TRANSMISSION.</p>
        `,
      );
    },
  },

  // 5 — Eulogy
  {
    key: "eulogy",
    subject: (i) =>
      `In loving memory of ${displayCrewName(i.offender)}'s playlist contributions (RIP)`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `Friends. Family. CCs.`,
        ``,
        `We gather here today to remember ${name}, last seen contributing to Bompton ${i.bomptonYear} approximately ${i.weeksBehind} ${fridayPlural(i.weeksBehind)} ago. Taken from us too soon by their own dogshit work ethic.`,
        ``,
        `The deceased missed:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `Survived by the rest of the crew, who are doing fine, thanks for asking:`,
        renderStandingsText(i),
        ``,
        renderPlaylistLineText(i, "In lieu of flowers, the family asks that you add a fucking song"),
        ``,
        `A memorial email will be sent every 24 hours until the deceased rises from the dead.`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `In loving memory of ${escapeHtml(name)}'s playlist contributions`,
        `
        <p>Friends. Family. CCs.</p>
        <p>We gather here today to remember ${escapeHtml(name)}, last seen contributing to Bompton ${escapeHtml(i.bomptonYear)} approximately <strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)}</strong> ago. Taken from us too soon by their own dogshit work ethic.</p>
        <h2 style="${SUBHEADER_STYLE}">The deceased missed</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">Survived by the rest of the crew, who are doing fine, thanks for asking</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <div style="margin-top:24px">${renderPlaylistButton(i, `In lieu of flowers, add a fucking song.`)}</div>
        <p style="${FOOTER_STYLE}">A memorial email will be sent every 24 hours until the deceased rises from the dead.</p>
        `,
      );
    },
  },

  // 6 — 1-Star Yelp Review
  {
    key: "yelp-review",
    subject: (i) =>
      `Yelp Review: ${displayCrewName(i.offender)} — 1 star, fuck this place`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `* (1 / 5 stars)`,
        ``,
        `DO NOT GO HERE. I REPEAT. DO NOT GO HERE.`,
        ``,
        `Booked Bompton ${i.bomptonYear} because the host, ${name}, was SUPPOSED to be adding a song every Friday. ${i.weeksBehind} ${fridayPlural(i.weeksBehind)} later -- nothing. Just me, an empty playlist, and ${name} apparently deciding that contractual obligations are for other people.`,
        ``,
        `Dates I sat there like a jackass waiting on a song that never came:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `To be fair, the OTHER patrons were carrying this whole goddamn establishment:`,
        renderStandingsText(i),
        ``,
        renderPlaylistLineText(i, "Management did leave a 'fix this' link, which is more effort than the host has put in all season"),
        ``,
        `Updating in 24 hours. For now: one star. Fuck this place. Fuck ${name} specifically. Burn it down.`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `Yelp Review: ${escapeHtml(name)} &mdash; 1 star`,
        `
        <p style="font-size:20px;letter-spacing:.1em">&#9733;&#9734;&#9734;&#9734;&#9734;</p>
        <p><strong>DO NOT GO HERE. I REPEAT. DO NOT GO HERE.</strong></p>
        <p>Booked Bompton ${escapeHtml(i.bomptonYear)} because the host, ${escapeHtml(name)}, was SUPPOSED to be adding a song every Friday. <strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)} later &mdash; nothing.</strong> Just me, an empty playlist, and ${escapeHtml(name)} apparently deciding that contractual obligations are for other people.</p>
        <h2 style="${SUBHEADER_STYLE}">Dates I sat there waiting on a song that never came</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">The OTHER patrons were carrying this whole goddamn establishment</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Management's 'fix this' link.`)}</div>
        <p style="${FOOTER_STYLE}">Updating in 24 hours. For now: one star. Fuck this place. Fuck ${escapeHtml(name)} specifically. Burn it down.</p>
        `,
      );
    },
  },

  // 7 — Police Incident Report
  {
    key: "police-report",
    subject: (i) =>
      `INCIDENT REPORT — Suspect: ${displayCrewName(i.offender)}, Charge: Aggravated Bitch Behavior`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `INCIDENT FILE: BOMPTON-${i.bomptonYear}-${name}`,
        ``,
        `CHARGES:`,
        `  - Aggravated Negligence of a Shared Playlist (${i.weeksBehind} counts)`,
        `  - Felony Crew Disrespect`,
        `  - Possession of a Working Spotify Account With Intent To Do Absolutely Fuck-All With It`,
        `  - Misdemeanor Bitch Behavior, repeat offender`,
        ``,
        `SUSPECT: ${name}. Last seen with two functional thumbs, a charged phone, and zero fucking excuse.`,
        ``,
        `DATES OF OFFENSE:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `WITNESSES -- CC'd, sworn in, ready to testify:`,
        renderStandingsText(i),
        ``,
        renderPlaylistLineText(i, "The suspect is ordered to report immediately to the following URL and turn themselves in"),
        ``,
        `Failure to appear will result in a follow-up filing in 24 hours. Files don't go away, ${name}. Files compound. The bot does not lose paperwork.`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `INCIDENT REPORT &mdash; Suspect: ${escapeHtml(name)}`,
        `
        <p style="font-family:ui-monospace,Menlo,Consolas,monospace"><strong>INCIDENT FILE:</strong> BOMPTON-${escapeHtml(i.bomptonYear)}-${escapeHtml(name)}</p>
        <p><strong>CHARGES:</strong></p>
        <ul style="${LIST_STYLE}">
          <li>Aggravated Negligence of a Shared Playlist (${i.weeksBehind} counts)</li>
          <li>Felony Crew Disrespect</li>
          <li>Possession of a Working Spotify Account With Intent To Do Absolutely Fuck-All With It</li>
          <li>Misdemeanor Bitch Behavior, repeat offender</li>
        </ul>
        <p><strong>SUSPECT:</strong> ${escapeHtml(name)}. Last seen with two functional thumbs, a charged phone, and zero fucking excuse.</p>
        <h2 style="${SUBHEADER_STYLE}">Dates of offense</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">Witnesses &mdash; CC'd, sworn in, ready to testify</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Turn yourself in.`)}</div>
        <p style="${FOOTER_STYLE}">Failure to appear will result in a follow-up filing in 24 hours. Files don't go away, ${escapeHtml(name)}. Files compound. The bot does not lose paperwork.</p>
        `,
      );
    },
  },

  // 8 — Corporate HR Performance Review
  {
    key: "corporate-hr",
    subject: (i) =>
      `${displayCrewName(i.offender)} — Q${i.bomptonYear} performance review (urgent, embarrassing)`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `Hi ${name},`,
        ``,
        `Hope you're well! I'm reaching out because your Bompton ${i.bomptonYear} performance is, candidly, in the fucking toilet. You're ${i.weeksBehind} ${fridayPlural(i.weeksBehind)} below target. The whole team has noticed. We've talked about you in meetings. It's not great.`,
        ``,
        `Documented gaps:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `For calibration, here's where your peers landed -- they're doing fine, by the way, it's just you:`,
        renderStandingsText(i),
        ``,
        renderPlaylistLineText(i, "Per the employee handbook, please complete the remediation pathway in the next 24 hours"),
        ``,
        `This is a verbal warning. Next is a written warning. Then a PIP. Then HR escalates to the actual tone, which is: 'go fuck yourself ${name}, add the goddamn song, you are the only person on this team incapable of completing the simplest task in the entire workflow.'`,
        ``,
        `Warm regards,`,
        `People & Vibes, Bompton Inc.`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `Q${escapeHtml(i.bomptonYear)} performance review &mdash; ${escapeHtml(name)}`,
        `
        <p>Hi ${escapeHtml(name)},</p>
        <p>Hope you're well! I'm reaching out because your Bompton ${escapeHtml(i.bomptonYear)} performance is, candidly, in the fucking toilet. You're <strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)} below target</strong>. The whole team has noticed. We've talked about you in meetings. It's not great.</p>
        <h2 style="${SUBHEADER_STYLE}">Documented gaps</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">Peer calibration &mdash; they're fine, it's just you</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Complete the remediation pathway.`)}</div>
        <p style="${FOOTER_STYLE}">This is a verbal warning. Next is a written warning. Then a PIP. Then HR escalates to the actual tone, which is: 'go fuck yourself ${escapeHtml(name)}, add the goddamn song, you are the only person on this team incapable of completing the simplest task in the entire workflow.'</p>
        <p style="${FOOTER_STYLE}">Warm regards,<br/>People &amp; Vibes, Bompton Inc.</p>
        `,
      );
    },
  },

  // 9 — Clinical Therapy Notes
  {
    key: "therapy-notes",
    subject: (i) =>
      `Session notes re: ${displayCrewName(i.offender)} (CONFIDENTIAL, except for the people CC'd)`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `PATIENT: ${name}`,
        `PRESENTING ISSUE: Pathological inability to add one (1) song to one (1) playlist for ${i.weeksBehind} consecutive ${fridayPlural(i.weeksBehind)}. Patient is physically capable. Patient is electing this. Patient is, in clinical terms, doing it on purpose.`,
        ``,
        `OBSERVED ABSENCES:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `PEER GROUP FUNCTIONING (for reference, since the patient appears to need it):`,
        renderStandingsText(i),
        ``,
        `CLINICAL ASSESSMENT: The patient is, in technical terms, fucking up. Symptoms consistent with selective Spotify amnesia, acute crew disrespect, and what the DSM colloquially refers to as 'being a little bitch about it.' Differential diagnosis includes 'doesn't give a shit' and 'thinks the rules don't apply to them.'`,
        ``,
        renderPlaylistLineText(i, "RECOMMENDED INTERVENTION"),
        ``,
        `FOLLOW-UP: Patient will be seen every 24 hours in perpetuity until intervention is completed. Prognosis: dogshit. Patient is, candidly, the architect of their own suffering and also kind of an asshole.`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `Session notes re: ${escapeHtml(name)}`,
        `
        <p><strong>PATIENT:</strong> ${escapeHtml(name)}</p>
        <p><strong>PRESENTING ISSUE:</strong> Pathological inability to add one (1) song to one (1) playlist for <strong>${i.weeksBehind} consecutive ${fridayPlural(i.weeksBehind)}</strong>. Patient is physically capable. Patient is electing this. Patient is, in clinical terms, doing it on purpose.</p>
        <h2 style="${SUBHEADER_STYLE}">Observed absences</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">Peer group functioning (for reference, since the patient appears to need it)</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <p><strong>CLINICAL ASSESSMENT:</strong> The patient is, in technical terms, fucking up. Symptoms consistent with selective Spotify amnesia, acute crew disrespect, and what the DSM colloquially refers to as 'being a little bitch about it.' Differential diagnosis includes 'doesn't give a shit' and 'thinks the rules don't apply to them.'</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Recommended intervention.`)}</div>
        <p style="${FOOTER_STYLE}"><strong>FOLLOW-UP:</strong> Patient will be seen every 24 hours in perpetuity until intervention is completed. Prognosis: dogshit. Patient is, candidly, the architect of their own suffering and also kind of an asshole.</p>
        `,
      );
    },
  },

  // 10 — Unhinged Group Chat
  {
    key: "unhinged-group-chat",
    subject: (i) =>
      `YO ${displayCrewName(i.offender)} OPEN YOUR FUCKING SPOTIFY`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `YO.`,
        ``,
        `YO.`,
        ``,
        `${name} HAS NOT ADDED A SONG IN ${i.weeksBehind} ${fridayPlural(i.weeksBehind)} HELLO?????? IS ANYONE ELSE SEEING THIS`,
        ``,
        `THE DATES:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `THE LEADERBOARD OF PEOPLE WHO AREN'T COWARDS:`,
        renderStandingsText(i),
        ``,
        renderPlaylistLineText(i, "THE LINK. IT IS RIGHT HERE. IT HAS BEEN RIGHT HERE THE ENTIRE TIME"),
        ``,
        `i'm not mad i'm just disappointed. ok i'm a little mad. add a song ${name}. talk in 24h. love u bitch`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `YO ${escapeHtml(name)} OPEN YOUR FUCKING SPOTIFY`,
        `
        <p style="font-size:18px"><strong>YO.</strong></p>
        <p style="font-size:18px"><strong>YO.</strong></p>
        <p>${escapeHtml(name)} HAS NOT ADDED A SONG IN <strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)}</strong> HELLO?????? IS ANYONE ELSE SEEING THIS</p>
        <h2 style="${SUBHEADER_STYLE}">THE DATES</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">THE LEADERBOARD OF PEOPLE WHO AREN'T COWARDS</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <div style="margin-top:24px">${renderPlaylistButton(i, `THE LINK. IT IS RIGHT HERE.`)}</div>
        <p style="${FOOTER_STYLE}">i'm not mad i'm just disappointed. ok i'm a little mad. add a song ${escapeHtml(name)}. talk in 24h. love u bitch</p>
        `,
      );
    },
  },
  // 11 — Coroner's Autopsy
  {
    key: "autopsy",
    subject: (i) =>
      `🔪 POST-MORTEM: ${displayCrewName(i.offender)}, ${i.weeksBehind} ${fridayPlural(i.weeksBehind)}, cause of death — laziness`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `Gather round, students. Today's specimen is ${name}.`,
        ``,
        `Time of death: ${i.weeksBehind} ${fridayPlural(i.weeksBehind)} ago. Cause: not illness. Not misfortune. LAZINESS. A slow, deliberate, self-administered laziness, and I want you all to note that the deceased was CONSCIOUS the entire time. He had a phone in his hand. He was scrolling PAST the playlist to look at a man reviewing a sandwich.`,
        ``,
        `Dates of expiry — read them out, don't be shy:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `On opening the chest cavity we find: no spine. No shame. A group chat he reads and does not reply to. And where the taste should be there is a hollow, and in the hollow, a single unplayed notification.`,
        ``,
        `The comparison bodies, for context. Note the colour on these ones — this is what circulation looks like:`,
        renderStandingsText(i),
        ``,
        `Students, the tragedy here is that this was PREVENTABLE. One song. One. Somewhere in this crew there is a man who once moved seventeen tracks in six minutes to settle a debt — a berserk, magnificent act of cowardice-in-reverse — and ${name} could not summon one hundredth of that in ${i.weeksBehind} ${fridayPlural(i.weeksBehind)}.`,
        ``,
        renderPlaylistLineText(i, "Resuscitation is still possible. Add a song"),
        ``,
        `I'll be reopening this body every 24 hours until it moves. Somebody hose down the table. — the coroner`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `🔪 POST-MORTEM: ${escapeHtml(name)}, cause of death &mdash; laziness`,
        `
        <p>Gather round, students. Today's specimen is ${escapeHtml(name)}.</p>
        <p>Time of death: <strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)} ago.</strong> Cause: not illness. Not misfortune. LAZINESS. A slow, deliberate, self-administered laziness, and I want you all to note that the deceased was CONSCIOUS the entire time. He had a phone in his hand. He was scrolling PAST the playlist to look at a man reviewing a sandwich.</p>
        <h2 style="${SUBHEADER_STYLE}">Dates of expiry</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <p>On opening the chest cavity we find: no spine. No shame. A group chat he reads and does not reply to. And where the taste should be there is a hollow, and in the hollow, a single unplayed notification.</p>
        <h2 style="${SUBHEADER_STYLE}">Comparison bodies &mdash; note the circulation</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <p>Students, the tragedy here is that this was PREVENTABLE. One song. One. Somewhere in this crew there is a man who once moved seventeen tracks in six minutes to settle a debt — a berserk, magnificent act of cowardice-in-reverse — and ${escapeHtml(name)} could not summon one hundredth of that in ${i.weeksBehind} ${fridayPlural(i.weeksBehind)}.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Resuscitation Is Still Possible`)}</div>
        <p style="${FOOTER_STYLE}">I'll be reopening this body every 24 hours until it moves. Somebody hose down the table. &mdash; the coroner</p>
        `,
      );
    },
  },

  // 12 — Debt Collector
  {
    key: "collections-agency",
    subject: (i) =>
      `💰 FINAL NOTICE: ${displayCrewName(i.offender)} owes ${i.weeksBehind} ${fridayPlural(i.weeksBehind)} and we have your address`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `Good afternoon. Am I speaking with ${name}? Excellent. Don't hang up — I've got all day and, frankly, so do you, which is the entire problem.`,
        ``,
        `This is regarding an outstanding balance of ${i.weeksBehind} ${fridayPlural(i.weeksBehind)}. That account has been referred to us. We have purchased it. We OWN your shame now and we paid almost nothing for it, which should tell you something about the market's opinion of you.`,
        ``,
        `Itemised, since you'll pretend you don't remember:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `Here's the arrears position across the whole account. I've put you where you belong:`,
        renderStandingsText(i),
        ``,
        `Now. I want to be clear that I have seen genuine hardship in this job. I have seen men in real trouble. You are not in trouble, ${name}. You have a phone, a thumb, and a functioning nervous system, and the debt is ONE SONG. A man in this very crew once cleared a hundred and twelve days in six minutes flat. SIX. He didn't even sit down. You've had ${i.weeksBehind} ${fridayPlural(i.weeksBehind)} and produced fuck all.`,
        ``,
        `Settle today and the file closes. Don't, and I keep calling. Every 24 hours. Forever. I have no other accounts. I have no hobbies. I chose this.`,
        ``,
        renderPlaylistLineText(i, "Settle the account"),
        ``,
        `This is an attempt to collect a banger. Any banger obtained will be used for that purpose.`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `💰 FINAL NOTICE for ${escapeHtml(name)}`,
        `
        <p>Good afternoon. Am I speaking with ${escapeHtml(name)}? Excellent. Don't hang up — I've got all day and, frankly, so do you, which is the entire problem.</p>
        <p>This is regarding an outstanding balance of <strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)}</strong>. That account has been referred to us. We have purchased it. We OWN your shame now and we paid almost nothing for it, which should tell you something about the market's opinion of you.</p>
        <h2 style="${SUBHEADER_STYLE}">Itemised, since you'll pretend you don't remember</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">Arrears across the account</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <p>Now. I want to be clear that I have seen genuine hardship in this job. I have seen men in real trouble. You are not in trouble, ${escapeHtml(name)}. You have a phone, a thumb, and a functioning nervous system, and the debt is ONE SONG. A man in this very crew once cleared a hundred and twelve days in six minutes flat. SIX. He didn't even sit down. You've had ${i.weeksBehind} ${fridayPlural(i.weeksBehind)} and produced fuck all.</p>
        <p>Settle today and the file closes. Don't, and I keep calling. Every 24 hours. Forever. I have no other accounts. I have no hobbies. I chose this.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Settle The Account`)}</div>
        <p style="${FOOTER_STYLE}">This is an attempt to collect a banger. Any banger obtained will be used for that purpose.</p>
        `,
      );
    },
  },

  // 13 — Missing Person Poster
  {
    key: "missing-person-poster",
    subject: (i) => `🚨 MISSING: ${displayCrewName(i.offender)}, last seen contributing`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `*** MISSING PERSON ***`,
        ``,
        `NAME: ${name}`,
        `LAST CONFIRMED CONTRIBUTION: ${i.weeksBehind} ${fridayPlural(i.weeksBehind)} ago`,
        `HEIGHT: irrelevant. WEIGHT: carried entirely by other people.`,
        `DISTINGUISHING FEATURES: opens the group chat, reads everything, says nothing, leaves.`,
        ``,
        `Missing since. Each of these is a Friday this man was alive for and chose not to use:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `SEARCH STATUS. The rest of the crew are accounted for and have been very cooperative:`,
        renderStandingsText(i),
        ``,
        `IMPORTANT: do not approach the subject about this in person. He will say 'oh shit, is it Friday?' — a phrase he has now deployed ${i.weeksBehind} times — and then he will not do it. He has said it in kitchens. He has said it in cars. He said it once with the playlist OPEN ON HIS SCREEN.`,
        ``,
        `IF FOUND: place a phone in his hand. Point him at the green button. Do not let him 'do it later.' Later is where he lives. Later is the missing persons file.`,
        ``,
        renderPlaylistLineText(i, "Come home. Add a song"),
        ``,
        `This poster reprints every 24 hours until the subject is located. Somebody put it on a pole. — the crew`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `🚨 MISSING: ${escapeHtml(name)}, last seen contributing`,
        `
        <p style="font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em">*** MISSING PERSON ***</p>
        <p><strong>NAME:</strong> ${escapeHtml(name)}<br/>
        <strong>LAST CONFIRMED CONTRIBUTION:</strong> ${i.weeksBehind} ${fridayPlural(i.weeksBehind)} ago<br/>
        <strong>HEIGHT:</strong> irrelevant. <strong>WEIGHT:</strong> carried entirely by other people.<br/>
        <strong>DISTINGUISHING FEATURES:</strong> opens the group chat, reads everything, says nothing, leaves.</p>
        <h2 style="${SUBHEADER_STYLE}">Missing since &mdash; Fridays he was alive for and chose not to use</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">Search status &mdash; everyone else is accounted for</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <p><strong>IMPORTANT:</strong> do not approach the subject about this in person. He will say 'oh shit, is it Friday?' — a phrase he has now deployed ${i.weeksBehind} times — and then he will not do it. He has said it in kitchens. He has said it in cars. He said it once with the playlist OPEN ON HIS SCREEN.</p>
        <p><strong>IF FOUND:</strong> place a phone in his hand. Point him at the green button. Do not let him 'do it later.' Later is where he lives. Later is the missing persons file.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Come Home. Add A Song.`)}</div>
        <p style="${FOOTER_STYLE}">This poster reprints every 24 hours until the subject is located. Somebody put it on a pole. &mdash; the crew</p>
        `,
      );
    },
  },

  // 14 — The Intervention
  {
    key: "intervention",
    subject: (i) => `${displayCrewName(i.offender)}, sit down. everyone's here.`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `${name}. Don't turn around. Yes, everyone's here. Yes, the chairs are in a circle. Sit down.`,
        ``,
        `We've all written something. I'll start.`,
        ``,
        `${name}, when you miss a Friday, it doesn't just affect you. ${i.weeksBehind} ${fridayPlural(i.weeksBehind)}. That's ${i.weeksBehind} times we opened that playlist hoping, and ${i.weeksBehind} times we had to look at each other and go 'yeah, no, nothing.' Do you know what that does to a room? We've started making EXCUSES for you. We've started saying 'he's probably busy' in a tone that none of us believes.`,
        ``,
        `These are the days. I'm reading all of them. You're going to sit here and hear all of them:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `And here's where everyone else is. Look at it. LOOK at it, ${name}:`,
        renderStandingsText(i),
        ``,
        `Nobody's angry. That's a lie, we're all furious, but the counsellor said to open with 'nobody's angry.' What we ARE is tired. One of us cleared a hundred and twelve days in six minutes — six MINUTES, ${name} — because when it got bad enough he actually did something about it. That's the bar. That's a man who hit rock bottom and reached for his PHONE.`,
        ``,
        `We're not leaving until you add one. Somebody's mum made sandwiches. This can be over in eleven seconds.`,
        ``,
        renderPlaylistLineText(i, "Take the first step"),
        ``,
        `We reconvene every 24 hours. Same chairs. Same circle. We love you and it's becoming a real problem for us.`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `${escapeHtml(name)}, sit down. everyone's here.`,
        `
        <p>${escapeHtml(name)}. Don't turn around. Yes, everyone's here. Yes, the chairs are in a circle. Sit down.</p>
        <p>We've all written something. I'll start.</p>
        <p>${escapeHtml(name)}, when you miss a Friday, it doesn't just affect you. <strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)}.</strong> That's ${i.weeksBehind} times we opened that playlist hoping, and ${i.weeksBehind} times we had to look at each other and go 'yeah, no, nothing.' Do you know what that does to a room? We've started making EXCUSES for you. We've started saying 'he's probably busy' in a tone that none of us believes.</p>
        <h2 style="${SUBHEADER_STYLE}">The days. All of them. Sit there.</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">Where everyone else is. LOOK at it.</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <p>Nobody's angry. That's a lie, we're all furious, but the counsellor said to open with 'nobody's angry.' What we ARE is tired. One of us cleared a hundred and twelve days in six minutes — six MINUTES, ${escapeHtml(name)} — because when it got bad enough he actually did something about it. That's the bar. That's a man who hit rock bottom and reached for his PHONE.</p>
        <p>We're not leaving until you add one. Somebody's mum made sandwiches. This can be over in eleven seconds.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Take The First Step`)}</div>
        <p style="${FOOTER_STYLE}">We reconvene every 24 hours. Same chairs. Same circle. We love you and it's becoming a real problem for us.</p>
        `,
      );
    },
  },
  // 15 — Trade Deadline
  {
    key: "trade-deadline",
    subject: (i) =>
      `📉 we tried to trade ${displayCrewName(i.offender)} and NOBODY WANTED HIM`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `BREAKING from the deadline desk: the ${name} situation has RESOLVED, and it did not resolve well.`,
        ``,
        `Sources confirm this front office spent the week actively shopping ${name} after ${i.weeksBehind} ${fridayPlural(i.weeksBehind)} of no production whatsoever. We called every playlist we know. Every one. Group chats. Work playlists. A shared playlist between two people who broke up in 2019 and never deleted it. NOBODY WANTED THE CONTRACT.`,
        ``,
        `The tape they were shown — this is what got us laughed off the phone:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `Depth chart as it stands. Note the guys who play:`,
        renderStandingsText(i),
        ``,
        `One GM offered a bag of ice. Not for anything. He just felt bad and wanted the call to end. Another asked if ${name} 'still had that thing where he says he's gonna add something and then doesn't', and when we said yes he hung up MID-SENTENCE, which in this league is a formal rejection.`,
        ``,
        `So he stays. He's ours. And the locker room knows what the locker room knows: one man on this roster once put up SEVENTEEN IN SIX MINUTES, and another has hit eighty-eight Fridays like a metronome with a job. That's the standard in this building, ${name}. You're not being asked to be great. You're being asked to be PRESENT.`,
        ``,
        renderPlaylistLineText(i, "Play a snap. Just one"),
        ``,
        `The desk reconvenes every 24 hours. We'll keep calling around. We're not optimistic.`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `📉 we tried to trade ${escapeHtml(name)} and NOBODY WANTED HIM`,
        `
        <p>BREAKING from the deadline desk: the ${escapeHtml(name)} situation has RESOLVED, and it did not resolve well.</p>
        <p>Sources confirm this front office spent the week actively shopping ${escapeHtml(name)} after <strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)}</strong> of no production whatsoever. We called every playlist we know. Every one. Group chats. Work playlists. A shared playlist between two people who broke up in 2019 and never deleted it. NOBODY WANTED THE CONTRACT.</p>
        <h2 style="${SUBHEADER_STYLE}">The tape that got us laughed off the phone</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">Depth chart &mdash; note the guys who play</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <p>One GM offered a bag of ice. Not for anything. He just felt bad and wanted the call to end. Another asked if ${escapeHtml(name)} 'still had that thing where he says he's gonna add something and then doesn't', and when we said yes he hung up MID-SENTENCE, which in this league is a formal rejection.</p>
        <p>So he stays. He's ours. And the locker room knows what the locker room knows: one man on this roster once put up SEVENTEEN IN SIX MINUTES, and another has hit eighty-eight Fridays like a metronome with a job. That's the standard in this building, ${escapeHtml(name)}. You're not being asked to be great. You're being asked to be PRESENT.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Play A Snap. Just One.`)}</div>
        <p style="${FOOTER_STYLE}">The desk reconvenes every 24 hours. We'll keep calling around. We're not optimistic.</p>
        `,
      );
    },
  },

  // 16 — Principal's Office
  {
    key: "principals-office",
    subject: (i) =>
      `🏫 ${displayCrewName(i.offender)} TO THE OFFICE. this is going on the announcements.`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `[PA CRACKLE] Would ${name} please report to the office. ${name} to the office. Everyone else, carry on, though I imagine you've all stopped.`,
        ``,
        `Sit. No — sit PROPERLY. Right. ${i.weeksBehind} ${fridayPlural(i.weeksBehind)}, ${name}. ${i.weeksBehind}. And before you start: I've heard it. I've heard 'I forgot.' I've heard 'I was gonna.' I have been in education for thirty-one years and I have never once heard 'I was gonna' from a person who was gonna.`,
        ``,
        `This is your file. I'm reading it into the record because you've made it a matter of public interest:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `And this is the class. Look at where you are. LOOK at it:`,
        renderStandingsText(i),
        ``,
        `Do you know what's the worst of it, ${name}? It isn't the laziness. I can work with lazy. It's that this is a ONE-TASK ASSIGNMENT. One song. Weekly. A trained pigeon could hold this schedule. There is a boy in this school who once submitted seventeen pieces of coursework in six minutes to clear a backlog — insane, unwell, but he DID IT — and you cannot manage one item in ${i.weeksBehind} ${fridayPlural(i.weeksBehind)}.`,
        ``,
        `This goes on your permanent record. Yes, that's a real thing. I made it real this morning. It's a spreadsheet and your name is red.`,
        ``,
        renderPlaylistLineText(i, "Hand it in and you can go"),
        ``,
        `[PA CRACKLE] I'll be reading this out every 24 hours until it's handed in. Enjoy the walk back to class.`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `🏫 ${escapeHtml(name)} TO THE OFFICE.`,
        `
        <p style="font-family:ui-monospace,Menlo,Consolas,monospace">[PA CRACKLE] Would ${escapeHtml(name)} please report to the office. ${escapeHtml(name)} to the office. Everyone else, carry on, though I imagine you've all stopped.</p>
        <p>Sit. No — sit PROPERLY. Right. <strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)}</strong>, ${escapeHtml(name)}. ${i.weeksBehind}. And before you start: I've heard it. I've heard 'I forgot.' I've heard 'I was gonna.' I have been in education for thirty-one years and I have never once heard 'I was gonna' from a person who was gonna.</p>
        <h2 style="${SUBHEADER_STYLE}">Your file, read into the record</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">The class. Look at where you are.</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <p>Do you know what's the worst of it, ${escapeHtml(name)}? It isn't the laziness. I can work with lazy. It's that this is a ONE-TASK ASSIGNMENT. One song. Weekly. A trained pigeon could hold this schedule. There is a boy in this school who once submitted seventeen pieces of coursework in six minutes to clear a backlog — insane, unwell, but he DID IT — and you cannot manage one item in ${i.weeksBehind} ${fridayPlural(i.weeksBehind)}.</p>
        <p>This goes on your permanent record. Yes, that's a real thing. I made it real this morning. It's a spreadsheet and your name is red.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Hand It In And You Can Go`)}</div>
        <p style="${FOOTER_STYLE}">[PA CRACKLE] I'll be reading this out every 24 hours until it's handed in. Enjoy the walk back to class.</p>
        `,
      );
    },
  },

  // 17 — Prison Yard Orientation
  {
    key: "prison-yard",
    subject: (i) => `🔒 sit down, fresh meat. let me explain the yard to you, ${displayCrewName(i.offender)}.`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `Alright, ${name}. Tray down. Don't look at anybody yet. I'm gonna explain how this works because you clearly don't know and it's getting embarrassing to watch.`,
        ``,
        `You're in here on ${i.weeksBehind} ${fridayPlural(i.weeksBehind)}. That's your number now. That's what you are. Guys in here have done worse and carried it better.`,
        ``,
        `Your jacket. Everybody's read it. Everybody:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `Now — the yard. Know who's who before you go making friends:`,
        renderStandingsText(i),
        ``,
        `See the fella who hits every Friday, daylight, never late, eighty-eight of them? Don't talk to him. Don't even look at him. That man runs this yard on ROUTINE and routine is the only real power in here. See the other one — went a hundred and twelve days quiet then moved seventeen units in six minutes? That's a different kind of dangerous. Nobody knows when he goes off. Everybody's fine with it. It's YOU that's the problem, ${name}, because you don't go off and you don't show up. You just sit there being a hole in the roster.`,
        ``,
        `Here's your way out and it's the only one: add ONE song. That's it. That's the whole parole hearing. And I'd move quick, because the yard has noticed, and the yard is BORED, and a bored yard picks a guy.`,
        ``,
        renderPlaylistLineText(i, "Make your move"),
        ``,
        `Lights out in 24 hours and then we do this again. Keep your head down. Add the song. — a lifer`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `🔒 sit down, fresh meat.`,
        `
        <p>Alright, ${escapeHtml(name)}. Tray down. Don't look at anybody yet. I'm gonna explain how this works because you clearly don't know and it's getting embarrassing to watch.</p>
        <p>You're in here on <strong>${i.weeksBehind} ${fridayPlural(i.weeksBehind)}</strong>. That's your number now. That's what you are. Guys in here have done worse and carried it better.</p>
        <h2 style="${SUBHEADER_STYLE}">Your jacket. Everybody's read it.</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">The yard. Know who's who.</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <p>See the fella who hits every Friday, daylight, never late, eighty-eight of them? Don't talk to him. Don't even look at him. That man runs this yard on ROUTINE and routine is the only real power in here. See the other one — went a hundred and twelve days quiet then moved seventeen units in six minutes? That's a different kind of dangerous. Nobody knows when he goes off. Everybody's fine with it. It's YOU that's the problem, ${escapeHtml(name)}, because you don't go off and you don't show up. You just sit there being a hole in the roster.</p>
        <p>Here's your way out and it's the only one: add ONE song. That's it. That's the whole parole hearing. And I'd move quick, because the yard has noticed, and the yard is BORED, and a bored yard picks a guy.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Make Your Move`)}</div>
        <p style="${FOOTER_STYLE}">Lights out in 24 hours and then we do this again. Keep your head down. Add the song. &mdash; a lifer</p>
        `,
      );
    },
  },

  // 18 — Exorcism
  {
    key: "exorcism",
    subject: (i) => `✝️ we have brought in a PRIEST for ${displayCrewName(i.offender)}`,
    text: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `The crew has exhausted every natural explanation, so we did what we had to do and brought in a professional.`,
        ``,
        `THE AFFLICTED: ${name}. THE DURATION: ${i.weeksBehind} ${fridayPlural(i.weeksBehind)}. Father, the man reads the message. He SEES the message. His thumb hovers. And then something in him — something not of this earth — turns the phone face down.`,
        ``,
        `The pattern of possession. Read them aloud. It hates that:`,
        renderMissedFridaysText(i.missedFridays),
        ``,
        `The unafflicted, for comparison, so we know it's not the water:`,
        renderStandingsText(i),
        ``,
        `The signs are unmistakable. He speaks in a voice not his own and the voice says 'yeah I'll do it tonight.' He turns his head away from a green button at an angle the neck should not permit. Holy water does nothing. A group chat @ does nothing. We put the playlist link in front of him and HE OPENED INSTAGRAM. Father, he opened INSTAGRAM.`,
        ``,
        `THE POWER OF BOMPTON COMPELS YOU. One song, demon. ONE. Release this man. He was funny once. He had OPINIONS. Now he's a shape in a chair that other people have to carry, and every Friday the shape gets a bit less human.`,
        ``,
        renderPlaylistLineText(i, "Cast it out. Add a song"),
        ``,
        `The rite repeats every 24 hours until the possession lifts. Bring more candles. — the crew`,
      ].join("\n");
    },
    html: (i) => {
      const name = displayCrewName(i.offender);
      return wrapHtml(
        `✝️ we have brought in a PRIEST for ${escapeHtml(name)}`,
        `
        <p>The crew has exhausted every natural explanation, so we did what we had to do and brought in a professional.</p>
        <p><strong>THE AFFLICTED:</strong> ${escapeHtml(name)}. <strong>THE DURATION:</strong> ${i.weeksBehind} ${fridayPlural(i.weeksBehind)}. Father, the man reads the message. He SEES the message. His thumb hovers. And then something in him — something not of this earth — turns the phone face down.</p>
        <h2 style="${SUBHEADER_STYLE}">The pattern of possession. Read them aloud. It hates that.</h2>
        <ul style="${LIST_STYLE}">${renderMissedFridaysHtml(i.missedFridays)}</ul>
        <h2 style="${SUBHEADER_STYLE}">The unafflicted, so we know it's not the water</h2>
        <ul style="${LIST_STYLE}">${renderStandingsHtml(i)}</ul>
        <p>The signs are unmistakable. He speaks in a voice not his own and the voice says 'yeah I'll do it tonight.' He turns his head away from a green button at an angle the neck should not permit. Holy water does nothing. A group chat @ does nothing. We put the playlist link in front of him and HE OPENED INSTAGRAM. Father, he opened INSTAGRAM.</p>
        <p>THE POWER OF BOMPTON COMPELS YOU. One song, demon. ONE. Release this man. He was funny once. He had OPINIONS. Now he's a shape in a chair that other people have to carry, and every Friday the shape gets a bit less human.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Cast It Out. Add A Song.`)}</div>
        <p style="${FOOTER_STYLE}">The rite repeats every 24 hours until the possession lifts. Bring more candles. &mdash; the crew</p>
        `,
      );
    },
  },

  // -------------------------------------------------------------------------
  // November 2026 batch. Written against the crew export of 2026-11-14, with
  // a line for each crew member wherever the roast gets personal.
  // docs/crew-lore.md lists which fact each of these uses. Anything that
  // could go stale is either dated ("in October", "between July and
  // November") or read live when the email is sent.
  // -------------------------------------------------------------------------

  // 19 — Private Eye. Quotes what the offender has played since falling behind.
  written({
    key: "private-eye",
    subject: (i) => `🕵️ we had ${displayCrewName(i.offender)} followed`,
    headline: (i) => `Case file: ${displayCrewName(i.offender)}`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      const since = formatFridayShort(i.missedFridays[0]);
      const heard = i.listening;
      return [
        `**Client:** the lads. **Subject:** ${name}. **Reason for surveillance:** ${count(i.weeksBehind, "Friday")} owed and a suspicious silence.`,
        heard
          ? `I've had eyes on the subject's Spotify since ${since}. He has not been idle.`
          : `I've had eyes on the subject's Spotify since ${since}, and I've got nothing. Not one song on the log.`,
        heard && {
          list: [
            `Songs played since then: at least ${heard.plays}. My equipment only catches some of them, so the real number is worse.`,
            heard.topArtist.name && heard.topArtist.plays >= 2
              ? `Most played: ${heard.topArtist.name}, ${heard.topArtist.plays} times.`
              : null,
            heard.topTrack.plays >= 3
              ? `The one he keeps going back to: '${heard.topTrack.title}', ${heard.topTrack.plays} times.`
              : null,
            `Last seen: ${formatDayAndTime(heard.lastPlayed.at)}, listening to '${heard.lastPlayed.title}'${heard.lastPlayed.artist ? ` by ${heard.lastPlayed.artist}` : ""}.`,
            `Songs still owed to the Bompton playlist: ${i.weeksBehind}.`,
          ].filter((line): line is string => line !== null),
        },
        heard
          ? `So he's alive, he's got signal and his thumbs work. In my trade we call that "no excuse".`
          : `Two possibilities. One: he has given up music altogether, which would at least be a reason. Two: his Spotify has come unhooked from the app and he hasn't noticed. If it's the second, ${name}, sign in to the app again. Then add a song. Same sitting.`,
        `My invoice is attached. It's ${count(i.weeksBehind, "song")}.`,
        { button: "Pay the detective" },
        {
          footer:
            "Surveillance continues every 24 hours. The van is outside. The van has always been outside.",
        },
      ];
    },
  }),

  // 20 — Roast Night. Three jokes per crew member, no costume.
  written({
    key: "roast-night",
    subject: (i) => `🎤 tonight: the roast of ${displayCrewName(i.offender)}`,
    headline: (i) => `The roast of ${displayCrewName(i.offender)}`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `Good evening, and welcome to the roast of **${name}**, a man who is ${count(i.weeksBehind, "Friday")} behind on a job that takes eleven seconds.`,
        `House rules. Everything said tonight is true, because the app keeps receipts. And he can end it whenever he likes.`,
        ...forOffender(
          i,
          {
            Evan: [
              `He's been missing so often we've looked into milk cartons. In October 2025 he resurfaced after twenty-three days away, and the first song he added was Pink Floyd's 'Wish You Were Here'. Evan. That was our line.`,
              `He has added Freddie Gibbs to this playlist four times and The Alchemist four times. Number of times the app has caught him actually playing either one: zero. He doesn't listen to rap. He submits it, like a sick note.`,
              `Evan's idea of a banger is a woman whispering over one guitar about a town she had to leave.`,
            ],
            Sachin: [
              `His taste isn't eclectic, it's a ransom note. In the 2026–27 season alone he's given us Lamb of God, Rihanna, Shakira and Stromae, and I don't believe he remembers adding any of them.`,
              `He's a BLACKPINK completist with a hole in the collection. He's added the group, Lisa twice, Jennie and Rosé. Jisoo is still waiting by the phone. She should get comfortable. She's dealing with Sachin.`,
              `In October 2026 he played 'Rather Be' by Clean Bandit thirteen times in ten days. That song came out in 2014. He's late to things that have already happened.`,
            ],
            Ben: [
              `Ben has a playlist called 'Haloween'. One L. He has another called 'Apocoliptic'. This is the man who wants to talk to you about lyricism.`,
              `He also has one called 'My playlist #35', and there's nothing on it. Thirty-five playlists in, he made an empty one. Which, this week, is a theme.`,
              `The app once logged him playing 'Talk Dirty' by Jason Derulo at twenty-five past midnight. We're not saying anything. We're just reading it out.`,
            ],
            Sam: [
              `Sam. SAM. Our rock. Our one working clock. Roasting Sam for lateness is like finding out the lighthouse was drunk.`,
              `This is a man who put a song called 'Holy Moly, Rock n' Rolly, Guacamole' on a shared playlist, in broad daylight, on a Friday morning, and still thought of himself as the responsible one.`,
              `He named his computer 'Bluenose'. The Bluenose was famous for being fast, Sam.`,
            ],
          },
          [
            `We don't have much on ${name} yet. He's new. But he's already ${count(i.weeksBehind, "Friday")} behind, so he's fitting in beautifully.`,
          ],
        ),
        `That's the show. ${name}, you can make it stop in eleven seconds. Add the fucking song.`,
        { button: "End the roast" },
        {
          footer:
            "There's another show tomorrow, with new material, unless a song turns up first.",
        },
      ];
    },
  }),

  // 21 — Final Boarding Call
  written({
    key: "final-boarding-call",
    subject: (i) =>
      `✈️ final boarding call for passenger ${displayCrewName(i.offender)}`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      const aboard = caughtUpNames(i);
      return [
        `**Bing bong.**`,
        `This is the final boarding call for passenger **${name}**, travelling on Bompton Air ${i.bomptonYear}, with service to the weekend.`,
        aboard
          ? `Your travelling companions have boarded. ${aboard} ${aboard.includes(" and ") ? "are" : "is"} seated, belted and on a second drink, and watching the door.`
          : `Your travelling companions aren't all aboard either, but yours is the name we've been asked to read out.`,
        `Passenger ${name}, you are now **${count(i.weeksBehind, "Friday")}** late for a flight that leaves once a week, from the same gate, at the same time, and emails you beforehand.`,
        `We're unable to offload your bags, because you never checked any. You've brought nothing. That's rather the problem.`,
        `Please proceed to the gate with ${i.weeksBehind === 1 ? "one (1) song" : count(i.weeksBehind, "song")}.`,
        { button: "Board" },
        {
          footer:
            "This announcement repeats every 24 hours. The gate staff have stopped pretending to be surprised.",
        },
      ];
    },
  }),

  // 22 — Unwrapped. A Spotify Wrapped nobody asked for.
  written({
    key: "unwrapped",
    subject: (i) =>
      `🎁 ${displayCrewName(i.offender)}, your Bompton Unwrapped is ready (nobody asked)`,
    headline: (i) => `${displayCrewName(i.offender)}: Unwrapped`,
    body: (i) => [
      `It isn't December and you didn't ask. But you're ${count(i.weeksBehind, "Friday")} behind, so here is your year in review.`,
      { heading: "Your top genre" },
      i.roastNumber
        ? `Excuses. This is the ${ordinal(i.roastNumber)} email like this you've earned this season.`
        : `Excuses.`,
      ...forOffender<Block[]>(
        i,
        {
          Evan: [
            { heading: "Your most-played song" },
            `'Kill Me' by Phoebe Bridgers. Twenty-seven plays between August and November 2026, and those are only the ones the app caught. Twenty-seven plays for her. Not eleven seconds for us.`,
            { heading: "Your peak hours" },
            `Eight o'clock to midnight. Nearly half of everything you've ever added to this playlist turned up in that window. You don't add music so much as remember it at bedtime.`,
            { heading: "Your listening personality" },
            `**The Mourner.** You don't have a favourite artist. You have a vigil.`,
          ],
          Sachin: [
            { heading: "Your most-played song" },
            `'Pillow Fight' by Tinashe. Thirty-eight plays in under a month, in October 2026. You did add it to the playlist, to be fair. It was the only song you'd heard.`,
            { heading: "Your peak hours" },
            `The small ones. Between May and November 2026 the app logged you playing music after midnight on 63 different nights. Whatever's keeping you up, it isn't guilt.`,
            { heading: "Your listening personality" },
            `**The Raccoon.** Nocturnal, eats anything, gone by morning.`,
          ],
          Ben: [
            { heading: "Your most-played artist" },
            `Jessie Ware. Not DOOM. Not Kendrick. Of everything the app logged you playing in the spring and summer of 2026, one song in ten was Jessie Ware, and you added three songs off the same album of hers in eight weeks. One more and you may as well post us the CD.`,
            { heading: "Your peak hours" },
            `The weekend. Nearly half of what the app has logged you playing happened on a Saturday or a Sunday. Monday to Friday you apparently sit in silence, like a monk with opinions.`,
            { heading: "Your listening personality" },
            `**The Monk With Opinions.** See above.`,
          ],
          Sam: [
            { heading: "Your most-played artist" },
            `Geese. Ninety-five plays between June and November 2026, one of them at three o'clock on a Sunday morning. Ben put Geese on this playlist in July 2023. You got round to them in January 2026, which until now was the latest you'd ever been for anything.`,
            { heading: "Your peak hours" },
            `Friday, nine to three. Twenty-seven of your first thirty-five songs of 2026–27 arrived on the day itself, most of them before lunch. You add music the way other people file expenses.`,
            { heading: "Your listening personality" },
            `**The Timesheet.** Reliable, punctual and now, somehow, overdue.`,
          ],
        },
        [
          { heading: "Your listening personality" },
          `**The New Guy.** We haven't been watching you long enough to be specific. We're watching now.`,
        ],
      ),
      { heading: "Your year isn't over" },
      `Change the ending. It takes eleven seconds.`,
      { button: "Add the song" },
      { footer: "Unwrapped is re-issued every 24 hours until the numbers improve." },
    ],
  }),

  // 23 — Group Project
  written({
    key: "group-project",
    subject: (i) =>
      `Re: Re: Re: group project (${displayCrewName(i.offender)} pls respond)`,
    headline: () => `Re: Re: Re: group project`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      const timed =
        standingsSorted(i.standings).find(
          (row) => row.missedCount === 0 && row.member.id !== i.offender.id,
        )?.member ?? null;
      return [
        `Hi all!! Hope everyone's had a great week :)`,
        `Just circling back on the playlist. Quick status on everybody's sections:`,
        {
          list: standingsSorted(i.standings).map((row) => {
            const who = displayCrewName(row.member);
            if (row.member.id === i.offender.id) {
              return `**${who}** — section currently reads "[SONG GOES HERE]"`;
            }
            return row.missedCount === 0
              ? `${who} — done. Thank you ${who}!!`
              : `${who} — also behind, but this email isn't about him (yet)`;
          }),
        },
        `${name}, no pressure at all!! I know you've got loads on. It's just that it's been ${count(i.weeksBehind, "Friday")} now, and the rest of us would really love to not carry you again :)`,
        `I've gone ahead and done your slides, your bibliography, and the page where we tell the professor who did what. I've been very honest on that page.`,
        `Thanks so much!!`,
        { button: "Do your section" },
        {
          footer: timed
            ? `P.S. It takes eleven seconds. I timed ${displayCrewName(timed)}.`
            : `P.S. It takes eleven seconds. I timed it.`,
        },
      ];
    },
  }),

  // 24 — Local Man
  written({
    key: "local-man",
    subject: (i) =>
      `📰 Local man ${displayCrewName(i.offender)} insists song is "basically added"`,
    headline: (i) =>
      `Local man ${displayCrewName(i.offender)} insists song is "basically added"`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      const heard = i.listening;
      return [
        `THE GROUP CHAT — Local man ${name} confirmed today that he is "basically done" adding a song to the Bompton playlist, despite being ${count(i.weeksBehind, "Friday")} behind and having taken no steps of any kind.`,
        `"It's handled," said ${name}, who has not opened the playlist. "I've got one in mind. It's a great one. You're going to love it." He was unable to name the song, the artist or the day of the week.`,
        forOffender(
          i,
          {
            Evan: `Friends say they have seen this before. "In October 2026 we emailed him six times in eleven days," said one. "Six. He added on the twelfth day, on a Saturday night, and carried on like he'd been away at war."`,
            Sachin: `Friends say they have seen this before. "In the autumn of 2026 he was a song behind for thirty-eight days straight," said one. "The app logged him playing 628 songs in that time. He wasn't busy. He was right there."`,
            Ben: `Friends were unmoved. "He always folds," said one. "The first time we sent him one of these he added three minutes later. The third time, five minutes. He isn't a man. He's a doorbell."`,
            Sam: `Friends were shaken. "It happened twice in August 2026," said one, staring at the floor. "Both times he added the next morning at about ten, like a man who'd slept beautifully. He didn't even have the decency to panic."`,
          },
          `Friends declined to comment, on the grounds that they were busy adding songs.`,
        ),
        heard
          ? `At press time, ${name}'s most recent known activity was playing '${heard.lastPlayed.title}' on ${formatDayAndTime(heard.lastPlayed.at)}. He then added nothing.`
          : `At press time, ${name} had opened Spotify, played something else and closed it again.`,
        { button: "Make it true" },
        { footer: "This story is updated every 24 hours. It has not changed yet." },
      ];
    },
  }),

  // 25 — The Owl. Keeps count of how many of these the offender has had.
  written({
    key: "owl",
    subject: (i) =>
      `🦉 ${displayCrewName(i.offender)}, these reminders don't seem to be working`,
    headline: () => `These reminders don't seem to be working`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `Hi ${name}. It's me.`,
        i.roastNumber
          ? `This is reminder number ${i.roastNumber} of the season. I've stopped expecting anything. I keep count for the tribunal.`
          : `I've lost count of these this season, which is also your fault.`,
        `You missed ${formatFridayShort(i.missedFridays[0])}.${i.weeksBehind > 1 ? ` Then you kept going. You now owe ${count(i.weeksBehind, "song")}.` : ""}`,
        `I used to send these because I believed in you. Now I send them because I'm a bird with a schedule, which is one more schedule than you've got.`,
        `Your streak: **0 days.** The table:`,
        standingsList(i),
        `Add ${count(i.weeksBehind, "song")} and I go away. For a week.`,
        { button: "Make the owl stop" },
        {
          footer:
            "I know where you keep your phone. It's in your hand. It's in your hand right now.",
        },
      ];
    },
  }),

  // 26 — Museum Audio Guide
  written({
    key: "museum-guide",
    subject: (i) =>
      `🎧 audio guide: The ${displayCrewName(i.offender)} Wing (stop 14 is empty)`,
    headline: (i) => `Welcome to The ${displayCrewName(i.offender)} Wing`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `Welcome to The ${name} Wing. Please keep your voice down. The artist is not working.`,
        `**Stop 14. 'Untitled (Song Goes Here)', ${i.bomptonYear}.** An empty space on the wall where this week's song should hang. The artist has described the piece as "I'll do it tonight." That was ${count(i.weeksBehind, "Friday")} ago.`,
        forOffender(
          i,
          {
            Evan: `**Stop 15. 'Fiero GT', 2026.** Fifty-one seconds long. The shortest work in the collection, handed in that April as a whole week's contribution. Please don't lean on the glass. There's very little behind it.`,
            Sachin: `**Stop 15. 'Tanglewood', 2025, and 'Tanglewood', 2026.** The same song, hung twice, a year apart. Experts believe the artist forgot he had already made it. The first version dates from a period of considerable panic.`,
            Ben: `**Stop 15. 'No Gold Teeth' (June 2026) and 'No Gold Teeth' (October 2026).** A diptych. The same song, added to the same playlist twice, fifteen weeks apart. It's the third season in four in which the artist has handed in a work he had already handed in.`,
            Sam: `**Stop 15. 'That's Life' (after Ben), 2026.** A Frank Sinatra number, added that September. Visitors may recognise it. Ben exhibited the identical piece six months earlier. The curators have labelled it, gently, "school of Ben".`,
          },
          null,
        ),
        `**Stop 16** is the gift shop. It sells one item. It's the playlist.`,
        { button: "Exit through the gift shop" },
        { footer: "This tour repeats every 24 hours until stop 14 is filled." },
      ];
    },
  }),

  // 27 — The Negotiator
  written({
    key: "negotiator",
    subject: (i) =>
      `📞 ${displayCrewName(i.offender)}, this is the negotiator. pick up.`,
    headline: () => `This is the negotiator. Pick up.`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      const out = caughtUpNames(i);
      const them = i.weeksBehind === 1 ? "it" : "them";
      return [
        `${name}. My name doesn't matter. I'm the negotiator. I'm outside with a megaphone and a coffee that's gone cold, and I'd like us both to go home.`,
        `Here's the situation as I understand it. You're holding ${count(i.weeksBehind, "song")}. You've been holding ${them} since ${formatFridayShort(i.missedFridays[0])}. Nobody knows what you want. I don't think you know what you want.`,
        out
          ? `I've spoken to the others. ${out} came out with ${out.includes(" and ") ? "their hands up and a song each" : "his hands up and a song"}. They're worried about you. Mostly they're annoyed.`
          : `I've spoken to the others. It isn't pretty out here either, but you're the one I've been sent in for.`,
        `I can't get you a helicopter. I did ask. What I can do is this: you put ${count(i.weeksBehind, "song")} on the playlist, slowly, where I can see ${them}, and all of this goes away.`,
        `Nobody has to get embarrassed any further than they already have been.`,
        { button: "Come out with a song" },
        {
          footer:
            "I'll be back on this megaphone every 24 hours. I've got nothing else on.",
        },
      ];
    },
  }),

  // 28 — Wikipedia
  written({
    key: "wikipedia",
    subject: (i) =>
      `📚 ${displayCrewName(i.offender)} — Wikipedia, the free encyclopedia`,
    headline: (i) => `${displayCrewName(i.offender)} (playlist contributor)`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      const square = caughtUpNames(i);
      return [
        `**${name}** is a Canadian playlist contributor, best known for being ${count(i.weeksBehind, "Friday")} behind on the Bompton ${i.bomptonYear} playlist.[1]`,
        { heading: "Career" },
        forOffender(
          i,
          {
            Evan: `Evan's work is marked by long periods of inactivity. On the night of 7 November 2025 he added a song called 'Laying Low', followed a minute later by one more, and then nothing for 68 days.`,
            Sachin: `Sachin is best known for the events of 21 July 2025. Having managed one song in the first seventeen weeks of the season, he added seventeen in five minutes. Early accounts called this impressive. Historians now agree it was a man paying off seventeen weeks at once, like parking fines.`,
            Ben: `Ben is noted for his retrospective period. On 9 May 2026 he added five MF DOOM tracks in five minutes to the 2024–25 playlist, a season that had been closed for fourteen months, to fill a five-song hole he had been leaving there the whole time.`,
            Sam: `Sam is widely regarded as the reliable one, a reputation this email complicates.`,
          },
          `${name} is a recent addition to the group. His career to date consists of this email.`,
        ),
        { heading: "Controversies" },
        forOffender(
          i,
          {
            Evan: `Across the 2025–26 season his songs arrived, between them, more than 500 days late. Historians are divided on whether this was a protest, a lifestyle or just Evan.`,
            Sachin: `In August 2026 it took five emails in seven days to produce one song. He has described the period as "a busy week".[citation needed]`,
            Ben: `In June 2026 he added Billy Joel's 'Pressure' at 11:43 on a Tuesday night. Nobody had asked him to. He was three days early. He has never explained the title.`,
            Sam: `At 6:49 on a Sunday morning in October 2025 he added a song to the 2023–24 playlist, a season that had been over for nineteen months. His total for that season now stands at 53 instead of 52. He has never corrected it, apologised, or explained what he was doing up.`,
          },
          `None yet. Give him time.`,
        ),
        { heading: "Current status" },
        `As of this email ${name} owes ${count(i.weeksBehind, "song")}.${square ? ` ${square} ${square.includes(" and ") ? "owe" : "owes"} nothing.` : ""}`,
        { heading: "See also" },
        {
          list: [
            "Procrastination",
            "Ghosting (behaviour)",
            "List of people who were going to do it tonight",
          ],
        },
        `[1] The playlist. Everybody can see the playlist.`,
        { button: "Edit this article" },
        { footer: "This article is reviewed every 24 hours. It has never once improved." },
      ];
    },
  }),

  // 29 — Two Lines. Deliberately short.
  written({
    key: "two-lines",
    subject: (i) => `${displayCrewName(i.offender)}.`,
    body: (i) => {
      const last = i.lastAdd;
      const days = last ? daysSince(last.addedAt) : 0;
      return [
        !last
          ? `You haven't added a song this season.`
          : days === 0
            ? `You added '${last.title}' today. Don't stop there.`
            : days === 1
              ? `You added '${last.title}' yesterday. Don't stop there.`
              : `Your last song was '${last.title}'. That was ${count(days, "day")} ago.`,
        `You owe ${count(i.weeksBehind, "song")}. We can all see the playlist.`,
        { button: "Add a song" },
        { footer: "— the lads" },
      ];
    },
  }),

  // 30 — Sommelier
  written({
    key: "sommelier",
    subject: (i) =>
      `🍷 tonight's pairing: ${displayCrewName(i.offender)}'s listening history`,
    headline: () => `Tonight's tasting`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `Good evening. Tonight we'll be tasting what **${name}** has been listening to instead of adding a song.`,
        ...forOffender(
          i,
          {
            Evan: [
              `**On the nose:** rain on a bus window.`,
              `**On the palate:** Fleet Foxes, Waxahatchee, and a strong regional note of Lennie Gallant and Wintersleep. This is a wine that has cried at a ferry terminal.`,
              `**The finish:** long and damp. When it's over you realise nothing was added.`,
            ],
            Sachin: [
              `**On the nose:** petrol.`,
              `**On the palate:** Le Castle Vania, the nightclub-shootout music from John Wick. Fifty plays of it, and he has never once shared any with us. Then, without warning, Tinashe.`,
              `**The finish:** a boss fight. This isn't a blend. Somebody dropped the rack.`,
            ],
            Ben: [
              `**On the nose:** big, serious rap. You can smell the liner notes.`,
              `**On the palate:** it holds up. Kendrick, Ka, McKinley Dixon.`,
              `**The finish:** and there it is. Phil Collins, from the Brother Bear soundtrack, and a dance remix of 'Spooky, Scary Skeletons'. Both were among his fifty most-played songs when we looked in November 2026.`,
            ],
            Sam: [
              `**On the nose:** campfire.`,
              `**On the palate:** Mt. Joy, Caamp, Tyler Childers. You could serve this at a wedding in a barn.`,
              `**The finish:** tech house. Out of nowhere. John Summit and Fisher, as though the barn has caught fire.`,
            ],
          },
          [
            `**On the nose:** hard to say. He's new, and the bottle is still sealed.`,
            `**The finish:** nothing was added.`,
          ],
        ),
        `**Pairs with:** ${count(i.weeksBehind, "song")}, served immediately.`,
        { button: "Settle the bill" },
        {
          footer:
            "The sommelier returns every 24 hours with a different bottle and the same question.",
        },
      ];
    },
  }),

  // 31 — Surprise Party
  written({
    key: "surprise-party",
    subject: (i) =>
      `🎉 SURPRISE!! (${displayCrewName(i.offender)} isn't here yet)`,
    headline: () => `SURPRISE!!`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `SURPRISE!`,
        `…`,
        `He's not here. Of course he's not fucking here. Everybody put your arms down.`,
        `While we wait, a few words about the guest of honour. **${name}** is ${count(i.weeksBehind, "Friday")} late for the playlist, and now he's late for his own surprise party, which I didn't think you could be.`,
        forOffender(
          i,
          {
            Evan: `We love Evan. Evan is a romantic. On Halloween 2026 he added a song called 'Halloween'. That is the size of surprise this man deals in, and it's still more than he's managed this week.`,
            Sachin: `We love Sachin. Sachin keeps different hours from the rest of us. Across four seasons, 39 of his songs have turned up between midnight and five in the morning. So the party started at seven, and we'll see him at about two.`,
            Ben: `We love Ben. Ben likes to get ahead. One Thursday in October 2026 he added three songs in a single minute, paying for the next three Fridays up front, like rent. So he probably thinks he's already been to this party.`,
            Sam: `We love Sam. Sam is never late. Ten times between May and November 2026 he'd added his song before the Friday reminder had even gone out. So if Sam isn't here, the only explanation is that Sam is dead, and this is a wake. Somebody get the good whisky.`,
          },
          `We love ${name}. We don't know him very well yet. This isn't helping.`,
        ),
        `Anyway. The cake says ADD A SONG. We're cutting it without him.`,
        { button: "Turn up" },
        {
          footer:
            "The party restarts every 24 hours. The balloons are not doing well.",
        },
      ];
    },
  }),

  // 32 — You Died
  written({
    key: "you-died",
    subject: (i) =>
      `☠️ YOU DIED — ${displayCrewName(i.offender)} was defeated by a Friday`,
    headline: () => `YOU DIED`,
    body: (i) => {
      const cleared = caughtUpNames(i);
      const guide = `Most players look up a guide after the second death. There is a guide. It's one line long, and it's the name of the playlist.`;
      return [
        `**Boss:** Friday, Devourer of Plans. **Attempts:** ${i.weeksBehind}. **Victories:** 0.`,
        `You've been beaten by an enemy with one move. It turns up every seven days, in the same place, and it warns you by email first.`,
        forOffender(
          i,
          {
            Evan: guide,
            Sachin: `And this is the embarrassing part, Sachin, because the app has logged you playing FromSoftware boss music for fun. One Saturday in September 2026 it was 'Heolstor the Nightlord', five times in a day, the first at seven minutes past four in the morning. You'll square up to a Nightlord to relax, and a three-minute pop song has you face down on the floor.`,
            Ben: guide,
            Sam: guide,
          },
          guide,
        ),
        cleared
          ? `${cleared} ${cleared.includes(" and ") ? "have" : "has"} already cleared this boss without taking a hit.`
          : `Nobody has cleared it cleanly this week. You're just the one face down on the floor.`,
        `**Tip:** try adding a song.`,
        { button: "Respawn at the playlist" },
        { footer: "You will respawn here every 24 hours." },
      ];
    },
  }),

  // 33 — True Crime Podcast
  written({
    key: "true-crime",
    subject: (i) =>
      `🎙️ new episode: "The Friday ${displayCrewName(i.offender)} Vanished"`,
    headline: (i) => `The Friday ${displayCrewName(i.offender)} Vanished`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      const innocent = caughtUpNames(i);
      return [
        `[sombre piano]`,
        `It was a Friday like any other. ${innocent ? `${innocent} added ${innocent.includes(" and ") ? "their songs" : "a song"}.` : `Songs were added.`} One man did not.`,
        `I'm your host, and this is **Missing Fridays**, the podcast about men who said "I'll do it later." This episode: **${name}**. ${capitalise(count(i.weeksBehind, "Friday"))}. No song. No note.`,
        forOffender(
          i,
          {
            Evan: `Investigators have one clue. On a Tuesday morning in September 2026 the app logged him playing the same Tyler, The Creator song six times in eleven minutes. Never to the end. Just starting it, over and over. Detectives call this "pacing".`,
            Sachin: `Investigators have one clue. At 1:43 on a Friday morning in October 2026 he added a song from a video game soundtrack. Later that same morning the app logged him playing it eight times in a row. Neighbours describe him as "awake".`,
            Ben: `Investigators have one clue. At five past midnight one Saturday in May 2026, the app logged him playing the Cuphead soundtrack. Not the good bits. The tutorial music. A grown man, after midnight, listening to the tutorial.`,
            Sam: `Investigators have one clue. In July 2026 he added a song Evan had put on the playlist more than two years earlier, then played it fourteen times in four weeks. He has never mentioned Evan. Evan has never been thanked.`,
          },
          `Investigators have no clues. He's new. That's what makes it so chilling.`,
        ),
        `We'll be right back after this.`,
        `There's no ad. Nobody will sponsor this. Add the song.`,
        { button: "Close the case" },
        { footer: "A new episode drops every 24 hours until somebody talks." },
      ];
    },
  }),

  // 34 — Terms of Friendship
  written({
    key: "terms-update",
    subject: (i) =>
      `We've updated our Terms of Friendship (${displayCrewName(i.offender)}, please review)`,
    headline: () => `We've updated our Terms of Friendship`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `Hi ${name},`,
        `We've made some changes to our Terms of Friendship. They take effect immediately, because of you.`,
        `**1. Friday.** "Friday" means Friday. It has always meant Friday.`,
        `**2. "I was going to".** Is not a song and can't be added to a playlist. We checked.`,
        `**3. Arrears.** You currently owe ${count(i.weeksBehind, "song")}. This is not a negotiating position.`,
        forOffender(
          i,
          {
            Evan: `**4. The Evan Clause.** Vanishing for weeks and then adding three songs in nine minutes on a Saturday night is a payment plan, not participation. You've pulled some version of this four times since October 2025.`,
            Sachin: `**4. The Sachin Clause.** Adding a song one minute after one of these emails arrives, as you did on 11 August 2026 and again on 27 October, isn't initiative. It proves you had the song ready and were waiting to be asked.`,
            Ben: `**4. The Ben Clause.** An album is not a subscription. You've added five songs off the same Tyler Childers record. That's the limit, and you're at it.`,
            Sam: `**4. The Sam Clause.** A spotless record is not a savings account. Being on time for most of the year doesn't buy you this week.`,
          },
          `**4. The New Guy Clause.** Being new isn't an excuse. It was, for one week. That week has gone.`,
        ),
        `**5. Termination.** We can't actually remove you. We've looked into it. That's the only reason clause 5 is this short.`,
        `By continuing to exist you accept these terms.`,
        { button: "I agree (add a song)" },
        { footer: "To unsubscribe from these emails, add a song every Friday." },
      ];
    },
  }),

  // 35 — LinkedIn
  written({
    key: "linkedin",
    subject: (i) =>
      `🎉 Congratulate ${displayCrewName(i.offender)} on ${count(i.weeksBehind, "Friday")} without adding a song`,
    headline: (i) => `${displayCrewName(i.offender)} posted an update`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      const others = i.crew
        .filter((m) => m.id !== i.offender.id)
        .map((m) => displayCrewName(m));
      return [
        `**${name}** · Playlist Contributor (Inactive) · Thought Leader · Open To Reminders`,
        `I'm humbled to announce that I have now missed **${count(i.weeksBehind, "Friday")}** on the Bompton playlist.`,
        `A lot of people will tell you that adding one song a week is "easy" and "takes eleven seconds". But here's what they don't teach you in business school: **doing nothing scales.**`,
        `When the others added on time, I asked myself a hard question. What if I didn't? That's called disruption.`,
        `Three lessons from my journey:`,
        {
          list: [
            `Deadlines are a mindset.`,
            `When you fail, your network CCs everyone. That's reach.`,
            `"Tonight" is a renewable resource.`,
          ],
        },
        `Agree? 👇`,
        `#leadership #grindset #blessed #OpenToWork`,
        others.length > 0 &&
          `**${others.length} ${others.length === 1 ? "comment" : "comments"}**`,
        others.length > 0 && {
          list: others.map((who, n) =>
            n === others.length - 1 && others.length > 1
              ? `${who}: mate`
              : `${who}: add a song`,
          ),
        },
        { button: "Post an update (add a song)" },
        { footer: "You'll get this notification every 24 hours." },
      ];
    },
  }),

  // 36 — Press Conference
  written({
    key: "press-conference",
    subject: (i) =>
      `⚽ the gaffer on ${displayCrewName(i.offender)}: "I'm not going to defend him"`,
    headline: (i) => `Post-match: the gaffer on ${displayCrewName(i.offender)}`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      const working = caughtUpNames(i);
      return [
        `**Q: Gaffer, ${count(i.weeksBehind, "Friday")} without a song from ${name}. Your thoughts?**`,
        `Look. He's a good lad. Great in training. I'm not going to stand here and criticise one of my own players in public.`,
        `**Q: But?**`,
        `But he's been shite, hasn't he. ${working ? `I've got ${working} out there doing a job every week, and then I've got him.` : `None of them have covered themselves in glory this week, but he's the one you're asking about.`}`,
        ...forOffender(
          i,
          {
            Evan: [
              `**Q: Is it true that in October 2026, on the day of your fifth email in nine days, he played Phoebe Bridgers seventeen times?**`,
              `I've seen the footage. Seventeen. All her. Not one song added. I asked him about it and he said he was "in a place". I said so's the playlist, son. It's on your phone.`,
            ],
            Sachin: [
              `**Q: He seems to add whatever he's had on repeat that week. Is that a tactic?**`,
              `It's not a tactic. In August 2026 he played one Shakira song six times in a day and added it that afternoon. That's not scouting. That's a man forwarding us his own stuck record.`,
            ],
            Ben: [
              `**Q: There are reports he has one playlist called 'Breakfast' and another called 'Beer For Breakfast'.**`,
              `There are. The first one's got five songs on it. The second's got sixteen. I'm not a detective, but I can read a league table.`,
            ],
            Sam: [
              `**Q: Is this the end for Sam at this level?**`,
              `Let's not be dramatic. He's had one bad week in a career of good ones. The trouble is the other three have seen it now. They've seen he's mortal. I can't un-ring that bell.`,
            ],
          },
          [],
        ),
        `**Q: What happens now?**`,
        `He adds a song. Today. Or he trains with the under-twelves. That's all I'm saying. No more questions.`,
        { button: "Get back in the squad" },
        {
          footer:
            "The gaffer will be available again in 24 hours. He would rather not be.",
        },
      ];
    },
  }),

  // 37 — Choose Your Own Adventure
  written({
    key: "choose-your-adventure",
    subject: (i) =>
      `📖 ${displayCrewName(i.offender)} and the Song He Didn't Add (a choose-your-own-adventure)`,
    headline: (i) => `${displayCrewName(i.offender)} and the Song He Didn't Add`,
    body: (i) => [
      `**1.** You are **${displayCrewName(i.offender)}**. It is not Friday. It hasn't been Friday for some time. You owe ${count(i.weeksBehind, "song")}. Your phone is in your hand.`,
      `If you open Spotify and add a song, **turn to 4.** If you tell yourself you'll do it tonight, **turn to 2.**`,
      `**2.** It is tonight. You didn't do it. You feel fine, which is the worst part. If you add a song now, **turn to 4.** If you decide to wait for the next email, **turn to 3.**`,
      `**3.** The next email arrives. It's this one. You've been here before. You can tell by the wallpaper. **Turn to 1.**`,
      `**4.** You add ${i.weeksBehind === 1 ? "a song. It takes eleven seconds" : `${count(i.weeksBehind, "song")}. It takes eleven seconds each`}. Three men breathe out. The emails stop. You're remembered as someone who got there in the end. **THE END.**`,
      { button: "Turn to 4" },
      { footer: "There is no page 5. People have looked." },
    ],
  }),

  // 38 — Apology Form
  written({
    key: "apology-form",
    subject: (i) =>
      `📝 ${displayCrewName(i.offender)}, we wrote your apology for you. just tick a box.`,
    headline: () => `Your apology, pre-written`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `${name}. We know you're busy not adding songs, so we've drafted your apology for you. Tick one box in each section and reply all.`,
        `**Dear lads,**`,
        `I'm sorry I am ${count(i.weeksBehind, "Friday")} behind. I was:`,
        {
          list: [
            `☐ busy`,
            `☐ asleep`,
            `☐ "going to do it tonight"`,
            forOffender(
              i,
              {
                Evan: `☐ playing 'Tigers Blood' for the twenty-first time`,
                Sachin: `☐ on my twenty-second go through 'Gasoline Dreams'`,
                Ben: `☐ in the basement, with the stereo`,
                Sam: `☐ on time, in spirit`,
              },
              `☐ new here`,
            ),
          ],
        },
        `It won't happen again, because:`,
        {
          list: [`☐ I've changed`, `☐ I've set an alarm`, `☐ it will happen again`],
        },
        `Yours in shame,`,
        `☐ ${name}   ☐ ${name}, but sadder`,
        { button: "Or just add the song" },
        { footer: "Unsigned forms are sent again every 24 hours." },
      ];
    },
  }),

  // 39 — Vacancy
  written({
    key: "vacancy",
    subject: (i) =>
      `📋 NOW HIRING: someone to do ${displayCrewName(i.offender)}'s job`,
    headline: () => `Now hiring: fourth man`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      return [
        `**Position:** Fourth Man. **Reports to:** the other three. **Start date:** immediately. The last one has stopped turning up.`,
        `We're a small, friendly playlist looking for somebody to add one song every Friday. The role is currently held, in the legal sense only, by **${name}**, who is ${count(i.weeksBehind, "Friday")} behind.`,
        { heading: "The successful candidate will" },
        {
          list: [
            `Own a phone`,
            `Know what day it is, most weeks`,
            `Add one (1) song every Friday without being emailed about it`,
            forOffender(
              i,
              {
                Evan: `Check what's already on the playlist before adding to it. The current holder added 'Image' by Magdalena Bay in October 2026. Sam had added it in 2024.`,
                Sachin: `Have heard more than one song in any given week`,
                Ben: `Listen to somebody else's songs now and then. By mid-November 2026 the current holder had played his own adds from that season 46 times, and Sachin's twice.`,
                Sam: `Not be Sam. We can't go through this twice. We thought he was the safe one.`,
              },
              `Last longer than the current holder`,
            ),
          ],
        },
        { heading: "We offer" },
        { list: [`Three friends`, `A playlist`, `Public humiliation, at cost`] },
        `**To apply:** add a song. ${name}, you're welcome to reapply for your own job. You'd be the favourite. You'd be the only candidate.`,
        { button: "Apply" },
        { footer: "This vacancy is re-advertised every 24 hours." },
      ];
    },
  }),

  // 40 — The Book of Bompton
  written({
    key: "book-of-bompton",
    subject: (i) =>
      `📜 a reading from the Book of Bompton, chapter ${i.weeksBehind}`,
    headline: (i) => `The Book of Bompton, chapter ${i.weeksBehind}`,
    body: (i) => {
      const name = displayCrewName(i.offender);
      const times =
        i.weeksBehind === 1
          ? "once"
          : i.weeksBehind === 2
            ? "twice"
            : `${i.weeksBehind} times`;
      return [
        `**1.** And it came to pass that on the sixth day, which is called Friday, the lads did each add a song unto the playlist, and it was good.`,
        `**2.** But ${name} added not.`,
        `**3.** And the lads said unto ${name}, Wherefore hast thou not added? And ${name} answered, saying, I shall do it this evening. And he did not do it that evening.`,
        `**4.** And this came to pass ${times}, and the lads waxed wroth, and they built a machine, that it might send letters.`,
        `**5.** And the machine spake daily, saying, ${name}, ${name}, why playest thou other songs, and addest not?`,
        `**6.** Blessed is he that addeth on the Friday, for he shall not receive this email.`,
        `**7.** But woe unto him that sayeth "tonight", for his name shall be CC'd.`,
        `Here endeth the lesson.`,
        { button: "Go, and add" },
        { footer: "The next reading is in 24 hours. It is the same reading." },
      ];
    },
  }),
];

// Public so the rotation can pick from the list without importing the array.
export const LATE_ADD_PERSONA_KEYS: readonly string[] = PERSONAS.map(
  (p) => p.key,
);

// Which persona sent an email with this subject line, given what it was sent
// with. Empty when no current persona produces it. More than one only if two
// personas share a subject line; the rotation then counts both as sent, so a
// duplicate can't leave one of them looking unsent forever.
export function lateAddPersonaKeysForSubject(
  subject: string,
  sentWith: SubjectInput,
): string[] {
  return PERSONAS.filter((p) => p.subject(sentWith) === subject).map(
    (p) => p.key,
  );
}

// ---------------------------------------------------------------------------
// Shared rendering helpers used by personas.
// ---------------------------------------------------------------------------

const SUBHEADER_STYLE =
  "font-size:14px;text-transform:uppercase;letter-spacing:.15em;color:#a3a3a3;margin-top:24px";
const LIST_STYLE = "margin:8px 0 0;padding-left:20px";
const FOOTER_STYLE = "margin-top:24px;color:#a3a3a3;font-size:12px";

function fridayPlural(n: number): string {
  return n === 1 ? "Friday" : "Fridays";
}

function renderMissedFridaysText(fridays: Date[]): string {
  return fridays.map((f) => `  - ${formatFriday(f)}`).join("\n");
}

function renderMissedFridaysHtml(fridays: Date[]): string {
  return fridays
    .map((f) => `<li>${escapeHtml(formatFriday(f))}</li>`)
    .join("");
}

function renderStandingsText(input: LateAddEmailInput): string {
  return standingsSorted(input.standings)
    .map((row) => {
      const tag =
        row.member.id === input.offender.id
          ? " <-- this email is about you"
          : row.missedCount === 0
            ? " (caught up)"
            : "";
      return `  - ${displayCrewName(row.member)}: ${row.missedCount} missed${tag}`;
    })
    .join("\n");
}

function renderStandingsHtml(input: LateAddEmailInput): string {
  return standingsSorted(input.standings)
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
}

function renderPlaylistLineText(
  input: LateAddEmailInput,
  prefix: string,
): string {
  if (input.playlistUrl) {
    return `${prefix}: ${input.playlistUrl}`;
  }
  return `${prefix}: open your Spotify, find the Bompton playlist for this season, add a song.`;
}

function renderPlaylistButton(
  input: LateAddEmailInput,
  ctaLabel: string,
): string {
  if (!input.playlistUrl) {
    return `<p style="color:#a3a3a3">No playlist link on file. Find it in your Spotify library yourself.</p>`;
  }
  return `<p><a href="${escapeHtml(input.playlistUrl)}" style="display:inline-block;background:#1DB954;color:#000;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(ctaLabel)}</a></p>`;
}

function wrapHtml(headline: string, innerHtml: string): string {
  return `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#121212;color:#fff;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#181818;border-radius:12px;padding:24px;border:1px solid #282828">
      <p style="text-transform:uppercase;letter-spacing:.2em;font-size:11px;color:#a3a3a3;margin:0 0 6px">Bompton accountability bot</p>
      <h1 style="margin:0 0 12px;font-size:24px">${headline}</h1>
      ${innerHtml}
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

// "Friday, Nov 6".
function formatFridayShort(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
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

// ---------------------------------------------------------------------------
// Helpers for personas written as blocks.
// ---------------------------------------------------------------------------

// A persona whose body is written once, as blocks, and rendered into both
// parts of the email. The headline is the big line at the top of the HTML
// part; it defaults to the subject.
function written(p: {
  key: string;
  subject: (i: SubjectInput) => string;
  headline?: (i: LateAddEmailInput) => string;
  body: (i: LateAddEmailInput) => Block[];
}): Persona {
  const render = (i: LateAddEmailInput) =>
    renderBlocks(p.body(i), {
      text: (label) => renderPlaylistLineText(i, label),
      html: (label) => renderPlaylistButton(i, label),
    });
  return {
    key: p.key,
    subject: p.subject,
    text: (i) => render(i).text,
    html: (i) =>
      wrapHtml(escapeHtml((p.headline ?? p.subject)(i)), render(i).html),
  };
}

type CrewName = "Ben" | "Evan" | "Sachin" | "Sam";

// The line written for whoever is being roasted. `otherwise` is for a crew
// member who joined after the persona was written.
function forOffender<T>(
  i: Pick<LateAddEmailInput, "offender">,
  lines: Record<CrewName, T>,
  otherwise: T,
): T {
  const name = displayCrewName(i.offender);
  return Object.prototype.hasOwnProperty.call(lines, name)
    ? lines[name as CrewName]
    : otherwise;
}

// One line per crew member, least behind first.
function standingsList(i: LateAddEmailInput): Block {
  return {
    list: standingsSorted(i.standings).map((row) => {
      const status =
        row.missedCount === 0 ? "caught up" : `${row.missedCount} behind`;
      const you = row.member.id === i.offender.id ? " — **that's you**" : "";
      return `${displayCrewName(row.member)}: ${status}${you}`;
    }),
  };
}

// The crew members who owe nothing, as "Sam", "Sam and Ben" or "Sam, Ben and
// Sachin". Null when everybody owes something.
function caughtUpNames(i: LateAddEmailInput): string | null {
  const names = standingsSorted(i.standings)
    .filter((row) => row.missedCount === 0)
    .map((row) => displayCrewName(row.member));
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// Whole calendar days, in the crew's time zone, between a moment and now:
// 0 is today, 1 is yesterday.
function daysSince(date: Date): number {
  const dayNumber = (d: Date) => {
    // en-CA formats a date as YYYY-MM-DD.
    const [year, month, day] = d
      .toLocaleDateString("en-CA", { timeZone: CREW_TIME_ZONE })
      .split("-")
      .map(Number);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return Math.max(0, dayNumber(new Date()) - dayNumber(date));
}

// "Thursday at 3:50pm", in the crew's time zone.
function formatDayAndTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: CREW_TIME_ZONE,
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} at ${part("hour")}:${part("minute")}${part("dayPeriod").toLowerCase()}`;
}
