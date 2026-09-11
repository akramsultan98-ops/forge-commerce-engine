import type { Metadata, Viewport } from "next";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "./globals.css";
import { getI18n } from "@/i18n/server";
import { env } from "@/server/env";

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(env().APP_URL),
    title: { default: "FORGE — Products worth discovering", template: "%s — FORGE" },
    description: "FORGE finds products gaining momentum before they become impossible to ignore.",
    applicationName: "FORGE",
    openGraph: { type: "website", siteName: "FORGE", title: "FORGE — Products worth discovering", description: "FORGE finds products gaining momentum before they become impossible to ignore." },
    twitter: { card: "summary_large_image", title: "FORGE — Products worth discovering" },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  themeColor: "#0c0c0c",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dir } = await getI18n();
  return (
    <html lang={locale} dir={dir}>
      <body>{children}</body>
    </html>
  );
}
