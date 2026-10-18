process.env.DATABASE_URL = "pglite:memory";
process.env.MB_ADMIN_EMAIL = "owner@timeline.test";
delete process.env.RESEND_API_KEY;

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

const { getDatabase } = await import("../lib/env.ts");
const { createInquiry, bookLead } = await import("../lib/crm.ts");
const { leadSchema } = await import("../lib/lead.ts");
const { saveBusinessSettings } = await import("../lib/business-settings.ts");
const { defaultTimeline, timelineSchema } = await import("../lib/planner.ts");
const {
  clientVisibleTimeline,
  inferTimelineKind,
  mergeClientTimeline,
  parseTimelineMinutes,
  timelineWarnings,
  emptyTimelineItem,
} = await import("../lib/timeline.ts");
const { createAssignment, staffBrief } = await import("../lib/operations.ts");
const { clientView, parseEvent, saveEvent, saveSection } = await import("../lib/planner-server.ts");
const { ensureDefaultTemplates, listPlanningTemplates } = await import("../lib/planning-templates.ts");

const db = getDatabase();
if (!db) throw new Error("database did not open");
const actor = { email: "owner@timeline.test", userId: null as string | null };

await saveBusinessSettings({ companyName: "MB Events", timezone: "America/New_York", actorEmail: actor.email });
await ensureDefaultTemplates();

const wedding = defaultTimeline("Wedding");
check("wedding template includes setup", wedding.some((item) => item.kind === "setup" || /setup/i.test(item.what)));
check("wedding template includes soundcheck", wedding.some((item) => item.kind === "soundcheck" || /sound/i.test(item.what)));
check("wedding template includes breakdown", wedding.some((item) => item.kind === "breakdown" || /breakdown/i.test(item.what)));
check("wedding template includes dinner", wedding.some((item) => item.kind === "dinner" || /dinner/i.test(item.what)));
check("infer kind for guest arrival", inferTimelineKind("Guest arrival & cocktail hour") === "guest_arrival");
check("parse 7:00 PM", parseTimelineMinutes("7:00 PM") === 19 * 60);
check("parse 19:30", parseTimelineMinutes("19:30") === 19 * 60 + 30);

const ordered = [
  emptyTimelineItem("a", { time: "6:00 PM", endTime: "7:00 PM", what: "Cocktail" }),
  emptyTimelineItem("b", { time: "6:30 PM", endTime: "7:30 PM", what: "Dinner" }),
];
const warns = timelineWarnings(ordered);
check("overlap warning fires", warns.some((w) => w.id.includes("overlap")));

const outOfOrder = [
  emptyTimelineItem("a", { time: "8:00 PM", what: "Dancing" }),
  emptyTimelineItem("b", { time: "7:00 PM", what: "Dinner" }),
];
check("ordering warning fires", timelineWarnings(outOfOrder).some((w) => w.id.includes("order")));

const endBefore = [emptyTimelineItem("a", { time: "8:00 PM", endTime: "7:00 PM", what: "Bad" })];
check("end-before-start warning", timelineWarnings(endBefore).some((w) => w.id.includes("end-before-start")));

const legacy = timelineSchema.safeParse([{ id: "legacy1", time: "7:00 PM", what: "Grand entrance", song: "", who: "DJ" }]);
check("legacy timeline items still parse", legacy.success, JSON.stringify(legacy.error?.issues?.[0]));

const templates = await listPlanningTemplates();
check("templates still seeded by event type", templates.some((t) => t.eventType === "Wedding" && t.timeline.length > 0));
check("corporate template exists", templates.some((t) => t.eventType === "Corporate"));

const lead = await createInquiry(leadSchema.parse({
  source: "contact",
  name: "Timeline Test",
  email: "timeline-test@example.com",
  phone: "5550909",
  eventType: "Wedding",
  eventDate: "2039-09-09",
  services: [],
}));
const booked = await bookLead({
  leadId: lead.id,
  actor,
  details: {
    clientNames: "Timeline Test",
    email: "timeline-test@example.com",
    phone: "5550909",
    eventType: "Wedding",
    eventDate: "2039-09-09",
    venueName: "Hall",
    guestCount: "120",
  },
});
await db.prepare("UPDATE bookings SET status = 'confirmed' WHERE event_id = ?").bind(booked.id).run();

const staffUser = crypto.randomUUID();
const staffId = crypto.randomUUID();
await db.prepare("INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, 'staff')")
  .bind(staffUser, "crew-timeline@example.com", "Crew Timeline").run();
await db.prepare("INSERT INTO staff (id, user_id, name, email, profile_type) VALUES (?, ?, ?, ?, 'dj')")
  .bind(staffId, staffUser, "Crew Timeline", "crew-timeline@example.com").run();
