import type { Metadata } from "next";
import { CheckInPage } from "@/components/planner/invite-public";
import "../../planner/planner.css";

export const metadata: Metadata = { title: "Check in | MB Events", robots: { index: false, follow: false } };

export default function Page() {
  return <CheckInPage />;
}
