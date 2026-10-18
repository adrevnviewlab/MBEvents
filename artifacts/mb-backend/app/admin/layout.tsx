import type { ReactNode } from "react";
import "../planner/planner.css";
import "./office.css";
import { OfficeShell } from "@/components/office/shell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const publicOrigin = (process.env.MB_PUBLIC_ORIGIN ?? "http://127.0.0.1:5173").replace(/\/$/, "") + "/";
  return <OfficeShell publicOrigin={publicOrigin}>{children}</OfficeShell>;
}
