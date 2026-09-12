import { pageContext } from "@/server/auth/session";
import { listCategories } from "@/server/services/catalog";
import { PageHeader, Panel } from "@/components/admin/ui";
import { ProductForm } from "@/components/admin/ProductForm";
import { createProductAction } from "../../../actions/products";

export const metadata = { title: "Add product" };

export default async function NewProductPage() {
  const ctx = await pageContext("products:write");
  const categories = await listCategories(ctx);
  return (
    <>
      <PageHeader eyebrow="Catalog" title="Add a product" description="Enter what you know. FORGE scores it immediately and tells you which signals are missing." />
      <Panel>
        <ProductForm action={createProductAction} categories={categories} submitLabel="Create & score" />
      </Panel>
    </>
  );
}
