// Two-level genre taxonomy on top of Last.fm's free-form tags.
//
// Last.fm tags are crowdsourced, so the same genre arrives under
// many spellings ("hip hop", "hip-hop", "hiphop", "rap", "conscious
// hip hop"). Without canonicalization, the genre tracker double-
// counts these as separate rows, and the per-crew "top genres" list
// is full of near-duplicates.
//
// This module turns each tag into:
//   - a canonical name (synonyms collapsed, casing/spacing fixed)
//   - an umbrella category (Rap / Rock / Pop / …) when one applies
//
// Pipeline order matters. Inputs to canonicalizeTag must already be
// post-cleanTagName form (lowercase, hyphens/underscores/slashes
// turned into spaces, whitespace collapsed) — that's how
// normalizeGenreTags in lib/lastfm.ts feeds us.
//
// Adding a new synonym/sub-genre: prefer SUBGENRE_UMBRELLA for
// "this exact tag belongs to umbrella X" mappings. Reserve
// SYNONYM_PATTERNS for true rewrites where one phrase IS another
// ("hip hop" IS "rap"). Suffix matching catches the obvious
// "<modifier> <umbrella>" shape automatically — don't add those.
//
// Correctness over coverage: better to leave an obscure tag
// unmapped (it just won't pick an umbrella) than to mis-bucket it.

// Substring rewrites applied to the canonical (post-cleanTagName)
// form. These are TRUE synonyms: the LHS phrase IS the RHS phrase
// in the music world, regardless of context. Word-boundary anchored
// so "trap" doesn't get rewritten by a "rap" rule and "rapper"
// stays put.
//
// Order matters when one rewrite's output could match another's
// input — apply most-specific first.
const SYNONYM_PATTERNS: Array<[RegExp, string]> = [
  // hip hop / rap — always normalize toward "rap" (shorter, single
  // token, doesn't fight with sub-genres like "conscious rap").
  [/\bhip hop\b/g, "rap"],
  [/\bhiphop\b/g, "rap"],
  // R&B variants — Last.fm exposes "rnb", "r and b", "r b" all the
  // time. Normalize to the standard "r&b" so the umbrella picker
  // sees one bucket.
  [/\brnb\b/g, "r&b"],
  [/\br and b\b/g, "r&b"],
  [/\bryhthm and blues\b/g, "r&b"],
  [/\brhythm and blues\b/g, "r&b"],
  // Electronic family
  [/\bedm\b/g, "electronic"],
  [/\belectronica\b/g, "electronic"],
  [/\belectronic dance music\b/g, "electronic"],
  // Misc
  [/\bd&b\b/g, "drum and bass"],
  [/\bdnb\b/g, "drum and bass"],
];

// Umbrella categories, ranked by priority. When a tag could plausibly
// belong to more than one umbrella ("indie rock" → indie OR rock?),
// the earlier entry wins. Order chosen so concrete musical genres
// outrank attitudes/positioning ("indie", "alternative") — those
// describe scene more than sound.
export const UMBRELLAS = [
  "rap",
  "metal",
  "punk",
  "country",
  "folk",
  "blues",
  "jazz",
  "soul",
  "funk",
  "r&b",
  "reggae",
  "latin",
  "electronic",
  "classical",
  "rock",
  "pop",
  "indie",
  "alternative",
] as const;

const UMBRELLA_SET = new Set<string>(UMBRELLAS);

// Sub-genres whose canonical name doesn't lexically contain their
// umbrella — so the suffix/word-match fallback can't find them.
// Anything that already ends in (or contains) a UMBRELLAS word as a
// whole word doesn't need to be listed: the resolver handles those
// automatically.
//
// Examples that DO need to live here:
//   "trap" → rap          (no "rap" in the string)
//   "house" → electronic  (no "electronic" in the string)
//   "shoegaze" → rock     (no "rock" in the string)
//
// Examples that DO NOT belong here:
//   "math rock"           (suffix "rock" matches)
//   "indie pop"           (word "pop" matches)
//   "g funk"              (word "funk" matches after cleanTagName)
const SUBGENRE_UMBRELLA: Record<string, string> = {
  // Rap (post-synonym-rewrite, so "hip hop" subs already became "rap")
  trap: "rap",
  drill: "rap",
  grime: "rap",
  "boom bap": "rap",
  // Electronic
  house: "electronic",
  techno: "electronic",
  dubstep: "electronic",
  trance: "electronic",
  "drum and bass": "electronic",
  ambient: "electronic",
  idm: "electronic",
  garage: "electronic",
  synthwave: "electronic",
  vaporwave: "electronic",
  breakbeat: "electronic",
  jungle: "electronic",
  // Rock-adjacent sub-genres without "rock" in the name
  shoegaze: "rock",
  emo: "rock",
  grunge: "rock",
  psychedelic: "rock",
  "post hardcore": "rock",
  // Metal
  thrash: "metal",
  doom: "metal",
  // Country / folk
  americana: "folk",
  bluegrass: "country",
  // Latin
  reggaeton: "latin",
  salsa: "latin",
  bachata: "latin",
  cumbia: "latin",
  // Pop adjacent
  synthpop: "pop",
  dreampop: "pop",
  "k pop": "pop",
  "j pop": "pop",
  // Jazz
  "bossa nova": "jazz",
  swing: "jazz",
  bebop: "jazz",
  // Soul/funk
  motown: "soul",
  // Reggae
  ska: "reggae",
  dancehall: "reggae",
};

// Apply true-synonym rewrites and re-collapse any whitespace they
// introduced. Idempotent.
export function canonicalizeTag(tag: string): string {
  let out = tag;
  for (const [pat, repl] of SYNONYM_PATTERNS) {
    out = out.replace(pat, repl);
  }
  return out.replace(/\s+/g, " ").trim();
}

// Resolve an umbrella for a (canonicalized) tag, or null if we can't
// confidently place it. Resolution order:
//   1. Tag IS an umbrella ("rock" → rock)
//   2. Explicit sub-genre table ("house" → electronic)
//   3. Last word of the tag is an umbrella ("math rock" → rock)
//   4. Any word in the tag is an umbrella, in UMBRELLAS priority
//      order ("electronic indie pop" → pop because pop wins over
//      indie/electronic in the priority list, after the suffix
//      check in step 3 fails)
export function umbrellaOf(tag: string): string | null {
  if (!tag) return null;
  if (UMBRELLA_SET.has(tag)) return tag;
  const explicit = SUBGENRE_UMBRELLA[tag];
  if (explicit) return explicit;
  const words = tag.split(/\s+/);
  const last = words[words.length - 1];
  if (last && UMBRELLA_SET.has(last)) return last;
  const wordSet = new Set(words);
  for (const umb of UMBRELLAS) {
    if (wordSet.has(umb)) return umb;
  }
  return null;
}
