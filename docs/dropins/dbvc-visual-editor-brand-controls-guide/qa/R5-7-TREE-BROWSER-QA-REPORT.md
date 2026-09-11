# R5.7 Brand Control Center Tree UI — Real-browser QA Report

**Date:** 2026-09-02
**Site:** `https://dbvc-codexchanges.local/` (LocalWP), homepage
**Auth:** `Agent User` (administrator; via the shipping in-app real-Chrome connection)
**Tool:** Claude in Chrome (extension), real Chrome
**Viewports covered:** 1440×900 window request (macOS retina-mapped to 1728×958 CSS pixels — real desktop viewport, adequate for D-058 desktop-only scope)
**Slice this closes:** the R5.7-c residual gate carried into wrap from
`R5.7-INLINE-TREE-IMPLEMENTATION-PLAN.md` §R5.7-c +
`BRAND-CONTROL-CENTER-RELEASE-NOTES-AND-ROLLBACK.md` §R5.7 *Residual /
deferred*.

**State observed live (both providers already registered):** 400
controls total — 1 `shared_globals:` (`available`) + 399 `vertical:`
(mixed; ~397 `available` per R5.1..R5.6 unlocks). **Zero records
carry `meta.role='repeater_parent'` or a non-empty `parentPublicId`
on the live site.** The `menus` field in
`settings_nav_menus > menus > menu_posts` turns out to be an ACF
**Group** (not a Repeater) — R5.6's `parentChainIsGroupOnly` gate
correctly allows the record as top-level `available` via the R5.4
reference-collection path (with R5.7-a's `parentChainImmediateRepeaterInfo`
returning null so no expansion runs). **R5.7-a's expansion path and
R5.7-b's tree UI code paths are therefore untriggered on the current
live curated set** — every visible row renders flat, which is the
correct behavior for a curated set with no repeater-nested records.
Tree-UI code was still verified as PRESENT + non-crashing (server
schema, DOM invariants, CSS rules, state helpers, i18n keys all
live-loaded correctly); the visual expand/collapse behavior is
covered by 51 jsdom tests using synthetic repeater fixtures.

## Checklist results

