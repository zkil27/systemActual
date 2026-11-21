import { getScannerSession } from "@/lib/auth";
import { StockInClient } from "./StockInClient";

export const dynamic = "force-dynamic";

export default async function StockInPage() {
  const session = await getScannerSession();
  return <StockInClient initialUnlocked={Boolean(session)} />;
}
