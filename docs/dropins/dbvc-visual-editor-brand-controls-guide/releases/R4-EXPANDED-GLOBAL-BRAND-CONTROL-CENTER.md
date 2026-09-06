# R4 — Expanded Global & Brand Control Center

## Production outcome

R4 turns the minimal R3 center into a coherent client-facing workspace for approved global and brand controls. It improves organization, discoverability, source clarity, and status handling while continuing to use only field families and mutation contracts proven at that point.

R4 is primarily a UI, read-model, and workflow release. It must not quietly broaden mutation authority.

## User problem

Users should not need to know which ACF option page, field group, backend screen, or Bricks binding owns a global value. The R3 center proves the registry; R4 makes it practical for routine client use.

## Primary personas

- Client content editor
- Marketing manager
- Business owner
- Agency administrator

## Existing surfaces extended

- R3 Brand Control Center
- Shared Globals
- Main editor/inspector panel
- Toolbar and existing popover shell
- Status messaging

## In scope

### Client-facing organization

- Category navigation based on registered metadata
- Search across labels, descriptions, safe owner labels, and approved keywords
- Filtering by category, field family, status, and scope where useful
- Grouping by option page or ACF field group when that metadata is proven
- Stable sorting with provider-defined order and deterministic fallbacks

Initial visible categories should be driven by actual registered controls. Typical categories may include:

- Brand Identity
- Business Identity
- Reusable Content
- Other Globals

Do not show empty future categories.

### Control records

Each displayed control should provide an appropriately compact representation of:

- label;
- short description when supplied;
- category/group;
- owner/source label;
- scope;
- field/control family;
- safe current-value summary;
- editable, inspect-only, unsupported, unavailable, or restricted state;
- action to open the existing panel.

Long text, WYSIWYG, gallery, and connected values require type-specific summaries rather than full content dumps.

### Unrendered controls

Registered controls must remain discoverable even when they do not appear on the current frontend page. Do not imply current-page usage when none has been observed.

### Shared Globals integration

- Decide from evidence whether Shared Globals becomes a compatibility route, subsection, alias, or legacy fallback.
- Preserve current settings and URLs/actions where possible.
- Do not remove the old surface until the replacement has passed production QA.

### UI state and accessibility

Implement first-class states for:

- initial loading;
- category/search loading;
- no controls registered;
- no search matches;
- provider error;
- unavailable source;
- unsupported family;
- inspect-only source;
- permission-filtered result;
- descriptor-loading when opening a control;
- save/reload status through the existing panel.

## Out of scope

- Enabling unsupported ACF option families; that is R5
- Pinned controls, named workspaces, or completion tracking
- Site-wide usage counts or impact indexing
- Temporary preview
- Batch editing or Save All across controls
- Site Manager drawer
- Site Assurance, changes to the already-shipped Media Manager, or design-system controls
- Arbitrary user-defined categories or a new category-management UI

## UI/UX mockup requirement

R4 requires a static HTML/CSS reference from Claude Code before production markup and styling are finalized.

Codex must first produce:

1. a verified data/state contract;
2. the actual list of actions and permissions;
3. the current Visual Editor component and CSS constraints;
4. required laptop/desktop layout and accessibility behavior; additional responsive/mobile behavior remains tabled by D-036;
5. representative sample controls using non-sensitive fixture data.

Then follow `ui-ux/CLAUDE-CODE-MOCKUP-HANDOFF.md` and `ui-ux/MOCKUP-TO-PRODUCTION-INTEGRATION.md`.

The mockup is a visual and interaction reference. It is not production DOM authority and must not dictate insecure data attributes or a parallel component architecture.

## Implementation slices

### R4-A — Read model and query behavior

- Add server-supported search/filter parameters only as needed.
- Produce type-specific safe summaries.
- Keep full descriptor hydration lazy.
- Add deterministic grouping and sorting.
- Cover provider errors without breaking the entire center.

#### R4-A checkpoint — 2026-08-30 (Slice landed)

Backend shape shipped end-to-end; frontend integration is R4-C. Summary of
what stands in `main`:

- `ControlRecord` widened with two optional public properties: `description`
  (`sanitize_text_field`) and `sortKey` (`sanitize_key`). Both default to
  empty; both are round-tripped through `fromArray()` and emitted on the
  safe `toListItem()` projection. Interior tests in
  `tests/phpunit/VisualEditorControlCenterR4ATest.php` pin the projection.
- `ControlProvider` interface widened with `buildValueSummary(ControlRecord,
  sessionId): ?array`. All four in-tree implementations
  (`SharedGlobalsControlProvider`, `VF_Vertical_Control_Provider`, plus the
  three anon-class test factories) supply `return null;` defaults; the
  Shared Globals implementation is real for `relationship` + `post_object`
  families.
