import type { AffiliateProvider } from "./types";
import { amazonProvider } from "./amazon/provider";

/** Every network FORGE can fetch from. Adding a network = implement AffiliateProvider and list it here. */
export const AFFILIATE_PROVIDERS: AffiliateProvider[] = [amazonProvider];

export function getAffiliateProvider(network: string): AffiliateProvider | null {
  return AFFILIATE_PROVIDERS.find((p) => p.network === network) ?? null;
}
