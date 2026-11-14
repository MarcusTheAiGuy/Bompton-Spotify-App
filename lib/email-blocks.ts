// A reminder email's body, written once and rendered as both its plain-text
// and its HTML part.
//
// The older personas in lib/late-add-email.ts and lib/friday-reminder-email.ts
// spell both parts out by hand. Anything new should be written as blocks, so
// the two parts can't drift apart.

export type Block =
  // A paragraph. **Double asterisks** make bold.
  | string
  | { heading: string }
  | { list: string[] }
  // The link to the playlist, with this label.
  | { button: string }
  // Small grey sign-off line.
  | { footer: string }
  // Skipped, so a body can say `condition && "..."` or use a lookup that
  // has nothing for this recipient.
  | null
  | undefined
  | false;

// How the playlist link reads in each part. Each email has its own wording
// for when no playlist link is on file.
export type PlaylistLink = {
  text: (label: string) => string;
  html: (label: string) => string;
};

const HEADING_STYLE =
  "font-size:14px;text-transform:uppercase;letter-spacing:.15em;color:#a3a3a3;margin-top:24px";
const LIST_STYLE = "margin:8px 0 0;padding-left:20px";
const FOOTER_STYLE = "margin-top:24px;color:#a3a3a3;font-size:12px";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineText(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1");
}

function inlineHtml(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

export function renderBlocks(
  blocks: Block[],
  playlistLink: PlaylistLink,
): { text: string; html: string } {
  const text: string[] = [];
  const html: string[] = [];
  for (const block of blocks) {
    if (!block) continue;
    if (typeof block === "string") {
      text.push(inlineText(block));
      html.push(`<p>${inlineHtml(block)}</p>`);
    } else if ("heading" in block) {
      text.push(inlineText(block.heading).toUpperCase());
      html.push(
        `<h2 style="${HEADING_STYLE}">${inlineHtml(block.heading)}</h2>`,
      );
    } else if ("list" in block) {
      text.push(block.list.map((item) => `  - ${inlineText(item)}`).join("\n"));
      html.push(
        `<ul style="${LIST_STYLE}">${block.list
          .map((item) => `<li>${inlineHtml(item)}</li>`)
          .join("")}</ul>`,
      );
    } else if ("button" in block) {
      text.push(playlistLink.text(block.button));
      html.push(
        `<div style="margin-top:24px">${playlistLink.html(block.button)}</div>`,
      );
    } else {
      text.push(inlineText(block.footer));
      html.push(`<p style="${FOOTER_STYLE}">${inlineHtml(block.footer)}</p>`);
    }
  }
  return { text: text.join("\n\n"), html: html.join("\n") };
}

const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

// "one song", "three songs", "14 songs".
export function count(
  n: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${NUMBER_WORDS[n] ?? n} ${n === 1 ? singular : plural}`;
}

// "1st", "2nd", "13th", "22nd".
export function ordinal(n: number): string {
  const lastTwo = n % 100;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13
      ? "th"
      : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
