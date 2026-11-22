"use client";

import { useEffect, useState } from "react";
import { FileUp, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button, Group, SectionHeader } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { toast } from "@/components/ui/Toast";
import { manilaDateTime } from "@/lib/ui/format";

interface ImportJobItem {
  id: string;
  fileName: string;
  sourceHint: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  createdAt: string;
}

const STORES = [
  { id: "SHOPEE", label: "Shopee" },
  { id: "TIKTOK", label: "TikTok Shop" },
] as const;

export default function ImportsPage() {
  const [platform, setPlatform] = useState<"SHOPEE" | "TIKTOK">("SHOPEE");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<ImportJobItem[]>([]);

  async function loadJobs() {
    const res = await fetch("/api/imports");
    if (res.ok) {
      const data = await res.json();
      setJobs(data.jobs ?? []);
    }
  }

  useEffect(() => {
    loadJobs();
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("platform", platform);
      const res = await fetch("/api/imports", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "This file couldn't be read.");
        return;
      }
      toast(`${data.imported} ${data.kind === "orders" ? "orders" : data.kind === "stock" ? "items" : "parcels"} added`);
      setFile(null);
      await loadJobs();
    } catch {
      setError("No connection. Try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSimulate() {
    setSimulating(true);
    try {
      const res = await fetch("/api/demo/simulate", { method: "POST" });
      const data = await res.json();
      if (res.ok) toast("Sample data refreshed");
      else toast(data.error || "Couldn't load sample data", "error");
    } finally {
      setSimulating(false);
    }
  }

  return (
    <AppShell title="Upload">
      <div className="space-y-8">
        <form onSubmit={handleUpload} className="space-y-4">
          <SegmentedControl label="Store" options={STORES} value={platform} onChange={setPlatform} />

          <label
            className={`pressable flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] px-6 py-8 text-center transition-colors ${
              file
                ? "bg-brand-soft shadow-[inset_0_0_0_1.5px_var(--color-brand)]"
                : "bg-surface shadow-[var(--shadow-card)] hover:bg-surface-subtle"
            }`}
          >
            <FileUp
              key={file ? file.name : "empty"}
              className={`anim-pop h-8 w-8 ${file ? "text-brand" : "text-ink-3"}`}
              strokeWidth={1.8}
            />
            <span className="max-w-full truncate text-[17px] font-semibold text-ink">
              {file ? file.name : "Choose a CSV or Excel file"}
            </span>
            <span className="text-[13px] text-ink-3">Supports Returns, Orders, or Product Stock exports</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="sr-only"
              onChange={(e) => {
                setError("");
                setFile(e.target.files?.[0] ?? null);
              }}
            />
          </label>

          {error && (
            <p role="alert" className="anim-fade-in px-1 text-[15px] font-semibold text-missing-ink">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" full disabled={!file || uploading}>
            {uploading ? "Importing…" : "Import file"}
          </Button>
        </form>

        {jobs.length > 0 && (
          <section>
            <SectionHeader title="Recent" />
            <Group className="divide-y divide-hairline">
              {jobs.map((j, i) => (
                <div
                  key={j.id}
                  className={`flex min-h-14 items-center justify-between gap-4 px-4 py-3 ${i < 10 ? "anim-rise-in" : ""}`}
                  style={i < 10 ? { animationDelay: `${i * 25}ms` } : undefined}
                >
                  <div className="min-w-0">
                    <p className="truncate text-[16px] font-semibold text-ink">{j.fileName}</p>
                    <p className="text-[14px] text-ink-3">{manilaDateTime(j.createdAt)}</p>
                  </div>
                  <span className="tabular-nums shrink-0 text-[16px] font-semibold text-arrived">
                    {j.importedRows} added
                  </span>
                </div>
              ))}
            </Group>
          </section>
        )}

        <Group>
          <button
            type="button"
            onClick={handleSimulate}
            disabled={simulating}
            className="pressable-row flex min-h-[52px] w-full items-center justify-between gap-4 px-4 text-left hover:bg-surface-subtle active:bg-surface-muted"
          >
            <span className="text-[17px] text-ink">Refresh sample data</span>
            <RefreshCw className={`h-5 w-5 text-brand ${simulating ? "anim-spin" : ""}`} />
          </button>
        </Group>
      </div>
    </AppShell>
  );
}
