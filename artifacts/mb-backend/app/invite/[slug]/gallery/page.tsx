import type { Metadata } from "next";
import { GalleryPage } from "@/components/planner/invite-public";
import "../../../planner/planner.css";

export const metadata: Metadata = { title: "Photos | MB Events", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <GalleryPage slug={slug} />;
}
