# Crew lore — real material for the reminder emails

Facts about the crew, taken from the app's own data, for writing the personas in
`lib/friday-reminder-email.ts` and `lib/late-add-email.ts`. Every line here is **true
and checkable**. Generic gags ("Ben likes jazz rap") go stale after two sends; specific
true facts don't.

Last pulled 2026-11-14: 753 Bompton adds across four seasons, 4,353 logged plays, and
the send history of both emails. Mark a fact when you use it, so the next batch
reaches for something fresh.

## How to regenerate this

Sign in, open `/troubleshooting`, press **Create export link** under "Crew data
export", and give the link to whoever is writing the personas. It works without a
session for 24 hours and returns one JSON file: every Bompton add with its timestamp,
each member's archived plays and daily Spotify snapshots (top tracks and artists,
saved library, playlists, followed artists), and the reminder emails sent so far.
`lib/crew-export.ts` documents the shape.

The export is raw rows, not stats, so the aggregating is yours to do: per-member
counts, longest/shortest track, repeat artists and albums, add day-of-week and hour,
longest silence, duplicate adds. The outliers are the useful part; plain "top artist"
aggregates are not funnier than what we already had.

As of this pull the daily snapshots had only just started saving (one day, Ben only),
so everything about listening below comes from logged plays, plus Ben's top lists. A
later pull should have top artists, saved songs, playlists and followed artists for
all four.

## Rules for writing with these facts

The first two batches got these wrong. The third was written to them.

1. **Use a fact once.** "Seventeen songs in six minutes" appeared in eight different
   emails. A fact gets one email; a running *theme* (Evan and Phoebe Bridgers) is
   fine as long as the receipts change.
2. **Get the meaning right before the joke.** A pile of songs added at once is
   somebody paying off weeks of neglect. It is never a feat, a storm, or a record.
   Adding ahead of time (Ben) is dodging the Friday, not diligence. A long silence is
   a long silence.
3. **Be sparing.** One or two receipts in an email, not a table of four members'
   stats. Plenty of the best ones have none.
4. **Date it or read it live.** These emails go out for months and then come round
   again. "This season he has added 33 songs" is false by next week. Write "by
   mid-November", "in October 2026", "between July and November" — or use the live
   inputs (below), which are true on the day by construction.
5. **Local time.** `addedAt` and `playedAt` are **UTC**. The crew is on
   `America/Halifax` (UTC-3 in summer, UTC-4 in winter). An add logged at 01:00 UTC
   happened at 9 or 10pm the evening *before*. Convert before writing a clock time or
   a weekday. Every time in this file is local.
6. **The play log is partial.** Spotify only hands over the last 50 plays at each
   capture, so a count of plays is a minimum, and "never played X" means "not in the
   log". Say "logged" or "that the app caught".
7. **Leave the blank tracks alone.** Two entries have no title, no artist and a
   length of 0:00 (Sam 2024-08-16, Sachin 2025-10-13). They are songs Spotify has
   since pulled, not something anybody did.
