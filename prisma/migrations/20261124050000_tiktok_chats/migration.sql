-- Real TikTok chats: bot and system senders, sync bookkeeping.
ALTER TYPE "ChatSender" ADD VALUE IF NOT EXISTS 'ROBOT';
ALTER TYPE "ChatSender" ADD VALUE IF NOT EXISTS 'SYSTEM';

ALTER TABLE "ShopConnection" ADD COLUMN IF NOT EXISTS "chatAccessAt" TIMESTAMP(3);
ALTER TABLE "ShopConnection" ADD COLUMN IF NOT EXISTS "chatsCheckedAt" TIMESTAMP(3);

ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "canReply" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ChatConversation" ADD COLUMN IF NOT EXISTS "remoteCheckedAt" TIMESTAMP(3);
