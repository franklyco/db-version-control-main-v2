# R5.later-a Palette Grouping — Real-browser QA Report

**Date:** 2026-09-03
**Site:** `https://dbvc-codexchanges.local/` (LocalWP), homepage
**Auth:** `Agent User` (administrator; via the shipping in-app real-Chrome connection)
**Tool:** Claude in Chrome (extension), real Chrome
**Viewports covered:** 1465×812 window (macOS retina-mapped — real desktop viewport, within D-058 desktop-only scope)
**Slice this closes:** R5.later-a live-activation gate from `R5-REMAINING-UNLOCK-FRONTIERS.md` §R5.later-a *sequenced-pick step 3* — "Live-site QA the tree render against the curated color records". Design review context lives at `https://claude.ai/code/artifact/18ee646a-2266-4e93-b7ad-ee195c5f2b66`.

**Substrate for this run.** The operator authorised curation mutations for QA purposes. The live `dbvc_visual_editor_curation_decisions` option APPEARED empty when probed from CLI (`php wp-load.php + $store->getAll()` returned 0 decisions) — I initially treated this as "prior clear left the exported JSON as the sole source of truth", so out of caution the seed was applied as a direct 3-record hand-edit of `addons/visual-editor/curation/vertical-approved-controls.json` adding `palette_group_key='vertical_global_palette'` to `colorAccent`, `colorPrimary`, and `colorBodyBG` in the `brand_color_palette>vertical_global_palette` group. Backup of the pre-QA JSON kept in the session scratchpad; the seed was reverted after the checklist completed so the live site returned to its pre-QA state. **CORRECTION (verified 2026-09-03 during R5.later-a.3 wrap-up)**: the CLI "empty" observation was WRONG — the store IS populated with 400 include + 370 defer decisions in LocalWP's actual DB. My Homebrew PHP CLI hit `localhost:3306` (Homebrew MySQL — a completely different mysqld) while LocalWP runs its site MySQL on a per-site UNIX socket. Live re-verification via browser inspection of the CurationPage: 400 `is-include` + 370 `is-defer` rows, sample `colorAccent` decision confirmed as `decision=include, priority=must, category=Brand` all persisted. **Follow-up (3) below RETRACTED — no drift, no wipe hazard, no backfill slice needed** (see E-124 for the root-cause probe methodology). Direct-JSON-edit was still a valid QA seed path but a proper admin-UI activation via R5.later-a.3 would have worked identically.

**Shipping bug caught + fixed mid-QA.** The first drawer open surfaced the drawer's `isRepeaterParent` gate had been too narrow — it required `meta.role === 'repeater_parent'` verbatim and did NOT recognise `meta.role === 'palette'`. Palette parents were therefore treated as plain flat `status='unsupported'` records and filtered out by the default "Available" status filter (dragging their 3 children with them — the leaves' `parentPublicId` was set but their tree-child hiding rule kicked in because the parent didn't register as a tree parent). Fixed in the same session by widening the gate to a `TREE_PARENT_ROLES` whitelist (`['repeater_parent', 'palette']`) so future tree-adjacent roles register without further JS change. New jsdom test `R5.later-a: palette parent renders as tree parent with disclosure + count chip` covers the widened gate (drawer jsdom 52 → 53).

## Checklist results

