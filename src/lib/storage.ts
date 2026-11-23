import { put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "fs/promises";
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

/** Size and real-image checks shared by proof and chat photos. */
async function readValidatedPhoto(file: File): Promise<{ buffer: Buffer; format: ImageFormat }> {
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
  return { buffer, format };
}

export function localChatPhotosDir(): string {
  return path.join(process.cwd(), "uploads", "chat-photos");
}

export const SAFE_CHAT_PHOTO_FILE = /^chat-photo-\d+-[a-f0-9]+\.(jpg|png|webp)$/;

/** Saves a photo the owner sends in a chat. Same checks as proof photos. */
export async function saveChatPhoto(file: File): Promise<string> {
  const { buffer, format } = await readValidatedPhoto(file);
  const uniqueName = `chat-photo-${Date.now()}-${crypto.randomBytes(16).toString("hex")}${format.ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`chat-photos/${uniqueName}`, buffer, {
      access: "public",
      contentType: format.contentType,
    });
    return blob.url;
  }

  const dir = localChatPhotosDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, uniqueName), buffer);
  return `/api/chats/photos/${uniqueName}`;
}

/** Only our own Blob store; never fetch an arbitrary URL from the server. */
export function isOwnBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com") && u.pathname.includes("/chat-photos/");
  } catch {
    return false;
  }
}

/** Reads back a chat photo saved by saveChatPhoto (to pass it on to the shop). */
export async function readChatPhoto(url: string): Promise<{ buffer: Buffer; format: ImageFormat; fileName: string }> {
  let buffer: Buffer;
  let fileName: string;
  const local = url.match(/^\/api\/chats\/photos\/([^/?#]+)$/);
  if (local) {
    fileName = local[1];
    if (!SAFE_CHAT_PHOTO_FILE.test(fileName)) throw new InvalidProofPhotoError("Photo not found.");
    buffer = await readFile(path.join(localChatPhotosDir(), fileName));
  } else if (isOwnBlobUrl(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new InvalidProofPhotoError("Photo not found.");
    buffer = Buffer.from(await res.arrayBuffer());
    fileName = decodeURIComponent(new URL(url).pathname.split("/").pop() || "photo");
  } else {
    throw new InvalidProofPhotoError("Photo not found.");
  }
  if (buffer.length > MAX_PROOF_BYTES) throw new InvalidProofPhotoError("Photo must be 5 MB or smaller.");
  const format = detectImageFormat(buffer);
  if (!format) throw new InvalidProofPhotoError("Only JPEG, PNG, or WebP photos are allowed.");
  return { buffer, format, fileName };
}

export async function saveProofPhoto(file: File): Promise<string> {
  const { buffer, format } = await readValidatedPhoto(file);

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
