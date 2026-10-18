"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { musicLibrary } from "@/lib/music-db";
import { api, beginTimed, fmtDate, loadFailure } from "./ui";

type Info = { guestCode: string; eventType: string; clientNames: string; eventDate: string; open: boolean; requests: { title: string; artist: string; status: string }[] };

export function GuestRequests() {
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<"loading" | "login" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("t")?.trim() ?? "";
    const linked = params.get("code")?.trim().toUpperCase() ?? "";
    const linkedPw = params.get("pw")?.trim() ?? "";
    const quiet = async <T,>(request: Promise<T>) => request.catch((e: unknown) => {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) return null;
      throw e;
    });
    const gt = params.get("gt")?.trim() ?? "";
    const infoPath = `/api/planner/guest/requests${gt ? `?gt=${encodeURIComponent(gt)}` : ""}`;
    const fetchInfo = () => quiet(api<Info>(infoPath, { signal }));
    let next = await fetchInfo();
    if (token) {
      // The link is the source of truth, even when an older guest session exists.
      if (next) await quiet(api("/api/planner/guest/login", { method: "DELETE", signal }));
      next = await quiet(api("/api/planner/guest/login", { body: { token }, signal }).then(() => api<Info>("/api/planner/guest/requests", { signal })));
    } else if (next && linked && linked !== next.guestCode) {
      await quiet(api("/api/planner/guest/login", { method: "DELETE", signal }));
      next = null;
    }
    // Older links put the guest password in the query string. Sign in, then drop it from the address bar.
    if (!next && linked && (linkedPw || process.env.NODE_ENV === "development")) {
      next = await quiet(api("/api/planner/guest/login", { body: { code: linked, password: linkedPw }, signal }).then(() => api<Info>(infoPath, { signal })));
    }
    if (next && linkedPw) {
      const url = new URL(window.location.href);
      url.searchParams.delete("pw");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (next) {
      setInfo(next);
      setState("ready");
    } else {
      setState("login");
    }
  }, []);

  const start = useCallback(() => {
    setLoadError("");
    setState("loading");
    return beginTimed(async (signal) => {
      try {
        await load(signal);
      } catch (e) {
        const message = loadFailure(e, signal);
        if (!message) return;
        setLoadError(message);
        setState("error");
      }
    });
  }, [load]);

  useEffect(() => {
    const run = start();
    return run.cancel;
  }, [start]);

  if (state === "loading") return <div className="pl pl-center"><p className="pl-sub">Loading...</p></div>;
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
  if (state === "login" || !info) return <GuestLogin onDone={load} />;
  return <GuestForm info={info} reload={load} />;
}

function GuestLogin({ onDone }: { onDone: () => Promise<void> }) {
  const [code, setCode] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("code") ?? ""));
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
            await api("/api/planner/guest/login", { body: { code, password } });
            await onDone();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <a className="pl-k" href="/">← MB Events</a>
        <h1>Request a song</h1>
        <p className="pl-intro">{process.env.NODE_ENV === "development" ? "Enter the guest code. No password is required on this local server." : "Enter the guest code and password from the hosts."}</p>
        <label className="pl-field"><span>Guest code</span><input value={code} placeholder="G-XXXXXX" onChange={(e) => setCode(e.target.value)} /></label>
        {process.env.NODE_ENV !== "development" && <label className="pl-field"><span>Password</span><input value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        {error && <p className="pl-warn" role="alert">{error}</p>}
        <button className="pl-btn" disabled={busy}>{busy ? "Checking..." : "Continue"}</button>
      </form>
    </div>
  );
}

function GuestForm({ info, reload }: { info: Info; reload: () => Promise<void> }) {
  const [guestName, setGuestName] = useState("");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const suggestions = useMemo(() => {
    const t = title.trim().toLowerCase();
    return t.length < 2 ? [] : musicLibrary.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(t)).slice(0, 6);
  }, [title]);

  return (
    <div className="pl">
      <div className="pl-wrap narrow">
        <div className="pl-top">
          <a href="/">← MB Events</a>
          <button className="pl-link" onClick={async () => { await api("/api/planner/guest/login", { method: "DELETE" }).catch(() => {}); window.location.reload(); }}>Not your event? Switch</button>
        </div>
        <header className="pl-hero">
          <div className="pl-k">{[info.eventType, info.clientNames, fmtDate(info.eventDate)].filter(Boolean).join(" · ")}</div>
          <h1>Request a song</h1>
          <p className="pl-intro">Add the songs you want to hear. The hosts review every request before it goes to the DJ.</p>
        </header>
        {info.open ? (
          <form
            className="pl-card pl-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMsg("");
              try {
                const gt = new URLSearchParams(window.location.search).get("gt")?.trim() ?? "";
                await api("/api/planner/guest/requests", { body: { guestName, title, artist, note, ...(gt ? { inviteToken: gt } : {}) } });
                setTitle(""); setArtist(""); setNote("");
                setMsg("Request sent! Add another anytime.");
                await reload();
              } catch (err) {
                setMsg((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="pl-field wide"><span>Your name</span><input required value={guestName} onChange={(e) => setGuestName(e.target.value)} /></label>
            <label className="pl-field"><span>Song</span><input required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="pl-field"><span>Artist</span><input value={artist} onChange={(e) => setArtist(e.target.value)} /></label>
            {!!suggestions.length && (
              <div className="pl-suggest wide">
                {suggestions.map((s) => <button type="button" key={s.title + s.artist} onClick={() => { setTitle(s.title); setArtist(s.artist); }}>{s.title} <small>{s.artist}</small></button>)}
              </div>
            )}
            <label className="pl-field wide"><span>Dedication or note (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
            {msg && <p className="pl-ok wide" role="status">{msg}</p>}
            <button className="pl-btn" disabled={busy}>{busy ? "Sending..." : "Send request"}</button>
          </form>
        ) : (
          <p className="pl-warn">Song requests are closed for this event.</p>
        )}
        <h3 className="pl-h3">Requested so far</h3>
        <div className="pl-card">
          {info.requests.length ? info.requests.map((r, i) => (
            <div className="pl-row" key={i}><span className="t"><strong>{r.title}</strong> <small>{r.artist}</small></span><span className={`pl-tag ${r.status === "approved" ? "ok" : ""}`}>{r.status}</span></div>
          )) : <p className="pl-empty">Be the first to request a song.</p>}
        </div>
      </div>
    </div>
  );
}