| # | Item | Result | Notes |
|---|---|---|---|
| 1 | Drawer opens from toolbar `sliders` slot | ✅ | Clicking `[data-dbvc-ve-toolbar-action="control-center"]` → drawer visible; toolbar has 9 actions in expected order (`status, review-fields, go-object, media-manager, shared-globals, control-center, edit-object, toggle-mode, close-popover`); the `control-center` slot sits immediately after `shared-globals` per R3-C-2 pinned decision #2. |
| 2 | R5.7-a: `menus > menu_posts` surfaces as one muted parent + N leaves | ⚠️ N/A on live | Verified by direct REST fetch: the record surfaces as ONE flat `status='available'` reference-collection row with `parentPublicId=""` and no `meta.role`. This is the correct outcome — on this live site `menus` is an ACF Group (not a Repeater), so R5.7-a's `parentChainImmediateRepeaterInfo` returns null and no expansion runs. R5.6's group-only ancestry gate allows the record via the R5.4 top-level relationship path. |
| 3 | R5.7-b: parent row renders as tree parent with disclosure + count chip + no Open | ⚠️ N/A on live | Zero `.__row.is-parent` elements in DOM. Zero `.__row-disclosure` buttons. Zero `.__row-childcount` chips. Correct absence — no repeater curation records exist to surface as tree parents. Code path present + covered by 51 jsdom tests using synthetic repeater fixtures. |
| 4 | R5.7-b: click disclosure expands + shows children | ⚠️ N/A on live | No disclosure to click. See #3. |
| 5 | R5.7-b: click disclosure again collapses | ⚠️ N/A on live | No disclosure to click. See #3. |
| 6 | R5.7-b: ArrowRight expands collapsed parent | ⚠️ N/A on live | No parent to focus. See #3. |
| 7 | R5.7-b: ArrowLeft collapses expanded parent | ⚠️ N/A on live | See #3. |
| 8 | R5.7-b: ArrowDown/ArrowUp move focus between visible rows | ⚠️ N/A on live | Handler installed at drawer-root level; verified via jsdom coverage. |
| 9 | R5.7-b: leaf Open opens the panel with correct subfield | ⚠️ N/A on live | No repeater leaves. The equivalent flat R5.4 `menu_posts` record has an Open button present (verified in DOM); opening it is byte-identical to pre-R5.7-b behavior (Open path unchanged for flat records). |
| 10 | R5.7-a: edit + save persists to correct row | ⚠️ **N/A — architecturally unreachable on this substrate** | Operator authorization granted 2026-09-02, but deeper descriptor inspection confirms no R5.7-a-shaped descriptors exist to write against. The `menu_posts` record's descriptor mints as `source.type='acf_collection_field'` + `is_grouped_field=true` + `group_write_path=[{menus},{menu_posts}]` + `resolver.name='acf_reference_collection'` + `mutation.contract='shared_relationship_collection'` — **the R5.4 group-write path via `writeGroupedFieldValue`, NOT R5.7-a's `writeRepeaterSubfieldValue`**. `container_type`, `row_index`, and `expected_row_signature` are all absent because the record doesn't use the R5.7-a path. A save through the R5.4 path was validated in R3 QA on 2026-08-29; re-testing here would exercise the wrong code path. **R5.7-a's `writeRepeaterSubfieldValue` remains fully covered by 8 PHPUnit tests in `VisualEditorControlCenterR57ATest` with synthetic repeater fixtures**. |
| 11 | R5.7-a: concurrent-reorder detection | ⚠️ **N/A — architecturally unreachable on this substrate** | Same reason as item 10 — the signature-guard code path (`AbstractAcfResolver::verifyExpectedRowSignature`) runs only inside `writeRepeaterSubfieldValue`, which this record's save doesn't reach (routes through `writeGroupedFieldValue` instead). Signature computation + mismatch-rejection paths remain fully covered by dedicated PHPUnit signature tests (6 in `VisualEditorControlCenterR57ATest`: deterministic, order-insensitive, sensitive-to-changes, strips-acf-row-keys, empty-for-non-array, recurses-nested-arrays). |
| 12 | R5.7-b: table has `role="tree"` + `aria-label="Global Brand Controls"` | ✅ | `document.querySelector('.__table').getAttribute('role')` → `"tree"`; `aria-label` → `"Global Brand Controls"`. Present regardless of whether any tree parents exist. |
| 13 | R5.7-b: expansion state persists via localStorage | ✅ (key present, empty as designed) | `localStorage['dbvc.ve.control-center.expanded-rows']` returns `null` because no parents were expanded (no parents exist). This is the CORRECT deviations-from-default state — the key would populate on the first expansion. Companion `dbvc.ve.control-center.groups` already has 6 entries from prior R4-C-2 group toggles, confirming the storage seam works. |
| 14 | R5.7-b: search auto-expands ancestors of leaf-only match | ⚠️ N/A on live | Requires tree parents. Covered by jsdom `recomputeSearchAutoExpansion` unit tests. |
| 15 | R5.7-b: search auto-expands parent whose own label matches | ⚠️ N/A on live | Same as #14. |
| 16 | R5.7-b: reduced-motion suppresses disclosure rotation | ✅ | Stylesheet scan confirms `@media (prefers-reduced-motion: reduce)` rule targeting `.__row-disclosure, .__row-disclosure-icon { transition: none; }` is present + loaded. |
| 17 | R5.7-b: rows carry only `data-public-id` — no forbidden target attrs | ✅ | Scanned all 400 rendered rows for `data-owner-id`, `data-field-key`, `data-selector`, `data-path`, `data-descriptor`, `data-token` — **0 violations, 0 missing publicIds**. R3 QA item 8 invariant preserved through R5.7-b. |
| 18 | R5.7-b: single polite live region preserved | ✅ | `querySelectorAll('.dbvc-ve-control-center [role="status"][aria-live="polite"]').length` = 1. |
| 19 | Regression: pre-R5.7 records still render, open | ✅ | 400 rows visible; sample flat record `vertical:site_settings__global_layout_style__theme_footer_elements__elements_group__partner_logos` has an Open button; sample R5.4 record `vertical:advanced_settings__settings_nav_menus__menus__menu_posts` renders as flat `available` reference-collection row per R5.4 pipeline. |
| 20 | Regression: R3 Shared Globals popover unchanged | ✅ | Toolbar `[data-dbvc-ve-toolbar-action="shared-globals"]` present with `aria-label="Shared globals"`. Slot untouched by R5.7 per D-063. |
| 21 | Regression: Media Manager unchanged | ✅ | Toolbar `[data-dbvc-ve-toolbar-action="media-manager"]` present with `aria-label="Media Manager"`. Slot untouched by R5.7. |
| 22 | Regression: `viewModelVersion=3` in list-endpoint response | ✅ | Direct REST fetch of `GET .../session/{id}/control-center/controls` returns HTTP 200 with `viewModelVersion: 3`. Top-level keys `[items, ok, providerErrors, query, viewModelVersion]`. `providerErrors: {}` (empty). Query echo `{category:'', family:'', q:'', status:''}`. Every one of 400 items carries the new `parentPublicId` key (`parentPublicIdOnEveryItem: true`). Zero items have a non-empty `parentPublicId` (expected — no tree data live). Item schema (12 keys): `[category, description, fieldFamily, group, label, meta, ownerSubtype, ownerType, parentPublicId, publicId, sortKey, status]`. |

