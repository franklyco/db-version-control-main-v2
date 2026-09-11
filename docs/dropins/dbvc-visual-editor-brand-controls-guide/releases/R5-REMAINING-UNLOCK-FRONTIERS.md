# R5 — Remaining unlock frontiers (planning doc)

**Drafted:** 2026-09-01.
**Status:** Planning only. No slice below is authorized to execute yet.
**Purpose:** Capture the four remaining known R5 unlock frontiers so any
future session can pick one up cold, with scope + risk + test surface
already laid out.

## Coverage snapshot at plan time

397–398 of 400 curated Vertical records editable (99.25–99.5%).
Uncertainty comes from the one nested reference record that flips based
on the ACF configuration of `menus` (group vs repeater). The three
remaining unsupported records are:

| # | field_type | field_name / owner | curation `unlocks_at` | Why unsupported today |
|--:|---|---|---|---|
| 1 | `date_picker` | `admin_site_verbiage>site_business_type` (owner: admin-settings) | `R5.1` | No `AcfDatePickerResolver` shipped in R5.1. Deferred with a note. |
| 2 | `vf_palette` | `settings_vf_term_colors` (owner: advanced-settings) | `never` | ~~Vertical-owned custom ACF field type; no DBVC resolver design.~~ **PATH B CLOSED 2026-09-03** — permanently out-of-scope for the drawer. Curator has a full per-term color-picker editor at Settings → Site Settings Advanced via the native `vf_palette` input (see §R5.later below). |
| 3 | `relationship` | `settings_nav_menus>menus>menu_posts` (owner: advanced-settings) | `R5.4` | Nested inside a repeater (probable); `writeGroupedFieldValue` doesn't cover repeater subfields. |

## The four proposed slices

Each slice below is a self-contained future R5 sub-slice, complete with
scope, primitives needed, non-goals, and green-baseline expectations.
Read the "recommended order" line at the bottom of each to see how they
interact.

---

### R5.5 — date_picker unlock (tiny)

**Status:** ✅ **Landed 2026-09-02.** New `AcfDatePickerResolver` +
wire-through pattern per plan. Panel side reuses existing
`createInputController('date', value)` — native `<input type="date">`,
zero new panel controller code. Group-nested + repeater-nested writes
inherit for free from R5.1-b + R5.7-a respectively. 25 new PHPUnit
tests + 2 in R51B (dedicated date_picker case + R5.6 matrix entry) + 1
jsdom chip case. `VisualEditor(*)` PHPUnit **404 / 2929 OK**. Drawer
jsdom **52 pass**. Both Vertical checkouts mirrored byte-identical.
See E-120 + tracker R5.5 row.

**Records unlocked:** 1 (`admin_site_verbiage>site_business_type`, currently the only
`date_picker` record; future curation additions inherit for free).

**Why this is a wire-through slice, not a design one.** Native
`<input type="date">` handles the panel side (same pattern
R5.2+color_picker used for `<input type="color">`). The only new
primitive is a resolver PHP class that validates ISO date strings and
routes save through `writeAcfValue`.

**Implementation steps (in order)**

1. **New resolver** `addons/visual-editor/src/Resolvers/AcfDatePickerResolver.php` —
   extends `AbstractAcfResolver`. `name()='acf_date_picker'`. `supports()`
   gates on `source.field_type === 'date_picker'`. `validate()` accepts
   empty / null / ISO 8601 dates (`YYYY-MM-DD`) — reject anything else
   with a clear message. `sanitize()` normalizes to `YYYY-MM-DD` (ACF's
   canonical storage). `save()` delegates to `writeAcfValue()` which
   inherits R5.1-b group-nested writes.
2. **Register** in `ResolverRegistry::__construct` `$instances` list
   next to `AcfTrueFalseResolver`.
3. **Widen** `SharedGlobalsControlProvider::supportedFieldTypes()` by
   `'date_picker'`.
4. **`SharedGlobalsControlProvider::mapFieldFamily()`** — no branch
   needed; date_picker collapses into ControlRecord's `'other'` bucket
   (whitelist has no date family).
5. **New static** `SharedGlobalsControlProvider::buildDateSummary($value)`
   returning `{family:'date', iso, label}` (label = the same ISO for
   MVP; a locale-formatted variant is out of scope for R5.5).
6. **`SharedGlobalsControlProvider::buildValueSummary`** — new
   `date_picker` dispatch branch delegating to `buildDateSummary`.
7. **Factory branch** in `SharedGlobalsDescriptorFactory::build()` —
   delegate to `buildSharedFieldDescriptor` with
   `{resolver:'acf_date_picker', input:'date',
   source_context:'toolbar_shared_global_option_date'}`.
   Group-nesting inherits from R5.1-b `walkGroupChain`.
8. **`overlay-app.js` panel wiring** — one-line `case 'date':` in
   `createFieldController` switch → delegates to
   `createInputController('date', value)` (native `<input type="date">`).
   Zero new panel controller code.
9. **Frontend chip renderer** — extend
   `brand-control-center-app.js`'s `renderValueSummaryChip` with a
   `family === 'date'` branch rendering the ISO in a monospace label
   (small calendar glyph optional).
10. **CSS** — `.__value-date` selector (compact one-line ellipsis
    following the pattern R5.1-a and beyond established).
11. **Vertical (both checkouts, byte-identical)** —
    `resolveStatus()`'s existing R5.1 branch widens: return `'available'`
    when `unlocks_at === 'R5.1'` AND `field_type ∈
    [text,textarea,url,email,number,date_picker]`. `buildDescriptor()`'s
    `$supported` list gains `'date_picker'`. `buildValueSummary()`
    gains a date_picker branch delegating to `buildDateSummary`.
