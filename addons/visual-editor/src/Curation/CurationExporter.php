<?php

namespace Dbvc\VisualEditor\Curation;

/**
 * R3-BX — Exporter for the curated allowlist.
 *
 * Writes two artifacts to `addons/visual-editor/curation/`:
 *   - `vertical-approved-controls.json` — machine-readable, shaped to
 *     seed a future `VerticalControlProvider::getControls()` verbatim.
 *   - `vertical-approved-controls.md` — human-readable review sheet
 *     grouped by R5 sequencing bucket.
 *
 * Only records with `decision === 'include'` are emitted. `defer` and
 * `ignore` records stay in the {@see CurationStore} for the human to
 * revisit but do not become part of the seed. The `unlocks_at` field
 * comes from {@see FieldCurationRecommender::deriveUnlocksAt} so the
 * MD review sheet can group records by "which R5 slice unlocks this".
 */
final class CurationExporter
{
    public const JSON_FILENAME = 'vertical-approved-controls.json';
    public const MD_FILENAME = 'vertical-approved-controls.md';
    public const SCHEMA_VERSION = 'dbvc.ve.curation.v1';

    /**
     * @var string
     */
    private $exportDir;

    /**
     * @var FieldCurationRecommender
     */
    private $recommender;

    /**
     * @param string                   $exportDir Absolute path.
     * @param FieldCurationRecommender $recommender
     */
    public function __construct($exportDir, FieldCurationRecommender $recommender)
    {
        $this->exportDir = rtrim((string) $exportDir, '/\\');
        $this->recommender = $recommender;
    }

