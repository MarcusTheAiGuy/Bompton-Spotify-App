import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

export class ExtensionAuthError extends Error {
  constructor(
    message: string,
    public status: number,
    public code:
      | "missing_header"
      | "malformed_header"
      | "token_not_found"
      | "token_revoked",
  ) {
    super(message);
    this.name = "ExtensionAuthError";
  }
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// 32 random bytes → 64 hex chars. Shown to the user once, never stored raw.
export function generateRawToken(): string {
  return randomBytes(32).toString("hex");
}

export type ExtensionTokenAuthResult = {
  userId: string;
  tokenId: string;
};

// Reads `Authorization: Bearer <raw>`, verifies it against a non-revoked
// ExtensionToken row, and bumps lastUsedAt. Throws ExtensionAuthError with
// the specific status + code + a message that tells the operator how to fix it.
export async function requireExtensionToken(
  request: Request,
): Promise<ExtensionTokenAuthResult> {
  const header = request.headers.get("authorization");
  if (!header) {
    throw new ExtensionAuthError(
      "Missing Authorization header. Send `Authorization: Bearer <token>` from the extension. Generate a token at /extension-setup.",
      401,
      "missing_header",
    );
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    throw new ExtensionAuthError(
      `Malformed Authorization header. Expected "Bearer <token>", got "${header.slice(0, 16)}…".`,
      401,
      "malformed_header",
    );
  }
  const raw = match[1].trim();
  const tokenHash = hashToken(raw);
  const row = await prisma.extensionToken.findUnique({
    where: { tokenHash },
  });
  if (!row) {
    throw new ExtensionAuthError(
      "Token not found in extension_tokens. Generate a new one at /extension-setup and paste it into the extension popup.",
      401,
      "token_not_found",
    );
  }
  if (row.revokedAt) {
    throw new ExtensionAuthError(
      `Token was revoked at ${row.revokedAt.toISOString()}. Generate a new one at /extension-setup.`,
      401,
      "token_revoked",
    );
  }
  await prisma.extensionToken.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });
  return { userId: row.userId, tokenId: row.id };
}

export function extensionAuthErrorResponse(error: ExtensionAuthError): Response {
  return Response.json(
    {
      error: error.name,
      code: error.code,
      message: error.message,
    },
    { status: error.status },
  );
}
