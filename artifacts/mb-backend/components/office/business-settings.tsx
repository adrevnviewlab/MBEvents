"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Field, Section, Text } from "@/components/planner/ui";

type Settings = {
  companyName: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  timezone: string;
  oneEventPerDate: boolean;
  requireOwnerConfirm: boolean;
  requireStaffBeforeConfirm: boolean;
  depositDueDays: number | null;
  ownerEmail: string;
  updatedAt: string | null;
  updatedBy: string;
};

type Payload = { settings: Settings; canEdit: boolean; ownerEmail: string };

const timezones = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Pacific/Honolulu",
  "UTC",
];

export function BusinessSettingsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [dueDays, setDueDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(() => {
    api<Payload>("/api/admin/settings/business").then((payload) => {
      setData(payload);
      setDraft(payload.settings);
      setDueDays(payload.settings.depositDueDays == null ? "" : String(payload.settings.depositDueDays));
      setLoadError("");
    }).catch((reason: Error) => {
      setData(null);
      setDraft(null);
      setLoadError(reason.message || "Could not load company settings.");
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  if (loadError) {
    return (
      <Section eyebrow="Company" title="Business profile and booking policies" intro="Company policy and owner gates.">
        <p className="pl-warn" role="alert">{loadError}</p>
        <button type="button" className="pl-btn ghost" onClick={load}>Retry</button>
      </Section>
    );
  }
  if (!data || !draft) {
    return (
      <Section eyebrow="Company" title="Business profile and booking policies" intro="Company policy and owner gates.">
        <p className="pl-empty">Loading company settings…</p>
      </Section>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      const depositDueDays = dueDays.trim() === "" ? null : Number(dueDays);
      if (dueDays.trim() !== "" && (!Number.isInteger(depositDueDays) || (depositDueDays as number) < 0)) {
        alert("Deposit due days must be blank or a whole number.");
        return;
      }
      await api("/api/admin/settings/business", {
        method: "PUT",
        body: {
          companyName: draft.companyName,
          contactEmail: draft.contactEmail,
          contactPhone: draft.contactPhone,
          contactAddress: draft.contactAddress,
          timezone: draft.timezone,
          oneEventPerDate: true,
          requireOwnerConfirm: draft.requireOwnerConfirm,
          requireStaffBeforeConfirm: draft.requireStaffBeforeConfirm,
          depositDueDays,
        },
      });
      await load();
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      eyebrow="Company"
      title="Business profile and booking policies"
      intro="The owner account is the email in MB_ADMIN_EMAIL. Company policy is one active hold or confirmed booking per calendar date. Multiple inquiries may share a date. Hold expiration is chosen per event. Ordinary staff cannot confirm bookings or change these policies."
    >
      <div className="pl-card">
        <p className="pl-intro">Owner account: <strong>{data.ownerEmail || "Set MB_ADMIN_EMAIL on the host"}</strong></p>
        <div className="pl-form">
          <Field label="Company name"><Text value={draft.companyName} onChange={(value) => setDraft({ ...draft, companyName: value })} disabled={!data.canEdit} /></Field>
          <Field label="Contact email"><Text value={draft.contactEmail} onChange={(value) => setDraft({ ...draft, contactEmail: value })} disabled={!data.canEdit} /></Field>
          <Field label="Contact phone"><Text value={draft.contactPhone} onChange={(value) => setDraft({ ...draft, contactPhone: value })} disabled={!data.canEdit} /></Field>
          <Field label="Address"><Text value={draft.contactAddress} onChange={(value) => setDraft({ ...draft, contactAddress: value })} disabled={!data.canEdit} /></Field>
          <Field label="Business timezone">
            <select
              value={draft.timezone}
              disabled={!data.canEdit}
              onChange={(event) => setDraft({ ...draft, timezone: event.target.value, oneEventPerDate: event.target.value ? draft.oneEventPerDate : false })}
              aria-label="Business timezone"
            >
              <option value="">Not set yet</option>
              {timezones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              {draft.timezone && !timezones.includes(draft.timezone) && <option value={draft.timezone}>{draft.timezone}</option>}
            </select>
          </Field>
          <Field label="Deposit due days after quote">
            <Text value={dueDays} placeholder="Blank until Michael sets a rule" onChange={setDueDays} disabled={!data.canEdit} />
          </Field>
          <label className="pl-check wide">
            <input type="checkbox" checked readOnly disabled />
            One active event per business calendar date (company policy — always on)
          </label>
          <label className="pl-check wide">
            <input type="checkbox" checked={draft.requireOwnerConfirm} disabled={!data.canEdit} onChange={(event) => setDraft({ ...draft, requireOwnerConfirm: event.target.checked })} />
            Owner must confirm bookings
          </label>
          <label className="pl-check wide">
            <input type="checkbox" checked={draft.requireStaffBeforeConfirm} disabled={!data.canEdit} onChange={(event) => setDraft({ ...draft, requireStaffBeforeConfirm: event.target.checked })} />
            Require staff assignment before confirmation
          </label>
          {data.canEdit && (
            <div className="wide">
              <button className="pl-btn" type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save company settings"}</button>
            </div>
          )}
          {!data.canEdit && <p className="pl-intro wide">Booking policies are owner-only. Ask the owner to update them.</p>}
        </div>
        {draft.updatedAt && <p className="pl-intro">Last saved {draft.updatedAt}{draft.updatedBy ? ` by ${draft.updatedBy}` : ""}.</p>}
      </div>
    </Section>
  );
}
