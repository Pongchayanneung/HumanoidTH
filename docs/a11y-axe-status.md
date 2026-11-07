# Automated accessibility status (axe)

Scope: `tests-node/a11y.spec.ts` runs axe-core (WCAG 2.0/2.1 A and AA tags) on `/`, `/dashboard`,
`/robots`, `/network`, `/map`, `/perspectives` and `/contributions` at 390px and 1440px, and fails on
serious or critical violations. Last verified 2026-11-07 against `next dev` with a migrated and seeded
Postgres 16 (issue #11).

Result: 14 of 14 cases pass, meaning axe reports 0 serious or critical violations (WCAG 2.0/2.1 A and AA tags) in these routes and widths. This is not a claim that the pages are fully accessible.

## What was fixed (33 nodes in 11 failing cases)

| Rule | Root cause | Fix |
| --- | --- | --- |
| color-contrast | Brand gold `--warning` (#705c30) used as text and icon colour on the dark green shell, 2.8:1 to 2.9:1 | New token `--gold-on-dark` (#d6be67, 9.7:1) for `.mobile-title`, `.brand`, `.mobile-profile`, active tab icon, `.terminal-header h3`, the active language button and the command step chip |
| color-contrast | `.badge.ok`, `.type-badge` and map badges used `--success`/`--accent` (#4a7c59) on a light green tint, 4.2:1 to 4.3:1 | Text uses the existing `--accent-strong` (#365b41), 6.6:1 to 6.8:1 |
| color-contrast | "No active runs" pill used inline `#94a3b8` on a light tint, 2.2:1 | `.success-pill.idle` class with `#475569`, 6.6:1 |
| aria-prohibited-attr | `aria-label` on a plain `div` (network graph container) | `role="group"` added, accessible name unchanged |

`link-name` and `label-content-name-mismatch` named in the CI comment did not reproduce on the seeded
data at either width.

## Not covered by this scan

- axe reported "needs review" (incomplete) for text over gradients or pseudo elements. These are unresolved,
  not confirmed passes. The spec ignores them and nobody has assessed them by hand: `.splash-title`,
  `.splash-brand`, `.status-row` spans, `.source-thumbnail-empty` on `/robots`, and the label inside the
  language selector buttons (the active button was fixed by token, its contrast is computed, not measured).
- Colour changes to states the seed data does not render were made by contrast calculation, not by axe:
  the active-run `.success-pill` and the map info-window badge.
- The spec starts scanning once the first `h1` is visible, which on a first visit is the `h1` of the
  FirstTimeLoader splash overlay. A separate scan after the splash detached also found 0 serious or
  critical violations on all 14 cases, but the spec itself does not wait for it.
- The `/network` graph is a Cytoscape canvas. `role="group"` only gives its container a valid accessible name; nodes and edges are not exposed to keyboard or screen-reader users there, so graph interaction needs an accessible alternative (open gap, not fixed here).
- Screen reader behaviour, real devices, zoom and reflow, and authenticated or operator pages are not tested.
- Keyboard: Tab order and a visible 2px gold focus outline were checked by script on the main nav, tab bar,
  header links and language selector at both widths. Focus indicator contrast against every background was
  not measured.
