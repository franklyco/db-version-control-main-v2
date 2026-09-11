<?php

namespace Dbvc\VisualEditor\Registry;

/**
 * R3-A — one normalized control entry in the {@see ControlRegistry}.
 *
 * A ControlRecord is a **discovery-time summary** of a control that a Brand
 * Control Center list should be able to render without hydrating a full
 * {@see EditableDescriptor}. It carries safe labels, category, owner/source
 * hints, field family, and status — nothing the browser could use as write
 * authority. The actual descriptor is minted server-side when the user opens
 * the control (R3-C route), through the existing pipeline.
 *
 * All string inputs are normalized via `sanitize_key`/`sanitize_text_field`
 * on construction. A ControlRecord that fails validation
 * ({@see fromArray}) returns null; the registry logs the rejection so
 * providers can be debugged during development.
 *
 * The `visibleTo` closure is the **only** capability gate — it runs at list
 * time for the current user, so the same provider output can serve different
 * users without repeating structural work. Providers that leave `visibleTo`
 * null default to "always visible"; downstream capability checks at open time
 * still gate mutation.
 */
final class ControlRecord
{
    /**
     * @var string Provider-local id (sanitize_key). Must be non-empty. Combined
     *             with the providerId to form the public {@see publicId}.
     */
    public $id;

    /**
     * @var string Provider id this record was registered under.
     */
    public $providerId;

    /**
     * @var string Human-readable label. Passed through `sanitize_text_field`.
     */
    public $label;

    /**
     * @var string Category slug (sanitize_key). Defaults to `general`.
     */
    public $category;

    /**
     * @var string Free-form group inside the category (sanitize_text_field).
     *             Optional; empty when unset.
     */
    public $group;

    /**
     * @var string Owner canonical form — matches existing resolver conventions
     *             (`option`, `post`, `term`, `user`). Defaults to `option` since
     *             the first provider (Shared Globals) is options-owned.
     */
    public $ownerType;

    /**
     * @var string Owner subtype (post type slug, taxonomy slug, options-page slug).
     *             sanitize_key. Optional.
     */
    public $ownerSubtype;

    /**
     * @var string Field family, whitelisted: `text`, `image`, `gallery`,
     *             `relationship`, `post_object`, `other`. Anything else → `other`.
     */
    public $fieldFamily;

    /**
     * @var string Discovery status, whitelisted: `available`, `inspect_only`,
     *             `unsupported`, `unavailable`. Anything else → `unavailable`.
     */
    public $status;

    /**
     * @var array<string, mixed> Opaque source-lookup hint the provider uses to
     *             rebuild the authoritative descriptor at open time. Never
     *             trusted as write authority; the registry passes it back to the
     *             provider's own descriptor factory in R3-C.
     */
    public $source;

    /**
     * @var array<string, mixed> Sanitized metadata the list UI can render (icon
     *             hint, badge text, tooltip). No secrets, no raw targets.
     */
    public $meta;

    /**
     * @var (\Closure(): bool)|null Per-user visibility gate. Returns false when
     *             the CURRENT user should not see the record. Null → always visible.
     */
    public $visibleTo;

    /**
     * @var string R4-A — optional short description providers opt in to per
     *             record. Renders as the drawer's muted second line under the
     *             label (mockup DESIGN-DECISIONS §4). Sanitized via
     *             `sanitize_text_field` on ingest. Empty when unset.
     */
    public $description;

    /**
     * @var string R4-A — provider-defined stable sort key. `sanitize_key`.
     *             {@see ControlRegistry::listControls()} sorts by this first,
     *             then by `label` (alpha), then by `publicId` as a final
     *             tie-breaker. Empty when the provider does not care about
     *             order — records fall through to the label/publicId chain.
     */
    public $sortKey;

