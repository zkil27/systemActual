"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Monitor, Moon, Sun } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button, Group } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { toast } from "@/components/ui/Toast";
import { formatManilaDateTime } from "@/lib/time";
import { useTheme, type ThemePreference } from "@/lib/ui/theme";
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
  settings: {
    defaultUnitCostPhp: number;
    defaultSellingPrice: number;
    overdueRtsDays: number;
    returnShippingEstimatePhp: number;
    stockSafetyBuffer: number;
    telegramChatId: string;
    telegramDailyBriefUtc: string;
    missingSinceDate: string;
    customWaybillEnabled: boolean;
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
    tokenExpiresAt: string | null;
    needsReconnect: boolean;
    writesEnabled: boolean;
  }>;
  telegramPreview?: string;
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
  const ThemeIcon = preference === "dark" ? Moon : preference === "system" ? Monitor : Sun;
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [unitCost, setUnitCost] = useState("82");
  const [sellingPrice, setSellingPrice] = useState("199");
  const [overdueDays, setOverdueDays] = useState("10");
  const [returnShipping, setReturnShipping] = useState("40");
  const [stockBuffer, setStockBuffer] = useState("0");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [missingSinceDate, setMissingSinceDate] = useState("");
  const [resettingMissing, setResettingMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffPin, setNewStaffPin] = useState("");
  const [addingStaff, setAddingStaff] = useState(false);
  const [telegramPreview, setTelegramPreview] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

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
    const res = await fetch("/api/settings");
    if (res.ok) {
      const payload: SettingsPayload = await res.json();
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
      missingSinceDate !== (data.settings.missingSinceDate ?? ""));

  async function setShopWrites(shopConnectionId: string, label: string, active: boolean) {
    if (
      active &&
      !window.confirm(
        `Let Kyna Ops update ${label}? It will sync stock, ship orders, and print labels automatically.`
      )
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
      !window.confirm(
        "Start fresh from today? Older returns stay saved in the database, but Today, 7 Days, Missing, and Overdue will only count from today onward."
      )
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

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const shopee = data?.shops.find((s) => s.platform === "SHOPEE" && !s.isDemo);
  const tiktok = data?.shops.find((s) => s.platform === "TIKTOK" && !s.isDemo);

  return (
    <AppShell title="Settings" width="wide">
      <div className="space-y-8 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8 lg:space-y-0">
        <div className="space-y-8">
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
                return (
                  <a key={row.label} href={row.href} className={rowLinkClass}>
                    <span className="flex flex-col">
                      <span className="text-[17px] text-ink">{row.label}</span>
                      {detail && <span className="text-[13px] text-ink-3">{detail}</span>}
                    </span>
                    <span
                      className={`flex items-center gap-1 text-[16px] ${
                        row.shop?.needsReconnect ? "font-semibold text-missing-ink" : "text-ink-3"
                      }`}
                    >
                      {storeStatus(row.shop, Boolean(row.keys))}
                      <ChevronRight className="chevron-nudge h-5 w-5" />
                    </span>
                  </a>
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
            </Group>
            <Group className="mt-4 divide-y divide-hairline lg:hidden">
              <Link href="/items" className={rowLinkClass}>
                <span className="text-[17px] text-ink">Items &amp; stock</span>
                <ChevronRight className="chevron-nudge h-5 w-5 text-ink-3" />
              </Link>
              <Link href="/waves" className={rowLinkClass}>
                <span className="text-[17px] text-ink">Waves &amp; pick lists</span>
                <ChevronRight className="chevron-nudge h-5 w-5 text-ink-3" />
              </Link>
              <Link href="/imports" className={rowLinkClass}>
                <span className="text-[17px] text-ink">Upload a file</span>
                <ChevronRight className="chevron-nudge h-5 w-5 text-ink-3" />
              </Link>
            </Group>
          </section>

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
            </Group>
          </section>

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

        <div className="space-y-8">
          <form onSubmit={saveGeneral} className="space-y-8">
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
                <label className="flex min-h-[64px] items-center justify-between gap-4 px-4 py-2.5">
                  <span className="flex flex-col">
                    <span className="text-[17px] text-ink">Track returns from</span>
                    <span className="text-[13px] text-ink-3">
                      Older returns stay saved in history, hidden from Today &amp; Missing
                    </span>
                  </span>
                  <input
                    type="date"
                    aria-label="Track returns from"
                    value={missingSinceDate}
                    onChange={(e) => setMissingSinceDate(e.target.value)}
                    className="tabular-nums h-9 rounded-lg bg-surface-muted px-2.5 text-[15px] font-semibold text-ink focus:shadow-[0_0_0_1.5px_var(--color-brand)] focus:outline-none"
                  />
                </label>
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

            <section>
              <GroupLabel>Telegram summary at 8 PM</GroupLabel>
              <Group className="divide-y divide-hairline">
                <label className={rowClass}>
                  <span className="shrink-0 text-[17px] text-ink">Chat ID</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="Send /start to the bot"
                    className="tabular-nums min-w-0 flex-1 bg-transparent text-right text-[17px] text-ink focus:outline-none"
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

            {dirty && (
              <Button type="submit" full disabled={saving} className="anim-rise-in">
                {saving ? "Saving…" : "Save changes"}
              </Button>
            )}
          </form>

          <section>
            <GroupLabel>Warehouse staff</GroupLabel>
            <Group className="divide-y divide-hairline">
              {(data?.staff ?? []).map((s) => (
                <div key={s.id} className={rowClass}>
                  <span className={`text-[17px] ${s.active ? "text-ink" : "text-ink-3"}`}>{s.name}</span>
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

          <Group>
            <button type="button" onClick={handleLogout} className={`${rowLinkClass} w-full`}>
              <span className="text-[17px] text-missing">Sign out</span>
            </button>
          </Group>
        </div>
      </div>
    </AppShell>
  );
}
