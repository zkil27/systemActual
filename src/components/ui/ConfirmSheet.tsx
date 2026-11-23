"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
}

/**
 * In-app replacement for window.confirm(): a bottom sheet with a clear
 * primary action. Use the hook, render `sheet` once, `await confirm({...})`.
 */
export function useConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  sheet: React.ReactNode;
} {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const settle = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpen(false);
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    // A second confirm while one is open answers the first with "no".
    resolver.current?.(false);
    setOpts(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const sheet = (
    <Sheet open={open} onClose={() => settle(false)} title={opts?.title ?? "Are you sure?"}>
      {opts && (
        <div className="space-y-5 pt-1">
          {opts.message && <div className="text-[16px] leading-relaxed text-ink-2">{opts.message}</div>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => settle(false)}>
              {opts.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={opts.danger ? "danger" : "primary"}
              onClick={() => settle(true)}
              className={opts.danger ? "bg-missing-solid text-white hover:bg-missing-solid/90" : ""}
            >
              {opts.confirmLabel ?? "OK"}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );

  return { confirm, sheet };
}