12. **Tests** — new `VisualEditorControlCenterR55DatePickerTest.php`
    (resolver name + supports + `@dataProvider` matrix of valid + junk
    date strings + sanitize normalization + validate + provider
    whitelist + factory shape + summary shape); extend the Vertical
    provider test with a date_picker case (`@dataProvider` swap on the
    R5.1 dataProvider is cleanest); +1 jsdom chip case.

**Non-goals**

- Locale-formatted display labels (native input handles user-facing
  formatting; the chip stays ISO for scannability). If the maintainer
  wants localized labels, that's a small R5.5-b polish slice.
- Time-of-day (`date_time_picker` / `time_picker` field types). If
  those show up in future curation, each needs its own resolver +
  factory branch, following the exact same pattern.

**Recommended order:** land this FIRST or LAST — it's independent of
the other three slices and takes coverage from 99.25% → 99.5% (or
99.5% → 99.75% depending on nested-reference outcome).

---

### R5.6 — R5.1-b text-family hardening (defensive)

**Status:** ✅ **Landed 2026-09-01** — the shared ancestry gate is now applied uniformly across every unlocked family (R5.1 text, R5.2 choice/link/wysiwyg/true_false, R5.2+color_picker, R5.3 image, R5.4 relationship/post_object). Helper renamed `hasGroupOnlyAncestry` → `parentChainIsGroupOnly` to reflect family-agnostic role. Zero live-site record status changes. See E-113 + tracker R5.6 row.

**Records unlocked:** 0 today (defensive). Prevents a latent
wrong-meta-key bug if any future curated text-family record gets nested
inside a repeater or flexible_content field.

**Why this exists.** During the nested-reference slice (E-112) we
noticed R5.1-b's `buildSharedFieldDescriptor` (text-family path) shares
the same `SharedGlobalsDescriptorFactory::walkGroupChain` helper the
nested-reference slice just extended — but WITHOUT the type-check on
intermediates. A repeater-nested text field would emit `group_write_path`
just like a group-nested one, and the save would land on the wrong
meta key. All 182 R5.1-b records currently work in production, meaning
none happen to be repeater-nested — but this is fragile.

**Implementation steps (in order)**

1. **Vertical `resolveStatus`** — mirror what the nested-reference
   slice added for R5.4 reference records: for records with
   `unlocks_at === 'R5.1'` AND `field_type ∈
   [text,textarea,url,email,number]` (and eventually `date_picker` if
   R5.5 landed), if the curated `field_name` contains `>`, call
   `self::hasGroupOnlyAncestry($field_key)`. Only flip `available` when
   true; otherwise `unsupported`. Top-level records short-circuit as
   today.
2. **Rename the helper** — `hasGroupOnlyAncestry` was named on the R5.4
   reference-collection slice but is family-agnostic. Rename to
   `parentChainIsGroupOnly` or similar to make the shared usage
   explicit. Keep both spellings during the slice for a compat window if
   needed.
3. **Also apply to R5.2 + R5.2+color_picker + R5.3 + true_false
   nested records** — same reasoning: any nested record whose
   intermediate is a repeater/flexible would silently mis-save. Broaden
   the gate across every family the drawer supports. The check runs at
   drawer-list time; ACF caches field lookups per-request, so the cost
   is bounded.
4. **Tests** — extend `VisualEditorVerticalProviderR51BTest` with a
   dataProvider matrix that runs the group-only-vs-repeater check
   across every currently-supported R5.x family. Each case seeds
   `$GLOBALS['vfe_test_acf_fields']` with a mixed / group-only chain
   fixture and asserts the correct `status`.
5. **Also consider factory-side rejection** as a defense-in-depth
   layer — `SharedGlobalsDescriptorFactory::build()` could check the
   walkGroupChain result and return null when a non-group parent is
   detected. This produces a 404 at open-time rather than a mis-save.
   BUT it duplicates the check between server-side factory and Vertical
   resolveStatus; skip unless we discover a case where a wrong-typed
   descriptor slips past Vertical. Add a note in the release doc that
   this is the second defense line if needed.

**Non-goals**

