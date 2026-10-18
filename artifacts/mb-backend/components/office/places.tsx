"use client";

import { useEffect, useState } from "react";
import { VenueDesk } from "@/components/office/venues";
import { VendorDesk } from "@/components/office/vendors";

type Tab = "venues" | "vendors";

function tabFromUrl(): Tab {
  if (typeof window === "undefined") return "venues";
  const value = new URLSearchParams(window.location.search).get("tab");
  return value === "vendors" || value === "partners" ? "vendors" : "venues";
}

export function PlacesOffice() {
  const [which, setWhich] = useState<Tab>("venues");

  useEffect(() => {
    setWhich(tabFromUrl());
  }, []);

  const select = (tab: Tab) => {
    setWhich(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", `${url.pathname}?tab=${tab}`);
  };

  return (
    <div className="pl">
      <div className="pl-wrap" style={{ paddingBottom: 0 }}>
        <header className="of-crm-header">
          <div>
            <p className="of-ecr-kicker">Directory</p>
            <h1>Venues & vendors</h1>
            <p>
              One office directory for venue records and preferred partners. Deep links to{" "}
              <a href="/admin/venues">/admin/venues</a> and <a href="/admin/vendors">/admin/vendors</a> still work.
              MB Events only shows bookings and assignments stored here — not third-party venue calendars or invented vendor balances.
            </p>
          </div>
          <div className="of-crm-header-actions">
            <a className="pl-btn sm ghost" href="/admin/calendar">Calendar</a>
          </div>
        </header>
        <div className="of-seg" role="tablist" aria-label="Directory">
          <button type="button" role="tab" aria-selected={which === "venues"} className={`of-surface${which === "venues" ? " is-on" : ""}`} onClick={() => select("venues")}>Venues</button>
          <button type="button" role="tab" aria-selected={which === "vendors"} className={`of-surface${which === "vendors" ? " is-on" : ""}`} onClick={() => select("vendors")}>Vendors</button>
        </div>
      </div>
      {which === "venues" ? <VenueDesk embedded /> : <VendorDesk embedded />}
    </div>
  );
}