    /**
     * Build the export payload and write both files. Returns paths + byte
     * counts + include-count. Throws a RuntimeException-ish array shape
     * for the caller to surface as an admin notice if the write fails.
     *
     * @param array<int, array<string, mixed>>  $candidates
     * @param array<string, array<string, mixed>> $decisions
     * @return array{ok:bool,message:string,json_path:string,md_path:string,include_count:int,unlocks_summary:array<string,int>}
     */
    public function export(array $candidates, array $decisions, $source_site = '')
    {
        if (! wp_mkdir_p($this->exportDir)) {
            return [
                'ok' => false,
                'message' => sprintf(
                    /* translators: %s: absolute directory path */
                    __('Could not create export directory: %s', 'dbvc'),
                    $this->exportDir
                ),
                'json_path' => '',
                'md_path' => '',
                'include_count' => 0,
                'unlocks_summary' => [],
            ];
        }

        $records = [];
        $unlocks_summary = [];
        foreach ($candidates as $candidate) {
            if (! is_array($candidate) || empty($candidate['id'])) {
                continue;
            }
            $id = (string) $candidate['id'];
            $decision = isset($decisions[$id]) && is_array($decisions[$id]) ? $decisions[$id] : null;
            if ($decision === null || ($decision['decision'] ?? '') !== 'include') {
                continue;
            }

            $unlocks_at = $this->recommender->deriveUnlocksAt((string) ($candidate['field_type'] ?? ''));
            $unlocks_summary[$unlocks_at] = ($unlocks_summary[$unlocks_at] ?? 0) + 1;

            $records[] = [
                'id' => $this->deriveRecordId($candidate),
                'label' => (string) ($candidate['field_label'] ?? ''),
                'field_name' => (string) ($candidate['field_name_path'] ?? ''),
                'field_key' => (string) ($candidate['field_key'] ?? ''),
                'field_type' => (string) ($candidate['field_type'] ?? ''),
                'owner' => 'option',
                'owner_subtype' => (string) ($candidate['options_page'] ?? ''),
                'group_title' => (string) ($candidate['group_title'] ?? ''),
                'ancestor_labels' => isset($candidate['ancestor_labels']) && is_array($candidate['ancestor_labels'])
                    ? array_values(array_map('strval', $candidate['ancestor_labels']))
                    : [],
                'category' => (string) ($decision['category'] ?? ''),
                'group' => (string) ($decision['group'] ?? ''),
                'client_priority' => (string) ($decision['client_priority'] ?? ''),
                'notes' => (string) ($decision['notes'] ?? ''),
                // R5.later-a — passthrough for Vertical's palette grouping;
                // R5.later-a.5 extends this with a recommender fallback so
                // color_picker records nested inside a group whose name
                // contains "palette" auto-default to that group's slug
                // without a per-row curator toggle. Curator override
                // (non-empty decision value) always wins over the auto
                // suggestion; empty decision + empty suggestion = flat.
                'palette_group_key' => $this->resolvePaletteGroupKey($decision, $candidate),
                // R5.later-a.6 — passthrough for the curator-set palette
                // parent label override. Empty string when unset — the
                // Vertical provider falls back to the humanised
                // `palette_group_key` slug in that case. Set on any one
                // child in the palette group; the provider's pre-scan
                // picks the first non-empty value seen.
                'palette_display_label' => (string) ($decision['palette_display_label'] ?? ''),
                'unlocks_at' => $unlocks_at,
            ];
        }

        ksort($unlocks_summary);

        $counts = [
            'include' => count($records),
            'defer' => $this->countByDecision($candidates, $decisions, 'defer'),
            'ignore' => $this->countByDecision($candidates, $decisions, 'ignore'),
        ];

        $payload = [
            'schema' => self::SCHEMA_VERSION,
            'exported_at' => gmdate('Y-m-d\TH:i:s\Z'),
            'source_site' => (string) $source_site,
            'counts' => $counts,
            'unlocks_summary' => $unlocks_summary,
            'records' => $records,
        ];

        $json_path = $this->exportDir . '/' . self::JSON_FILENAME;
        $md_path = $this->exportDir . '/' . self::MD_FILENAME;

        $json_bytes = file_put_contents($json_path, wp_json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
        if ($json_bytes === false) {
            return [
                'ok' => false,
                'message' => sprintf(
                    /* translators: %s: absolute file path */
                    __('Could not write JSON export: %s', 'dbvc'),
                    $json_path
                ),
                'json_path' => '',
                'md_path' => '',
                'include_count' => count($records),
                'unlocks_summary' => $unlocks_summary,
            ];
        }

        $md_bytes = file_put_contents($md_path, $this->renderMarkdown($payload));
        if ($md_bytes === false) {
            return [
                'ok' => false,
                'message' => sprintf(
                    /* translators: %s: absolute file path */
                    __('Could not write Markdown review sheet: %s', 'dbvc'),
                    $md_path
                ),
                'json_path' => $json_path,
                'md_path' => '',
                'include_count' => count($records),
                'unlocks_summary' => $unlocks_summary,
            ];
        }

        return [
            'ok' => true,
            'message' => sprintf(
                /* translators: 1: include count, 2: json file basename */
                __('Exported %1$d approved controls to %2$s.', 'dbvc'),
                count($records),
                self::JSON_FILENAME
            ),
            'json_path' => $json_path,
            'md_path' => $md_path,
            'include_count' => count($records),
            'unlocks_summary' => $unlocks_summary,
        ];
    }

    /**
     * R5.later-a.5 — resolve the exported `palette_group_key` for a record.
     * Curator override (non-empty decision value) wins; otherwise fall
     * back to the recommender's heuristic suggestion. See
     * {@see FieldCurationRecommender::deriveSuggestedPaletteGroupKey} for
     * the heuristic (color_picker inside a "palette"-named parent group).
     *
     * @param array<string, mixed> $decision
     * @param array<string, mixed> $candidate
     * @return string
     */
    private function resolvePaletteGroupKey(array $decision, array $candidate)
    {
        $explicit = isset($decision['palette_group_key']) ? (string) $decision['palette_group_key'] : '';
        if ($explicit !== '') {
            return $explicit;
        }

        return $this->recommender->deriveSuggestedPaletteGroupKey($candidate);
    }

    /**
     * Stable id for the exported record: `{options-page}__{field-name-path}`
     * with `>` collapsed to `__` so downstream JSON consumers can treat
     * the id as a filename-safe slug.
     *
     * @param array<string, mixed> $candidate
     * @return string
     */
    private function deriveRecordId(array $candidate)
    {
        $options_page = (string) ($candidate['options_page'] ?? '');
        $path = (string) ($candidate['field_name_path'] ?? '');

        return $options_page . '__' . str_replace('>', '__', $path);
    }

    /**
     * @param array<int, array<string, mixed>>  $candidates
     * @param array<string, array<string, mixed>> $decisions
     * @param string                            $target
     * @return int
     */
    private function countByDecision(array $candidates, array $decisions, $target)
    {
        $count = 0;
        foreach ($candidates as $candidate) {
            if (! is_array($candidate) || empty($candidate['id'])) {
                continue;
            }
            $id = (string) $candidate['id'];
            $decision = isset($decisions[$id]) && is_array($decisions[$id]) ? $decisions[$id] : null;
            if ($decision !== null && ($decision['decision'] ?? '') === $target) {
                $count++;
            }
        }

        return $count;
    }

    /**
     * @param array<string, mixed> $payload
     * @return string
     */
    private function renderMarkdown(array $payload)
    {
        $out = "# Vertical — Brand Control Center approved controls\n\n";
        $out .= '_Exported ' . ($payload['exported_at'] ?? '') . " from " . ($payload['source_site'] ?: 'local') . "._\n\n";
        $counts = isset($payload['counts']) && is_array($payload['counts']) ? $payload['counts'] : [];
        $out .= '**Counts:** ' . (int) ($counts['include'] ?? 0) . ' include · '
              . (int) ($counts['defer'] ?? 0) . ' defer · '
              . (int) ($counts['ignore'] ?? 0) . " ignore.\n\n";

        $summary = isset($payload['unlocks_summary']) && is_array($payload['unlocks_summary']) ? $payload['unlocks_summary'] : [];
        if (! empty($summary)) {
            $out .= "## R5 sequencing payoff (include-only)\n\n";
            $out .= "| Unlocks at | Count |\n|---|---|\n";
            foreach ($summary as $bucket => $count) {
                $out .= '| ' . $bucket . ' | ' . (int) $count . " |\n";
            }
            $out .= "\n";
        }

        $records = isset($payload['records']) && is_array($payload['records']) ? $payload['records'] : [];
        if (empty($records)) {
            $out .= "_(no records marked include yet)_\n";

            return $out;
        }

        // Group by unlocks_at bucket, then by category
        $grouped = [];
        foreach ($records as $record) {
            $bucket = (string) ($record['unlocks_at'] ?? 'later');
            $category = (string) ($record['category'] ?? '');
            $grouped[$bucket][$category][] = $record;
        }
        ksort($grouped);

        foreach ($grouped as $bucket => $by_category) {
            $out .= '## ' . $bucket . "\n\n";
            ksort($by_category);
            foreach ($by_category as $category => $rows) {
                $out .= '### ' . ($category !== '' ? $category : '(uncategorized)') . "\n\n";
                $out .= "| Label | Field | Type | Options page | Priority | Notes |\n|---|---|---|---|---|---|\n";
                foreach ($rows as $row) {
                    $notes = str_replace(['|', "\n", "\r"], [' ', ' ', ' '], (string) ($row['notes'] ?? ''));
                    $out .= '| ' . $row['label'] . ' | `' . $row['field_name'] . '` | ' . $row['field_type']
                          . ' | `' . $row['owner_subtype'] . '` | ' . ($row['client_priority'] !== '' ? $row['client_priority'] : '—')
                          . ' | ' . ($notes !== '' ? $notes : '—') . " |\n";
                }
                $out .= "\n";
            }
        }

        return $out;
    }
}
