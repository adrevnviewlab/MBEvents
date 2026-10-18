import { requireAdminPage } from "@/lib/admin";
import { OfficeNote } from "@/components/office/note";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposals | MB Admin", robots: { index: false, follow: false } };

export default async function ProposalsPage() {
  await requireAdminPage("/admin/proposals");
  return (
    <OfficeNote kicker="Sales" title="Proposals & contracts">
      <p className="pl-intro">Quotes and contracts stay on the event control room so CRM, calendar, and finance share one record.</p>
      <p className="pl-intro">Use Documents for contracts and Payments for the quote ledger. The owner overview lists unsigned contracts across active bookings.</p>
      <p>
        <a className="pl-btn" href="/admin/planner">Open events</a>{" "}
        <a className="pl-btn ghost" href="/admin">Owner desk</a>
      </p>
    </OfficeNote>
  );
}
