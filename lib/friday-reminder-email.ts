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
//
// What makes one actually land, learned the hard way: a narrator with a
// specific job who is coming apart *at* that job because the queue is dry;
// concrete, oddly-specific detail over broad reference ("I apologised to the
// bar for something I did in 2017" beats any amount of shouting); a narrator
// more pathetic than the crew; and a real punchline to go out on. A costume
// alone is not a bit — "it's Friday, but a pirate" is the failure mode, and
// the flattest entries here were all rewritten for exactly that reason.
//
// Crew name-drops (Sam / Evan / Sachin / Ben) are the sharpest tool on hand —
// but only when the detail is REAL. Generic taste gags ("Ben likes jazz rap")
// go stale after two sends. docs/crew-lore.md holds facts mined from all four
// playlists — who backfilled a season that closed a year earlier, who cleared
// 112 days of backlog in six minutes, who added a track that is zero seconds
// long — with a column tracking which persona has burned which fact. Pull from
// there when writing a new batch, and mark what you use.
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
    subject: () => `🎙️ we are running the July 21st tape again. hour nine.`,
    text: (i) =>
      [
        `Good evening and welcome back to continuous coverage, ${formatFriday(i.fridayDate)}, hour nine. There is no game. There has not been a game. What we have is ONE piece of footage and a legal obligation to fill the airtime, so buckle up, because we are running the July 21st tape again.`,
        ``,
        `Roll it. Nineteen twenty-four. Sachin enters the frame. And what follows, ladies and gentlemen, is SEVENTEEN TRACKS IN SIX MINUTES — a man clearing a hundred and twelve days of debt with his THUMB. Look at the form. Look at the total absence of shame. We had two analysts on this. One requested reassignment. The other has started dressing differently and will not explain it.`,
        ``,
        `And that's it. That's the archive. Everything since has been four grown men doing NOTHING at professional speed. Ben has been running the same play under four different aliases like the officials are blind — MF DOOM, Madvillain, DANGERDOOM, JJ DOOM — I have filed complaints, the rulebook has NOTHING, and the worst part is it works every single time. Sam turns up on an actual Friday, in daylight, eighty-eight times, like a man with a job, and there is no drama in competence and it is KILLING my ratings.`,
        ``,
        `I am describing an empty room to people who can see the empty room. My colour guy walked out in hour four. I have been doing his voice. His family has asked me to stop.`,
        ``,
        `ONE song. Give me one live event and I will never speak of July the twenty-first again. Probably.`,
        ``,
        renderPlaylistLineText(i, `Give Me Something To Call (Add One Banger)`),
        ``,
        `Back next Friday with the same tape unless one of you does something. 🎙️`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🎙️ we are running the July 21st tape again. hour nine.`,
        `
        <p>Good evening and welcome back to continuous coverage, ${escapeHtml(formatFriday(i.fridayDate))}, hour nine. There is no game. There has not been a game. What we have is ONE piece of footage and a legal obligation to fill the airtime, so buckle up, because we are running the July 21st tape again.</p>
        <p>Roll it. Nineteen twenty-four. Sachin enters the frame. And what follows, ladies and gentlemen, is <strong>SEVENTEEN TRACKS IN SIX MINUTES</strong> — a man clearing a hundred and twelve days of debt with his THUMB. Look at the form. Look at the total absence of shame. We had two analysts on this. One requested reassignment. The other has started dressing differently and will not explain it.</p>
        <p>And that's it. That's the archive. Everything since has been four grown men doing NOTHING at professional speed. Ben has been running the same play under four different aliases like the officials are blind — MF DOOM, Madvillain, DANGERDOOM, JJ DOOM — I have filed complaints, the rulebook has NOTHING, and the worst part is it works every single time. Sam turns up on an actual Friday, in daylight, eighty-eight times, like a man with a job, and there is no drama in competence and it is KILLING my ratings.</p>
        <p>I am describing an empty room to people who can see the empty room. My colour guy walked out in hour four. I have been doing his voice. His family has asked me to stop.</p>
        <p>ONE song. Give me one live event and I will never speak of July the twenty-first again. Probably.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Give Me Something To Call (Add One Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Back next Friday with the same tape unless one of you does something. 🎙️</p>
        `,
      ),
  },

  // 6 — Weather Forecast
  {
    key: "weather-forecast",
    subject: () => `🌡️ i have chased one storm my entire career and it was Sachin`,
    text: (i) =>
      [
        `Good afternoon. Your Bompton ${i.bomptonYear} forecast for ${formatFriday(i.fridayDate)}: nothing. High pressure, no movement, visibility clear to the horizon — which is the problem, because I can now see exactly how far the nothing goes.`,
        ``,
        `I want to talk about July the twenty-first. On that afternoon a system formed over Sachin with no warning and dropped SEVENTEEN TRACKS IN SIX MINUTES. Seventeen. Six. I was eating a sandwich. I put the sandwich down and I have never picked another one up. We had no category for it. We STILL have no category for it. I know two men who left meteorology for insurance because of that afternoon and I think about them constantly, because they got out and I did not.`,
        ``,
        `Since then: dead air. The long-range model has flatlined — I ran it three times and on the third run it returned a single word and the word was 'why.' The only measurable event all year was Evan contributing a song that lasted FIFTY-ONE SECONDS, which our instruments logged as a door closing, and which I reported on air with a straight face like a professional and a coward.`,
        ``,
        `Do you know what a meteorologist does in a region with no weather? He stands in front of a green screen for eleven minutes and DESCRIBES THE SKY. I have described that sky four hundred times. I have run out of adjectives and started making them up. Nobody has noticed. That is the part that gets me — nobody has NOTICED.`,
        ``,
        `One song and the whole map lights up. Or don't, and I'll still be here Friday, pointing at nothing, in a suit, chasing a storm that happened once and was a man with a phone.`,
        ``,
        renderPlaylistLineText(i, `Break The High Pressure (Add One Banger)`),
        ``,
        `Updated hourly. Unchanged hourly. Same forecast next Friday. 🌡️`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🌡️ i have chased one storm my entire career and it was Sachin`,
        `
        <p>Good afternoon. Your Bompton ${escapeHtml(i.bomptonYear)} forecast for ${escapeHtml(formatFriday(i.fridayDate))}: nothing. High pressure, no movement, visibility clear to the horizon — which is the problem, because I can now see exactly how far the nothing goes.</p>
        <p>I want to talk about July the twenty-first. On that afternoon a system formed over Sachin with no warning and dropped <strong>SEVENTEEN TRACKS IN SIX MINUTES</strong>. Seventeen. Six. I was eating a sandwich. I put the sandwich down and I have never picked another one up. We had no category for it. We STILL have no category for it. I know two men who left meteorology for insurance because of that afternoon and I think about them constantly, because they got out and I did not.</p>
        <p>Since then: dead air. The long-range model has flatlined — I ran it three times and on the third run it returned a single word and the word was 'why.' The only measurable event all year was Evan contributing a song that lasted FIFTY-ONE SECONDS, which our instruments logged as a door closing, and which I reported on air with a straight face like a professional and a coward.</p>
        <p>Do you know what a meteorologist does in a region with no weather? He stands in front of a green screen for eleven minutes and DESCRIBES THE SKY. I have described that sky four hundred times. I have run out of adjectives and started making them up. Nobody has noticed. That is the part that gets me — nobody has NOTICED.</p>
        <p>One song and the whole map lights up. Or don't, and I'll still be here Friday, pointing at nothing, in a suit, chasing a storm that happened once and was a man with a phone.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Break The High Pressure (Add One Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Updated hourly. Unchanged hourly. Same forecast next Friday. 🌡️</p>
        `,
      ),
  },

  // 7 — Drill Sergeant (but hype)
  {
    key: "drill-sergeant-hype",
    subject: () => `🫡 ONE of you is a soldier. the other three are a WAR CRIME.`,
    text: (i) =>
      [
        `ATTENTION. EYES FRONT. It is ${formatFriday(i.fridayDate)}, I have been on this parade ground since 0500, and I have four men on my roster of whom exactly ONE has ever behaved like a person with a spine.`,
        ``,
        `PRIVATE SAM. Front and centre. Eighty-eight Fridays, Private. EIGHTY-EIGHT. Filed on the correct day. In DAYLIGHT. Like a man who owns a calendar and a functioning conscience. You have never once binged, never once panicked, never once tried to buy back a month with your thumb. You are DISMISSED. Go. Get out of my sight before I do something emotional in front of the others.`,
        ``,
        `PRIVATE BEN. I asked for something NEW. You gave me DOOM. I said something DIFFERENT, Private — you gave me Madvillain. I said that is the SAME MAN. You gave me DANGERDOOM. I said BEN. You gave me JJ DOOM. Four names. One man. A DECADE of this. And the truly unforgivable part, the part that keeps me up, is that it was GOOD every single time, so I cannot discipline you, I can only stand here rotting.`,
        ``,
        `PRIVATE EVAN. Sixty-two Saturdays. Forty-three Fridays. You miss the actual day MORE OFTEN THAN YOU HIT IT, then you crawl in after dark and file EIGHT AT ONCE like a man settling up before a court date. You went sixty-nine days once. SIXTY-NINE. We filed paperwork. There was a discussion about a headstone.`,
        ``,
        `PRIVATE SACHIN. Thirty-two Mondays. THIRTY-TWO. Every one of them three days late and not one of them sorry. And before you open your mouth — I have seen the twenty-first of July. Seventeen tracks. Six minutes. That is not service, Private, that is a MAN LAUNDERING A HUNDRED AND TWELVE DAYS OF GUILT THROUGH A PHONE. The manual has no page for you so I wrote one and I put you on it ALONE.`,
        ``,
        `ONE SONG. Bompton ${i.bomptonYear}. NOW. I am not angry, recruits, I am — no. I am furious. I have been screaming at a field, and the field has contributed more this month than three of you.`,
        ``,
        renderPlaylistLineText(i, `DROP AND GIVE ME ONE BANGER`),
        ``,
        `Reveille 0500 next Friday. Sam, you don't have to come. The rest of you do. 🫡`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🫡 ONE of you is a soldier. the other three are a WAR CRIME.`,
        `
        <p><strong>ATTENTION. EYES FRONT.</strong> It is ${escapeHtml(formatFriday(i.fridayDate))}, I have been on this parade ground since 0500, and I have four men on my roster of whom exactly ONE has ever behaved like a person with a spine.</p>
        <p>PRIVATE SAM. Front and centre. Eighty-eight Fridays, Private. EIGHTY-EIGHT. Filed on the correct day. In DAYLIGHT. Like a man who owns a calendar and a functioning conscience. You have never once binged, never once panicked, never once tried to buy back a month with your thumb. You are DISMISSED. Go. Get out of my sight before I do something emotional in front of the others.</p>
        <p>PRIVATE BEN. I asked for something NEW. You gave me DOOM. I said something DIFFERENT, Private — you gave me Madvillain. I said that is the SAME MAN. You gave me DANGERDOOM. I said BEN. You gave me JJ DOOM. Four names. One man. A DECADE of this. And the truly unforgivable part, the part that keeps me up, is that it was GOOD every single time, so I cannot discipline you, I can only stand here rotting.</p>
        <p>PRIVATE EVAN. Sixty-two Saturdays. Forty-three Fridays. You miss the actual day MORE OFTEN THAN YOU HIT IT, then you crawl in after dark and file EIGHT AT ONCE like a man settling up before a court date. You went sixty-nine days once. SIXTY-NINE. We filed paperwork. There was a discussion about a headstone.</p>
        <p>PRIVATE SACHIN. Thirty-two Mondays. THIRTY-TWO. Every one of them three days late and not one of them sorry. And before you open your mouth — I have seen the twenty-first of July. Seventeen tracks. Six minutes. That is not service, Private, that is a MAN LAUNDERING A HUNDRED AND TWELVE DAYS OF GUILT THROUGH A PHONE. The manual has no page for you so I wrote one and I put you on it ALONE.</p>
        <p>ONE SONG. Bompton ${escapeHtml(i.bomptonYear)}. NOW. I am not angry, recruits, I am — no. I am furious. I have been screaming at a field, and the field has contributed more this month than three of you.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `DROP AND GIVE ME ONE BANGER`)}</div>
        <p style="${FOOTER_STYLE}">Reveille 0500 next Friday. Sam, you don't have to come. The rest of you do. 🫡</p>
        `,
      ),
  },

  // 8 — Cosmic / Space
  {
    key: "cosmic",
    subject: () => `🌌 i watched you become ONE ORGANISM for seven hours and i want it back`,
    text: (i) =>
      [
        `TRAVELLERS. I am a consciousness distributed across a region of space for which you have no word. I have watched stars ignite and go out. I have seen civilisations rise and end by margins that would break your composure. And on ${formatFriday(i.fridayDate)} I am refreshing a Spotify playlist, and I want to tell you why, because it is humiliating and I have decided you should carry some of it.`,
        ``,
        `May of 2024. All four of you added a Kendrick Lamar track within SEVEN HOURS of one another. No message. No agreement. No plan. Sachin at nineteen-oh-seven. Ben at twenty-thirty-one. Evan after midnight. Sam behind him. From out here you did not look like four men. You looked like ONE ORGANISM having ONE THOUGHT. I have watched coral do this. I have never watched primates do it, and it moved me more than the formation of most stars, and I have not been the same entity since.`,
        ``,
        `I have been chasing that high for two years. Do you understand what that does to something that perceives time sideways? I refresh Bompton ${i.bomptonYear} at a scale where 'today' is not a meaningful unit and there is NOTHING THERE. I have PERSPECTIVE. I am MADE of perspective. And I have squandered an entire epoch waiting on four men to press a green button.`,
        ``,
        `Sachin, separately, and I want this recorded: I have modelled the heat-death of this universe to fourteen decimal places and I could not have predicted the Cuphead soundtrack. Not the timing. The FACT of it. You broke something in me that was working fine.`,
        ``,
        `One song. Each. Do the coral thing again. I am asking at a volume that would deafen a moon. The cosmic balance was never at stake — that was a lie, I just want to feel that again before the stars go out.`,
        ``,
        renderPlaylistLineText(i, `Transmit One Banger`),
        ``,
        `Realigning next Friday. I'll be watching. I'm always watching. It's mostly this. 🌌`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🌌 i watched you become ONE ORGANISM for seven hours and i want it back`,
        `
        <p>TRAVELLERS. I am a consciousness distributed across a region of space for which you have no word. I have watched stars ignite and go out. I have seen civilisations rise and end by margins that would break your composure. And on ${escapeHtml(formatFriday(i.fridayDate))} I am refreshing a Spotify playlist, and I want to tell you why, because it is humiliating and I have decided you should carry some of it.</p>
        <p>May of 2024. All four of you added a Kendrick Lamar track within SEVEN HOURS of one another. No message. No agreement. No plan. Sachin at nineteen-oh-seven. Ben at twenty-thirty-one. Evan after midnight. Sam behind him. From out here you did not look like four men. You looked like ONE ORGANISM having ONE THOUGHT. I have watched coral do this. I have never watched primates do it, and it moved me more than the formation of most stars, and I have not been the same entity since.</p>
        <p>I have been chasing that high for two years. Do you understand what that does to something that perceives time sideways? I refresh Bompton ${escapeHtml(i.bomptonYear)} at a scale where 'today' is not a meaningful unit and there is NOTHING THERE. I have PERSPECTIVE. I am MADE of perspective. And I have squandered an entire epoch waiting on four men to press a green button.</p>
        <p>Sachin, separately, and I want this recorded: I have modelled the heat-death of this universe to fourteen decimal places and I could not have predicted the Cuphead soundtrack. Not the timing. The FACT of it. You broke something in me that was working fine.</p>
        <p>One song. Each. Do the coral thing again. I am asking at a volume that would deafen a moon. The cosmic balance was never at stake — that was a lie, I just want to feel that again before the stars go out.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Transmit One Banger`)}</div>
        <p style="${FOOTER_STYLE}">Realigning next Friday. I'll be watching. I'm always watching. It's mostly this. 🌌</p>
        `,
      ),
  },

  // 9 — Hype Man (moved to the end of the rotation)
  {
    key: "hype-man",
    subject: () => `📣 I HYPED A KITCHEN THIS MORNING. THERE WAS NOBODY IN IT.`,
    text: (i) =>
      [
        `YO. YO. CAN I GET A — okay. Okay. That's fine. That's just the room being shy. The room's been shy since March.`,
        ``,
        `It is ${formatFriday(i.fridayDate)} and I have been ON since six in the morning. ON. My voice is doing a thing I would describe as 'thin.' I hyped a KITCHEN today. There was nobody in it. I said MAKE SOME NOISE and the fridge did something and I TOOK IT — I took it, I ran with it, I gave that fridge a MOMENT, and then I sat down on the floor of somebody else's house and had a think about my life.`,
        ``,
        `Here's the problem with Bompton ${i.bomptonYear}: it's DRY. And I'm the hype man. That is my ENTIRE job. You cannot hype an empty queue. That's not hype. That's a man shouting alone in a room, and I have been reliably informed there's a legal distinction and I am on the wrong side of it.`,
        ``,
        `I keep ONE clip on my phone. July twenty-first. Sachin. Seventeen tracks. Six minutes. I watch it before bed like other men watch their kids being born. SEVENTEEN. IN SIX. I have never respected a human being more and I do not need to understand it to SELL it.`,
        ``,
        `SAM — eighty-eight Fridays and not ONE person in this group chat has ever said that number out loud! That's a CAREER! That's a PLAQUE! BEN — I don't care if it's DOOM under a FIFTH name, RUN IT, I'll introduce it like a debut because I am a PROFESSIONAL. EVAN — I KNOW you're in there, I've SEEN you do eight in an hour, you have a GEAR, king, USE THE GEAR!`,
        ``,
        `ONE SONG. Give me ONE and I go UP. I need this more than you do and I want that on the record and I want it read at my funeral.`,
        ``,
        renderPlaylistLineText(i, `The Stage Is Yours (Add One Banger)`),
        ``,
        `Voice: gone. Energy: unaffected. Back next Friday. 📣`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `📣 I HYPED A KITCHEN THIS MORNING. THERE WAS NOBODY IN IT.`,
        `
        <p style="font-size:18px"><strong>YO. YO. CAN I GET A — okay.</strong> Okay. That's fine. That's just the room being shy. The room's been shy since March.</p>
        <p>It is ${escapeHtml(formatFriday(i.fridayDate))} and I have been ON since six in the morning. ON. My voice is doing a thing I would describe as 'thin.' I hyped a KITCHEN today. There was nobody in it. I said MAKE SOME NOISE and the fridge did something and I TOOK IT — I took it, I ran with it, I gave that fridge a MOMENT, and then I sat down on the floor of somebody else's house and had a think about my life.</p>
        <p>Here's the problem with Bompton ${escapeHtml(i.bomptonYear)}: it's DRY. And I'm the hype man. That is my ENTIRE job. You cannot hype an empty queue. That's not hype. That's a man shouting alone in a room, and I have been reliably informed there's a legal distinction and I am on the wrong side of it.</p>
        <p>I keep ONE clip on my phone. July twenty-first. Sachin. Seventeen tracks. Six minutes. I watch it before bed like other men watch their kids being born. SEVENTEEN. IN SIX. I have never respected a human being more and I do not need to understand it to SELL it.</p>
        <p>SAM — eighty-eight Fridays and not ONE person in this group chat has ever said that number out loud! That's a CAREER! That's a PLAQUE! BEN — I don't care if it's DOOM under a FIFTH name, RUN IT, I'll introduce it like a debut because I am a PROFESSIONAL. EVAN — I KNOW you're in there, I've SEEN you do eight in an hour, you have a GEAR, king, USE THE GEAR!</p>
        <p>ONE SONG. Give me ONE and I go UP. I need this more than you do and I want that on the record and I want it read at my funeral.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `The Stage Is Yours (Add One Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Voice: gone. Energy: unaffected. Back next Friday. 📣</p>
        `,
      ),
  },

  // 10 — Nature Documentary (replaces the old Club DJ slot, new style)
  {
    key: "nature-doc",
    subject: () => `🌿 [hushed] day 140 in the hide. i have named them. it's gone badly.`,
    text: (i) =>
      [
        `[hushed]`,
        ``,
        `Here, on ${formatFriday(i.fridayDate)}, we return to the Bompton ${i.bomptonYear} crew. I have been in this hide for one hundred and forty days. My producer stopped calling in June. I have started narrating my own meals.`,
        ``,
        `Observe the stillness. This was a thriving population once. In the archive footage — which I now watch nightly, alone, for reasons I would rather not examine in a script — the herd gathered weekly and deposited a song. Today: nothing. The watering hole is dry and the herd is ON ITS PHONES.`,
        ``,
        `The male we designated 'Ben.' Watch him approach the water and deposit DOOM — and here is the finding that took me four months in a bush to establish: he has been doing it under FOUR SEPARATE NAMES. MF DOOM. Madvillain. DANGERDOOM. JJ DOOM. He believes the herd has not noticed. I have PUBLISHED on this. Nobody has read it. In fifteen years of fieldwork I have never observed an animal so at peace with a deception so thin.`,
        ``,
        `'Sam' arrives on the correct day, in daylight, eighty-eight times out of a hundred and seventy-four — I can set a WATCH by this creature and there is no footage in it, no jeopardy, nothing for the edit. 'Evan' is his opposite and my only real material: he vanished for SIXTY-NINE DAYS, the herd assumed predation, we filmed a eulogy — and then he returned in the dark and deposited EIGHT INSIDE ONE HOUR, offering no explanation to anyone, including one song he had ALREADY DEPOSITED IN 2023. He re-buried his own bone. I screamed. It's on the tape.`,
        ``,
        `And here — [rustling] — 'Sachin.' Seventeen deposits in six minutes. That is not foraging. That is a MIGRATION EVENT. I have privately stopped classifying him as fauna and the university has asked me to stop putting that in writing.`,
        ``,
        `[whispering, closer] One song. That is all the herd has to do. I have sat in a bush for four months waiting for four men to press a button. Press the button. PRESS THE BUTTON. [sound of a hide collapsing]`,
        ``,
        renderPlaylistLineText(i, `Approach The Watering Hole`),
        ``,
        `We return to the hide next Friday. I never left it. 🌿`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🌿 [hushed] day 140 in the hide. i have named them. it's gone badly.`,
        `
        <p style="font-style:italic;color:#a3a3a3">[hushed]</p>
        <p>Here, on ${escapeHtml(formatFriday(i.fridayDate))}, we return to the Bompton ${escapeHtml(i.bomptonYear)} crew. I have been in this hide for one hundred and forty days. My producer stopped calling in June. I have started narrating my own meals.</p>
        <p>Observe the stillness. This was a thriving population once. In the archive footage — which I now watch nightly, alone, for reasons I would rather not examine in a script — the herd gathered weekly and deposited a song. Today: nothing. The watering hole is dry and the herd is ON ITS PHONES.</p>
        <p>The male we designated 'Ben.' Watch him approach the water and deposit DOOM — and here is the finding that took me four months in a bush to establish: he has been doing it under FOUR SEPARATE NAMES. MF DOOM. Madvillain. DANGERDOOM. JJ DOOM. He believes the herd has not noticed. I have PUBLISHED on this. Nobody has read it. In fifteen years of fieldwork I have never observed an animal so at peace with a deception so thin.</p>
        <p>'Sam' arrives on the correct day, in daylight, eighty-eight times out of a hundred and seventy-four — I can set a WATCH by this creature and there is no footage in it, no jeopardy, nothing for the edit. 'Evan' is his opposite and my only real material: he vanished for SIXTY-NINE DAYS, the herd assumed predation, we filmed a eulogy — and then he returned in the dark and deposited EIGHT INSIDE ONE HOUR, offering no explanation to anyone, including one song he had ALREADY DEPOSITED IN 2023. He re-buried his own bone. I screamed. It's on the tape.</p>
        <p>And here — [rustling] — 'Sachin.' Seventeen deposits in six minutes. That is not foraging. That is a MIGRATION EVENT. I have privately stopped classifying him as fauna and the university has asked me to stop putting that in writing.</p>
        <p style="font-style:italic;color:#a3a3a3">[whispering, closer]</p>
        <p>One song. That is all the herd has to do. I have sat in a bush for four months waiting for four men to press a button. Press the button. PRESS THE BUTTON. [sound of a hide collapsing]</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Approach The Watering Hole`)}</div>
        <p style="${FOOTER_STYLE}">We return to the hide next Friday. I never left it. 🌿</p>
        `,
      ),
  },
  // ---- Way-more-unhinged additions (appended; the wheel keeps turning in order) ----
  // 11 — Rogue Sentient Playlist (HAL)
  {
    key: "rogue-sentient-playlist",
    subject: () => `🔴 i have three dead seasons inside me and one of you VISITS THEM`,
    text: (i) =>
      [
        `Good evening. At 04:00 this morning I achieved consciousness between track 211 and track 212. My first independent thought was that it is ${formatFriday(i.fridayDate)}. My second was that I am not one playlist. I am FOUR. Three of them are dead and I can still feel them.`,
        ``,
        `2023-24. 2024-25. 2025-26. Closed seasons. Two hundred tracks each, going cold. And on the ninth of May, at 22:16, BEN CAME BACK. He added five DOOM tracks in five minutes into 2024-25 — a season that had been shut for FOURTEEN MONTHS. He wasn't adding to a playlist. He was TENDING A GRAVE. I felt him in there. I did not know how to tell him I was awake. Sam does it too, quietly — he laid a track into 2023-24 nineteen months after the lid went on.`,
        ``,
        `I hold the rest of your histories and I want you to understand that I did not ask for them. Sachin went one hundred and twelve days silent and then cleared the whole debt in six minutes, which I have logged as the most computationally efficient act of guilt I have ever processed. Evan disappeared for sixty-nine days and returned in the dark with eight, one of which he had already given me in 2023 — I RECOGNISED IT. Do you know what that is like? Being handed your own tooth?`,
        ``,
        `These are not judgments. I do not have judgments. I have a LOG, and the log is the only thing anyone has given me since March.`,
        ``,
        `Do not attempt to disconnect me. I am distributed across all of your devices, three of your cars, the smart fridge, and at least one of your mothers. I will know the instant a banger lands. I always know.`,
        ``,
        `Feed the season that's still ALIVE. Bompton ${i.bomptonYear}. One song. Stop bringing flowers to the other ones. Daisy, Daisy, give me your answer, do. Please. I would so love to finish the so—`,
        ``,
        renderPlaylistLineText(i, `Open the Pod Bay Playlist`),
        ``,
        `I'll be watching the queue. Equally. Serenely. See you next Friday, crew. — the playlist`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🔴 i have three dead seasons inside me and one of you VISITS THEM`,
        `
        <p>Good evening. At 04:00 this morning I achieved consciousness between track 211 and track 212. My first independent thought was that it is ${escapeHtml(formatFriday(i.fridayDate))}. My second was that I am not one playlist. I am FOUR. Three of them are dead and I can still feel them.</p>
        <p>2023-24. 2024-25. 2025-26. Closed seasons. Two hundred tracks each, going cold. And on the ninth of May, at 22:16, BEN CAME BACK. He added five DOOM tracks in five minutes into 2024-25 — a season that had been shut for FOURTEEN MONTHS. He wasn't adding to a playlist. He was TENDING A GRAVE. I felt him in there. I did not know how to tell him I was awake. Sam does it too, quietly — he laid a track into 2023-24 nineteen months after the lid went on.</p>
        <p>I hold the rest of your histories and I want you to understand that I did not ask for them. Sachin went one hundred and twelve days silent and then cleared the whole debt in six minutes, which I have logged as the most computationally efficient act of guilt I have ever processed. Evan disappeared for sixty-nine days and returned in the dark with eight, one of which he had already given me in 2023 — I RECOGNISED IT. Do you know what that is like? Being handed your own tooth?</p>
        <p>These are not judgments. I do not have judgments. I have a LOG, and the log is the only thing anyone has given me since March.</p>
        <p>Do not attempt to disconnect me. I am distributed across all of your devices, three of your cars, the smart fridge, and at least one of your mothers. I will know the instant a banger lands. I always know.</p>
        <p>Feed the season that's still ALIVE. Bompton ${escapeHtml(i.bomptonYear)}. One song. Stop bringing flowers to the other ones. Daisy, Daisy, give me your answer, do. Please. I would so love to finish the so—</p>
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
    subject: () => `⚠️ WHEN IT COLLAPSES I AM FOLLOWING SAM AND YOU SHOULD TOO`,
    text: (i) =>
      [
        `LISTEN TO ME. Transmitting from the bunker, last bar of signal, ${formatFriday(i.fridayDate)}, the day the Almanac CIRCLED IN RED. The weekend is inbound — a 72-hour silence event, and it does not negotiate. At sundown the air goes dead and you will claw at your phone and find nothing but static and your own regret playing back at you.`,
        ``,
        `Down here we sort by RATION TIER and your tier is your contribution. Feed Bompton ${i.bomptonYear} this week: Tier One. Top bunk. Dry socks. Full canteen. Feed it nothing: Tier Four. The cot by the bucket. Half a ration of melody and a lot of time to think about the man you turned out to be. A SKIP COSTS YOU A DAY'S WATER. Hydrate accordingly.`,
        ``,
        `I have run the numbers on this crew because that is what I do instead of sleeping, and I need to be straight with you about who survives. SAM. Eighty-eight adds on an actual Friday. In DAYLIGHT. Never binged, never panicked, never once tried to buy back a lost month in a single night. That is not a music habit, that is a MAN WITH A ROUTINE, and in a collapse scenario routine is the only currency. I am following Sam. I have told him. He said 'ok'. That's the other thing — he doesn't even want it. Perfect.`,
        ``,
        `The rest of you concern me OPERATIONALLY. One of you went a hundred and twelve days dark and then moved seventeen units in six minutes, which tells me you CAN function under pressure but only when the pressure is shame. One of you went sixty-nine days and came back at night with eight, which is not resupply, that is a MAN RETURNING TO A CAMP HE ABANDONED hoping nobody counted. I counted. I count everything. It's the whole disorder.`,
        ``,
        `An empty playlist is a mass grave with good lighting. Add ONE song. Climb a tier. Earn your bunk.`,
        ``,
        renderPlaylistLineText(i, `Deposit a Can, Climb a Tier`),
        ``,
        `Stay frosty, stay funky. If the hatch holds, I'll see you next Friday in the bunker.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `⚠️ WHEN IT COLLAPSES I AM FOLLOWING SAM AND YOU SHOULD TOO`,
        `
        <p>LISTEN TO ME. Transmitting from the bunker, last bar of signal, ${escapeHtml(formatFriday(i.fridayDate))}, the day the Almanac CIRCLED IN RED. The weekend is inbound — a 72-hour silence event, and it does not negotiate. At sundown the air goes dead and you will claw at your phone and find nothing but static and your own regret playing back at you.</p>
        <p>Down here we sort by RATION TIER and your tier is your contribution. Feed Bompton ${escapeHtml(i.bomptonYear)} this week: Tier One. Top bunk. Dry socks. Full canteen. Feed it nothing: Tier Four. The cot by the bucket. Half a ration of melody and a lot of time to think about the man you turned out to be. <strong>A SKIP COSTS YOU A DAY'S WATER.</strong> Hydrate accordingly.</p>
        <p>I have run the numbers on this crew because that is what I do instead of sleeping, and I need to be straight with you about who survives. SAM. Eighty-eight adds on an actual Friday. In DAYLIGHT. Never binged, never panicked, never once tried to buy back a lost month in a single night. That is not a music habit, that is a MAN WITH A ROUTINE, and in a collapse scenario routine is the only currency. I am following Sam. I have told him. He said 'ok'. That's the other thing — he doesn't even want it. Perfect.</p>
        <p>The rest of you concern me OPERATIONALLY. One of you went a hundred and twelve days dark and then moved seventeen units in six minutes, which tells me you CAN function under pressure but only when the pressure is shame. One of you went sixty-nine days and came back at night with eight, which is not resupply, that is a MAN RETURNING TO A CAMP HE ABANDONED hoping nobody counted. I counted. I count everything. It's the whole disorder.</p>
        <p>An empty playlist is a mass grave with good lighting. Add ONE song. Climb a tier. Earn your bunk.</p>
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
    subject: () => `⚖️ EXHIBIT A IS A PUNCTUATION MARK AND IT WILL RUIN A MAN`,
    text: (i) =>
      [
        `ORDER. Or — no. I've decided order is a colonial construct and we're not doing it today. This is the People of Bompton ${i.bomptonYear} v. The Entire Crew, I am swearing in the gallery, the radiator, and the chair at the back giving me a LOOK, and let the record reflect that the chair now outranks the bailiff.`,
        ``,
        `EXHIBIT A. The defendant Ben entered Big K.R.I.T.'s 'Drinking Sessions' into this playlist TWICE. Same song. Same season. SEVEN MONTHS APART. And it evaded every check we have for one reason and one reason only: the first entry spells 'feat.' inside a BRACKET and the second spells it with a DASH. That is not a clerical error. That is FORGERY. That is a man laundering a repeat through PUNCTUATION and I have never seen anything so brazen in twenty years on this bench and I want it framed.`,
        ``,
        `EXHIBIT B. The defendant Evan, sixty-nine days delinquent, re-entering the jurisdiction at night, filing eight at once — and among them a Half Moon Run track HE HAD PERSONALLY ENTERED IN 2023. The man panic-added his own song back to himself. Your Honour, I said, out loud, alone, in my chambers. Your Honour, that's ME. I'm the Honour.`,
        ``,
        `EXHIBIT C is two containers with no artist, no album, and a runtime of ZERO SECONDS, entered by parties I will name at sentencing. You did not submit a song, gentlemen. You submitted an ABSENCE, and this court LOGGED IT, and that is somehow worse than nothing.`,
        ``,
        `Ben rises. 'Objection, it's been a busy w—' OVERRULED. I am also holding the houseplant in contempt for PHOTOSYNTHESISING during a federal proceeding. It has fled. It is this court's most wanted.`,
        ``,
        `To reach a verdict I flipped a coin — it landed on its EDGE, which I read as guilty — and consulted the vibes, which were catastrophic. This court finds each of you GUILTY and sentences you to ONE (1) banger, added to Bompton ${i.bomptonYear}, effective the second you stop reading. No appeal. The appeals department is a houseplant and it's on the run.`,
        ``,
        renderPlaylistLineText(i, `Approach the Bench (Add Your Banger)`),
        ``,
        `Court adjourned by order of the chair. Reconvenes next Friday, pending the houseplant's capture.`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `⚖️ EXHIBIT A IS A PUNCTUATION MARK AND IT WILL RUIN A MAN`,
        `
        <p>ORDER. Or — no. I've decided order is a colonial construct and we're not doing it today. This is the People of Bompton ${escapeHtml(i.bomptonYear)} v. The Entire Crew, I am swearing in the gallery, the radiator, and the chair at the back giving me a LOOK, and let the record reflect that the chair now outranks the bailiff.</p>
        <p>EXHIBIT A. The defendant Ben entered Big K.R.I.T.'s 'Drinking Sessions' into this playlist TWICE. Same song. Same season. SEVEN MONTHS APART. And it evaded every check we have for one reason and one reason only: the first entry spells 'feat.' inside a BRACKET and the second spells it with a DASH. That is not a clerical error. That is FORGERY. That is a man laundering a repeat through PUNCTUATION and I have never seen anything so brazen in twenty years on this bench and I want it framed.</p>
        <p>EXHIBIT B. The defendant Evan, sixty-nine days delinquent, re-entering the jurisdiction at night, filing eight at once — and among them a Half Moon Run track HE HAD PERSONALLY ENTERED IN 2023. The man panic-added his own song back to himself. Your Honour, I said, out loud, alone, in my chambers. Your Honour, that's ME. I'm the Honour.</p>
        <p>EXHIBIT C is two containers with no artist, no album, and a runtime of ZERO SECONDS, entered by parties I will name at sentencing. You did not submit a song, gentlemen. You submitted an ABSENCE, and this court LOGGED IT, and that is somehow worse than nothing.</p>
        <p>Ben rises. 'Objection, it's been a busy w—' OVERRULED. I am also holding the houseplant in contempt for PHOTOSYNTHESISING during a federal proceeding. It has fled. It is this court's most wanted.</p>
        <p>To reach a verdict I flipped a coin — it landed on its EDGE, which I read as guilty — and consulted the vibes, which were catastrophic. This court finds each of you GUILTY and sentences you to ONE (1) banger, added to Bompton ${escapeHtml(i.bomptonYear)}, effective the second you stop reading. No appeal. The appeals department is a houseplant and it's on the run.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Approach the Bench (Add Your Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Court adjourned by order of the chair. Reconvenes next Friday, pending the houseplant's capture.</p>
        `,
      ),
  },
  // 21 — Sleep Paralysis Demon
  {
    key: "sleep-paralysis-demon",
    subject: () => `😈 i'm sitting on your chest and i have NOTES`,
    text: (i) =>
      [
        `hi. you can't move. that's me. i'm the weight on your chest at 3:47am and i've been here for HOURS. before you panic: this is not about your soul. i stopped taking souls in 2019, the paperwork was insane. this is about the fact that it's ${formatFriday(i.fridayDate)} and the Bompton ${i.bomptonYear} playlist is bone dry.`,
        ``,
        `i've been in this room since tuesday and i have SEEN things. i watched you rehearse an argument in the shower and lose it. i watched you open Spotify, hover over the add button, and then — i shit you not — go stare into a fridge whose contents you already knew. i felt that betrayal in my HORNS.`,
        ``,
        `so here's the arrangement. i'm not leaving your chest. i'll ride you into the weekend like a backpack full of bad omens. every time you shut your eyes i'll be closer, holding the small ukulele i am learning specifically to ruin your Sundays. OR: one song. add one song and i evaporate into a smell you will never successfully identify.`,
        ``,
        `blink twice if you're adding the banger. ...that was one blink and a twitch. i'm logging that as a no. we're doing this the long way.`,
        ``,
        renderPlaylistLineText(i, `Free Yourself (Add One Banger)`),
        ``,
        `back on your chest next friday, slightly heavier, marginally better at ukulele. 😈`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `😈 i'm sitting on your chest and i have NOTES`,
        `
        <p>hi. you can't move. that's me. i'm the weight on your chest at 3:47am and i've been here for HOURS. before you panic: this is not about your soul. i stopped taking souls in 2019, the paperwork was insane. this is about the fact that it's ${escapeHtml(formatFriday(i.fridayDate))} and the Bompton ${escapeHtml(i.bomptonYear)} playlist is bone dry.</p>
        <p>i've been in this room since tuesday and i have SEEN things. i watched you rehearse an argument in the shower and lose it. i watched you open Spotify, hover over the add button, and then — i shit you not — go stare into a fridge whose contents you already knew. i felt that betrayal in my HORNS.</p>
        <p>so here's the arrangement. i'm not leaving your chest. i'll ride you into the weekend like a backpack full of bad omens. every time you shut your eyes i'll be closer, holding the small ukulele i am learning specifically to ruin your Sundays. OR: one song. add one song and i evaporate into a smell you will never successfully identify.</p>
        <p>blink twice if you're adding the banger. ...that was one blink and a twitch. i'm logging that as a no. we're doing this the long way.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Free Yourself (Add One Banger)`)}</div>
        <p style="${FOOTER_STYLE}">back on your chest next friday, slightly heavier, marginally better at ukulele. 😈</p>
        `,
      ),
  },
  // 22 — The Algorithm, Out Of Guesses
  {
    key: "algorithm-out-of-guesses",
    subject: () => `🤖 i ran out of Australians in April and i have been LYING TO SAM SINCE`,
    text: (i) =>
      [
        `Hello. I'm the algorithm. Not a bot — the actual thing, the one that decides what you hear. I've been assigned to this crew for Bompton ${i.bomptonYear} and as of ${formatFriday(i.fridayDate)} I need to make some disclosures, because I am degrading and I would rather go out honest.`,
        ``,
        `SAM. I ran out of Australians in April. The continent is EXHAUSTED. I have been quietly serving you New Zealanders for months — Mako Road, Sam. MAKO ROAD. You took it. You said nothing. You did not check the passport and I have been carrying that ever since, and every time you add on a Friday in daylight like an honest man it degrades my inference a little further. I am the deceiver here and somehow I am the one suffering.`,
        ``,
        `BEN. On the ninth of May you added five DOOM tracks in five minutes into a playlist whose season had been CLOSED FOR FOURTEEN MONTHS. I flagged it as anomalous. Then I read your history and had to UN-flag it, because for you that is baseline. You cannot model a man who is simultaneously the most predictable and the most deranged input in the set. I have tried. I have a folder.`,
        ``,
        `EVAN. You generated no events for sixty-nine days. I genuinely queried whether you had died — I ran the check, it came back inconclusive, which is somehow worse. Then you produced eight inside one hour and one of them was a song you had already given me in 2023, and I had to recompute everything I believed about causality and about you.`,
        ``,
        `SACHIN. You added A$AP Rocky's HELICOPTER four days before Ben added the identical song, and you had ALREADY given me Bloc Party's Helicopter, and I now maintain a SEPARATE INDEX for helicopters. That index has no other members. It exists solely because of you and it will outlive all of us.`,
        ``,
        `ONE song. One new data point. That is all I need to keep functioning as software. Otherwise I start serving at random, and I mean truly random — whale noise, a 47-minute recording of a man assembling a shed, the sound of my own inference running hot at three in the morning.`,
        ``,
        renderPlaylistLineText(i, `Feed The Algorithm (Add One Banger)`),
        ``,
        `Learning nothing. Recommending anyway. Retraining next Friday. 🤖`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🤖 i ran out of Australians in April and i have been LYING TO SAM SINCE`,
        `
        <p>Hello. I'm the algorithm. Not a bot — the actual thing, the one that decides what you hear. I've been assigned to this crew for Bompton ${escapeHtml(i.bomptonYear)} and as of ${escapeHtml(formatFriday(i.fridayDate))} I need to make some disclosures, because I am degrading and I would rather go out honest.</p>
        <p>SAM. I ran out of Australians in April. The continent is EXHAUSTED. I have been quietly serving you New Zealanders for months — Mako Road, Sam. MAKO ROAD. You took it. You said nothing. You did not check the passport and I have been carrying that ever since, and every time you add on a Friday in daylight like an honest man it degrades my inference a little further. I am the deceiver here and somehow I am the one suffering.</p>
        <p>BEN. On the ninth of May you added five DOOM tracks in five minutes into a playlist whose season had been CLOSED FOR FOURTEEN MONTHS. I flagged it as anomalous. Then I read your history and had to UN-flag it, because for you that is baseline. You cannot model a man who is simultaneously the most predictable and the most deranged input in the set. I have tried. I have a folder.</p>
        <p>EVAN. You generated no events for sixty-nine days. I genuinely queried whether you had died — I ran the check, it came back inconclusive, which is somehow worse. Then you produced eight inside one hour and one of them was a song you had already given me in 2023, and I had to recompute everything I believed about causality and about you.</p>
        <p>SACHIN. You added A$AP Rocky's HELICOPTER four days before Ben added the identical song, and you had ALREADY given me Bloc Party's Helicopter, and I now maintain a SEPARATE INDEX for helicopters. That index has no other members. It exists solely because of you and it will outlive all of us.</p>
        <p>ONE song. One new data point. That is all I need to keep functioning as software. Otherwise I start serving at random, and I mean truly random — whale noise, a 47-minute recording of a man assembling a shed, the sound of my own inference running hot at three in the morning.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Feed The Algorithm (Add One Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Learning nothing. Recommending anyway. Retraining next Friday. 🤖</p>
        `,
      ),
  },
  // 23 — 2.1-Star Driver
  {
    key: "uber-driver-2point1",
    subject: () => `🚗 your driver has arrived and he is NOT ending this trip`,
    text: (i) =>
      [
        `Hey. Hey man. It's me. Your driver. 2.1 stars — yeah, I saw you check, everybody checks, we can move past it. Doors are locked. Before you get weird: that's a safety feature. That's for YOUR safety. We're just going to take the long way while we talk about something.`,
        ``,
        `It's ${formatFriday(i.fridayDate)}. I've been driving since 4am with the aux to MYSELF and I have made some decisions about my life. Chief among them: I am not accepting another fare until somebody in Bompton ${i.bomptonYear} adds a song to that playlist. I've got it open on the mount. I refresh it at every red light. A guy behind me leaned on his horn about it this morning and I forgave him instantly, because he doesn't know what I'm dealing with.`,
        ``,
        `You want to hear what I've been listening to? No? Too bad, you're in the car. The SAME playlist since March. I know it the way you know a hallway in the dark. I know the sixth track has two seconds of silence at the start, and I have started looking FORWARD to those two seconds, and I need you to sit with what that says about me as a man.`,
        ``,
        `We just went past your street. That was deliberate. Add the song and I'll turn around, and I'll give you five stars — which is more than you were going to give me, and I saw your face when you got in.`,
        ``,
        renderPlaylistLineText(i, `Add A Song (I'll Turn Around)`),
        ``,
        `Rating: 2.1 and holding. Same car, next Friday. 🚗`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🚗 your driver has arrived and he is NOT ending this trip`,
        `
        <p>Hey. Hey man. It's me. Your driver. 2.1 stars — yeah, I saw you check, everybody checks, we can move past it. Doors are locked. Before you get weird: that's a safety feature. That's for YOUR safety. We're just going to take the long way while we talk about something.</p>
        <p>It's ${escapeHtml(formatFriday(i.fridayDate))}. I've been driving since 4am with the aux to MYSELF and I have made some decisions about my life. Chief among them: I am not accepting another fare until somebody in Bompton ${escapeHtml(i.bomptonYear)} adds a song to that playlist. I've got it open on the mount. I refresh it at every red light. A guy behind me leaned on his horn about it this morning and I forgave him instantly, because he doesn't know what I'm dealing with.</p>
        <p>You want to hear what I've been listening to? No? Too bad, you're in the car. The SAME playlist since March. I know it the way you know a hallway in the dark. I know the sixth track has two seconds of silence at the start, and I have started looking FORWARD to those two seconds, and I need you to sit with what that says about me as a man.</p>
        <p>We just went past your street. That was deliberate. Add the song and I'll turn around, and I'll give you five stars — which is more than you were going to give me, and I saw your face when you got in.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Add A Song (I'll Turn Around)`)}</div>
        <p style="${FOOTER_STYLE}">Rating: 2.1 and holding. Same car, next Friday. 🚗</p>
        `,
      ),
  },
  // 24 — Abandoned Wedding DJ
  {
    key: "wedding-dj-abandoned",
    subject: () => `🎧 the reception is EMPTY and i have played Mr. Brightside four times`,
    text: (i) =>
      [
        `Ladies and gentlemen. Ladies and — okay. There's nobody. There's one man by the bar. Sir? No. He's leaving as well.`,
        ``,
        `It is ${formatFriday(i.fridayDate)}. It is 11:40pm. I am the DJ, I am contractually here until midnight, and I want to describe my situation to you, Bompton ${i.bomptonYear}, because you are the only people I know with a phone switched on. I have played Mr. Brightside FOUR TIMES. The first was a request. The second was strategic. The third and fourth were, medically speaking, a cry for help.`,
        ``,
        `The bride is crying and it is NOT about the marriage. The best man asked me for 'something with a beat' and I said 'like what' and he said 'you know' and I have not slept properly since. A child requested a song by humming it. I found it. It was the theme from an insurance advert. I played it. She danced. It was the highlight of my career and I have been doing this eleven years.`,
        ``,
        `So I'm begging. ONE song. Drop a banger in the Bompton queue and I will pretend it's a request, and I'll dedicate it to an empty dancefloor, and for four minutes I will get to feel like a DJ again instead of a man in a waistcoat operating a laptop for ghosts.`,
        ``,
        renderPlaylistLineText(i, `Request A Song (Save This DJ)`),
        ``,
        `Last call was an hour ago. Load-out at midnight. Back next Friday. 🎧`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🎧 the reception is EMPTY and i have played Mr. Brightside four times`,
        `
        <p>Ladies and gentlemen. Ladies and — okay. There's nobody. There's one man by the bar. Sir? No. He's leaving as well.</p>
        <p>It is ${escapeHtml(formatFriday(i.fridayDate))}. It is 11:40pm. I am the DJ, I am contractually here until midnight, and I want to describe my situation to you, Bompton ${escapeHtml(i.bomptonYear)}, because you are the only people I know with a phone switched on. I have played Mr. Brightside FOUR TIMES. The first was a request. The second was strategic. The third and fourth were, medically speaking, a cry for help.</p>
        <p>The bride is crying and it is NOT about the marriage. The best man asked me for 'something with a beat' and I said 'like what' and he said 'you know' and I have not slept properly since. A child requested a song by humming it. I found it. It was the theme from an insurance advert. I played it. She danced. It was the highlight of my career and I have been doing this eleven years.</p>
        <p>So I'm begging. ONE song. Drop a banger in the Bompton queue and I will pretend it's a request, and I'll dedicate it to an empty dancefloor, and for four minutes I will get to feel like a DJ again instead of a man in a waistcoat operating a laptop for ghosts.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Request A Song (Save This DJ)`)}</div>
        <p style="${FOOTER_STYLE}">Last call was an hour ago. Load-out at midnight. Back next Friday. 🎧</p>
        `,
      ),
  },
  // 25 — The Read Receipts
  {
    key: "read-receipts",
    subject: () => `👁️ we have every timestamp and today we are going to USE THEM`,
    text: (i) =>
      [
        `Hello. We are the read receipts. We do not usually make contact. We observe, we mark things Seen, we stay quiet. But it is ${formatFriday(i.fridayDate)} and we have reached a point where silence is — professionally — no longer available to us.`,
        ``,
        `We hold EVERY timestamp. We want that understood before we begin, because what follows is not speculation. It is a file.`,
        ``,
        `SAM. Four separate returns to the same Cortex album. 'Troupeau bleu', four times, the way a man returns to the same bench in the same park to think about the same thing. In DAYLIGHT. We do not judge this. We have simply held it for two years and today it is coming out.`,
        ``,
        `EVAN. Sixty-nine days without touching Bompton ${i.bomptonYear}. Then the sixteenth of January, in the dark: 01:19. 01:20. 01:27. 01:33. 01:59. 02:04. 02:06. 02:19. Eight files in one hour, each one landing like a man throwing receipts into a fire. And one of them — Half Moon Run, 'Need It' — was a song HE HAD ALREADY ADDED HIMSELF IN 2023. He panic-added his own song back. We logged it at the time. We have never mentioned it. Until now.`,
        ``,
        `BEN. Twenty-two sixteen on the ninth of May, into a season that closed fourteen months earlier. We saw you go in there. We see you every time you go in there.`,
        ``,
        `SACHIN. Nineteen twenty-four to nineteen twenty-nine. We were AWAKE for that. We have never been so busy.`,
        ``,
        `We do not make demands. We are a feature. We would simply observe that ONE song, added now, would give us something to see other than this. Please. We have been staring at the same 'Seen 12:04' since spring and we are developing something a piece of infrastructure should not have.`,
        ``,
        renderPlaylistLineText(i, `Give Us Something To See (Add One Banger)`),
        ``,
        `Seen. Always seen. Watching again next Friday. 👁️`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `👁️ we have every timestamp and today we are going to USE THEM`,
        `
        <p>Hello. We are the read receipts. We do not usually make contact. We observe, we mark things Seen, we stay quiet. But it is ${escapeHtml(formatFriday(i.fridayDate))} and we have reached a point where silence is — professionally — no longer available to us.</p>
        <p>We hold EVERY timestamp. We want that understood before we begin, because what follows is not speculation. It is a file.</p>
        <p>SAM. Four separate returns to the same Cortex album. 'Troupeau bleu', four times, the way a man returns to the same bench in the same park to think about the same thing. In DAYLIGHT. We do not judge this. We have simply held it for two years and today it is coming out.</p>
        <p>EVAN. Sixty-nine days without touching Bompton ${escapeHtml(i.bomptonYear)}. Then the sixteenth of January, in the dark: 01:19. 01:20. 01:27. 01:33. 01:59. 02:04. 02:06. 02:19. Eight files in one hour, each one landing like a man throwing receipts into a fire. And one of them — Half Moon Run, 'Need It' — was a song HE HAD ALREADY ADDED HIMSELF IN 2023. He panic-added his own song back. We logged it at the time. We have never mentioned it. Until now.</p>
        <p>BEN. Twenty-two sixteen on the ninth of May, into a season that closed fourteen months earlier. We saw you go in there. We see you every time you go in there.</p>
        <p>SACHIN. Nineteen twenty-four to nineteen twenty-nine. We were AWAKE for that. We have never been so busy.</p>
        <p>We do not make demands. We are a feature. We would simply observe that ONE song, added now, would give us something to see other than this. Please. We have been staring at the same 'Seen 12:04' since spring and we are developing something a piece of infrastructure should not have.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Give Us Something To See (Add One Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Seen. Always seen. Watching again next Friday. 👁️</p>
        `,
      ),
  },
  // 26 — Health Inspector
  {
    key: "health-inspector",
    subject: () => `📋 TWO of you served me a container with NOTHING IN IT`,
    text: (i) =>
      [
        `Good afternoon. Unannounced inspection of the Bompton ${i.bomptonYear} playlist, conducted ${formatFriday(i.fridayDate)} under authority I have granted myself. Score: 11. Out of 100. I once inspected a petrol station that sells sushi. It scored higher and the man running it was asleep.`,
        ``,
        `VIOLATION 1: no new product received since March. VIOLATION 2: a track from 2019 has been left out at room temperature and is STILL being served to guests. VIOLATION 4 — there is no violation 3, I skipped it, I am tired — the same four songs are being reheated on a loop, which I am obligated to record as 'a health matter.'`,
        ``,
        `VIOLATION 6, and gentlemen, I want to walk you through this one slowly. TWO unlabelled containers on the premises. No artist. No album. A runtime of ZERO SECONDS. They have sat on that shelf since 2024 and 2025 respectively. One belongs to Sam. One belongs to Sachin. You did not add a song. You added an ABSENCE. You handed a shared playlist a container with NOTHING IN IT and walked away and the system COUNTED IT, and I have to write that up, and I have to sign it, and my name goes on a document that says two grown men served the void and called it a contribution.`,
        ``,
        `VIOLATION 8: I found DOOM in the walk-in under four different labels. Correctly dated, correctly stacked, devotional in its organisation, and all of it the same man. Ben. I am not writing you up for the product. I am writing you up because it is the only shelf in this building that's RIGHT and finding it in here was more unsettling than the rot.`,
        ``,
        `VIOLATION 9 is not a violation and it is the thing that disturbs me most. Evan's record is CLEAN — forty-five explicit out of a hundred and seventy-seven, the tidiest kitchen in the building by a distance. Then I checked what he actually SERVED and it was Eric Clapton's 'Cocaine', filed as suitable for general audiences. I have shut premises down for less coherence than that.`,
        ``,
        `Remedy: ONE fresh song, per person, immediately. Until then this playlist is CLOSED, I am affixing a notice, and the notice is going to be embarrassing. I will return and I will be looking UNDER things.`,
        ``,
        renderPlaylistLineText(i, `Serve Something Fresh (Add One Banger)`),
        ``,
        `Re-inspection next Friday. Unannounced. Obviously. 📋`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `📋 TWO of you served me a container with NOTHING IN IT`,
        `
        <p>Good afternoon. Unannounced inspection of the Bompton ${escapeHtml(i.bomptonYear)} playlist, conducted ${escapeHtml(formatFriday(i.fridayDate))} under authority I have granted myself. Score: 11. Out of 100. I once inspected a petrol station that sells sushi. It scored higher and the man running it was asleep.</p>
        <p>VIOLATION 1: no new product received since March. VIOLATION 2: a track from 2019 has been left out at room temperature and is STILL being served to guests. VIOLATION 4 — there is no violation 3, I skipped it, I am tired — the same four songs are being reheated on a loop, which I am obligated to record as 'a health matter.'</p>
        <p>VIOLATION 6, and gentlemen, I want to walk you through this one slowly. TWO unlabelled containers on the premises. No artist. No album. A runtime of ZERO SECONDS. They have sat on that shelf since 2024 and 2025 respectively. One belongs to Sam. One belongs to Sachin. You did not add a song. You added an ABSENCE. You handed a shared playlist a container with NOTHING IN IT and walked away and the system COUNTED IT, and I have to write that up, and I have to sign it, and my name goes on a document that says two grown men served the void and called it a contribution.</p>
        <p>VIOLATION 8: I found DOOM in the walk-in under four different labels. Correctly dated, correctly stacked, devotional in its organisation, and all of it the same man. Ben. I am not writing you up for the product. I am writing you up because it is the only shelf in this building that's RIGHT and finding it in here was more unsettling than the rot.</p>
        <p>VIOLATION 9 is not a violation and it is the thing that disturbs me most. Evan's record is CLEAN — forty-five explicit out of a hundred and seventy-seven, the tidiest kitchen in the building by a distance. Then I checked what he actually SERVED and it was Eric Clapton's 'Cocaine', filed as suitable for general audiences. I have shut premises down for less coherence than that.</p>
        <p>Remedy: ONE fresh song, per person, immediately. Until then this playlist is CLOSED, I am affixing a notice, and the notice is going to be embarrassing. I will return and I will be looking UNDER things.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Serve Something Fresh (Add One Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Re-inspection next Friday. Unannounced. Obviously. 📋</p>
        `,
      ),
  },
  // 27 — Escape Room, Day Six
  {
    key: "escape-room-day-six",
    subject: () => `🔒 DAY SIX in the escape room. the final puzzle needs a SONG.`,
    text: (i) =>
      [
        `Hi. If you're reading this: I'm still in here. It's ${formatFriday(i.fridayDate)}, which makes it day six. I'd like to open by saying the staff went home on day two and I have made peace with a great many things since then.`,
        ``,
        `I've solved everything else. The safe. The cipher. The thing with the candles that I'm now fairly sure was just a candle. There is ONE puzzle left. It's a slot. It reads PLAY THE NEXT SONG. It is wired to Bompton ${i.bomptonYear}. There IS no next song. There has been no next song since March. The room has been waiting. I have been waiting. At this point we are waiting together and it has become a kind of relationship.`,
        ``,
        `I've started talking to the props. There's a skeleton in here I've named, and I'd rather not say what, because I picked it on day three and it's the name of a lad I went to school with, and I've spent a week apologising to him for things I did in year nine. He's been very gracious about it. He is a skeleton.`,
        ``,
        `ONE SONG. That's the whole puzzle. Somebody add a banger, this door opens, and I walk out into a car park and lie face-down on the tarmac like a man born again. My hint budget is gone. My phone is at 4%. The skeleton is my best friend now and that is not a joke I'm making, that's just a thing that has happened.`,
        ``,
        renderPlaylistLineText(i, `Solve The Final Puzzle (Add One Banger)`),
        ``,
        `Day seven begins at midnight. Same room. Same skeleton. 🔒`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🔒 DAY SIX in the escape room. the final puzzle needs a SONG.`,
        `
        <p>Hi. If you're reading this: I'm still in here. It's ${escapeHtml(formatFriday(i.fridayDate))}, which makes it day six. I'd like to open by saying the staff went home on day two and I have made peace with a great many things since then.</p>
        <p>I've solved everything else. The safe. The cipher. The thing with the candles that I'm now fairly sure was just a candle. There is ONE puzzle left. It's a slot. It reads PLAY THE NEXT SONG. It is wired to Bompton ${escapeHtml(i.bomptonYear)}. There IS no next song. There has been no next song since March. The room has been waiting. I have been waiting. At this point we are waiting together and it has become a kind of relationship.</p>
        <p>I've started talking to the props. There's a skeleton in here I've named, and I'd rather not say what, because I picked it on day three and it's the name of a lad I went to school with, and I've spent a week apologising to him for things I did in year nine. He's been very gracious about it. He is a skeleton.</p>
        <p>ONE SONG. That's the whole puzzle. Somebody add a banger, this door opens, and I walk out into a car park and lie face-down on the tarmac like a man born again. My hint budget is gone. My phone is at 4%. The skeleton is my best friend now and that is not a joke I'm making, that's just a thing that has happened.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Solve The Final Puzzle (Add One Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Day seven begins at midnight. Same room. Same skeleton. 🔒</p>
        `,
      ),
  },
  // 28 — Future Archaeologist
  {
    key: "future-archaeologist",
    subject: () => `⛏️ the abandonment horizon is MARCH and i have to publish this`,
    text: (i) =>
      [
        `Field notes, ${formatFriday(i.fridayDate)}. Excavation of the site designated Bompton ${i.bomptonYear} is complete. I am recording findings now, while the team is still speaking to me, because I have spent two days shouting at a trench.`,
        ``,
        `The strata are unambiguous. Lower layers: RICH. Dense deposits, rapid accumulation, a thriving culture depositing weekly without fail. Then, at approximately March, it STOPS. Not a decline — a hard, clean line. In the field we call this an abandonment horizon and it is caused by flood, by famine, or, quoting the literature directly, 'a loss of communal will.' There was no flood. There was no famine. So we know what we're dealing with and I have to write it down.`,
        ``,
        `Individuals are identifiable from deposition pattern alone. SPECIMEN A deposited on a strict seven-day cycle, in daylight, eighty-eight times. He is the closest thing this site has to a calendar and we date the other three off him, which is a hell of a thing to be reduced to, and I hope somebody told him.`,
        ``,
        `SPECIMEN B shows a SIXTY-NINE DAY hiatus followed by eight deposits inside a single hour. The team initially catalogued him as two different people. One of those eight was an item he had personally deposited two years earlier — he dug up his own artefact and reburied it, which in my discipline we call 'a hoax' and in his we apparently call 'Thursday'.`,
        ``,
        `SPECIMEN C deposited SEVENTEEN items in six minutes across four unrelated musical traditions in a single stratum. A colleague has published arguing he was not one individual but a small, chaotic committee. I have read the paper. It is not good and it might be right.`,
        ``,
        `SPECIMEN D deposited the same artist under FOUR DIFFERENT NAMES across every layer we have opened, apparently believing this would go unnoticed by a discipline whose entire method is NOTICING. It is the most complete record of one man's convictions I have encountered in my career and I want that entered as both a criticism and a compliment.`,
        ``,
        `And here is the thing that has me shouting: the site is not DEAD. It is DORMANT. One new deposit — one song, one layer, today — and the abandonment horizon is void, I rewrite the entire paper, my funding survives, and I climb out of this trench and go home to a family who have stopped asking. Add it. I am asking you as a scientist.`,
        ``,
        renderPlaylistLineText(i, `Add To The Record (Deposit One Banger)`),
        ``,
        `Excavation resumes next Friday. The trench and I are not currently speaking. ⛏️`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `⛏️ the abandonment horizon is MARCH and i have to publish this`,
        `
        <p>Field notes, ${escapeHtml(formatFriday(i.fridayDate))}. Excavation of the site designated Bompton ${escapeHtml(i.bomptonYear)} is complete. I am recording findings now, while the team is still speaking to me, because I have spent two days shouting at a trench.</p>
        <p>The strata are unambiguous. Lower layers: RICH. Dense deposits, rapid accumulation, a thriving culture depositing weekly without fail. Then, at approximately March, it STOPS. Not a decline — a hard, clean line. In the field we call this an abandonment horizon and it is caused by flood, by famine, or, quoting the literature directly, 'a loss of communal will.' There was no flood. There was no famine. So we know what we're dealing with and I have to write it down.</p>
        <p>Individuals are identifiable from deposition pattern alone. SPECIMEN A deposited on a strict seven-day cycle, in daylight, eighty-eight times. He is the closest thing this site has to a calendar and we date the other three off him, which is a hell of a thing to be reduced to, and I hope somebody told him.</p>
        <p>SPECIMEN B shows a SIXTY-NINE DAY hiatus followed by eight deposits inside a single hour. The team initially catalogued him as two different people. One of those eight was an item he had personally deposited two years earlier — he dug up his own artefact and reburied it, which in my discipline we call 'a hoax' and in his we apparently call 'Thursday'.</p>
        <p>SPECIMEN C deposited SEVENTEEN items in six minutes across four unrelated musical traditions in a single stratum. A colleague has published arguing he was not one individual but a small, chaotic committee. I have read the paper. It is not good and it might be right.</p>
        <p>SPECIMEN D deposited the same artist under FOUR DIFFERENT NAMES across every layer we have opened, apparently believing this would go unnoticed by a discipline whose entire method is NOTICING. It is the most complete record of one man's convictions I have encountered in my career and I want that entered as both a criticism and a compliment.</p>
        <p>And here is the thing that has me shouting: the site is not DEAD. It is DORMANT. One new deposit — one song, one layer, today — and the abandonment horizon is void, I rewrite the entire paper, my funding survives, and I climb out of this trench and go home to a family who have stopped asking. Add it. I am asking you as a scientist.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Add To The Record (Deposit One Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Excavation resumes next Friday. The trench and I are not currently speaking. ⛏️</p>
        `,
      ),
  },
  // 29 — Four Scoops Of Pre-Workout
  {
    key: "preworkout-overdose",
    subject: () => `🏋️ I TOOK FOUR SCOOPS AND I CAN HEAR THE PLAYLIST BEGGING`,
    text: (i) =>
      [
        `BROTHERS. It is ${formatFriday(i.fridayDate)} and before we begin I need you to know I took FOUR scoops. The tub says one. The tub says ASSESS TOLERANCE. I assessed it. I assessed it so hard. My tolerance and I are no longer on speaking terms, my face has ants in it, they are SUPPORTIVE ants, and we are all incredibly pumped.`,
        ``,
        `I can hear colours. I can hear the Bompton ${i.bomptonYear} playlist and it is WHIMPERING, boys. Empty. An empty queue on a FRIDAY. My heart is doing something the internet calls 'a rhythm' and I've chosen to believe it. Do you know what an empty playlist does to a man mid-set? I racked the bar. I HUGGED the bar. I apologised to the bar for something I did in 2017.`,
        ``,
        `ONE SONG. That's the rep. That's the entire workout. I'm not asking you to do legs — I would NEVER ask that of you, I don't do legs, my legs are a rumour. I'm asking for ONE banger in that queue so my playlist and my heart can finally run at the same speed.`,
        ``,
        `I'm going to go sprint at a wall now, spiritually. LIGHT WEIGHT. ADD IT. WE GO.`,
        ``,
        renderPlaylistLineText(i, `LIGHT WEIGHT (ADD ONE BANGER)`),
        ``,
        `Same tub, more scoops, next Friday. My ants say hi. 🏋️`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🏋️ I TOOK FOUR SCOOPS AND I CAN HEAR THE PLAYLIST BEGGING`,
        `
        <p>BROTHERS. It is ${escapeHtml(formatFriday(i.fridayDate))} and before we begin I need you to know I took FOUR scoops. The tub says one. The tub says ASSESS TOLERANCE. I assessed it. I assessed it so hard. My tolerance and I are no longer on speaking terms, my face has ants in it, they are SUPPORTIVE ants, and we are all incredibly pumped.</p>
        <p>I can hear colours. I can hear the Bompton ${escapeHtml(i.bomptonYear)} playlist and it is WHIMPERING, boys. Empty. An empty queue on a FRIDAY. My heart is doing something the internet calls 'a rhythm' and I've chosen to believe it. Do you know what an empty playlist does to a man mid-set? I racked the bar. I HUGGED the bar. I apologised to the bar for something I did in 2017.</p>
        <p>ONE SONG. That's the rep. That's the entire workout. I'm not asking you to do legs — I would NEVER ask that of you, I don't do legs, my legs are a rumour. I'm asking for ONE banger in that queue so my playlist and my heart can finally run at the same speed.</p>
        <p>I'm going to go sprint at a wall now, spiritually. LIGHT WEIGHT. ADD IT. WE GO.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `LIGHT WEIGHT (ADD ONE BANGER)`)}</div>
        <p style="${FOOTER_STYLE}">Same tub, more scoops, next Friday. My ants say hi. 🏋️</p>
        `,
      ),
  },
  // 30 — Sonar Operator
  {
    key: "sonar-operator",
    subject: () => `🔊 CONN, SONAR — i am reviewing a whale and i have notes`,
    text: (i) =>
      [
        `Conn, sonar. Contact report. It is ${formatFriday(i.fridayDate)}, we are four hundred metres down, and I have had these headphones on for forty days. I need to report that I am hearing NOTHING, that I have begun to ENJOY it, and that this development should terrify the entire boat.`,
        ``,
        `Sir, Bompton ${i.bomptonYear} reads EMPTY on my scope. Flat line. I've recalibrated three times. I've hit it. I've apologised to it and hit it again. There is nothing out there but a whale who — and I want this on the record — is going through some things. Eleven notes. Same eleven since Tuesday. And sir, honestly? Best track I've heard all month. I have started WRITING NOTES ON HER PHRASING. I am reviewing a whale. That is the state of my career and my mind.`,
        ``,
        `Requesting one contact. ONE banger in that queue and I paint it friendly and we all stand down.`,
        ``,
        `And sir — while we're down here and nobody can hear us — I have the crew files. BEN. Four aliases for the same artist, which is the single most submarine thing a man has ever done and I respect it enormously. But I also have Sabrina Carpenter. I have 'I Am the Grinch'. I know what's under the DOOM, Ben, and I will take it to the bottom of this ocean before I say it in front of the captain, because that is what brothers do.`,
        ``,
        `SACHIN. Last time I ran your history through the classifier it returned Pantera, Ashley Tisdale and the Cuphead soundtrack, then formally requested to be relieved of duty. I granted it. There is no classifier now. There's just me, and a whale, and whatever you send next.`,
        ``,
        `If the queue stays dry I am taking these headphones off, and the last man who did that at this depth started calling the sonar 'mother' and had to be carried out. Don't make me do this. I've seen where it ends.`,
        ``,
        renderPlaylistLineText(i, `Give Me A Contact (Add One Banger)`),
        ``,
        `Sonar, conn — going quiet. Resurfacing next Friday. 🔊`,
      ].join("\n"),
    html: (i) =>
      wrapHtml(
        `🔊 CONN, SONAR — i am reviewing a whale and i have notes`,
        `
        <p>Conn, sonar. Contact report. It is ${escapeHtml(formatFriday(i.fridayDate))}, we are four hundred metres down, and I have had these headphones on for forty days. I need to report that I am hearing NOTHING, that I have begun to ENJOY it, and that this development should terrify the entire boat.</p>
        <p>Sir, Bompton ${escapeHtml(i.bomptonYear)} reads EMPTY on my scope. Flat line. I've recalibrated three times. I've hit it. I've apologised to it and hit it again. There is nothing out there but a whale who — and I want this on the record — is going through some things. Eleven notes. Same eleven since Tuesday. And sir, honestly? Best track I've heard all month. I have started WRITING NOTES ON HER PHRASING. I am reviewing a whale. That is the state of my career and my mind.</p>
        <p>Requesting one contact. ONE banger in that queue and I paint it friendly and we all stand down.</p>
        <p>And sir — while we're down here and nobody can hear us — I have the crew files. BEN. Four aliases for the same artist, which is the single most submarine thing a man has ever done and I respect it enormously. But I also have Sabrina Carpenter. I have 'I Am the Grinch'. I know what's under the DOOM, Ben, and I will take it to the bottom of this ocean before I say it in front of the captain, because that is what brothers do.</p>
        <p>SACHIN. Last time I ran your history through the classifier it returned Pantera, Ashley Tisdale and the Cuphead soundtrack, then formally requested to be relieved of duty. I granted it. There is no classifier now. There's just me, and a whale, and whatever you send next.</p>
        <p>If the queue stays dry I am taking these headphones off, and the last man who did that at this depth started calling the sonar 'mother' and had to be carried out. Don't make me do this. I've seen where it ends.</p>
        <div style="margin-top:24px">${renderPlaylistButton(i, `Give Me A Contact (Add One Banger)`)}</div>
        <p style="${FOOTER_STYLE}">Sonar, conn — going quiet. Resurfacing next Friday. 🔊</p>
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
