# R4-C resume prompt — Expanded Brand Control Center (production drawer)

> Fresh, self-contained resume for a new Claude Code session. R4-A (backend)
> and R4-B (mockup) are done and documented in the release doc + EVIDENCE-LOG
> E-100 / DECISION-LOG D-064; R4-C is the next slice — the production drawer
> that consumes R4-A's shape. R4-D (transition + hardening) is after that.
>
> **How to use this file:** copy the fenced block below into a fresh Claude
> Code chat in this repo. It is self-contained (no self-reference to this
> file) and gives the fresh agent enough to propose an R4-C plan and start
> work. The reference material below the fence is optional depth.
>
> **When R4-C lands:** archive this file into `archive/` alongside the R3
> resume, refresh `DBVC_VISUAL_EDITOR_HANDOFF.md`'s boundary line, and write
> a fresh R4-D (or R5.1) resume prompt whose scope matches the next slice.

---

```
Continue the DBVC Visual Editor R4 work — implement Slice R4-C (production drawer
that consumes the R4-A backend contract; UI-only; no new REST routes, no new
mutation authority, no change to the R3-D two-part kill switch).

Working directory:
/Users/rhettbutler/Documents/LocalWP/dbvc-codexchanges/app/public/wp-content/plugins/db-version-control-main

## Read first (in this order — do not skip)

1. addons/visual-editor/docs/handoffs/DBVC_VISUAL_EDITOR_HANDOFF.md
   — current boundary line + product boundary + safety/git rules.
2. docs/dropins/dbvc-visual-editor-brand-controls-guide/releases/R4-EXPANDED-GLOBAL-BRAND-CONTROL-CENTER.md
   — the whole doc; §R4-A checkpoint is the ground truth for the backend
   shape you will consume; §R4-C is the target slice.
3. docs/ui-mockups/dbvc-visual-editor/r4-expanded-brand-control-center/
   — README.md, DESIGN-DECISIONS.md (7 pinned decisions — honor verbatim),
   COMPONENT-NOTES.md (selector map + per-family value-summary contract),
   index.html + states.html + styles.css (production translation targets).
4. addons/visual-editor/assets/js/brand-control-center-app.js
   — the R3-C-2 drawer you will extend (~900 lines, IIFE). Do NOT rewrite;
   extend surgically. Match the code shape of media-manager-app.js.
5. addons/visual-editor/assets/css/control-center.css
   — R3-C-2 scoped stylesheet. Extend rather than rewrite; reuse the
   mockup's selector names so styles.css can drop in with rename-only diffs.
6. addons/visual-editor/src/Rest/Controllers/ControlCenterListController.php
   + ControlCenterValueSummariesController.php
   — the R4-A endpoints the drawer will consume. Note: viewModelVersion=2,
   query echoes `category`/`status`/`family`/`q`, response carries
   `providerErrors`. Value-summaries is POST with `{publicIds: [≤50]}`
   returning `{summaries: {publicId → summary|null}}`.
7. addons/visual-editor/assets/js/media-manager-app.js
   — reference pattern for IIFE lifecycle, event delegation, and the
   IntersectionObserver-driven lazy load. Do not import from it; mirror
   its shape.
8. docs/dropins/dbvc-visual-editor-brand-controls-guide/tracking/{EVIDENCE-LOG.md, DECISION-LOG.md, IMPLEMENTATION-TRACKER.md}
   — latest entries E-100 and D-064 pin R4-A's shape and the batch endpoint decision.

## Hard constraints (from the current handoff §Safety)

- Preserve the intentional dirty tree at base commit 5db4b40. No git
  operations either repo — no add / commit / stash / reset / checkout /
  clean / push. If you notice a change you did not make, investigate; do
  not overwrite.
- No live-site mutations. Never trigger a save against the LocalWP site;
  never toggle `dbvc_visual_editor_control_center_enabled` or the master
  Visual Editor option outside test setUp/tearDown; never send content
  through a REST route in production browsing.
- Never touch `~/.config/dbvc-local-agent.env`. If you need to run against
  the live site, ask.
- Desktop-only per D-058: 1440×900 primary + 1280×720 secondary. No
  mobile/tablet/touch scoping.
- No new write authority. R4 is UI-only; every save keeps routing through
  the existing MutationService pipeline via the R3-C-1 open path.
- Kill switch stays default off. Both parts of D-063 (master + Enable
  Brand Control Center) are required for any R4-C surface to render.

## R4-A backend contract (what R4-C consumes — DO NOT change)

- `GET .../session/{id}/control-center/controls?category=&status=&family=&q=`
  returns `{ok, viewModelVersion:2, query:{category,status,family,q},
  items:[…], providerErrors:{providerId → {message}}}`. `items[*]` carry
  `publicId, label, description, category, group, ownerType, ownerSubtype,
  fieldFamily, status, sortKey, meta` — NEVER a `source` bag.
- `POST .../session/{id}/control-center/value-summaries` body
  `{publicIds: string[]}` (max 50, over-cap → 400). Returns
  `{ok, summaries:{publicId → summary|null}}`. For relationship /
  post_object today the summary is
  `{family, count, firstTitles:string[≤3], hasMore:bool}`; every other
  family returns `null` until an R5 factory ships.
- `POST .../session/{id}/control-center/open` body `{publicId}` — mints a
  fresh descriptor, does the same capability recheck the summary endpoint
  does, attaches it to the session, returns `{ok, publicId, descriptors,
  descriptorHydrations}` for the existing main editor panel to consume via
  the `dbvc:visual-editor:absorb-descriptor` document event (R3-C-2 bridge).

## R4-C in-scope work (confirmed 2026-08-31 as three sub-slices)

Split into R4-C-1a / R4-C-1b / R4-C-2 for stability + smaller review
surface. Full detail is in the release doc §R4-C. Summary:

**R4-C-1a — contract wiring + priority-derivation fix** (+7 jsdom cases)

- Send `family` + `q` on the list route (250ms debounce on search;
  family chip fires immediate GET). `status` + `category` stay
  client-side (mixed filter model is intentional — keeps tab
  counting cheap).
- Introduce `loading-refresh` state (dimmed overlay over existing
  rows for non-initial requests; `.__refresh-overlay` selector is
  already shipped, unused).
- Render `item.description` (top-level on `toListItem()`, NOT under
  `meta`) as a muted second line; `textContent`, never innerHTML;
  omit the node when empty.
- Render `payload.providerErrors` as top-of-list
  `.__notice--provider-error` (`role="status"`, one line, dismiss
  button, per-drawer-lifetime dismissal).
- Fix `priorityFromItem()` — derive must/should/nice from `sortKey`
  prefix (`vertical_1_*` → must, etc.). The R3-C-2 `item.priority`
  fallback is dead against R4-A data.

**R4-C-1b — batch value-summary loader** (+4 jsdom cases)

- `IntersectionObserver` (root = `.__table-wrap`) on `status='available'`
  rows whose publicIds are unhydrated. 50ms-debounced batch flush of
  up to 20 publicIds → POST `.../control-center/value-summaries`.
  In-memory `state.valueSummaries` map persists for the drawer's
  lifetime; surgical re-render of the affected rows' summary slots
  only (no full `renderList()`).
- Family dispatcher — only `relationship` + `post_object` render for
  now (`<strong>{count}</strong> connected` + `title` = first 3
  titles); other families / null → empty slot. R5.x owns the rest.
- Graceful degrade if `IntersectionObserver` is unavailable — empty
  slots silently, no fallback fetch.

**R4-C-2 — view-mode toggle, collapsible groups, search-wrap, state
gallery, invariant sweep** (+5 jsdom cases)

- Header `.__view-toggle` segmented control (`By category` /
  `By provider`; localStorage `dbvc.ve.control-center.view-mode`
  wrapped in try/catch; arrow-key nav).
- Collapsible group headers per category (tbody-per-group,
  `.__group-header` disclosure with `aria-expanded`, keyed
  `{providerId}::{record.group}`; collapsed by default; per-viewer
  localStorage). Empty groups omitted.
- Search-wrap DOM (leading icon + Clear button).
- Translate remaining `states.html` cells: descriptor-loading,
  permission-filtered lock, value-summary loading skeleton,
  value-summary empty slot, loading-refresh dimmed overlay.
- Invariant sweep: reduced-motion suppresses chevron + segmented
  transitions; row-focus continuity survives view-mode flips;
  single polite live region rule preserved.

**Deferred to R4-D (not R4-C-2)**: save-status-strip. Requires an
overlay-app.js dispatch on save success, which straddles the R3-C-2
pinned baseline (14/14 jsdom + E-099 real-browser QA). R4-D already
carries the real-browser QA that catches cross-panel regressions.

### Green baselines to preserve at each slice boundary

- PHPUnit: 888/7 unchanged (R4-C touches no backend).
- `--filter "VisualEditor(Control|SharedGlobals)"`: 41/140.
- Drawer jsdom: 14 → 21 → 25 → 30.
- Media-manager jsdom: 42/42 unchanged.
- Agent docs: 54/443/0 (verify — AssetLoader i18n additions may
  rotate an extension-point hash; re-map if so).

## Tests (what to add — every branch you write needs coverage)

- Extend `tests/visual-editor-brand-control-center-state.test.cjs` with
  jsdom cases for: query round-trip on filter change; providerErrors
  banner render + dismiss; value-summary lazy load via a mocked
  IntersectionObserver + fetch; empty-summary slot renders nothing; view-
  mode toggle persists via localStorage; sort order comes from server.
- Backend contract regressions land in `tests/phpunit/VisualEditorControlCenterR4ATest.php`
  only if you touch backend code (you shouldn't in R4-C).

## Green baselines to preserve (verify at slice boundary)

- `vendor/bin/phpunit` → 888 tests, 7 failures (same 7 pre-existing
  unrelated failures across Bricks / Content Collector / Content
  Migration / Proposal Diff / Capability Landscape suites; R4-A adds 19
  new tests to this baseline).
- `vendor/bin/phpunit --filter "VisualEditor(Control|SharedGlobals)"` → 41
  tests / 140 assertions OK.
- `node --test tests/visual-editor-brand-control-center-state.test.cjs`
  → 14/14 pass (will grow as R4-C adds jsdom cases).
- `node --test tests/visual-editor-media-manager-state.test.cjs` → 42/42.
- `composer agent-docs:refresh && composer agent-docs:check` →
  `54 curated / 443 discovered / 0 unmapped`. R4-C is UI-only; expect
  discovery to stay at 443 (add nothing new to the manifest unless you
  add a REST route or hook — which you shouldn't).

## Doc reconciliation checklist at slice landing (mandatory)

- `docs/dropins/.../releases/R4-EXPANDED-GLOBAL-BRAND-CONTROL-CENTER.md`
  add §R4-C checkpoint like §R4-A's.
- `docs/dropins/.../tracking/EVIDENCE-LOG.md` E-101.
- `docs/dropins/.../tracking/DECISION-LOG.md` D-065+ only if you took a
  net-new decision (view-mode default, debounce duration, etc.). Small
  drawer plumbing choices generally don't warrant a decision entry.
- `docs/dropins/.../tracking/IMPLEMENTATION-TRACKER.md` R4 row status
  advances from "R4-A + R4-B landed" to include R4-C.
- `addons/visual-editor/CHANGELOG.md` — one paragraph describing the
  user-visible drawer changes (no jargon; write for a maintainer who
  never touched R4).
- `addons/visual-editor/docs/handoffs/DBVC_VISUAL_EDITOR_HANDOFF.md`
  boundary-line refresh.
- Archive THIS file (`DBVC_R4C_RESUME_PROMPT.md`) into `archive/` and
  write a fresh R4-D resume prompt if R4-D is the next slice.

## Pinned R4-A + R4-B decisions carried into R4-C

1. Value-summaries endpoint is BATCH (`POST .../value-summaries`), lazy
   per row via IntersectionObserver. Never inlined into the list route.
   (D-064)
2. Description sources (Shared Globals):
   `dbvc_visual_editor_control_center_description` filter → ACF
   `instructions` → empty. Description sources (Vertical):
   `vf_field_context_get_entry_primary_purpose($fieldName)` → curation
   `notes` → empty. Vertical also hooks the DBVC filter so Shared Globals
   rows pick up Field Context text.
3. sortKey mapping — Shared Globals `shared_{fieldName}`; Vertical
   `vertical_{must=1|should=2|nice=3|empty=9}_{fieldName}`. Global sort
   is `sortKey ASC → label ASC → publicId ASC`.
4. Provider errors are fail-SOFT — banner only, never shield the list.
5. Category view-mode toggle (grouped vs flat) — per-viewer preference via
   localStorage, wrapped in try/catch (private-window safe).
6. Drawer + main-editor-panel coexist visibly; do not close the drawer on
   open (R3-C-2 D-063 coexistence).
7. Rows carry ONLY `data-public-id`. No `data-owner-id`, `data-field-key`,
   `data-selector`, `data-path`, `data-descriptor`, `data-token`
   (schematic §6 invariant 2, jsdom-asserted).

Do NOT re-open any of these. If you believe one needs to change, PROPOSE
the change to the user before implementing.
```

