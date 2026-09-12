"use client";

import { useEffect, useRef } from "react";

/**
 * A real supplier/merchant image layered over the product illustration. If it fails to load —
 * before or after hydration — it hides itself, so the illustration shows instead of a broken image.
 */
export function ProductPhoto({ src, eager }: { src: string; eager?: boolean }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) img.hidden = true;
  }, []);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- supplier CDNs vary; the CSP governs allowed hosts
    <img
      ref={ref}
      src={src}
      alt=""
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={(e) => {
        e.currentTarget.hidden = true;
      }}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}
