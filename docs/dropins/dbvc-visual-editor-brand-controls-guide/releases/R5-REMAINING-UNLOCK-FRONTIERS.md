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
| 2 | `vf_palette` | `settings_vf_term_colors` (owner: advanced-settings) | `later` | Vertical-owned custom ACF field type; no DBVC resolver design. |
| 3 | `relationship` | `settings_nav_menus>menus>menu_posts` (owner: advanced-settings) | `R5.4` | Nested inside a repeater (probable); `writeGroupedFieldValue` doesn't cover repeater subfields. |

## The four proposed slices

Each slice below is a self-contained future R5 sub-slice, complete with
scope, primitives needed, non-goals, and green-baseline expectations.
Read the "recommended order" line at the bottom of each to see how they
interact.

---

### R5.5 — date_picker unlock (tiny)

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

### R5.later — `vf_palette` custom field type (Vertical-side design)

**Records unlocked:** 1 (`settings_vf_term_colors`, owner
`advanced-settings`).

**Why this is a Vertical-side slice, not DBVC.** `vf_palette` is a
Vertical-owned custom ACF field type (per the naming). DBVC's resolver
registry cannot know its storage shape without a Vertical
implementation. Two paths forward:

- **Path A: Vertical ships an `AcfVfPaletteResolver` and registers it
  through a DBVC hook.** Needs a DBVC extension point that lets themes
  register resolvers into the `ResolverRegistry` (mirrors R3-B's
  `dbvc_visual_editor_control_center_providers` extension point).
- **Path B: leave permanently unsupported.** If the maintainer never
  intends to edit term colors from the drawer, this is the correct
  call. 1 record; low friction.

**Recommended action before touching code:** confirm with the
maintainer whether term colors should be editable from the drawer at
all. If no, tag this record explicitly as `unlocks_at="never"` in the
curation JSON (docs: "custom field types are out-of-scope for the
drawer") and close this frontier. If yes, plan Path A as a real R5.8
slice with the new DBVC hook + Vertical resolver.

**Recommended order:** decide this BEFORE R5.7 investment — the
answer may reveal a similar pattern (Vertical-owned custom types) that
R5.7's design should also accommodate.

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
