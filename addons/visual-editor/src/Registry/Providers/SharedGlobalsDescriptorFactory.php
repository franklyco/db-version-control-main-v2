<?php

namespace Dbvc\VisualEditor\Registry\Providers;

use Dbvc\VisualEditor\Registry\EditableDescriptor;

/**
 * R3-C-1 — stateless descriptor factory for Shared Globals ACF fields.
 *
 * Extracted verbatim from `SharedGlobalFieldsController::buildDescriptor` +
 * its private helpers so that both the existing toolbar popover route and
 * the new Brand Control Center open route can mint identical descriptors
 * from the same ACF field object. This is a lift, not a redesign — the
 * behavior is byte-for-byte identical to the pre-extraction inline code
 * so the popover's public route response cannot regress (D-063 keeps the
 * popover parallel and intact).
 *
 * Stateless — the factory holds no per-request state. Callers instantiate
 * once and reuse; nothing here is capability-gated (callers are
 * responsible for capability checks) and nothing writes.
 */
final class SharedGlobalsDescriptorFactory
{
    /**
     * @param string               $session_id
     * @param array<string, mixed> $page_context
     * @param array<string, mixed> $field ACF field-object array (from
     *                                     `get_field_object($name, 'option', false, true)`
     *                                     or the provider's field-object resolver seam).
     * @return EditableDescriptor
     */
    public function build($session_id, array $page_context, array $field)
    {
        $field_name = sanitize_key((string) ($field['name'] ?? ''));
        $field_key = sanitize_key((string) ($field['key'] ?? ''));
        $field_type = sanitize_key((string) ($field['type'] ?? ''));

        // R5.1-a / R5.2 — each per-family branch mints a `shared_field`
        // descriptor whose resolver + ui.input + additional source hints
        // differ per family. All go through the shared
        // `buildSharedFieldDescriptor` helper with a per-family config bag
        // so the group-nesting logic (walkGroupChain) + option-page
        // metadata + entity shape stay in one place. Relationship +
        // post_object continue below on the R3-C-1 path — its shape is
        // asserted byte-identical against the popover route.
        //
        // R5.1-a: AcfTextResolver — text / textarea / url / email / number.
        if (in_array($field_type, ['text', 'textarea', 'url', 'email', 'number'], true)) {
            return $this->buildSharedFieldDescriptor(
                $session_id,
                $page_context,
                $field,
                $field_name,
                $field_key,
                $field_type,
                [
                    'resolver' => 'acf_text',
                    'input' => $field_type === 'textarea' ? 'textarea' : 'text',
                    'source_context' => 'toolbar_shared_global_option_field',
                ]
            );
        }

        // R5.2-a: AcfChoiceResolver — select / checkbox / radio / button_group.
        // The panel side picks the controller by `ui.input`:
        // `checkbox_group` for multi-select checkboxes, `select` for the
        // other three (radio + button_group both render as a dropdown
        // today — good-enough MVP; a per-type controller can arrive if
        // real-browser QA shows a mismatch).
        if (in_array($field_type, ['select', 'checkbox', 'radio', 'button_group'], true)) {
            return $this->buildSharedFieldDescriptor(
                $session_id,
                $page_context,
                $field,
                $field_name,
                $field_key,
                $field_type,
                [
                    'resolver' => 'acf_choice',
                    'input' => $field_type === 'checkbox' ? 'checkbox_group' : 'select',
                    'source_context' => 'toolbar_shared_global_option_choice',
                    'ui_options' => $this->projectAcfChoices($field),
                ]
            );
        }

        // R5.2-a: AcfLinkResolver — ACF's link field (URL + title + target).
        if ($field_type === 'link') {
            return $this->buildSharedFieldDescriptor(
                $session_id,
                $page_context,
                $field,
                $field_name,
                $field_key,
                $field_type,
                [
                    'resolver' => 'acf_link',
                    'input' => 'link',
                    'source_context' => 'toolbar_shared_global_option_link',
                ]
            );
        }

        // R5.2-b: AcfWysiwygResolver — ACF wysiwyg field. Panel renders
        // via `createRichTextController` (TinyMCE lazy-load).
        if ($field_type === 'wysiwyg') {
            return $this->buildSharedFieldDescriptor(
                $session_id,
                $page_context,
                $field,
                $field_name,
                $field_key,
                $field_type,
                [
                    'resolver' => 'acf_wysiwyg',
                    'input' => 'richtext',
                    'source_context' => 'toolbar_shared_global_option_wysiwyg',
                ]
            );
        }

        // R5.3: AcfImageResolver — ACF image field. Panel renders via
        // `createMediaReferenceController` (uses the same `wp.media` frame
        // factory the Media Manager owns). Group-nested writes inherit
        // from R5.1-b `walkGroupChain()` — AbstractAcfResolver's
        // `writeGroupedFieldValue` handles group-subfield attachment-id
        // persistence per the RK-013 pattern.
        if ($field_type === 'image') {
            return $this->buildSharedFieldDescriptor(
                $session_id,
                $page_context,
                $field,
                $field_name,
                $field_key,
                $field_type,
                [
                    'resolver' => 'acf_image',
                    'input' => 'media_reference',
                    'source_context' => 'toolbar_shared_global_option_image',
                ]
            );
        }

        // R5.2+color_picker: AcfColorPickerResolver — ACF color_picker
        // field. Panel renders via `createInputController('color', value)`
        // which produces a native `<input type="color">` — no new panel
        // controller needed. Group-nesting inherits from R5.1-b.
        if ($field_type === 'color_picker') {
            return $this->buildSharedFieldDescriptor(
                $session_id,
                $page_context,
                $field,
                $field_name,
                $field_key,
                $field_type,
                [
                    'resolver' => 'acf_color_picker',
                    'input' => 'color',
                    'source_context' => 'toolbar_shared_global_option_color',
                ]
            );
        }

        // true_false: AcfTrueFalseResolver — ACF true_false field. Panel
        // renders via `createBooleanController` (checkbox + label).
        // Group-nesting inherits from R5.1-b.
        if ($field_type === 'true_false') {
            return $this->buildSharedFieldDescriptor(
                $session_id,
                $page_context,
                $field,
                $field_name,
                $field_key,
                $field_type,
                [
                    'resolver' => 'acf_true_false',
                    'input' => 'true_false',
                    'source_context' => 'toolbar_shared_global_option_boolean',
                ]
            );
        }

        $field_label = isset($field['label']) && is_scalar($field['label'])
            ? sanitize_text_field((string) $field['label'])
            : $field_name;
        $post_types = $this->filterPostTypes($this->normalizePostTypes(isset($field['post_type']) ? $field['post_type'] : []));
        if (empty($post_types)) {
            $post_types = $this->getDefaultReferencePostTypes();
        }
        $field_group = $this->resolveFieldGroupContext($field);
        $option_page_slug = ! empty($field_group['option_pages']) ? (string) reset($field_group['option_pages']) : '';
        $option_page_label = $this->resolveOptionPageLabel($option_page_slug);
        $selected_ids = function_exists('get_field')
            ? $this->normalizeReferenceIds(get_field($field_name, 'option', false))
            : [];
        $is_multiple = $field_type === 'relationship' || ! empty($field['multiple']);
        $token = $this->createToolbarToken($session_id, $field_name, $field_key);
        $contract = $field_type === 'relationship'
            ? 'shared_relationship_collection'
            : 'shared_post_object_collection';

        // Nested reference-collection support: walk the ACF parent chain
        // the same way `buildSharedFieldDescriptor` does for R5.1-b
        // text-family. When the leaf is nested inside one or more Group
        // fields, we set `source.field_selector` to the ROOT group name
        // so `AcfReferenceCollectionResolver::writeCollectionValue()` →
        // `writeAcfValue()` → `writeGroupedFieldValue()` routes the save
        // THROUGH the parent group's `update_value` (Media Manager R2-F
        // RK-013 pattern). Top-level relationship fields see an empty
        // chain and fall through to the R3-C-1 shape unchanged.
        //
        // Callers that supply a repeater-nested leaf are the caller's
        // responsibility to gate (Vertical does this in resolveStatus by
        // rejecting non-group intermediates). If a repeater-nested leaf
        // reaches this branch, the descriptor structure is correct but
        // the actual save may fall back to update_field on the leaf key,
        // which for repeater subfields writes to the wrong meta key.
        $group_chain = $this->walkGroupChain($field);
        $is_grouped_ref = ! empty($group_chain);
        $root_ref_field_name = $is_grouped_ref ? (string) $group_chain[0]['name'] : $field_name;
        $root_ref_field_key = $is_grouped_ref ? (string) $group_chain[0]['key'] : $field_key;
        $ref_group_write_path = $is_grouped_ref ? array_slice($group_chain, 1) : [];

        return new EditableDescriptor(
            $token,
            'editable',
            'shared_entity',
            [
                'type' => 'option',
                'id' => 0,
                'subtype' => 'acf_options',
                'acf_object_id' => 'option',
                'option_page_slug' => $option_page_slug,
                'option_page_label' => $option_page_label,
            ],
            [
                'context' => 'query_collection',
                'attribute' => 'toolbar_shared_global',
                'element_id' => 'toolbar-shared-global-' . $field_name,
                'display_key' => 'default',
                'sync_group' => 'option:' . $field_name,
                'source_group' => 'option:' . $field_name,
            ],
            array_merge(
                [
                    'type' => 'acf_collection_field',
                    'source_context' => 'toolbar_shared_global_option',
                    'field_name' => $field_name,
                    // Nested reference: `field_selector` points at the
                    // ROOT group so getFieldIdentifier() (used by the
                    // resolver's non-grouped fallback) targets the parent
                    // group's own update_value pipeline. Top-level: this
                    // still equals `$field_name`.
                    'field_selector' => $root_ref_field_name,
                    'field_selector_raw' => $root_ref_field_name,
                    'field_key' => $field_key,
                    'leaf_field_name' => $field_name,
                    'leaf_field_key' => $field_key,
                    'field_type' => $field_type,
                    'field_group_key' => isset($field_group['key']) ? sanitize_key((string) $field_group['key']) : '',
                    'field_group_title' => isset($field_group['title']) ? sanitize_text_field((string) $field_group['title']) : '',
                    'field_group_option_pages' => isset($field_group['option_pages']) && is_array($field_group['option_pages']) ? $field_group['option_pages'] : [],
                    'reference_post_types' => $post_types,
                    'reference_multiple' => $is_multiple,
                    'reference_min' => $this->resolveReferenceMin($field),
                    'reference_max' => $this->resolveReferenceMax($field, $is_multiple),
                    'query_collection_write_mode' => 'replace_full_collection',
                    'query_result_ids' => $selected_ids,
                    'query_full_value_ids' => $selected_ids,
                    'query_preserved_ids' => [],
                    'query_result_empty' => empty($selected_ids),
                ],
                // Only emit the group-nesting keys when the chain is
                // actually non-empty — preserves R3-C-1's byte-identical
                // top-level relationship descriptor shape.
                $is_grouped_ref
                    ? [
                        'group_write_path' => $ref_group_write_path,
                        'is_grouped_field' => true,
                    ]
                    : []
            ),
            [
                'label' => $field_label,
                'badgeLabel' => __('Shared Global', 'dbvc'),
                'input' => 'reference_collection',
            ],
            [
                'name' => 'acf_reference_collection',
            ],
            $page_context,
            [
                'type' => 'option',
                'id' => 0,
                'subtype' => 'acf_options',
                'scope' => 'shared_entity',
                'isCurrentPageEntity' => false,
                'isLoopOwned' => false,
                'pageEntityId' => isset($page_context['entityId']) ? absint($page_context['entityId']) : 0,
            ],
            [],
            [
                'fieldName' => $field_name,
                'fieldKey' => $field_key,
                // Nested reference-collection: rootField* points at the
                // parent group so the panel + save pipeline can identify
                // the write target's outermost owner. Top-level:
                // rootField* still equals field* (unchanged shape).
                'rootFieldName' => $root_ref_field_name,
                'rootFieldKey' => $root_ref_field_key,
            ],
            [
                'version' => 1,
                'kind' => 'collection',
                'target' => 'field',
                'contract' => $contract,
                'renderContext' => 'query_collection',
                'reloadAfterSave' => true,
            ]
        );
    }

