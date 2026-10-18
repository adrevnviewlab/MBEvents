import { Suspense } from "react";
import { requireAdminPage } from "@/lib/admin";
import { TasksBoard } from "@/components/office/tasks-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks | MB Admin", robots: { index: false, follow: false } };

export default async function TasksPage() {
  await requireAdminPage("/admin/tasks", "tasks.read");
  return (
    <Suspense fallback={<div className="pl"><div className="pl-wrap"><p className="of-state">Loading tasks…</p></div></div>}>
      <TasksBoard />
    </Suspense>
  );
}