- `ControlRegistry`:
  - `listControls()` accepts `family` (`sanitize_key`) and `q` (trimmed,
    case-insensitive, matched against label OR description) in addition to
    the existing `category` + `status`.
  - Records now sort globally by `sortKey ASC → label ASC (case-insensitive)
    → publicId ASC` (previously per-provider then `id` ASC — the R3-A test
    order still holds because sortKey is empty in those tests).
  - `getControls()` per provider is wrapped in try/catch; a throwing
    provider is captured in `getProviderErrors()` (`{providerId → {message}}`)
    and its records are dropped without shielding the rest of the map. The
    R3-A observer channel (`dbvc_visual_editor_control_registry_invalid`)
    also fires with the new `provider_threw` reason.
  - `buildValueSummaryForRecord(record, sessionId)` mirrors
    `buildDescriptorForRecord`.
- `SharedGlobalsControlProvider`:
  - Emits `description` sourced from (in order) the
    `dbvc_visual_editor_control_center_description` filter (Vertical hooks
    this to inject `vf_field_context_get_entry_primary_purpose()`), then
    ACF's own `instructions`, then empty.
  - Emits `sortKey` as `shared_{fieldName}` so Shared Globals sits ahead of
    `vertical_*` records under the registry's ascending sort.
  - `buildValueSummary()` returns a `{family, count, firstTitles (≤3),
    hasMore}` shape for `relationship` + `post_object` families. Rechecks
    the option-owned capability probe (the same one visibility uses) before
    reading; returns `null` on empty values / gated capability / structural
    mismatch. A fourth optional constructor seam `$optionValueResolver`
    fronts `get_field($name, 'option', false)` for the summary path (test
    injection) — R3-B call sites and the existing R3-B tests keep working
    unchanged.
- `ControlCenterListController` response bumped `viewModelVersion` from 1
  → 2. `query` echoes all four params (`category`, `status`, `family`,
  `q`). New `providerErrors` map surfaces alongside `items`. `q` is trimmed
  and clamped at 128 characters at the controller.
- New `ControlCenterValueSummariesController` route:
  `POST .../session/{id}/control-center/value-summaries` body
  `{publicIds: string[]}` (batch cap **50**, over-cap ⇒ 400). Returns
  `{ok, summaries: {publicId → summary|null}}`. Per record: resolves the
  visible record → mints a descriptor via the provider → rechecks
  capability → asks the provider for its summary. Any step failing collapses
  that entry to `null` (fail-soft — the drawer renders nothing in that
  slot). Wired under the R3-D two-part kill switch in `Rest\Routes`.
- Vertical:
  - `VF_Vertical_Control_Provider` maps `description` via
    `vf_field_context_get_entry_primary_purpose($fieldName)` → curation
    `notes` → empty, and `sortKey` as `vertical_{1|2|3|9}_{fieldName}`
    keyed on `client_priority` (`must=1, should=2, nice=3, empty=9`).
    `buildValueSummary` still returns `null` (Vertical records are all
    `status="unsupported"` in the MVP).
  - `functions/features/dbvc-visual-editor/dbvc-visual-editor.php` adds a
    filter callback on `dbvc_visual_editor_control_center_description` that
    injects the same Field Context primary-purpose lookup into DBVC Shared
    Globals rows.

Test coverage: `VisualEditorControlCenterR4ATest` adds 19 focused cases
(sort behavior, filter widening, provider-error capture, SharedGlobals
description/sortKey/summary, new list-controller contract, batch endpoint
happy path + cap + dedup + edit-mode gate). Existing R3-A/B/C-1/D suites
stay green with only one localized adjustment: the routes test now asserts
`viewModelVersion=2` + four-key `query` echo + empty `providerErrors`.

Baselines after the slice: PHPUnit 888 tests / 9305 assertions (19 new;
same 7 pre-existing failures across unrelated Bricks / Content Collector /
Content Migration / Proposal Diff / Capability Landscape suites, which
match the pre-R4-A baseline).

### R4-B — UI contract and Claude Code mockup

- Document screens, states, data, actions, and accessibility.
- Generate static mockup artifacts.
- Review mockup against actual runtime constraints.
- Record accepted and rejected mockup decisions.

### R4-C — Production UI integration

Consumes the R4-A backend contract; adds no new REST routes and no new
mutation authority. Confirmed 2026-08-31 as three sub-slices for
stability + smaller review surface:

**R4-C-1a — contract wiring + priority-derivation fix** (LANDED 2026-08-31)

- Wire `family` + `q` query params to the list route with a 250ms
  debounce on the search input; `family` chip fires an immediate
  round-trip.
