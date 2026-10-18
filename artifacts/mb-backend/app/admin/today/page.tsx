import { requireAdminPage } from "@/lib/admin";
import { OfficeToday } from "@/components/office/today";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today | MB Admin", robots: { index: false, follow: false } };

export default async function TodayPage() {
  await requireAdminPage("/admin/today", "office.access");
  return <OfficeToday />;
}
