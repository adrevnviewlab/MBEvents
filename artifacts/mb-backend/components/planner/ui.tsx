"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export async function api<T = { ok: true }>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    signal: init?.signal,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(json.error || "Something went wrong."), { status: res.status });
  return json;
}

// Cleanup abort is ignored. A timeout becomes a message so a loading screen cannot spin forever.
export function beginTimed(task: (signal: AbortSignal) => Promise<void>, ms = 12000) {
  const stop = new AbortController();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException("The request timed out.", "TimeoutError")), ms);
  const signal = AbortSignal.any([stop.signal, timeout.signal]);
  const done = task(signal).finally(() => clearTimeout(timer));
  return { done, cancel: () => stop.abort() };
}

export function loadFailure(error: unknown, signal?: AbortSignal) {
  if ((error as Error).name === "AbortError") {
    return (signal?.reason as { name?: string } | undefined)?.name === "TimeoutError"
      ? "This is taking too long. Check your connection and try again."
      : null;
  }
  return (error as Error).message || "Something went wrong.";
}

export const newId = () => Math.random().toString(36).slice(2, 12);

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`pl-field${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Text({ value, onChange, placeholder, type = "text", area, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; area?: boolean; disabled?: boolean }) {
  return area ? (
    <textarea value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} rows={4} />
  ) : (
    <input type={type} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  );
}

export function Select<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

export function Section({ eyebrow, title, intro, actions, children }: { eyebrow: string; title: string; intro?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="pl-section">
      <header className="pl-section-head">
        <div>
          <div className="pl-k">{eyebrow}</div>
          <h2>{title}</h2>
          {intro && <p className="pl-intro">{intro}</p>}
        </div>
        {actions && <div className="pl-actions no-print">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="pl-empty">{children}</p>;
}

// Row editor for arrays of objects with add / remove / reorder.
export function useListOps<T extends { id: string }>(items: T[], set: (next: T[]) => void) {
  return {
    update: (id: string, patch: Partial<T>) => set(items.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    remove: (id: string) => set(items.filter((i) => i.id !== id)),
    add: (item: T) => set([...items, item]),
    move: (id: string, dir: -1 | 1) => {
      const index = items.findIndex((i) => i.id === id);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= items.length) return;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      set(next);
    },
    reorder: (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const from = items.findIndex((i) => i.id === fromId);
      const to = items.findIndex((i) => i.id === toId);
      if (from < 0 || to < 0) return;
      const next = [...items];
      const [row] = next.splice(from, 1);
      next.splice(to, 0, row);
      set(next);
    },
  };
}

export function RowTools({ onUp, onDown, onRemove }: { onUp?: () => void; onDown?: () => void; onRemove: () => void }) {
  return (
    <span className="pl-rowtools no-print">
      {onUp && <button type="button" aria-label="Move up" onClick={onUp}>↑</button>}
      {onDown && <button type="button" aria-label="Move down" onClick={onDown}>↓</button>}
      <button type="button" aria-label="Remove" className="danger" onClick={onRemove}>×</button>
    </span>
  );
}

// Freehand signature pad (mouse, pen, touch). Emits a PNG data URL, or "" when cleared.
export function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const canvas = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
  }, []);

  const point = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div className="pl-sigpad">
      <canvas
        ref={ref}
        onPointerDown={(e) => {
          drawing.current = true;
          ref.current!.setPointerCapture(e.pointerId);
          const ctx = ref.current!.getContext("2d")!;
          ctx.beginPath();
          ctx.moveTo(...point(e));
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext("2d")!;
          ctx.lineTo(...point(e));
          ctx.stroke();
          setDirty(true);
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (dirty) onChange(ref.current!.toDataURL("image/png"));
        }}
      />
      <button
        type="button"
        className="pl-link"
        onClick={() => {
          const c = ref.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          setDirty(false);
          onChange("");
        }}
      >
        Clear signature
      </button>
    </div>
  );
}

export function fmtDate(value: string) {
  if (!value) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
