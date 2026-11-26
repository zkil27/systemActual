import { PrintJobStatus, WaveItemStatus, WaveStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCatalog } from "@/lib/catalog/garments";
import { isOnline } from "@/lib/print/device";
import { getOverduePurchaseOrders } from "@/lib/restock/service";
import { urgentDeadlineWhere } from "@/lib/returns/rules";
import { unpickedPrintedWhere } from "@/lib/shipping/outbound";
import { getRealShopWhere } from "@/lib/shops";
import { hasActivePushSubscriptions } from "@/lib/push";
import { notifyOwnerTelegram } from "@/lib/telegram";
import { formatManilaDateTime } from "@/lib/time";

/** The whole alert check runs at most this often (it reads the catalog). */
export const ALERTS_EVERY_MS = 5 * 60_000;
const RUN_KEY = "alerts:last-run";

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * One alert "episode": while `active`, say it once (again after `repeatAfterMs`
 * if it's still true); once it's no longer true, forget it so the next episode
 * alerts again. Items are keyed one by one (per variant / parcel) so a list
 * alert only ever mentions the new ones.
 */
export interface AlertSpec {
  key: string;
  active: boolean;
  message: string;
  repeatAfterMs?: number;
}

export interface AlertPlan {
  send: AlertSpec[];
  clear: string[];
}

/** Pure: which alerts to send now and which finished episodes to forget. */
export function planAlerts(
  specs: AlertSpec[],
  sent: Map<string, Date>,
  now: Date,
  /** Keys owned by this run (prefixes). Logged keys under them that no spec mentions are cleared. */
  ownedPrefixes: string[] = []
): AlertPlan {
  const send: AlertSpec[] = [];
  const clear: string[] = [];
  const mentioned = new Set(specs.map((s) => s.key));
  for (const s of specs) {
    const at = sent.get(s.key);
    if (s.active) {
      const due = !at || (s.repeatAfterMs !== undefined && now.getTime() - at.getTime() >= s.repeatAfterMs);
      if (due) send.push(s);
    } else if (at) {
      clear.push(s.key);
    }
  }
  for (const key of sent.keys()) {
    if (!mentioned.has(key) && ownedPrefixes.some((p) => key.startsWith(p))) clear.push(key);
  }
  return { send, clear };
}

/** Group per-item keys into one message: "OUT OF STOCK (3): a, b, c". */
export function listMessage(title: string, items: string[], max = 10): string {
  const shown = items.slice(0, max).map((i) => `• ${i}`);
  return [`${title} (${items.length})`, ...shown, ...(items.length > max ? [`…and ${items.length - max} more`] : [])].join("\n");
}

async function collectSpecs(now: Date): Promise<{ specs: AlertSpec[]; batches: Array<{ title: string; keys: string[]; labels: string[]; footer?: string }> }> {
  const specs: AlertSpec[] = [];
  const [device, queued, runningWaves, failedJobs, unpicked, realShop, connectedPlatforms] = await Promise.all([
    prisma.printDevice.findFirst({ orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } } }),
    prisma.printJob.count({ where: { status: { in: [PrintJobStatus.QUEUED, PrintJobStatus.PRINTING] } } }),
    prisma.wave.findMany({ where: { status: WaveStatus.RUNNING }, select: { id: true, parcelCount: true, startedAt: true } }),
    prisma.printJob.findMany({
      where: { status: PrintJobStatus.FAILED, createdAt: { gte: new Date(now.getTime() - 30 * MIN) } },
      select: { title: true, error: true },
      take: 5,
    }),
    prisma.waveItem.count({ where: unpickedPrintedWhere(now) }),
    getRealShopWhere(),
    prisma.shopConnection
      .findMany({ where: { isDemo: false, accessToken: { not: null } }, select: { platform: true } })
      .then((s) => new Set(s.map((x) => x.platform)).size),
  ]);

  // Printer offline while something needs printing.
  const needPrinter = queued > 0 || runningWaves.length > 0;
  const offline = device ? !isOnline(device.lastSeenAt, now) : false;
  specs.push({
    key: "printer:offline",
    active: Boolean(device) && offline && needPrinter,
    repeatAfterMs: HOUR,
    message: `PRINTER PC OFFLINE — ${queued} label(s) waiting${runningWaves.length ? ", a wave is shipping" : ""}. Last seen ${formatManilaDateTime(device?.lastSeenAt ?? null)}. Check the warehouse PC is on and online.`,
  });

  // Printer itself in trouble (paper out, jammed, offline in Windows).
  const status = device?.printerStatus ?? "";
  const trouble = /offline|error|paper|jam|door|toner|stopped|paused/i.test(status) && !/^normal$/i.test(status);
  specs.push({
    key: "printer:status",
    active: Boolean(device) && !offline && trouble && needPrinter,
    repeatAfterMs: HOUR,
    message: `PRINTER NEEDS A HAND — Windows says “${status}”. ${queued} label(s) are held until it's fixed.`,
  });

  specs.push({
    key: "print:failed",
    active: failedJobs.length > 0,
    repeatAfterMs: 2 * HOUR,
    message: [
      `PRINT FAILED — ${failedJobs.length} job(s) in the last 30 min:`,
      ...failedJobs.map((j) => `• ${j.title}: ${j.error ?? "unknown error"}`),
      `Retry them in Settings → Printer.`,
    ].join("\n"),
  });

  // A running wave where nothing moved for 20 minutes.
  for (const w of runningWaves) {
    const [lastMove, open] = await Promise.all([
      prisma.waveItem.findFirst({ where: { waveId: w.id }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      prisma.waveItem.count({
        where: {
          waveId: w.id,
          status: { in: [WaveItemStatus.READY, WaveItemStatus.SHIPPING_ARRANGED, WaveItemStatus.TRACKING_ASSIGNED, WaveItemStatus.LABEL_READY] },
        },
      }),
    ]);
    const stalledFor = lastMove ? now.getTime() - lastMove.updatedAt.getTime() : 0;
    specs.push({
      key: `wave:stalled:${w.id}`,
      active: open > 0 && stalledFor >= 20 * MIN,
      repeatAfterMs: 2 * HOUR,
      message: `WAVE STALLED — ${open} of ${w.parcelCount} parcels haven't moved for ${Math.round(stalledFor / MIN)} min. Open Ship in Kyna Ops to retry or stop the wave.`,
    });
  }

  specs.push({
    key: "pack:unpicked",
    active: unpicked > 0,
    repeatAfterMs: 3 * HOUR,
    message: `${unpicked} PRINTED PARCEL(S) NOT PICKED UP (3h+). Check they were handed to the rider; open Ship → Handover.`,
  });

  // Per-item list alerts.
  const batches: Array<{ title: string; keys: string[]; labels: string[]; footer?: string }> = [];

  const catalog = await getCatalog();
  const outs: Array<{ key: string; label: string }> = [];
  const lows: Array<{ key: string; label: string }> = [];
  for (const g of catalog) {
    for (const v of g.variants) {
      if (v.available === null) continue;
      if (v.available === 0) outs.push({ key: `stock:out:${v.id}`, label: `${g.name} (${v.label})` });
      else if (v.available <= g.lowStockAt) lows.push({ key: `stock:low:${v.id}`, label: `${g.name} (${v.label}): ${v.available} left` });
    }
  }
  for (const o of outs) specs.push({ key: o.key, active: true, message: o.label });
  for (const l of lows) specs.push({ key: l.key, active: true, message: l.label });
  batches.push({ title: "OUT OF STOCK", keys: outs.map((o) => o.key), labels: outs.map((o) => o.label), footer: "Shops now show 0. Add a delivery in Stock-in when it arrives." });
  batches.push({ title: "LOW STOCK", keys: lows.map((l) => l.key), labels: lows.map((l) => l.label) });

  const due = await prisma.returnParcel.findMany({
    where: { AND: [urgentDeadlineWhere(now), realShop] },
    orderBy: { disputeDeadlineAt: "asc" },
    take: 30,
    select: { id: true, orderSn: true, itemSummary: true, disputeDeadlineAt: true, platform: true },
  });
  for (const p of due) {
    specs.push({
      key: `dispute:due:${p.id}`,
      active: true,
      message: `${p.platform === "SHOPEE" ? "Shopee" : "TikTok"} ${p.orderSn} — ${p.itemSummary}, due ${formatManilaDateTime(p.disputeDeadlineAt)}`,
    });
  }
  batches.push({
    title: "DISPUTE DEADLINE UNDER 24H",
    keys: due.map((p) => `dispute:due:${p.id}`),
    labels: due.map((p) => `${p.platform === "SHOPEE" ? "Shopee" : "TikTok"} ${p.orderSn} — ${p.itemSummary}, due ${formatManilaDateTime(p.disputeDeadlineAt)}`),
    footer: "Open Returns → Dispute due to file them.",
  });

  if (connectedPlatforms >= 2) {
    const fresh = catalog.filter(
      (g) => !g.archived && g.platforms.length === 1 && g.variants.some((v) => v.listings.length > 0)
    );
    // Only listings first seen in the last day are "new"; older single-shop items are already known.
    const ids = fresh.map((g) => g.id);
    const recent = ids.length
      ? await prisma.garment.findMany({
          where: { id: { in: ids }, createdAt: { gte: new Date(now.getTime() - 24 * HOUR) } },
          select: { id: true, name: true },
        })
      : [];
    for (const g of recent) specs.push({ key: `listing:unlinked:${g.id}`, active: true, message: g.name });
    batches.push({
      title: "NEW LISTING ON ONE SHOP ONLY",
      keys: recent.map((g) => `listing:unlinked:${g.id}`),
      labels: recent.map((g) => g.name),
      footer: "Link it to its twin in Items & stock so both shops share one count.",
    });
  }

  const overduePos = await getOverduePurchaseOrders(now);
  const overdueLabels = overduePos.map(
    (po) =>
      `${po.poNumber} (${po.supplierName}) — ${po.daysOverdue}d overdue (${po.remainingPieces} pcs pending)`
  );
  overduePos.forEach((po, idx) => {
    specs.push({
      key: `po:overdue:${po.id}`,
      active: true,
      message: overdueLabels[idx],
      repeatAfterMs: 24 * HOUR,
    });
  });
  batches.push({
    title: "OVERDUE SUPPLIER ORDERS",
    keys: overduePos.map((po) => `po:overdue:${po.id}`),
    labels: overdueLabels,
    footer: "Open Restock & suppliers or mark them received in Stock-in.",
  });

  return { specs, batches };
}

/** Prefixes for per-item keys: an item that drops out of the list ends its episode. */
const ITEM_PREFIXES = ["stock:out:", "stock:low:", "dispute:due:", "listing:unlinked:", "wave:stalled:", "po:overdue:"];

/**
 * Proactive owner alerts (Telegram + Web Push), deduped through AlertLog. Called
 * from the worker tick; does nothing without a linked Telegram chat or push
 * device, and at most every 5 minutes.
 */
export async function runProactiveAlerts(now: Date = new Date()): Promise<{ sent: number }> {
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" }, select: { telegramChatId: true } });
  const hasTelegram = Boolean(settings?.telegramChatId && process.env.TELEGRAM_BOT_TOKEN?.trim());
  const hasPush = await hasActivePushSubscriptions();
  if (!hasTelegram && !hasPush) return { sent: 0 };

  // Claim this 5-minute slot first so two ticks can't both alert.
  const cutoff = new Date(now.getTime() - ALERTS_EVERY_MS);
  const claimed = await prisma.alertLog.updateMany({ where: { key: RUN_KEY, sentAt: { lt: cutoff } }, data: { sentAt: now } });
  if (claimed.count === 0) {
    const exists = await prisma.alertLog.findUnique({ where: { key: RUN_KEY } });
    if (exists) return { sent: 0 };
    try {
      await prisma.alertLog.create({ data: { key: RUN_KEY, sentAt: now } });
    } catch {
      return { sent: 0 };
    }
  }

  const { specs, batches } = await collectSpecs(now);
  const logged = await prisma.alertLog.findMany({ where: { key: { not: RUN_KEY } } });
  const plan = planAlerts(
    specs,
    new Map(logged.map((l) => [l.key, l.sentAt])),
    now,
    ITEM_PREFIXES
  );

  const sendKeys = new Set(plan.send.map((s) => s.key));
  const batchedKeys = new Set(batches.flatMap((b) => b.keys));
  const messages: Array<{ text: string; keys: string[] }> = [];
  for (const s of plan.send) {
    if (!batchedKeys.has(s.key)) messages.push({ text: s.message, keys: [s.key] });
  }
  for (const b of batches) {
    const fresh = b.keys.map((k, i) => ({ k, label: b.labels[i] })).filter((x) => sendKeys.has(x.k));
    if (!fresh.length) continue;
    messages.push({
      text: [listMessage(b.title, fresh.map((f) => f.label)), b.footer].filter(Boolean).join("\n"),
      keys: fresh.map((f) => f.k),
    });
  }

  let sent = 0;
  for (const m of messages) {
    const ok = await notifyOwnerTelegram(m.text);
    if (!ok) continue; // Not logged: it'll be tried again next run.
    sent++;
    for (const key of m.keys) {
      await prisma.alertLog.upsert({
        where: { key },
        create: { key, sentAt: now, detail: m.text.slice(0, 200) },
        update: { sentAt: now, detail: m.text.slice(0, 200) },
      });
    }
  }
  if (plan.clear.length) await prisma.alertLog.deleteMany({ where: { key: { in: plan.clear } } });
  return { sent };
}
