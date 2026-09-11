# DBVC Visual Editor — Resume Prompt (pre-R6 phases)

**Copy everything below the `---` line into a fresh Claude Code session.**

---

You are picking up the DBVC Visual Editor project mid-arc. Four pre-R6 phases are planned and sequenced; read the canonical docs listed below **before** touching code, then start the sequenced first phase.

## Repository + branch + env

- **Working dir:** `/Users/rhettbutler/Documents/LocalWP/dbvc-codexchanges/app/public/wp-content/plugins/db-version-control-main`
- **Branch:** `codex/visual-editor-linked-posts-plan`
- **Base HEAD to preserve:** `5db4b40` — the tree at this commit is intentionally dirty; **do not** run any `git add`/`commit`/`stash`/`reset`/`checkout`/`clean`/`push`. Every prior slice landed as a working-tree edit; the maintainer commits manually.
- **Local site:** LocalWP at `https://dbvc-codexchanges.local/`
- **Cross-repo Vertical mirror:** every edit to `themes/vertical/functions/features/dbvc-visual-editor/includes/class-vf-vertical-control-provider.php` must be `cp`'d to the sibling checkout at `/Users/rhettbutler/Documents/LocalWP/frameworkflo-live/app/public/wp-content/themes/vertical/functions/features/dbvc-visual-editor/includes/class-vf-vertical-control-provider.php` and verified byte-identical via `diff -q`.

## Current boundary (as of 2026-09-05)

- **R1** signed off; **R4** arc COMPLETE + defensively hardened by R4-D-3; **R5.x** unlock arc COMPLETE for every intentionally-unlocked family; **R5.later Palette Grouping** arc feature-complete for all three design-review Options (X in-drawer tree, Y bulk-edit popover, Z panel palette render mode + inline editing + y-3 pre-mint perf).
- **Next up:** four planned pre-R6 phases, sequenced as **R5.later-tests → R5.later-perf → R5.later-c → R5.later-cache**, then R6 (Frontend Site Manager Workspace).
- **Start with:** R5.later-tests. It's the sequencing-first prerequisite that unblocks the other three.

## Baselines to preserve

Run these before starting AND after each substantive edit; they must stay green:

```bash
vendor/bin/phpunit --filter 'VisualEditor|Curation'         # expect 441/3036 OK
node --test tests/visual-editor-brand-control-center-state.test.cjs  # expect 60 pass
node --test tests/visual-editor-media-manager-state.test.cjs         # expect 42 pass
```

PHP lint every touched PHP file with `php -l <path>` before considering the edit done.

## Safety constraints (durable — do not deviate)

