/**
 * TikTok sends buyer chat events (New conversation, New message) to the same
 * webhook as orders. They carry a conversation id and no order id.
 */
export function isChatWebhook(data: Record<string, unknown> | null | undefined): boolean {
  if (!data || typeof data !== "object") return false;
  const conv = data.conversation_id;
  const hasConversation = (typeof conv === "string" && conv.length > 0) || typeof conv === "number";
  return hasConversation && !data.order_id;
}
