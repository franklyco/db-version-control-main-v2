# R4-D resume prompt — Shared Globals transition + hardening

> Fresh, self-contained resume for a new Claude Code session. R4-C
> landed 2026-08-31 across three sub-slices (R4-C-1a + R4-C-1b + R4-C-2);
> the production drawer now consumes the entire R4-A backend contract
> and translates every R4-B mockup DESIGN-DECISION into shipping code.
> R4-D is the last R4 slice: real-browser QA + long-label calibration
> + save-status-strip + release-notes/rollback update. R5.x per-family
> editing factories are separate slices after R4-D.
>
> **How to use this file:** copy the fenced block below into a fresh
> Claude Code chat in this repo. It is self-contained and gives the
> fresh agent enough to propose an R4-D plan and start work. The
> reference material below the fence is optional depth.
>
> **When R4-D lands:** archive this file into `archive/` alongside the
> R4-C resume, refresh `DBVC_VISUAL_EDITOR_HANDOFF.md`'s boundary line,
> and write a fresh R5.1 resume prompt whose scope matches the next
> slice.

---

```
Continue the DBVC Visual Editor R4 work — implement Slice R4-D (Shared
Globals transition + hardening; the last R4 slice before R5.x per-family
editing factories).

Working directory:
/Users/rhettbutler/Documents/LocalWP/dbvc-codexchanges/app/public/wp-content/plugins/db-version-control-main

## Read first (in this order — do not skip)

1. addons/visual-editor/docs/handoffs/DBVC_VISUAL_EDITOR_HANDOFF.md
   — current boundary line + product boundary + safety/git rules.
2. docs/dropins/dbvc-visual-editor-brand-controls-guide/releases/R4-EXPANDED-GLOBAL-BRAND-CONTROL-CENTER.md
   — the whole doc; §R4-A / §R4-C-1a / §R4-C-1b / §R4-C-2 checkpoints
   are the ground truth for what the drawer already does; §R4-D is
   the target slice.
3. addons/visual-editor/assets/js/brand-control-center-app.js (~1900
   lines) — the production drawer. Do NOT rewrite; extend surgically.
4. addons/visual-editor/assets/js/overlay-app.js — you MAY need to
   dispatch `dbvc:visual-editor:panel:saved` on successful save so
   the drawer can render its save-status-strip. Straddles the
   R3-C-2 pinned baseline (14/14 jsdom + E-099 real-browser QA); tread
   carefully. Add a jsdom regression case for whichever save path
   you hook.
5. addons/visual-editor/assets/css/control-center.css — extend for
   the save-status-strip + any long-label truncation calibration.
6. docs/dropins/dbvc-visual-editor-brand-controls-guide/releases/BRAND-CONTROL-CENTER-RELEASE-NOTES-AND-ROLLBACK.md
   — R3-D-era release notes. R4-D adds R4-A/B/C-1a/1b/2 rows + the
   R4-D real-browser QA report + updated rollback recipe (the flip
   is now "disable Brand Control Center" not "disable drawer" —
   same shape as R3-D).
7. docs/dropins/dbvc-visual-editor-brand-controls-guide/qa/R3-DRAWER-BROWSER-QA-REPORT.md
   — R3 real-browser QA at 1440×900 + 1280×720 (E-099). R4-D's real-
   browser QA report mirrors this shape: same viewports, same 12
   checklist items, plus R4-A/C additions (description line renders,
   provider-error banner surfaces and dismisses, value-summary chip
   hydrates lazily via the batch endpoint, view-mode toggle flips
   persistently, group headers collapse persistently).
8. docs/dropins/dbvc-visual-editor-brand-controls-guide/tracking/{EVIDENCE-LOG.md, DECISION-LOG.md, IMPLEMENTATION-TRACKER.md}
   — latest entries E-100 (R4-A), E-101 (R4-C-1a), E-102 (R4-C-1b),
   E-103 (R4-C-2) + D-064 (R4-A batch endpoint + fail-soft
   decisions).

## Hard constraints (from the current handoff §Safety)

- Preserve the intentional dirty tree at base commit 5db4b40. No git
  operations either repo — no add / commit / stash / reset / checkout
  / clean / push. If you notice a change you did not make,
  investigate; do not overwrite.
- No live-site mutations. Never trigger a save against the LocalWP
  site during real-browser QA unless the maintainer explicitly asks
  you to (a real save exercises MutationService, journals, and
  invalidates caches — R3 QA deliberately stopped short of clicking
  Save for exactly this reason); read-only inspection at both
  viewports is enough for the checklist items.
- Never toggle `dbvc_visual_editor_control_center_enabled` or the
  master Visual Editor option outside test setUp/tearDown.
- Never touch `~/.config/dbvc-local-agent.env`. Real-browser QA
  needs an already-authorized authenticated Chrome tab (E-099's
  shape) — if none exists, ask the maintainer before proceeding.
- Desktop-only per D-058: 1440×900 primary + 1280×720 secondary. No
  mobile/tablet/touch scoping.
- No new write authority. R4 is UI-only; every save keeps routing
  through the existing MutationService pipeline via the R3-C-1 open
  path.
- Kill switch stays default off. Both parts of D-063 (master + Enable
  Brand Control Center) are required for any R4-D surface to render.

## R4-D in-scope work (proposed slice shape — confirm with user)

Reasonable slicing is R4-D-1 (save-status-strip + overlay-app.js
event dispatch) + R4-D-2 (real-browser QA + long-label truncation
calibration + release-notes/rollback update). Propose the split as
your first output, then wait for confirmation.

Likely R4-D-1:

- Small addition to `overlay-app.js`'s successful-save path: dispatch
  a `dbvc:visual-editor:panel:saved` document event with a small
  detail `{publicId?, label?}` so the drawer's save-status-strip can
  render "Saved {label}" briefly. Add a jsdom regression case for
  the specific save code path you hook. If the overlay-app doesn't
  currently fire an equivalent event, this is the primary risk —
  R3-C-2 + E-099's real-browser panel-coexistence QA is the gate you
  must not regress.
- New drawer state / render code for the save-status-strip
  (`.__save-status-strip` per the mockup — position:sticky top of
  the drawer body, fades after N ms). Reuses the single polite live
  region (announcer stays authoritative — the strip is a visual
  affordance).
- One new i18n key: `controlCenterSaveStatus` ("Saved {label}" or
  similar). Add reduced-motion suppression for the strip's fade
  transition.

Likely R4-D-2:

- Real-browser QA at 1440×900 + 1280×720 against the live LocalWP
  site with the 400-row registry. Same 12 checklist items as E-099
  plus the R4-C additions (see qa/ shape above). Produce a new
  `qa/R4-DRAWER-BROWSER-QA-REPORT.md` sibling to E-099's.
- Long-label truncation calibration — measure at what character
  count Vertical labels + descriptions overflow at 1280×720 (drawer
  480px fixed width). The `.__label` and `.__description` don't
  currently truncate; R4-C's addition of value-summary chips + the
  R4-A description line means the row has less room. Add
  `text-overflow: ellipsis` + `title` tooltip if measurement shows
  overflow at real data. Deferred R4-C-2 note.
- Update `BRAND-CONTROL-CENTER-RELEASE-NOTES-AND-ROLLBACK.md`:
  add R4-A / R4-B / R4-C-1a / R4-C-1b / R4-C-2 / R4-D rows to
  *What shipped*; add R4-A batch endpoint + R4-C-1b IntersectionObserver
  to *Side effects & boundaries*; refresh the rollback recipe (still
  a two-part-kill-switch off; the new endpoint disappears when
  either half is off — verify with a curl); refresh *Verification
  snapshot* with the R4-D real-browser QA reference.

## Tests (what to add — every branch you write needs coverage)

- Extend `tests/visual-editor-brand-control-center-state.test.cjs`
  with jsdom cases for: save-status-strip renders when the
  `dbvc:visual-editor:panel:saved` document event fires; strip
  fades after N ms; reduced-motion path renders without transition.
- Add a media-manager jsdom case ONLY if you touch overlay-app.js's
  save flow in a way that could affect media-manager saves. If your
  overlay-app hook is scoped to a shared-globals-only path,
  media-manager suite (42/42) is the regression guard.
- Real-browser QA report is the authoritative evidence for the
  visual + interaction changes — jsdom cannot prove overflow
  measurement or the visual save-status-strip fade.

## Green baselines to preserve (verify at slice boundary)

- `vendor/bin/phpunit` → 888 tests, 7 failures (same 7 pre-existing
  unrelated failures across Bricks / Content Collector / Content
  Migration / Proposal Diff / Capability Landscape suites).
- `vendor/bin/phpunit --filter "VisualEditor(Control|SharedGlobals)"`
  → 60 tests / 200 assertions OK (unchanged since R4-A landing;
  R4-D touches no backend).
- `node --test tests/visual-editor-brand-control-center-state.test.cjs`
  → 30/30 pass (will grow as R4-D adds jsdom cases).
- `node --test tests/visual-editor-media-manager-state.test.cjs`
  → 42/42 (must stay at 42 unless you deliberately extend the save
  path).
- `composer agent-docs:refresh && composer agent-docs:check` →
  `54 curated / 443 discovered / 0 unmapped`. R4-D is UI-only unless
  you add a hook to overlay-app.js — a new hook there could shift
  a hash; re-map if so.

## Doc reconciliation checklist at slice landing (mandatory)

- `docs/dropins/.../releases/R4-EXPANDED-GLOBAL-BRAND-CONTROL-CENTER.md`
  add §R4-D checkpoint like §R4-C-2's.
- `docs/dropins/.../qa/R4-DRAWER-BROWSER-QA-REPORT.md` (new; the
  R3 report is the shape).
- `docs/dropins/.../releases/BRAND-CONTROL-CENTER-RELEASE-NOTES-AND-ROLLBACK.md`
  full R4 refresh (see R4-D-2 above).
- `docs/dropins/.../tracking/EVIDENCE-LOG.md` E-104.
- `docs/dropins/.../tracking/DECISION-LOG.md` D-065+ only if you
  took a net-new decision (save-status-strip fade duration, label
  truncation policy). Neither trivially warrants a decision row.
- `docs/dropins/.../tracking/IMPLEMENTATION-TRACKER.md` R4 row
  status advances to "R4 complete".
- `addons/visual-editor/CHANGELOG.md` — one paragraph.
- `addons/visual-editor/docs/handoffs/DBVC_VISUAL_EDITOR_HANDOFF.md`
  boundary-line refresh.
- Archive THIS file (`DBVC_R4D_RESUME_PROMPT.md`) into `archive/`
  and write a fresh R5.1 resume prompt (or a Post-R4 residual/QA
  prompt if R5 isn't next).

## Pinned R4-A + R4-B + R4-C decisions carried into R4-D

Every decision in the R4-C release-doc §"Pinned R4-C decisions"
section (mixed filter model; priority chip client-side via
`sortKey`; save-status-strip → R4-D; IO-unavailable → empty slots)
stays authoritative. R4-D executes the "save-status-strip → R4-D"
deferral; the other three are just carry-throughs.

Do NOT re-open any of these. If you believe one needs to change,
PROPOSE the change to the user before implementing.
```

