-- Phase 4: Safe chat auto-replies, Settings switches, and general Approval Queue

-- CreateEnum
CREATE TYPE "ActionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "AiSettings"
    ADD COLUMN "chatSendEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "autoSendEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "approvalQueueEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ActionRequest" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "ActionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "conversationId" TEXT,
    "proposedBy" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "resultJson" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActionRequest_dedupeKey_key" ON "ActionRequest"("dedupeKey");

-- CreateIndex
CREATE INDEX "ActionRequest_status_createdAt_idx" ON "ActionRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ActionRequest_kind_status_idx" ON "ActionRequest"("kind", "status");

-- CreateIndex
CREATE INDEX "ActionRequest_conversationId_status_idx" ON "ActionRequest"("conversationId", "status");

-- CreateIndex
CREATE INDEX "ActionRequest_expiresAt_idx" ON "ActionRequest"("expiresAt");

-- AddForeignKey
ALTER TABLE "ActionRequest" ADD CONSTRAINT "ActionRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
