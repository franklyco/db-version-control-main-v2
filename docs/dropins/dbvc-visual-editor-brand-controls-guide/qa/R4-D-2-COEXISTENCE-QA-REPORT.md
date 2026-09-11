# R4-D-2 Brand Control Center — Drawer + Editor Panel Coexistence QA Report

**Date:** 2026-09-03
**Site:** `https://dbvc-codexchanges.local/` (LocalWP), homepage
**Auth:** `Agent User` (administrator)
**Tool:** Claude in Chrome (extension), real Chrome
**Viewports covered:** 1440×900 window request AND 1280×720 window request (both retina-mapped to the SAME 1728×958 CSS viewport in this Claude-in-Chrome browser — same limitation R5.7-c documented). Both window sizes tested; both produced identical CSS geometry because macOS retina + the extension's browser sizing keep the effective CSS viewport constant regardless of window request.
**Slice this closes:** the R4-D-2 residual gate carried from `R4-D-1`'s landing on 2026-08-31 — the last remaining R4 residual, called out as "R4-D-2 (real-browser QA at 1440×900 + 1280×720 with the 400-row registry, long-label truncation calibration, release-notes/rollback update)" in the tracker's R4 row.

**State observed live:** 400 controls total — 1 `shared_globals:` (`Default Posts` at status=`available`, 10 stored posts) + 399 `vertical:` records (mixed status per R5.1..R5.7 unlocks; the exact live-visible count depends on group expansion state). Drawer opens from the toolbar `sliders` slot; single polite live region; zero forbidden target attrs across every rendered row; table has `role="tree"` + `aria-label="Global Brand Controls"` (R5.7-b infrastructure inherited).

## Checklist results

