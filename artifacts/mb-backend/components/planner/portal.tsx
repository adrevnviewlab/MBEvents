"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlannerData } from "@/lib/planner";
import { checklistProgress } from "@/lib/planner";
import { api, beginTimed, loadFailure } from "./ui";
import * as S from "./sections";

const TABS = [
  ["Overview", S.Overview],
  ["Details", S.Details],
  ["Planning form", S.PlanningForm],
  ["Music", S.Music],
  ["Guest requests", S.GuestRequests],
  ["Timeline", S.Timeline],
  ["Checklist", S.Checklist],
  ["Guests", S.Guests],
  ["Team", S.Team],
  ["Documents", S.Documents],
  ["Payments", S.Payments],
  ["Messages", S.Messages],
  ["Evaluation", S.Evaluation],
] as const;
type Tab = (typeof TABS)[number][0];

const TAB_BLOCK: Partial<Record<Tab, string>> = {
  Details: "details",
  "Planning form": "forms",
  Music: "songs",
  "Guest requests": "requests",
  Timeline: "timeline",
  Checklist: "checklist",
  Guests: "guests",
  Team: "team",
  Documents: "documents",
  Payments: "payments",
  Messages: "messages",
  Evaluation: "evaluation",
};

function visibleTabs(blocks: string[] | undefined) {
  if (!blocks?.length) return TABS;
  const allowed = new Set(blocks);
  return TABS.filter(([name]) => name === "Overview" || allowed.has(TAB_BLOCK[name] ?? ""));
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function Planner() {
  const [bundle, setBundle] = useState<S.Bundle | null>(null);
  const [state, setState] = useState<"loading" | "login" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>(() => {
    // Safe during SSR: the first paint is the loading screen either way.
    const t = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
    return (TABS.find(([name]) => name === t)?.[0] ?? "Overview") as Tab;
  });
  const [save, setSave] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const inflight = useRef(0);

  const reload = useCallback(async (signal?: AbortSignal) => {
    const linked = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("code")?.trim() ?? "";
    const openLinked = async () => {
      await api("/api/planner/login", { body: { code: linked } });
      setBundle(await api<S.Bundle>("/api/planner", { signal }));
      setState("ready");
    };
    try {
      const current = await api<S.Bundle>("/api/planner", { signal });
      if (process.env.NODE_ENV === "development" && linked && current.code !== linked) {
        await openLinked();
        return;
      }
      setBundle(current);
      setState("ready");
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        if (process.env.NODE_ENV === "development" && linked) {
          try {
            await openLinked();
            return;
          } catch {
            setState("login");
            return;
          }
        }
        setState("login");
        return;
      }
      const message = loadFailure(e, signal);
      if (!message) return;
      setLoadError(message);
      setState("error");
    }
  }, []);

  const start = useCallback(() => {
    setLoadError("");
    setState("loading");
    return beginTimed((signal) => reload(signal));
  }, [reload]);

  useEffect(() => {
    const run = start();
    return run.cancel;
  }, [start]);

  // Keep the active section visible in the scrolling mobile menu.
  useEffect(() => {
    document.querySelector(".pl-nav .on")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [tab, state]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(timers.current).length || inflight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // Optimistic local update, debounced save per section.
  const set = useCallback(<K extends keyof PlannerData>(section: K, value: PlannerData[K]) => {
    setBundle((b) => (b ? { ...b, data: { ...b.data, [section]: value } } : b));
    setSave("saving");
    clearTimeout(timers.current[section]);
    timers.current[section] = setTimeout(async () => {
      delete timers.current[section];
      inflight.current += 1;
      try {
        await api("/api/planner", { method: "PATCH", body: { section, value } });
        if (!Object.keys(timers.current).length && inflight.current === 1) setSave("saved");
      } catch (e) {
        setSaveError((e as Error).message);
        setSave("error");
        if ((e as { status?: number }).status === 401) setState("login");
      } finally {
        inflight.current -= 1;
      }
    }, 700);
  }, []);

  const go = (t: string) => {
    setTab(t as Tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    url.searchParams.delete("payment");
    window.history.replaceState(null, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (t === "Messages" && bundle?.messages.some((m) => m.sender === "mb" && !m.read_at)) {
      api("/api/planner/messages", { method: "PATCH" }).then(() => reload()).catch(() => {});
    }
  };

  const logout = async () => {
    await api("/api/planner/login", { method: "DELETE" }).catch(() => {});
    setBundle(null);
    setState("login");
  };

  if (state === "loading") return <div className="pl pl-center"><p className="pl-sub">Loading your planner...</p></div>;
  if (state === "error") {
    return (
      <div className="pl pl-center">
        <div className="pl-card pl-login">
          <p className="pl-warn" role="alert">{loadError}</p>
          <button className="pl-btn" onClick={() => start()}>Try again</button>
        </div>
      </div>
    );
  }
  if (state === "login" || !bundle) return <Login onDone={reload} />;

  const d = bundle.data.details;
  const progress = checklistProgress(bundle.data.checklist);
  const percent = Math.round(progress.ratio * 100);
  const badges: Partial<Record<Tab, number>> = {
    Messages: bundle.messages.filter((m) => m.sender === "mb" && !m.read_at).length,
    Documents: bundle.admin.documents.filter((x) => x.status === "sent").length,
    "Guest requests": bundle.requests.filter((r) => r.status === "pending").length,
  };
  const tabs = visibleTabs(bundle.data.blocks);
  const active = tabs.some(([name]) => name === tab) ? tab : "Overview";
  const Current = tabs.find(([name]) => name === active)?.[1] ?? tabs[0][1];

  return (
    <div className="pl">
      <div className="pl-wrap">
        <div className="pl-top no-print">
          <a href="/">← MB Events</a>
          <span className={`pl-save ${save}`} role="status">{save === "saving" ? "Saving..." : save === "saved" ? "All changes saved" : save === "error" ? `Not saved: ${saveError}` : ""}</span>
          <button className="pl-link" onClick={logout}>Sign out</button>
        </div>
        <header className="pl-hero">
          <div className="pl-k">MB Planner · {bundle.code}</div>
          <h1>{d.clientNames || "Your event"}</h1>
          <div className="pl-sub">{[d.eventType, d.eventDate && new Date(`${d.eventDate}T12:00:00`).toLocaleDateString("en-US", { dateStyle: "long" }), d.venueName].filter(Boolean).join(" · ")}</div>
          <div className="pl-bar" aria-label={`Planning progress ${percent}%`}><i style={{ width: `${percent}%` }} /></div>
          <div className="pl-sub">Planning progress {progress.done} of {progress.total}</div>
        </header>
        <div className="pl-layout">
          <nav className="pl-nav no-print" aria-label="Planner sections">
            {tabs.map(([name]) => (
              <button key={name} className={name === active ? "on" : ""} aria-current={name === active ? "page" : undefined} onClick={() => go(name)}>
                {name}
                {!!badges[name] && <b>{badges[name]}</b>}
              </button>
            ))}
          </nav>
          <main className="pl-main">
            <Current bundle={bundle} set={set} reload={reload} go={go} />
          </main>
        </div>
      </div>
    </div>
  );
}

function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [code, setCode] = useState("");
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
            await api("/api/planner/login", { body: { code, password } });
            await onDone();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <a className="pl-k" href="/">← MB Events</a>
        <h1>Client planner</h1>
        <p className="pl-intro">{process.env.NODE_ENV === "development" ? "Enter the event code. No password is required on this local server." : "Sign in with the event code and password MB sent you."}</p>
        <label className="pl-field"><span>Event code</span><input value={code} autoComplete="username" placeholder="MB-XXXXXX" onChange={(e) => setCode(e.target.value)} /></label>
        {process.env.NODE_ENV !== "development" && <label className="pl-field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        {error && <p className="pl-warn" role="alert">{error}</p>}
        <button className="pl-btn" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        <p className="pl-sub">No login yet? <a href="/contact">Contact MB</a> or call (855) 627-6863.</p>
        <p className="pl-sub">Here to request a song? <a href="/planner/guest">Guest requests</a></p>
      </form>
    </div>
  );
}
