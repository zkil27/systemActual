import { describe, expect, it } from "vitest";
import {
  detectImageFormat,
  InvalidProofPhotoError,
  MAX_PROOF_BYTES,
  isOwnBlobUrl,
  readChatPhoto,
  SAFE_CHAT_PHOTO_FILE,
  saveChatPhoto,
  saveProofPhoto,
} from "@/lib/storage";

describe("detectImageFormat", () => {
  it("accepts JPEG, PNG, and WebP magic bytes", () => {
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16),
    ]);
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x10, 0x00, 0x00, 0x00]),
      Buffer.from("WEBP", "ascii"),
      Buffer.alloc(8),
    ]);

    expect(detectImageFormat(jpg)).toEqual({ ext: ".jpg", contentType: "image/jpeg" });
    expect(detectImageFormat(png)).toEqual({ ext: ".png", contentType: "image/png" });
    expect(detectImageFormat(webp)).toEqual({ ext: ".webp", contentType: "image/webp" });
  });

  it("rejects SVG, HTML, text, and truncated buffers", () => {
    expect(detectImageFormat(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(detectImageFormat(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectImageFormat(Buffer.from("tiny"))).toBeNull();
  });
});

describe("saveChatPhoto", () => {
  it("uses the same checks as proof photos", async () => {
    const fake = new File(["<svg onload=alert(1)></svg>"], "evil.jpg", { type: "image/jpeg" });
    await expect(saveChatPhoto(fake)).rejects.toThrow(InvalidProofPhotoError);
    const big = new File([new Uint8Array(MAX_PROOF_BYTES + 1)], "huge.jpg", { type: "image/jpeg" });
    await expect(saveChatPhoto(big)).rejects.toThrow(InvalidProofPhotoError);
  });

  it("only reads back our own chat photos when passing them to a shop", async () => {
    expect(isOwnBlobUrl("https://abc.public.blob.vercel-storage.com/chat-photos/chat-photo-1-ab.jpg")).toBe(true);
    expect(isOwnBlobUrl("https://abc.public.blob.vercel-storage.com/return-proofs/a.jpg")).toBe(false);
    expect(isOwnBlobUrl("https://evil.example/chat-photos/a.jpg")).toBe(false);
    expect(isOwnBlobUrl("http://abc.public.blob.vercel-storage.com/chat-photos/a.jpg")).toBe(false);
    await expect(readChatPhoto("https://evil.example/x.jpg")).rejects.toThrow(InvalidProofPhotoError);
    await expect(readChatPhoto("/api/chats/photos/..%2F.env")).rejects.toThrow(InvalidProofPhotoError);
    await expect(readChatPhoto("http://169.254.169.254/latest")).rejects.toThrow(InvalidProofPhotoError);
  });

  it("only serves safe local file names", () => {
    expect(SAFE_CHAT_PHOTO_FILE.test("chat-photo-1732400000000-ab12cd.jpg")).toBe(true);
    expect(SAFE_CHAT_PHOTO_FILE.test("../.env")).toBe(false);
    expect(SAFE_CHAT_PHOTO_FILE.test("return-proof-1-ab.jpg")).toBe(false);
  });
});

describe("saveProofPhoto", () => {
  it("rejects non-image payloads even if filename/MIME claim jpeg", async () => {
    const fakeJpg = new File(["<svg onload=alert(1)></svg>"], "evil.jpg", {
      type: "image/jpeg",
    });
    await expect(saveProofPhoto(fakeJpg)).rejects.toThrow(InvalidProofPhotoError);
  });

  it("rejects files larger than 5 MB", async () => {
    const big = new File([new Uint8Array(MAX_PROOF_BYTES + 1)], "huge.jpg", {
      type: "image/jpeg",
    });
    await expect(saveProofPhoto(big)).rejects.toThrow(InvalidProofPhotoError);
  });
});
