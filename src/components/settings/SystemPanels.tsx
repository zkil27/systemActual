"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Button, Group } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import type { HealthSummary } from "@/lib/health";
import { rowLinkClass } from "./shared";

const HEALTH_DOT: Record<string, string> = { ok: "bg-arrived", warn: "bg-failed", bad: "bg-missing" };
const HEALTH_WORD: Record<string, string> = { ok: "All good", warn: "Needs a look", bad: "Something is wrong" };

export function HealthPanel() {
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setHealth(await res.json());
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Group>
      <Disclosure
        summaryClassName={rowLinkClass}
        label={
          <span className="flex items-center gap-2.5">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${health ? HEALTH_DOT[health.level] : "bg-ink-3/40"}`} />
            <span className="text-[17px] text-ink">System health</span>
            <span className="text-[15px] text-ink-3">
              {health ? HEALTH_WORD[health.level] : error ? "Couldn't check" : "Checking…"}
            </span>
          </span>
        }
        onOpenChange={(open) => {
          if (open) void load();
        }}
      >
        <ul className="divide-y divide-hairline border-t border-hairline">
          {(health?.checks ?? []).map((c) => (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3">
              <span aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${HEALTH_DOT[c.level]}`} />
              <span className="min-w-0">
                <span className="block text-[16px] font-semibold text-ink">{c.label}</span>
                <span className="block text-[14px] text-ink-3">{c.detail}</span>
              </span>
            </li>
          ))}
          {error && (
            <li className="px-4 py-3">
              <Button variant="secondary" onClick={load}>
                Try again
              </Button>
            </li>
          )}
        </ul>
      </Disclosure>
    </Group>
  );
}

/** Only shown to owner accounts on the DEVELOPER_EMAILS allowlist. */
export function DeveloperRow() {
  const [developer, setDeveloper] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/dev/access", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { developer?: boolean } | null) => {
        if (alive) setDeveloper(Boolean(b?.developer));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!developer) return null;
  return (
    <section>
      <h2 className="mb-2 px-4 text-[15px] font-semibold text-ink-3">Developer</h2>
      <Group>
        <Link href="/dev" className={rowLinkClass}>
          <span className="flex min-w-0 flex-col">
            <span className="text-[17px] text-ink">Developer tools</span>
            <span className="truncate text-[13px] text-ink-3">Database, errors, jobs and controls</span>
          </span>
          <ChevronRight className="chevron-nudge h-5 w-5 shrink-0 text-ink-3" />
        </Link>
      </Group>
    </section>
  );
}
