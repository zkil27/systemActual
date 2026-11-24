import { DisputeStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDailyTruthReport } from "@/lib/analytics/daily-returns";
import { getHealthSummary } from "@/lib/health";
import { lookupOrders, MIN_QUERY_LENGTH } from "@/lib/orders/lookup";
import { formatTelegramDailyBrief } from "@/lib/reports/brief";
import { urgentDeadlineWhere } from "@/lib/returns/rules";
import { getRealShopWhere } from "@/lib/shops";
import { formatManilaDateTime, getManilaDayBounds, getManilaTodayStr } from "@/lib/time";

/** "/order 2611ABC" → { cmd: "order", arg: "2611ABC" }. Handles "/order@KynaBot x". */
export function parseCommand(raw: string): { cmd: string; arg: string } | null {
  const m = /^\/([a-z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(raw.trim());
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), arg: (m[2] ?? "").trim() };
}

export const HELP_TEXT = [
  `KYNA OPS COMMANDS`,
  `/today — money, shipping, stock & returns`,
  `/7days — the same for the last 7 days`,
  `/ship — ready to ship & printer`,
  `/order <order #, tracking # or item> — find an order`,
  `/missing — returned to seller, not scanned`,
  `/overdue — failed deliveries stuck too long`,
  `/disputes — deadlines and open disputes`,
  `/stock — low & out of stock`,
  `/money — money credited today`,
  `/staff — who scanned and packed today`,
  `/health — sync, printer and backup status`,
  `/pause · /resume — stop or restart printing`,
  `/aioff · /aion — stop or restart the chats assistant`,
  `/sync — sync both shops now`,
].join("\n");

const peso = (n: number) => `PHP ${Math.round(n).toLocaleString("en-PH")}`;

async function orderReply(q: string): Promise<string> {
  if (q.length < MIN_QUERY_LENGTH) return `Send /order followed by an order number, tracking number or item name.`;
  const { orders, returnsOnly } = await lookupOrders(q, { limit: 3 });
  if (!orders.length && !returnsOnly.length) return `No order matches “${q}”.`;
  const lines: string[] = [];
  for (const o of orders) {
    lines.push(`${o.platform === "SHOPEE" ? "Shopee" : "TikTok"} ${o.orderSn} — ${o.headline.toUpperCase()}`);
    lines.push(`  ${o.lines.map((l) => `${l.quantity}× ${l.name}${l.variationName ? ` (${l.variationName})` : ""}`).join(", ")}`);
    if (o.trackingNumbers.length) lines.push(`  Tracking: ${o.trackingNumbers.join(", ")}${o.courier ? ` (${o.courier})` : ""}`);
    for (const s of o.stages.filter((s) => s.at)) {
      lines.push(`  ${s.alert ? "!" : "✓"} ${s.label}: ${formatManilaDateTime(new Date(s.at!))}${s.detail ? ` · ${s.detail}` : ""}`);
    }
    lines.push(``);
  }
  for (const r of returnsOnly.slice(0, 3)) {
    lines.push(`Return ${r.orderSn} — ${r.itemSummary} (${r.courier})`);
  }
  return lines.join("\n").trim();
}

async function healthReply(): Promise<string> {
  const h = await getHealthSummary();
  const mark = { ok: "OK", warn: "CHECK", bad: "PROBLEM" } as const;
  return [
    `SYSTEM HEALTH: ${mark[h.level]}`,
    ...h.checks.map((c) => `• ${c.label}: ${mark[c.level]} — ${c.detail}`),
  ].join("\n");
}

