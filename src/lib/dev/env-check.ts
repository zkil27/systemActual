/**
 * Which environment variables are set, by name only. Values never leave the
 * server. "required" ones break the app when missing; the rest turn a feature off.
 */

export interface EnvSpec {
  name: string;
  group: string;
  required: boolean;
  /** What stops working without it. */
  purpose: string;
}

export const ENV_SPECS: readonly EnvSpec[] = [
  { name: "DATABASE_URL", group: "Core", required: true, purpose: "Database (pooled)" },
  { name: "DIRECT_URL", group: "Core", required: true, purpose: "Database migrations" },
  { name: "AUTH_SECRET", group: "Core", required: true, purpose: "Sign-in sessions" },
  { name: "TOKEN_ENCRYPTION_KEY", group: "Core", required: false, purpose: "Own key for shop tokens (else AUTH_SECRET)" },
  { name: "APP_BASE_URL", group: "Core", required: true, purpose: "OAuth callbacks and links" },
  { name: "DEVELOPER_EMAILS", group: "Core", required: false, purpose: "Who can open this screen" },
  { name: "WORKER_SECRET", group: "Worker", required: true, purpose: "Printer PC tick calls" },
  { name: "CRON_SECRET", group: "Worker", required: false, purpose: "Vercel cron tick" },
  { name: "SHOPEE_PARTNER_ID", group: "Shopee", required: false, purpose: "Shopee API" },
  { name: "SHOPEE_PARTNER_KEY", group: "Shopee", required: false, purpose: "Shopee API signing" },
  { name: "SHOPEE_PUSH_PARTNER_KEY", group: "Shopee", required: false, purpose: "Shopee webhook signature" },
  { name: "SHOPEE_BASE_URL", group: "Shopee", required: false, purpose: "Shopee API host" },
  { name: "TIKTOK_APP_KEY", group: "TikTok", required: false, purpose: "TikTok API" },
  { name: "TIKTOK_APP_SECRET", group: "TikTok", required: false, purpose: "TikTok API signing" },
  { name: "TIKTOK_SERVICE_ID", group: "TikTok", required: false, purpose: "TikTok seller auth" },
  { name: "TIKTOK_SELLER_AUTH_URL", group: "TikTok", required: false, purpose: "TikTok seller auth link" },
  { name: "TIKTOK_AUTH_URL", group: "TikTok", required: false, purpose: "TikTok token host" },
  { name: "TIKTOK_API_BASE_URL", group: "TikTok", required: false, purpose: "TikTok API host" },
  { name: "TELEGRAM_BOT_TOKEN", group: "Telegram", required: false, purpose: "Telegram brief and alerts" },
  { name: "TELEGRAM_WEBHOOK_SECRET", group: "Telegram", required: false, purpose: "Telegram commands" },
  { name: "BLOB_READ_WRITE_TOKEN", group: "Storage", required: false, purpose: "Proof photos on Vercel Blob" },
  { name: "GROQ_API_KEY", group: "AI", required: false, purpose: "Chats assistant (Groq)" },
  { name: "CLOUDFLARE_ACCOUNT_ID", group: "AI", required: false, purpose: "Chats assistant (Cloudflare)" },
  { name: "CLOUDFLARE_AI_TOKEN", group: "AI", required: false, purpose: "Chats assistant (Cloudflare)" },
  { name: "OPENROUTER_API_KEY", group: "AI", required: false, purpose: "Chats assistant (OpenRouter)" },
  { name: "GEMINI_API_KEY", group: "AI", required: false, purpose: "Chats assistant (Gemini)" },
];

export interface EnvStatus extends EnvSpec {
  set: boolean;
}

export function checkEnv(env: Record<string, string | undefined> = process.env): EnvStatus[] {
  return ENV_SPECS.map((spec) => ({ ...spec, set: Boolean(env[spec.name]?.trim()) }));
}
