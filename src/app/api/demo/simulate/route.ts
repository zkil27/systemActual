import { NextResponse } from "next/server";
import { generateDemoDayData } from "@/lib/demo-simulator";
import { generateDemoChats } from "@/lib/demo-chats";

export async function POST() {
  try {
    const { createdCount } = await generateDemoDayData();
    await generateDemoChats();
    return NextResponse.json({
      ok: true,
      message: `Loaded ${createdCount} realistic kynaph return parcels for Today, Yesterday, and Overdue.`,
      createdCount,
    });
  } catch (err) {
    console.error("[Demo simulate error]", err);
    return NextResponse.json({ error: "Could not load sample data." }, { status: 500 });
  }
}
