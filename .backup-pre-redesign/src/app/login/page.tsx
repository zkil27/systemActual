"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Lock, Mail, QrCode } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";

  const [email, setEmail] = useState("owner@kynaph.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
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
        setError(data.error || "Sign in failed. Check your email and password.");
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-[#f4f7f8] px-4 py-8">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0f766e] text-lg font-extrabold text-white shadow-sm">
            K
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Kyna Ops
            </h1>
            <p className="text-sm font-medium text-slate-600">
              Daily Returns &amp; Failed Delivery Tracker
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Owner Sign In</h2>
          <p className="mt-1 text-sm text-slate-600">
            Check today&apos;s Shopee &amp; TikTok returns straight from your phone.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-semibold text-slate-700"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@kynaph.com"
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-11 pr-3.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-[#0f766e] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-semibold text-slate-700"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-slate-400" />
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-11 pr-3.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-[#0f766e] focus:outline-none"
                />
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-800"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0f766e] text-base font-bold text-white transition-colors hover:bg-[#115e59] disabled:opacity-60"
            >
              {submitting ? "Signing in..." : "Sign In"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
            Default local owner account:{" "}
            <span className="font-bold text-slate-800">owner@kynaph.com</span> /{" "}
            <span className="font-bold text-slate-800">kyna1234</span>
          </p>
        </div>

        <Link
          href="/scan"
          className="mt-4 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 shadow-sm transition-colors hover:bg-slate-50"
        >
          <QrCode className="h-5 w-5 text-[#0f766e]" />
          <span>Warehouse Staff? Open Return Scanner</span>
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f4f7f8]" />}>
      <LoginForm />
    </Suspense>
  );
}