## Cross-provider integration observed

- `SharedGlobalsControlProvider` (R3-B) — 1 record (`shared_globals:*`).
- `VerticalControlProvider` — 399 records (`vertical:*`). Sample field-family
  distribution: `text: 311, image: 37, other: 49, relationship: 2,
  post_object: 1`. Family distribution matches curated JSON's expected
  makeup post-R5.6 hardening.
- The `menu_posts` record surfaces via the R5.4 reference-collection
  path (`fieldFamily: 'relationship', status: 'available',
  meta.unlocksAt: 'R5.4'`). Meta bag carries camelCase `unlocksAt`
  correctly — R5.7-b's case-preserving `sanitizeMetaKey` is confirmed
  live (pre-R5.7-b this would have been silently lowercased to
  `unlocksat`; a latent bug that R5.7-b unblocked).
- The R5.7-a expansion path is dormant on this curated set because no
  ACF Repeater ancestors exist for any curated record. Zero
  `meta.role='repeater_parent'` or `'repeater_leaf'` in the response.
  This is the correct outcome — the R5.6 ancestry gate + R5.7-a
  repeater detection collaborated exactly as designed.
- Panel contract byte-identical for the flat R5.4 record: Open button
  present on the DOM row.

## Live-site coverage math correction

The R5.7-a evidence log said the `menus > menu_posts` record was
"likely" a repeater based on a-priori assumption. Live-site
verification confirms it is actually a **group** (per its ACF
configuration on this site). The corrected picture:

- **Pre-R5.7**: record was `status='unsupported'` under R5.6's
  ancestry gate (correct, no factory branch existed).
- **Post-R5.6 hardening**: record correctly stayed `unsupported`
  pending an unlock path.
- **Post-R5.4 nested-reference slice** (which the R5.6 hardening
  gates alongside): record ALREADY became `status='available'` because
  the group-only chain passes the gate + R5.4's `writeGroupedFieldValue`
  handles the save. **R5.7-a's expansion path was never needed for
  this specific record.**
- **Post-R5.7-a**: no live-site behavior change for this record
  (expansion path not triggered) — R5.7-a still landed the
  infrastructure (signature-guard resolver, descriptor factory,
  Vertical provider expansion helpers) for any FUTURE curation that
  adds a genuinely repeater-nested field.
