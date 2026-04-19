# Bompton-Spotify-App

A small Next.js site so the Bompton crew can connect their Spotify accounts
and share what they're listening to — top tracks, top artists, recently
played, a shared weekly recap, and the Bompton Playlist.

## Stack
- Next.js 15 (App Router) + TypeScript
- Tailwind CSS with a Spotify-inspired palette
- Auth.js (NextAuth v5) with the Spotify provider *(wired up in PR #2)*
- Prisma + Neon Postgres *(wired up in PR #2)*
- Deployed on Vercel

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values
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
| `CRON_SECRET` | Shared secret for the nightly recap cron |

### Spotify app setup
Add these redirect URIs in the Spotify dashboard:
- `http://localhost:3000/api/auth/callback/spotify`
- `https://<your-vercel-domain>/api/auth/callback/spotify`

## Deployment
Push to `main` → Vercel auto-deploys. Preview deploys are created for each PR.

## Roadmap
1. ✅ Scaffold + landing + placeholder playlist page
2. Auth (Spotify OAuth + email allowlist) + `/dashboard` skeleton
3. Personal data on `/dashboard`
4. `/friends` + compatibility meter
5. Weekly recap + nightly cron snapshots
6. Polish