    /**
     * @var string R5.7-b — optional publicId of another record whose child
     *             this record is in the drawer tree. Enables provider-shipped
     *             hierarchy (e.g. repeater parent → per-row leaves). The
     *             registry sorts children immediately after their parent so
     *             the drawer's tree renderer can render them adjacent without
     *             re-sorting the response array. Cross-provider links are
     *             rejected at ingest — the parent MUST be from the same
     *             provider as the child. Empty when the record is a root
     *             (top-level in the tree).
     */
    public $parentPublicId;

    /**
     * @param string $id
     * @param string $providerId
     * @param string $label
     * @param string $category
     * @param string $group
     * @param string $ownerType
     * @param string $ownerSubtype
     * @param string $fieldFamily
     * @param string $status
     * @param array<string, mixed> $source
     * @param array<string, mixed> $meta
     * @param (\Closure(): bool)|null $visibleTo
     */
    public function __construct(
        $id,
        $providerId,
        $label,
        $category,
        $group,
        $ownerType,
        $ownerSubtype,
        $fieldFamily,
        $status,
        array $source,
        array $meta,
        $visibleTo,
        $description = '',
        $sortKey = '',
        $parentPublicId = ''
    ) {
        $this->id = $id;
        $this->providerId = $providerId;
        $this->label = $label;
        $this->category = $category;
        $this->group = $group;
        $this->ownerType = $ownerType;
        $this->ownerSubtype = $ownerSubtype;
        $this->fieldFamily = $fieldFamily;
        $this->status = $status;
        $this->source = $source;
        $this->meta = $meta;
        $this->visibleTo = $visibleTo;
        $this->description = (string) $description;
        $this->sortKey = (string) $sortKey;
        $this->parentPublicId = (string) $parentPublicId;
    }

    /**
     * The public id for this control, namespaced by provider so two providers
     * can safely register the same local id. Format: `{providerId}:{id}`.
     *
     * @return string
     */
    public function publicId()
    {
        return $this->providerId . ':' . $this->id;
    }

    /**
     * @return bool
     */
    public function isVisibleToCurrentUser()
    {
        if ($this->visibleTo === null) {
            return true;
        }

        $gate = $this->visibleTo;

        return (bool) $gate();
    }

    /**
     * Project this record as a safe summary for the list UI. Never includes
     * `source` (opaque provider hint) — the frontend must call the R3-C open
     * route with the `publicId` to get an authoritative descriptor.
     *
     * @return array<string, mixed>
     */
    public function toListItem()
    {
        return [
            'publicId' => $this->publicId(),
            'label' => $this->label,
            'description' => $this->description,
            'category' => $this->category,
            'group' => $this->group,
            'ownerType' => $this->ownerType,
            'ownerSubtype' => $this->ownerSubtype,
            'fieldFamily' => $this->fieldFamily,
            'status' => $this->status,
            'sortKey' => $this->sortKey,
            'parentPublicId' => $this->parentPublicId,
            'meta' => $this->meta,
        ];
    }

