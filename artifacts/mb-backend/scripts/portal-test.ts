process.env.DATABASE_URL = "pglite:memory";

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });

function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      found.add(key);
      keysOf(item, found);
    }
  }
  return found;
}

function readJson(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) as unknown : value;
}

const hidden = ["internalNotes", "internal_notes", "staffRate", "staffRates", "margin", "profitMargin", "cost", "payouts", "incidentReport"];

const { can } = await import("../lib/authz.ts");
const {
  checklistProgress,
  countdownDays,
  defaultChecklist,
  defaultDanceList,
  defaultTimeline,
  newAdminData,
  newPlannerData,
  CLIENT_COOKIE,
  GUEST_COOKIE,
} = await import("../lib/planner.ts");
const { applyPlanningTemplate, defaultTemplateBody, namedEventTypes } = await import("../lib/planning-templates.ts");

check("staff cannot edit templates", can("staff", "events.read") && !can("staff", "events.write") && !can("staff", "office.access"));
check("office roles can edit templates", can("coordinator", "events.write") && can("sales", "events.write") && can("manager", "events.write") && can("admin", "events.write"));
check("client session is portal.client", can("client", "portal.client") && !can("client", "portal.guest"));
check("guest session stays portal.guest", can("guest", "portal.guest") && !can("guest", "portal.client") && !can("guest", "payments.read") && !can("guest", "contracts.read"));

const emptyProgress = checklistProgress([]);
check("empty checklist progress is 0", emptyProgress.done === 0 && emptyProgress.total === 0 && emptyProgress.ratio === 0);
const half = checklistProgress([{ done: true }, { done: false }, { done: true }, { done: false }]);
check("progress is done/total", half.done === 2 && half.total === 4 && half.ratio === 0.5);
check("missing date has no countdown", countdownDays("") === null && countdownDays("not-a-date") === null);
check("stored date has a countdown", countdownDays("2031-05-02") !== null);

const weddingDefaults = defaultTemplateBody("Wedding");
const answered = newPlannerData({ clientNames: "Ada", email: "ada@example.com", phone: "555", eventType: "Wedding", eventDate: "2031-05-02", venueName: "Hall", guestCount: "100" }, weddingDefaults);
answered.checklist = [{ id: "keep", text: "Bring the rings", due: "1 week", done: true }];
answered.timeline = [];
answered.songs = [
  { id: "must", title: "September", artist: "Earth, Wind & Fire", kind: "Must play", moment: "", note: "" },
  { id: "nope", title: "Chicken Dance", artist: "", kind: "Do not play", moment: "", note: "" },
];
answered.forms = {
  ...answered.forms,
  announcements: "No cake smash",
  dances: answered.forms.dances.map((dance) => dance.moment === "First dance" ? { ...dance, song: "At Last", artist: "Etta James" } : dance),
};
const sweet = defaultTemplateBody("Sweet 16");
const applied = applyPlanningTemplate(answered, sweet);
const firstDance = applied.forms.dances.find((dance) => dance.moment === "First dance");
check("template keeps checklist answers", applied.checklist.length === 1 && applied.checklist[0]?.text === "Bring the rings" && applied.checklist[0]?.done === true);
check("template keeps song answers", applied.songs.map((song) => song.title).join(",") === "September,Chicken Dance");
check("template keeps dance answers", firstDance?.song === "At Last" && firstDance.artist === "Etta James");
check("template keeps planning answers", applied.forms.announcements === "No cake smash");
check("template fills an empty timeline", applied.timeline.map((row) => row.what).join("|") === sweet.timeline.map((row) => row.what).join("|"));
check("template adds a missing moment", applied.forms.dances.some((dance) => dance.moment === "Candle lighting"));
const emptied = applyPlanningTemplate({ ...answered, checklist: [] }, sweet);
check("template fills an empty checklist", emptied.checklist.map((item) => item.text).join("|") === sweet.checklist.map((item) => item.text).join("|"));

