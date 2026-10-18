import { env } from "@/lib/env";
import { can } from "@/lib/authz";
import { getActor, requireAdminPage } from "@/lib/admin";
import { integrationFlags } from "@/lib/config";
import { listStages } from "@/lib/crm";
import { StaffManager } from "@/components/admin-auth";
import { LeadStagesEditor } from "@/components/lead-stages-editor";
import { BusinessSettingsPanel } from "@/components/office/business-settings";
import { AuditLogPanel, IntegrationStatusPanel, MfaSetupPanel } from "@/components/office/settings-extras";
import { TemplatesPanel } from "@/components/planner/admin";
import { CatalogPanel } from "@/components/planner/finance-admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings | MB Admin", robots: { index: false, follow: false } };

export default async function SettingsPage() {
  const actor = await getActor();
  await requireAdminPage("/admin/settings", "settings.read");
  const manage = !!actor && can(actor.role, "users.manage");
  const auditRead = !!actor && can(actor.role, "audit.read");
  const flags = integrationFlags();
  let stages: Awaited<ReturnType<typeof listStages>> = [];
  let stagesError = false;
  if (manage && env.DB) {
    try {
      stages = await listStages();
    } catch (error) {
      console.error("Lead stages failed", error);
      stagesError = true;
    }
  }
  return (
    <div className="pl">
      <div className="pl-wrap">
        <header className="pl-hero">
          <div className="pl-k">Office</div>
          <h1>Settings</h1>
          <p className="pl-intro">
            Company profile, booking policies, staff access, MFA, integrations, audit history, lead stages, planning templates, and the pricing catalog.
            Customer quotes use only approved and published prices. Booking rules are not changed here beyond owner-gated policies.
          </p>
        </header>
        <nav className="of-toolbar" aria-label="Settings sections">
          <a className="pl-btn ghost" href="#company">Company</a>
          <a className="pl-btn ghost" href="#integrations">Integrations</a>
          <a className="pl-btn ghost" href="#mfa">MFA</a>
          <a className="pl-btn ghost" href="#audit">Audit</a>
          <a className="pl-btn ghost" href="/admin/staff">Staff roster</a>
        </nav>
        <div id="company">
          <BusinessSettingsPanel />
        </div>
        <IntegrationStatusPanel flags={flags} />
        <MfaSetupPanel />
        <AuditLogPanel canRead={auditRead} />
        {manage ? <StaffManager embedded /> : <p className="pl-intro">Staff logins need a login that can manage users. Roster and roles for crew live under <a href="/admin/staff">Staff</a>.</p>}
        {manage && stagesError && <p className="pl-warn">Lead stages are temporarily unavailable.</p>}
        {manage && stages.length > 0 && (
          <LeadStagesEditor key={stages.map((stage) => `${stage.key}:${stage.label}:${stage.position}:${stage.active}`).join("|")} stages={stages} />
        )}
        <TemplatesPanel />
        <CatalogPanel />
      </div>
    </div>
  );
}