8. **Don't guess at lives.** Nothing here says who anybody lives with, what they do
   for work, or who "Emily" is (a one-song playlist of Ben's). Leave those alone.

## What the numbers mean

- The rule is one song each, every Friday, 52 a season. Extra songs break it too.
- Seasons really started on 2023-03-24, 2024-03-22, 2025-03-21 and 2026-03-20.
  (`seasonStart()` computes a week early for the first two, which only matters if you
  recompute old lateness.)
- Songs per member, per season (target 52; current season is 35 Fridays in, to Nov 13):

  | | Ben | Evan | Sachin | Sam |
  |---|---|---|---|---|
  | 2023–24 | 52 | 52 | 52 | 53 |
  | 2024–25 | 52 | 53 | 47 | 47 |
  | 2025–26 | 52 | 50 | 52 | 52 |
  | 2026–27 | 36 | 33 | 35 | 35 |

- The whole crew fell away in February and March 2025 (five and six adds in total).
- The playlist is alive: 16 to 20 adds every month. Old copy claiming "no new song
  since March" was never true.

## Live inputs

Read when the email is sent, so they can't go stale. Prefer these to a hard-coded
number wherever one fits.

**Late-add** (`LateAddEmailInput`): `weeksBehind`, `missedFridays`, `standings`;
`roastNumber` (roast emails this season, counting this one); `lastAdd` (title, artist,
when); `listening` (plays logged since the first Friday still owed: count, top artist,
top track, last played). The last three can be null.

**Friday** (`FridayReminderEmailInput`): `week` (of 52); `owed` (songs each member
owes as the email goes out, today's included); `closedSeasons` (each member's count
in every finished season).

## Send history (to 2026-11-14)

- **Friday:** 25 sends, nothing repeated. Six from August were never sent and now
  queue behind the November batch: weather-forecast, health-inspector,
  escape-room-day-six, future-archaeologist, preworkout-overdose, sonar-operator.
  Two of those (weather-forecast, future-archaeologist) are built on the
  seventeen-songs fact framed as a marvel — rule 2.
- **Late-add:** 33 delivered. Of the first 18 personas, 13 had gone out twice and 5
  once; it had been repeating since 2026-09-24.
- **Roasts received:** Evan 14, Sachin 14, Ben 3, Sam 2.

---

## Evan

| Fact | Used in |
|---|---|
| 784 plays logged Jul 11 – Nov 12 2026. **Phoebe Bridgers 275 (35%)**, Waxahatchee 131, Men I Trust 49, Fleet Foxes 45, Lennie Gallant 26, Wintersleep 24. | taste-audit (275 of 784); sommelier (the names, no counts) |
| Most-played song: **'Kill Me' (Phoebe Bridgers), 27 plays**, Aug–Nov. Then 'Tigers Blood' ×21. | unwrapped ('Kill Me'); apology-form ('Tigers Blood') |
| **October 2026: six roasts in eleven days** (13, 15, 17, 19, 21, 23) before he added three songs in nine minutes on Sat Oct 24, 9:06–9:15pm. | local-man (six emails); terms-update (three in nine minutes) |
| **Oct 21 2026**, the day of the fifth of those: 17 plays logged, every one Phoebe Bridgers. No add. | press-conference |
| Catch-ups after silence, four since Oct 2025: 7 songs in 21 min (2025-10-19, 23 days absent); 8 in an hour (2026-01-15, 68 days absent, 8 behind); 3 in 20 min (2026-05-22); 3 in 9 min (2026-10-24). | terms-update ("four times since October 2025"). The 8-in-an-hour figure: nature-doc, read-receipts, future-archaeologist |
| The night before the 68-day silence (Fri 2025-11-07, 11:59pm) he added Stella Donnelly's **'Laying Low'**, and one more a minute later. | wikipedia |
| First song of the Oct 2025 catch-up: Pink Floyd, **'Wish You Were Here'**. Last song of the Jan 2026 one: 'Words I should've said'. | roast-night ('Wish You Were Here'); the other is unused |
| **Adds rap he doesn't play.** Freddie Gibbs ×4, The Alchemist ×4, Earl Sweatshirt ×3, Madlib ×3, Westside Gunn ×3 added; none of them anywhere in the play log. | roast-night (Gibbs, Alchemist) |
| **None of Sachin's 35 adds this season appear in his play log.** Ben's: 2 plays. Sam's: 5. His own: 100. | nobody-listens |
| 'Fiero GT' (Men I Trust), **51 seconds**, added Sat 2026-04-18 as one of two catch-up adds. | museum-guide; weather-forecast |
| This season 11 of his first 33 songs arrived on the Friday they were due; worst single one 21 days late. 2025–26: more than 500 days late in total, 8 behind at worst. | the-odds (11 of 33; "later than 19 days with one song"); wikipedia (500 days) |
| Added Phoebe Bridgers' 'Halloween' on Halloween 2026. Five Phoebe songs this season, nine all-time. | surprise-party |
| Added songs the others already had: 'Sun, I Rise' (Ben's), 'Smoke Break-Dance' (Sam's), 'Image' (Sam 2024-12-28, Evan 2026-10-05). | vacancy ('Image') |
| Re-added his own 'Need It' (Half Moon Run, 2023) during the Oct 2025 catch-up. | courtroom-judge, future-archaeologist |
| Tue 2026-09-29, 10:56–11:07am: Tyler, The Creator's 'Noid' started six times in eleven minutes. | true-crime |
| Nearly half of everything he has ever added (91 of 188) arrived between 8pm and midnight. | unwrapped; cosmic ("night adder") |
| Finished 2025–26 two short (50) and 2024–25 one over (53). | agm-minutes (live) |
| Saturday 62, Friday 43 across all seasons. Cleanest record (45 explicit of 177) and the one who added 'Cocaine'. Avril Lavigne's 'I'm with You'. | drill-sergeant-hype; health-inspector |

## Sachin

| Fact | Used in |
|---|---|
| **2025–26: one song in the first seventeen weeks**, then **seventeen in five minutes** on Mon 2025-07-21, 4:24–4:29pm, to clear a seventeen-week debt. Longest silence 112 days (2025-03-19 → 07-09). | wikipedia — the one use in the November batch, framed as debt. Earlier, framed as a feat: sports-announcer, weather-forecast, rogue-sentient-playlist, future-archaeologist, and the late-add batch of Aug 2026. **Retire it.** |
| **One song behind for 38 straight days** (Sep 19 – Oct 26 2026) while 628 plays were logged. | local-man |
| 1,872 plays logged May 8 – Nov 14 across 470 artists. Tinashe 86 (all since Oct 3), KNEECAP 60, LISA 56, Le Castle Vania 50, Justice 46. | sommelier (Le Castle Vania, never added) |
| **'Pillow Fight' (Tinashe), 38 plays** in under a month; added it Oct 4. | unwrapped |
| **Ashley Tisdale, 'Be Good to Me': 21 plays** Jul 22 – Sep 22, one at 4:48am on Sat Aug 1. Added it Jul 25. | taste-audit |
| Justice, 'Pusher' (GTA VI score): 36 plays in two weeks, **eight in a row** on the morning of Fri Oct 30, having added it at **1:43am** that day. | true-crime |
| FromSoftware boss themes for fun. 'Heolstor the Nightlord' five times on Sat Sep 26, the first at 4:07am. | you-died |
| Plays logged after midnight on **63 different nights** (May–Nov). All-time, 39 adds between midnight and 5am. | unwrapped (63 nights); surprise-party (39 adds) |
| Answers a roast in **one minute** (Aug 11: email 2:42pm, add 2:43pm; Oct 27: 2:12 → 2:13) or not for days (Aug 18–24: five roasts in seven days). | terms-update (one minute); wikipedia (five in seven days) |
| BLACKPINK: has added the group, LISA twice, JENNIE and ROSÉ. Never JISOO. | roast-night |
| **The only one who plays the others' adds**: 12 of Ben's songs, 14 of Evan's, 11 of Sam's this season. In return: Ben 2 plays of his, Evan 0, Sam 2. | nobody-listens |
| Adds what he has on loop. Shakira's 'Dai Dai' six times on Aug 11, added that afternoon. 'Rather Be' (Clean Bandit, 2014) 13 times in ten days in Oct 2026, then added. 'Gasoline Dreams' ×22. | press-conference ('Dai Dai'); roast-night ('Rather Be'); apology-form ('Gasoline Dreams') |
| This season's adds include Lamb of God, Rihanna, Shakira and Stromae. Earlier range: Pantera → Ashley Tisdale → BLACKPINK → Cuphead OST → 'GAS GAS GAS'. | roast-night (this season's four); cosmic, sonar-operator (the earlier list) |
| Re-added 'Tanglewood' (The East Pointers) in Aug 2026; it was in the July 2025 dump. | museum-guide |
| Ten of his first 35 this season arrived on the Friday they were due. | the-odds |
| Still five short in 2024–25 (47). | agm-minutes (live) |
| Titles he has added: 'Where's My Phone?', 'WHERE IS MY HUSBAND!', 'You Know I'm No Good', 'Running From Yourself', 'Busy Earnin''. | — |
| Three helicopters: A$AP Rocky's 'HELICOPTER' four days before Ben added it, plus Bloc Party's 'Helicopter'. 32 Monday adds all-time. | algorithm; drill-sergeant-hype |

