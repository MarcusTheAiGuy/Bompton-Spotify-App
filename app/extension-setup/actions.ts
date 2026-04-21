"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateRawToken, hashToken } from "@/lib/extension-auth";
import { runExtensionSchemaSetup } from "@/lib/extension-schema-setup";

export type GenerateTokenResult =
  | { ok: true; raw: string; tokenId: string }
  | { ok: false; error: string };

export async function generateExtensionToken(
  formData: FormData,
): Promise<GenerateTokenResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error:
        "Unauthorized: sign in with your Spotify account first, then reload /extension-setup.",
    };
  }
  const labelInput = formData.get("label");
  const label =
    typeof labelInput === "string" && labelInput.trim().length > 0
      ? labelInput.trim().slice(0, 120)
      : null;

  const raw = generateRawToken();
  try {
    const token = await prisma.extensionToken.create({
      data: { userId: session.user.id, tokenHash: hashToken(raw), label },
      select: { id: true },
    });
    revalidatePath("/extension-setup");
    return { ok: true, raw, tokenId: token.id };
  } catch (error) {
    return {
      ok: false,
      error: `Database write failed while creating ExtensionToken: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Check DATABASE_URL and that \`npm run db:push\` has been run against the current schema.`,
    };
  }
}

export type RevokeTokenResult =
  | { ok: true; alreadyRevoked: boolean }
  | { ok: false; error: string };

export async function revokeExtensionToken(
  tokenId: string,
): Promise<RevokeTokenResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "Unauthorized: sign in first." };
  }
  const token = await prisma.extensionToken.findUnique({
    where: { id: tokenId },
    select: { id: true, userId: true, revokedAt: true },
  });
  if (!token) {
    return { ok: false, error: `No extension token with id ${tokenId}.` };
  }
  if (token.userId !== session.user.id) {
    return {
      ok: false,
      error: `Token ${tokenId} belongs to a different user. You can only revoke your own tokens.`,
    };
  }
  if (token.revokedAt) {
    return { ok: true, alreadyRevoked: true };
  }
  await prisma.extensionToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/extension-setup");
  return { ok: true, alreadyRevoked: false };
}

export type InitializeTablesResult =
  | { ok: true }
  | { ok: false; error: string };

// One-shot helper for initializing the extension tables in the connected
// Neon database. Equivalent to `npm run db:push` for the three models
// this feature added. Safe to re-run: every statement uses IF NOT EXISTS.
export async function initializeExtensionTables(): Promise<InitializeTablesResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error:
        "Unauthorized: sign in with a crew Spotify account first, then reload /extension-setup.",
    };
  }
  try {
    await runExtensionSchemaSetup();
    console.log("[extension-setup.init-tables]", {
      userId: session.user.id,
      email: session.user.email,
    });
    revalidatePath("/extension-setup");
    return { ok: true };
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[extension-setup.init-tables.failed]", {
      userId: session.user.id,
      name,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      ok: false,
      error: `Schema setup failed: ${name}: ${message}. Check DATABASE_URL (Vercel env var), confirm the Neon branch is reachable, and that the connection role has CREATE privileges on the \`public\` schema. Full stack in Vercel logs under [extension-setup.init-tables.failed].`,
    };
  }
}

