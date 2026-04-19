import { NextRequest, NextResponse } from "next/server";
import { auth, handlers } from "@/auth";
import { checkRequiredEnv } from "@/lib/env-check";
import { clearAuthLog, getAuthLog } from "@/lib/auth-log";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const probeMode = url.searchParams.get("probe") === "signin";
  const env = checkRequiredEnv();

  const bufferBeforeProbes = getAuthLog();

  const authProbe: { ok: boolean; sessionUserId?: string; error?: unknown } = {
    ok: false,
  };
  try {
    const session = await auth();
    authProbe.ok = true;
    authProbe.sessionUserId = session?.user?.id;
  } catch (error) {
    authProbe.error = serializeError(error);
  }

  const providersProbe = await probeGetHandler(request, "providers");

  let signinProbe: unknown = null;
  let signinProbeAuthLog: unknown = null;
  if (probeMode) {
    clearAuthLog();
    signinProbe = await probePostSignin(request);
    signinProbeAuthLog = getAuthLog();
  }

  let prismaProbe: { ok: boolean; userCount?: number; error?: unknown } = {
    ok: false,
  };
  try {
    const { prisma } = await import("@/lib/prisma");
    prismaProbe = { ok: true, userCount: await prisma.user.count() };
  } catch (error) {
    prismaProbe = { ok: false, error: serializeError(error) };
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
      providersHandler: providersProbe,
      signinProbe,
      signinProbeAuthLog,
      authLogBuffer: probeMode ? null : bufferBeforeProbes,
      prisma: prismaProbe,
      expectedSpotifyCallback: `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("host")}/api/auth/callback/spotify`,
      hint: probeMode
        ? "signinProbe ran a real CSRF-backed POST to /api/auth/signin/spotify. signinProbeAuthLog has any Auth.js error logged during it."
        : "Add ?probe=signin to actively test sign-in. authLogBuffer shows errors logged since the last probe — useful right after a failed Connect Spotify click.",
    },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}

async function probeGetHandler(request: Request, path: string) {
  const url = new URL(`/api/auth/${path}`, request.url);
  const probeRequest = new NextRequest(url, {
    method: "GET",
    headers: forwardHeaders(request),
  });
  try {
    const response = await handlers.GET(probeRequest);
    return {
      ok: response.ok || response.status === 302,
      status: response.status,
      location: response.headers.get("location"),
      body: await readBody(response),
    };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
}

async function probePostSignin(request: Request) {
  try {
    // Step 1: GET /api/auth/csrf to obtain a token + cookie
    const csrfUrl = new URL("/api/auth/csrf", request.url);
    const csrfReq = new NextRequest(csrfUrl, {
      method: "GET",
      headers: forwardHeaders(request),
    });
    const csrfResp = await handlers.GET(csrfReq);
    const csrfBody = (await csrfResp.json()) as { csrfToken: string };
    const setCookie = csrfResp.headers.get("set-cookie") ?? "";
    const cookieHeader = setCookie
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    // Step 2: POST /api/auth/signin/spotify with csrfToken in form body
    const signinUrl = new URL("/api/auth/signin/spotify", request.url);
    const formData = new URLSearchParams({
      csrfToken: csrfBody.csrfToken,
      callbackUrl: `${request.headers.get("x-forwarded-proto") ?? "https"}://${request.headers.get("host")}/dashboard`,
    });
    const signinReq = new NextRequest(signinUrl, {
      method: "POST",
      headers: {
        ...forwardHeaders(request),
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookieHeader,
      },
      body: formData.toString(),
    });
    const signinResp = await handlers.POST(signinReq);
    return {
      csrf: { ok: true, tokenLength: csrfBody.csrfToken.length },
      signin: {
        status: signinResp.status,
        location: signinResp.headers.get("location"),
        body: await readBody(signinResp),
      },
    };
  } catch (error) {
    return { error: serializeError(error) };
  }
}

function forwardHeaders(request: Request): Record<string, string> {
  return {
    host: request.headers.get("host") ?? "",
    "x-forwarded-proto": request.headers.get("x-forwarded-proto") ?? "https",
    "x-forwarded-host": request.headers.get("host") ?? "",
    accept: "application/json",
  };
}

async function readBody(response: Response): Promise<unknown> {
  try {
    const text = await response.clone().text();
    if (!text) return "";
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return "<unreadable>";
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      cause:
        error.cause instanceof Error
          ? {
              name: error.cause.name,
              message: error.cause.message,
            }
          : error.cause,
      stack: error.stack?.split("\n").slice(0, 8).join("\n"),
    };
  }
  return String(error);
}
