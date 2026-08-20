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
  // Index into PERSONAS for the round-robin roast rotation. The caller
  // (route) tracks the global cursor; we just modulo into the list so
  // the input can never go out of bounds even if the caller forgets.
  personaIndex: number;
};

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

  const persona = PERSONAS[((input.personaIndex % PERSONAS.length) + PERSONAS.length) % PERSONAS.length];
  const subject = persona.subject(input);
  const text = persona.text(input);
  const html = persona.html(input);

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
    personaKey: persona.key,
  };
}

// ---------------------------------------------------------------------------
// Persona registry. Round-robin rotation, advanced once per successful send
// by the route. Append new entries to the end of PERSONAS to extend the
// rotation — historical sends will still resolve by ordinal position
// because we never delete or reorder.
//
// House style: this one goes TO the offender and CCs the whole crew, so it is
// a public shaming and should read like one — crass, personal, no mercy. Much
// harder than the Friday reminders, which are crew-wide and celebratory.
//
// A persona can't know WHICH crew member it's roasting (the rotation is
// global, the offender is whoever fell behind), so per-person facts don't
// work here. What does work is the shared archive as a measuring stick —
// Sachin's seventeen tracks in six minutes, Sam's eighty-eight Fridays, the
// two zero-second ghost tracks. Those land on any recipient because they are
// the standard the recipient is failing to meet. docs/crew-lore.md holds the
// mined facts; pull from there rather than inventing new ones.
// ---------------------------------------------------------------------------

type Persona = {
  key: string;
  subject: (i: LateAddEmailInput) => string;
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
];

// Public so the route can use it to seed the rotation cursor without
// importing the array directly.
export const LATE_ADD_PERSONA_COUNT = PERSONAS.length;

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
