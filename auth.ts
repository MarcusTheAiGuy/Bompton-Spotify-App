import NextAuth from "next-auth";
import Spotify from "next-auth/providers/spotify";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { isAllowed } from "@/lib/allowlist";

const SPOTIFY_SCOPES = [
  // Profile
  "user-read-email",
  "user-read-private",
  // Top items
  "user-top-read",
  // Player state
  "user-read-recently-played",
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-playback-position",
  // Saved library (/me/tracks, /me/albums, /me/shows, /me/episodes, /me/audiobooks)
  "user-library-read",
  // Followed artists (/me/following)
  "user-follow-read",
  // Playlists (/me/playlists, including collaborative ones)
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  trustHost: true,
  providers: [
    Spotify({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      authorization: {
        url: "https://accounts.spotify.com/authorize",
        params: {
          scope: SPOTIFY_SCOPES,
          // Spotify otherwise skips the consent screen for already-authorized
          // users, which silently re-issues a token with only the scopes they
          // originally consented to — so newly-added scopes never come through.
          // show_dialog=true forces the consent screen on every sign-in, which
          // is fine for a small crew-only app.
          show_dialog: "true",
        },
      },
    }),
  ],
  pages: {
    signIn: "/",
    error: "/",
  },
  logger: {
    error(error) {
      console.error("[auth.error]", {
        name: error.name,
        message: error.message,
        cause:
          error.cause instanceof Error
            ? { name: error.cause.name, message: error.cause.message }
            : error.cause,
      });
    },
  },
  callbacks: {
    async signIn({ user }) {
      return isAllowed(user.email);
    },
    async session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
});