---

## Reference material (optional depth)

### Where things stand right now

- **R3 core (R3-A + R3-BX + R3-B + R3-C-1 + R3-C-2 + R3-D)** — signed
  off 2026-08-29. Real-browser QA CLOSED 2026-08-29 (E-099).
- **VerticalControlProvider cross-repo bridge** — landed 2026-08-29.
  400 R3-BX curation records reach the drawer as
  `status="unsupported"`. See E-098.
- **R4-B mockup** — landed 2026-08-29 with 7 pinned decisions.
- **R4-A backend** — landed 2026-08-30. `viewModelVersion=2`, new
  `family` + `q` list params, `providerErrors` map, batch
  `value-summaries` endpoint. See E-100 + D-064.
- **R4-C production drawer** — landed 2026-08-31 across three
  sub-slices:
  - **R4-C-1a** — server round-trip for `family` + `q`, description
    line, providerErrors banner, priority-chip fix. See E-101.
  - **R4-C-1b** — IntersectionObserver batch value-summary loader.
    See E-102.
  - **R4-C-2** — view-mode toggle (category ↔ provider), collapsible
    group headers per `record.group`, search-wrap DOM, invariant
    sweep. See E-103.
- **R4-D** — NEXT. This resume prompt.
- **R5.1–R5.4** — scheduled family-by-family unlocks for the
  remaining ACF option field types (all "Not started" per
  IMPLEMENTATION-TRACKER).