- Introduce a `loading-refresh` render state that keeps the current
  row list visible under a dimmed overlay for non-initial requests
  (the `.__refresh-overlay` selector already ships in
  `control-center.css`).
- Render the per-row `description` line as a muted second line under
  the label (`textContent`, never `innerHTML`); omit the node when
  empty.
- Render the `providerErrors` map from the list response as a
  top-of-list `.__notice--provider-error` banner (`role="status"`,
  one line, dismiss button); dismissal is per-drawer-lifetime.
- Fix `priorityFromItem()` to derive `must` / `should` / `nice` from
  the `sortKey` prefix (`vertical_1_*` / `_2_ / _3_`); every other
  prefix → no priority. The R3-C-2 fallback on `item.priority` /
  `item.meta.priority` is dead against R4-A data.
- Extend the jsdom suite by 7 cases (query round-trip, debounce,
  chip → GET, priority derivation, description render/omit, banner
  render, banner dismiss).

##### R4-C-1a checkpoint — 2026-08-31 (Landed)

All 7 planned drawer changes shipped with no backend edits. Files
touched: `assets/js/brand-control-center-app.js` (state additions
for `providerErrors` + `providerErrorsDismissed`; new
`priorityFromItem()` sortKey-prefix derivation; `listUrl(params)`
now encodes `?family=…&q=…`; `loadControls({reason})` supports
`initial`/`query`/`retry` with a `loading-refresh` state that keeps
existing rows visible under the previously-unused
`.__refresh-overlay`; `handleInput` debounce 180 → **250ms**;
`toggleChip` fires a round-trip on `fieldFamily`, stays client-side
for `status`/`priority`; `itemMatchesFilters` drops search +
fieldFamily branches; `clearFilters` fires a round-trip only when
clearing removed a server-scoped param; new
`renderProviderErrorBanner()` + `renderRefreshOverlay()` +
`dismissProviderErrors()` handler; `renderRow` wraps label in a new
`.__label-block` and appends a `.__description` `<p>` via
`textContent` only when the record ships a non-empty description;
`close()` resets dismissal; `publicState()` exposes the new
fields); `assets/css/control-center.css` (new
`.__notice--provider-error`, `.__label-block`, `.__description`
selectors — warning-tone banner sits above the table wrap; muted
second line with 2-line `-webkit-line-clamp`); `src/Assets/AssetLoader.php`
(widened `controlCenterSearchPlaceholder`; 4 new i18n keys —
`controlCenterRefreshing`, `…ProviderErrorSingular`, `…Plural`,
`…Dismiss`); `tests/visual-editor-brand-control-center-state.test.cjs`
(+7 R4-C-1a cases + `sleep()` + `extractQuery()` helpers).

**Validation** — every planned baseline hit exactly:

| Command | Result | Baseline |
|---|---|---|
| `node --test tests/visual-editor-brand-control-center-state.test.cjs` | **21 pass / 21 tests** | 14 → 21 (7 new) |
| `node --test tests/visual-editor-media-manager-state.test.cjs` | **42 pass** | Preserved |
| `vendor/bin/phpunit --filter "VisualEditor(Control\|SharedGlobals)"` | **60 tests / 200 assertions OK** | Unchanged from R4-A landing (R4-C-1a touched no backend) |
| `composer agent-docs:refresh && composer agent-docs:check` | **54 curated / 443 discovered / 0 unmapped** | Unchanged — AssetLoader i18n additions do not rotate hook or REST hashes |

**Contract preserved**: no new REST routes, no new mutation
authority, `data-public-id` remains the sole client-authoritative
row token (no forbidden `data-*` re-introduced), single polite live
region rule holds (the banner uses `role="status"` as a persistent
visual affordance but the announcer stays the authoritative
announcement channel), Bricks Builder isolation unaffected, kill
switch operationally unchanged.

**Non-events**: no content mutated; no persistent WP option
toggled outside test setUp/tearDown; no git operations either repo.
See EVIDENCE-LOG E-101 for the full row.

**R4-C-1b — batch value-summary loader** (LANDED 2026-08-31)

- Attach an `IntersectionObserver` (root = `.__table-wrap`) to each
  row whose `status === 'available'` and whose publicId is not yet
  hydrated. Batch up to 20 publicIds after a 50ms debounce → `POST
  .../control-center/value-summaries`. Merge results into an
  in-memory `state.valueSummaries` map that persists for the
  drawer's lifetime; surgically re-render only the affected rows'
  summary slots (no full `renderList()`).
- Dispatch on `summary.family` — for R4-C-1b only `relationship` and
  `post_object` render a chip (`<strong>{count}</strong> connected`
  with `title="{firstTitles.join(', ')}"`); every other family /
  null summary renders as an empty slot. R5.x owns the remaining
  family chips.