    /**
     * Build a normalized record from a loose array, or return null if the input
     * doesn't have the minimum required identity. Providers may return arrays
     * OR pre-built ControlRecord instances; this coercer accepts both.
     *
     * @param mixed  $input
     * @param string $providerId
     * @return ControlRecord|null
     */
    public static function fromArray($input, $providerId)
    {
        if ($input instanceof self) {
            // Providers may hand back already-built records; still re-namespace
            // to the current provider id to prevent provider-id spoofing.
            $input->providerId = self::normalizeProviderId($providerId);

            return $input;
        }
        if (! is_array($input)) {
            return null;
        }

        $id = sanitize_key((string) ($input['id'] ?? ''));
        $label = sanitize_text_field((string) ($input['label'] ?? ''));
        if ($id === '' || $label === '') {
            return null;
        }

        $sanitized_provider = self::normalizeProviderId($providerId);
        if ($sanitized_provider === '') {
            return null;
        }

        $category = sanitize_key((string) ($input['category'] ?? ''));
        if ($category === '') {
            $category = 'general';
        }

        $group = sanitize_text_field((string) ($input['group'] ?? ''));

        $owner_type = sanitize_key((string) ($input['ownerType'] ?? 'option'));
        if (! in_array($owner_type, ['option', 'post', 'term', 'user'], true)) {
            $owner_type = 'option';
        }

        $owner_subtype = sanitize_key((string) ($input['ownerSubtype'] ?? ''));

        $field_family = sanitize_key((string) ($input['fieldFamily'] ?? 'other'));
        if (! in_array($field_family, ['text', 'image', 'gallery', 'relationship', 'post_object', 'other'], true)) {
            $field_family = 'other';
        }

        $status = sanitize_key((string) ($input['status'] ?? 'available'));
        if (! in_array($status, ['available', 'inspect_only', 'unsupported', 'unavailable'], true)) {
            $status = 'unavailable';
        }

        $source = isset($input['source']) && is_array($input['source']) ? $input['source'] : [];
        $meta = isset($input['meta']) && is_array($input['meta']) ? self::sanitizeMeta($input['meta']) : [];

        $visible_to = isset($input['visibleTo']) && $input['visibleTo'] instanceof \Closure ? $input['visibleTo'] : null;

        // R4-A additions — both optional. `description` is the drawer's
        // muted second line; `sortKey` is provider-defined stable ordering.
        $description = sanitize_text_field((string) ($input['description'] ?? ''));
        $sort_key = sanitize_key((string) ($input['sortKey'] ?? ''));

        // R5.7-b — parentPublicId is optional and provider-scoped. A
        // parent must belong to the same provider as the child (no
        // cross-provider tree links); a malformed / cross-provider
        // value is silently dropped and the record still surfaces flat
        // (the drawer treats an empty parentPublicId as "top-level").
        $parent_public_id = '';
        if (isset($input['parentPublicId']) && is_string($input['parentPublicId'])) {
            $candidate = trim((string) $input['parentPublicId']);
            $required_prefix = $sanitized_provider . ':';
            if ($candidate !== '' && strpos($candidate, $required_prefix) === 0
                && strlen($candidate) > strlen($required_prefix)) {
                $parent_public_id = $candidate;
            }
        }

        return new self(
            $id,
            $sanitized_provider,
            $label,
            $category,
            $group,
            $owner_type,
            $owner_subtype,
            $field_family,
            $status,
            $source,
            $meta,
            $visible_to,
            $description,
            $sort_key,
            $parent_public_id
        );
    }

    /**
     * @param string $providerId
     * @return string
     */
    private static function normalizeProviderId($providerId)
    {
        return sanitize_key((string) $providerId);
    }

    /**
     * Sanitize the meta bag to scalars only so the list UI cannot receive
     * arbitrary provider objects that might carry non-JSON-serializable state
     * or raw target values.
     *
     * @param array<string, mixed> $meta
     * @return array<string, mixed>
     */
    private static function sanitizeMeta(array $meta)
    {
        $out = [];
        foreach ($meta as $key => $value) {
            $sanitized_key = self::sanitizeMetaKey($key);
            if ($sanitized_key === '') {
                continue;
            }
            if (is_scalar($value) || $value === null) {
                $out[$sanitized_key] = is_string($value) ? sanitize_text_field($value) : $value;
            }
        }

        return $out;
    }

    /**
     * R5.7-b — case-preserving meta key sanitizer. `sanitize_key`
     * lowercases which mangles frontend-visible camelCase keys
     * (`childCount`, `rowIndex`, `unlocksAt`). Meta keys are provider
     * emissions — they need to survive the server → drawer round trip
     * with their original casing so the frontend can read them by name.
     * Whitelisted charset: `[A-Za-z0-9_-]` — same alphabet
     * `sanitize_key` accepts, minus its lowercasing step.
     *
     * @param mixed $key
     * @return string
     */
    private static function sanitizeMetaKey($key)
    {
        $string = (string) $key;
        $stripped = preg_replace('/[^A-Za-z0-9_\-]/', '', $string);
        return is_string($stripped) ? $stripped : '';
    }
}
