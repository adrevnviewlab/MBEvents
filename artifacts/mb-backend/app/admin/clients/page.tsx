import { requireAdminPage } from "@/lib/admin";
import { OfficeClients } from "@/components/office/clients";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients | MB Admin", robots: { index: false, follow: false } };

export default async function ClientsPage() {
  await requireAdminPage("/admin/clients", "customers.read");
  return <OfficeClients />;
}
