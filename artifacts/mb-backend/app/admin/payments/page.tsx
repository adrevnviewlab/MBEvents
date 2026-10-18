import { requireAdminPage } from "@/lib/admin";
import { OfficePayments } from "@/components/office/payments";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments | MB Admin", robots: { index: false, follow: false } };

export default async function PaymentsPage() {
  await requireAdminPage("/admin/payments", "payments.read");
  return <OfficePayments />;
}
