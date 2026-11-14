import { createHmac, timingSafeEqual } from "node:crypto";

// Signed, expiring links to GET /api/crew-export.
//
// The export is read by whoever is writing the reminder emails, who has no
// Spotify session. A signed-in crew member creates a link on /troubleshooting
// and hands it over; the link works without a session until it expires. It
// is signed with the Auth.js secret, so only this deployment can mint one.

const LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;

function signature(expiresAtMs: number): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET (or AUTH_SECRET) is not set, so a crew-export link can't be signed or checked. Set it in the Vercel project's environment variables and redeploy.",
    );
  }
  return createHmac("sha256", secret)
    .update(`crew-export:${expiresAtMs}`)
    .digest("hex");
}

export function createCrewExportPath(): { path: string; expiresAt: Date } {
  const expiresAtMs = Date.now() + LINK_LIFETIME_MS;
  return {
    path: `/api/crew-export?exp=${expiresAtMs}&sig=${signature(expiresAtMs)}`,
    expiresAt: new Date(expiresAtMs),
  };
}

// Null when the link is good; otherwise what is wrong with it.
export function crewExportLinkProblem(
  exp: string | null,
  sig: string | null,
): string | null {
  if (!exp || !sig) {
    return "The link is missing its `exp` or `sig` parameter — it was probably cut off when it was copied.";
  }
  const expiresAtMs = Number(exp);
  if (!Number.isSafeInteger(expiresAtMs)) {
    return `The link's \`exp\` parameter ("${exp}") is not a timestamp.`;
  }
  const expected = Buffer.from(signature(expiresAtMs));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return "The link's signature doesn't match. It was edited or cut off when it was copied, or NEXTAUTH_SECRET has changed since it was created.";
  }
  if (Date.now() > expiresAtMs) {
    return `The link expired at ${new Date(expiresAtMs).toISOString()}.`;
  }
  return null;
}