    /**
     * R5.1-a — Build a `shared_field` descriptor for a text-family
     * (text / textarea / url / email / number) ACF option field.
     *
     * The descriptor's `source.type` is `acf_field` (not
     * `acf_collection_field`) so {@see \Dbvc\VisualEditor\Resolvers\AcfTextResolver::supports}
     * matches; the panel controller is picked via `ui.input` (`text` for
     * everything except `textarea` which uses `textarea`); the resolver
     * name is `acf_text`; the mutation contract is `shared_field`
     * (already whitelisted by {@see MutationContractService::isWritable}).
     * `reloadAfterSave` mirrors the reference-collection path so a page-
     * wide cached-token-refresh runs after the save.
     *
     * @param string               $session_id
     * @param array<string, mixed> $page_context
     * @param array<string, mixed> $field
     * @param string               $field_name  Pre-sanitized.
     * @param string               $field_key   Pre-sanitized.
     * @param string               $field_type  Pre-sanitized; caller
     *                                          guarantees text-family.
     * @return EditableDescriptor
     */
    private function buildSharedFieldDescriptor($session_id, array $page_context, array $field, $field_name, $field_key, $field_type, array $config = [])
    {
        $field_label = isset($field['label']) && is_scalar($field['label'])
            ? sanitize_text_field((string) $field['label'])
            : $field_name;
        $field_group = $this->resolveFieldGroupContext($field);
        $option_page_slug = ! empty($field_group['option_pages']) ? (string) reset($field_group['option_pages']) : '';
        $option_page_label = $this->resolveOptionPageLabel($option_page_slug);
        $token = $this->createToolbarToken($session_id, $field_name, $field_key);
        // R5.2: per-family config bag drives resolver + ui.input + source
        // context. R5.1-a callers pass no config so text-family defaults
        // apply, preserving byte-identical behavior for the text branch.
        $resolver_name = isset($config['resolver']) && is_string($config['resolver']) && $config['resolver'] !== ''
            ? sanitize_key((string) $config['resolver'])
            : 'acf_text';
        $input = isset($config['input']) && is_string($config['input']) && $config['input'] !== ''
            ? (string) $config['input']
            : ($field_type === 'textarea' ? 'textarea' : 'text');
        $source_context = isset($config['source_context']) && is_string($config['source_context']) && $config['source_context'] !== ''
            ? (string) $config['source_context']
            : 'toolbar_shared_global_option_field';
        $ui_options = isset($config['ui_options']) && is_array($config['ui_options'])
            ? $config['ui_options']
            : [];

        // R5.1-b: walk the ACF parent chain via `acf_get_field()` — for a
        // leaf nested inside one or more ACF Group fields this returns the
        // root group + intervening groups + leaf, from which we build
        // `group_write_path` (per Media Manager R2-F RK-013). Top-level
        // fields see an empty chain and fall through to the unchanged
        // top-level shape. `AbstractAcfResolver::writeAcfValue` reads the
        // presence of `group_write_path` + `is_grouped_field` to route the
        // save THROUGH the root group's own `update_value`, which is the
        // only way ACF persists group-subfield values to the correct
        // prefixed meta key.
        $group_chain = $this->walkGroupChain($field);
        $is_grouped = ! empty($group_chain);
        $root_field_name = $is_grouped ? (string) $group_chain[0]['name'] : $field_name;
        $root_field_key = $is_grouped ? (string) $group_chain[0]['key'] : $field_key;
        $group_write_path = $is_grouped ? array_slice($group_chain, 1) : [];

        $source = [
            'type' => 'acf_field',
            'source_context' => $source_context,
            // For a grouped field the resolver needs the ROOT selector so
            // `getFieldIdentifier` targets the group when it eventually
            // needs to; leaf_* keys carry the addressable leaf identity.
            'field_name' => $field_name,
            'field_selector' => $root_field_name,
            'field_selector_raw' => $root_field_name,
            'field_key' => $field_key,
            'leaf_field_name' => $field_name,
            'leaf_field_key' => $field_key,
            'field_type' => $field_type,
            'field_group_key' => isset($field_group['key']) ? sanitize_key((string) $field_group['key']) : '',
            'field_group_title' => isset($field_group['title']) ? sanitize_text_field((string) $field_group['title']) : '',
            'field_group_option_pages' => isset($field_group['option_pages']) && is_array($field_group['option_pages']) ? $field_group['option_pages'] : [],
        ];
        if ($is_grouped) {
            $source['group_write_path'] = $group_write_path;
            $source['is_grouped_field'] = true;
        }

        return new EditableDescriptor(
            $token,
            'editable',
            'shared_entity',
            [
                'type' => 'option',
                'id' => 0,
                'subtype' => 'acf_options',
                'acf_object_id' => 'option',
                'option_page_slug' => $option_page_slug,
                'option_page_label' => $option_page_label,
            ],
            [
                'context' => 'field',
                'attribute' => 'toolbar_shared_global',
                'element_id' => 'toolbar-shared-global-' . $field_name,
                'display_key' => 'default',
                'sync_group' => 'option:' . $field_name,
                'source_group' => 'option:' . $field_name,
            ],
            $source,
            array_merge(
                [
                    'label' => $field_label,
                    'badgeLabel' => __('Shared Global', 'dbvc'),
                    'input' => $input,
                ],
                // R5.2-a: choice descriptors project ACF's `choices` map
                // onto `ui.options` so createSelectController /
                // createCheckboxGroupController can render the dropdown /
                // list without a second server round-trip.
                ! empty($ui_options) ? ['options' => $ui_options] : []
            ),
            [
                'name' => $resolver_name,
            ],
            $page_context,
            [
                'type' => 'option',
                'id' => 0,
                'subtype' => 'acf_options',
                'scope' => 'shared_entity',
                'isCurrentPageEntity' => false,
                'isLoopOwned' => false,
                'pageEntityId' => isset($page_context['entityId']) ? absint($page_context['entityId']) : 0,
            ],
            [],
            [
                'fieldName' => $field_name,
                'fieldKey' => $field_key,
                'rootFieldName' => $root_field_name,
                'rootFieldKey' => $root_field_key,
            ],
            [
                'version' => 1,
                'kind' => 'scalar',
                'target' => 'field',
                'contract' => 'shared_field',
                'renderContext' => 'field',
                'reloadAfterSave' => true,
            ]
        );
    }

