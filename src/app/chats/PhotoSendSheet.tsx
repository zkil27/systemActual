"use client";

import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";

/** Check the photo before it goes to the buyer. */
export function PhotoSendSheet({
  draft,
  onCancel,
  onSend,
}: {
  draft: { file: File; url: string } | null;
  onCancel: () => void;
  onSend: () => void;
}) {
  return (
    <Sheet open={draft !== null} onClose={onCancel} title="Send this photo?">
      {draft && (
        <div className="space-y-5 pt-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={draft.url}
            alt="Photo to send"
            className="mx-auto max-h-[50dvh] w-auto rounded-[var(--radius-card)] bg-surface-muted object-contain"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onSend}>Send photo</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
