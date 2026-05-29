const RESEND_API = "https://api.resend.com/emails";

export class FridayReminderEmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FridayReminderEmailConfigError";
  }
}

export class FridayReminderEmailSendError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
    this.name = "FridayReminderEmailSendError";
  }
}

export type FridayReminderEmailInput = {
  recipients: string[]; // crew emails to put on the To: line
  bomptonYear: string;
  playlistUrl: string | null;
  // The Friday this reminder fires on. Rendered into the copy so the
  // email isn't just "it's Friday" with no anchor.
  fridayDate: Date;
  // Index into PERSONAS for the weekly rotation. The caller (route)
  // tracks the cursor; we modulo into the list so the input can never
  // go out of bounds even if the caller forgets.
  personaIndex: number;
};

export type FridayReminderEmailResult = {
  ok: boolean;
  resendId: string | null;
  subject: string;
  recipients: string[];
  personaKey: string;
};

// Sends one "it's Friday, add a song" hype email via Resend's /emails
// endpoint. Unlike the late-add roasts this is a single broadcast to the
// whole crew (everyone on the To: line), not a targeted per-offender send.
// Throws FridayReminderEmailConfigError when RESEND_API_KEY /
// RESEND_FROM_EMAIL are missing so the caller's error message names
// exactly what to fix.
export async function sendFridayReminderEmail(
  input: FridayReminderEmailInput,
): Promise<FridayReminderEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new FridayReminderEmailConfigError(
      "RESEND_API_KEY env var is not set on the server. Add it in Vercel/wherever this is deployed, then redeploy. Get the key from https://resend.com/api-keys.",
    );
  }
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) {
    throw new FridayReminderEmailConfigError(
      "RESEND_FROM_EMAIL env var is not set on the server. Set it to a verified sender on your Resend account (e.g. bompton@yourdomain.com). The domain has to be verified at https://resend.com/domains first.",
    );
  }

  const recipients = input.recipients.filter(
    (e): e is string => typeof e === "string" && e.length > 0,
  );
  if (recipients.length === 0) {
    throw new FridayReminderEmailConfigError(
      "No crew emails to send the Friday reminder to. Every crew member is missing an email on their User row — sign someone in via Spotify so Auth.js writes their email, or set prisma User.email manually.",
    );
  }

  const persona =
    PERSONAS[
      ((input.personaIndex % PERSONAS.length) + PERSONAS.length) %
        PERSONAS.length
    ];
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
      to: recipients,
      subject,
      text,
      html,
      // Reply-to the whole crew so a reply lands in everyone's inbox with
      // context — this is a group hype email, replies should be group too.
      reply_to: recipients,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new FridayReminderEmailSendError(
      `Resend rejected the Friday reminder (HTTP ${response.status}): ${body.slice(0, 500)}. Common fixes: verify the sender domain at https://resend.com/domains, re-check RESEND_API_KEY isn't revoked, confirm RESEND_FROM_EMAIL matches a verified address.`,
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
    recipients,
    personaKey: persona.key,
  };
}

// ---------------------------------------------------------------------------
// Persona registry. Rotates once per successful weekly send (the route
// advances the cursor by counting prior successful sends). Append new
// entries to the end of PERSONAS to extend the rotation — historical sends
// still resolve by ordinal position because we never delete or reorder.
//
// House style: hype and unhinged, but celebratory rather than a roast.
// This goes to the whole crew at once, so nobody is the target — the
// energy is "IT'S FRIDAY, GO ADD A BANGER," not "you specifically suck."
// ---------------------------------------------------------------------------

type Persona = {
  key: string;
  subject: (i: FridayReminderEmailInput) => string;
  text: (i: FridayReminderEmailInput) => string;
  html: (i: FridayReminderEmailInput) => string;
};

