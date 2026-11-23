"use client";

const FORMATS = ["code_128", "code_39", "qr_code", "ean_13", "itf"];
const READER_ID = "kyna-file-barcode-reader";

type DetectorCtor = new (opts: { formats: string[] }) => {
  detect: (src: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

/**
 * Read a waybill barcode from a photo (camera capture input). Native
 * BarcodeDetector first (Android Chrome), else html5-qrcode's file scanner (iOS).
 */
export async function decodeBarcodeFromFile(file: File): Promise<string | null> {
  const w = window as unknown as { BarcodeDetector?: DetectorCtor };
  if (w.BarcodeDetector) {
    try {
      const detector = new w.BarcodeDetector({ formats: FORMATS });
      const bitmap = await createImageBitmap(file);
      try {
        const found = await detector.detect(bitmap);
        const raw = found.find((b) => b.rawValue)?.rawValue;
        if (raw) return raw.trim();
      } finally {
        bitmap.close?.();
      }
    } catch {
      // Fall through to the JS decoder.
    }
  }
  try {
    let el = document.getElementById(READER_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = READER_ID;
      el.style.display = "none";
      document.body.appendChild(el);
    }
    const { Html5Qrcode } = await import("html5-qrcode");
    const reader = new Html5Qrcode(READER_ID, { verbose: false });
    try {
      const text = await reader.scanFile(file, false);
      return text?.trim() || null;
    } finally {
      reader.clear();
    }
  } catch {
    return null;
  }
}
