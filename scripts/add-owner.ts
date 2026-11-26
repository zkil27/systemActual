/**
 * Adds a separate owner account (e.g. for the developer), without touching
 * the existing ones. The password is typed in hidden and never printed.
 *
 *   npm run owner:add -- you@example.com "Your Name"
 *
 * Uses DATABASE_URL from .env, which is the live database. To use the
 * account for /dev, also list its email in DEVELOPER_EMAILS.
 */
import { createInterface } from "node:readline";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    out._writeToOutput = (s: string) => {
      if (!prompted) {
        out.output.write(s);
        prompted = true;
      } else if (s.includes("\n")) {
        out.output.write("\n");
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const [rawEmail, ...nameParts] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  const name = nameParts.join(" ").trim() || "Developer";
  if (!email || !email.includes("@")) {
    console.error('Usage: npm run owner:add -- you@example.com "Your Name"');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    if (await prisma.ownerUser.findUnique({ where: { email } })) {
      console.error(`An owner account for ${email} already exists. Nothing changed.`);
      process.exit(1);
    }
    const password = await askHidden("New password (8+ characters): ");
    if (password.length < 8 || password.length > 200) {
      console.error("Password must be 8 to 200 characters. Nothing changed.");
      process.exit(1);
    }
    const again = await askHidden("Type it again: ");
    if (again !== password) {
      console.error("Passwords don't match. Nothing changed.");
      process.exit(1);
    }
    // Same hashing as the app's owner sign-in (hashSecret in src/lib/auth.ts).
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.ownerUser.create({ data: { email, name, passwordHash } });
    console.log(`Added owner account ${email} (${name}). Sign in at /login with it.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