    /**
     * R5.2-a — Project an ACF field's `choices` map onto the
     * `[{value, label}]` shape the panel's `createSelectController` /
     * `createCheckboxGroupController` reads. ACF stores choices as a
     * key→label associative array (`['blue' => 'Blue', 'red' => 'Red']`).
     * Both key and label are sanitized so a curated field with junk
     * markup in its labels cannot inject HTML into the drawer panel.
     *
     * @param array<string, mixed> $field ACF field-object array.
     * @return array<int, array{value:string,label:string}>
     */
    private function projectAcfChoices(array $field)
    {
        $choices = isset($field['choices']) && is_array($field['choices']) ? $field['choices'] : [];
        $out = [];
        foreach ($choices as $value => $label) {
            $safe_value = is_scalar($value) ? (string) $value : '';
            if ($safe_value === '') {
                continue;
            }
            $safe_label = is_scalar($label) ? sanitize_text_field((string) $label) : $safe_value;
            $out[] = [
                'value' => sanitize_text_field($safe_value),
                'label' => $safe_label,
            ];
        }
        return $out;
    }

    /**
     * R5.1-b — Walk the ACF parent chain for a leaf field. Returns
     * `[ ['key' => root_group_key, 'name' => root_group_name], ..., ['key' => leaf_key, 'name' => leaf_name] ]`
     * when the leaf is nested inside one or more Group fields, or `[]`
     * when the leaf is top-level (parent is a field group `group_XXX`).
     *
     * The chain is used by callers to compose `group_write_path` (the
     * segment AFTER root DOWN TO leaf) and to identify the root selector
     * the ACF Group's own `update_value` handles.
     *
     * @param array<string, mixed> $leaf_field ACF field-object array for the leaf.
     * @return array<int, array{key:string,name:string}>
     */
    private function walkGroupChain(array $leaf_field)
    {
        $leaf_key = sanitize_key((string) ($leaf_field['key'] ?? ''));
        $leaf_name = sanitize_key((string) ($leaf_field['name'] ?? ''));
        if ($leaf_key === '' || $leaf_name === '') {
            return [];
        }

        $chain = [['key' => $leaf_key, 'name' => $leaf_name]];
        $parent = isset($leaf_field['parent']) ? sanitize_key((string) $leaf_field['parent']) : '';
        $seen = [$leaf_key => true];

        while (
            $parent !== ''
            && strpos($parent, 'group_') !== 0
            && ! isset($seen[$parent])
            && function_exists('acf_get_field')
        ) {
            $seen[$parent] = true;
            $parent_field = acf_get_field($parent);
            if (! is_array($parent_field)) {
                break;
            }
            $parent_key = sanitize_key((string) ($parent_field['key'] ?? ''));
            $parent_name = sanitize_key((string) ($parent_field['name'] ?? ''));
            if ($parent_key === '' || $parent_name === '') {
                break;
            }
            array_unshift($chain, ['key' => $parent_key, 'name' => $parent_name]);
            $parent = isset($parent_field['parent']) ? sanitize_key((string) $parent_field['parent']) : '';
        }

        // Nested only if we found at least one PARENT above the leaf.
        return count($chain) > 1 ? $chain : [];
    }