### Baselines at handoff time (2026-08-31, R4-C fully landed)

| Baseline | Number | Command |
|---|---|---|
| PHPUnit total | 888 tests / 9305 assertions | `vendor/bin/phpunit` |
| PHPUnit pre-existing failures | 7 (unrelated: Bricks, Content Collector, Content Migration, Proposal Diff, Capability Landscape) | ditto |
| PHPUnit Control + SharedGlobals subset | 60 / 200 OK | `vendor/bin/phpunit --filter "VisualEditor(Control\|SharedGlobals)"` |
| PHPUnit R4-A suite | 19 / 60 OK | `vendor/bin/phpunit --filter "VisualEditorControlCenterR4A"` |
| jsdom drawer | 30 / 30 pass | `node --test tests/visual-editor-brand-control-center-state.test.cjs` |
| jsdom media-manager | 42 / 42 pass | `node --test tests/visual-editor-media-manager-state.test.cjs` |
| Agent docs | 54 curated / 443 discovered / 0 unmapped | `composer agent-docs:refresh && composer agent-docs:check` |

### Files R4-C touched (context for R4-D)

Drawer + assets:
- `addons/visual-editor/assets/js/brand-control-center-app.js`
  (state additions for viewMode / expandedGroups / providerErrors /
  valueSummaries; new helpers, event handlers, per-group tbody
  render; ~1900 lines total)
