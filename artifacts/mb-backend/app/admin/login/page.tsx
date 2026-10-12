import { AdminLogin } from "@/components/admin-auth";
import "../../planner/planner.css";

export const metadata = { title: "Sign in | MB Admin", robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  return <AdminLogin />;
}
