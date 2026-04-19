"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app.error]", error);
  }, [error]);

  return (
    <section className="flex flex-col gap-4 py-10">
      <div className="card border border-red-500/40 bg-red-500/10">
        <h1 className="text-2xl font-extrabold tracking-tight text-red-200">
          Page crashed
        </h1>
        <p className="mt-2 text-sm text-red-200">
          The server component for this page threw an uncaught error. Full
          detail below so we can debug.
        </p>
        <dl className="mt-4 flex flex-col gap-2 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-widest text-red-300/70">
              Name
            </dt>
            <dd className="font-mono text-red-100">{error.name}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-widest text-red-300/70">
              Message
            </dt>
            <dd className="whitespace-pre-wrap font-mono text-red-100">
              {error.message}
            </dd>
          </div>
          {error.digest ? (
            <div>
              <dt className="text-xs uppercase tracking-widest text-red-300/70">
                Digest (match against Vercel function logs)
              </dt>
              <dd className="font-mono text-red-100">{error.digest}</dd>
            </div>
          ) : null}
          {error.stack ? (
            <div>
              <dt className="text-xs uppercase tracking-widest text-red-300/70">
                Stack
              </dt>
              <dd className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-3 font-mono text-xs text-red-100">
                {error.stack}
              </dd>
            </div>
          ) : null}
        </dl>
        <button
          type="button"
          onClick={reset}
          className="mt-4 btn-ghost border-red-500/40 text-red-100 hover:bg-red-500/20"
        >
          Try again
        </button>
      </div>
    </section>
  );
}
