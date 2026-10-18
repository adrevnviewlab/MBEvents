"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StaffManager } from "@/components/admin-auth";
import { CrewDesk } from "@/components/office/crew";

export function StaffHub({ canRoster, canManageLogins }: { canRoster: boolean; canManageLogins: boolean }) {
  const params = useSearchParams();
  const initialTab = useMemo(() => {
    const tab = params.get("tab");
    if (tab === "logins" && canManageLogins) return "logins" as const;
    if (canRoster) return "roster" as const;
    return canManageLogins ? "logins" as const : "roster" as const;
  }, [params, canRoster, canManageLogins]);
  const [tab, setTab] = useState<"roster" | "logins">(initialTab);
  const personId = params.get("person") ?? "";

  return (
    <div className="pl">
      <div className="pl-wrap" style={{ paddingBottom: 0 }}>
        <div className="of-toolbar" role="tablist" aria-label="Staff sections">
          {canRoster ? (
            <button type="button" className={`pl-btn ${tab === "roster" ? "" : "ghost"}`} role="tab" aria-selected={tab === "roster"} onClick={() => setTab("roster")}>
              Roster
            </button>
          ) : null}
          {canManageLogins ? (
            <button type="button" className={`pl-btn ${tab === "logins" ? "" : "ghost"}`} role="tab" aria-selected={tab === "logins"} onClick={() => setTab("logins")}>
              Logins
            </button>
          ) : null}
        </div>
      </div>
      {tab === "roster" && canRoster ? <CrewDesk initialPersonId={personId} /> : null}
      {tab === "logins" && canManageLogins ? <StaffManager embedded /> : null}
    </div>
  );
}
