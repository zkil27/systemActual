import type { AiSettings, ShopAnswer } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  AI_TOPIC_IDS,
  cleanTopicModes,
  topicMode,
  type AiMode,
  type AiSettingsInput,
  type AiTopic,
  type ShopAnswerInput,
} from "./settings";

const ID = "default";

export interface AiSettingsView {
  enabled: boolean;
  topicModes: Record<AiTopic, AiMode>;
  autoLabel: string;
  handoverText: string;
  eveningReservePct: number;
  updatedAt: string | null;
}

export function toSettingsView(row: AiSettings | null): AiSettingsView {
  const modes = {} as Record<AiTopic, AiMode>;
  for (const t of AI_TOPIC_IDS) modes[t] = topicMode(row?.topicModes, t);
  return {
    enabled: row?.enabled ?? false,
    topicModes: modes,
    autoLabel: row?.autoLabel ?? "(Auto-reply)",
    handoverText: row?.handoverText ?? "Salamat po! Our team will reply shortly.",
    eveningReservePct: row?.eveningReservePct ?? 15,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

/** Always read fresh (no cache): the on/off switch must stop sends right away. */
export async function getAiSettings(): Promise<AiSettingsView> {
  return toSettingsView(await prisma.aiSettings.findUnique({ where: { id: ID } }));
}

export async function updateAiSettings(input: AiSettingsInput): Promise<AiSettingsView> {
  const current = await prisma.aiSettings.findUnique({ where: { id: ID } });
  const data = {
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.topicModes ? { topicModes: cleanTopicModes(input.topicModes, current?.topicModes) } : {}),
    ...(input.autoLabel !== undefined ? { autoLabel: input.autoLabel } : {}),
    ...(input.handoverText !== undefined ? { handoverText: input.handoverText } : {}),
    ...(input.eveningReservePct !== undefined ? { eveningReservePct: input.eveningReservePct } : {}),
  };
  const row = await prisma.aiSettings.upsert({ where: { id: ID }, create: { id: ID, ...data }, update: data });
  return toSettingsView(row);
}

export async function setAiEnabled(enabled: boolean): Promise<AiSettingsView> {
  return updateAiSettings({ enabled });
}

export interface ShopAnswerView {
  id: string;
  topic: string;
  title: string;
  answer: string;
  active: boolean;
  canUndo: boolean;
  updatedAt: string;
}

function toAnswerView(a: ShopAnswer): ShopAnswerView {
  return {
    id: a.id,
    topic: a.topic,
    title: a.title,
    answer: a.answer,
    active: a.active,
    canUndo: Boolean(a.previousAnswer),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export async function listShopAnswers(): Promise<ShopAnswerView[]> {
  const rows = await prisma.shopAnswer.findMany({ orderBy: [{ topic: "asc" }, { title: "asc" }] });
  return rows.map(toAnswerView);
}

/** Active answers for some topics, for the assistant's prompt and templates. */
export async function activeShopAnswers(topics?: string[]): Promise<Array<{ topic: string; title: string; answer: string }>> {
  return prisma.shopAnswer.findMany({
    where: { active: true, ...(topics ? { topic: { in: topics } } : {}) },
    select: { topic: true, title: true, answer: true },
    orderBy: { title: "asc" },
  });
}

export async function saveShopAnswer(input: ShopAnswerInput): Promise<ShopAnswerView> {
  if (input.id) {
    const before = await prisma.shopAnswer.findUnique({ where: { id: input.id } });
    if (!before) throw new Error("Answer not found.");
    const row = await prisma.shopAnswer.update({
      where: { id: input.id },
      data: {
        topic: input.topic,
        title: input.title,
        answer: input.answer,
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(before.answer !== input.answer ? { previousAnswer: before.answer } : {}),
      },
    });
    return toAnswerView(row);
  }
  const row = await prisma.shopAnswer.create({
    data: { topic: input.topic, title: input.title, answer: input.answer, active: input.active ?? true },
  });
  return toAnswerView(row);
}

/** Puts back the answer from before the last edit. */
export async function undoShopAnswer(id: string): Promise<ShopAnswerView> {
  const row = await prisma.shopAnswer.findUnique({ where: { id } });
  if (!row?.previousAnswer) throw new Error("Nothing to undo.");
  const back = await prisma.shopAnswer.update({
    where: { id },
    data: { answer: row.previousAnswer, previousAnswer: row.answer },
  });
  return toAnswerView(back);
}

export async function deleteShopAnswer(id: string): Promise<void> {
  await prisma.shopAnswer.deleteMany({ where: { id } });
}
