<?php

namespace Dbvc\VisualEditor\Assets;

use Dbvc\VisualEditor\Context\EditModeState;
use Dbvc\VisualEditor\Context\PageContextResolver;
use Dbvc\VisualEditor\Registry\EditableRegistry;

final class AssetLoader
{
    /**
     * @var string
     */
    private $bootstrap_file;

    /**
     * @var EditModeState
     */
    private $edit_mode;

    /**
     * @var EditableRegistry
     */
    private $registry;

    /**
     * @var PageContextResolver
     */
    private $page_context;

    public function __construct($bootstrap_file, EditModeState $edit_mode, EditableRegistry $registry, PageContextResolver $page_context)
    {
        $this->bootstrap_file = (string) $bootstrap_file;
        $this->edit_mode = $edit_mode;
        $this->registry = $registry;
        $this->page_context = $page_context;
    }

    /**
     * @return void
     */
    public function register()
    {
        add_action('wp_enqueue_scripts', [$this, 'enqueue'], 100);
    }

    /**
     * @return void
     */
    public function unregister()
    {
        remove_action('wp_enqueue_scripts', [$this, 'enqueue'], 100);
    }

    /**
     * @return void
     */
    public function enqueue()
    {
        if (! $this->edit_mode->shouldLoadFrontendAssets()) {
            return;
        }

        $base_url = plugin_dir_url($this->bootstrap_file);
        $session_id = $this->registry->getSessionId();
        $page_context = $this->page_context->resolve();
        $style_version = $this->resolveAssetVersion('assets/css/overlay.css');
        $api_version = $this->resolveAssetVersion('assets/js/api-client.js');
        $overlay_version = $this->resolveAssetVersion('assets/js/overlay-app.js');
        // RK-011 Slice 1: shared wp.media frame factory. Same wiring pattern as
        // api-client.js — a small standalone module both overlay and media-manager
        // depend on, so the frame construction stays deduplicated.
        $media_frame_factory_version = $this->resolveAssetVersion('assets/js/media-frame-factory.js');
        $media_manager_enabled = $this->isMediaManagerEnabled();
        $media_manager_style_version = $this->resolveAssetVersion('assets/css/media-manager.css');
        $media_manager_script_version = $this->resolveAssetVersion('assets/js/media-manager-app.js');
        // R3-C-2: Brand Control Center drawer assets are only enqueued when both the master
        // Visual Editor switch and OPTION_CONTROL_CENTER_ENABLED are on (D-063). Bricks
        // Builder exclusion inherits — this whole enqueue path is already skipped inside
        // Bricks by the parent shouldLoadFrontendAssets() check.
        $control_center_enabled = $this->isControlCenterEnabled();
        $control_center_style_version = $this->resolveAssetVersion('assets/css/control-center.css');
        $control_center_script_version = $this->resolveAssetVersion('assets/js/brand-control-center-app.js');
        $overlay_dependencies = ['dbvc-visual-editor-api-client', 'dbvc-visual-editor-media-frame-factory'];

        if (function_exists('wp_enqueue_editor')) {
            wp_enqueue_editor();
        }

        if (function_exists('wp_enqueue_media')) {
            wp_enqueue_media();
        }

        if (wp_script_is('wp-editor', 'registered') || wp_script_is('wp-editor', 'enqueued')) {
            $overlay_dependencies[] = 'wp-editor';
        }

        if (wp_script_is('media-editor', 'registered') || wp_script_is('media-editor', 'enqueued')) {
            $overlay_dependencies[] = 'media-editor';
        }

        wp_enqueue_style(
            'dbvc-visual-editor-overlay',
            $base_url . 'assets/css/overlay.css',
            [],
            $style_version
        );

        wp_enqueue_script(
            'dbvc-visual-editor-api-client',
            $base_url . 'assets/js/api-client.js',
            [],
            $api_version,
            true
        );

        wp_enqueue_script(
            'dbvc-visual-editor-media-frame-factory',
            $base_url . 'assets/js/media-frame-factory.js',
            [],
            $media_frame_factory_version,
            true
        );

        wp_enqueue_script(
            'dbvc-visual-editor-overlay',
            $base_url . 'assets/js/overlay-app.js',
            $overlay_dependencies,
            $overlay_version,
            true
        );

        if ($media_manager_enabled) {
            wp_enqueue_style(
                'dbvc-visual-editor-media-manager',
                $base_url . 'assets/css/media-manager.css',
                ['dbvc-visual-editor-overlay'],
                $media_manager_style_version
            );

            wp_enqueue_script(
                'dbvc-visual-editor-media-manager',
                $base_url . 'assets/js/media-manager-app.js',
                ['dbvc-visual-editor-overlay'],
                $media_manager_script_version,
                true
            );
        }

        if ($control_center_enabled) {
            wp_enqueue_style(
                'dbvc-visual-editor-control-center',
                $base_url . 'assets/css/control-center.css',
                ['dbvc-visual-editor-overlay'],
                $control_center_style_version
            );

            wp_enqueue_script(
                'dbvc-visual-editor-control-center',
                $base_url . 'assets/js/brand-control-center-app.js',
                ['dbvc-visual-editor-overlay'],
                $control_center_script_version,
                true
            );
        }

        wp_localize_script(
            'dbvc-visual-editor-overlay',
            'DBVCVisualEditorBootstrap',
            [
                'active' => true,
                'restBase' => esc_url_raw(rest_url('dbvc/v1/visual-editor')),
                'nonce' => wp_create_nonce('wp_rest'),
                'sessionId' => $session_id,
                'sessionTtl' => $this->registry->getSessionTtl(),
                'sessionKeepaliveMs' => 240000,
                'pageContext' => $page_context,
                'currentEditLink' => $this->buildCurrentEditLink($page_context),
                'toggleUrl' => $this->edit_mode->buildToggleUrl(),
                'supportsWpEditor' => function_exists('wp_enqueue_editor') && (wp_script_is('wp-editor', 'enqueued') || wp_script_is('wp-editor', 'done') || wp_script_is('wp-editor', 'to_do')),
                'supportsWpMedia' => function_exists('wp_enqueue_media') && wp_script_is('media-editor', 'enqueued'),
                'canUpload' => current_user_can('upload_files'),
                'mediaManager' => [
                    'enabled' => $media_manager_enabled,
                    'restBase' => esc_url_raw(rest_url('dbvc/v1/visual-editor/media-manager')),
                    // R2-H Slice 2c: open the Media Manager from the durable, cross-user
                    // Media Index (instant, read-time per-user filtered) with the
                    // ephemeral scan as an automatic fallback. Filterable so a site can
                    // force the scan-only path if needed.
                    'indexList' => (bool) apply_filters('dbvc_visual_editor_media_index_list_enabled', $media_manager_enabled),
                ],
                // R3-C-2: Brand Control Center drawer bootstrap. `restBase` is the
                // session-neutral prefix; the drawer builds session-scoped URLs as
                // `restBase + '/session/' + sessionId + '/control-center/{controls|open}'`
                // — matches the R3-C-1 route shape (session-scoped so the open route can
                // attach its minted descriptor to the same Visual Editor session the
                // popover uses).
                'controlCenter' => [
                    'enabled' => $control_center_enabled,
                    'restBase' => esc_url_raw(rest_url('dbvc/v1/visual-editor')),
                ],
                'strings' => [
                    'modeActive' => __('Visual Editor active', 'dbvc'),
                    'supportedCount' => __('marked fields', 'dbvc'),
                    'zeroMarkers' => __('No supported or inspectable nodes were detected on this page yet.', 'dbvc'),
                    'sessionUnavailable' => __('Markers were found, but the descriptor session was unavailable for this request.', 'dbvc'),
                    'sessionExpired' => __('Visual Editor session expired. Refresh the page to continue editing.', 'dbvc'),
                    'sessionRefreshRecommended' => __('Refresh the page to continue editing this field.', 'dbvc'),
                    'panelTitle' => __('Edit field', 'dbvc'),
                    'panelSave' => __('Save', 'dbvc'),
                    'panelSaveAndReload' => __('Save and Reload', 'dbvc'),
                    'panelInspectOnly' => __('Inspect only', 'dbvc'),
                    'panelCancel' => __('Close', 'dbvc'),
                    'panelEmpty' => __('No field is selected yet.', 'dbvc'),
                    'panelLoading' => __('Loading field details…', 'dbvc'),
                    'panelSaving' => __('Saving…', 'dbvc'),
                    // true_false: labels for the boolean panel controller
                    // (checkbox + label) and the drawer's boolean chip
                    // fallback when the server summary is unlocalized.
                    'panelBooleanOn' => __('On', 'dbvc'),
                    'panelBooleanOff' => __('Off', 'dbvc'),
                    // R5.later-y (2026-09-04) — palette overview panel. Header
                    // text pluralised via {count}; empty state fires when the
                    // palette has no color leaves; per-cell aria-label
                    // injects the color's {label} for screen-reader
                    // disambiguation. R5.later-y-2 (2026-09-05) — updated
                    // header wording to reflect inline auto-save (was
                    // "Click a swatch to edit it individually" pre-R5.later-y-2)
                    // and added per-cell save status announcements
                    // (Saving… / Saved / Save failed) that populate the
                    // aria-live status slot inside each cell.
                    'panelPaletteOverviewHeaderOne' => __('{count} color in this palette. Each color saves automatically when changed.', 'dbvc'),
                    'panelPaletteOverviewHeaderMany' => __('{count} colors in this palette. Each color saves automatically when changed.', 'dbvc'),
                    'panelPaletteOverviewEmpty' => __('No colors in this palette yet.', 'dbvc'),
                    'panelPaletteOverviewCellLabel' => __('Edit {label}', 'dbvc'),
                    'panelPaletteOverviewCellSaving' => __('Saving…', 'dbvc'),
                    'panelPaletteOverviewCellSaved' => __('Saved', 'dbvc'),
                    'panelPaletteOverviewCellError' => __('Save failed', 'dbvc'),
                    // R5.later-b (2026-09-05) — Option Y bulk-palette
                    // popover. Full-attention modal surface for palette
                    // editing at a larger canvas + per-swatch Copy-hex
                    // + a Copy-all-as-CSS-variables header action.
                    // `controlCenterPaletteExpand` labels the compact
                    // Expand icon button on palette parent rows.
                    'controlCenterPaletteExpand' => __('Expand {name}', 'dbvc'),
                    'panelPaletteBulkLoading' => __('Loading palette…', 'dbvc'),
                    'panelPaletteBulkFailed' => __('Could not load palette.', 'dbvc'),
                    'panelPaletteBulkFallbackTitle' => __('Palette editor', 'dbvc'),
                    'panelPaletteBulkClose' => __('Close palette editor', 'dbvc'),
                    'panelPaletteBulkCopyHex' => __('Copy hex', 'dbvc'),
                    'panelPaletteBulkCopyAll' => __('Copy all as CSS variables', 'dbvc'),
                    'panelPaletteBulkCopied' => __('Copied to clipboard.', 'dbvc'),
                    'panelPaletteBulkCopyFailed' => __('Could not copy to clipboard.', 'dbvc'),
                    'panelReady' => __('Select a marker to inspect or edit it.', 'dbvc'),
                    'panelSaved' => __('Saved successfully.', 'dbvc'),
                    'panelSource' => __('Source', 'dbvc'),
                    'panelSourceDetails' => __('Source details', 'dbvc'),
                    'panelSaveContract' => __('Save contract', 'dbvc'),
                    'panelSaveContractDetail' => __('Contract detail', 'dbvc'),
                    'panelSourceLabel' => __('Label', 'dbvc'),
                    'panelSourceExpression' => __('Dynamic tag', 'dbvc'),
                    'panelRenderedHtmlTag' => __('Rendered HTML tag', 'dbvc'),
                    'panelSourceRepeater' => __('acf repeater', 'dbvc'),
                    'panelSourceFlexible' => __('acf flexible', 'dbvc'),
                    'panelScopeReadonly' => __('inspect only', 'dbvc'),
                    'panelScopeRelated' => __('related post', 'dbvc'),
                    'panelScopeRelatedTerm' => __('related term', 'dbvc'),
                    'panelScopeRelatedUser' => __('related user', 'dbvc'),
                    'panelScopeRelatedOption' => __('related option', 'dbvc'),
                    'panelScopeRelatedGeneric' => __('related item', 'dbvc'),
                    'panelScopeShared' => __('shared target', 'dbvc'),
                    'panelScopeSharedPost' => __('shared post', 'dbvc'),
                    'panelScopeSharedTerm' => __('shared term', 'dbvc'),
                    'panelScopeSharedUser' => __('shared user', 'dbvc'),
                    'panelScopeSharedOption' => __('shared option', 'dbvc'),
                    'panelScopeSharedGeneric' => __('shared item', 'dbvc'),
                    'panelNoticeTypeShared' => __('Shared', 'dbvc'),
                    'panelNoticeTypeRelated' => __('Related', 'dbvc'),
                    'panelNoticeTypeQuery' => __('Query Loop collection', 'dbvc'),
                    'panelNoticeTypeCurrent' => __('Current Post', 'dbvc'),
                    'panelRepeater' => __('repeater', 'dbvc'),
                    'panelFlexible' => __('flexible', 'dbvc'),
                    'panelLayout' => __('layout', 'dbvc'),
                    'panelRow' => __('row', 'dbvc'),
                    'panelLoop' => __('loop', 'dbvc'),
                    'panelEntityPost' => __('post', 'dbvc'),
                    'panelEntityOption' => __('option', 'dbvc'),
                    'panelEntityTerm' => __('term', 'dbvc'),
                    'panelEntityUser' => __('user', 'dbvc'),
                    'panelNoOptions' => __('No choices were available for this field.', 'dbvc'),
                    'panelRichTextBold' => __('Bold', 'dbvc'),
                    'panelRichTextItalic' => __('Italic', 'dbvc'),
                    'panelRichTextParagraph' => __('Paragraph', 'dbvc'),
                    'panelRichTextBullets' => __('Bullets', 'dbvc'),
                    'panelRichTextNumbers' => __('Numbers', 'dbvc'),
                    'panelRichTextVisual' => __('Visual', 'dbvc'),
                    'panelRichTextCode' => __('Code', 'dbvc'),
                    'panelLinkUrl' => __('Link URL', 'dbvc'),
                    'panelLinkTitle' => __('Link title', 'dbvc'),
                    'panelLinkSameTab' => __('Open in same tab', 'dbvc'),
                    'panelLinkNewTab' => __('Open in new tab', 'dbvc'),
                    'panelMediaUrl' => __('Media Library image URL', 'dbvc'),
                    'panelMediaId' => __('Attachment ID', 'dbvc'),
                    'panelMediaUrlHint' => __('Paste a local Media Library image URL to resolve this field to an attachment ID.', 'dbvc'),
                    'panelMediaChoose' => __('Choose from Media Library', 'dbvc'),
                    'panelMediaReplace' => __('Replace from Media Library', 'dbvc'),
                    'panelMediaClear' => __('Clear image', 'dbvc'),
                    'panelMediaFrameTitle' => __('Select image', 'dbvc'),
                    'panelMediaFrameButton' => __('Use this image', 'dbvc'),
                    'panelMediaSavedNoReload' => __('Image saved and updated on the page.', 'dbvc'),
                    'panelMediaReloading' => __('Image saved. Reloading page…', 'dbvc'),
                    'panelGallerySingle' => __('1 gallery image', 'dbvc'),
                    'panelGalleryCount' => __('gallery images', 'dbvc'),
                    'panelGalleryChoose' => __('Choose gallery images', 'dbvc'),
                    'panelGalleryAdd' => __('Add images', 'dbvc'),
                    'panelGalleryReplace' => __('Replace gallery', 'dbvc'),
                    'panelGalleryClear' => __('Clear gallery', 'dbvc'),
                    'panelGalleryRemove' => __('Remove image', 'dbvc'),
                    'panelGalleryMoveEarlier' => __('Move earlier', 'dbvc'),
                    'panelGalleryMoveLater' => __('Move later', 'dbvc'),
                    'panelGalleryDragToReorder' => __('Drag to reorder gallery image', 'dbvc'),
                    'panelGalleryFrameTitle' => __('Select gallery images', 'dbvc'),
                    'panelGalleryFrameButton' => __('Use selected images', 'dbvc'),
                    'panelGalleryAddFrameTitle' => __('Add gallery images', 'dbvc'),
                    'panelGalleryAddFrameButton' => __('Add selected images', 'dbvc'),
                    'panelGallerySavedNoReload' => __('Gallery saved. Reload when ready to rebuild the full gallery markup.', 'dbvc'),
                    'panelGalleryReloading' => __('Gallery saved. Reloading page…', 'dbvc'),
                    'panelCollectionSearch' => __('Search connected posts', 'dbvc'),
                    'panelCollectionSearchPlaceholder' => __('Search posts…', 'dbvc'),
                    'panelCollectionSelected' => __('Connected items', 'dbvc'),
                    'panelCollectionResults' => __('Search results', 'dbvc'),
                    'panelCollectionEmpty' => __('No connected posts are set yet.', 'dbvc'),
                    'panelCollectionNoResults' => __('No matching posts were found.', 'dbvc'),
                    'panelCollectionTermsEmpty' => __('No linked terms are set yet.', 'dbvc'),
                    'panelCollectionTermsNoResults' => __('No matching terms were found.', 'dbvc'),
                    'panelCollectionSearching' => __('Searching…', 'dbvc'),
                    'panelCollectionAdd' => __('Add', 'dbvc'),
                    'panelCollectionReplace' => __('Replace', 'dbvc'),
                    'panelCollectionRemove' => __('Remove', 'dbvc'),
                    'panelCollectionMoveUp' => __('Move up', 'dbvc'),
                    'panelCollectionMoveDown' => __('Move down', 'dbvc'),
                    'panelCollectionSavedNoReload' => __('Connected items saved. Reload when ready to refresh this query loop.', 'dbvc'),
                    'panelCollectionReloading' => __('Connected items saved. Reloading page…', 'dbvc'),
                    'panelCollectionSubsetSelected' => __('Connected {target}', 'dbvc'),
                    'panelCollectionSubsetContext' => __('Editing only {target} in this connected-items field.', 'dbvc'),
                    'panelCollectionSubsetPreservedSingle' => __('1 other linked item in this field will be preserved.', 'dbvc'),
                    'panelCollectionSubsetPreservedPlural' => __('{count} other linked items in this field will be preserved.', 'dbvc'),
                    'panelCollectionSubsetSearch' => __('Search {target}', 'dbvc'),
                    'panelCollectionSubsetSearchPlaceholder' => __('Search {target}…', 'dbvc'),
                    'panelCollectionSubsetEmpty' => __('No connected {target} are set yet.', 'dbvc'),
                    'panelCollectionPreviewSelected' => __('Queried items', 'dbvc'),
                    'panelCollectionPreviewEmpty' => __('No queried items were found.', 'dbvc'),
                    'panelCollectionBranchOptionsFallback' => __('Options fallback active', 'dbvc'),
                    'panelCollectionBranchUnmatchedQuery' => __('Query Editor post list', 'dbvc'),
                    'panelCollectionBranchInspectOnly' => __('Inspect-only query', 'dbvc'),
                    'panelCollectionPreviewOptionsFallback' => __('This query is currently using a shared ACF options fallback, but this branch did not meet the exact shared-option save contract. Saving is disabled.', 'dbvc'),
                    'panelCollectionPreviewUnmatched' => __('Visual Editor could not prove a writable ACF source for this query. Saving is disabled.', 'dbvc'),
                    'panelCollectionPreviewInspectOnly' => __('This query result can be inspected, but it is not writable from the Visual Editor yet.', 'dbvc'),
                    'panelCollectionPreviewFrontend' => __('Frontend', 'dbvc'),
                    'panelCollectionPreviewBackend' => __('Backend', 'dbvc'),
                    'panelCollectionSeedTitle' => __('Current page field fallback', 'dbvc'),
                    'panelCollectionSeedDescription' => __('The current page field is empty for this query branch. You can copy these fallback items into the current page field instead of editing the shared fallback.', 'dbvc'),
                    'panelCollectionSeedButton' => __('Add to current page field', 'dbvc'),
                    'panelCollectionSeedConfirm' => __('This copies the queried fallback items into the current page field and reloads the page. Continue?', 'dbvc'),
                    'panelCollectionSeedSaving' => __('Adding fallback items to current page field…', 'dbvc'),
                    'panelCollectionSeedReloading' => __('Current page field updated. Reloading page…', 'dbvc'),
                    'panelNoMedia' => __('No media is currently set.', 'dbvc'),
                    'panelRenderedValue' => __('Rendered value', 'dbvc'),
                    'panelResolvedValue' => __('Resolved source value', 'dbvc'),
                    'panelMismatch' => __('This marker is visible, but saving is disabled because the resolved backend value does not match the rendered page value yet.', 'dbvc'),
                    'panelSharedScopeAck' => __('I understand this updates a shared field and may affect other pages.', 'dbvc'),
                    'panelSharedScopeAckPost' => __('I understand this updates a shared post-owned field and may affect other pages.', 'dbvc'),
                    'panelSharedScopeAckTerm' => __('I understand this updates a shared taxonomy term field and may affect other pages.', 'dbvc'),
                    'panelSharedScopeAckUser' => __('I understand this updates a shared user field and may affect other pages.', 'dbvc'),
                    'panelSharedScopeAckOption' => __('I understand this updates a shared Site Settings value and may affect other pages.', 'dbvc'),
                    'panelSharedScopeAckGeneric' => __('I understand this updates a shared field and may affect other pages.', 'dbvc'),
                    'panelSharedScopeSave' => __('Save shared field', 'dbvc'),
                    'panelSharedScopeSavePost' => __('Save shared post', 'dbvc'),
                    'panelSharedScopeSaveTerm' => __('Save shared term', 'dbvc'),
                    'panelSharedScopeSaveUser' => __('Save shared user', 'dbvc'),
                    'panelSharedScopeSaveOption' => __('Save shared option', 'dbvc'),
                    'panelSharedScopeSaveGeneric' => __('Save shared item', 'dbvc'),
                    'panelSharedScopeRequired' => __('Acknowledge the shared scope warning before saving this field.', 'dbvc'),
                    'panelSharedScopeRequiredPost' => __('Acknowledge the shared-post warning before saving this field.', 'dbvc'),
                    'panelSharedScopeRequiredTerm' => __('Acknowledge the shared-term warning before saving this field.', 'dbvc'),
                    'panelSharedScopeRequiredUser' => __('Acknowledge the shared-user warning before saving this field.', 'dbvc'),
                    'panelSharedScopeRequiredOption' => __('Acknowledge the shared-option warning before saving this field.', 'dbvc'),
                    'panelSharedScopeRequiredGeneric' => __('Acknowledge the shared-item warning before saving this field.', 'dbvc'),
                    'panelRelatedScopeAck' => __('I understand this updates the related post shown in this Bricks query loop, not the current page.', 'dbvc'),
                    'panelRelatedScopeAckTerm' => __('I understand this updates the related term shown in this Bricks query loop, not the current page.', 'dbvc'),
                    'panelRelatedScopeAckUser' => __('I understand this updates the related user shown in this Bricks query loop, not the current page.', 'dbvc'),
                    'panelRelatedScopeAckOption' => __('I understand this updates the related option source shown in this Bricks query loop, not the current page.', 'dbvc'),
                    'panelRelatedScopeAckGeneric' => __('I understand this updates a related item shown in this Bricks query loop, not the current page.', 'dbvc'),
                    'panelRelatedScopeSave' => __('Save related post', 'dbvc'),
                    'panelRelatedScopeSaveTerm' => __('Save related term', 'dbvc'),
                    'panelRelatedScopeSaveUser' => __('Save related user', 'dbvc'),
                    'panelRelatedScopeSaveOption' => __('Save related option', 'dbvc'),
                    'panelRelatedScopeSaveGeneric' => __('Save related item', 'dbvc'),
                    'panelRelatedScopeRequired' => __('Acknowledge the related-post warning before saving this field.', 'dbvc'),
                    'panelRelatedScopeRequiredTerm' => __('Acknowledge the related-term warning before saving this field.', 'dbvc'),
                    'panelRelatedScopeRequiredUser' => __('Acknowledge the related-user warning before saving this field.', 'dbvc'),
                    'panelRelatedScopeRequiredOption' => __('Acknowledge the related-option warning before saving this field.', 'dbvc'),
                    'panelRelatedScopeRequiredGeneric' => __('Acknowledge the related-item warning before saving this field.', 'dbvc'),
                    'badgeConnected' => __('Edit Connected', 'dbvc'),
                    'badgeModifyLinkedPosts' => __('Linked Posts', 'dbvc'),
                    'panelCollectionGroupFallback' => __('Items', 'dbvc'),
                    'panelCollectionGroupItemSingular' => __('1 item', 'dbvc'),
                    'panelCollectionGroupItemPlural' => __('items', 'dbvc'),
                    'editLabel' => __('Edit', 'dbvc'),
                    'inspectLabel' => __('Inspect', 'dbvc'),
                    'badgeRelated' => __('Related Post', 'dbvc'),
                    'badgeRelatedTerm' => __('Related Term', 'dbvc'),
                    'badgeRelatedUser' => __('Related User', 'dbvc'),
                    'badgeRelatedOption' => __('Related Option', 'dbvc'),
                    'badgeRelatedGeneric' => __('Related', 'dbvc'),
                    'badgeShared' => __('Shared', 'dbvc'),
                    'badgeSharedPost' => __('Shared Post', 'dbvc'),
                    'badgeSharedTerm' => __('Shared Term', 'dbvc'),
                    'badgeSharedUser' => __('Shared User', 'dbvc'),
                    'badgeSharedOption' => __('Shared Option', 'dbvc'),
                    'badgeSharedGeneric' => __('Shared Item', 'dbvc'),
                    'toolbarLabel' => __('Visual Editor toolbar', 'dbvc'),
                    'toolbarStatus' => __('Visual Editor status', 'dbvc'),
                    'toolbarReviewFields' => __('Review fields', 'dbvc'),
                    'toolbarGoToObject' => __('Go to object', 'dbvc'),
                    'toolbarMediaManager' => __('Media Manager', 'dbvc'),
                    'toolbarSharedGlobals' => __('Shared globals', 'dbvc'),
                    'toolbarControlCenter' => __('Global Brand Controls', 'dbvc'),
                    'controlCenterTitle' => __('Global Brand Controls', 'dbvc'),
                    'controlCenterClose' => __('Close Global Brand Control Center', 'dbvc'),
                    'controlCenterSummary' => __('{count} controls', 'dbvc'),
                    'controlCenterSearchLabel' => __('Search controls', 'dbvc'),
                    // R4-C-1a: placeholder widened to reflect the R4-A `q`
                    // param matching label OR description.
                    'controlCenterSearchPlaceholder' => __('Search labels, descriptions, owner…', 'dbvc'),
                    'controlCenterRefreshing' => __('Refreshing…', 'dbvc'),
                    'controlCenterProviderErrorSingular' => __('{count} provider unavailable — {names}', 'dbvc'),
                    'controlCenterProviderErrorPlural' => __('{count} providers unavailable — {names}', 'dbvc'),
                    'controlCenterProviderErrorDismiss' => __('Dismiss', 'dbvc'),
                    // R4-C-1b: value-summary chip label for relationship /
                    // post_object families. Text prefaces the connected-item
                    // count that renders in the row's action cell.
                    'controlCenterValueRelationshipConnected' => __('connected', 'dbvc'),
                    // R5.1-a: text-family chip truncation suffix — appended
                    // after the preview when the value was longer than the
                    // 32-character preview cap. Shows the ORIGINAL character
                    // count so the viewer can see how much was cut.
                    'controlCenterValueTextTruncated' => __('({count})', 'dbvc'),
                    // R5.2-a: choice-family chip suffix for multi-checkbox
                    // summaries — appended after the count.
                    'controlCenterValueChoiceSelected' => __('selected', 'dbvc'),
                    // R5.2-b: wysiwyg-family chip suffix — word count for
                    // the stripped-text preview.
                    'controlCenterValueWysiwygWords' => __('· {count} words', 'dbvc'),
                    // R4-C-2: header segmented view-mode toggle (By category
                    // vs By provider), collapsible group headers, search
                    // wrap Clear button, and default provider labels.
                    'controlCenterViewToggleLabel' => __('Category view', 'dbvc'),
                    'controlCenterViewByCategory' => __('By category', 'dbvc'),
                    'controlCenterViewByProvider' => __('By provider', 'dbvc'),
                    'controlCenterGroupExpand' => __('Expand group', 'dbvc'),
                    'controlCenterGroupCollapse' => __('Collapse group', 'dbvc'),
                    'controlCenterGroupControlsCount' => __('{count} controls', 'dbvc'),
                    'controlCenterGroupUnnamed' => __('Other', 'dbvc'),
                    // R5.7-b — tree row disclosure + row-count chip.
                    // {name} is the parent row's label; keeps the aria-label
                    // scannable ("Expand Menus" vs generic "Expand").
                    'controlCenterTreeExpand' => __('Expand {name}', 'dbvc'),
                    'controlCenterTreeCollapse' => __('Collapse {name}', 'dbvc'),
                    'controlCenterTreeChildCountOne' => __('{count} row', 'dbvc'),
                    'controlCenterTreeChildCountMany' => __('{count} rows', 'dbvc'),
                    'controlCenterProviderShared' => __('Shared Globals', 'dbvc'),
                    'controlCenterProviderVertical' => __('Vertical', 'dbvc'),
                    'controlCenterProviderUnknown' => __('Other', 'dbvc'),
                    'controlCenterClearSearch' => __('Clear search', 'dbvc'),
                    // R4-D-1: transient confirmation strip shown briefly
                    // after the editor panel saves the row the drawer
                    // opened. Same string doubles as the polite-live-region
                    // announcement text.
                    'controlCenterSaveStatus' => __('Saved {label}.', 'dbvc'),
                    'controlCenterTabAll' => __('All', 'dbvc'),
                    'controlCenterTablist' => __('Category', 'dbvc'),
                    'controlCenterStatusLabel' => __('Status', 'dbvc'),
                    'controlCenterPriorityLabel' => __('Priority', 'dbvc'),
                    'controlCenterFieldLabel' => __('Field', 'dbvc'),
                    'controlCenterStatusAvailable' => __('Available', 'dbvc'),
                    'controlCenterStatusInspectOnly' => __('View only', 'dbvc'),
                    'controlCenterStatusUnsupported' => __('Unsupported', 'dbvc'),
                    'controlCenterStatusUnavailable' => __('Unavailable', 'dbvc'),
                    'controlCenterActionOpen' => __('Open', 'dbvc'),
                    'controlCenterActionView' => __('View', 'dbvc'),
                    'controlCenterActionOpening' => __('Opening…', 'dbvc'),
                    'controlCenterActionUnsupported' => __('Unsupported', 'dbvc'),
                    'controlCenterActionUnavailable' => __('Unavailable', 'dbvc'),
                    'controlCenterClearFilters' => __('Clear filters', 'dbvc'),
                    'controlCenterDismiss' => __('Dismiss', 'dbvc'),
                    'controlCenterRetry' => __('Retry', 'dbvc'),
                    'controlCenterFooterCount' => __('{visible} of {total} controls', 'dbvc'),
                    'controlCenterFooterHidden' => __('{hidden} hidden by filters', 'dbvc'),
                    'controlCenterLoadingTitle' => __('Loading Global Brand Controls', 'dbvc'),
                    'controlCenterLoadingBody' => __('Fetching registered controls for this session.', 'dbvc'),
                    'controlCenterEmptyTitle' => __('No global controls registered yet', 'dbvc'),
                    'controlCenterEmptyBody' => __('Once a provider registers controls, they will appear here.', 'dbvc'),
                    'controlCenterEmptyFilteredTitle' => __('No controls match these filters', 'dbvc'),
                    'controlCenterEmptyFilteredBody' => __('Clear the filters to see every registered control again.', 'dbvc'),
                    'controlCenterErrorTitle' => __('Controls could not be loaded', 'dbvc'),
                    'controlCenterErrorBody' => __('The registered-controls request failed. Retry when you are ready.', 'dbvc'),
                    'controlCenterOpenErrorUnknown' => __('That control is no longer available.', 'dbvc'),
                    'controlCenterOpenErrorForbidden' => __('You cannot edit that control right now.', 'dbvc'),
                    'controlCenterOpenErrorRefresh' => __('The control changed since it was listed. Refresh the drawer before trying again.', 'dbvc'),
                    'controlCenterAnnounceOpened' => __('Global Brand Controls opened. Showing {count} registered controls.', 'dbvc'),
                    'controlCenterAnnounceClosed' => __('Global Brand Controls closed.', 'dbvc'),
                    'controlCenterAnnounceFiltered' => __('{count} controls visible after filters.', 'dbvc'),
                    'controlCenterAnnounceOpenSuccess' => __('Opened {label}.', 'dbvc'),
                    'controlCenterAnnounceOpenError' => __('Could not open {label}. {message}', 'dbvc'),
                    'controlCenterCategoryGlobals' => __('Globals', 'dbvc'),
                    'controlCenterCategoryBrand' => __('Brand', 'dbvc'),
                    'controlCenterCategoryContact' => __('Contact', 'dbvc'),
                    'controlCenterCategoryContent' => __('Content', 'dbvc'),
                    'controlCenterCategoryDesign' => __('Design', 'dbvc'),
                    'controlCenterCategoryLayout' => __('Layout', 'dbvc'),
                    'controlCenterCategoryLegal' => __('Legal', 'dbvc'),
                    'controlCenterCategorySeo' => __('SEO', 'dbvc'),
                    'controlCenterCategoryGeneral' => __('General', 'dbvc'),
                    'controlCenterOwnerHint' => __('{ownerType}/{ownerSubtype} · {fieldFamily}', 'dbvc'),
                    'toolbarSharedGlobalsLoading' => __('Loading shared globals...', 'dbvc'),
                    'toolbarSharedGlobalsFailed' => __('Shared globals could not be loaded.', 'dbvc'),
                    'toolbarMore' => __('More options', 'dbvc'),
                    'toolbarEditObject' => __('Edit object', 'dbvc'),
                    'toolbarExitMode' => __('Exit Visual Editor', 'dbvc'),
                    'toolbarObjectFilterAll' => __('All', 'dbvc'),
                    'toolbarObjectFilterPosts' => __('Posts', 'dbvc'),
                    'toolbarObjectFilterTerms' => __('Terms', 'dbvc'),
                    'toolbarObjectCurrent' => __('Current object', 'dbvc'),
                    'toolbarObjectCurrentPage' => __('Current page', 'dbvc'),
                    'toolbarObjectCurrentTerm' => __('Current term', 'dbvc'),
                    'toolbarObjectCurrentLabel' => __('Current', 'dbvc'),
                    'toolbarObjectResults' => __('Results', 'dbvc'),
                    'toolbarObjectSearchPlaceholder' => __('Search posts and terms...', 'dbvc'),
                    'toolbarObjectSearching' => __('Searching...', 'dbvc'),
                    'toolbarObjectNoResults' => __('No matching objects were found.', 'dbvc'),
                    'toolbarObjectSearchFailed' => __('Object search failed.', 'dbvc'),
                    'toolbarObjectOpenFrontend' => __('Open', 'dbvc'),
                    'toolbarObjectOpenBackend' => __('Edit', 'dbvc'),
                    'toolbarObjectEditBackend' => __('Edit', 'dbvc'),
                    'toolbarSharedGlobalsEmpty' => __('No configured shared global relationship or post object fields are available.', 'dbvc'),
                    'toolbarSharedGlobalsNotice' => __('Configured sitewide option-owned relationship/post_object fields are listed here with verified ACF metadata. Saving updates the global fallback field itself, uses shared acknowledgement, and reloads after save.', 'dbvc'),
                    'toolbarSharedGlobalEditable' => __('Writable on page', 'dbvc'),
                    'toolbarSharedGlobalConfigured' => __('Configured global', 'dbvc'),
                    'toolbarSharedGlobalInspectOnly' => __('Inspect only', 'dbvc'),
                    'mediaManagerTitle' => __('Media Manager', 'dbvc'),
                    'mediaManagerSubtitle' => __('Read-only scan of published content for empty image fields.', 'dbvc'),
                    'mediaManagerClose' => __('Close Media Manager', 'dbvc'),
                    'mediaManagerShellTitle' => __('Ready to check media', 'dbvc'),
                    'mediaManagerShellDescription' => __('Open the Media Manager to check for a current read-only scan.', 'dbvc'),
                    'mediaManagerReadOnly' => __('R1 is read-only. No media assignments or content values can be changed from this panel.', 'dbvc'),
                    'mediaManagerActionRefresh' => __('Check again', 'dbvc'),
                    'mediaManagerActionStart' => __('Start new scan', 'dbvc'),
                    'mediaManagerActionNext' => __('Continue scan', 'dbvc'),
                    'mediaManagerActionRetry' => __('Retry scan', 'dbvc'),
                    'mediaManagerActionCancel' => __('Cancel scan', 'dbvc'),
                    'mediaManagerProgressLabel' => __('Processed', 'dbvc'),
                    'mediaManagerStateLoadingTitle' => __('Checking Media Manager state', 'dbvc'),
                    'mediaManagerStateLoadingDescription' => __('Waiting for the protected scan service to respond.', 'dbvc'),
                    'mediaManagerStateNoScanTitle' => __('No current scan', 'dbvc'),
                    'mediaManagerStateNoScanDescription' => __('Start a read-only scan to check published content for missing media.', 'dbvc'),
                    'mediaManagerStateIndexTitle' => __('Site media index', 'dbvc'),
                    'mediaManagerStateIndexDescription' => __('Showing entities with missing media from the durable site index. Start a new scan for a fresh full check.', 'dbvc'),
                    'mediaManagerStateScanningTitle' => __('Scan in progress', 'dbvc'),
                    'mediaManagerStateScanningDescription' => __('Continue the bounded scan when you are ready for the next chunk.', 'dbvc'),
                    'mediaManagerStateCompleteTitle' => __('Scan complete', 'dbvc'),
                    'mediaManagerStateCompleteDescription' => __('The current scan is ready. Search or filter the bounded results below.', 'dbvc'),
                    'mediaManagerStateFailedTitle' => __('Scan could not continue', 'dbvc'),
                    'mediaManagerStateFailedDescription' => __('The scan stopped safely. Retry is available only when the server permits it.', 'dbvc'),
                    'mediaManagerStateCanceledTitle' => __('Scan canceled', 'dbvc'),
                    'mediaManagerStateCanceledDescription' => __('No content was changed. You can start a new read-only scan.', 'dbvc'),
                    'mediaManagerStateInvalidatedTitle' => __('Scan configuration changed', 'dbvc'),
                    'mediaManagerStateInvalidatedDescription' => __('Start a fresh scan before relying on these results.', 'dbvc'),
                    'mediaManagerStateStaleTitle' => __('Scan state changed', 'dbvc'),
                    'mediaManagerStateStaleDescription' => __('A newer scan revision is authoritative. Check again before continuing.', 'dbvc'),
                    'mediaManagerStateRequestErrorTitle' => __('Media Manager is unavailable', 'dbvc'),
                    'mediaManagerStateRequestErrorDescription' => __('The protected scan request could not be completed.', 'dbvc'),
                    'mediaManagerStateInvalidResponse' => __('The Media Manager returned an invalid scan response.', 'dbvc'),
                    'mediaManagerStateClientUnavailable' => __('The Media Manager request client is unavailable.', 'dbvc'),
                    'mediaManagerResultsTitle' => __('Missing media results', 'dbvc'),
                    'mediaManagerSummaryCopy' => __('{entities} entities with findings · {findings} supported empty fields in the current scan', 'dbvc'),
                    'mediaManagerIndexSummaryCopy' => __('{entities} entities with missing media from the site index', 'dbvc'),
                    'mediaManagerSearchLabel' => __('Search entities', 'dbvc'),
                    'mediaManagerSearchPlaceholder' => __('Search entities…', 'dbvc'),
                    'mediaManagerEntityFilterLabel' => __('Entity type', 'dbvc'),
                    'mediaManagerFieldFilterLabel' => __('Field type', 'dbvc'),
                    'mediaManagerFilterAll' => __('All', 'dbvc'),
                    'mediaManagerFilterPosts' => __('Posts', 'dbvc'),
                    'mediaManagerFilterTerms' => __('Terms', 'dbvc'),
                    'mediaManagerFamilyFeaturedImage' => __('Featured image', 'dbvc'),
                    'mediaManagerFamilyAcfImage' => __('ACF image', 'dbvc'),
                    'mediaManagerFamilyAcfGallery' => __('ACF gallery', 'dbvc'),
                    'mediaManagerSortLabel' => __('Sort', 'dbvc'),
                    'mediaManagerSortEntityAsc' => __('Entity (A–Z)', 'dbvc'),
                    'mediaManagerSortEntityDesc' => __('Entity (Z–A)', 'dbvc'),
                    'mediaManagerSortMissingDesc' => __('Missing fields (most first)', 'dbvc'),
                    'mediaManagerSortMissingAsc' => __('Missing fields (fewest first)', 'dbvc'),
                    'mediaManagerSortScannedDesc' => __('Recently scanned', 'dbvc'),
                    'mediaManagerSortScannedAsc' => __('Oldest scanned', 'dbvc'),
                    'mediaManagerClearFilters' => __('Clear filters', 'dbvc'),
                    'mediaManagerRetryResults' => __('Retry results', 'dbvc'),
                    'mediaManagerResultsLoading' => __('Loading matching entities…', 'dbvc'),
                    'mediaManagerResultsLoadingMore' => __('Loading more matching entities…', 'dbvc'),
                    'mediaManagerTableCaption' => __('Published entities with empty supported media fields. Results use bounded cursor pages.', 'dbvc'),
                    'mediaManagerColumnEntity' => __('Entity', 'dbvc'),
                    'mediaManagerColumnType' => __('Type', 'dbvc'),
                    'mediaManagerColumnMissing' => __('Missing', 'dbvc'),
                    'mediaManagerColumnFamilies' => __('Field types', 'dbvc'),
                    'mediaManagerColumnScanned' => __('Scanned', 'dbvc'),
                    'mediaManagerColumnUpdated' => __('Updated', 'dbvc'),
                    'mediaManagerColumnFrontend' => __('Front end', 'dbvc'),
                    'mediaManagerOpenFrontend' => __('Open', 'dbvc'),
                    'mediaManagerNoFrontendRoute' => __('No route', 'dbvc'),
                    'mediaManagerUntitledEntity' => __('Untitled content', 'dbvc'),
                    'mediaManagerExpandRow' => __('Show missing media fields for {entity}', 'dbvc'),
                    'mediaManagerCollapseRow' => __('Hide missing media fields for {entity}', 'dbvc'),
                    'mediaManagerExpandedRegionLabel' => __('Missing media fields for {entity}', 'dbvc'),
                    'mediaManagerExpandedTitle' => __('Missing media fields', 'dbvc'),
                    'mediaManagerExpansionLoading' => __('Checking the current field state…', 'dbvc'),
                    'mediaManagerExpansionLoadingAnnouncement' => __('Checking missing media fields for {entity}.', 'dbvc'),
                    'mediaManagerExpansionCompleteAnnouncement' => __('Field check complete for {entity}. {summary}.', 'dbvc'),
                    'mediaManagerExpansionErrorAnnouncement' => __('Fields could not be checked for {entity}. {message}', 'dbvc'),
                    'mediaManagerExpansionErrorTitle' => __('Fields could not be checked', 'dbvc'),
                    'mediaManagerExpansionInvalid' => __('The Media Manager returned an invalid field response.', 'dbvc'),
                    'mediaManagerExpansionSummary' => __('{missing} still missing · {changed} changed · {resolved} no longer confirmed · {unavailable} unavailable', 'dbvc'),
                    'mediaManagerUnknownField' => __('Media field', 'dbvc'),
                    'mediaManagerFieldStatusMissing' => __('Still missing', 'dbvc'),
                    'mediaManagerFieldStatusChanged' => __('Changed since scan', 'dbvc'),
                    'mediaManagerFieldStatusResolved' => __('No longer confirmed missing', 'dbvc'),
                    'mediaManagerFieldStatusUnavailable' => __('Could not revalidate', 'dbvc'),
                    'mediaManagerFieldStatusAssigned' => __('Has media', 'dbvc'),
                    'mediaManagerThumbCount' => __('+{count}', 'dbvc'),
                    'mediaManagerAssignChooseImage' => __('Choose image', 'dbvc'),
                    'mediaManagerAssignChooseGallery' => __('Choose gallery images', 'dbvc'),
                    'mediaManagerAssignReplaceImage' => __('Replace image', 'dbvc'),
                    'mediaManagerAssignReplaceGallery' => __('Replace selection', 'dbvc'),
                    'mediaManagerAssignClear' => __('Clear selection', 'dbvc'),
                    'mediaManagerAssignUnsavedBadge' => __('Unsaved selection', 'dbvc'),
                    'mediaManagerAssignStagedSingle' => __('1 image selected but not saved.', 'dbvc'),
                    'mediaManagerAssignStagedPlural' => __('{count} images selected but not saved.', 'dbvc'),
                    'mediaManagerAssignFrameImageTitle' => __('Select image', 'dbvc'),
                    'mediaManagerAssignFrameImageButton' => __('Use this image', 'dbvc'),
                    'mediaManagerAssignFrameGalleryTitle' => __('Select gallery images', 'dbvc'),
                    'mediaManagerAssignFrameGalleryButton' => __('Use selected images', 'dbvc'),
                    'mediaManagerAssignPreparing' => __('Opening the Media Library for this field…', 'dbvc'),
                    'mediaManagerAssignOpening' => __('Opening Media Library…', 'dbvc'),
                    'mediaManagerAssignUploadUnavailable' => __('Uploading new files is not available for your account. Choose from existing Media Library images.', 'dbvc'),
                    'mediaManagerFieldStatusSaved' => __('Saved', 'dbvc'),
                    'mediaManagerRowResolved' => __('Resolved', 'dbvc'),
                    'mediaManagerAssignStagedAnnouncement' => __('{count} image(s) selected for {label} but not saved yet.', 'dbvc'),
                    'mediaManagerAssignClearedAnnouncement' => __('Selection cleared. Nothing was saved.', 'dbvc'),
                    'mediaManagerAssignUnsupported' => __('Media selection is unavailable in this browser session.', 'dbvc'),
                    'mediaManagerAssignError' => __('The media descriptor could not be prepared.', 'dbvc'),
                    'mediaManagerAssignStatusChanged' => __('This field changed since the scan. Refresh the scan before assigning media.', 'dbvc'),
                    'mediaManagerAssignStatusResolved' => __('This field is no longer confirmed missing. Refresh the scan.', 'dbvc'),
                    'mediaManagerAssignStatusUnavailable' => __('This field can no longer be edited. Refresh the scan.', 'dbvc'),
                    'mediaManagerAssignSave' => __('Save assignment', 'dbvc'),
                    'mediaManagerAssignSaving' => __('Saving…', 'dbvc'),
                    'mediaManagerAssignSavingAnnouncement' => __('Saving media assignment…', 'dbvc'),
                    'mediaManagerAssignSavedAnnouncement' => __('Media assigned for {label}. This field is no longer empty.', 'dbvc'),
                    'mediaManagerAssignSaveError' => __('The media assignment could not be saved.', 'dbvc'),
                    'mediaManagerReplaceImage' => __('Replace image', 'dbvc'),
                    'mediaManagerReplaceGallery' => __('Replace selection', 'dbvc'),
                    'mediaManagerReplaceChooseImage' => __('Choose different image', 'dbvc'),
                    'mediaManagerReplaceChooseGallery' => __('Choose different images', 'dbvc'),
                    'mediaManagerReplaceUnsavedBadge' => __('Unsaved replacement', 'dbvc'),
                    'mediaManagerReplaceStagedSingle' => __('1 image selected to replace the current media.', 'dbvc'),
                    'mediaManagerReplaceStagedPlural' => __('{count} images selected to replace the current media.', 'dbvc'),
                    'mediaManagerReplacePreparing' => __('Opening the Media Library to replace this field…', 'dbvc'),
                    'mediaManagerReplaceSave' => __('Save replacement', 'dbvc'),
                    'mediaManagerReplaceSaving' => __('Replacing…', 'dbvc'),
                    'mediaManagerReplaceSavingAnnouncement' => __('Saving media replacement…', 'dbvc'),
                    'mediaManagerReplaceSavedAnnouncement' => __('Media replaced for {label}. This field now points to the new selection.', 'dbvc'),
                    'mediaManagerReplaceSaveError' => __('The media replacement could not be saved.', 'dbvc'),
                    'mediaManagerValueUnavailable' => __('Not available', 'dbvc'),
                    'mediaManagerNoResultsYetTitle' => __('No findings loaded yet', 'dbvc'),
                    'mediaManagerNoResultsYetDescription' => __('Continue the bounded scan to check more published entities.', 'dbvc'),
                    'mediaManagerNoMatchesTitle' => __('No entities match these filters', 'dbvc'),
                    'mediaManagerNoMatchesDescription' => __('Clear the search or widen the entity and field filters. The scan itself is unchanged.', 'dbvc'),
                    'mediaManagerNoFindingsTitle' => __('No missing media assignments found', 'dbvc'),
                    'mediaManagerNoFindingsDescription' => __('The current completed scan returned no accessible entities with supported empty media fields.', 'dbvc'),
                    'mediaManagerIndexEmptyTitle' => __('No missing media in the site index', 'dbvc'),
                    'mediaManagerIndexEmptyDescription' => __('The durable media index found no accessible entities with supported empty media fields.', 'dbvc'),
                    'mediaManagerLoadedCount' => __('{count} entities loaded for this query.', 'dbvc'),
                    'mediaManagerResultsAnnouncement' => __('{count} entities loaded for the current query.', 'dbvc'),
                    'mediaManagerLoadMore' => __('Load more', 'dbvc'),
                    'statusbarEditEntity' => __('Edit', 'dbvc'),
                    'statusbarEditCurrentPage' => __('Edit current page', 'dbvc'),
                    'statusbarEditCurrentPost' => __('Edit current post', 'dbvc'),
                    'statusbarEditCurrentTerm' => __('Edit current term', 'dbvc'),
                    'statusbarEditCurrentItem' => __('Edit current item', 'dbvc'),
                    'fieldIndexReview' => __('Review fields', 'dbvc'),
                    'fieldIndexHide' => __('Hide fields', 'dbvc'),
                    'fieldIndexExpandAll' => __('Expand all', 'dbvc'),
                    'fieldIndexCollapseAll' => __('Collapse all', 'dbvc'),
                    'fieldIndexFilterAll' => __('All', 'dbvc'),
                    'fieldIndexFilterEditable' => __('Editable', 'dbvc'),
                    'fieldIndexFilterShared' => __('Shared', 'dbvc'),
                    'fieldIndexFilterRelated' => __('Related', 'dbvc'),
                    'fieldIndexFilterInspect' => __('Inspect-only', 'dbvc'),
                    'fieldIndexNoFilterResults' => __('No marked fields match this filter.', 'dbvc'),
                    'fieldIndexLocate' => __('Locate', 'dbvc'),
                    'fieldIndexOpen' => __('Open', 'dbvc'),
                    'fieldIndexNoFields' => __('No marked fields are available to review.', 'dbvc'),
                    'fieldIndexCurrentEntity' => __('Current entity', 'dbvc'),
                    'fieldIndexRelatedPosts' => __('Related posts', 'dbvc'),
                    'fieldIndexRelatedTerms' => __('Related terms', 'dbvc'),
                    'fieldIndexRelatedItems' => __('Related items', 'dbvc'),
                    'fieldIndexSharedOptions' => __('Shared options', 'dbvc'),
                    'fieldIndexSharedPosts' => __('Shared posts', 'dbvc'),
                    'fieldIndexSharedTerms' => __('Shared terms', 'dbvc'),
                    'fieldIndexSharedItems' => __('Shared items', 'dbvc'),
                    'fieldIndexArchiveFields' => __('Archive fields', 'dbvc'),
                    'fieldIndexInspectOnly' => __('Inspect-only fields', 'dbvc'),
                    'fieldIndexOtherFields' => __('Other fields', 'dbvc'),
                    'fieldIndexOptionFields' => __('Option fields', 'dbvc'),
                    'fieldIndexGeneralFields' => __('General fields', 'dbvc'),
                    'fieldIndexFieldFallback' => __('Field', 'dbvc'),
                    'fieldIndexSourceFallback' => __('Source', 'dbvc'),
                    'descriptorMissing' => __('Descriptor not found.', 'dbvc'),
                    'sessionMissing' => __('Visual Editor session not found for this page.', 'dbvc'),
                    'notEditable' => __('This field is not editable in the current MVP slice.', 'dbvc'),
                    'saveFailed' => __('Save failed.', 'dbvc'),
                    'saveSucceeded' => __('Saved successfully.', 'dbvc'),
                ],
            ]
        );
    }

