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