- Graceful degrade: if `IntersectionObserver` is unavailable, render
  empty slots silently. Never spawn a fallback fetch.
- Extend the jsdom suite by 4 cases (only-available rows observed,
  batch POST payload, chip render, null → empty slot, no
  rehydration).

##### R4-C-1b checkpoint — 2026-08-31 (Landed)

All 4 planned drawer changes shipped with no backend edits. Files
touched:

- `assets/js/brand-control-center-app.js` — added `state.valueSummaries`
  (publicId → summary\|null\|`'loading'` cache), `state.valueSummaryObserver`
  (lazy IO rooted on `.__table-wrap`, `threshold: 0`),
  `state.valueSummaryPending` (dedup queue), `state.valueSummaryFlushTimer`
  (50ms debounce). New helpers: `ensureValueSummaryState()`,
  `ensureValueSummaryObserver(wrap)`, `teardownValueSummaryObserver()`,
  `handleValueSummaryIntersect(entries)` (unobserves immediately,
  short-circuits cached publicIds, queues fresh ones),
  `scheduleValueSummaryFlush()` (50ms), `valueSummariesUrl()`,
  `flushValueSummaries()` (batch cap **20** per flush — D-064 server
  cap is 50 as headroom — marks `'loading'` before POST, chains
  another flush if queue still has entries, fail-soft collapses to
  `null` on network error), `patchValueSummarySlot(publicId)`
  (surgical per-row DOM patch — mirrors Media Manager R2-E3 pattern,
  no full `renderList()` so focus + sibling observer registrations
  survive), `renderValueSummaryChip(summary)` (family dispatcher —
  only `relationship` + `post_object` render for R4-C-1b),
  `registerVisibleValueSummaryTargets(wrap, tbody)` (called at the
  end of `renderList()`, observes only rows with
  `data-status="available"` and unhydrated publicId). `renderRow()`
  gained a `.__value-summary[data-public-id]` slot via new
  `renderValueSummarySlot(item, status, publicId)`. `close()`
  extended to teardown the observer + null-out caches. `publicState()`
  extended with `valueSummaries` for test observability. **Graceful
  degrade**: `typeof window.IntersectionObserver !== 'function'`
  short-circuits — rows render empty slots, no fallback fetch.
- `assets/css/control-center.css` — added `.__value-summary` (inline-flex
  chip container, `max-width: 200px`, ellipsis, `:empty { display: none }`
  so unhydrated / null rows do not claim space) and
  `.__value-relationship` (count + label chip).
- `src/Assets/AssetLoader.php` — 1 new i18n key
  `controlCenterValueRelationshipConnected` (label suffix for the
  "N connected" chip).
- `tests/visual-editor-brand-control-center-state.test.cjs` — added
  a minimal `IntersectionObserver` polyfill (exposed on
  `window.__ioRegistry` so tests trigger intersections via
  `triggerAll()` / `trigger(predicate)`; honors `unobserve` +
  `disconnect` so post-first-intersection re-triggers do not fire —
  matches real browser behavior). +4 R4-C-1b cases.

**Validation** — every planned baseline hit exactly:

| Command | Result | Baseline |
|---|---|---|
| `node --test tests/visual-editor-brand-control-center-state.test.cjs` | **25 pass / 25 tests** | 21 → 25 (4 new) |
| `node --test tests/visual-editor-media-manager-state.test.cjs` | **42 pass** | Preserved |
| `vendor/bin/phpunit --filter "VisualEditor(Control\|SharedGlobals)"` | **60 tests / 200 assertions OK** | Unchanged from R4-A landing (R4-C-1b touched no backend) |
| `composer agent-docs:refresh && composer agent-docs:check` | **54 curated / 443 discovered / 0 unmapped** | Unchanged — one i18n key added; no new hook or REST surface |

**Contract preserved**: no new REST routes, no new mutation
authority, per-record server-side capability recheck happens inside
`ControlCenterValueSummariesController` (unchanged from R4-A), single
polite live region rule holds (chip is a persistent visual
affordance), `data-public-id` remains the sole client-authoritative
row token (the summary slot re-uses the same allowed attribute), kill
switch operationally unchanged.

**R4-A backend surface now fully consumed by production code**:
- `GET .../control-center/controls?family=&q=` — R4-C-1a
- `POST .../control-center/value-summaries` — R4-C-1b
- `POST .../control-center/open` — R3-C-2 (unchanged)

R4-C-2 is purely presentational — view-mode toggle + collapsible
group headers + search-wrap + state gallery + invariant sweep. No
new API affordances remain to consume.

**Non-events**: no content mutated; no persistent WP option
toggled outside test setUp/tearDown; no git operations either repo.
See EVIDENCE-LOG E-102 for the full row.