const plain = newPlannerData({ clientNames: "Ada", email: "", phone: "", eventType: "Wedding", eventDate: "", venueName: "", guestCount: "" });
check("planner without a template still uses the defaults", plain.checklist.map((item) => `${item.text}|${item.due}`).join("|") === defaultChecklist().map((item) => `${item.text}|${item.due}`).join("|") && plain.timeline.map((row) => `${row.time}|${row.what}`).join("|") === defaultTimeline("Wedding").map((row) => `${row.time}|${row.what}`).join("|") && plain.forms.dances.map((dance) => dance.moment).join("|") === defaultDanceList("Wedding").map((dance) => dance.moment).join("|"));

const { getDatabase } = await import("../lib/env.ts");
const { ensureCustomer, createEventRecord } = await import("../lib/records.ts");
const {
  createPlanningTemplate,
  plannerDataFor,
  publishedTemplateFor,
  updatePlanningTemplate,
} = await import("../lib/planning-templates.ts");
const { createSession } = await import("../lib/planner-server.ts");
const db = getDatabase();
if (!db) throw new Error("database did not open");

const seeded = await (async () => {
  await plannerDataFor({ clientNames: "Seed", email: "", phone: "", eventType: "Wedding", eventDate: "", venueName: "", guestCount: "" });
  return db.prepare("SELECT COUNT(*)::int AS count FROM planning_templates WHERE seeded = true").first<{ count: number }>();
})();
check("default templates are seeded once", Number(seeded?.count) === namedEventTypes.length, String(seeded?.count));

const weddingTemplate = await publishedTemplateFor("Wedding");
const fresh = await plannerDataFor({ clientNames: "Wedding Client", email: "wedding@example.com", phone: "555", eventType: "Wedding", eventDate: "", venueName: "", guestCount: "" });
check("new wedding planner matches the current checklist", fresh.checklist.map((item) => `${item.text}|${item.due}`).join("|") === defaultChecklist().map((item) => `${item.text}|${item.due}`).join("|"));
check("new wedding planner matches the current timeline", fresh.timeline.map((row) => `${row.time}|${row.what}`).join("|") === defaultTimeline("Wedding").map((row) => `${row.time}|${row.what}`).join("|"));
check("new wedding planner matches the current dance list", fresh.forms.dances.map((dance) => dance.moment).join("|") === defaultDanceList("Wedding").map((dance) => dance.moment).join("|"));
check("wedding template includes ceremony moments", !!fresh.forms.dances.some((dance) => dance.moment === "Ceremony processional") && fresh.forms.dances.some((dance) => dance.moment === "Bride's entrance") && fresh.forms.dances.some((dance) => dance.moment === "Recessional"));
const mitzvah = await publishedTemplateFor("Bar / Bat Mitzvah");
check("mitzvah template keeps hora and candle lighting", !!mitzvah?.dances.some((dance) => dance.moment === "Hora") && !!mitzvah.dances.some((dance) => dance.moment === "Candle lighting"));

fresh.details.notes = "Gate code 441";
fresh.details.clientBudget = "8000";
(fresh as { internalNotes?: string }).internalNotes = "secret staff note";
(fresh.details as { staffRate?: number }).staffRate = 80;
const admin = newAdminData();
admin.packageName = "Evening";
admin.lineItems = [{ id: "li", description: "Package", qty: 2, price: 100 }];
admin.payments = [{ id: "pay", label: "Deposit", amount: 50, due: "", status: "paid", paidAt: "2030-01-01", method: "Check", ref: "rcpt-1" }];
admin.noteForClient = "See you there";
admin.documents = [
  { id: "draft-1", title: "Draft", body: "hidden", status: "draft", createdAt: "", signedName: "", signature: "", signedAt: "", signedIp: "" },
  { id: "signed-1", title: "Signed agreement", body: "signed body", status: "signed", createdAt: "", signedName: "Ada", signature: "data:image/png;base64,aaa", signedAt: "2030-01-02", signedIp: "1.1.1.1" },
];
(admin as { margin?: number }).margin = 0.4;
(admin.lineItems[0] as { cost?: number }).cost = 4;

