// Amazon Creators API configuration. Server-only: read from the environment and validated here —
// never sent to the browser, never logged, never stored in the database.

import { env } from "../../env";
import { IntegrationNotConfiguredError } from "../../errors";
import { AMAZON_MARKETPLACES, type AmazonMarketplace } from "./marketplaces";

/** The version Amazon issues with the credentials picks the OAuth flow (2.x Cognito, 3.x Login with Amazon) and region. */
export const CREDENTIAL_VERSIONS = {
  "2.1": { region: "NA", flow: "cognito", tokenUrl: "https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token" },
  "2.2": { region: "EU", flow: "cognito", tokenUrl: "https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token" },
  "2.3": { region: "FE", flow: "cognito", tokenUrl: "https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token" },
  "3.1": { region: "NA", flow: "lwa", tokenUrl: "https://api.amazon.com/auth/o2/token" },
  "3.2": { region: "EU", flow: "lwa", tokenUrl: "https://api.amazon.co.uk/auth/o2/token" },
  "3.3": { region: "FE", flow: "lwa", tokenUrl: "https://api.amazon.co.jp/auth/o2/token" },
} as const satisfies Record<string, { region: "NA" | "EU" | "FE"; flow: "cognito" | "lwa"; tokenUrl: string }>;
export type CredentialVersion = keyof typeof CREDENTIAL_VERSIONS;

export const AMAZON_ENV_VARS = ["AMAZON_CREATORS_CREDENTIAL_ID", "AMAZON_CREATORS_CREDENTIAL_SECRET", "AMAZON_CREATORS_CREDENTIAL_VERSION", "AMAZON_PARTNER_TAG"] as const;

export interface AmazonConfig {
  credentialId: string;
  credentialSecret: string;
  version: CredentialVersion;
  partnerTag: string;
  marketplace: AmazonMarketplace;
}

export interface AmazonConfigStatus {
  configured: boolean;
  marketplace: string;
  missing: string[];
  problems: string[];
  warnings: string[];
}

const isVersion = (v: string): v is CredentialVersion => Object.hasOwn(CREDENTIAL_VERSIONS, v);

/** What is missing or wrong, by variable NAME only — values never appear in the result. */
export function amazonConfigStatus(): AmazonConfigStatus {
  const e = env();
  const values: Record<(typeof AMAZON_ENV_VARS)[number], string> = {
    AMAZON_CREATORS_CREDENTIAL_ID: e.AMAZON_CREATORS_CREDENTIAL_ID,
    AMAZON_CREATORS_CREDENTIAL_SECRET: e.AMAZON_CREATORS_CREDENTIAL_SECRET,
    AMAZON_CREATORS_CREDENTIAL_VERSION: e.AMAZON_CREATORS_CREDENTIAL_VERSION,
    AMAZON_PARTNER_TAG: e.AMAZON_PARTNER_TAG,
  };
  const missing = AMAZON_ENV_VARS.filter((k) => !values[k].trim());
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const k of AMAZON_ENV_VARS) if (values[k] && values[k].trim() !== values[k]) problems.push(`${k} has leading or trailing whitespace`);
  const marketplace = AMAZON_MARKETPLACES[e.AMAZON_MARKETPLACE];
  if (!marketplace) problems.push(`AMAZON_MARKETPLACE "${e.AMAZON_MARKETPLACE}" is not supported (supported: ${Object.keys(AMAZON_MARKETPLACES).join(", ")})`);
  const version = values.AMAZON_CREATORS_CREDENTIAL_VERSION.trim();
  if (version && !isVersion(version)) problems.push(`AMAZON_CREATORS_CREDENTIAL_VERSION must be one of ${Object.keys(CREDENTIAL_VERSIONS).join(", ")} — use the version Amazon shows with your credentials`);
  if (version && isVersion(version) && marketplace && CREDENTIAL_VERSIONS[version].region !== marketplace.region) {
    warnings.push(`Credential version ${version} is for the ${CREDENTIAL_VERSIONS[version].region} region, but ${marketplace.name} is expected in ${marketplace.region}`);
  }
  const tag = values.AMAZON_PARTNER_TAG.trim();
  if (tag && !/^[A-Za-z0-9][A-Za-z0-9-]{0,62}-\d{2}$/.test(tag)) problems.push("AMAZON_PARTNER_TAG does not look like an Associates tracking tag (for example yourtag-21)");
  else if (tag && marketplace && !tag.endsWith(marketplace.tagSuffix)) warnings.push(`Associates tags for ${marketplace.name} usually end in ${marketplace.tagSuffix} — check the tag belongs to this marketplace`);
  return { configured: !missing.length && !problems.length, marketplace: e.AMAZON_MARKETPLACE, missing, problems, warnings };
}

/** Validated configuration, or IntegrationNotConfiguredError naming exactly what to fix. */
export function amazonConfig(marketplaceId?: string): AmazonConfig {
  const e = env();
  const s = amazonConfigStatus();
  const requirements = [...s.missing.map((k) => `${k} is not set`), ...s.problems];
  if (marketplaceId && marketplaceId !== e.AMAZON_MARKETPLACE) {
    requirements.push(`The Associates tag is configured for ${e.AMAZON_MARKETPLACE}; ${marketplaceId} needs its own Associates account, tag and AMAZON_MARKETPLACE`);
  }
  if (requirements.length) throw new IntegrationNotConfiguredError("Amazon Creators API", requirements);
  return {
    credentialId: e.AMAZON_CREATORS_CREDENTIAL_ID,
    credentialSecret: e.AMAZON_CREATORS_CREDENTIAL_SECRET,
    version: e.AMAZON_CREATORS_CREDENTIAL_VERSION.trim() as CredentialVersion,
    partnerTag: e.AMAZON_PARTNER_TAG.trim(),
    marketplace: AMAZON_MARKETPLACES[e.AMAZON_MARKETPLACE],
  };
}
