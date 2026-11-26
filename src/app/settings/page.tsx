"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronRight, Lock, Monitor, Moon, Sun } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button, Group } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmSheet";
import { DatePickerSheet } from "@/components/ui/DatePickerSheet";
import { Disclosure } from "@/components/ui/Disclosure";
import { Sheet } from "@/components/ui/Sheet";
import type { HealthSummary } from "@/lib/health";
import { manilaDayLabel, updatedAgo } from "@/lib/ui/format";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { toast } from "@/components/ui/Toast";
import { formatManilaDateTime, getManilaTodayStr } from "@/lib/time";
import { useAmbientPreference, useTheme, type ThemePreference } from "@/lib/ui/theme";
import { PrinterSettings } from "@/components/PrinterSettings";

const THEME_OPTIONS: readonly { id: ThemePreference; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Auto" },
];

const THEME_HINT: Record<ThemePreference, string> = {
  light: "Always light",
  dark: "Easier on the eyes at night",
  system: "Matches your phone",
};

interface SettingsPayload {
  hasDemoData?: boolean;
  settings: {
    defaultUnitCostPhp: number;
    defaultSellingPrice: number;
    overdueRtsDays: number;
    returnShippingEstimatePhp: number;
    stockSafetyBuffer: number;
    telegramChatId: string;
    telegramDailyBriefUtc: string;
    telegramDailyBriefManila: string;
    missingSinceDate: string;
    customWaybillEnabled: boolean;
  };
  integrations: {
    shopeeEnvReady: boolean;
    tiktokEnvReady: boolean;
    telegramBotReady: boolean;
  };
  owner: { email: string; name: string } | null;
  staff: StaffRow[];
  shops: Array<{
    id: string;
    platform: "SHOPEE" | "TIKTOK";
    shopId: string;
    shopName: string;
    isDemo: boolean;
    connected: boolean;
    lastSyncedAt: string | null;
    tokenExpiresAt: string | null;
    needsReconnect: boolean;
    tokenError: string | null;
    writesEnabled: boolean;
  }>;
  telegramPreview?: string;
}

interface StaffRow {
  id: string;
  name: string;
  active: boolean;
  locked: boolean;
  lockedUntil: string | null;
  failedPinAttempts: number;
}

async function postSettings(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, data };
  } catch {
    return { ok: false, data: { error: "No connection" } };
  }
}

/** Costs, Return tracking and Telegram sit in different columns but save together. */
const SETTINGS_FORM_ID = "settings-form";

const fieldClass =
  "h-12 w-full rounded-[var(--radius-control)] bg-surface-muted px-3.5 text-[16px] text-ink focus:shadow-[0_0_0_2px_var(--color-brand)] focus:outline-none";

