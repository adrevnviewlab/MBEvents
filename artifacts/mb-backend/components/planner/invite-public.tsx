"use client";

import { useEffect, useState } from "react";
import { api, fmtDate } from "./ui";

type Question = { id: string; label: string };
type Invite = {
  slug: string;
  title: string;
  message: string;
  mode: string;
  plusOneCap: number;
  rsvpDeadline: string | null;
  involvesMinors: boolean;
  theme: { color: string; accent: string; image: string };
  questions: Question[];
  event: { name: string; eventType: string; eventDate: string; startTime: string; endTime: string };
  guest: { rsvp: string; plusOnes: number; answers: { questionId: string; value: string }[] } | null;
};
type Media = { fileId: string; filename: string; contentType: string };

function useToken() {
  const [token, setToken] = useState("");
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("t")?.trim() ?? "");
  }, []);
  return token;
}

export function InvitePage({ slug }: { slug: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"yes" | "no">("yes");
  const [plusOnes, setPlusOnes] = useState(0);
  const [note, setNote] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("t")?.trim() ?? "";
    setToken(next);
    const query = next ? `?t=${encodeURIComponent(next)}` : "";
    api<Invite>(`/api/invites/${encodeURIComponent(slug)}${query}`)
      .then((body) => {
        setInvite(body);
        setPlusOnes(body.guest?.plusOnes ?? 0);
        setStatus(body.guest?.rsvp === "no" ? "no" : "yes");
        const saved: Record<string, string> = {};
        for (const answer of body.guest?.answers ?? []) saved[answer.questionId] = answer.value;
        setAnswers(saved);
        setState("ready");
      })
      .catch((err: Error) => {
        setError(err.message);
        setState("error");
      });
  }, [slug]);

  if (state === "loading") return <div className="pl pl-center"><p className="pl-sub">Loading...</p></div>;
  if (state === "error" || !invite) {
    return <div className="pl pl-center"><div className="pl-card pl-login"><p className="pl-warn" role="alert">{error || "This invitation is not available."}</p></div></div>;
  }
  const theme = invite.theme;
  return (
    <div className="pl" style={theme.color ? { background: theme.color } : undefined}>
      <div className="pl-wrap narrow">
        <div className="pl-top"><a href="/">← MB Events</a></div>
        <header className="pl-hero">
          <div className="pl-k">{[invite.event.eventType, invite.event.name, fmtDate(invite.event.eventDate), invite.event.startTime].filter(Boolean).join(" · ")}</div>
          <h1>{invite.title || invite.event.name || "Invitation"}</h1>
          {invite.message && <p className="pl-intro">{invite.message}</p>}
          {theme.image && <img src={theme.image} alt="" />}
        </header>
        {token ? (
          <form className="pl-card pl-form" onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setMsg("");
            try {
              await api("/api/invites/rsvp", { body: { token, status, plusOnes, note, answers: invite.questions.map((question) => ({ questionId: question.id, value: answers[question.id] ?? "" })) } });
              setMsg("Response saved.");
            } catch (err) {
              setMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}>
            <label className="pl-field"><span>RSVP</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as "yes" | "no")}>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="pl-field"><span>Plus-ones</span><input type="number" min={0} max={invite.plusOneCap} value={plusOnes} onChange={(event) => setPlusOnes(Number(event.target.value) || 0)} /></label>
            {invite.questions.map((question) => (
              <label className="pl-field wide" key={question.id}><span>{question.label}</span><input value={answers[question.id] ?? ""} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} /></label>
            ))}
            <label className="pl-field wide"><span>Note</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
            {invite.rsvpDeadline && <p className="pl-sub wide">Respond by {fmtDate(invite.rsvpDeadline.slice(0, 10))}</p>}
            {msg && <p className={msg === "Response saved." ? "pl-ok wide" : "pl-warn wide"} role="status">{msg}</p>}
            <button className="pl-btn" style={theme.accent ? { background: theme.accent } : undefined} disabled={busy}>{busy ? "Saving..." : "Send RSVP"}</button>
          </form>
        ) : (
          <p className="pl-intro">Your personal link is required to RSVP.</p>
        )}
        {token && (
          <div className="pl-card">
            <a href={`/planner/guest?gt=${encodeURIComponent(token)}`}>Request a song</a>
            <form onSubmit={async (event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("file");
              if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
              const body = new FormData();
              body.set("token", token);
              body.set("file", input.files[0]);
              setBusy(true);
              try {
                const res = await fetch("/api/invites/media", { method: "POST", body });
                const json = (await res.json().catch(() => ({}))) as { error?: string };
                if (!res.ok) throw new Error(json.error || "Upload failed.");
                setMsg("Photo sent. It stays hidden until the host approves it.");
                input.value = "";
              } catch (err) {
                setMsg((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}>
              <label className="pl-field"><span>Photo or video</span><input name="file" type="file" accept="image/*,video/*" /></label>
              <button className="pl-btn ghost" type="submit">Upload</button>
            </form>
            <p><a href={`/invite/${slug}/gallery${token ? `?t=${encodeURIComponent(token)}` : ""}`}>Photos</a> · <a href={`/invite/check-in?t=${encodeURIComponent(token)}`}>Check in</a></p>
          </div>
        )}
        {!token && invite.mode === "public" && <p><a href={`/invite/${slug}/gallery`}>Photos</a></p>}
      </div>
    </div>
  );
}

export function CheckInPage() {
  const token = useToken();
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const secret = new URLSearchParams(window.location.search).get("t")?.trim() || new URLSearchParams(window.location.search).get("code")?.trim() || "";
    if (!secret) {
      setError("That check-in link is not valid.");
      return;
    }
    api<{ checkedInAt: string; repeated: boolean }>("/api/invites/check-in", { body: { token: secret } })
      .then((body) => setMsg(body.repeated ? "You're checked in." : "Checked in."))
      .catch((err: Error) => setError(err.message));
  }, []);
  return (
    <div className="pl pl-center">
      <div className="pl-card pl-login">
        <a className="pl-k" href="/">← MB Events</a>
        <h1>Check in</h1>
        {error && <p className="pl-warn" role="alert">{error}</p>}
        {msg && <p className="pl-ok" role="status">{msg}</p>}
        {!token && !error && !msg && <p className="pl-sub">Loading...</p>}
      </div>
    </div>
  );
}

