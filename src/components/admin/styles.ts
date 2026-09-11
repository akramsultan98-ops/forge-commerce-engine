import { cn } from "@/lib/utils";

export type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
export type BtnSize = "sm" | "md";

export function btn(variant: BtnVariant = "secondary", size: BtnSize = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors whitespace-nowrap select-none",
    "disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
    variant === "primary" && "bg-fog text-night hover:bg-white",
    variant === "secondary" && "border border-edge-2 bg-panel-2 text-fog hover:bg-panel-3",
    variant === "ghost" && "text-haze hover:bg-panel-2 hover:text-fog",
    variant === "danger" && "border border-critical/60 text-fog hover:bg-critical/15",
    variant === "accent" && "bg-s1 text-white hover:bg-[#4a95ee]",
  );
}

export const inputCls =
  "h-9 w-full rounded-md border border-edge-2 bg-night px-3 text-sm text-fog placeholder:text-dim outline-none transition-colors focus:border-s1 focus:ring-1 focus:ring-s1 disabled:opacity-60";
export const textareaCls =
  "w-full rounded-md border border-edge-2 bg-night px-3 py-2 text-sm text-fog placeholder:text-dim outline-none transition-colors focus:border-s1 focus:ring-1 focus:ring-s1";
export const labelCls = "mb-1.5 block text-xs font-medium text-haze";
