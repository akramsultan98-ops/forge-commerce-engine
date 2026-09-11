import { isDemoMode } from "./env";
import { DemoModeBlockedError } from "./errors";
import { logger } from "./logging/logger";

/**
 * Single choke point for every outbound side effect (emails, Telegram, social posts,
 * Shopify writes, orders, paid API calls). In DEMO_MODE these are hard-blocked.
 */
export function assertOutboundAllowed(action: string) {
  if (isDemoMode()) {
    logger.info("demo mode blocked outbound action", { action });
    throw new DemoModeBlockedError(action);
  }
}

export function outboundAllowed(): boolean {
  return !isDemoMode();
}
