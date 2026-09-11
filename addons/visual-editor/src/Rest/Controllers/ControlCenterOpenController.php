<?php

namespace Dbvc\VisualEditor\Rest\Controllers;

use Dbvc\VisualEditor\Context\EditModeState;
use Dbvc\VisualEditor\Permissions\CapabilityManager;
use Dbvc\VisualEditor\Registry\ControlRegistry;
use Dbvc\VisualEditor\Registry\EditableDescriptor;
use Dbvc\VisualEditor\Registry\EditableRegistry;
use Dbvc\VisualEditor\Rest\DescriptorPayloadBuilder;
use WP_REST_Request;
use WP_REST_Response;

/**
 * R3-C-1 — Brand Control Center open route.
 *
 * `POST /dbvc/v1/visual-editor/session/{session_id}/control-center/open`
 * body: `{ "publicId": "<providerId>:<localId>" }`
 *
 * Resolves one `publicId` through the discovery-only
 * {@see ControlRegistry}, hands the record to its provider's own descriptor
 * factory to mint a fresh authoritative {@see \Dbvc\VisualEditor\Registry\EditableDescriptor}
 * server-side, re-checks per-descriptor capability, attaches the descriptor
 * to the Visual Editor session, and returns the descriptor summary + panel
 * hydration in the same shape the existing frontend panel already consumes
 * (mirrors {@see SharedGlobalFieldsController::handle}'s `descriptors` +
 * `descriptorHydrations` maps so the drawer UI, R3-C-2, can reuse the same
 * bootstrap path).
 *
 * Fails closed on:
 * - Missing / malformed / unknown / visibility-blocked `publicId` → 404.
 * - Provider `buildDescriptor` returns null → 404.
 * - Descriptor targets only post types excluded from Visual Editor
 *   (empty `reference_post_types`) → 403 (same policy the popover controller
 *   applies as a warning, promoted here to a hard refusal because there is no
 *   remaining author-visible surface for the message).
 * - `canEditDescriptor` returns false at open time → 403.
 * - `addDescriptorToSession` returns false → 404 (session gone).
 *
 * Auth model matches {@see SharedGlobalFieldsController}: WP REST nonce +
 * `CapabilityManager::canUseVisualEditor()` at `permission_callback`, plus
 * `EditModeState::isRestRequestAuthorized()` at the handler entry.
 */
final class ControlCenterOpenController
{
    /**
     * @var ControlRegistry
     */
    private $control_registry;

    /**
     * @var EditableRegistry
     */
    private $session_registry;

    /**
     * @var EditModeState
     */
    private $edit_mode;

    /**
     * @var CapabilityManager
     */
    private $capabilities;

    /**
     * @var DescriptorPayloadBuilder
     */
    private $payloads;

    public function __construct(
        ControlRegistry $control_registry,
        EditableRegistry $session_registry,
        EditModeState $edit_mode,
        CapabilityManager $capabilities,
        DescriptorPayloadBuilder $payloads
    ) {
        $this->control_registry = $control_registry;
        $this->session_registry = $session_registry;
        $this->edit_mode = $edit_mode;
        $this->capabilities = $capabilities;
        $this->payloads = $payloads;
    }

    /**
     * @return void
     */
    public function register()
    {
        register_rest_route(
            'dbvc/v1',
            '/visual-editor/session/(?P<session_id>[A-Za-z0-9_-]+)/control-center/open',
            [
                'methods' => 'POST',
                'permission_callback' => [$this, 'canAccess'],
                'callback' => [$this, 'handle'],
            ]
        );
    }

    /**
     * @return bool
     */
    public function canAccess()
    {
        return $this->capabilities->canUseVisualEditor();
    }

