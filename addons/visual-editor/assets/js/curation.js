(function () {
    'use strict';

    if (typeof window.DBVC_VE_CURATION === 'undefined') {
        return;
    }

    var config = window.DBVC_VE_CURATION;
    var i18n = (config && config.i18n) || {};
    var doc = document;

    function postForm(action, payload, onDone) {
        var body = new URLSearchParams();
        body.append('action', action);
        body.append('nonce', config.nonce);
        Object.keys(payload || {}).forEach(function (key) {
            var value = payload[key];
            if (Array.isArray(value)) {
                value.forEach(function (item) {
                    body.append(key + '[]', String(item));
                });
                return;
            }
            if (value !== null && typeof value === 'object') {
                Object.keys(value).forEach(function (subKey) {
                    body.append(key + '[' + subKey + ']', String(value[subKey]));
                });
                return;
            }
            if (typeof value !== 'undefined' && value !== null) {
                body.append(key, String(value));
            }
        });

        fetch(config.ajaxUrl, {
            method: 'POST',
            credentials: 'same-origin',
            body: body
        }).then(function (response) {
            return response.json().catch(function () { return null; });
        }).then(function (json) {
            onDone(null, json);
        }).catch(function (error) {
            onDone(error, null);
        });
    }

    function readRowDecision(row) {
        // R5.later-a.3 + R5.later-a.6: `palette_group_key` and
        // `palette_display_label` starters default to '' so a curator
        // clearing either field sends the empty value (unset) rather than
        // omitting the key (preserve — CurationStore.setDecision merges,
        // so an omitted key would leave any previous value in place,
        // which is not what "cleared" should mean).
        var decision = {
            decision: '',
            client_priority: '',
            category: '',
            notes: '',
            palette_group_key: '',
            palette_display_label: ''
        };
        var fields = row.querySelectorAll('[data-dbvc-ve-curation="field"]');
        fields.forEach(function (input) {
            var name = input.dataset.field;
            if (!name) {
                return;
            }
            if (input.type === 'radio') {
                if (input.checked) {
                    decision[name] = input.value;
                }
                return;
            }
            decision[name] = input.value;
        });

        return decision;
    }

    var ROW_SAVE_STATE_CLASSES = ['is-saving', 'is-saved', 'is-save-error'];

    function setRowStatus(row, message, kind) {
        // Keep the aria-live text updated so screen readers still hear
        // "Saving…" / "Saved" / "Save failed". Visually the element is
        // hidden by curation.css and every save state is expressed as a
        // row-level background pulse so nothing shifts layout.
        var status = row.querySelector('[data-dbvc-ve-curation="row-status"]');
        if (status) {
            status.textContent = message || '';
        }

        ROW_SAVE_STATE_CLASSES.forEach(function (cls) {
            row.classList.remove(cls);
        });

        if (kind === 'pending') {
            row.classList.add('is-saving');
            return; // Persist until the AJAX response flips it to ok/error.
        }
        if (kind === 'ok') {
            row.classList.add('is-saved');
        } else if (kind === 'error') {
            row.classList.add('is-save-error');
        } else {
            return;
        }

        // Auto-clear the terminal states after a short window; the
        // saved-pulse keyframe finishes at 900ms, error/pending stay a
        // beat longer so a misfire is noticeable without lingering.
        var lingerMs = kind === 'error' ? 2200 : 1200;
        setTimeout(function () {
            row.classList.remove('is-saved', 'is-save-error');
            if (status && status.textContent === message) {
                status.textContent = '';
            }
        }, lingerMs);
    }

    function applyRowStateClass(row, decisionValue) {
        row.classList.remove('is-include', 'is-ignore', 'is-defer', 'is-undecided');
        row.classList.add('is-' + (decisionValue || 'undecided'));
    }

    function syncRowFilterAttrs(row) {
        // Keep filterable data-* attributes in lockstep with the row's inline
        // controls so the client-side filter engine sees the latest values
        // without a page reload.
        var categoryEl = row.querySelector('[data-dbvc-ve-curation="field"][data-field="category"]');
        if (categoryEl) {
            row.setAttribute('data-category', categoryEl.value || '');
        }
        var checkedDecision = row.querySelector('[data-dbvc-ve-curation="field"][data-field="decision"]:checked');
        row.setAttribute('data-decision', checkedDecision ? checkedDecision.value : 'undecided');
    }

    function readFilterState(form) {
        if (!form) {
            return {};
        }
        return {
            options_page: (form.elements.options_page && form.elements.options_page.value) || '',
            field_type: (form.elements.field_type && form.elements.field_type.value) || '',
            group_key: (form.elements.group_key && form.elements.group_key.value) || '',
            decision: (form.elements.decision && form.elements.decision.value) || '',
            recommendation: (form.elements.recommendation && form.elements.recommendation.value) || '',
            category: (form.elements.category && form.elements.category.value) || '',
            search: ((form.elements.search && form.elements.search.value) || '').toLowerCase()
        };
    }

    function rowMatchesFilter(row, filter) {
        if (filter.options_page && row.getAttribute('data-options-page') !== filter.options_page) {
            return false;
        }
        if (filter.field_type && row.getAttribute('data-field-type') !== filter.field_type) {
            return false;
        }
        if (filter.group_key && row.getAttribute('data-group-key') !== filter.group_key) {
            return false;
        }
        if (filter.decision) {
            var current = row.getAttribute('data-decision') || 'undecided';
            if (current !== filter.decision) {
                return false;
            }
        }
        if (filter.recommendation && row.getAttribute('data-recommendation') !== filter.recommendation) {
            return false;
        }
        if (filter.category) {
            // Explicit category chosen on the row overrides the recommender default,
            // but a row that has neither can still be filtered on the recommender's
            // suggestion — so allow either to match.
            var chosen = row.getAttribute('data-category') || '';
            if (chosen !== filter.category) {
                return false;
            }
        }
        if (filter.search) {
            var haystack = row.getAttribute('data-search') || '';
            if (haystack.indexOf(filter.search) === -1) {
                return false;
            }
        }
        return true;
    }

    function applyFilters() {
        var form = doc.querySelector('[data-dbvc-ve-curation="filter-form"]');
        var status = doc.querySelector('[data-dbvc-ve-curation="filter-count"]');
        var noMatch = doc.querySelector('[data-dbvc-ve-curation="no-match"]');
        if (!form) {
            return;
        }
        var filter = readFilterState(form);
        var rows = doc.querySelectorAll('.dbvc-ve-curation__row');
        var total = rows.length;
        var visible = 0;
        rows.forEach(function (row) {
            if (rowMatchesFilter(row, filter)) {
                row.hidden = false;
                visible++;
            } else {
                row.hidden = true;
            }
        });
        if (status) {
            var anyFilter = filter.options_page || filter.field_type || filter.group_key
                || filter.decision || filter.recommendation || filter.category || filter.search;
            if (anyFilter) {
                status.textContent = (i18n.showingCount || 'Showing {visible} of {total} candidates')
                    .replace('{visible}', String(visible))
                    .replace('{total}', String(total));
            } else {
                status.textContent = (i18n.showingAll || 'Showing all {total} candidates')
                    .replace('{total}', String(total));
            }
        }
        if (noMatch) {
            noMatch.hidden = visible !== 0 || total === 0;
        }
    }

    function resetFilters() {
        var form = doc.querySelector('[data-dbvc-ve-curation="filter-form"]');
        if (!form) {
            return;
        }
        // Reset every selectable filter control back to its empty option.
        var controls = form.querySelectorAll('select, input[type="search"], input[type="text"]');
        controls.forEach(function (control) {
            if (control.name === 'page') {
                return;
            }
            if (control.tagName === 'SELECT') {
                control.selectedIndex = 0;
                return;
            }
            control.value = '';
        });
        applyFilters();
    }

    var searchDebounce = null;

    function saveRow(row) {
        var id = row.dataset.id;
        if (!id) {
            return;
        }
        setRowStatus(row, i18n.saving || 'Saving…', 'pending');
        postForm(config.actions.save, {
            id: id,
            decision: readRowDecision(row)
        }, function (err, json) {
            if (err || !json || !json.ok) {
                setRowStatus(row, i18n.error || 'Save failed', 'error');
                return;
            }
            var decision = json.decision && json.decision.decision ? json.decision.decision : '';
            applyRowStateClass(row, decision);
            syncRowFilterAttrs(row);
            // Re-apply filters — a row the user just switched to Include (while a
            // "decision=ignore" filter is active) should hide itself immediately.
            applyFilters();
            setRowStatus(row, i18n.saved || 'Saved', 'ok');
        });
    }

    function gatherSelectedIds() {
        var ids = [];
        doc.querySelectorAll('[data-dbvc-ve-curation="row-select"]').forEach(function (cb) {
            if (cb.checked && cb.value) {
                ids.push(cb.value);
            }
        });

        return ids;
    }

    function bulkApply() {
        var actionSelect = doc.querySelector('[data-dbvc-ve-curation="bulk-action"]');
        var status = doc.querySelector('[data-dbvc-ve-curation="bulk-status"]');
        if (!actionSelect || !status) {
            return;
        }
        var raw = actionSelect.value;
        if (!raw) {
            status.textContent = i18n.bulkNoAction || 'Choose a bulk action first.';
            return;
        }
        var ids = gatherSelectedIds();
        if (ids.length === 0) {
            status.textContent = i18n.bulkNoSelection || 'Select at least one row first.';
            return;
        }
        var parts = raw.split(':');
        var field = parts.shift();
        var value = parts.join(':');

        // Special actions route to dedicated endpoints — they can't be
        // expressed as a single {field: value} broadcast because each row
        // gets a different value.
        if (field === 'special' && value === 'adopt_suggested_priorities') {
            bulkAdoptSuggestedPriorities(ids, status);
            return;
        }

        var decision = {};
        decision[field] = value;

        status.textContent = i18n.saving || 'Saving…';
        postForm(config.actions.bulk, {
            ids: ids,
            decision: decision
        }, function (err, json) {
            if (err || !json || !json.ok) {
                status.textContent = i18n.error || 'Save failed';
                return;
            }
            status.textContent = (i18n.saved || 'Saved') + ' (' + (json.written || 0) + ')';
            // Reload to reflect canonical server state on every affected row + summary.
            window.location.reload();
        });
    }

    function bulkAdoptSuggestedPriorities(ids, status) {
        status.textContent = i18n.saving || 'Saving…';
        postForm(config.actions.adopt_priorities, {
            ids: ids
        }, function (err, json) {
            if (err || !json || !json.ok) {
                status.textContent = i18n.error || 'Save failed';
                return;
            }
            var written = (json.written || 0);
            var skippedNo = (json.skipped_no_suggestion || 0);
            var msg = (i18n.saved || 'Saved') + ' (' + written + ')';
            if (skippedNo > 0) {
                msg += ' · ' + skippedNo + ' skipped (no suggestion)';
            }
            status.textContent = msg;
            // Reload so every affected row's Priority radios reflect the
            // canonical server state without per-row JS repaint.
            window.location.reload();
        });
    }

    function exportSeed() {
        var status = doc.querySelector('[data-dbvc-ve-curation="export-status"]');
        if (status) {
            status.textContent = i18n.exporting || 'Exporting…';
        }
        postForm(config.actions.export, {}, function (err, json) {
            if (err || !json) {
                if (status) {
                    status.textContent = i18n.exportError || 'Export failed';
                }
                return;
            }
            if (!json.ok) {
                if (status) {
                    status.textContent = (i18n.exportError || 'Export failed') + ': ' + (json.message || '');
                }
                return;
            }
            if (status) {
                status.textContent = (i18n.exportOk || 'Export complete') + ' — ' + (json.message || '');
            }
        });
    }

    function bindFilterEvents() {
        var form = doc.querySelector('[data-dbvc-ve-curation="filter-form"]');
        if (!form) {
            return;
        }

        // Hijack the form submit — filtering is entirely client-side now, so a
        // native submit would trigger a full page reload for no benefit.
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            applyFilters();
        });

        // Every select in the filter form re-applies filters instantly on change.
        form.querySelectorAll('select').forEach(function (select) {
            select.addEventListener('change', applyFilters);
        });

        // The label search input is debounced so keystroke-per-filter doesn't
        // hammer the DOM for hundreds of rows.
        var searchInput = form.querySelector('input[type="search"], input[name="search"]');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                if (searchDebounce) {
                    clearTimeout(searchDebounce);
                }
                searchDebounce = setTimeout(applyFilters, 180);
            });
        }
    }

    function bindEvents() {
        bindFilterEvents();

        doc.addEventListener('click', function (event) {
            var target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            if (target.matches('[data-dbvc-ve-curation="filter-reset"]')) {
                resetFilters();
            }
        });

        doc.addEventListener('change', function (event) {
            var target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            if (target.matches('[data-dbvc-ve-curation="field"]')) {
                var row = target.closest('.dbvc-ve-curation__row');
                if (row) {
                    saveRow(row);
                }
                return;
            }
            if (target.matches('[data-dbvc-ve-curation="select-all"]')) {
                var checked = target.checked;
                doc.querySelectorAll('[data-dbvc-ve-curation="row-select"]').forEach(function (cb) {
                    cb.checked = checked;
                });
            }
        });

        doc.addEventListener('input', function (event) {
            var target = event.target;
            if (!(target instanceof HTMLTextAreaElement)) {
                return;
            }
            if (!target.matches('[data-dbvc-ve-curation="field"][data-field="notes"]')) {
                return;
            }
            // Debounce notes writes so keystroke-per-request doesn't hammer admin-ajax.
            if (target.__dbvc_ve_curation_timer) {
                clearTimeout(target.__dbvc_ve_curation_timer);
            }
            var row = target.closest('.dbvc-ve-curation__row');
            if (!row) {
                return;
            }
            target.__dbvc_ve_curation_timer = setTimeout(function () {
                saveRow(row);
            }, 600);
        });

        doc.addEventListener('click', function (event) {
            var target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            if (target.matches('[data-dbvc-ve-curation="bulk-apply"]')) {
                bulkApply();
                return;
            }
            if (target.matches('[data-dbvc-ve-curation="export"]')) {
                exportSeed();
                return;
            }
            if (target.matches('[data-dbvc-ve-curation="adopt-priority"]')) {
                adoptSuggestedPriority(target);
            }
        });
    }

    var PRIORITY_REC_TOGGLE_KEY = 'dbvc_ve_curation_show_priority_rec';

    function applyPriorityRecToggleState(checked) {
        var table = doc.querySelector('.dbvc-ve-curation__table');
        if (!table) {
            return;
        }
        table.classList.toggle('is-hiding-priority-rec', !checked);
        try {
            window.localStorage.setItem(PRIORITY_REC_TOGGLE_KEY, checked ? '1' : '0');
        } catch (e) {
            // localStorage may be unavailable (private window, blocked storage) —
            // toggle still works for the session, just doesn't persist.
        }
    }

    function restorePriorityRecToggleState() {
        var toggle = doc.querySelector('[data-dbvc-ve-curation="toggle-priority-rec"]');
        if (!toggle) {
            return;
        }
        var stored = null;
        try {
            stored = window.localStorage.getItem(PRIORITY_REC_TOGGLE_KEY);
        } catch (e) {
            stored = null;
        }
        if (stored === '0') {
            toggle.checked = false;
        } else if (stored === '1') {
            toggle.checked = true;
        }
        applyPriorityRecToggleState(toggle.checked);
        toggle.addEventListener('change', function () {
            applyPriorityRecToggleState(toggle.checked);
        });
    }

    function adoptSuggestedPriority(button) {
        var row = button.closest('.dbvc-ve-curation__row');
        if (!row) {
            return;
        }
        var priority = button.getAttribute('data-priority') || '';
        var radio = row.querySelector('[data-dbvc-ve-curation="field"][data-field="client_priority"][value="' + priority + '"]');
        if (!radio) {
            return;
        }
        radio.checked = true;
        // Fire the same save path as a manual radio click.
        saveRow(row);
    }

    bindEvents();
    applyFilters();
    restorePriorityRecToggleState();
}());
