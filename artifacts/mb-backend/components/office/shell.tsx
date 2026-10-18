"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AdminSignOut } from "@/components/admin-auth";
import { api } from "@/components/planner/ui";
import "@/app/admin/office.css";
import { OfficeMotion } from "./motion";

type IconName =
  | "home"
  | "sun"
  | "calendar"
  | "check"
  | "event"
  | "users"
  | "user"
  | "box"
  | "pin"
  | "doc"
  | "card"
  | "mail"
  | "send"
  | "bars"
  | "sliders";

type NavItem = { href: string; label: string; icon: IconName; permission: string };
type NavGroup = { id: string; label: string; items: NavItem[] };

/**
 * Phase 12 nav: every href is an existing admin route.
 * Guests & seating live under MB Invites / event room=guests. Budgets live on the event payments room.
 * /admin/venues and /admin/vendors redirect into Places tabs.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { href: "/admin", label: "Overview", icon: "home", permission: "office.access" },
      { href: "/admin/today", label: "Today", icon: "sun", permission: "office.access" },
      { href: "/admin/calendar", label: "Calendar", icon: "calendar", permission: "events.read" },
      { href: "/admin/tasks", label: "Tasks & Checklists", icon: "check", permission: "tasks.read" },
      { href: "/admin/planner", label: "Events", icon: "event", permission: "events.read" },
    ],
  },
  {
    id: "sales",
    label: "Sales & Clients",
    items: [
      { href: "/admin/leads", label: "Leads & CRM", icon: "users", permission: "leads.read" },
      { href: "/admin/clients", label: "Clients", icon: "user", permission: "customers.read" },
      { href: "/admin/proposals", label: "Quotes & Contracts", icon: "doc", permission: "events.read" },
    ],
  },
  {
    id: "planning",
    label: "Event Planning",
    items: [
      { href: "/admin/invitations", label: "MB Invites", icon: "mail", permission: "events.read" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { href: "/admin/staff", label: "Staff & DJs", icon: "users", permission: "staff.read" },
      { href: "/admin/equipment", label: "Equipment", icon: "box", permission: "equipment.read" },
      { href: "/admin/places", label: "Venues & Vendors", icon: "pin", permission: "venues.read" },
    ],
  },
  {
    id: "finances",
    label: "Finances",
    items: [
      { href: "/admin/payments", label: "Invoices & Payments", icon: "card", permission: "payments.read" },
    ],
  },
  {
    id: "business",
    label: "Business",
    items: [
      { href: "/admin/report", label: "Reports", icon: "bars", permission: "payments.read" },
      { href: "/admin/automations", label: "Marketing", icon: "send", permission: "automations.read" },
      { href: "/admin/settings", label: "Settings", icon: "sliders", permission: "settings.read" },
    ],
  },
];

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "home") return <svg {...common}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" /></svg>;
  if (name === "sun") return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" /></svg>;
  if (name === "calendar") return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="1.5" /><path d="M8 3.5V7M16 3.5V7M4 10h16" /></svg>;
  if (name === "check") return <svg {...common}><path d="M5 12.5 10 17.5 19 7" /></svg>;
  if (name === "event") return <svg {...common}><path d="M7 4h10v16l-5-2.5L7 20z" /></svg>;
  if (name === "users") return <svg {...common}><path d="M16 20v-1.2A3.2 3.2 0 0 0 12.8 15.5H7.2A3.2 3.2 0 0 0 4 18.8V20" /><circle cx="10" cy="8" r="3" /><path d="M20 20v-1.2A3.2 3.2 0 0 0 17.4 16M16 5.2a3 3 0 0 1 0 5.6" /></svg>;
  if (name === "user") return <svg {...common}><circle cx="12" cy="8" r="3.2" /><path d="M5 19.5v-.8A4.2 4.2 0 0 1 9.2 14.5h5.6A4.2 4.2 0 0 1 19 18.7v.8" /></svg>;
  if (name === "box") return <svg {...common}><path d="M3.5 8 12 4l8.5 4L12 12z" /><path d="M3.5 8V16L12 20l8.5-4V8" /><path d="M12 12v8" /></svg>;
  if (name === "pin") return <svg {...common}><path d="M12 21s6-5.1 6-10a6 6 0 1 0-12 0c0 4.9 6 10 6 10z" /><circle cx="12" cy="11" r="1.6" /></svg>;
  if (name === "doc") return <svg {...common}><path d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" /><path d="M14 3.5V9h5.2M8.5 13h7M8.5 16.5h5" /></svg>;
  if (name === "card") return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="1.5" /><path d="M3 10h18M7 15h4" /></svg>;
  if (name === "mail") return <svg {...common}><rect x="3.5" y="5.5" width="17" height="13" rx="1.5" /><path d="m4 7 8 6 8-6" /></svg>;
  if (name === "send") return <svg {...common}><path d="M4 12 20 4l-6 16-2.5-6.5z" /></svg>;
  if (name === "bars") return <svg {...common}><path d="M5 19V11M12 19V5M19 19v-6" /></svg>;
  return <svg {...common}><path d="M4 7h16M4 12h10M4 17h16" /></svg>;
}

function current(href: string, path: string) {
  if (href === "/admin") return path === "/admin";
  if (href === "/admin/places") {
    return path.startsWith("/admin/places") || path.startsWith("/admin/venues") || path.startsWith("/admin/vendors");
  }
  return path === href || path.startsWith(`${href}/`);
}

function initials(email: string) {
  const local = email.split("@")[0] || "MB";
  return local.slice(0, 2).toUpperCase();
}

function pageTitle(path: string) {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (current(item.href, path)) return item.label;
    }
  }
  if (path.startsWith("/admin/planner/")) return "Event";
  if (path.startsWith("/admin/leads/")) return "Lead";
  if (path.startsWith("/admin/clients/")) return "Client";
  if (path.startsWith("/admin/venues")) return "Venues";
  if (path.startsWith("/admin/vendors")) return "Vendors";
  if (path.startsWith("/admin/today")) return "Today";
  if (path.startsWith("/admin/tasks")) return "Tasks & Checklists";
  return "Office";
}

type OfficeTheme = "dark" | "light";
const THEME_KEY = "mb-office-theme";

function readTheme(): OfficeTheme {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function OfficeShell({ children, publicOrigin = "" }: { children: React.ReactNode; publicOrigin?: string }) {
  const path = usePathname() || "/admin";
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<OfficeTheme>("dark");
  const [session, setSession] = useState<{ email: string; role: string; permissions: Record<string, boolean> } | null>(null);

  useEffect(() => { setOpen(false); }, [path]);

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.officeTheme = theme;
  }, [theme]);

  useEffect(() => {
    api<{ ok: boolean; email: string; role: string; permissions: Record<string, boolean> }>("/api/admin/session")
      .then((body) => setSession(body))
      .catch(() => setSession(null))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const themeButton = (
    <button
      type="button"
      className="of-theme-btn"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light" : "Dark"}
      onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 7 7 0 1 0 20.5 14.5z" />
        </svg>
      )}
      <span>{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );

  if (path === "/admin/login") {
    return (
      <div className="office of-login" data-theme={theme}>
        <OfficeMotion />
        <div className="of-login-theme">{themeButton}</div>
        {children}
      </div>
    );
  }

  // Filter nav only after the client session load so SSR HTML matches the first paint.
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !ready || !session || session.permissions[item.permission] !== false),
  })).filter((group) => group.items.length > 0);

  const canSearchLeads = !ready || !session || session.permissions["leads.read"] !== false;

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (!canSearchLeads) return;
    router.push(q ? `/admin/leads?q=${encodeURIComponent(q)}` : "/admin/leads");
  };

  return (
    <div className={open ? "office of-shell is-nav-open" : "office of-shell"} data-theme={theme}>
      <OfficeMotion />
      <aside className="of-side" id="office-nav">
        <a className="of-brand" href="/admin">
          <img
            className="of-brand-logo"
            src="/assets/mb-events-logo.png"
            alt="Michael Bryan Events"
            width={180}
            height={48}
          />
          <small>Command center</small>
        </a>
        <nav className="of-nav" aria-label="Office">
          {groups.map((group) => (
            <div className="of-nav-group" key={group.id}>
              <p className="of-nav-label">{group.label}</p>
              {group.items.map((item) => {
                const on = current(item.href, path);
                return (
                  <a key={item.href} className="of-surface" href={item.href} aria-current={on ? "page" : undefined}>
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="of-side-foot">
          <div className="of-side-foot-row">
            <a
              className="of-side-link"
              href={publicOrigin || "http://127.0.0.1:5173/"}
              target="_blank"
              rel="noreferrer"
            >
              Website
            </a>
            <AdminSignOut />
          </div>
        </div>
      </aside>
      <div className="of-main">
        <header className="of-bar">
          <div className="of-bar-left">
            <button type="button" className="of-menu" aria-expanded={open} aria-controls="office-nav" onClick={() => setOpen((value) => !value)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              Menu
            </button>
            <div className="of-bar-title">
              <strong>{pageTitle(path)}</strong>
            </div>
          </div>
          <form className="of-bar-search" onSubmit={onSearch} role="search">
            <label className="of-sr" htmlFor={searchId}>Search leads</label>
            <input
              ref={searchRef}
              id={searchId}
              className="of-search of-bar-input"
              type="search"
              name="q"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={canSearchLeads ? "Search leads…" : "Search unavailable"}
              disabled={!canSearchLeads}
              autoComplete="off"
            />
            <kbd className="of-kbd" aria-hidden="true">⌘K</kbd>
          </form>
          <div className="of-bar-actions">
            {themeButton}
            <div className="of-who">
              <span className="of-avatar" aria-hidden="true">{session ? initials(session.email) : "MB"}</span>
              <span>
                <strong>{session?.email || "Office"}</strong>
                <small>{session?.role || "Signed in"}</small>
              </span>
            </div>
          </div>
        </header>
        <div className="of-content">{children}</div>
      </div>
      <button type="button" className="of-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
    </div>
  );
}