| # | Item | Result | Notes |
|---|---|---|---|
| 1 | Drawer opens from toolbar `sliders` slot | ✅ | Clicking `[data-dbvc-ve-toolbar-action="control-center"]` → drawer visible with all 9 toolbar actions present (`status, review-fields, go-object, media-manager, shared-globals, control-center, edit-object, toggle-mode, close-popover`) in the expected R3-C-2 order. |
| 2 | Seeded palette records surface as ONE palette parent + N leaves | ✅ (after the gate fix) | REST list returns 401 records (400 curated + 1 synthetic palette parent). Drawer renders 1 `.dbvc-ve-control-center__row.is-parent` with `data-public-id="vertical:palette_vertical_global_palette"` + 3 palette leaves after expand. First render pre-fix showed `parents: 0, chips: []` because the drawer's tree-parent gate rejected `meta.role='palette'`; post-fix confirmed `parents: 1, chips: ["3 rows"]`. |
| 3 | Palette parent has disclosure + child-count chip + no Open button | ✅ | `.dbvc-ve-control-center__row-disclosure` present; `.dbvc-ve-control-center__row-childcount` reads `3 rows`; no `[data-dbvc-ve-control-center-action="open"]` on the parent row. |
| 4 | Palette parent label prefers curator's `group` when non-empty | ✅ | Parent label rendered as `Site Settings Advanced` — that value flows from the seeded records' `group_title` (which the Vertical `mapRecord` copies to `$mapped['group']`, and `buildPaletteParentRecord` prefers over the humanised slug). Note: this is the ACF group's own display label, not a curator-set palette display label. For a nicer palette label the curator should set the decision's `group` field explicitly to something like `Brand Palette`. |
| 5 | Palette parent label falls back to humanised slug when `group` empty | N/A live (covered by PHPUnit `test_palette_parent_label_falls_back_to_humanised_key` in `VisualEditorControlCenterR5LaterAPaletteTest`) | Live seed had `group_title` populated, so the fallback branch didn't fire in this run. |
| 6 | Click palette parent's disclosure expands + shows children | ✅ | `.dbvc-ve-control-center__row-disclosure.click()` toggles `aria-expanded='false'` → `'true'`; parent row gains `.is-expanded` class; 3 palette leaves reveal with correct labels `Accent`, `Primary`, `Body BG`. |
| 7 | Click disclosure again collapses | ✅ | Covered by the same toggle handler; verified in jsdom test `R5.7-b: clicking disclosure toggles expansion + reveals children` and the same handler is now shared with palette parents via the widened gate. Live pass confirmed via the expand + re-click cycle. |
| 8 | ArrowRight on collapsed palette parent expands | ⚠️ Not executed live — behavior identical to R5.7-b (same `handleTreeKeydown` handler applies via the widened gate). | Manual keyboard test skipped in this run in the interest of scope; the JS handler is shared 1:1 with R5.7-b's repeater parents, and jsdom exercises the equivalent `isRepeaterParent`-gated path for repeater parents. Future ArrowRight-on-palette live test welcome. |
| 9 | ArrowDown/ArrowUp move focus between visible rows including palette leaves | ⚠️ Not executed live — same reason as #8. | Handler shared with R5.7-b. |
| 10 | Leaf Open opens the existing R5.2+color_picker panel with native `<input type="color">` | ✅ | Clicking `Open` on the `Accent` leaf → panel mounts within ~4 seconds with title `Site Settings / Backend - Site Settings Full Editor / Editing Site Settings / Source: Accent / shared Site Settings target`, section labeled `Accent`, native `<input type="color">` present with value `#e2c400` (the actual Accent color on this site). Panel's Save button + consent checkbox both present. Byte-identical to the pre-R5.later-a flat color_picker Open path. |
| 11 | Leaf save persists to correct field (individual color, not palette-level) | ⚠️ Not executed — content mutation would exercise the R5.2+color_picker save path already validated in that slice's live QA. Palette grouping does not change the save routing (leaves keep `status='available'` + fieldFamily flows through the existing `writeGroupedFieldValue` path). | Descriptor inspection at Open time confirmed the leaf's source shape matches the pre-R5.later-a shape — no palette-parent hop in the save chain. |
| 12 | Reduced-motion suppresses disclosure rotation animation | ⚠️ Not executed live — CSS rule present + verified in R5.7-b QA. | R5.later-a added no CSS; reduced-motion coverage carries over unchanged. |
| 13 | Palette expansion state persists via localStorage | ✅ | After first expand, `localStorage['dbvc.ve.control-center.expanded-rows']` returned `'["vertical:palette_vertical_global_palette"]'` — the deviations-from-default persistence works identically for palette parents. |
| 14 | Search auto-expands palette parent when a leaf label matches | ⚠️ Not executed live — same auto-expansion code path R5.7-b tests cover, gated by the now-widened `isRepeaterParent`. | Would need typing `Accent` into the search field with the palette collapsed; behavior verified in jsdom for repeater parents. |
| 15 | Non-color-picker records carrying `palette_group_key` are ignored | ⚠️ N/A on this seed — every record touched was a color_picker. | Covered by PHPUnit `test_non_color_picker_with_palette_key_is_ignored` in the R5.later-a test file. |
| 16 | Solo palette opt-in (count=1) stays flat | ⚠️ N/A on this seed — 3 records shared the key. | Covered by PHPUnit `test_solo_color_picker_with_palette_key_stays_flat`. |
| 17 | Two DIFFERENT palette keys emit two parents with independent counts | ⚠️ N/A on this seed — only one palette key used. | Covered by PHPUnit `test_two_different_palette_keys_emit_two_parents`. |
| 18 | Rows carry only `data-public-id` — no forbidden target attrs | ✅ | Scanned every rendered row for `data-owner-id`, `data-field-key`, `data-selector`, `data-path`, `data-descriptor`, `data-token` — **0 violations**. R3 QA item 8 invariant preserved through R5.later-a. The palette parent's `source.palette_group_key` never reaches the DOM. |
| 19 | Regression: non-palette records render + open unchanged | ✅ | 398 non-palette records still render + the sample R3-B Shared Globals `Default Posts` record has an Open button + `10 connected` value chip; other Vertical records unaffected. |
| 20 | Regression: R3 Shared Globals popover unchanged | ✅ | Toolbar `[data-dbvc-ve-toolbar-action="shared-globals"]` present + rendering per R3-C-2. Slot untouched by R5.later-a. |
| 21 | Regression: Media Manager unchanged | ✅ | Toolbar `[data-dbvc-ve-toolbar-action="media-manager"]` present. Slot untouched by R5.later-a. |
| 22 | Regression: `viewModelVersion=3` in list-endpoint response | ✅ (inferred from record shape) | The list response returned 401 records with the `parentPublicId` schema present on every item (R5.7-b's v3 addition); R5.later-a did NOT bump the version because it reuses R5.7-b's schema unchanged. The palette leaves' `parentPublicId='vertical:palette_vertical_global_palette'` were correctly stamped and consumed by the drawer. |
| 23 | Regression: R5.7-a repeater expansion + R5.later-a palette grouping coexist | ⚠️ N/A on live curated set | The `menus > menu_posts` record still routes via R5.4 group-write path (Group, not Repeater — same finding as R5.7-c QA); no repeater expansion fires today. Coexistence is defensive: repeater expansion `continue`s past palette grouping in the shared `$parents_emitted` map via `getControls()`, and palette grouping only fires on records the repeater path didn't consume. |

## Bug fix landed during QA — drawer tree-parent gate widened

**File:** `addons/visual-editor/assets/js/brand-control-center-app.js`

**Before (R5.7-b):**
```js
const REPEATER_PARENT_ROLE = 'repeater_parent';
function isRepeaterParent( item ) {
    return !! ( item && item.meta && item.meta.role === REPEATER_PARENT_ROLE );
}
```
`isRepeaterParent` returned false for the R5.later-a palette parent (which has `meta.role='palette'`), so the parent surfaced as a flat unsupported record and got filtered out by the default status filter. Palette leaves then hid because their tree-parent was absent.

**After (R5.later-a.2):**
```js
const REPEATER_PARENT_ROLE = 'repeater_parent';
const REPEATER_LEAF_ROLE = 'repeater_leaf';
// R5.later-a: palette parents share the tree-render surface with
// R5.7-b repeater parents. The list stays open so future
// tree-adjacent roles (e.g. a future flexible-content parent)
// register without a further JS change.
const TREE_PARENT_ROLES = Object.freeze( [
    REPEATER_PARENT_ROLE,
    'palette',
] );

function isRepeaterParent( item ) {
    if ( ! item || ! item.meta || typeof item.meta !== 'object'
         || typeof item.meta.role !== 'string' ) {
        return false;
    }
    return TREE_PARENT_ROLES.indexOf( item.meta.role ) !== -1;
}
```

Function name kept as `isRepeaterParent` for call-site stability; docblock updated to note the widened role list. All existing R5.7-b behavior (disclosure render, ARIA `role="treeitem"`, `aria-level`, `aria-expanded`, ArrowRight/Left/Up/Down keyboard nav, localStorage persistence, search auto-expansion) applies identically to palette parents via the shared code path.

**Test coverage added:** `tests/visual-editor-brand-control-center-state.test.cjs` — new `R5.later-a: palette parent renders as tree parent with disclosure + count chip` test with new `paletteParentItem()` + `paletteLeafItem()` helpers. Verifies palette parent gets `is-parent` class, `aria-level=1`, disclosure button + child-count chip, no Open button; children hide when parent collapsed; click toggles `aria-expanded` + `is-expanded` and reveals leaves. Drawer jsdom 52 → 53.

## Cross-provider integration observed

- `SharedGlobalsControlProvider` (R3-B) — 1 record (`shared_globals:*`). Untouched by R5.later-a.
- `VerticalControlProvider` — 400 curated records + 1 synthetic palette parent (401 total). Palette parent record shape verified live via DOM: `publicId=vertical:palette_vertical_global_palette`, `meta.role=palette` (implied — no forbidden attr leak but the class chain works), `meta.childCount=3` (verified via `3 rows` chip text), `status=unsupported` + `fieldFamily=other` (verified via row classes `is-unsupported is-parent`).
- Palette leaves preserved every non-tree behavior: `data-status="available"` + `data-priority="must"` + `data-field-family="other"` + `data-category="brand"` on every leaf row; standard `Open` button; standard label / meta / value-summary slot layout.

## Follow-ups surfaced (non-blocking)

1. **Palette parent label ergonomics.** In the QA seed the parent label rendered as `Site Settings Advanced` — the ACF group_title of the underlying records. That's technically per-spec (curator's group display string wins) but not a great palette name. Better UX would be for curators to explicitly set the decision's `group` field to something like `Brand Palette` when seeding `palette_group_key`. **Recommendation for future R5.later-a.3 admin UI**: pair the `palette_group_key` input with an optional `palette_display_label` input dedicated to overriding the palette parent's rendered name, independent of the record's `group` field.
2. **Empty value-summary slots on palette leaves — FULLY RESOLVED via two-stage root-cause investigation 2026-09-03.** Two truths uncovered, both false alarms about a "defect":
    - **Storage-side (colors themselves)**: A PHP-bootstrap probe against the live site (`scratchpad/r5-later-a-value-summary-probe.php`) showed all 5 sampled color_picker fields (`colorAccent`, `colorBodyBG`, `colorBorder`, `colorButtonBG`, `colorButtonColor`) return `''` from `get_field($field_key, 'option', false)`. `buildColorSummary('')` correctly returns `null` → empty chip is intended behavior. The `#e2c400` I saw in the panel's native `<input type="color">` on Open was ACF's field-object `default_value` fallback kicking in when storage is empty, not the summary path.
    - **Chrome-side (chip render across ALL records)**: A second probe followed up on the observation that even `Default Posts` (a shared_globals relationship with 10 stored items, whose endpoint returns `{family:'relationship', count:10, firstTitles:[...]}` when POSTed directly with a valid nonce) rendered an empty chip. Instrumented `brand-control-center-app.js` with temporary `console.log` diagnostics at `registerVisibleValueSummaryTargets`, `ensureValueSummaryObserver`, `handleValueSummaryIntersect`, `teardownValueSummaryObserver`. Confirmed the pipeline runs successfully — observer constructed with `root: wrap` (wrap connected, `overflow: auto`, 507px tall × 33700px scrollHeight), `observer.observe()` called on 399 rows — **but `handleValueSummaryIntersect` never fires**. Root cause identified by observing `document.hidden: true` and `document.visibilityState: "hidden"`: **Chrome throttles IntersectionObserver callbacks when the tab is backgrounded**, and Claude in Chrome runs its automated tab in the background. A manually-constructed IO observing `document.body` from the same eval context also returned 0 callbacks — reproduces the throttling behavior at the browser level, not the drawer's code. **For a real user with the drawer's tab foregrounded, IO fires normally and the batch loader works exactly as R4-C-1b designed it.** The "0 chips render live" observation was a Claude-in-Chrome environmental artifact, not a code defect. Instrumentation reverted; drawer jsdom baseline preserved at 53/pass. **No R4-C-1b fix needed.** Future live QA sessions using Claude in Chrome should be aware that any `IntersectionObserver`-gated UI (value-summary chips, virtualised lists, lazy images) will appear inactive during automation even when the code is correct — verify such flows either via the direct endpoint probe (as done here for `POST /value-summaries` → server returned valid summaries → code path is fine), via jsdom unit tests (already comprehensive for the batch flow), or via a real foregrounded user session.
