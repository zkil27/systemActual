-- CreateEnum
CREATE TYPE "ChatDraftStatus" AS ENUM ('PENDING', 'USED', 'DISMISSED', 'SENT', 'EXPIRED');

-- AlterTable
ALTER TABLE "ChatConversation" ADD COLUMN     "aiPausedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "topicModes" JSONB NOT NULL DEFAULT '{}',
    "autoLabel" TEXT NOT NULL DEFAULT '(Auto-reply)',
    "handoverText" TEXT NOT NULL DEFAULT 'Salamat po! Our team will reply shortly.',
    "eveningReservePct" INTEGER NOT NULL DEFAULT 15,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopAnswer" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "previousAnswer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEvent" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "decision" TEXT NOT NULL,
    "intent" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "latencyMs" INTEGER,
    "blockedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatDraft" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "basedOnMessageId" TEXT,
    "status" "ChatDraftStatus" NOT NULL DEFAULT 'PENDING',
    "rating" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopAnswer_topic_active_idx" ON "ShopAnswer"("topic", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsage_provider_model_dayKey_key" ON "AiUsage"("provider", "model", "dayKey");

-- CreateIndex
CREATE INDEX "AiEvent_createdAt_idx" ON "AiEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AiEvent_conversationId_createdAt_idx" ON "AiEvent"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatDraft_conversationId_status_idx" ON "ChatDraft"("conversationId", "status");

-- CreateIndex
CREATE INDEX "ChatDraft_createdAt_idx" ON "ChatDraft"("createdAt");

-- AddForeignKey
ALTER TABLE "ChatDraft" ADD CONSTRAINT "ChatDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
