import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runLateAddNotifications } from "@/lib/late-add-notifications";

export const dynamic = "force-dynamic";

// POST /api/late-add-notifications
// Body (optional): { thresholdDays?: number, dryRun?: boolean }
//
// Detects crew members who are more than `thresholdDays` (default 3) late
// on a Bompton add for the current season, then for each offender:
//   1. Checks LateAddNotification for any send in the last 24h.
//   2. If none, sends a Resend email to the offender, CCing the rest of
//      the crew.
//   3. Records the attempt (success or failure) into LateAddNotification.
//
// The work itself lives in lib/late-add-notifications.ts so the daily-sync
// cron can call it in-process. Previously the cron re-fetched this route
// with a self-set x-vercel-cron header that's stripped at the edge, so the
// call 401'd and the cron never sent a roast email — only a dashboard
// visit (session auth) did.
export async function POST(request: NextRequest) {
  const session = await auth();
  const cron = isAuthorizedCron(request);
  if (!session?.user?.id && !cron) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message:
          "Not signed in. /api/late-add-notifications requires either a Spotify session or a Vercel cron invocation (x-vercel-cron header) or Authorization: Bearer $CRON_SECRET.",
      },
      { status: 401 },
    );
  }
  const callerId = session?.user?.id ?? "vercel-cron";

  let body: { thresholdDays?: unknown; dryRun?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const thresholdDays =
    typeof body.thresholdDays === "number" && Number.isFinite(body.thresholdDays)
      ? body.thresholdDays
      : 3;
  const dryRun = Boolean(body.dryRun);

  const { status, body: resBody } = await runLateAddNotifications({
    thresholdDays,
    dryRun,
    callerId,
  });
  return NextResponse.json(resBody, { status });
}
