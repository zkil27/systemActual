import { Platform, PrismaClient } from "@prisma/client";
import { syncOrders } from "../src/lib/ledger/sync";
(async () => {
  const p = new PrismaClient();
  for (let i = 0; i < 80; i++) {
    const s = (await p.shopConnection.findFirst({ where: { platform: Platform.TIKTOK, isDemo: false } }))!;
    const t = Date.now();
    const r = await syncOrders(s, Date.now() + 45_000);
    const after = (await p.shopConnection.findUnique({ where: { id: s.id } }))!;
    console.log(`pass ${i + 1}: saved=${r.saved} ${Math.round((Date.now() - t) / 1000)}s caughtUp=${r.caughtUp} cursor=${after.ordersSyncedTo?.toISOString()}`);
    if (r.caughtUp) break;
  }
  console.log("AWAITING_SHIPMENT in DB now:", await p.order.count({ where: { platform: Platform.TIKTOK, status: "AWAITING_SHIPMENT" } }));
  console.log("DONE");
  await p.$disconnect();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
