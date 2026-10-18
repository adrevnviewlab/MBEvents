"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/planner/ui";

type Flags = {
  database: boolean;
  email: boolean;
  sms: boolean;
  emailSandbox: boolean;
  payments: boolean;
  mfa: boolean;
  fileStorage: string;
  fileStorageReady: boolean;
};

type AuditEntry = {
  id: string;
  createdAt: string;
  actorEmail: string;
  action: string;
  entity: string;
  subjectId: string;
  ip: string;
};

export function IntegrationStatusPanel({ flags }: { flags: Flags }) {
  return (
    <section className="pl-card" id="integrations">
      <h2>Integration health</h2>
      <p className="pl-intro">Booleans from environment configuration only. This does not send messages or charge cards.</p>
      <table className="pl-admin-table">
        <tbody>
          <tr><th>Database</th><td>{flags.database ? "Configured" : "Missing"}</td></tr>
          <tr><th>Email</th><td>{flags.email ? (flags.emailSandbox ? "Configured (sandbox)" : "Configured") : "Not configured"}</td></tr>
          <tr><th>SMS</th><td>{flags.sms ? "Enabled" : "Off / incomplete"}</td></tr>
          <tr><th>Stripe</th><td>{flags.payments ? "Test mode key present" : "No test key (live keys are refused)"}</td></tr>
          <tr><th>MFA encryption</th><td>{flags.mfa ? "Key present" : "Not configured"}</td></tr>
          <tr><th>File storage</th><td>{flags.fileStorageReady ? flags.fileStorage : `${flags.fileStorage} (not ready)`}</td></tr>
        </tbody>
      </table>
    </section>
  );
}

export function MfaSetupPanel() {
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const begin = async () => {
    setError("");
    setStatus("");
    setRecovery(null);
    try {
      const body = await api<{ secret: string; otpauthUrl: string }>("/api/admin/mfa/setup", { body: {} });
      setSecret(body.secret);
      setOtpauthUrl(body.otpauthUrl);
      setStatus("Scan the authenticator URL or enter the secret, then confirm with a 6-digit code.");
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const confirm = async () => {
    setError("");
    try {
      const body = await api<{ recoveryCodes: string[] }>("/api/admin/mfa/setup", { body: { code } });
      setRecovery(body.recoveryCodes);
      setSecret("");
      setOtpauthUrl("");
      setCode("");
      setStatus("MFA enabled. Store recovery codes offline. Other sessions were signed out.");
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  const disable = async () => {
    setError("");
    try {
      await api("/api/admin/mfa/setup", { body: { disable: true, password, code } });
      setStatus("MFA disabled for this account.");
      setPassword("");
      setCode("");
      setRecovery(null);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  return (
    <section className="pl-card" id="mfa">
      <h2>Authenticator (MFA)</h2>
      <p className="pl-intro">Optional second factor for staff logins. Owner policies are unchanged. Password reset stays on the sign-in page.</p>
      {error && <p className="pl-warn" role="alert">{error}</p>}
      {status && <p className="pl-intro">{status}</p>}
      <div className="pl-add">
        <button type="button" className="pl-btn" onClick={() => void begin()}>Start setup</button>
      </div>
      {secret ? (
        <div className="pl-card">
          <p className="pl-intro"><strong>Secret:</strong> <code>{secret}</code></p>
          <p className="pl-intro" style={{ wordBreak: "break-all" }}><strong>otpauth:</strong> {otpauthUrl}</p>
          <div className="pl-add">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" aria-label="MFA code" />
            <button type="button" className="pl-btn" disabled={code.trim().length < 6} onClick={() => void confirm()}>Confirm MFA</button>
          </div>
        </div>
      ) : null}
      {recovery ? (
        <div className="pl-card">
          <h3 className="pl-h3">Recovery codes</h3>
          <ul>{recovery.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
        </div>
      ) : null}
      <h3 className="pl-h3">Disable MFA</h3>
      <div className="pl-add">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password to disable MFA" />
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Authenticator code" aria-label="Code to disable MFA" />
        <button type="button" className="pl-btn ghost" disabled={!password || !code} onClick={() => void disable()}>Disable</button>
      </div>
    </section>
  );
}

export function AuditLogPanel({ canRead }: { canRead: boolean }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!canRead) return;
    api<{ entries: AuditEntry[] }>("/api/admin/audit")
      .then((body) => { setEntries(body.entries); setError(""); })
      .catch((reason: Error) => { setEntries([]); setError(reason.message); });
  }, [canRead]);

  useEffect(() => { load(); }, [load]);

  if (!canRead) {
    return (
      <section className="pl-card" id="audit">
        <h2>Audit log</h2>
        <p className="pl-intro">Audit history needs a role with audit.read (admin or manager).</p>
      </section>
    );
  }

  return (
    <section className="pl-card" id="audit">
      <h2>Audit log</h2>
      <p className="pl-intro">Recent admin actions. Append-only history — this view does not edit records.</p>
      {error && <p className="pl-warn" role="alert">{error}</p>}
      <div className="of-toolbar">
        <button type="button" className="pl-btn ghost" onClick={load}>Refresh</button>
      </div>
      {entries === null ? <p className="pl-empty">Loading…</p> : null}
      {entries && !entries.length ? <p className="pl-empty">No audit rows yet.</p> : null}
      {entries && entries.length ? (
        <div className="of-table-wrap">
          <table className="pl-admin-table">
            <thead>
              <tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Subject</th></tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.createdAt}</td>
                  <td>{entry.actorEmail}</td>
                  <td>{entry.action}</td>
                  <td>{entry.entity}</td>
                  <td><code>{entry.subjectId.slice(0, 8)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