/** Tap a staff row: rename, reset PIN, clear a lockout. */
function StaffSheet({ staff, onClose, onSaved }: { staff: StaffRow | null; onClose: () => void; onSaved: () => void }) {
  const last = useRef<StaffRow | null>(null);
  if (staff) last.current = staff;
  const s = last.current;
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (staff) {
      setName(staff.name);
      setPin("");
    }
  }, [staff]);

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const { ok, data } = await postSettings(body);
    setBusy(false);
    if (!ok) return toast(String(data.error ?? "Couldn't save"), "error");
    toast(done);
    onSaved();
  }

  return (
    <Sheet open={staff !== null} onClose={onClose} title={s?.name ?? "Staff"}>
      {s && (
        <div className="space-y-6 pt-1">
          {s.locked && (
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-missing-soft px-4 py-2">
              <span className="text-[15px] font-semibold text-missing-ink">Locked out after wrong PINs</span>
              <Button
                variant="plain"
                disabled={busy}
                onClick={() => run({ action: "clear_staff_lockout", staffId: s.id }, "Unlocked")}
                className="h-11 px-3"
              >
                Unlock
              </Button>
            </div>
          )}
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!/^\d{4}$/.test(pin)) return toast("PIN must be 4 digits", "error");
              void run({ action: "update_staff_pin", staffId: s.id, pin }, "New PIN saved. They need to unlock again.");
              setPin("");
            }}
          >
            <label className="block">
              <span className="mb-1 block text-[14px] font-semibold text-ink-3">New 4-digit PIN</span>
              <input
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className={`tabular-nums tracking-[0.4em] ${fieldClass}`}
              />
            </label>
            <Button type="submit" full disabled={busy || pin.length !== 4}>
              Reset PIN
            </Button>
          </form>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || name.trim() === s.name) return;
              void run({ action: "rename_staff", staffId: s.id, staffName: name.trim() }, "Renamed");
            }}
          >
            <label className="block">
              <span className="mb-1 block text-[14px] font-semibold text-ink-3">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={fieldClass} />
            </label>
            <Button type="submit" variant="secondary" full disabled={busy || !name.trim() || name.trim() === s.name}>
              Rename
            </Button>
          </form>
          <Button
            variant={s.active ? "danger" : "secondary"}
            full
            disabled={busy}
            onClick={() =>
              run({ action: "toggle_staff", staffId: s.id, active: !s.active }, s.active ? "Turned off" : "Turned on")
            }
          >
            {s.active ? "Turn off (signs them out now)" : "Let them use the scanner again"}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** Owner email + password. Both need the current password. */