async function insertPlanner(data: typeof fresh, adminData: typeof admin, label: string) {
  const id = crypto.randomUUID();
  const customerId = await ensureCustomer({ name: data.details.clientNames || label, email: `${label}@example.com`, phone: "555" });
  await createEventRecord({ id, customerId, name: data.details.clientNames || label, eventType: data.details.eventType, eventDate: data.details.eventDate, guestCount: data.details.guestCount });
  await db!.prepare(
    "INSERT INTO planner_events (id, code, password_hash, guest_code, guest_password, guest_access_token, event_id, data, admin_data) VALUES (?, ?, 'x', ?, 'GUESTPW', ?, ?, ?, ?)",
  ).bind(id, `MB-${label}`, `G-${label}`, `tok-${label}`, id, JSON.stringify(data), JSON.stringify(adminData)).run();
  return id;
}

const eventA = await insertPlanner(fresh, admin, "AAAA");
const otherData = newPlannerData({ clientNames: "SECRET-OTHER-EVENT", email: "other@example.com", phone: "555", eventType: "Birthday", eventDate: "2032-01-01", venueName: "Secret Hall", guestCount: "10" });
const otherAdmin = newAdminData();
otherAdmin.documents = [{ id: "other-doc", title: "Other contract", body: "other contract body", status: "sent", createdAt: "", signedName: "", signature: "", signedAt: "", signedIp: "" }];
otherAdmin.payments = [{ id: "other-pay", label: "Other balance", amount: 999, due: "", status: "due", paidAt: "", method: "", ref: "" }];
const eventB = await insertPlanner(otherData, otherAdmin, "BBBB");
await db.prepare("INSERT INTO payments (id, event_id, label, amount_cents, status) VALUES (?, ?, 'Deposit', 10000, 'due')").bind(crypto.randomUUID(), eventB).run();
await db.prepare("INSERT INTO payments (id, event_id, label, amount_cents, status) VALUES (?, ?, 'Paid', 2500, 'paid')").bind(crypto.randomUUID(), eventB).run();
await db.prepare("INSERT INTO tasks (id, event_id, title, due_on, done, client_visible) VALUES (?, ?, 'Visible deadline', '2031-04-01', false, true)").bind(crypto.randomUUID(), eventA).run();
await db.prepare("INSERT INTO tasks (id, event_id, title, due_on, done, client_visible) VALUES (?, ?, 'Hidden staff task', '2031-04-02', false, false)").bind(crypto.randomUUID(), eventA).run();

if (weddingTemplate) {
  await updatePlanningTemplate(weddingTemplate.id, {
    eventType: weddingTemplate.eventType,
    name: weddingTemplate.name,
    checklist: [{ text: "Changed later", due: "1 week" }],
    timeline: weddingTemplate.timeline,
    dances: weddingTemplate.dances,
    blocks: weddingTemplate.blocks,
    published: true,
  }, { email: "planner@example.com" });
}
const storedBefore = readJson((await db.prepare("SELECT data FROM planner_events WHERE id = ?").bind(eventA).first<{ data: unknown }>())?.data) as { checklist: { text: string }[] };
check("editing a template leaves an existing portal alone", storedBefore.checklist.some((item) => item.text === "Review and sign your agreement") && !storedBefore.checklist.some((item) => item.text === "Changed later"));
const afterEdit = await plannerDataFor({ clientNames: "Next", email: "", phone: "", eventType: "Wedding", eventDate: "", venueName: "", guestCount: "" });
check("a portal created after the edit uses the new template", afterEdit.checklist.length === 1 && afterEdit.checklist[0]?.text === "Changed later");

const clientSession = await createSession(eventA, "client");
const guestSession = await createSession(eventA, "guest");
const { GET, PATCH } = await import("../app/api/planner/route.ts");
const { GET: guestGET } = await import("../app/api/planner/guest/requests/route.ts");
const { POST: signPOST } = await import("../app/api/planner/sign/route.ts");
const { POST: payPOST } = await import("../app/api/planner/pay/route.ts");

