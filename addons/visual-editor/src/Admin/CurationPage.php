<?php

namespace Dbvc\VisualEditor\Admin;

use Dbvc\VisualEditor\Curation\CurationExporter;
use Dbvc\VisualEditor\Curation\CurationStore;
use Dbvc\VisualEditor\Curation\FieldCandidateProvider;
use Dbvc\VisualEditor\Curation\FieldCurationRecommender;

if (! defined('WPINC')) {
    die;
}

/**
 * R3-BX — Manual Approved Field Selection admin page.
 *
 * Temporary admin surface (kill-switch gated by
 * DBVC_Visual_Editor_Addon::is_curation_tool_enabled) that lists every
 * options-page-owned ACF field discoverable on the site and lets the
 * operator record an include / ignore / defer decision per row. On
 * export, the include set is written to
 * `addons/visual-editor/curation/vertical-approved-controls.json`
 * plus a companion Markdown review sheet.
 *
 * The page never mutates content: it reads ACF field metadata and
 * current option values via `get_field()`, and it writes only to its
 * own dedicated option (`dbvc_visual_editor_curation_decisions`).
 */
final class CurationPage
{
    public const PAGE_SLUG = 'dbvc-visual-editor-curation';
    private const NONCE_ACTION = 'dbvc_visual_editor_curation_action';
    private const NONCE_NAME = 'dbvc_visual_editor_curation_nonce';
    private const AJAX_ACTION_SAVE = 'dbvc_visual_editor_curation_save';
    private const AJAX_ACTION_BULK = 'dbvc_visual_editor_curation_bulk_save';
    private const AJAX_ACTION_EXPORT = 'dbvc_visual_editor_curation_export';
    private const AJAX_ACTION_ADOPT_PRIORITIES = 'dbvc_visual_editor_curation_adopt_priorities';

    /**
     * @return void
     */
    public function register()
    {
        add_action('admin_menu', [$this, 'registerMenu'], 21);
        add_action('admin_enqueue_scripts', [$this, 'enqueueAssets']);
        add_action('wp_ajax_' . self::AJAX_ACTION_SAVE, [$this, 'ajaxSaveDecision']);
        add_action('wp_ajax_' . self::AJAX_ACTION_BULK, [$this, 'ajaxBulkSaveDecisions']);
        add_action('wp_ajax_' . self::AJAX_ACTION_EXPORT, [$this, 'ajaxExport']);
        add_action('wp_ajax_' . self::AJAX_ACTION_ADOPT_PRIORITIES, [$this, 'ajaxAdoptPriorities']);
    }

    /**
     * @return void
     */
    public function registerMenu()
    {
        if (! $this->isEnabled()) {
            return;
        }

        add_submenu_page(
            'dbvc-export',
            __('Brand Control Center — Curation', 'dbvc'),
            __('BCC Curation', 'dbvc'),
            'manage_options',
            self::PAGE_SLUG,
            [$this, 'render']
        );
    }

    /**
     * @param string $hook_suffix
     * @return void
     */
    public function enqueueAssets($hook_suffix)
    {
        if (! is_string($hook_suffix) || strpos($hook_suffix, self::PAGE_SLUG) === false) {
            return;
        }
        if (! $this->isEnabled() || ! current_user_can('manage_options')) {
            return;
        }

        $addon_root = dirname(__DIR__, 2);
        // From src/Admin/CurationPage.php: dirname(__DIR__, 4) = plugin root
        // (Admin → src → visual-editor → addons → db-version-control-main).
        // Anchoring plugins_url() on the addon's own bootstrap.php avoids the
        // brittle "guess the plugin main file name" pattern and gives us the
        // addon directory URL directly.
        $addon_url = plugins_url('', $addon_root . '/bootstrap.php');

        // Version by filemtime so every code change automatically busts the
        // browser cache — matches the AssetLoader pattern used by the rest of
        // the Visual Editor addon. Falls back to a static version if the file
        // is unreadable so a stale link is still emitted rather than none.
        $css_path = $addon_root . '/assets/css/curation.css';
        $js_path = $addon_root . '/assets/js/curation.js';
        $css_ver = is_readable($css_path) ? (string) filemtime($css_path) : '0.1.0';
        $js_ver = is_readable($js_path) ? (string) filemtime($js_path) : '0.1.0';

        wp_enqueue_style(
            'dbvc-visual-editor-curation',
            $addon_url . '/assets/css/curation.css',
            [],
            $css_ver
        );
        wp_enqueue_script(
            'dbvc-visual-editor-curation',
            $addon_url . '/assets/js/curation.js',
            [],
            $js_ver,
            true
        );
        wp_localize_script('dbvc-visual-editor-curation', 'DBVC_VE_CURATION', [
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce(self::NONCE_ACTION),
            'actions' => [
                'save' => self::AJAX_ACTION_SAVE,
                'bulk' => self::AJAX_ACTION_BULK,
                'export' => self::AJAX_ACTION_EXPORT,
                'adopt_priorities' => self::AJAX_ACTION_ADOPT_PRIORITIES,
            ],
            'i18n' => [
                'saving' => __('Saving…', 'dbvc'),
                'saved' => __('Saved', 'dbvc'),
                'error' => __('Save failed', 'dbvc'),
                'exporting' => __('Exporting…', 'dbvc'),
                'exportOk' => __('Export complete', 'dbvc'),
                'exportError' => __('Export failed', 'dbvc'),
                'bulkNoSelection' => __('Select at least one row first.', 'dbvc'),
                'bulkNoAction' => __('Choose a bulk action first.', 'dbvc'),
                'showingAll' => __('Showing all {total} candidates', 'dbvc'),
                'showingCount' => __('Showing {visible} of {total} candidates (filters active)', 'dbvc'),
            ],
        ]);
    }

