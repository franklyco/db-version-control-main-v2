<?php

namespace Dbvc\VisualEditor\Registry;

/**
 * R3-A — provider-agnostic control registry.
 *
 * A discovery surface for controls that live outside the current render — Shared
 * Globals is the first {@see ControlProvider} adapted onto it (R3-B). The registry
 * collects providers, validates and normalizes each returned {@see ControlRecord},
 * rejects duplicates (observable via `dbvc_visual_editor_control_registry_invalid`
 * for developers/debugging), and re-applies per-user visibility on every list
 * call so the same provider output can serve different users cheaply.
 *
 * **This is not a write authority.** A registered control opens through the
 * existing {@see EditableRegistry}/`MediaFindingDescriptorBridge`/`MutationService`
 * pipeline; the registry is a discovery-only read model (matches the R3 plan's
 * "creates no new write authority" contract).
 *
 * The R3 plan's slice gate: registry output is deterministic, filtered, and
 * cannot introduce write authority. Slice R3-B adds the Shared Globals compat
 * provider; R3-C adds the minimal center UI + open route; R3-D hardens.
 */
final class ControlRegistry
{
    /**
     * @var array<string, ControlProvider>
     */
    private $providers = [];

    /**
     * R4-A — provider ids whose `getControls()` most recently threw during
     * {@see collectValidRecords()}, keyed to a small `{message}` context. The
     * registry captures instead of re-throwing so one buggy provider cannot
     * suppress every other provider's records (fail-soft — the R4 mockup
     * DESIGN-DECISIONS §6 pins this). Callers surface the map to the drawer
     * as a subtle banner via the R4-A list endpoint's `providerErrors` field.
     *
     * Cleared at the start of every {@see collectValidRecords()} pass so it
     * reflects the current call rather than accumulating across the request.
     *
     * @var array<string, array<string, string>>
     */
    private $providerErrors = [];

    /**
     * Registration reasons for a rejected provider or record, observable via
     * the `dbvc_visual_editor_control_registry_invalid` action.
     */
    private const REJECT_PROVIDER_INVALID_ID = 'provider_invalid_id';
    private const REJECT_PROVIDER_DUPLICATE = 'provider_duplicate';
    private const REJECT_RECORD_INVALID = 'record_invalid';
    private const REJECT_RECORD_DUPLICATE_LOCAL_ID = 'record_duplicate_local_id';
    private const REJECT_PROVIDER_THREW = 'provider_threw';

    /**
     * Register a provider. Returns true on success, false on rejection (a
     * duplicate provider id, or an id that fails `sanitize_key`).
     *
     * Rejection fires `dbvc_visual_editor_control_registry_invalid` with
     * `$reason` and `$context` so a developer can observe misregistration
     * during test/QA without breaking the runtime.
     *
     * @param ControlProvider $provider
     * @return bool
     */
    public function registerProvider(ControlProvider $provider)
    {
        $id = sanitize_key((string) $provider->getProviderId());
        if ($id === '') {
            $this->observeInvalid(self::REJECT_PROVIDER_INVALID_ID, [
                'class' => get_class($provider),
            ]);

            return false;
        }
        if (isset($this->providers[$id])) {
            $this->observeInvalid(self::REJECT_PROVIDER_DUPLICATE, [
                'provider_id' => $id,
                'class' => get_class($provider),
            ]);

            return false;
        }

        $this->providers[$id] = $provider;

        return true;
    }

    /**
     * True when a provider with this id is registered.
     *
     * @param string $providerId
     * @return bool
     */
    public function hasProvider($providerId)
    {
        return isset($this->providers[sanitize_key((string) $providerId)]);
    }

    /**
     * Currently-registered provider ids, sorted for deterministic output.
     *
     * @return array<int, string>
     */
    public function providerIds()
    {
        $ids = array_keys($this->providers);
        sort($ids);

        return $ids;
    }