const clientHeaders = { cookie: `${CLIENT_COOKIE}=${clientSession.token}` };
const otherRead = await GET(new Request(`http://localhost/api/planner?event=${eventB}`, { headers: clientHeaders }));
const otherBody = await otherRead.json() as { error?: string };
check("client cannot read another event", (otherRead.status === 403 || otherRead.status === 404) && !JSON.stringify(otherBody).includes("SECRET-OTHER-EVENT") && !JSON.stringify(otherBody).includes("other contract body"));

const own = await GET(new Request(`http://localhost/api/planner?event=${eventA}`, { headers: clientHeaders }));
const ownBody = await own.json() as {
  data: { details: { notes?: string; clientBudget?: string }; checklist: { done: boolean }[]; songs: { title: string }[] };
  admin: { documents: { status: string }[]; noteForClient?: string };
  progress: { done: number; total: number; ratio: number };
  budget: { total: number; paid: number; balance: number; clientBudget: string };
  deadlines: { title: string }[];
  countdown: number | null;
};
const ownKeys = keysOf(ownBody);
check("client can read their own event", own.status === 200, String(own.status));
check("client payload has no internal notes, staff rates, or margin", hidden.every((key) => !ownKeys.has(key)) && !JSON.stringify(ownBody).includes("secret staff note"), [...ownKeys].filter((key) => hidden.includes(key)).join(","));
check("client still sees their own note", ownBody.data.details.notes === "Gate code 441" && ownBody.admin.noteForClient === "See you there");
check("client sees signed documents and not drafts", ownBody.admin.documents.some((doc) => doc.status === "signed") && ownBody.admin.documents.every((doc) => doc.status !== "draft"));
check("client progress is done/total", ownBody.progress.total === ownBody.data.checklist.length && ownBody.progress.done === ownBody.data.checklist.filter((item) => item.done).length && ownBody.progress.ratio === (ownBody.progress.total === 0 ? 0 : ownBody.progress.done / ownBody.progress.total));
check("planner invoice is the budget when finance rows are empty", ownBody.budget.total === 200 && ownBody.budget.paid === 50 && ownBody.budget.balance === 150 && ownBody.budget.clientBudget === "8000");
check("no date means no countdown", ownBody.countdown === null);
check("client sees only client-visible deadlines", ownBody.deadlines.some((task) => task.title === "Visible deadline") && !ownBody.deadlines.some((task) => task.title === "Hidden staff task"));

const otherSession = await createSession(eventB, "client");
const finance = await GET(new Request("http://localhost/api/planner", { headers: { cookie: `${CLIENT_COOKIE}=${otherSession.token}` } }));
const financeBody = await finance.json() as { budget: { total: number; paid: number; balance: number; source?: string } };
check("finance payment rows use the phase 4 ledger", finance.status === 200 && financeBody.budget.source === "ledger" && financeBody.budget.paid === 25 && financeBody.budget.total === 0 && financeBody.budget.balance === -25, JSON.stringify(financeBody.budget));

const rejected = await PATCH(new Request("http://localhost/api/planner", {
  method: "PATCH",
  headers: { ...clientHeaders, "content-type": "application/json" },
  body: JSON.stringify({ section: "songs", value: [], eventId: eventB }),
}));
check("client cannot write another event", rejected.status === 403 || rejected.status === 404);

