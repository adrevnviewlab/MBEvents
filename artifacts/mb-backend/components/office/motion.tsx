"use client";

import { useEffect } from "react";

const MASS = 0.8;
const STIFFNESS = 220;
const DAMPING = 26;

type Spring = {
  x: number;
  y: number;
  o: number;
  vx: number;
  vy: number;
  vo: number;
  tx: number;
  ty: number;
  to: number;
};

const SELECTOR = ".of-surface, .pl-btn";

function resting(s: Spring) {
  return Math.abs(s.x - s.tx) < 0.002 && Math.abs(s.y - s.ty) < 0.002 && Math.abs(s.o - s.to) < 0.002
    && Math.abs(s.vx) < 0.002 && Math.abs(s.vy) < 0.002 && Math.abs(s.vo) < 0.002;
}

/** Border highlight lags the pointer. Disabled controls and reduced motion stay still. */
export function OfficeMotion() {
  useEffect(() => {
    const root = document.querySelector(".office");
    if (!root) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = new Map<HTMLElement, Spring>();
    let raf = 0;
    let last = 0;

    const ensure = (el: HTMLElement) => {
      let spring = nodes.get(el);
      if (!spring) {
        spring = { x: 0.5, y: 0.5, o: 0, vx: 0, vy: 0, vo: 0, tx: 0.5, ty: 0.5, to: 0 };
        nodes.set(el, spring);
      }
      return spring;
    };

    const paint = (el: HTMLElement, spring: Spring) => {
      el.style.setProperty("--hx", spring.x.toFixed(4));
      el.style.setProperty("--hy", spring.y.toFixed(4));
      el.style.setProperty("--h-opacity", spring.o.toFixed(3));
    };

    const kick = () => {
      if (raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.032, last ? (now - last) / 1000 : 0.016);
      last = now;
      let moving = false;
      for (const [el, spring] of nodes) {
        if (!el.isConnected) {
          nodes.delete(el);
          continue;
        }
        if (reduce) {
          spring.x = spring.tx;
          spring.y = spring.ty;
          spring.o = spring.to;
          spring.vx = spring.vy = spring.vo = 0;
        } else {
          const ax = (STIFFNESS * (spring.tx - spring.x) - DAMPING * spring.vx) / MASS;
          const ay = (STIFFNESS * (spring.ty - spring.y) - DAMPING * spring.vy) / MASS;
          const ao = (STIFFNESS * (spring.to - spring.o) - DAMPING * spring.vo) / MASS;
          spring.vx += ax * dt;
          spring.vy += ay * dt;
          spring.vo += ao * dt;
          spring.x += spring.vx * dt;
          spring.y += spring.vy * dt;
          spring.o += spring.vo * dt;
        }
        paint(el, spring);
        if (!resting(spring)) moving = true;
        else if (spring.to === 0) nodes.delete(el);
      }
      raf = moving ? requestAnimationFrame(frame) : 0;
    };

    const surface = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const el = target.closest(SELECTOR);
      if (!(el instanceof HTMLElement) || !root.contains(el)) return null;
      if (el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") return null;
      return el;
    };

    const onMove = (event: Event) => {
      if (!fine || reduce || !(event instanceof PointerEvent)) return;
      const el = surface(event.target);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spring = ensure(el);
      spring.tx = rect.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0.5;
      spring.ty = rect.height ? Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) : 0.5;
      spring.to = 1;
      kick();
    };

    const onOut = (event: Event) => {
      if (!(event instanceof PointerEvent)) return;
      const el = surface(event.target);
      if (!el) return;
      const next = event.relatedTarget;
      if (next instanceof Node && el.contains(next)) return;
      const spring = nodes.get(el);
      if (!spring) return;
      if (el.matches(":focus-visible")) {
        spring.tx = 0.5;
        spring.ty = 0.12;
        spring.to = 1;
      } else {
        spring.tx = 0.5;
        spring.ty = 0.5;
        spring.to = 0;
      }
      kick();
    };

    const onFocus = (event: Event) => {
      const el = surface(event.target);
      if (!el || !el.matches(":focus-visible")) return;
      const spring = ensure(el);
      spring.tx = 0.5;
      spring.ty = 0.12;
      spring.to = 1;
      kick();
    };

    const onBlur = (event: Event) => {
      const el = surface(event.target);
      if (!el) return;
      const spring = nodes.get(el);
      if (!spring) return;
      spring.tx = 0.5;
      spring.ty = 0.5;
      spring.to = 0;
      kick();
    };

    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerout", onOut);
    root.addEventListener("focusin", onFocus);
    root.addEventListener("focusout", onBlur);
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerout", onOut);
      root.removeEventListener("focusin", onFocus);
      root.removeEventListener("focusout", onBlur);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