function AccountSheet({
  open,
  email,
  onClose,
  onSaved,
}: {
  open: boolean;
  email: string;
  onClose: () => void;
  onSaved: () => void;
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

  const type = show ? "text" : "password";
  return (
    <Sheet open={open} onClose={onClose} title="Your account">
      <div className="space-y-5 pt-1">
        <label className="block">
          <span className="mb-1 block text-[14px] font-semibold text-ink-3">Current password</span>
          <input type={type} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-[15px] text-ink-2">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-5 w-5" />
          Show passwords
        </label>
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold text-ink-3">Email</span>
            <input type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={fieldClass} />
          </label>
          <Button
            variant="secondary"
            full
            disabled={busy || !current || !newEmail.trim() || newEmail.trim().toLowerCase() === email.toLowerCase()}
            onClick={() => run({ action: "update_owner_email", currentPassword: current, email: newEmail.trim() }, "Email changed")}
          >
            Change email
          </Button>
        </div>
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold text-ink-3">New password (8+ characters)</span>
            <input type={type} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={fieldClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[14px] font-semibold text-ink-3">Type it again</span>
            <input type={type} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={fieldClass} />
          </label>
          {confirmPassword && newPassword !== confirmPassword && (
            <p className="text-[14px] font-semibold text-missing-ink">The two passwords don&apos;t match.</p>
          )}
          <Button
            full
            disabled={busy || !current || newPassword.length < 8 || newPassword !== confirmPassword}
            onClick={() => run({ action: "update_owner_password", currentPassword: current, newPassword }, "Password changed")}
          >
            Change password
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

const HEALTH_DOT: Record<string, string> = { ok: "bg-arrived", warn: "bg-failed", bad: "bg-missing" };
const HEALTH_WORD: Record<string, string> = { ok: "All good", warn: "Needs a look", bad: "Something is wrong" };

function HealthPanel() {
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
            <span className="text-[15px] text-ink-3">{health ? HEALTH_WORD[health.level] : error ? "Couldn't check" : "Checking…"}</span>
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

/** "Nov 18", or "Nov 18, 2025" when the date isn't in this year. */
function sinceLabel(ymd: string): string {
  const label = manilaDayLabel(ymd);
  return ymd.slice(0, 4) === getManilaTodayStr().slice(0, 4) ? label : `${label}, ${ymd.slice(0, 4)}`;
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 px-4 text-[15px] font-semibold text-ink-3">{children}</h2>;
}

const rowClass = "flex min-h-[52px] items-center justify-between gap-4 px-4";
const rowLinkClass = `${rowClass} group pressable-row hover:bg-surface-subtle active:bg-surface-muted`;

function NumberRow({
  label,
  prefix,
  suffix,
  value,
  onChange,
}: {
  label: string;
  prefix?: string;
  suffix?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className={rowClass}>
      <span className="text-[17px] text-ink">{label}</span>
      <span className="flex items-center gap-1 text-[17px] text-ink-3">
        {prefix}
        <input
          type="number"
          form={SETTINGS_FORM_ID}
          inputMode="numeric"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // Width follows the digits so "₱" and "days" sit right beside the number.
          style={{ width: `${Math.max(value.length, 1) + 1}ch` }}
          className="tabular-nums bg-transparent text-right text-[17px] font-semibold text-ink focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {suffix}
      </span>
    </label>
  );
}

type ShopRow = SettingsPayload["shops"][number];

function storeStatus(shop: ShopRow | undefined, keysReady: boolean): string {
  if (shop?.needsReconnect) return "Reconnect";
  if (shop?.connected) return "Connected";
  return keysReady ? "Connect" : "Waiting for keys";
}

function storeDetail(shop: ShopRow | undefined): string | null {
  if (!shop?.connected || shop.needsReconnect || !shop.tokenExpiresAt) return null;
  return `Renews ${formatManilaDateTime(new Date(shop.tokenExpiresAt))}`;
}

export default function SettingsPage() {
  const router = useRouter();
  const { preference, setPreference } = useTheme();
  const { ambient, setAmbient } = useAmbientPreference();
  const ThemeIcon = preference === "dark" ? Moon : preference === "system" ? Monitor : Sun;
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [unitCost, setUnitCost] = useState("82");
  const [sellingPrice, setSellingPrice] = useState("199");
  const [overdueDays, setOverdueDays] = useState("10");
  const [returnShipping, setReturnShipping] = useState("40");
  const [stockBuffer, setStockBuffer] = useState("0");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [missingSinceDate, setMissingSinceDate] = useState("");
  const [sincePickerOpen, setSincePickerOpen] = useState(false);
  const [resettingMissing, setResettingMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffPin, setNewStaffPin] = useState("");
  const [addingStaff, setAddingStaff] = useState(false);
  const [telegramPreview, setTelegramPreview] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [clearingDemo, setClearingDemo] = useState(false);
  const [briefTime, setBriefTime] = useState("20:00");
  const [loadError, setLoadError] = useState(false);
  const [staffOpen, setStaffOpen] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const { confirm, sheet: confirmSheet } = useConfirm();

  async function loadTelegramPreview() {
    if (telegramPreview !== null || loadingPreview) return;
    setLoadingPreview(true);
    try {
      const res = await fetch("/api/settings?preview=1");
      if (res.ok) {
        const out = await res.json();
        setTelegramPreview(out.telegramPreview ?? "");
      }
    } finally {
      setLoadingPreview(false);
    }
  }

  async function loadSettings() {
    let res: Response;
    try {
      res = await fetch("/api/settings", { cache: "no-store" });
    } catch {
      setLoadError(true);
      return;
    }
    setLoadError(!res.ok);
    if (res.ok) {
      const payload: SettingsPayload = await res.json();
      setBriefTime(payload.settings.telegramDailyBriefManila ?? "20:00");
      setData(payload);
      setUnitCost(String(payload.settings.defaultUnitCostPhp));
      setSellingPrice(String(payload.settings.defaultSellingPrice));
      setOverdueDays(String(payload.settings.overdueRtsDays));
      setReturnShipping(String(payload.settings.returnShippingEstimatePhp));
      setStockBuffer(String(payload.settings.stockSafetyBuffer));
      setTelegramChatId(payload.settings.telegramChatId);
      setMissingSinceDate(payload.settings.missingSinceDate ?? "");
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  const dirty =
    data !== null &&
    (unitCost !== String(data.settings.defaultUnitCostPhp) ||
      sellingPrice !== String(data.settings.defaultSellingPrice) ||
      overdueDays !== String(data.settings.overdueRtsDays) ||
      returnShipping !== String(data.settings.returnShippingEstimatePhp) ||
      stockBuffer !== String(data.settings.stockSafetyBuffer) ||
      telegramChatId !== data.settings.telegramChatId ||
      briefTime !== (data.settings.telegramDailyBriefManila ?? "20:00") ||
      missingSinceDate !== (data.settings.missingSinceDate ?? ""));

  async function setShopWrites(shopConnectionId: string, label: string, active: boolean) {
    if (
      active &&
      !(await confirm({
        title: `Let Kyna Ops update ${label}?`,
        message: "It will sync stock, ship orders, and print labels automatically.",
        confirmLabel: "Turn on",
      }))
    ) {
      return;
    }
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_shop_writes", shopConnectionId, active }),
    });
    if (!res.ok) {
      toast("Couldn't save", "error");
      return;
    }
    toast(active ? `${label}: on` : `${label}: off`);
    await loadSettings();
  }

  async function setCustomWaybill(active: boolean) {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_settings", customWaybillEnabled: active }),
    });
    if (!res.ok) {
      toast("Couldn't save", "error");
      return;
    }
    toast(active ? "One sticker per parcel: on" : "One sticker per parcel: off");
    await loadSettings();
  }

  async function saveGeneral(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_settings",
          defaultUnitCostPhp: Number(unitCost),
          defaultSellingPrice: Number(sellingPrice),
          overdueRtsDays: Number(overdueDays),
          returnShippingEstimatePhp: Number(returnShipping),
          stockSafetyBuffer: Number(stockBuffer),
          telegramChatId,
          telegramDailyBriefManila: briefTime,
          missingSinceDate,
        }),
      });
      if (!res.ok) {
        toast("Couldn't save", "error");
        return;
      }
      toast("Saved");
      await loadSettings();
    } finally {
      setSaving(false);
    }
  }

  async function handleResetMissingBaseline() {
    if (
      !(await confirm({
        title: "Start fresh from today?",
        message:
          "Older returns stay saved in the database, but Today, 7 Days, Missing, and Overdue will only count from today onward.",
        confirmLabel: "Start fresh",
      }))
    ) {
      return;
    }
    setResettingMissing(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_missing_baseline" }),
      });
      if (!res.ok) {
        toast("Couldn't update", "error");
        return;
      }
      const out = await res.json();
      if (typeof out.missingSinceDate === "string") setMissingSinceDate(out.missingSinceDate);
      toast("Tracking returns from today");
      await loadSettings();
    } finally {
      setResettingMissing(false);
    }
  }

  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!newStaffName.trim() || !/^\d{4}$/.test(newStaffPin)) {
      toast("Add a name and a 4-digit PIN", "error");
      return;
    }
    setAddingStaff(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_staff", staffName: newStaffName.trim(), pin: newStaffPin }),
      });
      if (!res.ok) {
        toast("That name is already used", "error");
        return;
      }
      setNewStaffName("");
      setNewStaffPin("");
      toast("Staff added");
      await loadSettings();
    } finally {
      setAddingStaff(false);
    }
  }

  async function handleToggleStaff(staffId: string, active: boolean) {
    // Flip right away; the server confirms on reload.
    setData((d) =>
      d ? { ...d, staff: d.staff.map((s) => (s.id === staffId ? { ...s, active } : s)) } : d
    );
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle_staff", staffId, active }),
    });
    await loadSettings();
  }

  async function handleSendTestTelegram() {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_test_telegram" }),
    });
    const out = await res.json();
    if (out.ok) toast("Sent to Telegram");
    else toast(out.error || "Add your Telegram chat ID first", "error");
  }

  async function handleGeneratePairCode() {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate_telegram_pair_code" }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.code) {
      setPairCode(out.code);
      toast("Code ready (valid 10 mins)");
    } else {
      toast("Couldn't generate code", "error");
    }
  }

  async function handleClearDemo() {
    if (
      !(await confirm({
        title: "Remove sample data?",
        message: "Your real shops and settings won't be touched.",
        confirmLabel: "Remove",
        danger: true,
      }))
    )
      return;
    setClearingDemo(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_demo" }),
      });
      if (res.ok) {
        toast("Sample data cleared");
        await loadSettings();
      } else {
        toast("Couldn't clear sample data", "error");
      }
    } finally {
      setClearingDemo(false);
    }
  }

  async function handleDisconnect(shop: ShopRow) {
    const label = shop.platform === "SHOPEE" ? "Shopee" : "TikTok Shop";
    const ok = await confirm({
      title: `Disconnect ${label}?`,
      message: "Orders, returns and stock history stay. Syncing and updates to the shop stop until you connect again.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    const res = await postSettings({ action: "disconnect_shop", shopConnectionId: shop.id });
    if (!res.ok) return toast("Couldn't disconnect", "error");
    toast(`${label} disconnected`);
    await loadSettings();
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const shopee = data?.shops.find((s) => s.platform === "SHOPEE" && !s.isDemo);
  const tiktok = data?.shops.find((s) => s.platform === "TIKTOK" && !s.isDemo);

  return (
    <AppShell title="Settings" width="wide">
      {/* Costs, Return tracking, Telegram and the save bar are one form that spans both columns. */}
      <form id={SETTINGS_FORM_ID} onSubmit={saveGeneral} />
      <div className="space-y-10 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8 lg:space-y-0">
        <div className="space-y-10">
          <section>
            <GroupLabel>Stores</GroupLabel>
            <Group className="divide-y divide-hairline">
              {(
                [
                  { label: "Shopee PH", href: "/api/oauth/shopee/start", shop: shopee, keys: data?.integrations.shopeeEnvReady },
                  { label: "TikTok Shop PH", href: "/api/oauth/tiktok/start", shop: tiktok, keys: data?.integrations.tiktokEnvReady },
                ] as const
              ).map((row) => {
                const detail = storeDetail(row.shop);
                const synced = row.shop?.connected && row.shop.lastSyncedAt ? `Synced ${updatedAgo(row.shop.lastSyncedAt)}` : null;
                const status = storeStatus(row.shop, Boolean(row.keys));
                const body = (
                  <>
                    <span className="flex min-w-0 flex-col py-2">
                      <span className="text-[17px] text-ink">{row.label}</span>
                      {row.shop?.needsReconnect && row.shop.tokenError ? (
                        <span className="text-[13px] text-missing-ink">{row.shop.tokenError}</span>
                      ) : (
                        (detail || synced) && (
                          <span className="text-[13px] text-ink-3">{[synced, detail].filter(Boolean).join(" · ")}</span>
                        )
                      )}
                    </span>
                    <span
                      className={`flex shrink-0 items-center gap-1 text-[16px] ${
                        row.shop?.needsReconnect ? "font-semibold text-missing-ink" : "text-ink-3"
                      }`}
                    >
                      {status}
                      {row.keys && <ChevronRight className="chevron-nudge h-5 w-5" />}
                    </span>
                  </>
                );
                // No app keys on the server: connecting would only show an error page.
                return row.keys ? (
                  <a key={row.label} href={row.href} className={rowLinkClass}>
                    {body}
                  </a>
                ) : (
                  <div key={row.label} className={rowClass} aria-disabled="true">
                    {body}
                  </div>
                );
              })}
              {[shopee, tiktok]
                .filter((s): s is ShopRow => Boolean(s?.connected))
                .map((s) => {
                  const label = s.platform === "SHOPEE" ? "Shopee" : "TikTok";
                  return (
                    <div key={s.id} className={rowClass}>
                      <span className="flex flex-col">
                        <span className="text-[17px] text-ink">Update {label} from Kyna Ops</span>
                        <span className="text-[13px] text-ink-3">{s.writesEnabled ? "On: stock is sent to the shop" : "Off: nothing is changed on the shop"}</span>
                      </span>
                      <Switch
                        checked={s.writesEnabled}
                        onChange={(next) => setShopWrites(s.id, label, next)}
                        label={`Update ${label} from Kyna Ops`}
                      />
                    </div>
                  );
                })}
              {[shopee, tiktok]
                .filter((s): s is ShopRow => Boolean(s?.connected))
                .map((s) => (
                  <button
                    key={`dc-${s.id}`}
                    type="button"
                    onClick={() => handleDisconnect(s)}
                    className={`${rowLinkClass} w-full text-left`}
                  >
                    <span className="text-[17px] text-missing-ink">
                      Disconnect {s.platform === "SHOPEE" ? "Shopee" : "TikTok Shop"}
                    </span>
                  </button>
                ))}
            </Group>
          </section>

          <div className="space-y-5">
            <section>
              <GroupLabel>Costs</GroupLabel>
              <Group className="divide-y divide-hairline">
                <NumberRow label="Item cost" prefix="₱" value={unitCost} onChange={setUnitCost} />
                <NumberRow label="Selling price" prefix="₱" value={sellingPrice} onChange={setSellingPrice} />
                <NumberRow label="Shipping back" prefix="₱" value={returnShipping} onChange={setReturnShipping} />
                <NumberRow label="Overdue after" suffix="days" value={overdueDays} onChange={setOverdueDays} />
                <NumberRow label="Keep back from shops" suffix="pcs" value={stockBuffer} onChange={setStockBuffer} />
              </Group>
            </section>

            <section>
              <GroupLabel>Return tracking</GroupLabel>
              <Group className="divide-y divide-hairline">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setSincePickerOpen(true)}
                  className="pressable-row flex min-h-[64px] w-full items-center justify-between gap-4 px-4 py-2.5 text-left hover:bg-surface-subtle active:bg-surface-muted"
                >
                  <span className="flex flex-col">
                    <span className="text-[17px] text-ink">Track returns from</span>
                    <span className="text-[13px] text-ink-3">
                      Older returns stay saved in history, hidden from Today &amp; Missing
                    </span>
                  </span>
                  <span className="tabular-nums flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-surface-muted px-3 text-[16px] font-semibold text-ink">
                    <CalendarDays className="h-4 w-4 text-ink-3" />
                    {missingSinceDate ? sinceLabel(missingSinceDate) : "Pick date"}
                  </span>
                </button>
                <DatePickerSheet
                  title="Track returns from"
                  open={sincePickerOpen}
                  onClose={() => setSincePickerOpen(false)}
                  value={missingSinceDate}
                  onChange={setMissingSinceDate}
                />
                <button
                  type="button"
                  onClick={handleResetMissingBaseline}
                  disabled={resettingMissing}
                  className={`${rowLinkClass} w-full text-left disabled:opacity-50`}
                >
                  <span className="text-[17px] text-brand">
                    {resettingMissing ? "Updating…" : "Start fresh from today"}
                  </span>
                </button>
              </Group>
            </section>
          </div>

          <section>
            <GroupLabel>Warehouse staff</GroupLabel>
            <Group className="divide-y divide-hairline">
              {(data?.staff ?? []).map((s) => (
                <div key={s.id} className={`${rowClass} pr-4`}>
                  <button
                    type="button"
                    onClick={() => setStaffOpen(s.id)}
                    className="pressable flex min-h-[52px] min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className={`truncate text-[17px] ${s.active ? "text-ink" : "text-ink-3"}`}>{s.name}</span>
                    {s.locked && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-missing-soft px-2 py-0.5 text-[12px] font-bold text-missing-ink">
                        <Lock className="h-3 w-3" /> Locked
                      </span>
                    )}
                    <ChevronRight className="chevron-nudge ml-auto h-5 w-5 shrink-0 text-ink-3" />
                  </button>
                  <Switch
                    checked={s.active}
                    onChange={(next) => handleToggleStaff(s.id, next)}
                    label={`${s.name} can use the scanner`}
                  />
                </div>
              ))}
              <form onSubmit={handleAddStaff} className="flex items-center gap-2 px-4 py-2">
                <input
                  type="text"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  placeholder="New staff name"
                  aria-label="New staff name"
                  className="h-11 min-w-0 flex-1 bg-transparent text-[17px] text-ink focus:outline-none"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={newStaffPin}
                  onChange={(e) => setNewStaffPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="PIN"
                  aria-label="4-digit PIN"
                  className="tabular-nums h-11 w-16 rounded-[10px] bg-surface-muted text-center text-[17px] font-semibold tracking-widest text-ink focus:outline-none focus:ring-2 focus:ring-brand"
                />
                <Button type="submit" variant="plain" disabled={addingStaff} className="h-11 px-3">
                  Add
                </Button>
              </form>
            </Group>
          </section>
        </div>

        <div className="space-y-10">
          <div className="space-y-5">
            <section>
              <GroupLabel>Labels</GroupLabel>
              <Group className="divide-y divide-hairline">
                <div className={rowClass}>
                  <span className="flex flex-col">
                    <span className="text-[17px] text-ink">One sticker per parcel</span>
                    <span className="text-[13px] text-ink-3">
                      {data?.settings.customWaybillEnabled
                        ? "On: shop's label as is, never split · big orders get a packing slip"
                        : "Off: prints the shop's label as it is"}
                    </span>
                  </span>
                  <Switch
                    checked={Boolean(data?.settings.customWaybillEnabled)}
                    onChange={setCustomWaybill}
                    label="One sticker per parcel"
                  />
                </div>
              </Group>
            </section>

            <PrinterSettings />
          </div>

          <div className="space-y-5">
            <section>
              <GroupLabel>Telegram summary at 8 PM</GroupLabel>
              <Group className="divide-y divide-hairline">
                <label className={rowClass}>
                  <span className="shrink-0 text-[17px] text-ink">Chat ID</span>
                  <input
                    type="text"
                    form={SETTINGS_FORM_ID}
                    inputMode="numeric"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="Send /start to the bot"
                    className="tabular-nums min-w-0 flex-1 bg-transparent text-right text-[17px] text-ink focus:outline-none"
                  />
                </label>
                <button type="button" onClick={handleGeneratePairCode} className={`${rowLinkClass} w-full text-left`}>
                  <span className="text-[17px] text-brand">Link Telegram with 1-time code</span>
                </button>
                {pairCode && (
                  <div className="space-y-1 bg-brand-soft px-4 py-3">
                    <p className="text-[14px] text-ink-2">Send this to your Kyna Ops Telegram bot within 10 minutes:</p>
                    <code className="block select-all font-mono text-[15px] font-bold text-ink">/start {pairCode}</code>
                  </div>
                )}
                <label className={rowClass}>
                  <span className="text-[17px] text-ink">Send the summary at</span>
                  <input
                    type="time"
                    form={SETTINGS_FORM_ID}
                    aria-label="Daily summary time (Manila)"
                    value={briefTime}
                    onChange={(e) => setBriefTime(e.target.value)}
                    className="tabular-nums h-11 rounded-lg bg-surface-muted px-2.5 text-[16px] font-semibold text-ink focus:shadow-[0_0_0_1.5px_var(--color-brand)] focus:outline-none"
                  />
                </label>
                <button type="button" onClick={handleSendTestTelegram} className={`${rowLinkClass} w-full text-left`}>
                  <span className="text-[17px] text-brand">Send a test</span>
                </button>
                <Disclosure
                  summaryClassName={rowLinkClass}
                  label={<span className="text-[17px] text-ink">Tonight&apos;s message</span>}
                  onOpenChange={(open) => {
                    if (open) void loadTelegramPreview();
                  }}
                >
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-4 pb-4 font-sans text-[15px] leading-relaxed text-ink-2">
                    {loadingPreview
                      ? "Loading preview…"
                      : telegramPreview || "No preview available."}
                  </pre>
                </Disclosure>
              </Group>
            </section>

            <section>
              <GroupLabel>Chats</GroupLabel>
              <Group className="divide-y divide-hairline">
                <Link href="/settings/assistant" className={rowLinkClass}>
                  <span className="text-[17px] text-ink">Chats assistant</span>
                  <ChevronRight className="chevron-nudge h-5 w-5 text-ink-3" />
                </Link>
              </Group>
            </section>
          </div>

          <div className="space-y-5">
            <section>
              <GroupLabel>Appearance</GroupLabel>
              <Group className="space-y-3.5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex flex-col">
                    <span className="text-[17px] text-ink">Dark mode</span>
                    <span className="text-[13px] text-ink-3">{THEME_HINT[preference]}</span>
                  </span>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-brand">
                    <ThemeIcon key={preference} className="anim-pop h-[18px] w-[18px]" strokeWidth={2.2} />
                  </span>
                </div>
                <SegmentedControl
                  label="Theme"
                  options={THEME_OPTIONS}
                  value={preference}
                  onChange={setPreference}
                />
                <div className="flex items-center justify-between gap-3 border-t border-hairline pt-3.5">
                  <span className="flex flex-col">
                    <span className="text-[17px] text-ink">Background color</span>
                    <span className="text-[13px] text-ink-3">Soft shop colors behind the cards</span>
                  </span>
                  <Switch
                    label="Background color"
                    checked={ambient === "on"}
                    onChange={(next) => setAmbient(next ? "on" : "off")}
                  />
                </div>
              </Group>
            </section>

            <section>
              <GroupLabel>Health</GroupLabel>
              <HealthPanel />
            </section>
          </div>

          <div className="space-y-5">
            {data?.hasDemoData && (
              <Group>
                <button
                  type="button"
                  disabled={clearingDemo}
                  onClick={handleClearDemo}
                  className={`${rowLinkClass} w-full disabled:opacity-50`}
                >
                  <span className="text-[17px] text-missing-ink">
                    {clearingDemo ? "Clearing sample data…" : "Clear sample data"}
                  </span>
                </button>
              </Group>
            )}

            <section>
              <GroupLabel>Your account</GroupLabel>
              <Group className="divide-y divide-hairline">
                <button type="button" onClick={() => setAccountOpen(true)} className={`${rowLinkClass} w-full text-left`}>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[17px] text-ink">Email &amp; password</span>
                    {data?.owner?.email && <span className="truncate text-[13px] text-ink-3">{data.owner.email}</span>}
                  </span>
                  <ChevronRight className="chevron-nudge h-5 w-5 shrink-0 text-ink-3" />
                </button>
                <button type="button" onClick={handleLogout} className={`${rowLinkClass} w-full`}>
                  <span className="text-[17px] text-missing">Sign out</span>
                </button>
              </Group>
            </section>
          </div>
        </div>
      </div>

      {dirty && (
        <div className="anim-rise-in sticky bottom-[calc(env(safe-area-inset-bottom)+76px)] z-20 mt-8 lg:bottom-4 lg:mx-auto lg:max-w-md">
          <div className="flex items-center gap-2 rounded-[var(--radius-card)] bg-surface p-2 shadow-[var(--shadow-sheet)]">
            <span className="flex-1 px-2 text-[15px] font-semibold text-ink-2">Unsaved changes</span>
            <Button type="button" variant="plain" onClick={() => void loadSettings()} disabled={saving}>
              Undo
            </Button>
            <Button type="submit" form={SETTINGS_FORM_ID} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      {loadError && !data && (
        <div className="mt-6 space-y-3 text-center">
          <p className="text-[16px] text-ink-2">Couldn&apos;t load settings.</p>
          <Button variant="secondary" onClick={() => void loadSettings()}>
            Try again
          </Button>
        </div>
      )}

      <StaffSheet
        staff={data?.staff.find((s) => s.id === staffOpen) ?? null}
        onClose={() => setStaffOpen(null)}
        onSaved={() => void loadSettings()}
      />
      <AccountSheet
        open={accountOpen}
        email={data?.owner?.email ?? ""}
        onClose={() => setAccountOpen(false)}
        onSaved={() => void loadSettings()}
      />
      {confirmSheet}
    </AppShell>
  );
}
