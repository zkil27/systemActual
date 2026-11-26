"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { reportClientError } from "@/lib/client-errors";

/** Shown instead of a blank page when a screen crashes. The error goes to Developer › Errors. */
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error, { digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-[24px] font-extrabold tracking-tight text-ink">Something went wrong</h1>
      <p className="text-[16px] text-ink-2">This screen hit a problem. Your data is safe. Try again, or go back to Today.</p>
      <div className="flex w-full flex-col gap-2">
        <Button full onClick={reset}>
          Try again
        </Button>
        <Button full variant="secondary" onClick={() => window.location.assign("/")}>
          Go to Today
        </Button>
      </div>
    </main>
  );
}
