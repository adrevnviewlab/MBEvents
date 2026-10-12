import { z } from "zod";

// ---------- Shared shapes ----------

const id = z.string().min(1).max(60);
const short = z.string().max(200).default("");
const long = z.string().max(4000).default("");

export const detailsSchema = z.object({
  clientNames: short,
  email: short,
  phone: short,
  altContact: short,
  altPhone: short,
  address: short,
  eventType: short,
  eventDate: short,
  startTime: short,
  endTime: short,
  guestCount: short,
  venueName: short,
  venueAddress: short,
  venueContact: short,
  venuePhone: short,
  ceremonyLocation: short,
  notes: long,
});

export const checklistSchema = z.array(z.object({ id, text: z.string().max(300), due: short, done: z.boolean() })).max(300);
export const guestsSchema = z.array(z.object({ id, name: z.string().max(200), party: z.coerce.number().int().min(1).max(50).default(1), rsvp: z.enum(["Pending", "Yes", "No"]), table: short })).max(2000);
export const songKinds = ["Must play", "Play if possible", "Do not play", "Special moment"] as const;
export const songsSchema = z.array(z.object({ id, title: z.string().max(200), artist: short, kind: z.enum(songKinds), moment: short, note: short })).max(1000);
export const timelineSchema = z.array(z.object({ id, time: short, what: z.string().max(300), song: short, who: short })).max(200);
export const teamSchema = z.array(z.object({ id, name: z.string().max(200), role: short, company: short, phone: short, email: short })).max(100);

export const formsSchema = z.object({
  introductions: z.array(z.object({ id, names: z.string().max(300), role: short, song: short })).max(60).default([]),
  dances: z.array(z.object({ id, moment: z.string().max(120), song: short, artist: short, notes: short })).max(40).default([]),
  announcements: long,
  pronunciations: long,
  traditions: long,
  cocktailStyle: short,
  dinnerStyle: short,
  genresLove: short,
  genresAvoid: short,
  cleanOnly: z.boolean().default(false),
  volume: z.enum(["Soft", "Balanced", "Loud"]).default("Balanced"),
  mcStyle: z.enum(["Minimal", "Balanced", "High energy"]).default("Balanced"),
});

export const evaluationSchema = z.object({
  ratings: z.record(z.string().max(40), z.number().int().min(1).max(5)),
  comments: z.string().max(4000).default(""),
  recommend: z.boolean().default(true),
  submittedAt: z.string().max(40).optional(),
});

export const clientSections = {
  details: detailsSchema,
  checklist: checklistSchema,
  guests: guestsSchema,
  songs: songsSchema,
  timeline: timelineSchema,
  team: teamSchema,
  forms: formsSchema,
} as const;
export type ClientSection = keyof typeof clientSections;

export type PlannerData = {
  details: z.infer<typeof detailsSchema>;
  checklist: z.infer<typeof checklistSchema>;
  guests: z.infer<typeof guestsSchema>;
  songs: z.infer<typeof songsSchema>;
  timeline: z.infer<typeof timelineSchema>;
  team: z.infer<typeof teamSchema>;
  forms: z.infer<typeof formsSchema>;
  evaluation?: z.infer<typeof evaluationSchema>;
};

export const lineItemSchema = z.object({ id, description: z.string().max(200), qty: z.coerce.number().min(0).max(1000), price: z.coerce.number().min(0).max(1_000_000) });
export const paymentSchema = z.object({
  id,
  label: z.string().max(120),
  amount: z.coerce.number().min(0).max(1_000_000),
  due: short,
  status: z.enum(["due", "paid"]),
  paidAt: short,
  method: short,
  ref: short,
});
export const documentSchema = z.object({
  id,
  title: z.string().max(200),
  body: z.string().max(40000),
  status: z.enum(["draft", "sent", "signed"]),
  createdAt: short,
  signedName: short,
  signature: z.string().max(200000).default(""),
  signedAt: short,
  signedIp: short,
});

export const adminDataSchema = z.object({
  packageName: short,
  lineItems: z.array(lineItemSchema).max(100).default([]),
  taxRate: z.coerce.number().min(0).max(30).default(0),
  payments: z.array(paymentSchema).max(50).default([]),
  documents: z.array(documentSchema).max(50).default([]),
  guestRequestsOpen: z.boolean().default(true),
  noteForClient: long,
});
export type AdminData = z.infer<typeof adminDataSchema>;

// ---------- Defaults & templates ----------

export const uid = () => crypto.randomUUID().slice(0, 12);