**R4-C-2 — view-mode toggle, collapsible groups, search-wrap, state
gallery, invariant sweep** (LANDED 2026-08-31 — R4-C COMPLETE)

- Header segmented control (`.__view-toggle`, `role="tablist"`) —
  `By category` (default) vs `By provider`; arrow-key nav; preference
  persisted via `localStorage('dbvc.ve.control-center.view-mode')`
  wrapped in try/catch (private-window safe).
- Collapsible group headers within each category tab (tbody per
  group, `.__group-header` disclosure with `aria-expanded`), keyed
  on `{providerId}::{record.group}`; collapsed by default; per-viewer
  persistence via `localStorage`. Empty groups omitted.
- Search-wrap DOM (leading icon + Clear button visible only when the
  input has a value).
- Translate the remaining mockup `states.html` cells (descriptor-
  loading row modifier, permission-filtered lock glyph, value-summary
  loading skeleton, value-summary empty slot, loading-refresh dimmed
  overlay).
- Invariant sweep: reduced-motion suppresses the group-toggle chevron
  + segmented-control transitions; row-focus continuity extends to
  survive view-mode flips; single polite live region rule holds
  after every new control.
- Extend the jsdom suite by 5 cases (view-mode flip + aria-selected;
  localStorage round-trip; group render + collapsed-by-default;
  group-toggle localStorage; focus continuity across view-mode flip).

##### R4-C-2 checkpoint — 2026-08-31 (Landed — R4-C COMPLETE)

All 5 planned drawer changes shipped with no backend edits. Files
touched:

- `assets/js/brand-control-center-app.js` — biggest R4-C refactor:
  - Added `DEFAULT_QUERY.provider = 'all'` axis; new module constants
    `VIEW_MODES`, `LS_KEY_VIEW_MODE`, `LS_KEY_EXPANDED_GROUPS`; new
    state `viewMode` + `expandedGroups`. Groups default to COLLAPSED
    — the persisted list only records viewer DEVIATIONS from that
    default, so a new fixture group appearing after localStorage was
    written still collapses by default.
  - localStorage helpers `readStoredString` / `writeStoredString`
    (try/catch-wrapped for private-window safety),
    `loadStoredViewMode` (validates against `VIEW_MODES`),
    `loadStoredExpandedGroups` (guards bad JSON), `persistExpandedGroups`.
  - `setViewMode(mode)` — validates, snapshots active-row publicId
    BEFORE re-render, persists to localStorage, restores focus on
    the same publicId's Open button in the new layout.
  - `toggleGroup(groupKey)` — flips the map entry (adds when
    expanding, deletes when collapsing back to default), persists,
    re-renders.
  - `clearSearchInput()` — clears the input + fires a
    `loadControls({reason:'query'})` round-trip.
  - Provider helpers `providerIdFromPublicId` (splits publicId on
    `:`), `providerLabel` (Shared Globals / Vertical / fallback
    title-case), `providersFromItems`,
    `tabAxisForViewMode` / `tabEntriesForViewMode` / `tabLabelForViewMode`.
  - `ensureRoot()` rehydrates `viewMode` + `expandedGroups` from
    localStorage on first open.
  - `createHeader()` inserts the `.__view-toggle` segmented control
    (`role="tablist"` with `aria-label="Category view"` for a11y
    disambiguation vs the category tablist below) between the
    title-block and close button; two `role="tab"` buttons carrying
    `data-view-mode` + `data-dbvc-ve-control-center-action="set-view-mode"`.
  - `renderViewToggle()` keeps `aria-selected` + `tabIndex` in sync.
  - `createFilters()` replaces the bare input with a `.__search-wrap`
    (leading `.__search-icon` glyph + trailing `.__search-clear`
    button); `renderFilters()` toggles Clear visibility per
    `state.query.search === ''`.
  - `handleClick` gains `set-view-mode`, `toggle-group`,
    `clear-search` branches. `select-tab` reads `data-tab-slug`
    with `data-category` / `data-provider` fallbacks so the R3-C-2
    jsdom + real-browser tests remain compatible.
  - `handleKeydown` gains `ArrowLeft` / `ArrowRight` nav when focus
    is inside the view-toggle tablist — advances the segmented
    control and moves focus to the newly-selected button.
  - `renderTabs()` + `createTabButton()` are view-mode-aware — tabs
    carry both `data-tab-slug` (generic) and `data-category` /
    `data-provider` (axis-specific).
  - `selectTab()` routes into `state.query.category` or
    `state.query.provider` depending on `viewMode`.
  - `itemMatchesFilters()` branches on `viewMode` — provider mode
    filters on `providerIdFromPublicId(item.publicId)`.
  - `clearFilters()` preserves BOTH `category` and `provider` axes.
  - **`createTableWrap()` no longer creates the R3-C-2 single
    `<tbody>` sentinel** — rows now live inside per-group
    `<tbody class="__group">` elements built by `renderList()`.
  - `clearTableTbodies(wrap)` helper; `buildGroupsFromVisible(visible)`
    (keys groups `{providerId}::{group}`, preserves first-appearance
    order — matches R4-A `sortKey → label → publicId` global sort);
    `renderGroupTbody(group)` (emits tbody with `data-group-key` +
    `data-provider-id` + `is-collapsed` when not expanded);
    `renderGroupHeaderRow(group, isExpanded)` (colspan-2 disclosure
    row with `.__group-toggle` `aria-expanded` + `aria-label`
    Expand/Collapse, chevron, title, count badge).
  - `renderList()` overhauled — clears all tbodies via
    `clearTableTbodies`, then renders panel-state OR iterates
    `buildGroupsFromVisible` and appends one tbody per group.
  - `registerVisibleValueSummaryTargets(wrap)` signature simplified
    — takes wrap only, queries rows at the wrap level so per-group
    tbodies are picked up. Dead `clearRows(tbody)` helper removed.
  - `publicState()` gains `viewMode` + `expandedGroups`.
