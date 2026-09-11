<?php

namespace Dbvc\VisualEditor\Resolvers;

use Dbvc\VisualEditor\Registry\EditableDescriptor;

/**
 * R5.5 — resolver for ACF's date_picker field type.
 *
 * ACF stores date_picker values as an ISO-8601 date string (`YYYY-MM-DD`).
 * The panel side reuses the existing `createInputController('date', value)`
 * which produces a native `<input type="date">` — no new panel controller
 * needed, mirroring the R5.2+color_picker pattern.
 *
 * `validate()` accepts empty / null / ISO-8601 dates only. `sanitize()`
 * normalizes to `YYYY-MM-DD`. `save()` delegates to `writeAcfValue()`
 * which inherits R5.1-b group-nested support via `writeGroupedFieldValue`
 * and R5.7-a repeater-subfield support via `writeRepeaterSubfieldValue`
 * automatically — no per-family write-path work needed.
 *
 * Every other resolver hook mirrors the AcfTextResolver /
 * AcfColorPickerResolver / AcfTrueFalseResolver shape.
 */
final class AcfDatePickerResolver extends AbstractAcfResolver
{
    /**
     * @return string
     */
    public function name()
    {
        return 'acf_date_picker';
    }

    /**
     * @param EditableDescriptor $descriptor
     * @return bool
     */
    public function supports(EditableDescriptor $descriptor)
    {
        return $this->supportsAcfSource($descriptor)
            && ($descriptor->source['field_type'] ?? '') === 'date_picker';
    }

    /**
     * @param EditableDescriptor $descriptor
     * @return mixed
     */
    public function getValue(EditableDescriptor $descriptor)
    {
        return $this->getRawAcfValue($descriptor);
    }

    /**
     * @param EditableDescriptor $descriptor
     * @param mixed              $value
     * @return mixed
     */
    public function getDisplayValue(EditableDescriptor $descriptor, $value)
    {
        unset($descriptor);
        return self::normalizeIsoDate($value);
    }

    /**
     * @param EditableDescriptor $descriptor
     * @return string
     */
    public function getDisplayMode(EditableDescriptor $descriptor)
    {
        unset($descriptor);
        return 'text';
    }

    /**
     * @param EditableDescriptor $descriptor
     * @param mixed              $value
     * @return array<string, mixed>
     */
    public function validate(EditableDescriptor $descriptor, $value)
    {
        unset($descriptor);
        if ($value === null || $value === '') {
            return ['ok' => true, 'message' => ''];
        }
        if (self::isRecognizedIsoDate($value)) {
            return ['ok' => true, 'message' => ''];
        }
        return [
            'ok' => false,
            'message' => __('ACF date fields require an ISO-8601 date (YYYY-MM-DD).', 'dbvc'),
        ];
    }

    /**
     * @param EditableDescriptor $descriptor
     * @param mixed              $value
     * @return mixed
     */
    public function sanitize(EditableDescriptor $descriptor, $value)
    {
        unset($descriptor);
        if ($value === null || $value === '') {
            return '';
        }
        return self::normalizeIsoDate($value);
    }

    /**
     * @param EditableDescriptor $descriptor
     * @param mixed              $value
     * @return array<string, mixed>
     */
    public function save(EditableDescriptor $descriptor, $value)
    {
        return $this->writeAcfValue($descriptor, $value);
    }

    /**
     * R5.5 — accept only well-formed `YYYY-MM-DD` strings that also
     * represent a real calendar date (rejects `2026-02-30` etc). Public
     * static so both `validate()` and `sanitize()` share the same shape
     * guard, and so tests can exercise the check in isolation.
     *
     * @param mixed $value
     * @return bool
     */
    public static function isRecognizedIsoDate($value)
    {
        if (! is_string($value)) {
            return false;
        }
        $trimmed = trim($value);
        if ($trimmed === '') {
            return false;
        }
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $trimmed, $m) !== 1) {
            return false;
        }
        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    /**
     * R5.5 — normalize whatever inbound shape the panel or resolver
     * gives us into the canonical `YYYY-MM-DD` ACF stores. Non-string
     * or unrecognized input returns `''` — the resolver's validate()
     * step guards this before sanitize() runs, but sanitize is also
     * called directly from summary builders where defensive
     * normalization matters.
     *
     * @param mixed $value
     * @return string
     */
    public static function normalizeIsoDate($value)
    {
        if (! is_string($value)) {
            return '';
        }
        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }
        if (self::isRecognizedIsoDate($trimmed)) {
            return $trimmed;
        }
        return '';
    }
}