    /**
     * List every registered control the CURRENT user can see. Returns the safe
     * summary shape from {@see ControlRecord::toListItem} (no `source` bag —
     * that stays internal to the provider so a client cannot re-target it).
     *
     * Filtering is applied in this order so upstream filters cheaply prune
     * records BEFORE the per-user visibility gate runs:
     * category → status → family → q → visibility. Records are returned in
     * `sortKey ASC` order, tiebroken by label ASC (case-insensitive), then
     * publicId ASC as a final deterministic tiebreaker — the R4 mockup
     * DESIGN-DECISIONS §7 pins this so provider-defined ordering can win
     * over per-provider default order.
     *
     * @param array<string, mixed> $args Keys:
     *                                   - `category` (string, sanitize_key)
     *                                   - `status` (string, sanitize_key)
     *                                   - `family` (string, sanitize_key) —
     *                                     R4-A; matches `fieldFamily` exactly.
     *                                   - `q` (string) — R4-A; case-insensitive
     *                                     substring match against label OR
     *                                     description. Whitespace-trimmed;
     *                                     empty string is a no-op.
     * @return array<int, array<string, mixed>>
     */
    public function listControls(array $args = [])
    {
        $category_filter = isset($args['category']) ? sanitize_key((string) $args['category']) : '';
        $status_filter = isset($args['status']) ? sanitize_key((string) $args['status']) : '';
        $family_filter = isset($args['family']) ? sanitize_key((string) $args['family']) : '';
        $q_filter = isset($args['q']) ? trim((string) $args['q']) : '';
        $q_needle = $q_filter !== '' ? function_exists('mb_strtolower') ? mb_strtolower($q_filter, 'UTF-8') : strtolower($q_filter) : '';

        $records = $this->collectValidRecords();
        $items = [];

        foreach ($records as $record) {
            if ($category_filter !== '' && $record->category !== $category_filter) {
                continue;
            }
            if ($status_filter !== '' && $record->status !== $status_filter) {
                continue;
            }
            if ($family_filter !== '' && $record->fieldFamily !== $family_filter) {
                continue;
            }
            if ($q_needle !== '' && ! $this->matchesQuery($record, $q_needle)) {
                continue;
            }
            if (! $record->isVisibleToCurrentUser()) {
                continue;
            }
            $items[] = $record->toListItem();
        }

        return $items;
    }

    /**
     * R4-A — provider errors captured on the most recent
     * {@see collectValidRecords()} pass. Callers surface this to the drawer
     * as a subtle banner without shielding a partial list — the R4 mockup
     * DESIGN-DECISIONS §6 pins fail-soft semantics for provider errors.
     *
     * @return array<string, array<string, string>> Provider id → `{message}`.
     */
    public function getProviderErrors()
    {
        return $this->providerErrors;
    }

    /**
     * Resolve one record by its public id (`{providerId}:{id}`) for the current
     * user. Returns null when the record is unknown, malformed, or the current
     * user cannot see it — callers MUST fail closed on null.
     *
     * The `source` bag is included here because this method is the internal
     * bridge R3-C uses to hand the provider back its own opaque hint at open
     * time; it never crosses a REST boundary as-is.
     *
     * @param string $publicId
     * @return ControlRecord|null
     */
    public function getVisibleRecord($publicId)
    {
        $publicId = (string) $publicId;
        if ($publicId === '' || strpos($publicId, ':') === false) {
            return null;
        }
        [$providerId, $localId] = explode(':', $publicId, 2);
        $providerId = sanitize_key($providerId);
        $localId = sanitize_key($localId);
        if ($providerId === '' || $localId === '' || ! isset($this->providers[$providerId])) {
            return null;
        }

        $records = $this->collectValidRecords();
        foreach ($records as $record) {
            if ($record->providerId === $providerId && $record->id === $localId) {
                return $record->isVisibleToCurrentUser() ? $record : null;
            }
        }

        return null;
    }

    /**
     * R3-C-1 — mint an authoritative {@see EditableDescriptor} for one record
     * by delegating to the record's provider's own descriptor factory. This is
     * the internal bridge {@see \Dbvc\VisualEditor\Rest\Controllers\ControlCenterOpenController}
     * uses at open time; the private `$providers` map stays fully encapsulated.
     *
     * Fails closed to `null` when:
     * - The record's provider is no longer registered.
     * - The provider's own `buildDescriptor` returns null (e.g. the underlying
     *   field was deleted, changed type, or otherwise no longer resolves
     *   between list-time and open-time).
     *
     * Capability is NOT checked here — the caller re-checks
     * {@see \Dbvc\VisualEditor\Permissions\CapabilityManager::canEditDescriptor}
     * against the resulting descriptor before attaching it to a session.
     *
     * @param ControlRecord        $record
     * @param string               $sessionId
     * @param array<string, mixed> $pageContext
     * @return EditableDescriptor|null
     */
    public function buildDescriptorForRecord(ControlRecord $record, $sessionId, array $pageContext)
    {
        $providerId = sanitize_key((string) $record->providerId);
        if ($providerId === '' || ! isset($this->providers[$providerId])) {
            return null;
        }

        return $this->providers[$providerId]->buildDescriptor($record, (string) $sessionId, $pageContext);
    }

