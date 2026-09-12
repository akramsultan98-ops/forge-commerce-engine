import Link from "next/link";
import { Link2 } from "lucide-react";
import { AFFILIATE_NETWORK_TYPES } from "@/lib/constants";
import { can } from "@/lib/rbac";
import { formatRelative } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { NETWORK_PRESETS, listLinks, listNetworks } from "@/server/services/affiliate";
import { Badge, Callout, DemoTag, EmptyState, Field, Input, Mono, PageHeader, Panel, Select, Table, Td, Th } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { enqueueJobAction } from "../../actions/products";
import { linkAction, networkAction } from "../../actions/system";

export const metadata = { title: "Affiliate networks" };

export default async function AffiliatePage() {
  const ctx = await pageContext("affiliate:read");
  const [networks, links] = await Promise.all([listNetworks(ctx), listLinks(ctx)]);
  const canWrite = can(ctx.role, "affiliate:write");
  const canManage = can(ctx.role, "integrations:manage");
  const broken = links.filter((l) => l.link.status === "BROKEN").length;

  return (
    <>
      <PageHeader
        eyebrow="Money & data"
        title="Affiliate networks & links"
        description="Every outbound click goes through a tracked /r/{code} link. Networks send conversions back through a signed postback URL, so each commission is attributed to its click, content and campaign."
        actions={
          canWrite && (
            <ActionForm action={enqueueJobAction} className="inline-block">
              <input type="hidden" name="job" value="affiliate_link_check" />
              <SubmitButton variant="secondary" pendingText="Queuing…">
                Check all links
              </SubmitButton>
            </ActionForm>
          )
        }
      />
      {broken > 0 && (
        <Callout tone="critical" className="mb-6" title={`${broken} broken link${broken > 1 ? "s" : ""}`}>
          Visitors clicking these are sent to the product page instead of the merchant. Replace or re-check them below.
        </Callout>
      )}

      <Panel title="Networks" bodyClassName="p-0">
        {networks.length ? (
          <Table minWidth={1000}>
            <thead>
              <tr>
                <Th>Network</Th>
                <Th>Status</Th>
                <Th>Sub-id parameter</Th>
                <Th align="end">Cookie</Th>
                <Th align="end">Links</Th>
                <Th>Credentials</Th>
                <Th>Postback</Th>
              </tr>
            </thead>
            <tbody>
              {networks.map((n) => (
                <tr key={n.id} className="align-top">
                  <Td>
                    <p className="text-fog">{n.name}</p>
                    <p className="text-[11px] text-dim">
                      {n.type.replace("_", " ").toLowerCase()} {n.isDemo && <DemoTag />}
                    </p>
                  </Td>
                  <Td>
                    <Badge tone={n.status === "CONNECTED" ? "good" : n.status === "DEMO" ? "warning" : n.status === "ERROR" ? "critical" : "neutral"}>{n.status.replace("_", " ").toLowerCase()}</Badge>
                  </Td>
                  <Td>
                    <Mono>{n.subIdParam ?? "—"}</Mono>
                  </Td>
                  <Td align="end">{n.defaultCookieDays ? `${n.defaultCookieDays}d` : "—"}</Td>
                  <Td align="end">{n.links}</Td>
                  <Td>
                    {canManage ? (
                      <details>
                        <summary className="text-xs text-haze hover:text-fog">{n.hasCredentials ? "Saved (encrypted) · replace" : "Add API credentials"}</summary>
                        <ActionForm action={networkAction} className="mt-2 w-64 space-y-2" resetOnSuccess>
                          <input type="hidden" name="op" value="credentials" />
                          <input type="hidden" name="id" value={n.id} />
                          <Input name="cred:accountId" placeholder="Account / publisher id" autoComplete="off" />
                          <Input name="cred:apiKey" type="password" placeholder="API key / token" autoComplete="new-password" />
                          <SubmitButton size="sm">Save encrypted</SubmitButton>
                        </ActionForm>
                      </details>
                    ) : (
                      <span className="text-xs text-dim">{n.hasCredentials ? "saved" : "none"}</span>
                    )}
                  </Td>
                  <Td className="max-w-sm">
                    {canManage ? (
                      <ActionForm action={networkAction}>
                        <input type="hidden" name="op" value="postback" />
                        <input type="hidden" name="id" value={n.id} />
                        <SubmitButton size="sm" variant="ghost" confirm={n.hasPostbackSecret ? "Rotate the postback secret? The old URL stops working immediately." : undefined}>
                          {n.hasPostbackSecret ? "Rotate postback URL" : "Generate postback URL"}
                        </SubmitButton>
                      </ActionForm>
                    ) : (
                      <span className="text-xs text-dim">{n.hasPostbackSecret ? "configured" : "not set"}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState icon={Link2} title="No networks yet" />
          </div>
        )}
      </Panel>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {canWrite && (
          <Panel title="Add a network">
            <ActionForm action={networkAction} className="grid grid-cols-2 gap-3" resetOnSuccess>
              <input type="hidden" name="op" value="create" />
              <Field label="Name" htmlFor="nname" className="col-span-2">
                <Input id="nname" name="name" required minLength={2} maxLength={80} placeholder="Impact" />
              </Field>
              <Field label="Type" htmlFor="ntype">
                <Select id="ntype" name="type" options={AFFILIATE_NETWORK_TYPES.map((t) => ({ value: t, label: t.replace("_", " ").toLowerCase() }))} />
              </Field>
              <Field label="Cookie days" htmlFor="ncookie">
                <Input id="ncookie" name="defaultCookieDays" inputMode="numeric" />
              </Field>
              <Field label="Website" htmlFor="nweb">
                <Input id="nweb" name="website" placeholder="https://…" />
              </Field>
              <Field label="Sub-id parameter (optional)" htmlFor="nsub" hint="Defaults to the network's standard parameter.">
                <Input id="nsub" name="subIdParam" placeholder="subId1" />
              </Field>
              <div className="col-span-2">
                <SubmitButton>Add network</SubmitButton>
              </div>
            </ActionForm>
          </Panel>
        )}
        <Panel title="How conversion postbacks work">
          <ol className="list-decimal space-y-2 ps-4 text-xs leading-relaxed text-haze">
            <li>A visitor clicks a tracked link. FORGE logs the click and appends its click id to the destination under the network’s sub-id parameter.</li>
            <li>When the merchant records a sale, the network calls FORGE’s postback URL with its macros filled in (order id, sale amount, commission, click id).</li>
            <li>FORGE verifies the secret token (constant-time), de-duplicates by order id, and attributes the commission to the click, product, campaign and content.</li>
          </ol>
          <div className="mt-4 space-y-1.5 text-[11px]">
            {Object.entries(NETWORK_PRESETS)
              .slice(0, 6)
              .map(([k, p]) => (
                <p key={k} className="text-dim">
                  <span className="text-haze">{k.replace("_", " ").toLowerCase()}</span> · sub-id <Mono>{p.subIdParam}</Mono>
                  {p.macros.click_id ? (
                    <>
                      {" "}
                      · click macro <Mono>{p.macros.click_id}</Mono>
                    </>
                  ) : (
                    " · no postbacks (import reports)"
                  )}
                </p>
              ))}
          </div>
        </Panel>
      </div>

      <Panel className="mt-6" title={`All tracked links (${links.length})`} bodyClassName="p-0">
        {links.length ? (
          <Table minWidth={1100}>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Tracked</Th>
                <Th>Destination</Th>
                <Th>Network</Th>
                <Th align="end">Commission</Th>
                <Th>Status</Th>
                <Th>Checked</Th>
                <Th align="end" />
              </tr>
            </thead>
            <tbody>
              {links.map(({ link, productTitle, networkName }) => (
                <tr key={link.id}>
                  <Td>
                    {link.productId ? (
                      <Link href={`/admin/products/${link.productId}?tab=links`} className="text-fog hover:underline">
                        {productTitle}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    <Mono>/r/{link.code}</Mono>
                  </Td>
                  <Td className="max-w-xs">
                    <span className="block truncate text-xs" title={link.url}>
                      {link.url}
                    </span>
                  </Td>
                  <Td className="text-xs">{networkName ?? "direct / store"}</Td>
                  <Td align="end">{link.commissionRate !== null ? `${link.commissionRate}%` : "—"}</Td>
                  <Td>
                    <Badge tone={link.status === "ACTIVE" ? "good" : link.status === "BROKEN" ? "critical" : link.status === "PAUSED" ? "warning" : "neutral"}>{link.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-xs">{link.lastCheckedAt ? formatRelative(link.lastCheckedAt) : "never"}</Td>
                  <Td align="end">
                    {canWrite && (
                      <ActionForm action={linkAction}>
                        <input type="hidden" name="id" value={link.id} />
                        <input type="hidden" name="op" value="check" />
                        <SubmitButton size="sm" variant="ghost">
                          Check
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState title="No links yet">Create links from a product’s Links tab.</EmptyState>
          </div>
        )}
      </Panel>
    </>
  );
}
