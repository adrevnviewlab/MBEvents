import type { Metadata } from "next";
import { Planner } from "@/components/planner";
import "./planner.css";

export const metadata: Metadata = { title: "MB Planner | MB Events" };

export default function PlannerPage() {
  return <Planner />;
}
