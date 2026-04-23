"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Lets the signed-in user import any playlist they own by pasting its URL,
// URI, or id — covers the case where the playlist isn't in their first 50
// /me/playlists (which is what Spotify's endpoint caps at and what populates
// the PlaylistGrid above).
export function AddPlaylistForm() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setPending(true);
    try {
      const response = await fetch("/api/playlists/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistInput: input }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          `${body?.error ?? "SyncError"} (HTTP ${response.status}): ${body?.message ?? "unknown"}`,
        );
        return;
      }
      setSuccess(
        `Imported "${body.playlistName}" (${body.tracksWritten} tracks${body.linkCreated ? ", linked to your dashboard" : ", already linked"})`,
      );
      setInput("");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-spotify-border bg-spotify-base/40 p-3">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="add-playlist-input">
          Playlist URL, URI, or ID
        </label>
        <input
          id="add-playlist-input"
          type="text"
          required
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste a playlist URL, URI, or ID you own"
          className="flex-1 rounded border border-spotify-border bg-spotify-base px-3 py-2 text-sm text-spotify-text placeholder:text-spotify-subtext/60 focus:border-spotify-green focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="btn-spotify disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Importing…" : "Import"}
        </button>
      </form>
      <p className="mt-2 text-xs text-spotify-subtext">
        Playlists not in your first 50 above won&apos;t appear — paste them
        here instead. Must be owned by your account (Spotify&apos;s Feb-2026 Dev-Mode
        rules restrict track reads to owners).
      </p>
      {success ? (
        <p className="mt-2 rounded border border-spotify-green/40 bg-spotify-green/10 px-3 py-2 text-sm text-spotify-green">
          {success}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 whitespace-pre-wrap rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
