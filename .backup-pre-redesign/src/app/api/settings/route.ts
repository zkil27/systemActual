import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/lib/auth";
import { isShopeeConfigured } from "@/lib/connectors/shopee";
import { isTikTokConfigured } from "@/lib/connectors/tiktok";
import { getDailyTruthReport } from "@/lib/analytics/daily-returns";
import { formatTelegramDailyBrief } from "@/lib/reports/brief";
import { sendTelegramMessage } from "@/lib/telegram";

export async function GET() {
  const [settings, staff, shops, report] = await Promise.all([
    prisma.appSettings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    }),
    prisma.staffMember.findMany({
      select: { id: true, name: true, active: true, createdAt: true },
      orderBy: { name: "asc" },
    }),
    prisma.shopConnection.findMany({ orderBy: { platform: "asc" } }),
    getDailyTruthReport({ range: "today" }),
  ]);

  return NextResponse.json({
    settings: {
      defaultUnitCostPhp: Number(settings.defaultUnitCostPhp),
      defaultSellingPrice: Number(settings.defaultSellingPrice),
      overdueRtsDays: settings.overdueRtsDays,
      telegramChatId: settings.telegramChatId || "",
      telegramDailyBriefUtc: settings.telegramDailyBriefUtc,
    },
    integrations: {
      shopeeEnvReady: isShopeeConfigured(),
      tiktokEnvReady: isTikTokConfigured(),
      telegramBotReady: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    },
    staff,
    shops: shops.map((s) => ({
      id: s.id,
      platform: s.platform,
      shopId: s.shopId,
      shopName: s.shopName,
      isDemo: s.isDemo,
      connected: Boolean(s.accessToken),
      lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
    })),
    telegramPreview: formatTelegramDailyBrief(report),
  });
}

const updateSettingsSchema = z.object({
  action: z.enum(["update_settings", "add_staff", "update_staff_pin", "toggle_staff", "send_test_telegram"]),
  defaultUnitCostPhp: z.number().min(1).max(100000).optional(),
  defaultSellingPrice: z.number().min(1).max(100000).optional(),
  overdueRtsDays: z.number().int().min(1).max(60).optional(),
  telegramChatId: z.string().max(64).optional(),
  staffId: z.string().optional(),
  staffName: z.string().min(1).max(40).optional(),
  pin: z.string().regex(/^\d{4}$/).optional(),
  active: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = updateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid settings input." }, { status: 400 });
    }
    const data = parsed.data;

    if (data.action === "update_settings") {
      await prisma.appSettings.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          defaultUnitCostPhp: data.defaultUnitCostPhp ?? 82,
          defaultSellingPrice: data.defaultSellingPrice ?? 199,
          overdueRtsDays: data.overdueRtsDays ?? 10,
          telegramChatId: data.telegramChatId?.trim() || null,
        },
        update: {
          ...(data.defaultUnitCostPhp !== undefined
            ? { defaultUnitCostPhp: data.defaultUnitCostPhp }
            : {}),
          ...(data.defaultSellingPrice !== undefined
            ? { defaultSellingPrice: data.defaultSellingPrice }
            : {}),
          ...(data.overdueRtsDays !== undefined
            ? { overdueRtsDays: data.overdueRtsDays }
            : {}),
          ...(data.telegramChatId !== undefined
            ? { telegramChatId: data.telegramChatId.trim() || null }
            : {}),
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (data.action === "add_staff" && data.staffName && data.pin) {
      const pinHash = await hashSecret(data.pin);
      const member = await prisma.staffMember.create({
        data: { name: data.staffName.trim(), pinHash, active: true },
        select: { id: true, name: true, active: true },
      });
      return NextResponse.json({ ok: true, member });
    }

    if (data.action === "update_staff_pin" && data.staffId && data.pin) {
      const pinHash = await hashSecret(data.pin);
      await prisma.staffMember.update({
        where: { id: data.staffId },
        data: { pinHash },
      });
      return NextResponse.json({ ok: true });
    }

    if (data.action === "toggle_staff" && data.staffId && data.active !== undefined) {
      await prisma.staffMember.update({
        where: { id: data.staffId },
        data: { active: data.active },
      });
      return NextResponse.json({ ok: true });
    }

    if (data.action === "send_test_telegram") {
      const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
      const report = await getDailyTruthReport({ range: "today" });
      const text = formatTelegramDailyBrief(report);
      if (!settings?.telegramChatId || !process.env.TELEGRAM_BOT_TOKEN) {
        return NextResponse.json({
          ok: false,
          preview: text,
          error: "Add TELEGRAM_BOT_TOKEN in .env and save your Telegram Chat ID first.",
        });
      }
      const sent = await sendTelegramMessage(settings.telegramChatId, text);
      return NextResponse.json({ ok: sent, preview: text });
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (err) {
    console.error("[Settings update error]", err);
    return NextResponse.json({ error: "Could not save settings." }, { status: 500 });
  }
}