const checklist = fresh.checklist.map((item, index) => index === 0 ? { ...item, text: "Bring the rings", done: true } : item);
const details = { ...fresh.details, clientNames: "Portal Client", venueName: "The Saved Hall", eventDate: "2031-05-02", clientBudget: "8000" };
const songs = [
  { id: "must", title: "September", artist: "Earth, Wind & Fire", kind: "Must play", moment: "", note: "" },
  { id: "nope", title: "Chicken Dance", artist: "", kind: "Do not play", moment: "", note: "" },
];
for (const [section, value] of [["checklist", checklist], ["details", details], ["songs", songs]] as const) {
  const saved = await PATCH(new Request("http://localhost/api/planner", {
    method: "PATCH",
    headers: { ...clientHeaders, "content-type": "application/json" },
    body: JSON.stringify({ section, value }),
  }));
  check(`client ${section} save accepted`, saved.status === 200, String(saved.status));
}
const adminRead = readJson((await db.prepare("SELECT data FROM planner_events WHERE id = ?").bind(eventA).first<{ data: unknown }>())?.data) as {
  checklist: { text: string; done: boolean }[];
  details: { venueName: string; clientNames: string; eventDate: string };
  songs: { title: string; kind: string }[];
};
const eventRow = await db.prepare("SELECT name, event_date::text AS event_date FROM events WHERE id = ?").bind(eventA).first<{ name: string; event_date: string }>();
check("client checklist save is on the admin event", adminRead.checklist.some((item) => item.text === "Bring the rings" && item.done));
check("client details save is on the admin event", adminRead.details.venueName === "The Saved Hall" && adminRead.details.clientNames === "Portal Client" && eventRow?.name === "Portal Client" && eventRow.event_date === "2031-05-02");
check("client song save is on the admin event", adminRead.songs.some((song) => song.kind === "Must play" && song.title === "September") && adminRead.songs.some((song) => song.kind === "Do not play" && song.title === "Chicken Dance"));

const progressed = await GET(new Request("http://localhost/api/planner", { headers: clientHeaders }));
const progressedBody = await progressed.json() as { progress: { done: number; total: number; ratio: number }; countdown: number | null };
const doneCount = adminRead.checklist.filter((item) => item.done).length;
check("saved checklist progress is done/total", progressedBody.progress.done === doneCount && progressedBody.progress.total === adminRead.checklist.length && progressedBody.progress.ratio === doneCount / adminRead.checklist.length && doneCount >= 1, JSON.stringify(progressedBody.progress));
check("countdown uses the saved event date", typeof progressedBody.countdown === "number");

const guestHeaders = { cookie: `${GUEST_COOKIE}=${guestSession.token}` };
const guestPlanner = await GET(new Request("http://localhost/api/planner", { headers: guestHeaders }));
const guestInfo = await guestGET(new Request("http://localhost/api/planner/guest/requests", { headers: guestHeaders }));
const guestPayload = await guestInfo.json() as Record<string, unknown>;
const guestSign = await signPOST(new Request("http://localhost/api/planner/sign", { method: "POST", headers: guestHeaders, body: "{}" }));
const guestPay = await payPOST(new Request("http://localhost/api/planner/pay", { method: "POST", headers: guestHeaders, body: "{}" }));
check("guest cannot open the client planner", guestPlanner.status === 401);
check("guest payload has no payments, contracts, or messages", guestInfo.status === 200 && !("payments" in guestPayload) && !("documents" in guestPayload) && !("admin" in guestPayload) && !("messages" in guestPayload) && !JSON.stringify(guestPayload).includes("signed body") && !JSON.stringify(guestPayload).includes("rcpt-1"));
check("guest cannot sign or pay", guestSign.status === 401 && guestPay.status === 401, `${guestSign.status}/${guestPay.status}`);

const clientSign = await signPOST(new Request("http://localhost/api/planner/sign", {
  method: "POST",
  headers: { ...clientHeaders, "content-type": "application/json" },
  body: JSON.stringify({ docId: "signed-1", name: "Portal Client", signature: "data:image/png;base64,aaa", agree: true }),
}));
check("client cannot edit a signed contract", clientSign.status === 403);

const extra = await createPlanningTemplate({ eventType: "Birthday", name: "Birthday extra", published: false }, { email: "planner@example.com" });
await updatePlanningTemplate(extra.id, { eventType: "Birthday", name: "Birthday extra", published: true }, { email: "planner@example.com" });
const published = await db.prepare("SELECT action, entity FROM admin_audit WHERE subject_id = ? AND action = 'template_published'").bind(extra.id).first<{ action: string; entity: string }>();
check("publishing a template is audited", published?.action === "template_published" && published.entity === "planning_templates");

const failed = results.filter((result) => !result.pass);
for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name}${result.detail && !result.pass ? `  (${result.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
