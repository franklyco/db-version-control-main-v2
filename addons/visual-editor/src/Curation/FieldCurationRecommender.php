<?php

namespace Dbvc\VisualEditor\Curation;

/**
 * R3-BX — Recommendation rule set for the curation admin page.
 *
 * Given one {@see FieldCandidateProvider} record, returns the
 * suggested `decision` (include / ignore / defer / review), a
 * suggested `category` bucket (Brand / Contact / Content / Design /
 * Layout Elements / Legal / SEO), and a short `reasoning` string
 * for the tooltip. The recommender never persists — it only advises;
 * {@see CurationStore} holds the human decision.
 *
 * Rules are keyword-based on purpose: the maintainer can eyeball the
 * source and adjust the lists without re-plumbing anything. The
 * `unlocks_at` computation lives here too so the exporter's
 * "R5 sequencing payoff" summary stays in one place.
 */
final class FieldCurationRecommender
{
    /**
     * Operational options pages — every field on these pages defaults
     * to `ignore` regardless of label keywords. Curation is meant to
     * expose Global / Site-wide brand controls, not integrations/ops.
     *
     * @var array<int, string>
     */
    private const OPERATIONAL_PAGES = ['integrations-settings', 'admin-settings'];

    /**
     * @var array<string, array<int, string>>
     */
    private const INCLUDE_KEYWORDS = [
        'Brand' => [
            'logo', 'brand', 'color', 'palette', 'tagline', 'favicon',
            'mission', 'bio', 'trust_signal', 'partner_logo',
        ],
        'Contact' => [
            'business_name', 'phone', 'email', 'sms', 'fax',
            'address', 'hours', 'availability', 'office_manager',
            'directions',
        ],
        'Content' => [
            'banner', 'popup', 'announcement', 'cta', 'button',
            'custom_title_', 'custom_name_', 'verbiage', 'welcome_message',
        ],
        'Design' => [
            'preset', 'style_master', 'layout_', 'components_',
            'interaction_', 'card_enable', 'border_', 'radius',
            'spacing', 'surface', 'corner',
        ],
        'Legal' => [
            'privacy', 'tos_', 'tou_', 'policy', 'disclaimer',
            'terms_of', 'refund', 'cancellation',
        ],
        'SEO' => [
            'knowledge_graph', 'social_default', 'social_og', 'social_profiles',
            'entity_name', 'social_default_image', 'social_default_title',
        ],
        'Layout Elements' => [
            'nav_', 'header_', 'footer_', 'mega_menu', 'mm_',
            'menu_', 'fullscreen_', 'hero_', 'archive_', 'page_options',
        ],
    ];

    /**
     * @var array<int, string>
     */
    private const IGNORE_KEYWORDS = [
        'analytics', 'gtm', 'ga4_', 'meta_pixel', 'facebook_pixel',
        'verify_', 'webhook', 'api_key', 'api_secret',
        'sitemap_', 'robots_', 'noindex', 'nofollow', 'canonical_',
        'bulk_regenerate', 'bulk_confirm', 'debug_', 'dev_tools',
        'writer_prompt', 'writer_tone', 'scheduler_',
        'code_injection', 'chat_widget', 'integration_',
        'client_code', 'requires_attention',
    ];

    /**
     * Field types that no R5 slice can serve yet — recommend `defer`
     * until either a repeater strategy lands (R5+) or the family is
     * added to a specific R5 slice.
     *
     * @var array<int, string>
     */
    private const DEFERRED_FAMILIES = [
        'repeater', 'flexible_content', 'clone',
        'google_map', 'oembed', 'file',
    ];

