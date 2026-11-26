"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { fieldClass, postSettings } from "./shared";

/** Owner email, password, and active-session revocation. */
export function AccountSheet({
  open,
  email,
  onClose,
  onSaved,
  onRevokedAll,
}: {
  open: boolean;
  email: string;
  onClose: () => void;
  onSaved: () => void;
  onRevokedAll: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [newEmail, setNewEmail] = useState(email);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrent("");
      setNewEmail(email);
      setNewPassword("");
      setConfirmPassword("");
    }
  }, [open, email]);

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const { ok, data } = await postSettings(body);
    setBusy(false);
    if (!ok) return toast(String(data.error ?? "Couldn't save"), "error");
    toast(done);
    onSaved();
    onClose();
  }

  async function revokeAllDevices() {
    setBusy(true);
    const { ok, data } = await postSettings({ action: "revoke_owner_sessions" });
    setBusy(false);
    if (!ok) return toast(String(data.error ?? "Couldn't sign out other devices"), "error");
    toast("Signed out on every device");
    onClose();
    onRevokedAll();
  }

  const type = show ? "text" : "password";
  return (
    <Sheet open={open} onClose={onClose} title="Your account">
      <div className="space-y-5 pt-1">
        <label className="block">
          <span className="mb-1 block text-[14px] font-semibold text-ink-3">Current password</span>
          <input
            type={type}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-[15px] text-ink-2">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-5 w-5" />
          Show passwords
        </label>
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold text-ink-3">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className={fieldClass}
            />
          </label>
          <Button
            variant="secondary"
            full
            disabled={busy || !current || !newEmail.trim() || newEmail.trim().toLowerCase() === email.toLowerCase()}
            onClick={() =>
              run({ action: "update_owner_email", currentPassword: current, email: newEmail.trim() }, "Email changed")
            }
          >
            Change email
          </Button>
        </div>
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold text-ink-3">New password (8+ characters)</span>
            <input
              type={type}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold text-ink-3">Type it again</span>
            <input
              type={type}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={fieldClass}
            />
          </label>
          {confirmPassword && newPassword !== confirmPassword && (
            <p className="text-[14px] font-semibold text-missing-ink">The two passwords don&apos;t match.</p>
          )}
          <Button
            full
            disabled={busy || !current || newPassword.length < 8 || newPassword !== confirmPassword}
            onClick={() =>
              run(
                { action: "update_owner_password", currentPassword: current, newPassword },
                "Password changed and other devices signed out"
              )
            }
          >
            Change password
          </Button>
        </div>
        <div className="border-t border-hairline pt-4 space-y-2">
          <p className="text-[14px] text-ink-3">
            Lost a phone or signed in on another computer? Sign out your owner account everywhere at once.
          </p>
          <Button variant="danger" full disabled={busy} onClick={() => void revokeAllDevices()}>
            Sign out all devices
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
