"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, ScanBarcode } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { safeNextPath } from "@/lib/ui/safe-next";

const fieldClass =
  "h-[52px] w-full bg-transparent px-4 text-[17px] text-ink placeholder:text-ink-3 focus:outline-none";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only same-site paths: "?next=//evil.com" or "?next=https://..." would leave the app.
  const nextPath = safeNextPath(searchParams.get("next"));
  // Dev-only hints. Next swaps NODE_ENV for a literal, so production builds drop them entirely.
  const demo = process.env.NODE_ENV === "development";

  const [email, setEmail] = useState(demo ? "owner@kynaph.com" : "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [shakeKey, setShakeKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/owner-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Wrong email or password.");
        setShakeKey((k) => k + 1);
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("No connection. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="safe-top flex min-h-dvh flex-col bg-ground px-6">
      <div className="anim-page-in mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        <h1 className="text-[40px] font-extrabold leading-none tracking-[-0.03em] text-ink">Kyna Ops</h1>
        <p className="mt-3 text-[17px] text-ink-2">Sign in to see today&apos;s returns.</p>

        <form onSubmit={handleSubmit} className="mt-10 space-y-4">
          <div
            key={shakeKey}
            className={`divide-y divide-hairline overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] focus-within:shadow-[0_0_0_2px_var(--color-brand)] ${
              shakeKey > 0 ? "anim-shake" : ""
            }`}
          >
            <label className="block">
              <span className="sr-only">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className={fieldClass}
              />
            </label>
            <div className="flex items-center">
              <label className="block min-w-0 flex-1">
                <span className="sr-only">Password</span>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className={fieldClass}
                />
              </label>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="pressable mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-ink"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="anim-fade-in px-1 text-[15px] font-semibold text-missing-ink">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" full disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>

          {demo && (
            <p className="px-1 text-center text-[14px] text-ink-3">
              Dev account: owner@kynaph.com / kyna1234
            </p>
          )}
        </form>
      </div>

      <Link
        href="/scan"
        className="pressable safe-bottom mx-auto mb-4 flex h-12 items-center gap-2 rounded-full px-4 text-[16px] font-semibold text-brand"
      >
        <ScanBarcode className="h-5 w-5" />
        Staff scanner
      </Link>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-ground" />}>
      <LoginForm />
    </Suspense>
  );
}