    /**
     * @var array<string, string>
     */
    private const FAMILY_UNLOCK_MAP = [
        'text' => 'R5.1',
        'textarea' => 'R5.1',
        'url' => 'R5.1',
        'email' => 'R5.1',
        'number' => 'R5.1',
        'range' => 'R5.1',
        'password' => 'R5.1',
        'time_picker' => 'R5.1',
        'date_picker' => 'R5.1',
        'date_time_picker' => 'R5.1',
        'checkbox' => 'R5.2',
        'select' => 'R5.2',
        'radio' => 'R5.2',
        'button_group' => 'R5.2',
        'true_false' => 'R5.2',
        'link' => 'R5.2',
        'wysiwyg' => 'R5.2',
        'color_picker' => 'R5.2+color_picker',
        'font-awesome' => 'R5.2+font_awesome',
        'image' => 'R5.3',
        'gallery' => 'R5.3',
        'post_object' => 'R5.4',
        'relationship' => 'R5.4',
        'taxonomy' => 'R5.4',
        'user' => 'R5.4',
        // ACF `group` fields are containers and never appear as candidate rows
        // (see FieldCandidateProvider::walkFields — groups are recursed into,
        // not emitted). The entry is intentionally absent from this map.
        'repeater' => 'repeater-later',
        'flexible_content' => 'repeater-later',
        'clone' => 'repeater-later',
        'google_map' => 'later',
        'oembed' => 'later',
        'file' => 'later',
        // R5.later (Path B, 2026-09-03): Vertical's `vf_palette` custom ACF
        // field type is a per-taxonomy-term color grid whose native ACF UI
        // (rendered at Settings → Site Settings Advanced via the standard
        // vf_palette input) already offers a full color-picker-per-term
        // editor. Adding drawer support would duplicate the existing admin
        // functionality without adding real workflow value; marking as
        // permanently out-of-scope for the drawer per the R5.later Path B
        // recommendation in `docs/dropins/dbvc-visual-editor-brand-controls-guide/releases/R5-REMAINING-UNLOCK-FRONTIERS.md`.
        // The `never` sentinel flows through resolveStatus's default
        // "unrecognized unlocks_at → unsupported" path unchanged; no
        // provider-side code changes needed.
        'vf_palette' => 'never',
    ];

    /**
     * @param array<string, mixed> $candidate
     * @return array{recommendation:string,category:string,reasoning:string,unlocks_at:string}
     */
    public function recommend(array $candidate)
    {
        $options_page = isset($candidate['options_page']) ? (string) $candidate['options_page'] : '';
        $field_type = isset($candidate['field_type']) ? (string) $candidate['field_type'] : '';
        $field_name_path = isset($candidate['field_name_path']) ? (string) $candidate['field_name_path'] : '';
        $field_label = isset($candidate['field_label']) ? (string) $candidate['field_label'] : '';
        $is_repeater_family = ! empty($candidate['is_repeater_family']);

        $needle_source = strtolower($field_name_path . ' ' . $field_label);
        $unlocks_at = $this->deriveUnlocksAt($field_type);

        if ($is_repeater_family || in_array($field_type, self::DEFERRED_FAMILIES, true)) {
            return [
                'recommendation' => 'defer',
                'category' => 'Content',
                'reasoning' => sprintf(
                    /* translators: %s: ACF field family */
                    __('Field type "%s" is deferred: repeater/flexible/clone families and a few others (google_map, oembed, file) do not yet have R5 support.', 'dbvc'),
                    $field_type
                ),
                'unlocks_at' => $unlocks_at,
            ];
        }

        if (in_array($options_page, self::OPERATIONAL_PAGES, true)) {
            return [
                'recommendation' => 'ignore',
                'category' => '',
                'reasoning' => sprintf(
                    /* translators: %s: options-page slug */
                    __('Options page "%s" holds operational settings (integrations, admin). Not intended for the Brand Control Center.', 'dbvc'),
                    $options_page
                ),
                'unlocks_at' => $unlocks_at,
            ];
        }

        foreach (self::IGNORE_KEYWORDS as $keyword) {
            if (strpos($needle_source, strtolower($keyword)) !== false) {
                return [
                    'recommendation' => 'ignore',
                    'category' => '',
                    'reasoning' => sprintf(
                        /* translators: %s: matched keyword */
                        __('Matched operational keyword "%s" — appears to be an ops/dev control rather than a client-facing brand setting.', 'dbvc'),
                        $keyword
                    ),
                    'unlocks_at' => $unlocks_at,
                ];
            }
        }

        foreach (self::INCLUDE_KEYWORDS as $category => $keywords) {
            foreach ($keywords as $keyword) {
                if (strpos($needle_source, strtolower($keyword)) !== false) {
                    return [
                        'recommendation' => 'include',
                        'category' => $category,
                        'reasoning' => sprintf(
                            /* translators: 1: category name, 2: matched keyword */
                            __('Matched "%1$s" keyword "%2$s" — likely client-facing.', 'dbvc'),
                            $category,
                            $keyword
                        ),
                        'unlocks_at' => $unlocks_at,
                    ];
                }
            }
        }

        return [
            'recommendation' => 'review',
            'category' => '',
            'reasoning' => __('No keyword match. Review manually and decide include / ignore / defer.', 'dbvc'),
            'unlocks_at' => $unlocks_at,
        ];
    }

