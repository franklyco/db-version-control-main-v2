<?php

namespace Dbvc\VisualEditor\Registry\Providers;

use Dbvc\VisualEditor\Permissions\CapabilityManager;
use Dbvc\VisualEditor\Registry\ControlProvider;
use Dbvc\VisualEditor\Registry\ControlRecord;
use Dbvc\VisualEditor\Registry\EditableDescriptor;

/**
 * R3-B — Shared Globals compatibility provider.
 *
 * Adapts the existing `SharedGlobalFieldsController` field-enumeration path
 * onto the R3-A {@see \Dbvc\VisualEditor\Registry\ControlRegistry} as a
 * discovery-only surface. Each configured ACF options field name resolves to
 * one {@see \Dbvc\VisualEditor\Registry\ControlRecord} the Brand Control
 * Center list can render without minting an authoritative descriptor. The
 * existing Shared Globals toolbar popover keeps working exactly as it does
 * today — this provider is parallel, not a replacement.
 *
 * The provider carries no write authority. Descriptor minting and the actual
 * save path continue to route through
 * `SharedGlobalFieldsController::buildDescriptor` and the shared
 * `MutationService` pipeline (R3-C wires the open-time descriptor factory).
 *
 * Two callable seams keep this class testable without loading ACF:
 * - `$namesResolver` returns the configured Shared Globals field-name list
 *   (production: `\DBVC_Visual_Editor_Addon::get_shared_global_field_names`).
 * - `$fieldObjectResolver` returns the raw ACF field-object array for one
 *   name (production: `get_field_object($name, 'option', false, true)`), or
 *   `null`/`false` when ACF is unavailable or the name does not resolve.
 */
final class SharedGlobalsControlProvider implements ControlProvider
{
    public const PROVIDER_ID = 'shared_globals';

    /**
     * @var CapabilityManager
     */
    private $capabilities;

    /**
     * @var callable():array<int, string>
     */
    private $namesResolver;

    /**
     * @var callable(string):(array<string, mixed>|null|false)
     */
    private $fieldObjectResolver;

    /**
     * @var SharedGlobalsDescriptorFactory
     */
    private $descriptorFactory;

    /**
     * R4-A — resolves the raw stored value of one options-page ACF field
     * (relationship / post_object) so {@see buildValueSummary} can compute
     * the drawer's right-side chip without calling `get_field` directly (test
     * seam). Production wires an ACF-backed closure in
     * {@see \Dbvc\VisualEditor\Bootstrap\Addon}. May return array, scalar,
     * object, null, or false.
     *
     * @var callable(string):mixed
     */
    private $optionValueResolver;

    /**
     * @param CapabilityManager                                       $capabilities
     * @param callable():array<int, string>                           $namesResolver
     * @param callable(string):(array<string, mixed>|null|false)      $fieldObjectResolver
     * @param callable(string):mixed|null                             $optionValueResolver R4-A;
     *          Optional — defaults to a resolver that returns `null` so the
     *          registry ships the record without a summary chip until
     *          production wires an ACF-backed closure. Kept optional to
     *          preserve backwards-compatibility with R3-B call sites and tests.
     */
    public function __construct(
        CapabilityManager $capabilities,
        callable $namesResolver,
        callable $fieldObjectResolver,
        ?callable $optionValueResolver = null
    ) {
        $this->capabilities = $capabilities;
        $this->namesResolver = $namesResolver;
        $this->fieldObjectResolver = $fieldObjectResolver;
        $this->optionValueResolver = $optionValueResolver ?? static function ($fieldName) {
            return null;
        };
        $this->descriptorFactory = new SharedGlobalsDescriptorFactory();
    }

