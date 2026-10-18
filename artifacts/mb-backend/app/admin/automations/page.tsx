import { requireAdminPage } from "@/lib/admin";
import { AutomationDesk } from "@/components/directory-admin";
import "../../planner/planner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Automations | MB Admin", robots: { index: false, follow: false } };

export default async function AutomationsAdminPage() {
  await requireAdminPage("/admin/automations", "automations.read");
  return <AutomationDesk />;
}
