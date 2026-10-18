import { redirect } from "next/navigation";
import { AdminLogin } from "@/components/admin-auth";
import { devAuthOpen } from "@/lib/config";
import "../../planner/planner.css";

export const metadata = { title: "Sign in | MB Admin", robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  if (devAuthOpen()) redirect("/admin");
  return <AdminLogin />;
}
