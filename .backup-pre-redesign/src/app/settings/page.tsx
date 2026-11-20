"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ExternalLink,
  LogOut,
  Send,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";

interface SettingsPayload {
  settings: {
    defaultUnitCostPhp: number;
    defaultSellingPrice: number;
    overdueRtsDays: number;
    telegramChatId: string;
    telegramDailyBriefUtc: string;
  };
  integrations: {
    shopeeEnvReady: boolean;
    tiktokEnvReady: boolean;
    telegramBotReady: boolean;
  };
  staff: Array<{ id: string; name: string; active: boolean }>;
  shops: Array<{
    id: string;
    platform: "SHOPEE" | "TIKTOK";
    shopId: string;
    shopName: string;
    isDemo: boolean;
    connected: boolean;
    lastSyncedAt: string | null;
  }>;
  telegramPreview: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [unitCost, setUnitCost] = useState("82");
  const [sellingPrice, setSellingPrice] = useState("199");
  const [overdueDays, setOverdueDays] = useState("10");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffPin, setNewStaffPin] = useState("");
  const [addingStaff, setAddingStaff] = useState(false);

  async function loadSettings() {
    const res = await fetch("/api/settings");
    if (res.ok) {
      const payload: SettingsPayload = await res.json();
      setData(payload);
      setUnitCost(String(payload.settings.defaultUnitCostPhp));
      setSellingPrice(String(payload.settings.defaultSellingPrice));
      setOverdueDays(String(payload.settings.overdueRtsDays));
      setTelegramChatId(payload.settings.telegramChatId);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function saveGeneral(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_settings",
          defaultUnitCostPhp: Number(unitCost),
          defaultSellingPrice: Number(sellingPrice),
          overdueRtsDays: Number(overdueDays),
          telegramChatId,
        }),
      });
      if (!res.ok) {
        setError("Could not save settings.");
        return;
      }
      setNotice("Settings saved.");
      await loadSettings();
    } finally {
      setSaving(false);
    }
  }

  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!newStaffName.trim() || !/^\d{4}$/.test(newStaffPin)) {
      setError("Enter a staff name and a 4-digit PIN.");
      return;
    }
    setAddingStaff(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_staff",
          staffName: newStaffName.trim(),
          pin: newStaffPin,
        }),
      });
      if (!res.ok) {
        setError("Could not add staff (name may already exist).");
        return;
      }
      setNewStaffName("");
      setNewStaffPin("");
      setNotice("Staff member added for /scan.");
      await loadSettings();
    } finally {
      setAddingStaff(false);
    }
  }

  async function handleToggleStaff(staffId: string, active: boolean) {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_staff", staffId, active }),
    });
    await loadSettings();
  }

  async function handleSendTestTelegram() {
    setNotice("");
    setError("");
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_test_telegram" }),
    });
    const out = await res.json();
    if (out.ok) {
      setNotice("Sent today's daily summary to your Telegram!");
    } else {
      setError(out.error || "Telegram bot token or Chat ID not configured yet.");
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Settings</h1>
            <p className="mt-0.5 text-sm text-slate-600">
              Store links, item cost rule, warehouse staff PINs, and Telegram alerts.
            </p>
          </div>
          <Link
            href="/imports"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800 md:hidden"
          >
            <Upload className="h-4 w-4 text-[#0f766e]" />
            Upload File
          </Link>
        </div>

        {notice && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{notice}</span>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-800">
            {error}
          </div>
        )}

        {/* Store Connections */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <h2 className="text-base font-extrabold text-slate-900">Store Connections</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Once Shopee and TikTok finish reviewing your In-House Developer apps, add the keys in
            Vercel / <code className="rounded bg-slate-100 px-1">.env</code> and tap Connect.
          </p>

          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <a
              href="/api/oauth/shopee/start"
              className="flex h-12 items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-900 hover:bg-slate-100"
            >
              <span>
                Shopee PH{" "}
                <span className="ml-1 text-xs font-semibold text-slate-500">
                  ({data?.integrations.shopeeEnvReady ? "Keys Ready" : "Waiting Keys"})
                </span>
              </span>
              <ExternalLink className="h-4 w-4 text-[#0f766e]" />
            </a>
            <a
              href="/api/oauth/tiktok/start"
              className="flex h-12 items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-900 hover:bg-slate-100"
            >
              <span>
                TikTok Shop PH{" "}
                <span className="ml-1 text-xs font-semibold text-slate-500">
                  ({data?.integrations.tiktokEnvReady ? "Keys Ready" : "Waiting Keys"})
                </span>
              </span>
              <ExternalLink className="h-4 w-4 text-[#0f766e]" />
            </a>
          </div>
        </section>

        {/* Flat Cost Rule & Telegram Chat ID */}
        <form
          onSubmit={saveGeneral}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
        >
          <h2 className="text-base font-extrabold text-slate-900">
            Item Cost &amp; Daily Telegram Brief
          </h2>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Unit Cost (₱)
              </label>
              <input
                type="number"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="tabular-nums h-11 w-full rounded-xl border border-slate-300 px-3 text-base font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Sell Price (₱)
              </label>
              <input
                type="number"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                className="tabular-nums h-11 w-full rounded-xl border border-slate-300 px-3 text-base font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                Overdue (Days)
              </label>
              <input
                type="number"
                value={overdueDays}
                onChange={(e) => setOverdueDays(e.target.value)}
                className="tabular-nums h-11 w-full rounded-xl border border-slate-300 px-3 text-base font-bold text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">
              Owner Telegram Chat ID (Free 8:00 PM Daily Summary)
            </label>
            <input
              type="text"
              value={telegramChatId}
              onChange={(e) => setTelegramChatId(e.target.value)}
              placeholder="Send /start to your Telegram bot to auto-link"
              className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0f766e] px-5 text-sm font-bold text-white hover:bg-[#115e59] disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
            <button
              type="button"
              onClick={handleSendTestTelegram}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              <Send className="h-4 w-4 text-[#0f766e]" />
              Send Test Brief
            </button>
          </div>

          {data?.telegramPreview && (
            <div className="pt-2">
              <p className="mb-1.5 text-xs font-bold text-slate-600">
                Preview of Tonight&apos;s 8:00 PM Telegram Summary:
              </p>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800">
                {data.telegramPreview}
              </pre>
            </div>
          )}
        </form>

        {/* Warehouse Staff PINs */}
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-[#0f766e]" />
            <h2 className="text-base font-extrabold text-slate-900">
              Warehouse Staff (/scan PINs)
            </h2>
          </div>

          <ul className="divide-y divide-slate-100 border-y border-slate-100">
            {(data?.staff ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-bold text-slate-900">{s.name}</span>
                <button
                  type="button"
                  onClick={() => handleToggleStaff(s.id, !s.active)}
                  className={`rounded-lg px-3 py-1 text-xs font-bold ${
                    s.active
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {s.active ? "Active" : "Disabled"}
                </button>
              </li>
            ))}
          </ul>

          <form onSubmit={handleAddStaff} className="flex gap-2">
            <input
              type="text"
              value={newStaffName}
              onChange={(e) => setNewStaffName(e.target.value)}
              placeholder="Staff name"
              className="h-11 flex-1 rounded-xl border border-slate-300 px-3 text-sm text-slate-900"
            />
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={newStaffPin}
              onChange={(e) => setNewStaffPin(e.target.value.replace(/\D/g, ""))}
              placeholder="4-digit PIN"
              className="tabular-nums h-11 w-28 rounded-xl border border-slate-300 px-3 text-center text-sm font-bold text-slate-900"
            />
            <button
              type="submit"
              disabled={addingStaff}
              className="inline-flex h-11 items-center gap-1 rounded-xl bg-slate-900 px-3.5 text-xs font-bold text-white"
            >
              <UserPlus className="h-4 w-4" />
              Add
            </button>
          </form>
        </section>

        <button
          type="button"
          onClick={handleLogout}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white text-sm font-bold text-red-700 hover:bg-red-50"
        >
          <LogOut className="h-4 w-4" />
          Sign Out of Owner Account
        </button>
      </div>
    </AppShell>
  );
}
