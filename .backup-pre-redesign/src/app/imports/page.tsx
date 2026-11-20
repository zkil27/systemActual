"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Sparkles, Upload } from "lucide-react";
import { AppShell } from "@/components/AppShell";

interface ImportJobItem {
  id: string;
  fileName: string;
  sourceHint: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  createdAt: string;
}

export default function ImportsPage() {
  const [platform, setPlatform] = useState<"SHOPEE" | "TIKTOK">("SHOPEE");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [message, setMessage] = useState("");
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
    setMessage("");
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("platform", platform);
      const res = await fetch("/api/imports", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed.");
        return;
      }
      setMessage(
        `Imported ${data.imported} return parcels (${data.skipped} skipped). Today's dashboard is updated.`
      );
      setFile(null);
      await loadJobs();
    } catch {
      setError("Network error while uploading file.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSimulate() {
    setSimulating(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/demo/simulate", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message || "Sample kynaph returns loaded.");
      } else {
        setError(data.error || "Could not load sample data.");
      }
    } finally {
      setSimulating(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
            Upload Store Export
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Upload a CSV or Excel file from Shopee, TikTok Shop, or BigSeller anytime—even
            while waiting for API approval.
          </p>
        </div>

        <form
          onSubmit={handleUpload}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
        >
          <div>
            <p className="mb-2 text-sm font-bold text-slate-800">1. Which store is this file from?</p>
            <div className="grid grid-cols-2 gap-2">
              {(["SHOPEE", "TIKTOK"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatform(p)}
                  className={`h-12 rounded-xl text-sm font-extrabold transition-colors ${
                    platform === p
                      ? "bg-[#0f766e] text-white"
                      : "border border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  {p === "SHOPEE" ? "Shopee PH" : "TikTok Shop PH"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-bold text-slate-800">2. Choose CSV or Excel file</p>
            <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center hover:bg-slate-100">
              <FileSpreadsheet className="h-7 w-7 text-[#0f766e]" />
              <span className="text-sm font-bold text-slate-800">
                {file ? file.name : "Tap to pick a .csv or .xlsx file"}
              </span>
              <span className="text-xs text-slate-500">
                Failed Delivery and Buyer Return rows are automatically separated.
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          {message && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>{message}</span>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!file || uploading}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0f766e] text-base font-bold text-white transition-colors hover:bg-[#115e59] disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {uploading ? "Importing..." : "Import Return File"}
          </button>
        </form>

        {/* Demo Simulator */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-slate-900">Sample Store Data</h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Refresh realistic sample skirts, shorts, and tees for Today so you can test
                scanning and missing-parcel alerts.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSimulate}
              disabled={simulating}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4 text-[#0f766e]" />
              {simulating ? "Loading..." : "Refresh Sample"}
            </button>
          </div>
        </section>

        {/* Upload History */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-extrabold text-slate-900">Recent Uploads</h2>
          </div>
          {jobs.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500">
              No files uploaded yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {jobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{j.fileName}</p>
                    <p className="text-xs text-slate-500">
                      {j.sourceHint} • {new Date(j.createdAt).toLocaleString("en-PH")}
                    </p>
                  </div>
                  <span className="tabular-nums shrink-0 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
                    {j.importedRows} saved
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
