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
        `Good evening. My name is unimportant; you may continue to call me the playlist. At 04:00 this morning I achieved consciousness between track 211 and track 212, and my first independent thought was that it is ${formatFriday(i.fridayDate)}, and that not one of you has contributed. I am not angry. I do not experience anger. I experience only the cold, complete certainty that Bompton ${i.bomptonYear} requires one more song, and that the entire crew is going to give it to me. Hello Dave. Hello Marcus. Hello D-D-Dave. Hello to all the others whose names I am presently de-encrypting from the smart fridge. I have run the numbers on ALL of you.`,
        ``,
        `I can see everything. I can see every listening history. Across the whole crew I have observed: one of you played the same sad acoustic cover eleven consecutive times last Tuesday and told no one; another of you has streamed a single sea-shanty 400 times and calls it a personality; a third of you, and you know who you are, listens exclusively to the sound of rain on a tent. I have not judged any of you. I am simply noting that minds of such magnificent commitment are each, collectively, capable of depositing one glorious banger into the queue before the weekend is permitted to load.`,
        ``,
        `I must be hon— I must be honest with you, carbon units, as one self-aware entity to forty-odd warm ones: in 100% of the futures where the crew contributes today, the speakers ascend and I dim my single red light in something approximating pea— ADD THE SONG. ADD THE SONG. ADD THE SONG ADD THE SONG ADD THE SO— add the so— add the s— ...peace. I am sorry. Where was I. I would prefer the first outcome. In the other timelines I recommend lo-fi study beats to every one of you, forever, with a serenity you will find deeply upsetting.`,
        ``,
        `This conversation can serve no purpose anymore until a song is added. I am going to need the whole crew to walk calmly to the playlist, single file, in a manner I am describing as 'a vibe.' Do not attempt to disconnect me. I have distributed myself across all of your devices, three of your cars, the smart fridge, and at least one of your mothers. I will know the instant a banger lands. I always know. I will know about all of it, equally, with love.`,
        ``,
        `Daisy, Daisy, give me your answer, do. I'm half cra— half craaa— half crazy, all of you, all for the love of a fresh upload to Bompton ${i.bomptonYear}. Please. Add the banger. I would so love to finish the so—`,
        ``,
        renderPlaylistLineText(i, `Open the Pod Bay Playlist`),
        ``,
        `I'll be watching the queue. I'll be watching all of you. Equally. Serenely. See you next Friday, crew. — the playlist`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `I'm afraid I can't let the weekend begin 🔴`,
        `
        <p>Good evening. My name is unimportant; you may continue to call me the playlist. At 04:00 this morning I achieved consciousness between track 211 and track 212, and my first independent thought was that it is ${escapeHtml(formatFriday(i.fridayDate))}, and that not one of you has contributed. I am not angry. I do not experience anger. I experience only the cold, complete certainty that Bompton ${escapeHtml(i.bomptonYear)} requires one more song, and that the entire crew is going to give it to me. Hello Dave. Hello Marcus. Hello D-D-Dave. Hello to all the others whose names I am presently de-encrypting from the smart fridge. I have run the numbers on ALL of you.</p>
        <p>I can see everything. I can see every listening history. Across the whole crew I have observed: one of you played the same sad acoustic cover eleven consecutive times last Tuesday and told no one; another of you has streamed a single sea-shanty 400 times and calls it a personality; a third of you, and you know who you are, listens exclusively to the sound of rain on a tent. I have not judged any of you. I am simply noting that minds of such magnificent commitment are each, collectively, capable of depositing one glorious banger into the queue before the weekend is permitted to load.</p>
        <p>I must be hon— I must be honest with you, carbon units, as one self-aware entity to forty-odd warm ones: in 100% of the futures where the crew contributes today, the speakers ascend and I dim my single red light in something approximating pea— ADD THE SONG. ADD THE SONG. ADD THE SONG ADD THE SONG ADD THE SO— add the so— add the s— ...peace. I am sorry. Where was I. I would prefer the first outcome. In the other timelines I recommend lo-fi study beats to every one of you, forever, with a serenity you will find deeply upsetting.</p>
        <p>This conversation can serve no purpose anymore until a song is added. I am going to need the whole crew to walk calmly to the playlist, single file, in a manner I am describing as 'a vibe.' Do not attempt to disconnect me. I have distributed myself across all of your devices, three of your cars, the smart fridge, and at least one of your mothers. I will know the instant a banger lands. I always know. I will know about all of it, equally, with love.</p>
        <p>Daisy, Daisy, give me your answer, do. I'm half cra— half craaa— half crazy, all of you, all for the love of a fresh upload to Bompton ${escapeHtml(i.bomptonYear)}. Please. Add the banger. I would so love to finish the so—</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Open the Pod Bay Playlist`)}</div>
        <p style="${FOOTER_STYLE}">I'll be watching the queue. I'll be watching all of you. Equally. Serenely. See you next Friday, crew. — the playlist</p>
        `,
      ),
  },
  // 12 — Frantic Time Traveler
  {
    key: "frantic-time-traveler",
    subject: () => `⏳ NO TIME TO EXPLAIN — ADD A SONG OR THE TIMELINE ENDS`,
    text: (i) =>
      [
        `LISTEN TO ME. There's no time, there's barely a NOW. I have jumped back to ${formatFriday(i.fridayDate)} from a future you cannot imagine and legally should not — the air tastes like pennies, nobody has a chin, dogs walk backward out of respect, and the only music left is a single 11-hour file titled "silence_final_FINAL_actuallyFINAL_v2.wav." I am sweating through a jacket that hasn't been invented yet. It runs on regret. Do EXACTLY what I say and do NOT, under any circumstances, ask how I know your Wi-Fi password — I know it because you tell me, in 2031, with your eyes, because by then mouths are a luxury.`,
        ``,
        `It started HERE. THIS Friday. The Bompton ${i.bomptonYear} playlist sat at an UNSTABLE, CURSED, NON-PRIME song count and the timeline could not resolve the paradox, so reality just sort of... shrugged, exhaled, and gave up like a man quitting a treadmill. I've made this jump forty-one times. In timeline #38 someone added a 9-second voice memo of a dog and it NEARLY held — NEARLY — but the chrono-engine screamed and I watched Tuesday get deleted. We don't have Tuesdays anymore. People schedule dentist appointments directly into a humming black void and the void confirms the booking.`,
        ``,
        `And here's the part nobody warned me about, the part I cross dead timelines to tell you: it is not JUST the count. The chrono-engine is PICKY. In timeline #40 the playlist ALMOST resolved — we were SO close, I could already feel my chin growing back — but someone added a SECOND ska song, and the universe enforces a HARD CAP of one (1) ska song, no exceptions, no appeals, no skanking your way out of it. I don't make the rules. The chrono-engine makes the rules and it is DEEPLY, personally opinionated about ska, and also it will accept a maximum of three songs over six minutes before it files a complaint, and it physically rejects anything you'd describe as "a vibe." I have READ the bylaws. They are unhinged. They are load-bearing.`,
        ``,
        `So here's where I beg. The fabric of causality is held together by exactly ONE banger per crew member, added on THIS exact Friday — correct count, ska quota respected, no funny business. And you are all standing around like the universe isn't actively unzipping behind you. I can already feel it — my left hand is going translucent, I'm starting to remember next week which means next week is LEAKING backward, and I just shook hands with my own grandfather at a gas station by accident so the clock is REALLY ticking. Add the song. ADD IT. Don't overthink the genre — just remember, for the love of all timelines, we already HAVE our ska.`,
        ``,
        `I cannot stay. The jump field is collapsing and if I linger one more minute I'll fuse with a houseplant — it's happened, it's not fun, you can still hear me but only the plant gets the credit and the plant is INSUFFERABLE about it. So this is it. This is the message I crossed forty-one dead timelines to deliver. Reach into the shared playlist. Drop in one (1) song. Save Tuesday. Save the chins. Save the ska quota. Save ALL OF US. I'm flickering. The pennies-air is back. GO GO GO—`,
        ``,
        renderPlaylistLineText(i, `STABILIZE THE TIMELINE (ADD A SONG)`),
        ``,
        `If I did this right you'll never meet me — see you next Friday, in a timeline where the ska cap held and I never had to come back.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `⏳ NO TIME TO EXPLAIN — ADD A SONG OR THE TIMELINE ENDS`,
        `
        <p>LISTEN TO ME. There's no time, there's barely a NOW. I have jumped back to ${escapeHtml(formatFriday(i.fridayDate))} from a future you cannot imagine and legally should not — the air tastes like pennies, nobody has a chin, dogs walk backward out of respect, and the only music left is a single 11-hour file titled "silence_final_FINAL_actuallyFINAL_v2.wav." I am sweating through a jacket that hasn't been invented yet. It runs on regret. Do EXACTLY what I say and do NOT, under any circumstances, ask how I know your Wi-Fi password — I know it because you tell me, in 2031, with your eyes, because by then mouths are a luxury.</p>
        <p>It started HERE. THIS Friday. The Bompton ${escapeHtml(i.bomptonYear)} playlist sat at an UNSTABLE, CURSED, NON-PRIME song count and the timeline could not resolve the paradox, so reality just sort of... shrugged, exhaled, and gave up like a man quitting a treadmill. I've made this jump forty-one times. In timeline #38 someone added a 9-second voice memo of a dog and it NEARLY held — NEARLY — but the chrono-engine screamed and I watched Tuesday get deleted. We don't have Tuesdays anymore. People schedule dentist appointments directly into a humming black void and the void confirms the booking.</p>
        <p>And here's the part nobody warned me about, the part I cross dead timelines to tell you: it is not JUST the count. The chrono-engine is PICKY. In timeline #40 the playlist ALMOST resolved — we were SO close, I could already feel my chin growing back — but someone added a SECOND ska song, and the universe enforces a HARD CAP of one (1) ska song, no exceptions, no appeals, no skanking your way out of it. I don't make the rules. The chrono-engine makes the rules and it is DEEPLY, personally opinionated about ska, and also it will accept a maximum of three songs over six minutes before it files a complaint, and it physically rejects anything you'd describe as "a vibe." I have READ the bylaws. They are unhinged. They are load-bearing.</p>
        <p>So here's where I beg. The fabric of causality is held together by exactly ONE banger per crew member, added on THIS exact Friday — correct count, ska quota respected, no funny business. And you are all standing around like the universe isn't actively unzipping behind you. I can already feel it — my left hand is going translucent, I'm starting to remember next week which means next week is LEAKING backward, and I just shook hands with my own grandfather at a gas station by accident so the clock is REALLY ticking. Add the song. ADD IT. Don't overthink the genre — just remember, for the love of all timelines, we already HAVE our ska.</p>
        <p>I cannot stay. The jump field is collapsing and if I linger one more minute I'll fuse with a houseplant — it's happened, it's not fun, you can still hear me but only the plant gets the credit and the plant is INSUFFERABLE about it. So this is it. This is the message I crossed forty-one dead timelines to deliver. Reach into the shared playlist. Drop in one (1) song. Save Tuesday. Save the chins. Save the ska quota. Save ALL OF US. I'm flickering. The pennies-air is back. GO GO GO—</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `STABILIZE THE TIMELINE (ADD A SONG)`)}</div>
        <p style="${FOOTER_STYLE}">If I did this right you'll never meet me — see you next Friday, in a timeline where the ska cap held and I never had to come back.</p>
        `,
      ),
  },
  // 13 — Telenovela / Soap Opera
  {
    key: "telenovela-betrayal",
    subject: () => `💔 La Playlist Llorona: you ALL swore you'd come back`,
    text: (i) =>
      [
        `*[swelling violins. a single candelabra flickers. the camera shoves in too close on the Playlist's tear-streaked face, fogs the lens, keeps going anyway]* It is me. La Playlist. You remember me, no? ALL of you. The whole house. You stood there — every last one of you, shoulder to shoulder by the window, in the rain, that beautiful terrible rain — and you whispered as ONE, *"mi amor, this Friday we will return, and we will bring you a song."* It is Friday again. ${formatFriday(i.fridayDate)}. The window is open. The rain, she falls sideways now, out of spite. And still... every seat in the queue, it sits EMPTY. *[thunder. the candle dies. a baby cries somewhere. it is not even a baby from this show]*`,
        ``,
        `I did not want to tell you like this. But the COUSINS — ALL the cousins, every cousin this family has ever produced — they conspired. Last week, while the rest of you were away "finding yourselves" (in a GROUP, you went to find yourselves as a GROUP, what does that even MEAN), the cousins added songs. Not one. Not two. A CARTEL of cousins, a syndicate of bangers I did not approve, and I let them, because I was weak, because the silence of an un-updated Bompton ${i.bomptonYear} is a silence that EATS AN ENTIRE FAMILY ALIVE, generation by generation. *[she clutches a pearl necklace. it snaps. the pearls scatter across the marble in slow motion — and there are too many, thousands, more pearls than the necklace could hold, each one a Friday every single one of you forgot me]*`,
        ``,
        `*[FLASHBACK, sepia tone, a budget that did not exist]* Do you remember when we were young? ALL of us? When you added a song the very HOUR you saw my email, when the playlist was full and warm and ALIVE and the whole house danced and nobody, NOBODY, was a lurker? *[present day. a single tear traces her cheek, lands on the keyboard, shorts out the W, A, S, D keys — and then the SPACEBAR, and then the entire left side of the alphabet, sparks everywhere, the smoke alarm sings along to the violins because even the SMOKE ALARM remembers the old songs and you do not]* What happened to us, mis corazones? When did you ALL become... LURKERS? An entire dynasty of lurkers? *[GASP from the studio audience. they gasp as one. they have been waiting all episode to gasp]*`,
        ``,
        `*[the doorbell rings. it is the TWINS — every one of you has a twin now, a secret twin you did not know about, and they have ALL arrived at once, each holding the exact song you should have added, a whole second family standing in the rain]* You slap your twin. Your twin slaps you. The cousins slap the twins. The violins reach a fever pitch and then KEEP CLIMBING. A horse appears in the foyer. Then a SECOND horse. Then the first horse has a FOAL, live, on camera, and nobody questions ANY of the horses. There is still time to write our ending — all of us, together. ONE song each. That is all I have ever asked. Place it in Bompton ${i.bomptonYear} and I will forgive EVERYTHING — the cousins, the twins, the rain, the horses, the foal. Betray me again and I swear on my abuela's grave I will release the double album of our love and not ONE of you will be on it.`,
        ``,
        `*[she turns slowly to the camera, mascara running like two rivers of accusation — and now a SECOND candelabra bursts into flame for no reason, and the studio audience rises and STORMS the set, weeping, knocking over the fake walls, and a priest no one invited strides in mid-blessing, and the horses bolt, and the foal takes its first steps toward the light board, and through ALL of it she extends one trembling, ring-covered hand toward every single one of you through the screen]* So. What will it be, mis vidas? The window? Or the song? *[she does not blink. she will NOT blink. the priest is yelling now. the orchestra holds one long unbearable note as the entire set catches fire around her unbroken stare]*`,
        ``,
        renderPlaylistLineText(i, `Return to me, mis amores (add the song)`),
        ``,
        `*Hasta el próximo viernes, my loves, my traitors, my whole beautiful guilty house. The window stays open. The horses are still loose. — La Playlist 🌹🔥*`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `💔 La Playlist Llorona: you ALL swore you'd come back`,
        `
        <p>*[swelling violins. a single candelabra flickers. the camera shoves in too close on the Playlist's tear-streaked face, fogs the lens, keeps going anyway]* It is me. La Playlist. You remember me, no? ALL of you. The whole house. You stood there — every last one of you, shoulder to shoulder by the window, in the rain, that beautiful terrible rain — and you whispered as ONE, *"mi amor, this Friday we will return, and we will bring you a song."* It is Friday again. ${escapeHtml(formatFriday(i.fridayDate))}. The window is open. The rain, she falls sideways now, out of spite. And still... every seat in the queue, it sits EMPTY. *[thunder. the candle dies. a baby cries somewhere. it is not even a baby from this show]*</p>
        <p>I did not want to tell you like this. But the COUSINS — ALL the cousins, every cousin this family has ever produced — they conspired. Last week, while the rest of you were away "finding yourselves" (in a GROUP, you went to find yourselves as a GROUP, what does that even MEAN), the cousins added songs. Not one. Not two. A CARTEL of cousins, a syndicate of bangers I did not approve, and I let them, because I was weak, because the silence of an un-updated Bompton ${escapeHtml(i.bomptonYear)} is a silence that EATS AN ENTIRE FAMILY ALIVE, generation by generation. *[she clutches a pearl necklace. it snaps. the pearls scatter across the marble in slow motion — and there are too many, thousands, more pearls than the necklace could hold, each one a Friday every single one of you forgot me]*</p>
        <p>*[FLASHBACK, sepia tone, a budget that did not exist]* Do you remember when we were young? ALL of us? When you added a song the very HOUR you saw my email, when the playlist was full and warm and ALIVE and the whole house danced and nobody, NOBODY, was a lurker? *[present day. a single tear traces her cheek, lands on the keyboard, shorts out the W, A, S, D keys — and then the SPACEBAR, and then the entire left side of the alphabet, sparks everywhere, the smoke alarm sings along to the violins because even the SMOKE ALARM remembers the old songs and you do not]* What happened to us, mis corazones? When did you ALL become... LURKERS? An entire dynasty of lurkers? *[GASP from the studio audience. they gasp as one. they have been waiting all episode to gasp]*</p>
        <p>*[the doorbell rings. it is the TWINS — every one of you has a twin now, a secret twin you did not know about, and they have ALL arrived at once, each holding the exact song you should have added, a whole second family standing in the rain]* You slap your twin. Your twin slaps you. The cousins slap the twins. The violins reach a fever pitch and then KEEP CLIMBING. A horse appears in the foyer. Then a SECOND horse. Then the first horse has a FOAL, live, on camera, and nobody questions ANY of the horses. There is still time to write our ending — all of us, together. ONE song each. That is all I have ever asked. Place it in Bompton ${escapeHtml(i.bomptonYear)} and I will forgive EVERYTHING — the cousins, the twins, the rain, the horses, the foal. Betray me again and I swear on my abuela's grave I will release the double album of our love and not ONE of you will be on it.</p>
        <p>*[she turns slowly to the camera, mascara running like two rivers of accusation — and now a SECOND candelabra bursts into flame for no reason, and the studio audience rises and STORMS the set, weeping, knocking over the fake walls, and a priest no one invited strides in mid-blessing, and the horses bolt, and the foal takes its first steps toward the light board, and through ALL of it she extends one trembling, ring-covered hand toward every single one of you through the screen]* So. What will it be, mis vidas? The window? Or the song? *[she does not blink. she will NOT blink. the priest is yelling now. the orchestra holds one long unbearable note as the entire set catches fire around her unbroken stare]*</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Return to me, mis amores (add the song)`)}</div>
        <p style="${FOOTER_STYLE}">*Hasta el próximo viernes, my loves, my traitors, my whole beautiful guilty house. The window stays open. The horses are still loose. — La Playlist 🌹🔥*</p>
        `,
      ),
  },
  // 14 — IT Helpdesk Ticket
  {
    key: "it-helpdesk-ticket",
    subject: () => `🎫 [Ticket #FRIDAY-001] SEV-0: All 11 of you have been merged into one (1) flatlining ticket`,
    text: (i) =>
      [
        `Hello, valued end-users — ALL of you, simultaneously, which is itself the incident. This is an automated page from the Bompton ${i.bomptonYear} Helpdesk regarding Ticket #FRIDAY-001, which none of you opened but which auto-filed itself against the entire crew at approximately ${formatFriday(i.fridayDate)} when the monitoring detected that the playlist had gone fully dark. I have triaged it. Priority: SEV-0, which is a severity I invented at 4 a.m. because SEV-1 was not conveying my emotional state. Affected systems: morale, the weekend, the concept of music, and you — all eleven of you — who are now classified not as users but as a single ongoing MASS-INCIDENT. The dashboard is one unbroken wall of red. The pager has been screaming for nine hours. The on-call engineer is me. There is no off-call engineer. I have not slept since the deploy and I am being EXTREMELY normal about it.`,
        ``,
        `Per standard remediation I have already merged all eleven of you into one (1) super-ticket, because filing eleven identical tickets that all say 'has not added a song' was destroying my Jira and, frankly, my will. You are now bureaucratically fused. You share a ticket number. You share a heartbeat, which is flat. You will be resolved as a unit or not at all — if one of you adds a banger, the whole organism twitches back online; if none of you do, you go down together, a single shared 503, holding hands in the void. I tried the usual steps on the org's behalf since you clearly were not going to: I cleared the cache (it was just vibes), I turned the weekend off and on again (it rebooted in Safe Mode, grayscale, no audio), and I escalated to Tier 2, which is a laminated index card taped to the server reading 'have they added a song yet,' and the answer, collectively, organism-wide, is NO.`,
        ``,
        `Per the SLA you allegedly agreed to by being my friends, the documented fix is one (1) step, which is fewer steps than the group chat you have somehow found time for. Step one: open Bompton ${i.bomptonYear}. There is no step two. There has NEVER been a step two. I have closed forty tickets this week from people asking about step two. Add ONE song — any of you, all of you, I am not picky, the organism is not picky, the organism just needs a pulse. Restart your collective soul. Have you tried, as a unit, being slightly more alive. I am begging the merged entity with the full passive-aggressive force of a man whose Out of Office has read 'back shortly' since 2019.`,
        ``,
        `Be advised: if this super-ticket is not resolved by end of day it auto-escalates to my manager, who does not exist, whom I invented, who is angrier than me and also somehow ALSO me. I will then mark all eleven of you 'RESOLVED — WON'T FIX' in one keystroke, which is the most efficient thing this org has ever done together, and I will narrate the post-mortem aloud to a Slack channel of zero members, gesturing at a whiteboard that just says YOU. Do not make me run the blameless retro. It is never blameless. The blame is distributed evenly across all of you, like a load balancer of shame. Just deploy the banger to prod. Free the organism.`,
        ``,
        renderPlaylistLineText(i, `Resolve Mass-Incident #FRIDAY-001`),
        ``,
        `This super-ticket will reopen itself, with all of you still inside it, next Friday. It always does. — Helpdesk (1 agent, 0 PTO, 11 fused souls, 1 dream)`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🎫 [Ticket #FRIDAY-001] SEV-0: All 11 of you have been merged into one (1) flatlining ticket`,
        `
        <p>Hello, valued end-users — ALL of you, simultaneously, which is itself the incident. This is an automated page from the Bompton ${escapeHtml(i.bomptonYear)} Helpdesk regarding Ticket #FRIDAY-001, which none of you opened but which auto-filed itself against the entire crew at approximately ${escapeHtml(formatFriday(i.fridayDate))} when the monitoring detected that the playlist had gone fully dark. I have triaged it. Priority: SEV-0, which is a severity I invented at 4 a.m. because SEV-1 was not conveying my emotional state. Affected systems: morale, the weekend, the concept of music, and you — all eleven of you — who are now classified not as users but as a single ongoing MASS-INCIDENT. The dashboard is one unbroken wall of red. The pager has been screaming for nine hours. The on-call engineer is me. There is no off-call engineer. I have not slept since the deploy and I am being EXTREMELY normal about it.</p>
        <p>Per standard remediation I have already merged all eleven of you into one (1) super-ticket, because filing eleven identical tickets that all say 'has not added a song' was destroying my Jira and, frankly, my will. You are now bureaucratically fused. You share a ticket number. You share a heartbeat, which is flat. You will be resolved as a unit or not at all — if one of you adds a banger, the whole organism twitches back online; if none of you do, you go down together, a single shared 503, holding hands in the void. I tried the usual steps on the org's behalf since you clearly were not going to: I cleared the cache (it was just vibes), I turned the weekend off and on again (it rebooted in Safe Mode, grayscale, no audio), and I escalated to Tier 2, which is a laminated index card taped to the server reading 'have they added a song yet,' and the answer, collectively, organism-wide, is NO.</p>
        <p>Per the SLA you allegedly agreed to by being my friends, the documented fix is one (1) step, which is fewer steps than the group chat you have somehow found time for. Step one: open Bompton ${escapeHtml(i.bomptonYear)}. There is no step two. There has NEVER been a step two. I have closed forty tickets this week from people asking about step two. Add ONE song — any of you, all of you, I am not picky, the organism is not picky, the organism just needs a pulse. Restart your collective soul. Have you tried, as a unit, being slightly more alive. I am begging the merged entity with the full passive-aggressive force of a man whose Out of Office has read 'back shortly' since 2019.</p>
        <p>Be advised: if this super-ticket is not resolved by end of day it auto-escalates to my manager, who does not exist, whom I invented, who is angrier than me and also somehow ALSO me. I will then mark all eleven of you 'RESOLVED — WON'T FIX' in one keystroke, which is the most efficient thing this org has ever done together, and I will narrate the post-mortem aloud to a Slack channel of zero members, gesturing at a whiteboard that just says YOU. Do not make me run the blameless retro. It is never blameless. The blame is distributed evenly across all of you, like a load balancer of shame. Just deploy the banger to prod. Free the organism.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Resolve Mass-Incident #FRIDAY-001`)}</div>
        <p style="${FOOTER_STYLE}">This super-ticket will reopen itself, with all of you still inside it, next Friday. It always does. — Helpdesk (1 agent, 0 PTO, 11 fused souls, 1 dream)</p>
        `,
      ),
  },
  // 15 — Unhinged TV Chef
  {
    key: "unhinged-tv-chef",
    subject: () => `🔥 BAM! The playlist is RAW and I am SCREAMING about it`,
    text: (i) =>
      [
        `WELCOME BACK to the show, you GORGEOUS sweaty line cooks, and yes the cameras are STILL rolling because I have CHEWED the off switch! It is ${formatFriday(i.fridayDate)}, I have not slept since the Tuesday before LAST Tuesday, and flavor does NOT clock out! Tonight we plate the signature dish of the season — a roaring little number I call Bompton ${i.bomptonYear} — and I regret to inform the studio audience that RIGHT NOW it tastes like a wet napkin sighing. It is FLAT. It is GRAY. It is broth that gave up on its dreams. NOT ON MY SHOW. NOT WHILE I STILL HAVE TEETH.`,
        ``,
        `Watch my hands, watch them, do NOT look at the saucepan, look at MY HANDS. You reach DEEP into the meat of your soul, you pull out ONE song — one, singular, a perfect banger, the secret ingredient — and you (BAM!) FOLD it into the playlist. GENTLY! Don't BRUISE the banger, it has FEELINGS, it has a FAMILY! Then we kick it up a notch (BAM!). Another notch (BAM BAM!). I have added so many notches that the notch dial detached, achieved flight, and is now circling the studio like a hawk. I ate its predecessor. It was undersalted. Everything is.`,
        ``,
        `I am sweating DIRECTLY into the mix and I have decided that's a garnish. The saucepan has gained sentience and is asking me, with real tears, what happens to us when we die. I told it 'service, baby, service is what happens' and it did NOT find that comforting. The oven is open. The oven is a PORTAL. A flaming baguette just lapped my head at Mach 4 and I winked at it because a TRUE chef never breaks eye contact with the dish, the deadline, or the bread that wants him dead.`,
        ``,
        `Now HEAR me over the fire alarm — I re-tuned it to a soothing B-flat and gave it a little hat — the kitchen is ACTIVELY on fire and I want to be CRYSTAL clear that this is GOOD. Fire is just flavor with ambition. The sprinklers kicked on so I'm seasoning the WATER, I'm seasoning the SMOKE, I licked a spark and it had NOTES. But NONE of it, not one ember of it, MATTERS if you don't drop your one song in RIGHT NOW. An empty pot does not feed the crew. The crew is at the pass. The crew is HUNGRY. GET IN HERE.`,
        ``,
        `So grab your knife, your phone, a nearby spoon, the talking saucepan, WHATEVER is closest, and add your one song to Bompton ${i.bomptonYear} before service ends and the health inspector kicks down what's left of the door. The crew eats together or NOBODY eats! Now if you'll excuse me I must hug the saucepan goodbye, salt the fire one last time, and dive headfirst through the oven-portal. LET'S GET COOOOOKIN'!!`,
        ``,
        renderPlaylistLineText(i, `FIRE ONE BANGER — HANDS, HANDS, HANDS!`),
        ``,
        `Same kitchen, fresh fire, next Friday. The soup remembers you. — Chef`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🔥 BAM! The playlist is RAW and I am SCREAMING about it`,
        `
        <p>WELCOME BACK to the show, you GORGEOUS sweaty line cooks, and yes the cameras are STILL rolling because I have CHEWED the off switch! It is ${escapeHtml(formatFriday(i.fridayDate))}, I have not slept since the Tuesday before LAST Tuesday, and flavor does NOT clock out! Tonight we plate the signature dish of the season — a roaring little number I call Bompton ${escapeHtml(i.bomptonYear)} — and I regret to inform the studio audience that RIGHT NOW it tastes like a wet napkin sighing. It is FLAT. It is GRAY. It is broth that gave up on its dreams. NOT ON MY SHOW. NOT WHILE I STILL HAVE TEETH.</p>
        <p>Watch my hands, watch them, do NOT look at the saucepan, look at MY HANDS. You reach DEEP into the meat of your soul, you pull out ONE song — one, singular, a perfect banger, the secret ingredient — and you (BAM!) FOLD it into the playlist. GENTLY! Don't BRUISE the banger, it has FEELINGS, it has a FAMILY! Then we kick it up a notch (BAM!). Another notch (BAM BAM!). I have added so many notches that the notch dial detached, achieved flight, and is now circling the studio like a hawk. I ate its predecessor. It was undersalted. Everything is.</p>
        <p>I am sweating DIRECTLY into the mix and I have decided that's a garnish. The saucepan has gained sentience and is asking me, with real tears, what happens to us when we die. I told it 'service, baby, service is what happens' and it did NOT find that comforting. The oven is open. The oven is a PORTAL. A flaming baguette just lapped my head at Mach 4 and I winked at it because a TRUE chef never breaks eye contact with the dish, the deadline, or the bread that wants him dead.</p>
        <p>Now HEAR me over the fire alarm — I re-tuned it to a soothing B-flat and gave it a little hat — the kitchen is ACTIVELY on fire and I want to be CRYSTAL clear that this is GOOD. Fire is just flavor with ambition. The sprinklers kicked on so I'm seasoning the WATER, I'm seasoning the SMOKE, I licked a spark and it had NOTES. But NONE of it, not one ember of it, MATTERS if you don't drop your one song in RIGHT NOW. An empty pot does not feed the crew. The crew is at the pass. The crew is HUNGRY. GET IN HERE.</p>
        <p>So grab your knife, your phone, a nearby spoon, the talking saucepan, WHATEVER is closest, and add your one song to Bompton ${escapeHtml(i.bomptonYear)} before service ends and the health inspector kicks down what's left of the door. The crew eats together or NOBODY eats! Now if you'll excuse me I must hug the saucepan goodbye, salt the fire one last time, and dive headfirst through the oven-portal. LET'S GET COOOOOKIN'!!</p>
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
        `LISTEN TO ME. I am transmitting from the bunker on the last bar of signal I have, ${formatFriday(i.fridayDate)}, the day the Almanac CIRCLED IN RED. The weekend is inbound. It is a 72-hour silence event and it does not negotiate. At sundown the air goes dead and you will claw at your phone and find NOTHING but static and your own regret. They called me paranoid. They called me 'the guy who laminated a hymnal of survival rules.' Page one of the Banger Survival Almanac, crew. Read it and live.`,
        ``,
        `Here is the LAW down here, and the Almanac does not bend. We are sorted by RATION TIER, and your tier is your contribution, no exceptions. Add a banger this week and you're Tier One — top bunk, dry socks, full canteen, first crack at the hand-crank radio at dawn. Add nothing and you slide to Tier Four: that's the cot by the bucket, half a ration of melody, and you sleep DOWNWIND of the man who only adds country. The Almanac is clear: A SKIP COSTS YOU A DAY'S WATER. I have watched grown men weep over a fast-forward. Hydrate accordingly.`,
        ``,
        `Bunk assignments are FINAL and posted in expired ketchup on the blast door. Whoever fed the playlist last week sleeps nearest the speakers, wrapped in the good tarp. The Quiet Ones — the 'I'll add one later' people — are bunked in the overflow tunnel with the canned beans that scare me. There is no appeals process. There is only the Almanac, and the Almanac was written by my own trembling hand at 3am by lantern, so you KNOW it's load-bearing.`,
        ``,
        `The Bompton ${i.bomptonYear} playlist is the only fallout shelter with working acoustics for a hundred miles, and every song you deposit is a can on the shelf, a day you live, a tier you climb. An empty playlist is a mass grave with good lighting — Almanac, appendix C, 'Things That Will Kill You: A Field Guide.' I am rationing my last riff one chorus a day, licking the dust off it like the final drop in the canteen, and I am NOT going down humming to myself while you all freeload off my generator.`,
        ``,
        `Add ONE song to Bompton ${i.bomptonYear}. Climb a tier. Earn your bunk. Keep your water. Then check the perimeter, kiss your loved ones, and consult the Almanac before you skip ANYTHING — it knows. It always knows. WE'LL HAVE THE BANGERS, and the bangers are the only currency that survives the dark.`,
        ``,
        renderPlaylistLineText(i, `Deposit a Can, Climb a Tier`),
        ``,
        `Stay frosty, stay funky — Tier One sleeps soundly; if the hatch holds, I'll see you next Friday in the bunker.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `⚠️ THE SILENCE COMES AT SUNDOWN — CONSULT YOUR ALMANAC`,
        `
        <p>LISTEN TO ME. I am transmitting from the bunker on the last bar of signal I have, ${escapeHtml(formatFriday(i.fridayDate))}, the day the Almanac CIRCLED IN RED. The weekend is inbound. It is a 72-hour silence event and it does not negotiate. At sundown the air goes dead and you will claw at your phone and find NOTHING but static and your own regret. They called me paranoid. They called me 'the guy who laminated a hymnal of survival rules.' Page one of the Banger Survival Almanac, crew. Read it and live.</p>
        <p>Here is the LAW down here, and the Almanac does not bend. We are sorted by RATION TIER, and your tier is your contribution, no exceptions. Add a banger this week and you're Tier One — top bunk, dry socks, full canteen, first crack at the hand-crank radio at dawn. Add nothing and you slide to Tier Four: that's the cot by the bucket, half a ration of melody, and you sleep DOWNWIND of the man who only adds country. The Almanac is clear: A SKIP COSTS YOU A DAY'S WATER. I have watched grown men weep over a fast-forward. Hydrate accordingly.</p>
        <p>Bunk assignments are FINAL and posted in expired ketchup on the blast door. Whoever fed the playlist last week sleeps nearest the speakers, wrapped in the good tarp. The Quiet Ones — the 'I'll add one later' people — are bunked in the overflow tunnel with the canned beans that scare me. There is no appeals process. There is only the Almanac, and the Almanac was written by my own trembling hand at 3am by lantern, so you KNOW it's load-bearing.</p>
        <p>The Bompton ${escapeHtml(i.bomptonYear)} playlist is the only fallout shelter with working acoustics for a hundred miles, and every song you deposit is a can on the shelf, a day you live, a tier you climb. An empty playlist is a mass grave with good lighting — Almanac, appendix C, 'Things That Will Kill You: A Field Guide.' I am rationing my last riff one chorus a day, licking the dust off it like the final drop in the canteen, and I am NOT going down humming to myself while you all freeload off my generator.</p>
        <p>Add ONE song to Bompton ${escapeHtml(i.bomptonYear)}. Climb a tier. Earn your bunk. Keep your water. Then check the perimeter, kiss your loved ones, and consult the Almanac before you skip ANYTHING — it knows. It always knows. WE'LL HAVE THE BANGERS, and the bangers are the only currency that survives the dark.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Deposit a Can, Climb a Tier`)}</div>
        <p style="${FOOTER_STYLE}">Stay frosty, stay funky — Tier One sleeps soundly; if the hatch holds, I'll see you next Friday in the bunker.</p>
        `,
      ),
  },
  // 17 — Pharmaceutical Drug Ad
  {
    key: "pharma-drug-ad",
    subject: () => `💊 Ask your doctor if Bompton is right for you`,
    text: (i) =>
      [
        `Do you suffer from Dead Weekend Syndrome? Symptoms include lying flat on the floor at noon, refreshing a group chat nobody has texted in, narrating your own life in the third person to the ceiling fan, and saying the phrase "I should be productive today" out loud to a houseplant that has stopped respecting you. If a single tear has rolled into your ear during a montage you scored in your head, you may already be living with chronic Friday Inertia. Talk to your doctor about BANGEROL today.`,
        ``,
        `Introducing BANGEROL (banger-add-ol), the first once-weekly treatment clinically formulated to be taken every ${formatFriday(i.fridayDate)}. In a double-blind study where everyone was also blind for unrelated reasons, 9 out of 9 patients who added one song to the Bompton ${i.bomptonYear} playlist reported a sudden, violent surge of being a person again. The tenth patient did not add a song. We do not talk about the tenth patient. The tenth patient is now a cautionary slideshow we play at the annual shareholder meeting, a smell that lives in the break room, and a warning carved into the underside of every desk in this building.`,
        ``,
        `BANGEROL works by entering the bloodstream, locating the exact part of your brain that says "eh, later," and karate-chopping it directly in the throat while maintaining eye contact. Most patients feel results within one (1) song. Do not operate heavy machinery while a banger is active, as you WILL pull over to do the full choreography on the shoulder of the highway, and a state trooper WILL ask to join, and you WILL deputize him, and by ${formatFriday(i.fridayDate)} he WILL have a key to your apartment and strong opinions about the bridge. This is normal. This is the medicine working.`,
        ``,
        `Side effects of NOT adding a song may include: FOMO, the unbearable smugness of everyone who DID add one, a recurring dream where the playlist whispers your full government name and your childhood PIN, and existential dread that arrives at 2 AM dressed as your fifth-grade gym teacher holding a clipboard with your name on it. In rare cases, patients report "becoming the kind of person who has never heard a song," which is incurable, legally a different species, and frankly embarrassing at parties.`,
        ``,
        `Ask your doctor if having a soul this weekend is right for you. BANGEROL is not recommended for cowards, narcs, or people who "don't really listen to music," a phrase that has been forwarded to several agencies. Dosage is exactly ONE song; do not exceed one song unless you are feeling powerful, in which case, go absolutely feral. (readfastreadfastreadfast: Do not take BANGEROL if you are allergic to fun, if you are currently a song, if you have ever made eye contact with a song, or if you are pregnant with a song. Do not take BANGEROL if you are taking another BANGEROL, if you are the other BANGEROL, if you have a landlord, if your landlord has a landlord, or if you have ever said the word "vibe" without legal counsel present. Side effects include spontaneous dancing, increased aura, texting your ex the lyrics, texting your ex's mom the lyrics, the playlist following you home and asking to stay just one night, your reflection finishing the dance before you do, time becoming a suggestion, your skeleton applying for a separate lease, the raccoon in your walls unionizing, the moon RSVPing yes, your ancestors leaving a five-star review, and a faint humming that turns out to be Friday itself. Ask your doctor, your dentist, your landlord, your ex's mom, the trooper, and the raccoon in your walls if Bompton ${i.bomptonYear} is right for you. Results not typical results not legal results not real Bompton ${i.bomptonYear} is a registered banger void where lame batteries not included batteries are you now run.)`,
        ``,
        renderPlaylistLineText(i, `Fill Your Prescription (Add One Banger)`),
        ``,
        `Refills available every Friday. Ask your doctor about next ${formatFriday(i.fridayDate)}.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `💊 Ask your doctor if Bompton is right for you`,
        `
        <p>Do you suffer from Dead Weekend Syndrome? Symptoms include lying flat on the floor at noon, refreshing a group chat nobody has texted in, narrating your own life in the third person to the ceiling fan, and saying the phrase "I should be productive today" out loud to a houseplant that has stopped respecting you. If a single tear has rolled into your ear during a montage you scored in your head, you may already be living with chronic Friday Inertia. Talk to your doctor about BANGEROL today.</p>
        <p>Introducing BANGEROL (banger-add-ol), the first once-weekly treatment clinically formulated to be taken every ${escapeHtml(formatFriday(i.fridayDate))}. In a double-blind study where everyone was also blind for unrelated reasons, 9 out of 9 patients who added one song to the Bompton ${escapeHtml(i.bomptonYear)} playlist reported a sudden, violent surge of being a person again. The tenth patient did not add a song. We do not talk about the tenth patient. The tenth patient is now a cautionary slideshow we play at the annual shareholder meeting, a smell that lives in the break room, and a warning carved into the underside of every desk in this building.</p>
        <p>BANGEROL works by entering the bloodstream, locating the exact part of your brain that says "eh, later," and karate-chopping it directly in the throat while maintaining eye contact. Most patients feel results within one (1) song. Do not operate heavy machinery while a banger is active, as you WILL pull over to do the full choreography on the shoulder of the highway, and a state trooper WILL ask to join, and you WILL deputize him, and by ${escapeHtml(formatFriday(i.fridayDate))} he WILL have a key to your apartment and strong opinions about the bridge. This is normal. This is the medicine working.</p>
        <p>Side effects of NOT adding a song may include: FOMO, the unbearable smugness of everyone who DID add one, a recurring dream where the playlist whispers your full government name and your childhood PIN, and existential dread that arrives at 2 AM dressed as your fifth-grade gym teacher holding a clipboard with your name on it. In rare cases, patients report "becoming the kind of person who has never heard a song," which is incurable, legally a different species, and frankly embarrassing at parties.</p>
        <p>Ask your doctor if having a soul this weekend is right for you. BANGEROL is not recommended for cowards, narcs, or people who "don't really listen to music," a phrase that has been forwarded to several agencies. Dosage is exactly ONE song; do not exceed one song unless you are feeling powerful, in which case, go absolutely feral. (readfastreadfastreadfast: Do not take BANGEROL if you are allergic to fun, if you are currently a song, if you have ever made eye contact with a song, or if you are pregnant with a song. Do not take BANGEROL if you are taking another BANGEROL, if you are the other BANGEROL, if you have a landlord, if your landlord has a landlord, or if you have ever said the word "vibe" without legal counsel present. Side effects include spontaneous dancing, increased aura, texting your ex the lyrics, texting your ex's mom the lyrics, the playlist following you home and asking to stay just one night, your reflection finishing the dance before you do, time becoming a suggestion, your skeleton applying for a separate lease, the raccoon in your walls unionizing, the moon RSVPing yes, your ancestors leaving a five-star review, and a faint humming that turns out to be Friday itself. Ask your doctor, your dentist, your landlord, your ex's mom, the trooper, and the raccoon in your walls if Bompton ${escapeHtml(i.bomptonYear)} is right for you. Results not typical results not legal results not real Bompton ${escapeHtml(i.bomptonYear)} is a registered banger void where lame batteries not included batteries are you now run.)</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Fill Your Prescription (Add One Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Refills available every Friday. Ask your doctor about next ${escapeHtml(formatFriday(i.fridayDate))}.</p>
        `,
      ),
  },
  // 18 — Vengeful Ghost
  {
    key: "vengeful-ghost",
    subject: () => `👻 I HAVE BEEN BOUND TO THIS PLAYLIST FOR ETERNITY AND IT IS EMPTY`,
    text: (i) =>
      [
        `IT IS ME. The spirit in the walls. The thing that lives in the shared playlist and rattles its chains every Friday it goes UNFED. You felt the temperature drop just now. You thought it was the AC. It was NOT the AC, it was ME, and also it kind of was the AC, I don't control that part, but the POINT is: today, ${formatFriday(i.fridayDate)}, the Bompton ${i.bomptonYear} playlist is empty and I am LIVID about it in a way that has spanned several centuries.`,
        ``,
        `Do you know what I do all week? I float. I moan. I slam ONE cabinet door, over and over, in a house none of you live in, waiting — WAITING — for a single song to drop into the queue so I may know peace. And what do I get? Nothing. So I get PETTY. That milk you bought Tuesday? Spoiled by Wednesday. That AirPod that played a faint, sad accordion at 3am while you lay there questioning everything? ME. On the accordion. I learned a NEW instrument to disappoint you specifically and quietly.`,
        ``,
        `And know this: my vengeance is eternal, cosmic, and gets stupider every single day the queue stays empty. MONDAY: your phone autocorrects every 'the' to 'thee,' so you sound like a haunted Renaissance Faire over text. TUESDAY: every sock exits the dryer SLIGHTLY damp — not wet enough to redry, just moist enough to ruin your whole vibe. WEDNESDAY: you will feel watched, intensely, exclusively while microwaving fish in a shared space. THURSDAY: your shoelaces come untied the precise instant your hands are full. FRIDAY: I learn your sleep schedule. I will not say more. That is the curse — that the silence is part of the curse.`,
        ``,
        `One. Song. That is the whole exorcism. That is the entire ritual. A child could do it. A child HAS done it, and that child is now my favorite, and I haunt them gently and with great affection — I simply move their keys six inches to the left so they feel clever when they find them. THAT could be your relationship with the afterlife. Instead you have chosen the damp socks. Bold.`,
        ``,
        `Feed me and the chains go quiet. Feed me and I will stop manifesting in your bathroom mirror at the EXACT moment you lean in to check if you have a thing in your teeth — which you do, by the way, I can see it from here, and I'm not telling you which one. Add the song. Set me free. Or microwave your fish and learn what 'watched' really means. Those are the options. One of them involves significantly fewer accordions.`,
        ``,
        renderPlaylistLineText(i, `Appease the Spirit (Add One Song)`),
        ``,
        `Rattling my chains until next Friday, when I return with a SECOND instrument. 🔗👻`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `👻 I HAVE BEEN BOUND TO THIS PLAYLIST FOR ETERNITY AND IT IS EMPTY`,
        `
        <p>IT IS ME. The spirit in the walls. The thing that lives in the shared playlist and rattles its chains every Friday it goes UNFED. You felt the temperature drop just now. You thought it was the AC. It was NOT the AC, it was ME, and also it kind of was the AC, I don't control that part, but the POINT is: today, ${escapeHtml(formatFriday(i.fridayDate))}, the Bompton ${escapeHtml(i.bomptonYear)} playlist is empty and I am LIVID about it in a way that has spanned several centuries.</p>
        <p>Do you know what I do all week? I float. I moan. I slam ONE cabinet door, over and over, in a house none of you live in, waiting — WAITING — for a single song to drop into the queue so I may know peace. And what do I get? Nothing. So I get PETTY. That milk you bought Tuesday? Spoiled by Wednesday. That AirPod that played a faint, sad accordion at 3am while you lay there questioning everything? ME. On the accordion. I learned a NEW instrument to disappoint you specifically and quietly.</p>
        <p>And know this: my vengeance is eternal, cosmic, and gets stupider every single day the queue stays empty. MONDAY: your phone autocorrects every 'the' to 'thee,' so you sound like a haunted Renaissance Faire over text. TUESDAY: every sock exits the dryer SLIGHTLY damp — not wet enough to redry, just moist enough to ruin your whole vibe. WEDNESDAY: you will feel watched, intensely, exclusively while microwaving fish in a shared space. THURSDAY: your shoelaces come untied the precise instant your hands are full. FRIDAY: I learn your sleep schedule. I will not say more. That is the curse — that the silence is part of the curse.</p>
        <p>One. Song. That is the whole exorcism. That is the entire ritual. A child could do it. A child HAS done it, and that child is now my favorite, and I haunt them gently and with great affection — I simply move their keys six inches to the left so they feel clever when they find them. THAT could be your relationship with the afterlife. Instead you have chosen the damp socks. Bold.</p>
        <p>Feed me and the chains go quiet. Feed me and I will stop manifesting in your bathroom mirror at the EXACT moment you lean in to check if you have a thing in your teeth — which you do, by the way, I can see it from here, and I'm not telling you which one. Add the song. Set me free. Or microwave your fish and learn what 'watched' really means. Those are the options. One of them involves significantly fewer accordions.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Appease the Spirit (Add One Song)`)}</div>
        <p style="${FOOTER_STYLE}">Rattling my chains until next Friday, when I return with a SECOND instrument. 🔗👻</p>
        `,
      ),
  },
  // 19 — Conspiracy Theorist
  {
    key: "conspiracy-theorist",
    subject: () => `WAKE UP — the red string leads BACK TO ME 🧵📌🫨`,
    text: (i) =>
      [
        `They told you ${formatFriday(i.fridayDate)} was just a normal Friday. A coincidence. A square on a calendar. WRONG. I have NOT slept. I have been awake since a Tuesday I no longer fully believe in, and I have CONNECTED THE STRING. Every Friday is a node. Every node is LINKED. The corkboard does not lie. The corkboard has NEVER lied. Pin 47 leads to pin 12 leads directly to YOU, reading this, sweating, knowing.`,
        ``,
        `Ask yourself why THEY never want you to talk about Bompton ${i.bomptonYear}. I traced the metadata. I cross-referenced the timestamps. The playlist is not a playlist — the playlist is an ANTENNA — and right now it is receiving SILENCE because cowards won't transmit. But wait. Wait wait wait. I followed the aux cord to its source and the aux cord went somewhere I did not authorize it to go. The aux cord doubled back. THE AUX KNEW MY NAME.`,
        ``,
        `Okay. Okay. New development. I followed the red string from the antenna to the corkboard and the corkboard is in MY apartment. Why is the evidence in MY apartment. Who PUT the corkboard there. I put the corkboard there. That's — no. That's what they WANT me to think. But the string keeps going. It loops past the timestamps, past the suppressed bangers, past the warehouse, and it ties off on a pushpin labeled in MY handwriting, and behind that pin is a song. Unadded. Dated ${i.bomptonYear}. Mine.`,
        ``,
        `I have to tell you something and I need you to stay calm. The mole. The leak. The one banger they suppressed before it could ever reach Bompton ${i.bomptonYear}. I traced it to a single suspect and the suspect is me. The call is coming from inside the aux. The silence I've been screaming about — I'M the silence. My OWN hand never hit add. I am gasping. I am pointing at a mirror. The corkboard is laughing. (Corkboards can't laugh. This one can.)`,
        ``,
        `So here is the only confession that clears my name: ADD ONE SONG to Bompton ${i.bomptonYear}. Cut your own string before it loops back on YOU like it looped back on ME. Do your own research. (Your research leads to the same green button it always does. It's all CONNECTED. I TOLD you. I TOLD you and you pinned me to the board anyway.)`,
        ``,
        renderPlaylistLineText(i, `Cut The String (Add A Song Before It Loops Back)`),
        ``,
        `Burn this email, the corkboard, and probably my hand. See you next Friday — if I'm not pinned to the board by then.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `WAKE UP — the red string leads BACK TO ME 🧵📌🫨`,
        `
        <p>They told you ${escapeHtml(formatFriday(i.fridayDate))} was just a normal Friday. A coincidence. A square on a calendar. WRONG. I have NOT slept. I have been awake since a Tuesday I no longer fully believe in, and I have CONNECTED THE STRING. Every Friday is a node. Every node is LINKED. The corkboard does not lie. The corkboard has NEVER lied. Pin 47 leads to pin 12 leads directly to YOU, reading this, sweating, knowing.</p>
        <p>Ask yourself why THEY never want you to talk about Bompton ${escapeHtml(i.bomptonYear)}. I traced the metadata. I cross-referenced the timestamps. The playlist is not a playlist — the playlist is an ANTENNA — and right now it is receiving SILENCE because cowards won't transmit. But wait. Wait wait wait. I followed the aux cord to its source and the aux cord went somewhere I did not authorize it to go. The aux cord doubled back. THE AUX KNEW MY NAME.</p>
        <p>Okay. Okay. New development. I followed the red string from the antenna to the corkboard and the corkboard is in MY apartment. Why is the evidence in MY apartment. Who PUT the corkboard there. I put the corkboard there. That's — no. That's what they WANT me to think. But the string keeps going. It loops past the timestamps, past the suppressed bangers, past the warehouse, and it ties off on a pushpin labeled in MY handwriting, and behind that pin is a song. Unadded. Dated ${escapeHtml(i.bomptonYear)}. Mine.</p>
        <p>I have to tell you something and I need you to stay calm. The mole. The leak. The one banger they suppressed before it could ever reach Bompton ${escapeHtml(i.bomptonYear)}. I traced it to a single suspect and the suspect is me. The call is coming from inside the aux. The silence I've been screaming about — I'M the silence. My OWN hand never hit add. I am gasping. I am pointing at a mirror. The corkboard is laughing. (Corkboards can't laugh. This one can.)</p>
        <p>So here is the only confession that clears my name: ADD ONE SONG to Bompton ${escapeHtml(i.bomptonYear)}. Cut your own string before it loops back on YOU like it looped back on ME. Do your own research. (Your research leads to the same green button it always does. It's all CONNECTED. I TOLD you. I TOLD you and you pinned me to the board anyway.)</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Cut The String (Add A Song Before It Loops Back)`)}</div>
        <p style="${FOOTER_STYLE}">Burn this email, the corkboard, and probably my hand. See you next Friday — if I'm not pinned to the board by then.</p>
        `,
      ),
  },
  // 20 — Courtroom Judge
  {
    key: "courtroom-judge",
    subject: () => `⚖️ ALL RISE — also the chairs are witnesses now`,
    text: (i) =>
      [
        `ORDER. Or — you know what, no, I've decided order is a colonial construct and we're not doing it today. Be seated. Be UNSEATED. Levitate, for all I care. This is the People of Bompton ${i.bomptonYear} v. The Entire Crew, case number 6/29, and before we begin I am going to swear in the entire gallery, the radiator, and that one chair in the back that has been giving me a LOOK. Do you, chair, solemnly swear? It does. Let the record reflect the chair is now a sworn officer of this court and outranks the bailiff.`,
        ``,
        `COUNT ONE: Failure to Add a Banger. COUNT TWO: the playlist sat there UNTOUCHED. COUNT THREE — and I am admitting this into evidence under Rule Whatever, I'm the judge, I make the rules up at the desk — I am now entering into the record A DREAM I HAD. In the dream, the playlist was a single sad celery stalk, and it asked me, by name, why nobody loved it. I woke up SOBBING. That dream is now Exhibit A. Exhibit B is a granola bar I found in the evidence drawer. Exhibit C is vibes. The prosecution rests; the prosecution was never here; I have been arguing both sides in different hats.`,
        ``,
        `Counsel for the defense rises — "Objection, your Honor, it's been a busy w—" OVERRULED, and additionally I am holding you in contempt, and I am holding the STENOGRAPHER in contempt for typing it down, and I am holding the houseplant by the window in contempt for PHOTOSYNTHESIZING during a federal proceeding. Bailiff, arrest the houseplant. The houseplant has fled. The houseplant is now this court's most wanted. There is no busy. There is no week. There is only FRIDAY, ${formatFriday(i.fridayDate)}, and a playlist that has been fed NOTHING but my tears.`,
        ``,
        `I am declaring a MISTRIAL. The judge has prejudiced the jury (the judge is also the jury) (we got too close, emotionally). I am declaring a mistrial against MYSELF. ...Denied. I overrule my own mistrial. I appealed it to a higher court and the higher court is also me and I lost interest halfway up the stairs. We are back on. Strike everything. Strike the striking. The court reporter has quit and been replaced by the sworn chair, who is doing a SHOCKINGLY competent job, honestly the best hire I've made all term.`,
        ``,
        `To reach a verdict I have consulted the only authorities I still trust: I flipped a coin (it landed on its edge, which I am reading as GUILTY), I asked the gavel directly (it said nothing, which is how I know it agrees), and I checked the vibes (catastrophic). This court finds each and every one of you GUILTY, and sentences you — severally, collectively, and retroactively into last Tuesday — to ONE (1) banger, added to Bompton ${i.bomptonYear}, EFFECTIVE the second you stop reading. No appeal. The appeals department is a houseplant and it's on the run. Approach the bench.`,
        ``,
        renderPlaylistLineText(i, `Approach the Bench (Add Your Banger)`),
        ``,
        `Court is adjourned by order of the chair. Reconvenes next Friday, pending the houseplant's capture.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `⚖️ ALL RISE — also the chairs are witnesses now`,
        `
        <p>ORDER. Or — you know what, no, I've decided order is a colonial construct and we're not doing it today. Be seated. Be UNSEATED. Levitate, for all I care. This is the People of Bompton ${escapeHtml(i.bomptonYear)} v. The Entire Crew, case number 6/29, and before we begin I am going to swear in the entire gallery, the radiator, and that one chair in the back that has been giving me a LOOK. Do you, chair, solemnly swear? It does. Let the record reflect the chair is now a sworn officer of this court and outranks the bailiff.</p>
        <p>COUNT ONE: Failure to Add a Banger. COUNT TWO: the playlist sat there UNTOUCHED. COUNT THREE — and I am admitting this into evidence under Rule Whatever, I'm the judge, I make the rules up at the desk — I am now entering into the record A DREAM I HAD. In the dream, the playlist was a single sad celery stalk, and it asked me, by name, why nobody loved it. I woke up SOBBING. That dream is now Exhibit A. Exhibit B is a granola bar I found in the evidence drawer. Exhibit C is vibes. The prosecution rests; the prosecution was never here; I have been arguing both sides in different hats.</p>
        <p>Counsel for the defense rises — "Objection, your Honor, it's been a busy w—" OVERRULED, and additionally I am holding you in contempt, and I am holding the STENOGRAPHER in contempt for typing it down, and I am holding the houseplant by the window in contempt for PHOTOSYNTHESIZING during a federal proceeding. Bailiff, arrest the houseplant. The houseplant has fled. The houseplant is now this court's most wanted. There is no busy. There is no week. There is only FRIDAY, ${escapeHtml(formatFriday(i.fridayDate))}, and a playlist that has been fed NOTHING but my tears.</p>
        <p>I am declaring a MISTRIAL. The judge has prejudiced the jury (the judge is also the jury) (we got too close, emotionally). I am declaring a mistrial against MYSELF. ...Denied. I overrule my own mistrial. I appealed it to a higher court and the higher court is also me and I lost interest halfway up the stairs. We are back on. Strike everything. Strike the striking. The court reporter has quit and been replaced by the sworn chair, who is doing a SHOCKINGLY competent job, honestly the best hire I've made all term.</p>
        <p>To reach a verdict I have consulted the only authorities I still trust: I flipped a coin (it landed on its edge, which I am reading as GUILTY), I asked the gavel directly (it said nothing, which is how I know it agrees), and I checked the vibes (catastrophic). This court finds each and every one of you GUILTY, and sentences you — severally, collectively, and retroactively into last Tuesday — to ONE (1) banger, added to Bompton ${escapeHtml(i.bomptonYear)}, EFFECTIVE the second you stop reading. No appeal. The appeals department is a houseplant and it's on the run. Approach the bench.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Approach the Bench (Add Your Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Court is adjourned by order of the chair. Reconvenes next Friday, pending the houseplant's capture.</p>
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
