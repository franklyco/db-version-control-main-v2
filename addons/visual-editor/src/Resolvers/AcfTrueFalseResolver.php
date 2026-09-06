<?php

namespace Dbvc\VisualEditor\Resolvers;

use Dbvc\VisualEditor\Registry\EditableDescriptor;

/**
 * true_false — resolver for ACF's true_false (boolean) field type.
 *
 * ACF stores true_false values as the integer `1` (true) or `0` (false).
 * `validate()` accepts common boolean-shaped inputs (bool, `1`/`0`,
 * `'1'`/`'0'`, `'true'`/`'false'`, `'on'`/`'off'`, empty → false). `sanitize()`
 * normalizes to the ACF-canonical `1` / `0` integer. Every other resolver
 * hook mirrors the AcfTextResolver / AcfColorPickerResolver shape.
 *
 * The panel-side controller is a new `createBooleanController` (checkbox
 * + label). Routed from `createFieldController` by `ui.input === 'true_false'`.
 */
final class AcfTrueFalseResolver extends AbstractAcfResolver
{
    /**
     * @return string
     */
    public function name()
    {
        return 'acf_true_false';
    }

    /**
     * @param EditableDescriptor $descriptor
     * @return bool
     */
    public function supports(EditableDescriptor $descriptor)
    {
        return $this->supportsAcfSource($descriptor)
            && ($descriptor->source['field_type'] ?? '') === 'true_false';
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
        return self::coerceToBool($value) ? 1 : 0;
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
        if ($value === null || $value === '' || is_bool($value)) {
            return ['ok' => true, 'message' => ''];
        }
        if (is_int($value) || (is_string($value) && ctype_digit($value))) {
            $int = (int) $value;
            if ($int === 0 || $int === 1) {
                return ['ok' => true, 'message' => ''];
            }
        }
        if (is_string($value)) {
            $lower = strtolower(trim($value));
            if (in_array($lower, ['true', 'false', 'on', 'off', 'yes', 'no'], true)) {
                return ['ok' => true, 'message' => ''];
            }
        }
        return [
            'ok' => false,
            'message' => __('ACF true/false fields require a boolean value.', 'dbvc'),
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
        return self::coerceToBool($value) ? 1 : 0;
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
     * Coerce a wide range of boolean-shaped inputs to a real bool. Every
     * hook feeds through this so getDisplayValue + sanitize + summary all
     * agree.
     *
     * @param mixed $value
     * @return bool
     */
    public static function coerceToBool($value)
    {
        if (is_bool($value)) {
            return $value;
        }
        if ($value === null || $value === '') {
            return false;
        }
        if (is_int($value)) {
            return $value !== 0;
        }
        if (is_string($value)) {
            $lower = strtolower(trim($value));
            if (in_array($lower, ['1', 'true', 'on', 'yes'], true)) {
                return true;
            }
            if (in_array($lower, ['0', 'false', 'off', 'no', ''], true)) {
                return false;
            }
        }
        return (bool) $value;
    }
}
