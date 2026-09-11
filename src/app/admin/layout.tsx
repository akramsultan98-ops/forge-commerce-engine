import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Command center", template: "%s · FORGE" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-night text-fog [color-scheme:dark]">{children}</div>;
}
