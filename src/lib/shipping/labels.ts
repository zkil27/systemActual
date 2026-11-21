import { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { shopeePostFile } from "@/lib/connectors/shopee";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { DOC_TYPE } from "./shopee-rules";

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
  throw new Error("TikTok labels aren't available yet.");
}
