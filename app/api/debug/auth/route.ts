import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { checkRequiredEnv } from "@/lib/env-check";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const env = checkRequiredEnv();

  const authProbe: { ok: boolean; sessionUserId?: string; error?: unknown } = {
    ok: false,
  };
  try {
    const session = await auth();
    authProbe.ok = true;
    authProbe.sessionUserId = session?.user?.id;
  } catch (error) {
    authProbe.error =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            cause: error.cause,
            stack: error.stack?.split("\n").slice(0, 6).join("\n"),
          }
        : String(error);
  }

  return NextResponse.json(
    {
      runtime: process.env.NEXT_RUNTIME ?? "nodejs",
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      vercelUrl: process.env.VERCEL_URL ?? null,
      requestUrl: request.url,
      requestHost: request.headers.get("host"),
      requestProto: request.headers.get("x-forwarded-proto"),
      nextauthUrlEnv: process.env.NEXTAUTH_URL ?? null,
      authUrlEnv: process.env.AUTH_URL ?? null,
      authTrustHostEnv: process.env.AUTH_TRUST_HOST ?? null,
      env: env.map((v) => ({
        name: v.name,
        set: v.set,
        length: v.length,
        hasWhitespace: v.hasWhitespace,
        shapeOk: v.shapeOk,
        shapeNote: v.shapeNote,
        preview: v.preview,
      })),
      auth: authProbe,
      expectedSpotifyCallback: `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("host")}/api/auth/callback/spotify`,
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