async function disputesReply(): Promise<string> {
  const now = new Date();
  const realShop = await getRealShopWhere();
  const since = new Date(now.getTime() - 30 * 24 * 3600_000);
  const [due, filed, won, lost] = await Promise.all([
    prisma.returnParcel.findMany({
      where: { AND: [urgentDeadlineWhere(now), realShop] },
      orderBy: { disputeDeadlineAt: "asc" },
      take: 10,
    }),
    prisma.returnParcel.findMany({
      where: { ...realShop, disputeStatus: DisputeStatus.FILED },
      orderBy: { disputeFiledAt: "asc" },
      take: 10,
    }),
    prisma.returnParcel.aggregate({
      where: { ...realShop, disputeStatus: DisputeStatus.WON, resolvedAt: { gte: since } },
      _count: { _all: true },
      _sum: { reimbursedPhp: true },
    }),
    prisma.returnParcel.count({ where: { ...realShop, disputeStatus: DisputeStatus.LOST, resolvedAt: { gte: since } } }),
  ]);
  const lines = [`DISPUTES`];
  lines.push(``, `Due within 24h (${due.length}):`);
  if (!due.length) lines.push(`• none`);
  for (const p of due) {
    lines.push(`• ${p.orderSn} — ${p.itemSummary} (${p.courier}), due ${formatManilaDateTime(p.disputeDeadlineAt)}`);
  }
  lines.push(``, `Filed, waiting for the shop (${filed.length}):`);
  if (!filed.length) lines.push(`• none`);
  for (const p of filed) {
    lines.push(`• ${p.orderSn}${p.disputeRef ? ` [${p.disputeRef}]` : ""} — filed ${formatManilaDateTime(p.disputeFiledAt)}`);
  }
  lines.push(
    ``,
    `Last 30 days: ${won._count._all} won (${peso(Number(won._sum.reimbursedPhp ?? 0))} back) · ${lost} lost`
  );
  return lines.join("\n");
}

async function staffReply(): Promise<string> {
  const { start, end } = getManilaDayBounds(getManilaTodayStr());
  const [staff, scans, packed, deliveries] = await Promise.all([
    prisma.staffMember.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, active: true, pinLockedUntil: true } }),
    prisma.physicalScan.groupBy({ by: ["staffMemberId"], where: { scannedAt: { gte: start, lt: end } }, _count: { _all: true } }),
    prisma.package.groupBy({ by: ["packedByStaffId"], where: { packedAt: { gte: start, lt: end } }, _count: { _all: true } }),
    prisma.stockMovement.groupBy({
      by: ["staffMemberId"],
      where: { reason: "SUPPLIER_IN", createdAt: { gte: start, lt: end } },
      _sum: { delta: true },
    }),
  ]);
  if (!staff.length) return `No staff yet. Add them in Settings → Warehouse staff.`;
  const scanBy = new Map(scans.map((s) => [s.staffMemberId, s._count._all]));
  const packBy = new Map(packed.map((p) => [p.packedByStaffId, p._count._all]));
  const inBy = new Map(deliveries.map((d) => [d.staffMemberId, d._sum.delta ?? 0]));
  const now = Date.now();
  return [
    `STAFF TODAY`,
    ...staff.map((s) => {
      const flags = [!s.active ? "off" : null, s.pinLockedUntil && s.pinLockedUntil.getTime() > now ? "LOCKED OUT" : null]
        .filter(Boolean)
        .join(", ");
      return `• ${s.name}${flags ? ` (${flags})` : ""}: ${scanBy.get(s.id) ?? 0} returns scanned · ${packBy.get(s.id) ?? 0} packed · ${inBy.get(s.id) ?? 0} pcs stocked in`;
    }),
  ].join("\n");
}

async function setPrintPaused(paused: boolean): Promise<string> {
  const res = await prisma.printDevice.updateMany({ data: { paused } });
  if (!res.count) return `No printer PC is set up yet.`;
  return paused
    ? `PRINTING PAUSED. Labels stay in the queue. Send /resume to start again.`
    : `PRINTING RESUMED. The PC picks up queued labels within a minute.`;
}

async function setAssistant(on: boolean): Promise<string> {
  const { setAiEnabled } = await import("@/lib/ai/settings-store");
  await setAiEnabled(on);
  return on
    ? "Chats assistant is ON. It writes reply drafts in Chats (auto-replies only go to test chats)."
    : "Chats assistant is OFF. No drafts or automatic replies until you send /aion.";
}

/**
 * Commands added for owner ops. Returns null when the text isn't one of them,
 * so the older keyword router handles it.
 */
export async function buildOpsCommandReply(raw: string): Promise<string | null> {
  const parsed = parseCommand(raw);
  if (!parsed) return null;
  switch (parsed.cmd) {
    case "help":
      return HELP_TEXT;
    case "order":
    case "find":
      return orderReply(parsed.arg);
    case "health":
    case "status":
      return healthReply();
    case "disputes":
    case "dispute":
      return disputesReply();
    case "staff":
      return staffReply();
    case "7days":
    case "week":
      return formatTelegramDailyBrief(await getDailyTruthReport({ range: "7days" }));
    case "pause":
      return setPrintPaused(true);
    case "resume":
      return setPrintPaused(false);
    case "aioff":
      return setAssistant(false);
    case "aion":
      return setAssistant(true);
    default:
      return null;
  }
}
