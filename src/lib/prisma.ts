import { PrismaClient } from "@prisma/client";

const SCHEMA_VERSION = "2026-11-27-developer-tools";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaVersion?: string;
};

function createClient(): PrismaClient {
  if (typeof window !== "undefined") {
    return {} as PrismaClient;
  }

  const opts = {
    log: (process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]) as Array<
      "error" | "warn"
    >,
  };

  if (
    process.env.NODE_ENV !== "production" &&
    globalForPrisma.prisma &&
    (globalForPrisma.prismaSchemaVersion !== SCHEMA_VERSION ||
      !("priceChange" in globalForPrisma.prisma) ||
      !("channelProduct" in globalForPrisma.prisma) ||
      !("appError" in globalForPrisma.prisma))
  ) {
    void globalForPrisma.prisma.$disconnect().catch(() => {});
    try {
      const getBuiltin = (
        process as unknown as {
          getBuiltinModule?: (id: string) => {
            createRequire?: (filename: string) => NodeRequire;
            join?: (...parts: string[]) => string;
          };
        }
      ).getBuiltinModule;
      const modBuiltin = getBuiltin?.("module");
      const pathBuiltin = getBuiltin?.("path");
      if (modBuiltin?.createRequire && pathBuiltin?.join) {
        const nodeRequire = modBuiltin.createRequire(
          pathBuiltin.join(process.cwd(), "package.json")
        );
        for (const key of Object.keys(nodeRequire.cache ?? {})) {
          if (
            key.includes(".prisma") ||
            (key.includes("@prisma") && !key.includes("runtime"))
          ) {
            delete nodeRequire.cache[key];
          }
        }
        const fresh = nodeRequire("@prisma/client") as {
          PrismaClient: typeof PrismaClient;
        };
        return new fresh.PrismaClient(opts);
      }
    } catch {
      // Fallback to standard constructor
    }
    return new PrismaClient(opts);
  }

  return globalForPrisma.prisma ?? new PrismaClient(opts);
}

export const prisma = createClient();

if (process.env.NODE_ENV !== "production" && typeof window === "undefined") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaSchemaVersion = SCHEMA_VERSION;
}
