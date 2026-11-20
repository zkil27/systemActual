import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generateDemoDayData } from "../src/lib/demo-simulator";

const prisma = new PrismaClient();

async function main() {
  await prisma.appSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      defaultUnitCostPhp: 82.0,
      defaultSellingPrice: 199.0,
      overdueRtsDays: 10,
    },
    update: {},
  });

  const ownerPasswordHash = await bcrypt.hash("kyna1234", 10);
  await prisma.ownerUser.upsert({
    where: { email: "owner@kynaph.com" },
    create: {
      email: "owner@kynaph.com",
      name: "Kyna Owner",
      passwordHash: ownerPasswordHash,
    },
    update: {},
  });

  const staffProfiles = [
    { name: "Ana", pin: "1111" },
    { name: "Joy", pin: "2222" },
    { name: "Mark", pin: "3333" },
    { name: "Lisa", pin: "4444" },
    { name: "Carlo", pin: "5555" },
    { name: "Mae", pin: "6666" },
  ];

  for (const s of staffProfiles) {
    const pinHash = await bcrypt.hash(s.pin, 10);
    await prisma.staffMember.upsert({
      where: { name: s.name },
      create: { name: s.name, pinHash, active: true },
      update: {},
    });
  }

  const existingParcels = await prisma.returnParcel.count();
  if (existingParcels === 0) {
    const { createdCount } = await generateDemoDayData();
    console.log(`Seeded ${createdCount} realistic kynaph return parcels.`);
  } else {
    console.log(`Skipped demo parcels (${existingParcels} already present).`);
  }

  console.log("Seed complete. Owner login: owner@kynaph.com / kyna1234");
  console.log("Staff PINs: Ana (1111), Joy (2222), Mark (3333), Lisa (4444), Carlo (5555), Mae (6666)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