    /**
     * @return void
     */
    public function render()
    {
        if (! current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to manage Brand Control Center curation.', 'dbvc'));
        }
        if (! $this->isEnabled()) {
            wp_die(esc_html__('The Brand Control Center curation tool is disabled. Enable it from the Visual Editor settings page to continue.', 'dbvc'));
        }

        $provider = new FieldCandidateProvider();
        $recommender = new FieldCurationRecommender();
        $store = new CurationStore();

        $candidates = $provider->getCandidates();
        $decisions = $store->getAll();
        $summary = $store->summarize($candidates);

        // All filtering is client-side (see curation.js). Every candidate row is
        // rendered into the DOM with filterable data-* attributes; the JS filter
        // engine shows/hides via the hidden attribute so filter changes are
        // instant with no page reload and no server round trip. The filter form
        // controls still read initial values from URL params for graceful
        // no-JS fallback, but the server does not pre-filter the row set.
        $filters = $this->readFilters();
        $rows = $this->prepareRows($candidates, $decisions, $recommender);
        $facets = $this->buildFacets($candidates);

        $this->renderPage($rows, $decisions, $recommender, $summary, $facets, $filters);
    }

    /**
     * @return void
     */
    public function ajaxSaveDecision()
    {
        if (! $this->verifyAjax()) {
            return;
        }
        $id = isset($_POST['id']) ? (string) wp_unslash($_POST['id']) : '';
        $decision = isset($_POST['decision']) && is_array($_POST['decision'])
            ? array_map('wp_unslash', $_POST['decision'])
            : [];

        $store = new CurationStore();
        $ok = $store->setDecision($id, $decision);

        wp_send_json([
            'ok' => (bool) $ok,
            'id' => $id,
            'decision' => $store->getDecision($id),
        ]);
    }

    /**
     * @return void
     */
    public function ajaxBulkSaveDecisions()
    {
        if (! $this->verifyAjax()) {
            return;
        }
        $ids = isset($_POST['ids']) && is_array($_POST['ids'])
            ? array_map('wp_unslash', $_POST['ids'])
            : [];
        $partial = isset($_POST['decision']) && is_array($_POST['decision'])
            ? array_map('wp_unslash', $_POST['decision'])
            : [];

        $store = new CurationStore();
        $written = $store->setDecisionsBulk($ids, $partial);

        wp_send_json([
            'ok' => $written > 0 || empty($ids),
            'written' => $written,
        ]);
    }

    /**
     * Bulk "adopt suggested priorities for selected rows" — the client posts
     * a `priorities` map keyed by canonical id whose values are the
     * recommender's per-row suggested tier. We re-derive the suggestions on
     * the server (the client-sent values are guidance only; we never trust
     * client-supplied field values as authoritative) and write them per-id
     * in one option update via {@see CurationStore::setDecisionsPerId}.
     *
     * @return void
     */
    public function ajaxAdoptPriorities()
    {
        if (! $this->verifyAjax()) {
            return;
        }

        $ids_raw = isset($_POST['ids']) && is_array($_POST['ids'])
            ? array_map('wp_unslash', $_POST['ids'])
            : [];
        if (empty($ids_raw)) {
            wp_send_json([
                'ok' => true,
                'written' => 0,
                'skipped' => 0,
                'message' => __('No rows selected.', 'dbvc'),
            ]);
            return;
        }

        // Build canonical id → server-recomputed suggested priority map. Any
        // id whose recommender-declined the suggestion (ignore/defer primary)
        // is silently skipped — nothing to adopt for those.
        $provider = new FieldCandidateProvider();
        $recommender = new FieldCurationRecommender();
        $candidates_by_id = [];
        foreach ($provider->getCandidates() as $c) {
            $candidates_by_id[(string) ($c['id'] ?? '')] = $c;
        }

        $map = [];
        $skipped_no_suggestion = 0;
        $skipped_unknown_id = 0;
        foreach ($ids_raw as $id) {
            $id = (string) $id;
            if (! isset($candidates_by_id[$id])) {
                $skipped_unknown_id++;
                continue;
            }
            $rec = $recommender->recommendPriority($candidates_by_id[$id]);
            $priority = (string) ($rec['priority'] ?? '');
            if ($priority === '') {
                $skipped_no_suggestion++;
                continue;
            }
            $map[$id] = ['client_priority' => $priority];
        }

        $store = new CurationStore();
        $result = $store->setDecisionsPerId($map);

        wp_send_json([
            'ok' => true,
            'written' => (int) ($result['written'] ?? 0),
            'skipped_no_suggestion' => $skipped_no_suggestion,
            'skipped_unknown_id' => $skipped_unknown_id,
        ]);
    }