    /**
     * Priority-tier keyword rules. Order matters within each tier: the first
     * matching tier wins. `must` runs before `should`, `should` before `nice`.
     * Matched against the lowercased `field_name_path + field_label + options_page`
     * so tab / group / owner-page context can inform the tier (e.g. anything on
     * `advanced-settings` under `vertical_global_palette` is a brand-critical color).
     */
    private const MUST_KEYWORDS = [
        // Identity-critical brand assets every client edits day-one.
        'main_logo', 'logo_mark', 'favicon',
        'business_name', 'brand_name',
        'tagline', 'phone_number_primary', 'email_primary',
        'address_primary', 'office_manager',
        // The six core Vertical brand palette slots — the visual identity anchors.
        'colorprimary', 'colorsecondary', 'colordark', 'colorlight',
        'coloraccent', 'colorneutral',
    ];

    private const SHOULD_KEYWORDS = [
        // Common brand + content edits most clients touch eventually.
        'bio', 'mission', 'trust_signal',
        'footer_logo', 'brand_content', 'brand_verbiage',
        'phone_number_secondary', 'email_secondary', 'sms',
        'policy', 'disclaimer', 'terms', 'privacy', 'refund', 'cancellation',
        'banner', 'announcement',
        'cta', 'button_1', 'button_2', 'custom_secondary_cta',
        'social_default', 'social_profiles', 'knowledge_graph',
        'partner_logo', 'partner_logos',
        'hours', 'availability',
        'nav_header', 'header_', 'footer_',
        'popup', 'exitpopup',
        'default_posts', 'default_terms',
        'custom_title_', 'custom_name_',
        // Non-core Vertical palette slots — visually meaningful but less identity-critical.
        'colorheading', 'colortext', 'colortextlink', 'colorbodybg',
        'colorbutton', 'colorborder', 'colorsuccess', 'colorempha',
        'colorneutralalt', 'colortransbg',
    ];

    private const NICE_KEYWORDS = [
        // Advanced / stylistic / occasional-touch controls.
        'preset', 'style_master', 'layout_', 'components_',
        'interaction_', 'border_', 'radius', 'spacing', 'surface', 'corner',
        'textures', 'filters', 'bg_noise', 'effects',
        'enable_effects', 'card_enable', 'card_options',
        'breadcrumbs', 'archive_', 'floating_menu', 'float_navs',
        'mega_menu', 'mm_', 'fullscreen_',
        'schema_', 'sitemap_ui', 'seo_local',
    ];