const timelineTemplates: Record<string, [string, string][]> = {
  Wedding: [
    ["4:30 PM", "Ceremony music begins"], ["5:00 PM", "Ceremony"], ["5:30 PM", "Cocktail hour"],
    ["6:30 PM", "Grand entrance & introductions"], ["6:40 PM", "First dance"], ["6:45 PM", "Welcome & blessing"],
    ["7:00 PM", "Dinner"], ["7:45 PM", "Toasts"], ["8:00 PM", "Parent dances"], ["8:15 PM", "Open dancing"],
    ["9:30 PM", "Cake cutting"], ["9:45 PM", "Bouquet & garter"], ["10:45 PM", "Last dance"], ["11:00 PM", "Send-off"],
  ],
  "Sweet 16": [
    ["7:00 PM", "Guest arrival & cocktail hour"], ["8:00 PM", "Court introductions"], ["8:10 PM", "Grand entrance"],
    ["8:15 PM", "Father-daughter dance"], ["8:30 PM", "Dinner"], ["9:00 PM", "Candle-lighting ceremony"],
    ["9:30 PM", "Open dancing"], ["10:30 PM", "Cake & happy birthday"], ["11:45 PM", "Last dance"],
  ],
  "Bar / Bat Mitzvah": [
    ["6:00 PM", "Cocktail hour"], ["7:00 PM", "Grand entrance"], ["7:05 PM", "Hora"], ["7:20 PM", "Motzi & kiddush"],
    ["7:30 PM", "Dinner"], ["8:15 PM", "Candle-lighting ceremony"], ["8:45 PM", "Open dancing & games"], ["10:45 PM", "Last dance"],
  ],
  Corporate: [
    ["6:00 PM", "Arrival & networking"], ["7:00 PM", "Welcome remarks"], ["7:15 PM", "Dinner"], ["8:00 PM", "Awards / presentations"],
    ["8:45 PM", "Open dancing"], ["10:30 PM", "Close"],
  ],
};

export function defaultTimeline(eventType: string) {
  const key = Object.keys(timelineTemplates).find((k) => eventType.toLowerCase().includes(k.toLowerCase().split(" ")[0])) ?? "";
  const rows = timelineTemplates[key] ?? [["6:00 PM", "Guest arrival"], ["7:00 PM", "Grand entrance"], ["7:30 PM", "Dinner"], ["8:30 PM", "Open dancing"], ["10:45 PM", "Last dance"]];
  return rows.map(([time, what]) => ({ id: uid(), time, what, song: "", who: "" }));
}

const defaultDances: Record<string, string[]> = {
  Wedding: ["Ceremony processional", "Bride's entrance", "Recessional", "Grand entrance", "First dance", "Father-daughter dance", "Mother-son dance", "Cake cutting", "Bouquet toss", "Garter", "Anniversary dance", "Last dance"],
  "Sweet 16": ["Court entrance", "Grand entrance", "Father-daughter dance", "Candle lighting", "Cake", "Last dance"],
  Quince: ["Court entrance", "Grand entrance", "Changing of the shoes", "Father-daughter waltz", "Surprise dance", "Last dance"],
  Mitzvah: ["Grand entrance", "Hora", "Candle lighting", "Parent dance", "Last dance"],
};

export function defaultDanceList(eventType: string) {
  const key = Object.keys(defaultDances).find((k) => eventType.toLowerCase().includes(k.toLowerCase().split(" ")[0])) ?? "";
  return (defaultDances[key] ?? ["Grand entrance", "Special dance", "Last dance"]).map((moment) => ({ id: uid(), moment, song: "", artist: "", notes: "" }));
}

export function defaultChecklist() {
  return [
    ["Review and sign your agreement", "12 months"], ["Pay your deposit", "12 months"], ["Confirm venue details & load-in time", "6 months"],
    ["Fill out the planning form", "2 months"], ["Choose special dance songs", "2 months"], ["Add must-play and do-not-play songs", "6 weeks"],
    ["Share the guest request link", "6 weeks"], ["Finalize the timeline", "4 weeks"], ["Send introductions & pronunciations", "3 weeks"],
    ["Pay final balance", "2 weeks"], ["Confirm vendor contacts", "2 weeks"], ["Final planning call with MB", "1 week"],
  ].map(([text, due]) => ({ id: uid(), text, due, done: false }));
}

export function newPlannerData(input: { clientNames: string; email: string; phone: string; eventType: string; eventDate: string; venueName: string; guestCount: string }): PlannerData {
  return {
    details: detailsSchema.parse({ ...input }),
    checklist: defaultChecklist(),
    guests: [],
    songs: [],
    timeline: defaultTimeline(input.eventType),
    team: [{ id: uid(), name: "MB Events", role: "DJ, MC, lighting & production", company: "Michael Bryan Events", phone: "(855) 627-6863", email: "" }],
    forms: formsSchema.parse({ dances: defaultDanceList(input.eventType) }),
  };
}

export function newAdminData(): AdminData {
  return adminDataSchema.parse({});
}

