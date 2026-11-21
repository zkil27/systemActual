import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeePostFile } from "@/lib/connectors/shopee";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { DOC_TYPE } from "./shopee-rules";
import { tiktokLabel } from "./tiktok-rules";
import { tiktokShippingDocument } from "./tiktok-engine";

/** Fetches a single merged multi-page Shopee label PDF for a batch of packages (up to 50). */
export async function fetchBatchLabelPdf(packageIds: string[]): Promise<Buffer> {
  if (!packageIds.length) throw new Error("Label batch has no parcels.");
  if (packageIds.length === 1) return fetchLabelPdf(packageIds[0]);

  const pkgs = await prisma.package.findMany({
    where: { id: { in: packageIds } },
    include: { order: { include: { shopConnection: true } } },
  });
  const byId = new Map(pkgs.map((p) => [p.id, p]));
  const ordered = packageIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (!ordered.length) throw new Error("These parcels are no longer in the system.");

  const shop = ordered[0].order.shopConnection;
  if (shop.platform !== Platform.SHOPEE) {
    return fetchLabelPdf(ordered[0].id);
  }
  const token = await ensureFreshToken(shop);
  return shopeePostFile("/api/v2/logistics/download_shipping_document", shop.shopId, token, {
    shipping_document_type: DOC_TYPE,
    order_list: ordered.map((pkg) => ({
      order_sn: pkg.order.orderSn,
      package_number: pkg.packageNumber,
    })),
  });
}

/** The shop's own label PDF, fetched when the PC prints it (never stored). */
export async function fetchLabelPdf(packageId: string): Promise<Buffer> {
  const pkg = await prisma.package.findUnique({
    where: { id: packageId },
    include: { order: { include: { shopConnection: true } } },
  });
  if (!pkg) throw new Error("This parcel is no longer in the system.");
  const shop = pkg.order.shopConnection;
  const token = await ensureFreshToken(shop);

  if (shop.platform === Platform.SHOPEE) {
    return shopeePostFile("/api/v2/logistics/download_shipping_document", shop.shopId, token, {
      shipping_document_type: DOC_TYPE,
      order_list: [{ order_sn: pkg.order.orderSn, package_number: pkg.packageNumber }],
    });
  }

  // TikTok: ask for a fresh label URL (they expire after 24 h), then download it.
  const { url } = tiktokLabel(await tiktokShippingDocument(shop, token, pkg.packageNumber));
  if (!url) throw new Error("TikTok didn't return a label.");
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "follow" });
  if (!res.ok) throw new Error(`Couldn't download the TikTok label (${res.status})`);
  const pdf = Buffer.from(await res.arrayBuffer());
  if (pdf.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error("TikTok's label wasn't a PDF.");
  return pdf;
}
