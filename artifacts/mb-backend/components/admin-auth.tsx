"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/planner/ui";

export function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="pl pl-center">
      <form
        className="pl-card pl-login"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/api/admin/login", { body: { email, password } });
            const next = new URLSearchParams(window.location.search).get("next") ?? "";
            window.location.assign(new URL(next.startsWith("/admin") ? next : "/admin/planner", window.location.href));
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <a className="pl-k" href="/">← MB Events</a>
        <h1>MB Admin</h1>
        <p className="pl-intro">Sign in to manage leads and client planners.</p>
        <label className="pl-field"><span>Email</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="pl-field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="pl-warn" role="alert">{error}</p>}
        <button className="pl-btn" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
      </form>
    </div>
  );
}

export function AdminSignOut() {
  return (
    <button
      className="pl-link"
      onClick={async () => {
        await api("/api/admin/login", { method: "DELETE" }).catch(() => {});
        window.location.assign(new URL("/admin/login", window.location.href));
      }}
    >
      Sign out
    </button>
  );
}

type Staff = { email: string; name: string; created_at: string };

export function StaffManager() {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [form, setForm] = useState({ email: "", name: "" });
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api<{ staff: Staff[] }>("/api/admin/staff").then((r) => setStaff(r.staff)).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);
  const add = async (email: string, name: string) => {
    setError("");
    try {
      setCreds(await api<{ email: string; password: string }>("/api/admin/staff", { body: { email, name } }));
      setForm({ email: "", name: "" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="pl">
      <div className="pl-wrap narrow">
        <div className="pl-top"><a href="/admin/planner">← Client planners</a><span>MB Admin · Staff</span><AdminSignOut /></div>
        <header className="pl-hero"><h1>Staff logins</h1><p className="pl-intro">Staff can manage leads and client planners. Only the owner can add or remove staff.</p></header>
        {creds && (
          <div className="pl-creds" role="status">
            Login for <code>{creds.email}</code>. The password is shown only once:<br />
            Sign-in page: <code>{window.location.origin}/admin/login</code><br />
            Password: <code>{creds.password}</code>
          </div>
        )}
        {error && <p className="pl-warn">{error}</p>}
        <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); add(form.email, form.name); }}>
          <label className="pl-field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="pl-field"><span>Email</span><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <div className="wide"><button className="pl-btn">Add staff login</button></div>
        </form>
        <div className="pl-card">
          {staff === null ? <p className="pl-empty">Loading...</p> : staff.length ? staff.map((s) => (
            <div className="pl-row" key={s.email}>
              <span className="t"><strong>{s.name || s.email}</strong> <small>{s.email}</small></span>
              <span className="pl-rowtools">
                <button onClick={() => confirm(`Reset the password for ${s.email}?`) && add(s.email, s.name)}>Reset password</button>
                <button className="danger" onClick={async () => { if (!confirm(`Remove ${s.email}?`)) return; await api(`/api/admin/staff?email=${encodeURIComponent(s.email)}`, { method: "DELETE" }).catch((e) => setError(e.message)); load(); }}>Remove</button>
              </span>
            </div>
          )) : <p className="pl-empty">No staff logins yet.</p>}
        </div>
      </div>
    </div>
  );
}
