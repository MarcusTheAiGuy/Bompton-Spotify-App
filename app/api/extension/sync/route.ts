import { NextRequest, NextResponse } from "next/server";
import {
  ExtensionAuthError,
  extensionAuthErrorResponse,
  requireExtensionToken,
} from "@/lib/extension-auth";
import {
  applyExtensionSync,
  ExtensionSyncValidationError,
  validateExtensionSyncPayload,
} from "@/lib/extension-sync";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let userId: string;
  try {
    const auth = await requireExtensionToken(request);
    userId = auth.userId;
  } catch (error) {
    if (error instanceof ExtensionAuthError) {
      return extensionAuthErrorResponse(error);
    }
    throw error;
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: "BadRequest",
        message: `Request body is not valid JSON. ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 400 },
    );
  }

  let payload;
  try {
    payload = validateExtensionSyncPayload(bodyJson);
  } catch (error) {
    if (error instanceof ExtensionSyncValidationError) {
      return NextResponse.json(
        { error: error.name, message: error.message },
        { status: 400 },
      );
    }
    throw error;
  }

  try {
    const result = await applyExtensionSync(payload, userId);
    console.log("[extension.sync]", {
      userId,
      playlistId: payload.playlist.id,
      tracksWritten: result.tracksWritten,
      snapshotChanged: result.snapshotChanged,
    });
    return NextResponse.json(result);
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[extension.sync.failed]", {
      userId,
      playlistId: payload.playlist.id,
      name,
      message,
      stack,
    });
    return NextResponse.json(
      {
        error: name,
        message: `Sync failed while writing playlist ${payload.playlist.id}: ${message}. Check /api/extension/sync server logs for context.`,
      },
      { status: 500 },
    );
  }
}
