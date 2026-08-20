# Crew lore — real material for the reminder emails

Facts mined from all four Bompton playlists (701 tracks, 2023-03 → 2026-08), pulled
2026-08-20. Every line here is **true and checkable against the playlist data**, which
is the whole point: the reminder personas in `lib/friday-reminder-email.ts` used to
recycle four generic genre gags, and generic gags go stale after two sends. Specific
true facts don't.

Use this as the source of material when writing new personas. Mark facts as you burn
them so the next batch reaches for something fresh.

## How to regenerate this

The one-off export tooling (`/api/crew-dossier` + a `/troubleshooting` button) was
deleted after this pull — it was never meant to live in prod. To refresh, re-add a
read-only script that reads `Playlist` + `PlaylistTrack` from Neon, attributes each
row via the `SPOTIFY_USER_DISPLAY_NAMES` map in `lib/spotify-user-names.ts`, and
aggregates: per-member counts, longest/shortest track, repeat artists and albums,
add day-of-week and hour, biggest single-day binge, longest silence, duplicate adds.
The outliers are the useful part; plain "top artist" aggregates are not funnier than
what we already had.

## ⚠️ Timezone trap

`addedAt` is **UTC**. The crew is Atlantic (UTC-3 in summer, UTC-4 in winter). An add
logged at 01:00 UTC is ~9-10pm local the evening *before*, not 1am. Don't write "Evan
adds at 2am" off the raw hour — that was wrong in an earlier batch. Relative framing
("Evan adds at night, Sam adds in daylight") is always safe; specific local clock
times need converting first.

---

## Ben — 178 adds

| Fact | Used in |
|---|---|
| Has added DOOM under **four separate billings** — MF DOOM, Madvillain, DANGERDOOM, JJ DOOM — plus a Herbaliser guest spot. 12 MF DOOM credits total. | nature-doc, sports-announcer |
| On **2026-05-09, between 22:16 and 22:21**, added five DOOM tracks in five minutes — into the **2024-25 playlist**, a season that had closed ~14 months earlier. | algorithm, rogue-sentient-playlist |
| Added Big K.R.I.T.'s "Drinking Sessions" **twice into the same season**, seven months apart (2025-05-04, 2025-12-17). Slipped the duplicate check because one title says `(feat.` and the other says `- feat.` | courtroom-judge |
| Added The Red Clay Strays' "Killers" twice — 2023-12-24 and 2024-03-01. | — |
| Added two **different songs both called "Fentanyl"** a week apart (Conway the Machine 2024-06-30, Black Thought 2024-07-06). | health-inspector |
| Owns the longest track in the archive: **Funkadelic — Maggot Brain, 10:19**. | — |
| Most explicit tracks of anyone: **104 of 178**. | — |
| Also responsible for Sabrina Carpenter's "Please Please Please" and Tyler's "I Am the Grinch". The range is wider than he lets on. | sonar-operator |
| 69 Friday adds — second-best attendance. Adds in the evening (peak 22:00 UTC). | — |

## Evan — 177 adds

| Fact | Used in |
|---|---|
| **Vanished for 69 days** (2025-11-08 → 2026-01-16), then broke it by adding **eight tracks in one hour** (01:19 → 02:19 UTC). | nature-doc, read-receipts |
| Did it again: **seven tracks in 21 minutes** on 2025-10-19 (23:04 → 23:25). | — |
| During that October catch-up he **re-added Half Moon Run's "Need It"** — a song he had already added in **May 2023**. Panic-added his own song back. | courtroom-judge |
| **Saturday 62, Friday 43** — misses the actual day more often than he hits it. | drill-sergeant-hype |
| **Cleanest record of anyone: 45/177 explicit** — and he's the one who added Eric Clapton's "Cocaine". | health-inspector |
| Added a **51-second song** (Men I Trust — "Fiero GT") as an entire week's contribution. | weather-forecast |
| Added Arcade Fire's "Haiti" and "Rebellion (Lies)" **in the same minute**. | — |
| Night adder (peak 01:00 UTC ×29). Fleet Foxes ×6, Half Moon Run ×6, Stella Donnelly ×6. | cosmic |
| Also has Avril Lavigne's "I'm with You" on the record. | — |

## Sachin — 172 adds