    /**
     * @param WP_REST_Request $request
     * @return WP_REST_Response
     */
    public function handle($request)
    {
        if (! ($request instanceof WP_REST_Request)) {
            return new WP_REST_Response(
                [
                    'ok' => false,
                    'message' => __('Invalid request.', 'dbvc'),
                ],
                400
            );
        }

        if (! $this->edit_mode->isRestRequestAuthorized()) {
            return new WP_REST_Response(
                [
                    'ok' => false,
                    'message' => __('Visual Editor mode is not active.', 'dbvc'),
                ],
                403
            );
        }

        $session_id = sanitize_key((string) $request['session_id']);
        $session = $this->session_registry->loadSession($session_id, false);
        if (empty($session)) {
            return new WP_REST_Response(
                [
                    'ok' => false,
                    'message' => __('Visual Editor session expired. Refresh the page to continue editing.', 'dbvc'),
                ],
                404
            );
        }

        $public_id = isset($request['publicId']) ? (string) $request['publicId'] : '';
        $record = $this->control_registry->getVisibleRecord($public_id);
        if ($record === null) {
            return new WP_REST_Response(
                [
                    'ok' => false,
                    'message' => __('That control is no longer available.', 'dbvc'),
                ],
                404
            );
        }

        $page_context = isset($session['page_context']) && is_array($session['page_context']) ? $session['page_context'] : [];
        $descriptor = $this->control_registry->buildDescriptorForRecord($record, $session_id, $page_context);
        if ($descriptor === null) {
            return new WP_REST_Response(
                [
                    'ok' => false,
                    'message' => __('That control is no longer available.', 'dbvc'),
                ],
                404
            );
        }

        // Same policy as SharedGlobalFieldsController::handle — a descriptor
        // whose reference_post_types resolved to empty targets only post types
        // excluded from Visual Editor. The popover surfaces this as a warning
        // in its inventory; the open route has no equivalent surface, so refuse.
        if (isset($descriptor->source['reference_post_types'])
            && is_array($descriptor->source['reference_post_types'])
            && empty($descriptor->source['reference_post_types'])
        ) {
            return new WP_REST_Response(
                [
                    'ok' => false,
                    'message' => __('That control targets post types excluded from Visual Editor.', 'dbvc'),
                ],
                403
            );
        }

        if (! $this->capabilities->canEditDescriptor($descriptor)) {
            return new WP_REST_Response(
                [
                    'ok' => false,
                    'message' => __('You cannot edit that control.', 'dbvc'),
                ],
                403
            );
        }

        if (! $this->session_registry->addDescriptorToSession($session_id, $descriptor)) {
            return new WP_REST_Response(
                [
                    'ok' => false,
                    'message' => __('That control could not be attached to this Visual Editor session.', 'dbvc'),
                ],
                404
            );
        }

        // R5.later-y-3 (2026-09-05): a palette-parent descriptor can carry
        // pre-minted leaf descriptors in `source.leaves[i].descriptor`.
        // Register each in the session so subsequent per-swatch saves
        // route through those tokens WITHOUT a separate `/open` call
        // (first save per swatch drops from 2 round-trips to 1).
        // Capability + exclusion checks are re-applied per leaf; a
        // failed leaf is silently skipped rather than blocking the
        // palette parent from opening.
        $collected_descriptors = [$descriptor->token => $descriptor];
        $leaves = isset($descriptor->source['leaves']) && is_array($descriptor->source['leaves'])
            ? $descriptor->source['leaves']
            : [];
        foreach ($leaves as $leaf) {
            if (! is_array($leaf) || empty($leaf['descriptor']) || ! is_array($leaf['descriptor'])) {
                continue;
            }
            $leaf_descriptor = EditableDescriptor::fromArray($leaf['descriptor']);
            if (! $leaf_descriptor->token) {
                continue;
            }
            if (! $this->capabilities->canEditDescriptor($leaf_descriptor)) {
                continue;
            }
            if (! $this->session_registry->addDescriptorToSession($session_id, $leaf_descriptor)) {
                continue;
            }
            $collected_descriptors[$leaf_descriptor->token] = $leaf_descriptor;
        }

        $payload = $this->payloads->build($descriptor);
        $summary = $this->session_registry->exportPublicMap($collected_descriptors);

        $descriptors_response = [];
        $hydrations_response = [
            $descriptor->token => array_merge(['ok' => true], $payload),
        ];
        foreach ($collected_descriptors as $token => $collected) {
            $descriptors_response[$token] = isset($summary[$token]) ? $summary[$token] : [];
        }

        return new WP_REST_Response(
            [
                'ok' => true,
                'publicId' => $record->publicId(),
                'descriptors' => $descriptors_response,
                'descriptorHydrations' => $hydrations_response,
            ]
        );
    }
}