- **No git operations** in either repo. Preserve the intentional dirty tree at base `5db4b40`. Not `add`, `commit`, `stash`, `reset`, `checkout`, `clean`, or `push`.
- **No live-site mutations** outside test setUp/tearDown. Never toggle `dbvc_visual_editor_control_center_enabled` or the master Visual Editor option from production paths.
- **Never touch** `~/.config/dbvc-local-agent.env`.
- **Desktop-only** per D-058 (mobile is a permanent non-goal; do not add mobile paths or media queries beyond the existing narrow-width regression floor).
- **No new write authority.** Every new save round-trip must route through an existing `save_shared_field` mutation contract; do not create new REST routes or new resolvers unless the phase spec explicitly calls for one.
- **Cross-repo Vertical parity is invariant.** Both checkouts of `class-vf-vertical-control-provider.php` must stay byte-identical after every edit.
- **Commit-message attribution** (when the maintainer later commits): end with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`. PR descriptions end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Canonical docs (read these first, before writing code)

1. **`addons/visual-editor/docs/handoffs/DBVC_VISUAL_EDITOR_HANDOFF.md`** — the current-state handoff. Its first ~40 lines carry the boundary + last-slice summaries. Do not read the whole thing (it's ~75KB); the head is what matters.
2. **`docs/dropins/dbvc-visual-editor-brand-controls-guide/releases/R5-REMAINING-UNLOCK-FRONTIERS.md`** — §Planned phases before R6 has the **full spec + Known Risks + Pinned Design Decisions** for each of the four pre-R6 phases. This is the canonical source. Read the §R5.later-tests section first (starting slice), then §Sequencing before R6.
3. **`docs/dropins/dbvc-visual-editor-brand-controls-guide/tracking/IMPLEMENTATION-TRACKER.md`** — one row per phase; the pre-R6 rows carry planned-files annotations. Grep for `R5.later-tests` for your starting row.
4. **`addons/visual-editor/CHANGELOG.md`** — Unreleased section top has the R5.later Palette Grouping arc's landed slices with their evidence-log references (E-127 through E-133). Skim to understand the recent code shape.
5. **`docs/dropins/dbvc-visual-editor-brand-controls-guide/tracking/EVIDENCE-LOG.md`** — E-131/E-132/E-133 for R5.later-y-2/b/y-3 give you the recent code-touch pattern. E-123 documents the Claude-in-Chrome IO-throttling gotcha you'll hit during R5.later-perf.

## Task tracking convention

Use `TaskCreate` at the start of each phase to break work into 4-8 tasks. Update as you go with `TaskUpdate`. Task naming pattern: `{Phase}: {short subject}` (e.g. `R5.later-tests: overlay-app.js jsdom scaffolding`). Don't batch — mark each task completed as it lands.

## The four sequenced phases at a glance

| # | Phase | Sizing | Blocking |
|---|---|---|---|
| 1 | **R5.later-tests** | Medium | Nothing blocks it; unblocks the other three |
| 2 | **R5.later-perf** | Small-medium | Needs R5.later-tests; unblocks R5.later-c + R5.later-cache |
| 3 | **R5.later-c** | Medium | Needs R5.later-perf findings on image-family hydration cost |
| 4 | **R5.later-cache** | Medium-large | Needs all three prior; highest correctness bar |

## Start here: R5.later-tests — overlay-app.js jsdom scaffolding

**Goal:** stand up `tests/visual-editor-overlay-app-state.test.cjs` so panel controllers (currently only live-verified) get deterministic regression coverage. This unblocks R5.later-cache (which cannot safely ship without invariant tests) and reduces the "shipped without regression tests → hotfix" pattern the R5.later-y arc had four instances of (2b entity type, 2c ui.input/setDisabled, 2d group-nested value resolution, R5.later-b modal).

**Coverage targets (from the spec, prioritized):**
1. `createPaletteOverviewController` mount + swatch change → lazy-open + save flow (from R5.later-y-2)
2. `createPaletteBulkPopoverModal` mount + copy-hex + copy-all-as-CSS-variables (from R5.later-b)
3. `handleSave` early-return guard for `input='palette_grid'` (regression guard for R5.later-y-2c bug)
4. `handleOpenControlRequest` event routing (from R5.later-y)
5. `renderEditorPanel` dispatch on `ui.input` for each shipped family (regression guard for the entire R5.later-y-2c class of bug — panel falling through to `'text'` default because `ui.input` isn't set)

**Design decision to make:** overlay-app.js is one ~13,000-line IIFE. Two options for testability — prefer (a):
- **(a)** Load the whole file into a jsdom context. No production surface change. Must confirm jsdom's script loader handles the size + doesn't hit CommonJS-in-a-browser weirdness.
- **(b)** Refactor to expose controllers on `window.DBVCVisualEditorPanelControllers` for test access. Cleaner test API, but adds a production surface just for tests.

**Reference implementations:**
- `tests/visual-editor-brand-control-center-state.test.cjs` — drawer state test file, has the IntersectionObserver polyfill pattern to copy
- `tests/visual-editor-media-manager-state.test.cjs` — has the `DBVCVisualEditorBootstrap` + `DBVCVisualEditorApi` mock pattern to copy

**Acceptable-if-documented limitations:** jsdom stubs focus/scroll/computed-style poorly. Skip layout-dependent scenarios (modal focus trap, visual overlay positioning, `scrollIntoView`) and cover the state/network flow only. Real-browser QA still needed for the visual bits — call this out in the file header.

**Sizing:** medium — one-time scaffolding + per-controller fixtures. Estimate 5-8 tasks.

**When done:** update the four canonical docs (CHANGELOG, HANDOFF boundary, EVIDENCE-LOG new E-134, IMPLEMENTATION-TRACKER row) with the landing summary. Then baselines. Then propose starting R5.later-perf.

## Then, in order

- **R5.later-perf** — R5-REMAINING doc §R5.later-perf has the full spec. Discovery/report slice; produces `docs/dropins/dbvc-visual-editor-brand-controls-guide/qa/R5-LATER-PERF-AUDIT-REPORT.md`; ZERO production code changes. **Must be measured in real foregrounded Chrome, not Claude-in-Chrome automation** (E-123 IO-throttling gotcha).
- **R5.later-c** — inline current-value display; **pinned decisions**: chip MOVES from action to label cell, 1-line ellipsis cap, search-scope stays label+description only. **Conditional dependency**: if R5.later-perf flags image-family hydration as top-3 cost, R5.later-cache must land BEFORE R5.later-c (sequence flips to perf → cache → c).
- **R5.later-cache** — **pinned decisions**: kill-switch default OFF, localStorage + LRU above 4MB, 7 correctness invariants including palette-per-swatch invalidation (R5.later-y-2 currently doesn't fire `panel:saved` — you'll need to add that) + ETag-per-row + cross-tab `storage` listener + capability-change burn.

## Key file locations reference

- Palette controllers + save/copy paths: `addons/visual-editor/assets/js/overlay-app.js` (grep `createPaletteOverviewController`, `openPaletteBulkPopover`)
- Drawer surface: `addons/visual-editor/assets/js/brand-control-center-app.js`
- Vertical provider (both checkouts, byte-identical): `themes/vertical/functions/features/dbvc-visual-editor/includes/class-vf-vertical-control-provider.php`
- List/Open/Save controllers: `addons/visual-editor/src/Rest/Controllers/{ControlCenterListController,ControlCenterOpenController,SaveController}.php`
- Descriptor factory (single-color, text, etc.): `addons/visual-editor/src/Registry/Providers/SharedGlobalsDescriptorFactory.php`
- Panel CSS: `addons/visual-editor/assets/css/overlay.css`; drawer CSS: `addons/visual-editor/assets/css/control-center.css`
- i18n: `addons/visual-editor/src/Assets/AssetLoader.php`

## Environmental gotchas (learned the hard way)

- **Claude-in-Chrome runs backgrounded** by default and throttles IntersectionObserver callbacks (E-123). Any IO-dependent verification must run in real foregrounded Chrome.
- **Claude-in-Chrome viewport is retina-mapped** — a 1440×900 request maps to 1728×958 CSS pixels. Can't genuinely test 1280×720 in an automation session; extrapolate from 1728 results with the geometry math (R5.7-c + R4-D-2 QA reports document this).
- **jsdom stubs layout poorly** — no `scrollIntoView`, `getBoundingClientRect` returns zeros, focus behaviour is limited. Cover state + network flow; leave real-layout to browser QA.
- **LocalWP mysql is faster than production** — perf audit findings need a "translation to production" caveat.

## What NOT to do

- Do not start any phase after R5.later-tests until it lands and its coverage is proven.
- Do not modify `addons/visual-editor/assets/js/overlay-app.js` for new features until R5.later-tests scaffolding is in place (would recreate the "hotfix-after-live-QA" pattern).
- Do not reopen pinned design decisions in the R5-REMAINING doc without explicit maintainer direction.
- Do not add features/refactor/introduce abstractions beyond what the phase spec calls for.

## First action to take

1. Read `docs/dropins/dbvc-visual-editor-brand-controls-guide/releases/R5-REMAINING-UNLOCK-FRONTIERS.md` §R5.later-tests + §Sequencing before R6.
2. Read the head (~40 lines) of `addons/visual-editor/docs/handoffs/DBVC_VISUAL_EDITOR_HANDOFF.md`.
3. Run the three baseline commands above and confirm they're green.
4. Grep `overlay-app.js` for `createPaletteOverviewController` to understand the controller shape you'll be testing.
5. Look at `tests/visual-editor-brand-control-center-state.test.cjs` (top ~200 lines) to understand the jsdom + fetch-mock + IO-polyfill pattern to copy.
6. Draft a plan for the 5 coverage targets, propose it to the maintainer, then start.

Good luck — the arc is in a genuinely clean state and the next four phases are cleanly scoped.