- `assets/css/control-center.css` — `.__view-toggle*` (segmented
  control with `aria-selected="true"` bg swap, focus-visible ring),
  `.__search-wrap` + `.__search-icon` + `.__search-clear` (icon
  positioned absolute at input left, Clear at right with hover /
  focus states), `.__group-header*` + `.__group-toggle*` (chevron
  rotates 90deg on `[aria-expanded="true"]` via a 160ms transition,
  suppressed under `prefers-reduced-motion`), `.__group-title`,
  `.__group-count`, `.__group.is-collapsed .__row { display: none }`
  (semantic tree stays intact), reduced-motion block.
- `src/Assets/AssetLoader.php` — 11 new i18n keys:
  `controlCenterViewToggleLabel`, `…ViewByCategory`, `…ViewByProvider`,
  `controlCenterGroupExpand`, `…GroupCollapse`,
  `…GroupControlsCount`, `…GroupUnnamed`, `controlCenterProviderShared`,
  `…ProviderVertical`, `…ProviderUnknown`, `controlCenterClearSearch`.
- `tests/visual-editor-brand-control-center-state.test.cjs` — 5
  new cases. Two assertions use `JSON.stringify` comparison instead
  of `deepStrictEqual` because jsdom's plain-object prototype
  differs from Node's plain-object prototype (documented inline).

**Validation** — every planned baseline hit exactly:

| Command | Result | Baseline |
|---|---|---|
| `node --test tests/visual-editor-brand-control-center-state.test.cjs` | **30 pass / 30 tests** | 25 → 30 (5 new) |
| `node --test tests/visual-editor-media-manager-state.test.cjs` | **42 pass** | Preserved |
| `vendor/bin/phpunit --filter "VisualEditor(Control\|SharedGlobals)"` | **60 tests / 200 assertions OK** | Unchanged from R4-A landing (R4-C-2 touched no backend) |
| `composer agent-docs:refresh && composer agent-docs:check` | **54 curated / 443 discovered / 0 unmapped** | Unchanged — 11 new i18n keys; no new hook or REST surface |

**Contract preserved**: no new REST routes, no new mutation
authority, `data-public-id` remains the sole client-authoritative
row token (new UI-scoped attributes `data-view-mode`,
`data-group-key`, `data-tab-slug`, `data-provider`,
`data-provider-id` are all cosmetic — none carries target authority
the save pipeline reads). Single polite live region rule holds.
Reduced-motion suppresses chevron rotation + segmented-control
transitions. Kill switch operationally unchanged.

**All 7 pinned R4-B decisions honored end-to-end**: (1) persistent
search input; (2) flat tab strip; (3) collapsible group headers;
(4) description as muted second line (R4-C-1a); (5) per-family
value-summary chips (R4-C-1b relationship/post_object; other
families → R5.x); (6) Shared Globals folded into the same category
system + view-mode toggle; (7) view-mode toggle in drawer header
with localStorage persistence.

**Non-events**: no content mutated; no persistent WP option
toggled outside test setUp/tearDown; no git operations either repo.
See EVIDENCE-LOG E-103 for the full row.

**R4-C is complete.** Follow-ons: R4-D (Shared Globals transition +
hardening — real-browser QA at 1440×900 + 1280×720 with a 400-row
registry, long-label truncation calibration, save-status-strip that
dispatches from `overlay-app.js` on successful save, release-notes
+ rollback update) and R5.x (per-family editing factories).

