import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getScannerSession } from "@/lib/auth";
import { localProofsDir } from "@/lib/storage";

const SAFE_PROOF_FILE = /^return-proof-\d+-[a-f0-9]+\.(jpg|png|webp)$/;

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ file: string }> }
) {
  const session = await getScannerSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { file } = await context.params;
  if (!SAFE_PROOF_FILE.test(file)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = path.extname(file);
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  const primaryPath = path.join(localProofsDir(), file);
  const legacyPath = path.join(process.cwd(), "public", "uploads", file);

  let buf: Buffer | null = null;
  for (const candidate of [primaryPath, legacyPath]) {
    try {
      buf = await readFile(candidate);
      break;
    } catch {
      // Try next path
    }
  }
  if (!buf) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
