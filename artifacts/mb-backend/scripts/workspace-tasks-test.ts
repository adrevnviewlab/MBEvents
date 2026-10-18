process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@tasks.test";
delete process.env.RESEND_API_KEY;

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

const { getDatabase } = await import("../lib/env.ts");
const { createInquiry, addLeadTask, bookLead } = await import("../lib/crm.ts");
const { leadSchema } = await import("../lib/lead.ts");
const { saveBusinessSettings } = await import("../lib/business-settings.ts");
const {
  createWorkspaceTask,
  listWorkspaceTasks,
  updateWorkspaceTask,
} = await import("../lib/workspace-tasks.ts");
const { buildTodayBoard, buildChecklistBoard } = await import("../lib/today.ts");
const { buildOwnerDesk } = await import("../lib/office-desk.ts");
const { addChecklistItem, setChecklistAssignee, setChecklistDone, officeEvent } = await import("../lib/operations.ts");
const { ensureDefaultTemplates, listPlanningTemplates } = await import("../lib/planning-templates.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");
const actor = { email: "owner@tasks.test", userId: null as string | null, role: "admin" as const };

await saveBusinessSettings({ companyName: "MB Events", timezone: "America/New_York", actorEmail: actor.email });
await ensureDefaultTemplates();

const templates = await listPlanningTemplates();
check("seeded templates include Wedding", templates.some((t) => t.eventType === "Wedding" && t.checklist.length > 0));
check("seeded templates include Sweet 16", templates.some((t) => t.eventType === "Sweet 16"));
check("seeded templates include Corporate", templates.some((t) => t.eventType === "Corporate"));

const lead = await createInquiry(leadSchema.parse({
  source: "contact",
  name: "Taylor Tasks",
  email: "taylor-tasks@example.com",
  phone: "5550808",
  eventType: "Wedding",
  eventDate: "2039-05-01",
  services: [],
}));
await addLeadTask(lead.id, { title: "Overdue CRM call", dueOn: "2000-02-01", assigneeId: null, priority: "high" }, actor);

const today = new Date().toISOString().slice(0, 10);
const general = await createWorkspaceTask({
  title: "Order ink cartridges",
  dueOn: today,
  priority: "normal",
}, actor);
check("general business task created without lead/event", Boolean(general.id));

const booked = await bookLead({
  leadId: lead.id,
  actor,
  details: {
    clientNames: "Taylor Tasks",
    email: "taylor-tasks@example.com",
    phone: "5550808",
    eventType: "Wedding",
    eventDate: today,
    venueName: "Hall",
    guestCount: "100",
  },
});
await db.prepare("UPDATE bookings SET status = 'tentative' WHERE event_id = ?").bind(booked.id).run();

const eventTask = await createWorkspaceTask({
  title: "Confirm load-in",
  dueOn: today,
  eventId: booked.id,
  priority: "high",
}, actor);

const listed = await listWorkspaceTasks("admin", { status: "open" });
check("CRM overdue task listed", listed.tasks.some((t) => t.title === "Overdue CRM call" && t.leadId === lead.id && t.bucket === "overdue"));
check("event task stays attached to event", listed.tasks.some((t) => t.id === eventTask.id && t.eventId === booked.id));
check("general task listed", listed.tasks.some((t) => t.id === general.id && !t.eventId && !t.leadId));

const filtered = await listWorkspaceTasks("admin", { eventId: booked.id, status: "open" });
check("event filter keeps only that event", filtered.tasks.every((t) => t.eventId === booked.id) && filtered.tasks.some((t) => t.id === eventTask.id));
check("event filter excludes CRM-only task", !filtered.tasks.some((t) => t.title === "Overdue CRM call"));

await updateWorkspaceTask(eventTask.id, { done: true }, actor);
const history = await listWorkspaceTasks("admin", { status: "done", eventId: booked.id });
check("completed history includes event task", history.tasks.some((t) => t.id === eventTask.id && t.done));

const reopened = await listWorkspaceTasks("admin", { status: "open", eventId: booked.id });
check("done task leaves open list", !reopened.tasks.some((t) => t.id === eventTask.id));
await updateWorkspaceTask(eventTask.id, { done: false, assigneeId: null }, actor);

const todayBoard = await buildTodayBoard("admin");
check("today board has today's event", todayBoard.counts.todaysEvents >= 1);
check("today board has overdue follow-up", todayBoard.counts.overdueFollowUps >= 1);
check("today board has tasks due today", todayBoard.counts.tasksDueToday >= 1);

const desk = await buildOwnerDesk("admin");
check("desk urgent tasks include unified tasks", desk.counts.urgentTasks >= 1);

const itemId = await addChecklistItem({ actorRole: "admin", eventId: booked.id, title: "Pack wireless mics" });
await setChecklistAssignee({ actorRole: "admin", itemId, assigneeId: null });
await setChecklistDone({ actorRole: "admin", actorUserId: "", itemId, done: true });
const ops = await officeEvent(booked.id, "admin");
check("ops checklist tracks completion", ops.checklist.some((item) => item.id === itemId && item.done));

const checklistBoard = await buildChecklistBoard("admin");
check("checklist board shows templates", checklistBoard.templates.length >= 3);
check("checklist board shows event progress", checklistBoard.events.some((event) => event.id === booked.id && event.opsTotal >= 1 && event.opsDone >= 1));

const attached = await db.prepare("SELECT event_id FROM tasks WHERE id = ?").bind(eventTask.id).first<{ event_id: string }>();
check("task row still points at booking event", attached?.event_id === booked.id);

const failed = results.filter((row) => !row.pass);
for (const row of results) {
  console.log(`${row.pass ? "PASS" : "FAIL"} ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);
}
if (failed.length) {
  console.error(`\n${failed.length} failed`);
  process.exit(1);
}
console.log(`\n${results.length} checks passed`);
