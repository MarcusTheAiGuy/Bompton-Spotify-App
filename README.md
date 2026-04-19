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