await createAssignment({
  actorRole: "coordinator",
  eventId: booked.id,
  staffId,
  roleLabel: "DJ",
});
await db.prepare("UPDATE assignments SET status = 'confirmed' WHERE event_id = ? AND staff_id = ?")
  .bind(booked.id, staffId).run();

const hidden = emptyTimelineItem("hid1", {
  time: "3:00 PM",
  what: "Internal load-in notes",
  kind: "setup",
  notes: "Park by loading dock",
  clientVisible: false,
  who: "Crew Timeline",
});
const visible = emptyTimelineItem("vis1", {
  time: "6:00 PM",
  endTime: "7:00 PM",
  what: "Guest arrival",
  kind: "guest_arrival",
  clientVisible: true,
  who: "Host",
});
const dancing = emptyTimelineItem("vis2", {
  time: "8:00 PM",
  what: "Open dancing",
  kind: "dancing",
  clientVisible: true,
});

const row = await db.prepare("SELECT * FROM planner_events WHERE event_id = ?").bind(booked.id).first();
if (!row) throw new Error("planner missing");
const event = parseEvent(row as never);
// Office writes go through saveEvent (admin API). Client writes use saveSection + merge.
await saveEvent(event.row.id, { data: { timeline: [hidden, visible, dancing] as never } });

const refreshed = parseEvent((await db.prepare("SELECT * FROM planner_events WHERE event_id = ?").bind(booked.id).first()) as never);
check("saved timeline stays on one planner event", refreshed.data.timeline.length === 3);
check("hidden moment stored on same record", refreshed.data.timeline.some((item) => item.id === "hid1" && item.clientVisible === false));

const view = clientView(refreshed, { requests: [], messages: [] });
const clientTimeline = (view as { data: { timeline: { id: string }[] } }).data.timeline;
check("client view hides staff-only moments", clientTimeline.every((item) => item.id !== "hid1") && clientTimeline.length === 2);

const clientEdit = clientVisibleTimeline(refreshed.data.timeline as never).map((item, index) => (
  index === 0 ? { ...item, what: "Doors open" } : item
));
const merged = mergeClientTimeline(refreshed.data.timeline as never, clientEdit as never);
check("client merge keeps staff-only moment", merged.some((item) => item.id === "hid1" && item.clientVisible === false));
check("client merge updates visible moment", merged.some((item) => item.id === "vis1" && item.what === "Doors open"));

await saveSection(refreshed, "timeline", clientEdit as never);
const afterClient = parseEvent((await db.prepare("SELECT * FROM planner_events WHERE event_id = ?").bind(booked.id).first()) as never);
check("after client save staff-only remains attached", afterClient.data.timeline.some((item) => item.id === "hid1"));

const reordered = [afterClient.data.timeline[2], afterClient.data.timeline[0], afterClient.data.timeline[1]];
await saveEvent(afterClient.row.id, { data: { timeline: reordered as never } });
const afterReorder = parseEvent((await db.prepare("SELECT * FROM planner_events WHERE event_id = ?").bind(booked.id).first()) as never);
check("reorder persists on same event record", afterReorder.data.timeline.map((item) => item.id).join(",") === reordered.map((item) => item.id).join(","));

const clientReorder = clientVisibleTimeline(afterReorder.data.timeline as never).reverse();
await saveSection(afterReorder, "timeline", clientReorder as never);
const afterClientReorder = parseEvent((await db.prepare("SELECT * FROM planner_events WHERE event_id = ?").bind(booked.id).first()) as never);
const visibleOrder = clientVisibleTimeline(afterClientReorder.data.timeline as never).map((item) => item.id).join(",");
check("client can reorder visible moments without dropping staff-only", visibleOrder === clientReorder.map((item) => item.id).join(",") && afterClientReorder.data.timeline.some((item) => item.id === "hid1"));

const brief = await staffBrief(staffUser);
const assigned = brief.events.find((item) => item.id === booked.id);
check("staff brief uses same timeline", !!assigned?.runOfShow.timeline.some((item) => item.what === "Doors open" || item.what === "Guest arrival"));
check("staff brief shows end time / notes fields", !!assigned?.runOfShow.timeline.some((item) => item.endTime === "7:00 PM" || item.notes === "Park by loading dock"));

const failed = results.filter((row) => !row.pass);
for (const row of results) {
  console.log(`${row.pass ? "PASS" : "FAIL"} ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);
}
if (failed.length) {
  console.error(`\n${failed.length} failed`);
  process.exit(1);
}
console.log(`\n${results.length} checks passed`);
