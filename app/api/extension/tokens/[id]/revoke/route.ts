import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message: "Sign in to revoke extension tokens.",
      },
      { status: 401 },
    );
  }

  const { id } = await params;

  const token = await prisma.extensionToken.findUnique({
    where: { id },
    select: { id: true, userId: true, revokedAt: true },
  });

  if (!token) {
    return NextResponse.json(
      {
        error: "NotFound",
        message: `No extension token with id ${id}.`,
      },
      { status: 404 },
    );
  }
  if (token.userId !== session.user.id) {
    return NextResponse.json(
      {
        error: "Forbidden",
        message: `Token ${id} belongs to a different user. You can only revoke your own tokens.`,
      },
      { status: 403 },
    );
  }
  if (token.revokedAt) {
    return NextResponse.json({
      ok: true,
      alreadyRevoked: true,
      revokedAt: token.revokedAt.toISOString(),
    });
  }

  const updated = await prisma.extensionToken.update({
    where: { id },
    data: { revokedAt: new Date() },
    select: { id: true, revokedAt: true },
  });

  return NextResponse.json({
    ok: true,
    revokedAt: updated.revokedAt!.toISOString(),
  });
}
