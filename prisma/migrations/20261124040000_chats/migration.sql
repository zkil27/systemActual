-- CreateEnum
CREATE TYPE "ChatSender" AS ENUM ('BUYER', 'SELLER');

-- CreateEnum
CREATE TYPE "ChatMessageKind" AS ENUM ('TEXT', 'IMAGE', 'ORDER_CARD', 'PRODUCT_CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "ChatMessageStatus" AS ENUM ('SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "shopConnectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerAvatarUrl" TEXT,
    "orderSn" TEXT,
    "sampleOrder" JSONB,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "lastMessagePreview" TEXT NOT NULL DEFAULT '',
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalId" TEXT,
    "sender" "ChatSender" NOT NULL,
    "kind" "ChatMessageKind" NOT NULL,
    "text" TEXT,
    "imageUrl" TEXT,
    "cardData" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "status" "ChatMessageStatus" NOT NULL DEFAULT 'SENT',
    "clientKey" TEXT,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatConversation_platform_lastMessageAt_idx" ON "ChatConversation"("platform", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatConversation_shopConnectionId_externalId_key" ON "ChatConversation"("shopConnectionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_clientKey_key" ON "ChatMessage"("clientKey");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_sentAt_idx" ON "ChatMessage"("conversationId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_conversationId_externalId_key" ON "ChatMessage"("conversationId", "externalId");

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_shopConnectionId_fkey" FOREIGN KEY ("shopConnectionId") REFERENCES "ShopConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
