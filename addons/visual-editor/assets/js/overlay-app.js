( function () {
	const state = {
		session: null,
		activeNode: null,
		activeDescriptor: null,
		activeController: null,
		activeRequiresSharedScopeAck: false,
		activeAcknowledgementType: 'none',
		activeSaveBlockedByStale: false,
		sharedScopeAcknowledged: false,
		descriptorCache: {},
		descriptorRequests: {},
		collectionSeedUndoByToken: {},
		badgeLayer: null,
		badgeNode: null,
		badgeLayoutFrame: 0,
		badgeEventsBound: false,
		previewNode: null,
		badgeHideTimeout: 0,
		prefetchTimeout: 0,
		prefetchToken: '',
		touchSelectionToken: '',
		touchSuppressToken: '',
		touchClickSuppressUntil: 0,
		statusBarState: null,
		toolbarNode: null,
		toolbarPopoverNode: null,
		toolbarStatusbarParkingNode: null,
		toolbarOpenPanel: '',
		toolbarTriggerNode: null,
		toolbarEventsBound: false,
		toolbarObjectSearchRequestId: 0,
		toolbarObjectSearchTimer: 0,
		toolbarObjectSearchType: 'all',
		toolbarObjectSearchTerm: '',
		toolbarSharedGlobalsRequestId: 0,
		toolbarSharedGlobalsByToken: {},
		fieldIndexOpen: false,
		fieldIndexFilter: 'all',
		fieldIndexScrollTop: 0,
		fieldIndexResetScroll: false,
		fieldIndexOpenSections: new Set(),
		fieldIndexOpenItems: new Set(),
		fieldIndexSectionStateCaptured: false,
		fieldIndexRefreshFrame: 0,
		panelOpen: false,
		panelPosition: null,
		panelDrag: null,
		sessionKeepaliveTimer: 0,
		sessionKeepaliveInFlight: null,
		sessionKeepaliveBound: false,
		sessionLastRefreshAt: 0,
		sessionExpired: false,
		saveInFlight: false,
		reloadPending: false,
		mediaModalOpen: false,
		viewportPrefetchObserver: null,
		viewportPrefetchNodes: new Set(),
		viewportPrefetchQueue: [],
		viewportPrefetchIdleHandle: 0,
		viewportPrefetchTimer: 0,
		viewportPrefetchInFlight: 0,
		performanceMeasureId: 0,
		queryCollectionBadgeRefreshTimer: 0,
		queryCollectionBadgeObserver: null,
	};

	const PANEL_POSITION_STORAGE_KEY = 'dbvc-ve-panel-position';
	const PERFORMANCE_PREFIX = 'dbvc.ve.';
	const BADGE_HIDE_DELAY_MS = 500;

	function supportsPerformanceTimings() {
		return Boolean(
			window.performance &&
				typeof window.performance.mark === 'function' &&
				typeof window.performance.measure === 'function'
		);
	}

	function normalizePerformanceName( name ) {
		return (
			String( name || 'step' )
				.replace( /[^a-z0-9_.:-]+/gi, '_' )
				.replace( /^_+|_+$/g, '' )
				.slice( 0, 80 ) || 'step'
		);
	}

	function createPerformanceSpan( name ) {
		if ( ! supportsPerformanceTimings() ) {
			return { end() {} };
		}

		const normalized = normalizePerformanceName( name );
		const id = `${ Date.now() }.${ ++state.performanceMeasureId }`;
		const startName = `${ PERFORMANCE_PREFIX }${ normalized }.start.${ id }`;
		const endName = `${ PERFORMANCE_PREFIX }${ normalized }.end.${ id }`;
		let ended = false;

		try {
			window.performance.mark( startName );
		} catch ( error ) {
			return { end() {} };
		}

		return {
			end() {
				if ( ended ) {
					return;
				}

				ended = true;
				try {
					window.performance.mark( endName );
					window.performance.measure(
						`${ PERFORMANCE_PREFIX }${ normalized }`,
						startName,
						endName
					);
					if ( typeof window.performance.clearMarks === 'function' ) {
						window.performance.clearMarks( startName );
						window.performance.clearMarks( endName );
					}
				} catch ( error ) {}
			},
		};
	}

	function measurePerformance( name, callback ) {
		const span = createPerformanceSpan( name );

		try {
			const result = callback();
			if ( result && typeof result.finally === 'function' ) {
				return result.finally( function () {
					span.end();
				} );
			}

			span.end();

			return result;
		} catch ( error ) {
			span.end();
			throw error;
		}
	}

	function strings() {
		return (
			( window.DBVCVisualEditorBootstrap &&
				window.DBVCVisualEditorBootstrap.strings ) ||
			{}
		);
	}

	function loadStoredPanelPosition() {
		try {
			const raw = window.sessionStorage.getItem(
				PANEL_POSITION_STORAGE_KEY
			);

			if ( ! raw ) {
				return null;
			}

			const parsed = JSON.parse( raw );
			if ( ! parsed || typeof parsed !== 'object' ) {
				return null;
			}

			const left = Number( parsed.left );
			const top = Number( parsed.top );

			if ( ! Number.isFinite( left ) || ! Number.isFinite( top ) ) {
				return null;
			}

			return {
				left,
				top,
			};
		} catch ( error ) {
			return null;
		}
	}

	function persistPanelPosition( position ) {
		if (
			! position ||
			! Number.isFinite( position.left ) ||
			! Number.isFinite( position.top )
		) {
			return;
		}

		try {
			window.sessionStorage.setItem(
				PANEL_POSITION_STORAGE_KEY,
				JSON.stringify( {
					left: position.left,
					top: position.top,
				} )
			);
		} catch ( error ) {}
	}

	function supportsWpMedia() {
		return Boolean(
			window.DBVCVisualEditorBootstrap &&
				window.DBVCVisualEditorBootstrap.supportsWpMedia &&
				window.wp &&
				typeof window.wp.media === 'function'
		);
	}

	function clonePayload( payload ) {
		return payload ? JSON.parse( JSON.stringify( payload ) ) : null;
	}

	function escapeHtml( value ) {
		return String( value )
			.replace( /&/g, '&amp;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' )
			.replace( /"/g, '&quot;' )
			.replace( /'/g, '&#39;' );
	}

	function escapeCssValue( value ) {
		const stringValue = String( value || '' );

		if ( window.CSS && typeof window.CSS.escape === 'function' ) {
			return window.CSS.escape( stringValue );
		}

		return stringValue.replace( /["\\]/g, '\\$&' );
	}

	function cacheDescriptorPayload( payload ) {
		if ( ! payload || ! payload.descriptor || ! payload.descriptor.token ) {
			return;
		}

		state.descriptorCache[ payload.descriptor.token ] = clonePayload(
			Object.assign( { ok: true }, payload )
		);
		scheduleFieldIndexRefresh();
	}

	function cacheDescriptorHydrations( hydrations ) {
		if ( ! hydrations || typeof hydrations !== 'object' ) {
			return;
		}

		Object.keys( hydrations ).forEach( function ( token ) {
			cacheDescriptorPayload( hydrations[ token ] );
		} );
	}

	function getCachedDescriptorPayload( token ) {
		if ( ! token || ! state.descriptorCache[ token ] ) {
			return null;
		}

		return clonePayload( state.descriptorCache[ token ] );
	}

	function clearDescriptorPayload( token ) {
		if ( ! token ) {
			return;
		}

		delete state.descriptorCache[ token ];
		delete state.descriptorRequests[ token ];
		scheduleFieldIndexRefresh();
	}

	function getMarkerToken( node ) {
		return node && typeof node.getAttribute === 'function'
			? String( node.getAttribute( 'data-dbvc-ve' ) || '' )
			: '';
	}

	function mapDescriptorScopeToMarker( scope ) {
		if ( scope === 'shared_entity' ) {
			return 'shared';
		}

		if ( scope === 'related_entity' ) {
			return 'related';
		}

		return 'current';
	}

	function getSessionId() {
		return state.session && typeof state.session.sessionId === 'string'
			? state.session.sessionId
			: '';
	}

	function supportsViewportPrefetch() {
		return Boolean( window.IntersectionObserver );
	}

	function getViewportPrefetchRootMargin() {
		return '300px 0px 300px 0px';
	}

	function getViewportPrefetchConcurrency() {
		return 2;
	}

	function getViewportPrefetchCycleBudget() {
		return 4;
	}

	function getViewportPrefetchBatchSize() {
		return 4;
	}

	function clearViewportPrefetchSchedule() {
		if (
			state.viewportPrefetchIdleHandle &&
			typeof window.cancelIdleCallback === 'function'
		) {
			window.cancelIdleCallback( state.viewportPrefetchIdleHandle );
		}

		if ( state.viewportPrefetchTimer ) {
			window.clearTimeout( state.viewportPrefetchTimer );
		}

		state.viewportPrefetchIdleHandle = 0;
		state.viewportPrefetchTimer = 0;
	}

	function shouldPauseViewportPrefetch() {
		if ( ! supportsViewportPrefetch() ) {
			return true;
		}

		if ( state.sessionExpired || ! state.session || ! getSessionId() ) {
			return true;
		}

		if ( document.visibilityState === 'hidden' ) {
			return true;
		}

		if ( ! state.panelOpen && ! state.previewNode ) {
			return true;
		}

		if (
			state.saveInFlight ||
			state.reloadPending ||
			state.mediaModalOpen
		) {
			return true;
		}

		return false;
	}

	function getSessionKeepaliveMs() {
		const raw =
			window.DBVCVisualEditorBootstrap &&
			window.DBVCVisualEditorBootstrap.sessionKeepaliveMs;
		const value = Number( raw );

		if ( ! Number.isFinite( value ) || value < 60000 ) {
			return 240000;
		}

		return value;
	}

	function getSessionExpiredMessage() {
		return (
			strings().sessionExpired ||
			'Visual Editor session expired. Refresh the page to continue editing.'
		);
	}

	function isSessionExpiredError( error ) {
		const message =
			error && error.message ? String( error.message ).toLowerCase() : '';
		const expired = getSessionExpiredMessage().toLowerCase();
		const missing = (
			strings().sessionMissing ||
			'Visual Editor session not found for this page.'
		).toLowerCase();

		return (
			Boolean( message ) &&
			( message.indexOf( expired ) !== -1 ||
				message.indexOf( missing ) !== -1 ||
				message.indexOf( 'session expired' ) !== -1 ||
				message.indexOf( 'session not found' ) !== -1 )
		);
	}

	function isCompositeStaleError( error ) {
		const data =
			error && error.data && typeof error.data === 'object'
				? error.data
				: null;
		const stage = data && data.stage ? String( data.stage ) : '';
		const message =
			error && error.message ? String( error.message ).toLowerCase() : '';

		return Boolean(
			error &&
				( error.status === 409 ||
					stage === 'stale' ||
					message.indexOf( 'changed after this panel was loaded' ) !==
						-1 )
		);
	}

	function syncSessionPayload( session ) {
		if ( ! session || ! session.ok || ! session.sessionId ) {
			return;
		}

		state.session = session;
		state.sessionExpired = false;
		state.sessionLastRefreshAt = Date.now();
		cacheDescriptorHydrations( session.descriptorHydrations );
		scheduleViewportPrefetch();
	}

	function mergeSessionDescriptors( descriptors ) {
		if ( ! descriptors || typeof descriptors !== 'object' ) {
			return;
		}

		if ( ! state.session || typeof state.session !== 'object' ) {
			return;
		}

		if (
			! state.session.descriptors ||
			typeof state.session.descriptors !== 'object'
		) {
			state.session.descriptors = {};
		}

		Object.keys( descriptors ).forEach( function ( token ) {
			if (
				! token ||
				! descriptors[ token ] ||
				typeof descriptors[ token ] !== 'object'
			) {
				return;
			}

			state.session.descriptors[ token ] = descriptors[ token ];
		} );

		scheduleFieldIndexRefresh();
	}

	function mergeSharedGlobalInventory( result ) {
		if ( ! result || typeof result !== 'object' ) {
			return;
		}

		mergeSessionDescriptors( result.descriptors );
		cacheDescriptorHydrations( result.descriptorHydrations );

		if ( Array.isArray( result.fields ) ) {
			result.fields.forEach( function ( field ) {
				if ( ! field || typeof field !== 'object' || ! field.token ) {
					return;
				}

				state.toolbarSharedGlobalsByToken[ String( field.token ) ] =
					field;
			} );
		}
	}

	function handleExpiredSession( error ) {
		const message =
			error && error.message
				? String( error.message )
				: getSessionExpiredMessage();
		state.sessionExpired = true;
		state.session = null;
		clearViewportPrefetchSchedule();
		state.viewportPrefetchQueue = [];

		updateStatusBar( {
			kind: 'error',
			count: getMarkerCount(),
			message,
		} );

		const panelNodes = getPanelNodes();
		if ( panelNodes && panelNodes.panel && state.panelOpen ) {
			panelNodes.panel.dataset.state = 'error';
			panelNodes.status.textContent = message;
			panelNodes.saveButton.disabled = true;
			schedulePanelViewportClamp();
		}
	}

	function refreshSession( options ) {
		const bootstrapSessionId =
			window.DBVCVisualEditorBootstrap &&
			window.DBVCVisualEditorBootstrap.sessionId
				? String( window.DBVCVisualEditorBootstrap.sessionId )
				: '';
		const currentSessionId = getSessionId();
		const touchOnly = Boolean(
			options && options.touchOnly && currentSessionId
		);

		if ( ! bootstrapSessionId ) {
			return Promise.reject( new Error( getSessionExpiredMessage() ) );
		}

		if ( state.sessionKeepaliveInFlight ) {
			return state.sessionKeepaliveInFlight;
		}

		state.sessionKeepaliveInFlight = (
			touchOnly
				? window.DBVCVisualEditorApi.touchSession( currentSessionId )
				: window.DBVCVisualEditorApi.getSession( bootstrapSessionId )
		)
			.then( function ( session ) {
				if ( touchOnly ) {
					state.sessionExpired = false;
					state.sessionLastRefreshAt = Date.now();

					return (
						state.session || {
							ok: true,
							sessionId: currentSessionId,
						}
					);
				}

				syncSessionPayload( session );
				return session;
			} )
			.catch( function ( error ) {
				if ( isSessionExpiredError( error ) ) {
					handleExpiredSession( error );
				} else if ( ! options || ! options.silent ) {
					window.console.warn( error );
				}

				throw error;
			} )
			.finally( function () {
				state.sessionKeepaliveInFlight = null;
			} );

		return state.sessionKeepaliveInFlight;
	}

	function bindSessionKeepaliveEvents() {
		if ( state.sessionKeepaliveBound ) {
			return;
		}

		state.sessionKeepaliveBound = true;

		document.addEventListener( 'visibilitychange', function () {
			if (
				document.visibilityState === 'visible' &&
				! state.sessionExpired
			) {
				refreshSession( { silent: true, touchOnly: true } ).catch(
					function () {}
				);
			}
		} );

		window.addEventListener( 'focus', function () {
			if ( ! state.sessionExpired ) {
				refreshSession( { silent: true, touchOnly: true } ).catch(
					function () {}
				);
			}
		} );
	}

	function startSessionKeepalive() {
		if ( state.sessionKeepaliveTimer ) {
			window.clearInterval( state.sessionKeepaliveTimer );
			state.sessionKeepaliveTimer = 0;
		}

		bindSessionKeepaliveEvents();

		state.sessionKeepaliveTimer = window.setInterval( function () {
			if ( state.sessionExpired ) {
				return;
			}

			refreshSession( { silent: true, touchOnly: true } ).catch(
				function () {}
			);
		}, getSessionKeepaliveMs() );
	}

	function shouldRefreshSessionBeforeAction() {
		if ( state.sessionExpired ) {
			return false;
		}

		if ( ! state.session || ! state.session.sessionId ) {
			return true;
		}

		if ( ! state.sessionLastRefreshAt ) {
			return true;
		}

		return Date.now() - state.sessionLastRefreshAt > 60000;
	}

	function getSessionDescriptorSummary( token ) {
		if (
			! token ||
			! state.session ||
			! state.session.descriptors ||
			typeof state.session.descriptors !== 'object' ||
			! state.session.descriptors[ token ] ||
			typeof state.session.descriptors[ token ] !== 'object'
		) {
			return null;
		}

		return state.session.descriptors[ token ];
	}

	function clearDescriptorPrefetch() {
		if ( state.prefetchTimeout ) {
			window.clearTimeout( state.prefetchTimeout );
			state.prefetchTimeout = 0;
		}

		state.prefetchToken = '';
	}

	function isViewportPrefetchCandidate( token ) {
		if ( ! token ) {
			return false;
		}

		if (
			! state.session ||
			! state.session.descriptors ||
			typeof state.session.descriptors !== 'object' ||
			! state.session.descriptors[ token ]
		) {
			return false;
		}

		if (
			getCachedDescriptorPayload( token ) ||
			state.descriptorRequests[ token ]
		) {
			return false;
		}

		return true;
	}

	function isNodeInsideViewport( node ) {
		if ( ! node || typeof node.getBoundingClientRect !== 'function' ) {
			return false;
		}

		const rect = node.getBoundingClientRect();
		const viewportWidth =
			window.innerWidth || document.documentElement.clientWidth || 0;
		const viewportHeight =
			window.innerHeight || document.documentElement.clientHeight || 0;

		return (
			rect.bottom > 0 &&
			rect.top < viewportHeight &&
			rect.right > 0 &&
			rect.left < viewportWidth
		);
	}

	function getViewportPrefetchPriority( node, token ) {
		if ( ! node || ! token ) {
			return null;
		}

		const summary = getSessionDescriptorSummary( token );
		const editable = summary && summary.status === 'editable';
		const visible = isNodeInsideViewport( node );
		const rect =
			typeof node.getBoundingClientRect === 'function'
				? node.getBoundingClientRect()
				: null;
		const distance = rect
			? Math.min(
					Math.abs( rect.top ),
					Math.abs( rect.bottom - ( window.innerHeight || 0 ) )
			  )
			: Number.MAX_SAFE_INTEGER;

		return {
			priority: visible ? ( editable ? 1 : 2 ) : 3,
			distance,
		};
	}

	function rebuildViewportPrefetchQueue() {
		if ( shouldPauseViewportPrefetch() ) {
			return [];
		}

		const bestByToken = new Map();

		state.viewportPrefetchNodes.forEach( function ( node ) {
			if ( ! node || ! node.isConnected ) {
				state.viewportPrefetchNodes.delete( node );
				return;
			}

			const token = getMarkerToken( node );
			if ( ! isViewportPrefetchCandidate( token ) ) {
				return;
			}

			const ranking = getViewportPrefetchPriority( node, token );
			if ( ! ranking ) {
				return;
			}

			const existing = bestByToken.get( token );
			if (
				! existing ||
				ranking.priority < existing.priority ||
				( ranking.priority === existing.priority &&
					ranking.distance < existing.distance )
			) {
				bestByToken.set( token, ranking );
			}
		} );

		return Array.from( bestByToken.entries() )
			.sort( function ( left, right ) {
				if ( left[ 1 ].priority !== right[ 1 ].priority ) {
					return left[ 1 ].priority - right[ 1 ].priority;
				}

				return left[ 1 ].distance - right[ 1 ].distance;
			} )
			.map( function ( entry ) {
				return entry[ 0 ];
			} );
	}

	function queueViewportPrefetchBatch( tokens ) {
		const sessionId = getSessionId();
		const batchTokens = Array.isArray( tokens )
			? tokens.filter( function ( token ) {
					return isViewportPrefetchCandidate( token );
			  } )
			: [];

		if ( ! sessionId || ! batchTokens.length ) {
			return;
		}

		state.viewportPrefetchInFlight += 1;

		loadDescriptorPayloadBatch( sessionId, batchTokens )
			.catch( function () {} )
			.finally( function () {
				state.viewportPrefetchInFlight = Math.max(
					0,
					state.viewportPrefetchInFlight - 1
				);
				scheduleViewportPrefetch();
			} );
	}

	function pumpViewportPrefetchQueue( deadline ) {
		const span = createPerformanceSpan( 'prefetch.pump' );

		try {
			state.viewportPrefetchIdleHandle = 0;
			state.viewportPrefetchTimer = 0;

			if ( shouldPauseViewportPrefetch() ) {
				state.viewportPrefetchQueue = [];
				return;
			}

			state.viewportPrefetchQueue = rebuildViewportPrefetchQueue();

			if ( ! state.viewportPrefetchQueue.length ) {
				return;
			}

			let dispatched = 0;
			while (
				state.viewportPrefetchInFlight <
					getViewportPrefetchConcurrency() &&
				state.viewportPrefetchQueue.length &&
				dispatched < getViewportPrefetchCycleBudget()
			) {
				if (
					deadline &&
					typeof deadline.timeRemaining === 'function' &&
					dispatched > 0 &&
					deadline.timeRemaining() <= 4
				) {
					break;
				}

				const batchTokens = [];
				while (
					state.viewportPrefetchQueue.length &&
					batchTokens.length < getViewportPrefetchBatchSize() &&
					dispatched < getViewportPrefetchCycleBudget()
				) {
					const token = state.viewportPrefetchQueue.shift();
					if ( ! isViewportPrefetchCandidate( token ) ) {
						continue;
					}

					batchTokens.push( token );
					dispatched += 1;
				}

				if ( batchTokens.length ) {
					queueViewportPrefetchBatch( batchTokens );
				}
			}

			if (
				( state.viewportPrefetchQueue.length ||
					state.viewportPrefetchInFlight ) &&
				! shouldPauseViewportPrefetch()
			) {
				scheduleViewportPrefetch();
			}
		} finally {
			span.end();
		}
	}

	function scheduleViewportPrefetch() {
		if ( shouldPauseViewportPrefetch() ) {
			clearViewportPrefetchSchedule();
			state.viewportPrefetchQueue = [];
			return;
		}

		if ( state.viewportPrefetchIdleHandle || state.viewportPrefetchTimer ) {
			return;
		}

		if ( typeof window.requestIdleCallback === 'function' ) {
			state.viewportPrefetchIdleHandle = window.requestIdleCallback(
				function ( deadline ) {
					pumpViewportPrefetchQueue( deadline );
				},
				{ timeout: 400 }
			);
			return;
		}

		state.viewportPrefetchTimer = window.setTimeout( function () {
			pumpViewportPrefetchQueue();
		}, 120 );
	}

	function startViewportPrefetch( markers ) {
		const span = createPerformanceSpan( 'prefetch.setup' );

		try {
			if ( ! supportsViewportPrefetch() ) {
				return;
			}

			if ( state.viewportPrefetchObserver ) {
				state.viewportPrefetchObserver.disconnect();
			}

			state.viewportPrefetchNodes.clear();
			state.viewportPrefetchQueue = [];

			state.viewportPrefetchObserver = new window.IntersectionObserver(
				function ( entries ) {
					entries.forEach( function ( entry ) {
						if ( entry.isIntersecting ) {
							state.viewportPrefetchNodes.add( entry.target );
						} else {
							state.viewportPrefetchNodes.delete( entry.target );
						}
					} );

					scheduleViewportPrefetch();
				},
				{
					root: null,
					rootMargin: getViewportPrefetchRootMargin(),
					threshold: 0,
				}
			);

			( Array.isArray( markers ) ? markers : [] ).forEach(
				function ( node ) {
					if (
						node &&
						typeof state.viewportPrefetchObserver.observe ===
							'function'
					) {
						state.viewportPrefetchObserver.observe( node );
					}
				}
			);
		} finally {
			span.end();
		}
	}

	function loadDescriptorPayload( sessionId, token ) {
		const cached = getCachedDescriptorPayload( token );

		if ( cached && cached.ok && cached.descriptor ) {
			return Promise.resolve( cached );
		}

		if ( ! sessionId || ! token ) {
			return Promise.reject(
				new Error(
					strings().descriptorMissing || 'Descriptor not found.'
				)
			);
		}

		if ( state.descriptorRequests[ token ] ) {
			return state.descriptorRequests[ token ].then( clonePayload );
		}

		const descriptorRequestSpan =
			createPerformanceSpan( 'descriptor_request' );

		state.descriptorRequests[ token ] =
			window.DBVCVisualEditorApi.getDescriptor( sessionId, token )
				.then( function ( result ) {
					if ( ! result || ! result.ok || ! result.descriptor ) {
						throw new Error(
							strings().descriptorMissing ||
								'Descriptor not found.'
						);
					}

					cacheDescriptorPayload( result );

					return result;
				} )
				.catch( function ( error ) {
					if ( isSessionExpiredError( error ) ) {
						handleExpiredSession( error );
					}

					throw error;
				} )
				.finally( function () {
					descriptorRequestSpan.end();
					delete state.descriptorRequests[ token ];
				} );

		return state.descriptorRequests[ token ].then( clonePayload );
	}

	function loadDescriptorPayloadBatch( sessionId, tokens ) {
		const requestTokens = [];
		const seen = new Set();

		( Array.isArray( tokens ) ? tokens : [] ).forEach( function ( token ) {
			const normalizedToken = String( token || '' ).trim();
			if (
				! normalizedToken ||
				seen.has( normalizedToken ) ||
				getCachedDescriptorPayload( normalizedToken ) ||
				state.descriptorRequests[ normalizedToken ]
			) {
				return;
			}

			seen.add( normalizedToken );
			requestTokens.push( normalizedToken );
		} );

		if ( ! sessionId || ! requestTokens.length ) {
			return Promise.resolve( {} );
		}

		const descriptorRequestSpan = createPerformanceSpan(
			'descriptor_batch_request'
		);

		const batchRequest = window.DBVCVisualEditorApi.getDescriptors(
			sessionId,
			requestTokens
		)
			.then( function ( result ) {
				if (
					! result ||
					! result.ok ||
					! result.descriptorHydrations ||
					typeof result.descriptorHydrations !== 'object'
				) {
					throw new Error(
						strings().descriptorMissing || 'Descriptor not found.'
					);
				}

				cacheDescriptorHydrations( result.descriptorHydrations );

				return result.descriptorHydrations;
			} )
			.catch( function ( error ) {
				if ( isSessionExpiredError( error ) ) {
					handleExpiredSession( error );
				}

				throw error;
			} )
			.finally( function () {
				descriptorRequestSpan.end();
				requestTokens.forEach( function ( token ) {
					delete state.descriptorRequests[ token ];
				} );
			} );

		requestTokens.forEach( function ( token ) {
			state.descriptorRequests[ token ] = batchRequest.then(
				function ( hydrations ) {
					const payload =
						hydrations && hydrations[ token ]
							? Object.assign( { ok: true }, hydrations[ token ] )
							: null;
					if ( ! payload || ! payload.descriptor ) {
						throw new Error(
							strings().descriptorMissing ||
								'Descriptor not found.'
						);
					}

					return payload;
				}
			);
			state.descriptorRequests[ token ].catch( function () {} );
		} );

		return batchRequest;
	}

	function scheduleDescriptorPrefetch( node ) {
		const token = getMarkerToken( node );
		const sessionId = getSessionId();

		clearDescriptorPrefetch();

		if ( ! node || ! token || ! sessionId ) {
			return;
		}

		if (
			getCachedDescriptorPayload( token ) ||
			state.descriptorRequests[ token ]
		) {
			return;
		}

		state.prefetchToken = token;
		state.prefetchTimeout = window.setTimeout( function () {
			state.prefetchTimeout = 0;

			if ( state.prefetchToken !== token ) {
				return;
			}

			loadDescriptorPayload( sessionId, token ).catch( function () {} );
		}, 180 );
	}

	function bindMediaFramePrefetchState( mediaFrame ) {
		if ( ! mediaFrame || typeof mediaFrame.on !== 'function' ) {
			return;
		}

		mediaFrame.on( 'open', function () {
			state.mediaModalOpen = true;
			clearViewportPrefetchSchedule();
		} );

		mediaFrame.on( 'close', function () {
			state.mediaModalOpen = false;
			scheduleViewportPrefetch();
		} );
	}

	function getDescriptorRenderContext( descriptor, node ) {
		if (
			descriptor &&
			descriptor.render &&
			typeof descriptor.render.context === 'string' &&
			descriptor.render.context
		) {
			return descriptor.render.context;
		}

		if (
			node &&
			node.dataset &&
			typeof node.dataset.dbvcVeContext === 'string' &&
			node.dataset.dbvcVeContext
		) {
			return node.dataset.dbvcVeContext;
		}

		return 'text';
	}

	function getDescriptorRenderAttribute( descriptor, node ) {
		if (
			descriptor &&
			descriptor.render &&
			typeof descriptor.render.attribute === 'string' &&
			descriptor.render.attribute
		) {
			return descriptor.render.attribute;
		}

		if (
			node &&
			node.dataset &&
			typeof node.dataset.dbvcVeAttribute === 'string' &&
			node.dataset.dbvcVeAttribute
		) {
			return node.dataset.dbvcVeAttribute;
		}

		return '';
	}

	function getDescriptorTextProjection( descriptor, node ) {
		if (
			descriptor &&
			descriptor.render &&
			typeof descriptor.render.text_projection === 'string' &&
			descriptor.render.text_projection
		) {
			return descriptor.render.text_projection;
		}

		if (
			node &&
			node.dataset &&
			typeof node.dataset.dbvcVeTextProjection === 'string' &&
			node.dataset.dbvcVeTextProjection
		) {
			return node.dataset.dbvcVeTextProjection;
		}

		return '';
	}

	function getDescriptorTextTemplate( descriptor ) {
		return descriptor &&
			descriptor.render &&
			typeof descriptor.render.text_template === 'string' &&
			descriptor.render.text_template
			? descriptor.render.text_template
			: '';
	}

	function getDescriptorTextExpression( descriptor ) {
		return descriptor &&
			descriptor.render &&
			typeof descriptor.render.text_expression === 'string' &&
			descriptor.render.text_expression
			? descriptor.render.text_expression
			: '';
	}

	function hasHydratedDescriptorForNode( node, descriptor ) {
		if ( ! node || ! descriptor || ! descriptor.token ) {
			return false;
		}

		if (
			state.activeDescriptor &&
			state.activeDescriptor.token === descriptor.token
		) {
			return true;
		}

		return Boolean( getCachedDescriptorPayload( descriptor.token ) );
	}

	function lookupDescriptorForNode( node ) {
		if ( ! node ) {
			return null;
		}

		const token = node.getAttribute( 'data-dbvc-ve' );

		if (
			state.activeDescriptor &&
			state.activeDescriptor.token === token
		) {
			return state.activeDescriptor;
		}

		const cached = getCachedDescriptorPayload( token );

		if ( cached && cached.descriptor ) {
			return cached.descriptor;
		}

		return getSessionDescriptorSummary( token );
	}

	function getDescriptorDisplayKey( descriptor ) {
		return descriptor &&
			descriptor.render &&
			typeof descriptor.render.display_key === 'string' &&
			descriptor.render.display_key
			? descriptor.render.display_key
			: 'default';
	}

	function getDescriptorMediaSize( descriptor ) {
		return descriptor &&
			descriptor.source &&
			typeof descriptor.source.media_size === 'string' &&
			descriptor.source.media_size
			? descriptor.source.media_size
			: '';
	}

	function isMediaRenderContext( context ) {
		return context === 'image_src' || context === 'background_image';
	}

	function canPatchRenderContextWithoutReload( context ) {
		return (
			isMediaRenderContext( context ) || context === 'gallery_collection'
		);
	}

	function getDescriptorSourceGroup( descriptor, node ) {
		if (
			descriptor &&
			descriptor.render &&
			typeof descriptor.render.source_group === 'string' &&
			descriptor.render.source_group
		) {
			return descriptor.render.source_group;
		}

		if (
			node &&
			node.dataset &&
			typeof node.dataset.dbvcVeSourceGroup === 'string' &&
			node.dataset.dbvcVeSourceGroup
		) {
			return node.dataset.dbvcVeSourceGroup;
		}

		return '';
	}

	function getDescriptorStatus( descriptor, node ) {
		if (
			descriptor &&
			typeof descriptor.status === 'string' &&
			descriptor.status
		) {
			return descriptor.status;
		}

		if (
			node &&
			node.dataset &&
			typeof node.dataset.dbvcVeStatus === 'string' &&
			node.dataset.dbvcVeStatus
		) {
			return node.dataset.dbvcVeStatus;
		}

		return 'editable';
	}

	function getDescriptorScope( descriptor, node ) {
		if (
			descriptor &&
			typeof descriptor.scope === 'string' &&
			descriptor.scope
		) {
			return descriptor.scope;
		}

		if (
			! node ||
			! node.dataset ||
			typeof node.dataset.dbvcVeScope !== 'string'
		) {
			return 'current_entity';
		}

		if ( node.dataset.dbvcVeScope === 'shared' ) {
			return 'shared_entity';
		}

		if ( node.dataset.dbvcVeScope === 'related' ) {
			return 'related_entity';
		}

		return 'current_entity';
	}

	function getDescriptorEntityType( descriptor ) {
		return descriptor &&
			descriptor.entity &&
			typeof descriptor.entity.type === 'string' &&
			descriptor.entity.type
			? descriptor.entity.type
			: '';
	}

	function getDescriptorBadgeLabel( descriptor, node ) {
		if (
			descriptor &&
			descriptor.ui &&
			typeof descriptor.ui.badgeLabel === 'string'
		) {
			return descriptor.ui.badgeLabel.trim();
		}

		if (
			node &&
			node.dataset &&
			typeof node.dataset.dbvcVeBadgeLabel === 'string'
		) {
			return node.dataset.dbvcVeBadgeLabel.trim();
		}

		return descriptor && typeof descriptor.badgeLabel === 'string'
			? descriptor.badgeLabel.trim()
			: '';
	}

	function getDescriptorInputType( descriptor, node ) {
		if (
			descriptor &&
			descriptor.ui &&
			typeof descriptor.ui.input === 'string' &&
			descriptor.ui.input
		) {
			return descriptor.ui.input;
		}

		if (
			node &&
			node.dataset &&
			typeof node.dataset.dbvcVeInput === 'string' &&
			node.dataset.dbvcVeInput
		) {
			return node.dataset.dbvcVeInput;
		}

		return descriptor && typeof descriptor.input === 'string'
			? descriptor.input
			: '';
	}

	function isMissingMediaMarker( node ) {
		return Boolean(
			node && node.dataset && node.dataset.dbvcVeMissingMedia === '1'
		);
	}

	function getMissingMediaKind( node ) {
		if ( ! isMissingMediaMarker( node ) ) {
			return '';
		}

		return node.dataset.dbvcVeMissingMediaKind === 'gallery'
			? 'gallery'
			: 'image';
	}

	function getDescriptorQuerySource( descriptor ) {
		if (
			descriptor &&
			descriptor.source &&
			typeof descriptor.source.query_source === 'string'
		) {
			return descriptor.source.query_source;
		}

		return descriptor &&
			descriptor.index &&
			typeof descriptor.index.querySource === 'string'
			? descriptor.index.querySource
			: '';
	}

	function resolveRelatedBadgeLabel( entityType ) {
		if ( entityType === 'term' ) {
			return strings().badgeRelatedTerm || 'Related Term';
		}

		if ( entityType === 'user' ) {
			return strings().badgeRelatedUser || 'Related User';
		}

		if ( entityType === 'option' ) {
			return strings().badgeRelatedOption || 'Related Option';
		}

		if ( entityType === 'post' ) {
			return strings().badgeRelated || 'Related Post';
		}

		return strings().badgeRelatedGeneric || 'Related';
	}

	function resolveSharedBadgeLabel( entityType ) {
		if ( entityType === 'term' ) {
			return strings().badgeSharedTerm || 'Shared Term';
		}

		if ( entityType === 'user' ) {
			return strings().badgeSharedUser || 'Shared User';
		}

		if ( entityType === 'option' ) {
			return strings().badgeSharedOption || 'Shared Option';
		}

		if ( entityType === 'post' ) {
			return strings().badgeSharedPost || 'Shared Post';
		}

		return (
			strings().badgeShared || strings().badgeSharedGeneric || 'Shared'
		);
	}

	function resolveRelatedSaveLabel( entityType ) {
		if ( entityType === 'term' ) {
			return strings().panelRelatedScopeSaveTerm || 'Save related term';
		}

		if ( entityType === 'user' ) {
			return strings().panelRelatedScopeSaveUser || 'Save related user';
		}

		if ( entityType === 'option' ) {
			return (
				strings().panelRelatedScopeSaveOption || 'Save related option'
			);
		}

		if ( entityType === 'post' ) {
			return strings().panelRelatedScopeSave || 'Save related post';
		}

		return strings().panelRelatedScopeSaveGeneric || 'Save related item';
	}

	function resolveSharedSaveLabel( entityType ) {
		if ( entityType === 'term' ) {
			return strings().panelSharedScopeSaveTerm || 'Save shared term';
		}

		if ( entityType === 'user' ) {
			return strings().panelSharedScopeSaveUser || 'Save shared user';
		}

		if ( entityType === 'option' ) {
			return strings().panelSharedScopeSaveOption || 'Save shared option';
		}

		if ( entityType === 'post' ) {
			return strings().panelSharedScopeSavePost || 'Save shared post';
		}

		return (
			strings().panelSharedScopeSave ||
			strings().panelSharedScopeSaveGeneric ||
			'Save shared field'
		);
	}

	function resolveRelatedAckText( entityType ) {
		if ( entityType === 'term' ) {
			return (
				strings().panelRelatedScopeAckTerm ||
				'I understand this updates the related term shown in this Bricks query loop, not the current page.'
			);
		}

		if ( entityType === 'user' ) {
			return (
				strings().panelRelatedScopeAckUser ||
				'I understand this updates the related user shown in this Bricks query loop, not the current page.'
			);
		}

		if ( entityType === 'option' ) {
			return (
				strings().panelRelatedScopeAckOption ||
				'I understand this updates the related option source shown in this Bricks query loop, not the current page.'
			);
		}

		if ( entityType === 'post' ) {
			return (
				strings().panelRelatedScopeAck ||
				'I understand this updates the related post shown in this Bricks query loop, not the current page.'
			);
		}

		return (
			strings().panelRelatedScopeAckGeneric ||
			'I understand this updates a related item shown in this Bricks query loop, not the current page.'
		);
	}

	function resolveSharedAckText( entityType ) {
		if ( entityType === 'term' ) {
			return (
				strings().panelSharedScopeAckTerm ||
				'I understand this updates a shared taxonomy term field and may affect other pages.'
			);
		}

		if ( entityType === 'user' ) {
			return (
				strings().panelSharedScopeAckUser ||
				'I understand this updates a shared user field and may affect other pages.'
			);
		}

		if ( entityType === 'option' ) {
			return (
				strings().panelSharedScopeAckOption ||
				'I understand this updates a shared Site Settings value and may affect other pages.'
			);
		}

		if ( entityType === 'post' ) {
			return (
				strings().panelSharedScopeAckPost ||
				'I understand this updates a shared post-owned field and may affect other pages.'
			);
		}

		return (
			strings().panelSharedScopeAck ||
			strings().panelSharedScopeAckGeneric ||
			'I understand this updates a shared field and may affect other pages.'
		);
	}

	function resolveRelatedRequiredText( entityType ) {
		if ( entityType === 'term' ) {
			return (
				strings().panelRelatedScopeRequiredTerm ||
				'Acknowledge the related-term warning before saving this field.'
			);
		}

		if ( entityType === 'user' ) {
			return (
				strings().panelRelatedScopeRequiredUser ||
				'Acknowledge the related-user warning before saving this field.'
			);
		}

		if ( entityType === 'option' ) {
			return (
				strings().panelRelatedScopeRequiredOption ||
				'Acknowledge the related-option warning before saving this field.'
			);
		}

		if ( entityType === 'post' ) {
			return (
				strings().panelRelatedScopeRequired ||
				'Acknowledge the related-post warning before saving this field.'
			);
		}

		return (
			strings().panelRelatedScopeRequiredGeneric ||
			'Acknowledge the related-item warning before saving this field.'
		);
	}

	function resolveSharedRequiredText( entityType ) {
		if ( entityType === 'term' ) {
			return (
				strings().panelSharedScopeRequiredTerm ||
				'Acknowledge the shared-term warning before saving this field.'
			);
		}

		if ( entityType === 'user' ) {
			return (
				strings().panelSharedScopeRequiredUser ||
				'Acknowledge the shared-user warning before saving this field.'
			);
		}

		if ( entityType === 'option' ) {
			return (
				strings().panelSharedScopeRequiredOption ||
				'Acknowledge the shared-option warning before saving this field.'
			);
		}

		if ( entityType === 'post' ) {
			return (
				strings().panelSharedScopeRequiredPost ||
				'Acknowledge the shared-post warning before saving this field.'
			);
		}

		return (
			strings().panelSharedScopeRequired ||
			strings().panelSharedScopeRequiredGeneric ||
			'Acknowledge the shared scope warning before saving this field.'
		);
	}

	function resolveScopeMetaLabel( scope, entityType ) {
		if ( scope === 'related_entity' ) {
			if ( entityType === 'term' ) {
				return strings().panelScopeRelatedTerm || 'related term';
			}

			if ( entityType === 'user' ) {
				return strings().panelScopeRelatedUser || 'related user';
			}

			if ( entityType === 'option' ) {
				return strings().panelScopeRelatedOption || 'related option';
			}

			if ( entityType === 'post' ) {
				return strings().panelScopeRelated || 'related post';
			}

			return strings().panelScopeRelatedGeneric || 'related item';
		}

		if ( scope === 'shared_entity' ) {
			if ( entityType === 'term' ) {
				return strings().panelScopeSharedTerm || 'shared term';
			}

			if ( entityType === 'user' ) {
				return strings().panelScopeSharedUser || 'shared user';
			}

			if ( entityType === 'option' ) {
				return strings().panelScopeSharedOption || 'shared option';
			}

			if ( entityType === 'post' ) {
				return strings().panelScopeSharedPost || 'shared post';
			}

			return (
				strings().panelScopeShared ||
				strings().panelScopeSharedGeneric ||
				'shared target'
			);
		}

		return '';
	}

	function normalizeProjection( candidate, fallbackValue, fallbackMode ) {
		if ( ! candidate || typeof candidate !== 'object' ) {
			return {
				key: 'default',
				value: typeof fallbackValue === 'string' ? fallbackValue : '',
				mode: fallbackMode || 'text',
			};
		}

		return {
			key:
				typeof candidate.key === 'string' && candidate.key
					? candidate.key
					: 'default',
			value:
				typeof candidate.value === 'string'
					? candidate.value
					: typeof fallbackValue === 'string'
					? fallbackValue
					: '',
			mode:
				typeof candidate.mode === 'string' && candidate.mode
					? candidate.mode
					: fallbackMode || 'text',
		};
	}

	function normalizeMediaReferenceValue( value ) {
		if ( ! value || typeof value !== 'object' ) {
			return {};
		}

		const attachmentId = Number( value.attachmentId || value.id || 0 ) || 0;

		return Object.assign( {}, value, {
			attachmentId,
			id: attachmentId,
		} );
	}

	function resolveMediaReferenceRenderData( value, descriptor ) {
		const normalized = normalizeMediaReferenceValue( value );
		const renderAttributes =
			normalized.renderAttributes &&
			typeof normalized.renderAttributes === 'object'
				? normalized.renderAttributes
				: {};

		return {
			attachmentId: normalized.attachmentId || 0,
			src: String(
				renderAttributes.src ||
					normalized.renderUrl ||
					normalized.fullUrl ||
					normalized.url ||
					''
			),
			srcset: String( renderAttributes.srcset || '' ),
			sizes: String( renderAttributes.sizes || '' ),
			fullUrl: String( normalized.fullUrl || normalized.url || '' ),
			alt: String( normalized.alt || normalized.title || '' ),
			title: String( normalized.title || '' ),
			mediaSize: getDescriptorMediaSize( descriptor ),
		};
	}

	function isEmptyMediaReferenceRenderData( renderData ) {
		if ( ! renderData || typeof renderData !== 'object' ) {
			return true;
		}

		return ! (
			Number( renderData.attachmentId || 0 ) ||
			String( renderData.src || '' ) ||
			String( renderData.fullUrl || '' )
		);
	}

	function resolveImageMediaNode( node ) {
		if ( ! node || node.nodeType !== 1 ) {
			return null;
		}

		if (
			node.matches &&
			( node.matches( 'img' ) || node.matches( 'picture' ) )
		) {
			return node;
		}

		const picture = node.querySelector
			? node.querySelector( 'picture' )
			: null;
		if ( picture ) {
			return picture;
		}

		return node.querySelector ? node.querySelector( 'img' ) : null;
	}

	function resolveImageElement( mediaNode ) {
		if ( ! mediaNode || mediaNode.nodeType !== 1 ) {
			return null;
		}

		if ( mediaNode.matches && mediaNode.matches( 'img' ) ) {
			return mediaNode;
		}

		return mediaNode.querySelector
			? mediaNode.querySelector( 'img' )
			: null;
	}

	function clearImageElementAttributes( imageNode, attribute ) {
		if ( ! imageNode ) {
			return;
		}

		const primaryAttribute = attribute || 'src';

		imageNode.removeAttribute( primaryAttribute );
		if ( primaryAttribute !== 'src' ) {
			imageNode.removeAttribute( 'src' );
		}
		imageNode.removeAttribute( 'srcset' );
		imageNode.removeAttribute( 'sizes' );
		imageNode.removeAttribute( 'alt' );
	}

	function rememberClearedMediaClassName( markerNode, mediaNode ) {
		if (
			! markerNode ||
			! markerNode.dataset ||
			! mediaNode ||
			! mediaNode.className ||
			typeof mediaNode.className !== 'string'
		) {
			return;
		}

		const className = mediaNode.className
			.split( /\s+/ )
			.filter( function ( name ) {
				return (
					name &&
					name !== 'dbvc-ve-media-cleared' &&
					name !== 'dbvc-ve-media-cleared-self'
				);
			} )
			.join( ' ' );

		if ( className ) {
			markerNode.dataset.dbvcVeClearedMediaClassName = className;
		}
	}

	function clearRenderedImageMediaNode( node, attribute ) {
		if ( ! node || node.nodeType !== 1 ) {
			return;
		}

		const mediaNode = resolveImageMediaNode( node );
		const imageNode = resolveImageElement( mediaNode );

		node.classList.add( 'dbvc-ve-media-cleared' );
		if ( node.dataset ) {
			node.dataset.dbvcVeDisplayValue = '';
		}

		if ( ! mediaNode ) {
			scheduleBadgeLayout();
			return;
		}

		if ( imageNode ) {
			clearImageElementAttributes( imageNode, attribute );
		}

		if (
			mediaNode === node ||
			mediaNode.hasAttribute( 'data-dbvc-ve' ) ||
			( mediaNode.querySelector &&
				mediaNode.querySelector( '[data-dbvc-ve]' ) )
		) {
			scheduleBadgeLayout();
			return;
		}

		rememberClearedMediaClassName( node, imageNode || mediaNode );
		mediaNode.remove();
		scheduleBadgeLayout();
	}

	function restoreClearedMediaState( node ) {
		if ( ! node || node.nodeType !== 1 ) {
			return;
		}

		node.classList.remove(
			'dbvc-ve-media-cleared',
			'dbvc-ve-media-cleared-self'
		);
		node.removeAttribute( 'aria-hidden' );

		if ( node.querySelectorAll ) {
			node.querySelectorAll( '.dbvc-ve-media-cleared-self' ).forEach(
				function ( item ) {
					item.classList.remove( 'dbvc-ve-media-cleared-self' );
					item.removeAttribute( 'aria-hidden' );
				}
			);
		}
	}

	function ensureRenderedImageElement( node ) {
		if ( ! node || node.nodeType !== 1 ) {
			return null;
		}

		const existing = resolveImageElement( resolveImageMediaNode( node ) );
		if ( existing ) {
			return existing;
		}

		const image = document.createElement( 'img' );
		const rememberedClass =
			node.dataset && node.dataset.dbvcVeClearedMediaClassName
				? String( node.dataset.dbvcVeClearedMediaClassName )
				: '';

		image.className = rememberedClass || 'dbvc-ve-live-media-image';

		if ( node.matches && node.matches( 'picture' ) ) {
			node.appendChild( image );
			return image;
		}

		const picture = node.querySelector
			? node.querySelector( 'picture' )
			: null;
		if ( picture ) {
			picture.appendChild( image );
			return image;
		}

		node.appendChild( image );
		return image;
	}

	function normalizeGalleryItems( value, descriptor ) {
		const items = Array.isArray( value )
			? value
			: value && typeof value === 'object' && Array.isArray( value.items )
			? value.items
			: [];
		const mediaSize = getDescriptorMediaSize( descriptor );

		return items
			.map( function ( item ) {
				if ( typeof item === 'number' || typeof item === 'string' ) {
					const id = Number( item ) || 0;

					return {
						id,
						url: '',
						renderUrl: '',
						alt: '',
						caption: '',
						title: '',
					};
				}

				if ( ! item || typeof item !== 'object' ) {
					return null;
				}

				const id = Number( item.id || item.ID || 0 ) || 0;
				const renderAttributes =
					item.renderAttributes &&
					typeof item.renderAttributes === 'object'
						? item.renderAttributes
						: {};
				const sizes =
					item.sizes && typeof item.sizes === 'object'
						? item.sizes
						: {};
				const sizeData =
					mediaSize && sizes[ mediaSize ] ? sizes[ mediaSize ] : null;

				return {
					id,
					url: String( item.url || item.fullUrl || '' ),
					renderUrl: String(
						renderAttributes.src ||
							item.renderUrl ||
							( sizeData && sizeData.url ) ||
							item.url ||
							item.fullUrl ||
							''
					),
					alt: String( item.alt || '' ),
					caption: String( item.caption || '' ),
					title: String( item.title || '' ),
				};
			} )
			.filter( Boolean );
	}

	function copyClassName( source, fallback ) {
		return source &&
			typeof source.className === 'string' &&
			source.className
			? source.className
			: fallback;
	}

	function patchGalleryCollectionNode( node, value, descriptor ) {
		if ( ! node ) {
			return 0;
		}

		const items = normalizeGalleryItems( value, descriptor );
		const existingChildren = Array.from( node.children || [] );
		const existingItem = existingChildren[ 0 ] || null;
		const existingFigure =
			existingItem &&
			existingItem.matches &&
			existingItem.matches( 'figure' )
				? existingItem
				: existingItem && existingItem.querySelector
				? existingItem.querySelector( 'figure' )
				: null;
		const existingAnchor =
			existingItem && existingItem.querySelector
				? existingItem.querySelector( 'a' )
				: null;
		const existingImage =
			existingItem && existingItem.querySelector
				? existingItem.querySelector( 'img' )
				: null;
		const usesListItems = [ 'UL', 'OL' ].indexOf( node.tagName ) !== -1;
		const itemTag = usesListItems ? 'li' : 'figure';
		const itemClassName = copyClassName(
			existingItem,
			'dbvc-ve-live-gallery-item'
		);
		const figureClassName =
			existingFigure && existingFigure !== existingItem
				? copyClassName( existingFigure, '' )
				: '';
		const anchorClassName = copyClassName( existingAnchor, '' );
		const imageClassName = copyClassName( existingImage, '' );

		node.innerHTML = '';

		items.forEach( function ( item ) {
			const id = Number( ( item && item.id ) || 0 ) || 0;
			const url =
				item && ( item.renderUrl || item.url )
					? String( item.renderUrl || item.url )
					: '';
			const fullUrl = item && item.url ? String( item.url ) : url;

			if ( ! url ) {
				return;
			}

			const itemNode = document.createElement( itemTag );
			let imageParent = itemNode;

			itemNode.className = itemClassName;
			itemNode.classList.add( 'dbvc-ve-live-gallery-item' );

			if ( id > 0 ) {
				itemNode.dataset.id = String( id );
			}

			if ( usesListItems ) {
				const figure = document.createElement( 'figure' );

				if ( figureClassName ) {
					figure.className = figureClassName;
				}

				itemNode.appendChild( figure );
				imageParent = figure;
			}

			if ( existingAnchor ) {
				const anchor = document.createElement( 'a' );

				anchor.href = fullUrl || url;
				if ( anchorClassName ) {
					anchor.className = anchorClassName;
				}
				if ( existingAnchor.target ) {
					anchor.target = existingAnchor.target;
				}
				if ( existingAnchor.rel ) {
					anchor.rel = existingAnchor.rel;
				}

				imageParent.appendChild( anchor );
				imageParent = anchor;
			}

			const image = document.createElement( 'img' );

			image.src = url;
			image.alt = item && item.alt ? String( item.alt ) : '';
			image.loading = 'lazy';
			image.decoding = 'async';

			if ( imageClassName ) {
				image.className = imageClassName;
			}

			imageParent.appendChild( image );
			node.appendChild( itemNode );
		} );

		return items.length;
	}

	function mergeGalleryItems( existingItems, addedItems ) {
		const items = [];
		const seen = new Set();

		[ existingItems, addedItems ].forEach( function ( group ) {
			normalizeGalleryItems( group || [] ).forEach( function ( item ) {
				const id = Number( item.id || 0 ) || 0;

				if ( ! id || seen.has( id ) ) {
					return;
				}

				seen.add( id );
				items.push( item );
			} );
		} );

		return items;
	}

	function mapMediaSelectionToGalleryItem( data, descriptor ) {
		const mediaSize = getDescriptorMediaSize( descriptor );
		const sizes =
			data && data.sizes && typeof data.sizes === 'object'
				? data.sizes
				: {};
		const sizeData =
			mediaSize && sizes[ mediaSize ] ? sizes[ mediaSize ] : null;

		return {
			id: data && data.id ? Number( data.id ) : 0,
			url: data && data.url ? String( data.url ) : '',
			renderUrl:
				sizeData && sizeData.url
					? String( sizeData.url )
					: String( ( data && data.url ) || '' ),
			alt: data && data.alt ? String( data.alt ) : '',
			caption: data && data.caption ? String( data.caption ) : '',
			title: data && data.title ? String( data.title ) : '',
		};
	}

	function readComparableBackgroundImage( node ) {
		if ( ! node ) {
			return '';
		}

		const inlineStyle = node.getAttribute( 'style' ) || '';
		const inlineMatch = inlineStyle.match(
			/background(?:-image)?\s*:\s*url\((["']?)(.*?)\1\)/i
		);

		if ( inlineMatch && inlineMatch[ 2 ] ) {
			return normalizeValue( inlineMatch[ 2 ] );
		}

		if ( window.getComputedStyle ) {
			const computed =
				window.getComputedStyle( node ).backgroundImage || '';
			const computedMatch = computed.match( /url\((["']?)(.*?)\1\)/i );

			if ( computedMatch && computedMatch[ 2 ] ) {
				return normalizeValue( computedMatch[ 2 ] );
			}
		}

		return '';
	}

	function resolveDisplayProjection( descriptor, saveResult ) {
		const candidates = Array.isArray(
			saveResult && saveResult.displayCandidates
		)
			? saveResult.displayCandidates
			: [];
		const displayKey = getDescriptorDisplayKey( descriptor );
		let match = null;

		if ( candidates.length ) {
			match =
				candidates.find( function ( candidate ) {
					return (
						candidate &&
						typeof candidate.key === 'string' &&
						candidate.key === displayKey
					);
				} ) || null;

			if ( ! match && displayKey === 'default' ) {
				match = candidates[ 0 ] || null;
			}
		}

		return normalizeProjection(
			match,
			saveResult && saveResult.displayValue,
			saveResult && saveResult.displayMode
		);
	}

	function updateCachedDescriptors( syncGroup, sourceGroup, saveResult ) {
		const tokens = Object.keys( state.descriptorCache );
		const activeContext = getDescriptorRenderContext(
			state.activeDescriptor,
			state.activeNode
		);
		const activeMediaSize = getDescriptorMediaSize(
			state.activeDescriptor
		);

		tokens.forEach( function ( token ) {
			const payload = state.descriptorCache[ token ];
			const descriptor =
				payload && payload.descriptor ? payload.descriptor : null;
			const payloadGroup =
				descriptor &&
				payload.descriptor &&
				payload.descriptor.render &&
				typeof payload.descriptor.render.sync_group === 'string'
					? payload.descriptor.render.sync_group
					: '';
			const payloadSourceGroup = getDescriptorSourceGroup( descriptor );

			if ( sourceGroup ) {
				if ( payloadSourceGroup !== sourceGroup ) {
					return;
				}

				if (
					isMediaRenderContext( activeContext ) &&
					getDescriptorRenderContext( descriptor ) ===
						activeContext &&
					getDescriptorMediaSize( descriptor ) !== activeMediaSize
				) {
					return;
				}
			} else if ( syncGroup ) {
				if ( payloadGroup !== syncGroup ) {
					return;
				}
			} else if (
				token !==
				( state.activeDescriptor && state.activeDescriptor.token )
			) {
				return;
			}

			const projection = resolveDisplayProjection(
				descriptor,
				saveResult
			);

			payload.currentValue = saveResult.value;
			payload.displayValue = projection.value;
			payload.displayMode = projection.mode;

			if ( saveResult && saveResult.entitySummary ) {
				payload.entitySummary = clonePayload(
					saveResult.entitySummary
				);
			}

			if ( saveResult && saveResult.sourceSummary ) {
				payload.sourceSummary = clonePayload(
					saveResult.sourceSummary
				);
			}
		} );
	}

	function applyCollectionStateToDescriptor( descriptor, collectionState ) {
		if (
			! descriptor ||
			! descriptor.source ||
			! collectionState ||
			typeof collectionState !== 'object'
		) {
			return;
		}

		if ( Array.isArray( collectionState.queryResultIds ) ) {
			descriptor.source.query_result_ids =
				collectionState.queryResultIds.slice();
			descriptor.source.query_result_empty =
				collectionState.queryResultIds.length === 0;
		}

		if ( Array.isArray( collectionState.queryFullValueIds ) ) {
			descriptor.source.query_full_value_ids =
				collectionState.queryFullValueIds.slice();
		}

		if ( Array.isArray( collectionState.queryPreservedIds ) ) {
			descriptor.source.query_preserved_ids =
				collectionState.queryPreservedIds.slice();
		}
	}

	function applyCollectionStateToCachedDescriptors( saveResult ) {
		if ( ! saveResult || ! saveResult.collectionState ) {
			return;
		}

		Object.keys( state.descriptorCache ).forEach( function ( token ) {
			const payload = state.descriptorCache[ token ];

			if (
				payload &&
				payload.descriptor &&
				payload.descriptor.token === saveResult.token
			) {
				applyCollectionStateToDescriptor(
					payload.descriptor,
					saveResult.collectionState
				);
			}
		} );

		applyCollectionStateToDescriptor(
			state.activeDescriptor,
			saveResult.collectionState
		);
	}

	function normalizeValue( value ) {
		return String( value || '' )
			.replace( /\s+/g, ' ' )
			.trim();
	}

	function normalizeMediaComparableValue( value ) {
		const normalized = normalizeValue( value );

		if ( ! normalized ) {
			return '';
		}

		let path = '';

		try {
			path = new URL( normalized, window.location.origin ).pathname || '';
		} catch ( error ) {
			path = normalized;
		}

		path = path
			.replace( /-\d+x\d+(?=\.[a-zA-Z0-9]+$)/, '' )
			.trim()
			.replace( /^\/+/, '' )
			.toLowerCase();

		return path;
	}

	function valuesMatchForDescriptor(
		renderedValue,
		displayValue,
		descriptor,
		node
	) {
		const normalizedRendered = normalizeValue( renderedValue );
		const normalizedDisplay = normalizeValue( displayValue );

		if ( normalizedRendered === normalizedDisplay ) {
			return true;
		}

		const context = getDescriptorRenderContext( descriptor, node );
		if ( ! isMediaRenderContext( context ) ) {
			return false;
		}

		const renderedMedia = normalizeMediaComparableValue( renderedValue );
		const displayMedia = normalizeMediaComparableValue( displayValue );

		return (
			Boolean( renderedMedia ) &&
			Boolean( displayMedia ) &&
			renderedMedia === displayMedia
		);
	}

	function extractTextFromHtml( value ) {
		const wrapper = document.createElement( 'div' );
		wrapper.innerHTML = typeof value === 'string' ? value : '';

		return normalizeValue( wrapper.textContent || '' );
	}

	function extractDisplayText( displayValue, displayMode ) {
		if ( ( displayMode || 'text' ) === 'html' ) {
			return extractTextFromHtml( displayValue );
		}

		return normalizeValue( displayValue );
	}

	function projectDisplayValueForDescriptor(
		descriptor,
		displayValue,
		displayMode
	) {
		const mode = displayMode || 'text';
		const value = typeof displayValue === 'string' ? displayValue : '';

		if (
			! descriptor ||
			getDescriptorTextProjection( descriptor, null ) !==
				'single_embedded'
		) {
			return {
				value,
				mode,
			};
		}

		const template = getDescriptorTextTemplate( descriptor );
		const expression = getDescriptorTextExpression( descriptor );

		if (
			! template ||
			! expression ||
			template.indexOf( expression ) === -1
		) {
			return {
				value,
				mode,
			};
		}

		const projectedValue = template
			.split( expression )
			.join( mode === 'html' ? value : escapeHtml( value ) );

		return {
			value: projectedValue,
			mode: 'html',
		};
	}

	function extractProjectedDisplayText(
		descriptor,
		displayValue,
		displayMode
	) {
		const projected = projectDisplayValueForDescriptor(
			descriptor,
			displayValue,
			displayMode
		);

		return extractDisplayText( projected.value, projected.mode );
	}

	function formatSaveSummary( saveResult ) {
		const summary =
			saveResult &&
			saveResult.saveSummary &&
			typeof saveResult.saveSummary === 'object'
				? saveResult.saveSummary
				: null;

		if ( ! summary ) {
			return '';
		}

		const title = summary.title ? String( summary.title ) : '';
		const detail = summary.detail ? String( summary.detail ) : '';

		if ( title && detail ) {
			return `${ title }. ${ detail }`;
		}

		return title || detail || '';
	}

	function readNodeComparableValue( node, descriptor ) {
		if ( ! node ) {
			return '';
		}

		const context = getDescriptorRenderContext( descriptor, node );

		if ( context === 'link_href' ) {
			const attribute =
				getDescriptorRenderAttribute( descriptor, node ) || 'href';

			return normalizeValue( node.getAttribute( attribute ) || '' );
		}

		if ( context === 'image_src' ) {
			const attribute =
				getDescriptorRenderAttribute( descriptor, node ) || 'src';
			const imageNode =
				node.matches && node.matches( 'img' )
					? node
					: node.querySelector( 'img' );

			return normalizeValue(
				imageNode ? imageNode.getAttribute( attribute ) || '' : ''
			);
		}

		if ( context === 'background_image' ) {
			return readComparableBackgroundImage( node );
		}

		return normalizeValue( node.textContent || '' );
	}

	function getNodeDisplayValue( node, descriptor ) {
		if ( ! node ) {
			return '';
		}

		return typeof node.dataset.dbvcVeDisplayValue === 'string'
			? node.dataset.dbvcVeDisplayValue
			: readNodeComparableValue( node, descriptor );
	}

	function hasSourceMismatch( node, result ) {
		if (
			getDescriptorStatus( result && result.descriptor, node ) !==
			'editable'
		) {
			return false;
		}

		if (
			[ 'gallery_collection', 'query_collection' ].includes(
				getDescriptorRenderContext( result && result.descriptor, node )
			)
		) {
			return false;
		}

		if (
			result &&
			result.descriptor &&
			result.descriptor.render &&
			result.descriptor.render.value_match === true
		) {
			return false;
		}

		const renderedValue = getNodeDisplayValue(
			node,
			result && result.descriptor
		);
		const displayValue = extractProjectedDisplayText(
			result && result.descriptor,
			result.displayValue,
			result.displayMode
		);

		if ( ! renderedValue && ! displayValue ) {
			return false;
		}

		return ! valuesMatchForDescriptor(
			renderedValue,
			displayValue,
			result && result.descriptor,
			node
		);
	}

	function ensureStatusBar() {
		let bar = document.querySelector( '.dbvc-ve-statusbar' );
		const mount = getStatusBarMountNode();

		if ( bar ) {
			bindStatusBarEvents( bar );
			if ( mount && bar.parentNode !== mount ) {
				mount.appendChild( bar );
			}
			return bar;
		}

		bar = document.createElement( 'div' );
		bar.className = 'dbvc-ve-statusbar';
		bar.innerHTML = [
			'<div class="dbvc-ve-statusbar__title"></div>',
			'<div class="dbvc-ve-statusbar__meta"></div>',
			'<div class="dbvc-ve-statusbar__links"></div>',
			'<div class="dbvc-ve-statusbar__message"></div>',
		].join( '' );

		bindStatusBarEvents( bar );
		mount.appendChild( bar );

		return bar;
	}

	function normalizeStatusBarLink( link ) {
		if ( ! link || typeof link !== 'object' || ! link.url ) {
			return null;
		}

		return {
			url: String( link.url ),
			label: link.label ? String( link.label ) : String( link.url ),
		};
	}

	function getDefaultStatusBarEditLink() {
		const bootstrap = window.DBVCVisualEditorBootstrap || {};

		return normalizeStatusBarLink( bootstrap.currentEditLink || null );
	}

	function resolveStatusBarEditLinkFromEntitySummary( summary ) {
		if ( ! summary || typeof summary !== 'object' ) {
			return getDefaultStatusBarEditLink();
		}

		const backendLink = normalizeStatusBarLink(
			summary.backendLink || null
		);

		if ( ! backendLink ) {
			return getDefaultStatusBarEditLink();
		}

		const typeLabel = summary.typeLabel ? String( summary.typeLabel ) : '';
		const prefix = strings().statusbarEditEntity || 'Edit';

		return {
			url: backendLink.url,
			label: typeLabel ? `${ prefix } ${ typeLabel }` : backendLink.label,
		};
	}

	function createStatusBarLinkMarkup( link ) {
		if ( ! link || ! link.url ) {
			return '';
		}

		return `<a class="dbvc-ve-statusbar__link" href="${ escapeHtml(
			link.url
		) }" target="_blank" rel="noopener noreferrer">${ escapeHtml(
			link.label || link.url
		) }</a>`;
	}

	function getToolbarString( key, fallback ) {
		const value = strings()[ key ];

		return typeof value === 'string' && value ? value : fallback;
	}

	function isMediaManagerEnabled() {
		const bootstrap = window.DBVCVisualEditorBootstrap || {};
		const mediaManager = bootstrap.mediaManager;

		return Boolean(
			mediaManager &&
				typeof mediaManager === 'object' &&
				mediaManager.enabled === true
		);
	}

	function dispatchMediaManagerEvent( name, detail ) {
		if ( ! isMediaManagerEnabled() ) {
			return;
		}

		document.dispatchEvent(
			new CustomEvent( `dbvc:visual-editor:media-manager:${ name }`, {
				detail: detail || {},
			} )
		);
	}

	function isControlCenterEnabled() {
		const bootstrap = window.DBVCVisualEditorBootstrap || {};
		const controlCenter = bootstrap.controlCenter;

		return Boolean(
			controlCenter &&
				typeof controlCenter === 'object' &&
				controlCenter.enabled === true
		);
	}

	function dispatchControlCenterEvent( name, detail ) {
		if ( ! isControlCenterEnabled() ) {
			return;
		}

		document.dispatchEvent(
			new CustomEvent( `dbvc:visual-editor:control-center:${ name }`, {
				detail: detail || {},
			} )
		);
	}

	/**
	 * R4-D-1 — panel-saved signal for the Brand Control Center drawer's
	 * save-status-strip.
	 *
	 * Fires on every successful save from the editor panel (both composite
	 * and non-composite paths). The Control Center drawer's listener gates
	 * on `state.activeToken === detail.token` so saves for descriptors the
	 * drawer did not open are ignored downstream — no need to duplicate
	 * that gate here. Kept behind the Control Center enable check so the
	 * event never fires at all when the feature is off, matching the
	 * existing dispatchControlCenterEvent policy.
	 *
	 * @param {string} token Descriptor token that was just saved.
	 */
	function dispatchPanelSaved( token ) {
		if ( ! isControlCenterEnabled() ) {
			return;
		}
		if ( typeof token !== 'string' || ! token ) {
			return;
		}
		document.dispatchEvent(
			new CustomEvent( 'dbvc:visual-editor:panel:saved', {
				detail: { token },
			} )
		);
	}

	/**
	 * R3-C-2 — Control Center → Editor Panel bridge.
	 *
	 * The Brand Control Center drawer lives in a separate frontend module and
	 * cannot reach `mergeSharedGlobalInventory` / `openToolbarDescriptorPanel`
	 * directly (both are IIFE-scoped inside overlay-app.js). Instead the drawer
	 * dispatches `dbvc:visual-editor:absorb-descriptor` with the payload from
	 * R3-C-1's open route (`{descriptors, descriptorHydrations, token, publicId}`)
	 * and this listener does the merge + panel-open work using the same helpers
	 * the Shared Globals popover already uses — so the panel behaves identically
	 * whether a control was opened from the popover or from the drawer.
	 *
	 * Idempotent: gated by `state.controlCenterBridgeBound` so mount() calling
	 * this twice cannot double-bind. Guarded by `isControlCenterEnabled()` so
	 * the listener is a no-op when the feature is off.
	 */
	function bindControlCenterBridge() {
		if ( ! isControlCenterEnabled() || state.controlCenterBridgeBound ) {
			return;
		}

		state.controlCenterBridgeBound = true;
		document.addEventListener(
			'dbvc:visual-editor:absorb-descriptor',
			function ( event ) {
				const detail =
					event && event.detail && typeof event.detail === 'object'
						? event.detail
						: {};
				const token =
					typeof detail.token === 'string' && detail.token
						? detail.token
						: '';
				if ( ! token ) {
					return;
				}

				mergeSharedGlobalInventory( {
					descriptors: detail.descriptors,
					descriptorHydrations: detail.descriptorHydrations,
					fields: [],
					warnings: [],
				} );

				if ( findMarkerByToken( token ) ) {
					locateFieldIndexMarker( token, true );
					return;
				}

				openToolbarDescriptorPanel( token );
			}
		);
		// R5.later-b (2026-09-05): the drawer dispatches this when a
		// curator clicks Expand on a palette parent. Fetch the palette
		// descriptor via the same /control-center/open route the
		// drawer's Open button uses, then mount our modal popover
		// (Option Y — dedicated popup). Zero new REST routes; the
		// modal reuses the R5.later-y-2 lazy-open + save flow byte-
		// identical for each swatch's edits.
		document.addEventListener(
			'dbvc:visual-editor:open-palette-bulk',
			function ( event ) {
				if ( ! isControlCenterEnabled() ) {
					return;
				}
				const detail =
					event && event.detail && typeof event.detail === 'object'
						? event.detail
						: {};
				const publicId =
					typeof detail.publicId === 'string' && detail.publicId
						? detail.publicId
						: '';
				if ( ! publicId ) {
					return;
				}
				openPaletteBulkPopover( publicId );
			}
		);
	}

	function renderToolbarIcon( name ) {
		const attrs =
			'aria-hidden="true" focusable="false" viewBox="0 0 24 24"';
		const common =
			'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
		const filled = 'fill="currentColor"';
		const icons = {
			status: `<svg ${ attrs }><path ${ filled } d="M8 5a2 2 0 0 0-2 2v10a2 2 0 1 0 4 0V7a2 2 0 0 0-2-2Zm8 0a2 2 0 0 0-2 2v10a2 2 0 1 0 4 0V7a2 2 0 0 0-2-2Z"/></svg>`,
			layers: `<svg ${ attrs }><path ${ common } d="m12 3 8 4-8 4-8-4 8-4Z"/><path ${ common } d="m4 12 8 4 8-4"/><path ${ common } d="m4 17 8 4 8-4"/></svg>`,
			search: `<svg ${ attrs }><circle ${ common } cx="11" cy="11" r="6"/><path ${ common } d="m16 16 4 4"/></svg>`,
			media: `<svg ${ attrs }><rect ${ common } x="3" y="4" width="18" height="16" rx="2.5"/><circle ${ common } cx="8.75" cy="9.75" r="1.6"/><path ${ common } d="m4 16.5 4.5-4a1.8 1.8 0 0 1 2.4 0l3 2.7a1.8 1.8 0 0 0 2.4 0l3.7-2.6"/></svg>`,
			globe: `<svg ${ attrs }><circle ${ common } cx="12" cy="12" r="9"/><path ${ common } d="M3 12h18"/><path ${ common } d="M12 3c2.5 2.7 3.5 5.7 3.5 9s-1 6.3-3.5 9c-2.5-2.7-3.5-5.7-3.5-9S9.5 5.7 12 3Z"/></svg>`,
			edit: `<svg ${ attrs }><path ${ common } d="M4 20h16"/><path ${ common } d="m6 16 1-4 9-9 4 4-9 9-4 1Z"/><path ${ common } d="m14 5 4 4"/></svg>`,
			// R3-C — Brand Control Center toolbar entry (registered ahead of R3-C so
			// the icon key is available when the drawer entry is wired). Icon reads
			// as "adjustment controls" (three horizontal sliders with knob dots).
			sliders: `<svg ${ attrs }><path ${ common } d="M4 6h11"/><circle ${ common } cx="18" cy="6" r="2"/><path ${ common } d="M9 12H4"/><circle ${ common } cx="12" cy="12" r="2"/><path ${ common } d="M16 12h4"/><path ${ common } d="M4 18h11"/><circle ${ common } cx="18" cy="18" r="2"/></svg>`,
			more: `<svg ${ attrs }><circle ${ filled } cx="5" cy="12" r="1.8"/><circle ${ filled } cx="12" cy="12" r="1.8"/><circle ${ filled } cx="19" cy="12" r="1.8"/></svg>`,
			power: `<svg ${ attrs }><path ${ common } d="M12 2v10"/><path ${ common } d="M18.4 6.6a8 8 0 1 1-12.8 0"/></svg>`,
		};

		return icons[ name ] || icons.more;
	}

	function createToolbarButtonMarkup(
		action,
		icon,
		label,
		extraClass,
		disabled,
		accessibility
	) {
		const classes = [ 'dbvc-ve-toolbar__button' ];
		const attributes =
			accessibility && typeof accessibility === 'object'
				? accessibility
				: {};
		const controls = attributes.controls
			? ` aria-controls="${ escapeHtml( attributes.controls ) }"`
			: '';
		const expanded =
			typeof attributes.expanded === 'boolean'
				? ` aria-expanded="${ attributes.expanded ? 'true' : 'false' }"`
				: '';
		const hasPopup = attributes.hasPopup
			? ` aria-haspopup="${ escapeHtml( attributes.hasPopup ) }"`
			: '';

		if ( extraClass ) {
			classes.push( extraClass );
		}

		return [
			`<button type="button" class="${ classes.join(
				' '
			) }" data-dbvc-ve-toolbar-action="${ escapeHtml(
				action
			) }" aria-label="${ escapeHtml( label ) }" title="${ escapeHtml(
				label
			) }"${ controls }${ expanded }${ hasPopup }${
				disabled ? ' disabled aria-disabled="true"' : ''
			}>`,
			renderToolbarIcon( icon ),
			'<span class="dbvc-ve-toolbar__count" aria-hidden="true"></span>',
			'</button>',
		].join( '' );
	}

	function getToolbarToggleUrl() {
		const value =
			window.DBVCVisualEditorBootstrap &&
			window.DBVCVisualEditorBootstrap.toggleUrl;

		return typeof value === 'string' && value ? value : '';
	}

	function bindToolbarEvents( toolbar ) {
		if ( ! toolbar || toolbar.dataset.toolbarBound === '1' ) {
			return;
		}

		toolbar.dataset.toolbarBound = '1';
		toolbar.addEventListener( 'click', handleToolbarClick );

		if ( ! state.toolbarEventsBound ) {
			state.toolbarEventsBound = true;
			document.addEventListener(
				'pointerdown',
				handleToolbarOutsidePointerDown,
				true
			);
			document.addEventListener( 'keydown', handleToolbarKeydown, true );
		}
	}

	function ensureToolbar() {
		if ( state.toolbarNode && state.toolbarNode.isConnected ) {
			return state.toolbarNode;
		}

		let toolbar = document.querySelector( '.dbvc-ve-toolbar' );

		if ( ! toolbar ) {
			const toolbarLabel = getToolbarString(
				'toolbarLabel',
				'Visual Editor toolbar'
			);
			const statusLabel = getToolbarString(
				'toolbarStatus',
				'Visual Editor status'
			);
			const reviewLabel = getToolbarString(
				'toolbarReviewFields',
				'Review fields'
			);
			const goObjectLabel = getToolbarString(
				'toolbarGoToObject',
				'Go to object'
			);
			const mediaManagerLabel = getToolbarString(
				'toolbarMediaManager',
				'Media Manager'
			);
			const sharedGlobalsLabel = getToolbarString(
				'toolbarSharedGlobals',
				'Shared globals'
			);
			const controlCenterLabel = getToolbarString(
				'toolbarControlCenter',
				'Global Brand Controls'
			);
			const moreLabel = getToolbarString( 'toolbarMore', 'More options' );
			const editLabel = getToolbarString(
				'toolbarEditObject',
				'Edit object'
			);
			const exitLabel = getToolbarString(
				'toolbarExitMode',
				'Exit Visual Editor'
			);
			const toggleUrl = getToolbarToggleUrl();

			toolbar = document.createElement( 'div' );
			toolbar.className = 'dbvc-ve-toolbar';
			toolbar.setAttribute( 'role', 'toolbar' );
			toolbar.setAttribute( 'aria-label', toolbarLabel );
			toolbar.innerHTML = [
				createToolbarButtonMarkup(
					'status',
					'status',
					statusLabel,
					'dbvc-ve-toolbar__button--satellite',
					false
				),
				'<div class="dbvc-ve-toolbar__dock">',
				createToolbarButtonMarkup(
					'review-fields',
					'layers',
					reviewLabel,
					'dbvc-ve-toolbar__button--dock',
					false
				),
				createToolbarButtonMarkup(
					'go-object',
					'search',
					goObjectLabel,
					'dbvc-ve-toolbar__button--dock',
					false
				),
				isMediaManagerEnabled()
					? createToolbarButtonMarkup(
							'media-manager',
							'media',
							mediaManagerLabel,
							'dbvc-ve-toolbar__button--dock',
							false,
							{
								controls: 'dbvc-ve-media-manager',
								expanded: false,
								hasPopup: 'dialog',
							}
					  )
					: '',
				createToolbarButtonMarkup(
					'shared-globals',
					'globe',
					sharedGlobalsLabel,
					'dbvc-ve-toolbar__button--dock',
					false
				),
				isControlCenterEnabled()
					? createToolbarButtonMarkup(
							'control-center',
							'sliders',
							controlCenterLabel,
							'dbvc-ve-toolbar__button--dock',
							false,
							{
								controls: 'dbvc-ve-control-center',
								expanded: false,
								hasPopup: 'dialog',
							}
					  )
					: '',
				isMediaManagerEnabled() || isControlCenterEnabled()
					? ''
					: createToolbarButtonMarkup(
							'overflow',
							'more',
							moreLabel,
							'dbvc-ve-toolbar__button--dock',
							true
					  ),
				'</div>',
				`<a class="dbvc-ve-toolbar__button dbvc-ve-toolbar__button--satellite dbvc-ve-toolbar__edit-link is-disabled" data-dbvc-ve-toolbar-action="edit-object" aria-label="${ escapeHtml(
					editLabel
				) }" title="${ escapeHtml(
					editLabel
				) }" target="_blank" rel="noopener noreferrer" aria-disabled="true">${ renderToolbarIcon(
					'edit'
				) }</a>`,
				toggleUrl
					? `<a class="dbvc-ve-toolbar__button dbvc-ve-toolbar__button--satellite dbvc-ve-toolbar__button--power" data-dbvc-ve-toolbar-action="toggle-mode" aria-label="${ escapeHtml(
							exitLabel
					  ) }" title="${ escapeHtml(
							exitLabel
					  ) }" href="${ escapeHtml(
							toggleUrl
					  ) }">${ renderToolbarIcon( 'power' ) }</a>`
					: createToolbarButtonMarkup(
							'toggle-mode',
							'power',
							exitLabel,
							'dbvc-ve-toolbar__button--satellite dbvc-ve-toolbar__button--power',
							true
					  ),
				'<div class="dbvc-ve-toolbar__message" hidden></div>',
				'<div class="dbvc-ve-toolbar-popover" role="dialog" aria-modal="false" hidden>',
				'  <div class="dbvc-ve-toolbar-popover__header">',
				'    <div class="dbvc-ve-toolbar-popover__title" id="dbvc-ve-toolbar-popover-title"></div>',
				`    <button type="button" class="dbvc-ve-toolbar-popover__close" data-dbvc-ve-toolbar-action="close-popover" aria-label="${ escapeHtml(
					strings().panelCancel || 'Close'
				) }">×</button>`,
				'  </div>',
				'  <div class="dbvc-ve-toolbar-popover__body"></div>',
				'</div>',
				'<div class="dbvc-ve-toolbar__statusbar-parking" hidden></div>',
			].join( '' );

			document.body.appendChild( toolbar );
		}

		state.toolbarNode = toolbar;
		state.toolbarPopoverNode = toolbar.querySelector(
			'.dbvc-ve-toolbar-popover'
		);
		state.toolbarStatusbarParkingNode = toolbar.querySelector(
			'.dbvc-ve-toolbar__statusbar-parking'
		);
		bindToolbarEvents( toolbar );
		syncToolbarState( state.statusBarState || {} );

		return toolbar;
	}

	function getToolbarPopoverBody() {
		const toolbar = ensureToolbar();

		return toolbar.querySelector( '.dbvc-ve-toolbar-popover__body' );
	}

	function getStatusBarMountNode() {
		const toolbar = ensureToolbar();
		const popover =
			state.toolbarPopoverNode ||
			toolbar.querySelector( '.dbvc-ve-toolbar-popover' );
		const body = toolbar.querySelector( '.dbvc-ve-toolbar-popover__body' );

		if (
			popover &&
			body &&
			! popover.hidden &&
			( state.toolbarOpenPanel === 'status' ||
				state.toolbarOpenPanel === 'review-fields' )
		) {
			return body;
		}

		return (
			state.toolbarStatusbarParkingNode ||
			toolbar.querySelector( '.dbvc-ve-toolbar__statusbar-parking' ) ||
			document.body
		);
	}

	function clearToolbarPopoverBody( body, keepNode ) {
		if ( ! body ) {
			return;
		}

		Array.from( body.childNodes ).forEach( function ( node ) {
			if ( node !== keepNode ) {
				node.remove();
			}
		} );
	}

	function openStatusBarToolbarPopover( options ) {
		const toolbar = ensureToolbar();
		const popover =
			state.toolbarPopoverNode ||
			toolbar.querySelector( '.dbvc-ve-toolbar-popover' );
		const title = toolbar.querySelector(
			'.dbvc-ve-toolbar-popover__title'
		);
		const body = getToolbarPopoverBody();
		const expandIndex = Boolean( options && options.expandIndex );
		const wasReviewOpen = state.toolbarOpenPanel === 'review-fields';

		state.toolbarOpenPanel = expandIndex ? 'review-fields' : 'status';
		state.toolbarTriggerNode =
			options && options.trigger ? options.trigger : null;

		state.fieldIndexOpen = expandIndex;
		if ( expandIndex && ! wasReviewOpen ) {
			requestFieldIndexScrollReset();
		}

		if ( popover ) {
			popover.hidden = false;
			popover.setAttribute(
				'aria-labelledby',
				'dbvc-ve-toolbar-popover-title'
			);
		}

		if ( title ) {
			title.textContent = expandIndex
				? getToolbarString( 'toolbarReviewFields', 'Review fields' )
				: getToolbarString( 'toolbarStatus', 'Visual Editor status' );
		}

		const bar = ensureStatusBar();
		clearToolbarPopoverBody( body, bar );
		if ( body && bar.parentNode !== body ) {
			body.appendChild( bar );
		}

		updateToolbarExpandedState();
		updateStatusBar( {} );
	}

	function getToolbarObjectSearchFilterOptions() {
		return [
			{
				key: 'all',
				label: getToolbarString( 'toolbarObjectFilterAll', 'All' ),
			},
			{
				key: 'post',
				label: getToolbarString( 'toolbarObjectFilterPosts', 'Posts' ),
			},
			{
				key: 'term',
				label: getToolbarString( 'toolbarObjectFilterTerms', 'Terms' ),
			},
		];
	}

	function buildCurrentObjectShortcut() {
		const bootstrap = window.DBVCVisualEditorBootstrap || {};
		const pageContext =
			bootstrap.pageContext && typeof bootstrap.pageContext === 'object'
				? bootstrap.pageContext
				: {};
		const editLink = normalizeStatusBarLink(
			bootstrap.currentEditLink || null
		);
		const url = pageContext.url ? String( pageContext.url ) : '';
		const entityType = pageContext.entityType
			? String( pageContext.entityType )
			: '';
		const entityId = Number( pageContext.entityId || 0 ) || 0;

		if ( ! url && ! editLink ) {
			return null;
		}

		return {
			objectType: entityType === 'term' ? 'term' : 'post',
			id: entityId,
			title: getToolbarString( 'toolbarObjectCurrent', 'Current object' ),
			typeLabel:
				entityType === 'term'
					? getToolbarString(
							'toolbarObjectCurrentTerm',
							'Current term'
					  )
					: getToolbarString(
							'toolbarObjectCurrentPage',
							'Current page'
					  ),
			status: '',
			frontendUrl: url,
			backendUrl: editLink && editLink.url ? editLink.url : '',
			canEdit: Boolean( editLink && editLink.url ),
		};
	}

	function renderObjectSearchItem( item ) {
		const object = item && typeof item === 'object' ? item : {};
		const title = object.title
			? String( object.title )
			: `#${ Number( object.id || 0 ) || '' }`;
		const typeLabel = object.typeLabel
			? String( object.typeLabel )
			: object.objectType
			? String( object.objectType )
			: '';
		const status = object.status ? String( object.status ) : '';
		const meta = [ typeLabel, status ].filter( Boolean ).join( ' / ' );
		const frontendUrl = object.frontendUrl
			? String( object.frontendUrl )
			: '';
		const backendUrl = object.backendUrl ? String( object.backendUrl ) : '';
		const primaryUrl = frontendUrl || backendUrl;
		const primaryLabel = frontendUrl
			? getToolbarString( 'toolbarObjectOpenFrontend', 'Open' )
			: getToolbarString( 'toolbarObjectOpenBackend', 'Edit' );

		return [
			'<div class="dbvc-ve-toolbar-object__row">',
			'  <div class="dbvc-ve-toolbar-object__row-text">',
			`    <div class="dbvc-ve-toolbar-object__row-title">${ escapeHtml(
				title
			) }</div>`,
			meta
				? `    <div class="dbvc-ve-toolbar-object__row-meta">${ escapeHtml(
						meta
				  ) }</div>`
				: '',
			'  </div>',
			'  <div class="dbvc-ve-toolbar-object__row-actions">',
			primaryUrl
				? `    <a class="dbvc-ve-toolbar-object__action" href="${ escapeHtml(
						primaryUrl
				  ) }">${ escapeHtml( primaryLabel ) }</a>`
				: '',
			backendUrl && backendUrl !== primaryUrl
				? `    <a class="dbvc-ve-toolbar-object__action" href="${ escapeHtml(
						backendUrl
				  ) }" target="_blank" rel="noopener noreferrer">${ escapeHtml(
						getToolbarString( 'toolbarObjectEditBackend', 'Edit' )
				  ) }</a>`
				: '',
			'  </div>',
			'</div>',
		].join( '' );
	}

	function renderObjectSearchResults( body, items, message ) {
		const results = body
			? body.querySelector( '.dbvc-ve-toolbar-object__results' )
			: null;
		const shortcuts = body
			? body.querySelector( '.dbvc-ve-toolbar-object__shortcuts' )
			: null;

		if ( ! results ) {
			return;
		}

		if ( shortcuts ) {
			const current = buildCurrentObjectShortcut();
			shortcuts.innerHTML = current
				? [
						`<div class="dbvc-ve-toolbar-object__section-title">${ escapeHtml(
							getToolbarString(
								'toolbarObjectCurrentLabel',
								'Current'
							)
						) }</div>`,
						renderObjectSearchItem( current ),
				  ].join( '' )
				: '';
		}

		if ( message ) {
			results.innerHTML = `<div class="dbvc-ve-toolbar-object__empty">${ escapeHtml(
				message
			) }</div>`;
			return;
		}

		if ( ! Array.isArray( items ) || ! items.length ) {
			results.innerHTML = `<div class="dbvc-ve-toolbar-object__empty">${ escapeHtml(
				getToolbarString(
					'toolbarObjectNoResults',
					'No matching objects were found.'
				)
			) }</div>`;
			return;
		}

		results.innerHTML = [
			`<div class="dbvc-ve-toolbar-object__section-title">${ escapeHtml(
				getToolbarString( 'toolbarObjectResults', 'Results' )
			) }</div>`,
			items.map( renderObjectSearchItem ).join( '' ),
		].join( '' );
	}

	function performToolbarObjectSearch( body ) {
		const search = state.toolbarObjectSearchTerm;
		const objectType = state.toolbarObjectSearchType;
		const requestId = state.toolbarObjectSearchRequestId + 1;

		state.toolbarObjectSearchRequestId = requestId;
		renderObjectSearchResults(
			body,
			[],
			getToolbarString( 'toolbarObjectSearching', 'Searching...' )
		);

		window.DBVCVisualEditorApi.searchObjects( search, objectType )
			.then( function ( result ) {
				if (
					requestId !== state.toolbarObjectSearchRequestId ||
					state.toolbarOpenPanel !== 'go-object'
				) {
					return;
				}

				renderObjectSearchResults(
					body,
					result && Array.isArray( result.items ) ? result.items : [],
					''
				);
			} )
			.catch( function ( error ) {
				if ( requestId !== state.toolbarObjectSearchRequestId ) {
					return;
				}

				renderObjectSearchResults(
					body,
					[],
					error && error.message
						? error.message
						: getToolbarString(
								'toolbarObjectSearchFailed',
								'Object search failed.'
						  )
				);
			} );
	}

	function scheduleToolbarObjectSearch( body ) {
		if ( state.toolbarObjectSearchTimer ) {
			window.clearTimeout( state.toolbarObjectSearchTimer );
		}

		state.toolbarObjectSearchTimer = window.setTimeout( function () {
			state.toolbarObjectSearchTimer = 0;
			performToolbarObjectSearch( body );
		}, 180 );
	}

	function openObjectSearchToolbarPopover( options ) {
		const toolbar = ensureToolbar();
		const popover =
			state.toolbarPopoverNode ||
			toolbar.querySelector( '.dbvc-ve-toolbar-popover' );
		const title = toolbar.querySelector(
			'.dbvc-ve-toolbar-popover__title'
		);
		const body = getToolbarPopoverBody();
		const filters = getToolbarObjectSearchFilterOptions();

		state.toolbarOpenPanel = 'go-object';
		state.toolbarTriggerNode =
			options && options.trigger ? options.trigger : null;
		state.fieldIndexOpen = false;

		if ( state.toolbarObjectSearchType === '' ) {
			state.toolbarObjectSearchType = 'all';
		}

		if ( popover ) {
			popover.hidden = false;
			popover.setAttribute(
				'aria-labelledby',
				'dbvc-ve-toolbar-popover-title'
			);
		}

		if ( title ) {
			title.textContent = getToolbarString(
				'toolbarGoToObject',
				'Go to object'
			);
		}

		if ( body ) {
			body.innerHTML = [
				'<div class="dbvc-ve-toolbar-object">',
				'  <div class="dbvc-ve-toolbar-object__filters">',
				filters
					.map( function ( filter ) {
						const active =
							filter.key === state.toolbarObjectSearchType;

						return `<button type="button" class="dbvc-ve-toolbar-object__filter${
							active ? ' is-active' : ''
						}" data-dbvc-ve-object-filter="${ escapeHtml(
							filter.key
						) }" aria-pressed="${
							active ? 'true' : 'false'
						}">${ escapeHtml( filter.label ) }</button>`;
					} )
					.join( '' ),
				'  </div>',
				`  <input type="search" class="dbvc-ve-toolbar-object__search" value="${ escapeHtml(
					state.toolbarObjectSearchTerm
				) }" placeholder="${ escapeHtml(
					getToolbarString(
						'toolbarObjectSearchPlaceholder',
						'Search posts and terms...'
					)
				) }">`,
				'  <div class="dbvc-ve-toolbar-object__shortcuts"></div>',
				'  <div class="dbvc-ve-toolbar-object__results"></div>',
				'</div>',
			].join( '' );

			const input = body.querySelector(
				'.dbvc-ve-toolbar-object__search'
			);

			body.querySelectorAll( '[data-dbvc-ve-object-filter]' ).forEach(
				function ( button ) {
					button.addEventListener( 'click', function () {
						state.toolbarObjectSearchType =
							button.getAttribute(
								'data-dbvc-ve-object-filter'
							) || 'all';
						openObjectSearchToolbarPopover( {
							trigger: state.toolbarTriggerNode,
						} );
					} );
				}
			);

			if ( input ) {
				input.addEventListener( 'input', function () {
					state.toolbarObjectSearchTerm = input.value.trim();
					scheduleToolbarObjectSearch( body );
				} );

				window.setTimeout( function () {
					input.focus();
					input.select();
				}, 0 );
			}

			renderObjectSearchResults( body, [], '' );
			performToolbarObjectSearch( body );
		}

		updateToolbarExpandedState();
	}

	function buildSessionDescriptorEntry( token, domOrder ) {
		if (
			! token ||
			! state.session ||
			! state.session.descriptors ||
			typeof state.session.descriptors !== 'object' ||
			! state.session.descriptors[ token ] ||
			typeof state.session.descriptors[ token ] !== 'object'
		) {
			return null;
		}

		const descriptor = state.session.descriptors[ token ] || {};
		const cached = getCachedDescriptorPayload( token );
		const hydratedDescriptor =
			cached && cached.descriptor && typeof cached.descriptor === 'object'
				? cached.descriptor
				: null;
		const sourceSummary =
			cached &&
			cached.sourceSummary &&
			typeof cached.sourceSummary === 'object'
				? cached.sourceSummary
				: null;
		const entitySummary =
			cached &&
			cached.entitySummary &&
			typeof cached.entitySummary === 'object'
				? cached.entitySummary
				: null;
		const publicIndex =
			descriptor.index && typeof descriptor.index === 'object'
				? descriptor.index
				: {};
		const source =
			hydratedDescriptor &&
			hydratedDescriptor.source &&
			typeof hydratedDescriptor.source === 'object'
				? hydratedDescriptor.source
				: {};
		const index = Object.assign( {}, publicIndex );
		const entity =
			descriptor.entity && typeof descriptor.entity === 'object'
				? descriptor.entity
				: {};
		const hydratedEntity =
			hydratedDescriptor &&
			hydratedDescriptor.entity &&
			typeof hydratedDescriptor.entity === 'object'
				? hydratedDescriptor.entity
				: null;

		if ( ! index.sourceContext && source.source_context ) {
			index.sourceContext = String( source.source_context );
		}

		if ( ! index.fieldName && source.field_name ) {
			index.fieldName = String( source.field_name );
		}

		if ( ! index.fieldType && source.field_type ) {
			index.fieldType = String( source.field_type );
		}

		if (
			( ! Array.isArray( index.fieldGroupOptionPages ) ||
				! index.fieldGroupOptionPages.length ) &&
			Array.isArray( source.field_group_option_pages )
		) {
			index.fieldGroupOptionPages =
				source.field_group_option_pages.slice();
		}

		if ( ! index.fieldGroupTitle && source.field_group_title ) {
			index.fieldGroupTitle = String( source.field_group_title );
		}

		return {
			token,
			status:
				hydratedDescriptor &&
				typeof hydratedDescriptor.status === 'string' &&
				hydratedDescriptor.status
					? hydratedDescriptor.status
					: typeof descriptor.status === 'string' && descriptor.status
					? descriptor.status
					: 'editable',
			scope:
				hydratedDescriptor &&
				typeof hydratedDescriptor.scope === 'string' &&
				hydratedDescriptor.scope
					? hydratedDescriptor.scope
					: typeof descriptor.scope === 'string' && descriptor.scope
					? descriptor.scope
					: 'current_entity',
			label:
				sourceSummary && sourceSummary.label
					? String( sourceSummary.label )
					: hydratedDescriptor &&
					  hydratedDescriptor.ui &&
					  hydratedDescriptor.ui.label
					? String( hydratedDescriptor.ui.label )
					: descriptor.label
					? String( descriptor.label )
					: strings().fieldIndexFieldFallback || 'Field',
			input:
				hydratedDescriptor &&
				hydratedDescriptor.ui &&
				hydratedDescriptor.ui.input
					? String( hydratedDescriptor.ui.input )
					: descriptor.input
					? String( descriptor.input )
					: '',
			entity: Object.assign( {}, entity, hydratedEntity || {} ),
			sourceSummary,
			entitySummary,
			index,
			domOrder,
		};
	}

	function isConfiguredSharedGlobalCandidate( entry ) {
		const index =
			entry && entry.index && typeof entry.index === 'object'
				? entry.index
				: {};
		const inventory =
			entry &&
			state.toolbarSharedGlobalsByToken &&
			state.toolbarSharedGlobalsByToken[ entry.token ]
				? state.toolbarSharedGlobalsByToken[ entry.token ]
				: null;
		const fieldType = index.fieldType
			? String( index.fieldType )
			: inventory && inventory.fieldType
			? String( inventory.fieldType )
			: '';

		if (
			! inventory &&
			index.sourceContext !== 'toolbar_shared_global_option'
		) {
			return false;
		}

		return fieldType === 'relationship' || fieldType === 'post_object';
	}

	function getSharedGlobalEntries() {
		const tokens = new Set();

		Object.keys( state.toolbarSharedGlobalsByToken || {} ).forEach(
			function ( token ) {
				if ( token ) {
					tokens.add( token );
				}
			}
		);

		if (
			state.session &&
			state.session.descriptors &&
			typeof state.session.descriptors === 'object'
		) {
			Object.keys( state.session.descriptors ).forEach(
				function ( token ) {
					const entry = buildSessionDescriptorEntry(
						token,
						Number.MAX_SAFE_INTEGER
					);

					if ( entry && isConfiguredSharedGlobalCandidate( entry ) ) {
						tokens.add( token );
					}
				}
			);
		}

		return Array.from( tokens )
			.map( function ( token ) {
				return buildSessionDescriptorEntry(
					token,
					Number.MAX_SAFE_INTEGER
				);
			} )
			.filter( function ( entry ) {
				return entry && isConfiguredSharedGlobalCandidate( entry );
			} )
			.sort( function ( left, right ) {
				const leftField =
					left.index && left.index.fieldName
						? String( left.index.fieldName )
						: left.label;
				const rightField =
					right.index && right.index.fieldName
						? String( right.index.fieldName )
						: right.label;

				return leftField.localeCompare( rightField );
			} );
	}

	function getSharedGlobalGroupLabel( entry ) {
		const index =
			entry && entry.index && typeof entry.index === 'object'
				? entry.index
				: {};
		const inventory =
			entry &&
			state.toolbarSharedGlobalsByToken &&
			state.toolbarSharedGlobalsByToken[ entry.token ]
				? state.toolbarSharedGlobalsByToken[ entry.token ]
				: null;
		const optionPageList =
			Array.isArray( index.fieldGroupOptionPages ) &&
			index.fieldGroupOptionPages.length
				? index.fieldGroupOptionPages
				: inventory && Array.isArray( inventory.optionPages )
				? inventory.optionPages
				: [];
		const optionPages = optionPageList.length
			? optionPageList.filter( Boolean ).join( ', ' )
			: '';

		return (
			optionPages ||
			index.fieldGroupTitle ||
			( inventory && inventory.fieldGroupTitle ) ||
			getToolbarString( 'toolbarSharedGlobals', 'Shared globals' )
		);
	}

	function renderSharedGlobalEntry( entry ) {
		const index =
			entry.index && typeof entry.index === 'object' ? entry.index : {};
		const inventory =
			state.toolbarSharedGlobalsByToken &&
			state.toolbarSharedGlobalsByToken[ entry.token ]
				? state.toolbarSharedGlobalsByToken[ entry.token ]
				: null;
		const fieldType = index.fieldType
			? String( index.fieldType )
			: inventory && inventory.fieldType
			? String( inventory.fieldType )
			: '';
		const status =
			( inventory && inventory.configured ) ||
			index.sourceContext === 'toolbar_shared_global_option'
				? getToolbarString(
						'toolbarSharedGlobalConfigured',
						'Configured global'
				  )
				: getToolbarString(
						'toolbarSharedGlobalInspectOnly',
						'Inspect only'
				  );
		const itemCount =
			inventory && typeof inventory.itemCount === 'number'
				? `${ inventory.itemCount } ${
						inventory.itemCount === 1 ? 'item' : 'items'
				  }`
				: '';
		const details = [
			fieldType,
			index.fieldName ? String( index.fieldName ) : '',
			itemCount,
			status,
		]
			.filter( Boolean )
			.join( ' / ' );
		const label =
			entry.label ||
			( inventory && inventory.label ) ||
			index.label ||
			getToolbarString( 'fieldIndexFieldFallback', 'Field' );

		return [
			'<div class="dbvc-ve-toolbar-shared__row">',
			'  <div class="dbvc-ve-toolbar-shared__row-text">',
			`    <div class="dbvc-ve-toolbar-shared__row-title">${ escapeHtml(
				label
			) }</div>`,
			details
				? `    <div class="dbvc-ve-toolbar-shared__row-meta">${ escapeHtml(
						details
				  ) }</div>`
				: '',
			'  </div>',
			'  <div class="dbvc-ve-toolbar-shared__row-actions">',
			`    <button type="button" class="dbvc-ve-toolbar-shared__action" data-dbvc-ve-toolbar-shared-open="${ escapeHtml(
				entry.token
			) }">${ escapeHtml(
				getToolbarString( 'fieldIndexOpen', 'Open' )
			) }</button>`,
			'  </div>',
			'</div>',
		].join( '' );
	}

	function renderSharedGlobalsMarkup( entries, options ) {
		const renderOptions =
			options && typeof options === 'object' ? options : {};
		const warnings = Array.isArray( renderOptions.warnings )
			? renderOptions.warnings
			: [];

		if ( ! entries.length ) {
			return [
				'<div class="dbvc-ve-toolbar-shared">',
				renderOptions.loading
					? `<div class="dbvc-ve-toolbar-shared__notice">${ escapeHtml(
							getToolbarString(
								'toolbarSharedGlobalsLoading',
								'Loading shared globals...'
							)
					  ) }</div>`
					: '',
				warnings.length
					? `<div class="dbvc-ve-toolbar-object__empty">${ escapeHtml(
							warnings.join( ' ' )
					  ) }</div>`
					: '',
				`<div class="dbvc-ve-toolbar-object__empty">${ escapeHtml(
					getToolbarString(
						'toolbarSharedGlobalsEmpty',
						'No configured shared global relationship or post object fields are available.'
					)
				) }</div>`,
				'</div>',
			].join( '' );
		}

		const groups = new Map();

		entries.forEach( function ( entry ) {
			const label = getSharedGlobalGroupLabel( entry );
			const key = label.toLowerCase();

			if ( ! groups.has( key ) ) {
				groups.set( key, {
					label,
					entries: [],
				} );
			}

			groups.get( key ).entries.push( entry );
		} );

		return [
			'<div class="dbvc-ve-toolbar-shared">',
			`<div class="dbvc-ve-toolbar-shared__notice">${ escapeHtml(
				getToolbarString(
					'toolbarSharedGlobalsNotice',
					'Configured sitewide option-owned relationship/post_object fields are listed here with verified ACF metadata. Saving updates the global fallback field itself, uses shared acknowledgement, and reloads after save.'
				)
			) }</div>`,
			warnings.length
				? `<div class="dbvc-ve-toolbar-object__empty">${ escapeHtml(
						warnings.join( ' ' )
				  ) }</div>`
				: '',
			Array.from( groups.values() )
				.map( function ( group ) {
					return [
						`<div class="dbvc-ve-toolbar-object__section-title">${ escapeHtml(
							group.label
						) }</div>`,
						group.entries.map( renderSharedGlobalEntry ).join( '' ),
					].join( '' );
				} )
				.join( '' ),
			'</div>',
		].join( '' );
	}

	function openSharedGlobalsToolbarPopover( options ) {
		const toolbar = ensureToolbar();
		const popover =
			state.toolbarPopoverNode ||
			toolbar.querySelector( '.dbvc-ve-toolbar-popover' );
		const title = toolbar.querySelector(
			'.dbvc-ve-toolbar-popover__title'
		);
		const body = getToolbarPopoverBody();

		state.toolbarOpenPanel = 'shared-globals';
		state.toolbarTriggerNode =
			options && options.trigger ? options.trigger : null;
		state.fieldIndexOpen = false;

		if ( popover ) {
			popover.hidden = false;
			popover.setAttribute(
				'aria-labelledby',
				'dbvc-ve-toolbar-popover-title'
			);
		}

		if ( title ) {
			title.textContent = getToolbarString(
				'toolbarSharedGlobals',
				'Shared globals'
			);
		}

		if ( body ) {
			body.innerHTML = renderSharedGlobalsMarkup(
				getSharedGlobalEntries()
			);
			bindSharedGlobalsToolbarActions( body );
			loadConfiguredSharedGlobals( body );
		}

		updateToolbarExpandedState();
	}

	function bindSharedGlobalsToolbarActions( body ) {
		if ( ! body ) {
			return;
		}

		body.querySelectorAll( '[data-dbvc-ve-toolbar-shared-open]' ).forEach(
			function ( button ) {
				button.addEventListener( 'click', function () {
					const token =
						button.getAttribute(
							'data-dbvc-ve-toolbar-shared-open'
						) || '';

					closeToolbarPopover();

					if ( findMarkerByToken( token ) ) {
						locateFieldIndexMarker( token, true );
						return;
					}

					openToolbarDescriptorPanel( token );
				} );
			}
		);
	}

	function loadConfiguredSharedGlobals( body ) {
		const sessionId = getSessionId();
		const requestId = state.toolbarSharedGlobalsRequestId + 1;

		state.toolbarSharedGlobalsRequestId = requestId;

		if (
			! body ||
			! sessionId ||
			! window.DBVCVisualEditorApi ||
			typeof window.DBVCVisualEditorApi.getSharedGlobalFields !==
				'function'
		) {
			return;
		}

		body.innerHTML = renderSharedGlobalsMarkup( getSharedGlobalEntries(), {
			loading: true,
		} );
		bindSharedGlobalsToolbarActions( body );

		window.DBVCVisualEditorApi.getSharedGlobalFields( sessionId )
			.then( function ( result ) {
				if (
					state.toolbarSharedGlobalsRequestId !== requestId ||
					state.toolbarOpenPanel !== 'shared-globals'
				) {
					return;
				}

				mergeSharedGlobalInventory( result );
				body.innerHTML = renderSharedGlobalsMarkup(
					getSharedGlobalEntries(),
					{
						warnings:
							result && Array.isArray( result.warnings )
								? result.warnings
								: [],
					}
				);
				bindSharedGlobalsToolbarActions( body );
			} )
			.catch( function ( error ) {
				if ( isSessionExpiredError( error ) ) {
					handleExpiredSession( error );
				}

				if (
					state.toolbarSharedGlobalsRequestId !== requestId ||
					state.toolbarOpenPanel !== 'shared-globals'
				) {
					return;
				}

				body.innerHTML = renderSharedGlobalsMarkup(
					getSharedGlobalEntries(),
					{
						warnings: [
							error && error.message
								? error.message
								: getToolbarString(
										'toolbarSharedGlobalsFailed',
										'Shared globals could not be loaded.'
								  ),
						],
					}
				);
				bindSharedGlobalsToolbarActions( body );
			} );
	}

	function closeToolbarPopover() {
		const toolbar = state.toolbarNode;
		const popover = state.toolbarPopoverNode;

		if ( state.toolbarObjectSearchTimer ) {
			window.clearTimeout( state.toolbarObjectSearchTimer );
			state.toolbarObjectSearchTimer = 0;
		}

		state.toolbarObjectSearchRequestId += 1;
		state.toolbarSharedGlobalsRequestId += 1;
		state.toolbarOpenPanel = '';
		state.toolbarTriggerNode = null;

		if ( popover ) {
			popover.hidden = true;
		}

		if ( toolbar ) {
			const parking =
				state.toolbarStatusbarParkingNode ||
				toolbar.querySelector( '.dbvc-ve-toolbar__statusbar-parking' );
			const bar = toolbar.querySelector( '.dbvc-ve-statusbar' );

			if ( parking && bar && bar.parentNode !== parking ) {
				parking.appendChild( bar );
			}
		}

		updateToolbarExpandedState();
	}

	function updateToolbarExpandedState() {
		const toolbar = state.toolbarNode;

		if ( ! toolbar ) {
			return;
		}

		toolbar.classList.toggle(
			'is-popover-open',
			Boolean( state.toolbarOpenPanel )
		);
		toolbar
			.querySelectorAll( '[data-dbvc-ve-toolbar-action]' )
			.forEach( function ( node ) {
				const action =
					node.getAttribute( 'data-dbvc-ve-toolbar-action' ) || '';
				const expanded = action === state.toolbarOpenPanel;

				if ( action === 'status' || action === 'review-fields' ) {
					node.setAttribute(
						'aria-expanded',
						expanded ? 'true' : 'false'
					);
				}
			} );
	}

	function syncToolbarState( nextState ) {
		const toolbar =
			state.toolbarNode && state.toolbarNode.isConnected
				? state.toolbarNode
				: document.querySelector( '.dbvc-ve-toolbar' );

		if ( ! toolbar ) {
			return;
		}

		const statusButton = toolbar.querySelector(
			'[data-dbvc-ve-toolbar-action="status"]'
		);
		const reviewButton = toolbar.querySelector(
			'[data-dbvc-ve-toolbar-action="review-fields"]'
		);
		const editLink = toolbar.querySelector(
			'[data-dbvc-ve-toolbar-action="edit-object"]'
		);
		const message = toolbar.querySelector( '.dbvc-ve-toolbar__message' );
		const count =
			typeof nextState.count === 'number' ? nextState.count : null;
		const countText = count !== null ? String( count ) : '';
		const statusText = nextState.message
			? String( nextState.message )
			: [
					strings().modeActive || 'Visual Editor active',
					getStatusBarCountText( count ),
			  ]
					.filter( Boolean )
					.join( ' / ' );

		toolbar.dataset.state = nextState.kind || 'active';

		[ statusButton, reviewButton ].forEach( function ( button ) {
			if ( ! button ) {
				return;
			}

			button.dataset.state = nextState.kind || 'active';
			button.title =
				statusText || button.getAttribute( 'aria-label' ) || '';
			const countNode = button.querySelector( '.dbvc-ve-toolbar__count' );
			if ( countNode ) {
				countNode.textContent = countText;
				countNode.hidden = count === null;
			}
		} );

		if ( editLink ) {
			const link = normalizeStatusBarLink( nextState.editLink || null );
			const label =
				link && link.label
					? link.label
					: getToolbarString( 'toolbarEditObject', 'Edit object' );

			editLink.setAttribute( 'aria-label', label );
			editLink.title = label;

			if ( link && link.url ) {
				editLink.href = link.url;
				editLink.classList.remove( 'is-disabled' );
				editLink.setAttribute( 'aria-disabled', 'false' );
			} else {
				editLink.removeAttribute( 'href' );
				editLink.classList.add( 'is-disabled' );
				editLink.setAttribute( 'aria-disabled', 'true' );
			}
		}

		if ( message ) {
			message.textContent = nextState.message || '';
			message.hidden = ! nextState.message;
		}

		updateToolbarExpandedState();
	}

	function handleToolbarClick( event ) {
		const statusbarActionNode =
			event.target && typeof event.target.closest === 'function'
				? event.target.closest( '[data-dbvc-ve-statusbar-action]' )
				: null;

		if ( statusbarActionNode ) {
			handleStatusBarClick( event );
			return;
		}

		const actionNode =
			event.target && typeof event.target.closest === 'function'
				? event.target.closest( '[data-dbvc-ve-toolbar-action]' )
				: null;

		if ( ! actionNode ) {
			return;
		}

		const action =
			actionNode.getAttribute( 'data-dbvc-ve-toolbar-action' ) || '';

		if (
			actionNode.disabled ||
			actionNode.getAttribute( 'aria-disabled' ) === 'true'
		) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}

		if ( action === 'media-manager' ) {
			event.preventDefault();
			event.stopPropagation();
			closeToolbarPopover();
			dispatchMediaManagerEvent( 'toggle', { trigger: actionNode } );
			dispatchControlCenterEvent( 'close', { restoreFocus: false } );
			return;
		}

		if ( action === 'control-center' ) {
			event.preventDefault();
			event.stopPropagation();
			closeToolbarPopover();
			dispatchMediaManagerEvent( 'close', { restoreFocus: false } );
			dispatchControlCenterEvent( 'toggle', { trigger: actionNode } );
			return;
		}

		dispatchMediaManagerEvent( 'close', { restoreFocus: false } );
		dispatchControlCenterEvent( 'close', { restoreFocus: false } );

		if ( action === 'edit-object' || action === 'toggle-mode' ) {
			closeToolbarPopover();
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		if ( action === 'close-popover' ) {
			const trigger = state.toolbarTriggerNode;
			closeToolbarPopover();
			if ( trigger && typeof trigger.focus === 'function' ) {
				trigger.focus();
			}
			return;
		}

		if ( action === 'status' ) {
			if ( state.toolbarOpenPanel === 'status' ) {
				closeToolbarPopover();
			} else {
				openStatusBarToolbarPopover( {
					trigger: actionNode,
					expandIndex: false,
				} );
			}
			return;
		}

		if ( action === 'review-fields' ) {
			if ( state.toolbarOpenPanel === 'review-fields' ) {
				closeToolbarPopover();
			} else {
				openStatusBarToolbarPopover( {
					trigger: actionNode,
					expandIndex: true,
				} );
			}
			return;
		}

		if ( action === 'go-object' ) {
			if ( state.toolbarOpenPanel === 'go-object' ) {
				closeToolbarPopover();
			} else {
				openObjectSearchToolbarPopover( { trigger: actionNode } );
			}
			return;
		}

		if ( action === 'shared-globals' ) {
			if ( state.toolbarOpenPanel === 'shared-globals' ) {
				closeToolbarPopover();
			} else {
				openSharedGlobalsToolbarPopover( { trigger: actionNode } );
			}
		}
	}

	function handleToolbarOutsidePointerDown( event ) {
		if ( ! state.toolbarOpenPanel ) {
			return;
		}

		const target = event.target;

		if ( ! target || isWpMediaModalElement( target ) ) {
			return;
		}

		if ( target.closest && target.closest( '.dbvc-ve-toolbar' ) ) {
			return;
		}

		closeToolbarPopover();
	}

	function handleToolbarKeydown( event ) {
		if ( ! state.toolbarOpenPanel || event.key !== 'Escape' ) {
			return;
		}

		closeToolbarPopover();
		event.preventDefault();
		event.stopPropagation();
	}

	function bindStatusBarEvents( bar ) {
		if ( ! bar || bar.dataset.fieldIndexBound === '1' ) {
			return;
		}

		bar.dataset.fieldIndexBound = '1';
		bar.addEventListener( 'click', handleStatusBarClick );
	}

	function handleStatusBarClick( event ) {
		const actionNode =
			event.target && typeof event.target.closest === 'function'
				? event.target.closest( '[data-dbvc-ve-statusbar-action]' )
				: null;

		if ( ! actionNode ) {
			return;
		}

		const action =
			actionNode.getAttribute( 'data-dbvc-ve-statusbar-action' ) || '';
		const token = actionNode.getAttribute( 'data-token' ) || '';

		event.preventDefault();
		event.stopPropagation();

		if ( action === 'toggle-field-index' ) {
			state.fieldIndexOpen = ! state.fieldIndexOpen;
			requestFieldIndexScrollReset();
			updateStatusBar( {} );
			return;
		}

		if (
			action === 'expand-field-sections' ||
			action === 'collapse-field-sections'
		) {
			setFieldIndexSectionsOpen(
				actionNode,
				action === 'expand-field-sections'
			);
			return;
		}

		if ( action === 'filter-field-index' ) {
			setFieldIndexFilter(
				actionNode.getAttribute( 'data-filter' ) || 'all'
			);
			return;
		}

		if ( action === 'locate-field' ) {
			locateFieldIndexMarker( token, false );
			return;
		}

		if ( action === 'open-field' ) {
			if ( state.toolbarOpenPanel ) {
				closeToolbarPopover();
			}
			locateFieldIndexMarker( token, true );
		}
	}

	function getStatusBarCountText( count ) {
		return typeof count === 'number'
			? `${ count } ${ strings().supportedCount || 'marked fields' }`
			: '';
	}

	function normalizeFieldIndexFilter( filter ) {
		const value = String( filter || '' ).trim();

		return [ 'all', 'editable', 'shared', 'related', 'inspect' ].indexOf(
			value
		) !== -1
			? value
			: 'all';
	}

	function setFieldIndexFilter( filter ) {
		state.fieldIndexFilter = normalizeFieldIndexFilter( filter );
		state.fieldIndexOpenSections = new Set();
		state.fieldIndexSectionStateCaptured = false;
		requestFieldIndexScrollReset();
		updateStatusBar( {} );
	}

	function setFieldIndexSectionsOpen( actionNode, open ) {
		const group =
			actionNode && typeof actionNode.closest === 'function'
				? actionNode.closest( '.dbvc-ve-field-index__group' )
				: null;
		const root =
			group ||
			( actionNode && typeof actionNode.closest === 'function'
				? actionNode.closest( '.dbvc-ve-field-index' )
				: null );

		if ( ! root ) {
			return;
		}

		root.querySelectorAll( '.dbvc-ve-field-index__section' ).forEach(
			function ( node ) {
				node.open = Boolean( open );
			}
		);

		captureFieldIndexOpenState();
	}

	function requestFieldIndexScrollReset() {
		state.fieldIndexScrollTop = 0;
		state.fieldIndexResetScroll = true;
	}

	function getFieldIndexScrollNode() {
		const bar = document.querySelector( '.dbvc-ve-statusbar' );

		return bar ? bar.querySelector( '.dbvc-ve-field-index' ) : null;
	}

	function captureFieldIndexScrollState() {
		const indexNode = getFieldIndexScrollNode();

		if ( ! indexNode ) {
			return state.fieldIndexScrollTop || 0;
		}

		state.fieldIndexScrollTop = Math.max(
			0,
			Number( indexNode.scrollTop ) || 0
		);

		return state.fieldIndexScrollTop;
	}

	function restoreFieldIndexScrollState() {
		const indexNode = getFieldIndexScrollNode();

		if ( ! indexNode ) {
			state.fieldIndexResetScroll = false;
			return;
		}

		const maxScrollTop = Math.max(
			0,
			indexNode.scrollHeight - indexNode.clientHeight
		);
		const nextScrollTop = state.fieldIndexResetScroll
			? 0
			: Math.min(
					Math.max( 0, state.fieldIndexScrollTop || 0 ),
					maxScrollTop
			  );

		indexNode.scrollTop = nextScrollTop;
		state.fieldIndexScrollTop = nextScrollTop;
		state.fieldIndexResetScroll = false;
	}

	function scheduleFieldIndexRefresh() {
		if ( ! state.fieldIndexOpen || state.fieldIndexRefreshFrame ) {
			return;
		}

		state.fieldIndexRefreshFrame = window.requestAnimationFrame(
			function () {
				state.fieldIndexRefreshFrame = 0;
				updateStatusBar( {} );
			}
		);
	}

	function captureFieldIndexOpenState() {
		const bar = document.querySelector( '.dbvc-ve-statusbar' );
		const openSections = new Set();
		const openItems = new Set();
		let sectionCount = 0;

		if ( ! bar || ! bar.querySelector( '.dbvc-ve-field-index' ) ) {
			return;
		}

		bar.querySelectorAll(
			'.dbvc-ve-field-index__section[data-section-key]'
		).forEach( function ( node ) {
			const key = node.getAttribute( 'data-section-key' ) || '';

			sectionCount += 1;
			if ( key && node.open ) {
				openSections.add( key );
			}
		} );

		bar.querySelectorAll(
			'.dbvc-ve-field-index__item[data-item-key]'
		).forEach( function ( node ) {
			const key = node.getAttribute( 'data-item-key' ) || '';

			if ( key && node.open ) {
				openItems.add( key );
			}
		} );

		if ( sectionCount > 0 ) {
			state.fieldIndexOpenSections = openSections;
			state.fieldIndexSectionStateCaptured = true;
		}
		state.fieldIndexOpenItems = openItems;
	}

	function getSessionDescriptorEntries() {
		if (
			! state.session ||
			! state.session.descriptors ||
			typeof state.session.descriptors !== 'object'
		) {
			return [];
		}

		const markerOrder = new Map();

		findMarkers().forEach( function ( node, index ) {
			const token = getMarkerToken( node );

			if ( token && ! markerOrder.has( token ) ) {
				markerOrder.set( token, index );
			}
		} );

		return Object.keys( state.session.descriptors )
			.filter( function ( token ) {
				return markerOrder.has( token );
			} )
			.map( function ( token ) {
				const descriptor = state.session.descriptors[ token ] || {};
				const cached = getCachedDescriptorPayload( token );
				const hydratedDescriptor =
					cached &&
					cached.descriptor &&
					typeof cached.descriptor === 'object'
						? cached.descriptor
						: null;
				const sourceSummary =
					cached &&
					cached.sourceSummary &&
					typeof cached.sourceSummary === 'object'
						? cached.sourceSummary
						: null;
				const entitySummary =
					cached &&
					cached.entitySummary &&
					typeof cached.entitySummary === 'object'
						? cached.entitySummary
						: null;
				const index =
					descriptor.index && typeof descriptor.index === 'object'
						? descriptor.index
						: {};
				const entity =
					descriptor.entity && typeof descriptor.entity === 'object'
						? descriptor.entity
						: {};
				const hydratedEntity =
					hydratedDescriptor &&
					hydratedDescriptor.entity &&
					typeof hydratedDescriptor.entity === 'object'
						? hydratedDescriptor.entity
						: null;

				return {
					token,
					status:
						hydratedDescriptor &&
						typeof hydratedDescriptor.status === 'string' &&
						hydratedDescriptor.status
							? hydratedDescriptor.status
							: typeof descriptor.status === 'string' &&
							  descriptor.status
							? descriptor.status
							: 'editable',
					scope:
						hydratedDescriptor &&
						typeof hydratedDescriptor.scope === 'string' &&
						hydratedDescriptor.scope
							? hydratedDescriptor.scope
							: typeof descriptor.scope === 'string' &&
							  descriptor.scope
							? descriptor.scope
							: 'current_entity',
					label:
						sourceSummary && sourceSummary.label
							? String( sourceSummary.label )
							: hydratedDescriptor &&
							  hydratedDescriptor.ui &&
							  hydratedDescriptor.ui.label
							? String( hydratedDescriptor.ui.label )
							: descriptor.label
							? String( descriptor.label )
							: strings().fieldIndexFieldFallback || 'Field',
					input:
						hydratedDescriptor &&
						hydratedDescriptor.ui &&
						hydratedDescriptor.ui.input
							? String( hydratedDescriptor.ui.input )
							: descriptor.input
							? String( descriptor.input )
							: '',
					entity: Object.assign( {}, entity, hydratedEntity || {} ),
					sourceSummary,
					entitySummary,
					index,
					domOrder: markerOrder.get( token ),
				};
			} );
	}

	function getFieldIndexFilterOptions( entries ) {
		const counts = {
			all: entries.length,
			editable: 0,
			shared: 0,
			related: 0,
			inspect: 0,
		};

		entries.forEach( function ( entry ) {
			if ( entry.status === 'readonly' ) {
				counts.inspect += 1;
			} else {
				counts.editable += 1;
			}

			if (
				entry.scope === 'shared_entity' ||
				( entry.entity && entry.entity.type === 'option' )
			) {
				counts.shared += 1;
			}

			if ( entry.scope === 'related_entity' ) {
				counts.related += 1;
			}
		} );

		return [
			{
				key: 'all',
				label: strings().fieldIndexFilterAll || 'All',
				count: counts.all,
			},
			{
				key: 'editable',
				label: strings().fieldIndexFilterEditable || 'Editable',
				count: counts.editable,
			},
			{
				key: 'shared',
				label: strings().fieldIndexFilterShared || 'Shared',
				count: counts.shared,
			},
			{
				key: 'related',
				label: strings().fieldIndexFilterRelated || 'Related',
				count: counts.related,
			},
			{
				key: 'inspect',
				label: strings().fieldIndexFilterInspect || 'Inspect-only',
				count: counts.inspect,
			},
		];
	}

	function filterFieldIndexEntries( entries ) {
		const filter = normalizeFieldIndexFilter( state.fieldIndexFilter );

		if ( filter === 'all' ) {
			return entries;
		}

		return entries.filter( function ( entry ) {
			if ( filter === 'editable' ) {
				return entry.status !== 'readonly';
			}

			if ( filter === 'shared' ) {
				return (
					entry.scope === 'shared_entity' ||
					( entry.entity && entry.entity.type === 'option' )
				);
			}

			if ( filter === 'related' ) {
				return entry.scope === 'related_entity';
			}

			if ( filter === 'inspect' ) {
				return entry.status === 'readonly';
			}

			return true;
		} );
	}

	function humanizeIdentifier( value ) {
		const normalized = String( value || '' )
			.replace( /[{}]/g, '' )
			.replace( /^acf_/, '' )
			.replace( /[_-]+/g, ' ' )
			.trim();

		if ( ! normalized ) {
			return '';
		}

		return normalized.replace( /\b\w/g, function ( match ) {
			return match.toUpperCase();
		} );
	}

	function resolveEntityTypeLabel( entity ) {
		const type = entity && entity.type ? String( entity.type ) : '';
		const subtype =
			entity && entity.subtype ? String( entity.subtype ) : '';

		if ( type === 'post' ) {
			return humanizeIdentifier( subtype ) || 'Post';
		}

		if ( type === 'term' ) {
			return humanizeIdentifier( subtype ) || 'Term';
		}

		if ( type === 'option' ) {
			return 'Options';
		}

		if ( type === 'user' ) {
			return 'User';
		}

		return humanizeIdentifier( type ) || 'Item';
	}

	function resolveEntityIndexLabel( entry ) {
		const entity = entry && entry.entity ? entry.entity : {};
		const entitySummary =
			entry && entry.entitySummary ? entry.entitySummary : {};
		const typeLabel = entitySummary.typeLabel
			? String( entitySummary.typeLabel )
			: resolveEntityTypeLabel( entity );
		const id = entity && entity.id ? Number( entity.id ) : 0;
		const label = entitySummary.title
			? String( entitySummary.title )
			: entity && entity.label
			? String( entity.label )
			: '';

		if ( entity.type === 'option' ) {
			return label || typeLabel;
		}

		if ( label ) {
			return `${ typeLabel }: ${ label }`;
		}

		return id > 0 ? `${ typeLabel } #${ id }` : typeLabel;
	}

	function isArchiveIndexEntry( entry ) {
		const index = entry && entry.index ? entry.index : {};
		const context = index.sourceContext
			? String( index.sourceContext )
			: '';

		return (
			context.indexOf( 'archive' ) !== -1 ||
			index.sourceType === 'archive_field'
		);
	}

	function resolveFieldIndexTopGroup( entry ) {
		const entity = entry && entry.entity ? entry.entity : {};
		const type = entity.type ? String( entity.type ) : '';
		const scope = entry && entry.scope ? String( entry.scope ) : '';

		if ( entry.status === 'readonly' ) {
			return {
				key: 'inspect',
				label: strings().fieldIndexInspectOnly || 'Inspect-only fields',
				order: 80,
			};
		}

		if ( isArchiveIndexEntry( entry ) ) {
			return {
				key: 'archive',
				label: strings().fieldIndexArchiveFields || 'Archive fields',
				order: 70,
			};
		}

		if ( scope === 'related_entity' ) {
			if ( type === 'post' ) {
				return {
					key: 'related-posts',
					label: strings().fieldIndexRelatedPosts || 'Related posts',
					order: 20,
				};
			}

			if ( type === 'term' ) {
				return {
					key: 'related-terms',
					label: strings().fieldIndexRelatedTerms || 'Related terms',
					order: 21,
				};
			}

			return {
				key: 'related-items',
				label: strings().fieldIndexRelatedItems || 'Related items',
				order: 22,
			};
		}

		if ( scope === 'shared_entity' || type === 'option' ) {
			if ( type === 'option' ) {
				return {
					key: 'shared-options',
					label:
						strings().fieldIndexSharedOptions || 'Shared options',
					order: 30,
				};
			}

			if ( type === 'post' ) {
				return {
					key: 'shared-posts',
					label: strings().fieldIndexSharedPosts || 'Shared posts',
					order: 31,
				};
			}

			if ( type === 'term' ) {
				return {
					key: 'shared-terms',
					label: strings().fieldIndexSharedTerms || 'Shared terms',
					order: 32,
				};
			}

			return {
				key: 'shared-items',
				label: strings().fieldIndexSharedItems || 'Shared items',
				order: 33,
			};
		}

		if ( scope === 'current_entity' ) {
			return {
				key: 'current',
				label: strings().fieldIndexCurrentEntity || 'Current entity',
				order: 10,
			};
		}

		return {
			key: 'other',
			label: strings().fieldIndexOtherFields || 'Other fields',
			order: 90,
		};
	}

	function formatRowIndex( rowIndex ) {
		if ( rowIndex === null || rowIndex === undefined || rowIndex === '' ) {
			return '';
		}

		const value = Number( rowIndex );

		return Number.isFinite( value )
			? `${ strings().panelRow || 'row' } ${ value + 1 }`
			: '';
	}

	function formatNativeQueryLabel( index ) {
		if ( ! index || typeof index !== 'object' ) {
			return '';
		}

		const ancestry = Array.isArray( index.nativeQueryAncestry )
			? index.nativeQueryAncestry
			: [];
		const parts = ancestry
			.map( function ( item ) {
				const kind = item && item.kind ? String( item.kind ) : '';
				const selector =
					item && item.selector ? String( item.selector ) : '';
				const loopIndex =
					item &&
					item.loopIndex !== '' &&
					item.loopIndex !== null &&
					item.loopIndex !== undefined
						? formatRowIndex( item.loopIndex )
						: '';
				const label = [ kind, selector ].filter( Boolean ).join( ':' );

				return [ label, loopIndex ].filter( Boolean ).join( ' ' );
			} )
			.filter( Boolean );

		if ( parts.length ) {
			return `${ strings().panelLoop || 'loop' } ${ parts.join(
				' > '
			) }`;
		}

		const kind = index.nativeQueryKind || index.parentNativeQueryKind || '';
		const selector =
			index.nativeQuerySelector || index.parentNativeQuerySelector || '';

		if ( kind || selector ) {
			return `${ strings().panelLoop || 'loop' } ${ [ kind, selector ]
				.filter( Boolean )
				.join( ':' ) }`;
		}

		return '';
	}

	function resolveFieldIndexSourceLabel( entry ) {
		const index = entry && entry.index ? entry.index : {};
		const sourceSummary =
			entry && entry.sourceSummary ? entry.sourceSummary : {};
		const fieldName = index.leafFieldName || index.fieldName || '';
		const parentFieldName = index.parentFieldName || '';
		const containerType = index.containerType || '';
		const groupPath = Array.isArray( index.groupPath )
			? index.groupPath
			: [];
		const parts = [];

		if ( parentFieldName ) {
			parts.push(
				`${ humanizeIdentifier( containerType || 'group' ) }: ${
					humanizeIdentifier( parentFieldName ) || parentFieldName
				}`
			);
		}

		if ( index.layoutName || index.layoutKey ) {
			parts.push(
				`${ strings().panelLayout || 'layout' }: ${
					humanizeIdentifier( index.layoutName || index.layoutKey ) ||
					index.layoutName ||
					index.layoutKey
				}`
			);
		}

		groupPath.forEach( function ( segment ) {
			const label = humanizeIdentifier( segment );

			if ( label ) {
				parts.push( label );
			}
		} );

		if ( sourceSummary.label ) {
			parts.push( String( sourceSummary.label ) );
		} else if ( fieldName ) {
			parts.push( humanizeIdentifier( fieldName ) || fieldName );
		}

		return (
			parts.join( ' / ' ) ||
			entry.label ||
			strings().fieldIndexSourceFallback ||
			'Source'
		);
	}

	function resolveFieldIndexSubGroup( entry ) {
		const index = entry && entry.index ? entry.index : {};
		const entity = entry && entry.entity ? entry.entity : {};
		const scope = entry && entry.scope ? String( entry.scope ) : '';
		const nativeLabel = formatNativeQueryLabel( index );

		if ( scope === 'related_entity' ) {
			return (
				nativeLabel ||
				( index.parentFieldName
					? humanizeIdentifier( index.parentFieldName ) ||
					  index.parentFieldName
					: '' ) ||
				resolveEntityTypeLabel( entity )
			);
		}

		if ( entity.type === 'option' ) {
			return (
				index.fieldGroupTitle ||
				( Array.isArray( index.fieldGroupOptionPages ) &&
				index.fieldGroupOptionPages.length
					? index.fieldGroupOptionPages
							.map( humanizeIdentifier )
							.join( ', ' )
					: '' ) ||
				resolveEntityIndexLabel( entry )
			);
		}

		if ( nativeLabel ) {
			return nativeLabel;
		}

		return (
			resolveEntityIndexLabel( entry ) ||
			strings().fieldIndexSourceFallback ||
			'Source'
		);
	}

	function resolveFieldIndexSubGroupKey( entry ) {
		const index = entry && entry.index ? entry.index : {};
		const entity = entry && entry.entity ? entry.entity : {};
		const optionPages = Array.isArray( index.fieldGroupOptionPages )
			? index.fieldGroupOptionPages.join( ',' )
			: '';
		const nativeKey = [
			index.nativeQueryKind || '',
			index.nativeQuerySelector || '',
			index.parentNativeQueryKind || '',
			index.parentNativeQuerySelector || '',
			Array.isArray( index.nativeQueryAncestry )
				? index.nativeQueryAncestry
						.map( function ( item ) {
							return [
								item && item.kind ? String( item.kind ) : '',
								item && item.selector
									? String( item.selector )
									: '',
								item && item.objectType
									? String( item.objectType )
									: '',
								item &&
								item.loopIndex !== undefined &&
								item.loopIndex !== null
									? String( item.loopIndex )
									: '',
							].join( ':' );
						} )
						.join( '>' )
				: '',
		]
			.filter( Boolean )
			.join( '|' );

		return [
			entry.scope || '',
			entity.type || '',
			entity.subtype || '',
			entity.id || 0,
			index.fieldGroupTitle || '',
			optionPages,
			nativeKey,
			index.parentFieldName || '',
			index.containerType || '',
			index.sourceContext || '',
		].join( '::' );
	}

	function getFieldIndexSubgroupPriority( entry ) {
		const index = entry && entry.index ? entry.index : {};
		const entity = entry && entry.entity ? entry.entity : {};
		const scope = entry && entry.scope ? String( entry.scope ) : '';
		const entityType = entity && entity.type ? String( entity.type ) : '';

		if (
			scope === 'current_entity' &&
			[ 'post', 'term', 'user' ].indexOf( entityType ) !== -1
		) {
			if (
				! formatNativeQueryLabel( index ) &&
				! isArchiveIndexEntry( entry )
			) {
				return 0;
			}

			return 1;
		}

		return 10;
	}

	function resolveFieldIndexItemLabel( entry ) {
		const index = entry && entry.index ? entry.index : {};
		const entity = entry && entry.entity ? entry.entity : {};
		const scope = entry && entry.scope ? String( entry.scope ) : '';
		const entityLabel = resolveEntityIndexLabel( entry );
		const parentLabel = index.parentFieldName
			? humanizeIdentifier( index.parentFieldName ) ||
			  index.parentFieldName
			: '';
		const nativeLabel = formatNativeQueryLabel( index );
		const rowLabel = formatRowIndex( index.rowIndex );
		const layoutLabel =
			index.layoutName || index.layoutKey
				? `${ strings().panelLayout || 'layout' }: ${
						humanizeIdentifier(
							index.layoutName || index.layoutKey
						) ||
						index.layoutName ||
						index.layoutKey
				  }`
				: '';
		const optionPages = Array.isArray( index.fieldGroupOptionPages )
			? index.fieldGroupOptionPages
					.map( humanizeIdentifier )
					.filter( Boolean )
					.join( ', ' )
			: '';

		if ( scope === 'related_entity' ) {
			return (
				[
					entityLabel,
					parentLabel || nativeLabel,
					layoutLabel,
					rowLabel,
				]
					.filter( Boolean )
					.join( ' / ' ) || entityLabel
			);
		}

		if ( entity.type === 'option' ) {
			return (
				[
					index.fieldGroupTitle || optionPages || entityLabel,
					parentLabel,
					layoutLabel,
					rowLabel,
				]
					.filter( Boolean )
					.join( ' / ' ) || entityLabel
			);
		}

		if ( parentLabel || rowLabel || layoutLabel ) {
			return [ parentLabel || entityLabel, layoutLabel, rowLabel ]
				.filter( Boolean )
				.join( ' / ' );
		}

		if ( nativeLabel ) {
			return nativeLabel;
		}

		return entityLabel || strings().fieldIndexSourceFallback || 'Source';
	}

	function resolveFieldIndexItemKey( entry ) {
		const index = entry && entry.index ? entry.index : {};
		const entity = entry && entry.entity ? entry.entity : {};
		const entityKey = [
			entity.type || '',
			entity.subtype || '',
			entity.id || 0,
		].join( ':' );
		const optionPages = Array.isArray( index.fieldGroupOptionPages )
			? index.fieldGroupOptionPages.join( ',' )
			: '';
		const nativeKey = [
			formatNativeQueryLabel( index ),
			index.nativeQueryKind || '',
			index.nativeQuerySelector || '',
			index.parentNativeQueryKind || '',
			index.parentNativeQuerySelector || '',
		]
			.filter( Boolean )
			.join( '|' );

		return [
			entityKey,
			entry.scope || '',
			index.fieldGroupTitle || '',
			optionPages,
			nativeKey,
			index.parentFieldName || '',
			index.containerType || '',
			index.layoutName || index.layoutKey || '',
			index.rowIndex === null || index.rowIndex === undefined
				? ''
				: `row:${ index.rowIndex }`,
			Array.isArray( index.groupPath ) ? index.groupPath.join( '>' ) : '',
			index.sourceContext || '',
		].join( '::' );
	}

	function getFieldIndexGroupPath( index ) {
		return Array.isArray( index && index.groupPath )
			? index.groupPath
					.map( function ( segment ) {
						return String( segment || '' ).trim();
					} )
					.filter( Boolean )
			: [];
	}

	function resolveFieldIndexUngroupedSectionLabel( entry ) {
		const entity = entry && entry.entity ? entry.entity : {};

		if ( entity.type === 'option' ) {
			return strings().fieldIndexOptionFields || 'Option fields';
		}

		if ( isArchiveIndexEntry( entry ) ) {
			return strings().fieldIndexArchiveFields || 'Archive fields';
		}

		if ( entry && entry.status === 'readonly' ) {
			return strings().fieldIndexInspectOnly || 'Inspect-only fields';
		}

		return strings().fieldIndexGeneralFields || 'General fields';
	}

	function resolveFieldIndexSection( entry ) {
		const index = entry && entry.index ? entry.index : {};
		const groupPath = getFieldIndexGroupPath( index );
		const immediateGroup = groupPath.length ? groupPath[ 0 ] : '';
		const parentFieldName = index.parentFieldName
			? String( index.parentFieldName )
			: '';
		const containerType = index.containerType
			? String( index.containerType )
			: '';
		const optionPages = Array.isArray( index.fieldGroupOptionPages )
			? index.fieldGroupOptionPages
					.map( humanizeIdentifier )
					.filter( Boolean )
					.join( ', ' )
			: '';
		const nativeLabel = formatNativeQueryLabel( index );

		if ( immediateGroup ) {
			return {
				key: `acf-group:${ immediateGroup }`,
				label: humanizeIdentifier( immediateGroup ) || immediateGroup,
				priority: 0,
			};
		}

		if ( parentFieldName && containerType ) {
			return {
				key: `container:${ containerType }:${ parentFieldName }`,
				label: [
					humanizeIdentifier( parentFieldName ) || parentFieldName,
					humanizeIdentifier( containerType ),
				]
					.filter( Boolean )
					.join( ' / ' ),
				priority: 3,
			};
		}

		if ( index.fieldGroupTitle || optionPages ) {
			const label = index.fieldGroupTitle
				? String( index.fieldGroupTitle )
				: optionPages;

			return {
				key: `field-group:${ label }`,
				label,
				priority: 5,
			};
		}

		if ( nativeLabel ) {
			return {
				key: [
					'native',
					nativeLabel,
					index.nativeQueryKind || '',
					index.nativeQuerySelector || '',
					index.parentNativeQueryKind || '',
					index.parentNativeQuerySelector || '',
				].join( ':' ),
				label: nativeLabel,
				priority: 8,
			};
		}

		return {
			key: 'ungrouped',
			label: resolveFieldIndexUngroupedSectionLabel( entry ),
			priority: 20,
		};
	}

	function summarizeFieldIndexSection( section ) {
		return getStatusBarCountText(
			section && typeof section.count === 'number' ? section.count : 0
		);
	}

	function summarizeFieldIndexItem( item ) {
		const count =
			item && Array.isArray( item.entries ) ? item.entries.length : 0;
		const readonly = item.entries.filter( function ( entry ) {
			return entry.status === 'readonly';
		} ).length;
		const editable = count - readonly;
		const parts = [ getStatusBarCountText( count ) ];

		if ( editable > 0 && readonly > 0 ) {
			parts.push( `${ editable } ${ strings().editLabel || 'Edit' }` );
			parts.push(
				`${ readonly } ${ strings().inspectLabel || 'Inspect' }`
			);
		} else if ( readonly > 0 ) {
			parts.push( strings().inspectLabel || 'Inspect' );
		}

		return parts.filter( Boolean ).join( ' / ' );
	}

	function buildFieldIndexModel( entries ) {
		const groups = new Map();

		entries.forEach( function ( entry ) {
			const top = resolveFieldIndexTopGroup( entry );
			const sectionMeta = resolveFieldIndexSection( entry );
			const sectionKey = `${ top.key }:${ sectionMeta.key }`;
			const subLabel = resolveFieldIndexSubGroup( entry );
			const subKey = `${ top.key }:${ resolveFieldIndexSubGroupKey(
				entry
			) }`;
			let group = groups.get( top.key );

			if ( ! group ) {
				group = {
					key: top.key,
					label: top.label,
					order: top.order,
					domOrder: entry.domOrder,
					count: 0,
					sections: new Map(),
				};
				groups.set( top.key, group );
			} else {
				group.domOrder = Math.min( group.domOrder, entry.domOrder );
			}

			let section = group.sections.get( sectionKey );
			if ( ! section ) {
				section = {
					key: sectionKey,
					label: sectionMeta.label,
					domOrder: entry.domOrder,
					priority: sectionMeta.priority,
					count: 0,
					subgroups: new Map(),
				};
				group.sections.set( sectionKey, section );
			} else {
				section.domOrder = Math.min( section.domOrder, entry.domOrder );
				section.priority = Math.min(
					section.priority,
					sectionMeta.priority
				);
			}

			let subgroup = section.subgroups.get( subKey );
			if ( ! subgroup ) {
				subgroup = {
					key: subKey,
					label: subLabel,
					domOrder: entry.domOrder,
					priority: getFieldIndexSubgroupPriority( entry ),
					count: 0,
					items: new Map(),
				};
				section.subgroups.set( subKey, subgroup );
			} else {
				subgroup.domOrder = Math.min(
					subgroup.domOrder,
					entry.domOrder
				);
				subgroup.priority = Math.min(
					subgroup.priority,
					getFieldIndexSubgroupPriority( entry )
				);
			}

			const itemKey = `${ subKey }:${ resolveFieldIndexItemKey(
				entry
			) }`;
			let item = subgroup.items.get( itemKey );
			if ( ! item ) {
				item = {
					key: itemKey,
					label: resolveFieldIndexItemLabel( entry ),
					domOrder: entry.domOrder,
					entries: [],
				};
				subgroup.items.set( itemKey, item );
			} else {
				item.domOrder = Math.min( item.domOrder, entry.domOrder );
			}

			group.count += 1;
			section.count += 1;
			subgroup.count += 1;
			item.entries.push( entry );
		} );

		return Array.from( groups.values() )
			.sort( function ( left, right ) {
				return (
					left.order - right.order ||
					left.domOrder - right.domOrder ||
					left.label.localeCompare( right.label )
				);
			} )
			.map( function ( group ) {
				group.sections = Array.from( group.sections.values() )
					.sort( function ( left, right ) {
						return (
							left.priority - right.priority ||
							left.domOrder - right.domOrder ||
							left.label.localeCompare( right.label )
						);
					} )
					.map( function ( section ) {
						section.subgroups = Array.from(
							section.subgroups.values()
						)
							.sort( function ( left, right ) {
								return (
									left.priority - right.priority ||
									left.domOrder - right.domOrder ||
									left.label.localeCompare( right.label )
								);
							} )
							.map( function ( subgroup ) {
								subgroup.items = Array.from(
									subgroup.items.values()
								)
									.sort( function ( left, right ) {
										return (
											left.domOrder - right.domOrder ||
											left.label.localeCompare(
												right.label
											)
										);
									} )
									.map( function ( item ) {
										item.entries = item.entries.sort(
											function ( left, right ) {
												return (
													left.domOrder -
														right.domOrder ||
													resolveFieldIndexSourceLabel(
														left
													).localeCompare(
														resolveFieldIndexSourceLabel(
															right
														)
													)
												);
											}
										);

										return item;
									} );

								return subgroup;
							} );

						return section;
					} );

				return group;
			} );
	}

	function renderFieldIndexStatusChip( entry ) {
		const status =
			entry && entry.status ? String( entry.status ) : 'editable';

		if ( status === 'readonly' ) {
			return strings().inspectLabel || 'Inspect';
		}

		return strings().editLabel || 'Edit';
	}

	function renderFieldIndexEntryMarkup( entry ) {
		const index = entry && entry.index ? entry.index : {};
		const sourceSummary =
			entry && entry.sourceSummary ? entry.sourceSummary : {};
		const sourceLabel = resolveFieldIndexSourceLabel( entry );
		const fieldName = index.leafFieldName || index.fieldName || '';
		const isActive = Boolean(
			state.activeNode &&
				getMarkerToken( state.activeNode ) === entry.token
		);
		const details = [
			sourceSummary.summary || fieldName,
			index.fieldType,
			entry.input,
			formatRowIndex( index.rowIndex ),
		]
			.filter( Boolean )
			.join( ' / ' );

		return [
			`<li class="dbvc-ve-field-index__row${
				isActive ? ' is-active' : ''
			}" data-status="${ escapeHtml(
				entry.status
			) }" data-scope="${ escapeHtml( entry.scope ) }">`,
			'  <div class="dbvc-ve-field-index__row-text">',
			`    <span class="dbvc-ve-field-index__row-label">${ escapeHtml(
				entry.label || sourceLabel
			) }</span>`,
			`    <span class="dbvc-ve-field-index__row-source">${ escapeHtml(
				sourceLabel
			) }</span>`,
			details
				? `    <span class="dbvc-ve-field-index__row-details">${ escapeHtml(
						details
				  ) }</span>`
				: '',
			'  </div>',
			'  <span class="dbvc-ve-field-index__row-chip">',
			escapeHtml( renderFieldIndexStatusChip( entry ) ),
			'  </span>',
			'  <div class="dbvc-ve-field-index__row-actions">',
			`    <button type="button" class="dbvc-ve-field-index__action" data-dbvc-ve-statusbar-action="locate-field" data-token="${ escapeHtml(
				entry.token
			) }">${ escapeHtml(
				strings().fieldIndexLocate || 'Locate'
			) }</button>`,
			`    <button type="button" class="dbvc-ve-field-index__action" data-dbvc-ve-statusbar-action="open-field" data-token="${ escapeHtml(
				entry.token
			) }">${ escapeHtml(
				strings().fieldIndexOpen || 'Open'
			) }</button>`,
			'  </div>',
			'</li>',
		].join( '' );
	}

	function renderFieldIndexItemMarkup( item ) {
		const isOpen =
			state.fieldIndexOpenItems &&
			state.fieldIndexOpenItems.has( item.key );

		return [
			`<details class="dbvc-ve-field-index__item" data-item-key="${ escapeHtml(
				item.key
			) }"${ isOpen ? ' open' : '' }>`,
			'  <summary class="dbvc-ve-field-index__item-summary">',
			'    <span class="dbvc-ve-field-index__item-title">',
			`      <span>${ escapeHtml( item.label ) }</span>`,
			`      <span>${ escapeHtml(
				summarizeFieldIndexItem( item )
			) }</span>`,
			'    </span>',
			'  </summary>',
			'  <ul class="dbvc-ve-field-index__rows">',
			item.entries.map( renderFieldIndexEntryMarkup ).join( '' ),
			'  </ul>',
			'</details>',
		].join( '' );
	}

	function renderFieldIndexSectionControlsMarkup() {
		return [
			'<div class="dbvc-ve-field-index__section-controls">',
			`  <button type="button" class="dbvc-ve-field-index__control" data-dbvc-ve-statusbar-action="expand-field-sections">${ escapeHtml(
				strings().fieldIndexExpandAll || 'Expand all'
			) }</button>`,
			`  <button type="button" class="dbvc-ve-field-index__control" data-dbvc-ve-statusbar-action="collapse-field-sections">${ escapeHtml(
				strings().fieldIndexCollapseAll || 'Collapse all'
			) }</button>`,
			'</div>',
		].join( '' );
	}

	function renderFieldIndexSubgroupMarkup( subgroup ) {
		return [
			`<div class="dbvc-ve-field-index__subgroup" data-subgroup-key="${ escapeHtml(
				subgroup.key
			) }">`,
			'  <div class="dbvc-ve-field-index__items">',
			subgroup.items.map( renderFieldIndexItemMarkup ).join( '' ),
			'  </div>',
			'</div>',
		].join( '' );
	}

	function renderFieldIndexSectionMarkup( section ) {
		const isOpen =
			! state.fieldIndexSectionStateCaptured ||
			( state.fieldIndexOpenSections &&
				state.fieldIndexOpenSections.has( section.key ) );

		return [
			`<details class="dbvc-ve-field-index__section" data-section-key="${ escapeHtml(
				section.key
			) }"${ isOpen ? ' open' : '' }>`,
			'  <summary class="dbvc-ve-field-index__section-summary">',
			`    <span>${ escapeHtml( section.label ) }</span>`,
			`    <span>${ escapeHtml(
				summarizeFieldIndexSection( section )
			) }</span>`,
			'  </summary>',
			'  <div class="dbvc-ve-field-index__subgroups">',
			section.subgroups.map( renderFieldIndexSubgroupMarkup ).join( '' ),
			'  </div>',
			'</details>',
		].join( '' );
	}

	function renderFieldIndexFilterMarkup( entries ) {
		const currentFilter = normalizeFieldIndexFilter(
			state.fieldIndexFilter
		);
		const options = getFieldIndexFilterOptions( entries );

		return [
			'<div class="dbvc-ve-field-index__filters" role="group" aria-label="Field index filters">',
			options
				.map( function ( option ) {
					const active = option.key === currentFilter;

					return [
						`<button type="button" class="dbvc-ve-field-index__filter${
							active ? ' is-active' : ''
						}" data-dbvc-ve-statusbar-action="filter-field-index" data-filter="${ escapeHtml(
							option.key
						) }" aria-pressed="${ active ? 'true' : 'false' }">`,
						`  <span>${ escapeHtml( option.label ) }</span>`,
						`  <span>${ escapeHtml(
							String( option.count )
						) }</span>`,
						'</button>',
					].join( '' );
				} )
				.join( '' ),
			'</div>',
		].join( '' );
	}

	function renderFieldIndexMarkup() {
		const entries = getSessionDescriptorEntries();
		const groups = buildFieldIndexModel(
			filterFieldIndexEntries( entries )
		);
		const filterMarkup = renderFieldIndexFilterMarkup( entries );

		if ( ! entries.length ) {
			return [
				'<div class="dbvc-ve-field-index" role="list">',
				filterMarkup,
				`<div class="dbvc-ve-field-index__empty">${ escapeHtml(
					strings().fieldIndexNoFields ||
						'No marked fields are available to review.'
				) }</div>`,
				'</div>',
			].join( '' );
		}

		if ( ! groups.length ) {
			return [
				'<div class="dbvc-ve-field-index" role="list">',
				filterMarkup,
				`<div class="dbvc-ve-field-index__empty">${ escapeHtml(
					strings().fieldIndexNoFilterResults ||
						'No marked fields match this filter.'
				) }</div>`,
				'</div>',
			].join( '' );
		}

		return [
			'<div class="dbvc-ve-field-index" role="list">',
			filterMarkup,
			groups
				.map( function ( group ) {
					return [
						'<details class="dbvc-ve-field-index__group" open>',
						`  <summary class="dbvc-ve-field-index__group-summary"><span>${ escapeHtml(
							group.label
						) }</span><span>${ escapeHtml(
							getStatusBarCountText( group.count )
						) }</span></summary>`,
						'  <div class="dbvc-ve-field-index__sections">',
						renderFieldIndexSectionControlsMarkup(),
						group.sections
							.map( renderFieldIndexSectionMarkup )
							.join( '' ),
						'  </div>',
						'</details>',
					].join( '' );
				} )
				.join( '' ),
			'</div>',
		].join( '' );
	}

	function renderStatusBarMeta( meta, nextState ) {
		captureFieldIndexOpenState();
		if ( state.fieldIndexResetScroll ) {
			state.fieldIndexScrollTop = 0;
		} else {
			captureFieldIndexScrollState();
		}

		const countText = getStatusBarCountText( nextState.count );
		const hasIndex = Boolean(
			state.session &&
				state.session.descriptors &&
				Object.keys( state.session.descriptors ).length
		);
		const expanded = Boolean( state.fieldIndexOpen && hasIndex );
		const toggleLabel = expanded
			? strings().fieldIndexHide || 'Hide fields'
			: strings().fieldIndexReview || 'Review fields';

		if ( ! countText && ! hasIndex ) {
			meta.textContent = '';
			state.fieldIndexResetScroll = false;
			return;
		}

		meta.innerHTML = [
			'<div class="dbvc-ve-statusbar__meta-summary">',
			countText
				? `<span>${ escapeHtml( countText ) }</span>`
				: '<span></span>',
			hasIndex
				? `  <button type="button" class="dbvc-ve-statusbar__toggle" data-dbvc-ve-statusbar-action="toggle-field-index" aria-expanded="${
						expanded ? 'true' : 'false'
				  }">${ escapeHtml( toggleLabel ) }</button>`
				: '',
			'</div>',
			expanded ? renderFieldIndexMarkup() : '',
		].join( '' );

		if ( expanded ) {
			restoreFieldIndexScrollState();
		} else {
			state.fieldIndexResetScroll = false;
		}
	}

	function findMarkerByToken( token ) {
		if ( ! token ) {
			return null;
		}

		return (
			findMarkers().find( function ( node ) {
				return getMarkerToken( node ) === token;
			} ) || null
		);
	}

	function canOpenMarkerPanelFromNode( node ) {
		if ( ! node || typeof node.getBoundingClientRect !== 'function' ) {
			return false;
		}

		const rect = node.getBoundingClientRect();
		if ( ! rect || rect.width <= 0 || rect.height <= 0 ) {
			return false;
		}

		const styles = window.getComputedStyle
			? window.getComputedStyle( node )
			: null;

		return (
			! styles ||
			( styles.display !== 'none' && styles.visibility !== 'hidden' )
		);
	}

	function locateFieldIndexMarker( token, openPanel ) {
		const node = findMarkerByToken( token );

		if ( ! node ) {
			if ( openPanel ) {
				openToolbarDescriptorPanel( token );
			}
			return;
		}

		if ( openPanel && ! canOpenMarkerPanelFromNode( node ) ) {
			openToolbarDescriptorPanel( token );
			return;
		}

		if ( typeof node.scrollIntoView === 'function' ) {
			node.scrollIntoView( {
				block: 'center',
				inline: 'nearest',
				behavior:
					window.matchMedia &&
					window.matchMedia( '(prefers-reduced-motion: reduce)' )
						.matches
						? 'auto'
						: 'smooth',
			} );
		}

		setPreviewNode( node );
		node.classList.add( 'is-locating' );
		window.setTimeout( function () {
			if ( node && node.classList ) {
				node.classList.remove( 'is-locating' );
			}
		}, 1300 );
		if ( openPanel ) {
			if ( state.session ) {
				openEditor( node, state.session );
			} else {
				openToolbarDescriptorPanel( token );
			}
		}
	}

	function ensureBadgeLayer() {
		if ( state.badgeLayer && state.badgeLayer.isConnected ) {
			return state.badgeLayer;
		}

		let layer = document.querySelector( '.dbvc-ve-badge-layer' );

		if ( layer ) {
			state.badgeLayer = layer;
			return layer;
		}

		layer = document.createElement( 'div' );
		layer.className = 'dbvc-ve-badge-layer';
		document.body.appendChild( layer );
		state.badgeLayer = layer;

		return layer;
	}

	function ensureSharedBadge() {
		if ( state.badgeNode && state.badgeNode.isConnected ) {
			return state.badgeNode;
		}

		const badge = document.createElement( 'button' );

		badge.type = 'button';
		badge.className = 'dbvc-ve-badge';
		badge.addEventListener( 'click', function ( event ) {
			const target = resolveBadgeTarget();

			event.preventDefault();
			event.stopPropagation();

			if ( ! target || ! state.session ) {
				return;
			}

			openEditor( target, state.session );
		} );
		badge.addEventListener( 'mouseenter', clearBadgeHideTimeout );
		badge.addEventListener( 'focusin', clearBadgeHideTimeout );
		badge.addEventListener( 'mouseleave', function ( event ) {
			const relatedMarker = resolveMarkerNodeFromTarget(
				event.relatedTarget
			);

			if ( relatedMarker ) {
				setPreviewNode( relatedMarker );
				return;
			}

			if ( state.activeNode ) {
				state.previewNode = null;
				scheduleViewportPrefetch();
				scheduleBadgeLayout();
				return;
			}

			scheduleBadgeHide();
		} );
		badge.addEventListener( 'focusout', function ( event ) {
			if ( isBadgeElement( event.relatedTarget ) ) {
				return;
			}

			if ( resolveMarkerNodeFromTarget( event.relatedTarget ) ) {
				return;
			}

			if ( state.activeNode ) {
				state.previewNode = null;
				scheduleViewportPrefetch();
				scheduleBadgeLayout();
				return;
			}

			scheduleBadgeHide();
		} );

		ensureBadgeLayer().appendChild( badge );
		state.badgeNode = badge;

		return badge;
	}

	function shouldMountQueryCollectionContainerBadge( marker ) {
		const descriptor = lookupDescriptorForNode( marker );
		const context = getDescriptorRenderContext( descriptor, marker );
		const inputType = getDescriptorInputType( descriptor, marker );
		const badgeLabel = getDescriptorBadgeLabel( descriptor, marker );

		return (
			context === 'query_collection' &&
			( ! descriptor ||
				badgeLabel !== '' ||
				inputType === 'reference_collection' ||
				inputType === 'reference_collection_preview' ||
				getDescriptorQuerySource( descriptor ) ===
					'derived_bricks_query' )
		);
	}

	function getQueryCollectionContainerGroupKey( marker ) {
		const descriptor = lookupDescriptorForNode( marker );
		const source = descriptor && descriptor.source ? descriptor.source : {};
		const context = getDescriptorRenderContext( descriptor, marker );
		const scope = getDescriptorScope( descriptor, marker );
		const queryElementId = getMarkerQueryElementId( marker, descriptor );
		const nativeSelector = source.native_query_selector
			? String( source.native_query_selector )
			: '';
		const sourceGroup = getDescriptorSourceGroup( descriptor, marker );
		const expression = source.expression ? String( source.expression ) : '';
		const badgeLabel = getDescriptorBadgeLabel( descriptor, marker );
		const isPostTermsCollection =
			source.type === 'post_terms_collection' ||
			( context === 'query_collection' &&
				scope === 'related_entity' &&
				sourceGroup !== '' &&
				/terms$/i.test( badgeLabel || '' ) );

		return [
			isPostTermsCollection
				? sourceGroup ||
				  getMarkerToken( marker ) ||
				  queryElementId ||
				  nativeSelector ||
				  expression
				: queryElementId ||
				  nativeSelector ||
				  sourceGroup ||
				  expression ||
				  getMarkerToken( marker ),
			badgeLabel || getQueryCollectionContainerBadgeLabel( marker ),
		].join( ':' );
	}

	function getQueryCollectionContainerBadgeLabel( marker ) {
		const descriptor = lookupDescriptorForNode( marker );
		const badgeLabel = getDescriptorBadgeLabel( descriptor, marker );
		const status = getDescriptorStatus( descriptor, marker );

		if ( status === 'readonly' ) {
			return (
				strings().panelInspectOnly ||
				strings().inspectLabel ||
				'Inspect only'
			);
		}

		return badgeLabel || strings().badgeConnected || 'Edit Connected';
	}

	function isPostTermsCollectionMarker( marker ) {
		const descriptor = lookupDescriptorForNode( marker );
		const source = descriptor && descriptor.source ? descriptor.source : {};

		return source.type === 'post_terms_collection';
	}

	function normalizeBricksDomId( id ) {
		const value = String( id || '' ).trim();

		return value.indexOf( 'brxe-' ) === 0 ? value.slice( 5 ) : value;
	}

	function getMarkerQueryElementId( marker, descriptor ) {
		const source = descriptor && descriptor.source ? descriptor.source : {};

		if ( source.query_element_id ) {
			return String( source.query_element_id );
		}

		if ( marker && marker.dataset ) {
			if (
				typeof marker.dataset.dbvcVeQueryElementId === 'string' &&
				marker.dataset.dbvcVeQueryElementId
			) {
				return marker.dataset.dbvcVeQueryElementId;
			}

			if (
				typeof marker.dataset.queryElementId === 'string' &&
				marker.dataset.queryElementId
			) {
				return marker.dataset.queryElementId;
			}
		}

		return '';
	}

	function findLoopCommentParent( queryElementId ) {
		const normalizedId = String( queryElementId || '' ).trim();

		if (
			! normalizedId ||
			typeof document.createTreeWalker !== 'function'
		) {
			return null;
		}

		const walker = document.createTreeWalker(
			document.body,
			NodeFilter.SHOW_COMMENT
		);
		let node = walker.nextNode();

		while ( node ) {
			if (
				String( node.nodeValue || '' ).trim() ===
				`brx-loop-start-${ normalizedId }`
			) {
				const parent = node.parentElement;

				return parent && elementHasUsableBadgeRect( parent )
					? parent
					: null;
			}

			node = walker.nextNode();
		}

		return null;
	}

	function getElementAncestorList( node ) {
		const ancestors = [];
		let current = node && node.nodeType === 1 ? node : null;

		while ( current && current.nodeType === 1 ) {
			ancestors.push( current );
			current = current.parentElement;
		}

		return ancestors;
	}

	function findCommonElementAncestor( nodes ) {
		const normalized = Array.isArray( nodes )
			? nodes.filter( function ( node ) {
					return node && node.nodeType === 1;
			  } )
			: [];

		if ( ! normalized.length ) {
			return null;
		}

		const firstAncestors = getElementAncestorList( normalized[ 0 ] );

		return (
			firstAncestors.find( function ( candidate ) {
				return normalized.every( function ( node ) {
					return candidate === node || candidate.contains( node );
				} );
			} ) || null
		);
	}

	function elementHasUsableBadgeRect( node ) {
		if (
			! node ||
			typeof node.getBoundingClientRect !== 'function' ||
			! elementLooksVisible( node )
		) {
			return false;
		}

		const rect = node.getBoundingClientRect();

		return Boolean( rect && rect.width > 0 && rect.height > 0 );
	}

	function findNearestBricksContainer(
		node,
		stopNode,
		excludedQueryElementId
	) {
		let current = node && node.nodeType === 1 ? node : null;
		const excludedId = normalizeBricksDomId( excludedQueryElementId );

		while ( current && current.nodeType === 1 ) {
			const currentId = current.id
				? normalizeBricksDomId( current.id )
				: '';

			if (
				currentId !== '' &&
				currentId !== excludedId &&
				elementHasUsableBadgeRect( current )
			) {
				return current;
			}

			if ( current === stopNode ) {
				break;
			}

			current = current.parentElement;
		}

		return null;
	}

	function resolveQueryCollectionContainerBadgeTarget( markers ) {
		const groupMarkers = Array.isArray( markers )
			? markers.filter( function ( marker ) {
					return marker && marker.isConnected;
			  } )
			: [];

		if ( ! groupMarkers.length ) {
			return null;
		}

		const descriptor = lookupDescriptorForNode( groupMarkers[ 0 ] );
		const queryElementId = getMarkerQueryElementId(
			groupMarkers[ 0 ],
			descriptor
		);
		const emptyLoopParent =
			groupMarkers.length === 1 &&
			groupMarkers[ 0 ].dataset &&
			groupMarkers[ 0 ].dataset.dbvcVeEmptyLoopContainer === '1'
				? groupMarkers[ 0 ]
				: null;

		if ( emptyLoopParent && elementHasUsableBadgeRect( emptyLoopParent ) ) {
			return emptyLoopParent;
		}

		const queryTrailParent =
			groupMarkers.length === 1 &&
			groupMarkers[ 0 ].classList &&
			groupMarkers[ 0 ].classList.contains( 'brx-query-trail' )
				? groupMarkers[ 0 ].parentElement
				: null;

		if (
			queryTrailParent &&
			elementHasUsableBadgeRect( queryTrailParent )
		) {
			return queryTrailParent;
		}

		const section = groupMarkers[ 0 ].closest( 'section' );
		const common = findCommonElementAncestor( groupMarkers );
		const searchStart =
			groupMarkers.length === 1 && common && common.parentElement
				? common.parentElement
				: common;
		const commonTarget = findNearestBricksContainer(
			searchStart,
			section,
			queryElementId
		);

		if ( commonTarget ) {
			return commonTarget;
		}

		const markerTarget = findNearestBricksContainer(
			groupMarkers[ 0 ],
			section,
			queryElementId
		);
		if ( markerTarget ) {
			return markerTarget;
		}

		return section && elementHasUsableBadgeRect( section )
			? section
			: groupMarkers[ 0 ];
	}

	function mountQueryCollectionContainerBadges( markers ) {
		const groups = new Map();
		const entries = [];
		const layer = ensureBadgeLayer();

		layer
			.querySelectorAll( '.dbvc-ve-section-badge--query-collection' )
			.forEach( function ( badge ) {
				badge.remove();
			} );

		markers.forEach( function ( marker ) {
			if (
				! marker ||
				! marker.isConnected ||
				! shouldMountQueryCollectionContainerBadge( marker )
			) {
				return;
			}

			const key = getQueryCollectionContainerGroupKey( marker );
			const group = groups.get( key ) || {
				key,
				marker,
				markers: [],
			};

			group.markers.push( marker );
			groups.set( key, group );
		} );

		groups.forEach( function ( group ) {
			const target = resolveQueryCollectionContainerBadgeTarget(
				group.markers
			);

			if ( ! target ) {
				return;
			}

			entries.push( {
				marker: group.marker,
				target,
			} );
		} );

		const entryTokens = new Set(
			entries.map( function ( entry ) {
				return getMarkerToken( entry.marker );
			} )
		);

		markers.forEach( function ( marker ) {
			const token = getMarkerToken( marker );

			if (
				! marker ||
				! marker.isConnected ||
				! token ||
				entryTokens.has( token )
			) {
				return;
			}

			if (
				getDescriptorRenderContext(
					lookupDescriptorForNode( marker ),
					marker
				) !== 'query_collection'
			) {
				return;
			}

			if (
				! marker.classList ||
				! marker.classList.contains( 'brx-query-trail' )
			) {
				return;
			}

			const target = marker.parentElement;
			if ( ! target || ! elementHasUsableBadgeRect( target ) ) {
				return;
			}

			entries.push( {
				marker,
				target,
			} );
			entryTokens.add( token );
		} );

		const targetCounts = new Map();

		entries.forEach( function ( entry, index ) {
			const marker = entry.marker;
			const target = entry.target;
			const targetIndex = targetCounts.get( target ) || 0;

			targetCounts.set( target, targetIndex + 1 );
			target.classList.add( 'dbvc-ve-query-collection-container' );
			target.dataset.dbvcVeQueryCollectionContainer = '1';

			const badge = document.createElement( 'button' );

			badge.type = 'button';
			badge.className =
				'dbvc-ve-section-badge dbvc-ve-section-badge--query-collection dbvc-ve-section-badge--container';
			badge.textContent = getQueryCollectionContainerBadgeLabel( marker );
			badge.dataset.token = getMarkerToken( marker );
			badge.dataset.sectionIndex = String( index );
			badge.dataset.targetIndex = String( targetIndex );
			badge.dataset.targetId = target.id || '';
			badge._dbvcVeBadgeTarget = target;
			badge.onclick = function ( event ) {
				const token = badge.dataset.token || '';
				const target = token
					? document.querySelector(
							`[data-dbvc-ve="${
								window.CSS && CSS.escape
									? CSS.escape( token )
									: token
							}"]`
					  )
					: null;

				event.preventDefault();
				event.stopPropagation();

				if ( ! target || ! state.session ) {
					return;
				}

				setPreviewNode( target );
				openEditor( target, state.session );
			};

			layer.appendChild( badge );
		} );

		positionQueryCollectionContainerBadges();
	}

	function bindBadgeEvents() {
		if ( state.badgeEventsBound ) {
			return;
		}

		state.badgeEventsBound = true;

		window.addEventListener( 'resize', function () {
			if ( state.panelPosition ) {
				applyPanelPosition( ensureEditorPanel() );
			}

			scheduleBadgeLayout();
			schedulePanelViewportClamp();
		} );
		if (
			window.visualViewport &&
			typeof window.visualViewport.addEventListener === 'function'
		) {
			window.visualViewport.addEventListener( 'resize', function () {
				if ( state.panelPosition ) {
					applyPanelPosition( ensureEditorPanel() );
				}

				scheduleBadgeLayout();
				schedulePanelViewportClamp();
			} );
			window.visualViewport.addEventListener( 'scroll', function () {
				if ( state.panelPosition ) {
					applyPanelPosition( ensureEditorPanel() );
				}

				scheduleBadgeLayout();
				schedulePanelViewportClamp();
			} );
		}
		window.addEventListener( 'scroll', scheduleBadgeLayout, true );
		document.addEventListener( 'mouseover', handleMarkerMouseOver, true );
		document.addEventListener( 'mouseout', handleMarkerMouseOut, true );
		document.addEventListener( 'focusin', handleMarkerFocusIn, true );
		document.addEventListener( 'focusout', handleMarkerFocusOut, true );
		document.addEventListener( 'pointerup', handleMarkerPointerUp, true );
		document.addEventListener(
			'pointerdown',
			handlePanelOutsidePointerDown,
			true
		);
		document.addEventListener( 'click', handleMarkerClick, true );
		document.addEventListener( 'keydown', handleBadgeKeydown, true );
	}

	function clearBadgeHideTimeout() {
		if ( ! state.badgeHideTimeout ) {
			return;
		}

		window.clearTimeout( state.badgeHideTimeout );
		state.badgeHideTimeout = 0;
	}

	function scheduleBadgeHide() {
		clearBadgeHideTimeout();

		state.badgeHideTimeout = window.setTimeout( function () {
			state.badgeHideTimeout = 0;
			state.previewNode = null;
			clearDescriptorPrefetch();
			scheduleViewportPrefetch();
			scheduleBadgeLayout();
		}, BADGE_HIDE_DELAY_MS );
	}

	function resolveMarkerNodeFromTarget( target ) {
		if ( ! target || typeof target.closest !== 'function' ) {
			return null;
		}

		return target.closest( '[data-dbvc-ve]' );
	}

	function eventHasViewportPoint( event ) {
		return (
			event &&
			typeof event.clientX === 'number' &&
			typeof event.clientY === 'number' &&
			event.clientX >= 0 &&
			event.clientY >= 0
		);
	}

	function rectContainsViewportPoint( rect, x, y ) {
		return (
			rect &&
			rect.width > 0 &&
			rect.height > 0 &&
			x >= rect.left &&
			x <= rect.right &&
			y >= rect.top &&
			y <= rect.bottom
		);
	}

	function rectIntersectsViewport( rect ) {
		return (
			rect &&
			rect.width > 0 &&
			rect.height > 0 &&
			rect.right > 0 &&
			rect.bottom > 0 &&
			rect.left < window.innerWidth &&
			rect.top < window.innerHeight
		);
	}

	function markerContainsViewportPoint( marker, x, y ) {
		if ( ! marker || typeof marker.getClientRects !== 'function' ) {
			return false;
		}

		const rects = Array.from( marker.getClientRects() );

		if (
			rects.some( function ( rect ) {
				return rectContainsViewportPoint( rect, x, y );
			} )
		) {
			return true;
		}

		if ( typeof marker.getBoundingClientRect !== 'function' ) {
			return false;
		}

		return rectContainsViewportPoint(
			marker.getBoundingClientRect(),
			x,
			y
		);
	}

	function elementLooksVisible( node, stopNode ) {
		let current = node;

		while ( current && current.nodeType === 1 ) {
			if (
				current.hidden ||
				current.getAttribute( 'aria-hidden' ) === 'true'
			) {
				return false;
			}

			if ( typeof window.getComputedStyle === 'function' ) {
				const style = window.getComputedStyle( current );

				if (
					! style ||
					style.display === 'none' ||
					style.visibility === 'hidden' ||
					style.visibility === 'collapse' ||
					style.opacity === '0'
				) {
					return false;
				}
			}

			if ( current === stopNode ) {
				break;
			}

			current = current.parentElement;
		}

		return true;
	}

	function getMarkerViewportArea( marker ) {
		if ( ! marker || typeof marker.getBoundingClientRect !== 'function' ) {
			return Number.MAX_SAFE_INTEGER;
		}

		const rect = marker.getBoundingClientRect();

		if ( ! rect || rect.width <= 0 || rect.height <= 0 ) {
			return Number.MAX_SAFE_INTEGER;
		}

		return rect.width * rect.height;
	}

	function getBricksElementIdClasses( node ) {
		if ( ! node || ! node.classList ) {
			return [];
		}

		return Array.from( node.classList ).filter( function ( className ) {
			return /^brxe-[a-z0-9]{6}$/i.test( className );
		} );
	}

	function hasRepeatedBricksElementClass( node ) {
		if ( ! node || ! node.parentElement ) {
			return false;
		}

		const classNames = getBricksElementIdClasses( node );

		if ( ! classNames.length ) {
			return false;
		}

		return classNames.some( function ( className ) {
			return Array.from( node.parentElement.children ).some(
				function ( sibling ) {
					return (
						sibling !== node &&
						sibling.classList &&
						sibling.classList.contains( className )
					);
				}
			);
		} );
	}

	function resolveScopedMarkerRoot( event ) {
		let node =
			event && event.target && event.target.nodeType === 1
				? event.target
				: null;

		while (
			node &&
			node !== document.body &&
			node !== document.documentElement
		) {
			if (
				node.hasAttribute &&
				node.hasAttribute( 'data-brx-loop-start' )
			) {
				return node;
			}

			if ( hasRepeatedBricksElementClass( node ) ) {
				return node;
			}

			node = node.parentElement;
		}

		return null;
	}

	function resolveMarkerNodeFromPoint( event ) {
		if (
			! eventHasViewportPoint( event ) ||
			typeof document.elementsFromPoint !== 'function'
		) {
			return null;
		}

		const x = event.clientX;
		const y = event.clientY;
		const candidates = [];
		const seen = new Set();

		function addCandidate( marker, scopeRoot ) {
			if ( ! marker || ! marker.isConnected || seen.has( marker ) ) {
				return;
			}

			if ( scopeRoot && ! scopeRoot.contains( marker ) ) {
				return;
			}

			if ( ! markerContainsViewportPoint( marker, x, y ) ) {
				return;
			}

			if ( ! elementLooksVisible( marker, scopeRoot || null ) ) {
				return;
			}

			seen.add( marker );
			candidates.push( marker );
		}

		document.elementsFromPoint( x, y ).forEach( function ( node ) {
			if ( ! node || isBadgeElement( node ) || isPanelElement( node ) ) {
				return;
			}

			addCandidate( resolveMarkerNodeFromTarget( node ), null );
		} );

		const scopedRoot = resolveScopedMarkerRoot( event );

		if ( scopedRoot && elementLooksVisible( scopedRoot, null ) ) {
			scopedRoot
				.querySelectorAll( '[data-dbvc-ve]' )
				.forEach( function ( marker ) {
					addCandidate( marker, scopedRoot );
				} );
		}

		if ( ! candidates.length ) {
			return null;
		}

		candidates.sort( function ( a, b ) {
			return getMarkerViewportArea( a ) - getMarkerViewportArea( b );
		} );

		return candidates[ 0 ];
	}

	function resolveMarkerNodeFromEvent( event ) {
		const marker = resolveMarkerNodeFromTarget(
			event ? event.target : null
		);

		if ( ! eventHasViewportPoint( event ) ) {
			return marker;
		}

		const pointMarker = resolveMarkerNodeFromPoint( event );

		if ( ! marker ) {
			return pointMarker;
		}

		if (
			! markerContainsViewportPoint(
				marker,
				event.clientX,
				event.clientY
			)
		) {
			return pointMarker || marker;
		}

		if (
			pointMarker &&
			pointMarker !== marker &&
			getMarkerViewportArea( pointMarker ) <
				getMarkerViewportArea( marker )
		) {
			return pointMarker;
		}

		return marker;
	}

	function isBadgeElement( target ) {
		return Boolean(
			target &&
				( ( state.badgeNode &&
					( state.badgeNode === target ||
						state.badgeNode.contains( target ) ) ) ||
					( typeof target.closest === 'function' &&
						target.closest( '.dbvc-ve-section-badge' ) ) )
		);
	}

	function setPreviewNode( node ) {
		clearBadgeHideTimeout();
		state.previewNode = node && node.isConnected ? node : null;
		if ( state.previewNode ) {
			scheduleDescriptorPrefetch( state.previewNode );
		} else {
			clearDescriptorPrefetch();
		}
		scheduleViewportPrefetch();
		scheduleBadgeLayout();
	}

	function handleMarkerMouseOver( event ) {
		if ( isBadgeElement( event.target ) ) {
			return;
		}

		const marker = resolveMarkerNodeFromEvent( event );

		if ( ! marker ) {
			return;
		}

		if ( state.activeNode && state.activeNode !== marker ) {
			return;
		}

		setPreviewNode( marker );
	}

	function handleMarkerMouseOut( event ) {
		if ( isBadgeElement( event.target ) ) {
			return;
		}

		const marker = resolveMarkerNodeFromTarget( event.target );

		if ( ! marker ) {
			return;
		}

		if ( state.activeNode && state.activeNode !== marker ) {
			return;
		}

		if ( event.relatedTarget && marker.contains( event.relatedTarget ) ) {
			return;
		}

		if ( isBadgeElement( event.relatedTarget ) ) {
			return;
		}

		if ( state.previewNode === marker ) {
			scheduleBadgeHide();
		}
	}

	function handleMarkerFocusIn( event ) {
		if ( isBadgeElement( event.target ) ) {
			return;
		}

		const marker = resolveMarkerNodeFromTarget( event.target );

		if ( ! marker ) {
			return;
		}

		if ( state.activeNode && state.activeNode !== marker ) {
			return;
		}

		setPreviewNode( marker );
	}

	function handleMarkerFocusOut( event ) {
		if ( isBadgeElement( event.target ) ) {
			return;
		}

		const marker = resolveMarkerNodeFromTarget( event.target );

		if ( ! marker ) {
			return;
		}

		if ( state.activeNode && state.activeNode !== marker ) {
			return;
		}

		if ( event.relatedTarget && marker.contains( event.relatedTarget ) ) {
			return;
		}

		if ( isBadgeElement( event.relatedTarget ) ) {
			return;
		}

		if ( state.previewNode === marker ) {
			scheduleBadgeHide();
		}
	}

	function handleBadgeKeydown( event ) {
		if ( event.key !== 'Escape' ) {
			return;
		}

		if ( state.panelOpen ) {
			closeEditorPanel();
			return;
		}

		if ( state.activeNode ) {
			return;
		}

		clearBadgeHideTimeout();
		state.previewNode = null;
		clearDescriptorPrefetch();
		scheduleViewportPrefetch();
		scheduleBadgeLayout();
	}

	function isTouchLikePointer( event ) {
		return Boolean(
			event &&
				( event.pointerType === 'touch' || event.pointerType === 'pen' )
		);
	}

	function suppressTouchClick( token ) {
		state.touchSuppressToken = token;
		state.touchClickSuppressUntil = Date.now() + 700;
	}

	function handleMarkerPointerUp( event ) {
		if ( ! isTouchLikePointer( event ) || isBadgeElement( event.target ) ) {
			return;
		}

		const marker = resolveMarkerNodeFromEvent( event );
		const token = getMarkerToken( marker );

		if ( ! marker || ! token ) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		suppressTouchClick( token );

		if (
			state.activeNode &&
			state.activeNode !== marker &&
			state.session
		) {
			state.touchSelectionToken = token;
			openEditor( marker, state.session );
			return;
		}

		if (
			state.touchSelectionToken === token &&
			state.previewNode === marker &&
			state.session
		) {
			openEditor( marker, state.session );
			return;
		}

		state.touchSelectionToken = token;
		setPreviewNode( marker );
	}

	function handleMarkerClick( event ) {
		const marker = resolveMarkerNodeFromEvent( event );
		const token = getMarkerToken( marker );

		if ( ! marker || ! token ) {
			return;
		}

		if (
			state.touchSuppressToken !== token ||
			Date.now() > state.touchClickSuppressUntil
		) {
			return;
		}

		state.touchSuppressToken = '';
		state.touchClickSuppressUntil = 0;
		event.preventDefault();
		event.stopPropagation();
	}

	function resolveBadgeTarget() {
		if ( state.activeNode && state.activeNode.isConnected ) {
			return state.activeNode;
		}

		if ( state.previewNode && state.previewNode.isConnected ) {
			return state.previewNode;
		}

		return null;
	}

	function applyBadgePresentation( node ) {
		const badge = ensureSharedBadge();
		const descriptor = lookupDescriptorForNode( node );
		const scope = getDescriptorScope( descriptor, node );
		const status = getDescriptorStatus( descriptor, node );
		const entityType = getDescriptorEntityType( descriptor );
		const context = getDescriptorRenderContext( descriptor, node );
		const badgeLabel = getDescriptorBadgeLabel( descriptor, node );
		const token = node.getAttribute( 'data-dbvc-ve' ) || '';

		badge.className = 'dbvc-ve-badge';
		badge.dataset.token = token;

		if ( isMissingMediaMarker( node ) ) {
			badge.classList.add( 'dbvc-ve-badge--connected' );
			badge.textContent =
				badgeLabel || strings().panelMediaChoose || 'Add Image';
			return badge;
		}

		if (
			badgeLabel &&
			context === 'query_collection' &&
			status === 'readonly'
		) {
			badge.classList.add( 'dbvc-ve-badge--readonly' );
			badge.textContent =
				strings().panelInspectOnly ||
				strings().inspectLabel ||
				'Inspect only';
			return badge;
		}

		if ( badgeLabel && context === 'query_collection' ) {
			badge.classList.add( 'dbvc-ve-badge--connected' );
			badge.textContent = badgeLabel;
			return badge;
		}

		if ( scope === 'related_entity' ) {
			badge.classList.add( 'dbvc-ve-badge--related' );
			badge.textContent = resolveRelatedBadgeLabel( entityType );
			return badge;
		}

		if ( scope === 'shared_entity' ) {
			badge.classList.add( 'dbvc-ve-badge--shared' );
			badge.textContent = resolveSharedBadgeLabel( entityType );
			return badge;
		}

		if ( badgeLabel ) {
			badge.classList.add(
				context === 'query_collection'
					? 'dbvc-ve-badge--connected'
					: 'dbvc-ve-badge--readonly'
			);
			badge.textContent = badgeLabel;
			return badge;
		}

		if ( status === 'readonly' ) {
			badge.classList.add( 'dbvc-ve-badge--readonly' );
			badge.textContent = strings().inspectLabel || 'Inspect';
			return badge;
		}

		if ( context === 'query_collection' ) {
			badge.classList.add( 'dbvc-ve-badge--connected' );
			badge.textContent = strings().badgeConnected || 'Edit Connected';
			return badge;
		}

		badge.textContent = strings().editLabel || 'Edit';

		return badge;
	}

	function hideSharedBadge() {
		if ( ! state.badgeNode ) {
			return;
		}

		state.badgeNode.style.opacity = '0';
		state.badgeNode.style.pointerEvents = 'none';
	}

	function scheduleBadgeLayout() {
		if ( state.badgeLayoutFrame ) {
			window.cancelAnimationFrame( state.badgeLayoutFrame );
		}

		state.badgeLayoutFrame = window.requestAnimationFrame( function () {
			state.badgeLayoutFrame = 0;
			positionSharedBadge();
			positionQueryCollectionContainerBadges();
		} );
	}

	function positionQueryCollectionContainerBadges() {
		const badges = Array.from(
			document.querySelectorAll(
				'.dbvc-ve-section-badge--query-collection'
			)
		);
		const groups = new Map();

		badges.forEach( function ( badge ) {
			const target = badge._dbvcVeBadgeTarget;

			if (
				! target ||
				! target.isConnected ||
				! elementHasUsableBadgeRect( target )
			) {
				badge.style.opacity = '0';
				badge.style.pointerEvents = 'none';
				return;
			}

			const rect = target.getBoundingClientRect();

			if ( ! rectIntersectsViewport( rect ) ) {
				badge.style.opacity = '0';
				badge.style.pointerEvents = 'none';
				return;
			}

			if ( ! groups.has( target ) ) {
				groups.set( target, {
					rect,
					badges: [],
				} );
			}

			groups.get( target ).badges.push( badge );
		} );

		groups.forEach( function ( group ) {
			const baseLeft = Math.max( 8, group.rect.left + 10 );
			const baseTop = Math.max( 8, group.rect.top + 10 );
			const rowRight = Math.min(
				window.innerWidth - 8,
				Math.max( baseLeft, group.rect.right - 10 )
			);
			let left = baseLeft;
			let top = baseTop;
			let rowHeight = 0;

			group.badges
				.sort( function ( a, b ) {
					const aIndex =
						Number(
							a.dataset.targetIndex || a.dataset.sectionIndex || 0
						) || 0;
					const bIndex =
						Number(
							b.dataset.targetIndex || b.dataset.sectionIndex || 0
						) || 0;

					return aIndex - bIndex;
				} )
				.forEach( function ( badge, index ) {
					const badgeWidth = badge.offsetWidth || 0;
					const badgeHeight = badge.offsetHeight || 0;

					if ( index > 0 && left + badgeWidth > rowRight ) {
						left = baseLeft;
						top += rowHeight + 8;
						rowHeight = 0;
					}

					badge.style.left = `${ Math.min(
						Math.max( 8, left ),
						window.innerWidth - badgeWidth - 8
					) }px`;
					badge.style.top = `${ Math.min(
						Math.max( 8, top ),
						window.innerHeight - badgeHeight - 8
					) }px`;
					badge.style.opacity = '1';
					badge.style.pointerEvents = 'auto';

					left += badgeWidth + 8;
					rowHeight = Math.max( rowHeight, badgeHeight );
				} );
		} );
	}

	function positionSharedBadge() {
		const target = resolveBadgeTarget();
		const badge = ensureSharedBadge();

		if ( ! target || ! target.isConnected ) {
			hideSharedBadge();
			return;
		}

		if (
			shouldMountQueryCollectionContainerBadge( target ) &&
			! isPostTermsCollectionMarker( target )
		) {
			hideSharedBadge();
			return;
		}

		const rect = target.getBoundingClientRect();

		if (
			! rect ||
			rect.width <= 0 ||
			rect.height <= 0 ||
			rect.bottom < 0 ||
			rect.top > window.innerHeight ||
			rect.right < 0 ||
			rect.left > window.innerWidth
		) {
			hideSharedBadge();
			return;
		}

		applyBadgePresentation( target );

		const badgeWidth = badge.offsetWidth || 0;
		const badgeHeight = badge.offsetHeight || 0;
		const left = Math.min(
			Math.max( 8, rect.right - Math.min( 24, badgeWidth / 2 ) ),
			window.innerWidth - badgeWidth - 8
		);
		const top = Math.min(
			Math.max( 8, rect.top - Math.max( 12, badgeHeight / 2 ) ),
			window.innerHeight - badgeHeight - 8
		);

		badge.style.left = `${ left }px`;
		badge.style.top = `${ top }px`;
		badge.style.opacity = '1';
		badge.style.pointerEvents = 'auto';
	}

	function updateStatusBar( statePatch ) {
		const bar = ensureStatusBar();
		const title = bar.querySelector( '.dbvc-ve-statusbar__title' );
		const meta = bar.querySelector( '.dbvc-ve-statusbar__meta' );
		const links = bar.querySelector( '.dbvc-ve-statusbar__links' );
		const message = bar.querySelector( '.dbvc-ve-statusbar__message' );
		const modeActive = strings().modeActive || 'Visual Editor active';
		const nextState = Object.assign(
			{
				kind: 'active',
				count: null,
				message: '',
				editLink: getDefaultStatusBarEditLink(),
			},
			state.statusBarState || {}
		);

		if ( Object.prototype.hasOwnProperty.call( statePatch, 'kind' ) ) {
			nextState.kind = statePatch.kind || 'active';
		}

		if ( Object.prototype.hasOwnProperty.call( statePatch, 'count' ) ) {
			nextState.count =
				typeof statePatch.count === 'number' ? statePatch.count : null;
		}

		if ( Object.prototype.hasOwnProperty.call( statePatch, 'message' ) ) {
			nextState.message = statePatch.message || '';
		}

		if (
			Object.prototype.hasOwnProperty.call( statePatch, 'entitySummary' )
		) {
			nextState.editLink = resolveStatusBarEditLinkFromEntitySummary(
				statePatch.entitySummary
			);
		} else if (
			Object.prototype.hasOwnProperty.call( statePatch, 'editLink' )
		) {
			nextState.editLink =
				normalizeStatusBarLink( statePatch.editLink ) ||
				getDefaultStatusBarEditLink();
		} else if ( ! nextState.editLink ) {
			nextState.editLink = getDefaultStatusBarEditLink();
		}

		state.statusBarState = nextState;

		bar.dataset.state = nextState.kind || 'active';
		bar.classList.toggle(
			'is-field-index-open',
			Boolean( state.fieldIndexOpen )
		);
		title.textContent = modeActive;
		renderStatusBarMeta( meta, nextState );
		links.innerHTML = createStatusBarLinkMarkup( nextState.editLink );
		links.hidden = ! nextState.editLink;
		message.textContent = nextState.message || '';
		syncToolbarState( nextState );
	}

	function getPanelViewportBounds() {
		const visualViewport = window.visualViewport;
		const width =
			visualViewport &&
			Number.isFinite( visualViewport.width ) &&
			visualViewport.width > 0
				? visualViewport.width
				: window.innerWidth ||
				  document.documentElement.clientWidth ||
				  1;
		const height =
			visualViewport &&
			Number.isFinite( visualViewport.height ) &&
			visualViewport.height > 0
				? visualViewport.height
				: window.innerHeight ||
				  document.documentElement.clientHeight ||
				  1;
		const left =
			visualViewport && Number.isFinite( visualViewport.offsetLeft )
				? visualViewport.offsetLeft
				: 0;
		const top =
			visualViewport && Number.isFinite( visualViewport.offsetTop )
				? visualViewport.offsetTop
				: 0;

		return {
			left,
			top,
			width: Math.max( 1, width ),
			height: Math.max( 1, height ),
		};
	}

	function syncPanelViewportSize( panel ) {
		if ( ! panel ) {
			return;
		}

		const bounds = getPanelViewportBounds();

		panel.style.maxWidth = `${ Math.max( 1, bounds.width - 16 ) }px`;
		panel.style.maxHeight = `${ Math.max( 1, bounds.height - 16 ) }px`;
	}

	function ensurePanelPosition( panel ) {
		if ( state.panelPosition || ! panel || panel.hidden ) {
			return;
		}

		syncPanelViewportSize( panel );

		const bounds = getPanelViewportBounds();
		const rect = panel.getBoundingClientRect();
		const panelWidth = rect && rect.width ? rect.width : 380;
		const panelHeight = rect && rect.height ? rect.height : 320;

		state.panelPosition = {
			left: bounds.left + bounds.width - panelWidth - 16,
			top: bounds.top + bounds.height - panelHeight - 108,
		};
	}

	function clampPanelPosition( position, panel ) {
		const bounds = getPanelViewportBounds();
		const margin = 8;
		const minLeft = bounds.left + margin;
		const minTop = bounds.top + margin;
		const availableWidth = Math.max( 1, bounds.width - margin * 2 );
		const availableHeight = Math.max( 1, bounds.height - margin * 2 );

		if ( panel ) {
			syncPanelViewportSize( panel );
		}

		const rect = panel ? panel.getBoundingClientRect() : null;
		const panelWidth = Math.min(
			availableWidth,
			rect ? rect.width || panel.offsetWidth || 380 : 380
		);
		const panelHeight = Math.min(
			availableHeight,
			rect ? rect.height || panel.offsetHeight || 320 : 320
		);
		const maxLeft = Math.max(
			minLeft,
			bounds.left + bounds.width - panelWidth - margin
		);
		const maxTop = Math.max(
			minTop,
			bounds.top + bounds.height - panelHeight - margin
		);
		const parsedLeft = Number( position.left );
		const parsedTop = Number( position.top );
		const requestedLeft = Number.isFinite( parsedLeft )
			? parsedLeft
			: minLeft;
		const requestedTop = Number.isFinite( parsedTop ) ? parsedTop : minTop;

		return {
			left: Math.min( Math.max( minLeft, requestedLeft ), maxLeft ),
			top: Math.min( Math.max( minTop, requestedTop ), maxTop ),
		};
	}

	function applyPanelPosition( panel ) {
		if ( ! panel ) {
			return;
		}

		ensurePanelPosition( panel );

		if ( ! state.panelPosition ) {
			return;
		}

		syncPanelViewportSize( panel );

		const clamped = clampPanelPosition( state.panelPosition, panel );

		state.panelPosition = clamped;
		panel.style.left = `${ clamped.left }px`;
		panel.style.top = `${ clamped.top }px`;
		panel.style.right = 'auto';
		panel.style.bottom = 'auto';
	}

	function ensurePanelInViewport() {
		if ( ! state.panelOpen ) {
			return;
		}

		const panel = ensureEditorPanel();

		ensurePanelPosition( panel );

		if ( ! state.panelPosition ) {
			return;
		}

		const clamped = clampPanelPosition( state.panelPosition, panel );

		if (
			clamped.left !== state.panelPosition.left ||
			clamped.top !== state.panelPosition.top
		) {
			state.panelPosition = clamped;
			applyPanelPosition( panel );
			persistPanelPosition( clamped );
		}
	}

	function schedulePanelViewportClamp() {
		if ( ! state.panelOpen ) {
			return;
		}

		window.requestAnimationFrame( function () {
			ensurePanelInViewport();
		} );
	}

	function setPanelOpen( isOpen ) {
		const panel = ensureEditorPanel();

		state.panelOpen = Boolean( isOpen );
		panel.hidden = ! state.panelOpen;
		panel.setAttribute( 'aria-hidden', state.panelOpen ? 'false' : 'true' );
		panel.dataset.open = state.panelOpen ? '1' : '0';

		if ( state.panelOpen ) {
			applyPanelPosition( panel );
			schedulePanelViewportClamp();
		}

		scheduleViewportPrefetch();
	}

	function isPanelElement( target ) {
		const panel = document.querySelector( '.dbvc-ve-panel' );

		return Boolean(
			panel && target && ( panel === target || panel.contains( target ) )
		);
	}

	function isToolbarElement( target ) {
		return Boolean(
			target &&
				typeof target.closest === 'function' &&
				target.closest( '.dbvc-ve-toolbar' )
		);
	}

	function isWpMediaModalElement( target ) {
		if ( ! target || typeof target.closest !== 'function' ) {
			return false;
		}

		return Boolean(
			target.closest( '.media-modal' ) ||
				target.closest( '.media-modal-backdrop' ) ||
				target.closest( '.media-frame' )
		);
	}

	function shouldIgnorePanelDragTarget( target ) {
		if ( ! target ) {
			return false;
		}

		return Boolean(
			target.closest(
				'button, input, select, textarea, label, summary, details, a'
			)
		);
	}

	function handlePanelDragMove( event ) {
		if ( ! state.panelDrag ) {
			return;
		}

		const panel = ensureEditorPanel();
		const nextPosition = clampPanelPosition(
			{
				left: event.clientX - state.panelDrag.offsetX,
				top: event.clientY - state.panelDrag.offsetY,
			},
			panel
		);

		state.panelPosition = nextPosition;
		applyPanelPosition( panel );
	}

	function endPanelDrag() {
		if ( ! state.panelDrag ) {
			return;
		}

		persistPanelPosition( state.panelPosition );
		document.body.classList.remove( 'dbvc-ve-panel-dragging' );
		window.removeEventListener( 'pointermove', handlePanelDragMove, true );
		window.removeEventListener( 'pointerup', endPanelDrag, true );
		window.removeEventListener( 'pointercancel', endPanelDrag, true );
		state.panelDrag = null;
	}

	function startPanelDrag( event ) {
		const panel = ensureEditorPanel();

		if (
			! state.panelOpen ||
			event.button !== 0 ||
			shouldIgnorePanelDragTarget( event.target )
		) {
			return;
		}

		const rect = panel.getBoundingClientRect();

		event.preventDefault();

		state.panelDrag = {
			offsetX: event.clientX - rect.left,
			offsetY: event.clientY - rect.top,
		};

		state.panelPosition = {
			left: rect.left,
			top: rect.top,
		};

		applyPanelPosition( panel );
		document.body.classList.add( 'dbvc-ve-panel-dragging' );
		window.addEventListener( 'pointermove', handlePanelDragMove, true );
		window.addEventListener( 'pointerup', endPanelDrag, true );
		window.addEventListener( 'pointercancel', endPanelDrag, true );
	}

	function handlePanelOutsidePointerDown( event ) {
		if ( ! state.panelOpen || state.panelDrag ) {
			return;
		}

		if (
			isPanelElement( event.target ) ||
			isBadgeElement( event.target ) ||
			isToolbarElement( event.target ) ||
			isWpMediaModalElement( event.target )
		) {
			return;
		}

		closeEditorPanel();
	}

	function ensureEditorPanel() {
		let panel = document.querySelector( '.dbvc-ve-panel' );

		if ( panel ) {
			if ( ! state.panelPosition ) {
				state.panelPosition = loadStoredPanelPosition();
			}
			return panel;
		}

		if ( ! state.panelPosition ) {
			state.panelPosition = loadStoredPanelPosition();
		}

		panel = document.createElement( 'aside' );
		panel.className = 'dbvc-ve-panel';
		panel.hidden = true;
		panel.setAttribute( 'aria-hidden', 'true' );
		panel.dataset.open = '0';
		panel.innerHTML = [
			'<div class="dbvc-ve-panel__header">',
			'  <div>',
			'    <div class="dbvc-ve-panel__eyebrow">DBVC Visual Editor</div>',
			'    <h2 class="dbvc-ve-panel__title"></h2>',
			'    <div class="dbvc-ve-panel__entity-type"></div>',
			'  </div>',
			'  <button type="button" class="dbvc-ve-panel__close" aria-label="Close">×</button>',
			'</div>',
			'<div class="dbvc-ve-panel__entity-links"></div>',
			'<div class="dbvc-ve-panel__notice"></div>',
			'<div class="dbvc-ve-panel__body">',
			'  <label class="dbvc-ve-panel__field-label" for="dbvc-ve-panel-input"></label>',
			'  <div class="dbvc-ve-panel__meta"></div>',
			'  <div class="dbvc-ve-panel__field-wrap"></div>',
			'</div>',
			'<div class="dbvc-ve-panel__status"></div>',
			'<div class="dbvc-ve-panel__footer-notice" hidden></div>',
			'<div class="dbvc-ve-panel__actions">',
			'  <button type="button" class="dbvc-ve-panel__button dbvc-ve-panel__button--secondary" data-action="close"></button>',
			'  <button type="button" class="dbvc-ve-panel__button dbvc-ve-panel__button--secondary" data-action="save-no-reload" hidden></button>',
			'  <button type="button" class="dbvc-ve-panel__button dbvc-ve-panel__button--primary" data-action="save"></button>',
			'</div>',
		].join( '' );

		panel
			.querySelector( '[data-action="close"]' )
			.addEventListener( 'click', closeEditorPanel );
		panel
			.querySelector( '.dbvc-ve-panel__close' )
			.addEventListener( 'click', closeEditorPanel );
		panel
			.querySelector( '[data-action="save"]' )
			.addEventListener( 'click', function () {
				handleSave( { reloadAfterSave: true } );
			} );
		panel
			.querySelector( '[data-action="save-no-reload"]' )
			.addEventListener( 'click', function () {
				handleSave( { reloadAfterSave: false, closeAfterSave: true } );
			} );
		panel
			.querySelector( '.dbvc-ve-panel__header' )
			.addEventListener( 'pointerdown', startPanelDrag );

		document.body.appendChild( panel );

		applyPanelPosition( panel );
		renderIdlePanel();

		return panel;
	}

	function getPanelNodes() {
		const panel = ensureEditorPanel();

		return {
			panel,
			title: panel.querySelector( '.dbvc-ve-panel__title' ),
			entityType: panel.querySelector( '.dbvc-ve-panel__entity-type' ),
			entityLinks: panel.querySelector( '.dbvc-ve-panel__entity-links' ),
			meta: panel.querySelector( '.dbvc-ve-panel__meta' ),
			notice: panel.querySelector( '.dbvc-ve-panel__notice' ),
			fieldLabel: panel.querySelector( '.dbvc-ve-panel__field-label' ),
			fieldWrap: panel.querySelector( '.dbvc-ve-panel__field-wrap' ),
			status: panel.querySelector( '.dbvc-ve-panel__status' ),
			footerNotice: panel.querySelector(
				'.dbvc-ve-panel__footer-notice'
			),
			closeButton: panel.querySelector( '[data-action="close"]' ),
			saveNoReloadButton: panel.querySelector(
				'[data-action="save-no-reload"]'
			),
			saveButton: panel.querySelector( '[data-action="save"]' ),
		};
	}

	function renderIdlePanel() {
		const panelNodes = getPanelNodes();

		destroyActiveController();
		clearDescriptorPrefetch();
		state.activeNode = null;
		state.activeDescriptor = null;
		state.activeController = null;
		state.activeRequiresSharedScopeAck = false;
		state.activeAcknowledgementType = 'none';
		state.activeSaveBlockedByStale = false;
		state.sharedScopeAcknowledged = false;
		state.touchSelectionToken = '';
		panelNodes.panel.dataset.state = 'idle';
		panelNodes.panel.dataset.scope = 'current_entity';
		panelNodes.panel.dataset.status = 'idle';
		panelNodes.title.textContent = strings().panelTitle || 'Edit field';
		panelNodes.entityType.textContent = '';
		panelNodes.entityLinks.innerHTML = '';
		panelNodes.meta.innerHTML = '';
		panelNodes.notice.innerHTML = '';
		if ( panelNodes.footerNotice ) {
			panelNodes.footerNotice.innerHTML = '';
			panelNodes.footerNotice.hidden = true;
		}
		panelNodes.fieldLabel.textContent = '';
		panelNodes.fieldWrap.innerHTML =
			'<div class="dbvc-ve-panel__placeholder"></div>';
		panelNodes.fieldWrap.firstChild.textContent =
			strings().panelReady || 'Select a marker to inspect and edit it.';
		panelNodes.status.textContent = '';
		panelNodes.closeButton.textContent = strings().panelCancel || 'Close';
		panelNodes.saveNoReloadButton.textContent =
			strings().panelSave || 'Save';
		panelNodes.saveNoReloadButton.hidden = true;
		panelNodes.saveNoReloadButton.disabled = true;
		panelNodes.saveButton.textContent = strings().panelSave || 'Save';
		panelNodes.saveButton.disabled = true;

		document
			.querySelectorAll( '.dbvc-ve-target.is-active' )
			.forEach( function ( node ) {
				node.classList.remove( 'is-active' );
			} );

		scheduleBadgeLayout();
	}

	function closeEditorPanel() {
		renderIdlePanel();
		setPanelOpen( false );
		updateStatusBar( {
			entitySummary: null,
		} );
	}

	function destroyActiveController() {
		if (
			state.activeController &&
			typeof state.activeController.destroy === 'function'
		) {
			state.activeController.destroy();
		}
	}

	function syncTextareaAutoHeight( field ) {
		if ( ! field ) {
			return;
		}

		field.style.height = 'auto';
		field.style.height = `${ Math.max( field.scrollHeight, 92 ) }px`;
	}

	function createTextLikeController( value ) {
		const field = document.createElement( 'textarea' );

		field.id = 'dbvc-ve-panel-input';
		field.className = 'dbvc-ve-panel__input dbvc-ve-panel__input--textlike';
		field.rows = 3;
		field.value =
			value === null || typeof value === 'undefined'
				? ''
				: String( value );
		syncTextareaAutoHeight( field );
		field.addEventListener( 'input', function () {
			syncTextareaAutoHeight( field );
		} );

		return {
			element: field,
			getValue() {
				return field.value;
			},
			setValue( nextValue ) {
				field.value =
					nextValue === null || typeof nextValue === 'undefined'
						? ''
						: String( nextValue );
				syncTextareaAutoHeight( field );
			},
			focus() {
				field.focus();
				field.setSelectionRange(
					field.value.length,
					field.value.length
				);
			},
			setDisabled( disabled ) {
				field.disabled = Boolean( disabled );
			},
		};
	}

	function createInputController( type, value ) {
		if ( ( type || 'text' ) === 'text' ) {
			return createTextLikeController( value );
		}

		const field = document.createElement( 'input' );

		field.id = 'dbvc-ve-panel-input';
		field.className = 'dbvc-ve-panel__input';
		field.type = type || 'text';
		field.value =
			value === null || typeof value === 'undefined'
				? ''
				: String( value );

		return {
			element: field,
			getValue() {
				return field.value;
			},
			setValue( nextValue ) {
				field.value =
					nextValue === null || typeof nextValue === 'undefined'
						? ''
						: String( nextValue );
			},
			focus() {
				field.focus();
				field.select();
			},
			setDisabled( disabled ) {
				field.disabled = Boolean( disabled );
			},
		};
	}

	// true_false: checkbox controller for ACF boolean fields.
	// Reads back as `1` (checked) / `0` (unchecked) — matches ACF's
	// canonical storage format and the AcfTrueFalseResolver sanitize path.
	function createBooleanController( value ) {
		const wrapper = document.createElement( 'label' );
		wrapper.className = 'dbvc-ve-panel__boolean';
		const checkbox = document.createElement( 'input' );
		checkbox.type = 'checkbox';
		checkbox.id = 'dbvc-ve-panel-input';
		checkbox.className = 'dbvc-ve-panel__boolean-input';
		const initial = coerceBooleanValue( value );
		checkbox.checked = initial;
		const labelText = document.createElement( 'span' );
		labelText.className = 'dbvc-ve-panel__boolean-label';
		labelText.textContent = initial
			? ( strings().panelBooleanOn || 'On' )
			: ( strings().panelBooleanOff || 'Off' );
		checkbox.addEventListener( 'change', function () {
			labelText.textContent = checkbox.checked
				? ( strings().panelBooleanOn || 'On' )
				: ( strings().panelBooleanOff || 'Off' );
		} );
		wrapper.appendChild( checkbox );
		wrapper.appendChild( labelText );

		return {
			element: wrapper,
			getValue() {
				return checkbox.checked ? 1 : 0;
			},
			setValue( nextValue ) {
				const next = coerceBooleanValue( nextValue );
				checkbox.checked = next;
				labelText.textContent = next
					? ( strings().panelBooleanOn || 'On' )
					: ( strings().panelBooleanOff || 'Off' );
			},
			focus() {
				checkbox.focus();
			},
			setDisabled( disabled ) {
				checkbox.disabled = Boolean( disabled );
			},
		};
	}

	// R5.later-y (2026-09-04) — palette overview panel controller.
	// R5.later-y-2 (2026-09-05) — swatches are now LIVE inline color
	// editors, not navigation buttons. Reads `descriptor.source.leaves`
	// (array of {publicId, label, current_hex}) minted by Vertical's
	// `buildPaletteOverviewDescriptor`. Renders a responsive CSS grid
	// where each cell is a `<label>` wrapping a native `<input
	// type="color">` + the label/hex text + a save-status indicator.
	//
	// Save flow (lazy-open + save through the existing R5.2+color_picker
	// contract):
	//   1. First change on a swatch → POST /control-center/open with the
	//      leaf's publicId → cache the returned token per publicId.
	//   2. Every change (first or subsequent) → POST /save with cached
	//      token + new hex value → update per-swatch status indicator
	//      (pending → saved → clear after 1.5s) or error state.
	// The token cache means only the first edit of a specific swatch
	// pays the open round-trip; every subsequent edit is a single
	// round-trip save. `input` events fire while dragging the native
	// picker — we debounce 250ms so a live drag saves once at rest.
	//
	// getValue() returns null — the panel's Save button intentionally
	// no-ops for palette overviews (handleSave has an early-return for
	// `descriptor.render.input === 'palette_grid'`). Saves are per-swatch,
	// not whole-panel.
	function createPaletteOverviewController( descriptor ) {
		const wrapper = document.createElement( 'div' );
		wrapper.className = 'dbvc-ve-panel__palette-overview';
		wrapper.id = 'dbvc-ve-panel-input';
		const s = strings();
		const source =
			descriptor && descriptor.source && typeof descriptor.source === 'object'
				? descriptor.source
				: {};
		const leaves =
			source && Array.isArray( source.leaves ) ? source.leaves : [];
		const count = leaves.length;
		// Header text with pluralised color count.
		const header = document.createElement( 'p' );
		header.className = 'dbvc-ve-panel__palette-overview-header';
		const headerTemplate =
			count === 1
				? s.panelPaletteOverviewHeaderOne || '{count} color in this palette. Each color saves automatically when changed.'
				: s.panelPaletteOverviewHeaderMany || '{count} colors in this palette. Each color saves automatically when changed.';
		header.textContent = headerTemplate.replace( '{count}', String( count ) );
		wrapper.appendChild( header );

		const grid = document.createElement( 'div' );
		grid.className = 'dbvc-ve-panel__palette-overview-grid';
		grid.setAttribute( 'role', 'list' );
		wrapper.appendChild( grid );

		if ( count === 0 ) {
			const empty = document.createElement( 'p' );
			empty.className = 'dbvc-ve-panel__palette-overview-empty';
			empty.textContent =
				s.panelPaletteOverviewEmpty || 'No colors in this palette yet.';
			wrapper.appendChild( empty );
		}

		// R5.later-y-2 — per-publicId descriptor cache. Populated on the
		// first swatch change; subsequent saves against the same swatch
		// reuse the cached token.
		//
		// R5.later-y-3 (2026-09-05) — pre-warm the cache with each
		// leaf's pre-minted token when the Vertical provider embedded
		// one. The server-side `ControlCenterOpenController` registers
		// those leaf descriptors alongside the palette parent at open
		// time, so a save against a pre-minted token works immediately
		// without an intermediate `/control-center/open` call. First
		// save per swatch drops from 2 round-trips to 1. Leaves missing
		// a pre-minted token (defensive — factory build failed for that
		// leaf) still fall through to the lazy-open path unchanged.
		const descriptorCache = {};
		const debounceTimers = {};
		leaves.forEach( function ( leaf ) {
			if (
				leaf &&
				typeof leaf.publicId === 'string' &&
				leaf.publicId &&
				typeof leaf.token === 'string' &&
				leaf.token
			) {
				descriptorCache[ leaf.publicId ] = { token: leaf.token };
			}
		} );

		leaves.forEach( function ( leaf ) {
			if ( ! leaf || typeof leaf !== 'object' ) {
				return;
			}
			const publicId =
				typeof leaf.publicId === 'string' ? leaf.publicId : '';
			const label = typeof leaf.label === 'string' ? leaf.label : '';
			const initialHex =
				typeof leaf.current_hex === 'string' ? leaf.current_hex : '';
			if ( publicId === '' ) {
				return;
			}
			const cell = document.createElement( 'label' );
			cell.className = 'dbvc-ve-panel__palette-overview-cell';
			cell.setAttribute( 'role', 'listitem' );
			cell.setAttribute( 'data-public-id', publicId );
			const editTemplate =
				s.panelPaletteOverviewCellLabel || 'Edit {label}';
			cell.setAttribute(
				'aria-label',
				editTemplate.replace( '{label}', label )
			);

			// Swatch wrapper — the visible color square, positioned above
			// the native `<input type="color">` which is transparent but
			// covers the same area so clicking the swatch opens the picker.
			const swatchWrap = document.createElement( 'span' );
			swatchWrap.className = 'dbvc-ve-panel__palette-overview-swatch-wrap';

			const swatch = document.createElement( 'span' );
			swatch.className = 'dbvc-ve-panel__palette-overview-swatch';
			swatch.setAttribute( 'aria-hidden', 'true' );
			if ( initialHex !== '' ) {
				swatch.style.backgroundColor = initialHex;
			} else {
				swatch.classList.add( 'is-empty' );
			}
			swatchWrap.appendChild( swatch );

			const input = document.createElement( 'input' );
			input.type = 'color';
			input.className = 'dbvc-ve-panel__palette-overview-input';
			// Native color inputs REQUIRE a hex value — a real one, not
			// empty. Fall back to a neutral gray when the current value
			// is empty so the picker opens without a warning; on change
			// the user's actual pick becomes the new value.
			input.value = initialHex !== '' ? initialHex : '#000000';
			input.setAttribute(
				'aria-label',
				editTemplate.replace( '{label}', label )
			);
			swatchWrap.appendChild( input );
			cell.appendChild( swatchWrap );

			const meta = document.createElement( 'span' );
			meta.className = 'dbvc-ve-panel__palette-overview-meta';
			const nameEl = document.createElement( 'span' );
			nameEl.className = 'dbvc-ve-panel__palette-overview-name';
			nameEl.textContent = label;
			const hexEl = document.createElement( 'span' );
			hexEl.className = 'dbvc-ve-panel__palette-overview-hex';
			hexEl.textContent = initialHex !== '' ? initialHex : '—';
			meta.appendChild( nameEl );
			meta.appendChild( hexEl );
			cell.appendChild( meta );

			// Per-cell save status indicator. `aria-live="polite"` so
			// screen readers announce state changes. Empty text renders
			// no dot; the CSS uses `:empty` to collapse the slot.
			const statusEl = document.createElement( 'span' );
			statusEl.className = 'dbvc-ve-panel__palette-overview-cell-status';
			statusEl.setAttribute( 'role', 'status' );
			statusEl.setAttribute( 'aria-live', 'polite' );
			cell.appendChild( statusEl );

			// `input` event fires continuously while the user is dragging
			// the picker; `change` fires once at rest. We debounce a
			// combined listener so a rapid drag doesn't fire N saves —
			// just one at the end. 250ms matches the R4-C-1a search
			// debounce for consistency.
			function handleSwatchChange() {
				const newHex = input.value;
				if ( debounceTimers[ publicId ] ) {
					window.clearTimeout( debounceTimers[ publicId ] );
				}
				debounceTimers[ publicId ] = window.setTimeout( function () {
					debounceTimers[ publicId ] = 0;
					saveSwatch( publicId, newHex, cell, swatch, hexEl, statusEl );
				}, 250 );
			}
			input.addEventListener( 'input', handleSwatchChange );
			input.addEventListener( 'change', handleSwatchChange );

			grid.appendChild( cell );
		} );

		function saveSwatch( publicId, hex, cell, swatch, hexEl, statusEl ) {
			setCellState( cell, statusEl, 'saving', s );
			// R5.later-y-2 — lazy-open pattern: first save on a swatch
			// resolves the leaf's descriptor via a silent /open call
			// (dispatched as `absorb-descriptor: false` so overlay-app
			// doesn't remount the panel). Cached tokens skip this step.
			const cached = descriptorCache[ publicId ];
			const openPromise = cached
				? Promise.resolve( { token: cached.token } )
				: openLeafDescriptor( publicId );
			openPromise
				.then( function ( openResult ) {
					if ( ! openResult || ! openResult.token ) {
						throw new Error( 'open failed' );
					}
					if ( ! cached ) {
						descriptorCache[ publicId ] = openResult;
					}
					return window.DBVCVisualEditorApi.save(
						getSessionId(),
						openResult.token,
						hex,
						true
					);
				} )
				.then( function () {
					// Optimistically update the swatch + hex label. The
					// server-returned value is authoritative but for a
					// simple hex round-trip the input's value is already
					// the sanitized form.
					swatch.style.backgroundColor = hex;
					swatch.classList.remove( 'is-empty' );
					hexEl.textContent = hex;
					setCellState( cell, statusEl, 'saved', s );
					// Clear the saved state after 1.5s so the cell
					// returns to idle. Matches R4-D-1's save-status-strip
					// fade timing shape but scoped per-cell not per-panel.
					window.setTimeout( function () {
						if ( cell.dataset.state === 'saved' ) {
							setCellState( cell, statusEl, 'idle', s );
						}
					}, 1500 );
				} )
				.catch( function () {
					setCellState( cell, statusEl, 'error', s );
				} );
		}

		function openLeafDescriptor( publicId ) {
			const openUrl =
				DBVCVisualEditorBootstrap.restBase +
				'/session/' +
				encodeURIComponent( getSessionId() ) +
				'/control-center/open';
			return window
				.fetch( openUrl, {
					method: 'POST',
					credentials: 'same-origin',
					headers: {
						Accept: 'application/json',
						'Content-Type': 'application/json',
						'X-WP-Nonce': DBVCVisualEditorBootstrap.nonce,
					},
					body: JSON.stringify( { publicId: publicId } ),
				} )
				.then( function ( response ) {
					return response
						.json()
						.catch( function () {
							return null;
						} )
						.then( function ( payload ) {
							if (
								! response.ok ||
								! payload ||
								payload.ok !== true ||
								! payload.descriptors
							) {
								return null;
							}
							const tokens = Object.keys( payload.descriptors );
							if ( tokens.length === 0 ) {
								return null;
							}
							return { token: tokens[ 0 ] };
						} );
				} );
		}

		function setCellState( cell, statusEl, state, sBag ) {
			cell.dataset.state = state;
			switch ( state ) {
				case 'saving':
					statusEl.textContent =
						sBag.panelPaletteOverviewCellSaving || 'Saving…';
					break;
				case 'saved':
					statusEl.textContent =
						sBag.panelPaletteOverviewCellSaved || 'Saved';
					break;
				case 'error':
					statusEl.textContent =
						sBag.panelPaletteOverviewCellError || 'Save failed';
					break;
				default:
					statusEl.textContent = '';
			}
		}

		return {
			element: wrapper,
			getValue() {
				// Palette overview saves are per-swatch, not whole-panel.
				// Returning `null` (vs an empty string) signals "no
				// writeable value" so a defensive check in handleSave
				// can skip the outer Save button click.
				return null;
			},
			setValue( /* nextValue */ ) {
				// No-op — palette overview has no writable state at the
				// container level. Per-swatch saves are managed
				// internally via `saveSwatch`.
			},
			focus() {
				const firstInput = wrapper.querySelector(
					'.dbvc-ve-panel__palette-overview-input'
				);
				if ( firstInput ) {
					firstInput.focus();
				}
			},
			setDisabled( /* disabled */ ) {
				// R5.later-y-2c hotfix (2026-09-05): NO-OP intentional.
				// The panel-level `handleSave` calls `setDisabled(true)`
				// when `result.canEdit === false`, which is always the
				// case for palette overviews because the descriptor's
				// status is `available` (not `editable`) and its
				// mutation array is empty (no whole-panel save). Left
				// as a naive input-disable, this would disable every
				// swatch's `<input type="color">` and lock the user out
				// of inline editing. Per-swatch saves route through
				// each leaf's OWN descriptor (via lazy `openLeafDescriptor`
				// on first change) — that leaf descriptor IS editable
				// and IS writable via the existing R5.2+color_picker
				// save contract, so the palette parent's "not writable"
				// state is orthogonal to whether individual swatches
				// can save. The correct behaviour is to keep swatches
				// enabled regardless of the panel-level disabled call.
			},
		};
	}

	// R5.later-b (2026-09-05) — Option Y bulk-palette popover.
	// Full-attention modal surface for editing a palette's colors.
	// Complements R5.later-y-2's compact side-panel by giving curators
	// a larger canvas with per-swatch Copy-hex + a header
	// "Copy all as CSS variables" action for design-token export.
	//
	// State: single-modal-at-a-time (rebuilds if reopened while open).
	// Save flow byte-identical to the side-panel: each swatch runs
	// its own lazy-open + save via the leaf's own single-color descriptor.
	// Zero new REST routes, zero new mutation authority.

	// Module-scoped modal-state so a second open replaces (not stacks).
	let paletteBulkPopoverState = null;

	function openPaletteBulkPopover( publicId ) {
		if ( ! publicId ) {
			return;
		}
		if ( ! DBVCVisualEditorBootstrap || ! DBVCVisualEditorBootstrap.restBase ) {
			return;
		}
		// If a modal is already open (curator clicked Expand while it was
		// up), replace its contents rather than stacking.
		closePaletteBulkPopover();
		const openUrl =
			DBVCVisualEditorBootstrap.restBase +
			'/session/' +
			encodeURIComponent( getSessionId() ) +
			'/control-center/open';
		// Loading state — mount an empty modal shell immediately so the
		// curator sees the surface open without staring at a broken
		// click. Populate with the swatch grid once the fetch resolves.
		const shell = buildPaletteBulkPopoverShell();
		paletteBulkPopoverState = shell;
		document.body.appendChild( shell.backdrop );
		shell.headerTitle.textContent =
			strings().panelPaletteBulkLoading || 'Loading palette…';
		// Focus the close button so Escape works from keystroke 1.
		shell.closeButton.focus();
		window
			.fetch( openUrl, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'X-WP-Nonce': DBVCVisualEditorBootstrap.nonce,
				},
				body: JSON.stringify( { publicId: publicId } ),
			} )
			.then( function ( response ) {
				return response
					.json()
					.catch( function () {
						return null;
					} )
					.then( function ( payload ) {
						if (
							! response.ok ||
							! payload ||
							payload.ok !== true ||
							! payload.descriptorHydrations
						) {
							return null;
						}
						const tokens = Object.keys( payload.descriptorHydrations );
						if ( tokens.length === 0 ) {
							return null;
						}
						const hydration = payload.descriptorHydrations[ tokens[ 0 ] ];
						if ( ! hydration || ! hydration.descriptor ) {
							return null;
						}
						return hydration.descriptor;
					} );
			} )
			.then( function ( descriptor ) {
				if ( ! paletteBulkPopoverState || paletteBulkPopoverState !== shell ) {
					return; // modal was closed / replaced while fetch was in-flight
				}
				if ( ! descriptor ) {
					shell.headerTitle.textContent =
						strings().panelPaletteBulkFailed ||
						'Could not load palette.';
					return;
				}
				renderPaletteBulkPopoverContent( shell, descriptor );
			} )
			.catch( function () {
				if ( paletteBulkPopoverState === shell ) {
					shell.headerTitle.textContent =
						strings().panelPaletteBulkFailed ||
						'Could not load palette.';
				}
			} );
	}

	function closePaletteBulkPopover() {
		if ( ! paletteBulkPopoverState ) {
			return;
		}
		const shell = paletteBulkPopoverState;
		paletteBulkPopoverState = null;
		if ( shell.escapeHandler ) {
			document.removeEventListener( 'keydown', shell.escapeHandler, true );
		}
		if ( shell.backdrop && shell.backdrop.parentNode ) {
			shell.backdrop.parentNode.removeChild( shell.backdrop );
		}
		// Restore focus to the drawer's Expand button that opened this
		// modal, if it's still in the DOM.
		if ( shell.returnFocus && shell.returnFocus.focus ) {
			try {
				shell.returnFocus.focus();
			} catch ( err ) {
				/* focus recovery best-effort */
			}
		}
	}

	function buildPaletteBulkPopoverShell() {
		const s = strings();
		const backdrop = document.createElement( 'div' );
		backdrop.className = 'dbvc-ve-palette-bulk-popover-backdrop';
		backdrop.setAttribute( 'role', 'presentation' );

		const container = document.createElement( 'div' );
		container.className = 'dbvc-ve-palette-bulk-popover';
		container.setAttribute( 'role', 'dialog' );
		container.setAttribute( 'aria-modal', 'true' );
		container.setAttribute( 'aria-labelledby', 'dbvc-ve-palette-bulk-popover-title' );

		const header = document.createElement( 'div' );
		header.className = 'dbvc-ve-palette-bulk-popover__header';

		const headerTitle = document.createElement( 'h2' );
		headerTitle.className = 'dbvc-ve-palette-bulk-popover__title';
		headerTitle.id = 'dbvc-ve-palette-bulk-popover-title';
		header.appendChild( headerTitle );

		const headerActions = document.createElement( 'div' );
		headerActions.className = 'dbvc-ve-palette-bulk-popover__header-actions';

		const copyAllButton = document.createElement( 'button' );
		copyAllButton.type = 'button';
		copyAllButton.className =
			'dbvc-ve-palette-bulk-popover__copy-all is-hidden';
		copyAllButton.textContent =
			s.panelPaletteBulkCopyAll || 'Copy all as CSS variables';
		headerActions.appendChild( copyAllButton );

		const closeButton = document.createElement( 'button' );
		closeButton.type = 'button';
		closeButton.className = 'dbvc-ve-palette-bulk-popover__close';
		closeButton.setAttribute(
			'aria-label',
			s.panelPaletteBulkClose || 'Close palette editor'
		);
		closeButton.setAttribute(
			'title',
			s.panelPaletteBulkClose || 'Close palette editor'
		);
		closeButton.innerHTML =
			'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
		closeButton.addEventListener( 'click', closePaletteBulkPopover );
		headerActions.appendChild( closeButton );
		header.appendChild( headerActions );
		container.appendChild( header );

		const body = document.createElement( 'div' );
		body.className = 'dbvc-ve-palette-bulk-popover__body';
		container.appendChild( body );

		const statusEl = document.createElement( 'div' );
		statusEl.className = 'dbvc-ve-palette-bulk-popover__status';
		statusEl.setAttribute( 'role', 'status' );
		statusEl.setAttribute( 'aria-live', 'polite' );
		container.appendChild( statusEl );

		backdrop.appendChild( container );

		// Click-outside close: only when the click lands directly on
		// the backdrop, not on children.
		backdrop.addEventListener( 'click', function ( event ) {
			if ( event.target === backdrop ) {
				closePaletteBulkPopover();
			}
		} );

		// Escape close.
		const escapeHandler = function ( event ) {
			if ( event.key === 'Escape' ) {
				event.preventDefault();
				closePaletteBulkPopover();
			}
		};
		document.addEventListener( 'keydown', escapeHandler, true );

		return {
			backdrop: backdrop,
			container: container,
			header: header,
			headerTitle: headerTitle,
			copyAllButton: copyAllButton,
			closeButton: closeButton,
			body: body,
			statusEl: statusEl,
			escapeHandler: escapeHandler,
			returnFocus: document.activeElement,
			leaves: [],
			descriptorCache: {},
		};
	}

	function renderPaletteBulkPopoverContent( shell, descriptor ) {
		const s = strings();
		const source =
			descriptor && descriptor.source && typeof descriptor.source === 'object'
				? descriptor.source
				: {};
		const leaves = Array.isArray( source.leaves ) ? source.leaves : [];
		shell.leaves = leaves;
		// R5.later-y-3 (2026-09-05): pre-warm the modal's descriptor
		// cache from any leaf tokens the server embedded. Mirrors the
		// side-panel controller's pre-warm — first save per swatch is
		// 1 round-trip instead of 2 when leaves carry pre-minted tokens.
		leaves.forEach( function ( leaf ) {
			if (
				leaf &&
				typeof leaf.publicId === 'string' &&
				leaf.publicId &&
				typeof leaf.token === 'string' &&
				leaf.token
			) {
				shell.descriptorCache[ leaf.publicId ] = { token: leaf.token };
			}
		} );

		const title =
			( descriptor.entity && descriptor.entity.label ) ||
			( descriptor.render && descriptor.render.label ) ||
			s.panelPaletteBulkFallbackTitle ||
			'Palette editor';
		shell.headerTitle.textContent = title;

		// Show Copy All when there's at least one non-empty color.
		const anyHex = leaves.some( function ( leaf ) {
			return leaf && typeof leaf.current_hex === 'string' && leaf.current_hex !== '';
		} );
		if ( anyHex ) {
			shell.copyAllButton.classList.remove( 'is-hidden' );
			shell.copyAllButton.addEventListener( 'click', function () {
				const css = leaves
					.filter( function ( leaf ) {
						return leaf && leaf.current_hex;
					} )
					.map( function ( leaf ) {
						const varName = String( leaf.label || leaf.field_name || '' )
							.toLowerCase()
							.replace( /[^a-z0-9]+/g, '-' )
							.replace( /^-+|-+$/g, '' );
						return '--' + varName + ': ' + leaf.current_hex + ';';
					} )
					.join( '\n' );
				copyToClipboard( css, shell.statusEl );
			} );
		}

		// Body: enlarged swatch grid.
		shell.body.innerHTML = '';
		const grid = document.createElement( 'div' );
		grid.className = 'dbvc-ve-palette-bulk-popover__grid';
		grid.setAttribute( 'role', 'list' );

		if ( leaves.length === 0 ) {
			const empty = document.createElement( 'p' );
			empty.className = 'dbvc-ve-palette-bulk-popover__empty';
			empty.textContent =
				s.panelPaletteOverviewEmpty || 'No colors in this palette yet.';
			shell.body.appendChild( empty );
			return;
		}

		leaves.forEach( function ( leaf ) {
			if ( ! leaf || typeof leaf !== 'object' ) {
				return;
			}
			const publicId =
				typeof leaf.publicId === 'string' ? leaf.publicId : '';
			const label = typeof leaf.label === 'string' ? leaf.label : '';
			const initialHex =
				typeof leaf.current_hex === 'string' ? leaf.current_hex : '';
			if ( publicId === '' ) {
				return;
			}
			grid.appendChild(
				buildPaletteBulkCell( shell, publicId, label, initialHex )
			);
		} );

		shell.body.appendChild( grid );
	}

	function buildPaletteBulkCell( shell, publicId, label, initialHex ) {
		const s = strings();
		const cell = document.createElement( 'div' );
		cell.className = 'dbvc-ve-palette-bulk-popover__cell';
		cell.setAttribute( 'role', 'listitem' );
		cell.setAttribute( 'data-public-id', publicId );

		const swatchWrap = document.createElement( 'label' );
		swatchWrap.className = 'dbvc-ve-palette-bulk-popover__swatch-wrap';

		const swatch = document.createElement( 'span' );
		swatch.className = 'dbvc-ve-palette-bulk-popover__swatch';
		swatch.setAttribute( 'aria-hidden', 'true' );
		if ( initialHex !== '' ) {
			swatch.style.backgroundColor = initialHex;
		} else {
			swatch.classList.add( 'is-empty' );
		}
		swatchWrap.appendChild( swatch );

		const input = document.createElement( 'input' );
		input.type = 'color';
		input.className = 'dbvc-ve-palette-bulk-popover__input';
		input.value = initialHex !== '' ? initialHex : '#000000';
		const editTemplate =
			s.panelPaletteOverviewCellLabel || 'Edit {label}';
		input.setAttribute(
			'aria-label',
			editTemplate.replace( '{label}', label )
		);
		swatchWrap.appendChild( input );
		cell.appendChild( swatchWrap );

		const meta = document.createElement( 'div' );
		meta.className = 'dbvc-ve-palette-bulk-popover__meta';
		const nameEl = document.createElement( 'div' );
		nameEl.className = 'dbvc-ve-palette-bulk-popover__name';
		nameEl.textContent = label;
		const hexEl = document.createElement( 'code' );
		hexEl.className = 'dbvc-ve-palette-bulk-popover__hex';
		hexEl.textContent = initialHex !== '' ? initialHex : '—';
		meta.appendChild( nameEl );
		meta.appendChild( hexEl );
		cell.appendChild( meta );

		const actions = document.createElement( 'div' );
		actions.className = 'dbvc-ve-palette-bulk-popover__cell-actions';
		const copyButton = document.createElement( 'button' );
		copyButton.type = 'button';
		copyButton.className = 'dbvc-ve-palette-bulk-popover__copy';
		copyButton.textContent = s.panelPaletteBulkCopyHex || 'Copy hex';
		copyButton.disabled = initialHex === '';
		copyButton.addEventListener( 'click', function () {
			const hex = hexEl.textContent || '';
			if ( hex && hex !== '—' ) {
				copyToClipboard( hex, shell.statusEl );
			}
		} );
		actions.appendChild( copyButton );

		const statusEl = document.createElement( 'span' );
		statusEl.className = 'dbvc-ve-palette-bulk-popover__cell-status';
		statusEl.setAttribute( 'role', 'status' );
		statusEl.setAttribute( 'aria-live', 'polite' );
		actions.appendChild( statusEl );

		cell.appendChild( actions );

		let debounceTimer = 0;
		function handleChange() {
			const newHex = input.value;
			if ( debounceTimer ) {
				window.clearTimeout( debounceTimer );
			}
			debounceTimer = window.setTimeout( function () {
				debounceTimer = 0;
				saveBulkCell(
					shell,
					publicId,
					newHex,
					cell,
					swatch,
					hexEl,
					copyButton,
					statusEl
				);
			}, 250 );
		}
		input.addEventListener( 'input', handleChange );
		input.addEventListener( 'change', handleChange );

		return cell;
	}

	function saveBulkCell(
		shell,
		publicId,
		hex,
		cell,
		swatch,
		hexEl,
		copyButton,
		statusEl
	) {
		const s = strings();
		setBulkCellState( cell, statusEl, 'saving', s );
		const cached = shell.descriptorCache[ publicId ];
		const openPromise = cached
			? Promise.resolve( { token: cached.token } )
			: openLeafDescriptorForBulk( publicId );
		openPromise
			.then( function ( openResult ) {
				if ( ! openResult || ! openResult.token ) {
					throw new Error( 'open failed' );
				}
				if ( ! cached ) {
					shell.descriptorCache[ publicId ] = openResult;
				}
				return window.DBVCVisualEditorApi.save(
					getSessionId(),
					openResult.token,
					hex,
					true
				);
			} )
			.then( function () {
				swatch.style.backgroundColor = hex;
				swatch.classList.remove( 'is-empty' );
				hexEl.textContent = hex;
				copyButton.disabled = false;
				setBulkCellState( cell, statusEl, 'saved', s );
				window.setTimeout( function () {
					if ( cell.dataset.state === 'saved' ) {
						setBulkCellState( cell, statusEl, 'idle', s );
					}
				}, 1500 );
			} )
			.catch( function () {
				setBulkCellState( cell, statusEl, 'error', s );
			} );
	}

	function openLeafDescriptorForBulk( publicId ) {
		const openUrl =
			DBVCVisualEditorBootstrap.restBase +
			'/session/' +
			encodeURIComponent( getSessionId() ) +
			'/control-center/open';
		return window
			.fetch( openUrl, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'X-WP-Nonce': DBVCVisualEditorBootstrap.nonce,
				},
				body: JSON.stringify( { publicId: publicId } ),
			} )
			.then( function ( response ) {
				return response
					.json()
					.catch( function () {
						return null;
					} )
					.then( function ( payload ) {
						if (
							! response.ok ||
							! payload ||
							payload.ok !== true ||
							! payload.descriptors
						) {
							return null;
						}
						const tokens = Object.keys( payload.descriptors );
						if ( tokens.length === 0 ) {
							return null;
						}
						return { token: tokens[ 0 ] };
					} );
			} );
	}

	function setBulkCellState( cell, statusEl, state, sBag ) {
		cell.dataset.state = state;
		switch ( state ) {
			case 'saving':
				statusEl.textContent =
					sBag.panelPaletteOverviewCellSaving || 'Saving…';
				break;
			case 'saved':
				statusEl.textContent =
					sBag.panelPaletteOverviewCellSaved || 'Saved';
				break;
			case 'error':
				statusEl.textContent =
					sBag.panelPaletteOverviewCellError || 'Save failed';
				break;
			default:
				statusEl.textContent = '';
		}
	}

	function copyToClipboard( text, statusEl ) {
		const s = strings();
		if (
			navigator &&
			navigator.clipboard &&
			typeof navigator.clipboard.writeText === 'function'
		) {
			navigator.clipboard
				.writeText( text )
				.then( function () {
					showBulkStatus(
						statusEl,
						s.panelPaletteBulkCopied || 'Copied to clipboard.'
					);
				} )
				.catch( function () {
					showBulkStatus(
						statusEl,
						s.panelPaletteBulkCopyFailed ||
							'Could not copy to clipboard.'
					);
				} );
			return;
		}
		// Fallback for browsers without navigator.clipboard — a hidden
		// textarea + execCommand('copy'). Older Safari, older Firefox.
		try {
			const ta = document.createElement( 'textarea' );
			ta.value = text;
			ta.setAttribute( 'aria-hidden', 'true' );
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			document.body.appendChild( ta );
			ta.select();
			document.execCommand( 'copy' );
			document.body.removeChild( ta );
			showBulkStatus(
				statusEl,
				s.panelPaletteBulkCopied || 'Copied to clipboard.'
			);
		} catch ( err ) {
			showBulkStatus(
				statusEl,
				s.panelPaletteBulkCopyFailed || 'Could not copy to clipboard.'
			);
		}
	}

	function showBulkStatus( statusEl, message ) {
		if ( ! statusEl ) {
			return;
		}
		statusEl.textContent = message;
		window.setTimeout( function () {
			if ( statusEl.textContent === message ) {
				statusEl.textContent = '';
			}
		}, 2000 );
	}

	function coerceBooleanValue( value ) {
		if ( value === true || value === 1 || value === '1' ) {
			return true;
		}
		if ( value === false || value === 0 || value === '0' ) {
			return false;
		}
		if ( typeof value === 'string' ) {
			const lower = value.trim().toLowerCase();
			if ( lower === 'true' || lower === 'on' || lower === 'yes' ) {
				return true;
			}
		}
		return Boolean( value );
	}

	function createTextareaController( value ) {
		const field = document.createElement( 'textarea' );

		field.id = 'dbvc-ve-panel-input';
		field.className = 'dbvc-ve-panel__input';
		field.rows = 8;
		field.value =
			value === null || typeof value === 'undefined'
				? ''
				: String( value );

		return {
			element: field,
			getValue() {
				return field.value;
			},
			setValue( nextValue ) {
				field.value =
					nextValue === null || typeof nextValue === 'undefined'
						? ''
						: String( nextValue );
			},
			focus() {
				field.focus();
			},
			setDisabled( disabled ) {
				field.disabled = Boolean( disabled );
			},
		};
	}

	function createToolbarButton( label, handler ) {
		const button = document.createElement( 'button' );

		button.type = 'button';
		button.className = 'dbvc-ve-panel__toolbar-button';
		button.textContent = label;
		button.addEventListener( 'mousedown', function ( event ) {
			event.preventDefault();
		} );
		button.addEventListener( 'click', handler );

		return button;
	}

	function supportsWpEditor() {
		return Boolean(
			window.DBVCVisualEditorBootstrap &&
				window.DBVCVisualEditorBootstrap.supportsWpEditor &&
				window.wp &&
				window.wp.editor &&
				typeof window.wp.editor.initialize === 'function' &&
				typeof window.wp.editor.remove === 'function'
		);
	}

	function getTinyMceEditor( editorId ) {
		return window.tinymce && typeof window.tinymce.get === 'function'
			? window.tinymce.get( editorId )
			: null;
	}

	function createFallbackRichTextController( value ) {
		const wrapper = document.createElement( 'div' );
		const toolbar = document.createElement( 'div' );
		const editor = document.createElement( 'div' );
		const toolbarButtons = [];

		wrapper.className = 'dbvc-ve-panel__stack';
		toolbar.className = 'dbvc-ve-panel__toolbar';
		editor.id = 'dbvc-ve-panel-input';
		editor.className = 'dbvc-ve-panel__richtext';
		editor.contentEditable = 'true';
		editor.innerHTML = typeof value === 'string' ? value : '';

		[
			{ label: strings().panelRichTextBold || 'Bold', command: 'bold' },
			{
				label: strings().panelRichTextItalic || 'Italic',
				command: 'italic',
			},
			{
				label: strings().panelRichTextParagraph || 'Paragraph',
				command: 'formatBlock',
				argument: 'p',
			},
			{
				label: strings().panelRichTextBullets || 'Bullets',
				command: 'insertUnorderedList',
			},
			{
				label: strings().panelRichTextNumbers || 'Numbers',
				command: 'insertOrderedList',
			},
		].forEach( function ( item ) {
			const button = createToolbarButton( item.label, function () {
				editor.focus();
				if ( item.command === 'formatBlock' ) {
					document.execCommand( item.command, false, item.argument );
					return;
				}

				document.execCommand( item.command, false, null );
			} );

			toolbarButtons.push( button );
			toolbar.appendChild( button );
		} );

		wrapper.appendChild( toolbar );
		wrapper.appendChild( editor );

		return {
			element: wrapper,
			mount() {},
			getValue() {
				return editor.innerHTML;
			},
			setValue( nextValue ) {
				editor.innerHTML =
					typeof nextValue === 'string' ? nextValue : '';
			},
			focus() {
				editor.focus();
			},
			setDisabled( disabled ) {
				const isDisabled = Boolean( disabled );

				editor.contentEditable = isDisabled ? 'false' : 'true';
				toolbarButtons.forEach( function ( button ) {
					button.disabled = isDisabled;
				} );
			},
			destroy() {},
		};
	}

	function createWordPressRichTextController( value ) {
		const wrapper = document.createElement( 'div' );
		const textarea = document.createElement( 'textarea' );
		const editorId = 'dbvc-ve-panel-input';
		let initialized = false;
		let disabled = false;

		wrapper.className = 'dbvc-ve-panel__wysiwyg-host';
		textarea.id = editorId;
		textarea.className =
			'dbvc-ve-panel__input dbvc-ve-panel__wysiwyg-textarea';
		textarea.value = typeof value === 'string' ? value : '';
		wrapper.appendChild( textarea );

		function syncState() {
			const editor = getTinyMceEditor( editorId );

			textarea.disabled = disabled;
			wrapper.classList.toggle( 'is-disabled', disabled );

			if ( editor && typeof editor.setMode === 'function' ) {
				editor.setMode( disabled ? 'readonly' : 'design' );
			}
		}

		return {
			element: wrapper,
			mount() {
				if ( initialized ) {
					syncState();
					return;
				}

				try {
					window.wp.editor.remove( editorId );
				} catch ( error ) {}

				window.wp.editor.initialize( editorId, {
					tinymce: {
						wpautop: true,
						resize: true,
						height: 260,
					},
					quicktags: true,
					mediaButtons: false,
				} );

				initialized = true;
				syncState();
			},
			getValue() {
				const editor = getTinyMceEditor( editorId );

				if ( editor && typeof editor.save === 'function' ) {
					editor.save();
				}

				return textarea.value;
			},
			setValue( nextValue ) {
				const normalized =
					typeof nextValue === 'string' ? nextValue : '';
				const editor = getTinyMceEditor( editorId );

				textarea.value = normalized;

				if ( editor && typeof editor.setContent === 'function' ) {
					editor.setContent( normalized );
				}
			},
			focus() {
				window.setTimeout( function () {
					const editor = getTinyMceEditor( editorId );

					if (
						editor &&
						typeof editor.isHidden === 'function' &&
						! editor.isHidden()
					) {
						editor.focus();
						return;
					}

					textarea.focus();
				}, 0 );
			},
			setDisabled( nextDisabled ) {
				disabled = Boolean( nextDisabled );
				syncState();
			},
			destroy() {
				if ( ! initialized ) {
					return;
				}

				const editor = getTinyMceEditor( editorId );

				if ( editor && typeof editor.save === 'function' ) {
					editor.save();
				}

				window.wp.editor.remove( editorId );
				initialized = false;
			},
		};
	}

	function createRichTextController( value ) {
		if ( supportsWpEditor() ) {
			return createWordPressRichTextController( value );
		}

		return createFallbackRichTextController( value );
	}

	function createNoopLifecycle( controller ) {
		return Object.assign(
			{
				mount() {},
				destroy() {},
			},
			controller
		);
	}

	function createCheckboxGroupController( value, descriptor ) {
		const controller = createCheckboxGroupControllerBase(
			value,
			descriptor
		);

		return createNoopLifecycle( controller );
	}

	function createCheckboxGroupControllerBase( value, descriptor ) {
		const wrapper = document.createElement( 'div' );
		const options = Array.isArray( descriptor.ui && descriptor.ui.options )
			? descriptor.ui.options
			: [];
		const selectedValues = new Set(
			Array.isArray( value ) ? value.map( String ) : []
		);
		const inputs = [];

		wrapper.className = 'dbvc-ve-panel__option-list';

		if ( ! options.length ) {
			wrapper.innerHTML = `<div class="dbvc-ve-panel__placeholder">${
				strings().panelNoOptions ||
				'No choices were available for this field.'
			}</div>`;

			return {
				element: wrapper,
				getValue() {
					return [];
				},
				setValue() {},
				focus() {},
				setDisabled() {},
			};
		}

		options.forEach( function ( option, index ) {
			const label = document.createElement( 'label' );
			const input = document.createElement( 'input' );
			const text = document.createElement( 'span' );
			const optionValue =
				option && typeof option.value !== 'undefined'
					? String( option.value )
					: '';

			label.className = 'dbvc-ve-panel__option';
			input.type = 'checkbox';
			input.value = optionValue;
			input.checked = selectedValues.has( optionValue );
			input.id = `dbvc-ve-panel-input-${ index }`;
			text.textContent =
				option && option.label ? String( option.label ) : optionValue;

			label.appendChild( input );
			label.appendChild( text );
			wrapper.appendChild( label );
			inputs.push( input );
		} );

		return {
			element: wrapper,
			getValue() {
				return inputs
					.filter( function ( input ) {
						return input.checked;
					} )
					.map( function ( input ) {
						return input.value;
					} );
			},
			setValue( nextValue ) {
				const nextValues = new Set(
					Array.isArray( nextValue ) ? nextValue.map( String ) : []
				);

				inputs.forEach( function ( input ) {
					input.checked = nextValues.has( input.value );
				} );
			},
			focus() {
				if ( inputs[ 0 ] ) {
					inputs[ 0 ].focus();
				}
			},
			setDisabled( disabled ) {
				const isDisabled = Boolean( disabled );

				inputs.forEach( function ( input ) {
					input.disabled = isDisabled;
				} );
			},
		};
	}

	function createSelectController( value, descriptor ) {
		const select = document.createElement( 'select' );
		const options = Array.isArray( descriptor.ui && descriptor.ui.options )
			? descriptor.ui.options
			: [];

		select.id = 'dbvc-ve-panel-input';
		select.className = 'dbvc-ve-panel__input dbvc-ve-panel__select';

		options.forEach( function ( option ) {
			const item = document.createElement( 'option' );
			const optionValue =
				option && typeof option.value !== 'undefined'
					? String( option.value )
					: '';

			item.value = optionValue;
			item.textContent =
				option && option.label ? String( option.label ) : optionValue;
			item.selected = optionValue === String( value || '' );
			select.appendChild( item );
		} );

		return createNoopLifecycle( {
			element: select,
			getValue() {
				return select.value;
			},
			setValue( nextValue ) {
				select.value =
					nextValue === null || typeof nextValue === 'undefined'
						? ''
						: String( nextValue );
			},
			focus() {
				select.focus();
			},
			setDisabled( disabled ) {
				select.disabled = Boolean( disabled );
			},
		} );
	}

	function createLinkController( value ) {
		const wrapper = document.createElement( 'div' );
		const urlField = document.createElement( 'input' );
		const titleField = document.createElement( 'input' );
		const targetField = document.createElement( 'select' );
		const fields = [ urlField, titleField, targetField ];
		const normalized = value && typeof value === 'object' ? value : {};

		wrapper.className = 'dbvc-ve-panel__stack';

		urlField.className = 'dbvc-ve-panel__input';
		urlField.type = 'url';
		urlField.placeholder = strings().panelLinkUrl || 'Link URL';
		urlField.value = normalized.url ? String( normalized.url ) : '';

		titleField.className = 'dbvc-ve-panel__input';
		titleField.type = 'text';
		titleField.placeholder = strings().panelLinkTitle || 'Link title';
		titleField.value = normalized.title ? String( normalized.title ) : '';

		targetField.className = 'dbvc-ve-panel__input dbvc-ve-panel__select';
		[
			{
				value: '',
				label: strings().panelLinkSameTab || 'Open in same tab',
			},
			{
				value: '_blank',
				label: strings().panelLinkNewTab || 'Open in new tab',
			},
		].forEach( function ( item ) {
			const option = document.createElement( 'option' );

			option.value = item.value;
			option.textContent = item.label;
			option.selected = item.value === String( normalized.target || '' );
			targetField.appendChild( option );
		} );

		wrapper.appendChild( urlField );
		wrapper.appendChild( titleField );
		wrapper.appendChild( targetField );

		return createNoopLifecycle( {
			element: wrapper,
			getValue() {
				return {
					url: urlField.value,
					title: titleField.value,
					target: targetField.value,
				};
			},
			setValue( nextValue ) {
				const next =
					nextValue && typeof nextValue === 'object' ? nextValue : {};

				urlField.value = next.url ? String( next.url ) : '';
				titleField.value = next.title ? String( next.title ) : '';
				targetField.value = next.target ? String( next.target ) : '';
			},
			focus() {
				urlField.focus();
			},
			setDisabled( disabled ) {
				const isDisabled = Boolean( disabled );

				fields.forEach( function ( field ) {
					field.disabled = isDisabled;
				} );
			},
		} );
	}

	function createReadonlyPreviewController( value ) {
		const preview = document.createElement( 'pre' );

		preview.id = 'dbvc-ve-panel-input';
		preview.className = 'dbvc-ve-panel__preview';

		if ( typeof value === 'string' ) {
			preview.textContent = value;
		} else if ( value === null || typeof value === 'undefined' ) {
			preview.textContent = '';
		} else if ( typeof value === 'object' ) {
			try {
				preview.textContent = JSON.stringify( value, null, 2 );
			} catch ( error ) {
				preview.textContent = String( value );
			}
		} else {
			preview.textContent = String( value );
		}

		return createNoopLifecycle( {
			element: preview,
			getValue() {
				return value;
			},
			setValue( nextValue ) {
				if ( typeof nextValue === 'string' ) {
					preview.textContent = nextValue;
					return;
				}

				if ( nextValue === null || typeof nextValue === 'undefined' ) {
					preview.textContent = '';
					return;
				}

				if ( typeof nextValue === 'object' ) {
					try {
						preview.textContent = JSON.stringify(
							nextValue,
							null,
							2
						);
						return;
					} catch ( error ) {}
				}

				preview.textContent = String( nextValue );
			},
			focus() {
				preview.scrollIntoView( { block: 'nearest' } );
			},
			setDisabled() {},
		} );
	}

	function formatCompositeChildSource( child ) {
		const summary =
			child &&
			child.sourceSummary &&
			typeof child.sourceSummary === 'object'
				? child.sourceSummary
				: {};
		const entity =
			child &&
			child.entitySummary &&
			typeof child.entitySummary === 'object'
				? child.entitySummary
				: {};
		const parts = [];

		if ( child && child.status ) {
			parts.push( String( child.status ) );
		}

		if ( child && child.scope ) {
			parts.push( String( child.scope ).replace( /_/g, ' ' ) );
		}

		if ( entity.typeLabel || entity.title ) {
			parts.push(
				[ entity.typeLabel, entity.title ]
					.filter( Boolean )
					.join( ': ' )
			);
		}

		if ( summary.summary ) {
			parts.push( String( summary.summary ) );
		} else if ( summary.fieldName ) {
			parts.push( String( summary.fieldName ) );
		}

		return parts.filter( Boolean ).join( ' / ' );
	}

	function formatCompositeReadinessMeta( readiness ) {
		if ( ! readiness || typeof readiness !== 'object' ) {
			return '';
		}

		const dynamicCount = Number( readiness.dynamicCount || 0 ) || 0;
		const readyCount = Number( readiness.readyChildCount || 0 ) || 0;
		const blockedCount = Number( readiness.blockedChildCount || 0 ) || 0;
		const ownerGroups = Array.isArray( readiness.ownerGroups )
			? readiness.ownerGroups
			: [];
		const ackTypes = Array.isArray( readiness.requiresAcknowledgementTypes )
			? readiness.requiresAcknowledgementTypes
					.map( function ( type ) {
						return String( type ).replace( /_/g, ' ' );
					} )
					.filter( Boolean )
			: [];
		const parts = [];

		parts.push(
			`${
				strings().panelCompositeReadyFields || 'Ready fields'
			}: ${ readyCount }/${ dynamicCount }`
		);

		if ( blockedCount > 0 ) {
			parts.push(
				`${
					strings().panelCompositeBlockedFields || 'Blocked'
				}: ${ blockedCount }`
			);
		}

		if ( ownerGroups.length > 0 ) {
			parts.push(
				`${ strings().panelCompositeOwners || 'Owners' }: ${
					ownerGroups.length
				}`
			);
		}

		if ( ackTypes.length > 0 ) {
			parts.push(
				`${
					strings().panelCompositeAcknowledgements ||
					'Acknowledgements'
				}: ${ ackTypes.join( ', ' ) }`
			);
		}

		return parts.join( ' · ' );
	}

	function isCompositeBatchSaveReady( result ) {
		const composite =
			result &&
			result.compositeText &&
			typeof result.compositeText === 'object'
				? result.compositeText
				: null;
		const readiness =
			composite &&
			composite.saveReadiness &&
			typeof composite.saveReadiness === 'object'
				? composite.saveReadiness
				: null;

		return Boolean( readiness && readiness.canBatchSave );
	}

	function isActiveCompositeBatchSave() {
		return Boolean(
			state.activeDescriptor &&
				state.activeDescriptor.ui &&
				state.activeDescriptor.ui.input === 'composite_text' &&
				state.activeController &&
				state.activeController.canBatchSave
		);
	}

	function getCompositeAcknowledgementTypes( result ) {
		const composite =
			result &&
			result.compositeText &&
			typeof result.compositeText === 'object'
				? result.compositeText
				: null;
		const readiness =
			composite &&
			composite.saveReadiness &&
			typeof composite.saveReadiness === 'object'
				? composite.saveReadiness
				: null;
		const types =
			readiness && Array.isArray( readiness.requiresAcknowledgementTypes )
				? readiness.requiresAcknowledgementTypes
				: [];

		return types
			.map( function ( type ) {
				return String( type || '' ).trim();
			} )
			.filter( Boolean );
	}

	function resolveCompositeAcknowledgementType( types ) {
		if ( types.includes( 'related' ) ) {
			return 'related';
		}

		if ( types.includes( 'shared' ) ) {
			return 'shared';
		}

		return 'none';
	}

	function normalizeCompositeHtmlToText( html ) {
		const wrapper = document.createElement( 'div' );

		wrapper.innerHTML = String( html || '' ).replace(
			/<br\s*\/?>/gi,
			'\n'
		);

		return ( wrapper.textContent || '' ).trim();
	}

	function buildCompositeHtmlFromSegments( segments, valuesByIndex ) {
		const sourceSegments = Array.isArray( segments ) ? segments : [];

		return sourceSegments
			.map( function ( segment ) {
				if ( ! segment || typeof segment !== 'object' ) {
					return '';
				}

				const type = segment.type ? String( segment.type ) : '';
				if ( type === 'literal' ) {
					return typeof segment.text === 'string' ? segment.text : '';
				}

				if ( type === 'dynamic' ) {
					const index = Number( segment.index );
					const value =
						Number.isFinite( index ) &&
						Object.prototype.hasOwnProperty.call(
							valuesByIndex,
							index
						)
							? valuesByIndex[ index ]
							: typeof segment.expression === 'string'
							? segment.expression
							: '';

					return escapeHtml(
						value === null || typeof value === 'undefined'
							? ''
							: String( value )
					);
				}

				return '';
			} )
			.join( '' );
	}

	function buildCompositeValuesByIndex( children, useDisplayValue ) {
		const values = {};

		( Array.isArray( children ) ? children : [] ).forEach(
			function ( child ) {
				if ( ! child || typeof child !== 'object' ) {
					return;
				}

				const index = Number( child.index );
				if ( ! Number.isFinite( index ) ) {
					return;
				}

				if (
					useDisplayValue &&
					Object.prototype.hasOwnProperty.call(
						child,
						'displayValue'
					)
				) {
					values[ index ] = extractDisplayText(
						child.displayValue,
						child.displayMode
					);
					return;
				}

				if (
					Object.prototype.hasOwnProperty.call(
						child,
						'currentValue'
					)
				) {
					values[ index ] = child.currentValue;
					return;
				}

				if ( Object.prototype.hasOwnProperty.call( child, 'value' ) ) {
					values[ index ] = child.value;
				}
			}
		);

		return values;
	}

	function createCompositeChildEditor( child, onChange ) {
		const input = child && child.input ? String( child.input ) : 'text';
		const index =
			child && typeof child.index !== 'undefined'
				? String( child.index )
				: String( Date.now() );
		const initialValue =
			child &&
			Object.prototype.hasOwnProperty.call( child, 'currentValue' )
				? child.currentValue
				: '';
		let field;

		if ( input === 'select' ) {
			const descriptor =
				child &&
				child.descriptor &&
				typeof child.descriptor === 'object'
					? child.descriptor
					: {};
			const options = Array.isArray(
				descriptor.ui && descriptor.ui.options
			)
				? descriptor.ui.options
				: [];
			const initialString =
				initialValue === null || typeof initialValue === 'undefined'
					? ''
					: String( initialValue );
			let matchedInitialOption = false;

			field = document.createElement( 'select' );
			field.className =
				'dbvc-ve-panel__input dbvc-ve-panel__select dbvc-ve-panel__composite-input';

			options.forEach( function ( option ) {
				const item = document.createElement( 'option' );
				const optionValue =
					option && typeof option.value !== 'undefined'
						? String( option.value )
						: '';

				item.value = optionValue;
				item.textContent =
					option && option.label
						? String( option.label )
						: optionValue;
				item.selected = optionValue === initialString;
				matchedInitialOption = matchedInitialOption || item.selected;
				field.appendChild( item );
			} );

			if ( ! matchedInitialOption ) {
				const current = document.createElement( 'option' );

				current.value = initialString;
				current.textContent =
					initialString || strings().panelEmptyValue || 'Empty value';
				current.selected = true;
				field.insertBefore( current, field.firstChild );
			}
		} else if ( input === 'textarea' || input === 'text' ) {
			field = document.createElement( 'textarea' );
			field.className =
				'dbvc-ve-panel__input dbvc-ve-panel__input--textlike dbvc-ve-panel__composite-input';
			field.rows = input === 'textarea' ? 4 : 2;
			field.value =
				initialValue === null || typeof initialValue === 'undefined'
					? ''
					: String( initialValue );
			syncTextareaAutoHeight( field );
			field.addEventListener( 'input', function () {
				syncTextareaAutoHeight( field );
			} );
		} else {
			field = document.createElement( 'input' );
			field.className =
				'dbvc-ve-panel__input dbvc-ve-panel__composite-input';
			field.type = [ 'number', 'url', 'email' ].includes( input )
				? input
				: 'text';
			field.value =
				initialValue === null || typeof initialValue === 'undefined'
					? ''
					: String( initialValue );
		}

		field.id = `dbvc-ve-composite-child-${ index }`;
		field.addEventListener( 'input', onChange );
		field.addEventListener( 'change', onChange );

		return {
			element: field,
			getValue() {
				return field.value;
			},
			getPreviewValue() {
				if ( field.tagName === 'SELECT' ) {
					const selected = field.options[ field.selectedIndex ];

					return selected ? selected.textContent : field.value;
				}

				return field.value;
			},
			setValue( nextValue ) {
				field.value =
					nextValue === null || typeof nextValue === 'undefined'
						? ''
						: String( nextValue );
				if ( field.tagName === 'TEXTAREA' ) {
					syncTextareaAutoHeight( field );
				}
			},
			focus() {
				field.focus();
				if ( typeof field.select === 'function' ) {
					field.select();
				}
			},
			setDisabled( disabled ) {
				field.disabled = Boolean( disabled );
			},
		};
	}

	function createCompositeTextController( value, descriptor, result ) {
		const wrapper = document.createElement( 'div' );
		const previewBlock = document.createElement( 'div' );
		const previewLabel = document.createElement( 'div' );
		const preview = document.createElement( 'pre' );
		const templateBlock = document.createElement( 'details' );
		const templateSummary = document.createElement( 'summary' );
		const templateBody = document.createElement( 'pre' );
		const list = document.createElement( 'div' );
		const composite =
			result &&
			result.compositeText &&
			typeof result.compositeText === 'object'
				? result.compositeText
				: {};
		const children = Array.isArray( composite.children )
			? composite.children
			: [];
		const previewText =
			typeof composite.previewText === 'string'
				? composite.previewText
				: typeof value === 'string'
				? value
				: '';
		const template =
			typeof composite.template === 'string'
				? composite.template
				: descriptor &&
				  descriptor.source &&
				  typeof descriptor.source.template === 'string'
				? descriptor.source.template
				: '';
		const unsupportedChildCount =
			Number( composite.unsupportedChildCount || 0 ) || 0;
		const readiness =
			composite.saveReadiness &&
			typeof composite.saveReadiness === 'object'
				? composite.saveReadiness
				: null;
		const canBatchSave = Boolean( readiness && readiness.canBatchSave );
		const childControllers = {};
		const baseValuesByIndex = buildCompositeValuesByIndex(
			children,
			false
		);
		let firstEditableController = null;

		function buildCurrentValuesByIndex( usePreviewValues ) {
			const values = buildCompositeValuesByIndex( children, true );

			Object.keys( childControllers ).forEach( function ( index ) {
				values[ index ] =
					usePreviewValues &&
					typeof childControllers[ index ].getPreviewValue ===
						'function'
						? childControllers[ index ].getPreviewValue()
						: childControllers[ index ].getValue();
			} );

			return values;
		}

		function refreshPreview() {
			const html = buildCompositeHtmlFromSegments(
				composite.segments,
				buildCurrentValuesByIndex( true )
			);

			preview.textContent = normalizeCompositeHtmlToText( html );
		}

		wrapper.className = 'dbvc-ve-panel__composite';
		previewBlock.className = 'dbvc-ve-panel__composite-preview';
		previewLabel.className = 'dbvc-ve-panel__composite-label';
		previewLabel.textContent =
			strings().panelCompositePreview || 'Reconstructed preview';
		preview.className =
			'dbvc-ve-panel__preview dbvc-ve-panel__composite-preview-text';
		preview.textContent = previewText;
		previewBlock.appendChild( previewLabel );
		previewBlock.appendChild( preview );
		wrapper.appendChild( previewBlock );

		templateBlock.className = 'dbvc-ve-panel__composite-template';
		templateSummary.className = 'dbvc-ve-panel__meta-summary';
		templateSummary.textContent =
			strings().panelCompositeTemplate || 'Original Bricks template';
		templateBody.className =
			'dbvc-ve-panel__preview dbvc-ve-panel__composite-template-text';
		templateBody.textContent = template;
		templateBlock.appendChild( templateSummary );
		templateBlock.appendChild( templateBody );
		wrapper.appendChild( templateBlock );

		if ( unsupportedChildCount > 0 ) {
			const note = document.createElement( 'div' );

			note.className = 'dbvc-ve-panel__composite-note';
			note.textContent =
				strings().panelCompositePartial ||
				'Some dynamic tags in this Bricks text template are locked because Visual Editor cannot resolve them to safe field contracts yet.';
			wrapper.appendChild( note );
		}

		if ( readiness ) {
			const readinessBlock = document.createElement( 'div' );
			const readinessTitle = document.createElement( 'div' );
			const readinessDetail = document.createElement( 'div' );
			const readinessMeta = document.createElement( 'div' );
			const blockers = Array.isArray( readiness.blockers )
				? readiness.blockers.filter( Boolean )
				: [];

			readinessBlock.className = 'dbvc-ve-panel__composite-readiness';
			readinessBlock.dataset.status = readiness.canBatchSave
				? 'ready'
				: readiness.childContractsReady
				? 'pending'
				: 'blocked';
			readinessTitle.className =
				'dbvc-ve-panel__composite-readiness-title';
			readinessDetail.className =
				'dbvc-ve-panel__composite-readiness-detail';
			readinessMeta.className = 'dbvc-ve-panel__composite-readiness-meta';
			readinessTitle.textContent =
				strings().panelCompositeReadiness || 'Batch save preflight';
			readinessDetail.textContent = readiness.message
				? String( readiness.message )
				: strings().panelCompositeBatchDisabled ||
				  'Composite batch save is not enabled yet.';
			readinessMeta.textContent =
				formatCompositeReadinessMeta( readiness );
			readinessBlock.appendChild( readinessTitle );
			readinessBlock.appendChild( readinessDetail );
			if ( readinessMeta.textContent ) {
				readinessBlock.appendChild( readinessMeta );
			}
			if ( blockers.length ) {
				const blockerList = document.createElement( 'ul' );

				blockerList.className =
					'dbvc-ve-panel__composite-readiness-list';
				blockers.slice( 0, 4 ).forEach( function ( reason ) {
					const item = document.createElement( 'li' );

					item.textContent = String( reason );
					blockerList.appendChild( item );
				} );
				readinessBlock.appendChild( blockerList );
			}
			wrapper.appendChild( readinessBlock );
		}

		list.className = 'dbvc-ve-panel__composite-list';

		if ( ! children.length ) {
			const empty = document.createElement( 'div' );

			empty.className = 'dbvc-ve-panel__placeholder';
			empty.textContent =
				strings().panelCompositeEmpty ||
				'No child dynamic fields were resolved for this mixed text element.';
			list.appendChild( empty );
		}

		children.forEach( function ( child ) {
			const row = document.createElement( 'div' );
			const header = document.createElement( 'div' );
			const title = document.createElement( 'div' );
			const expression = document.createElement( 'code' );
			const badge = document.createElement( 'span' );
			const valueNode = document.createElement( 'pre' );
			const meta = document.createElement( 'div' );
			const warning = document.createElement( 'div' );
			const displayText = extractDisplayText(
				child && child.displayValue,
				child && child.displayMode
			);
			const label =
				child && child.label
					? String( child.label )
					: strings().fieldIndexFieldFallback || 'Field';
			const sourceMeta = formatCompositeChildSource( child );
			const status =
				child && child.status ? String( child.status ) : 'unsupported';
			const warningText =
				child && child.warning
					? String( child.warning )
					: child && child.blockReason
					? String( child.blockReason )
					: '';

			row.className = 'dbvc-ve-panel__composite-child';
			row.dataset.status = status;
			header.className = 'dbvc-ve-panel__composite-child-header';
			title.className = 'dbvc-ve-panel__composite-child-title';
			expression.className = 'dbvc-ve-panel__composite-expression';
			badge.className = 'dbvc-ve-panel__composite-child-badge';
			valueNode.className = 'dbvc-ve-panel__composite-child-value';
			meta.className = 'dbvc-ve-panel__composite-child-meta';
			warning.className = 'dbvc-ve-panel__composite-child-warning';

			title.textContent = label;
			expression.textContent =
				child && child.expression ? String( child.expression ) : '';
			badge.textContent =
				child && ( child.saveReady || child.canEdit )
					? strings().panelCompositeChildReady ||
					  'Save contract ready'
					: status === 'readonly'
					? strings().panelInspectOnly || 'Inspect only'
					: strings().panelLocked || 'Locked';
			valueNode.textContent = displayText || '';
			meta.textContent = sourceMeta;
			warning.textContent = warningText;

			header.appendChild( title );
			header.appendChild( badge );
			row.appendChild( header );
			if ( expression.textContent ) {
				row.appendChild( expression );
			}
			if ( canBatchSave && child && child.saveReady ) {
				const childController = createCompositeChildEditor(
					child,
					refreshPreview
				);
				const childIndex = String( child.index );

				childControllers[ childIndex ] = childController;
				if ( ! firstEditableController ) {
					firstEditableController = childController;
				}
				row.appendChild( childController.element );
			} else {
				row.appendChild( valueNode );
			}
			if ( meta.textContent ) {
				row.appendChild( meta );
			}
			if ( warning.textContent ) {
				row.appendChild( warning );
			}
			list.appendChild( row );
		} );

		wrapper.appendChild( list );

		return createNoopLifecycle( {
			element: wrapper,
			canBatchSave,
			getAcknowledgementTypes() {
				return readiness &&
					Array.isArray( readiness.requiresAcknowledgementTypes )
					? readiness.requiresAcknowledgementTypes
					: [];
			},
			getValue() {
				return Object.keys( childControllers ).map( function ( index ) {
					return {
						index: Number( index ),
						value: childControllers[ index ].getValue(),
					};
				} );
			},
			getBaseValues() {
				return Object.keys( childControllers ).map( function ( index ) {
					return {
						index: Number( index ),
						value: Object.prototype.hasOwnProperty.call(
							baseValuesByIndex,
							index
						)
							? baseValuesByIndex[ index ]
							: '',
					};
				} );
			},
			setValue( nextValue ) {
				const nextChildren =
					nextValue && Array.isArray( nextValue.children )
						? nextValue.children
						: [];
				const nextByIndex = {};

				nextChildren.forEach( function ( child ) {
					if ( ! child || typeof child !== 'object' ) {
						return;
					}

					const index = Number( child.index );
					if ( Number.isFinite( index ) ) {
						nextByIndex[ index ] = child;
					}
				} );

				Object.keys( childControllers ).forEach( function ( index ) {
					const child = nextByIndex[ index ];

					if (
						child &&
						Object.prototype.hasOwnProperty.call( child, 'value' )
					) {
						childControllers[ index ].setValue( child.value );
						baseValuesByIndex[ index ] = child.value;
					}
				} );

				if ( nextChildren.length ) {
					const html = buildCompositeHtmlFromSegments(
						composite.segments,
						buildCompositeValuesByIndex( nextChildren, true )
					);

					preview.textContent = normalizeCompositeHtmlToText( html );
				} else {
					refreshPreview();
				}
			},
			focus() {
				if ( firstEditableController ) {
					firstEditableController.focus();
				} else {
					preview.scrollIntoView( { block: 'nearest' } );
				}
			},
			setDisabled( disabled ) {
				wrapper.classList.toggle( 'is-disabled', Boolean( disabled ) );
				Object.keys( childControllers ).forEach( function ( index ) {
					childControllers[ index ].setDisabled( disabled );
				} );
			},
			buildPatchedHtml( saveResult ) {
				const saveChildren =
					saveResult && Array.isArray( saveResult.children )
						? saveResult.children
						: [];

				return buildCompositeHtmlFromSegments(
					composite.segments,
					buildCompositeValuesByIndex( saveChildren, true )
				);
			},
		} );
	}

	function renderMediaPreviewImage( preview, url, alt ) {
		preview.innerHTML = '';

		if ( ! url ) {
			preview.textContent =
				strings().panelNoMedia || 'No media is currently set.';
			return;
		}

		const image = document.createElement( 'img' );

		image.src = url;
		image.alt = alt || '';
		preview.appendChild( image );
	}

	function createMediaReferenceController( value, descriptor ) {
		const wrapper = document.createElement( 'div' );
		const preview = document.createElement( 'div' );
		const buttonRow = document.createElement( 'div' );
		const chooseButton = document.createElement( 'button' );
		const clearButton = document.createElement( 'button' );
		const urlField = document.createElement( 'input' );
		const meta = document.createElement( 'div' );
		const fields = [ urlField, chooseButton, clearButton ];
		let currentValue = normalizeMediaReferenceValue( value );
		let mediaFrame = null;

		wrapper.className = 'dbvc-ve-panel__stack';
		preview.className = 'dbvc-ve-panel__media-preview';
		buttonRow.className = 'dbvc-ve-panel__toolbar';
		meta.className = 'dbvc-ve-panel__media-meta';
		chooseButton.type = 'button';
		chooseButton.className = 'dbvc-ve-panel__toolbar-button';
		clearButton.type = 'button';
		clearButton.className = 'dbvc-ve-panel__toolbar-button';
		urlField.className = 'dbvc-ve-panel__input';
		urlField.type = 'url';
		urlField.placeholder =
			strings().panelMediaUrl || 'Media Library image URL';

		function render( nextValue ) {
			const normalized = normalizeMediaReferenceValue( nextValue );
			const renderData = resolveMediaReferenceRenderData(
				normalized,
				descriptor
			);
			const previewUrl = renderData.src;
			const fullUrl = renderData.fullUrl;
			const attachmentId = renderData.attachmentId;
			const alt = renderData.alt;

			currentValue = Object.assign( {}, normalized, {
				attachmentId,
				id: attachmentId,
			} );
			urlField.value = fullUrl ? String( fullUrl ) : '';
			chooseButton.textContent = attachmentId
				? strings().panelMediaReplace || 'Replace from Media Library'
				: strings().panelMediaChoose || 'Choose from Media Library';
			clearButton.textContent =
				strings().panelMediaClear || 'Clear image';
			clearButton.disabled = ! attachmentId && ! fullUrl;
			meta.textContent = attachmentId
				? `${
						strings().panelMediaId || 'Attachment ID'
				  }: ${ attachmentId }`
				: strings().panelMediaUrlHint ||
				  'Paste a local Media Library image URL to resolve this field to an attachment ID.';
			renderMediaPreviewImage(
				preview,
				previewUrl ? String( previewUrl ) : '',
				alt ? String( alt ) : ''
			);
		}

		function openMediaFrame() {
			if ( ! supportsWpMedia() ) {
				urlField.focus();
				return;
			}

			if ( ! mediaFrame ) {
				// RK-011 Slice 2: single-active-frame discipline for the overlay image
				// control. The shared factory disposes any prior frame passed as
				// `previousFrame` before minting the new one, so re-opening after a
				// controller `destroy()` (which clears `mediaFrame`) cannot leak the
				// previous listeners.
				const mediaFrameFactory = window.DBVCVisualEditorMediaFrame;
				const created =
					mediaFrameFactory &&
					typeof mediaFrameFactory.createMediaFrame === 'function'
						? mediaFrameFactory.createMediaFrame( {
								mode: 'single',
								title:
									strings().panelMediaFrameTitle ||
									'Select image',
								buttonText:
									strings().panelMediaFrameButton ||
									'Use this image',
						  } )
						: null;
				mediaFrame = created && created.frame ? created.frame : null;
				if ( ! mediaFrame ) {
					urlField.focus();
					return;
				}
				bindMediaFramePrefetchState( mediaFrame );

				mediaFrame.on( 'select', function () {
					const attachment = mediaFrame
						.state()
						.get( 'selection' )
						.first();
					const data = attachment ? attachment.toJSON() : null;

					if ( ! data ) {
						return;
					}

					const mediaSize = getDescriptorMediaSize( descriptor );
					const selectedRenderUrl =
						mediaSize && data.sizes && data.sizes[ mediaSize ]
							? data.sizes[ mediaSize ].url
							: data.url || '';

					render( {
						attachmentId: data.id || 0,
						id: data.id || 0,
						url: data.url || '',
						fullUrl: data.url || '',
						renderUrl: selectedRenderUrl,
						renderAttributes: {
							src: selectedRenderUrl,
							srcset: '',
							sizes: '',
						},
						alt: data.alt || '',
						title: data.title || '',
					} );
				} );
			}

			mediaFrame.open();
		}

		render( value );

		chooseButton.addEventListener( 'click', function () {
			openMediaFrame();
		} );
		clearButton.addEventListener( 'click', function () {
			render( {
				attachmentId: 0,
				id: 0,
				url: '',
				fullUrl: '',
				renderUrl: '',
				renderAttributes: {
					src: '',
					srcset: '',
					sizes: '',
				},
				alt: '',
				title: '',
			} );
		} );
		urlField.addEventListener( 'input', function () {
			currentValue.attachmentId = 0;
			currentValue.id = 0;
			currentValue.url = urlField.value;
			currentValue.fullUrl = urlField.value;
			currentValue.renderUrl = urlField.value;
			currentValue.renderAttributes = {
				src: urlField.value,
				srcset: '',
				sizes: '',
			};
			render( currentValue );
		} );

		wrapper.appendChild( preview );
		buttonRow.appendChild( chooseButton );
		buttonRow.appendChild( clearButton );
		wrapper.appendChild( buttonRow );
		wrapper.appendChild( urlField );
		wrapper.appendChild( meta );

		return createNoopLifecycle( {
			element: wrapper,
			getValue() {
				return {
					attachmentId:
						currentValue.attachmentId || currentValue.id || 0,
					url: urlField.value,
				};
			},
			setValue( nextValue ) {
				render( nextValue );
			},
			focus() {
				urlField.focus();
				urlField.select();
			},
			setDisabled( disabled ) {
				const isDisabled = Boolean( disabled );

				fields.forEach( function ( field ) {
					field.disabled = isDisabled;
				} );
			},
			// RK-011 Slice 2: dispose the active wp.media frame on controller teardown
			// (panel close, re-open, or descriptor swap). Prevents the previously-
			// memoized image frame from surviving as an orphan listener.
			destroy() {
				const mediaFrameFactory = window.DBVCVisualEditorMediaFrame;
				if (
					mediaFrame &&
					mediaFrameFactory &&
					typeof mediaFrameFactory.disposeFrame === 'function'
				) {
					mediaFrameFactory.disposeFrame( mediaFrame );
				}
				mediaFrame = null;
			},
		} );
	}

	function reorderGalleryItems( items, fromIndex, toIndex ) {
		const normalized = Array.isArray( items ) ? items : [];
		const from = Number( fromIndex );
		const to = Number( toIndex );

		if (
			! Number.isInteger( from ) ||
			! Number.isInteger( to ) ||
			from === to ||
			from < 0 ||
			to < 0 ||
			from >= normalized.length ||
			to >= normalized.length
		) {
			return null;
		}

		const nextItems = normalized.slice();
		const item = nextItems.splice( from, 1 )[ 0 ];

		nextItems.splice( to, 0, item );

		return nextItems;
	}

	function renderGalleryPreviewItems( grid, meta, items, options ) {
		const normalized = Array.isArray( items ) ? items : [];
		const controls = options && typeof options === 'object' ? options : {};
		const editable = Boolean( controls.editable );
		const disabled = Boolean( controls.disabled );
		const draggable =
			editable &&
			! disabled &&
			normalized.length > 1 &&
			typeof controls.onReorder === 'function';
		let draggedIndex = null;

		grid.innerHTML = '';
		meta.textContent =
			normalized.length === 1
				? strings().panelGallerySingle || '1 gallery image'
				: `${ normalized.length } ${
						strings().panelGalleryCount || 'gallery images'
				  }`;

		if ( ! normalized.length ) {
			grid.innerHTML = `<div class="dbvc-ve-panel__placeholder">${
				strings().panelNoMedia || 'No media is currently set.'
			}</div>`;
			return;
		}

		normalized.forEach( function ( item, index ) {
			const url =
				item && ( item.renderUrl || item.url )
					? String( item.renderUrl || item.url )
					: '';

			if ( ! url ) {
				return;
			}

			const figure = document.createElement( 'figure' );
			const image = document.createElement( 'img' );

			figure.className = 'dbvc-ve-panel__gallery-item';
			image.src = url;
			image.alt = item && item.alt ? String( item.alt ) : '';
			image.draggable = false;
			figure.appendChild( image );

			if ( draggable ) {
				figure.draggable = true;
				figure.classList.add( 'is-draggable' );
				figure.title =
					strings().panelGalleryDragToReorder ||
					'Drag to reorder gallery image';
				figure.setAttribute( 'aria-grabbed', 'false' );

				figure.addEventListener( 'dragstart', function ( event ) {
					if (
						event.target &&
						typeof event.target.closest === 'function' &&
						event.target.closest( '.dbvc-ve-panel__gallery-action' )
					) {
						event.preventDefault();
						return;
					}

					draggedIndex = index;
					figure.classList.add( 'is-dragging' );
					figure.setAttribute( 'aria-grabbed', 'true' );

					if ( event.dataTransfer ) {
						event.dataTransfer.effectAllowed = 'move';
						event.dataTransfer.setData(
							'text/plain',
							String( index )
						);
					}
				} );
				figure.addEventListener( 'dragover', function ( event ) {
					if ( draggedIndex === null || draggedIndex === index ) {
						return;
					}

					event.preventDefault();
					figure.classList.add( 'is-drop-target' );

					if ( event.dataTransfer ) {
						event.dataTransfer.dropEffect = 'move';
					}
				} );
				figure.addEventListener( 'dragleave', function ( event ) {
					if (
						event.relatedTarget &&
						figure.contains( event.relatedTarget )
					) {
						return;
					}

					figure.classList.remove( 'is-drop-target' );
				} );
				figure.addEventListener( 'drop', function ( event ) {
					let fromIndex = draggedIndex;

					event.preventDefault();
					figure.classList.remove( 'is-drop-target' );

					if ( event.dataTransfer ) {
						const transferredValue =
							event.dataTransfer.getData( 'text/plain' );
						const transferredIndex =
							transferredValue === ''
								? null
								: Number( transferredValue );

						if ( Number.isInteger( transferredIndex ) ) {
							fromIndex = transferredIndex;
						}
					}

					if ( fromIndex === null || fromIndex === index ) {
						return;
					}

					controls.onReorder( fromIndex, index );
				} );
				figure.addEventListener( 'dragend', function () {
					draggedIndex = null;
					figure.classList.remove( 'is-dragging' );
					figure.setAttribute( 'aria-grabbed', 'false' );

					grid.querySelectorAll(
						'.dbvc-ve-panel__gallery-item.is-drop-target'
					).forEach( function ( itemNode ) {
						itemNode.classList.remove( 'is-drop-target' );
					} );
				} );
			}

			if ( editable ) {
				const actions = document.createElement( 'div' );
				const moveUpButton = document.createElement( 'button' );
				const moveDownButton = document.createElement( 'button' );
				const removeButton = document.createElement( 'button' );
				const itemLabel =
					item && item.title
						? String( item.title )
						: `#${
								Number( ( item && item.id ) || 0 ) || index + 1
						  }`;

				actions.className = 'dbvc-ve-panel__gallery-actions';
				moveUpButton.type = 'button';
				moveDownButton.type = 'button';
				removeButton.type = 'button';
				moveUpButton.className = 'dbvc-ve-panel__gallery-action';
				moveDownButton.className = 'dbvc-ve-panel__gallery-action';
				removeButton.className =
					'dbvc-ve-panel__gallery-action dbvc-ve-panel__gallery-action--danger';
				moveUpButton.textContent = '↑';
				moveDownButton.textContent = '↓';
				removeButton.textContent = '×';
				moveUpButton.title =
					strings().panelGalleryMoveEarlier || 'Move earlier';
				moveDownButton.title =
					strings().panelGalleryMoveLater || 'Move later';
				removeButton.title =
					strings().panelGalleryRemove || 'Remove image';
				moveUpButton.setAttribute(
					'aria-label',
					`${ moveUpButton.title }: ${ itemLabel }`
				);
				moveDownButton.setAttribute(
					'aria-label',
					`${ moveDownButton.title }: ${ itemLabel }`
				);
				removeButton.setAttribute(
					'aria-label',
					`${ removeButton.title }: ${ itemLabel }`
				);
				moveUpButton.disabled = disabled || index === 0;
				moveDownButton.disabled =
					disabled || index >= normalized.length - 1;
				removeButton.disabled = disabled;

				moveUpButton.addEventListener( 'click', function () {
					if ( controls.onMove ) {
						controls.onMove( index, -1 );
					}
				} );
				moveDownButton.addEventListener( 'click', function () {
					if ( controls.onMove ) {
						controls.onMove( index, 1 );
					}
				} );
				removeButton.addEventListener( 'click', function () {
					if ( controls.onRemove ) {
						controls.onRemove( index );
					}
				} );

				actions.appendChild( moveUpButton );
				actions.appendChild( moveDownButton );
				actions.appendChild( removeButton );
				figure.appendChild( actions );
			}

			grid.appendChild( figure );
		} );
	}

	function createMediaGalleryPreviewController( value, descriptor ) {
		const wrapper = document.createElement( 'div' );
		const meta = document.createElement( 'div' );
		const grid = document.createElement( 'div' );

		wrapper.className = 'dbvc-ve-panel__stack';
		meta.className = 'dbvc-ve-panel__media-meta';
		grid.className = 'dbvc-ve-panel__gallery-preview';

		function render( items ) {
			renderGalleryPreviewItems(
				grid,
				meta,
				normalizeGalleryItems( items, descriptor )
			);
		}

		render( value );

		wrapper.appendChild( meta );
		wrapper.appendChild( grid );

		return createNoopLifecycle( {
			element: wrapper,
			getValue() {
				return value;
			},
			setValue( nextValue ) {
				render( nextValue );
			},
			focus() {
				wrapper.scrollIntoView( { block: 'nearest' } );
			},
			setDisabled() {},
		} );
	}

	function createMediaGalleryReferenceController( value, descriptor ) {
		const wrapper = document.createElement( 'div' );
		const buttonRow = document.createElement( 'div' );
		const addButton = document.createElement( 'button' );
		const replaceButton = document.createElement( 'button' );
		const clearButton = document.createElement( 'button' );
		const meta = document.createElement( 'div' );
		const grid = document.createElement( 'div' );
		const fields = [ addButton, replaceButton, clearButton ];
		let currentItems = normalizeGalleryItems( value, descriptor );
		let disabledState = false;
		// RK-011 Slice 2: track a single active gallery frame so re-opens (add or
		// replace) dispose the prior frame instead of leaking listeners.
		let mediaFrame = null;

		wrapper.className = 'dbvc-ve-panel__stack';
		buttonRow.className = 'dbvc-ve-panel__toolbar';
		meta.className = 'dbvc-ve-panel__media-meta';
		grid.className = 'dbvc-ve-panel__gallery-preview';
		addButton.type = 'button';
		addButton.className = 'dbvc-ve-panel__toolbar-button';
		replaceButton.type = 'button';
		replaceButton.className = 'dbvc-ve-panel__toolbar-button';
		clearButton.type = 'button';
		clearButton.className = 'dbvc-ve-panel__toolbar-button';

		function render( nextItems ) {
			currentItems = normalizeGalleryItems( nextItems, descriptor );
			addButton.textContent = currentItems.length
				? strings().panelGalleryAdd || 'Add images'
				: strings().panelGalleryChoose || 'Choose gallery images';
			replaceButton.textContent =
				strings().panelGalleryReplace || 'Replace gallery';
			replaceButton.hidden = ! currentItems.length;
			clearButton.textContent =
				strings().panelGalleryClear || 'Clear gallery';
			addButton.disabled = disabledState;
			replaceButton.disabled = disabledState || ! currentItems.length;
			clearButton.disabled = disabledState || ! currentItems.length;
			renderGalleryPreviewItems( grid, meta, currentItems, {
				editable: true,
				disabled: disabledState,
				onMove( index, direction ) {
					const nextItems = reorderGalleryItems(
						currentItems,
						index,
						index + direction
					);

					if ( nextItems ) {
						render( nextItems );
					}
				},
				onReorder( fromIndex, toIndex ) {
					const nextItems = reorderGalleryItems(
						currentItems,
						fromIndex,
						toIndex
					);

					if ( nextItems ) {
						render( nextItems );
					}
				},
				onRemove( index ) {
					const nextItems = currentItems.slice();

					nextItems.splice( index, 1 );
					render( nextItems );
				},
			} );
		}

		function openMediaFrame( mode ) {
			if ( ! supportsWpMedia() ) {
				return;
			}

			// RK-011 Slice 2: single-active-frame discipline. The shared factory
			// disposes the prior frame (if any) before minting the new one, so
			// repeated Add / Replace clicks keep at most one live gallery frame.
			const mediaFrameFactory = window.DBVCVisualEditorMediaFrame;
			const created =
				mediaFrameFactory &&
				typeof mediaFrameFactory.createMediaFrame === 'function'
					? mediaFrameFactory.createMediaFrame( {
							mode: 'multiple',
							title:
								mode === 'add'
									? strings().panelGalleryAddFrameTitle ||
									  strings().panelGalleryFrameTitle ||
									  'Add gallery images'
									: strings().panelGalleryFrameTitle ||
									  'Select gallery images',
							buttonText:
								mode === 'add'
									? strings().panelGalleryAddFrameButton ||
									  strings().panelGalleryFrameButton ||
									  'Add selected images'
									: strings().panelGalleryFrameButton ||
									  'Use selected images',
							previousFrame: mediaFrame,
					  } )
					: null;
			mediaFrame = created && created.frame ? created.frame : null;
			if ( ! mediaFrame ) {
				return;
			}
			bindMediaFramePrefetchState( mediaFrame );

			mediaFrame.on( 'select', function () {
				const selection = mediaFrame.state().get( 'selection' );
				const items = [];

				if ( selection && typeof selection.each === 'function' ) {
					selection.each( function ( attachment ) {
						const data = attachment ? attachment.toJSON() : null;

						if ( ! data ) {
							return;
						}

						items.push(
							mapMediaSelectionToGalleryItem( data, descriptor )
						);
					} );
				}

				render(
					mode === 'add'
						? mergeGalleryItems( currentItems, items )
						: items
				);
			} );

			mediaFrame.open();
		}

		render( value );

		addButton.addEventListener( 'click', function () {
			openMediaFrame( 'add' );
		} );
		replaceButton.addEventListener( 'click', function () {
			openMediaFrame( 'replace' );
		} );
		clearButton.addEventListener( 'click', function () {
			render( [] );
		} );

		buttonRow.appendChild( addButton );
		buttonRow.appendChild( replaceButton );
		buttonRow.appendChild( clearButton );
		wrapper.appendChild( buttonRow );
		wrapper.appendChild( meta );
		wrapper.appendChild( grid );

		return createNoopLifecycle( {
			element: wrapper,
			getValue() {
				return currentItems
					.map( function ( item ) {
						return Number( item.id || 0 ) || 0;
					} )
					.filter( Boolean );
			},
			setValue( nextValue ) {
				render( nextValue );
			},
			focus() {
				addButton.focus();
			},
			setDisabled( disabled ) {
				disabledState = Boolean( disabled );

				render( currentItems );
			},
			// RK-011 Slice 2: dispose the active gallery wp.media frame on controller
			// teardown (panel close, re-open, or descriptor swap). Closes the
			// gallery-frame-per-open leak that pre-dated the R2-E3 remediation on the
			// Media Manager side.
			destroy() {
				const mediaFrameFactory = window.DBVCVisualEditorMediaFrame;
				if (
					mediaFrame &&
					mediaFrameFactory &&
					typeof mediaFrameFactory.disposeFrame === 'function'
				) {
					mediaFrameFactory.disposeFrame( mediaFrame );
				}
				mediaFrame = null;
			},
		} );
	}

	function normalizeReferenceCollectionItems( value ) {
		if ( ! Array.isArray( value ) ) {
			return [];
		}

		const items = [];
		const seen = new Set();

		value.forEach( function ( item ) {
			if ( ! item || typeof item !== 'object' ) {
				return;
			}

			const id = Number( item.id || 0 ) || 0;
			if ( ! id || seen.has( id ) ) {
				return;
			}

			seen.add( id );
			items.push( {
				id,
				title: item.title ? String( item.title ) : `#${ id }`,
				objectType: item.objectType ? String( item.objectType ) : '',
				postType: item.postType ? String( item.postType ) : '',
				taxonomy: item.taxonomy ? String( item.taxonomy ) : '',
				typeLabel: item.typeLabel ? String( item.typeLabel ) : '',
				status: item.status ? String( item.status ) : '',
				frontendUrl: item.frontendUrl ? String( item.frontendUrl ) : '',
				backendUrl: item.backendUrl ? String( item.backendUrl ) : '',
			} );
		} );

		return items;
	}

	function getReferenceCollectionGroupLabel( item ) {
		if ( item && item.typeLabel ) {
			return String( item.typeLabel );
		}

		if ( item && item.postType ) {
			return String( item.postType );
		}

		if ( item && item.taxonomy ) {
			return String( item.taxonomy );
		}

		if ( item && item.objectType ) {
			return String( item.objectType );
		}

		return strings().panelCollectionGroupFallback || 'Items';
	}

	function getReferenceCollectionGroupKey( item ) {
		const objectType =
			item && item.objectType ? String( item.objectType ) : '';
		const postType = item && item.postType ? String( item.postType ) : '';
		const taxonomy = item && item.taxonomy ? String( item.taxonomy ) : '';
		const label = getReferenceCollectionGroupLabel( item );

		return [ objectType || postType || taxonomy || 'item', label ].join(
			':'
		);
	}

	function groupReferenceCollectionItems( items ) {
		const groups = [];
		const groupMap = new Map();

		items.forEach( function ( item, index ) {
			const key = getReferenceCollectionGroupKey( item );
			let group = groupMap.get( key );

			if ( ! group ) {
				group = {
					key,
					label: getReferenceCollectionGroupLabel( item ),
					items: [],
				};
				groupMap.set( key, group );
				groups.push( group );
			}

			group.items.push( {
				item,
				index,
			} );
		} );

		return groups;
	}

	function formatReferenceCollectionGroupCount( count ) {
		return count === 1
			? strings().panelCollectionGroupItemSingular || '1 item'
			: `${ count } ${
					strings().panelCollectionGroupItemPlural || 'items'
			  }`;
	}

	function getReferenceCollectionPreviewBranchLabel( descriptor ) {
		const source = descriptor && descriptor.source ? descriptor.source : {};
		const branchState = source.query_branch_state
			? String( source.query_branch_state )
			: '';

		if ( branchState === 'shared_option_fallback_exact_match' ) {
			return (
				strings().panelCollectionBranchOptionsFallback ||
				'Options fallback active'
			);
		}

		if ( branchState === 'query_editor_post_in_unmatched' ) {
			return (
				strings().panelCollectionBranchUnmatchedQuery ||
				'Query Editor post list'
			);
		}

		return (
			strings().panelCollectionBranchInspectOnly || 'Inspect-only query'
		);
	}

	function getReferenceCollectionPreviewContext( descriptor ) {
		const source = descriptor && descriptor.source ? descriptor.source : {};
		const branchState = source.query_branch_state
			? String( source.query_branch_state )
			: '';

		if ( branchState === 'shared_option_fallback_exact_match' ) {
			return (
				strings().panelCollectionPreviewOptionsFallback ||
				'This query is currently using a shared ACF options fallback, but this branch did not meet the exact shared-option save contract. Saving is disabled.'
			);
		}

		if ( branchState === 'query_editor_post_in_unmatched' ) {
			return (
				strings().panelCollectionPreviewUnmatched ||
				'Visual Editor could not prove a writable ACF source for this query. Saving is disabled.'
			);
		}

		return (
			strings().panelCollectionPreviewInspectOnly ||
			'This query result can be inspected, but it is not writable from the Visual Editor yet.'
		);
	}

	function normalizeReferenceCollectionPreviewList( value, limit ) {
		const values = Array.isArray( value ) ? value : [];
		const max = Number.isFinite( Number( limit ) )
			? Math.max( 1, Number( limit ) )
			: 6;
		const normalized = [];

		values.forEach( function ( item ) {
			const text = String( item || '' )
				.replace( /\s+/g, ' ' )
				.trim();

			if ( text && ! normalized.includes( text ) ) {
				normalized.push( text );
			}
		} );

		if ( normalized.length <= max ) {
			return normalized;
		}

		return normalized
			.slice( 0, max )
			.concat( [ `+${ normalized.length - max } more` ] );
	}

	function getReferenceCollectionPreviewLockedReason( descriptor ) {
		const source = descriptor && descriptor.source ? descriptor.source : {};
		const branchState = source.query_branch_state
			? String( source.query_branch_state )
			: '';

		if ( branchState === 'query_editor_post_in_unmatched' ) {
			return (
				strings().panelCollectionPreviewReasonUnmatched ||
				'Locked because the final queried IDs do not exactly match one writable current-page ACF relationship or post-object field.'
			);
		}

		if ( branchState === 'shared_option_fallback_exact_match' ) {
			return (
				strings().panelCollectionPreviewReasonOptionsFallback ||
				'Locked because this shared options fallback did not meet the exact shared-option save contract for this panel state.'
			);
		}

		return (
			strings().panelCollectionPreviewReasonGeneric ||
			'Locked because Visual Editor cannot prove a safe collection save contract for this query branch.'
		);
	}

	function appendReferenceCollectionEvidenceRow( body, label, values ) {
		const normalized = normalizeReferenceCollectionPreviewList( values, 6 );

		if ( ! normalized.length ) {
			return;
		}

		const row = document.createElement( 'div' );
		const term = document.createElement( 'dt' );
		const detail = document.createElement( 'dd' );

		row.className = 'dbvc-ve-panel__collection-evidence-row';
		term.textContent = label;
		detail.textContent = normalized.join( ', ' );
		row.appendChild( term );
		row.appendChild( detail );
		body.appendChild( row );
	}

	function createReferenceCollectionPreviewEvidence(
		descriptor,
		currentItems
	) {
		const source = descriptor && descriptor.source ? descriptor.source : {};
		const details = document.createElement( 'details' );
		const summary = document.createElement( 'summary' );
		const body = document.createElement( 'dl' );
		const reason = document.createElement( 'div' );
		const branchLabel =
			getReferenceCollectionPreviewBranchLabel( descriptor );
		const targetLabel =
			source.query_target_post_type_label ||
			source.query_target_post_type ||
			'';
		const querySetting = [
			source.query_id_setting_source,
			source.query_id_setting_key,
		]
			.filter( Boolean )
			.join( ':' );

		details.className = 'dbvc-ve-panel__collection-evidence';
		details.open = true;
		summary.className = 'dbvc-ve-panel__collection-evidence-summary';
		summary.textContent =
			strings().panelCollectionPreviewEvidence ||
			'Locked source evidence';
		body.className = 'dbvc-ve-panel__collection-evidence-body';
		reason.className = 'dbvc-ve-panel__collection-evidence-reason';
		reason.textContent =
			getReferenceCollectionPreviewLockedReason( descriptor );

		appendReferenceCollectionEvidenceRow(
			body,
			strings().panelCollectionPreviewEvidenceBranch || 'Active branch',
			[ branchLabel ]
		);
		appendReferenceCollectionEvidenceRow(
			body,
			strings().panelCollectionPreviewEvidenceCount || 'Queried items',
			[ String( ( currentItems || [] ).length ) ]
		);
		appendReferenceCollectionEvidenceRow(
			body,
			strings().panelCollectionPreviewEvidenceTarget || 'Target type',
			targetLabel ? [ targetLabel ] : []
		);
		appendReferenceCollectionEvidenceRow(
			body,
			strings().panelCollectionPreviewEvidenceCurrentHints ||
				'Current field hints',
			source.query_editor_field_hints || []
		);
		appendReferenceCollectionEvidenceRow(
			body,
			strings().panelCollectionPreviewEvidenceOptionHints ||
				'Option field hints',
			source.query_editor_option_field_hints || []
		);
		appendReferenceCollectionEvidenceRow(
			body,
			strings().panelCollectionPreviewEvidenceDynamicTags ||
				'Dynamic tags',
			source.query_dynamic_tags || []
		);
		appendReferenceCollectionEvidenceRow(
			body,
			strings().panelCollectionPreviewEvidenceSetting || 'Query setting',
			querySetting ? [ querySetting ] : []
		);

		details.appendChild( summary );
		details.appendChild( reason );
		details.appendChild( body );

		return details;
	}

	function getReferenceCollectionEditableBranchContext( descriptor ) {
		const source = descriptor && descriptor.source ? descriptor.source : {};
		const branchState = source.query_branch_state
			? String( source.query_branch_state )
			: '';
		const sourceContext = source.source_context
			? String( source.source_context )
			: '';
		const writeMode = source.query_collection_write_mode
			? String( source.query_collection_write_mode )
			: '';

		if (
			branchState === 'shared_option_fallback_exact_match' ||
			sourceContext === 'shared_option_fallback'
		) {
			if ( writeMode === 'replace_full_collection' ) {
				return (
					strings().panelCollectionOptionsFallbackFullContext ||
					'This loop is using a shared ACF options fallback. Saving replaces the full shared fallback list and can affect every page that uses this fallback.'
				);
			}

			return (
				strings().panelCollectionOptionsFallbackSubsetContext ||
				'This loop is using a shared ACF options fallback. Saving updates only the proven matching post-type subset and preserves other connected items in the shared field.'
			);
		}

		return '';
	}

	function appendReferenceCollectionPreviewLink( actions, url, label ) {
		if ( ! url ) {
			return;
		}

		const link = document.createElement( 'a' );

		link.className = 'dbvc-ve-panel__entity-link';
		link.href = String( url );
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		link.textContent = label;
		actions.appendChild( link );
	}

	function getReferenceCollectionSeedContext( descriptor ) {
		const source = descriptor && descriptor.source ? descriptor.source : {};
		const seed =
			source.query_seed_current_field &&
			typeof source.query_seed_current_field === 'object'
				? source.query_seed_current_field
				: null;

		return seed && seed.enabled ? seed : null;
	}

	function setReferenceCollectionSeedActionState(
		actionNodes,
		stateName,
		message
	) {
		if ( ! actionNodes ) {
			return;
		}

		const hasUndo = Boolean(
			actionNodes.token &&
				state.collectionSeedUndoByToken[ actionNodes.token ]
		);

		if ( actionNodes.feedback ) {
			actionNodes.feedback.textContent = message || '';
			actionNodes.feedback.hidden = ! message;
		}

		if ( actionNodes.seedButton ) {
			actionNodes.seedButton.disabled = stateName === 'saving' || hasUndo;
		}

		if ( actionNodes.undoButton ) {
			actionNodes.undoButton.hidden = ! hasUndo;
			actionNodes.undoButton.disabled = stateName === 'saving';
		}

		if ( actionNodes.reloadButton ) {
			actionNodes.reloadButton.hidden = ! hasUndo;
			actionNodes.reloadButton.disabled = stateName === 'saving';
		}
	}

	async function handleReferenceCollectionSeed(
		descriptor,
		actionNodes,
		mode
	) {
		const panelNodes = getPanelNodes();
		const sessionId = getSessionId();
		const token =
			descriptor && descriptor.token ? String( descriptor.token ) : '';
		const isUndo = mode === 'undo';
		const undoState = token
			? state.collectionSeedUndoByToken[ token ]
			: null;

		if ( ! sessionId || ! token || ! actionNodes ) {
			return;
		}

		if (
			isUndo &&
			( ! undoState || ! Array.isArray( undoState.previousValue ) )
		) {
			return;
		}

		const confirmMessage = isUndo
			? strings().panelCollectionSeedUndoConfirm ||
			  'Undo the current-page seed and restore the previous connected-items value?'
			: strings().panelCollectionSeedConfirm ||
			  'This copies the queried fallback items into the current page field. You can undo this before reloading. Continue?';
		if (
			typeof window.confirm === 'function' &&
			! window.confirm( confirmMessage )
		) {
			return;
		}

		setReferenceCollectionSeedActionState(
			actionNodes,
			'saving',
			isUndo
				? strings().panelCollectionSeedUndoSaving ||
						'Undoing current page seed…'
				: strings().panelCollectionSeedSaving ||
						'Adding fallback items to current page field…'
		);
		if ( panelNodes.saveButton ) {
			panelNodes.saveButton.disabled = true;
		}
		if ( panelNodes.saveNoReloadButton ) {
			panelNodes.saveNoReloadButton.disabled = true;
		}
		state.saveInFlight = true;
		panelNodes.panel.dataset.state = 'saving';
		panelNodes.status.textContent = isUndo
			? strings().panelCollectionSeedUndoSaving ||
			  'Undoing current page seed…'
			: strings().panelCollectionSeedSaving ||
			  'Adding fallback items to current page field…';
		schedulePanelViewportClamp();

		try {
			if ( shouldRefreshSessionBeforeAction() ) {
				await refreshSession( { silent: true, touchOnly: true } );
			}

			const result = await window.DBVCVisualEditorApi.seedCurrentField(
				state.session.sessionId,
				token,
				{
					mode: isUndo ? 'undo' : 'seed',
					previousValue: isUndo ? undoState.previousValue : [],
				}
			);
			const message =
				result && result.message
					? result.message
					: isUndo
					? strings().panelCollectionSeedUndoDone ||
					  'Current page seed undone. Reload when ready.'
					: strings().panelCollectionSeedDone ||
					  'Current page field updated. Reload when ready, or undo this seed before reloading.';

			if ( isUndo ) {
				delete state.collectionSeedUndoByToken[ token ];
			} else if ( result && result.undo && result.undo.enabled ) {
				state.collectionSeedUndoByToken[ token ] = {
					previousValue: Array.isArray( result.undo.previousValue )
						? result.undo.previousValue.slice()
						: [],
				};
			}

			panelNodes.panel.dataset.state = 'saved';
			panelNodes.status.textContent = message;
			setReferenceCollectionSeedActionState(
				actionNodes,
				'ready',
				message
			);
			if (
				state.activeController &&
				typeof state.activeController.setDisabled === 'function'
			) {
				state.activeController.setDisabled( false );
			}
			updateSaveButtonState(
				panelNodes,
				getDescriptorStatus(
					state.activeDescriptor,
					state.activeNode
				) !== 'readonly'
			);
			updateStatusBar( {
				kind: 'ready',
				count: getMarkerCount(),
				message,
				entitySummary:
					result && result.entitySummary
						? result.entitySummary
						: null,
			} );
			schedulePanelViewportClamp();
		} catch ( error ) {
			if ( isSessionExpiredError( error ) ) {
				handleExpiredSession( error );
			}

			panelNodes.panel.dataset.state = 'error';
			panelNodes.status.textContent =
				error && error.message
					? error.message
					: strings().saveFailed || 'Save failed.';
			setReferenceCollectionSeedActionState(
				actionNodes,
				'ready',
				error && error.message
					? error.message
					: strings().saveFailed || 'Save failed.'
			);
			if (
				state.activeController &&
				typeof state.activeController.setDisabled === 'function'
			) {
				state.activeController.setDisabled( false );
			}
			updateSaveButtonState(
				panelNodes,
				getDescriptorStatus(
					state.activeDescriptor,
					state.activeNode
				) !== 'readonly'
			);
			schedulePanelViewportClamp();
			window.console.error( error );
		} finally {
			state.saveInFlight = false;
		}
	}

	function appendReferenceCollectionSeedAction( wrapper, descriptor ) {
		const seed = getReferenceCollectionSeedContext( descriptor );
		if ( ! seed ) {
			return;
		}

		const box = document.createElement( 'div' );
		const title = document.createElement( 'div' );
		const description = document.createElement( 'div' );
		const actions = document.createElement( 'div' );
		const button = document.createElement( 'button' );
		const undoButton = document.createElement( 'button' );
		const reloadButton = document.createElement( 'button' );
		const feedback = document.createElement( 'div' );
		const fieldLabel = seed.field_label ? String( seed.field_label ) : '';
		const actionNodes = {
			token:
				descriptor && descriptor.token
					? String( descriptor.token )
					: '',
			seedButton: button,
			undoButton,
			reloadButton,
			feedback,
		};

		box.className = 'dbvc-ve-panel__collection-seed';
		title.className = 'dbvc-ve-panel__collection-seed-title';
		description.className = 'dbvc-ve-panel__collection-seed-description';
		actions.className = 'dbvc-ve-panel__collection-seed-actions';
		button.type = 'button';
		button.className = 'dbvc-ve-panel__toolbar-button';
		undoButton.type = 'button';
		undoButton.className = 'dbvc-ve-panel__collection-action';
		undoButton.title = strings().panelCollectionSeedUndo || 'Undo seed';
		undoButton.setAttribute(
			'aria-label',
			strings().panelCollectionSeedUndo || 'Undo seed'
		);
		undoButton.textContent = '↶';
		reloadButton.type = 'button';
		reloadButton.className = 'dbvc-ve-panel__collection-action';
		reloadButton.title =
			strings().panelCollectionSeedReload || 'Reload page';
		reloadButton.setAttribute(
			'aria-label',
			strings().panelCollectionSeedReload || 'Reload page'
		);
		reloadButton.textContent = '↻';
		feedback.className = 'dbvc-ve-panel__collection-seed-feedback';
		feedback.hidden = true;
		title.textContent =
			strings().panelCollectionSeedTitle || 'Current page field fallback';
		description.textContent = fieldLabel
			? `${
					strings().panelCollectionSeedDescription ||
					'The current page field is empty for this query branch. You can copy these fallback items into the current page field instead of editing the shared fallback.'
			  } (${ fieldLabel })`
			: strings().panelCollectionSeedDescription ||
			  'The current page field is empty for this query branch. You can copy these fallback items into the current page field instead of editing the shared fallback.';
		button.textContent =
			strings().panelCollectionSeedButton || 'Add to current page field';
		button.addEventListener( 'click', function () {
			handleReferenceCollectionSeed( descriptor, actionNodes, 'seed' );
		} );
		undoButton.addEventListener( 'click', function () {
			handleReferenceCollectionSeed( descriptor, actionNodes, 'undo' );
		} );
		reloadButton.addEventListener( 'click', function () {
			state.reloadPending = true;
			window.location.reload();
		} );

		actions.appendChild( button );
		actions.appendChild( undoButton );
		actions.appendChild( reloadButton );
		box.appendChild( title );
		box.appendChild( description );
		box.appendChild( actions );
		box.appendChild( feedback );
		wrapper.appendChild( box );
		setReferenceCollectionSeedActionState( actionNodes, 'ready', '' );
	}

	function createReferenceCollectionPreviewController( value, descriptor ) {
		const wrapper = document.createElement( 'div' );
		const selectedLabel = document.createElement( 'div' );
		const branchContext = document.createElement( 'div' );
		const selectedList = document.createElement( 'div' );
		let currentItems = normalizeReferenceCollectionItems( value );

		wrapper.className = 'dbvc-ve-panel__stack dbvc-ve-panel__collection';
		selectedLabel.className = 'dbvc-ve-panel__collection-label';
		selectedLabel.textContent =
			strings().panelCollectionPreviewSelected || 'Queried items';
		branchContext.className = 'dbvc-ve-panel__collection-context';
		branchContext.textContent = `${ getReferenceCollectionPreviewBranchLabel(
			descriptor
		) }. ${ getReferenceCollectionPreviewContext( descriptor ) }`;
		selectedList.className = 'dbvc-ve-panel__collection-selected';

		function renderSelected() {
			selectedList.innerHTML = '';

			if ( ! currentItems.length ) {
				selectedList.innerHTML = `<div class="dbvc-ve-panel__placeholder">${ escapeHtml(
					strings().panelCollectionPreviewEmpty ||
						'No queried items were found.'
				) }</div>`;
				return;
			}

			groupReferenceCollectionItems( currentItems ).forEach(
				function ( group ) {
					const details = document.createElement( 'details' );
					const summary = document.createElement( 'summary' );
					const groupTitle = document.createElement( 'span' );
					const groupCount = document.createElement( 'span' );
					const groupBody = document.createElement( 'div' );

					details.className = 'dbvc-ve-panel__collection-group';
					summary.className =
						'dbvc-ve-panel__collection-group-summary';
					groupTitle.className =
						'dbvc-ve-panel__collection-group-title';
					groupCount.className =
						'dbvc-ve-panel__collection-group-count';
					groupBody.className =
						'dbvc-ve-panel__collection-group-body';
					groupTitle.textContent = group.label;
					groupCount.textContent =
						formatReferenceCollectionGroupCount(
							group.items.length
						);

					summary.appendChild( groupTitle );
					summary.appendChild( groupCount );
					details.appendChild( summary );
					details.appendChild( groupBody );

					group.items.forEach( function ( entry ) {
						const item = entry.item;
						const row = document.createElement( 'div' );
						const text = document.createElement( 'div' );
						const title = document.createElement( 'div' );
						const meta = document.createElement( 'div' );
						const actions = document.createElement( 'div' );

						row.className =
							'dbvc-ve-panel__collection-row is-readonly';
						text.className = 'dbvc-ve-panel__collection-text';
						title.className = 'dbvc-ve-panel__collection-title';
						meta.className = 'dbvc-ve-panel__collection-meta';
						actions.className = 'dbvc-ve-panel__collection-actions';
						title.textContent = item.title;
						meta.textContent = [ item.typeLabel, item.status ]
							.filter( Boolean )
							.join( ' / ' );

						appendReferenceCollectionPreviewLink(
							actions,
							item.frontendUrl,
							strings().panelCollectionPreviewFrontend ||
								'Frontend'
						);
						appendReferenceCollectionPreviewLink(
							actions,
							item.backendUrl,
							strings().panelCollectionPreviewBackend || 'Backend'
						);

						text.appendChild( title );
						if ( meta.textContent ) {
							text.appendChild( meta );
						}
						row.appendChild( text );
						if ( actions.children.length ) {
							row.appendChild( actions );
						}
						groupBody.appendChild( row );
					} );

					selectedList.appendChild( details );
				}
			);
		}

		wrapper.appendChild( selectedLabel );
		wrapper.appendChild( branchContext );
		wrapper.appendChild(
			createReferenceCollectionPreviewEvidence( descriptor, currentItems )
		);
		appendReferenceCollectionSeedAction( wrapper, descriptor );
		wrapper.appendChild( selectedList );
		renderSelected();

		return createNoopLifecycle( {
			element: wrapper,
			getValue() {
				return value;
			},
			setValue( nextValue ) {
				currentItems = normalizeReferenceCollectionItems( nextValue );
				renderSelected();
			},
			focus() {
				const firstSummary = wrapper.querySelector( 'summary' );
				if ( firstSummary ) {
					firstSummary.focus();
				}
			},
		} );
	}

	function formatTemplateString( template, replacements ) {
		return String( template || '' ).replace(
			/\{([a-zA-Z0-9_]+)\}/g,
			function ( match, key ) {
				return Object.prototype.hasOwnProperty.call( replacements, key )
					? String( replacements[ key ] )
					: match;
			}
		);
	}

	function isFilteredSubsetReferenceCollection( descriptor ) {
		const source = descriptor && descriptor.source ? descriptor.source : {};

		return (
			getDescriptorQuerySource( descriptor ) === 'derived_bricks_query' &&
			source.query_subset_write_mode === 'replace_target_post_type_subset'
		);
	}

	function isPostTermsReferenceCollection( descriptor ) {
		return Boolean(
			descriptor &&
				descriptor.source &&
				descriptor.source.type === 'post_terms_collection'
		);
	}

	function getReferenceCollectionSubsetTargetLabel( descriptor ) {
		const source = descriptor && descriptor.source ? descriptor.source : {};
		const sourceLabel = source.query_target_post_type_label
			? String( source.query_target_post_type_label )
					.replace( /\s+/g, ' ' )
					.trim()
			: '';
		const badgeLabel = getDescriptorBadgeLabel( descriptor );

		if ( sourceLabel ) {
			return /\bposts?\b$/i.test( sourceLabel )
				? sourceLabel
				: `${ sourceLabel } Posts`;
		}

		if ( badgeLabel ) {
			return badgeLabel;
		}

		return strings().badgeModifyLinkedPosts || 'Linked Posts';
	}

	function getReferenceCollectionPreservedCount( descriptor ) {
		const source = descriptor && descriptor.source ? descriptor.source : {};

		if ( Array.isArray( source.query_preserved_ids ) ) {
			return source.query_preserved_ids.length;
		}

		if (
			Array.isArray( source.query_full_value_ids ) &&
			Array.isArray( source.query_result_ids )
		) {
			const resultIds = new Set(
				source.query_result_ids
					.map( function ( id ) {
						return Number( id || 0 ) || 0;
					} )
					.filter( Boolean )
			);

			return source.query_full_value_ids.filter( function ( id ) {
				const normalizedId = Number( id || 0 ) || 0;
				return normalizedId && ! resultIds.has( normalizedId );
			} ).length;
		}

		return 0;
	}

	function formatReferenceCollectionSubsetContext( descriptor, targetLabel ) {
		const parts = [
			formatTemplateString(
				strings().panelCollectionSubsetContext ||
					'Editing only {target} in this connected-items field.',
				{ target: targetLabel }
			),
		];
		const preservedCount =
			getReferenceCollectionPreservedCount( descriptor );

		if ( preservedCount === 1 ) {
			parts.push(
				strings().panelCollectionSubsetPreservedSingle ||
					'1 other linked item in this field will be preserved.'
			);
		} else if ( preservedCount > 1 ) {
			parts.push(
				formatTemplateString(
					strings().panelCollectionSubsetPreservedPlural ||
						'{count} other linked items in this field will be preserved.',
					{ count: preservedCount }
				)
			);
		}

		return parts.join( ' ' );
	}

	function createReferenceCollectionController( value, descriptor ) {
		const wrapper = document.createElement( 'div' );
		const selectedLabel = document.createElement( 'div' );
		const branchContext = document.createElement( 'div' );
		const subsetContext = document.createElement( 'div' );
		const selectedList = document.createElement( 'div' );
		const searchLabel = document.createElement( 'div' );
		const searchField = document.createElement( 'input' );
		const resultsLabel = document.createElement( 'div' );
		const resultsList = document.createElement( 'div' );
		const sessionId = getSessionId();
		const token =
			descriptor && descriptor.token ? String( descriptor.token ) : '';
		const maxSelections =
			Number(
				( descriptor &&
					descriptor.source &&
					descriptor.source.reference_max ) ||
					0
			) || 0;
		const allowMultiple =
			maxSelections === 0 ||
			maxSelections > 1 ||
			Boolean(
				descriptor &&
					descriptor.source &&
					descriptor.source.reference_multiple
			);
		const fields = [ searchField ];
		let currentItems = normalizeReferenceCollectionItems( value );
		let pendingSearchToken = '';
		let searchRequestId = 0;
		let searchFrame = 0;
		let disabledState = false;
		let lastSearchItems = [];
		const selectedGroupOpenState = new Map();
		const isFilteredSubset =
			isFilteredSubsetReferenceCollection( descriptor );
		const isPostTermsCollection =
			isPostTermsReferenceCollection( descriptor );
		const targetLabel =
			getReferenceCollectionSubsetTargetLabel( descriptor );
		const editableBranchContext =
			getReferenceCollectionEditableBranchContext( descriptor );

		wrapper.className = 'dbvc-ve-panel__stack dbvc-ve-panel__collection';
		selectedLabel.className = 'dbvc-ve-panel__collection-label';
		selectedLabel.textContent = isPostTermsCollection
			? 'Linked terms'
			: isFilteredSubset
			? formatTemplateString(
					strings().panelCollectionSubsetSelected ||
						'Connected {target}',
					{ target: targetLabel }
			  )
			: strings().panelCollectionSelected || 'Connected items';
		branchContext.className = 'dbvc-ve-panel__collection-context';
		branchContext.textContent = editableBranchContext;
		subsetContext.className = 'dbvc-ve-panel__collection-context';
		subsetContext.textContent = formatReferenceCollectionSubsetContext(
			descriptor,
			targetLabel
		);
		selectedList.className = 'dbvc-ve-panel__collection-selected';
		searchLabel.className = 'dbvc-ve-panel__collection-label';
		searchLabel.textContent = isPostTermsCollection
			? 'Search terms'
			: isFilteredSubset
			? formatTemplateString(
					strings().panelCollectionSubsetSearch || 'Search {target}',
					{ target: targetLabel }
			  )
			: strings().panelCollectionSearch || 'Search connected posts';
		searchField.className = 'dbvc-ve-panel__input';
		searchField.type = 'search';
		searchField.placeholder = isPostTermsCollection
			? 'Search terms...'
			: isFilteredSubset
			? formatTemplateString(
					strings().panelCollectionSubsetSearchPlaceholder ||
						'Search {target}…',
					{ target: targetLabel }
			  )
			: strings().panelCollectionSearchPlaceholder || 'Search posts…';
		resultsLabel.className = 'dbvc-ve-panel__collection-label';
		resultsLabel.textContent =
			strings().panelCollectionResults || 'Search results';
		resultsList.className = 'dbvc-ve-panel__collection-results';

		function getSelectedIds() {
			return currentItems
				.map( function ( item ) {
					return Number( item.id || 0 ) || 0;
				} )
				.filter( Boolean );
		}

		function renderSelected() {
			selectedList.innerHTML = '';

			if ( ! currentItems.length ) {
				const emptyMessage = isFilteredSubset
					? formatTemplateString(
							strings().panelCollectionSubsetEmpty ||
								'No connected {target} are set yet.',
							{ target: targetLabel }
					  )
					: isPostTermsCollection
					? strings().panelCollectionTermsEmpty ||
					  'No linked terms are set yet.'
					: strings().panelCollectionEmpty ||
					  'No connected posts are set yet.';

				selectedList.innerHTML = `<div class="dbvc-ve-panel__placeholder">${ escapeHtml(
					emptyMessage
				) }</div>`;
				return;
			}

			groupReferenceCollectionItems( currentItems ).forEach(
				function ( group ) {
					const details = document.createElement( 'details' );
					const summary = document.createElement( 'summary' );
					const groupTitle = document.createElement( 'span' );
					const groupCount = document.createElement( 'span' );
					const groupBody = document.createElement( 'div' );

					details.className = 'dbvc-ve-panel__collection-group';
					details.open =
						selectedGroupOpenState.get( group.key ) === true;
					details.addEventListener( 'toggle', function () {
						selectedGroupOpenState.set( group.key, details.open );
					} );
					summary.className =
						'dbvc-ve-panel__collection-group-summary';
					groupTitle.className =
						'dbvc-ve-panel__collection-group-title';
					groupCount.className =
						'dbvc-ve-panel__collection-group-count';
					groupBody.className =
						'dbvc-ve-panel__collection-group-body';
					groupTitle.textContent = group.label;
					groupCount.textContent =
						formatReferenceCollectionGroupCount(
							group.items.length
						);

					summary.appendChild( groupTitle );
					summary.appendChild( groupCount );
					details.appendChild( summary );
					details.appendChild( groupBody );

					group.items.forEach( function ( entry, groupIndex ) {
						const item = entry.item;
						const index = entry.index;
						const row = document.createElement( 'div' );
						const text = document.createElement( 'div' );
						const title = document.createElement( 'div' );
						const meta = document.createElement( 'div' );
						const actions = document.createElement( 'div' );
						const upButton = document.createElement( 'button' );
						const downButton = document.createElement( 'button' );
						const removeButton = document.createElement( 'button' );

						row.className =
							'dbvc-ve-panel__collection-row is-selected';
						text.className = 'dbvc-ve-panel__collection-text';
						title.className = 'dbvc-ve-panel__collection-title';
						meta.className = 'dbvc-ve-panel__collection-meta';
						actions.className = 'dbvc-ve-panel__collection-actions';
						title.textContent = item.title;
						meta.textContent = [ item.typeLabel, item.status ]
							.filter( Boolean )
							.join( ' / ' );

						upButton.type = 'button';
						upButton.className = 'dbvc-ve-panel__collection-action';
						upButton.textContent = '↑';
						upButton.title =
							strings().panelCollectionMoveUp || 'Move up';
						upButton.disabled = disabledState || groupIndex <= 0;
						upButton.addEventListener( 'click', function () {
							if ( groupIndex <= 0 ) {
								return;
							}

							const next = currentItems.slice();
							const previousIndex =
								group.items[ groupIndex - 1 ].index;
							const swap = next[ previousIndex ];

							next[ previousIndex ] = next[ index ];
							next[ index ] = swap;
							currentItems = next;
							renderSelected();
							renderResults( null, getSelectedIds() );
						} );

						downButton.type = 'button';
						downButton.className =
							'dbvc-ve-panel__collection-action';
						downButton.textContent = '↓';
						downButton.title =
							strings().panelCollectionMoveDown || 'Move down';
						downButton.disabled =
							disabledState ||
							groupIndex >= group.items.length - 1;
						downButton.addEventListener( 'click', function () {
							if ( groupIndex >= group.items.length - 1 ) {
								return;
							}

							const next = currentItems.slice();
							const nextIndex =
								group.items[ groupIndex + 1 ].index;
							const swap = next[ nextIndex ];

							next[ nextIndex ] = next[ index ];
							next[ index ] = swap;
							currentItems = next;
							renderSelected();
							renderResults( null, getSelectedIds() );
						} );

						removeButton.type = 'button';
						removeButton.className =
							'dbvc-ve-panel__collection-action is-remove';
						removeButton.textContent = '×';
						removeButton.title =
							strings().panelCollectionRemove || 'Remove';
						removeButton.setAttribute(
							'aria-label',
							strings().panelCollectionRemove || 'Remove'
						);
						removeButton.disabled = disabledState;
						removeButton.addEventListener( 'click', function () {
							currentItems = currentItems.filter(
								function ( selected ) {
									return (
										Number( selected.id || 0 ) !==
										Number( item.id || 0 )
									);
								}
							);
							renderSelected();
							renderResults( null, getSelectedIds() );
						} );

						text.appendChild( title );
						text.appendChild( meta );
						actions.appendChild( upButton );
						actions.appendChild( downButton );
						actions.appendChild( removeButton );
						row.appendChild( text );
						row.appendChild( actions );
						groupBody.appendChild( row );
					} );

					selectedList.appendChild( details );
				}
			);
		}

		function setSearchState( message ) {
			resultsList.innerHTML = `<div class="dbvc-ve-panel__placeholder">${ escapeHtml(
				message
			) }</div>`;
		}

		function renderResults( items, previousSelectedIds ) {
			const selectedIds = Array.isArray( previousSelectedIds )
				? previousSelectedIds
				: getSelectedIds();
			const renderItems = Array.isArray( items )
				? items
				: lastSearchItems;

			resultsList.innerHTML = '';

			lastSearchItems = Array.isArray( renderItems ) ? renderItems : [];

			if ( ! renderItems.length ) {
				setSearchState(
					isPostTermsCollection
						? strings().panelCollectionTermsNoResults ||
								'No matching terms were found.'
						: strings().panelCollectionNoResults ||
								'No matching posts were found.'
				);
				return;
			}

			renderItems.forEach( function ( item ) {
				const id = Number( ( item && item.id ) || 0 ) || 0;
				const selected = selectedIds.includes( id );
				const row = document.createElement( 'div' );
				const text = document.createElement( 'div' );
				const title = document.createElement( 'div' );
				const meta = document.createElement( 'div' );
				const action = document.createElement( 'button' );

				row.className = 'dbvc-ve-panel__collection-row';
				text.className = 'dbvc-ve-panel__collection-text';
				title.className = 'dbvc-ve-panel__collection-title';
				meta.className = 'dbvc-ve-panel__collection-meta';
				action.type = 'button';
				action.className = 'dbvc-ve-panel__toolbar-button';
				action.textContent = allowMultiple
					? strings().panelCollectionAdd || 'Add'
					: strings().panelCollectionReplace || 'Replace';
				action.disabled =
					disabledState ||
					! id ||
					selected ||
					( maxSelections > 0 &&
						currentItems.length >= maxSelections &&
						allowMultiple );
				title.textContent =
					item && item.title ? String( item.title ) : `#${ id }`;
				meta.textContent = [
					item && item.typeLabel ? String( item.typeLabel ) : '',
					item && item.status ? String( item.status ) : '',
				]
					.filter( Boolean )
					.join( ' / ' );

				action.addEventListener( 'click', function () {
					const normalizedItem = normalizeReferenceCollectionItems( [
						item,
					] )[ 0 ];
					if ( ! normalizedItem ) {
						return;
					}

					if ( allowMultiple ) {
						currentItems = currentItems.concat( [
							normalizedItem,
						] );
					} else {
						currentItems = [ normalizedItem ];
					}

					renderSelected();
					renderResults( renderItems, getSelectedIds() );
				} );

				text.appendChild( title );
				text.appendChild( meta );
				row.appendChild( text );
				row.appendChild( action );
				resultsList.appendChild( row );
			} );
		}

		function performSearch( search ) {
			if ( ! sessionId || ! token ) {
				setSearchState(
					strings().descriptorMissing || 'Descriptor not found.'
				);
				return;
			}

			const requestId = ++searchRequestId;
			const selectedIds = getSelectedIds();
			pendingSearchToken = search;
			setSearchState(
				strings().panelCollectionSearching || 'Searching…'
			);

			window.DBVCVisualEditorApi.searchReferences(
				sessionId,
				token,
				search
			)
				.then( function ( result ) {
					if (
						requestId !== searchRequestId ||
						pendingSearchToken !== search
					) {
						return;
					}

					const items =
						result && Array.isArray( result.items )
							? result.items
							: [];
					renderResults( items, selectedIds );
				} )
				.catch( function ( error ) {
					if ( requestId !== searchRequestId ) {
						return;
					}

					setSearchState(
						error && error.message
							? error.message
							: strings().saveFailed || 'Search failed.'
					);
				} );
		}

		function scheduleSearch() {
			if ( searchFrame ) {
				window.clearTimeout( searchFrame );
			}

			const search = searchField.value.trim();
			searchFrame = window.setTimeout( function () {
				searchFrame = 0;
				performSearch( search );
			}, 180 );
		}

		searchField.addEventListener( 'input', scheduleSearch );

		wrapper.appendChild( selectedLabel );
		if ( editableBranchContext ) {
			wrapper.appendChild( branchContext );
		}
		if ( isFilteredSubset ) {
			wrapper.appendChild( subsetContext );
		}
		appendReferenceCollectionSeedAction( wrapper, descriptor );
		wrapper.appendChild( selectedList );
		wrapper.appendChild( searchLabel );
		wrapper.appendChild( searchField );
		wrapper.appendChild( resultsLabel );
		wrapper.appendChild( resultsList );

		renderSelected();
		setSearchState( strings().panelCollectionSearching || 'Searching…' );

		return createNoopLifecycle( {
			element: wrapper,
			mount() {
				performSearch( '' );
			},
			getValue() {
				return getSelectedIds();
			},
			setValue( nextValue ) {
				currentItems = normalizeReferenceCollectionItems( nextValue );
				renderSelected();
				performSearch( searchField.value.trim() );
			},
			focus() {
				searchField.focus();
				searchField.select();
			},
			setDisabled( disabled ) {
				disabledState = Boolean( disabled );
				fields.forEach( function ( field ) {
					field.disabled = disabledState;
				} );
				renderSelected();
				performSearch( searchField.value.trim() );
			},
			destroy() {
				if ( searchFrame ) {
					window.clearTimeout( searchFrame );
					searchFrame = 0;
				}
			},
		} );
	}

	function createFieldController( inputType, value, descriptor, result ) {
		switch ( inputType ) {
			case 'composite_text':
				return createCompositeTextController(
					value,
					descriptor,
					result
				);
			case 'reference_collection_preview':
				return createReferenceCollectionPreviewController(
					value,
					descriptor
				);
			case 'readonly_preview':
				return createReadonlyPreviewController( value );
			case 'reference_collection':
				return createReferenceCollectionController( value, descriptor );
			case 'media_reference':
				return createMediaReferenceController( value, descriptor );
			case 'media_gallery_reference':
				return createMediaGalleryReferenceController(
					value,
					descriptor
				);
			case 'media_gallery_preview':
				return createMediaGalleryPreviewController( value, descriptor );
			case 'textarea':
				return createTextareaController( value );
			case 'richtext':
				return createRichTextController( value );
			case 'checkbox_group':
				return createCheckboxGroupController( value, descriptor );
			case 'select':
				return createSelectController( value, descriptor );
			case 'link':
				return createLinkController( value );
			case 'url':
			case 'email':
			case 'number':
			// R5.2+color_picker: native `<input type="color">` — no new
			// controller required; the browser's built-in picker handles
			// the UX. Value round-trips as `#rrggbb`.
			case 'color':
			// R5.5: native `<input type="date">` — no new controller.
			// Value round-trips as ISO `YYYY-MM-DD`; server sanitize
			// coerces via AcfDatePickerResolver::normalizeIsoDate.
			case 'date':
				return createInputController( inputType, value );
			// true_false: checkbox controller for ACF boolean fields.
			// Value round-trips as `1` / `0` — server resolver coerces
			// via AcfTrueFalseResolver::coerceToBool.
			case 'true_false':
				return createBooleanController( value );
			// R5.later-y (2026-09-04): palette overview panel. Renders
			// a CSS grid of swatch buttons — each cell shows the
			// color's label + its current hex in a solid swatch.
			// Clicking a swatch dispatches an `open-control` event
			// with the leaf's publicId; the drawer listens and opens
			// that leaf's own single-color panel via the existing
			// R5.2+color_picker path. The controller returns null
			// from `getValue()` so the panel's save-on-blur path
			// treats palette parents as read-only.
			case 'palette_grid':
				return createPaletteOverviewController( descriptor );
			default:
				return createInputController( 'text', value );
		}
	}

	function formatEntityMeta( descriptor ) {
		const scope = getDescriptorScope( descriptor );
		const status = getDescriptorStatus( descriptor );
		const sourceType =
			descriptor.source && descriptor.source.type
				? descriptor.source.type
				: '';
		let sourceTypeLabel = sourceType;

		if ( sourceType === 'acf_repeater_subfield' ) {
			sourceTypeLabel = strings().panelSourceRepeater || 'acf repeater';
		} else if ( sourceType === 'acf_flexible_subfield' ) {
			sourceTypeLabel = strings().panelSourceFlexible || 'acf flexible';
		}

		const sourceField =
			descriptor.source && descriptor.source.field_name
				? descriptor.source.field_name
				: '';
		const containerType =
			descriptor.source && descriptor.source.container_type
				? descriptor.source.container_type
				: '';
		const parentField =
			descriptor.source && descriptor.source.parent_field_name
				? descriptor.source.parent_field_name
				: '';
		const rowIndex =
			descriptor.source &&
			Number.isFinite( Number( descriptor.source.row_index ) )
				? Number( descriptor.source.row_index )
				: null;
		const layoutName =
			descriptor.source && descriptor.source.layout_name
				? descriptor.source.layout_name
				: '';
		const layoutKey =
			descriptor.source && descriptor.source.layout_key
				? descriptor.source.layout_key
				: '';
		const entity = descriptor.entity || {};
		const loop =
			descriptor.render &&
			descriptor.render.loop &&
			typeof descriptor.render.loop === 'object'
				? descriptor.render.loop
				: null;
		const bits = [ sourceTypeLabel, sourceField ].filter( Boolean );
		const scopeLabel = resolveScopeMetaLabel( scope, entity.type || '' );

		if ( scopeLabel ) {
			bits.unshift( scopeLabel );
		}

		if ( status === 'readonly' ) {
			bits.unshift( strings().panelScopeReadonly || 'inspect only' );
		}

		if ( parentField ) {
			if ( containerType === 'flexible_content' ) {
				bits.push(
					`${
						strings().panelFlexible || 'flexible'
					}:${ parentField }`
				);
			} else {
				bits.push(
					`${
						strings().panelRepeater || 'repeater'
					}:${ parentField }`
				);
			}
		}

		if ( rowIndex !== null && rowIndex >= 0 ) {
			bits.push( `${ strings().panelRow || 'row' }:${ rowIndex + 1 }` );
		}

		if ( layoutName || layoutKey ) {
			bits.push(
				`${ strings().panelLayout || 'layout' }:${
					layoutName || layoutKey
				}`
			);
		}

		if ( entity.type === 'post' && entity.id ) {
			bits.push(
				`${ strings().panelEntityPost || 'post' }:${ entity.id }`
			);
		} else if ( entity.type === 'option' ) {
			bits.push( strings().panelEntityOption || 'option' );
		} else if ( entity.type === 'term' && entity.subtype ) {
			bits.push(
				`${ strings().panelEntityTerm || 'term' }:${ entity.subtype }:${
					entity.id || ''
				}`.replace( /:$/, '' )
			);
		} else if ( entity.type === 'user' && entity.id ) {
			bits.push(
				`${ strings().panelEntityUser || 'user' }:${ entity.id }`
			);
		}

		if ( loop && loop.active ) {
			const loopType = loop.query_object_type
				? String( loop.query_object_type )
				: '';
			const loopObjectType = loop.loop_object_type
				? String( loop.loop_object_type )
				: '';
			const loopObjectId = loop.loop_object_id
				? String( loop.loop_object_id )
				: '';
			const loopLabel = strings().panelLoop || 'loop';
			const loopSummary = [
				loopType,
				loopObjectType && loopObjectId
					? `${ loopObjectType }:${ loopObjectId }`
					: loopObjectType,
			]
				.filter( Boolean )
				.join( ' / ' );

			if ( loopSummary ) {
				bits.push( `${ loopLabel }:${ loopSummary }` );
			}
		}

		return bits.length
			? `${ strings().panelSource || 'Source' }: ${ bits.join( ' / ' ) }`
			: '';
	}

	function createEntityLinkMarkup( link ) {
		if ( ! link || typeof link !== 'object' || ! link.url ) {
			return '';
		}

		const label = link.label ? String( link.label ) : String( link.url );
		const url = String( link.url );

		return `<a class="dbvc-ve-panel__entity-link" href="${ escapeHtml(
			url
		) }" target="_blank" rel="noopener noreferrer">${ escapeHtml(
			label
		) }</a>`;
	}

	function renderEntityHeader( result, panelNodes ) {
		const summary =
			result &&
			result.entitySummary &&
			typeof result.entitySummary === 'object'
				? result.entitySummary
				: {};
		const title = summary.title
			? String( summary.title )
			: strings().panelTitle || 'Edit field';
		const typeLabel = summary.typeLabel ? String( summary.typeLabel ) : '';
		const links = [
			createEntityLinkMarkup( summary.frontendLink ),
			createEntityLinkMarkup( summary.backendLink ),
		].filter( Boolean );

		panelNodes.title.textContent = title;
		panelNodes.entityType.textContent = typeLabel;
		panelNodes.entityLinks.innerHTML = links.join( '' );
	}

	function renderSourceMeta( result, panelNodes ) {
		const summary =
			result &&
			result.sourceSummary &&
			typeof result.sourceSummary === 'object'
				? result.sourceSummary
				: {};
		const label = summary.label ? String( summary.label ) : '';
		const sourceSummary = summary.summary ? String( summary.summary ) : '';
		const expression = summary.expression
			? String( summary.expression )
			: '';
		const descriptor =
			result && result.descriptor && typeof result.descriptor === 'object'
				? result.descriptor
				: {};
		const source =
			descriptor.source && typeof descriptor.source === 'object'
				? descriptor.source
				: {};
		const render =
			descriptor.render && typeof descriptor.render === 'object'
				? descriptor.render
				: {};
		const renderedHtmlTag =
			render.html_tag &&
			/^[a-z][a-z0-9-]*$/i.test( String( render.html_tag ) )
				? String( render.html_tag ).toLowerCase()
				: '';
		const renderedFieldName =
			source.leaf_field_name ||
			source.field_name ||
			summary.fieldName ||
			label ||
			'';

		panelNodes.meta.innerHTML = '';

		if ( ! label && ! sourceSummary && ! expression ) {
			return;
		}

		const details = document.createElement( 'details' );
		const summaryNode = document.createElement( 'summary' );
		const body = document.createElement( 'div' );
		const lines = [];

		details.className = 'dbvc-ve-panel__meta-toggle';
		summaryNode.className = 'dbvc-ve-panel__meta-summary';
		summaryNode.textContent =
			strings().panelSourceDetails || 'Source details';
		body.className = 'dbvc-ve-panel__meta-body';

		if ( label ) {
			lines.push(
				`<div><strong>${ escapeHtml(
					strings().panelSourceLabel || 'Label'
				) }:</strong> ${ escapeHtml( label ) }</div>`
			);
		}

		if ( expression ) {
			lines.push(
				`<div><strong>${ escapeHtml(
					strings().panelSourceExpression || 'Dynamic tag'
				) }:</strong> <code>${ escapeHtml( expression ) }</code></div>`
			);
		}

		if ( sourceSummary ) {
			lines.push(
				`<div><strong>${ escapeHtml(
					strings().panelSource || 'Source'
				) }:</strong> ${ escapeHtml( sourceSummary ) }</div>`
			);
		}

		if ( renderedHtmlTag ) {
			const renderedHtmlValue = renderedFieldName
				? `${ String( renderedFieldName ) } = <${ renderedHtmlTag }>`
				: `<${ renderedHtmlTag }>`;
			lines.push(
				`<div><strong>${ escapeHtml(
					strings().panelRenderedHtmlTag || 'Rendered HTML tag'
				) }:</strong> <code>${ escapeHtml(
					renderedHtmlValue
				) }</code></div>`
			);
		}

		if ( result.saveContractSummary && result.saveContractSummary.label ) {
			lines.push(
				`<div><strong>${ escapeHtml(
					strings().panelSaveContract || 'Save contract'
				) }:</strong> ${ escapeHtml(
					String( result.saveContractSummary.label )
				) }</div>`
			);
		}

		if ( result.saveContractSummary && result.saveContractSummary.detail ) {
			lines.push(
				`<div><strong>${ escapeHtml(
					strings().panelSaveContractDetail || 'Contract detail'
				) }:</strong> ${ escapeHtml(
					String( result.saveContractSummary.detail )
				) }</div>`
			);
		}

		body.innerHTML = lines.join( '' );
		details.appendChild( summaryNode );
		details.appendChild( body );
		panelNodes.meta.appendChild( details );
	}

	function updateSaveButtonState( panelNodes, canEdit ) {
		const status = getDescriptorStatus(
			state.activeDescriptor,
			state.activeNode
		);
		const needsSharedAck = state.activeRequiresSharedScopeAck;
		const acknowledgementType = state.activeAcknowledgementType;
		const entityType = getDescriptorEntityType( state.activeDescriptor );
		const renderContext = getDescriptorRenderContext(
			state.activeDescriptor,
			state.activeNode
		);
		const isMissingMedia = isMissingMediaMarker( state.activeNode );
		const isCompositeBatch = isActiveCompositeBatchSave();
		const staleBlocked = Boolean( state.activeSaveBlockedByStale );
		const canNoReloadSave =
			! isMissingMedia &&
			! isCompositeBatch &&
			status !== 'readonly' &&
			( renderContext === 'query_collection' ||
				canPatchRenderContextWithoutReload( renderContext ) );
		const offersReloadSave = canNoReloadSave || isMissingMedia;
		const disabled =
			staleBlocked ||
			! canEdit ||
			( needsSharedAck && ! state.sharedScopeAcknowledged );

		if ( panelNodes.saveNoReloadButton ) {
			panelNodes.saveNoReloadButton.hidden = ! canNoReloadSave;
			panelNodes.saveNoReloadButton.textContent =
				strings().panelSave || 'Save';
			panelNodes.saveNoReloadButton.disabled = disabled;
		}

		if ( status === 'readonly' && ! isCompositeBatch ) {
			panelNodes.saveButton.textContent =
				strings().panelInspectOnly || 'Inspect only';
			panelNodes.saveButton.disabled = true;
			return;
		}

		if ( isCompositeBatch ) {
			panelNodes.saveButton.textContent =
				strings().panelCompositeSaveAll || 'Save All';
		} else if ( offersReloadSave ) {
			panelNodes.saveButton.textContent =
				strings().panelSaveAndReload || 'Save and Reload';
		} else if ( needsSharedAck && acknowledgementType === 'related' ) {
			panelNodes.saveButton.textContent =
				resolveRelatedSaveLabel( entityType );
		} else if ( needsSharedAck ) {
			panelNodes.saveButton.textContent =
				resolveSharedSaveLabel( entityType );
		} else {
			panelNodes.saveButton.textContent = strings().panelSave || 'Save';
		}

		panelNodes.saveButton.disabled = disabled;
	}

	function resolvePanelNoticeIndicatorType( descriptor ) {
		const scope = getDescriptorScope( descriptor, state.activeNode );
		const renderContext = getDescriptorRenderContext(
			descriptor,
			state.activeNode
		);

		if ( scope === 'shared_entity' ) {
			return 'shared';
		}

		if ( scope === 'related_entity' ) {
			return 'related';
		}

		if ( renderContext === 'query_collection' ) {
			return 'query';
		}

		return 'current';
	}

	function resolvePanelNoticeIndicatorLabel( type ) {
		if ( type === 'shared' ) {
			return strings().panelNoticeTypeShared || 'Shared';
		}

		if ( type === 'related' ) {
			return strings().panelNoticeTypeRelated || 'Related';
		}

		if ( type === 'query' ) {
			return strings().panelNoticeTypeQuery || 'Query Loop collection';
		}

		return strings().panelNoticeTypeCurrent || 'Current Post';
	}

	function renderPanelNoticeIndicatorIcon( type ) {
		const attrs =
			'aria-hidden="true" focusable="false" viewBox="0 0 24 24"';
		const common =
			'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

		if ( type === 'shared' ) {
			return `<svg ${ attrs }><circle ${ common } cx="12" cy="12" r="9"/><path ${ common } d="M3 12h18"/><path ${ common } d="M12 3c2.5 2.8 3.5 5.8 3.5 9s-1 6.2-3.5 9c-2.5-2.8-3.5-5.8-3.5-9s1-6.2 3.5-9Z"/></svg>`;
		}

		if ( type === 'related' ) {
			return `<svg ${ attrs }><path ${ common } d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path ${ common } d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/></svg>`;
		}

		if ( type === 'query' ) {
			return `<svg ${ attrs }><path ${ common } d="M4 6h16"/><path ${ common } d="M4 12h16"/><path ${ common } d="M4 18h16"/><circle fill="currentColor" cx="7" cy="6" r="1.6"/><circle fill="currentColor" cx="17" cy="12" r="1.6"/><circle fill="currentColor" cx="10" cy="18" r="1.6"/></svg>`;
		}

		return `<svg ${ attrs }><path ${ common } d="M7 3h7l4 4v14H7z"/><path ${ common } d="M14 3v5h5"/><path ${ common } d="M10 13h6"/><path ${ common } d="M10 17h4"/></svg>`;
	}

	function createPanelWarningIndicator( descriptor, warning ) {
		const type = resolvePanelNoticeIndicatorType( descriptor );
		const label = resolvePanelNoticeIndicatorLabel( type );
		const button = document.createElement( 'button' );

		button.type = 'button';
		button.className = 'dbvc-ve-panel__notice-indicator';
		button.dataset.noticeType = type;
		button.title = warning;
		button.setAttribute( 'aria-label', `${ label }: ${ warning }` );
		button.innerHTML = [
			renderPanelNoticeIndicatorIcon( type ),
			`<span class="dbvc-ve-panel__notice-indicator-label">${ escapeHtml(
				label
			) }</span>`,
			`<span class="dbvc-ve-panel__notice-tooltip" role="tooltip">${ escapeHtml(
				warning
			) }</span>`,
		].join( '' );

		return button;
	}

	function renderPanelNotice( result, panelNodes, canEdit ) {
		const descriptor = result.descriptor;
		const warning =
			descriptor.ui && descriptor.ui.warning
				? String( descriptor.ui.warning )
				: '';
		const editMessage = result.editMessage
			? String( result.editMessage )
			: '';
		const noticeSummary =
			result.noticeSummary && typeof result.noticeSummary === 'object'
				? result.noticeSummary
				: null;
		const requiresSharedAck =
			Boolean( result.requiresSharedScopeAck ) && canEdit;
		const acknowledgementType = result.acknowledgementType || 'none';
		const entityType = getDescriptorEntityType( descriptor );

		panelNodes.notice.innerHTML = '';
		if ( panelNodes.footerNotice ) {
			panelNodes.footerNotice.innerHTML = '';
			panelNodes.footerNotice.hidden = true;
		}

		if (
			! warning &&
			! editMessage &&
			! requiresSharedAck &&
			! noticeSummary
		) {
			return;
		}

		if (
			noticeSummary &&
			( noticeSummary.title || noticeSummary.detail )
		) {
			const summaryBlock = document.createElement( 'div' );
			const titleBlock = document.createElement( 'div' );
			const detailBlock = document.createElement( 'div' );

			summaryBlock.className = 'dbvc-ve-panel__notice-block is-context';
			titleBlock.className = 'dbvc-ve-panel__notice-title';
			detailBlock.className = 'dbvc-ve-panel__notice-detail';
			titleBlock.textContent = noticeSummary.title
				? String( noticeSummary.title )
				: '';
			detailBlock.textContent = noticeSummary.detail
				? String( noticeSummary.detail )
				: '';

			if ( titleBlock.textContent ) {
				summaryBlock.appendChild( titleBlock );
			}

			if ( detailBlock.textContent ) {
				summaryBlock.appendChild( detailBlock );
			}

			panelNodes.notice.appendChild( summaryBlock );
		}

		if ( warning ) {
			const warningIndicator = createPanelWarningIndicator(
				descriptor,
				warning
			);

			if ( panelNodes.footerNotice ) {
				panelNodes.footerNotice.appendChild( warningIndicator );
			} else {
				const warningBlock = document.createElement( 'div' );

				warningBlock.className =
					'dbvc-ve-panel__notice-block is-warning';
				warningBlock.textContent = warning;
				panelNodes.notice.appendChild( warningBlock );
			}
		}

		if ( editMessage ) {
			const messageBlock = document.createElement( 'div' );

			messageBlock.className = 'dbvc-ve-panel__notice-block is-muted';
			messageBlock.textContent = editMessage;
			panelNodes.notice.appendChild( messageBlock );
		}

		if ( requiresSharedAck ) {
			const label = document.createElement( 'label' );
			const checkbox = document.createElement( 'input' );
			const text = document.createElement( 'span' );
			const acknowledgementText =
				acknowledgementType === 'related'
					? resolveRelatedAckText( entityType )
					: resolveSharedAckText( entityType );

			label.className = 'dbvc-ve-panel__ack';
			checkbox.type = 'checkbox';
			checkbox.checked = Boolean( state.sharedScopeAcknowledged );
			text.textContent = acknowledgementText;

			checkbox.addEventListener( 'change', function () {
				state.sharedScopeAcknowledged = checkbox.checked;
				updateSaveButtonState( panelNodes, canEdit );
			} );

			label.appendChild( checkbox );
			label.appendChild( text );
			if ( panelNodes.footerNotice ) {
				panelNodes.footerNotice.appendChild( label );
			} else {
				panelNodes.notice.appendChild( label );
			}
		}

		if (
			panelNodes.footerNotice &&
			panelNodes.footerNotice.children.length
		) {
			panelNodes.footerNotice.hidden = false;
		}
	}

	function renderEditorPanel( result ) {
		const span = createPerformanceSpan( 'panel.render' );

		try {
			const descriptor = result.descriptor;
			const panelNodes = getPanelNodes();
			const inputType =
				( descriptor.ui && descriptor.ui.input ) || 'text';
			const controller = createFieldController(
				inputType,
				result.currentValue,
				descriptor,
				result
			);
			const compositeCanEdit = isCompositeBatchSaveReady( result );
			const compositeAckTypes = compositeCanEdit
				? getCompositeAcknowledgementTypes( result )
				: [];
			const compositeAckType =
				resolveCompositeAcknowledgementType( compositeAckTypes );
			const canEdit =
				( Boolean( result.canEdit ) || compositeCanEdit ) &&
				! result.sourceMismatch;
			let statusMessage = '';

			destroyActiveController();
			state.activeController = controller;
			state.activeRequiresSharedScopeAck =
				( Boolean( result.requiresSharedScopeAck ) ||
					compositeAckTypes.length > 0 ) &&
				canEdit;
			state.activeAcknowledgementType =
				compositeAckType !== 'none'
					? compositeAckType
					: result.acknowledgementType || 'none';
			state.activeSaveBlockedByStale = false;
			state.sharedScopeAcknowledged = false;

			if ( result.sourceMismatch ) {
				const renderedValue = result.renderedValue || '';
				const renderedLabel =
					strings().panelRenderedValue || 'Rendered value';
				const resolvedLabel =
					strings().panelResolvedValue || 'Resolved source value';
				const mismatchMessage =
					strings().panelMismatch ||
					'This marker is visible, but saving is disabled because the resolved backend value does not match the rendered page value yet.';
				const resolvedText = extractDisplayText(
					result.displayValue,
					result.displayMode
				);

				statusMessage = `${ mismatchMessage } ${ renderedLabel }: "${ renderedValue }". ${ resolvedLabel }: "${ resolvedText }".`;
				controller.setDisabled( true );
			} else if ( ! canEdit ) {
				controller.setDisabled( true );
				statusMessage = result.editMessage || '';
			}

			panelNodes.panel.dataset.state = canEdit
				? 'ready'
				: getDescriptorStatus( descriptor, state.activeNode ) ===
				  'readonly'
				? 'inspect'
				: 'locked';
			panelNodes.panel.dataset.scope = getDescriptorScope(
				descriptor,
				state.activeNode
			);
			panelNodes.panel.dataset.status = getDescriptorStatus(
				descriptor,
				state.activeNode
			);
			panelNodes.fieldLabel.textContent =
				descriptor.ui && descriptor.ui.label ? descriptor.ui.label : '';
			renderEntityHeader( result, panelNodes );
			renderSourceMeta( result, panelNodes );
			renderPanelNotice(
				compositeCanEdit
					? Object.assign( {}, result, {
							requiresSharedScopeAck:
								compositeAckTypes.length > 0,
							acknowledgementType:
								state.activeAcknowledgementType,
					  } )
					: result,
				panelNodes,
				canEdit
			);
			updateStatusBar( {
				entitySummary:
					result && result.entitySummary
						? result.entitySummary
						: null,
			} );
			panelNodes.fieldWrap.innerHTML = '';
			panelNodes.fieldWrap.appendChild( controller.element );
			if ( typeof controller.mount === 'function' ) {
				controller.mount();
			}
			panelNodes.status.textContent = statusMessage;
			panelNodes.closeButton.textContent =
				strings().panelCancel || 'Close';
			updateSaveButtonState( panelNodes, canEdit );

			if ( state.activeNode ) {
				document
					.querySelectorAll( '.dbvc-ve-target.is-active' )
					.forEach( function ( node ) {
						node.classList.remove( 'is-active' );
					} );
				state.activeNode.classList.add( 'is-active' );
			}

			scheduleBadgeLayout();
			schedulePanelViewportClamp();

			if ( canEdit ) {
				controller.focus();
			}
		} finally {
			span.end();
		}
	}

	function findMarkers() {
		return measurePerformance( 'markers.scan', function () {
			return Array.from( document.querySelectorAll( '[data-dbvc-ve]' ) );
		} );
	}

	function getMarkerCount() {
		return findMarkers().length;
	}

	function recoverQueryCollectionMarkersFromSession() {
		const span = createPerformanceSpan(
			'markers.recover_query_collections'
		);

		try {
			if (
				! state.session ||
				! state.session.descriptors ||
				typeof state.session.descriptors !== 'object'
			) {
				return;
			}

			Object.keys( state.session.descriptors ).forEach(
				function ( token ) {
					const descriptor = state.session.descriptors[ token ];
					const index =
						descriptor && descriptor.index ? descriptor.index : {};
					const queryElementId =
						typeof index.queryElementId === 'string'
							? index.queryElementId
							: '';

					if (
						! queryElementId ||
						index.renderContext !== 'query_collection'
					) {
						return;
					}

					if (
						document.querySelector(
							`[data-dbvc-ve="${ escapeCssValue( token ) }"]`
						)
					) {
						return;
					}

					const marker =
						document.querySelector(
							`[data-query-element-id="${ escapeCssValue(
								queryElementId
							) }"]`
						) || findLoopCommentParent( queryElementId );
					if ( ! marker || marker.getAttribute( 'data-dbvc-ve' ) ) {
						return;
					}

					marker.setAttribute( 'data-dbvc-ve', token );
					marker.setAttribute(
						'data-dbvc-ve-status',
						descriptor.status || 'editable'
					);
					marker.setAttribute(
						'data-dbvc-ve-scope',
						mapDescriptorScopeToMarker(
							descriptor.scope || 'current_entity'
						)
					);
					marker.setAttribute(
						'data-dbvc-ve-context',
						'query_collection'
					);
					marker.setAttribute(
						'data-dbvc-ve-query-element-id',
						queryElementId
					);

					if ( ! marker.hasAttribute( 'data-query-element-id' ) ) {
						marker.setAttribute(
							'data-dbvc-ve-empty-loop-container',
							'1'
						);
					}

					if ( descriptor.badgeLabel ) {
						marker.setAttribute(
							'data-dbvc-ve-badge-label',
							descriptor.badgeLabel
						);
					}

					if ( descriptor.input ) {
						marker.setAttribute(
							'data-dbvc-ve-input',
							descriptor.input
						);
					}
				}
			);
		} finally {
			span.end();
		}
	}

	function mountMarkerNode( node ) {
		if ( ! node || ! node.dataset || node.dataset.dbvcVeMounted === '1' ) {
			return;
		}

		node.dataset.dbvcVeMounted = '1';
		node.classList.add( 'dbvc-ve-target' );
		if ( node.dataset.dbvcVeScope === 'shared' ) {
			node.classList.add( 'is-shared' );
		} else if ( node.dataset.dbvcVeScope === 'related' ) {
			node.classList.add( 'is-related' );
		}
		if ( node.dataset.dbvcVeStatus === 'readonly' ) {
			node.classList.add( 'is-readonly' );
		}
		node.dataset.dbvcVeDisplayValue = normalizeValue(
			readNodeComparableValue( node, lookupDescriptorForNode( node ) )
		);
	}

	function refreshQueryCollectionBadges() {
		if ( ! state.session ) {
			return;
		}

		recoverQueryCollectionMarkersFromSession();
		const markers = findMarkers();
		markers.forEach( mountMarkerNode );
		mountQueryCollectionContainerBadges( markers );
		scheduleBadgeLayout();
	}

	function scheduleQueryCollectionBadgeRefresh( delay ) {
		if ( state.queryCollectionBadgeRefreshTimer ) {
			window.clearTimeout( state.queryCollectionBadgeRefreshTimer );
		}

		state.queryCollectionBadgeRefreshTimer = window.setTimeout(
			function () {
				state.queryCollectionBadgeRefreshTimer = 0;
				refreshQueryCollectionBadges();
			},
			typeof delay === 'number' ? delay : 100
		);
	}

	function startQueryCollectionBadgeObserver() {
		if (
			state.queryCollectionBadgeObserver ||
			typeof window.MutationObserver !== 'function'
		) {
			return;
		}

		state.queryCollectionBadgeObserver = new window.MutationObserver(
			function ( mutations ) {
				if (
					mutations.some( function ( mutation ) {
						if ( mutation.type === 'attributes' ) {
							return (
								mutation.target &&
								mutation.target.nodeType === 1 &&
								( mutation.target.hasAttribute(
									'data-dbvc-ve'
								) ||
									mutation.target.hasAttribute(
										'data-query-element-id'
									) )
							);
						}

						return Array.from( mutation.addedNodes || [] ).some(
							function ( node ) {
								return (
									node &&
									node.nodeType === 1 &&
									( node.hasAttribute( 'data-dbvc-ve' ) ||
										node.hasAttribute(
											'data-query-element-id'
										) ||
										( typeof node.querySelector ===
											'function' &&
											node.querySelector(
												'[data-dbvc-ve], [data-query-element-id]'
											) ) )
								);
							}
						);
					} )
				) {
					scheduleQueryCollectionBadgeRefresh( 120 );
				}
			}
		);

		state.queryCollectionBadgeObserver.observe( document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: [
				'data-dbvc-ve',
				'data-dbvc-ve-context',
				'data-query-element-id',
			],
		} );
	}

	function getActiveSyncGroup() {
		return state.activeDescriptor &&
			state.activeDescriptor.render &&
			typeof state.activeDescriptor.render.sync_group === 'string'
			? state.activeDescriptor.render.sync_group
			: '';
	}

	function getActiveSourceGroup() {
		return getDescriptorSourceGroup( state.activeDescriptor );
	}

	function setNodeDisplayValue(
		node,
		displayValue,
		displayMode,
		descriptor,
		currentValue
	) {
		const mode = displayMode || 'text';
		const nextValue = typeof displayValue === 'string' ? displayValue : '';
		const context = getDescriptorRenderContext( descriptor, node );

		if ( context === 'link_href' ) {
			const attribute =
				getDescriptorRenderAttribute( descriptor, node ) || 'href';

			if ( nextValue ) {
				node.setAttribute( attribute, nextValue );
			} else {
				node.removeAttribute( attribute );
			}

			node.dataset.dbvcVeDisplayValue = normalizeValue( nextValue );
			return;
		}

		if ( context === 'image_src' ) {
			const attribute =
				getDescriptorRenderAttribute( descriptor, node ) || 'src';
			const renderData = resolveMediaReferenceRenderData(
				currentValue,
				descriptor
			);
			const nextSrc = renderData.src || nextValue;
			const shouldClearMedia =
				! nextSrc && isEmptyMediaReferenceRenderData( renderData );

			if ( shouldClearMedia ) {
				clearRenderedImageMediaNode( node, attribute );
				return;
			}

			restoreClearedMediaState( node );

			const imageNode = ensureRenderedImageElement( node );

			if ( imageNode ) {
				if ( nextSrc ) {
					imageNode.setAttribute( attribute, nextSrc );
				} else {
					imageNode.removeAttribute( attribute );
				}

				if ( renderData.srcset ) {
					imageNode.setAttribute( 'srcset', renderData.srcset );
				} else {
					imageNode.removeAttribute( 'srcset' );
				}

				if ( renderData.sizes ) {
					imageNode.setAttribute( 'sizes', renderData.sizes );
				} else {
					imageNode.removeAttribute( 'sizes' );
				}

				if ( renderData.alt ) {
					imageNode.setAttribute( 'alt', renderData.alt );
				} else {
					imageNode.removeAttribute( 'alt' );
				}
			}

			node.dataset.dbvcVeDisplayValue = normalizeValue( nextSrc );
			scheduleBadgeLayout();
			return;
		}

		if ( context === 'background_image' ) {
			const renderData = resolveMediaReferenceRenderData(
				currentValue,
				descriptor
			);
			const nextBackground = renderData.src || nextValue;
			const shouldClearMedia =
				! nextBackground &&
				isEmptyMediaReferenceRenderData( renderData );

			node.style.backgroundImage = nextBackground
				? `url("${ nextBackground.replace( /"/g, '\\"' ) }")`
				: '';
			node.classList.toggle( 'dbvc-ve-media-cleared', shouldClearMedia );
			node.dataset.dbvcVeDisplayValue = normalizeValue( nextBackground );
			scheduleBadgeLayout();
			return;
		}

		if ( context === 'gallery_collection' ) {
			patchGalleryCollectionNode( node, currentValue, descriptor );
			node.dataset.dbvcVeDisplayValue = normalizeValue( nextValue );
			scheduleBadgeLayout();
			return;
		}

		const projected = projectDisplayValueForDescriptor(
			descriptor,
			nextValue,
			mode
		);
		const patchValue = projected.value;
		const patchMode = projected.mode;
		const children = Array.from( node.childNodes );

		children.forEach( function ( child ) {
			node.removeChild( child );
		} );

		if ( patchMode === 'html' ) {
			const wrapper = document.createElement( 'div' );

			wrapper.innerHTML = patchValue;

			while ( wrapper.firstChild ) {
				node.appendChild( wrapper.firstChild );
			}
		} else {
			node.appendChild( document.createTextNode( patchValue ) );
		}

		node.dataset.dbvcVeDisplayValue = extractDisplayText(
			patchValue,
			patchMode
		);
		scheduleBadgeLayout();
	}

	function syncSavedDisplayValues( syncGroup, sourceGroup, saveResult ) {
		const activeContext = getDescriptorRenderContext(
			state.activeDescriptor,
			state.activeNode
		);
		const activeMediaSize = getDescriptorMediaSize(
			state.activeDescriptor
		);
		const nodes = sourceGroup
			? findMarkers().filter( function ( node ) {
					if ( node.dataset.dbvcVeSourceGroup !== sourceGroup ) {
						return false;
					}

					if ( isMediaRenderContext( activeContext ) ) {
						const descriptor = lookupDescriptorForNode( node );

						return (
							getDescriptorRenderContext( descriptor, node ) ===
								activeContext &&
							getDescriptorMediaSize( descriptor ) ===
								activeMediaSize
						);
					}

					if ( activeContext === 'gallery_collection' ) {
						const descriptor = lookupDescriptorForNode( node );

						return (
							getDescriptorRenderContext( descriptor, node ) ===
							'gallery_collection'
						);
					}

					return true;
			  } )
			: syncGroup
			? findMarkers().filter( function ( node ) {
					return node.dataset.dbvcVeGroup === syncGroup;
			  } )
			: [];

		if ( ! nodes.length ) {
			if ( state.activeNode ) {
				const activeProjection = resolveDisplayProjection(
					state.activeDescriptor,
					saveResult
				);
				const activePayload = state.activeDescriptor
					? getCachedDescriptorPayload( state.activeDescriptor.token )
					: null;

				setNodeDisplayValue(
					state.activeNode,
					activeProjection.value,
					activeProjection.mode,
					state.activeDescriptor,
					activePayload
						? activePayload.currentValue
						: saveResult.value
				);
			}

			return;
		}

		nodes.forEach( function ( node ) {
			const descriptor = lookupDescriptorForNode( node );
			if (
				getDescriptorRenderContext( descriptor, node ) === 'text' &&
				getDescriptorTextProjection( descriptor, node ) ===
					'single_embedded' &&
				! hasHydratedDescriptorForNode( node, descriptor )
			) {
				return;
			}

			const projection = resolveDisplayProjection(
				descriptor,
				saveResult
			);
			const payload = descriptor
				? getCachedDescriptorPayload( descriptor.token )
				: null;

			setNodeDisplayValue(
				node,
				projection.value,
				projection.mode,
				descriptor,
				payload ? payload.currentValue : saveResult.value
			);
		} );
	}

	function updateCachedCompositePayload( saveResult ) {
		if (
			! state.activeDescriptor ||
			! saveResult ||
			! Array.isArray( saveResult.children )
		) {
			return;
		}

		const payload = getCachedDescriptorPayload(
			state.activeDescriptor.token
		);
		if (
			! payload ||
			! payload.compositeText ||
			! Array.isArray( payload.compositeText.children )
		) {
			return;
		}

		const childrenByIndex = {};

		saveResult.children.forEach( function ( child ) {
			if ( ! child || typeof child !== 'object' ) {
				return;
			}

			const index = Number( child.index );
			if ( Number.isFinite( index ) ) {
				childrenByIndex[ index ] = child;
			}
		} );

		payload.compositeText.children.forEach( function ( child ) {
			const index = Number( child && child.index );
			const savedChild = Number.isFinite( index )
				? childrenByIndex[ index ]
				: null;

			if ( ! savedChild ) {
				return;
			}

			child.currentValue = savedChild.value;
			child.displayValue = savedChild.displayValue;
			child.displayMode = savedChild.displayMode;
			if ( savedChild.sourceSummary ) {
				child.sourceSummary = clonePayload( savedChild.sourceSummary );
			}
			if ( savedChild.entitySummary ) {
				child.entitySummary = clonePayload( savedChild.entitySummary );
			}
			if ( savedChild.saveSummary ) {
				child.saveSummary = clonePayload( savedChild.saveSummary );
			}
		} );

		const html = buildCompositeHtmlFromSegments(
			payload.compositeText.segments,
			buildCompositeValuesByIndex( saveResult.children, true )
		);

		payload.compositeText.previewText =
			normalizeCompositeHtmlToText( html );
	}

	function patchCompositeTextNode( saveResult ) {
		if (
			! state.activeController ||
			typeof state.activeController.buildPatchedHtml !== 'function'
		) {
			return '';
		}

		const activeNode =
			state.activeNode && state.activeNode.isConnected
				? state.activeNode
				: null;
		const targetNode =
			activeNode ||
			( state.activeDescriptor
				? findMarkerByToken( state.activeDescriptor.token )
				: null );
		if ( ! targetNode ) {
			return '';
		}

		const html = state.activeController.buildPatchedHtml( saveResult );

		targetNode.innerHTML = html;
		targetNode.dataset.dbvcVeDisplayValue = normalizeValue(
			normalizeCompositeHtmlToText( html )
		);
		scheduleBadgeLayout();

		return html;
	}

	async function openToolbarDescriptorPanel( token ) {
		const panelNodes = getPanelNodes();
		const cached = getCachedDescriptorPayload( token );
		let session = state.session;
		const span = createPerformanceSpan( 'panel.open.toolbar' );

		try {
			if ( ! token ) {
				return;
			}

			setPanelOpen( true );
			destroyActiveController();
			state.activeController = null;
			panelNodes.panel.dataset.state = 'loading';
			panelNodes.title.textContent = strings().panelTitle || 'Edit field';
			panelNodes.entityType.textContent = '';
			panelNodes.entityLinks.innerHTML = '';
			panelNodes.meta.innerHTML = '';
			panelNodes.notice.innerHTML = '';
			if ( panelNodes.footerNotice ) {
				panelNodes.footerNotice.innerHTML = '';
				panelNodes.footerNotice.hidden = true;
			}
			panelNodes.fieldLabel.textContent = '';
			panelNodes.fieldWrap.innerHTML =
				'<div class="dbvc-ve-panel__placeholder"></div>';
			panelNodes.fieldWrap.firstChild.textContent =
				strings().panelLoading || 'Loading field details...';
			panelNodes.status.textContent = '';
			panelNodes.saveNoReloadButton.hidden = true;
			panelNodes.saveNoReloadButton.disabled = true;
			panelNodes.saveButton.disabled = true;
			schedulePanelViewportClamp();

			state.activeNode = null;
			state.activeDescriptor = null;
			state.activeRequiresSharedScopeAck = false;
			state.activeAcknowledgementType = 'none';
			state.activeSaveBlockedByStale = false;
			state.sharedScopeAcknowledged = false;
			state.touchSelectionToken = token;
			clearDescriptorPrefetch();

			if ( shouldRefreshSessionBeforeAction() ) {
				try {
					session = await refreshSession( {
						silent: true,
						touchOnly: true,
					} );
				} catch ( error ) {
					panelNodes.panel.dataset.state = 'error';
					panelNodes.status.textContent =
						error && error.message
							? error.message
							: getSessionExpiredMessage();
					schedulePanelViewportClamp();
					window.console.error( error );
					return;
				}
			}

			if ( ! session || ! session.sessionId ) {
				panelNodes.panel.dataset.state = 'error';
				panelNodes.status.textContent = getSessionExpiredMessage();
				schedulePanelViewportClamp();
				return;
			}

			if ( cached && cached.ok && cached.descriptor ) {
				cached.sourceMismatch = false;
				cached.renderedValue = cached.displayValue || '';
				state.activeDescriptor = cached.descriptor;
				renderEditorPanel( cached );
				return;
			}

			try {
				const result = await loadDescriptorPayload(
					session.sessionId,
					token
				);
				result.sourceMismatch = false;
				result.renderedValue = result.displayValue || '';
				state.activeDescriptor = result.descriptor;
				renderEditorPanel( result );
			} catch ( error ) {
				if ( isSessionExpiredError( error ) ) {
					handleExpiredSession( error );
				}

				panelNodes.panel.dataset.state = 'error';
				panelNodes.status.textContent =
					error && error.message
						? error.message
						: strings().descriptorMissing ||
						  'Descriptor not found.';
				schedulePanelViewportClamp();
				window.console.error( error );
			}
		} finally {
			span.end();
		}
	}

	async function openEditor( node, session ) {
		const token = getMarkerToken( node );
		const panelNodes = getPanelNodes();
		const cached = getCachedDescriptorPayload( token );
		const span = createPerformanceSpan( 'panel.open.marker' );

		try {
			setPanelOpen( true );
			destroyActiveController();
			state.activeController = null;
			panelNodes.panel.dataset.state = 'loading';
			panelNodes.title.textContent = strings().panelTitle || 'Edit field';
			panelNodes.entityType.textContent = '';
			panelNodes.entityLinks.innerHTML = '';
			panelNodes.meta.innerHTML = '';
			panelNodes.notice.innerHTML = '';
			if ( panelNodes.footerNotice ) {
				panelNodes.footerNotice.innerHTML = '';
				panelNodes.footerNotice.hidden = true;
			}
			panelNodes.fieldLabel.textContent = '';
			panelNodes.fieldWrap.innerHTML =
				'<div class="dbvc-ve-panel__placeholder"></div>';
			panelNodes.fieldWrap.firstChild.textContent =
				strings().panelLoading || 'Loading field details…';
			panelNodes.status.textContent = '';
			panelNodes.saveNoReloadButton.hidden = true;
			panelNodes.saveNoReloadButton.disabled = true;
			panelNodes.saveButton.disabled = true;
			schedulePanelViewportClamp();

			state.activeNode = node;
			state.activeDescriptor = null;
			state.activeRequiresSharedScopeAck = false;
			state.activeAcknowledgementType = 'none';
			state.activeSaveBlockedByStale = false;
			state.sharedScopeAcknowledged = false;
			state.touchSelectionToken = token;
			clearDescriptorPrefetch();

			if ( shouldRefreshSessionBeforeAction() ) {
				try {
					session = await refreshSession( {
						silent: true,
						touchOnly: true,
					} );
				} catch ( error ) {
					panelNodes.panel.dataset.state = 'error';
					panelNodes.status.textContent =
						error && error.message
							? error.message
							: getSessionExpiredMessage();
					schedulePanelViewportClamp();
					window.console.error( error );
					return;
				}
			}

			if ( cached && cached.ok && cached.descriptor ) {
				cached.sourceMismatch = hasSourceMismatch( node, cached );
				cached.renderedValue = getNodeDisplayValue(
					node,
					cached.descriptor
				);
				state.activeDescriptor = cached.descriptor;
				renderEditorPanel( cached );
				return;
			}

			try {
				const result = await loadDescriptorPayload(
					session.sessionId,
					token
				);
				result.sourceMismatch = hasSourceMismatch( node, result );
				result.renderedValue = getNodeDisplayValue(
					node,
					result.descriptor
				);
				state.activeDescriptor = result.descriptor;
				renderEditorPanel( result );
			} catch ( error ) {
				if ( isSessionExpiredError( error ) ) {
					handleExpiredSession( error );
				}

				panelNodes.panel.dataset.state = 'error';
				panelNodes.status.textContent =
					error && error.message
						? error.message
						: strings().descriptorMissing ||
						  'Descriptor not found.';
				schedulePanelViewportClamp();
				window.console.error( error );
			}
		} finally {
			span.end();
		}
	}

	async function handleSave( options ) {
		const saveOptions =
			options && typeof options === 'object' ? options : {};
		const panelNodes = getPanelNodes();

		if (
			! state.session ||
			! state.activeDescriptor ||
			! state.activeController
		) {
			return;
		}

		// R5.later-y-2 (2026-09-05) — palette overview panels save
		// per-swatch inline, not via this whole-panel Save button.
		// getValue() returns null for palette_grid controllers; passing
		// null to the save endpoint would risk zeroing a color, so we
		// short-circuit before reaching the API call. The palette panel
		// header already carries a "saves automatically" hint so users
		// aren't confused by the disabled-looking Save button.
		if (
			state.activeDescriptor.render &&
			state.activeDescriptor.render.input === 'palette_grid'
		) {
			return;
		}

		const token = state.activeDescriptor.token;
		const value = state.activeController.getValue();
		const baseValues =
			typeof state.activeController.getBaseValues === 'function'
				? state.activeController.getBaseValues()
				: [];
		const acknowledgeSharedScope =
			! state.activeRequiresSharedScopeAck ||
			state.sharedScopeAcknowledged;
		const isCompositeSave = isActiveCompositeBatchSave();

		if ( ! acknowledgeSharedScope ) {
			panelNodes.panel.dataset.state = 'locked';
			const entityType = getDescriptorEntityType(
				state.activeDescriptor
			);
			panelNodes.status.textContent =
				state.activeAcknowledgementType === 'related'
					? resolveRelatedRequiredText( entityType )
					: resolveSharedRequiredText( entityType );
			schedulePanelViewportClamp();
			return;
		}

		panelNodes.panel.dataset.state = 'saving';
		panelNodes.status.textContent = strings().panelSaving || 'Saving…';
		panelNodes.saveButton.disabled = true;
		if ( panelNodes.saveNoReloadButton ) {
			panelNodes.saveNoReloadButton.disabled = true;
		}
		state.activeController.setDisabled( true );
		state.saveInFlight = true;
		const span = createPerformanceSpan( 'save.request' );

		try {
			if ( shouldRefreshSessionBeforeAction() ) {
				await refreshSession( { silent: true, touchOnly: true } );
			}

			const saveResult = isCompositeSave
				? await window.DBVCVisualEditorApi.saveComposite(
						state.session.sessionId,
						token,
						value,
						{
							baseValues,
							acknowledgeCompositeScope: acknowledgeSharedScope,
							acknowledgements: {
								related:
									state.activeAcknowledgementType ===
										'related' && acknowledgeSharedScope,
								shared:
									state.activeAcknowledgementType ===
										'shared' && acknowledgeSharedScope,
							},
						}
				  )
				: await window.DBVCVisualEditorApi.save(
						state.session.sessionId,
						token,
						value,
						acknowledgeSharedScope
				  );
			const syncGroup = getActiveSyncGroup();
			const sourceGroup = getActiveSourceGroup();
			const activeContext = getDescriptorRenderContext(
				state.activeDescriptor,
				state.activeNode
			);
			const activeMissingMedia = isMissingMediaMarker( state.activeNode );
			const canPatchWithoutReload =
				! activeMissingMedia &&
				canPatchRenderContextWithoutReload( activeContext );
			const canDeferReload =
				activeContext === 'query_collection' || canPatchWithoutReload;
			const shouldReloadAfterSave =
				activeMissingMedia ||
				( ( activeContext === 'query_collection' ||
					canPatchWithoutReload ) &&
					saveOptions.reloadAfterSave !== false );
			const saveSummaryMessage = isCompositeSave
				? ''
				: formatSaveSummary( saveResult );
			let successMessage =
				saveSummaryMessage ||
				( saveResult && saveResult.message
					? saveResult.message
					: strings().panelSaved || 'Saved successfully.' );

			if ( isCompositeSave ) {
				// R4-D-1: dispatch panel:saved for composite saves too so
				// the drawer's save-status-strip lights up regardless of
				// which save button was clicked. See non-composite path
				// below for the full rationale.
				dispatchPanelSaved( token );

				const activePayload = state.activeDescriptor
					? getCachedDescriptorPayload( state.activeDescriptor.token )
					: null;
				const patchedHtml = patchCompositeTextNode( saveResult );

				updateCachedCompositePayload( saveResult );
				state.activeController.setValue( saveResult );
				state.activeController.setDisabled( false );
				panelNodes.panel.dataset.state = 'saved';
				panelNodes.status.textContent = patchedHtml
					? strings().panelCompositeSavedNoReload ||
					  successMessage ||
					  'Composite fields saved and updated on the page.'
					: successMessage ||
					  strings().panelSaved ||
					  'Saved successfully.';
				updateSaveButtonState( panelNodes, true );
				schedulePanelViewportClamp();
				updateStatusBar( {
					kind: 'ready',
					count: getMarkerCount(),
					message: panelNodes.status.textContent,
					entitySummary:
						activePayload && activePayload.entitySummary
							? activePayload.entitySummary
							: null,
				} );

				if ( saveOptions.closeAfterSave ) {
					closeEditorPanel();
				}

				return;
			}

			if ( shouldReloadAfterSave ) {
				if ( activeContext === 'query_collection' ) {
					successMessage =
						strings().panelCollectionReloading ||
						'Connected items saved. Reloading page…';
				} else if (
					activeContext === 'gallery_collection' ||
					( activeMissingMedia &&
						getMissingMediaKind( state.activeNode ) === 'gallery' )
				) {
					successMessage =
						strings().panelGalleryReloading ||
						'Gallery saved. Reloading page…';
				} else {
					successMessage =
						strings().panelMediaReloading ||
						'Image saved. Reloading page…';
				}
			} else if ( canDeferReload ) {
				if ( activeContext === 'gallery_collection' ) {
					successMessage =
						strings().panelGallerySavedNoReload ||
						'Gallery saved. Reload when ready to rebuild the full gallery markup.';
				} else if ( isMediaRenderContext( activeContext ) ) {
					successMessage =
						strings().panelMediaSavedNoReload ||
						'Image saved and updated on the page.';
				} else {
					successMessage =
						strings().panelCollectionSavedNoReload ||
						'Connected items saved. Reload when ready to refresh this query loop.';
				}
			}

			updateCachedDescriptors( syncGroup, sourceGroup, saveResult );
			applyCollectionStateToCachedDescriptors( saveResult );
			if (
				! shouldReloadAfterSave &&
				( canPatchWithoutReload || ! canDeferReload )
			) {
				syncSavedDisplayValues( syncGroup, sourceGroup, saveResult );
			}
			state.activeController.setValue( saveResult.value );
			state.activeController.setDisabled( false );
			if ( saveResult && saveResult.entitySummary ) {
				renderEntityHeader( saveResult, panelNodes );
			}
			if ( saveResult && saveResult.sourceSummary ) {
				renderSourceMeta( saveResult, panelNodes );
			}
			panelNodes.panel.dataset.state = 'saved';
			panelNodes.status.textContent = successMessage;
			updateSaveButtonState( panelNodes, true );
			schedulePanelViewportClamp();
			updateStatusBar( {
				kind: 'ready',
				count: getMarkerCount(),
				message: successMessage,
				entitySummary:
					saveResult && saveResult.entitySummary
						? saveResult.entitySummary
						: null,
			} );

			// R4-D-1: notify any listener (currently the Brand Control
			// Center drawer's save-status-strip) that this descriptor was
			// just saved. Dispatch is unconditional + fail-safe — the
			// drawer's listener gates on `state.activeToken === detail.token`
			// so events for descriptors the drawer did not open are dropped
			// there. The dispatch runs BEFORE the shouldReloadAfterSave
			// window.location.reload so the drawer has one tick to render
			// its confirmation strip when the reload path is taken.
			dispatchPanelSaved( token );

			if ( shouldReloadAfterSave ) {
				state.reloadPending = true;
				window.setTimeout( function () {
					window.location.reload();
				}, 250 );
			} else if ( canDeferReload && saveOptions.closeAfterSave ) {
				closeEditorPanel();
			}
		} catch ( error ) {
			if ( isSessionExpiredError( error ) ) {
				handleExpiredSession( error );
			}

			if ( isCompositeSave && isCompositeStaleError( error ) ) {
				const staleMessage =
					error && error.message
						? error.message
						: strings().panelCompositeStale ||
						  'Composite save was blocked because one child field changed after this panel was loaded. Close and reopen the field details before saving again.';

				state.activeSaveBlockedByStale = true;
				clearDescriptorPayload( token );
				panelNodes.panel.dataset.state = 'stale';
				panelNodes.status.textContent = staleMessage;
				if ( state.activeController ) {
					state.activeController.setDisabled( false );
				}
				panelNodes.saveButton.disabled = true;
				if ( panelNodes.saveNoReloadButton ) {
					panelNodes.saveNoReloadButton.disabled = true;
				}
				schedulePanelViewportClamp();
				updateStatusBar( {
					kind: 'error',
					count: getMarkerCount(),
					message: staleMessage,
				} );
				return;
			}

			panelNodes.panel.dataset.state = 'error';
			panelNodes.status.textContent =
				error && error.message
					? error.message
					: strings().saveFailed || 'Save failed.';
			schedulePanelViewportClamp();

			if ( state.activeController ) {
				state.activeController.setDisabled( false );
			}

			updateSaveButtonState( panelNodes, true );

			window.console.error( error );
		} finally {
			span.end();
			state.saveInFlight = false;
			if ( ! state.reloadPending ) {
				scheduleViewportPrefetch();
			}
		}
	}

	async function mount() {
		const bootSpan = createPerformanceSpan( 'overlay_boot' );

		try {
			if (
				! window.DBVCVisualEditorBootstrap ||
				! window.DBVCVisualEditorBootstrap.active
			) {
				return;
			}

			document.body.classList.add( 'dbvc-ve-active' );
			ensureToolbar();
			ensureStatusBar();
			ensureEditorPanel();
			ensureBadgeLayer();
			ensureSharedBadge();
			bindBadgeEvents();
			bindControlCenterBridge();

			const markers = findMarkers();
			if ( ! markers.length ) {
				updateStatusBar( {
					kind: 'empty',
					count: 0,
					message:
						strings().zeroMarkers ||
						'No supported editable nodes were detected on this page yet.',
				} );
				return;
			}

			let session;

			try {
				session = await measurePerformance(
					'session.public_map_request',
					function () {
						return window.DBVCVisualEditorApi.getSession(
							DBVCVisualEditorBootstrap.sessionId
						);
					}
				);
			} catch ( error ) {
				window.console.error( error );
			}

			if ( ! session || ! session.ok || ! session.sessionId ) {
				window.console.warn(
					strings().sessionMissing ||
						'Visual Editor session not found for this page.'
				);
				updateStatusBar( {
					kind: 'error',
					count: markers.length,
					message:
						strings().sessionUnavailable ||
						strings().sessionExpired ||
						'Markers were found, but the descriptor session was unavailable for this request.',
				} );
				return;
			}

			measurePerformance( 'session.public_map_sync', function () {
				syncSessionPayload( session );
			} );
			recoverQueryCollectionMarkersFromSession();
			const mountedMarkers = findMarkers();
			startSessionKeepalive();
			startViewportPrefetch( mountedMarkers );

			if ( state.previewNode ) {
				scheduleDescriptorPrefetch( state.previewNode );
			}

			updateStatusBar( {
				kind: 'ready',
				count: mountedMarkers.length,
				message: '',
			} );

			measurePerformance( 'markers.mount', function () {
				mountedMarkers.forEach( mountMarkerNode );
			} );

			measurePerformance( 'badges.query_collection_mount', function () {
				mountQueryCollectionContainerBadges( mountedMarkers );
			} );
			startQueryCollectionBadgeObserver();
			[ 250, 1000, 2500 ].forEach( function ( delay ) {
				window.setTimeout( refreshQueryCollectionBadges, delay );
			} );
			scheduleBadgeLayout();
		} finally {
			bootSpan.end();
		}
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', mount );
	} else {
		mount();
	}
} )();
