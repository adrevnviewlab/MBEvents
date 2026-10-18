import { requireAdminPage } from "@/lib/admin";
import { ReportDesk } from "@/components/office/report-desk";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics | MB Admin", robots: { index: false, follow: false } };

export default async function ReportPage() {
  await requireAdminPage("/admin/report", "payments.read");
  return <ReportDesk />;
}
