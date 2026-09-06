/*
 * DBVC Visual Editor — R3-C-2 Brand Control Center drawer.
 *
 * Production translation of the accepted static mockup at
 *   docs/ui-mockups/dbvc-visual-editor/r3-brand-control-center/
 *
 * Contract:
 * - Discovery-only surface. The drawer lists the registered controls the
 *   current user is allowed to see (list route from R3-C-1) and opens one
 *   row's authoritative descriptor into the existing main editor panel
 *   (open route from R3-C-1). It never mutates content itself.
 * - Rows carry ONLY `data-public-id` — no `data-owner-id`, `data-field-key`,
 *   `data-selector`, `data-path`, `data-descriptor`, or `data-token`
 *   (schematic §6 invariant 2, enforced in jsdom).
 * - Filtering is client-side in R3 — no round-trips on tab / chip / search
 *   changes. The list response's `items` array is the source of truth for
 *   the drawer's lifetime.
 * - When a row's Open action succeeds, the drawer dispatches
 *   `dbvc:visual-editor:absorb-descriptor` with the R3-C-1 payload
 *   ({descriptors, descriptorHydrations, token, publicId}). `overlay-app.js`
 *   listens for that event, merges the descriptor into the session, and
 *   opens the existing panel — same helpers the Shared Globals popover
 *   already uses, so the panel behaves identically regardless of entry
 *   point.
 * - The drawer stays open while the panel is up (drawer + panel coexist).
 */