| Fact | Used in |
|---|---|
| **Seventeen tracks in six minutes** on 2025-07-21 (19:24 → 19:29). An entire season's backlog cleared in one sitting. | sports-announcer, weather-forecast |
| **Longest silence of anyone: 112 days** (2025-03-19 → 2025-07-09). The 17-track dump came twelve days after he resurfaced. | rogue-sentient-playlist |
| **32 Monday adds** — Monday is his third-most-common day. Reliably three days late. | drill-sergeant-hype |
| Added a track with **no artist, no album, and a runtime of 0:00** (2025-10-13). It is still in the playlist. | health-inspector |
| Genuine range, with receipts: Pantera → Ashley Tisdale → BLACKPINK → the Cuphead OST → Tiësto's "Adagio for Strings" → "GAS GAS GAS - EXTENDED MIX". | cosmic, sonar-operator |
| Added A$AP Rocky's "HELICOPTER" **four days before Ben added the same song**; separately added Bloc Party's "Helicopter". Three helicopters. | algorithm |

## Sam — 174 adds

| Fact | Used in |
|---|---|
| **88 of 174 adds land on a Friday** — more than half, and 19 more Fridays than anyone else. He is the only one who actually does the thing. | drill-sergeant-hype, doomsday-prepper, nature-doc |
| Adds in **daylight** (peak 12:00-17:00 UTC). Everyone else is a night creature. | sports-announcer |
| **Biggest single day: 2 tracks.** Has never once binged. | — |
| Mined the **Cortex album _Troupeau bleu_ four separate times** (6 Cortex tracks overall). | read-receipts |
| Added **both "Pump It" and "My Humps"**. Committed to the bit. | — |
| Also has a **0:00 ghost track** (2024-08-16). Two of these exist in the archive. | health-inspector |
| **Backfilled the 2023-24 playlist in October 2025** — 19 months after that season closed. | — |
| Added Thee Sacred Souls' "Easier Said Than Done" in 2026; Evan had already added it in 2024. | — |
| The Australian thing is real (Old Mervs, Spacey Jane, Sticky Fingers, The Jungle Giants, The Grogans, Lime Cordiale, The Terrys, The Rions, Babe Rainbow, The Murlocs) — but **Mako Road is a New Zealand band**, so the "he wouldn't notice a Kiwi" joke is now load-bearing. | algorithm |

## Crew-wide

| Fact | Used in |
|---|---|
| **May 2024, Kendrick beef week: all four added a Kendrick track inside seven hours** — Not Like Us (Sachin, 19:07), euphoria (Ben, 20:31), The Heart Part 4 (Evan, 00:33), Like That (Sam, 01:56). | cosmic |
| **November 2024, GNX week: all four again**, five tracks in four days. | — |
| **Christmas Eve 2023, 00:32 UTC — three tracks landed in the same minute** (Ben ×1, Sam ×2). | — |
| Tyler's CHROMAKOPIA dropped 2024-11-01; three of four had a track from it within six hours. | — |
| **Two ghost tracks** (0:00, no artist, no album) sit in the archive — one Sam, one Sachin. | health-inspector |
| Season sizes: 2023-24 → 209 · 2024-25 → 199 · 2025-26 → 206 · 2026-27 → 87 (in progress). | — |

---

## Seams not mined yet

- `getListeningDedication` in `lib/bompton-stats.ts` computes how often each member
  actually **plays** tracks other members added. If `ListeningPlay` has accumulated
  enough rows, "nobody has ever played anything X added" is the most brutal true
  fact available and it is not yet used anywhere.
- Per-artist first-appearance: who introduced an artist the others then adopted.
- Gap between a track's release date and the add — who is always six months late to
  a record.

---

## Note on the two email surfaces

`lib/friday-reminder-email.ts` goes crew-wide, so it can name individuals and
use their own facts — that's where the per-person material above belongs.

`lib/late-add-email.ts` is the public shaming: sent TO whoever fell behind,
CC'd to everyone else. The rotation is global, so a persona there has no idea
who it is addressing and **cannot use recipient-specific facts**. What it can
use is the shared archive as a benchmark — "a man in this crew once cleared
112 days in six minutes and you can't manage one in three weeks." Those work
on anybody. The late-add batch added in this pass (autopsy, collections-agency,
missing-person-poster, intervention, trade-deadline, principals-office,
prison-yard, exorcism) all use that device.
