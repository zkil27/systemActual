import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerSession, hashSecret, verifySecret } from "@/lib/auth";
import { manilaToUtcHm, utcToManilaHm } from "@/lib/reports/brief-time";
import { isShopeeConfigured } from "@/lib/connectors/shopee";
import { isTikTokConfigured } from "@/lib/connectors/tiktok";
import { getDailyTruthReport } from "@/lib/analytics/daily-returns";
import { formatTelegramDailyBrief } from "@/lib/reports/brief";
import { sendTelegramMessage } from "@/lib/telegram";
import { formatWaveScheduleSetting, isContinuousWave, parseWaveTimes } from "@/lib/waves/schedule";
import { getManilaDateString, getManilaDayBounds, getManilaTodayStr } from "@/lib/time";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("preview") === "1") {
    const report = await getDailyTruthReport({ range: "today" });
    return NextResponse.json({ telegramPreview: formatTelegramDailyBrief(report) });
  }

  const owner = await getOwnerSession();
  const [settings, staff, shops, ownerUser] = await Promise.all([
    prisma.appSettings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    }),
    prisma.staffMember.findMany({
      select: { id: true, name: true, active: true, createdAt: true, pinLockedUntil: true, failedPinAttempts: true },
      orderBy: { name: "asc" },
    }),
    prisma.shopConnection.findMany({ orderBy: { platform: "asc" } }),
    owner ? prisma.ownerUser.findUnique({ where: { id: owner.userId }, select: { email: true, name: true } }) : null,
  ]);
  const now = Date.now();

  return NextResponse.json({
    hasDemoData: shops.some((s) => s.isDemo),
    settings: {
      defaultUnitCostPhp: Number(settings.defaultUnitCostPhp),
      defaultSellingPrice: Number(settings.defaultSellingPrice),
      overdueRtsDays: settings.overdueRtsDays,
      returnShippingEstimatePhp: Number(settings.returnShippingEstimatePhp),
      stockSafetyBuffer: settings.stockSafetyBuffer,
      telegramChatId: settings.telegramChatId || "",
      telegramDailyBriefUtc: settings.telegramDailyBriefUtc,
      telegramDailyBriefManila: utcToManilaHm(settings.telegramDailyBriefUtc),
      missingSinceDate: settings.missingSinceAt ? getManilaDateString(settings.missingSinceAt) : "",
      customWaybillEnabled: settings.customWaybillEnabled,
    },
    integrations: {
      shopeeEnvReady: isShopeeConfigured(),
      tiktokEnvReady: isTikTokConfigured(),
      telegramBotReady: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    },
    owner: ownerUser,
    staff: staff.map((s) => ({
      id: s.id,
      name: s.name,
      active: s.active,
      locked: Boolean(s.pinLockedUntil && s.pinLockedUntil.getTime() > now),
      lockedUntil: s.pinLockedUntil && s.pinLockedUntil.getTime() > now ? s.pinLockedUntil.toISOString() : null,
      failedPinAttempts: s.failedPinAttempts,
    })),
    shops: shops.map((s) => ({
      id: s.id,
      platform: s.platform,
      shopId: s.shopId,
      shopName: s.shopName,
      isDemo: s.isDemo,
      connected: Boolean(s.accessToken),
      lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null,
      tokenExpiresAt: s.tokenExpiresAt?.toISOString() ?? null,
      needsReconnect: Boolean(s.tokenErrorAt),
      tokenError: s.tokenErrorAt ? s.tokenError : null,
      writesEnabled: s.writesEnabled,
    })),
  });
}

