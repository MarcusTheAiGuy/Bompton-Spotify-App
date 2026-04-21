"use client";

import { useState, useTransition } from "react";
import {
  initializeExtensionTables,
  type InitializeTablesResult,
} from "./actions";

export function InitializeTablesButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<InitializeTablesResult | null>(null);

  function onClick() {
    startTransition(async () => {
      const r = await initializeExtensionTables();
      setResult(r);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="btn-spotify disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Running schema setup…" : "Initialize extension tables"}
      </button>

      {result && result.ok ? (
        <p className="rounded-lg border border-spotify-green/50 bg-spotify-green/10 px-3 py-2 text-xs text-spotify-green">
          Tables created. Refresh the page to continue with token generation.
        </p>
      ) : null}

      {result && !result.ok ? (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-xs">
          <p className="font-bold text-red-300">Schema setup failed</p>
          <p className="mt-1 whitespace-pre-wrap text-red-200">{result.error}</p>
        </div>
      ) : null}
    </div>
  );
}
