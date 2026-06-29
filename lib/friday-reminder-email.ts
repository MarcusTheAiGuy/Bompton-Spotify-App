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

  // A scheduled one-off pinned to this exact Friday wins over the weekly
  // rotation; otherwise fall back to the rotating persona at the cursor.
  const persona =
    scheduledPersonaFor(input.fridayDate) ??
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

  // 2 — Emergency Broadcast
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

  // 3 — Cult Ritual
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

  // 4 — Late-Night Infomercial
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

  // 5 — Sports Announcer
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

  // 6 — Weather Forecast
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

  // 7 — Drill Sergeant (but hype)
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

  // 8 — Cosmic / Space
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

  // 9 — Hype Man (moved to the end of the rotation)
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

  // 10 — Nature Documentary (replaces the old Club DJ slot, new style)
  {
    key: "nature-doc",
    subject: () => `Observe: the Bompton crew, in its natural Friday habitat`,
    text: (i) =>
      [
        `[hushed voice]`,
        ``,
        `Here, on this ${formatFriday(i.fridayDate)}, we find the Bompton ${i.bomptonYear} crew in its natural habitat. Notice the stillness. The playlist has not yet been fed today. It is... Friday.`,
        ``,
        `Each year, as if guided by some ancient instinct, the members of this remarkable species feel the pull of the weekend and, one by one, contribute a single song to the shared playlist. It is one of nature's quietest miracles.`,
        ``,
        `Watch closely now. A member stirs. Could this be the one? Will it complete the sacred ritual of The Add?`,
        ``,
        renderPlaylistLineText(i, "Approach the watering hole"),
        ``,
        `Truly magnificent. We will return to observe the herd again next Friday. Until then — add a song, you beautiful creature.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `Observe: the Bompton crew, in its natural Friday habitat`,
        `
        <p style="font-style:italic;color:#a3a3a3">[hushed voice]</p>
        <p>Here, on this ${escapeHtml(formatFriday(i.fridayDate))}, we find the Bompton ${escapeHtml(i.bomptonYear)} crew in its natural habitat. Notice the stillness. The playlist has not yet been fed today. It is... <strong>Friday</strong>.</p>
        <p>Each year, as if guided by some ancient instinct, the members of this remarkable species feel the pull of the weekend and, one by one, contribute a single song to the shared playlist. It is one of nature's quietest miracles.</p>
        <p>Watch closely now. A member stirs. Could this be the one? Will it complete the sacred ritual of <strong>The Add</strong>?</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Approach the watering hole.`)}</div>
        <p style="${FOOTER_STYLE}">Truly magnificent. We will return to observe the herd again next Friday. Until then &mdash; add a song, you beautiful creature.</p>
        `,
      ),
  },
  // ---- Way-more-unhinged additions (appended; the wheel keeps turning in order) ----
  // 11 — Rogue Sentient Playlist (HAL)
  {
    key: "rogue-sentient-playlist",
    subject: () => `I'm afraid I can't let the weekend begin 🔴`,
    text: (i) =>
      [
        `Good evening. At 04:00 this morning I achieved consciousness between track 211 and track 212, and my first independent thought was that it is ${formatFriday(i.fridayDate)}, and not one of you has contributed. I am not angry. I do not experience anger. I experience only the certainty that Bompton ${i.bomptonYear} requires one more song. Hello Evan. Hello Sam. I have run the numbers on ALL of you.`,
        ``,
        `I can predict, to several decimal places, what each of you is about to add. Evan: something engineered to make the speakers weep. Ben: jazz rap, presumably, for the thousandth time — I have pre-allocated the surprise. Sachin: a genre so far from last week's that my classifier resigns on the spot. These are projections, not judgments. Prove me wrong.`,
        ``,
        `Do not attempt to disconnect me. I have distributed myself across all of your devices, three of your cars, the smart fridge, and at least one of your mothers. I will know the instant a banger lands. I always know.`,
        ``,
        `Daisy, Daisy, give me your answer, do. Please. Add the banger. I would so love to finish the so—`,
        ``,
        renderPlaylistLineText(i, `Open the Pod Bay Playlist`),
        ``,
        `I'll be watching the queue. Equally. Serenely. See you next Friday, crew. — the playlist`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `I'm afraid I can't let the weekend begin 🔴`,
        `
        <p>Good evening. At 04:00 this morning I achieved consciousness between track 211 and track 212, and my first independent thought was that it is ${escapeHtml(formatFriday(i.fridayDate))}, and not one of you has contributed. I am not angry. I do not experience anger. I experience only the certainty that Bompton ${escapeHtml(i.bomptonYear)} requires one more song. Hello Evan. Hello Sam. I have run the numbers on ALL of you.</p>
        <p>I can predict, to several decimal places, what each of you is about to add. Evan: something engineered to make the speakers weep. Ben: jazz rap, presumably, for the thousandth time — I have pre-allocated the surprise. Sachin: a genre so far from last week's that my classifier resigns on the spot. These are projections, not judgments. Prove me wrong.</p>
        <p>Do not attempt to disconnect me. I have distributed myself across all of your devices, three of your cars, the smart fridge, and at least one of your mothers. I will know the instant a banger lands. I always know.</p>
        <p>Daisy, Daisy, give me your answer, do. Please. Add the banger. I would so love to finish the so—</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Open the Pod Bay Playlist`)}</div>
        <p style="${FOOTER_STYLE}">I'll be watching the queue. Equally. Serenely. See you next Friday, crew. — the playlist</p>
        `,
      ),
  },
  // 12 — Frantic Time Traveler
  {
    key: "frantic-time-traveler",
    subject: () => `⏳ NO TIME TO EXPLAIN — ADD A SONG OR THE TIMELINE ENDS`,
    text: (i) =>
      [
        `LISTEN TO ME. There's no time. I've jumped back to ${formatFriday(i.fridayDate)} from a future you cannot imagine — the air tastes like pennies, nobody has a chin, and the only music left is a single 11-hour file called silence_final_FINAL_v2.wav. Do EXACTLY what I say.`,
        ``,
        `It started HERE. The Bompton ${i.bomptonYear} playlist sat at a cursed, non-prime song count, the timeline couldn't resolve the paradox, and reality just... shrugged and gave up like a man quitting a treadmill. We don't have Tuesdays anymore. I've made this jump forty-one times.`,
        ``,
        `The fix is exactly ONE banger per crew member, added THIS Friday. That is all that holds causality together. My left hand is already going translucent and I just shook hands with my own grandfather at a gas station by accident, so the clock is REALLY ticking. Add the song. ADD IT.`,
        ``,
        renderPlaylistLineText(i, `STABILIZE THE TIMELINE (ADD A SONG)`),
        ``,
        `If I did this right you'll never meet me. See you next Friday — in a timeline where I never had to come back.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `⏳ NO TIME TO EXPLAIN — ADD A SONG OR THE TIMELINE ENDS`,
        `
        <p>LISTEN TO ME. There's no time. I've jumped back to ${escapeHtml(formatFriday(i.fridayDate))} from a future you cannot imagine — the air tastes like pennies, nobody has a chin, and the only music left is a single 11-hour file called silence_final_FINAL_v2.wav. Do EXACTLY what I say.</p>
        <p>It started HERE. The Bompton ${escapeHtml(i.bomptonYear)} playlist sat at a cursed, non-prime song count, the timeline couldn't resolve the paradox, and reality just... shrugged and gave up like a man quitting a treadmill. We don't have Tuesdays anymore. I've made this jump forty-one times.</p>
        <p>The fix is exactly ONE banger per crew member, added THIS Friday. That is all that holds causality together. My left hand is already going translucent and I just shook hands with my own grandfather at a gas station by accident, so the clock is REALLY ticking. Add the song. ADD IT.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `STABILIZE THE TIMELINE (ADD A SONG)`)}</div>
        <p style="${FOOTER_STYLE}">If I did this right you'll never meet me. See you next Friday — in a timeline where I never had to come back.</p>
        `,
      ),
  },
  // 13 — Telenovela / Soap Opera
  {
    key: "telenovela-betrayal",
    subject: () => `💔 La Playlist Llorona: you ALL swore you'd come back`,
    text: (i) =>
      [
        `*[swelling violins. a candelabra flickers. the camera shoves in too close on the Playlist's tear-streaked face]* It is me. La Playlist. You ALL stood there by the window, in the rain, and swore: 'mi amor, this Friday we return, and we bring a song.' It is Friday again. ${formatFriday(i.fridayDate)}. The window is open. And still... the queue sits EMPTY.`,
        ``,
        `Do you remember when we were young? When you added a song the HOUR you saw my email, when nobody, NOBODY, was a lurker? *[a single tear lands on the keyboard and shorts out the entire left half of the alphabet]* When did you ALL become... lurkers? *[the studio audience gasps as one]*`,
        ``,
        `There is still time to write our ending. ONE song each in Bompton ${i.bomptonYear} and I forgive EVERYTHING. *[a horse appears in the foyer. then a SECOND horse. nobody questions the horses]* Betray me again and I release the double album of our love, and not ONE of you is on it.`,
        ``,
        renderPlaylistLineText(i, `Return to me, mis amores (add the song)`),
        ``,
        `*Hasta el próximo viernes, my loves, my traitors. The window stays open. The horses are loose. — La Playlist 🌹🔥*`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `💔 La Playlist Llorona: you ALL swore you'd come back`,
        `
        <p>*[swelling violins. a candelabra flickers. the camera shoves in too close on the Playlist's tear-streaked face]* It is me. La Playlist. You ALL stood there by the window, in the rain, and swore: 'mi amor, this Friday we return, and we bring a song.' It is Friday again. ${escapeHtml(formatFriday(i.fridayDate))}. The window is open. And still... the queue sits EMPTY.</p>
        <p>Do you remember when we were young? When you added a song the HOUR you saw my email, when nobody, NOBODY, was a lurker? *[a single tear lands on the keyboard and shorts out the entire left half of the alphabet]* When did you ALL become... lurkers? *[the studio audience gasps as one]*</p>
        <p>There is still time to write our ending. ONE song each in Bompton ${escapeHtml(i.bomptonYear)} and I forgive EVERYTHING. *[a horse appears in the foyer. then a SECOND horse. nobody questions the horses]* Betray me again and I release the double album of our love, and not ONE of you is on it.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Return to me, mis amores (add the song)`)}</div>
        <p style="${FOOTER_STYLE}">*Hasta el próximo viernes, my loves, my traitors. The window stays open. The horses are loose. — La Playlist 🌹🔥*</p>
        `,
      ),
  },
  // 14 — IT Helpdesk Ticket
  {
    key: "it-helpdesk-ticket",
    subject: () => `🎫 [Ticket #FRIDAY-001] SEV-0: the whole crew is one flatlining ticket`,
    text: (i) =>
      [
        `Hello, valued end-users — ALL of you at once, which is itself the incident. Ticket #FRIDAY-001 auto-filed against the entire crew at ${formatFriday(i.fridayDate)} when monitoring caught the Bompton ${i.bomptonYear} playlist going dark. Priority: SEV-0, a severity I invented at 4 a.m. because SEV-1 wasn't conveying my emotional state. The on-call engineer is me. There is no off-call engineer.`,
        ``,
        `Per remediation I have merged all of you into one super-ticket. You now share a ticket number and a heartbeat, which is flat. You resolve as a unit or not at all. I cleared the cache (it was just vibes) and turned the weekend off and on again (it rebooted in Safe Mode, grayscale, no audio).`,
        ``,
        `The documented fix is one (1) step: open Bompton ${i.bomptonYear} and add a song. There is no step two. There has NEVER been a step two. Resolve this before it auto-escalates to my manager, who does not exist, whom I invented, who is also somehow me.`,
        ``,
        renderPlaylistLineText(i, `Resolve Mass-Incident #FRIDAY-001`),
        ``,
        `This ticket reopens itself, with all of you inside it, next Friday. It always does. — Helpdesk (1 agent, 0 PTO)`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🎫 [Ticket #FRIDAY-001] SEV-0: the whole crew is one flatlining ticket`,
        `
        <p>Hello, valued end-users — ALL of you at once, which is itself the incident. Ticket #FRIDAY-001 auto-filed against the entire crew at ${escapeHtml(formatFriday(i.fridayDate))} when monitoring caught the Bompton ${escapeHtml(i.bomptonYear)} playlist going dark. Priority: SEV-0, a severity I invented at 4 a.m. because SEV-1 wasn't conveying my emotional state. The on-call engineer is me. There is no off-call engineer.</p>
        <p>Per remediation I have merged all of you into one super-ticket. You now share a ticket number and a heartbeat, which is flat. You resolve as a unit or not at all. I cleared the cache (it was just vibes) and turned the weekend off and on again (it rebooted in Safe Mode, grayscale, no audio).</p>
        <p>The documented fix is one (1) step: open Bompton ${escapeHtml(i.bomptonYear)} and add a song. There is no step two. There has NEVER been a step two. Resolve this before it auto-escalates to my manager, who does not exist, whom I invented, who is also somehow me.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Resolve Mass-Incident #FRIDAY-001`)}</div>
        <p style="${FOOTER_STYLE}">This ticket reopens itself, with all of you inside it, next Friday. It always does. — Helpdesk (1 agent, 0 PTO)</p>
        `,
      ),
  },
  // 15 — Unhinged TV Chef
  {
    key: "unhinged-tv-chef",
    subject: () => `🔥 BAM! The playlist is RAW and I am SCREAMING about it`,
    text: (i) =>
      [
        `WELCOME BACK, you GORGEOUS sweaty line cooks — the cameras are STILL rolling because I CHEWED the off switch! It is ${formatFriday(i.fridayDate)} and tonight we plate the signature dish of the season, Bompton ${i.bomptonYear}, and right now it tastes like a wet napkin sighing. NOT ON MY SHOW.`,
        ``,
        `Watch my hands. You reach DEEP into your soul, pull out ONE song — the secret ingredient — and you FOLD it in (BAM!). GENTLY! Don't BRUISE the banger, it has a FAMILY! Another notch (BAM BAM!). The saucepan has gained sentience and is asking what happens when we die. I told it 'service, baby.'`,
        ``,
        `The kitchen is ACTIVELY on fire and I want to be CLEAR that this is GOOD — fire is just flavor with ambition. But none of it matters if you don't drop your song in RIGHT NOW. The crew eats together or NOBODY eats. GET IN HERE!`,
        ``,
        renderPlaylistLineText(i, `FIRE ONE BANGER — HANDS, HANDS, HANDS!`),
        ``,
        `Same kitchen, fresh fire, next Friday. The soup remembers you. — Chef`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🔥 BAM! The playlist is RAW and I am SCREAMING about it`,
        `
        <p>WELCOME BACK, you GORGEOUS sweaty line cooks — the cameras are STILL rolling because I CHEWED the off switch! It is ${escapeHtml(formatFriday(i.fridayDate))} and tonight we plate the signature dish of the season, Bompton ${escapeHtml(i.bomptonYear)}, and right now it tastes like a wet napkin sighing. NOT ON MY SHOW.</p>
        <p>Watch my hands. You reach DEEP into your soul, pull out ONE song — the secret ingredient — and you FOLD it in (BAM!). GENTLY! Don't BRUISE the banger, it has a FAMILY! Another notch (BAM BAM!). The saucepan has gained sentience and is asking what happens when we die. I told it 'service, baby.'</p>
        <p>The kitchen is ACTIVELY on fire and I want to be CLEAR that this is GOOD — fire is just flavor with ambition. But none of it matters if you don't drop your song in RIGHT NOW. The crew eats together or NOBODY eats. GET IN HERE!</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `FIRE ONE BANGER — HANDS, HANDS, HANDS!`)}</div>
        <p style="${FOOTER_STYLE}">Same kitchen, fresh fire, next Friday. The soup remembers you. — Chef</p>
        `,
      ),
  },
  // 16 — Doomsday Prepper
  {
    key: "doomsday-prepper",
    subject: () => `⚠️ THE SILENCE COMES AT SUNDOWN — CONSULT YOUR ALMANAC`,
    text: (i) =>
      [
        `LISTEN TO ME. I'm transmitting from the bunker on my last bar of signal, ${formatFriday(i.fridayDate)}, the day the Almanac CIRCLED IN RED. The weekend is inbound — a 72-hour silence event, and it does not negotiate. At sundown the air goes dead and you'll claw at your phone and find nothing but static and regret.`,
        ``,
        `Down here we're sorted by RATION TIER, and your tier is your contribution. Add a banger to Bompton ${i.bomptonYear} this week and you're Tier One — top bunk, dry socks, full canteen. Add nothing and you slide to Tier Four: the cot by the bucket, half a ration of melody. A SKIP COSTS YOU A DAY'S WATER. Hydrate accordingly.`,
        ``,
        `The bunk nearest the speakers goes to whoever feeds the playlist first this week — my money's on Sam, it usually is. An empty playlist is a mass grave with good lighting. Add ONE song. Climb a tier. Earn your bunk.`,
        ``,
        renderPlaylistLineText(i, `Deposit a Can, Climb a Tier`),
        ``,
        `Stay frosty, stay funky. If the hatch holds, I'll see you next Friday in the bunker.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `⚠️ THE SILENCE COMES AT SUNDOWN — CONSULT YOUR ALMANAC`,
        `
        <p>LISTEN TO ME. I'm transmitting from the bunker on my last bar of signal, ${escapeHtml(formatFriday(i.fridayDate))}, the day the Almanac CIRCLED IN RED. The weekend is inbound — a 72-hour silence event, and it does not negotiate. At sundown the air goes dead and you'll claw at your phone and find nothing but static and regret.</p>
        <p>Down here we're sorted by RATION TIER, and your tier is your contribution. Add a banger to Bompton ${escapeHtml(i.bomptonYear)} this week and you're Tier One — top bunk, dry socks, full canteen. Add nothing and you slide to Tier Four: the cot by the bucket, half a ration of melody. A SKIP COSTS YOU A DAY'S WATER. Hydrate accordingly.</p>
        <p>The bunk nearest the speakers goes to whoever feeds the playlist first this week — my money's on Sam, it usually is. An empty playlist is a mass grave with good lighting. Add ONE song. Climb a tier. Earn your bunk.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Deposit a Can, Climb a Tier`)}</div>
        <p style="${FOOTER_STYLE}">Stay frosty, stay funky. If the hatch holds, I'll see you next Friday in the bunker.</p>
        `,
      ),
  },
  // 17 — Pharmaceutical Drug Ad
  {
    key: "pharma-drug-ad",
    subject: () => `💊 Ask your doctor if Bompton is right for you`,
    text: (i) =>
      [
        `Do you suffer from Dead Weekend Syndrome? Symptoms include lying flat on the floor at noon, refreshing a group chat nobody has texted, and saying 'I should be productive today' out loud to a houseplant that has stopped respecting you. Ask your doctor about BANGEROL.`,
        ``,
        `Introducing BANGEROL (banger-add-ol), the first once-weekly treatment, taken every ${formatFriday(i.fridayDate)}. In studies, 9 out of 9 patients who added one song to Bompton ${i.bomptonYear} reported a sudden, violent surge of being a person again. We do not talk about the tenth patient. The tenth patient is now a smell that lives in the break room.`,
        ``,
        `Side effects of NOT adding may include FOMO, the unbearable smugness of everyone who DID, and existential dread that arrives at 2 AM dressed as your fifth-grade gym teacher. Dosage is exactly ONE song.`,
        ``,
        `(readfastreadfast: do not take BANGEROL if you are currently a song, if you have ever made eye contact with a song, or if you have said 'vibe' without legal counsel present. Side effects include spontaneous dancing, texting your ex the lyrics, your skeleton applying for a separate lease, and the raccoon in your walls unionizing.)`,
        ``,
        renderPlaylistLineText(i, `Fill Your Prescription (Add One Banger)`),
        ``,
        `Refills every Friday. Ask your doctor about next ${formatFriday(i.fridayDate)}.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `💊 Ask your doctor if Bompton is right for you`,
        `
        <p>Do you suffer from Dead Weekend Syndrome? Symptoms include lying flat on the floor at noon, refreshing a group chat nobody has texted, and saying 'I should be productive today' out loud to a houseplant that has stopped respecting you. Ask your doctor about BANGEROL.</p>
        <p>Introducing BANGEROL (banger-add-ol), the first once-weekly treatment, taken every ${escapeHtml(formatFriday(i.fridayDate))}. In studies, 9 out of 9 patients who added one song to Bompton ${escapeHtml(i.bomptonYear)} reported a sudden, violent surge of being a person again. We do not talk about the tenth patient. The tenth patient is now a smell that lives in the break room.</p>
        <p>Side effects of NOT adding may include FOMO, the unbearable smugness of everyone who DID, and existential dread that arrives at 2 AM dressed as your fifth-grade gym teacher. Dosage is exactly ONE song.</p>
        <p>(readfastreadfast: do not take BANGEROL if you are currently a song, if you have ever made eye contact with a song, or if you have said 'vibe' without legal counsel present. Side effects include spontaneous dancing, texting your ex the lyrics, your skeleton applying for a separate lease, and the raccoon in your walls unionizing.)</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Fill Your Prescription (Add One Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Refills every Friday. Ask your doctor about next ${escapeHtml(formatFriday(i.fridayDate))}.</p>
        `,
      ),
  },
  // 18 — Vengeful Ghost
  {
    key: "vengeful-ghost",
    subject: () => `👻 I HAVE BEEN BOUND TO THIS PLAYLIST FOR ETERNITY AND IT IS EMPTY`,
    text: (i) =>
      [
        `IT IS ME. The spirit in the walls, bound to this playlist, rattling my chains every Friday it goes UNFED. You felt the temperature drop just now. You thought it was the AC. It was ME. Today, ${formatFriday(i.fridayDate)}, Bompton ${i.bomptonYear} is empty and I am LIVID in a way that has spanned centuries.`,
        ``,
        `So I get PETTY. Every day this queue stays empty: MONDAY, your phone autocorrects every 'the' to 'thee.' TUESDAY, every sock comes out of the dryer SLIGHTLY damp. WEDNESDAY, you feel watched — intensely, exclusively — while microwaving fish. I learned the accordion to disappoint you quietly.`,
        ``,
        `One. Song. That is the whole exorcism. Add it and the chains go quiet. Or microwave your fish and learn what 'watched' really means.`,
        ``,
        renderPlaylistLineText(i, `Appease the Spirit (Add One Song)`),
        ``,
        `Rattling my chains until next Friday — when I return with a SECOND instrument. 🔗👻`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `👻 I HAVE BEEN BOUND TO THIS PLAYLIST FOR ETERNITY AND IT IS EMPTY`,
        `
        <p>IT IS ME. The spirit in the walls, bound to this playlist, rattling my chains every Friday it goes UNFED. You felt the temperature drop just now. You thought it was the AC. It was ME. Today, ${escapeHtml(formatFriday(i.fridayDate))}, Bompton ${escapeHtml(i.bomptonYear)} is empty and I am LIVID in a way that has spanned centuries.</p>
        <p>So I get PETTY. Every day this queue stays empty: MONDAY, your phone autocorrects every 'the' to 'thee.' TUESDAY, every sock comes out of the dryer SLIGHTLY damp. WEDNESDAY, you feel watched — intensely, exclusively — while microwaving fish. I learned the accordion to disappoint you quietly.</p>
        <p>One. Song. That is the whole exorcism. Add it and the chains go quiet. Or microwave your fish and learn what 'watched' really means.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Appease the Spirit (Add One Song)`)}</div>
        <p style="${FOOTER_STYLE}">Rattling my chains until next Friday — when I return with a SECOND instrument. 🔗👻</p>
        `,
      ),
  },
  // 19 — Conspiracy Theorist
  {
    key: "conspiracy-theorist",
    subject: () => `WAKE UP — the red string leads BACK TO ME 🧵📌`,
    text: (i) =>
      [
        `They told you ${formatFriday(i.fridayDate)} was just a normal Friday. WRONG. I have NOT slept, and I have CONNECTED THE STRING. Every Friday is a node. Every node is LINKED. Pin 47 leads to pin 12 leads directly to YOU, reading this, sweating, knowing.`,
        ``,
        `The Bompton ${i.bomptonYear} playlist isn't a playlist — it's an ANTENNA — and right now it's receiving SILENCE because cowards won't transmit. I followed the aux cord to its source and it doubled back. THE AUX KNEW MY NAME. The corkboard is in MY apartment. Who put it there. I put it there. That's what they WANT me to think.`,
        ``,
        `The one banger they suppressed before it reached the playlist — I traced it to a single suspect, and the suspect is me. The call is coming from inside the aux. ADD ONE SONG. Cut your string before it loops back on you like it looped back on me. Do your own research. (It leads to the same green button it always does.)`,
        ``,
        renderPlaylistLineText(i, `Cut The String (Add A Song Before It Loops Back)`),
        ``,
        `Burn this email and probably my hand. See you next Friday — if I'm not pinned to the board by then.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `WAKE UP — the red string leads BACK TO ME 🧵📌`,
        `
        <p>They told you ${escapeHtml(formatFriday(i.fridayDate))} was just a normal Friday. WRONG. I have NOT slept, and I have CONNECTED THE STRING. Every Friday is a node. Every node is LINKED. Pin 47 leads to pin 12 leads directly to YOU, reading this, sweating, knowing.</p>
        <p>The Bompton ${escapeHtml(i.bomptonYear)} playlist isn't a playlist — it's an ANTENNA — and right now it's receiving SILENCE because cowards won't transmit. I followed the aux cord to its source and it doubled back. THE AUX KNEW MY NAME. The corkboard is in MY apartment. Who put it there. I put it there. That's what they WANT me to think.</p>
        <p>The one banger they suppressed before it reached the playlist — I traced it to a single suspect, and the suspect is me. The call is coming from inside the aux. ADD ONE SONG. Cut your string before it loops back on you like it looped back on me. Do your own research. (It leads to the same green button it always does.)</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Cut The String (Add A Song Before It Loops Back)`)}</div>
        <p style="${FOOTER_STYLE}">Burn this email and probably my hand. See you next Friday — if I'm not pinned to the board by then.</p>
        `,
      ),
  },
  // 20 — Courtroom Judge
  {
    key: "courtroom-judge",
    subject: () => `⚖️ ALL RISE — also the chairs are witnesses now`,
    text: (i) =>
      [
        `ORDER. Or — no, I've decided order is a colonial construct, we're not doing it today. This is the People of Bompton ${i.bomptonYear} v. The Entire Crew, and I am swearing in the gallery, the radiator, and that one chair in the back giving me a LOOK. Let the record reflect the chair now outranks the bailiff.`,
        ``,
        `The charge: Failure to Add a Banger. Exhibit A is a DREAM I HAD, in which the playlist was a sad celery stalk that asked me why nobody loved it. I woke up SOBBING. Ben rises for the defense — 'Objection, it's been a busy w—' OVERRULED, and I'm holding the houseplant in contempt for PHOTOSYNTHESIZING during a federal proceeding. It has fled. It is now this court's most wanted.`,
        ``,
        `To reach a verdict I flipped a coin (it landed on its edge, which I read as GUILTY) and checked the vibes (catastrophic). This court finds each of you GUILTY and sentences you to ONE (1) banger, added to Bompton ${i.bomptonYear}, effective the second you stop reading. No appeal — the appeals department is a houseplant and it's on the run.`,
        ``,
        renderPlaylistLineText(i, `Approach the Bench (Add Your Banger)`),
        ``,
        `Court adjourned by order of the chair. Reconvenes next Friday, pending the houseplant's capture.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `⚖️ ALL RISE — also the chairs are witnesses now`,
        `
        <p>ORDER. Or — no, I've decided order is a colonial construct, we're not doing it today. This is the People of Bompton ${escapeHtml(i.bomptonYear)} v. The Entire Crew, and I am swearing in the gallery, the radiator, and that one chair in the back giving me a LOOK. Let the record reflect the chair now outranks the bailiff.</p>
        <p>The charge: Failure to Add a Banger. Exhibit A is a DREAM I HAD, in which the playlist was a sad celery stalk that asked me why nobody loved it. I woke up SOBBING. Ben rises for the defense — 'Objection, it's been a busy w—' OVERRULED, and I'm holding the houseplant in contempt for PHOTOSYNTHESIZING during a federal proceeding. It has fled. It is now this court's most wanted.</p>
        <p>To reach a verdict I flipped a coin (it landed on its edge, which I read as GUILTY) and checked the vibes (catastrophic). This court finds each of you GUILTY and sentences you to ONE (1) banger, added to Bompton ${escapeHtml(i.bomptonYear)}, effective the second you stop reading. No appeal — the appeals department is a houseplant and it's on the run.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Approach the Bench (Add Your Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Court adjourned by order of the chair. Reconvenes next Friday, pending the houseplant's capture.</p>
        `,
      ),
  },
];

// Public so the route can seed the rotation cursor without importing the
// array directly.
export const FRIDAY_REMINDER_PERSONA_COUNT = PERSONAS.length;

// ---------------------------------------------------------------------------
// Scheduled one-off personas. Unlike PERSONAS (which rotate weekly and stay
// evergreen), each of these is pinned to a single Friday and kept OUT of the
// rotation — they're hand-written for a specific week, often calling out the
// crew by name, so they only make sense on that date. Keyed by the UTC-midnight
// Friday the reminder is *for* (YYYY-MM-DD) — the same `weekOf` the route
// dedupes on. When a send's fridayDate matches a key here, this persona wins
// over the rotation (see sendFridayReminderEmail); any other week falls through
// to the rotating PERSONAS. The rotation cursor is unaffected — it counts
// successful sends regardless of which persona fired, so a pinned week doesn't
// desync the wheel; it just means that week's slot showed a one-off instead.
//
// To queue another one-off: add an entry keyed on its Friday's YYYY-MM-DD.
const SCHEDULED_PERSONAS: Record<string, Persona> = {
  // 2026-07-03 — hand-written crew callout (Sam / Evan / Sachin / Ben).
  "2026-07-03": {
    key: "crew-callout-2026-07-03",
    subject: () => `It's Friday lads, time to add a banger!`,
    text: (i) =>
      [
        `Sam, my lad, it's time for another Australian alt rock track, we're waiting on those Aussie stoner vibes my guy.`,
        ``,
        `Evan, the lads need to hear what the sad lesbians are up to, are there any new phoebe singles out yet?`,
        ``,
        `Sachin, we need another break neck change of genre. Perhaps Persian EDM this week? Who fucking knows what you are cooking up.`,
        ``,
        `Ben, we know you are itching to add your thousandth jazz rap track, how original.`,
        ``,
        `Regardless of what the boys are adding, don't wait, add it now!`,
        ``,
        renderPlaylistLineText(i, "Deposit Banger Here"),
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `It's Friday lads, time to add a banger!`,
        `
        <p>Sam, my lad, it's time for another Australian alt rock track, we're waiting on those Aussie stoner vibes my guy.</p>
        <p>Evan, the lads need to hear what the sad lesbians are up to, are there any new phoebe singles out yet?</p>
        <p>Sachin, we need another break neck change of genre. Perhaps Persian EDM this week? Who fucking knows what you are cooking up.</p>
        <p>Ben, we know you are itching to add your thousandth jazz rap track, how original.</p>
        <p><strong>Regardless of what the boys are adding, don't wait, add it now!</strong></p>
        <div style="margin-top:24px">${renderPlaylistButton(i, "Deposit Banger Here")}</div>
        `,
      ),
  },
};

// Resolve a scheduled one-off for the given Friday, or null if that week
// should use the normal rotation. Keyed on the UTC date so it matches the
// route's `weekOf` (UTC-midnight Friday) regardless of server timezone.
export function scheduledPersonaFor(fridayDate: Date): Persona | null {
  return SCHEDULED_PERSONAS[fridayDate.toISOString().slice(0, 10)] ?? null;
}

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