    /**
     * Recommend a priority tier for a candidate. Returns an empty priority when
     * the recommender declined to recommend (e.g. the candidate itself is being
     * recommended to ignore or defer — priority only makes sense for candidates
     * that could become approved controls).
     *
     * @param array<string, mixed> $candidate
     * @return array{priority:string,reasoning:string}
     */
    public function recommendPriority(array $candidate)
    {
        $decision = $this->recommend($candidate);
        $primary = (string) ($decision['recommendation'] ?? 'review');

        // Priority only makes sense for candidates that could become approved.
        // A field the recommender is already asking you to ignore or defer has
        // no meaningful priority to suggest.
        if ($primary === 'ignore' || $primary === 'defer') {
            return [
                'priority' => '',
                'reasoning' => __('No priority recommendation — the recommender suggests ignore/defer for this field.', 'dbvc'),
            ];
        }

        $needle = strtolower(
            (string) ($candidate['field_name_path'] ?? '') . ' '
            . (string) ($candidate['field_label'] ?? '') . ' '
            . (string) ($candidate['options_page'] ?? '')
        );

        foreach (self::MUST_KEYWORDS as $keyword) {
            if (strpos($needle, strtolower($keyword)) !== false) {
                return [
                    'priority' => 'must',
                    'reasoning' => sprintf(
                        /* translators: %s: matched keyword */
                        __('Matched must-tier keyword "%s" — identity-critical, every client edits this early.', 'dbvc'),
                        $keyword
                    ),
                ];
            }
        }

        foreach (self::SHOULD_KEYWORDS as $keyword) {
            if (strpos($needle, strtolower($keyword)) !== false) {
                return [
                    'priority' => 'should',
                    'reasoning' => sprintf(
                        /* translators: %s: matched keyword */
                        __('Matched should-tier keyword "%s" — common brand/content edit most clients touch eventually.', 'dbvc'),
                        $keyword
                    ),
                ];
            }
        }

        foreach (self::NICE_KEYWORDS as $keyword) {
            if (strpos($needle, strtolower($keyword)) !== false) {
                return [
                    'priority' => 'nice',
                    'reasoning' => sprintf(
                        /* translators: %s: matched keyword */
                        __('Matched nice-tier keyword "%s" — advanced/stylistic control, occasional edits.', 'dbvc'),
                        $keyword
                    ),
                ];
            }
        }

        // Default when nothing matches — safe middle. The maintainer's
        // annotation guidance is "when in doubt, `should`."
        return [
            'priority' => 'should',
            'reasoning' => __('No keyword match — default to should (safe middle per the annotation guidance).', 'dbvc'),
        ];
    }

    /**
     * @param string $field_type
     * @return string
     */
    public function deriveUnlocksAt($field_type)
    {
        $type = (string) $field_type;

        return isset(self::FAMILY_UNLOCK_MAP[$type]) ? self::FAMILY_UNLOCK_MAP[$type] : 'later';
    }

    /**
     * R5.later-a.5 — derive a suggested `palette_group_key` for a candidate
     * based on its ACF parent context. Heuristic:
     *
     *   - The field's `field_type` must be `color_picker`
     *     (palette grouping is brand-color-only in MVP per R5.later-a's
     *     Vertical provider `countPaletteMembers` gate).
     *   - The immediate parent segment in `field_name_path` (2nd-to-last
     *     when split on `>`) must contain the case-insensitive substring
     *     `palette`. This picks up the Vertical Global Palette's
     *     `brand_color_palette>vertical_global_palette>colorXxx` shape
     *     automatically without a per-row curator toggle.
     *
     * When the heuristic fires, the returned value is
     * `sanitize_key($parent_segment)` — the same slug shape the store's
     * `palette_group_key` field enforces. Zero suggestion (empty string)
     * for any candidate that fails the heuristic; the curator can always
     * override by explicitly setting `palette_group_key` in the store
     * (curator value wins in `CurationExporter::export`).
     *
     * @param array<string, mixed> $candidate
     * @return string
     */
    public function deriveSuggestedPaletteGroupKey(array $candidate)
    {
        $field_type = isset($candidate['field_type']) ? (string) $candidate['field_type'] : '';
        if ($field_type !== 'color_picker') {
            return '';
        }
        $path = isset($candidate['field_name_path']) ? (string) $candidate['field_name_path'] : '';
        if ($path === '' || strpos($path, '>') === false) {
            return '';
        }
        $segments = explode('>', $path);
        // Immediate parent = segment before the leaf (the leaf itself is
        // the last segment).
        $parent_segment = isset($segments[count($segments) - 2])
            ? (string) $segments[count($segments) - 2]
            : '';
        if ($parent_segment === '') {
            return '';
        }
        if (stripos($parent_segment, 'palette') === false) {
            return '';
        }

        return sanitize_key($parent_segment);
    }

    /**
     * @return array<int, string>
     */
    public function knownCategories()
    {
        return array_keys(self::INCLUDE_KEYWORDS);
    }
}