    /**
     * @param array<string, mixed> $field
     * @return array<int, string>
     */
    public function resolveFieldPostTypes(array $field)
    {
        $post_types = $this->filterPostTypes($this->normalizePostTypes(isset($field['post_type']) ? $field['post_type'] : []));

        return ! empty($post_types) ? $post_types : $this->getDefaultReferencePostTypes();
    }

    /**
     * @param string $session_id
     * @param string $field_name
     * @param string $field_key
     * @return string
     */
    private function createToolbarToken($session_id, $field_name, $field_key)
    {
        return 've_' . substr(hash('sha256', sanitize_key((string) $session_id) . '|toolbar_shared_global|' . sanitize_key((string) $field_name) . '|' . sanitize_key((string) $field_key)), 0, 12);
    }

    /**
     * @param mixed $value
     * @return array<int, int>
     */
    private function normalizeReferenceIds($value)
    {
        $values = is_array($value) ? $value : [$value];
        $ids = [];

        foreach ($values as $item) {
            if (is_array($item) && isset($item['ID'])) {
                $id = absint($item['ID']);
            } elseif (is_array($item) && isset($item['id'])) {
                $id = absint($item['id']);
            } elseif (is_object($item) && isset($item->ID)) {
                $id = absint($item->ID);
            } elseif (is_object($item) && isset($item->id)) {
                $id = absint($item->id);
            } else {
                $id = absint($item);
            }

            if ($id > 0 && ! in_array($id, $ids, true)) {
                $ids[] = $id;
            }
        }

        return $ids;
    }