---

## Reference material (optional depth)

### Where things stand right now

- **R3 core (R3-A + R3-BX + R3-B + R3-C-1 + R3-C-2 + R3-D)** — signed
  off 2026-08-29. Kill switch behind D-063 two-part gate. Drawer opens
  from `sliders` toolbar entry, populates from R3-C-1 REST, opens rows
  into the main editor panel via `dbvc:visual-editor:absorb-descriptor`.
- **VerticalControlProvider cross-repo bridge** — landed 2026-08-29.
  400 R3-BX curation records reach the drawer as `status="unsupported"`.
  See E-098.
- **R3 residual gate CLOSED 2026-08-29** — real-browser QA at 1440×900
  + 1280×720 passed all 12 checklist items. E-099.
- **R4-B mockup** — landed 2026-08-29 with 7 pinned decisions.
  `docs/ui-mockups/dbvc-visual-editor/r4-expanded-brand-control-center/`.
- **R4-A backend** — landed 2026-08-30. Widened ControlRecord + Provider
  interface + Registry filter/sort/error-capture + SharedGlobals emissions
  + new list-controller contract (`viewModelVersion=2`) + new
  value-summaries batch endpoint. Cross-repo: Vertical adopts sortKey +
  description. See E-100 + D-064 + §R4-A checkpoint in R4 release doc.