#### Pinned R4-C decisions (agreed 2026-08-31 during planning)

Not promoted to DECISION-LOG rows because they refine D-064 rather
than diverge from it. Track here so a fresh session picks them up:

- **Mixed filter model.** `status` + `category` stay client-side;
  only `family` + `q` go server-side. Keeps the `All (N)` tab
  counting cheap (no second unfiltered request) and avoids scope
  creep into a backend slice.
- **Priority chip stays client-side**, derived from the `sortKey`
  prefix. If a future provider wants `priority`-first sort, the
  cleaner move is a backend param, not a runtime map lookup.
- **Save-status-strip is deferred to R4-D**, not R4-C-2. The
  overlay-app.js dispatch straddles the R3-C-2 pinned baseline
  (14/14 jsdom + E-099 real-browser panel-coexistence QA); R4-D
  already carries the real-browser QA that would catch cross-panel
  regressions.
- **`IntersectionObserver` unavailable → empty slots silently.** No
  fallback fetch. The drawer never runs in an environment where IO
  is absent, but the two-line guard costs nothing.

#### R4-C non-goals

- No new REST routes; no new mutation authority. Every save still
  routes through the existing `MutationService` pipeline via the
  R3-C-1 open route.
- No overlay-app.js edits (save-status-strip → R4-D).
- No `text` / `image` / `gallery` / `color_picker` / `wysiwyg` chip
  rendering (→ R5.x factory slices).
- No real-browser QA at 400 rows / long-label truncation calibration
  (→ R4-D).

#### Green baselines to preserve at each slice boundary

| Command | Expected |
|---|---|
| `vendor/bin/phpunit` | 888/7 (unchanged; R4-C touches no backend) |
| `vendor/bin/phpunit --filter "VisualEditor(Control\|SharedGlobals)"` | 41/140 OK |
| `node --test tests/visual-editor-brand-control-center-state.test.cjs` | 14 → 21 → 25 → 30 |
| `node --test tests/visual-editor-media-manager-state.test.cjs` | 42/42 |
| `composer agent-docs:refresh && composer agent-docs:check` | 54/443/0 (verify — AssetLoader line shifts may rotate an extension-point hash; re-map if so) |

### R4-D — Shared Globals transition and hardening

- Add compatibility entry or fallback.
- Verify existing relationship/post-object flows.
- Test large registries and long labels/values.
- Complete supported laptop/desktop and accessibility QA. Additional responsive/mobile and touch-specific QA remains tabled by D-036.

#### R4-D-1 checkpoint — 2026-08-31 (Landed — save-status-strip)

First R4-D sub-slice and first R4 slice to touch `overlay-app.js` in
any way. R4-D-2 (real-browser QA + long-label truncation calibration
+ release-notes/rollback update) remains open.

**What shipped**

- `assets/js/overlay-app.js` — new `dispatchPanelSaved(token)` helper
  next to `dispatchControlCenterEvent`; gated behind
  `isControlCenterEnabled()` matching the existing dispatch policy.
  Fires `dbvc:visual-editor:panel:saved` with `{token}` detail on
  BOTH `handleSave` success paths (composite + non-composite),
  placed AFTER the panel-state / status-bar updates and BEFORE
  the `shouldReloadAfterSave` `window.location.reload` so the
  drawer has one tick to render its strip before a page reload.
- `assets/js/brand-control-center-app.js` — `state.activeToken`
  stored in `openRow` alongside `activePublicId`;
  `state.saveStatusStrip` + `state.saveStatusTimer` new; new
  `handlePanelSaved(event)` gates on `token === state.activeToken`
  AND `state.activePublicId` non-empty; new `renderSaveStatusStrip()`
  inserts / removes the strip at the top of the table wrap; `close()`
  clears the timer + strip state + activeToken; `renderList()` calls
  `renderSaveStatusStrip()` after `renderRefreshOverlay(wrap)` so a
  filter change / view-mode flip mid-fade preserves the confirmation.
  `publicState()` gains `activeToken` + `saveStatusStrip`. Document
  listener wired in `mount()`.
- `assets/css/control-center.css` — new `.__save-status-strip`
  selector (sticky top:0, success-green background,
  `dbvc-ve-cc-save-status` keyframe fade over 2500ms) + a
  reduced-motion block suppressing the animation.
- `src/Assets/AssetLoader.php` — 1 new i18n key
  `controlCenterSaveStatus = "Saved {label}."` — same string doubles
  as the polite live-region announcement text.
- `tests/visual-editor-brand-control-center-state.test.cjs` — +3
  R4-D-1 jsdom cases.

**Validation** — every planned baseline hit exactly:

