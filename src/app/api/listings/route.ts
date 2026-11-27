import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromSession } from "@/lib/audit";
import { getOwnerSession } from "@/lib/auth";
import {
  listUnifiedListings,
  proposeCopyListing,
  proposePriceChange,
  retryPriceChange,
} from "@/lib/listings/service";
import { createAndPublishItem, retryItemPublish } from "@/lib/listings/create-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("proposePrice"),
    garmentId: z.string().min(1).max(64),
    garmentVariantId: z.string().min(1).max(64).nullish(),
    newPricePhp: z.number().min(1).max(100_000),
  }),
  z.object({
    action: z.literal("retryPrice"),
    priceChangeId: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("proposeCopy"),
    sourceChannelProductId: z.string().min(1).max(64),
    targetShopConnectionId: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(255),
    description: z.string().max(3000).default(""),
    categoryId: z.string().trim().min(1).max(64),
    pricePhp: z.number().min(1).max(100_000),
    variants: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(60),
          pricePhp: z.number().min(1).max(100_000),
          stock: z.number().int().min(0).max(100_000),
        })
      )
      .min(1)
      .max(50),
  }),
  z.object({
    action: z.literal("createItem"),
    title: z.string().trim().min(1).max(255),
    description: z.string().max(3000).optional().default(""),
    publishMode: z.enum(["DRAFT", "LIVE"]).default("DRAFT"),
    imageUrls: z.array(z.string().min(1).max(500)).max(9).default([]),
    weightKg: z.number().min(0.01).max(50).optional().nullable(),
    dimensionsCm: z
      .object({
        length: z.number().min(1).max(300),
        width: z.number().min(1).max(300),
        height: z.number().min(1).max(300),
      })
      .optional()
      .nullable(),
    unitCostPhp: z.number().min(0).max(100_000).optional().nullable(),
    safetyBuffer: z.number().int().min(0).max(10_000).optional().nullable(),
    binLocation: z.string().max(40).optional().nullable(),
    tiers: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(30),
          options: z.array(z.string().trim().min(1).max(40)).min(1).max(50),
        })
      )
      .max(2)
      .default([]),
    variants: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(80),
          tierValues: z.array(z.string().trim().min(1).max(40)).max(2).default([]),
          pricePhp: z.number().min(1).max(100_000),
          stock: z.number().int().min(0).max(100_000),
          skuCode: z.string().max(50).optional().nullable(),
        })
      )
      .min(1)
      .max(50),
    targets: z
      .array(
        z.object({
          shopConnectionId: z.string().min(1).max(64),
          platform: z.enum(["SHOPEE", "TIKTOK"]),
          categoryId: z.string().trim().min(1).max(64),
          categoryName: z.string().max(120).optional().nullable(),
        })
      )
      .max(10)
      .default([]),
  }),
  z.object({
    action: z.literal("retryPublish"),
    itemPublishId: z.string().min(1).max(64),
    categoryId: z.string().trim().min(1).max(64).optional(),
    categoryName: z.string().max(120).optional().nullable(),
    publishMode: z.enum(["DRAFT", "LIVE"]).optional(),
  }),
]);

export async function GET() {
  if (!(await getOwnerSession())) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  const data = await listUnifiedListings();
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const session = await getOwnerSession();
  if (!session) {
    return NextResponse.json({ error: "Owner sign-in required." }, { status: 401 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 }
    );
  }

  const actor = actorFromSession(session);
  const d = parsed.data;
  try {
    switch (d.action) {
      case "proposePrice": {
        const res = await proposePriceChange(
          {
            garmentId: d.garmentId,
            garmentVariantId: d.garmentVariantId ?? null,
            newPricePhp: d.newPricePhp,
          },
          actor
        );
        return NextResponse.json({ ok: true, ...res }, { status: 201 });
      }
      case "retryPrice": {
        const change = await retryPriceChange(d.priceChangeId, actor);
        return NextResponse.json({ ok: true, change });
      }
      case "proposeCopy": {
        const res = await proposeCopyListing(d, actor);
        return NextResponse.json({ ok: true, ...res }, { status: 201 });
      }
      case "createItem": {
        const { action: _a, ...rest } = d;
        void _a;
        const res = await createAndPublishItem(rest, actor);
        return NextResponse.json({ ok: true, ...res }, { status: 201 });
      }
      case "retryPublish": {
        const result = await retryItemPublish(
          d.itemPublishId,
          {
            categoryId: d.categoryId,
            categoryName: d.categoryName,
            publishMode: d.publishMode,
          },
          actor
        );
        return NextResponse.json({ ok: true, result });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't save.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