## Ben

| Fact | Used in |
|---|---|
| **Three roasts; added 3, 30 and 5 minutes after them.** | local-man |
| **Pays ahead.** Thu 2026-10-22: three songs in one minute while not behind, covering the next three Fridays. 13 of his first 36 adds this season were on a Friday. | surprise-party |
| **The same song twice in one season, three seasons of four**: 'Killers' (2023–24), 'Drinking Sessions' (2025–26), 'No Gold Teeth' (2026–27, Jun 26 and Oct 9). It is why he is one over this season. | museum-guide ('No Gold Teeth'); courtroom-judge ('Drinking Sessions') |
| Sat 2026-05-09, 7:16–7:21pm: **five DOOM tracks into the 2024–25 playlist**, fourteen months after it closed, to fill a five-song hole. | wikipedia; algorithm, rogue-sentient-playlist |
| Spotify's all-time top artists for him (2026-11-14): Kendrick, McKinley Dixon, Ka, **Zach Bryan (4)**, Tyler Childers, **Taylor Swift (6)** … MF DOOM (12). Added: DOOM 13 times, Taylor Swift never, Zach Bryan never. | taste-audit |
| 599 plays logged (May–Jul and Nov; nothing logged Aug–Oct). **Jessie Ware 57**, about one in ten. Three Jessie Ware songs off one album added in eight weeks. Saturdays and Sundays are 46% of his plays. | unwrapped |
| Plays of this season's adds: his own 46, Sachin's 2, Evan's 8, Sam's 10. | vacancy |
| Added 'White Flag' 17 days after Evan did, same season. 'HELICOPTER' five days after Sachin. | nobody-listens ('White Flag') |
| Playlists: 'Haloween', 'Apocoliptic', 'My playlist #35' (empty), 'Breakfast' (5 songs), 'Beer For Breakfast' (16), 'Superb Spanish Shit', 'ACAB', 'Sams birthday' (170). | roast-night (first three); press-conference (the breakfasts) |
| Cuphead soundtrack, starting with the tutorial, at 12:05am on Sat May 16. 'Talk Dirty' (Jason Derulo) at 12:25am on Sun May 17. | true-crime (Cuphead); roast-night ('Talk Dirty') |
| Fifty most-played songs in Nov 2026 include Phil Collins's 'On My Way' (Brother Bear) and a remix of 'Spooky, Scary Skeletons'. | sommelier |
| Billy Joel's 'Pressure' added at 11:43pm on Tue Jun 16 2026, three days early. | wikipedia |
| Five songs off one Tyler Childers album (Snipe Hunter). Four off one Aesop Rock album. | terms-update (Childers) |
| Listens through a device called 'Basement Stereo'. | apology-form |
| DOOM under four billings (MF DOOM, Madvillain, DANGERDOOM, JJ DOOM). Two different songs called 'Fentanyl' a week apart. Longest track in the archive ('Maggot Brain', 10:19). Sabrina Carpenter and 'I Am the Grinch'. | nature-doc, sports-announcer, health-inspector, sonar-operator |