    /**
     * @return void
     */
    public function ajaxExport()
    {
        if (! $this->verifyAjax()) {
            return;
        }

        $provider = new FieldCandidateProvider();
        $recommender = new FieldCurationRecommender();
        $store = new CurationStore();

        $candidates = $provider->getCandidates();
        $decisions = $store->getAll();

        $export_dir = dirname(__DIR__, 2) . '/curation';
        $exporter = new CurationExporter($export_dir, $recommender);
        $result = $exporter->export($candidates, $decisions, (string) get_bloginfo('name'));

        wp_send_json($result);
    }

    /**
     * @return bool
     */
    private function verifyAjax()
    {
        if (! current_user_can('manage_options')) {
            wp_send_json_error(['message' => 'forbidden'], 403);

            return false;
        }
        $nonce = isset($_POST['nonce']) ? (string) wp_unslash($_POST['nonce']) : '';
        if (! wp_verify_nonce($nonce, self::NONCE_ACTION)) {
            wp_send_json_error(['message' => 'invalid_nonce'], 400);

            return false;
        }

        return true;
    }

    /**
     * @return bool
     */
    private function isEnabled()
    {
        return class_exists('\DBVC_Visual_Editor_Addon')
            && method_exists('\DBVC_Visual_Editor_Addon', 'is_curation_tool_enabled')
            && \DBVC_Visual_Editor_Addon::is_curation_tool_enabled();
    }

    /**
     * @return array<string, string>
     */
    private function readFilters()
    {
        return [
            'options_page' => isset($_GET['options_page']) ? sanitize_key((string) $_GET['options_page']) : '',
            'field_type' => isset($_GET['field_type']) ? sanitize_key((string) $_GET['field_type']) : '',
            'group_key' => isset($_GET['group_key']) ? sanitize_key((string) $_GET['group_key']) : '',
            'decision' => isset($_GET['decision']) ? sanitize_key((string) $_GET['decision']) : '',
            'recommendation' => isset($_GET['recommendation']) ? sanitize_key((string) $_GET['recommendation']) : '',
            'category' => isset($_GET['category']) ? sanitize_text_field((string) $_GET['category']) : '',
            'search' => isset($_GET['search']) ? sanitize_text_field((string) $_GET['search']) : '',
        ];
    }

    /**
     * Build every candidate row (no filtering). Each row carries its recommendation
     * and current decision so the JS filter engine can read them from data-*
     * attributes at filter time without another server round trip.
     *
     * @param array<int, array<string, mixed>>    $candidates
     * @param array<string, array<string, mixed>> $decisions
     * @param FieldCurationRecommender            $recommender
     * @return array<int, array<string, mixed>>
     */
    private function prepareRows(array $candidates, array $decisions, FieldCurationRecommender $recommender)
    {
        $out = [];
        foreach ($candidates as $candidate) {
            $id = (string) $candidate['id'];
            $candidate['_decision'] = isset($decisions[$id]) ? $decisions[$id] : null;
            $candidate['_recommendation'] = $recommender->recommend($candidate);
            $candidate['_priority_rec'] = $recommender->recommendPriority($candidate);
            // R5.later-a.5 — heuristic palette_group_key suggestion:
            // color_picker records nested inside a group whose name
            // contains "palette" auto-default to the parent's slug on
            // export. Surfaced as the input's placeholder + a small
            // "auto: {slug}" hint in the row render.
            $candidate['_palette_group_key_suggested'] = $recommender->deriveSuggestedPaletteGroupKey($candidate);
            $out[] = $candidate;
        }

        return $out;
    }

    /**
     * @param array<int, array<string, mixed>> $candidates
     * @return array<string, array<int, array{value:string,label:string}>>
     */
    private function buildFacets(array $candidates)
    {
        $pages = [];
        $types = [];
        $groups = [];
        foreach ($candidates as $c) {
            $page = (string) $c['options_page'];
            if ($page !== '') {
                $pages[$page] = true;
            }
            $type = (string) $c['field_type'];
            if ($type !== '') {
                $types[$type] = true;
            }
            $group_key = (string) $c['group_key'];
            if ($group_key !== '') {
                $groups[$group_key] = (string) $c['group_title'];
            }
        }

        $to_pairs = static function (array $keys) {
            $pairs = [];
            foreach (array_keys($keys) as $k) {
                $pairs[] = ['value' => (string) $k, 'label' => (string) $k];
            }
            usort($pairs, static function ($a, $b) {
                return strcmp($a['label'], $b['label']);
            });

            return $pairs;
        };

        $group_pairs = [];
        foreach ($groups as $k => $title) {
            $group_pairs[] = ['value' => (string) $k, 'label' => $title !== '' ? $title : $k];
        }
        usort($group_pairs, static function ($a, $b) {
            return strcmp($a['label'], $b['label']);
        });

        return [
            'options_pages' => $to_pairs($pages),
            'field_types' => $to_pairs($types),
            'groups' => $group_pairs,
        ];
    }

