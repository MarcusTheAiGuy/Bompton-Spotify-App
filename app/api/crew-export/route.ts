import { gzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildCrewExport } from "@/lib/crew-export";
import { crewExportLinkProblem } from "@/lib/crew-export-link";

export const dynamic = "force-dynamic";
// Reads every play and a few hundred snapshot rows in one go.
export const maxDuration = 60;

// GET /api/crew-export
// The crew's Bompton adds, archived listening and reminder-email history as
// one JSON document — see lib/crew-export.ts. Read-only.
//
// Auth: a Spotify session, or a signed link created on /troubleshooting
// (?exp=…&sig=…, see lib/crew-export-link.ts) for a reader who has none.
// Add &download=1 to get it as a file.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const exp = params.get("exp");
  const sig = params.get("sig");

  let callerId: string;
  if (exp !== null || sig !== null) {
    let problem: string | null;
    try {
      problem = crewExportLinkProblem(exp, sig);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[crew-export.link-check.failed]", { message });
      return NextResponse.json(
        { error: "ExportLinkUncheckable", message },
        { status: 500 },
      );
    }
    if (problem) {
      return NextResponse.json(
        {
          error: "BadExportLink",
          message: `${problem} Create a fresh one with the "Create export link" button on /troubleshooting.`,
        },
        { status: 401 },
      );
    }
    callerId = "export-link";
  } else {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          message:
            'Not signed in, and the URL has no signed-link parameters. Sign in at / and retry, or use a link from the "Create export link" button on /troubleshooting.',
        },
        { status: 401 },
      );
    }
    callerId = session.user.id;
  }

  try {
    const crewExport = await buildCrewExport();
    console.log("[crew-export]", {
      callerId,
      seasons: crewExport.seasons.length,
      problems: crewExport.problems,
    });
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    if (params.get("download") === "1") {
      headers.set(
        "Content-Disposition",
        'attachment; filename="bompton-crew-export.json"',
      );
    }
    // A few months of plays is already megabytes of JSON, and Vercel refuses
    // a function response over 4.5 MB. It compresses about tenfold, so gzip
    // it here rather than leave it to the edge, which only sees the response
    // after that limit has been applied.
    const json = JSON.stringify(crewExport);
    if (request.headers.get("accept-encoding")?.includes("gzip")) {
      headers.set("Content-Encoding", "gzip");
      headers.set("Vary", "Accept-Encoding");
      return new NextResponse(gzipSync(json), { headers });
    }
    return new NextResponse(json, { headers });
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : String(error);
    console.error("[crew-export.failed]", { callerId, name, message });
    return NextResponse.json(
      {
        error: name,
        message: `Failed to build the crew export: ${message}. The crew list (User + Account tables) couldn't be read, which usually means DATABASE_URL is unreachable from this function.`,
      },
      { status: 500 },
    );
  }
}
