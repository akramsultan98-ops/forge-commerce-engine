import { redirect } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { getDb } from "@/server/db/client";
import { countUsers } from "@/server/auth/core";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { Field, Input } from "@/components/admin/ui";
import { setupAction } from "../actions/auth";

export const metadata = { title: "Set up FORGE" };

export default async function SetupPage() {
  if ((await countUsers(getDb())) > 0) redirect("/admin/login");
  const { t } = await getI18n();
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <p className="mb-10 text-center text-lg font-semibold tracking-[0.3em] text-fog">FORGE</p>
        <div className="rounded-xl border border-edge bg-panel p-7">
          <h1 className="text-lg font-semibold text-fog">{t("admin.setup.title")}</h1>
          <p className="mb-6 mt-1 text-sm text-haze">{t("admin.setup.sub")}</p>
          <ActionForm action={setupAction} className="space-y-4" refresh={false}>
            <Field label={t("admin.setup.name")} htmlFor="name">
              <Input id="name" name="name" autoComplete="name" required maxLength={120} />
            </Field>
            <Field label={t("admin.login.email")} htmlFor="email">
              <Input id="email" name="email" type="email" autoComplete="username" required />
            </Field>
            <Field label={t("admin.login.password")} htmlFor="password" hint="At least 10 characters. Stored as a salted scrypt hash.">
              <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
            </Field>
            <SubmitButton className="w-full">{t("admin.setup.submit")}</SubmitButton>
          </ActionForm>
        </div>
      </div>
    </main>
  );
}