- `addons/visual-editor/assets/css/control-center.css`
  (banner + label-block + description; value-summary + relationship
  chip; view-toggle + search-wrap + group-header + reduced-motion
  block)
- `addons/visual-editor/src/Assets/AssetLoader.php`
  (16 new i18n keys across R4-C-1a/1b/2; widened search placeholder)

Tests:
- `tests/visual-editor-brand-control-center-state.test.cjs`
  (14 → 30 pass; +7 R4-C-1a + IntersectionObserver polyfill + 4
  R4-C-1b + 5 R4-C-2)

Docs:
- `docs/dropins/.../releases/R4-EXPANDED-GLOBAL-BRAND-CONTROL-CENTER.md`
  (§R4-C rewrite + §R4-C-1a / §R4-C-1b / §R4-C-2 checkpoints)
- `docs/dropins/.../tracking/{EVIDENCE-LOG.md, IMPLEMENTATION-TRACKER.md}`
  (E-101, E-102, E-103 + R4 row promoted three times)
- `addons/visual-editor/CHANGELOG.md`
  (three top entries — one per sub-slice)
- `addons/visual-editor/docs/handoffs/DBVC_VISUAL_EDITOR_HANDOFF.md`
  (boundary-line refreshed three times)

### What's out of scope for R4-D

- Any new mutation authority. R4 is UI-only.
- New ACF field-family support (color_picker, text/textarea,
  wysiwyg, image, gallery editing). That's R5.x territory —
  separate slices with their own gates.
- Native (non-ACF) WordPress option pages. Not in scope for R3/R4/R5.
- Real Safari / real assistive-technology QA. Permanent non-goal
  per D-058.
- Mobile / tablet / touch. Permanent non-goal per D-058.
