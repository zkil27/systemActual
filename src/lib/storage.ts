import { put } from "@vercel/blob";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";

export async function saveProofPhoto(file: File): Promise<string> {
  const ext = getSafeExtension(file.name, file.type);
  const uniqueName = `return-proof-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`return-proofs/${uniqueName}`, buffer, {
      access: "public",
      contentType: file.type || "image/jpeg",
    });
    return blob.url;
  }

  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const targetPath = path.join(uploadsDir, uniqueName);
  await writeFile(targetPath, buffer);
  return `/uploads/${uniqueName}`;
}

function getSafeExtension(fileName: string, mimeType: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png") || mimeType === "image/png") return ".png";
  if (lower.endsWith(".webp") || mimeType === "image/webp") return ".webp";
  return ".jpg";
}
