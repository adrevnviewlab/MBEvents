// End-to-end smoke test for the site, admin, client planner, and guest flows.
// Usage: BASE_URL=http://localhost:5173 MB_ADMIN_EMAIL=... MB_ADMIN_PASSWORD=... node scripts/smoke-test.mjs
// Creates a temporary client portal and deletes it at the end. SKIP_LEAD=1 skips the lead-form check
// (leads are not deleted). RATE_LIMIT=1 also checks login throttling (locks the tester's IP for 15 min).
const BASE = (process.env.BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const results = [];
const ok = (name, pass, detail = "") => results.push({ name, pass, detail });

function jar() {
  const cookies = new Map();
  return {
    async req(path, { method = "GET", body, headers = {} } = {}) {
      const res = await fetch(BASE + path, {
        method,
        redirect: "manual",
        headers: { ...(body ? { "content-type": "application/json", origin: BASE } : method !== "GET" ? { origin: BASE } : {}), cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const [k, v] = pair.split("=");
        if (/Max-Age=0/i.test(c)) cookies.delete(k);
        else cookies.set(k, v);
      }
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = undefined; }
      return { status: res.status, json, text, headers: res.headers };
    },
  };
}

const anon = jar();
for (const path of ["/", "/weddings", "/contact", "/planner", "/planner/guest", "/admin/login"]) {
  const r = await anon.req(path);
  ok(`GET ${path}`, r.status === 200, String(r.status));
}
const adminPage = await anon.req("/admin/login");
ok("security headers", adminPage.headers.get("x-frame-options") === "DENY" && !!adminPage.headers.get("strict-transport-security"), adminPage.headers.get("x-frame-options") ?? "missing");
ok("admin page redirects to login", [307, 308].includes((await anon.req("/admin/planner")).status));
ok("planner API requires session", (await anon.req("/api/planner")).status === 401);
ok("cross-origin write rejected", (await anon.req("/api/leads", { method: "POST", body: {}, headers: { origin: "https://evil.example" } })).status === 403);

const admin = jar();
ok("admin wrong password rejected", (await admin.req("/api/admin/login", { method: "POST", body: { email: process.env.MB_ADMIN_EMAIL, password: "definitely-wrong" } })).status === 401);
const login = await admin.req("/api/admin/login", { method: "POST", body: { email: process.env.MB_ADMIN_EMAIL, password: process.env.MB_ADMIN_PASSWORD } });
ok("admin login", login.status === 200, login.json?.error ?? "");
ok("admin pages load", (await admin.req("/admin/planner")).status === 200 && (await admin.req("/admin/leads")).status === 200);

const created = await admin.req("/api/admin/planner", { method: "POST", body: { clientNames: "Smoke Test Client", email: "", phone: "", eventType: "Wedding", eventDate: "2030-06-01", venueName: "Test Hall", guestCount: "100" } });
ok("create portal", created.status === 201, created.json?.error ?? "");
const { id, code, password } = created.json ?? {};

const client = jar();
ok("client login (lowercase password)", (await client.req("/api/planner/login", { method: "POST", body: { code, password: String(password).toLowerCase() } })).status === 200);
let bundle = (await client.req("/api/planner")).json;
ok("client bundle", bundle?.code === code && bundle?.data?.timeline?.length > 0);
ok("client save section", (await client.req("/api/planner", { method: "PATCH", body: { section: "songs", value: [{ id: "s1", title: "Perfect", artist: "Ed Sheeran", kind: "Must play", moment: "", note: "" }] } })).status === 200);
{
  // Concurrent saves of different sections must both persist (no lost updates).
  const team = [{ id: "v1", name: "Pat", role: "Photographer", company: "", phone: "", email: "" }];
  const timeline = [{ id: "t1", time: "7:00 PM", what: "Concurrency check", song: "", who: "" }];
  await Promise.all([
    client.req("/api/planner", { method: "PATCH", body: { section: "team", value: team } }),
    client.req("/api/planner", { method: "PATCH", body: { section: "timeline", value: timeline } }),
  ]);
  const after = (await client.req("/api/planner")).json;
  ok("concurrent section saves both persist", after?.data?.team?.[0]?.id === "v1" && after?.data?.timeline?.[0]?.what === "Concurrency check" && after?.data?.songs?.[0]?.id === "s1");
}
ok("client invalid section rejected", (await client.req("/api/planner", { method: "PATCH", body: { section: "admin", value: {} } })).status === 400);
ok("client message", (await client.req("/api/planner/messages", { method: "POST", body: { body: "Smoke test message" } })).status === 201);
ok("client cannot reach admin API", [401, 403].includes((await client.req("/api/admin/planner")).status));

const guest = jar();
ok("guest login", (await guest.req("/api/planner/guest/login", { method: "POST", body: { code: bundle?.guestCode, password: bundle?.guestPassword } })).status === 200);
ok("guest request", (await guest.req("/api/planner/guest/requests", { method: "POST", body: { guestName: "Tester", title: "September", artist: "Earth, Wind & Fire" } })).status === 201);
ok("guest cannot read client planner", (await guest.req("/api/planner")).status === 401);
bundle = (await client.req("/api/planner")).json;
const requestId = bundle?.requests?.[0]?.id;
await client.req("/api/planner/requests", { method: "PATCH", body: { id: requestId, status: "approved" } });
bundle = (await client.req("/api/planner")).json;
ok("approved guest song joins music list", !!bundle?.data?.songs?.some((s) => s.id === `guest-${requestId}`));

const adminBundle = (await admin.req(`/api/admin/planner/${id}`)).json;
const doc = { id: "doc1", title: "Agreement", body: "Agreement for {{client_name}} on {{event_date}}", status: "sent", createdAt: "", signedName: "", signature: "", signedAt: "", signedIp: "" };
const payments = [{ id: "p1", label: "Deposit", amount: 500, due: "", status: "paid", paidAt: "2026-01-01", method: "Check", ref: "" }];
ok("admin saves invoice + document", (await admin.req(`/api/admin/planner/${id}`, { method: "PATCH", body: { admin: { ...adminBundle.admin, lineItems: [{ id: "l1", description: "DJ", qty: 1, price: 2000 }], payments, documents: [doc] } } })).status === 200);
const signature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
ok("client signs document", (await client.req("/api/planner/sign", { method: "POST", body: { docId: "doc1", name: "Smoke Tester", signature, agree: true } })).status === 200);
bundle = (await client.req("/api/planner")).json;
ok("signed doc has merged text", bundle?.admin?.documents?.[0]?.status === "signed" && bundle.admin.documents[0].body.includes("Smoke Test Client"));
ok("checklist auto-ticked", (bundle?.data?.checklist?.filter((c) => c.done).length ?? 0) >= 2);
ok("calendar download", (await client.req("/api/planner/calendar")).text.startsWith("BEGIN:VCALENDAR"));

if (!process.env.SKIP_LEAD) {
  const lead = await anon.req("/api/leads", { method: "POST", body: { source: "contact", name: "Smoke Test Lead", email: "smoke@example.test", phone: "", eventType: "Other", priorities: [], contactMethod: "either", notes: "smoke", website: "" } });
  ok("lead form", [200, 201].includes(lead.status), lead.json?.error ?? "");
}

ok("delete test portal", (await admin.req(`/api/admin/planner/${id}`, { method: "DELETE" })).status === 200);
ok("deleted portal session revoked", (await client.req("/api/planner")).status === 401);
ok("admin logout", (await admin.req("/api/admin/login", { method: "DELETE" })).status === 200 && [307, 308].includes((await admin.req("/admin/planner")).status));

if (process.env.RATE_LIMIT) {
  const attacker = jar();
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await attacker.req("/api/admin/login", { method: "POST", body: { email: "nobody@example.test", password: "x" } })).status;
  ok("login rate limit (429 after 10 tries)", last === 429, String(last));
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail && !r.pass ? `  (${r.detail})` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
