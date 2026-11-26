"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-errors";

/** Last-resort screen when the root layout itself fails. Plain styles: the app's CSS may not have loaded. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100dvh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 360 }}>
          <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 16, color: "#555", margin: "0 0 16px" }}>The app hit a problem. Your data is safe.</p>
          <button
            type="button"
            onClick={reset}
            style={{ height: 48, width: "100%", borderRadius: 12, border: 0, background: "#2563eb", color: "#fff", fontSize: 16, fontWeight: 700 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
