import NextAuth from "next-auth";
import Spotify from "next-auth/providers/spotify";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { isAllowed } from "@/lib/allowlist";

const SPOTIFY_SCOPES = [
  "user-read-email",
  "user-read-private",
  "user-top-read",
  "user-read-recently-played",
  "user-read-currently-playing",
  "user-read-playback-state",
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
  debug: true,
  providers: [
    Spotify({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      authorization: { params: { scope: SPOTIFY_SCOPES } },
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
        cause: error.cause,
        stack: error.stack,
      });
    },
    warn(code) {
      console.warn("[auth.warn]", code);
    },
    debug(message, metadata) {
      console.log("[auth.debug]", message, metadata);
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