    /**
     * @param array<string, mixed> $page_context
     * @return array<string, string>
     */
    private function buildCurrentEditLink(array $page_context)
    {
        $entity_type = isset($page_context['entityType']) ? sanitize_key((string) $page_context['entityType']) : '';
        $entity_id = isset($page_context['entityId']) ? absint($page_context['entityId']) : 0;
        $post_type = isset($page_context['postType']) ? sanitize_key((string) $page_context['postType']) : '';
        $taxonomy = isset($page_context['taxonomy']) ? sanitize_key((string) $page_context['taxonomy']) : '';

        if ($entity_type === 'post' && $entity_id > 0) {
            $url = get_edit_post_link($entity_id, '');

            if (is_string($url) && $url !== '') {
                return [
                    'url' => esc_url_raw($url),
                    'label' => $post_type === 'page'
                        ? __('Edit current page', 'dbvc')
                        : ($post_type === 'post' ? __('Edit current post', 'dbvc') : __('Edit current item', 'dbvc')),
                ];
            }
        }

        if ($entity_type === 'term' && $entity_id > 0 && $taxonomy !== '') {
            $url = get_edit_term_link($entity_id, $taxonomy, '');

            if (is_string($url) && $url !== '' && ! is_wp_error($url)) {
                return [
                    'url' => esc_url_raw($url),
                    'label' => __('Edit current term', 'dbvc'),
                ];
            }
        }

        return [];
    }