const updateSettingsSchema = z.object({
  action: z.enum([
    "update_settings",
    "reset_missing_baseline",
    "add_staff",
    "update_staff_pin",
    "toggle_staff",
    "send_test_telegram",
    "generate_telegram_pair_code",
    "clear_demo",
    "set_shop_writes",
    "rename_staff",
    "clear_staff_lockout",
    "disconnect_shop",
    "update_owner_password",
    "update_owner_email",
  ]),
  telegramDailyBriefManila: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  currentPassword: z.string().min(1).max(200).optional(),
  newPassword: z.string().min(8).max(200).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  shopConnectionId: z.string().optional(),
  stockSafetyBuffer: z.number().int().min(0).max(1000).optional(),
  waveTimes: z.string().max(120).optional(),
  wavesAutoEnabled: z.boolean().optional(),
  customWaybillEnabled: z.boolean().optional(),
  defaultUnitCostPhp: z.number().min(1).max(100000).optional(),
  defaultSellingPrice: z.number().min(1).max(100000).optional(),
  overdueRtsDays: z.number().int().min(1).max(60).optional(),
  returnShippingEstimatePhp: z.number().min(0).max(10000).optional(),
  telegramChatId: z.string().max(64).optional(),
  missingSinceDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).nullable().optional(),
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
      const missingSinceAt =
        data.missingSinceDate !== undefined
          ? data.missingSinceDate
            ? getManilaDayBounds(data.missingSinceDate).start
            : null
          : undefined;
      await prisma.appSettings.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          defaultUnitCostPhp: data.defaultUnitCostPhp ?? 82,
          defaultSellingPrice: data.defaultSellingPrice ?? 199,
          overdueRtsDays: data.overdueRtsDays ?? 10,
          returnShippingEstimatePhp: data.returnShippingEstimatePhp ?? 40,
          stockSafetyBuffer: data.stockSafetyBuffer ?? 0,
          telegramChatId: data.telegramChatId?.trim() || null,
          ...(missingSinceAt !== undefined ? { missingSinceAt } : {}),
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
          ...(data.returnShippingEstimatePhp !== undefined
            ? { returnShippingEstimatePhp: data.returnShippingEstimatePhp }
            : {}),
          ...(data.stockSafetyBuffer !== undefined ? { stockSafetyBuffer: data.stockSafetyBuffer } : {}),
          ...(data.waveTimes !== undefined
            ? {
                waveTimes: formatWaveScheduleSetting(
                  parseWaveTimes(data.waveTimes),
                  isContinuousWave(data.waveTimes)
                ),
              }
            : {}),
          ...(data.wavesAutoEnabled !== undefined ? { wavesAutoEnabled: data.wavesAutoEnabled } : {}),
          ...(data.customWaybillEnabled !== undefined
            ? { customWaybillEnabled: data.customWaybillEnabled }
            : {}),
          ...(data.telegramChatId !== undefined
            ? { telegramChatId: data.telegramChatId.trim() || null }
            : {}),
          ...(missingSinceAt !== undefined ? { missingSinceAt } : {}),
          ...(data.telegramDailyBriefManila !== undefined
            ? { telegramDailyBriefUtc: manilaToUtcHm(data.telegramDailyBriefManila) }
            : {}),
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (data.action === "rename_staff" && data.staffId && data.staffName) {
      try {
        await prisma.staffMember.update({ where: { id: data.staffId }, data: { name: data.staffName.trim() } });
      } catch {
        return NextResponse.json({ error: "That name is already used." }, { status: 409 });
      }
      return NextResponse.json({ ok: true });
    }

    if (data.action === "clear_staff_lockout" && data.staffId) {
      await prisma.staffMember.update({
        where: { id: data.staffId },
        data: { failedPinAttempts: 0, pinLockedUntil: null },
      });
      return NextResponse.json({ ok: true });
    }

    if (data.action === "disconnect_shop" && data.shopConnectionId) {
      // Keeps orders, returns and stock history; only forgets the keys and stops changes to the shop.
      await prisma.shopConnection.update({
        where: { id: data.shopConnectionId },
        data: {
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          tokenError: null,
          tokenErrorAt: null,
          writesEnabled: false,
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (data.action === "update_owner_password" || data.action === "update_owner_email") {
      const owner = await getOwnerSession();
      if (!owner) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
      const user = await prisma.ownerUser.findUnique({ where: { id: owner.userId } });
      if (!user || !data.currentPassword || !(await verifySecret(data.currentPassword, user.passwordHash))) {
        return NextResponse.json({ error: "Current password is wrong." }, { status: 403 });
      }
      if (data.action === "update_owner_password") {
        if (!data.newPassword) return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
        await prisma.ownerUser.update({
          where: { id: user.id },
          data: { passwordHash: await hashSecret(data.newPassword), failedLoginAttempts: 0, loginLockedUntil: null },
        });
        return NextResponse.json({ ok: true });
      }
      if (!data.email) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
      try {
        await prisma.ownerUser.update({ where: { id: user.id }, data: { email: data.email } });
      } catch {
        return NextResponse.json({ error: "That email is already used." }, { status: 409 });
      }
      return NextResponse.json({ ok: true, email: data.email });
    }

    if (data.action === "reset_missing_baseline") {
      const todayStr = getManilaTodayStr();
      const { start } = getManilaDayBounds(todayStr);
      await prisma.appSettings.upsert({
        where: { id: "default" },
        create: { id: "default", missingSinceAt: start },
        update: { missingSinceAt: start },
      });
      return NextResponse.json({ ok: true, missingSinceDate: todayStr });
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
        // A new PIN from the owner also clears any lockout and revokes old staff tokens.
        data: { pinHash, failedPinAttempts: 0, pinLockedUntil: null, tokenVersion: { increment: 1 } },
      });
      return NextResponse.json({ ok: true });
    }

    if (data.action === "set_shop_writes" && data.shopConnectionId && data.active !== undefined) {
      // The one switch that lets the app change a shop (stock now, shipping later). Off by default.
      await prisma.shopConnection.update({
        where: { id: data.shopConnectionId },
        data: { writesEnabled: data.active },
      });
      return NextResponse.json({ ok: true });
    }

    if (data.action === "toggle_staff" && data.staffId && data.active !== undefined) {
      await prisma.staffMember.update({
        where: { id: data.staffId },
        data: {
          active: data.active,
          ...(!data.active ? { tokenVersion: { increment: 1 } } : {}),
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (data.action === "generate_telegram_pair_code") {
      const code = crypto.randomBytes(4).toString("hex").toUpperCase();
      const expiresAt = new Date(Date.now() + 10 * 60_000);
      await prisma.workerLock.upsert({
        where: { id: "telegram-pair" },
        create: { id: "telegram-pair", lockedUntil: expiresAt, holder: code },
        update: { lockedUntil: expiresAt, holder: code },
      });
      return NextResponse.json({ ok: true, code, expiresAt: expiresAt.toISOString() });
    }

    if (data.action === "clear_demo") {
      const deleted = await prisma.shopConnection.deleteMany({ where: { isDemo: true } });
      return NextResponse.json({ ok: true, deleted: deleted.count });
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
