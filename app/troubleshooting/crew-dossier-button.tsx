"use client";

import { useState } from "react";

// TEMPORARY — see the header comment in lib/crew-dossier.ts for what this is
// and how to remove it.
//
// Two-step on purpose: "Generate" fetches and holds the markdown in state,
// then Copy/Download act on the text already in memory. iOS Safari drops the
// clipboard permission if writeText() is awaited across a fetch, so the copy
// has to happen synchronously inside its own click.
export function CrewDossierButton() {
  const [pending, setPending] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setPending(true);
    setError(null);
    setMarkdown(null);
    setCopied(false);
    try {
      const res = await fetch("/api/crew-dossier", { cache: "no-store" });
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        // The route reports failures as JSON with a message that says what to fix.
        if (contentType.includes("application/json")) {
          const body = (await res.json()) as { error?: string; message?: string };
          setError(
            `${body.error ?? `HTTP ${res.status}`}: ${body.message ?? "(no message)"}`,
          );
        } else {
          setError(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
        }
        return;
      }
      setMarkdown(await res.text());
    } catch (e) {
      setError(
        `Request to /api/crew-dossier failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}. Check the deploy is live and you're still signed in.`,
      );
    } finally {
      setPending(false);
    }
  }

  function copy() {
    if (!markdown) return;
    navigator.clipboard.writeText(markdown).then(
      () => setCopied(true),
      (e: unknown) =>
        setError(
          `Clipboard write failed: ${e instanceof Error ? e.message : String(e)}. Select the text in the box below and copy it manually.`,
        ),
    );
  }

  function download() {
    if (!markdown) return;
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "bompton-dossier.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  const lineCount = markdown ? markdown.split("\n").length : 0;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={generate}
        disabled={pending}
        className="btn-spotify self-start disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Building…" : "Generate crew dossier"}
      </button>

      {error ? (
        <p className="whitespace-pre-wrap text-xs text-red-300">{error}</p>
      ) : null}

      {markdown ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-spotify-green">
            Built {lineCount.toLocaleString()} lines (
            {Math.round(markdown.length / 1024).toLocaleString()} KB).
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copy}
              className="btn-spotify disabled:cursor-not-allowed disabled:opacity-60"
            >
              {copied ? "Copied ✓" : "Copy to clipboard"}
            </button>
            <button
              type="button"
              onClick={download}
              className="btn-spotify disabled:cursor-not-allowed disabled:opacity-60"
            >
              Download .md
            </button>
          </div>
          <textarea
            readOnly
            value={markdown}
            onFocus={(e) => e.currentTarget.select()}
            className="h-64 w-full rounded-lg border border-spotify-border bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-spotify-subtext"
          />
        </div>
      ) : null}
    </div>
  );
}