    /**
     * R4-A — mint a per-family value summary for one record by delegating to
     * the record's provider's own summary factory. Internal bridge used by
     * {@see \Dbvc\VisualEditor\Rest\Controllers\ControlCenterValueSummariesController}
     * (the batch endpoint) so the private `$providers` map stays fully
     * encapsulated. The returned summary is an opaque per-family shape the
     * drawer renders as the row's right-side chip; providers own its shape.
     *
     * Fails closed to `null` when the record's provider is no longer
     * registered, or the provider's own `buildValueSummary` returns null
     * (family without a factory yet, empty value, provider opting out).
     *
     * Capability is NOT checked here — the caller re-checks
     * {@see \Dbvc\VisualEditor\Permissions\CapabilityManager::canEditDescriptor}
     * per record against the resolved descriptor first, per R4 mockup
     * DESIGN-DECISIONS §5's "value summary is a read-model that surfaces
     * owned data" contract.
     *
     * @param ControlRecord $record
     * @param string        $sessionId
     * @return array<string, mixed>|null
     */
    public function buildValueSummaryForRecord(ControlRecord $record, $sessionId)
    {
        $providerId = sanitize_key((string) $record->providerId);
        if ($providerId === '' || ! isset($this->providers[$providerId])) {
            return null;
        }

        return $this->providers[$providerId]->buildValueSummary($record, (string) $sessionId);
    }

    /**
     * Deterministic list of every valid, de-duplicated record across every
     * provider. Duplicate local ids within one provider are rejected
     * (observed); the same local id across two different providers is kept
     * because their public ids differ. Providers that throw during
     * `getControls()` are captured in {@see $providerErrors} and dropped from
     * the pass without cascading — one buggy provider must not suppress every
     * other provider's records (R4 mockup DESIGN-DECISIONS §6).
     *
     * Sort: `sortKey ASC` first, then label ASC (case-insensitive), then
     * `publicId` ASC as a deterministic tiebreaker. Records with an empty
     * `sortKey` fall through to the label chain — this preserves R3-A test
     * expectations, where records had no `sortKey` and were listed by their
     * per-provider local id (which happened to align alphabetically with
     * their labels).
     *
     * @return array<int, ControlRecord>
     */
    private function collectValidRecords()
    {
        $this->providerErrors = [];
        $records = [];
        $provider_ids = array_keys($this->providers);
        sort($provider_ids);

        foreach ($provider_ids as $provider_id) {
            $provider = $this->providers[$provider_id];
            try {
                $raw = $provider->getControls();
            } catch (\Throwable $throwable) {
                // R4-A fail-soft: capture, observe, drop this provider's
                // records but keep processing the rest of the map. The
                // observer channel keeps developer-side visibility; the
                // captured message drives the drawer banner.
                $message = (string) $throwable->getMessage();
                $this->providerErrors[$provider_id] = ['message' => $message];
                $this->observeInvalid(self::REJECT_PROVIDER_THREW, [
                    'provider_id' => $provider_id,
                    'class' => get_class($provider),
                    'exception_class' => get_class($throwable),
                    'message' => $message,
                ]);
                continue;
            }
            if (! is_array($raw)) {
                continue;
            }

            $seen_local_ids = [];
            foreach ($raw as $entry) {
                $record = ControlRecord::fromArray($entry, $provider_id);
                if ($record === null) {
                    $this->observeInvalid(self::REJECT_RECORD_INVALID, [
                        'provider_id' => $provider_id,
                    ]);
                    continue;
                }
                if (isset($seen_local_ids[$record->id])) {
                    $this->observeInvalid(self::REJECT_RECORD_DUPLICATE_LOCAL_ID, [
                        'provider_id' => $provider_id,
                        'local_id' => $record->id,
                    ]);
                    continue;
                }
                $seen_local_ids[$record->id] = true;
                $records[] = $record;
            }
        }

        usort($records, static function (ControlRecord $a, ControlRecord $b) {
            $sort_cmp = strcmp($a->sortKey, $b->sortKey);
            if ($sort_cmp !== 0) {
                return $sort_cmp;
            }
            $label_a = function_exists('mb_strtolower') ? mb_strtolower($a->label, 'UTF-8') : strtolower($a->label);
            $label_b = function_exists('mb_strtolower') ? mb_strtolower($b->label, 'UTF-8') : strtolower($b->label);
            $label_cmp = strcmp($label_a, $label_b);
            if ($label_cmp !== 0) {
                return $label_cmp;
            }
            return strcmp($a->publicId(), $b->publicId());
        });

        return $this->flattenParentChildOrder($records);
    }

