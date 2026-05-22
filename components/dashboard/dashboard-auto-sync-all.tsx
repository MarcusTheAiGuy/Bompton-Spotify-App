"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SyncOutcome = {
  userId: string;
  userLabel: string;
  playlistId: string;
  playlistName: string | null;
  status: "synced" | "skipped" | "error";
  tracksWritten?: number;
  snapshotChanged?: boolean;
  error?: { name: string; code?: string; message: string };
};

type SyncResponse = {
  ok: boolean;
  totalLinks: number;
  attempted: number;
  synced: number;
  errors: number;
  skippedFresh: number;
  outcomes: SyncOutcome[];
};

type LateAddOutcome = {
  userId: string;
  userLabel: string;
  weeksBehind: number;
  status:
    | "emailed"
    | "skipped-cooldown"
    | "skipped-no-email"
    | "skipped-dry-run"
    | "config-error"
    | "send-error";
  cooldownUntil?: string;
  error?: { name: string; message: string };
  resendId?: string | null;
  subject?: string;
  ccEmails?: string[];
};

type LateAddResponse = {
  ok: boolean;
  year: string;
  thresholdDays: number;
  offenderCount: number;
  emailed: number;
  skippedCooldown: number;
  errors: number;
  outcomes: LateAddOutcome[];
};

type State =
  | { status: "idle" }
  | { status: "syncing"; force: boolean }
  | { status: "emailing"; force: boolean; syncResult: SyncResponse }
  | {
      status: "done";
      force: boolean;
      syncResult: SyncResponse;
      lateAdd: LateAddResponse | { error: { title: string; detail: string } };
    }
  | { status: "failed"; title: string; detail: string; force: boolean };

// Mounts on the dashboard and fires:
//   1. POST /api/sync-all-playlists  — resyncs every UserPlaylistLink
//      using each link owner's stored OAuth token.
//   2. POST /api/late-add-notifications — detects crew >3 days late on
//      a Bompton add and sends a roast email (CCing the rest of the
//      crew) via Resend, with a 24h cooldown per offender.
//
// The two steps chain because the late-add detection needs fresh data
// from the sync. If the sync fails, the email check is skipped so we
// don't email people based on stale state.
//
// Auto-run on mount: 1h staleness filter on sync, no dry-run on emails.
// "Force resync everyone" button bypasses the staleness filter.
export function DashboardAutoSyncAll() {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });
  const hasAutoRun = useRef(false);

  async function run(force: boolean) {
    setState({ status: "syncing", force });
    let syncResult: SyncResponse;
    try {
      const response = await fetch("/api/sync-all-playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<
        SyncResponse & { error?: string; message?: string }
      >;
      if (!response.ok) {
        setState({
          status: "failed",
          title:
            (body as { error?: string }).error ?? `HTTP ${response.status}`,
          detail:
            (body as { message?: string }).message ??
            `POST /api/sync-all-playlists returned ${response.status}.`,
          force,
        });
        return;
      }
      syncResult = body as SyncResponse;
    } catch (error) {
      setState({
        status: "failed",
        title: error instanceof Error ? error.name : "NetworkError",
        detail:
          error instanceof Error
            ? `${error.message}. Check the network tab and server logs for /api/sync-all-playlists.`
            : String(error),
        force,
      });
      return;
    }

    setState({ status: "emailing", force, syncResult });
    let lateAdd: LateAddResponse | { error: { title: string; detail: string } };
    try {
      const response = await fetch("/api/late-add-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<
        LateAddResponse & { error?: string; message?: string }
      >;
      if (!response.ok) {
        lateAdd = {
          error: {
            title:
              (body as { error?: string }).error ?? `HTTP ${response.status}`,
            detail:
              (body as { message?: string }).message ??
              `POST /api/late-add-notifications returned ${response.status}.`,
          },
        };
      } else {
        lateAdd = body as LateAddResponse;
      }
    } catch (error) {
      lateAdd = {
        error: {
          title: error instanceof Error ? error.name : "NetworkError",
          detail:
            error instanceof Error
              ? `${error.message}. Check the network tab and server logs for /api/late-add-notifications.`
              : String(error),
        },
      };
    }

    setState({ status: "done", force, syncResult, lateAdd });
    router.refresh();
  }

  useEffect(() => {
    if (hasAutoRun.current) return;
    hasAutoRun.current = true;
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = state.status === "syncing" || state.status === "emailing";

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-spotify-border bg-spotify-elevated/40 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-widest text-spotify-subtext">
          Crew-wide sync + late-add nudge
        </span>
        <button
          type="button"
          onClick={() => {
            if (running) return;
            void run(true);
          }}
          disabled={running}
          className="btn-ghost disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running
            ? state.status === "emailing"
              ? "Checking lateness…"
              : state.force
                ? "Force-resyncing everyone…"
                : "Syncing everyone…"
            : "Force resync + recheck"}
        </button>
        <p className="text-xs text-spotify-subtext">
          On dashboard open: resyncs every UserPlaylistLink whose last sync is
          older than 1 hour (each via its owner&apos;s token), then emails any
          crew member &gt;3 days late on a Bompton add. 24h cooldown per
          offender, CCs the rest of the crew. Force button bypasses both
          freshness checks.
        </p>
      </div>

      {state.status === "syncing" ? (
        <p className="text-xs text-spotify-subtext">
          Iterating links sequentially — this may take a few seconds per stale
          playlist. Late-add check fires when sync finishes.
        </p>
      ) : null}
      {state.status === "emailing" ? (
        <p className="text-xs text-spotify-subtext">
          Sync done. Checking for crew members &gt;3 days late and dispatching
          Resend emails…
        </p>
      ) : null}

      {state.status === "done" ? (
        <>
          <SyncSummary result={state.syncResult} />
          {"error" in state.lateAdd ? (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <p className="font-semibold">
                Late-add check failed: {state.lateAdd.error.title}
              </p>
              <p className="mt-1 whitespace-pre-wrap">
                {state.lateAdd.error.detail}
              </p>
            </div>
          ) : (
            <LateAddSummary result={state.lateAdd} />
          )}
        </>
      ) : null}

      {state.status === "failed" ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <p className="font-semibold">
            Crew sync request failed: {state.title}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{state.detail}</p>
        </div>
      ) : null}
    </section>
  );
}

