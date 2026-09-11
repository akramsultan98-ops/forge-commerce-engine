// Product imagery. Real supplier/merchant images when available; otherwise an editorial
// "catalogue plate" (never a stock photo that misrepresents the product).

import type { LucideIcon } from "lucide-react";
import { Box, Car, CookingPot, Laptop, PawPrint, Tent } from "lucide-react";
import { cn, hashString } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = { CookingPot, Laptop, Car, PawPrint, Tent };
const TONES = ["#e8e4da", "#dedad0", "#e5ded3", "#d9ddd5", "#e2e0da", "#dde0e2", "#e9e1d6"];

export function ProductVisual({
  title,
  slug,
  imageUrl,
  categoryName,
  categoryIcon,
  index,
  className,
  size = "lg",
  eager,
}: {
  title: string;
  slug: string;
  imageUrl?: string | null;
  categoryName?: string | null;
  categoryIcon?: string | null;
  index?: number;
  className?: string;
  size?: "sm" | "md" | "lg";
  eager?: boolean;
}) {
  if (imageUrl) {
    return (
      <div className={cn("relative overflow-hidden bg-paper-2", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- supplier CDNs vary; CSP + remotePatterns govern hosts */}
        <img src={imageUrl} alt={title} loading={eager ? "eager" : "lazy"} decoding="async" className="h-full w-full object-cover" />
      </div>
    );
  }
  const h = hashString(slug);
  const tone = TONES[h % TONES.length];
  const Icon = (categoryIcon && ICONS[categoryIcon]) || Box;
  const n = String(index ?? (h % 97) + 1).padStart(3, "0");
  return (
    <div
      role="img"
      aria-label={`${title} — illustration`}
      className={cn("relative overflow-hidden text-ink", className)}
      style={{ background: `radial-gradient(120% 90% at 28% 18%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 58%), ${tone}` }}
    >
      <div className="absolute inset-0 grid place-items-center">
        <Icon aria-hidden strokeWidth={size === "sm" ? 1.25 : 0.6} className={cn("text-ink/75", size === "sm" ? "h-1/2 w-1/2" : "h-[46%] w-[46%]")} />
      </div>
      {size !== "sm" && (
        <>
          <span className="absolute start-4 top-4 font-mono text-[10px] tracking-[0.2em] text-ink/55">N° {n}</span>
          <span className="absolute inset-x-4 bottom-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-ink/55">
            <span className="truncate">{categoryName ?? "FORGE"}</span>
            <span>FORGE</span>
          </span>
        </>
      )}
    </div>
  );
}
