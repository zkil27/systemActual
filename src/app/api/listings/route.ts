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

export const dynamic = "force-dynamic";

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
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't save.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
