// Telegram Bot API (https://core.telegram.org/bots/api#sendmessage).

import { env } from "../env";
import { assertOutboundAllowed } from "../demo";
import { IntegrationNotConfiguredError } from "../errors";

export function telegramConfigured(): boolean {
  return !!env().TELEGRAM_BOT_TOKEN && !!env().TELEGRAM_CHAT_ID;
}

export async function sendTelegram(text: string) {
  assertOutboundAllowed("telegram.send");
  if (!telegramConfigured()) throw new IntegrationNotConfiguredError("Telegram", ["TELEGRAM_BOT_TOKEN (from @BotFather)", "TELEGRAM_CHAT_ID"]);
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("TELEGRAM_BOT_TOKEN has an invalid format");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env().TELEGRAM_CHAT_ID, text: text.slice(0, 4000), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Telegram returned ${res.status}`);
}
