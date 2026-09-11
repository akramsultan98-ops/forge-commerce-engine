import Link from "next/link";
import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { getDb } from "@/server/db/client";
import { countUsers } from "@/server/auth/core";
import { getSession } from "@/server/auth/session";
import { isDemoMode } from "@/server/env";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { Field, Input } from "@/components/admin/ui";
import { loginAction } from "../actions/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) redirect("/admin/dashboard");
  if ((await countUsers(getDb())) === 0) redirect("/admin/setup");
  const { t } = await getI18n();
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-10 block text-center text-lg font-semibold tracking-[0.3em] text-fog">
          FORGE
        </Link>
        <div className="rounded-xl border border-edge bg-panel p-7">
          <h1 className="mb-6 text-lg font-semibold text-fog">{t("admin.login.title")}</h1>
          <ActionForm action={loginAction} className="space-y-4" refresh={false}>
            <input type="hidden" name="next" value={next ?? ""} />
            <Field label={t("admin.login.email")} htmlFor="email">
              <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
            </Field>
            <Field label={t("admin.login.password")} htmlFor="password">
              <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={10} />
            </Field>
            <SubmitButton className="w-full">{t("admin.login.submit")}</SubmitButton>
          </ActionForm>
        </div>
        {isDemoMode() && <p className="mt-4 text-center text-[11px] text-dim">DEMO_MODE is on. Create an admin with <code className="text-haze">npm run admin:create</code>.</p>}
      </div>
    </main>
  );
}