( function () {
	'use strict';

	const DEFAULT_QUERY = Object.freeze( {
		search: '',
		category: 'all',
		// R4-C-2: separate axis so provider-mode's tab selection doesn't
		// stomp on category-mode's, and flipping view mode preserves the
		// previously-selected tab per axis.
		provider: 'all',
		status: '',
		priority: '',
		fieldFamily: '',
	} );
	const VIEW_MODES = Object.freeze( [ 'category', 'provider' ] );
	const LS_KEY_VIEW_MODE = 'dbvc.ve.control-center.view-mode';
	// R4-C-2: single JSON array of currently-expanded group keys. Groups
	// default to COLLAPSED; the persisted list records the deviations, so a
	// new fixture group appearing after localStorage was written still
	// collapses by default.
	const LS_KEY_EXPANDED_GROUPS = 'dbvc.ve.control-center.groups';
	const FORBIDDEN_ROW_ATTRS = Object.freeze( [
		'data-owner-id',
		'data-field-key',
		'data-selector',
		'data-path',
		'data-descriptor',
		'data-token',
	] );
	const state = {
		root: null,
		trigger: null,
		hasLoaded: false,
		requestSequence: 0,
		// R4-C-1a: `loading-initial` blanks the panel + spinner (first open);
		// `loading-refresh` keeps the current row list rendered under a dimmed
		// overlay while a query round-trip (search / family chip / retry) is
		// in flight; `success` / `error` are terminal.
		requestStatus: 'idle',
		items: [],
		query: Object.assign( {}, DEFAULT_QUERY ),
		activePublicId: '',
		// R4-D-1: track the token the drawer sent to the overlay so we can
		// gate the save-status-strip on matching saves only. A save fired
		// from the Shared Globals popover carries a different token and
		// must NOT surface a "Saved …" strip in the drawer.
		activeToken: '',
		openingPublicId: '',
		openErrors: {},
		// R4-D-1: transient strip shown briefly after a save on the
		// currently-opened drawer descriptor. Cleared by a fade timer.
		saveStatusStrip: null,
		saveStatusTimer: 0,
		// R4-C-1a: providerErrors is the R4-A list-controller's
		// `payload.providerErrors` map (`{providerId → {message}}`).
		// providerErrorsDismissed clears on close() — dismissal is
		// per-drawer-lifetime, not per-request.
		providerErrors: {},
		providerErrorsDismissed: false,
		searchTimer: 0,
		error: null,
		announcer: null,
		// R4-C-1b: per-publicId value-summary cache. Keys are publicIds;
		// values are: undefined (never requested), 'loading' (batch in
		// flight), null (backend returned null — empty slot), or an object
		// `{family, count, firstTitles, hasMore}` for
		// relationship/post_object. Cache persists for the drawer's
		// lifetime; a `close()` empties it so a fresh open re-hydrates.
		valueSummaries: null,
		// Lazy IntersectionObserver rooted on `.__table-wrap`. Null when IO
		// is unavailable (fallback: rows just show empty slots) or when the
		// drawer is closed.
		valueSummaryObserver: null,
		// Pending publicIds queued for the next batch flush. Deduped.
		valueSummaryPending: null,
		// 50ms debounce timer for the batch flush.
		valueSummaryFlushTimer: 0,
		// R4-C-2: 'category' (default) | 'provider'. Loaded from
		// localStorage on ensureRoot; persisted on every setViewMode. Wrapped
		// in try/catch so private-window / storage-blocked contexts fall
		// through to the in-memory default without erroring the drawer.
		viewMode: 'category',
		// R4-C-2: set of collapsed `{providerId}::{group}` keys. Loaded from
		// localStorage per-group on first render; persisted on every toggle.
		// Groups are collapsed by default at the render layer — this set
		// records DEVIATIONS from that default: it holds keys the viewer
		// explicitly EXPANDED (see R4-C-2 rendering path). Storing deviations
		// keeps localStorage cheap and makes the "default collapsed" claim
		// robust to new groups appearing in the fixture.
		expandedGroups: null,
	};

	function bootstrap() {
		return window.DBVCVisualEditorBootstrap || {};
	}

	function config() {
		const value = bootstrap().controlCenter;

		return value && typeof value === 'object' ? value : {};
	}

	function strings() {
		const value = bootstrap().strings;

		return value && typeof value === 'object' ? value : {};
	}

	function text( key, fallback ) {
		const value = strings()[ key ];

		return typeof value === 'string' && value ? value : fallback;
	}

	function templateText( key, fallback, values ) {
		let output = text( key, fallback );

		Object.keys( values || {} ).forEach( function ( name ) {
			output = output
				.split( '{' + name + '}' )
				.join( String( values[ name ] ) );
		} );

		return output;
	}

	function nonce() {
		const value = bootstrap().nonce;

		return typeof value === 'string' && value ? value : '';
	}

	function sessionId() {
		const value = bootstrap().sessionId;

		return typeof value === 'string' && value ? value : '';
	}

	function restBase() {
		const value = config().restBase;

		return typeof value === 'string' && value
			? value.replace( /\/+$/, '' )
			: '';
	}

	function createElement( tagName, className, content ) {
		const node = document.createElement( tagName );

		if ( className ) {
			node.className = className;
		}

		if ( typeof content === 'string' ) {
			node.textContent = content;
		}

		return node;
	}

	function sanitizeAttr( value ) {
		return String( value || '' );
	}

	function classifyPriority( value ) {
		const priority = sanitizeAttr( value ).toLowerCase();
		if ( priority === 'must' || priority === 'should' || priority === 'nice' ) {
			return priority;
		}
		return '';
	}

	function classifyFieldFamily( family ) {
		const value = sanitizeAttr( family ).toLowerCase();
		if (
			value === 'text' ||
			value === 'image' ||
			value === 'gallery' ||
			value === 'relationship' ||
			value === 'post_object' ||
			value === 'other'
		) {
			return value;
		}
		return 'other';
	}

	function classifyStatus( status ) {
		const value = sanitizeAttr( status ).toLowerCase();
		if (
			value === 'available' ||
			value === 'inspect_only' ||
			value === 'unsupported' ||
			value === 'unavailable'
		) {
			return value;
		}
		return 'unavailable';
	}

	function categoryLabel( slug ) {
		const key =
			'controlCenterCategory' +
			slug.charAt( 0 ).toUpperCase() +
			slug.slice( 1 );
		return text( key, slug ? slug.charAt( 0 ).toUpperCase() + slug.slice( 1 ) : text( 'controlCenterCategoryGeneral', 'General' ) );
	}

	function statusLabel( status ) {
		if ( status === 'available' ) {
			return text( 'controlCenterStatusAvailable', 'Available' );
		}
		if ( status === 'inspect_only' ) {
			return text( 'controlCenterStatusInspectOnly', 'View only' );
		}
		if ( status === 'unsupported' ) {
			return text( 'controlCenterStatusUnsupported', 'Unsupported' );
		}
		return text( 'controlCenterStatusUnavailable', 'Unavailable' );
	}

	function ownerHint( item ) {
		return templateText(
			'controlCenterOwnerHint',
			'{ownerType}/{ownerSubtype} · {fieldFamily}',
			{
				ownerType: sanitizeAttr( item.ownerType ),
				ownerSubtype: sanitizeAttr( item.ownerSubtype ),
				fieldFamily: sanitizeAttr( item.fieldFamily ),
			}
		);
	}

	// R4-A promotes priority into the top-level `sortKey` field as a numeric
	// prefix (`vertical_1_<fieldName>` = must, `_2_` = should, `_3_` = nice,
	// `_9_` = no priority). Shared Globals sortKeys start `shared_*` and do
	// not carry a priority tier. The pre-R4-A `item.priority` / meta.priority
	// fallback never populates against real R4-A data, so drop it.
	function priorityFromItem( item ) {
		if ( ! item || typeof item !== 'object' ) {
			return '';
		}
		const sortKey = sanitizeAttr( item.sortKey );
		if ( ! sortKey ) {
			return '';
		}
		const match = sortKey.match( /^[a-z0-9]+_([1-9])_/i );
		if ( ! match ) {
			return '';
		}
		if ( match[ 1 ] === '1' ) {
			return 'must';
		}
		if ( match[ 1 ] === '2' ) {
			return 'should';
		}
		if ( match[ 1 ] === '3' ) {
			return 'nice';
		}
		return '';
	}

	function categoriesFromItems( items ) {
		const counts = {};
		items.forEach( function ( item ) {
			const category = sanitizeAttr( item.category ).toLowerCase() || 'general';
			counts[ category ] = ( counts[ category ] || 0 ) + 1;
		} );
		const ordered = Object.keys( counts ).sort();
		return ordered.map( function ( slug ) {
			return { slug, count: counts[ slug ] };
		} );
	}

	// R4-C-1a mixed filter model:
	// - `family` + `search` are server-side (see loadControls → listUrl); this
	//   function no longer branches on them because the response is already
	//   filtered.
	// - `category`, `status`, `priority` stay client-side so tab counts stay
	//   cheap (no second unfiltered request) and priority derivation lives in
	//   the drawer (backend has no priority param).
	function itemMatchesFilters( item ) {
		const query = state.query;
		const category = sanitizeAttr( item.category ).toLowerCase() || 'general';
		const status = classifyStatus( item.status );
		const priority = priorityFromItem( item );

		// R4-C-2: tab axis follows view mode. Category mode filters on
		// `record.category`; provider mode filters on the publicId prefix.
		if ( state.viewMode === 'provider' ) {
			if ( query.provider && query.provider !== 'all' ) {
				const providerId = providerIdFromPublicId( item.publicId );
				if ( providerId !== query.provider ) {
					return false;
				}
			}
		} else if ( query.category !== 'all' && category !== query.category ) {
			return false;
		}
		if ( query.status && status !== query.status ) {
			return false;
		}
		if ( query.priority && priority !== query.priority ) {
			return false;
		}
		return true;
	}

	function filteredItems() {
		return state.items.filter( itemMatchesFilters );
	}

	function ensureRoot() {
		if ( state.root && state.root.isConnected ) {
			return state.root;
		}

		// R4-C-2: rehydrate view-mode + expanded-groups preferences from
		// localStorage on the drawer's first open in this browsing session.
		// Both reads are try/catch-wrapped inside their loaders so a
		// private-window / storage-blocked context falls through to the
		// in-memory defaults without erroring the drawer.
		state.viewMode = loadStoredViewMode();
		state.expandedGroups = loadStoredExpandedGroups();

		let root = document.getElementById( 'dbvc-ve-control-center' );

		if ( ! root ) {
			root = createElement( 'aside', 'dbvc-ve-control-center' );
			root.id = 'dbvc-ve-control-center';
			root.setAttribute( 'role', 'complementary' );
			root.setAttribute( 'aria-labelledby', 'dbvc-ve-control-center-title' );
			root.hidden = true;
			root.appendChild( createHeader() );
			root.appendChild( createTabs() );
			root.appendChild( createFilters() );
			root.appendChild( createTableWrap() );
			root.appendChild( createAnnouncer() );
			root.appendChild( createFooter() );
			document.body.appendChild( root );
		}

		state.root = root;
		state.announcer = root.querySelector(
			'[data-dbvc-ve-control-center-announcer]'
		);
		bindEventListeners( root );
		return root;
	}

	function createHeader() {
		const header = createElement( 'header', 'dbvc-ve-control-center__header' );
		const icon = createElement( 'span', 'dbvc-ve-control-center__header-icon' );
		icon.setAttribute( 'aria-hidden', 'true' );
		icon.textContent = '▤';
		const titleBlock = createElement(
			'div',
			'dbvc-ve-control-center__title-block'
		);
		const title = createElement(
			'h2',
			'dbvc-ve-control-center__title',
			text( 'controlCenterTitle', 'Global Brand Controls' )
		);
		title.id = 'dbvc-ve-control-center-title';
		const summary = createElement(
			'span',
			'dbvc-ve-control-center__summary-chip'
		);
		summary.setAttribute( 'data-dbvc-ve-control-center-summary', '1' );
		titleBlock.appendChild( title );
		titleBlock.appendChild( summary );
		// R4-C-2: header segmented view-mode toggle sits between the title
		// block and the close button. Arrow-key nav happens on the tablist
		// container itself (see `handleViewToggleKeydown` below). Wrapped in
		// role="tablist" per the mockup DESIGN-DECISIONS §7 accessibility
		// note; a11y disambiguation vs the category tablist is provided by
		// distinct `aria-label`s.
		const viewToggle = createElement(
			'div',
			'dbvc-ve-control-center__view-toggle'
		);
		viewToggle.setAttribute( 'role', 'tablist' );
		viewToggle.setAttribute(
			'aria-label',
			text( 'controlCenterViewToggleLabel', 'Category view' )
		);
		viewToggle.setAttribute(
			'data-dbvc-ve-control-center-view-toggle',
			'1'
		);
		[
			{
				mode: 'category',
				label: text( 'controlCenterViewByCategory', 'By category' ),
			},
			{
				mode: 'provider',
				label: text( 'controlCenterViewByProvider', 'By provider' ),
			},
		].forEach( function ( option ) {
			const button = createElement(
				'button',
				'dbvc-ve-control-center__view-toggle-option',
				option.label
			);
			button.type = 'button';
			button.setAttribute( 'role', 'tab' );
			button.setAttribute( 'aria-selected', 'false' );
			button.setAttribute( 'data-view-mode', option.mode );
			button.setAttribute(
				'data-dbvc-ve-control-center-action',
				'set-view-mode'
			);
			viewToggle.appendChild( button );
		} );

		const close = createElement(
			'button',
			'dbvc-ve-control-center__close',
			'×'
		);
		close.type = 'button';
		close.setAttribute(
			'aria-label',
			text( 'controlCenterClose', 'Close Global Brand Control Center' )
		);
		close.setAttribute( 'data-dbvc-ve-control-center-action', 'close' );
		header.appendChild( icon );
		header.appendChild( titleBlock );
		header.appendChild( viewToggle );
		header.appendChild( close );
		return header;
	}

	function renderViewToggle() {
		if ( ! state.root ) {
			return;
		}
		const toggle = state.root.querySelector(
			'[data-dbvc-ve-control-center-view-toggle]'
		);
		if ( ! toggle ) {
			return;
		}
		Array.from(
			toggle.querySelectorAll( '[data-view-mode]' )
		).forEach( function ( button ) {
			const mode = button.getAttribute( 'data-view-mode' ) || '';
			button.setAttribute(
				'aria-selected',
				mode === state.viewMode ? 'true' : 'false'
			);
			button.tabIndex = mode === state.viewMode ? 0 : -1;
		} );
	}

	function createTabs() {
		const tabs = createElement( 'div', 'dbvc-ve-control-center__tabs' );
		tabs.setAttribute( 'role', 'tablist' );
		tabs.setAttribute(
			'aria-label',
			text( 'controlCenterTablist', 'Category' )
		);
		tabs.setAttribute( 'data-dbvc-ve-control-center-tablist', '1' );
		return tabs;
	}

	function createFilters() {
		const filters = createElement( 'div', 'dbvc-ve-control-center__filters' );
		filters.setAttribute( 'data-dbvc-ve-control-center-filters', '1' );

		const searchLabel = createElement(
			'label',
			'dbvc-ve-control-center__sr-only',
			text( 'controlCenterSearchLabel', 'Search controls' )
		);
		searchLabel.setAttribute( 'for', 'dbvc-ve-control-center-search' );

		// R4-C-2: search-wrap gives the input a leading search glyph and a
		// trailing Clear button that fades in only when the input has a
		// value. The clear button posts a `clear-search` action; the same
		// path the debounce fires (loadControls with `reason: 'query'`).
		const searchWrap = createElement(
			'div',
			'dbvc-ve-control-center__search-wrap'
		);
		const searchIcon = createElement(
			'span',
			'dbvc-ve-control-center__search-icon'
		);
		searchIcon.setAttribute( 'aria-hidden', 'true' );
		searchIcon.textContent = '⌕';

		const search = createElement( 'input', 'dbvc-ve-control-center__search' );
		search.type = 'search';
		search.id = 'dbvc-ve-control-center-search';
		search.maxLength = 100;
		search.placeholder = text(
			'controlCenterSearchPlaceholder',
			'Search labels, descriptions, owner…'
		);
		search.setAttribute( 'data-dbvc-ve-control-center-query', 'search' );

		const searchClear = createElement(
			'button',
			'dbvc-ve-control-center__search-clear',
			'×'
		);
		searchClear.type = 'button';
		searchClear.setAttribute(
			'aria-label',
			text( 'controlCenterClearSearch', 'Clear search' )
		);
		searchClear.setAttribute(
			'data-dbvc-ve-control-center-action',
			'clear-search'
		);
		searchClear.hidden = true;

		searchWrap.appendChild( searchIcon );
		searchWrap.appendChild( search );
		searchWrap.appendChild( searchClear );

		filters.appendChild( searchLabel );
		filters.appendChild( searchWrap );
		filters.appendChild(
			createChipRow(
				'status',
				text( 'controlCenterStatusLabel', 'Status' ),
				[
					{
						value: 'available',
						label: text( 'controlCenterStatusAvailable', 'Available' ),
					},
					{
						value: 'inspect_only',
						label: text( 'controlCenterStatusInspectOnly', 'View only' ),
					},
					{
						value: 'unsupported',
						label: text( 'controlCenterStatusUnsupported', 'Unsupported' ),
					},
					{
						value: 'unavailable',
						label: text( 'controlCenterStatusUnavailable', 'Unavailable' ),
					},
				]
			)
		);
		filters.appendChild(
			createChipRow(
				'priority',
				text( 'controlCenterPriorityLabel', 'Priority' ),
				[
					{ value: 'must', label: 'Must' },
					{ value: 'should', label: 'Should' },
					{ value: 'nice', label: 'Nice' },
				]
			)
		);
		filters.appendChild(
			createChipRow(
				'fieldFamily',
				text( 'controlCenterFieldLabel', 'Field' ),
				[
					{ value: 'image', label: 'Image' },
					{ value: 'gallery', label: 'Gallery' },
					{ value: 'relationship', label: 'Relationship' },
					{ value: 'post_object', label: 'Post' },
					{ value: 'other', label: 'Other' },
				]
			)
		);

		const clear = createElement(
			'button',
			'dbvc-ve-control-center__clear-filters',
			text( 'controlCenterClearFilters', 'Clear filters' )
		);
		clear.type = 'button';
		clear.setAttribute(
			'data-dbvc-ve-control-center-action',
			'clear-filters'
		);
		clear.hidden = true;
		filters.appendChild( clear );

		return filters;
	}

	function createChipRow( axis, label, chips ) {
		const row = createElement( 'div', 'dbvc-ve-control-center__chip-row' );
		row.setAttribute( 'role', 'group' );
		row.setAttribute( 'aria-label', label + ' filter' );
		const labelNode = createElement(
			'span',
			'dbvc-ve-control-center__chip-label',
			label
		);
		row.appendChild( labelNode );
		chips.forEach( function ( chip ) {
			const button = createElement(
				'button',
				'dbvc-ve-control-center__chip',
				chip.label
			);
			button.type = 'button';
			button.setAttribute( 'aria-pressed', 'false' );
			button.setAttribute(
				'data-dbvc-ve-control-center-chip',
				axis
			);
			button.setAttribute( 'data-value', chip.value );
			row.appendChild( button );
		} );
		return row;
	}

	function createTableWrap() {
		const wrap = createElement(
			'div',
			'dbvc-ve-control-center__table-wrap'
		);
		wrap.setAttribute( 'data-dbvc-ve-control-center-table-wrap', '1' );
		const table = createElement( 'table', 'dbvc-ve-control-center__table' );
		table.setAttribute( 'role', 'table' );
		const thead = createElement( 'thead', 'dbvc-ve-control-center__thead' );
		const headerRow = document.createElement( 'tr' );
		const th1 = createElement(
			'th',
			'dbvc-ve-control-center__th',
			text( 'controlCenterTitle', 'Global Brand Controls' )
		);
		th1.scope = 'col';
		th1.textContent = 'Control';
		const th2 = createElement(
			'th',
			'dbvc-ve-control-center__th dbvc-ve-control-center__th--action'
		);
		th2.scope = 'col';
		const th2Label = createElement(
			'span',
			'dbvc-ve-control-center__sr-only',
			'Actions'
		);
		th2.appendChild( th2Label );
		headerRow.appendChild( th1 );
		headerRow.appendChild( th2 );
		thead.appendChild( headerRow );
		// R4-C-2: rows now live inside per-group `<tbody class="__group">`
		// elements built by renderList. The R3-C-2 single sentinel tbody
		// is dropped — panel state renders inside the `.__table-wrap`, not
		// the table.
		table.appendChild( thead );
		wrap.appendChild( table );
		return wrap;
	}

	function clearTableTbodies( wrap ) {
		if ( ! wrap ) {
			return;
		}
		const tbodies = wrap.querySelectorAll(
			'.dbvc-ve-control-center__table tbody'
		);
		tbodies.forEach( function ( tb ) {
			if ( tb.parentNode ) {
				tb.parentNode.removeChild( tb );
			}
		} );
	}

	// R4-C-2: build groups from visible items, keyed on
	// `{providerId}::{record.group}` (falls back to 'other' when group is
	// empty). Preserves first-appearance order — the R4-A registry sorts
	// globally by `sortKey → label → publicId`, so first appearance
	// matches server order.
	function buildGroupsFromVisible( visible ) {
		const order = [];
		const map = Object.create( null );
		visible.forEach( function ( item ) {
			const providerId =
				providerIdFromPublicId( item.publicId ) || 'unknown';
			const rawGroup = sanitizeAttr( item.group );
			const groupName =
				rawGroup ||
				text( 'controlCenterGroupUnnamed', 'Other' );
			const groupKey = providerId + '::' + groupName;
			if ( ! map[ groupKey ] ) {
				map[ groupKey ] = {
					key: groupKey,
					title: groupName,
					providerId,
					items: [],
				};
				order.push( groupKey );
			}
			map[ groupKey ].items.push( item );
		} );
		return order.map( function ( key ) {
			return map[ key ];
		} );
	}

	function renderGroupTbody( group ) {
		const tbody = document.createElement( 'tbody' );
		tbody.className = 'dbvc-ve-control-center__group';
		tbody.setAttribute( 'data-group-key', group.key );
		tbody.setAttribute( 'data-provider-id', group.providerId );
		const isExpanded = Boolean(
			state.expandedGroups && state.expandedGroups[ group.key ]
		);
		if ( ! isExpanded ) {
			tbody.classList.add( 'is-collapsed' );
		}
		tbody.appendChild( renderGroupHeaderRow( group, isExpanded ) );
		group.items.forEach( function ( item ) {
			tbody.appendChild( renderRow( item ) );
			if ( state.openErrors[ item.publicId ] ) {
				tbody.appendChild( renderRowNotice( item ) );
			}
		} );
		return tbody;
	}

	function renderGroupHeaderRow( group, isExpanded ) {
		const row = createElement( 'tr', 'dbvc-ve-control-center__group-header' );
		const cell = createElement(
			'td',
			'dbvc-ve-control-center__group-header-cell'
		);
		cell.colSpan = 2;
		const toggle = createElement(
			'button',
			'dbvc-ve-control-center__group-toggle'
		);
		toggle.type = 'button';
		toggle.setAttribute( 'aria-expanded', isExpanded ? 'true' : 'false' );
		toggle.setAttribute(
			'data-dbvc-ve-control-center-action',
			'toggle-group'
		);
		toggle.setAttribute( 'data-group-key', group.key );
		toggle.setAttribute(
			'aria-label',
			isExpanded
				? text( 'controlCenterGroupCollapse', 'Collapse group' )
				: text( 'controlCenterGroupExpand', 'Expand group' )
		);
		const chevron = createElement(
			'span',
			'dbvc-ve-control-center__group-toggle-icon'
		);
		chevron.setAttribute( 'aria-hidden', 'true' );
		chevron.textContent = '›';
		toggle.appendChild( chevron );
		toggle.appendChild(
			createElement(
				'span',
				'dbvc-ve-control-center__group-title',
				group.title
			)
		);
		toggle.appendChild(
			createElement(
				'span',
				'dbvc-ve-control-center__group-count',
				templateText(
					'controlCenterGroupControlsCount',
					'{count} controls',
					{ count: group.items.length }
				)
			)
		);
		cell.appendChild( toggle );
		row.appendChild( cell );
		return row;
	}

	function createAnnouncer() {
		const announcer = createElement(
			'p',
			'dbvc-ve-control-center__sr-only'
		);
		announcer.setAttribute( 'role', 'status' );
		announcer.setAttribute( 'aria-live', 'polite' );
		announcer.setAttribute( 'aria-atomic', 'true' );
		announcer.setAttribute( 'data-dbvc-ve-control-center-announcer', '1' );
		return announcer;
	}

	function createFooter() {
		const footer = createElement( 'footer', 'dbvc-ve-control-center__footer' );
		footer.setAttribute( 'data-dbvc-ve-control-center-footer', '1' );
		return footer;
	}

	function announce( message ) {
		if ( state.announcer ) {
			state.announcer.textContent = String( message || '' );
		}
	}

	function bindEventListeners( root ) {
		if ( root.dataset.controlCenterBound === '1' ) {
			return;
		}
		root.dataset.controlCenterBound = '1';
		root.addEventListener( 'click', handleClick );
		root.addEventListener( 'input', handleInput );
	}

	function handleClick( event ) {
		const target = event.target;
		if ( ! target || typeof target.closest !== 'function' ) {
			return;
		}

		const chip = target.closest( '[data-dbvc-ve-control-center-chip]' );
		if ( chip ) {
			event.preventDefault();
			toggleChip( chip );
			return;
		}

		const action = target.closest(
			'[data-dbvc-ve-control-center-action]'
		);
		if ( ! action ) {
			return;
		}

		const name = action.getAttribute(
			'data-dbvc-ve-control-center-action'
		);
		event.preventDefault();

		if ( name === 'close' ) {
			close( { restoreFocus: true } );
		} else if ( name === 'open' ) {
			openRow( action.getAttribute( 'data-public-id' ) || '' );
		} else if ( name === 'clear-filters' ) {
			clearFilters();
		} else if ( name === 'clear-search' ) {
			clearSearchInput();
		} else if ( name === 'dismiss-notice' ) {
			dismissOpenError( action.getAttribute( 'data-public-id' ) || '' );
		} else if ( name === 'dismiss-provider-error' ) {
			dismissProviderErrors();
		} else if ( name === 'retry' ) {
			loadControls( { reason: 'retry' } );
		} else if ( name === 'select-tab' ) {
			// R4-C-2: the tab's data attribute is view-mode dependent —
			// category-mode carries `data-category` (preserved from R3-C-2
			// for jsdom / real-browser test compatibility), provider-mode
			// carries `data-provider`. Either way `data-tab-slug` is the
			// generic alias the handler reads.
			selectTab(
				action.getAttribute( 'data-tab-slug' ) ||
					action.getAttribute( 'data-category' ) ||
					action.getAttribute( 'data-provider' ) ||
					'all'
			);
		} else if ( name === 'set-view-mode' ) {
			setViewMode( action.getAttribute( 'data-view-mode' ) || 'category' );
		} else if ( name === 'toggle-group' ) {
			toggleGroup( action.getAttribute( 'data-group-key' ) || '' );
		}
	}

	function dismissProviderErrors() {
		if ( state.providerErrorsDismissed ) {
			return;
		}
		state.providerErrorsDismissed = true;
		renderList();
	}

	// ------------------------------------------------------------------
	// R4-C-2: view-mode toggle + collapsible group persistence
	// ------------------------------------------------------------------
	//
	// Both preferences live in `localStorage`, wrapped in try/catch so a
	// private window / storage-blocked context falls through to the
	// in-memory default without erroring the drawer. Reads happen once at
	// `ensureRoot()`; writes happen on every user action.

	function readStoredString( key ) {
		try {
			const raw = window.localStorage.getItem( key );
			return typeof raw === 'string' ? raw : '';
		} catch ( _err ) {
			return '';
		}
	}

	function writeStoredString( key, value ) {
		try {
			window.localStorage.setItem( key, String( value ) );
		} catch ( _err ) {
			/* private window / quota / permission — drop silently */
		}
	}

	function loadStoredViewMode() {
		const raw = readStoredString( LS_KEY_VIEW_MODE );
		return VIEW_MODES.indexOf( raw ) === -1 ? 'category' : raw;
	}

	function loadStoredExpandedGroups() {
		const raw = readStoredString( LS_KEY_EXPANDED_GROUPS );
		if ( ! raw ) {
			return {};
		}
		try {
			const parsed = JSON.parse( raw );
			if ( ! Array.isArray( parsed ) ) {
				return {};
			}
			const out = {};
			parsed.forEach( function ( entry ) {
				if ( typeof entry === 'string' && entry ) {
					out[ entry ] = true;
				}
			} );
			return out;
		} catch ( _err ) {
			return {};
		}
	}

	function persistExpandedGroups() {
		if ( ! state.expandedGroups ) {
			return;
		}
		writeStoredString(
			LS_KEY_EXPANDED_GROUPS,
			JSON.stringify( Object.keys( state.expandedGroups ) )
		);
	}

	function setViewMode( mode ) {
		if ( VIEW_MODES.indexOf( mode ) === -1 || state.viewMode === mode ) {
			return;
		}
		// R4-C-2: focus continuity across a view-mode flip. Snapshot the
		// currently-focused row's publicId so the re-render can put focus
		// back on the same row's Open button in the new layout.
		const doc = state.root ? state.root.ownerDocument : document;
		const activeElement = doc.activeElement;
		let focusedPublicId = '';
		if (
			activeElement &&
			typeof activeElement.closest === 'function' &&
			activeElement.closest( '.dbvc-ve-control-center__row' )
		) {
			focusedPublicId =
				activeElement
					.closest( '.dbvc-ve-control-center__row' )
					.getAttribute( 'data-public-id' ) || '';
		}
		state.viewMode = mode;
		writeStoredString( LS_KEY_VIEW_MODE, mode );
		renderList();
		if ( focusedPublicId && state.root ) {
			const restored = state.root.querySelector(
				'.dbvc-ve-control-center__row[data-public-id="' +
					cssEscape( focusedPublicId ) +
					'"] .dbvc-ve-control-center__action, ' +
					'.dbvc-ve-control-center__row[data-public-id="' +
					cssEscape( focusedPublicId ) +
					'"] .dbvc-ve-control-center__action--view'
			);
			if ( restored && typeof restored.focus === 'function' ) {
				restored.focus();
			}
		}
	}

	function toggleGroup( groupKey ) {
		if ( ! groupKey ) {
			return;
		}
		if ( ! state.expandedGroups ) {
			state.expandedGroups = {};
		}
		if ( state.expandedGroups[ groupKey ] ) {
			delete state.expandedGroups[ groupKey ];
		} else {
			state.expandedGroups[ groupKey ] = true;
		}
		persistExpandedGroups();
		renderList();
	}

	function clearSearchInput() {
		if ( state.query.search === '' ) {
			return;
		}
		state.query.search = '';
		if ( state.root ) {
			const search = state.root.querySelector(
				'[data-dbvc-ve-control-center-query="search"]'
			);
			if ( search ) {
				search.value = '';
			}
		}
		window.clearTimeout( state.searchTimer );
		state.searchTimer = 0;
		loadControls( { reason: 'query' } );
	}

	function providerIdFromPublicId( publicId ) {
		const raw = String( publicId || '' );
		const idx = raw.indexOf( ':' );
		return idx === -1 ? '' : raw.slice( 0, idx );
	}

	function providerLabel( slug ) {
		if ( slug === 'shared_globals' ) {
			return text( 'controlCenterProviderShared', 'Shared Globals' );
		}
		if ( slug === 'vertical' ) {
			return text( 'controlCenterProviderVertical', 'Vertical' );
		}
		if ( ! slug ) {
			return text( 'controlCenterProviderUnknown', 'Other' );
		}
		return slug
			.split( '_' )
			.map( function ( part ) {
				return part.charAt( 0 ).toUpperCase() + part.slice( 1 );
			} )
			.join( ' ' );
	}

	function providersFromItems( items ) {
		const counts = {};
		items.forEach( function ( item ) {
			const providerId = providerIdFromPublicId( item.publicId ) || 'unknown';
			counts[ providerId ] = ( counts[ providerId ] || 0 ) + 1;
		} );
		return Object.keys( counts )
			.sort()
			.map( function ( slug ) {
				return { slug, count: counts[ slug ] };
			} );
	}

	// R4-D-1: fade duration for the save-status-strip. Held briefly, then
	// removed from the DOM. Reduced-motion viewers get the same total
	// duration but the CSS transition itself is suppressed.
	const SAVE_STATUS_STRIP_MS = 2500;

	function handlePanelSaved( event ) {
		const detail =
			event && event.detail && typeof event.detail === 'object'
				? event.detail
				: {};
		const token =
			typeof detail.token === 'string' && detail.token ? detail.token : '';
		if ( ! token || token !== state.activeToken ) {
			return; // save was for a descriptor the drawer did not open
		}
		const publicId = state.activePublicId;
		if ( ! publicId ) {
			return;
		}
		const label = labelForPublicId( publicId );
		state.saveStatusStrip = { label };
		window.clearTimeout( state.saveStatusTimer );
		state.saveStatusTimer = window.setTimeout( function () {
			state.saveStatusStrip = null;
			state.saveStatusTimer = 0;
			renderSaveStatusStrip();
		}, SAVE_STATUS_STRIP_MS );
		renderSaveStatusStrip();
		announce(
			templateText(
				'controlCenterSaveStatus',
				'Saved {label}.',
				{ label }
			)
		);
	}

	function renderSaveStatusStrip() {
		if ( ! state.root ) {
			return;
		}
		const wrap = state.root.querySelector(
			'[data-dbvc-ve-control-center-table-wrap]'
		);
		if ( ! wrap ) {
			return;
		}
		const existing = state.root.querySelector(
			'[data-dbvc-ve-control-center-save-status-strip]'
		);
		if ( ! state.saveStatusStrip ) {
			if ( existing && existing.parentNode ) {
				existing.parentNode.removeChild( existing );
			}
			return;
		}
		const message = templateText(
			'controlCenterSaveStatus',
			'Saved {label}.',
			{ label: sanitizeAttr( state.saveStatusStrip.label ) }
		);
		if ( existing ) {
			existing.textContent = message;
			return;
		}
		const strip = createElement(
			'div',
			'dbvc-ve-control-center__save-status-strip',
			message
		);
		strip.setAttribute(
			'data-dbvc-ve-control-center-save-status-strip',
			'1'
		);
		// The single polite live region (announcer) already announced this
		// save — the strip is a persistent visual affordance, not a
		// second announcement. Explicit aria-hidden keeps AT from
		// double-announcing.
		strip.setAttribute( 'aria-hidden', 'true' );
		// Insert at the top of the table wrap so the strip stays visible
		// as rows scroll.
		if ( wrap.firstChild ) {
			wrap.insertBefore( strip, wrap.firstChild );
		} else {
			wrap.appendChild( strip );
		}
	}

	function tabAxisForViewMode() {
		return state.viewMode === 'provider' ? 'provider' : 'category';
	}

	function tabEntriesForViewMode( items ) {
		return state.viewMode === 'provider'
			? providersFromItems( items )
			: categoriesFromItems( items );
	}

	function tabLabelForViewMode( slug ) {
		return state.viewMode === 'provider'
			? providerLabel( slug )
			: categoryLabel( slug );
	}

	// ------------------------------------------------------------------
	// R4-C-1b: value-summary batch loader
	// ------------------------------------------------------------------
	//
	// R4-A's list route omits the per-row value summary; the drawer fetches
	// them lazily via `POST .../control-center/value-summaries` in batches
	// of up to 20 as rows scroll into view (D-064). One IntersectionObserver
	// (rooted on the table-wrap) watches every `available` row whose
	// publicId has not been hydrated; intersections push into a 50ms
	// batched flush queue.
	//
	// Cache discipline: `state.valueSummaries[publicId]` records
	// 'loading' (in flight) → summary object | null (fetched). A cached
	// entry short-circuits re-hydration on re-enter, so scrolling back and
	// forth does not thrash the endpoint.
	//
	// Graceful degrade: if `IntersectionObserver` is unavailable the loader
	// simply never observes anything and rows render as empty slots. No
	// fallback fetch — the drawer is not expected to run in an environment
	// without IO.

	function ensureValueSummaryState() {
		if ( ! state.valueSummaries ) {
			state.valueSummaries = {};
		}
		if ( ! state.valueSummaryPending ) {
			state.valueSummaryPending = [];
		}
	}

	function ensureValueSummaryObserver( wrap ) {
		ensureValueSummaryState();
		if ( state.valueSummaryObserver ) {
			return state.valueSummaryObserver;
		}
		if ( typeof window.IntersectionObserver !== 'function' ) {
			return null;
		}
		state.valueSummaryObserver = new window.IntersectionObserver(
			handleValueSummaryIntersect,
			{ root: wrap || null, threshold: 0 }
		);
		return state.valueSummaryObserver;
	}

	function teardownValueSummaryObserver() {
		if ( state.valueSummaryObserver ) {
			try {
				state.valueSummaryObserver.disconnect();
			} catch ( _err ) {
				/* jsdom fallbacks may throw — safe to ignore. */
			}
			state.valueSummaryObserver = null;
		}
		if ( state.valueSummaryFlushTimer ) {
			window.clearTimeout( state.valueSummaryFlushTimer );
			state.valueSummaryFlushTimer = 0;
		}
		if ( state.valueSummaryPending ) {
			state.valueSummaryPending.length = 0;
		}
	}

	function handleValueSummaryIntersect( entries ) {
		if ( ! entries || ! entries.length ) {
			return;
		}
		ensureValueSummaryState();
		let queued = false;
		entries.forEach( function ( entry ) {
			if ( ! entry.isIntersecting || ! entry.target ) {
				return;
			}
			const publicId = entry.target.getAttribute
				? entry.target.getAttribute( 'data-public-id' ) || ''
				: '';
			if ( ! publicId ) {
				return;
			}
			// Unobserve immediately — one hydration attempt per row per
			// drawer lifetime is enough (cache handles re-enter).
			if ( state.valueSummaryObserver ) {
				try {
					state.valueSummaryObserver.unobserve( entry.target );
				} catch ( _err ) {
					/* ignore */
				}
			}
			if (
				Object.prototype.hasOwnProperty.call(
					state.valueSummaries,
					publicId
				)
			) {
				return; // already fetched or fetching
			}
			if ( state.valueSummaryPending.indexOf( publicId ) !== -1 ) {
				return; // already queued
			}
			state.valueSummaryPending.push( publicId );
			queued = true;
		} );
		if ( queued ) {
			scheduleValueSummaryFlush();
		}
	}

	function scheduleValueSummaryFlush() {
		if ( state.valueSummaryFlushTimer ) {
			return;
		}
		state.valueSummaryFlushTimer = window.setTimeout( function () {
			state.valueSummaryFlushTimer = 0;
			flushValueSummaries();
		}, 50 );
	}

	function valueSummariesUrl() {
		return (
			restBase() +
			'/session/' +
			encodeURIComponent( sessionId() ) +
			'/control-center/value-summaries'
		);
	}

	function flushValueSummaries() {
		ensureValueSummaryState();
		if ( ! state.valueSummaryPending.length ) {
			return;
		}
		if ( ! sessionId() ) {
			state.valueSummaryPending.length = 0;
			return;
		}
		// Batch cap 20 (D-064: server hard-caps at 50; the drawer's flush
		// window keeps it well under so a single scroll never spikes the
		// endpoint). Remaining publicIds stay queued for the next flush.
		const batch = state.valueSummaryPending.splice( 0, 20 );
		batch.forEach( function ( publicId ) {
			state.valueSummaries[ publicId ] = 'loading';
		} );
		if ( state.valueSummaryPending.length ) {
			scheduleValueSummaryFlush();
		}
		window
			.fetch( valueSummariesUrl(), {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'X-WP-Nonce': nonce(),
				},
				body: JSON.stringify( { publicIds: batch } ),
			} )
			.then( async function ( response ) {
				const payload = await response.json().catch( function () {
					return null;
				} );
				const summaries =
					payload &&
					payload.ok === true &&
					payload.summaries &&
					typeof payload.summaries === 'object'
						? payload.summaries
						: {};
				batch.forEach( function ( publicId ) {
					const summary = Object.prototype.hasOwnProperty.call(
						summaries,
						publicId
					)
						? summaries[ publicId ]
						: null;
					state.valueSummaries[ publicId ] = summary || null;
					patchValueSummarySlot( publicId );
				} );
			} )
			.catch( function () {
				// Fail-soft — on network failure, drop the batch entries to
				// null so the row renders an empty slot and does not sit
				// stuck on the loading state. The row is not re-queued —
				// that would risk a retry loop against a broken endpoint.
				batch.forEach( function ( publicId ) {
					state.valueSummaries[ publicId ] = null;
					patchValueSummarySlot( publicId );
				} );
			} );
	}

	// Surgical DOM patch — only touches the affected row's summary slot.
	// A full renderList would blow away focus state + drop the observer
	// registrations. Mirrors Media Manager R2-E3's per-row patch pattern.
	function patchValueSummarySlot( publicId ) {
		if ( ! state.root ) {
			return;
		}
		const slot = state.root.querySelector(
			'.dbvc-ve-control-center__value-summary[data-public-id="' +
				cssEscape( publicId ) +
				'"]'
		);
		if ( ! slot ) {
			return;
		}
		while ( slot.firstChild ) {
			slot.removeChild( slot.firstChild );
		}
		const summary = state.valueSummaries[ publicId ];
		if ( ! summary || typeof summary !== 'object' ) {
			return; // null / 'loading' → empty slot
		}
		const chip = renderValueSummaryChip( summary );
		if ( chip ) {
			slot.appendChild( chip );
		}
	}

	// Per-family dispatcher (mockup COMPONENT-NOTES §3). R4-C-1b renders
	// relationship + post_object; R5.1-a adds text (text/textarea/url/
	// email/number all collapse to family='text' at the provider). Every
	// other family / null returns no chip (empty slot) until an R5.2+
	// family factory ships.
	function renderValueSummaryChip( summary ) {
		if ( ! summary || typeof summary !== 'object' ) {
			return null;
		}
		const family = sanitizeAttr( summary.family );
		if ( family === 'relationship' || family === 'post_object' ) {
			const chip = createElement(
				'span',
				'dbvc-ve-control-center__value-relationship'
			);
			const rawCount = Number( summary.count );
			const count = Number.isFinite( rawCount ) && rawCount >= 0
				? Math.floor( rawCount )
				: 0;
			const titles = Array.isArray( summary.firstTitles )
				? summary.firstTitles
						.filter( function ( part ) {
							return typeof part === 'string' && part;
						} )
						.slice( 0, 3 )
				: [];
			if ( titles.length ) {
				chip.setAttribute( 'title', titles.join( ', ' ) );
			}
			const strong = createElement( 'strong', '', String( count ) );
			chip.appendChild( strong );
			chip.appendChild(
				document.createTextNode(
					' ' +
						text(
							'controlCenterValueRelationshipConnected',
							'connected'
						)
				)
			);
			return chip;
		}
		if ( family === 'choice' ) {
			// R5.2-a: single-choice → label chip; multi-choice
			// (checkbox) → `<strong>N</strong> selected` with first-3
			// labels as a title tooltip, mirroring the relationship shape.
			const firstLabels = Array.isArray( summary.firstLabels )
				? summary.firstLabels
						.filter( function ( part ) {
							return typeof part === 'string' && part;
						} )
						.slice( 0, 3 )
				: [];
			const rawCount = Number( summary.count );
			const count = Number.isFinite( rawCount ) && rawCount >= 0
				? Math.floor( rawCount )
				: 0;
			if ( count > 0 || firstLabels.length > 0 ) {
				const chip = createElement(
					'span',
					'dbvc-ve-control-center__value-choice'
				);
				if ( firstLabels.length ) {
					chip.setAttribute( 'title', firstLabels.join( ', ' ) );
				}
				const strong = createElement(
					'strong',
					'',
					String( count )
				);
				chip.appendChild( strong );
				chip.appendChild(
					document.createTextNode(
						' ' +
							text(
								'controlCenterValueChoiceSelected',
								'selected'
							)
					)
				);
				return chip;
			}
			const label =
				typeof summary.label === 'string' ? summary.label : '';
			if ( label === '' ) {
				return null;
			}
			const chip = createElement(
				'span',
				'dbvc-ve-control-center__value-choice'
			);
			chip.setAttribute( 'title', label );
			chip.appendChild( document.createTextNode( label ) );
			return chip;
		}
		if ( family === 'link' ) {
			// R5.2-a: title (falling back to URL host server-side) + a
			// small `↗` glyph so viewers can distinguish link summaries
			// from plain text at a glance. Full url in the title tooltip.
			const title =
				typeof summary.title === 'string' ? summary.title : '';
			const url = typeof summary.url === 'string' ? summary.url : '';
			if ( title === '' && url === '' ) {
				return null;
			}
			const chip = createElement(
				'span',
				'dbvc-ve-control-center__value-link'
			);
			chip.setAttribute( 'title', url || title );
			const glyph = createElement(
				'span',
				'dbvc-ve-control-center__value-link-glyph'
			);
			glyph.setAttribute( 'aria-hidden', 'true' );
			glyph.textContent = '↗';
			chip.appendChild( glyph );
			chip.appendChild(
				document.createTextNode( title || url )
			);
			return chip;
		}
		if ( family === 'boolean' ) {
			// true_false: on/off pill. Class variant `is-on` picks up a
			// success-tone bg so viewers can tell the state at a glance.
			// value is a real bool from the server; label is
			// server-localized ("On" / "Off").
			const on = summary.value === true;
			const label = typeof summary.label === 'string'
				? summary.label
				: ( on ? 'On' : 'Off' );
			const chip = createElement(
				'span',
				'dbvc-ve-control-center__value-boolean' +
					( on ? ' is-on' : '' )
			);
			chip.setAttribute( 'title', label );
			chip.appendChild( document.createTextNode( label ) );
			return chip;
		}
		if ( family === 'color' ) {
			// R5.2+color_picker: 12×12 rounded swatch backgrounded from
			// `summary.hex` + the same value rendered as a monospace
			// label to the right. Hex is already server-normalized
			// (lowercase 7-char OR rgba string); we set it via a data
			// attribute + a CSS custom property so we never inject raw
			// user text into a style attribute at eval time (defense in
			// depth — even though server validated).
			const hex = typeof summary.hex === 'string' ? summary.hex : '';
			if ( hex === '' ) {
				return null;
			}
			const chip = createElement(
				'span',
				'dbvc-ve-control-center__value-color'
			);
			chip.setAttribute( 'title', hex );
			const swatch = createElement(
				'span',
				'dbvc-ve-control-center__value-color-swatch'
			);
			swatch.setAttribute( 'aria-hidden', 'true' );
			// Server-validated shape only; browser CSS parser rejects
			// unknown values.
			swatch.style.setProperty( 'background-color', hex );
			chip.appendChild( swatch );
			const label = createElement(
				'span',
				'dbvc-ve-control-center__value-color-hex',
				hex
			);
			chip.appendChild( label );
			return chip;
		}
		if ( family === 'image' ) {
			// R5.3: 24×24 rounded thumbnail (loading=lazy) + filename to
			// the right (ellipsis truncated by the parent .__value-summary).
			// The thumbUrl is the server-computed WP attachment URL; per
			// the mockup COMPONENT-NOTES §3 data-safety rule we hand it to
			// the img tag as-is (server already escaped via esc_url_raw)
			// but never trust a client-supplied URL. attachmentId is not
			// currently rendered but kept in the summary payload for
			// future click-to-open behavior.
			const filename =
				typeof summary.filename === 'string' ? summary.filename : '';
			const thumbUrl =
				typeof summary.thumbUrl === 'string' ? summary.thumbUrl : '';
			if ( filename === '' && thumbUrl === '' ) {
				return null;
			}
			const chip = createElement(
				'span',
				'dbvc-ve-control-center__value-image'
			);
			chip.setAttribute( 'title', filename || thumbUrl );
			if ( thumbUrl !== '' ) {
				const img = document.createElement( 'img' );
				img.setAttribute( 'src', thumbUrl );
				img.setAttribute( 'alt', '' );
				img.setAttribute( 'width', '24' );
				img.setAttribute( 'height', '24' );
				img.setAttribute( 'loading', 'lazy' );
				chip.appendChild( img );
			}
			if ( filename !== '' ) {
				const name = createElement(
					'span',
					'dbvc-ve-control-center__value-image-filename',
					filename
				);
				chip.appendChild( name );
			}
			return chip;
		}
		if ( family === 'wysiwyg' ) {
			// R5.2-b: stripped-text preview (server-side; 40-char cap) +
			// word-count suffix. Full preview text as title tooltip.
			const preview =
				typeof summary.preview === 'string' ? summary.preview : '';
			if ( preview === '' ) {
				return null;
			}
			const chip = createElement(
				'span',
				'dbvc-ve-control-center__value-wysiwyg'
			);
			chip.setAttribute( 'title', preview );
			chip.appendChild( document.createTextNode( preview ) );
			const rawWords = Number( summary.wordCount );
			const words = Number.isFinite( rawWords ) && rawWords >= 0
				? Math.floor( rawWords )
				: 0;
			if ( words > 0 ) {
				const suffix = createElement(
					'span',
					'dbvc-ve-control-center__value-wysiwyg-words',
					templateText(
						'controlCenterValueWysiwygWords',
						'· {count} words',
						{ count: words }
					)
				);
				chip.appendChild( suffix );
			}
			return chip;
		}
		if ( family === 'text' ) {
			// R5.1-a: preview + optional truncation suffix. Preview is
			// pre-truncated + pre-sanitized server-side; the char count is
			// the ORIGINAL length so viewers can see "how much was cut".
			// Full text on hover via title attribute (plain text, no HTML)
			// so the row still gives context without exposing the entire
			// value in the visible chip.
			const preview =
				typeof summary.preview === 'string' ? summary.preview : '';
			if ( preview === '' ) {
				return null;
			}
			const chip = createElement(
				'span',
				'dbvc-ve-control-center__value-text'
			);
			chip.setAttribute( 'title', preview );
			chip.appendChild( document.createTextNode( preview ) );
			if ( summary.truncated ) {
				const rawCount = Number( summary.charCount );
				const count = Number.isFinite( rawCount ) && rawCount >= 0
					? Math.floor( rawCount )
					: 0;
				const suffix = createElement(
					'span',
					'dbvc-ve-control-center__value-text-count',
					templateText(
						'controlCenterValueTextTruncated',
						'({count})',
						{ count }
					)
				);
				chip.appendChild( suffix );
			}
			return chip;
		}
		return null;
	}

	// R4-C-1a: search fires a debounced server round-trip (mockup pinned
	// 250ms). The `family` chip fires an immediate round-trip via toggleChip;
	// `status` + `priority` chips filter client-side.
	function handleInput( event ) {
		const target = event.target;
		if ( ! target || typeof target.matches !== 'function' ) {
			return;
		}
		if ( target.matches( '[data-dbvc-ve-control-center-query="search"]' ) ) {
			window.clearTimeout( state.searchTimer );
			state.searchTimer = window.setTimeout( function () {
				const nextSearch = String( target.value || '' ).trim();
				if ( nextSearch === state.query.search ) {
					return;
				}
				state.query.search = nextSearch;
				loadControls( { reason: 'query' } );
			}, 250 );
		}
	}

	function toggleChip( chip ) {
		const axis = chip.getAttribute( 'data-dbvc-ve-control-center-chip' );
		const value = chip.getAttribute( 'data-value' ) || '';
		if ( ! axis || ! Object.prototype.hasOwnProperty.call( state.query, axis ) ) {
			return;
		}
		const current = state.query[ axis ];
		state.query[ axis ] = current === value ? '' : value;
		// R4-C-1a: `fieldFamily` is server-side (?family=…). Every other axis
		// (`status`, `priority`) filters the loaded items in place.
		if ( axis === 'fieldFamily' ) {
			loadControls( { reason: 'query' } );
			return;
		}
		renderList();
	}

	function selectTab( slug ) {
		const value = sanitizeAttr( slug ) || 'all';
		// R4-C-2: route to the axis matching the current view mode.
		if ( state.viewMode === 'provider' ) {
			state.query.provider = value;
		} else {
			state.query.category = value;
		}
		renderList();
	}

	function clearFilters() {
		const preservedCategory = state.query.category || 'all';
		const preservedProvider = state.query.provider || 'all';
		const priorFamily = state.query.fieldFamily;
		const priorSearch = state.query.search;
		state.query = Object.assign( {}, DEFAULT_QUERY, {
			category: preservedCategory,
			provider: preservedProvider,
		} );
		const search = state.root
			? state.root.querySelector(
					'[data-dbvc-ve-control-center-query="search"]'
			  )
			: null;
		if ( search ) {
			search.value = '';
		}
		// R4-C-1a: if clearing removed a server-scoped param (family or
		// search), we need a fresh unfiltered list from the server; if only
		// client-scoped chips were active, an in-place rerender is enough.
		if ( priorFamily || priorSearch ) {
			loadControls( { reason: 'query' } );
			return;
		}
		renderList();
	}

	function dismissOpenError( publicId ) {
		if ( ! publicId ) {
			return;
		}
		delete state.openErrors[ publicId ];
		renderList();
	}

	function renderTabs() {
		if ( ! state.root ) {
			return;
		}
		const tablist = state.root.querySelector(
			'[data-dbvc-ve-control-center-tablist]'
		);
		if ( ! tablist ) {
			return;
		}
		while ( tablist.firstChild ) {
			tablist.removeChild( tablist.firstChild );
		}
		const axis = tabAxisForViewMode();
		const total = state.items.length;
		const activeSlug =
			( axis === 'provider' ? state.query.provider : state.query.category ) ||
			'all';
		const allTab = createTabButton(
			'all',
			text( 'controlCenterTabAll', 'All' ),
			total,
			activeSlug === 'all',
			axis
		);
		tablist.appendChild( allTab );
		tabEntriesForViewMode( state.items ).forEach( function ( entry ) {
			tablist.appendChild(
				createTabButton(
					entry.slug,
					tabLabelForViewMode( entry.slug ),
					entry.count,
					activeSlug === entry.slug,
					axis
				)
			);
		} );
	}

	function createTabButton( slug, label, count, selected, axis ) {
		const button = createElement(
			'button',
			'dbvc-ve-control-center__tab'
		);
		button.type = 'button';
		button.setAttribute( 'role', 'tab' );
		button.setAttribute( 'aria-selected', selected ? 'true' : 'false' );
		button.setAttribute( 'data-dbvc-ve-control-center-action', 'select-tab' );
		// R4-C-2: `data-tab-slug` is the generic handle the click handler
		// reads. `data-category` (category mode) / `data-provider` (provider
		// mode) preserve compatibility with the R3-C-2 jsdom + real-browser
		// tests that look for `data-category`, and add a symmetric
		// affordance for provider mode.
		button.setAttribute( 'data-tab-slug', slug );
		if ( axis === 'provider' ) {
			button.setAttribute( 'data-provider', slug );
		} else {
			button.setAttribute( 'data-category', slug );
		}
		button.appendChild( document.createTextNode( label + ' ' ) );
		const badge = createElement(
			'span',
			'dbvc-ve-control-center__tab-count',
			String( count )
		);
		button.appendChild( badge );
		return button;
	}

	function renderFilters() {
		if ( ! state.root ) {
			return;
		}
		const filters = state.root.querySelector(
			'[data-dbvc-ve-control-center-filters]'
		);
		if ( ! filters ) {
			return;
		}
		filters
			.querySelectorAll( '[data-dbvc-ve-control-center-chip]' )
			.forEach( function ( chip ) {
				const axis = chip.getAttribute(
					'data-dbvc-ve-control-center-chip'
				);
				const value = chip.getAttribute( 'data-value' ) || '';
				const active = axis && state.query[ axis ] === value;
				chip.setAttribute( 'aria-pressed', active ? 'true' : 'false' );
			} );
		const search = filters.querySelector(
			'[data-dbvc-ve-control-center-query="search"]'
		);
		if ( search && search.value !== state.query.search ) {
			search.value = state.query.search;
		}
		// R4-C-2: the trailing clear button appears only when the input
		// has a value. Independent of the axis-level "clear filters"
		// button below.
		const searchClear = filters.querySelector(
			'[data-dbvc-ve-control-center-action="clear-search"]'
		);
		if ( searchClear ) {
			searchClear.hidden = state.query.search === '';
		}
		const clear = filters.querySelector(
			'[data-dbvc-ve-control-center-action="clear-filters"]'
		);
		if ( clear ) {
			clear.hidden = ! hasActiveFilters();
		}
	}

	function hasActiveFilters() {
		return (
			state.query.search !== '' ||
			state.query.status !== '' ||
			state.query.priority !== '' ||
			state.query.fieldFamily !== ''
		);
	}

	function renderSummary() {
		if ( ! state.root ) {
			return;
		}
		const summary = state.root.querySelector(
			'[data-dbvc-ve-control-center-summary]'
		);
		if ( ! summary ) {
			return;
		}
		summary.textContent = templateText(
			'controlCenterSummary',
			'{count} controls',
			{ count: state.items.length }
		);
	}

	function renderFooter() {
		if ( ! state.root ) {
			return;
		}
		const footer = state.root.querySelector(
			'[data-dbvc-ve-control-center-footer]'
		);
		if ( ! footer ) {
			return;
		}
		while ( footer.firstChild ) {
			footer.removeChild( footer.firstChild );
		}
		if ( ! state.items.length ) {
			return;
		}
		const visible = filteredItems().length;
		const total = state.items.length;
		const hidden = total - visible;
		const line = createElement( 'span' );
		line.appendChild(
			document.createTextNode(
				templateText(
					'controlCenterFooterCount',
					'{visible} of {total} controls',
					{ visible, total }
				)
			)
		);
		if ( hidden > 0 ) {
			line.appendChild(
				document.createTextNode(
					' · ' +
						templateText(
							'controlCenterFooterHidden',
							'{hidden} hidden by filters',
							{ hidden }
						)
				)
			);
		}
		footer.appendChild( line );
	}

	// R4-C-1a: subtle top-of-drawer banner surfacing the R4-A
	// `payload.providerErrors` map. Reuses `role="status"` (polite) — the
	// single-live-region rule is preserved because the announcer stays the
	// authoritative announcement channel; this banner is a persistent
	// visual affordance, not an announcement. Empty when no providers
	// errored or the viewer already dismissed the current set.
	function renderProviderErrorBanner() {
		if ( ! state.root ) {
			return;
		}
		const filters = state.root.querySelector(
			'[data-dbvc-ve-control-center-filters]'
		);
		if ( ! filters ) {
			return;
		}
		const existing = state.root.querySelector(
			'[data-dbvc-ve-control-center-provider-errors]'
		);
		const errorIds = Object.keys( state.providerErrors );
		if ( state.providerErrorsDismissed || errorIds.length === 0 ) {
			if ( existing && existing.parentNode ) {
				existing.parentNode.removeChild( existing );
			}
			return;
		}
		const names = errorIds.join( ', ' );
		const template = errorIds.length === 1
			? text(
					'controlCenterProviderErrorSingular',
					'{count} provider unavailable — {names}'
			  )
			: text(
					'controlCenterProviderErrorPlural',
					'{count} providers unavailable — {names}'
			  );
		const message = template
			.split( '{count}' )
			.join( String( errorIds.length ) )
			.split( '{names}' )
			.join( names );

		if ( existing ) {
			const messageNode = existing.querySelector(
				'[data-dbvc-ve-control-center-provider-errors-text]'
			);
			if ( messageNode ) {
				messageNode.textContent = message;
			}
			return;
		}
		const notice = createElement(
			'div',
			'dbvc-ve-control-center__notice dbvc-ve-control-center__notice--provider-error'
		);
		notice.setAttribute( 'role', 'status' );
		notice.setAttribute(
			'data-dbvc-ve-control-center-provider-errors',
			'1'
		);
		const messageNode = createElement(
			'span',
			'',
			message
		);
		messageNode.setAttribute(
			'data-dbvc-ve-control-center-provider-errors-text',
			'1'
		);
		const dismiss = createElement(
			'button',
			'dbvc-ve-control-center__notice-dismiss',
			text( 'controlCenterProviderErrorDismiss', 'Dismiss' )
		);
		dismiss.type = 'button';
		dismiss.setAttribute(
			'data-dbvc-ve-control-center-action',
			'dismiss-provider-error'
		);
		notice.appendChild( messageNode );
		notice.appendChild( dismiss );
		// Insert directly after the filter strip so the banner sits above the
		// table wrap and stays visible as the list scrolls.
		if ( filters.parentNode ) {
			filters.parentNode.insertBefore( notice, filters.nextSibling );
		}
	}

	// R4-C-1a: `loading-refresh` renders a dimmed overlay on top of the
	// existing rows (rather than blanking to a spinner) so a search /
	// family-chip round-trip does not throw context away. Reuses the
	// `.__refresh-overlay` selector already shipped in control-center.css.
	function renderRefreshOverlay( wrap ) {
		const existing = wrap.querySelector(
			'[data-dbvc-ve-control-center-refresh-overlay]'
		);
		if ( state.requestStatus !== 'loading-refresh' ) {
			if ( existing && existing.parentNode ) {
				existing.parentNode.removeChild( existing );
			}
			return;
		}
		if ( existing ) {
			return;
		}
		const overlay = createElement(
			'div',
			'dbvc-ve-control-center__refresh-overlay'
		);
		overlay.setAttribute(
			'data-dbvc-ve-control-center-refresh-overlay',
			'1'
		);
		overlay.setAttribute( 'aria-hidden', 'true' );
		const spinner = createElement(
			'span',
			'dbvc-ve-control-center__spinner'
		);
		spinner.setAttribute( 'aria-hidden', 'true' );
		overlay.appendChild( spinner );
		overlay.appendChild(
			document.createTextNode(
				' ' +
					text( 'controlCenterRefreshing', 'Refreshing…' )
			)
		);
		wrap.appendChild( overlay );
	}

	function renderList() {
		if ( ! state.root ) {
			return;
		}
		renderViewToggle();
		renderTabs();
		renderFilters();
		renderSummary();
		renderProviderErrorBanner();

		const wrap = state.root.querySelector(
			'[data-dbvc-ve-control-center-table-wrap]'
		);
		if ( ! wrap ) {
			return;
		}
		renderRefreshOverlay( wrap );
		// R4-D-1: re-attach the save-status-strip after any full render so
		// a filter change / view-mode flip during the fade window keeps
		// the confirmation visible until the timer clears it.
		renderSaveStatusStrip();

		// Restore focus to the same publicId across rerenders (row-focus continuity).
		const doc = wrap.ownerDocument || document;
		const activeElement = doc.activeElement;
		const focusedPublicId =
			activeElement &&
			typeof activeElement.closest === 'function' &&
			activeElement.closest( '.dbvc-ve-control-center__row' )
				? activeElement
						.closest( '.dbvc-ve-control-center__row' )
						.getAttribute( 'data-public-id' ) || ''
				: '';

		removeExistingPanelState( wrap );

		if ( state.requestStatus === 'loading-initial' && ! state.items.length ) {
			renderPanelState(
				wrap,
				text( 'controlCenterLoadingTitle', 'Loading Global Brand Controls' ),
				text(
					'controlCenterLoadingBody',
					'Fetching registered controls for this session.'
				),
				[]
			);
			clearTableTbodies( wrap );
			return;
		}
		if ( state.requestStatus === 'error' ) {
			const message =
				state.error && state.error.message
					? String( state.error.message )
					: text(
							'controlCenterErrorBody',
							'The registered-controls request failed. Retry when you are ready.'
					  );
			renderPanelState(
				wrap,
				text(
					'controlCenterErrorTitle',
					'Controls could not be loaded'
				),
				message,
				[
					{
						action: 'retry',
						label: text( 'controlCenterRetry', 'Retry' ),
					},
				]
			);
			clearTableTbodies( wrap );
			return;
		}
		if ( ! state.items.length ) {
			renderPanelState(
				wrap,
				text(
					'controlCenterEmptyTitle',
					'No global controls registered yet'
				),
				text(
					'controlCenterEmptyBody',
					'Once a provider registers controls, they will appear here.'
				),
				[]
			);
			clearTableTbodies( wrap );
			return;
		}

		const visible = filteredItems();
		clearTableTbodies( wrap );

		if ( ! visible.length ) {
			renderPanelState(
				wrap,
				text(
					'controlCenterEmptyFilteredTitle',
					'No controls match these filters'
				),
				text(
					'controlCenterEmptyFilteredBody',
					'Clear the filters to see every registered control again.'
				),
				[
					{
						action: 'clear-filters',
						label: text( 'controlCenterClearFilters', 'Clear filters' ),
					},
				]
			);
			renderFooter();
			return;
		}

		// R4-C-2: emit one `<tbody class="__group">` per record.group,
		// keyed `{providerId}::{group}`. Collapsed by default; user
		// deviations persist in state.expandedGroups (localStorage).
		const table = wrap.querySelector( '.dbvc-ve-control-center__table' );
		const groups = buildGroupsFromVisible( visible );
		groups.forEach( function ( group ) {
			table.appendChild( renderGroupTbody( group ) );
		} );

		// R4-C-1b: renderList rebuilds every tbody from scratch, so prior
		// observer registrations are dropped along with the old nodes.
		// Re-observe rows whose status is `available` and whose publicId
		// is not yet hydrated — cached summaries short-circuit and render
		// synchronously inside the newly-built row.
		registerVisibleValueSummaryTargets( wrap );
		renderFooter();
		announce(
			templateText(
				'controlCenterAnnounceFiltered',
				'{count} controls visible after filters.',
				{ count: visible.length }
			)
		);

		// Row-focus continuity: restore focus onto the same publicId when possible.
		if ( focusedPublicId ) {
			const restored = wrap.querySelector(
				'.dbvc-ve-control-center__row[data-public-id="' +
					cssEscape( focusedPublicId ) +
					'"] .dbvc-ve-control-center__action, .dbvc-ve-control-center__row[data-public-id="' +
					cssEscape( focusedPublicId ) +
					'"] .dbvc-ve-control-center__action--view'
			);
			if ( restored && typeof restored.focus === 'function' ) {
				restored.focus();
			}
		}
	}

	function cssEscape( value ) {
		return String( value ).replace(
			/([\\!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g,
			'\\$1'
		);
	}

	function renderRow( item ) {
		const status = classifyStatus( item.status );
		const priority = priorityFromItem( item );
		const fieldFamily = classifyFieldFamily( item.fieldFamily );
		const publicId = sanitizeAttr( item.publicId );
		const row = createElement(
			'tr',
			'dbvc-ve-control-center__row is-' + status
		);
		row.setAttribute( 'data-public-id', publicId );
		row.setAttribute(
			'data-category',
			sanitizeAttr( item.category ).toLowerCase() || 'general'
		);
		row.setAttribute( 'data-status', status );
		if ( priority ) {
			row.setAttribute( 'data-priority', priority );
		}
		row.setAttribute( 'data-field-family', fieldFamily );
		if ( state.activePublicId && state.activePublicId === publicId ) {
			row.classList.add( 'is-focused-source' );
		}
		FORBIDDEN_ROW_ATTRS.forEach( function ( attr ) {
			row.removeAttribute( attr );
		} );

		const labelCell = createElement(
			'td',
			'dbvc-ve-control-center__row-cell dbvc-ve-control-center__row-cell--label'
		);
		labelCell.setAttribute( 'data-label', 'Control' );
		const dot = createElement(
			'span',
			'dbvc-ve-control-center__status-dot dbvc-ve-control-center__status-dot--' +
				status
		);
		dot.setAttribute( 'aria-hidden', 'true' );
		dot.setAttribute( 'title', statusLabel( status ) );
		labelCell.appendChild( dot );
		// R4-C-1a: `.__label-block` wraps the label + optional description so
		// they stack under the status dot without disturbing the meta / owner
		// rows below. Description is omitted from the DOM entirely when the
		// backend emits an empty string — the layout doesn't reserve space.
		const labelBlock = createElement(
			'div',
			'dbvc-ve-control-center__label-block'
		);
		labelBlock.appendChild(
			createElement(
				'span',
				'dbvc-ve-control-center__label',
				sanitizeAttr( item.label )
			)
		);
		const description = sanitizeAttr( item.description );
		if ( description ) {
			labelBlock.appendChild(
				createElement(
					'p',
					'dbvc-ve-control-center__description',
					description
				)
			);
		}
		labelCell.appendChild( labelBlock );
		labelCell.appendChild( renderMeta( item ) );
		labelCell.appendChild(
			createElement(
				'div',
				'dbvc-ve-control-center__owner',
				ownerHint( item )
			)
		);

		const actionCell = createElement(
			'td',
			'dbvc-ve-control-center__row-cell dbvc-ve-control-center__row-cell--action'
		);
		actionCell.setAttribute( 'data-label', 'Action' );
		// R4-C-1b: `.__value-summary` slot sits before the action button.
		// Populated lazily via IntersectionObserver → batch POST. For rows
		// whose status is not `available`, the slot renders empty (only
		// available rows have descriptors + capabilities to source a value
		// from). A cached summary renders synchronously; a cache miss
		// leaves the slot empty until the observer fires.
		actionCell.appendChild( renderValueSummarySlot( item, status, publicId ) );
		actionCell.appendChild( renderAction( item, status, publicId ) );

		row.appendChild( labelCell );
		row.appendChild( actionCell );
		return row;
	}

	function registerVisibleValueSummaryTargets( wrap ) {
		if ( ! wrap ) {
			return;
		}
		const observer = ensureValueSummaryObserver( wrap );
		if ( ! observer ) {
			return;
		}
		ensureValueSummaryState();
		// R4-C-2: rows now live inside per-group tbodies; query at the
		// wrap level to pick them up regardless of which tbody they sit
		// in. Collapsed groups still register their rows (the observer
		// won't fire while the row is `display: none`, but a viewer
		// expanding a group later paints the rows visible and
		// intersection fires naturally on scroll).
		const rows = wrap.querySelectorAll(
			'.dbvc-ve-control-center__row[data-status="available"]'
		);
		rows.forEach( function ( row ) {
			const publicId = row.getAttribute( 'data-public-id' ) || '';
			if ( ! publicId ) {
				return;
			}
			if (
				Object.prototype.hasOwnProperty.call(
					state.valueSummaries,
					publicId
				)
			) {
				return; // cached (loading | resolved | null-empty)
			}
			try {
				observer.observe( row );
			} catch ( _err ) {
				/* ignore — jsdom fallbacks may throw */
			}
		} );
	}

	function renderValueSummarySlot( item, status, publicId ) {
		const slot = createElement(
			'span',
			'dbvc-ve-control-center__value-summary'
		);
		slot.setAttribute( 'data-public-id', publicId );
		if ( status !== 'available' || ! publicId ) {
			return slot;
		}
		ensureValueSummaryState();
		const cached = state.valueSummaries[ publicId ];
		if ( cached && typeof cached === 'object' ) {
			const chip = renderValueSummaryChip( cached );
			if ( chip ) {
				slot.appendChild( chip );
			}
		}
		return slot;
	}

	function renderMeta( item ) {
		const meta = createElement( 'div', 'dbvc-ve-control-center__meta' );
		const category = sanitizeAttr( item.category ).toLowerCase() || 'general';
		meta.appendChild(
			createElement(
				'span',
				'dbvc-ve-control-center__meta-part',
				categoryLabel( category )
			)
		);
		if ( item.group ) {
			meta.appendChild(
				createElement(
					'span',
					'dbvc-ve-control-center__meta-part',
					sanitizeAttr( item.group )
				)
			);
		}
		const badge =
			item.meta && typeof item.meta === 'object' && item.meta.badge
				? sanitizeAttr( item.meta.badge )
				: '';
		if ( badge ) {
			meta.appendChild(
				createElement( 'span', 'dbvc-ve-control-center__badge', badge )
			);
		}
		return meta;
	}

	function renderAction( item, status, publicId ) {
		if ( status === 'unsupported' ) {
			return createElement(
				'span',
				'dbvc-ve-control-center__action-none',
				text( 'controlCenterActionUnsupported', 'Unsupported' )
			);
		}
		if ( status === 'unavailable' ) {
			return createElement(
				'span',
				'dbvc-ve-control-center__action-none',
				text( 'controlCenterActionUnavailable', 'Unavailable' )
			);
		}
		const isOpening = state.openingPublicId === publicId;
		const isView = status === 'inspect_only';
		let className = 'dbvc-ve-control-center__action';
		if ( isView ) {
			className += ' dbvc-ve-control-center__action--view';
		}
		if ( isOpening ) {
			className += ' dbvc-ve-control-center__action--opening';
		}
		const button = createElement( 'button', className );
		button.type = 'button';
		button.setAttribute( 'data-dbvc-ve-control-center-action', 'open' );
		button.setAttribute( 'data-public-id', publicId );
		if ( isOpening ) {
			button.setAttribute( 'aria-busy', 'true' );
			button.disabled = true;
			button.textContent = text( 'controlCenterActionOpening', 'Opening…' );
			const spinner = createElement(
				'span',
				'dbvc-ve-control-center__spinner'
			);
			spinner.setAttribute( 'aria-hidden', 'true' );
			button.appendChild( spinner );
		} else {
			button.textContent = isView
				? text( 'controlCenterActionView', 'View' )
				: text( 'controlCenterActionOpen', 'Open' );
		}
		return button;
	}

	function renderRowNotice( item ) {
		const notice = state.openErrors[ item.publicId ];
		const row = createElement( 'tr', 'dbvc-ve-control-center__row-notice' );
		const cell = createElement(
			'td',
			'dbvc-ve-control-center__row-notice-cell'
		);
		cell.colSpan = 2;
		const noticeNode = createElement(
			'div',
			'dbvc-ve-control-center__notice ' +
				( notice.severity === 'error'
					? 'is-error'
					: notice.severity === 'warning'
					? 'is-warning'
					: '' )
		);
		noticeNode.setAttribute(
			'role',
			notice.severity === 'error' ? 'alert' : 'status'
		);
		noticeNode.appendChild(
			document.createTextNode( notice.message )
		);
		const dismiss = createElement(
			'button',
			'dbvc-ve-control-center__notice-dismiss',
			text( 'controlCenterDismiss', 'Dismiss' )
		);
		dismiss.type = 'button';
		dismiss.setAttribute(
			'data-dbvc-ve-control-center-action',
			'dismiss-notice'
		);
		dismiss.setAttribute( 'data-public-id', item.publicId );
		noticeNode.appendChild( dismiss );
		cell.appendChild( noticeNode );
		row.appendChild( cell );
		return row;
	}

	function renderPanelState( wrap, title, body, actions ) {
		removeExistingPanelState( wrap );
		const panel = createElement(
			'div',
			'dbvc-ve-control-center__panel-state'
		);
		panel.setAttribute( 'data-dbvc-ve-control-center-panel-state', '1' );
		if ( state.requestStatus === 'loading-initial' ) {
			const spinner = createElement(
				'div',
				'dbvc-ve-control-center__loading-spinner'
			);
			spinner.setAttribute( 'aria-hidden', 'true' );
			panel.appendChild( spinner );
		}
		panel.appendChild(
			createElement(
				'p',
				'dbvc-ve-control-center__panel-state-title',
				title
			)
		);
		panel.appendChild(
			createElement( 'p', 'dbvc-ve-control-center__panel-state-body', body )
		);
		if ( actions && actions.length ) {
			const actionsRow = createElement(
				'div',
				'dbvc-ve-control-center__panel-state-actions'
			);
			actions.forEach( function ( action ) {
				const button = createElement(
					'button',
					'dbvc-ve-control-center__button dbvc-ve-control-center__button--secondary',
					action.label
				);
				button.type = 'button';
				button.setAttribute(
					'data-dbvc-ve-control-center-action',
					action.action
				);
				actionsRow.appendChild( button );
			} );
			panel.appendChild( actionsRow );
		}
		wrap.appendChild( panel );
	}

	function removeExistingPanelState( wrap ) {
		const existing = wrap.querySelector(
			'[data-dbvc-ve-control-center-panel-state]'
		);
		if ( existing && existing.parentNode ) {
			existing.parentNode.removeChild( existing );
		}
	}

	// R4-C-1a: the list URL now carries the R4-A server-scoped query params
	// (`family`, `q`). Empty values are omitted so the response `query` echo
	// stays clean.
	function listUrl( params ) {
		const base =
			restBase() +
			'/session/' +
			encodeURIComponent( sessionId() ) +
			'/control-center/controls';
		if ( ! params || typeof params !== 'object' ) {
			return base;
		}
		const parts = [];
		Object.keys( params ).forEach( function ( key ) {
			const raw = params[ key ];
			if ( raw === undefined || raw === null || raw === '' ) {
				return;
			}
			parts.push(
				encodeURIComponent( key ) +
					'=' +
					encodeURIComponent( String( raw ) )
			);
		} );
		return parts.length ? base + '?' + parts.join( '&' ) : base;
	}

	function openUrl() {
		return (
			restBase() +
			'/session/' +
			encodeURIComponent( sessionId() ) +
			'/control-center/open'
		);
	}

	// R4-C-1a: `reason` is `'initial'` (first open — full-panel spinner),
	// `'query'` (search or family chip changed — dimmed overlay over the
	// existing rows), or `'retry'` (error → retry button — dimmed overlay).
	// The dimmed-overlay pattern reuses the `.__refresh-overlay` selector
	// already shipped in control-center.css.
	function loadControls( options ) {
		if ( ! sessionId() ) {
			return Promise.resolve();
		}
		const reason =
			options && typeof options === 'object' && options.reason
				? String( options.reason )
				: state.hasLoaded
				? 'query'
				: 'initial';
		const requestId = ++state.requestSequence;
		// Loading-refresh keeps the current rows visible under a dimmed
		// overlay — that only makes sense once we have rows. A retry from
		// a first-time error falls back to loading-initial (blank panel +
		// spinner), matching R3-C-2's shape.
		state.requestStatus =
			reason === 'initial' || ! state.hasLoaded
				? 'loading-initial'
				: 'loading-refresh';
		state.error = null;
		renderList();
		const url = listUrl( {
			family: state.query.fieldFamily,
			q: state.query.search,
		} );
		return window
			.fetch( url, {
				method: 'GET',
				credentials: 'same-origin',
				headers: {
					Accept: 'application/json',
					'X-WP-Nonce': nonce(),
				},
			} )
			.then( async function ( response ) {
				const payload = await response.json().catch( function () {
					return null;
				} );
				if ( requestId !== state.requestSequence ) {
					return;
				}
				if ( ! response.ok || ! payload || payload.ok !== true ) {
					state.requestStatus = 'error';
					state.error = payload && payload.message
						? { message: payload.message }
						: {
								message: text(
									'controlCenterErrorBody',
									'The registered-controls request failed. Retry when you are ready.'
								),
						  };
					renderList();
					return;
				}
				state.items = Array.isArray( payload.items ) ? payload.items : [];
				// R4-A: `providerErrors` is a `{providerId → {message}}` map.
				// Reset the dismissed flag on a fresh error set — a new
				// error surface deserves to be re-surfaced. Same providers
				// throwing again keep dismissal state.
				const nextErrors =
					payload.providerErrors && typeof payload.providerErrors === 'object'
						? payload.providerErrors
						: {};
				// R4-C-1a diagnostic aid: surface per-provider messages to
				// the browser console so operators can debug a fail-soft
				// event without opening devtools Network. The banner keeps
				// showing only provider ids (end-user-facing).
				Object.keys( nextErrors ).forEach( function ( providerId ) {
					const entry = nextErrors[ providerId ];
					const message =
						entry && typeof entry === 'object' && entry.message
							? String( entry.message )
							: '';
					// eslint-disable-next-line no-console
					console.warn(
						'[DBVC Brand Control Center] Provider "' +
							providerId +
							'" reported an error:',
						message
					);
				} );
				const prevKeys = Object.keys( state.providerErrors ).sort().join( '|' );
				const nextKeys = Object.keys( nextErrors ).sort().join( '|' );
				if ( prevKeys !== nextKeys ) {
					state.providerErrorsDismissed = false;
				}
				state.providerErrors = nextErrors;
				state.requestStatus = 'success';
				state.hasLoaded = true;
				renderList();
				if ( reason === 'initial' ) {
					announce(
						templateText(
							'controlCenterAnnounceOpened',
							'Global Brand Controls opened. Showing {count} registered controls.',
							{ count: state.items.length }
						)
					);
				}
			} )
			.catch( function ( error ) {
				if ( requestId !== state.requestSequence ) {
					return;
				}
				state.requestStatus = 'error';
				state.error = {
					message:
						error && error.message
							? String( error.message )
							: text(
									'controlCenterErrorBody',
									'The registered-controls request failed. Retry when you are ready.'
							  ),
				};
				renderList();
			} );
	}

	function openRow( publicId ) {
		publicId = sanitizeAttr( publicId );
		if ( ! publicId || state.openingPublicId === publicId ) {
			return;
		}
		state.openingPublicId = publicId;
		delete state.openErrors[ publicId ];
		renderList();

		window
			.fetch( openUrl(), {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'X-WP-Nonce': nonce(),
				},
				body: JSON.stringify( { publicId } ),
			} )
			.then( async function ( response ) {
				const payload = await response.json().catch( function () {
					return null;
				} );
				state.openingPublicId = '';
				if ( ! response.ok || ! payload || payload.ok !== true ) {
					recordOpenError( publicId, response.status, payload );
					renderList();
					return;
				}
				const token = firstTokenFrom( payload.descriptors );
				state.activePublicId = publicId;
				// R4-D-1: remember the token so the save-status-strip
				// listener can match it against the overlay's panel:saved
				// dispatch — saves from a different entry point (e.g. the
				// Shared Globals popover) carry a different token and are
				// intentionally ignored here.
				state.activeToken = token;
				renderList();
				document.dispatchEvent(
					new CustomEvent(
						'dbvc:visual-editor:absorb-descriptor',
						{
							detail: {
								publicId,
								token,
								descriptors: payload.descriptors,
								descriptorHydrations: payload.descriptorHydrations,
							},
						}
					)
				);
				announce(
					templateText(
						'controlCenterAnnounceOpenSuccess',
						'Opened {label}.',
						{ label: labelForPublicId( publicId ) }
					)
				);
			} )
			.catch( function ( error ) {
				state.openingPublicId = '';
				recordOpenError( publicId, 0, {
					message:
						error && error.message
							? String( error.message )
							: '',
				} );
				renderList();
			} );
	}

	function firstTokenFrom( descriptors ) {
		if ( ! descriptors || typeof descriptors !== 'object' ) {
			return '';
		}
		const keys = Object.keys( descriptors );
		return keys.length ? String( keys[ 0 ] ) : '';
	}

	function labelForPublicId( publicId ) {
		const match = state.items.find( function ( item ) {
			return item.publicId === publicId;
		} );
		return match ? String( match.label || publicId ) : publicId;
	}

	function recordOpenError( publicId, status, payload ) {
		const severity = status === 409 ? 'error' : 'warning';
		const message =
			payload && payload.message
				? String( payload.message )
				: status === 404
				? text(
						'controlCenterOpenErrorUnknown',
						'That control is no longer available.'
				  )
				: status === 403
				? text(
						'controlCenterOpenErrorForbidden',
						'You cannot edit that control right now.'
				  )
				: status === 409
				? text(
						'controlCenterOpenErrorRefresh',
						'The control changed since it was listed. Refresh the drawer before trying again.'
				  )
				: text(
						'controlCenterErrorBody',
						'The registered-controls request failed. Retry when you are ready.'
				  );
		state.openErrors[ publicId ] = { severity, message };
		announce(
			templateText(
				'controlCenterAnnounceOpenError',
				'Could not open {label}. {message}',
				{ label: labelForPublicId( publicId ), message }
			)
		);
	}

	function setTriggerExpanded( expanded ) {
		if ( ! state.trigger || ! state.trigger.isConnected ) {
			return;
		}
		state.trigger.setAttribute(
			'aria-expanded',
			expanded ? 'true' : 'false'
		);
	}

	function open( options ) {
		const root = ensureRoot();
		const trigger = options && options.trigger;
		const activeElement = root.ownerDocument.activeElement;

		if ( trigger && trigger.isConnected ) {
			state.trigger = trigger;
		} else if (
			! state.trigger &&
			activeElement instanceof window.HTMLElement
		) {
			state.trigger = activeElement;
		}

		root.hidden = false;
		root.classList.remove( 'is-closed' );
		root.setAttribute( 'aria-hidden', 'false' );
		setTriggerExpanded( true );

		const closeButton = root.querySelector(
			'[data-dbvc-ve-control-center-action="close"]'
		);
		if ( closeButton && typeof closeButton.focus === 'function' ) {
			window.requestAnimationFrame( function () {
				closeButton.focus();
			} );
		}

		document.dispatchEvent(
			new CustomEvent( 'dbvc:visual-editor:control-center:opened' )
		);
		if ( ! state.hasLoaded && state.requestStatus !== 'loading-initial' ) {
			loadControls();
		} else {
			renderList();
		}
	}

	function close( options ) {
		const root = state.root;
		const restoreFocus = ! options || options.restoreFocus !== false;
		const trigger = state.trigger;
		if ( ! root || root.hidden ) {
			setTriggerExpanded( false );
			return;
		}
		root.hidden = true;
		root.setAttribute( 'aria-hidden', 'true' );
		setTriggerExpanded( false );
		window.clearTimeout( state.searchTimer );
		state.searchTimer = 0;
		// R4-C-1a: providerErrors dismissal is per-drawer-lifetime — a fresh
		// open should re-surface any providers still throwing.
		state.providerErrorsDismissed = false;
		// R4-C-1b: drop the observer, cancel any pending flush, and empty
		// the summary cache so a reopen re-hydrates against fresh data.
		teardownValueSummaryObserver();
		state.valueSummaries = null;
		state.valueSummaryPending = null;
		// R4-D-1: cancel any pending save-status-strip fade + clear the
		// strip state so a reopen never inherits stale confirmation text.
		if ( state.saveStatusTimer ) {
			window.clearTimeout( state.saveStatusTimer );
			state.saveStatusTimer = 0;
		}
		state.saveStatusStrip = null;
		state.activeToken = '';
		if (
			restoreFocus &&
			trigger &&
			trigger.isConnected &&
			typeof trigger.focus === 'function'
		) {
			trigger.focus();
		}
		document.dispatchEvent(
			new CustomEvent( 'dbvc:visual-editor:control-center:closed' )
		);
		announce(
			text( 'controlCenterAnnounceClosed', 'Global Brand Controls closed.' )
		);
	}

	function toggle( options ) {
		const root = ensureRoot();
		if ( root.hidden ) {
			open( options || {} );
		} else {
			close( { restoreFocus: true } );
		}
	}

	function isOpen() {
		return Boolean( state.root && ! state.root.hidden );
	}

	function publicState() {
		return {
			hasLoaded: state.hasLoaded,
			requestStatus: state.requestStatus,
			items: state.items.slice(),
			query: Object.assign( {}, state.query ),
			openErrors: Object.assign( {}, state.openErrors ),
			openingPublicId: state.openingPublicId,
			activePublicId: state.activePublicId,
			providerErrors: Object.assign( {}, state.providerErrors ),
			providerErrorsDismissed: state.providerErrorsDismissed,
			valueSummaries: state.valueSummaries
				? Object.assign( {}, state.valueSummaries )
				: {},
			viewMode: state.viewMode,
			expandedGroups: state.expandedGroups
				? Object.assign( {}, state.expandedGroups )
				: {},
			activeToken: state.activeToken,
			saveStatusStrip: state.saveStatusStrip
				? Object.assign( {}, state.saveStatusStrip )
				: null,
			isOpen: isOpen(),
		};
	}

	function handleKeydown( event ) {
		if ( ! state.root || state.root.hidden ) {
			return;
		}
		if ( event.key === 'Escape' ) {
			event.preventDefault();
			event.stopPropagation();
			close( { restoreFocus: true } );
			return;
		}
		// R4-C-2: arrow-key nav across the view-mode segmented control
		// (mockup DESIGN-DECISIONS §7). Only fires when focus is already
		// inside the tablist — no interference with the surrounding drawer
		// scope.
		if (
			( event.key === 'ArrowLeft' || event.key === 'ArrowRight' ) &&
			event.target &&
			typeof event.target.closest === 'function' &&
			event.target.closest(
				'[data-dbvc-ve-control-center-view-toggle]'
			)
		) {
			event.preventDefault();
			const currentIdx = VIEW_MODES.indexOf( state.viewMode );
			if ( currentIdx === -1 ) {
				return;
			}
			const delta = event.key === 'ArrowLeft' ? -1 : 1;
			const nextIdx =
				( currentIdx + delta + VIEW_MODES.length ) % VIEW_MODES.length;
			setViewMode( VIEW_MODES[ nextIdx ] );
			// Move focus onto the newly-selected tab so the tablist stays
			// keyboard-navigable across successive arrow presses.
			if ( state.root ) {
				const next = state.root.querySelector(
					'[data-view-mode="' +
						cssEscape( VIEW_MODES[ nextIdx ] ) +
						'"]'
				);
				if ( next && typeof next.focus === 'function' ) {
					next.focus();
				}
			}
		}
	}

	function mount() {
		if ( ! bootstrap().active || config().enabled !== true ) {
			return;
		}

		document.addEventListener(
			'dbvc:visual-editor:control-center:toggle',
			function ( event ) {
				toggle( event && event.detail ? event.detail : {} );
			}
		);
		document.addEventListener(
			'dbvc:visual-editor:control-center:close',
			function ( event ) {
				close( event && event.detail ? event.detail : {} );
			}
		);
		// R4-D-1: overlay-app.js dispatches this on every successful
		// editor-panel save. handlePanelSaved gates on activeToken so
		// events for descriptors the drawer did not open are dropped.
		document.addEventListener(
			'dbvc:visual-editor:panel:saved',
			handlePanelSaved
		);
		document.addEventListener( 'keydown', handleKeydown, true );

		window.DBVCVisualEditorBrandControlCenter = {
			open,
			close,
			toggle,
			list: loadControls,
			isOpen,
			getState: publicState,
		};
	}

	mount();
} )();
