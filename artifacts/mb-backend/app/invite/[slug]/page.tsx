import type { Metadata } from "next";
import { InvitePage } from "@/components/planner/invite-public";
import "../../planner/planner.css";

export const metadata: Metadata = { title: "Invitation | MB Events", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <InvitePage slug={slug} />;
}