export function GalleryPage({ slug }: { slug: string }) {
  const [media, setMedia] = useState<Media[] | null>(null);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("t")?.trim() ?? "";
    setToken(next);
    const query = next ? `?t=${encodeURIComponent(next)}` : "";
    api<{ media: Media[] }>(`/api/invites/gallery/${encodeURIComponent(slug)}${query}`)
      .then((body) => setMedia(body.media))
      .catch((err: Error) => setError(err.message));
  }, [slug]);
  return (
    <div className="pl">
      <div className="pl-wrap narrow">
        <div className="pl-top"><a href={`/invite/${slug}${token ? `?t=${encodeURIComponent(token)}` : ""}`}>← Invitation</a></div>
        <header className="pl-hero"><h1>Photos</h1></header>
        {error && <p className="pl-warn" role="alert">{error}</p>}
        <div className="pl-card">
          {media?.length ? media.map((item) => (
            <div className="pl-row" key={item.fileId}>
              {item.contentType.startsWith("video/")
                ? <video controls src={`/api/invites/gallery/${slug}/${item.fileId}${token ? `?t=${encodeURIComponent(token)}` : ""}`} />
                : <img alt="" src={`/api/invites/gallery/${slug}/${item.fileId}${token ? `?t=${encodeURIComponent(token)}` : ""}`} />}
            </div>
          )) : <p className="pl-empty">{media ? "No photos yet." : "Loading..."}</p>}
        </div>
      </div>
    </div>
  );
}
