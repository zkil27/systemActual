import { put } from "@vercel/blob";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";

export const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB

export type ImageFormat = {
  ext: ".jpg" | ".png" | ".webp";
  contentType: "image/jpeg" | "image/png" | "image/webp";
};

/**
 * Inspects file magic bytes to ensure uploaded proof photos are real JPEG, PNG,
 * or WebP images — never trusting client-supplied MIME types or extensions.
 */
export function detectImageFormat(buf: Buffer): ImageFormat | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: ".jpg", contentType: "image/jpeg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { ext: ".png", contentType: "image/png" };
  }
  // WebP: RIFF <4 bytes> WEBP
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { ext: ".webp", contentType: "image/webp" };
  }
  return null;
}

export class InvalidProofPhotoError extends Error {}

export function localProofsDir(): string {
  return path.join(process.cwd(), "uploads", "proofs");
}

export async function saveProofPhoto(file: File): Promise<string> {
  if (file.size <= 0) {
    throw new InvalidProofPhotoError("Photo file is empty.");
  }
  if (file.size > MAX_PROOF_BYTES) {
    throw new InvalidProofPhotoError("Photo must be 5 MB or smaller.");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_PROOF_BYTES) {
    throw new InvalidProofPhotoError("Photo must be 5 MB or smaller.");
  }
  const format = detectImageFormat(buffer);
  if (!format) {
    throw new InvalidProofPhotoError("Only JPEG, PNG, or WebP photos are allowed.");
  }

  const uniqueName = `return-proof-${Date.now()}-${crypto.randomBytes(16).toString("hex")}${format.ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`return-proofs/${uniqueName}`, buffer, {
      access: "public",
      contentType: format.contentType,
    });
    return blob.url;
  }

  const uploadsDir = localProofsDir();
  await mkdir(uploadsDir, { recursive: true });
  const targetPath = path.join(uploadsDir, uniqueName);
  await writeFile(targetPath, buffer);
  return `/api/proofs/${uniqueName}`;
}