export const documentTemplates = [
  {
    title: "Entertainment Agreement",
    body: `ENTERTAINMENT AGREEMENT

This agreement is made on {{today}} between Michael Bryan Events ("MB Events") and {{client_name}} ("Client").

EVENT
Type: {{event_type}}
Date: {{event_date}}
Time: {{start_time}} to {{end_time}}
Venue: {{venue}}
Estimated guests: {{guest_count}}

SERVICES
Package: {{package}}
{{line_items}}

FEES
Total: {{total}}
Paid to date: {{paid}}
Balance: {{balance}}

PAYMENT SCHEDULE
{{payment_schedule}}

1. The date is reserved once this agreement is signed and the deposit is received.
2. The remaining balance is due according to the payment schedule in the client portal.
3. Client will provide safe access, a dedicated power source, and a covered area for equipment.
4. Overtime, if requested on the day and available, is billed at the agreed hourly rate.
5. Music requests, timeline, and planning forms should be completed in the portal at least three weeks before the event.

Signed electronically through the MB Events client portal.`,
  },
  {
    title: "Invoice",
    body: `INVOICE

Billed to: {{client_name}}
Event: {{event_type}} on {{event_date}} at {{venue}}

{{line_items}}

Total: {{total}}
Paid: {{paid}}
Balance due: {{balance}}

Thank you for choosing MB Events.`,
  },
];

export function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function totals(admin: AdminData) {
  const subtotal = admin.lineItems.reduce((sum, item) => sum + item.qty * item.price, 0);
  const total = Math.round(subtotal * (1 + admin.taxRate / 100) * 100) / 100;
  const paid = admin.payments.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amount, 0);
  return { subtotal, total, paid, balance: Math.max(0, Math.round((total - paid) * 100) / 100) };
}

const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { dateStyle: "long" });

export function fillMergeTags(body: string, data: PlannerData, admin: AdminData) {
  const t = totals(admin);
  const d = data.details;
  const tags: Record<string, string> = {
    client_name: d.clientNames,
    email: d.email,
    phone: d.phone,
    event_type: d.eventType,
    event_date: d.eventDate ? new Date(`${d.eventDate}T12:00:00`).toLocaleDateString("en-US", { dateStyle: "long" }) : "TBD",
    start_time: d.startTime || "TBD",
    end_time: d.endTime || "TBD",
    venue: [d.venueName, d.venueAddress].filter(Boolean).join(", ") || "TBD",
    guest_count: d.guestCount || "TBD",
    package: admin.packageName || "Custom",
    line_items: admin.lineItems.map((i) => `- ${i.description}${i.qty !== 1 ? ` x${i.qty}` : ""}: ${money(i.qty * i.price)}`).join("\n"),
    payment_schedule: admin.payments.length
      ? admin.payments.map((p) => `- ${p.label}: ${money(p.amount)}${p.status === "paid" ? ` (paid${p.paidAt ? ` ${longDate(p.paidAt)}` : ""})` : p.due ? ` due ${longDate(p.due)}` : ""}`).join("\n")
      : "As listed in the client portal.",
    total: money(t.total),
    paid: money(t.paid),
    balance: money(t.balance),
    today: new Date().toLocaleDateString("en-US", { dateStyle: "long" }),
  };
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => tags[key] ?? match);
}

// ---------- Credentials & sessions ----------

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomCode(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

const toHex = (buf: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 210_000;
  return `pbkdf2$${iterations}$${toHex(salt)}$${toHex(await pbkdf2(password, salt, iterations))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !salt || !hash) return false;
  const actual = toHex(await pbkdf2(password, fromHex(salt), Number(iter)));
  if (actual.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= actual.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export async function sha256(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export const CLIENT_COOKIE = "mb_planner";
export const GUEST_COOKIE = "mb_planner_guest";

export function readCookie(request: Request, name: string) {
  const match = new RegExp(`(?:^|; )${name}=([A-Za-z0-9-]{20,80})(?:;|$)`).exec(request.headers.get("cookie") || "");
  return match?.[1] ?? null;
}

export function sessionCookie(request: Request, name: string, token: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// Ticks checklist items that the system can verify on its own. Never unticks.
const AUTO_CHECKS: [RegExp, (admin: AdminData) => boolean][] = [
  [/sign.*agreement|agreement.*sign|sign.*contract/i, (a) => a.documents.some((d) => d.status === "signed")],
  [/deposit/i, (a) => a.payments.some((p) => /deposit/i.test(p.label) && p.status === "paid") || (a.payments[0]?.status === "paid")],
  [/final (balance|payment)/i, (a) => a.payments.length > 0 && a.payments.every((p) => p.status === "paid")],
];

export function autoCheck(data: PlannerData, admin: AdminData): PlannerData | null {
  let changed = false;
  const checklist = data.checklist.map((item) => {
    if (item.done) return item;
    const rule = AUTO_CHECKS.find(([re]) => re.test(item.text));
    if (rule && rule[1](admin)) {
      changed = true;
      return { ...item, done: true };
    }
    return item;
  });
  return changed ? { ...data, checklist } : null;
}

// Approved guest requests are mirrored into the music list under a stable id.
export const guestSongId = (requestId: string) => `guest-${requestId}`;
