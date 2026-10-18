"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/planner/ui";

export function AdminLogin() {
  const [mode, setMode] = useState<"password" | "mfa" | "recover" | "reset">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset")) {
      setResetToken(params.get("reset") ?? "");
      setMode("reset");
    }
    if (params.get("reason") === "role") setNotice("That account can't open the office tools.");
  }, []);
  const go = (home?: string) => {
    const next = new URLSearchParams(window.location.search).get("next") ?? "";
    const dest = home === "/staff" ? "/staff" : next.startsWith("/admin") ? next : home || "/admin";
    window.location.assign(new URL(dest, window.location.href));
  };
  return (
    <div className="pl pl-center">
      <form
        className="pl-card pl-login"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          try {
            if (mode === "recover") {
              await api("/api/admin/recover", { body: { email } });
              setNotice("If that account can be reset by email, a link is on its way.");
              setMode("password");
            } else if (mode === "reset") {
              await api("/api/admin/recover", { body: { token: resetToken, password } });
              setNotice("Password updated. Sign in with the new one.");
              setMode("password");
              setPassword("");
            } else if (mode === "mfa") {
              const result = await api<{ home?: string }>("/api/admin/mfa", { body: { challenge, code } });
              go(result.home);
            } else {
              const result = await api<{ ok?: boolean; home?: string; mfaRequired?: boolean; challenge?: string }>("/api/admin/login", { body: { email, password } });
              if (result.mfaRequired && result.challenge) {
                setChallenge(result.challenge);
                setMode("mfa");
                setCode("");
              } else go(result.home);
            }
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <a className="pl-k of-login-brand" href="/">
          <img src="/assets/mb-events-logo.png" alt="Michael Bryan Events" width={200} height={54} />
        </a>
        <h1>Admin</h1>
        <p className="pl-intro">
          {mode === "mfa" ? "Enter the code from your authenticator app, or a recovery code." : mode === "recover" ? "We'll email a reset link if this account has a password." : mode === "reset" ? "Choose a new password of at least 10 characters." : "Sign in to manage leads and client planners."}
        </p>
        {mode !== "mfa" && mode !== "reset" && <label className="pl-field"><span>Email</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>}
        {(mode === "password" || mode === "reset") && <label className="pl-field"><span>Password</span><input type="password" autoComplete={mode === "reset" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        {mode === "mfa" && <label className="pl-field"><span>Code</span><input inputMode="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>}
        {notice && <p className="pl-intro" role="status">{notice}</p>}
        {error && <p className="pl-warn" role="alert">{error}</p>}
        <button className="pl-btn" disabled={busy}>{busy ? "Working..." : mode === "recover" ? "Email reset link" : mode === "reset" ? "Save password" : mode === "mfa" ? "Verify" : "Sign in"}</button>
        {mode === "password" && <button type="button" className="pl-link" onClick={() => { setMode("recover"); setError(""); }}>Forgot password</button>}
        {mode !== "password" && <button type="button" className="pl-link" onClick={() => { setMode("password"); setError(""); }}>Back to sign in</button>}
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

type Staff = { email: string; name: string; role: string; created_at: string };

export function StaffManager({ embedded = false }: { embedded?: boolean }) {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [form, setForm] = useState({ email: "", name: "", role: "coordinator" });
  const [creds, setCreds] = useState<{ email: string; password: string; role?: string } | null>(null);
  const [officeOrigin, setOfficeOrigin] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => api<{ staff: Staff[] }>("/api/admin/staff").then((r) => setStaff(r.staff)).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
    setOfficeOrigin(window.location.origin);
  }, [load]);
  const add = async (email: string, name: string, role: string) => {
    setError("");
    try {
      setCreds(await api<{ email: string; password: string; role: string }>("/api/admin/staff", { body: { email, name, role } }));
      setForm({ email: "", name: "", role: "coordinator" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const body = (
    <>
      <header className="pl-hero"><h1>Staff logins</h1><p className="pl-intro">These are office logins. Coordinators can manage leads and client planners. Sales, managers, and event-day staff are limited to what that role allows. Talent profiles and assignments are kept on each event, not as a separate marketplace. Full roster tools live under <a href="/admin/staff">Staff</a>.</p></header>
      {creds && (
        <div className="pl-creds" role="status">
          Login for <code>{creds.email}</code>.<br />
          Office: <code>{officeOrigin || ""}/admin</code><br />
          {creds.password ? (
            <>
              Temporary password: <code>{creds.password}</code>
              <br />
              Copy it now — it is not shown again after you leave this page.
            </>
          ) : null}
        </div>
      )}
      {error && <p className="pl-warn" role="alert">{error}</p>}
      <form className="pl-card pl-form" onSubmit={(e) => { e.preventDefault(); add(form.email, form.name, form.role); }}>
        <label className="pl-field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Name" /></label>
        <label className="pl-field"><span>Email</span><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="Email" /></label>
        <label className="pl-field"><span>Role</span>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} aria-label="Role">
            <option value="coordinator">Coordinator</option>
            <option value="manager">Manager</option>
            <option value="sales">Sales</option>
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <div className="wide"><button className="pl-btn" type="submit">Add staff login</button></div>
      </form>
      <p className="pl-intro"><a href="/admin/planner">Open events</a> to assign someone to a booking.</p>
      <div className="pl-card">
        {staff === null ? <p className="pl-empty">Loading…</p> : staff.length ? staff.map((s) => (
          <div className="pl-row" key={s.email}>
            <span className="t"><strong>{s.name || s.email}</strong> <small>{s.email} · {s.role}</small></span>
            <span className="pl-rowtools">
              <button type="button" onClick={() => confirm(`Reset the password for ${s.email}? A new temporary password will appear above.`) && add(s.email, s.name, s.role)}>Reset password</button>
              <button type="button" className="danger" onClick={async () => { if (!confirm(`Remove ${s.email}?`)) return; await api(`/api/admin/staff?email=${encodeURIComponent(s.email)}`, { method: "DELETE" }).catch((e) => setError(e.message)); load(); }}>Remove</button>
            </span>
          </div>
        )) : <p className="pl-empty">No staff logins yet.</p>}
      </div>
    </>
  );
  if (embedded) {
    return <section className="pl-card" id="staff-logins">{body}</section>;
  }
  return (
    <div className="pl">
      <div className="pl-wrap narrow">
        <div className="pl-top"><a href="/admin/planner">← Client planners</a><span>MB Admin · Staff</span><AdminSignOut /></div>
        {body}
      </div>
    </div>
  );
}