    /**
     * @param array<int, array<string, mixed>>    $rows
     * @param array<string, array<string, mixed>> $decisions
     * @param FieldCurationRecommender            $recommender
     * @param array<string, int>                  $summary
     * @param array<string, array<int, array{value:string,label:string}>> $facets
     * @param array<string, string>               $filters
     * @return void
     */
    private function renderPage(array $rows, array $decisions, FieldCurationRecommender $recommender, array $summary, array $facets, array $filters)
    {
        $categories = $recommender->knownCategories();
        ?>
        <div class="wrap dbvc-ve-curation">
            <h1><?php esc_html_e('Brand Control Center — Curation', 'dbvc'); ?></h1>
            <p class="description">
                <?php esc_html_e('Approve which options-page ACF fields become Visual Editor Brand Control Center controls. This page is temporary — turn off the kill switch in Visual Editor settings once the export is committed.', 'dbvc'); ?>
            </p>

            <div class="dbvc-ve-curation__summary">
                <strong><?php echo esc_html(number_format_i18n((int) $summary['total'])); ?></strong>
                <?php esc_html_e('candidates', 'dbvc'); ?> ·
                <?php echo esc_html(number_format_i18n((int) $summary['include'])); ?> <?php esc_html_e('include', 'dbvc'); ?> ·
                <?php echo esc_html(number_format_i18n((int) $summary['ignore'])); ?> <?php esc_html_e('ignore', 'dbvc'); ?> ·
                <?php echo esc_html(number_format_i18n((int) $summary['defer'])); ?> <?php esc_html_e('defer', 'dbvc'); ?> ·
                <?php echo esc_html(number_format_i18n((int) $summary['undecided'])); ?> <?php esc_html_e('undecided', 'dbvc'); ?>
                <button type="button" class="button button-primary" data-dbvc-ve-curation="export" style="margin-left:1em;">
                    <?php esc_html_e('Export curated seed', 'dbvc'); ?>
                </button>
                <span class="dbvc-ve-curation__export-status" data-dbvc-ve-curation="export-status" aria-live="polite"></span>
                <label class="dbvc-ve-curation__toggle" style="margin-left:1em;">
                    <input type="checkbox" data-dbvc-ve-curation="toggle-priority-rec" checked />
                    <?php esc_html_e('Show suggested-priority column', 'dbvc'); ?>
                </label>
            </div>

            <form method="get" action="" class="dbvc-ve-curation__filters" data-dbvc-ve-curation="filter-form">
                <input type="hidden" name="page" value="<?php echo esc_attr(self::PAGE_SLUG); ?>" />
                <label>
                    <?php esc_html_e('Options page', 'dbvc'); ?>
                    <select name="options_page">
                        <option value=""><?php esc_html_e('All', 'dbvc'); ?></option>
                        <?php foreach ($facets['options_pages'] as $pair) : ?>
                            <option value="<?php echo esc_attr($pair['value']); ?>" <?php selected($filters['options_page'], $pair['value']); ?>>
                                <?php echo esc_html($pair['label']); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </label>

                <label>
                    <?php esc_html_e('Field type', 'dbvc'); ?>
                    <select name="field_type">
                        <option value=""><?php esc_html_e('All', 'dbvc'); ?></option>
                        <?php foreach ($facets['field_types'] as $pair) : ?>
                            <option value="<?php echo esc_attr($pair['value']); ?>" <?php selected($filters['field_type'], $pair['value']); ?>>
                                <?php echo esc_html($pair['label']); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </label>

                <label>
                    <?php esc_html_e('Field group', 'dbvc'); ?>
                    <select name="group_key">
                        <option value=""><?php esc_html_e('All', 'dbvc'); ?></option>
                        <?php foreach ($facets['groups'] as $pair) : ?>
                            <option value="<?php echo esc_attr($pair['value']); ?>" <?php selected($filters['group_key'], $pair['value']); ?>>
                                <?php echo esc_html($pair['label']); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </label>

                <label>
                    <?php esc_html_e('Decision', 'dbvc'); ?>
                    <select name="decision">
                        <option value=""><?php esc_html_e('All', 'dbvc'); ?></option>
                        <option value="undecided" <?php selected($filters['decision'], 'undecided'); ?>><?php esc_html_e('Undecided', 'dbvc'); ?></option>
                        <option value="include" <?php selected($filters['decision'], 'include'); ?>><?php esc_html_e('Include', 'dbvc'); ?></option>
                        <option value="ignore" <?php selected($filters['decision'], 'ignore'); ?>><?php esc_html_e('Ignore', 'dbvc'); ?></option>
                        <option value="defer" <?php selected($filters['decision'], 'defer'); ?>><?php esc_html_e('Defer', 'dbvc'); ?></option>
                    </select>
                </label>

                <label>
                    <?php esc_html_e('My recommendation', 'dbvc'); ?>
                    <select name="recommendation">
                        <option value=""><?php esc_html_e('All', 'dbvc'); ?></option>
                        <option value="include" <?php selected($filters['recommendation'], 'include'); ?>><?php esc_html_e('Include', 'dbvc'); ?></option>
                        <option value="ignore" <?php selected($filters['recommendation'], 'ignore'); ?>><?php esc_html_e('Ignore', 'dbvc'); ?></option>
                        <option value="defer" <?php selected($filters['recommendation'], 'defer'); ?>><?php esc_html_e('Defer', 'dbvc'); ?></option>
                        <option value="review" <?php selected($filters['recommendation'], 'review'); ?>><?php esc_html_e('Review', 'dbvc'); ?></option>
                    </select>
                </label>

                <label>
                    <?php esc_html_e('Category', 'dbvc'); ?>
                    <select name="category">
                        <option value=""><?php esc_html_e('All', 'dbvc'); ?></option>
                        <?php foreach ($categories as $category) : ?>
                            <option value="<?php echo esc_attr($category); ?>" <?php selected($filters['category'], $category); ?>>
                                <?php echo esc_html($category); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </label>

                <label>
                    <?php esc_html_e('Label search', 'dbvc'); ?>
                    <input type="search" name="search" value="<?php echo esc_attr($filters['search']); ?>" />
                </label>

                <?php submit_button(__('Apply filters', 'dbvc'), 'secondary', 'submit', false); ?>
                <button type="button" class="button" data-dbvc-ve-curation="filter-reset"><?php esc_html_e('Reset filters', 'dbvc'); ?></button>
            </form>

            <p class="dbvc-ve-curation__filters-status" data-dbvc-ve-curation="filter-count" aria-live="polite"></p>

            <div class="dbvc-ve-curation__bulk" data-dbvc-ve-curation="bulk-bar">
                <label>
                    <?php esc_html_e('Bulk action', 'dbvc'); ?>
                    <select data-dbvc-ve-curation="bulk-action">
                        <option value=""><?php esc_html_e('Choose…', 'dbvc'); ?></option>
                        <option value="decision:include"><?php esc_html_e('Set decision → Include', 'dbvc'); ?></option>
                        <option value="decision:ignore"><?php esc_html_e('Set decision → Ignore', 'dbvc'); ?></option>
                        <option value="decision:defer"><?php esc_html_e('Set decision → Defer', 'dbvc'); ?></option>
                        <option value="decision:"><?php esc_html_e('Clear decision', 'dbvc'); ?></option>
                        <option value="special:adopt_suggested_priorities"><?php esc_html_e('Adopt suggested priorities for selected rows', 'dbvc'); ?></option>
                        <?php foreach ($categories as $category) : ?>
                            <option value="category:<?php echo esc_attr($category); ?>">
                                <?php
                                echo esc_html(sprintf(
                                    /* translators: %s: category name */
                                    __('Set category → %s', 'dbvc'),
                                    $category
                                ));
                                ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </label>
                <button type="button" class="button" data-dbvc-ve-curation="bulk-apply">
                    <?php esc_html_e('Apply to selected', 'dbvc'); ?>
                </button>
                <span class="dbvc-ve-curation__bulk-status" data-dbvc-ve-curation="bulk-status" aria-live="polite"></span>
            </div>

            <div class="dbvc-ve-curation__table-wrap">
            <table class="wp-list-table widefat striped dbvc-ve-curation__table">
                <colgroup>
                    <col style="width:32px" />
                    <col style="width:10%" />
                    <col style="width:12%" />
                    <col style="width:7%" />
                    <col style="width:9%" />
                    <col style="width:10%" />
                    <col style="width:10%" />
                    <col style="width:7%" />
                    <col style="width:8%" />
                    <col style="width:8%" />
                    <col class="dbvc-ve-curation__col-priority-rec" style="width:7%" />
                    <col style="width:8%" />
                    <col style="width:auto" />
                    <col style="width:9%" />
                </colgroup>
                <thead>
                    <tr>
                        <td class="check-column">
                            <input type="checkbox" data-dbvc-ve-curation="select-all" />
                        </td>
                        <th><?php esc_html_e('Label', 'dbvc'); ?></th>
                        <th><?php esc_html_e('Field (name path)', 'dbvc'); ?></th>
                        <th><?php esc_html_e('Type', 'dbvc'); ?></th>
                        <th><?php esc_html_e('Options page', 'dbvc'); ?></th>
                        <th><?php esc_html_e('Current value', 'dbvc'); ?></th>
                        <th><?php esc_html_e('VF context / purpose', 'dbvc'); ?></th>
                        <th><?php esc_html_e('Recommendation', 'dbvc'); ?></th>
                        <th><?php esc_html_e('Category', 'dbvc'); ?></th>
                        <th><?php esc_html_e('Decision', 'dbvc'); ?></th>
                        <th class="dbvc-ve-curation__col-priority-rec"><?php esc_html_e('Suggested priority', 'dbvc'); ?></th>
                        <th><?php esc_html_e('Priority', 'dbvc'); ?></th>
                        <th><?php esc_html_e('Notes', 'dbvc'); ?></th>
                        <th title="<?php esc_attr_e('R5.later-a: sibling color_picker records that share this key fold into one palette parent in the drawer. Leave blank for no grouping. Use lowercase / hyphens / underscores only (e.g. brand_primary, semantic-neutrals). Curator can also set Category or the Group field to control the palette parent’s display label.', 'dbvc'); ?>"><?php esc_html_e('Palette group', 'dbvc'); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($rows)) : ?>
                        <tr><td colspan="14"><?php esc_html_e('No candidates discovered. Confirm the Visual Editor curation tool has ACF options-page groups to walk.', 'dbvc'); ?></td></tr>
                    <?php else : ?>
                        <?php foreach ($rows as $row) : ?>
                            <?php $this->renderRow($row, $categories); ?>
                        <?php endforeach; ?>
                        <tr class="dbvc-ve-curation__no-match-row" data-dbvc-ve-curation="no-match" hidden>
                            <td colspan="14"><?php esc_html_e('No candidates match the current filters.', 'dbvc'); ?></td>
                        </tr>
                    <?php endif; ?>
                </tbody>
            </table>
            </div>
        </div>
        <?php
    }

    /**
     * @param array<string, mixed> $row
     * @param array<int, string>   $categories
     * @return void
     */
    private function renderRow(array $row, array $categories)
    {
        $id = (string) $row['id'];
        $decision = isset($row['_decision']) && is_array($row['_decision']) ? $row['_decision'] : [];
        $recommendation = isset($row['_recommendation']) && is_array($row['_recommendation']) ? $row['_recommendation'] : [];
        $current_value = $this->resolveCurrentValueDisplay($row);
        $vf_context = $this->composeVfContext($row);
        $decision_value = (string) ($decision['decision'] ?? '');
        $decision_bucket = $decision_value !== '' ? $decision_value : 'undecided';
        $category_value = (string) ($decision['category'] ?? ($recommendation['category'] ?? ''));
        $priority_value = (string) ($decision['client_priority'] ?? '');
        $notes_value = (string) ($decision['notes'] ?? '');
        $palette_group_key_value = (string) ($decision['palette_group_key'] ?? '');
        // R5.later-a.5 — the recommender heuristically suggests a palette
        // group slug for color_picker records nested inside a group whose
        // name contains "palette". Surface the suggestion in the row's
        // input placeholder + a small hint so curators see the auto
        // behaviour + can override by typing.
        $palette_group_key_suggested = isset($row['_palette_group_key_suggested'])
            ? (string) $row['_palette_group_key_suggested']
            : '';
        $palette_group_key_using_auto = $palette_group_key_value === '' && $palette_group_key_suggested !== '';
        // R5.later-a.6 — curator-set label override for the palette parent
        // row in the drawer. When empty, the Vertical provider humanises
        // the effective palette_group_key (`vertical_global_palette` →
        // "Vertical Global Palette"). Setting this here overrides that
        // humanised default with the curator's readable text.
        $palette_display_label_value = (string) ($decision['palette_display_label'] ?? '');
        // Compute the humanised default for the placeholder so the curator
        // sees exactly what the parent row will read as if they leave the
        // field blank. Effective key = curator override, else auto-suggest.
        $palette_effective_key = $palette_group_key_value !== '' ? $palette_group_key_value : $palette_group_key_suggested;
        $palette_display_label_default = $palette_effective_key !== ''
            ? $this->humanisePaletteSlugPreview($palette_effective_key)
            : '';
        $rec_value = (string) ($recommendation['recommendation'] ?? 'review');
        $rec_reasoning = (string) ($recommendation['reasoning'] ?? '');
        $priority_rec = isset($row['_priority_rec']) && is_array($row['_priority_rec']) ? $row['_priority_rec'] : [];
        $priority_rec_value = (string) ($priority_rec['priority'] ?? '');
        $priority_rec_reasoning = (string) ($priority_rec['reasoning'] ?? '');
        $search_haystack = strtolower(
            (string) $row['field_label'] . ' '
            . (string) $row['field_name_path'] . ' '
            . (string) $row['group_title']
        );
        ?>
        <tr
            data-id="<?php echo esc_attr($id); ?>"
            class="dbvc-ve-curation__row is-<?php echo esc_attr($decision_bucket); ?>"
            data-options-page="<?php echo esc_attr((string) $row['options_page']); ?>"
            data-field-type="<?php echo esc_attr((string) $row['field_type']); ?>"
            data-group-key="<?php echo esc_attr((string) $row['group_key']); ?>"
            data-decision="<?php echo esc_attr($decision_bucket); ?>"
            data-recommendation="<?php echo esc_attr($rec_value); ?>"
            data-category="<?php echo esc_attr($category_value); ?>"
            data-search="<?php echo esc_attr($search_haystack); ?>"
        >
            <th scope="row" class="check-column">
                <input type="checkbox" data-dbvc-ve-curation="row-select" value="<?php echo esc_attr($id); ?>" />
            </th>
            <td title="<?php echo esc_attr((string) $row['field_label']); ?>"><strong><?php echo esc_html((string) $row['field_label']); ?></strong></td>
            <td title="<?php echo esc_attr((string) $row['field_name_path']); ?>"><code><?php echo esc_html((string) $row['field_name_path']); ?></code></td>
            <td><?php echo esc_html((string) $row['field_type']); ?></td>
            <td><code><?php echo esc_html((string) $row['options_page']); ?></code></td>
            <td class="dbvc-ve-curation__value" title="<?php echo esc_attr($current_value); ?>"><?php echo esc_html($current_value); ?></td>
            <td class="dbvc-ve-curation__context" title="<?php echo esc_attr($vf_context); ?>"><?php echo esc_html($vf_context); ?></td>
            <td class="dbvc-ve-curation__rec">
                <span class="dbvc-ve-curation__chip is-<?php echo esc_attr($rec_value); ?>" title="<?php echo esc_attr($rec_reasoning); ?>">
                    <?php echo esc_html($rec_value); ?>
                </span>
            </td>
            <td>
                <select data-dbvc-ve-curation="field" data-field="category">
                    <option value=""><?php esc_html_e('—', 'dbvc'); ?></option>
                    <?php foreach ($categories as $category) : ?>
                        <option value="<?php echo esc_attr($category); ?>" <?php selected($category_value, $category); ?>>
                            <?php echo esc_html($category); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </td>
            <td>
                <div class="dbvc-ve-curation__radio-group">
                    <label><input type="radio" name="decision-<?php echo esc_attr($id); ?>" value="include" data-dbvc-ve-curation="field" data-field="decision" <?php checked($decision_value, 'include'); ?> /> <?php esc_html_e('Include', 'dbvc'); ?></label>
                    <label><input type="radio" name="decision-<?php echo esc_attr($id); ?>" value="ignore" data-dbvc-ve-curation="field" data-field="decision" <?php checked($decision_value, 'ignore'); ?> /> <?php esc_html_e('Ignore', 'dbvc'); ?></label>
                    <label><input type="radio" name="decision-<?php echo esc_attr($id); ?>" value="defer" data-dbvc-ve-curation="field" data-field="decision" <?php checked($decision_value, 'defer'); ?> /> <?php esc_html_e('Defer', 'dbvc'); ?></label>
                </div>
            </td>
            <td class="dbvc-ve-curation__col-priority-rec">
                <?php if ($priority_rec_value !== '') : ?>
                    <span class="dbvc-ve-curation__chip is-priority-<?php echo esc_attr($priority_rec_value); ?>" title="<?php echo esc_attr($priority_rec_reasoning); ?>">
                        <?php echo esc_html($priority_rec_value); ?>
                    </span>
                    <button type="button" class="button button-small dbvc-ve-curation__adopt-priority" data-dbvc-ve-curation="adopt-priority" data-priority="<?php echo esc_attr($priority_rec_value); ?>" title="<?php esc_attr_e('Adopt the suggested priority for this row', 'dbvc'); ?>">
                        <?php esc_html_e('adopt', 'dbvc'); ?>
                    </button>
                <?php else : ?>
                    <span class="dbvc-ve-curation__chip is-review" title="<?php echo esc_attr($priority_rec_reasoning); ?>">—</span>
                <?php endif; ?>
            </td>
            <td>
                <div class="dbvc-ve-curation__radio-group">
                    <label><input type="radio" name="priority-<?php echo esc_attr($id); ?>" value="" data-dbvc-ve-curation="field" data-field="client_priority" <?php checked($priority_value, ''); ?> /> <?php esc_html_e('None', 'dbvc'); ?></label>
                    <label><input type="radio" name="priority-<?php echo esc_attr($id); ?>" value="must" data-dbvc-ve-curation="field" data-field="client_priority" <?php checked($priority_value, 'must'); ?> /> <?php esc_html_e('Must', 'dbvc'); ?></label>
                    <label><input type="radio" name="priority-<?php echo esc_attr($id); ?>" value="should" data-dbvc-ve-curation="field" data-field="client_priority" <?php checked($priority_value, 'should'); ?> /> <?php esc_html_e('Should', 'dbvc'); ?></label>
                    <label><input type="radio" name="priority-<?php echo esc_attr($id); ?>" value="nice" data-dbvc-ve-curation="field" data-field="client_priority" <?php checked($priority_value, 'nice'); ?> /> <?php esc_html_e('Nice', 'dbvc'); ?></label>
                </div>
            </td>
            <td>
                <textarea rows="2" data-dbvc-ve-curation="field" data-field="notes"><?php echo esc_textarea($notes_value); ?></textarea>
                <span class="dbvc-ve-curation__row-status" data-dbvc-ve-curation="row-status" aria-live="polite"></span>
            </td>
            <td>
                <input
                    type="text"
                    class="dbvc-ve-curation__palette-key<?php echo $palette_group_key_using_auto ? ' is-auto' : ''; ?>"
                    data-dbvc-ve-curation="field"
                    data-field="palette_group_key"
                    value="<?php echo esc_attr($palette_group_key_value); ?>"
                    placeholder="<?php echo esc_attr($palette_group_key_suggested !== '' ? $palette_group_key_suggested : __('e.g. brand_primary', 'dbvc')); ?>"
                    maxlength="40"
                    autocomplete="off"
                    spellcheck="false"
                    aria-label="<?php esc_attr_e('Palette group key (R5.later-a)', 'dbvc'); ?>"
                />
                <?php if ($palette_group_key_using_auto) : ?>
                    <span class="dbvc-ve-curation__palette-key-hint" title="<?php esc_attr_e('R5.later-a.5: this color_picker sits inside a group whose name contains "palette". The exporter auto-defaults palette_group_key to the parent group slug so the drawer folds all sibling colors under one palette parent. Type an override to opt out of this auto-behaviour.', 'dbvc'); ?>">
                        <?php
                        /* translators: %s: auto-suggested palette group slug */
                        printf(esc_html__('auto: %s', 'dbvc'), esc_html($palette_group_key_suggested));
                        ?>
                    </span>
                <?php endif; ?>
                <input
                    type="text"
                    class="dbvc-ve-curation__palette-label"
                    data-dbvc-ve-curation="field"
                    data-field="palette_display_label"
                    value="<?php echo esc_attr($palette_display_label_value); ?>"
                    placeholder="<?php echo esc_attr($palette_display_label_default !== '' ? $palette_display_label_default : __('Palette label override (optional)', 'dbvc')); ?>"
                    maxlength="60"
                    autocomplete="off"
                    spellcheck="false"
                    aria-label="<?php esc_attr_e('Palette display label override (R5.later-a.6)', 'dbvc'); ?>"
                    title="<?php esc_attr_e('R5.later-a.6: override the palette parent’s drawer label. Empty falls back to the humanised palette group key (shown as placeholder). Set on any one child in the palette group — the first non-empty value wins.', 'dbvc'); ?>"
                />
            </td>
        </tr>
        <?php
    }

    /**
     * @param array<string, mixed> $row
     * @return string
     */
    private function resolveCurrentValueDisplay(array $row)
    {
        if (! function_exists('get_field')) {
            return '';
        }
        $selector = (string) ($row['field_key'] !== '' ? $row['field_key'] : $row['field_name']);
        $value = get_field($selector, 'option');

        if ($value === null || $value === false) {
            return '';
        }
        if (is_bool($value)) {
            return $value ? __('Yes', 'dbvc') : __('No', 'dbvc');
        }
        if (is_array($value)) {
            if (isset($value['url'])) {
                return (string) $value['url'];
            }
            if (isset($value['filename'])) {
                return (string) $value['filename'];
            }
            $count = count($value);

            return sprintf(_n('%d item', '%d items', $count, 'dbvc'), $count);
        }
        if (is_object($value)) {
            if (isset($value->post_title)) {
                return (string) $value->post_title;
            }
            if (isset($value->name)) {
                return (string) $value->name;
            }

            return get_class($value);
        }
        $string = (string) $value;
        if (strlen($string) > 80) {
            return substr($string, 0, 77) . '…';
        }

        return $string;
    }

    /**
     * @param array<string, mixed> $row
     * @return string
     */
    private function composeVfContext(array $row)
    {
        $parts = [];
        if (! empty($row['group_title'])) {
            $parts[] = (string) $row['group_title'];
        }
        if (! empty($row['ancestor_labels']) && is_array($row['ancestor_labels'])) {
            foreach ($row['ancestor_labels'] as $label) {
                $label = (string) $label;
                if ($label !== '') {
                    $parts[] = $label;
                }
            }
        }
        if (! empty($row['field_instructions'])) {
            $parts[] = (string) $row['field_instructions'];
        }

        return implode(' › ', $parts);
    }

    /**
     * R5.later-a.6 — humanise a palette group slug for the label-override
     * input's placeholder so the curator sees exactly what the drawer's
     * palette parent will read as when the override field is left blank.
     * Mirrors the Vertical provider's `humanizePaletteGroupKey()` shape:
     * split on `_`/`-`, title-case each segment, join with spaces.
     *
     * @param string $slug
     * @return string
     */
    private function humanisePaletteSlugPreview($slug)
    {
        $slug = (string) $slug;
        if ($slug === '') {
            return '';
        }
        $parts = preg_split('/[_\-]+/', $slug);
        if (! is_array($parts)) {
            return ucfirst($slug);
        }
        $words = [];
        foreach ($parts as $part) {
            if ($part === '') {
                continue;
            }
            $words[] = ucfirst(strtolower($part));
        }
        return implode(' ', $words);
    }
}
