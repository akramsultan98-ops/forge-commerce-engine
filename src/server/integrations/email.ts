// Email delivery via Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
// Swap the provider by implementing `sendEmail` for another API — callers never change.

import { env } from "../env";
import { assertOutboundAllowed } from "../demo";
import { IntegrationNotConfiguredError } from "../errors";

export function emailConfigured(): boolean {
  const e = env();
  return e.EMAIL_PROVIDER === "resend" && !!e.EMAIL_PROVIDER_KEY && !!(e.ALERT_EMAIL_TO || e.EMAIL_FROM);
}

export async function sendEmail(msg: { to?: string; subject: string; text: string }) {
  assertOutboundAllowed("email.send");
  const e = env();
  if (!emailConfigured()) throw new IntegrationNotConfiguredError("Email", ["EMAIL_PROVIDER=resend", "EMAIL_PROVIDER_KEY", "EMAIL_FROM", "ALERT_EMAIL_TO (or Settings → Notifications)"]);
  const to = msg.to || e.ALERT_EMAIL_TO;
  if (!to) throw new IntegrationNotConfiguredError("Email", ["ALERT_EMAIL_TO"]);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${e.EMAIL_PROVIDER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: e.EMAIL_FROM, to: [to], subject: msg.subject.slice(0, 200), text: msg.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
}