    /**
     * @return string
     */
    public function getProviderId()
    {
        return self::PROVIDER_ID;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getControls()
    {
        $names = call_user_func($this->namesResolver);
        if (! is_array($names) || empty($names)) {
            return [];
        }

        $capabilities = $this->capabilities;
        $records = [];
        $seen = [];

        foreach ($names as $configured_name) {
            $configured_name = sanitize_key((string) $configured_name);
            if ($configured_name === '' || isset($seen[$configured_name])) {
                continue;
            }

            $field = call_user_func($this->fieldObjectResolver, $configured_name);
            if (! is_array($field)) {
                continue;
            }

            $field_name = isset($field['name']) ? sanitize_key((string) $field['name']) : '';
            if ($field_name === '' || $field_name !== $configured_name) {
                continue;
            }

            // R3-B originally accepted only relationship + post_object;
            // R5.1-a widens the whitelist to the AcfTextResolver families
            // (text / textarea / url / email / number). ControlRecord's
            // fieldFamily whitelist collapses everything text-shaped down
            // to `'text'` so the drawer treats them uniformly for filter
            // + chip render.
            $field_type = isset($field['type']) ? sanitize_key((string) $field['type']) : '';
            if (! in_array($field_type, self::supportedFieldTypes(), true)) {
                continue;
            }
            $field_family = self::mapFieldFamily($field_type);

            $field_key = isset($field['key']) ? sanitize_key((string) $field['key']) : '';
            $label = isset($field['label']) && is_scalar($field['label'])
                ? sanitize_text_field((string) $field['label'])
                : $field_name;
            $group_title = $this->resolveFieldGroupTitle($field);

            $seen[$configured_name] = true;

            // R4-A: description sourced from (in order):
            //   1) `dbvc_visual_editor_control_center_description` filter — the
            //      Vertical bridge hooks this to inject
            //      `vf_field_context_get_entry_primary_purpose()`. Filter
            //      receives the default + a small context bag so hooks can
            //      differentiate by provider / field / family.
            //   2) ACF's own `instructions` on the field object (fail-safe
            //      when no filter runs — surfaces the sitewide field-editor
            //      instructions on the drawer's muted second line).
            //   3) Empty — the drawer collapses the description slot when
            //      the value is empty (mockup DESIGN-DECISIONS §4).
            $default_description = isset($field['instructions']) && is_scalar($field['instructions'])
                ? sanitize_text_field((string) $field['instructions'])
                : '';
            $description = (string) apply_filters(
                'dbvc_visual_editor_control_center_description',
                $default_description,
                [
                    'providerId' => self::PROVIDER_ID,
                    'fieldName' => $field_name,
                    'fieldKey' => $field_key,
                    'fieldType' => $field_type,
                    'label' => $label,
                ]
            );

            // R4-A sortKey — `shared_{fieldName}` puts Shared Globals ahead
            // of other providers (e.g. `vertical_*`) under the R3-A registry's
            // stable `sortKey` ascending sort, and keeps per-field ordering
            // stable across restarts.
            $sort_key = sanitize_key('shared_' . $field_name);

            $records[] = [
                'id' => $field_name,
                'label' => $label,
                'description' => $description,
                'category' => 'globals',
                'group' => $group_title,
                'ownerType' => 'option',
                'ownerSubtype' => 'acf_options',
                'fieldFamily' => $field_family,
                'status' => 'available',
                'sortKey' => $sort_key,
                'source' => [
                    'field_name' => $field_name,
                    'field_key' => $field_key,
                ],
                'meta' => [
                    'badge' => __('Shared Global', 'dbvc'),
                ],
                'visibleTo' => static function () use ($capabilities) {
                    $probe = new EditableDescriptor(
                        've_shared_global_capability_probe',
                        'editable',
                        'shared_entity',
                        [
                            'type' => 'option',
                            'id' => 0,
                            'subtype' => 'acf_options',
                            'acf_object_id' => 'option',
                        ],
                        [],
                        [],
                        [],
                        []
                    );

                    return $capabilities->canEditDescriptor($probe);
                },
            ];
        }

        return $records;
    }

    /**
     * R3-C-1 — mint the authoritative Shared Globals descriptor at open time.
     *
     * Re-resolves the ACF field via the constructor's `$fieldObjectResolver`
     * seam (so stale records fail closed cleanly), re-validates that the type
     * is still `relationship`/`post_object` (a maintainer may have converted
     * the field between list and open), then delegates to the shared
     * {@see SharedGlobalsDescriptorFactory} so the descriptor is byte-identical
     * to what the existing Shared Globals popover route mints for the same
     * field. Returns null on any structural miss — the caller
     * ({@see \Dbvc\VisualEditor\Rest\Controllers\ControlCenterOpenController})
     * translates that into a fail-closed 404.
     *
     * @param ControlRecord        $record
     * @param string               $sessionId
     * @param array<string, mixed> $pageContext
     * @return EditableDescriptor|null
     */
    public function buildDescriptor(ControlRecord $record, $sessionId, array $pageContext)
    {
        $field_name = isset($record->source['field_name']) ? sanitize_key((string) $record->source['field_name']) : '';
        if ($field_name === '') {
            return null;
        }

        $field = call_user_func($this->fieldObjectResolver, $field_name);
        if (! is_array($field)) {
            return null;
        }

        $resolved_name = isset($field['name']) ? sanitize_key((string) $field['name']) : '';
        if ($resolved_name === '' || $resolved_name !== $field_name) {
            return null;
        }

        $field_type = isset($field['type']) ? sanitize_key((string) $field['type']) : '';
        if (! in_array($field_type, ['relationship', 'post_object'], true)) {
            return null;
        }

        return $this->descriptorFactory->build((string) $sessionId, $pageContext, $field);
    }

    /**
     * R4-A — mint a per-family value summary for the drawer's right-side
     * chip. Currently supports `relationship` + `post_object` (the two
     * families the R3-B provider emits as `status="available"`) and shapes
     * the summary as:
     *
     *   {
     *       family:      "relationship" | "post_object",
     *       count:       int,           // total related items on the option
     *       firstTitles: string[],      // up to 3, sanitize_text_field
     *       hasMore:     bool,          // count > firstTitles.length
     *   }
     *
     * Fails closed to `null` when:
     * - The record no longer resolves via the field-object resolver seam
     *   (mirrors {@see buildDescriptor}).
     * - The field type is no longer relationship / post_object.
     * - The current user fails the same option-owned capability probe the
     *   record's `visibleTo` uses (R4 mockup DESIGN-DECISIONS §5's
     *   "recheck capability against the owner").
     * - The stored option value is empty or contains no valid post ids.
     *
     * @param ControlRecord $record
     * @param string        $sessionId  Unused for Shared Globals — options
     *                                   are session-agnostic — but kept as a
     *                                   parameter to satisfy the interface.
     * @return array<string, mixed>|null
     */
    public function buildValueSummary(ControlRecord $record, $sessionId)
    {
        unset($sessionId);

        $field_name = isset($record->source['field_name']) ? sanitize_key((string) $record->source['field_name']) : '';
        if ($field_name === '') {
            return null;
        }

        $field = call_user_func($this->fieldObjectResolver, $field_name);
        if (! is_array($field)) {
            return null;
        }

        $resolved_name = isset($field['name']) ? sanitize_key((string) $field['name']) : '';
        if ($resolved_name === '' || $resolved_name !== $field_name) {
            return null;
        }

        $field_type = isset($field['type']) ? sanitize_key((string) $field['type']) : '';
        if (! in_array($field_type, self::supportedFieldTypes(), true)) {
            return null;
        }

        // Recheck capability against the same options-owned probe descriptor
        // the visibility closure uses at list-time. This closes the "list
        // included, but stored value snuck out via the summary endpoint"
        // window that DESIGN-DECISIONS §5 calls out.
        $probe = new EditableDescriptor(
            've_shared_global_capability_probe',
            'editable',
            'shared_entity',
            [
                'type' => 'option',
                'id' => 0,
                'subtype' => 'acf_options',
                'acf_object_id' => 'option',
            ],
            [],
            [],
            [],
            []
        );
        if (! $this->capabilities->canEditDescriptor($probe)) {
            return null;
        }

        $value = call_user_func($this->optionValueResolver, $field_name);

        // R5.1-a: text-family summary. Family is normalized to `'text'` (the
        // drawer's ControlRecord fieldFamily whitelist collapses all
        // text-shaped types onto the same bucket). Preview is capped at 32
        // characters — matches R4 mockup §5. Empty / non-string values
        // collapse to null so the drawer renders no chip.
        if (in_array($field_type, ['text', 'textarea', 'url', 'email', 'number'], true)) {
            return self::buildTextSummary($value);
        }

        // R5.2-a: choice summary — single-select fields collapse to
        // `{family:'choice', label}`; multi-select checkbox fields collapse
        // to `{family:'choice', count, firstLabels:[<=3]}` for parity with
        // the relationship shape. The chip renderer branches on
        // `firstLabels` presence.
        if (in_array($field_type, ['select', 'radio', 'button_group'], true)) {
            return self::buildSingleChoiceSummary($value, $field);
        }
        if ($field_type === 'checkbox') {
            return self::buildMultiChoiceSummary($value, $field);
        }

        // R5.2-a: link summary — ACF's link field stores
        // `{url, title, target}`. Prefer the human title; fall back to the
        // URL host; empty → null.
        if ($field_type === 'link') {
            return self::buildLinkSummary($value);
        }

        // R5.2-b: wysiwyg summary — strip HTML, collapse whitespace,
        // truncate at 40 chars, count words. Empty → null.
        if ($field_type === 'wysiwyg') {
            return self::buildWysiwygSummary($value);
        }

        // R5.3: image summary — resolve the attachment id from whatever
        // shape ACF returned, then look up filename + thumb URL via WP's
        // attachment helpers.
        if ($field_type === 'image') {
            return self::buildImageSummary($value);
        }

        // R5.2+color_picker: color summary — validate the stored hex /
        // rgb(a) shape and return `{family:'color', hex}` for the swatch
        // chip. Invalid / empty → null.
        if ($field_type === 'color_picker') {
            return self::buildColorSummary($value);
        }

        // true_false: boolean summary — coerce whatever ACF returned onto
        // a real bool via AcfTrueFalseResolver::coerceToBool, then
        // return `{family:'boolean', value, label}` for the on/off pill.
        if ($field_type === 'true_false') {
            return self::buildBooleanSummary($value);
        }

        // Relationship / post_object (R4-A path). Delegates to the
        // R5.4-added public static helper so Vertical rows can reuse the
        // exact same shape via the same source of truth.
        return self::buildReferenceSummary($value, $field_type);
    }

    /**
     * R5.4 — relationship / post_object summary shape:
     * `{family, count, firstTitles:[≤3], hasMore}`.
     * Coerces whatever ACF's `get_field(..., false)` returned into a flat
     * list of positive post ids, then resolves the first three via
     * `get_the_title`. Empty / unresolvable → null so the drawer renders
     * no chip.
     *
     * Public + static so the Vertical cross-repo provider can produce the
     * exact same shape for its 2 curated post_object/relationship
     * records without duplicating the coercion + title walk. Family is a
     * caller-passed argument so relationship and post_object can be
     * routed to the same walker while preserving distinct chip labels.
     *
     * @param mixed  $value
     * @param string $family Either `'relationship'` or `'post_object'`.
     * @return array<string, mixed>|null
     */
    public static function buildReferenceSummary($value, $family)
    {
        $family = sanitize_key((string) $family);
        if (! in_array($family, ['relationship', 'post_object'], true)) {
            return null;
        }
        $ids = self::normalizeToPostIdsList($value);
        if (empty($ids)) {
            return null;
        }
        $limit = 3;
        $preview_ids = array_slice($ids, 0, $limit);
        $titles = [];
        foreach ($preview_ids as $post_id) {
            $post_id = (int) $post_id;
            if ($post_id <= 0) {
                continue;
            }
            if (! function_exists('get_the_title')) {
                continue;
            }
            $title = get_the_title($post_id);
            if (! is_string($title) || $title === '') {
                continue;
            }
            $titles[] = sanitize_text_field($title);
        }
        if (empty($titles)) {
            return null;
        }

        return [
            'family' => $family,
            'count' => count($ids),
            'firstTitles' => $titles,
            'hasMore' => count($ids) > count($titles),
        ];
    }

    /**
     * R5.4 — static twin of the instance {@see normalizeToPostIds} so
     * {@see buildReferenceSummary} stays fully static. Behavior is
     * identical.
     *
     * @param mixed $value
     * @return array<int, int>
     */
    private static function normalizeToPostIdsList($value)
    {
        if ($value === null || $value === false || $value === '') {
            return [];
        }
        if (is_scalar($value)) {
            $id = self::coerceOnePostIdValue($value);
            return $id > 0 ? [$id] : [];
        }
        if (is_object($value)) {
            $id = self::coerceOnePostIdValue($value);
            return $id > 0 ? [$id] : [];
        }
        if (! is_array($value)) {
            return [];
        }
        // ACF associative-array `[ID => 123, …]` single-post_object shape.
        if (isset($value['ID']) || isset($value['id'])) {
            $id = self::coerceOnePostIdValue($value);
            return $id > 0 ? [$id] : [];
        }
        $ids = [];
        foreach ($value as $entry) {
            $id = self::coerceOnePostIdValue($entry);
            if ($id > 0) {
                $ids[] = $id;
            }
        }
        return $ids;
    }

    /**
     * R5.4 — static twin of {@see coerceOnePostId}.
     *
     * @param mixed $item
     * @return int
     */
    private static function coerceOnePostIdValue($item)
    {
        if (is_int($item)) {
            return $item > 0 ? $item : 0;
        }
        if (is_string($item) && ctype_digit($item)) {
            return (int) $item;
        }
        if (is_array($item)) {
            foreach (['ID', 'id'] as $key) {
                if (isset($item[$key]) && is_scalar($item[$key])) {
                    $inner = $item[$key];
                    if (is_int($inner) && $inner > 0) {
                        return $inner;
                    }
                    if (is_string($inner) && ctype_digit($inner) && (int) $inner > 0) {
                        return (int) $inner;
                    }
                }
            }
        }
        if (is_object($item) && isset($item->ID) && is_int($item->ID) && $item->ID > 0) {
            return $item->ID;
        }
        return 0;
    }

    /**
     * R4-A — coerce whatever `get_field($name, 'option', ...)` returned into
     * a flat list of positive post ids. Accepts ints, numeric strings,
     * WP_Post objects, ACF's associative-array shape (`['ID' => 123, …]`),
     * or a single scalar (post_object). Anything that does not resolve is
     * dropped rather than throwing.
     *
     * @param mixed $value
     * @return array<int, int>
     */
    private function normalizeToPostIds($value)
    {
        if ($value === null || $value === false || $value === '') {
            return [];
        }

        if (! is_array($value)) {
            $id = $this->coerceOnePostId($value);

            return $id > 0 ? [$id] : [];
        }

        $ids = [];
        foreach ($value as $item) {
            $id = $this->coerceOnePostId($item);
            if ($id > 0) {
                $ids[] = $id;
            }
        }

        return array_values($ids);
    }

    /**
     * @param mixed $item
     * @return int
     */
    private function coerceOnePostId($item)
    {
        if (is_object($item) && isset($item->ID) && is_numeric($item->ID)) {
            return (int) $item->ID;
        }
        if (is_array($item) && isset($item['ID']) && is_numeric($item['ID'])) {
            return (int) $item['ID'];
        }
        if (is_numeric($item)) {
            return (int) $item;
        }

        return 0;
    }

    /**
     * Walk the ACF field's parent chain to find its containing field group,
     * then return the group's human title. Mirrors
     * `SharedGlobalFieldsController::resolveFieldGroupKey` +
     * `resolveFieldGroupContext` so the record's `group` display value is
     * consistent with the existing Shared Globals popover UI. Returns an
     * empty string when ACF is unavailable or the group cannot be resolved.
     *
     * @param array<string, mixed> $field
     * @return string
     */
    private function resolveFieldGroupTitle(array $field)
    {
        $group_key = $this->resolveFieldGroupKey($field);
        if ($group_key === '' || ! function_exists('acf_get_field_group')) {
            return '';
        }

        $group = acf_get_field_group($group_key);
        if (! is_array($group) || empty($group['title'])) {
            return '';
        }

        return sanitize_text_field((string) $group['title']);
    }

    /**
     * @param array<string, mixed> $field
     * @return string
     */
    private function resolveFieldGroupKey(array $field)
    {
        $parent = isset($field['parent']) ? sanitize_key((string) $field['parent']) : '';
        $seen = [];

        while ($parent !== '' && empty($seen[$parent])) {
            $seen[$parent] = true;

            if (strpos($parent, 'group_') === 0) {
                return $parent;
            }

            if (! function_exists('acf_get_field')) {
                break;
            }

            $parent_field = acf_get_field($parent);
            if (! is_array($parent_field) || empty($parent_field['parent'])) {
                break;
            }

            $parent = sanitize_key((string) $parent_field['parent']);
        }

        return '';
    }

    /**
     * R5.1-a — ACF field types eligible for Brand Control Center listing.
     * The set is the union of R3-B's relationship + post_object (delegates
     * to SharedGlobalsDescriptorFactory's reference-collection path) and
     * R5.1's text-family (delegates to the factory's shared_field path,
     * which routes through AcfTextResolver).
     *
     * @return array<int, string>
     */
    public static function supportedFieldTypes()
    {
        return [
            // R3-B: reference-collection families.
            'relationship',
            'post_object',
            // R5.1-a: AcfTextResolver families.
            'text',
            'textarea',
            'url',
            'email',
            'number',
            // R5.2-a: AcfChoiceResolver families (delegates to
            // createSelectController or createCheckboxGroupController on the
            // panel side depending on ui.input) + AcfLinkResolver.
            'select',
            'checkbox',
            'radio',
            'button_group',
            'link',
            // R5.2-b: AcfWysiwygResolver — routes to createRichTextController.
            'wysiwyg',
            // R5.3: AcfImageResolver — routes to createMediaReferenceController.
            'image',
            // R5.2+color_picker: AcfColorPickerResolver — routes to a
            // native `<input type="color">` via createInputController.
            'color_picker',
            // true_false: AcfTrueFalseResolver — routes to
            // createBooleanController (checkbox + label).
            'true_false',
        ];
    }

    /**
     * R5.1-a — collapse a raw ACF field type onto the drawer's
     * `fieldFamily` whitelist (ControlRecord::fromArray enforces
     * `['text','image','gallery','relationship','post_object','other']`).
     * text / textarea / url / email / number all fold to `'text'` so the
     * drawer filter + chip render treat them as one family.
     *
     * @param string $field_type
     * @return string
     */
    public static function mapFieldFamily($field_type)
    {
        if ($field_type === 'relationship' || $field_type === 'post_object') {
            return $field_type;
        }
        if (in_array($field_type, ['text', 'textarea', 'url', 'email', 'number'], true)) {
            return 'text';
        }
        // R5.3: image maps to ControlRecord's `'image'` bucket (whitelist
        // whitelists it explicitly) so the drawer's Field family chip picks
        // it out.
        if ($field_type === 'image') {
            return 'image';
        }
        // R5.2: choice / link / wysiwyg families fall into ControlRecord's
        // 'other' bucket — the whitelist there is `[text|image|gallery|
        // relationship|post_object|other]` and does not include a
        // per-choice-family slot. Drawer filter shows them under "Other".
        return 'other';
    }

    /**
     * R5.1-a — text-family summary shape: `{family, preview, charCount, truncated}`.
     * Preview capped at 32 chars per mockup COMPONENT-NOTES §3. Empty /
     * non-scalar values return null so the drawer renders no chip.
     * Exposed as a public static so the Vertical provider can reuse
     * exactly the same shape without duplicating the truncation logic.
     *
     * @param mixed $value
     * @return array<string, mixed>|null
     */
    public static function buildTextSummary($value)
    {
        if (! is_scalar($value)) {
            return null;
        }
        $string = trim((string) $value);
        if ($string === '') {
            return null;
        }
        $string = sanitize_text_field($string);
        $length = function_exists('mb_strlen') ? mb_strlen($string, 'UTF-8') : strlen($string);
        $preview_limit = 32;
        $truncated = $length > $preview_limit;
        $preview = $truncated
            ? (function_exists('mb_substr') ? mb_substr($string, 0, $preview_limit, 'UTF-8') : substr($string, 0, $preview_limit))
            : $string;

        return [
            'family' => 'text',
            'preview' => $preview,
            'charCount' => $length,
            'truncated' => $truncated,
        ];
    }

    /**
     * R5.2-a — single-choice summary: `{family:'choice', label}`. Resolves
     * the stored value against the ACF field's `choices` map so the chip
     * shows the human label rather than the raw key. Unknown values fall
     * through to the raw string (with sanitize_text_field). Empty → null.
     *
     * @param mixed                $value
     * @param array<string, mixed> $field ACF field object (for choices).
     * @return array<string, mixed>|null
     */
    public static function buildSingleChoiceSummary($value, array $field)
    {
        if (! is_scalar($value) || (string) $value === '') {
            return null;
        }
        $raw = (string) $value;
        $choices = isset($field['choices']) && is_array($field['choices']) ? $field['choices'] : [];
        $label = isset($choices[$raw]) && is_scalar($choices[$raw]) && (string) $choices[$raw] !== ''
            ? sanitize_text_field((string) $choices[$raw])
            : sanitize_text_field($raw);

        return [
            'family' => 'choice',
            'label' => $label,
        ];
    }

    /**
     * R5.2-a — multi-choice (checkbox) summary:
     * `{family:'choice', count, firstLabels:[≤3], hasMore}`. Mirrors the
     * relationship shape so the chip renderer can reuse the "N connected /
     * first-3 hover" pattern. Empty array → null.
     *
     * @param mixed                $value
     * @param array<string, mixed> $field ACF field object (for choices).
     * @return array<string, mixed>|null
     */
    public static function buildMultiChoiceSummary($value, array $field)
    {
        if (! is_array($value) || empty($value)) {
            return null;
        }
        $choices = isset($field['choices']) && is_array($field['choices']) ? $field['choices'] : [];
        $selected_count = 0;
        $labels = [];
        foreach ($value as $entry) {
            if (! is_scalar($entry) || (string) $entry === '') {
                continue;
            }
            $key = (string) $entry;
            $selected_count++;
            if (count($labels) >= 3) {
                continue;
            }
            $label = isset($choices[$key]) && is_scalar($choices[$key]) && (string) $choices[$key] !== ''
                ? sanitize_text_field((string) $choices[$key])
                : sanitize_text_field($key);
            $labels[] = $label;
        }
        if ($selected_count === 0) {
            return null;
        }

        return [
            'family' => 'choice',
            'count' => $selected_count,
            'firstLabels' => $labels,
            'hasMore' => $selected_count > count($labels),
        ];
    }

    /**
     * R5.2-a — link summary: `{family:'link', title, url}`. ACF stores
     * link fields as `{url, title, target}`. Missing title falls back to
     * the URL's host (or the full URL if host parsing fails). Missing url
     * → null.
     *
     * @param mixed $value
     * @return array<string, mixed>|null
     */
    public static function buildLinkSummary($value)
    {
        if (! is_array($value)) {
            return null;
        }
        $url = isset($value['url']) && is_scalar($value['url']) ? trim((string) $value['url']) : '';
        if ($url === '') {
            return null;
        }
        $safe_url = esc_url_raw($url);
        if ($safe_url === '') {
            return null;
        }
        $title_raw = isset($value['title']) && is_scalar($value['title']) ? trim((string) $value['title']) : '';
        $title = $title_raw !== '' ? sanitize_text_field($title_raw) : '';
        if ($title === '') {
            $host = wp_parse_url($safe_url, PHP_URL_HOST);
            $title = is_string($host) && $host !== '' ? sanitize_text_field($host) : sanitize_text_field($safe_url);
        }
        return [
            'family' => 'link',
            'title' => $title,
            'url' => $safe_url,
        ];
    }

    /**
     * R5.2-b — wysiwyg summary:
     * `{family:'wysiwyg', preview:stripped_text_at_40_chars, wordCount, truncated}`.
     * Strips HTML via `wp_strip_all_tags`, collapses runs of whitespace,
     * counts words on the stripped result (mockup COMPONENT-NOTES §3).
     * Empty / non-scalar values → null.
     *
     * @param mixed $value
     * @return array<string, mixed>|null
     */
    public static function buildWysiwygSummary($value)
    {
        if (! is_scalar($value)) {
            return null;
        }
        $string = (string) $value;
        $stripped = function_exists('wp_strip_all_tags') ? wp_strip_all_tags($string) : strip_tags($string);
        $stripped = trim((string) preg_replace('/\s+/', ' ', (string) $stripped));
        if ($stripped === '') {
            return null;
        }
        $stripped = sanitize_text_field($stripped);
        $length = function_exists('mb_strlen') ? mb_strlen($stripped, 'UTF-8') : strlen($stripped);
        $preview_limit = 40;
        $truncated = $length > $preview_limit;
        $preview = $truncated
            ? (function_exists('mb_substr') ? mb_substr($stripped, 0, $preview_limit, 'UTF-8') : substr($stripped, 0, $preview_limit))
            : $stripped;
        $word_count = $stripped === '' ? 0 : preg_match_all('/\S+/', $stripped);

        return [
            'family' => 'wysiwyg',
            'preview' => $preview,
            'wordCount' => (int) $word_count,
            'truncated' => $truncated,
        ];
    }

    /**
     * R5.3 — image summary shape:
     * `{family:'image', attachmentId, filename, thumbUrl}`.
     * ACF's image field returns the value in one of three shapes depending
     * on how the field is configured: bare attachment id (int / numeric
     * string), a WP_Post-shaped associative array with `ID`, or a nested
     * array with `id`/`url`/`filename` keys the frontend passes through.
     * We collapse all three onto an integer attachment id, then hit
     * `wp_get_attachment_image_src` for the thumbnail URL and
     * `wp_get_attachment_metadata` for the canonical filename. Empty /
     * unresolvable → null so the drawer renders no chip.
     *
     * @param mixed $value
     * @return array<string, mixed>|null
     */
    public static function buildImageSummary($value)
    {
        $attachment_id = self::coerceAttachmentId($value);
        if ($attachment_id <= 0) {
            return null;
        }
        if (! function_exists('get_post') || ! get_post($attachment_id)) {
            return null;
        }

        $thumb_url = '';
        if (function_exists('wp_get_attachment_image_src')) {
            $src = wp_get_attachment_image_src($attachment_id, 'thumbnail');
            if (is_array($src) && ! empty($src[0]) && is_string($src[0])) {
                $thumb_url = esc_url_raw((string) $src[0]);
            }
        }

        $filename = '';
        if (function_exists('get_attached_file')) {
            $path = get_attached_file($attachment_id);
            if (is_string($path) && $path !== '') {
                $filename = basename($path);
            }
        }
        if ($filename === '' && function_exists('wp_get_attachment_metadata')) {
            $meta = wp_get_attachment_metadata($attachment_id);
            if (is_array($meta) && ! empty($meta['file']) && is_string($meta['file'])) {
                $filename = basename((string) $meta['file']);
            }
        }
        $filename = sanitize_text_field((string) $filename);

        return [
            'family' => 'image',
            'attachmentId' => $attachment_id,
            'filename' => $filename,
            'thumbUrl' => $thumb_url,
        ];
    }

    /**
     * R5.2+color_picker — color summary: `{family:'color', hex}`.
     * ACF's color_picker field stores values as scalar strings — the
     * native `<input type="color">` returns `#rrggbb`; ACF may also emit
     * `#rgb`, `#rrggbbaa`, or `rgb(a)(...)` shapes depending on how the
     * field is configured. We accept any of those and normalize hex to
     * lowercase 7-char form for chip render consistency. Empty /
     * non-scalar / unrecognized shape → null.
     *
     * @param mixed $value
     * @return array<string, mixed>|null
     */
    public static function buildColorSummary($value)
    {
        if (! is_scalar($value)) {
            return null;
        }
        $string = trim((string) $value);
        if ($string === '') {
            return null;
        }
        if (preg_match('/^#([0-9a-f]{6})$/i', $string, $m)) {
            return ['family' => 'color', 'hex' => '#' . strtolower($m[1])];
        }
        if (preg_match('/^#([0-9a-f]{3})$/i', $string, $m)) {
            $c = strtolower($m[1]);
            $expanded = $c[0] . $c[0] . $c[1] . $c[1] . $c[2] . $c[2];
            return ['family' => 'color', 'hex' => '#' . $expanded];
        }
        if (preg_match('/^#([0-9a-f]{8})$/i', $string, $m)) {
            return ['family' => 'color', 'hex' => '#' . strtolower($m[1])];
        }
        if (preg_match('/^rgba?\(/i', $string)) {
            return ['family' => 'color', 'hex' => sanitize_text_field($string)];
        }
        return null;
    }

    /**
     * true_false — boolean summary: `{family:'boolean', value, label}`.
     * Coerces whatever ACF returned via
     * {@see \Dbvc\VisualEditor\Resolvers\AcfTrueFalseResolver::coerceToBool}
     * so getDisplayValue + summary + factory all agree on truthy shape.
     * `null` result is never returned — a boolean field always has a
     * summary (either On or Off) as long as the record is resolvable.
     *
     * @param mixed $value
     * @return array<string, mixed>
     */
    public static function buildBooleanSummary($value)
    {
        $bool = \Dbvc\VisualEditor\Resolvers\AcfTrueFalseResolver::coerceToBool($value);
        return [
            'family' => 'boolean',
            'value' => $bool,
            'label' => $bool
                ? __('On', 'dbvc')
                : __('Off', 'dbvc'),
        ];
    }

    /**
     * R5.3 — coerce ACF image value shapes onto a positive integer
     * attachment id. Silent-drops non-resolvable values.
     *
     * @param mixed $value
     * @return int
     */
    private static function coerceAttachmentId($value)
    {
        if (is_int($value)) {
            return $value > 0 ? $value : 0;
        }
        if (is_string($value) && ctype_digit($value)) {
            return (int) $value;
        }
        if (is_array($value)) {
            foreach (['ID', 'id', 'attachmentId'] as $key) {
                if (isset($value[$key])) {
                    $inner = $value[$key];
                    if (is_int($inner) && $inner > 0) {
                        return $inner;
                    }
                    if (is_string($inner) && ctype_digit($inner) && (int) $inner > 0) {
                        return (int) $inner;
                    }
                }
            }
        }
        if (is_object($value) && isset($value->ID) && is_int($value->ID) && $value->ID > 0) {
            return $value->ID;
        }
        return 0;
    }
}
