# Interactive surface recipes

Use these patterns when implementing the skill. Prefer CSS for dim/highlight; use a spring only for the border mass.

## Tokens

```css
.surface-group {
  --surface-rest: 1;
  --surface-dim: 0.64;
  --surface-highlight: 1;
  --stroke-rest: color-mix(in oklab, canvastext 12%, transparent);
  --stroke-active: color-mix(in oklab, canvastext 46%, transparent);
  --highlight: color-mix(in oklab, var(--accent, CanvasText) 70%, white);
}
```

Tune `--surface-dim` to `0.7` for button rows, `0.62` for card grids.

## Inactive dim + active highlight (CSS)

```css
.surface-group:has(:hover) .surface:not(:hover):not(:focus-visible),
.surface-group:has(:focus-visible) .surface:not(:hover):not(:focus-visible) {
  opacity: var(--surface-dim);
}

.surface {
  opacity: var(--surface-rest);
  border: 1px solid var(--stroke-rest);
  transition: opacity 160ms ease, border-color 160ms ease, transform 160ms ease;
}

.surface:hover,
.surface:focus-visible {
  opacity: var(--surface-highlight);
  border-color: var(--stroke-active);
  transform: translateY(-1px);
}

.surface:active {
  transform: scale(0.98);
  transition-duration: 0ms;
}

@media (prefers-reduced-motion: reduce) {
  .surface {
    transition: none;
  }
}
```

The 160ms opacity fade is the dim/highlight crossfade. It is not a substitute for the border spring.

## Border mass spring physics (pointer spotlight)

Drive `--hx` `--hy` (0–1) with a spring. The border highlight is a radial light whose center is the mass.

```css
.surface {
  position: relative;
  --hx: 0.5;
  --hy: 0.5;
  --h-opacity: 0;
  background:
    radial-gradient(
      180px circle at calc(var(--hx) * 100%) calc(var(--hy) * 100%),
      color-mix(in oklab, var(--highlight) 28%, transparent),
      transparent 55%
    ),
    var(--surface-fill, Canvas);
}

.surface::after {
  content: "";
  pointer-events: none;
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: radial-gradient(
    140px circle at calc(var(--hx) * 100%) calc(var(--hy) * 100%),
    var(--highlight),
    transparent 50%
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: var(--h-opacity);
}
```

Spring the three values, not the pointer:

| Value | Rest | Pointer over | Leave |
| --- | --- | --- | --- |
| `--hx`, `--hy` | 0.5, 0.5 | pointer / rect | 0.5, 0.5 |
| `--h-opacity` | 0 | 1 | 0 |

Integrator (no library):

```ts
type Spring = { pos: number; vel: number };
const MASS = 0.8;
const STIFFNESS = 220;
const DAMPING = 26;

function step(s: Spring, target: number, dt: number): Spring {
  const acc = (STIFFNESS * (target - s.pos) - DAMPING * s.vel) / MASS;
  const vel = s.vel + acc * dt;
  return { pos: s.pos + vel * dt, vel };
}
```

On `pointermove` over the surface, set `targetX = (clientX - left) / width` (clamp 0–1). On `pointerleave`, targets go to `0.5` / `0` opacity. Run `step` on rAF until velocities are near 0.

Motion (if already installed):

```ts
const hx = useSpring(0.5, { mass: 0.8, stiffness: 220, damping: 26 });
const hy = useSpring(0.5, { mass: 0.8, stiffness: 220, damping: 26 });
const glow = useSpring(0, { mass: 0.8, stiffness: 220, damping: 26 });
```

Optional body pull: spring `x`/`y` translate with strength `0.12–0.2` and radius falloff. Disable when `prefers-reduced-motion` or not `(hover: hover) and (pointer: fine)`.

## Keyboard

On `:focus-visible`, set targets to `0.5, 0.12` (top-center mass) and `--h-opacity` to 1. Same dim rules as hover. Do not require a mouse move to show the highlight.

## Touch

If `matchMedia("(hover: hover) and (pointer: fine)")` is false:

- Do not attach `pointermove` springs.
- Keep `:active` scale and selected/focus highlight.
- Dim siblings only when a selected/pressed state exists, not on touchstart flicker.

## Group JS fallback

Use JS dim only when CSS `:has` cannot see the peers (portals, virtualized lists):

```ts
group.addEventListener("pointerover", (e) => {
  const t = (e.target as Element).closest(".surface");
  if (!t || !group.contains(t)) return;
  for (const el of group.querySelectorAll(".surface")) {
    el.classList.toggle("is-dim", el !== t);
    el.classList.toggle("is-active", el === t);
  }
});
group.addEventListener("pointerleave", () => {
  for (const el of group.querySelectorAll(".surface")) {
    el.classList.remove("is-dim", "is-active");
  }
});
```

Mirror the same classes from `focusin` / `focusout` for keyboard.
