import { redirect } from "next/navigation";

export default async function ReportById({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/reports?id=${encodeURIComponent(id)}`);
}