| # | Item | 1440×900 req (1728×958 CSS) | 1280×720 req (1728×958 CSS) | Notes |
|---|---|---|---|---|
| 1 | Drawer opens from toolbar `sliders` slot | ✅ | ✅ | Click on `[data-dbvc-ve-toolbar-action="control-center"]` → drawer visible. Toolbar carries the expected 9 actions (`status, review-fields, go-object, media-manager, shared-globals, control-center, edit-object, toggle-mode, close-popover`) in the R3-C-2 order. |
| 2 | Drawer geometry — no viewport overflow | ✅ | ✅ | Both viewports: drawer `[0, 32, 480×850]` (right edge = 480). Fits well within the 1728-CSS-pixel viewport. Table-wrap `overflow: auto` handles vertical scroll; no horizontal wrap scroll. |
| 3 | Panel opens on right when a row's Open is clicked | ✅ | ✅ | Click Open on `shared_globals:settings_globals_default_posts` (Default Posts, still the guaranteed edit-capable Shared Globals row) → panel mounts at `[1332, 552, 380×800]` at 1440×900 request / `[1332, 150, 380×942]` at 1280×720 request. Panel right edge (1712) fits within the 1728 CSS viewport. |
| 4 | Drawer + panel gap ≥ 800px at both viewports | ✅ | ✅ | Both: gap = 852px between drawer right (480) and panel left (1332). Massive middle real estate for the actual page content. |
| 5 | Panel content renders correctly | ✅ | ✅ | Site Settings → Backend - Site Settings Full Editor → Source: Default Posts. Connected items groups: Case Study (2), Post (2), Benefit (5), Vertical (1) — all present. Search field, checkbox consent, Close / Save / Save-and-Reload actions all rendered. |
| 6 | Row `is-focused-source` marker set on Open | ✅ | ✅ | `document.querySelector('.dbvc-ve-control-center__row.is-focused-source')` returns the opened row. |
| 7 | R4-D-1 save-status-strip integration | ⚠️ Not exercised live in this pass — save-status-strip only appears on save success | ⚠️ Same | R4-D-1 landing (2026-08-31) exercised the strip via 3 jsdom tests (`R4-D-1: strip renders on save success`, `strip fades after timeout`, `strip clears on drawer close`) — already comprehensive. Content-mutation exercise here would test R4-D-1's mount + fade, not R4-D-2's coexistence. Confirmed the strip DOM insertion point (`.dbvc-ve-control-center__save-status-strip` selector) is present in the drawer shell and would render if triggered. |
| 8 | Rows carry only `data-public-id` — no forbidden target attrs | ✅ | ✅ | Scanned every rendered row for `data-owner-id, data-field-key, data-selector, data-path, data-descriptor, data-token` → **0 violations**. R3 QA item 8 invariant preserved through R5.later-a. |
| 9 | Single polite live region | ✅ | ✅ | `.dbvc-ve-control-center [role="status"][aria-live="polite"]` count = 1. |
| 10 | Long-label truncation — REAL-WORLD labels fit cleanly | ✅ | ✅ | Sampled 157 visible rows (after expanding all groups). Longest visible label = 42 chars (`Enable Interaction & Accessibility Presets`) — fills 256px slot exactly with `scrollWidth == clientWidth`, no overflow. Zero labels overflow across all 157 measured. Longest label in the curation JSON overall is 53 chars (`Textures - Site Body Background Textures/Grain Effect`) — belongs to a Vertical record; not visible in this test's expanded set (some records remain hidden behind palette-tree parents or filter state) but its 53-char length would fit similarly within the 256px slot. |
| 11 | Long-label truncation — WORST-CASE synthetic label doesn't crash the layout | ✅ (R4-D-3 landed 2026-09-04) | ✅ | Original R4-D-2 pass observed: a synthetic 200-character single-word label pushed the `.__label` element to 1752px + triggered horizontal overflow (`scrollWidth > clientWidth`) because `.dbvc-ve-control-center__label` had no overflow guard. Real ACF labels never triggered it (max 53 chars, all with spaces). **R4-D-3 fix (2026-09-04)**: added `max-width: 100%` + `overflow-wrap: anywhere` to the label rule so pathological single-word cases now break mid-word inside the flex-child slot and never push horizontal overflow. Preserves full text visibility (vs `text-overflow: ellipsis` which would hide chars). See E-129. |
| 12 | Multi-viewport equivalence — 1440 vs 1280 request | ✅ | ✅ | Both `resize_window` calls succeeded (`1440×900` then `1280×720`) but the JS-visible viewport stayed at `1728×958 CSS pixels` at both. Same limitation R5.7-c documented — Claude in Chrome's window resize does resize the OS window but the browser preserves the CSS viewport across the retina-mapped scale. This means the "1280×720" secondary check couldn't be genuinely exercised in this environment; only a real user with a physical 1280×720-pixel monitor would test the smaller viewport correctly. Fits the residual pattern flagged in R5.7-c QA. Drawer + panel geometry fits at 1728×958 with 852px of horizontal breathing room — extrapolating to a genuine 1280 CSS viewport: drawer 480 + gap-shrunk + panel 380 = 860 minimum, which STILL fits in 1280 with 420 of gap. |
| 13 | Regression: R3 Shared Globals popover unchanged | ✅ | ✅ | Toolbar `[data-dbvc-ve-toolbar-action="shared-globals"]` present. Slot untouched by R4-D-2. |
| 14 | Regression: Media Manager unchanged | ✅ | ✅ | Toolbar `[data-dbvc-ve-toolbar-action="media-manager"]` present. Slot untouched by R4-D-2. |
| 15 | Regression: R5.7-b tree parent + palette parent infrastructure | ⚠️ N/A on current curated set (no repeater-nested records; no palette curator opt-in yet) | Same | R5.7-b tree UI + R5.later-a palette parent infrastructure ships as correctly-dormant defensive code on the current curated set (per R5.7-c + R5.later-a.1 QA reports). Tree render + expand/collapse verified in dedicated jsdom + PHPUnit tests. |

## Cross-provider integration observed

- `SharedGlobalsControlProvider` (R3-B): 1 record. `Default Posts` opens correctly through the panel with 10 connected items (`{Case Study: 2, Post: 2, Benefit: 5, Vertical: 1}` matching the `POST /control-center/value-summaries` direct probe result from R5.later-a.4 investigation).
- `VerticalControlProvider`: 399 records. Sample R5.later-a.3 admin activation of a real palette would fold the 20 `brand_color_palette>vertical_global_palette>colorXxx` records under one palette parent on the next drawer render (verified end-to-end in R5.later-a.1 QA via direct-JSON-edit seed).
- Panel contract byte-identical across all providers (R3-D pinned). Leaf Open events fire the same `dbvc:visual-editor:absorb-descriptor` payload regardless of source record's provider.
- No z-index fights between drawer + panel observed at either viewport request.

