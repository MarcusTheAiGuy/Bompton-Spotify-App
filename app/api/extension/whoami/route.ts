import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ExtensionAuthError,
  extensionAuthErrorResponse,
  requireExtensionToken,
} from "@/lib/extension-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let userId: string;
  let tokenId: string;
  try {
    const auth = await requireExtensionToken(request);
    userId = auth.userId;
    tokenId = auth.tokenId;
  } catch (error) {
    if (error instanceof ExtensionAuthError) {
      return extensionAuthErrorResponse(error);
    }
    throw error;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, id: true },
  });

  if (!user) {
    return NextResponse.json(
      {
        error: "UserNotFound",
        message: `Token is valid but its owning user ${userId} no longer exists. Ask an admin to reset the token.`,
      },
      { status: 410 },
    );
  }

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    name: user.name,
    tokenId,
  });
}
