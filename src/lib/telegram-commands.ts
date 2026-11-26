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
  `/profit — profit this month, after shop fees and cost`,
  `/staff — who scanned and packed today`,
  `/health — sync, printer and backup status`,
  `/pause · /resume — stop or restart printing`,
  `/approvals — pending chat replies to approve`,
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

export type OpsConfirmCmd = "pause" | "aioff" | "sync";
export type OpsCallbackAction = "confirm" | "cancel" | "undo";

export function isConfirmableOpsCommand(cmd: string): cmd is OpsConfirmCmd {
  return cmd === "pause" || cmd === "aioff" || cmd === "sync";
}

export function parseOpsCallbackData(
  raw: string
): { action: OpsCallbackAction; cmd: OpsConfirmCmd } | null {
  const m = /^ops:(confirm|cancel|undo):(pause|aioff|sync)$/.exec(raw.trim());
  if (!m) return null;
  return { action: m[1] as OpsCallbackAction, cmd: m[2] as OpsConfirmCmd };
}

export function buildOpsConfirmPrompt(cmd: OpsConfirmCmd): {
  text: string;
  replyMarkup: Record<string, unknown>;
} {
  const copy: Record<OpsConfirmCmd, { text: string; confirmLabel: string }> = {
    pause: {
      text: "Pause label printing on the warehouse PC? Labels will wait in the queue until you resume.",
      confirmLabel: "Pause printing",
    },
    aioff: {
      text: "Turn off the chats assistant? No drafts or auto-replies will run until you turn it back on.",
      confirmLabel: "Turn assistant off",
    },
    sync: {
      text: "Run a manual sync for both shops right now?",
      confirmLabel: "Sync both shops",
    },
  };
  return {
    text: copy[cmd].text,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: copy[cmd].confirmLabel, callback_data: `ops:confirm:${cmd}` },
          { text: "Cancel", callback_data: `ops:cancel:${cmd}` },
        ],
      ],
    },
  };
}

async function setPrintPaused(paused: boolean): Promise<{ ok: boolean; text: string }> {
  const res = await prisma.printDevice.updateMany({ data: { paused } });
  if (!res.count) return { ok: false, text: `No printer PC is set up yet.` };
  const { recordAudit, systemActor } = await import("@/lib/audit");
  await recordAudit({
    actor: systemActor("telegram"),
    action: paused ? "printer.pause" : "printer.resume",
    entity: "PrintDevice",
    entityId: "all",
    after: { paused },
  });
  return {
    ok: true,
    text: paused
      ? `PRINTING PAUSED. Labels stay in the queue. Tap Undo below or send /resume to start again.`
      : `PRINTING RESUMED. The PC picks up queued labels within a minute.`,
  };
}

async function setAssistant(on: boolean): Promise<{ ok: boolean; text: string }> {
  const { setAiEnabled } = await import("@/lib/ai/settings-store");
  const { systemActor } = await import("@/lib/audit");
  await setAiEnabled(on, systemActor("telegram"));
  return {
    ok: true,
    text: on
      ? "Chats assistant is ON. Drafts and any auto-replies you turned on in Settings are active."
      : "Chats assistant is OFF. No drafts or automatic replies until you tap Undo below or send /aion.",
  };
}

export async function executeOpsCallback(
  action: OpsCallbackAction,
  cmd: OpsConfirmCmd
): Promise<{
  toast: string;
  text: string;
  replyMarkup?: Record<string, unknown>;
  triggerManualSync?: boolean;
}> {
  if (action === "cancel") {
    return {
      toast: "Cancelled.",
      text: "Cancelled — nothing changed.",
    };
  }
  if (cmd === "pause") {
    if (action === "confirm") {
      const res = await setPrintPaused(true);
      return {
        toast: res.ok ? "Printing paused." : res.text,
        text: res.text,
        ...(res.ok
          ? {
              replyMarkup: {
                inline_keyboard: [[{ text: "Undo — Resume printing", callback_data: "ops:undo:pause" }]],
              },
            }
          : {}),
      };
    }
    const res = await setPrintPaused(false);
    return { toast: res.ok ? "Printing resumed." : res.text, text: `Undone. ${res.text}` };
  }
  if (cmd === "aioff") {
    if (action === "confirm") {
      const res = await setAssistant(false);
      return {
        toast: "Chats assistant turned off.",
        text: res.text,
        replyMarkup: {
          inline_keyboard: [[{ text: "Undo — Turn assistant back on", callback_data: "ops:undo:aioff" }]],
        },
      };
    }
    const res = await setAssistant(true);
    return { toast: "Chats assistant turned back on.", text: `Undone. ${res.text}` };
  }
  // cmd === "sync"
  return {
    toast: "Sync started.",
    text: "Syncing both shops now. Send /today in a minute for fresh numbers.",
    triggerManualSync: action === "confirm",
  };
}

async function approvalsReply(): Promise<string> {
  const { listActionRequests } = await import("@/lib/approvals/service");
  const pending = await listActionRequests({ status: "PENDING" });
  if (!pending.length) {
    return "No pending approvals right now.";
  }
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  const lines = [
    `PENDING APPROVALS (${pending.length})`,
    ...pending.slice(0, 5).map((r) => `• ${r.title} — ${r.summary.slice(0, 120)}`),
  ];
  if (pending.length > 5) {
    lines.push(`…and ${pending.length - 5} more.`);
  }
  if (base) {
    lines.push(``, `Review in Kyna Ops: ${base}/approvals`);
  }
  return lines.join("\n");
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
      return (await setPrintPaused(true)).text;
    case "resume":
      return (await setPrintPaused(false)).text;
    case "approvals":
      return approvalsReply();
    case "aioff":
      return (await setAssistant(false)).text;
    case "aion":
      return (await setAssistant(true)).text;
    default:
      return null;
  }
}