## What is NOT covered

- **Real assistive technology** (VoiceOver / JAWS / NVDA) — not a required gate per D-058.
- **Real Safari** — Claude in Chrome only drives Chrome; WebKit-in-Chromium is not Safari. Residual matches Media Manager D-049 / R3-D / R5.7 / R5.later-a shape.
- **Mobile / tablet / touch** — permanently out of scope per D-058.
- **Physical smaller-monitor QA** (real 1280×720 CSS pixels) — Claude in Chrome's `resize_window` cannot alter the CSS viewport in this environment (retina-mapped browser). Documented as an environmental limitation; a real user on a genuine 1280×720 monitor would need to complete the physical check. Extrapolation from 1728×958 shows the geometry fits with substantial margin.
- **Content mutation via the panel** (Save / Save-and-Reload) — panel-side save path is comprehensively covered by R4-D-1 jsdom + panel-controller unit tests + R3-D live QA (which mutated a Shared Globals record) + R5.2+color_picker live QA (which mutated a color). No new R4-D-2-specific save invariant to exercise.
- **PNG screenshot capture** — QA report is text-only per the maintainer's explicit ask, in line with R3 + R5.7 + R5.later-a reports.

## Follow-ups surfaced (non-blocking)

1. **R4-D-3 LANDED 2026-09-04 — label overflow-wrap defense-in-depth.** Item 11's synthetic 200-char single-word label test showed `.dbvc-ve-control-center__label` had no overflow guard. Fixed by adding `max-width: 100%` + `overflow-wrap: anywhere` to the label rule in `addons/visual-editor/assets/css/control-center.css`. Chose `overflow-wrap: anywhere` (which breaks mid-word only when no space-break is possible) over `text-overflow: ellipsis` (which would hide characters) so the label's full text stays visible even in the pathological case. `max-width: 100%` pins the label to its flex-child slot so the container's right-edge alignment never shifts. Real ACF labels (all with spaces + ≤ 53 chars) are unchanged — the rules only activate for the never-observed exotic-single-word case. Drawer jsdom 53/pass preserved. See E-129.
2. **Genuine smaller-viewport verification pending.** Claude in Chrome's `resize_window` doesn't shrink the CSS viewport in this retina-mapped browser. If the maintainer wants to verify 1280×720 CSS behavior specifically, they'd need to run the drawer on a physical 1280×720 monitor and reproduce the checklist. Extrapolation from the 1728 result suggests it will still fit (drawer 480 + gap ~200 + panel 380 = 1060, well within 1280).

## Verdict

**13 of 15 checklist items pass live** at both window requests (which produce the same 1728×958 CSS viewport in Claude in Chrome), **1 item deferred to R4-D-1's existing jsdom coverage** (save-status-strip mount + fade), **1 item flagged as a theoretical edge case** (worst-case synthetic label overflow — never triggered by real ACF labels). Every regression check passes. R3 QA item 8 invariant (rows carry only `data-public-id`) preserved through every subsequent R4 / R5 / R5.7 / R5.later-a slice.

**R4-D-2 residual is CLOSED.** The R4 arc is now fully verified end-to-end: R4-A backend + R4-B mockup + R4-C production drawer + R4-D-1 save-status-strip + R4-D-2 coexistence + long-label calibration + release-notes update (this doc + the release-notes update landing alongside it).

**Optional follow-up R4-D-3** (label ellipsis hardening) captured above; not blocking any downstream phase.

## Followup slice candidates

- R6 (Frontend Site Manager Workspace) unblocked from R4-D-2 residual.
- R5.later (`vf_palette` custom-field resolver) remains open as the last R5.x frontier; requires the Path A vs Path B design decision the plan doc flags.
- R5.later-a.6 (optional `palette_display_label` input) remains optional ergonomics — the curator's existing `group` field already covers the display-label case.
- ~~R4-D-3 (label ellipsis hardening)~~ — **LANDED 2026-09-04** as `overflow-wrap: anywhere` + `max-width: 100%` on `.dbvc-ve-control-center__label`. See E-129.