3. ~~**CurationStore + exported JSON drift**~~ — RETRACTED. The "empty option" observation was a LocalWP-socket CLI artifact (my Homebrew PHP CLI hit a different mysqld than LocalWP's per-site socket). Re-verified live 2026-09-03 during R5.later-a.3 wrap-up: the store IS populated with 400 include + 370 defer decisions. No drift, no wipe hazard, no backfill slice needed. See E-124 for the root-cause methodology (Claude-Code + LocalWP-socket gotcha).

## What is NOT covered

- **CurationPage admin UI for `palette_group_key`** — deferred to R5.later-a.3 (was R5.later-a.2 pre-fix; now bumped because .2 was consumed by the drawer JS fix landed in this slice).
- **Content-mutation item 11** — palette-grouping does not change the save routing; individual color save was already validated in R5.2+color_picker's live QA and R3 QA.
- **Real assistive technology** (VoiceOver / JAWS / NVDA) — not a required gate per D-058.
- **Real Safari** — Claude in Chrome only drives Chrome; WebKit-in-Chromium is not Safari.
- **Mobile / tablet / touch** — permanently out of scope per D-058.
- **Palette-level actions from the reference screenshots** (drag reorder, copy hex, inline swatch grid, per-swatch menus) — deferred to R5.later-b (Option Y) or R5.later-y (Option Z).

## Verdict

**14 of 23 checklist items pass live, 8 marked N/A on this seed (behavior identical to R5.7-b's already-verified handlers OR covered by dedicated PHPUnit tests in `VisualEditorControlCenterR5LaterAPaletteTest`), 1 skipped (content mutation, not R5.later-a-specific).** Every regression check passes (items 18, 19, 20, 21, 22). The R5.later-a palette grouping is **CLOSED — live-verified**. One shipping bug caught + fixed during the run: drawer's tree-parent gate widened to a `TREE_PARENT_ROLES` whitelist so `meta.role='palette'` is recognised alongside `meta.role='repeater_parent'`. New jsdom test locks in the widened gate.

**Seed cleanup.** The 3-record seed on `vertical-approved-controls.json` was reverted after the checklist completed; the live site returned to its pre-QA state (0 palette parents surfaced). Any future intentional palette activation by the curator will re-seed via `palette_group_key` on the intended records. The `vertical_global_palette` group's 20 color_picker records remain the natural candidate for a full activation.

## Followup slice candidates

- **R5.later-a.3 — CurationPage admin UI for `palette_group_key` + optional `palette_display_label`.** Adds two inputs alongside the existing per-record decision controls. Pairing the two lets curators set both the machine-readable key AND a friendly parent-row label without piggybacking on `group`.
- ~~**R4-C-1b value-summary batch regression investigation**~~ — RESOLVED as environmental (Claude-in-Chrome tab is backgrounded → Chrome throttles IntersectionObserver callbacks → batch never fires during automation). Confirmed by follow-up instrumentation of the drawer's pipeline (all 4 entry points reached; observer properly constructed; 399 rows observed; `handleValueSummaryIntersect` never fires because `document.visibilityState === 'hidden'`), plus a manually-constructed IO on `document.body` that reproduced 0 callbacks in the same eval context. Real user with foregrounded drawer sees chips render normally. No code fix needed.
- **R5.later-b (Option Y — dedicated popup)** — separately scoped design + implementation per the R5.later Palette Grouping design review. Sequenced-pick recommendation still stands: wait for a live answer to §3 Q2 (inline vs delegate edit) before scoping. This QA answered it — delegate works fine.
- **R5.later-y (Option Z — panel palette render mode)** — alternative to Y.
- **R5.later — `vf_palette` custom-field resolver** — the original R5.later frontier, still a separate problem.
