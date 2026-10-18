import { requireAdminPage } from "@/lib/admin";
import { OfficeInvitations } from "@/components/office/invitations";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invitations | MB Admin", robots: { index: false, follow: false } };

export default async function InvitationsPage() {
  await requireAdminPage("/admin/invitations", "events.read");
  return <OfficeInvitations />;
}
