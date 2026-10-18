import { notFound } from "next/navigation";
import { getActor, requireAdminPage } from "@/lib/admin";
import { customerProfile } from "@/lib/customers";
import { env } from "@/lib/env";
import { ClientProfile } from "@/components/office/client-profile";
import "../../../planner/planner.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client | MB Admin", robots: { index: false, follow: false } };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage("/admin/clients", "customers.read");
  const actor = await getActor();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !env.DB || !actor) notFound();
  const profile = await customerProfile(id, actor.role);
  if (!profile) notFound();
  return <ClientProfile profile={profile} />;
}