- Repeater-subfield actual support (that's R5.7).
- Detecting the mismatch in DBVC's factory (deferred — see step 5).
- Live-migration of any records that were "silently working" because
  they happened to be group-only anyway — no action needed there.

**Recommended order:** land AFTER R5.5 (share the widened family
whitelist) OR BEFORE R5.7 (which will need a symmetric gate structure).
Independent of R5.5 in principle; the merge just gets slightly cleaner
if R5.5 is in first.

---

### R5.7 — Repeater / flexible-content nested support (substantial)

**Shape locked (2026-09-01): Option C-1 · inline expandable tree, no drag.**
Chosen from the four-option design review (see the accompanying lo-fi
artifact). Concrete slice-by-slice plan lives in a dedicated doc:
[R5.7-INLINE-TREE-IMPLEMENTATION-PLAN.md](R5.7-INLINE-TREE-IMPLEMENTATION-PLAN.md).
The rest of this section is the pre-decision analysis, kept for
provenance; the implementation plan supersedes the design-options
discussion below.

**Records unlocked:** 1 today (`settings_nav_menus>menus>menu_posts`
if `menus` is a repeater; the current nested-reference slice leaves it
unsupported by design). Future-proofs for any curation additions
nested in repeaters.

**Why this is a design slice, not just wiring.** ACF stores repeater
values as an ORDERED LIST of rows, each row a keyed dict of subfield
values. Editing a subfield of a repeater requires knowing WHICH ROW —
which isn't part of the current drawer model. There are three UI
design decisions to make before any code:

**Design decision 1** — how does the drawer represent repeater rows?

- **Option A: one drawer entry per row.** Each row surfaces as its own
  Vertical record, labelled with a distinguishing field from the row
  (e.g., the menu label). Clean UX; pushes the "how do I distinguish
  rows" question into the row itself. Requires the Vertical provider
  to unroll repeater rows into synthetic records at getControls-time,
  with row_index baked into the descriptor.
- **Option B: one drawer entry per repeater, with row picker inside
  the panel.** Simpler provider (one record per field), but the panel
  needs a new UI mode for row selection.
- **Option C: bulk-edit all rows at once.** Wrong for most workflows
  (users edit one row at a time). Skip.

Recommendation: **Option A** — matches the existing "one Control per
row" mental model and doesn't require panel-side redesign.

**Design decision 2** — how does the descriptor identify a specific
row?

Existing infrastructure: `source.type='acf_repeater_subfield'` +
`source.container_type='repeater'` + `source.parent_field_name` +
`source.row_index` (already recognized by `AbstractAcfResolver::isRepeaterSubfieldSource`
+ related helpers). Reuse this shape.

**Design decision 3** — how are rows uniquely identified across
re-orders?

ACF row order can change (drag-and-drop reorders the underlying array).
A descriptor keyed on row_index becomes stale if the row moves. Two
options:

- **Row-index by numeric position at descriptor-mint time.** Simple.
  Stale after reorder. On save, need `expected_row_signature` check (a
  hash of the row's current values) to guard against wrong-row writes.
- **Row-index by ACF's internal row key.** ACF stores each row with a
  generated `acf_row_*` key — a stable identifier that survives
  reorders. If ACF exposes these via `get_field_object()`'s value
  shape, use them. If not, fall back to positional + expected-signature.

Recommendation: prefer stable row keys if available; fall back to
positional + signature.

**Implementation steps (in order)**

1. **Investigate row-key availability** — spike (~1 hour) to see what
   `get_field($repeater_name, 'option')` returns for a live ACF
   repeater. Confirms whether stable row keys are accessible or we're
   stuck with positional.
2. **Design the synthetic-record shape** in the Vertical provider —
   how does one repeater row become N control records (one per
   subfield)? Publicid convention (e.g.,
   `vertical:{parent_slug}::row_{index_or_key}::{subfield_slug}`)?
   Category / group_title inheritance from the parent field or from
   the row?
3. **Update the curation JSON schema** (optional) — if the curator
   wants to control per-row Category or priority, the JSON may need
   new fields.
4. **DBVC factory extension** — new `buildRepeaterSubfieldDescriptor`
   helper that emits `source.type='acf_repeater_subfield'` +
   `container_type='repeater'` + `parent_field_name` + `row_index` (or
   row_key). Contract stays `shared_field` for a scalar subfield or
   `shared_relationship_collection` for a reference-collection
   subfield.
5. **AcfReferenceCollectionResolver + AcfTextResolver + others** —
   confirm the existing `isRepeaterSubfieldSource` write path
   (`writeRepeaterSubfieldValue`) handles what we hand it. Extend if
   needed.
6. **Vertical provider getControls** — expand every reference /
   scalar repeater record into N synthetic records (one per row) at
   list-time. Use the curated repeater's field_key to lift its rows via
   `get_field()` + emit one record per row. Add a per-row label
   (e.g., first-non-empty subfield value).
7. **Vertical provider buildDescriptor** — parse the synthetic
   publicId to extract row_index/key, then delegate to the factory
   with row info attached.
8. **Vertical provider buildValueSummary** — same shape as top-level
   for each row (delegates to the appropriate static builder).
9. **Frontend** — the drawer's row-rendering code shouldn't need
   changes (records are just records to the drawer). Verify the
   value-summary chip renders correctly for repeater-subfield
   reference collections.
10. **Tests** — new `VisualEditorControlCenterR57RepeaterSubfieldTest.php`
    (factory helper shape; AcfReferenceCollectionResolver group-vs-repeater
    detection; Vertical row expansion with mocked repeater fixtures).
    Extend Vertical provider test with repeater-nested cases via the
    global ACF stub.
11. **Live-site QA** — this is the highest-risk R5 slice. Real-browser
    QA at 1440×900 with the actual `menus` repeater to verify: (a)
    each row surfaces as its own drawer entry with a distinguishing
    label, (b) opening a row loads the correct subfield value in the
    panel, (c) saving persists to the correct row (not the wrong row
    after a reorder in another window), (d) row deletion in ACF admin
    invalidates the record.

**Non-goals**

- Editing a whole repeater row (multi-subfield composite save) — R5.7
  is one subfield at a time. Composite repeater-row editing is a
  larger slice.
- Adding/removing repeater rows from the drawer — administration lives
  in ACF admin.
- Reordering rows from the drawer — same.

**Recommended order:** land LAST. This slice touches: Vertical provider
schema (synthetic records), factory descriptor shape, resolver write
paths, frontend rendering (verify), and needs real-browser QA. Land
R5.5 + R5.6 first as small wins; then tackle R5.7 with the coverage
foundation stable.

---

### R5.later-a — Palette grouping (curator opt-in) **[LANDED 2026-09-03]**

**Design review artifact:** `https://claude.ai/code/artifact/18ee646a-2266-4e93-b7ad-ee195c5f2b66` — three-option lo-fi (in-drawer tree / dedicated popup / panel palette render mode). Chosen: Option X (in-drawer tree, cheapest — reuses R5.7-b's `parentPublicId` primitive end-to-end).

**Records unlocked:** 0 (UX-only slice — no status changes). Individual color_picker records that currently surface as flat drawer rows now fold under a single synthetic palette parent when a curator marks ≥ 2 siblings with a shared `palette_group_key`.

**What shipped.** `CurationStore::normalizeDecision` gains a `palette_group_key` field (sanitize_key + 40 char cap; treated as a meaningful decision on its own — `isEmptyDecision` does not prune a lone key). `CurationExporter` passes it through to the exported record shape. The Vertical provider (both checkouts, byte-identical) pre-scans records for palette members, then in `getControls()` dedupe-emits ONE synthetic palette parent (`meta.role='palette'` + `meta.childCount=N` + `status='unsupported'` + `fieldFamily='other'`) the first time each key is hit and stamps `parentPublicId='vertical:palette_{slug}'` on every color leaf sharing it. Parent label uses the curator's `group` string on the first-seen child; falls back to a humanised slug via new `humanizePaletteGroupKey()` (`brand_primary` → `Brand Primary`, `brand-warm` → `Brand Warm`). R5.7-b's tree renderer groups the resulting parent + leaves under one disclosure with the existing childCount chip — zero drawer JS or CSS changes.

**Guards.** Grouping is color-picker-only in MVP — non-color records carrying the key contribute nothing to the count and stay flat. Solo opt-ins (count < 2) fall through to a flat emission (no palette-of-one disclosure). Palette parents coexist with R5.7-a repeater expansion via the same `$parents_emitted` map — repeater expansion `continue`s past palette grouping; palette grouping only fires on records the repeater path did not consume.

**Follow-on slices that also landed** (2026-09-03..04):

- **R5.later-a.1 (2026-09-03)** — live-site QA report + release-notes block. QA report at `qa/R5-LATER-A-PALETTE-GROUPING-QA-REPORT.md` (14/23 pass, 8 N/A, 1 skipped). Evidence: E-122.
- **R5.later-a.2 (2026-09-03)** — drawer `isRepeaterParent` gate generalised into a `TREE_PARENT_ROLES` whitelist including `'palette'` so palette parents surface as tree parents with disclosure + child-count chip. Evidence: E-122.
- **R5.later-a.3 (2026-09-03)** — `CurationPage` admin UI for `palette_group_key` input per row. Evidence: E-124.
- **R5.later-a.5 (2026-09-03)** — recommender heuristically auto-suggests `palette_group_key` for color_picker records nested inside a "palette"-named parent group; exporter uses suggestion as fallback (curator override wins); admin UI shows placeholder + `is-auto` hint. Vertical provider `buildPaletteParentRecord` always uses humanised slug for parent label (no longer inherits ACF group_title's generic container name). Evidence: E-127.
- **R5.later-a.6 (2026-09-04)** — curator-set `palette_display_label` override for the palette parent's drawer label. New `sanitize_text_field` field preserved through store → export → provider; only ONE child in the group needs the value (first non-empty wins in the pre-scan — curator annotates a single canonical color instead of duplicating on every row). Evidence: E-128.

**Follow-on slice R5.later-y-3 (pre-mint leaf descriptors — first-save perf) LANDED 2026-09-05.** Closes the last captured R5.later palette-UX frontier. Server pre-mints each leaf descriptor + token at palette-parent open time; `ControlCenterOpenController` registers each in the session; frontend palette controllers pre-warm their descriptorCache. First save per swatch drops from 2 round-trips to 1. Zero new REST routes / mutation authority. Zero user-visible UI change. **The R5.later Palette Grouping arc is now feature-complete for all documented Options + follow-on frontiers.** Evidence: E-133.

**Follow-on slice R5.later-b (Option Y — dedicated bulk-edit popover) LANDED 2026-09-05.** Palette-role tree parents now render an Expand icon button alongside Open; click Expand → full-attention centered modal with larger swatch grid (200px min cells, 96px swatch height), per-cell Copy hex button, header Copy-all-as-CSS-variables action (produces `--kebab-case: #hex;` newline blocks for design-token export). Same lazy-open + save contract as R5.later-y-2 byte-identical. Focus trap + Escape close + click-outside close. Zero backend touches. **The R5.later Palette Grouping arc is now COMPLETE for all three design-review Options (X in-drawer tree + Y dedicated popup + Z panel palette render mode).** Evidence: E-132.

**Follow-on slice R5.later-y-2 (inline swatch editing) LANDED 2026-09-05.** Extends R5.later-y's read-only panel with live per-swatch editing. Each swatch is now a `<label>` wrapping a native `<input type="color">`; changing a color fires lazy-open + save through existing R5.2+color_picker contract with per-publicId token cache. First edit per swatch = 2 round-trips; subsequent edits on same swatch = 1 round-trip. 250ms debounce for live-drag inputs. Per-cell save-status indicators. Zero new REST routes / mutation authority. Zero backend touches (descriptor shape from R5.later-y is exactly what inline editing needs). Evidence: E-131.

**Follow-on slice R5.later-y (Option Z — panel palette render mode) LANDED 2026-09-04.** Palette parents flipped to `status='available'`; new `buildPaletteOverviewDescriptor` mints `input='palette_grid'` shared_field descriptor with `source.leaves=[{publicId, label, current_hex}]`. Drawer renders Open button alongside disclosure; overlay-app.js gains `createPaletteOverviewController` rendering swatch grid; swatch click dispatches `dbvc:visual-editor:open-control` event → drawer routes to leaf's own R5.2+color_picker panel via existing save contract. Zero new REST routes / mutation authority / resolvers. Curator now has two orthogonal ways to reach any palette color. Evidence: E-130.

**Deferred (still open) to follow-on slices.** **R5.later-b (Option Y — dedicated popup)** remains a future frontier as an ALTERNATIVE surface, not a successor — it could ship on top of R5.later-y's infrastructure without conflict (both would live behind different affordances). **R5.later-y-2 (inline per-swatch editing)** — currently swatches are navigation buttons that route to individual color panels; a future slice could turn each swatch into a live `<input type="color">` firing per-color saves without leaving the palette panel. The `vf_palette` custom-field frontier (below) is a separate problem — different data shape (one ACF field storing N colors internally vs N sibling color_picker fields folded via `palette_group_key`).

**Evidence:** E-121, E-122, E-124, E-127, E-128, E-130 · **Test surface:** `VisualEditorControlCenterR5LaterAPaletteTest` (32/89 as of R5.later-y — grew from 16/48 baseline via R5.later-a.5's +2 exporter tests + label-rename + R5.later-a.6's +7 label-override cases + R5.later-y's +4 descriptor tests + status-flip assertion) covering store normalisation + exporter passthrough + auto-suggestion + curator-override precedence + provider dedupe + child linking + humanised-slug fallback + curator-set label override + first-non-empty-wins pre-scan + whitespace-only-label fallback + non-color-picker ignore + solo-opt-in flat + two-different-keys emit two parents + hyphenated + underscore-separated humanization + palette parent status='available' + palette overview descriptor happy-path + null-return for nonexistent + null-return for empty palette_key. Drawer jsdom `visual-editor-brand-control-center-state.test.cjs` (57/pass — grew from 53 via R5.later-y's +4 cases) covering palette parent Open button rendering + repeater parent tree-only regression guard + open-control event → openRow routing + unknown-publicId silent-ignore.

---

### R5.later — `vf_palette` custom field type (Vertical-side design) **[PATH B CLOSED 2026-09-03]**

**Records unlocked:** 0 (permanently out-of-scope). The single affected record (`settings_vf_term_colors`, owner `advanced-settings`) stays `unsupported` in the drawer by design; curator continues to edit it via the native `vf_palette` UI at **Settings → Site Settings Advanced**.

**Decision rationale — why Path B.** Live investigation of the `vf_palette` field type (`themes/vertical/functions/plugins/acf/field-types/palette.php`) revealed the field is a per-taxonomy-term color grid (default: `category` taxonomy, up to 200 terms). Storage: `{term_id: hex, ..., _taxonomy: 'category'}` snapshot in the options row; AUTHORITATIVE per-color values in term meta (`core_tax_group_term_styles_term_custom_color_value` per term). The **existing ACF UI at Settings → Site Settings Advanced already offers a complete per-term color-picker editor** — grid layout with WP color-pickers per term, search filter for large taxonomies, save writes both the snapshot AND per-term meta via ACF's native `update_value` hook. Path A (ship a drawer version) would duplicate this existing admin functionality without adding real workflow value — the curator's editing experience would be identical modulo the entry point. The one-time infrastructure argument for Path A (a general "themes register custom resolvers through a DBVC hook" extension point) can be built later when a genuinely-different custom field type appears; building it now with vf_palette as the sole consumer means designing the abstraction against a single case, which is the wrong shape for a good extension point.

**What shipped (Path B — small doc slice, 2026-09-03):**
- `addons/visual-editor/src/Curation/FieldCurationRecommender.php` — `FAMILY_UNLOCK_MAP` gains `'vf_palette' => 'never'` entry with an inline comment linking back to this frontier's rationale. The `never` sentinel distinguishes "intentionally out-of-scope" from "not-yet-supported (`later`)" so future maintainers reading the curation JSON can immediately tell the two apart.
- `addons/visual-editor/curation/vertical-approved-controls.json` — hand-edit flipped the `settings_vf_term_colors` record's `unlocks_at` from `"later"` to `"never"` (matches what next re-export will emit; 400 record count preserved).
- `tests/phpunit/VisualEditorCurationRecommenderTest.php` — new assertion in `test_unlocks_at_maps_families_to_the_right_r5_slice` covering `deriveUnlocksAt('vf_palette') === 'never'`.
- `tests/phpunit/VisualEditorVerticalProviderR51BTest.php` — new `test_r5later_pathb_never_unlocks_at_stays_unsupported` (defensive — pins the "never sentinel → unsupported" invariant so a future contributor who adds a `unlocks_at="never" → available` bypass trips the test).
- No Vertical provider code changes needed — `resolveStatus()`'s default "unrecognized unlocks_at → unsupported" path handles `never` unchanged. No cross-repo mirror needed.
- Baselines: PHPUnit `VisualEditor|Curation` **421/2982** (was 420/2977 — +1 test / +5 assertions).

**Live-site impact:** 0 records change status today. Drawer coverage stays at "397+ of 400 curated records surface as Available"; the 3 remaining unsupported records break down as: 1 R5.5 date_picker (`admin_site_verbiage>site_business_type`, still `later` pending curator tagging as `R5.1` per E-120), 1 R5.4 relationship (`settings_nav_menus>menus>menu_posts`, actually unlocked via R5.4 group-write path per E-118 scope correction — the "unsupported" claim in the top table is now stale for this record too), and 1 R5.later `vf_palette` (this record, now explicitly `never`).

**What Path B does NOT close.** If Vertical ever ships a genuinely-different custom ACF field type that IS worth drawer support (e.g., a rich icon picker, a per-field JSON editor), the "theme-provided resolver via DBVC hook" question re-opens as a fresh design conversation. Path B closes the vf_palette-specific frontier; it does not preclude a future R5.8 "theme resolver extension point" slice if a genuine need appears.

---

## Planned phases before R6 (added 2026-09-05, sequencing + risks revised 2026-09-05)

Four new phases captured before starting the R6 Frontend Site Manager Workspace major phase. Sequenced deliberately after a risk pass: **R5.later-tests → R5.later-perf → R5.later-c → R5.later-cache**. Rationale in §Sequencing at the bottom.

### R5.later-tests — Overlay-app.js jsdom scaffolding **[PLANNED, sequenced first]**

**Scope.** Every panel controller (R5.1 text, R5.2 choice/link/wysiwyg, R5.2+color_picker, R5.3 image, R5.4 relationship/post_object, R5.5 date, true_false, R5.later-y palette overview, R5.later-y-2 inline swatch editing, R5.later-b modal) currently ships with the caveat "overlay-app.js has no dedicated jsdom test file — live-verified only." Every one of the next three planned phases (perf, value-display, cache) touches overlay-app.js and/or the drawer's fetch paths. This slice stands up the missing test scaffolding before more code lands.

**Why now.** Four accumulated hotfixes on R5.later-y-2 alone (2b entity type, 2c ui.input/setDisabled, 2d group-nested value resolution, then the modal in R5.later-b) each shipped without mechanical regression coverage — each was caught by live QA. R5.later-cache's correctness invariants (stale-row invalidation gaps, cross-tab drift, capability-change burn) demand deterministic tests to be safely shippable at all. Standing up the test surface once pays off across three follow-on slices.

**Rough scope.**
- New `tests/visual-editor-overlay-app-state.test.cjs` mirroring the drawer + media-manager test file shape (jsdom + IntersectionObserver polyfill + `window.fetch` mock).
- Coverage targets, prioritized: (1) `createPaletteOverviewController` mount + swatch change → lazy-open + save flow, (2) `createPaletteBulkPopoverModal` mount + copy-hex + copy-all-as-CSS-variables, (3) `handleSave` early-return guard for `input='palette_grid'`, (4) `handleOpenControlRequest` event routing, (5) core `renderEditorPanel` dispatch on `ui.input` for each shipped family (regression guard for R5.later-y-2c type of bug).
- Reuses R4-C-1b's IntersectionObserver polyfill pattern from the drawer test file — extract to a shared helper if the copy-paste bloat gets excessive.

**Known risks / open design questions.**
- Overlay-app.js is one 13,000-line IIFE. Testing individual controllers requires either (a) loading the whole file into a jsdom context, or (b) refactoring to expose controllers on `window.DBVCVisualEditorPanelControllers` for test access. Prefer (a) — no production surface change — but must confirm jsdom's script loader handles the size + doesn't hit CommonJS-in-a-browser weirdness.
- Bootstrap globals (`DBVCVisualEditorBootstrap`, `DBVCVisualEditorApi`) need mocks that match what the production runtime provides. Media Manager test file's mocks are the reference implementation to copy.
- Some panel behaviors depend on real focus/scroll/computed-style that jsdom stubs poorly. Acceptable-if-documented: skip the layout-dependent scenarios (visual overlay positioning, `scrollIntoView`) and cover the state/network flow only.

**Non-goals.** Not a full mock of every panel controller — just the surface the next three phases will touch. Not a replacement for live QA — modal focus trap + click-outside close + real color-picker interaction still need real-browser verification.

**Sizing.** Medium — the scaffolding is a one-time setup cost; each covered controller is small once the fixtures exist.

### R5.later-perf — Deep frontend performance audit **[PLANNED, sequenced second]**

**Scope.** Systematic audit of the Brand Control Center's frontend load path, measuring where time and network bytes go from `?dbvc_ve_editmode=1` through drawer-opens through first meaningful interaction. Produces a scoped findings report with prioritized fixes, no code changes in this slice itself.

**Why now.** The drawer's initial-open experience today makes multiple sequential rounds (list controls, family scan, per-row hydrations via R4-C-1b, per-descriptor open, session refreshes). Each has been optimized individually but no one has measured the composite cost against real load size (400 curated records, all-Available). R5.later-y-3 already trimmed 1 round-trip per palette-swatch first-save; the same lens applied end-to-end may find similarly cheap wins. This slice must land BEFORE R5.later-c so we know whether widening per-row hydration is affordable, and BEFORE R5.later-cache so we can prove the cache actually helped.

**Rough scope.**
- Instrument the drawer's initial-open path via `window.performance.mark`/`.measure` at each network round-trip + each significant render pass. Capture in a debug flag hidden behind the existing performance profiler (D-064 infra).
- Real-browser measurement against the deployed local site — capture flame charts, network waterfalls, and IntersectionObserver activity across 400 rows.
- Produce a `qa/R5-LATER-PERF-AUDIT-REPORT.md` with: baseline measurements at both viewports, top-N findings ranked by cost × frequency, recommendations for each (fix in flight vs. fix in cache — the latter feeds R5.later-cache), and a "wins we chose not to pursue" residuals list.
- **Commit baseline numbers to the repo** so future audits (post R5.later-c, post R5.later-cache) can prove regressions or improvements.
- Zero production code changes in this slice — this is a discovery/report slice. Fixes ship in follow-on R5.later-perf-{a,b,c...} slices sequenced by the report.

**Known risks / open design questions.**
- **Instrumentation skews measurement.** `performance.mark`/`.measure` calls have small but non-zero overhead. Need instrumentation-off baselines too — either run measurements with instrumentation compiled out, or rely on Chrome DevTools for cold numbers alongside the instrumented ones.
- **Real-browser variance.** Same viewport, same content, run-to-run can vary 20-40% (GC, background tabs, network jitter). Report requires N=5+ runs per scenario with medians reported, not single-shot numbers.
- **Claude-in-Chrome environmental limits still apply.** E-123 documented IntersectionObserver throttling in backgrounded automation tabs + retina viewport mapping issues. Audit MUST be done in real foregrounded Chrome, not an automation session, or the numbers are systematically wrong.
- **LocalWP → production translation gap.** Local host is faster than most production (no CDN, local mysql, no PHP-FPM contention). Report should explicitly caveat + recommend re-measuring on staging before treating findings as production-relevant.
- **Content-derived variance.** Vertical's 400 records is one shape. Themes with 800+ records or media-heavy content look different. Report is Vertical-specific; extrapolation needs care.

**Non-goals.** No code changes in this slice. No mobile perf work (D-058 non-goal). No mutation-path perf (drawer is read-heavy; save round-trips already ~50-150ms each and rarely batched).

**Sizing.** Small-medium — mostly measurement + writing. The instrumentation is one-shot (removed after audit) unless it turns out to be broadly useful.

### R5.later-c — Drawer inline current-value display **[PLANNED, sequenced third]**

**Scope.** Every drawer row currently renders `.__meta` (category · group · badge) directly under the label. Beneath that, render the field's **current stored value** in a compact sanitized preview so a curator scanning the drawer can see the site's actual state at a glance without opening each control individually.

**Why now.** R4-C-1b's value-summary chip (relationship/post_object "N connected") sits in the ACTION cell before the Open button, is IntersectionObserver-lazy-loaded from a batch endpoint, and is family-scoped (only reference collections render today). This planned slice widens the same shape to every family + moves it into the LABEL cell — the design intent is "what does this field currently hold?" surfaced universally, not "does this field have connected items?" surfaced narrowly. Substantial UX value now that ~400 curated records are all editable — a curator's visual model of "what's set to what" today lives outside the drawer. Sequenced AFTER R5.later-perf so the audit's findings inform whether widening per-row hydration is affordable as-designed or needs to lean on R5.later-cache first.

**PINNED design decisions (2026-09-05).**
- **The R4-C-1b chip MOVES from the action cell to the label cell** (not "add a second slot"). One location is cleaner — the action cell keeps the Open button, the label cell owns display context (label + description + meta + inline value). Migration path preserves R4-C-1b's IntersectionObserver + batch + cache invariants byte-identical; only the DOM insertion point changes.
- **Repeater/palette parents show a compact aggregate** (`[N rows]` for repeater; `[N colors]` for palette) in the new inline slot — mirrors the existing childCount chip semantics + keeps parent rows visually distinguishable from leaves at a glance.
- **Row-height cap: 1 line for the inline value, ellipsis on overflow.** No wysiwyg-preview-blows-up-your-drawer. WYSIWYG stripped-text still shown but capped at ~40 chars with a full-value `title` tooltip — same shape R5.2-b's existing chip already uses.
- **Search-scope stays label + description ONLY (R4-C-1a shape unchanged).** Widening `q` to match against value text would push server-side re-derivation per search keystroke; too expensive for the win. Curators who need value-search can rely on the visible inline previews + browser Ctrl-F within the drawer.

**Rough scope.**
- Extend the existing R4-A `POST /value-summaries` endpoint's per-family builders to cover text, choice, link, image, color, boolean, date, wysiwyg (all R5.x-shipped families) alongside the existing relationship/post_object. Each builder ~30-60 lines: PHP static per-family projection into `{family, presentation, ...}` shape.
- Drawer render: MOVE `.__value-summary` slot from action cell to a new `.__value-inline` slot after `.__meta`. Same IntersectionObserver batch-fetch machinery; family-scoped presenter functions render the actual value (truncated text, ellipsed link title, monospaced hex + solid swatch for colors, tiny lazy-loaded thumb for images, "N connected" for references, "On"/"Off" for boolean, ISO for date, stripped preview for wysiwyg).
- Respect R4-C-1b's cache + batch + fail-soft invariants. Zero new REST routes; the existing value-summaries endpoint's response shape widens.
- Uses R4-D-3's overflow-wrap defense so long values don't push horizontal overflow.

**Known risks / open design questions.**
- **Image family is the expensive one.** Every image row needs attachment metadata for the thumbnail. Batched via the existing endpoint helps, but for media-heavy palettes/pages this may materially slow drawer opens. R5.later-perf is expected to flag this — its findings determine whether we ship eager or wait for R5.later-cache to soften the cost. **Explicit dependency**: if perf audit says image-family hydration is a top-3 offender, R5.later-cache must land first.
- **Row-height rhythm** — even with 1-line + ellipsis cap, some cells (colors with swatches, images with thumbs) are visually heavier than others (text). Might need per-family visual balancing.
- **A11y** — inline value text needs to be reachable by screen readers WITHOUT being announced as part of the row's label (that would be noisy). Solution: `aria-describedby` linking to the value slot, tested via jsdom + real AT.

**Non-goals.** No editing UX changes; this is display-only. No new save authority. No repeater-parent aggregate summaries beyond the compact `[N rows]` chip (leaves still show individually).

**Sizing.** Medium — the endpoint widening is 8 per-family builders + one drawer JS render block + one CSS block + moving the R4-C-1b slot. Testable via the R5.later-tests scaffolding + extending R4-C-1b's IntersectionObserver polyfill.

### R5.later-cache — Session-persistent scan cache **[PLANNED, sequenced last]**

**Scope.** After R5.later-perf identifies where time goes AND R5.later-c widens hydration, ship a client-side caching layer that survives page reloads so a returning curator doesn't re-populate every drawer row from scratch on every reload. The specific cache shape is a design decision informed by the audit's findings — this phase captures intent + boundaries + correctness invariants.

**Why now.** Curators editing a large brand palette or content-heavy option field group typically reload the page multiple times as they iterate (browser dev tools, cache clears, real content changes). Today every reload re-runs the drawer's list fetch + IntersectionObserver hydration for every visible row. Since the drawer's read model is heavily deterministic and mutation is rare relative to reads, a well-scoped cache would visibly speed the everyday workflow. Sequenced LAST so R5.later-perf has proven where cost lives + R5.later-c has finalized the hydration shape we're caching.

**PINNED design decisions (2026-09-05).**
- **Kill-switch default OFF** (opt-in via a new setting). Correctness bar is much higher than a typical cache — a stale row that survives an invalidation gap and lies to the curator about the current value is a bad user outcome. Default-off gives us real users flagging correctness issues before it's on for everyone. Flip default ON only after real-world use validates correctness.
- **localStorage + LRU eviction above 4MB.** Not IndexedDB (too much ceremony for the payload size) + not a WP transient (server-side cache is out of scope; the audit may recommend as a separate follow-on). LRU keeps the recent N palettes cached; older entries evict when the quota approaches.
- **Cache key includes `{userId}`** so a demoted user's cache doesn't survive across capability changes. Cache MUST burn on session-token rotation via a `panel:session-changed` event (new — needs to be dispatched from the session-refresh path).
- **Multi-signal invalidation**, not just `viewModelVersion`. See §Correctness invariants below.

**Rough scope (final shape subject to audit findings).**
- **Cache shape**: localStorage-keyed by `{sessionId}:{viewModelVersion}:{userId}` — cheap to check, easy to invalidate on registry version bump.
- **Cache contents**: R4-A list payload (safe rows only) + per-row value summaries. NOT descriptors (those are session-registered server-side and mint fresh via `/open`).
- **Cache-hit UX**: drawer renders instantly from cache while a background revalidation fetch runs; if revalidation returns changed data, surgical per-row patches (R4-C-1b's `patchValueSummarySlot` shape) reconcile the difference. Small subtle "revalidating…" indicator so curators know it's an optimistic-render.
- **Kill switch**: new `dbvc_visual_editor_control_center_cache_enabled` setting, default OFF.

**Correctness invariants (must be provably maintained).**
1. `viewModelVersion` bumps burst the cache (already-shipped signal at v3 per R5.7-b).
2. R4-D-1's `panel:saved` event invalidates the affected row's summary entry.
3. **Palette per-swatch saves invalidate too** — R5.later-y-2's per-swatch saves currently do NOT fire `panel:saved` (by design). Cache slice must either (a) dispatch a compatible `panel:saved`-shaped event from the per-swatch save path with the leaf's publicId, OR (b) add a distinct `palette:swatch-saved` event and wire cache invalidation to both. Prefer (a) — one invalidation channel is simpler than two.
4. **ETag-per-row background revalidation** — the R4-A list response gains an optional `rowVersion` (hash of the row's safe payload) per row; cache stores it; background revalidation sends `If-None-Match: {rowVersion}` and server returns `304` or fresh payload. Catches other-user saves + direct wp-admin edits that don't fire client-side events.
5. **Cross-tab drift** — `window.storage` event listener bursts the cache when another tab writes a different `panel:saved` marker. Alternative: accept stale-in-other-tab explicitly and document the caveat. Prefer the listener; small addition, big correctness win.
6. **Capability-change burn** — cache must burn when the session-token rotates (indicates auth state changed). Requires the session-refresh code to fire a `panel:session-changed` event.
7. **Quota exceeded graceful degradation** — LRU eviction fires above 4MB; if a write STILL fails with `QuotaExceededError`, burn the entire cache + fall through to no-cache render (never break the drawer).

**Known risks / open design questions.**
- **Correctness bar dominates all other design tradeoffs.** Every invariant above needs deterministic tests via the R5.later-tests scaffolding. Manual QA alone is not enough — the failure modes are silent (stale row shown, curator saves over wrong value).
- **`ETag`-per-row shape is a server-side addition.** Small addition to R4-A's list response but needs to hash consistently across processes. Salt with `wp_get_current_user()` since row content varies per capability.
- **Palette per-swatch event dispatch** — sequencing gap that must be closed as part of this slice, not a "TODO after."
- **Private/incognito mode** — localStorage is either unavailable or session-lifetime. Cache falls back to in-memory-only for the session. Documented graceful degradation.

**Non-goals.** No server-side cache (WP transient) in this phase — the audit may recommend as a follow-on. No cross-user cache sharing (per-user only). No cross-device sync (per-viewer only). Not a replacement for the R2-H persistent media index (that's server-side scan cache, different problem).

**Sizing.** Medium-large — the mechanics are straightforward but the invariants + tests + palette-event coupling add non-trivial coverage work. Sizing estimate assumes R5.later-tests scaffolding is already in place.

### Sequencing before R6 (revised 2026-09-05 after risk pass)

**Order: R5.later-tests → R5.later-perf → R5.later-c → R5.later-cache → R6.**

Rationale:
- **R5.later-tests first** — stands up overlay-app.js jsdom coverage that all three follow-on slices lean on. Prevents the R5.later-y-2b/c/d/hotfix pattern of "shipped without mechanical regression coverage → live QA caught it → hotfix" from repeating across three more slices. Also unblocks R5.later-cache which cannot be safely shipped without deterministic invariant tests.
- **R5.later-perf second** — its findings inform whether R5.later-c's added per-row hydration is affordable as-designed OR needs R5.later-cache to soften it first (in which case the sequence flips to perf → cache → c). Also produces baselines that let us prove R5.later-cache actually helped.
- **R5.later-c third** — the drawer's visible daily-use polish; safe to ship once we know how expensive it is + have the test scaffolding to lock it.
- **R5.later-cache last** — highest correctness bar; benefits from having the audit's findings + the widened hydration shape (from R5.later-c) as the specific target to cache.

**Parallel-landing conflict warning.** All three follow-on slices touch `brand-control-center-app.js` and/or `overlay-app.js`. Sequential landing is required — parallel branches would guarantee merge conflicts. R5.later-tests is the exception; its test-file additions don't conflict with feature work.

After all four land, R6 (Frontend Site Manager Workspace) becomes the next major phase.

---

## Cross-cutting notes

**Test infrastructure that would ease all four slices.** The nested-reference
slice introduced the `$GLOBALS['vfe_test_acf_fields']` ACF stub pattern
(see `VisualEditorControlCenterNestedReferenceTest.php` +
`VisualEditorVerticalProviderR51BTest.php` set_up/tear_down). Every
R5.x slice from here on should reuse it rather than re-inventing.
Consider extracting to a shared test trait
(`tests/phpunit/traits/AcfFieldStubTrait.php`) so future slices don't
need to re-declare the `acf_get_field` function.

**Documentation that would ease all four slices.** No new
documentation is required for R5.5, R5.6, or R5.later. R5.7's design
decisions should land in a dedicated `docs/dropins/.../ui-ux/R5.7-repeater-row-model.md`
before any code — this is the kind of slice where a wrong UI decision
costs a rebuild.

**Live-site QA gates.**

- R5.5 (date_picker): light — 1 record; verify native picker opens
  and saves an ISO date.
- R5.6 (hardening): no live-visible change — just make sure the
  existing 397 unlocked records keep working after the guard broadens.
- R5.7 (repeater): heavy — needs real-browser QA at 1440×900 across
  every synthetic-per-row control that surfaces, and confirmation of
  the row-uniqueness contract.
- R5.later (vf_palette): design decision only.
