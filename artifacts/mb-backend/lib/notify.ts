import { env } from "@/lib/env";

type NotifyEnv = { RESEND_API_KEY?: string; MB_FROM_EMAIL?: string; MB_NOTIFY_EMAIL?: string };
const cfg = () => env as unknown as NotifyEnv;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Optional email alerts via Resend. Without RESEND_API_KEY + MB_FROM_EMAIL this is a no-op,
// and a failed send never breaks the request that triggered it.
async function send(to: string, subject: string, lines: string[], link?: { url: string; label: string }) {
  const { RESEND_API_KEY: key, MB_FROM_EMAIL: from } = cfg();
  if (!key || !from || !to.includes("@")) return false;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1714">${lines.map((l) => `<p>${escape(l).replace(/\n/g, "<br>")}</p>`).join("")}${link ? `<p><a href="${escape(link.url)}" style="background:#c9b07a;color:#0c0b0a;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">${escape(link.label)}</a></p>` : ""}<p style="color:#888;font-size:12px">MB Events · (855) 627-6863</p></div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error("Email send failed", res.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Email send failed", error);
    return false;
  }
}

export function notifyMb(origin: string, eventId: string, subject: string, lines: string[], path = `/admin/planner/${eventId}`) {
  return send(cfg().MB_NOTIFY_EMAIL ?? "", subject, lines.filter(Boolean), { url: `${origin}${path}`, label: "Open in admin" });
}

export function notifyClient(origin: string, to: string, subject: string, lines: string[], tab?: string) {
  return send(to, subject, lines, { url: `${origin}/planner${tab ? `?tab=${encodeURIComponent(tab)}` : ""}`, label: "Open your planner" });
}

export function notifyAccount(to: string, subject: string, lines: string[], link?: { url: string; label: string }) {
  return send(to, subject, lines, link);
}
