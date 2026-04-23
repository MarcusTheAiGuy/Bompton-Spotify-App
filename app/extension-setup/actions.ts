"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateRawToken, hashToken } from "@/lib/extension-auth";

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

export type ResetSyncStateResult =
  | { ok: true; playlistsCleared: number; tracksDeleted: number }
  | { ok: false; error: string };

// Clears Playlist.snapshotId (and any already-stored PlaylistTrack rows) so
// the next extension sync treats every Bompton playlist as changed and
// re-fetches its full track list. Needed after the v0.1.2 bug that wrote
// current snapshotIds with 0 tracks — without this, v0.1.3 sees snapshot
// unchanged and skips every playlist.
export async function resetPlaylistSyncState(): Promise<ResetSyncStateResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      error: "Unauthorized: sign in with your Spotify account first.",
    };
  }
  try {
    const [deleted, updated] = await prisma.$transaction([
      prisma.playlistTrack.deleteMany({}),
      prisma.playlist.updateMany({ data: { snapshotId: null } }),
    ]);
    revalidatePath("/extension-setup");
    return {
      ok: true,
      playlistsCleared: updated.count,
      tracksDeleted: deleted.count,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Database write failed while resetting sync state: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}. Check DATABASE_URL.`,
    };
  }
}

