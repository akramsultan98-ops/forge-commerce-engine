// Badges for network listings (affiliate_products) in the admin.

import { Archive, BadgeCheck, CircleX, Eye, Globe, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AffiliateProductStatus } from "@/lib/constants";
import { Badge, type Tone } from "./ui";

const STATUS: Record<AffiliateProductStatus, { tone: Tone; icon: LucideIcon; label: string }> = {
  DISCOVERED: { tone: "neutral", icon: Sparkles, label: "Discovered" },
  REVIEW: { tone: "info", icon: Eye, label: "In review" },
  APPROVED: { tone: "info", icon: BadgeCheck, label: "Approved" },
  PUBLISHED: { tone: "good", icon: Globe, label: "Published" },
  REJECTED: { tone: "critical", icon: CircleX, label: "Rejected" },
  ARCHIVED: { tone: "neutral", icon: Archive, label: "Archived" },
};

export const LISTING_STATUS_LABEL = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.label])) as Record<AffiliateProductStatus, string>;

export function ListingStatusBadge({ status }: { status: AffiliateProductStatus }) {
  const m = STATUS[status];
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {m.label}
    </Badge>
  );
}

export function FreshnessBadge({ fresh, ageHours, maxHours }: { fresh: boolean; ageHours: number | null; maxHours: number | null }) {
  if (ageHours === null) return <Badge tone="warning">never fetched</Badge>;
  const age = ageHours < 1 ? "< 1 h" : `${Math.round(ageHours)} h`;
  if (maxHours === null) return <Badge tone="neutral">{age} old</Badge>;
  return (
    <Badge tone={fresh ? (ageHours > maxHours * 0.8 ? "warning" : "good") : "critical"} title={`Data may be shown for at most ${maxHours} h after fetching`}>
      {fresh ? `${age} old` : `stale · ${age}`}
    </Badge>
  );
}

const AVAILABILITY: Record<string, { tone: Tone; label: string }> = {
  IN_STOCK: { tone: "good", label: "in stock" },
  OUT_OF_STOCK: { tone: "critical", label: "out of stock" },
  PREORDER: { tone: "info", label: "pre-order" },
  BACKORDER: { tone: "warning", label: "back-order" },
  UNKNOWN: { tone: "neutral", label: "unknown" },
};

export function AvailabilityBadge({ availability }: { availability: string }) {
  const m = AVAILABILITY[availability] ?? AVAILABILITY.UNKNOWN;
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
