import type { NextRequest } from "next/server";

// Returns true if the request originated from a Vercel cron invocation,
// OR from a caller presenting CRON_SECRET as a Bearer token. Returns
// false otherwise — we fail closed so the public cron URL can't be hit
// by anyone on the internet to trigger a crew-wide Spotify sync and
// roast-email blast.
//
// Vercel attaches `x-vercel-cron: 1` to every cron-triggered invocation,
// and client-supplied headers in the `x-vercel-*` namespace are stripped
// at the edge, so the header is trustworthy when present. No env var
// setup required — but if you also want a manual override (e.g. to
// trigger from curl during testing), set CRON_SECRET in the project's
// environment variables and send `Authorization: Bearer $CRON_SECRET`.
export function isAuthorizedCron(request: NextRequest): boolean {
  if (request.headers.get("x-vercel-cron") === "1") return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