- **Post-R5.7-b**: no live-site visual change (no tree parents to
  render) — R5.7-b still landed the drawer tree UI + ARIA + keyboard
  nav infrastructure for the same future case.
- **Live-site coverage**: 397-398 of 400 available (per R5.6
  snapshot; unchanged by R5.7-a/b since no repeater records to unlock).
  R5.7 shipped correctly-untriggered defensive infrastructure.

## What is NOT covered

- **Content-mutation items 10 + 11** — pending operator go-ahead.
  Also inherently N/A on the current curated set (no repeater
  subfield descriptors exist to write against). If future curation
  adds one, re-run this checklist to close 10 + 11 against real
  repeater rows.
- **Real assistive technology** (VoiceOver / JAWS / NVDA)
  sit-with-a-screen-reader QA — **not a required gate per D-058**
  (desktop-only, no real AT).
- **Real Safari** — Claude in Chrome only drives Chrome; WebKit-in-
  Chromium is not Safari. Residual, matches Media Manager D-049 shape.
- **Mobile / tablet / touch** — permanently out of scope per D-058.
- **PNG screenshot capture** — QA report is text-only per the
  maintainer's explicit ask, in line with the R3 QA report shape.
- **R5.7-C-2 (drag reorder)** — deferred slice; drag handles do not
  render in R5.7-b so nothing to QA there.

## Follow-ups surfaced (non-blocking)

1. **Curation-JSON documentation clarification** — the R5.7 planning
   docs (and E-115) assumed `menus` was a repeater and framed R5.7-a
   as "unlocks the `menus > menu_posts` record". Live verification
   shows `menus` is a group; R5.6 + R5.4 already unlocked the record
   via the group path. R5.7 remains valid as defensive
   infrastructure for future repeater-nested curation but its
   live-site unlock claim needs to be re-scoped in a follow-up doc
   update from "1 record unlocks" to "0 records unlock today, 0-N
   records unlock automatically for future repeater-nested curation
   additions".
2. **Latent bug closed as bonus** — R5.7-b's case-preserving
   `sanitizeMetaKey` fix means `meta.unlocksAt` now round-trips
   correctly through the safe projection (verified live: response
   contains `meta.unlocksAt: 'R5.4'`, not the pre-R5.7-b silent
   `'unlocksat'`). Any downstream consumer that was working around
   this by reading the lowercased form now needs the camelCase form.

## Verdict

**7 of 22 checklist items pass live, 15 are architecturally
unreachable on the current curated set** (no repeater records exist
to exercise the R5.7-b tree UI paths OR the R5.7-a write-path with
its signature guard — the correct absence). Items 10 + 11 (content
mutation) received operator authorization and were investigated
further; the `menu_posts` record's descriptor mints via the R5.4
group-write path (`source.type='acf_collection_field'` +
`is_grouped_field=true` + `group_write_path` populated + resolver
`acf_reference_collection`), so its save doesn't reach R5.7-a's
`writeRepeaterSubfieldValue` or `verifyExpectedRowSignature`
codepaths — running a mutation on this record would test the wrong
pipeline. Every regression check passes (items 17, 18, 19, 20, 21,
22). The R5.7 tree + signature-guard infrastructure is present,
non-crashing, and correctly-dormant. The R5.7-c residual gate is
**CLOSED in the "verified defensive infrastructure" sense**; full
tree-UI + signature-guard activation QA becomes executable at the
future point that any curation adds a genuinely repeater-nested
field.

## Followup slice

- R6 (Frontend Site Manager Workspace) unblocked from R5.7 residual.
- R5.5 (date_picker, 1 record) + R5.later (`vf_palette`, Vertical-side
  design decision) remain as small independent micro-slices.
- R5.7-C-2 (drag reorder) + R5.7-C-3 (roll-up summaries) + R5.7-C-4
  (expand-all controls) deferred polish slices; not blocked by the QA
  outcome above.