- **R4-C production drawer** — NEXT. This resume prompt.
- **R4-D transition + hardening** — after R4-C.
- **R5.1–R5.4** — scheduled family-by-family unlocks for the remaining
  ACF option field types (all "Not started" per IMPLEMENTATION-TRACKER).

### Baselines at handoff time (2026-08-30, R4-A landed)

| Baseline | Number | Command |
|---|---|---|
| PHPUnit total | 888 tests / 9305 assertions | `vendor/bin/phpunit` |
| PHPUnit pre-existing failures | 7 (unrelated: Bricks, Content Collector, Content Migration, Proposal Diff, Capability Landscape) | ditto |
| PHPUnit Control + SharedGlobals subset | 41 / 140 OK | `vendor/bin/phpunit --filter "VisualEditor(Control\|SharedGlobals)"` |
| PHPUnit R4-A suite | 19 / 60 OK | `vendor/bin/phpunit --filter "VisualEditorControlCenterR4A"` |
| jsdom drawer | 14 / 14 pass | `node --test tests/visual-editor-brand-control-center-state.test.cjs` |
| jsdom media-manager | 42 / 42 pass | `node --test tests/visual-editor-media-manager-state.test.cjs` |
| Agent docs | 54 curated / 443 discovered / 0 unmapped | `composer agent-docs:refresh && composer agent-docs:check` |

