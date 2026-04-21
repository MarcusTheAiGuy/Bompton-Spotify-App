import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateRawToken, hashToken } from "@/lib/extension-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message:
          "You need to sign in to generate an extension token. Visit /extension-setup while signed in.",
      },
      { status: 401 },
    );
  }

  let body: { label?: string } = {};
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = (await request.json()) as { label?: string };
    } catch (error) {
      return NextResponse.json(
        {
          error: "BadRequest",
          message: `Request body is not valid JSON. ${error instanceof Error ? error.message : String(error)}`,
        },
        { status: 400 },
      );
    }
  }
  const label =
    typeof body.label === "string" && body.label.trim().length > 0
      ? body.label.trim().slice(0, 120)
      : null;

  const raw = generateRawToken();
  const tokenHash = hashToken(raw);

  const token = await prisma.extensionToken.create({
    data: {
      userId: session.user.id,
      tokenHash,
      label,
    },
    select: { id: true, label: true, createdAt: true },
  });

  return NextResponse.json({
    token: {
      id: token.id,
      label: token.label,
      createdAt: token.createdAt.toISOString(),
    },
    raw,
    warning:
      "This is the only time the raw token will be shown. Copy it into the extension popup now.",
  });
}