## Sam

| Fact | Used in |
|---|---|
| **27 of his first 35 songs this season arrived on the Friday**, mostly between 9am and 3pm. A combined 19 days late all season. Never more than one behind. | unwrapped (27 of 35); the-odds (19 days) |
| **Had added before the Friday reminder even went out on 10 of 25 Fridays** (May 29 – Nov 13). | surprise-party |
| Two roasts ever, Aug 11 and Aug 18 2026; added about 10am the next morning both times. | local-man |
| 1,098 plays logged Jun 19 – Nov 10 across 466 artists. **Geese 95**, Noah Kahan 39, Tyler Childers 34, Peach Pit 26, Mt. Joy 24, Caamp 12; also John Summit and Fisher. | unwrapped (Geese); sommelier (Mt. Joy, Caamp, Childers, the house) |
| Geese at 3am on Sun Aug 9. Ben added Geese in July 2023; Sam's first Geese add was Jan 2026. | unwrapped |
| **Noah Kahan: 39 plays, never added.** Caamp the same. | taste-audit |
| Sun 2025-10-12, 6:49am: added a song to the **2023–24** playlist, nineteen months after it closed. That season now reads 53. | wikipedia; agm-minutes (live, the count only) |
| Still five short in 2024–25 (47). | agm-minutes (live) |
| Adds what the others already added: Sinatra's 'That's Life' six months after Ben; 'Easier Said Than Done' more than two years after Evan, then played it 14 times in four weeks. | museum-guide ('That's Life'); true-crime ('Easier Said Than Done') |
| Two plays each of Evan's and Sachin's adds this season. | nobody-listens |
| Real adds: 'Holy Moly, Rock n' Rolly, Guacamole' (a Friday morning), 'Doo Doo Doo Doo Doo'. Computer is called 'Bluenose'. | roast-night (Guacamole, Bluenose) |
| Adds rap ('Stir Fry', 'Devil In A New Dress', 'Bam', 'DNA.') while playing Geese and Noah Kahan. Pub songs ('Seven Drunken Nights', 'Sally MacLennane'). | — |
| 88 Friday adds all-time. Daylight adder. Cortex's *Troupeau bleu* four times. 'Pump It' and 'My Humps'. Mako Road is from New Zealand. | drill-sergeant-hype, doomsday-prepper, nature-doc, sports-announcer, read-receipts, algorithm |

## Crew-wide

| Fact | Used in |
|---|---|
| **Nobody plays anybody else's adds**, Sachin excepted (see each table). | nobody-listens |
| **All four adding on the same Friday happened once** in the first 35 weeks of 2026–27: May 22. | the-odds |
| Ben added within half an hour of the Friday reminder four times between May and November. | the-odds |
| Closed seasons that don't add up to 52 (table above). | agm-minutes (live) |
| May 2024, Kendrick beef week: all four added a Kendrick track inside seven hours. | cosmic |
| November 2024, GNX week: all four again. Christmas Eve 2023: three tracks in the same minute. CHROMAKOPIA: three of four within six hours of release. | — |

---

## Note on the two email surfaces

`lib/friday-reminder-email.ts` goes to all four at once. It can name anybody, and the
live `owed` list says where each of them stands that morning.

`lib/late-add-email.ts` is the public shaming: sent to whoever fell behind, CC'd to
the rest. Each persona is handed the offender, so it can and should be about that
person — `forOffender` picks the line written for them. (The August 2026 batch
assumed a persona couldn't know who it was addressing, and so leaned on the same
shared facts for everybody. That was a mistake in the code comments, not a limit.)
Since two people get most of these, a new batch needs enough distinct material that
the same person can receive ten in a row without hearing a fact twice.
