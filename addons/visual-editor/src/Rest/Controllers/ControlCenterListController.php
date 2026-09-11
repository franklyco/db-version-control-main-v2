<?php

namespace Dbvc\VisualEditor\Rest\Controllers;

use Dbvc\VisualEditor\Context\EditModeState;
use Dbvc\VisualEditor\Permissions\CapabilityManager;
use Dbvc\VisualEditor\Registry\ControlRegistry;
use Dbvc\VisualEditor\Registry\EditableRegistry;
use WP_REST_Request;
use WP_REST_Response;

/**
 * R3-C-1 / R4-A — Brand Control Center list route.
 *
 * `GET /dbvc/v1/visual-editor/session/{session_id}/control-center/controls
 *      ?category=&status=&family=&q=`
 *
 * Discovery-only. Returns the safe list projection from
 * {@see ControlRegistry::listControls} — never the opaque per-record `source`
 * bag, which stays server-side for the open route's descriptor factory. The
 * safe projection already applies per-user visibility, so the same registry
 * output can serve different users cheaply.
 *
 * R4-A additions:
 * - `family` query param — filters records by their `fieldFamily` (matches
 *   the R3-A whitelist: text / image / gallery / relationship / post_object /
 *   other).
 * - `q` query param — case-insensitive substring match against label OR
 *   description. Trimmed; empty is a no-op.
 * - `providerErrors` response field — provider-error map captured on the
 *   most recent registry pass so the drawer can surface a subtle banner
 *   without shielding a partial list (mockup DESIGN-DECISIONS §6).
 *
 * Auth model matches {@see SharedGlobalFieldsController}: WP REST nonce +
 * `CapabilityManager::canUseVisualEditor()` at `permission_callback`, plus
 * `EditModeState::isRestRequestAuthorized()` at the handler entry. Session
 * scoping is present because the open route (which shares this URL prefix)
 * attaches its minted descriptor to the same session.
 */
final class ControlCenterListController
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

    public function __construct(
        ControlRegistry $control_registry,
        EditableRegistry $session_registry,
        EditModeState $edit_mode,
        CapabilityManager $capabilities
    ) {
        $this->control_registry = $control_registry;
        $this->session_registry = $session_registry;
        $this->edit_mode = $edit_mode;
        $this->capabilities = $capabilities;
    }

    /**
     * @return void
     */
    public function register()
    {
        register_rest_route(
            'dbvc/v1',
            '/visual-editor/session/(?P<session_id>[A-Za-z0-9_-]+)/control-center/controls',
            [
                'methods' => 'GET',
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

        $category = isset($request['category']) ? sanitize_key((string) $request['category']) : '';
        $status = isset($request['status']) ? sanitize_key((string) $request['status']) : '';
        $family = isset($request['family']) ? sanitize_key((string) $request['family']) : '';
        // R4-A `q` free-text: trim + cap length at 128 chars so a very long
        // query does not force a wide LIKE-style scan (registry still runs a
        // linear substring; the cap is belt-and-braces). The registry
        // lowercases internally; keeping the response echo unmodified so the
        // frontend can render the user's original casing.
        $q_raw = isset($request['q']) ? (string) $request['q'] : '';
        $q = trim($q_raw);
        if (strlen($q) > 128) {
            $q = substr($q, 0, 128);
        }

        $items = $this->control_registry->listControls([
            'category' => $category,
            'status' => $status,
            'family' => $family,
            'q' => $q,
        ]);

        // R4-A: provider-error capture — one buggy provider must not shield
        // the entire list, but callers should know a partial list was served.
        $provider_errors = $this->control_registry->getProviderErrors();

        return new WP_REST_Response(
            [
                'ok' => true,
                'viewModelVersion' => 3, // R5.7-b bumped from 2 — parentPublicId added to items[]
                'query' => [
                    'category' => $category,
                    'status' => $status,
                    'family' => $family,
                    'q' => $q,
                ],
                'items' => $items,
                'providerErrors' => $provider_errors,
            ]
        );
    }
}
