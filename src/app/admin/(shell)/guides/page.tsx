import { BookOpen } from "lucide-react";
import { can } from "@/lib/rbac";
import { formatRelative } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { listArticles } from "@/server/services/articles";
import { Badge, ButtonLink, DemoTag, EmptyState, EngineBadge, Mono, PageHeader, Panel, Table, Td, Th } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { articleAction } from "../../actions/growth";

export const metadata = { title: "Guides" };

export default async function GuidesAdminPage() {
  const ctx = await pageContext("content:read");
  const articles = await listArticles(ctx);
  const canWrite = can(ctx.role, "content:write");
  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Guides & discovery articles"
        description="Round-ups, “best for” lists and comparisons generated from the catalog. Every product mention is backed by its fact sheet and honest watch-outs — no low-quality AI spam."
        actions={
          canWrite && (
            <ActionForm action={articleAction} className="inline-block">
              <input type="hidden" name="op" value="ideas" />
              <SubmitButton pendingText="Thinking…">Generate article ideas</SubmitButton>
            </ActionForm>
          )
        }
      />
      <Panel bodyClassName="p-0">
        {articles.length ? (
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>Article</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Engine</Th>
                <Th>Updated</Th>
                <Th align="end" />
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <p className="font-medium text-fog">{a.title}</p>
                    <Mono>/guides/{a.slug}</Mono> {a.isDemo && <DemoTag />}
                  </Td>
                  <Td className="text-xs">{a.type.replace("_", " ").toLowerCase()}</Td>
                  <Td>
                    <Badge tone={a.status === "PUBLISHED" ? "good" : a.status === "DRAFT" ? "info" : "neutral"}>{a.status.toLowerCase()}</Badge>
                  </Td>
                  <Td>{a.status !== "IDEA" && <EngineBadge method={a.generationMethod} />}</Td>
                  <Td className="text-xs">{formatRelative(a.updatedAt)}</Td>
                  <Td align="end">
                    <div className="flex justify-end gap-1">
                      {a.status === "PUBLISHED" && (
                        <ButtonLink href={`/guides/${a.slug}`} external size="sm" variant="ghost">
                          View
                        </ButtonLink>
                      )}
                      {canWrite && (
                        <ActionForm action={articleAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="op" value={a.status === "IDEA" ? "write" : a.status === "DRAFT" ? "publish" : "unpublish"} />
                          <SubmitButton size="sm" variant="secondary" pendingText="Working…">
                            {a.status === "IDEA" ? "Write draft" : a.status === "DRAFT" ? "Publish" : "Unpublish"}
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState icon={BookOpen} title="No guides yet">
              Generate ideas once you have approved products in a category.
            </EmptyState>
          </div>
        )}
      </Panel>
    </>
  );
}