    /**
     * @param string $relative_path
     * @return string
     */
    private function resolveAssetVersion($relative_path)
    {
        $path = dirname($this->bootstrap_file) . '/' . ltrim((string) $relative_path, '/');
        $mtime = is_readable($path) ? filemtime($path) : false;

        if ($mtime !== false) {
            return (string) $mtime;
        }

        return defined('DBVC_PLUGIN_VERSION') ? DBVC_PLUGIN_VERSION : '1.0.0';
    }

    /**
     * @return bool
     */
    private function isMediaManagerEnabled()
    {
        return class_exists('\\DBVC_Visual_Editor_Addon')
            && method_exists('\\DBVC_Visual_Editor_Addon', 'is_media_manager_enabled')
            && \DBVC_Visual_Editor_Addon::is_media_manager_enabled();
    }

    /**
     * R3-C-2 — mirror of {@see isMediaManagerEnabled()}. The two-part kill switch
     * (master Visual Editor switch AND `dbvc_visual_editor_control_center_enabled`)
     * is enforced by `DBVC_Visual_Editor_Addon::is_control_center_enabled()`.
     *
     * @return bool
     */
    private function isControlCenterEnabled()
    {
        return class_exists('\\DBVC_Visual_Editor_Addon')
            && method_exists('\\DBVC_Visual_Editor_Addon', 'is_control_center_enabled')
            && \DBVC_Visual_Editor_Addon::is_control_center_enabled();
    }
}