    /**
     * @param mixed $value
     * @return array<int, string>
     */
    private function normalizePostTypes($value)
    {
        $values = is_array($value) ? $value : [$value];
        $post_types = [];

        foreach ($values as $item) {
            $post_type = sanitize_key((string) $item);
            if ($post_type !== '' && ! in_array($post_type, $post_types, true)) {
                $post_types[] = $post_type;
            }
        }

        return $post_types;
    }

    /**
     * @return array<int, string>
     */
    private function getDefaultReferencePostTypes()
    {
        return $this->filterPostTypes(
            array_values(
                array_filter(
                    get_post_types(
                        [
                            'public' => true,
                        ],
                        'names'
                    )
                )
            )
        );
    }

    /**
     * @param array<int, string> $post_types
     * @return array<int, string>
     */
    private function filterPostTypes(array $post_types)
    {
        if (class_exists('\DBVC_Visual_Editor_Addon') && method_exists('\DBVC_Visual_Editor_Addon', 'filter_post_types')) {
            return \DBVC_Visual_Editor_Addon::filter_post_types($post_types);
        }

        return array_values(array_filter(array_map('sanitize_key', $post_types)));
    }

    /**
     * @param array<string, mixed> $field
     * @return int
     */
    private function resolveReferenceMin(array $field)
    {
        return isset($field['min']) && is_numeric($field['min']) ? max(0, absint($field['min'])) : 0;
    }