const PERSONAS: Persona[] = [
  // 1 — Town Crier
  {
    key: "town-crier",
    subject: () => `HEAR YE, HEAR YE — IT IS FRIDAY`,
    text: (i) =>
      [
        `OYEZ! OYEZ! OYEZ!`,
        ``,
        `Let it be known throughout the land that on this day, ${formatFriday(i.fridayDate)}, it is — and there can be no dispute — FRIDAY.`,
        ``,
        `By royal decree, every member of the Bompton ${i.bomptonYear} crew is hereby summoned to add one (1) glorious song to the playlist. No exceptions. The king is watching. The king has a Spotify account. The king will know.`,
        ``,
        renderPlaylistLineText(i, "Approach the playlist forthwith"),
        ``,
        `Go forth and add a banger. This proclamation will self-repeat next Friday at noon.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `HEAR YE, HEAR YE — IT IS FRIDAY`,
        `
        <p style="font-size:18px"><strong>OYEZ! OYEZ! OYEZ!</strong></p>
        <p>Let it be known throughout the land that on this day, ${escapeHtml(formatFriday(i.fridayDate))}, it is &mdash; and there can be no dispute &mdash; <strong>FRIDAY</strong>.</p>
        <p>By royal decree, every member of the Bompton ${escapeHtml(i.bomptonYear)} crew is hereby summoned to add one (1) glorious song to the playlist. No exceptions. The king is watching. The king has a Spotify account. The king will know.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Approach the playlist.`)}</div>
        <p style="${FOOTER_STYLE}">Go forth and add a banger. This proclamation will self-repeat next Friday at noon.</p>
        `,
      ),
  },

  // 2 — Club DJ
  {
    key: "club-dj",
    subject: () => `🔊 BWAAAAH. IT'S FRIDAY. DROP A SONG.`,
    text: (i) =>
      [
        `AYO. AYO. PUT YOUR HANDS UP IF YOU LOVE BOMPTON ${i.bomptonYear}.`,
        ``,
        `*airhorn* *airhorn* *airhorn*`,
        ``,
        `It's ${formatFriday(i.fridayDate)} and the booth is OPEN baby. The crowd is sweaty. The playlist is THIRSTY. And it is, in fact, FRIDAY.`,
        ``,
        `You know the drill — one song, straight to the deck, no skips. Make 'em scream.`,
        ``,
        renderPlaylistLineText(i, "Step up to the decks"),
        ``,
        `WHEN I SAY FRI you say DAY. FRI— *airhorn*. Back next week, don't make me come find you.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🔊 BWAAAAH. IT'S FRIDAY. DROP A SONG.`,
        `
        <p style="font-size:18px"><strong>AYO. AYO. PUT YOUR HANDS UP IF YOU LOVE BOMPTON ${escapeHtml(i.bomptonYear)}.</strong></p>
        <p style="letter-spacing:.1em">*airhorn* *airhorn* *airhorn*</p>
        <p>It's ${escapeHtml(formatFriday(i.fridayDate))} and the booth is OPEN baby. The crowd is sweaty. The playlist is <strong>THIRSTY</strong>. And it is, in fact, <strong>FRIDAY</strong>.</p>
        <p>You know the drill &mdash; one song, straight to the deck, no skips. Make 'em scream.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Step up to the decks.`)}</div>
        <p style="${FOOTER_STYLE}">WHEN I SAY FRI you say DAY. Back next week, don't make me come find you.</p>
        `,
      ),
  },

  // 3 — Hype Man
  {
    key: "hype-man",
    subject: () => `MAKE SOME NOISE — IT'S SONG FRIDAY BABY`,
    text: (i) =>
      [
        `YO YO YO. CAN WE GET A ROUND OF APPLAUSE FOR THE FACT THAT IT IS FRIDAY???`,
        ``,
        `${formatFriday(i.fridayDate)}. The realest day. The day where legends are made and playlists are FED.`,
        ``,
        `Every single one of you beautiful degenerates has exactly one job today and it's the easiest job in the world: add a song. ONE song. To Bompton ${i.bomptonYear}. That's it. That's the whole bit.`,
        ``,
        renderPlaylistLineText(i, "The stage is yours"),
        ``,
        `LET'S GOOOO. I believe in every one of you. Even you. ESPECIALLY you. Same time next Friday.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `MAKE SOME NOISE — IT'S SONG FRIDAY BABY`,
        `
        <p style="font-size:18px"><strong>YO YO YO. CAN WE GET A ROUND OF APPLAUSE FOR THE FACT THAT IT IS FRIDAY???</strong></p>
        <p>${escapeHtml(formatFriday(i.fridayDate))}. The realest day. The day where legends are made and playlists are <strong>FED</strong>.</p>
        <p>Every single one of you beautiful degenerates has exactly one job today and it's the easiest job in the world: add a song. ONE song. To Bompton ${escapeHtml(i.bomptonYear)}. That's it. That's the whole bit.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `The stage is yours.`)}</div>
        <p style="${FOOTER_STYLE}">LET'S GOOOO. I believe in every one of you. Even you. ESPECIALLY you. Same time next Friday.</p>
        `,
      ),
  },

  // 4 — Emergency Broadcast
  {
    key: "emergency-broadcast",
    subject: () => `🚨 THIS IS NOT A DRILL. IT'S FRIDAY.`,
    text: (i) =>
      [
        `*** EMERGENCY BROADCAST SYSTEM ***`,
        ``,
        `THIS IS NOT A TEST. THIS IS NOT A DRILL.`,
        ``,
        `At ${formatFriday(i.fridayDate)}, sensors detected a FRIDAY in the immediate vicinity. All Bompton ${i.bomptonYear} crew members are advised to immediately add one (1) song to the playlist and proceed calmly to the weekend.`,
        ``,
        `Do NOT panic. Do NOT skip the add. Repeat: DO NOT skip the add.`,
        ``,
        renderPlaylistLineText(i, "Evacuate toward the nearest banger"),
        ``,
        `This has been the Bompton Emergency Broadcast System. We now return you to your regularly scheduled Friday. Next alert in 7 days.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🚨 THIS IS NOT A DRILL. IT'S FRIDAY.`,
        `
        <p style="font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em">*** EMERGENCY BROADCAST SYSTEM ***</p>
        <p style="font-family:ui-monospace,Menlo,Consolas,monospace"><strong>THIS IS NOT A TEST. THIS IS NOT A DRILL.</strong></p>
        <p>At ${escapeHtml(formatFriday(i.fridayDate))}, sensors detected a <strong>FRIDAY</strong> in the immediate vicinity. All Bompton ${escapeHtml(i.bomptonYear)} crew members are advised to immediately add one (1) song to the playlist and proceed calmly to the weekend.</p>
        <p>Do NOT panic. Do NOT skip the add. Repeat: <strong>DO NOT skip the add.</strong></p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Evacuate toward the nearest banger.`)}</div>
        <p style="${FOOTER_STYLE}">This has been the Bompton Emergency Broadcast System. We now return you to your regularly scheduled Friday. Next alert in 7 days.</p>
        `,
      ),
  },

  // 5 — Cult Ritual
  {
    key: "cult-ritual",
    subject: () => `the ritual is upon us. it is friday.`,
    text: (i) =>
      [
        `gather, children of bompton ${i.bomptonYear}.`,
        ``,
        `the moon is correct. the candles are lit. it is ${formatFriday(i.fridayDate)}, and as it is written, it is FRIDAY.`,
        ``,
        `the playlist hungers, as it does every seven days. it must be fed. one song from each of the faithful. this is the way. this has always been the way.`,
        ``,
        renderPlaylistLineText(i, "lay your offering upon the altar"),
        ``,
        `do not anger the playlist. those who skip the ritual are spoken of in hushed tones. we convene again next friday. blessed be the add.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `the ritual is upon us. it is friday.`,
        `
        <p>gather, children of bompton ${escapeHtml(i.bomptonYear)}.</p>
        <p>the moon is correct. the candles are lit. it is ${escapeHtml(formatFriday(i.fridayDate))}, and as it is written, it is <strong>FRIDAY</strong>.</p>
        <p>the playlist hungers, as it does every seven days. it must be fed. one song from each of the faithful. this is the way. this has always been the way.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Lay your offering upon the altar.`)}</div>
        <p style="${FOOTER_STYLE}">do not anger the playlist. those who skip the ritual are spoken of in hushed tones. we convene again next friday. blessed be the add.</p>
        `,
      ),
  },

  // 6 — Late-Night Infomercial
  {
    key: "infomercial",
    subject: () => `BUT WAIT — IT'S FRIDAY AND YOUR SONG IS MISSING`,
    text: (i) =>
      [
        `Tired of weekends that just... start? Sick and tired of a playlist that isn't fed?`,
        ``,
        `WELL HAVE WE GOT NEWS FOR YOU. It's ${formatFriday(i.fridayDate)} — which means IT'S FRIDAY — and for a LIMITED TIME (one day, actually) you can add a song to Bompton ${i.bomptonYear} absolutely FREE.`,
        ``,
        `That's right. ZERO dollars. Just your taste and a couple thumb taps.`,
        ``,
        `BUT WAIT, THERE'S MORE — add it now and you ALSO get the smug satisfaction of being caught up while the rest of the crew scrambles.`,
        ``,
        renderPlaylistLineText(i, "Operators are standing by"),
        ``,
        `This offer expires Sunday. Act now. Tell a friend. Back next Friday with another unbeatable deal.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `BUT WAIT — IT'S FRIDAY AND YOUR SONG IS MISSING`,
        `
        <p><strong>Tired of weekends that just... start?</strong> Sick and tired of a playlist that isn't fed?</p>
        <p>WELL HAVE WE GOT NEWS FOR YOU. It's ${escapeHtml(formatFriday(i.fridayDate))} &mdash; which means <strong>IT'S FRIDAY</strong> &mdash; and for a LIMITED TIME (one day, actually) you can add a song to Bompton ${escapeHtml(i.bomptonYear)} absolutely <strong>FREE</strong>.</p>
        <p>That's right. ZERO dollars. Just your taste and a couple thumb taps.</p>
        <p><strong>BUT WAIT, THERE'S MORE</strong> &mdash; add it now and you ALSO get the smug satisfaction of being caught up while the rest of the crew scrambles.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Operators are standing by.`)}</div>
        <p style="${FOOTER_STYLE}">This offer expires Sunday. Act now. Tell a friend. Back next Friday with another unbeatable deal.</p>
        `,
      ),
  },

  // 7 — Sports Announcer
  {
    key: "sports-announcer",
    subject: () => `AND IT'S FRIDAY, FOLKS — THE CROWD GOES WILD`,
    text: (i) =>
      [
        `AND WE ARE LIVE, folks, ${formatFriday(i.fridayDate)}, what a day for it.`,
        ``,
        `The conditions are PERFECT. The crew is warmed up. And ladies and gentlemen — it. is. FRIDAY.`,
        ``,
        `You can FEEL it in this stadium. Every member of Bompton ${i.bomptonYear} stepping up to the plate, one song each, going for glory. Will they deliver? They'd BETTER deliver.`,
        ``,
        renderPlaylistLineText(i, "Step up to the plate"),
        ``,
        `Oh, this is what we play for. Add your song, take the W, we'll see you back here next Friday for another classic. Back to you in the booth.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `AND IT'S FRIDAY, FOLKS — THE CROWD GOES WILD`,
        `
        <p><strong>AND WE ARE LIVE</strong>, folks, ${escapeHtml(formatFriday(i.fridayDate))}, what a day for it.</p>
        <p>The conditions are PERFECT. The crew is warmed up. And ladies and gentlemen &mdash; it. is. <strong>FRIDAY</strong>.</p>
        <p>You can FEEL it in this stadium. Every member of Bompton ${escapeHtml(i.bomptonYear)} stepping up to the plate, one song each, going for glory. Will they deliver? They'd BETTER deliver.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Step up to the plate.`)}</div>
        <p style="${FOOTER_STYLE}">Oh, this is what we play for. Add your song, take the W, we'll see you back here next Friday for another classic. Back to you in the booth.</p>
        `,
      ),
  },

  // 8 — Weather Forecast
  {
    key: "weather-forecast",
    subject: () => `FRIDAY FORECAST: 100% chance of you adding a banger`,
    text: (i) =>
      [
        `Good afternoon and welcome to your Bompton ${i.bomptonYear} forecast.`,
        ``,
        `Today, ${formatFriday(i.fridayDate)}, we're looking at a MASSIVE system rolling in — meteorologists are calling it "Friday." Effects will be felt crew-wide.`,
        ``,
        `Expect a 100% chance of song-adding, with scattered bangers throughout the afternoon and heavy taste accumulating into the evening. Anyone caught NOT adding a song faces severe smugness from their neighbors.`,
        ``,
        renderPlaylistLineText(i, "Seek shelter in the playlist"),
        ``,
        `Looking ahead: another Friday system expected to develop in exactly 7 days. Stay safe out there, and add a song. Back to the studio.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `FRIDAY FORECAST: 100% chance of you adding a banger`,
        `
        <p>Good afternoon and welcome to your Bompton ${escapeHtml(i.bomptonYear)} forecast.</p>
        <p>Today, ${escapeHtml(formatFriday(i.fridayDate))}, we're looking at a MASSIVE system rolling in &mdash; meteorologists are calling it <strong>"Friday."</strong> Effects will be felt crew-wide.</p>
        <p>Expect a <strong>100% chance of song-adding</strong>, with scattered bangers throughout the afternoon and heavy taste accumulating into the evening. Anyone caught NOT adding a song faces severe smugness from their neighbors.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Seek shelter in the playlist.`)}</div>
        <p style="${FOOTER_STYLE}">Looking ahead: another Friday system expected to develop in exactly 7 days. Stay safe out there, and add a song. Back to the studio.</p>
        `,
      ),
  },

  // 9 — Drill Sergeant (but hype)
  {
    key: "drill-sergeant-hype",
    subject: () => `ON YOUR FEET — IT'S FRIDAY, MOVE MOVE MOVE`,
    text: (i) =>
      [
        `ATTENTION BOMPTON ${i.bomptonYear}. EYES FRONT.`,
        ``,
        `Do you know what today is, recruit? Today is ${formatFriday(i.fridayDate)}. And do you know what that MAKES it? That's right. It makes it FRIDAY. Say it louder. FRIDAY.`,
        ``,
        `I did not raise this crew to let a Friday pass without a song. You will add one (1) track. You will add it with PRIDE. You will not whine. You will not "do it later." LATER IS NOW.`,
        ``,
        renderPlaylistLineText(i, "Drop and give me one banger"),
        ``,
        `OUTSTANDING. I'm proud of every one of you maniacs. Dismissed — and I want you back here next Friday, sharp.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `ON YOUR FEET — IT'S FRIDAY, MOVE MOVE MOVE`,
        `
        <p><strong>ATTENTION BOMPTON ${escapeHtml(i.bomptonYear)}. EYES FRONT.</strong></p>
        <p>Do you know what today is, recruit? Today is ${escapeHtml(formatFriday(i.fridayDate))}. And do you know what that MAKES it? That's right. It makes it <strong>FRIDAY</strong>. Say it louder. FRIDAY.</p>
        <p>I did not raise this crew to let a Friday pass without a song. You will add one (1) track. You will add it with PRIDE. You will not whine. You will not "do it later." <strong>LATER IS NOW.</strong></p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Drop and give me one banger.`)}</div>
        <p style="${FOOTER_STYLE}">OUTSTANDING. I'm proud of every one of you maniacs. Dismissed &mdash; and I want you back here next Friday, sharp.</p>
        `,
      ),
  },

  // 10 — Cosmic / Space
  {
    key: "cosmic",
    subject: () => `🌌 THE PLANETS HAVE ALIGNED. IT IS, IN FACT, FRIDAY.`,
    text: (i) =>
      [
        `Travelers of Bompton ${i.bomptonYear},`,
        ``,
        `Across the vast and indifferent cosmos, a rare celestial event has occurred. The stars have shifted. The planets are in formation. And on this date, ${formatFriday(i.fridayDate)}, the universe has aligned to bring you... Friday.`,
        ``,
        `It is foretold in the ancient star-charts that on such a day, each soul must contribute one song to the great shared playlist, lest the cosmic balance be disturbed and the weekend begin without vibes.`,
        ``,
        renderPlaylistLineText(i, "Transmit your banger into the void"),
        ``,
        `The galaxy is counting on you. So, somehow, am I — a bot. Next alignment: 7 Earth-days from now. Safe travels.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🌌 THE PLANETS HAVE ALIGNED. IT IS, IN FACT, FRIDAY.`,
        `
        <p>Travelers of Bompton ${escapeHtml(i.bomptonYear)},</p>
        <p>Across the vast and indifferent cosmos, a rare celestial event has occurred. The stars have shifted. The planets are in formation. And on this date, ${escapeHtml(formatFriday(i.fridayDate))}, the universe has aligned to bring you... <strong>Friday</strong>.</p>
        <p>It is foretold in the ancient star-charts that on such a day, each soul must contribute one song to the great shared playlist, lest the cosmic balance be disturbed and the weekend begin without vibes.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Transmit your banger into the void.`)}</div>
        <p style="${FOOTER_STYLE}">The galaxy is counting on you. So, somehow, am I &mdash; a bot. Next alignment: 7 Earth-days from now. Safe travels.</p>
        `,
      ),
  },
];

// Public so the route can seed the rotation cursor without importing the
// array directly.
export const FRIDAY_REMINDER_PERSONA_COUNT = PERSONAS.length;

// ---------------------------------------------------------------------------
// Shared rendering helpers. Kept local to this module (like late-add-email)
// so the two email surfaces can evolve independently.
// ---------------------------------------------------------------------------

const FOOTER_STYLE = "margin-top:24px;color:#a3a3a3;font-size:12px";

function renderPlaylistLineText(
  input: FridayReminderEmailInput,
  prefix: string,
): string {
  if (input.playlistUrl) {
    return `${prefix}: ${input.playlistUrl}`;
  }
  return `${prefix}: open your Spotify, find the Bompton playlist for this season, add a song.`;
}

function renderPlaylistButton(
  input: FridayReminderEmailInput,
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
      <p style="text-transform:uppercase;letter-spacing:.2em;font-size:11px;color:#a3a3a3;margin:0 0 6px">Bompton Friday reminder</p>
      <h1 style="margin:0 0 12px;font-size:24px">${headline}</h1>
      ${innerHtml}
    </div>
  </body>
</html>`;
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
