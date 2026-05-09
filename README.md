# Bompton-Spotify-App

A small Next.js site so the Bompton crew can connect their Spotify accounts
and share what they're listening to — top tracks, top artists, recently
played, and the Bompton Playlist. Switch between crew members' dashboards
with the tabs at the top.

## Stack
- Next.js 15 (App Router) + TypeScript
- Tailwind CSS with a Spotify-inspired palette
- Auth.js (NextAuth v5) with the Spotify provider
- Prisma + Neon Postgres
- Deployed on Vercel

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values
npm run db:push              # create tables in your Neon DB
npm run dev
```

Visit <http://localhost:3000>.

### Environment variables
See `.env.example`. In production, set these in the Vercel dashboard.

| Var | Purpose |
|---|---|
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | From <https://developer.spotify.com/dashboard> |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `http://localhost:3000` locally; Vercel URL in prod |
| `DATABASE_URL` | Neon connection string |
| `ALLOWED_EMAILS` | Comma-separated list of Spotify account emails allowed to sign in |

### Spotify app setup
Add these redirect URIs in the Spotify dashboard:
- `http://localhost:3000/api/auth/callback/spotify`
- `https://<your-vercel-domain>/api/auth/callback/spotify`

## Bompton playlist sync
Spotify's Feb-2026 Dev-Mode rules let the playlist **owner** read full track
data (including `added_at` / `added_by`) via the regular Web API, but
non-owners get metadata only. Each Bompton season's playlist is owned by
one of the crew, so syncs only succeed when that owner's session triggers
them.

- Sync runs server-side via `POST /api/playlists/sync`
  (`lib/playlist-sync.ts`), writing into the shared `Playlist` /
  `PlaylistTrack` tables.
- `BomptonAutoSync` on `/bompton-playlist` auto-fires on page load for
  any Bompton playlist in the caller's library that hasn't been synced
  in the last hour. The "Refresh all 4 Bompton playlists" button on
  that page forces a fresh pull regardless of staleness.
- `/troubleshooting` exposes per-playlist sync state, a reset button,
  and one-shot DDL utilities for new Prisma tables.
- Historical note: an earlier version used a Chrome extension that
  scraped the open.spotify.com web player. That path is retired; the
  legacy writer survives as `applyExtensionSync` in
  `lib/extension-sync.ts`, now reused by the server-side sync.

## Deployment
Push to `main` → Vercel auto-deploys. Preview deploys are created for each PR.

## Roadmap
1. ✅ Scaffold + landing + placeholder playlist page
2. ✅ Auth (Spotify OAuth + email allowlist) + `/dashboard` skeleton
3. Per-user `/dashboard/[userId]` with tabs, Spotify API client, and full profile data
4. Top tracks + top artists (short / medium / long term)
5. Recently played + currently playing + playback state
6. Saved tracks, saved albums, followed artists
7. Playlists + audio-feature aggregates
8. Derived listening stats