    /**
     * @param array<string, mixed> $field
     * @param bool                 $is_multiple
     * @return int
     */
    private function resolveReferenceMax(array $field, $is_multiple)
    {
        if (! $is_multiple) {
            return 1;
        }

        return isset($field['max']) && is_numeric($field['max']) ? max(0, absint($field['max'])) : 0;
    }

    /**
     * @param array<string, mixed> $field
     * @return array<string, mixed>
     */
    private function resolveFieldGroupContext(array $field)
    {
        $group_key = $this->resolveFieldGroupKey($field);
        if ($group_key === '' || ! function_exists('acf_get_field_group')) {
            return [
                'key' => $group_key,
                'title' => '',
                'option_pages' => [],
            ];
        }

        $group = acf_get_field_group($group_key);
        if (! is_array($group)) {
            return [
                'key' => $group_key,
                'title' => '',
                'option_pages' => [],
            ];
        }

        return [
            'key' => isset($group['key']) ? sanitize_key((string) $group['key']) : $group_key,
            'title' => isset($group['title']) ? sanitize_text_field((string) $group['title']) : '',
            'option_pages' => $this->extractFieldGroupOptionPages($group),
        ];
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
     * @param array<string, mixed> $group
     * @return array<int, string>
     */
    private function extractFieldGroupOptionPages(array $group)
    {
        $locations = isset($group['location']) && is_array($group['location']) ? $group['location'] : [];
        $slugs = [];

        foreach ($locations as $rules) {
            if (! is_array($rules)) {
                continue;
            }

            foreach ($rules as $rule) {
                if (! is_array($rule)) {
                    continue;
                }

                $param = isset($rule['param']) ? sanitize_key((string) $rule['param']) : '';
                $operator = isset($rule['operator']) ? (string) $rule['operator'] : '==';
                $value = isset($rule['value']) ? sanitize_key((string) $rule['value']) : '';

                if (! in_array($param, ['options_page', 'options_page_key'], true) || $value === '') {
                    continue;
                }

                if (! in_array($operator, ['==', '==='], true)) {
                    continue;
                }

                $slug = preg_replace('/^acf-options-/', '', $value);
                if (is_string($slug) && $slug !== '') {
                    $slugs[] = sanitize_key($slug);
                }
            }
        }

        return array_values(array_unique(array_filter($slugs)));
    }

    /**
     * @param string $slug
     * @return string
     */
    private function resolveOptionPageLabel($slug)
    {
        $slug = sanitize_key((string) $slug);
        if ($slug === '') {
            return __('Site Settings', 'dbvc');
        }

        if (function_exists('acf_get_options_pages')) {
            $pages = acf_get_options_pages();
            if (is_array($pages)) {
                foreach ($pages as $page) {
                    if (! is_array($page)) {
                        continue;
                    }

                    $menu_slug = ! empty($page['menu_slug']) ? sanitize_key((string) $page['menu_slug']) : '';
                    $normalized = preg_replace('/^acf-options-/', '', $menu_slug);
                    $normalized = is_string($normalized) ? sanitize_key($normalized) : '';

                    if ($menu_slug !== '' && ($menu_slug === $slug || $normalized === $slug)) {
                        if (! empty($page['menu_title'])) {
                            return sanitize_text_field((string) $page['menu_title']);
                        }

                        if (! empty($page['page_title'])) {
                            return sanitize_text_field((string) $page['page_title']);
                        }
                    }
                }
            }
        }

        return ucwords(str_replace(['-', '_'], ' ', $slug));
    }
}