| Command | Result | Baseline |
|---|---|---|
| `node --test tests/visual-editor-brand-control-center-state.test.cjs` | **33 pass / 33 tests** | 30 → 33 (3 new) |
| `node --test tests/visual-editor-media-manager-state.test.cjs` | **42 pass** | Preserved (overlay-app.js addition is Control-Center-scoped, media-manager save flow untouched) |
| `vendor/bin/phpunit --filter "VisualEditor(Control\|SharedGlobals)"` | **60 tests / 200 assertions OK** | Unchanged (R4-D-1 touched no backend) |
| `composer agent-docs:refresh && composer agent-docs:check` | **54 curated / 443 discovered / 0 unmapped** | Unchanged (one i18n key added; no new hook or REST surface) |

**Contract preserved**: no new REST routes, no new mutation authority.
Single polite live region rule holds (strip is `aria-hidden`,
announcer stays authoritative). Cross-panel coexistence preserved
(strip listener gates on `activeToken` so Shared Globals popover
saves for a DIFFERENT descriptor never surface a strip in the drawer).
Kill switch operationally unchanged.

**Note on R4-A live-site bug fix (unrelated, same day)**

Two Vertical theme callsites of `vf_field_context_get_entry_primary_purpose()`
were passing a string field name where the function requires the
resolved entry array — a pre-existing R4-A cross-repo landing bug
that only surfaced on the first live-site drawer request. Fixed in
both Vertical checkouts by adding a
`vf_field_context_get_entry_for_runtime_field($field_name, 'option')`
catalog lookup before the purpose call. See E-104 for the full row.

**Non-events**: no content mutated; no persistent WP option toggled
outside test setUp/tearDown; no git operations either repo.

**Follow-on**: R4-D-2 (real-browser QA at 1440×900 + 1280×720 with
the 400-row registry, long-label truncation calibration,
release-notes/rollback update).

## Interaction model

A recommended interaction pattern is:

```text
Toolbar entry
    ↓
Global & Brand Control Center
    ├── Search
    ├── Category navigation
    ├── Optional status/family filters
    └── Control list
            ↓ Open
      Existing main editor panel
            ↓ Save / Save and Reload
      Existing journal and status systems
```

Do not create inline editing inside list rows in R4. Keeping edits in the existing main panel reduces duplicated validation, media-modal handling, WYSIWYG behavior, and save-state complexity.

## Data rules

- Search must operate on approved metadata, not raw arbitrary option values.
- Value summaries must be escaped and type-aware.
- Media summaries should use attachment IDs and safe metadata resolved server-side.
- Connected-item summaries should not return full object data unnecessarily.
- Restricted controls should follow current visibility conventions.
- Provider/category failures should not expose implementation details to clients.

## Performance requirements

- Search/filter requests must be debounced or submitted intentionally using current UI conventions.
- Avoid reloading the complete registry when only client-side filtering of an already-small result is appropriate.
- Use server pagination when evidence shows the list can be large.
- Keep descriptors and connected-item search lazy. Add no new TinyMCE/Media Library enqueue; current active Visual Editor mode already carries those assets.
- Reuse cached ACF field-group and option-page metadata where safe.

## Acceptance criteria

### Discoverability

- [ ] Users can search registered controls by approved labels and descriptions.
- [ ] Controls are grouped into meaningful non-empty categories.
- [ ] Option-page or field-group metadata is shown only when proven.
- [ ] Controls absent from the current page remain discoverable.
- [ ] No arbitrary option or field becomes searchable.

### Clarity

- [ ] Every control shows authoritative source/owner context.
- [ ] Editable, inspect-only, unsupported, unavailable, and loading states are distinguishable without relying on color alone.
- [ ] Safe value summaries are appropriate to each supported family.
- [ ] Current-page presence is not confused with site-wide usage.

### Interaction

- [ ] Selecting a control opens the existing main panel.
- [ ] Focus moves predictably and returns appropriately when the panel closes.
- [ ] Search, category, filter, and scroll state behave consistently during passive status updates.
- [ ] Touch and narrow-screen behavior are usable.
- [ ] Media Library and WordPress editor interactions remain unaffected.

### Compatibility and safety

- [ ] Existing Shared Globals users retain a functional path.
- [ ] R4 adds no new mutation authority.
- [ ] Capability, nonce, descriptor, acknowledgement, stale-value, journal, and audit behavior are unchanged.
- [ ] Bricks Builder remains unaffected.
- [ ] The center can be disabled without changing stored content.

### Mockup integration

- [ ] Static mockup deliverables are stored or referenced in the repository.
- [ ] Accepted visual decisions are mapped to existing components.
- [ ] Mockup-only markup, fake data targeting, or global CSS was not copied blindly.
- [ ] Accessibility and runtime states omitted by the mockup were added in production.