    /**
     * R5.7-b — post-sort DFS flatten so records with `parentPublicId`
     * pointing at another record in the same pass appear immediately
     * after their parent, and children of the same parent stay in their
     * sortKey / label / publicId order (they were already sorted before
     * this step).
     *
     * Orphaned children (parentPublicId points at a non-existent
     * publicId, or the parent is filtered out at read time) fall back
     * to root position rather than being dropped — the drawer then
     * renders them as top-level, which is a safer degradation than
     * silently disappearing a record that the provider registered.
     *
     * The DFS runs to arbitrary depth so a future slice can nest deeper
     * (grandchildren, etc.) without further changes here.
     *
     * @param array<int, ControlRecord> $sorted_records
     * @return array<int, ControlRecord>
     */
    private function flattenParentChildOrder(array $sorted_records)
    {
        $by_public_id = [];
        foreach ($sorted_records as $record) {
            $by_public_id[$record->publicId()] = true;
        }
        $roots = [];
        $children_of = [];
        foreach ($sorted_records as $record) {
            $parent = $record->parentPublicId;
            if ($parent !== '' && isset($by_public_id[$parent])) {
                if (! isset($children_of[$parent])) {
                    $children_of[$parent] = [];
                }
                $children_of[$parent][] = $record;
                continue;
            }
            $roots[] = $record;
        }
        $flat = [];
        $emit = function (ControlRecord $node) use (&$emit, &$flat, &$children_of) {
            $flat[] = $node;
            $public_id = $node->publicId();
            if (isset($children_of[$public_id])) {
                foreach ($children_of[$public_id] as $child) {
                    $emit($child);
                }
            }
        };
        foreach ($roots as $root) {
            $emit($root);
        }
        return $flat;
    }

    /**
     * R4-A — does this record match the free-text `q` filter? Case-insensitive
     * substring match against the record's label OR its description; either
     * field may be empty. Callers pre-lowercase the needle.
     *
     * @param ControlRecord $record
     * @param string        $needle Already lowercased.
     * @return bool
     */
    private function matchesQuery(ControlRecord $record, $needle)
    {
        $label = function_exists('mb_strtolower') ? mb_strtolower((string) $record->label, 'UTF-8') : strtolower((string) $record->label);
        if ($label !== '' && strpos($label, $needle) !== false) {
            return true;
        }
        $description = function_exists('mb_strtolower') ? mb_strtolower((string) $record->description, 'UTF-8') : strtolower((string) $record->description);
        if ($description !== '' && strpos($description, $needle) !== false) {
            return true;
        }

        return false;
    }

    /**
     * @param string               $reason
     * @param array<string, mixed> $context
     * @return void
     */
    private function observeInvalid($reason, array $context)
    {
        /**
         * Fires when the control registry rejects a provider registration or a
         * returned record during validation. Useful for developer/QA debugging;
         * consumers should NOT do heavy work in-hook.
         *
         * @param string               $reason  One of the REJECT_* constants
         *                                       (e.g. `provider_duplicate`,
         *                                       `record_invalid`).
         * @param array<string, mixed> $context Structured context about the
         *                                       rejection (provider id, class,
         *                                       local id, etc.). Never carries
         *                                       raw target values.
         */
        do_action('dbvc_visual_editor_control_registry_invalid', sanitize_key((string) $reason), $context);
    }
}