### Files R4-A touched (context for R4-C)

DBVC:
- `addons/visual-editor/src/Registry/ControlRecord.php` (+description, +sortKey)
- `addons/visual-editor/src/Registry/ControlProvider.php` (+buildValueSummary)
- `addons/visual-editor/src/Registry/ControlRegistry.php` (filters, sort, provider errors, buildValueSummaryForRecord)
- `addons/visual-editor/src/Registry/Providers/SharedGlobalsControlProvider.php` (emissions + real buildValueSummary)
- `addons/visual-editor/src/Rest/Controllers/ControlCenterListController.php` (viewModelVersion=2, new params, providerErrors)
- `addons/visual-editor/src/Rest/Controllers/ControlCenterValueSummariesController.php` (new batch endpoint)
- `addons/visual-editor/src/Rest/Routes.php` (wire new controller)
- `addons/visual-editor/src/Bootstrap/Addon.php` (wire optionValueResolver)
- `tests/phpunit/VisualEditorControlCenterR4ATest.php` (new)
- `tests/phpunit/VisualEditorControlCenterRoutesTest.php` (updated for viewModelVersion=2 + providerErrors)
- `tests/phpunit/VisualEditorControlRegistryTest.php`, `VisualEditorControlCenterProvidersFilterTest.php` (anon-class stubs for buildValueSummary)
- `docs/agents/manifest.json` (rotated 3 ids, added 2 new)
- `docs/dropins/.../releases/R4-EXPANDED-GLOBAL-BRAND-CONTROL-CENTER.md` (§R4-A checkpoint)
- `docs/dropins/.../tracking/{EVIDENCE-LOG.md,DECISION-LOG.md,IMPLEMENTATION-TRACKER.md}` (E-100, D-064, R4 row promoted)
- `addons/visual-editor/CHANGELOG.md` (top entry)
- `addons/visual-editor/docs/handoffs/DBVC_VISUAL_EDITOR_HANDOFF.md` (boundary line)

Vertical (in `/Users/rhettbutler/Documents/LocalWP/frameworkflo-live/app/public/wp-content/themes/vertical/functions/features/dbvc-visual-editor/`, mirrored to `/Users/rhettbutler/Documents/LocalWP/dbvc-codexchanges/app/public/wp-content/themes/vertical/functions/features/dbvc-visual-editor/`):
- `includes/class-vf-vertical-control-provider.php` (description via Field Context; sortKey; buildValueSummary null)
- `dbvc-visual-editor.php` (new filter callback for Shared Globals description injection)

### What's out of scope for R4-C

- Any change to descriptor factories or the save pipeline. R4 is UI-only.
- New ACF field-family support. That's R5.1..R5.4 territory — separate
  slices with their own gates. Every Vertical row + every non-relationship
  Shared Globals field stays `status="unsupported"` until an R5 factory
  ships for it.
- Native (non-ACF) WordPress option pages. Not in scope for R3/R4/R5.
- Real Safari / real assistive-technology QA. Permanent non-goal per D-058.
- Mobile / tablet / touch. Permanent non-goal per D-058.
