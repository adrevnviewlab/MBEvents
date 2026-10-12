import type { Metadata } from "next";
import { GuestRequests } from "@/components/planner/guest";
import "../planner.css";

export const metadata: Metadata = { title: "Song Requests | MB Events", robots: { index: false, follow: false } };

export default function GuestRequestPage() {
  return <GuestRequests />;
}
