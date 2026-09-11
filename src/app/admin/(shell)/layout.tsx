import Link from "next/link";
import { headers } from "next/headers";
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  BookOpen,
  Bot,
  CalendarDays,
  ChartColumn,
  Clapperboard,
  Coins,
  Compass,
  Database,
  FlaskConical,
  LayoutDashboard,
  Link2,
  ListChecks,
  LogOut,
  Megaphone,
  Menu,
  Package,
  PanelsTopLeft,
  ScrollText,
  Settings,
  ShoppingBag,
  Split,
  Store,
  Terminal,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getI18n } from "@/i18n/server";
import { pageContext } from "@/server/auth/session";
import { isDemoMode } from "@/server/env";
import { unreadCount } from "@/server/services/notifications";
import { logoutAction } from "../actions/auth";

type NavItem = { href: string; key: string; icon: LucideIcon; exact?: boolean };
const GROUPS: Array<{ key: string; items: NavItem[] }> = [
  {
    key: "groupOverview",
    items: [
      { href: "/admin/dashboard", key: "dashboard", icon: LayoutDashboard },
      { href: "/admin/command", key: "command", icon: Terminal },
      { href: "/admin/reports", key: "reports", icon: ListChecks },
      { href: "/admin/notifications", key: "notifications", icon: Bell },
    ],
  },
  {
    key: "groupCatalog",
    items: [
      { href: "/admin/products", key: "products", icon: Package, exact: true },
      { href: "/admin/products/discover", key: "discover", icon: Compass },
      { href: "/admin/products/testing", key: "testing", icon: FlaskConical },
      { href: "/admin/products/winners", key: "winners", icon: Trophy },
    ],
  },
  {
    key: "groupGrowth",
    items: [
      { href: "/admin/landing-pages", key: "landing", icon: PanelsTopLeft },
      { href: "/admin/content", key: "content", icon: Clapperboard, exact: true },
      { href: "/admin/content/calendar", key: "calendar", icon: CalendarDays },
      { href: "/admin/guides", key: "guides", icon: BookOpen },
      { href: "/admin/campaigns", key: "campaigns", icon: Megaphone },
      { href: "/admin/experiments", key: "experiments", icon: Split },
    ],
  },
  {
    key: "groupMoney",
    items: [
      { href: "/admin/analytics", key: "analytics", icon: ChartColumn },
      { href: "/admin/affiliate-networks", key: "affiliate", icon: Link2 },
      { href: "/admin/shopify", key: "shopify", icon: ShoppingBag },
      { href: "/admin/sources", key: "sources", icon: Database },
    ],
  },
  {
    key: "groupSystem",
    items: [
      { href: "/admin/agents", key: "agents", icon: Bot },
      { href: "/admin/ai-usage", key: "aiUsage", icon: Coins },
      { href: "/admin/logs", key: "logs", icon: ScrollText },
      { href: "/admin/settings", key: "settings", icon: Settings },
    ],
  },
];

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href || (pathname.startsWith(`${item.href}/`) && !GROUPS.some((g) => g.items.some((i) => i !== item && i.href.startsWith(item.href) && pathname.startsWith(i.href))));
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavList({ pathname, t }: { pathname: string; t: (k: string) => string }) {
  return (
    <nav aria-label="Command center" className="space-y-6">
      {GROUPS.map((g) => (
        <div key={g.key}>
          <p className="eyebrow mb-2 px-3 text-dim">{t(`admin.nav.${g.key}`)}</p>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn("flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition-colors", active ? "bg-panel-2 text-fog" : "text-haze hover:bg-panel hover:text-fog")}
                  >
                    <Icon aria-hidden className={cn("h-4 w-4", active ? "text-fog" : "text-dim")} strokeWidth={1.75} />
                    {t(`admin.nav.${item.key}`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageContext();
  const { t } = await getI18n();
  const pathname = (await headers()).get("x-pathname") ?? "";
  const unread = await unreadCount(ctx);
  const demo = isDemoMode();

  return (
    <div className="min-h-screen">
      {demo && (
        <div role="note" className="border-b border-warning/25 bg-[#2a2210] px-4 py-1.5 text-center text-[11px] text-haze">
          <span aria-hidden className="me-2 inline-block h-1.5 w-1.5 rounded-full bg-warning align-middle" />
          {t("admin.demoBanner")}
        </div>
      )}
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-e border-edge lg:flex">
          <div className="flex h-14 items-center gap-2 border-b border-edge px-5">
            <Link href="/admin/dashboard" className="text-[15px] font-semibold tracking-[0.22em] text-fog">
              FORGE
            </Link>
            <span className="eyebrow text-dim">OS</span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-5 scrollbar-thin">
            <NavList pathname={pathname} t={t} />
          </div>
          <div className="border-t border-edge p-3">
            <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] text-fog">{ctx.user.name}</p>
                <p className="truncate text-[11px] text-dim">
                  {ctx.user.email} · {ctx.user.role}
                </p>
              </div>
              <form action={logoutAction}>
                <button type="submit" title={t("admin.nav.signOut")} className="rounded p-1.5 text-dim hover:bg-panel-2 hover:text-fog">
                  <LogOut aria-hidden className="h-4 w-4" />
                  <span className="sr-only">{t("admin.nav.signOut")}</span>
                </button>
              </form>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-edge bg-night/85 px-4 backdrop-blur lg:px-8">
            <details className="relative lg:hidden">
              <summary className="rounded-md p-2 text-haze hover:bg-panel-2" aria-label={t("nav.menu")}>
                <Menu aria-hidden className="h-5 w-5" />
              </summary>
              <div className="absolute start-0 top-11 z-40 max-h-[80vh] w-64 overflow-y-auto rounded-lg border border-edge bg-panel p-3 shadow-2xl">
                <NavList pathname={pathname} t={t} />
              </div>
            </details>
            <Link href="/admin/dashboard" className="text-sm font-semibold tracking-[0.22em] text-fog lg:hidden">
              FORGE
            </Link>
            <Link href="/admin/command" className="ms-auto hidden h-8 w-72 items-center gap-2 rounded-md border border-edge-2 bg-panel px-3 text-xs text-dim hover:border-dim md:flex lg:ms-0">
              <Terminal aria-hidden className="h-3.5 w-3.5" />
              Ask FORGE… “Which product should I scale?”
            </Link>
            <div className="ms-auto flex items-center gap-1">
              <Link href="/admin/notifications" className="relative rounded-md p-2 text-haze hover:bg-panel-2 hover:text-fog" aria-label={`${t("admin.nav.notifications")}${unread ? ` (${unread} unread)` : ""}`}>
                <Bell aria-hidden className="h-4 w-4" />
                {unread > 0 && <span className="tabular absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-s1 px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>}
              </Link>
              <a href="/" target="_blank" rel="noopener" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-haze hover:bg-panel-2 hover:text-fog">
                <Store aria-hidden className="h-4 w-4" />
                <span className="hidden sm:inline">{t("admin.nav.viewStore")}</span>
              </a>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1440px] px-4 py-8 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