function SyncSummary({ result }: { result: SyncResponse }) {
  const failed = result.outcomes.filter((o) => o.status === "error");
  const synced = result.outcomes.filter((o) => o.status === "synced");

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-spotify-subtext">
        Sync: attempted <strong>{result.attempted}</strong> of{" "}
        <strong>{result.totalLinks}</strong> links · synced{" "}
        <strong className="text-spotify-green">{result.synced}</strong> ·
        skipped (fresh) <strong>{result.skippedFresh}</strong> · errors{" "}
        <strong className={result.errors > 0 ? "text-red-400" : ""}>
          {result.errors}
        </strong>
      </p>

      {synced.length > 0 ? (
        <details className="text-xs text-spotify-subtext">
          <summary className="cursor-pointer">
            Show {synced.length} synced link
            {synced.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-4">
            {synced.map((o) => (
              <li key={`${o.userId}-${o.playlistId}`}>
                <span className="text-spotify-text">{o.userLabel}</span> ·{" "}
                {o.playlistName ?? o.playlistId} ·{" "}
                {o.snapshotChanged
                  ? `${o.tracksWritten ?? 0} tracks rewritten`
                  : "snapshot unchanged"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {failed.length > 0 ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <p className="font-semibold">
            {failed.length} link{failed.length === 1 ? "" : "s"} failed to sync:
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {failed.map((o) => (
              <li
                key={`${o.userId}-${o.playlistId}`}
                className="whitespace-pre-wrap"
              >
                <strong>{o.userLabel}</strong> ·{" "}
                {o.playlistName ?? o.playlistId}: {o.error?.name}
                {o.error?.code ? ` (${o.error.code})` : ""} —{" "}
                {o.error?.message ?? "unknown error"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function LateAddSummary({ result }: { result: LateAddResponse }) {
  const emailed = result.outcomes.filter((o) => o.status === "emailed");
  const cooldown = result.outcomes.filter(
    (o) => o.status === "skipped-cooldown",
  );
  const errored = result.outcomes.filter(
    (o) => o.status === "send-error" || o.status === "config-error",
  );
  const noEmail = result.outcomes.filter(
    (o) => o.status === "skipped-no-email",
  );

  if (result.offenderCount === 0) {
    return (
      <p className="text-xs text-spotify-subtext">
        Late-add check: nobody is more than {result.thresholdDays} days late on
        a Bompton {result.year} add. Crew is caught up.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-spotify-subtext">
        Late-add check: <strong>{result.offenderCount}</strong> offender
        {result.offenderCount === 1 ? "" : "s"} &gt;{result.thresholdDays} days
        late · emailed{" "}
        <strong className="text-spotify-green">{result.emailed}</strong> ·
        skipped (24h cooldown) <strong>{result.skippedCooldown}</strong> ·
        errors{" "}
        <strong className={result.errors > 0 ? "text-red-400" : ""}>
          {result.errors}
        </strong>
      </p>

      {emailed.length > 0 ? (
        <details className="text-xs text-spotify-subtext">
          <summary className="cursor-pointer">
            Sent {emailed.length} roast email{emailed.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-4">
            {emailed.map((o) => (
              <li key={o.userId}>
                <strong className="text-spotify-text">{o.userLabel}</strong>:{" "}
                {o.weeksBehind} Fridays behind · subject{" "}
                <em>{o.subject ?? ""}</em>
                {o.ccEmails && o.ccEmails.length > 0
                  ? ` · CC: ${o.ccEmails.join(", ")}`
                  : ""}
                {o.resendId ? ` · resend id ${o.resendId}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {cooldown.length > 0 ? (
        <details className="text-xs text-spotify-subtext">
          <summary className="cursor-pointer">
            {cooldown.length} skipped (already emailed in the last 24h)
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-4">
            {cooldown.map((o) => (
              <li key={o.userId}>
                <strong className="text-spotify-text">{o.userLabel}</strong>:{" "}
                {o.weeksBehind} Fridays behind · next eligible{" "}
                {o.cooldownUntil
                  ? new Date(o.cooldownUntil).toLocaleString()
                  : "unknown"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {noEmail.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <p className="font-semibold">
            {noEmail.length} offender{noEmail.length === 1 ? "" : "s"} skipped
            — no email on file:
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {noEmail.map((o) => (
              <li key={o.userId} className="whitespace-pre-wrap">
                <strong>{o.userLabel}</strong>:{" "}
                {o.error?.message ?? "unknown reason"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {errored.length > 0 ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <p className="font-semibold">
            {errored.length} email send{errored.length === 1 ? "" : "s"}{" "}
            failed:
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {errored.map((o) => (
              <li key={o.userId} className="whitespace-pre-wrap">
                <strong>{o.userLabel}</strong> ({o.status}): {o.error?.name} —{" "}
                {o.error?.message ?? "unknown error"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
