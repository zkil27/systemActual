import { WaveItemStatus, WaveStatus } from "@prisma/client";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { prisma } from "@/lib/prisma";
import { isAwaitingRiderPickup, isOrderCancelledForPacking } from "@/lib/shipping/outbound";
import { getManilaDateString, getManilaDayBounds } from "@/lib/time";

export interface CourierHandoverSummary {
  courier: string;
  totalPrinted: number;
  packedCount: number;
  handedOverCount: number;
  awaitingPickupCount: number;
  cancelledCount: number;
  trackingNumbers: string[];
}

export async function getDailyHandoverSummary(now: Date = new Date()): Promise<CourierHandoverSummary[]> {
  const { start, end } = getManilaDayBounds(getManilaDateString(now));
  const items = await prisma.waveItem.findMany({
    where: {
      status: WaveItemStatus.PRINTED,
      wave: {
        createdAt: { gte: start, lt: end },
        status: { in: [WaveStatus.RUNNING, WaveStatus.DONE] },
      },
    },
    select: {
      package: {
        select: {
          trackingNumber: true,
          packedAt: true,
          carrier: true,
          order: {
            select: {
              orderSn: true,
              platform: true,
              status: true,
              shippedAt: true,
              cancelRequested: true,
            },
          },
        },
      },
    },
    orderBy: [{ wave: { createdAt: "asc" } }, { position: "asc" }],
  });

  const byCourier = new Map<string, CourierHandoverSummary>();
  for (const it of items) {
    const pkg = it.package;
    const courier = normalizeCourierName(pkg.carrier);
    let row = byCourier.get(courier);
    if (!row) {
      row = {
        courier,
        totalPrinted: 0,
        packedCount: 0,
        handedOverCount: 0,
        awaitingPickupCount: 0,
        cancelledCount: 0,
        trackingNumbers: [],
      };
      byCourier.set(courier, row);
    }

    row.totalPrinted += 1;
    if (pkg.packedAt) row.packedCount += 1;

    if (isOrderCancelledForPacking(pkg.order)) {
      row.cancelledCount += 1;
      continue;
    }

    row.trackingNumbers.push(pkg.trackingNumber || pkg.order.orderSn);
    if (isAwaitingRiderPickup(pkg.order)) {
      row.awaitingPickupCount += 1;
    } else {
      row.handedOverCount += 1;
    }
  }

  return [...byCourier.values()].sort(
    (a, b) => b.totalPrinted - a.totalPrinted || a.courier.localeCompare(b.courier)
  );
}

const LINE_CHARS = 44;
const LINES_PER_PAGE = 25;

function fit(s: string, max = LINE_CHARS) {
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

/** Formats a 4×6 thermal Rider Handover Manifest for one courier. */
export function buildHandoverManifestLines(
  summary: CourierHandoverSummary,
  dateLabel: string
): string[][] {
  const validTotal = Math.max(0, summary.totalPrinted - summary.cancelledCount);
  const lines: string[] = [
    "============================================",
    "          RIDER HANDOVER MANIFEST",
    "============================================",
    fit(`Store: Kyna Clothing Shop`),
    fit(`Date: ${dateLabel}`),
    fit(`Courier: ${summary.courier.toUpperCase()}`),
    fit(`Total parcels: ${validTotal} (${summary.packedCount} packed)`),
    ...(summary.cancelledCount > 0
      ? [fit(`Cancelled excluded: ${summary.cancelledCount}`)]
      : []),
    "--------------------------------------------",
  ];

  if (summary.trackingNumbers.length === 0) {
    lines.push("No active printed parcels.");
  } else {
    for (let i = 0; i < summary.trackingNumbers.length; i += 2) {
      const left = `${i + 1}. ${summary.trackingNumbers[i]}`.slice(0, 21).padEnd(22, " ");
      const right = summary.trackingNumbers[i + 1]
        ? `${i + 2}. ${summary.trackingNumbers[i + 1]}`.slice(0, 21)
        : "";
      lines.push(fit(`${left}${right}`.trimEnd()));
    }
  }

  lines.push(
    "--------------------------------------------",
    "Rider Name: ________________________________",
    "Signature:  ________________________________",
    "Time / Date: _______________________________"
  );

  const body = LINES_PER_PAGE - 1;
  const count = Math.max(1, Math.ceil(lines.length / body));
  return Array.from({ length: count }, (_, i) => [
    `Page ${i + 1}/${count}`,
    ...lines.slice(i * body, (i + 1) * body),
  ]);
}
