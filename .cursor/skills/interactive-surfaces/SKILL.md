---
name: interactive-surfaces
description: Polish buttons, cards, and peer groups with border mass spring physics, inactive dim, and active highlight. Use when building or refining UI, hover/focus/press states, magnetic or spring motion, dimming siblings, or highlighting the active control.
---

# Interactive Surfaces

Read this skill before changing button, card, chip, tab, or list-row chrome. Apply both signatures together: **border mass spring physics** on the surface, plus **inactive dim** and **active highlight** in the peer group.

For implementation snippets and spring numbers, see [recipes.md](recipes.md).

## Signatures (verbatim)

These two treatments are the product feel. Do not substitute generic `transition: all` hovers.

1. **border mass spring physics** — the border highlight is a physical mass. Pointer/focus sets a target; a spring (mass, stiffness, damping) moves the highlight. It lags, overshoots slightly, and settles. It never teleports.
2. **inactive dim** and **active highlight** — in a peer group, the hovered/focused/pressed item is the **active highlight**. Siblings take **inactive dim**. Leaving the group restores rest.

## When to apply

| Apply | Skip |
| --- | --- |
| Primary/secondary buttons, icon buttons | Disabled controls (static dim only, no spring) |
| Cards, pricing tiles, event tiles, selectable rows | Dense data tables, tiny icon-only toolbars |
| Tabs, chips, segmented controls | Continuous text links in prose |
| Hover-capable pointers and `:focus-visible` | Touch-only devices for pointer-follow; keep press + focus |

## Physics

Treat the border glow (position around the edge, or spotlight x/y on the face) as a mass-spring-damper — not a CSS hover snap.

- Pointer/focus updates **target** only.
- A spring integrates toward target each frame (`mass`, `stiffness`, `damping`).
- On pointer leave, target returns to rest (center or fade-out). The mass coasts home; do not cut opacity to 0 in one frame unless `prefers-reduced-motion`.
- Magnetic body pull (translate the whole control toward the pointer) is optional and weaker than the border. Max drift ~4–8px on buttons, ~6–12px on cards. Never so strong that neighbors collide.
- Animate `transform` and `opacity` (and CSS variables that only drive `background-position` / gradient stops). Never animate `width`, `height`, `top`, `left`, or `transition: all`.

Default spring (hover-capable, high-frequency):

- border highlight: `mass: 0.8`, `stiffness: 220`, `damping: 26` (near-critical, tiny settle)
- optional body pull: `mass: 1`, `stiffness: 180`, `damping: 24`
- press scale: **0ms** to `0.98` (buttons) / `0.985` (cards); release uses the body spring

If Motion (Framer Motion) is in the project, use `useSpring`. Otherwise a 16ms rAF integrator is fine. Do not add a motion library only for one button.

## Inactive dim and active highlight

Peer group = siblings that compete (card grid, button row, chip row, tablist).

| State | Surface | Border | Content |
| --- | --- | --- | --- |
| Rest | full opacity, quiet border | 1px token stroke, no glow mass | normal |
| Active highlight | 1.0 opacity, +2–4% brightness or +lift `translateY(-1px)` | spring-driven highlight on the stroke | full contrast |
| Inactive dim | opacity `0.58–0.72` (cards `0.62`, buttons `0.7`) | stroke fades toward muted | do not blur text |
| Pressed (active item) | scale `0.98`, highlight holds | spring may compress inward 1px | keep readable |
| Disabled | opacity `0.4–0.5`, no spring, `pointer-events: none` | muted | `aria-disabled` |

Rules:

- Dim **siblings**, not the whole page. Scope to the group container.
- Hover and `:focus-visible` produce the same highlight/dim pairing. Keyboard users get the full treatment.
- One active item per group. `:focus-visible` wins over hover if both exist.
- Leaving the group (pointer out **and** focus leaves) springs everyone back to rest.
- Prefer container `:has(:hover)`, `:has(:focus-visible)` for CSS dim; use JS only when the group is virtualized or the highlight is pointer-tracking.
- Do not dim if the group has a single item.

## Accessibility and input

- `@media (prefers-reduced-motion: reduce)`: no mass, no magnetic pull. Instant opacity/border-color change ≤120ms or none.
- `@media (hover: hover) and (pointer: fine)` required for pointer-follow springs. Touch: press scale + focus highlight only.
- Visible `:focus-visible` ring may be the same spring border, but contrast must meet 3:1 against adjacent background.
- `touch-action: manipulation` on tappable controls.
- Do not put `onMouseMove` on `document` for every card. Listen on the group or the surface.

## Anti-patterns

- Instant border-color hover with `transition: 150ms ease` as a stand-in for **border mass spring physics**
- Dimming the active item, or greying the entire page behind a hover
- Blur, heavy drop-shadow, or gradient-text as the only “highlight”
- Different hover vs focus visuals
- Springs on every decorative icon or background orb
- Bounce/overshoot on high-frequency hovers that makes text wobble (keep damping high)

## Workflow

1. Identify the peer group and the surfaces (button vs card).
2. Add rest / active highlight / inactive dim tokens (opacity + border + optional lift).
3. Attach border mass (spotlight or edge-travel) with the default spring; gate on hover + reduced-motion.
4. Wire `:focus-visible` to the same targets as hover.
5. Verify: pointer travel lags then settles; siblings dim; keyboard matches; reduced-motion is instant; touch has no stray tracking.
