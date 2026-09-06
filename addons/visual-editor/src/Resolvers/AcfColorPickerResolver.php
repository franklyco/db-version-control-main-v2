<?php

namespace Dbvc\VisualEditor\Resolvers;

use Dbvc\VisualEditor\Registry\EditableDescriptor;

/**
 * R5.2+color_picker — resolver for ACF's color_picker field type.
 *
 * Values are stored as scalar strings, typically the CSS-hex form
 * (`#rrggbb` / `#rgb`) but ACF's own field type also accepts `rgba(...)`
 * / `rgb(...)` when its "return format" configures it that way.
 * `validate()` rejects non-scalar, non-empty values that don't match one
 * of the recognized color-string shapes; `sanitize()` normalizes to a
 * lowercase 7-char hex when possible and otherwise passes the value
 * through `sanitize_text_field`. Empty ('') and null are always allowed
 * so a viewer can clear the field.
 *
 * The panel-side controller is `createInputController('color', value)`
 * (a native `<input type="color">`), routed from `createFieldController`
 * by `ui.input === 'color'` on the R5.2+color_picker branch of
 * `SharedGlobalsDescriptorFactory`.
 */
final class AcfColorPickerResolver extends AbstractAcfResolver
{
    /**
     * @return string
     */
    public function name()
    {
        return 'acf_color_picker';
    }

    /**
     * @param EditableDescriptor $descriptor
     * @return bool
     */
    public function supports(EditableDescriptor $descriptor)
    {
        return $this->supportsAcfSource($descriptor)
            && ($descriptor->source['field_type'] ?? '') === 'color_picker';
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

        return is_scalar($value) || $value === null ? (string) $value : '';
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

        // Empty / null clears the field — always allowed.
        if ($value === null || $value === '') {
            return ['ok' => true, 'message' => ''];
        }
        if (! is_scalar($value)) {
            return [
                'ok' => false,
                'message' => __('ACF color-picker fields require a color string.', 'dbvc'),
            ];
        }
        $string = trim((string) $value);
        if ($string === '') {
            return ['ok' => true, 'message' => ''];
        }
        if (self::isRecognizedColorString($string)) {
            return ['ok' => true, 'message' => ''];
        }
        return [
            'ok' => false,
            'message' => __('The color value must be a hex or rgb(a) string.', 'dbvc'),
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
        if (! is_scalar($value)) {
            return '';
        }
        $string = trim((string) $value);
        if ($string === '') {
            return '';
        }
        // Prefer lowercase 7-char hex — the native color picker always
        // hands us `#RRGGBB`, so normalizing keeps stored values
        // consistent across form + code-set edits.
        if (preg_match('/^#([0-9a-f]{6})$/i', $string, $m)) {
            return '#' . strtolower($m[1]);
        }
        // 3-char hex expands to 6-char lowercase.
        if (preg_match('/^#([0-9a-f]{3})$/i', $string, $m)) {
            $c = strtolower($m[1]);
            return '#' . $c[0] . $c[0] . $c[1] . $c[1] . $c[2] . $c[2];
        }
        // 8-char hex (with alpha) — preserve as lowercase.
        if (preg_match('/^#([0-9a-f]{8})$/i', $string, $m)) {
            return '#' . strtolower($m[1]);
        }
        // rgb() / rgba() — pass through `sanitize_text_field` since the
        // shape is validated but we don't reformat.
        if (preg_match('/^rgba?\(/i', $string)) {
            return sanitize_text_field($string);
        }
        return sanitize_text_field($string);
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
     * True when the input matches a recognized color-string shape:
     * `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, or `rgba(...)`.
     * Used by validate() to accept the WordPress + native-color-input
     * value space without letting arbitrary text through.
     *
     * @param string $string Pre-trimmed input.
     * @return bool
     */
    public static function isRecognizedColorString($string)
    {
        if (preg_match('/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i', $string)) {
            return true;
        }
        if (preg_match('/^rgba?\(/i', $string)) {
            // Loose shape check — sanitize_text_field will strip any
            // markup. The color value ends up in a CSS context, not HTML,
            // so shape validation is what matters here.
            return true;
        }
        return false;
    }
}
