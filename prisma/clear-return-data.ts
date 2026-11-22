/**
 * Deletes demo and imported return data so real API data starts clean.
 * Removes: demo ReturnParcels (with their ReturnEvents and PhysicalScans),
 * every ImportJob, and demo ShopConnections. Keeps real shop data, owner, staff and settings.
 *
 * Usage: npm run db:clear-returns -- --yes
 * Pass --all to also delete real-shop ReturnParcels.
 * Back up the database first if it is not a local one.
 */
import { PrismaClient } from "@prisma/client";

function describeTarget(): string {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`; // never print credentials
  } catch {
    return "(unknown database)";
  }
}

async function main() {
  // Construct first: Prisma Client loads .env, which describeTarget() reads.
  const prisma = new PrismaClient();
  const target = describeTarget();
  const clearAll = process.argv.includes("--all");
  if (!process.argv.includes("--yes")) {
    console.log(
      `This will delete ${clearAll ? "ALL" : "demo"} return parcels, imports and demo shops in: ${target}`
    );
    console.log("Re-run with --yes to confirm:  npm run db:clear-returns -- --yes");
    await prisma.$disconnect();
    process.exit(1);
  }

  try {
    const result = await prisma.$transaction([
      prisma.returnParcel.deleteMany(
        clearAll ? {} : { where: { shopConnection: { isDemo: true } } }
      ),
      prisma.importJob.deleteMany({}),
      prisma.shopConnection.deleteMany({ where: { isDemo: true } }),
    ]);
    console.log(
      `Cleared ${target}: ${result[0].count} parcels, ${result[1].count} imports, ${result[2].count} demo shops.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
