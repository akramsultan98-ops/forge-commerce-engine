import { apiRoute } from "@/server/auth/api";
import { affiliateProviderStatus } from "@/server/services/affiliate-products";

export const dynamic = "force-dynamic";

/** GET /api/v1/affiliate/providers — which networks are configured, what is missing (variable names only), marketplaces. */
export const GET = apiRoute({ permission: "affiliate:read" }, async () => ({ providers: affiliateProviderStatus() }));
