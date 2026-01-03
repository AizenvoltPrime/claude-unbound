# Component Structure Patterns

This document outlines the structural patterns for Vue 3 components in the IEMIS project.

## Script Setup Pattern

All components use `<script setup lang="ts">` with TypeScript:

```typescript
<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useUsersStore } from "../../stores/usersStore";

// Define Props interface
interface Props {
    modelValue?: string;
    label?: string;
    error?: string | null;
    required?: boolean;
    disabled?: boolean;
    isValid?: boolean;
    isValidating?: boolean;
}

// Define Emits interface
interface Emits {
    "update:modelValue": [value: string];
    blur: [];
    input: [];
}

// Use withDefaults for default values
const props = withDefaults(defineProps<Props>(), {
    modelValue: "",
    isValid: true,
    isValidating: false,
    required: false,
    disabled: false,
});

const emit = defineEmits<Emits>();

// Composables
const { t } = useI18n();
const usersStore = useUsersStore();

// Component state
const isOpen = ref(false);

// Computed properties
const displayLabel = computed(() => {
    return props.label ? t(props.label) : '';
});

// Methods
const handleChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    emit("update:modelValue", target.value);
};
</script>
```

## Props Interface Guidelines

1. **Always define interfaces** for Props and Emits
2. **Use optional properties** (`?`) where appropriate
3. **Provide default values** via `withDefaults()`
4. **Type validation props** explicitly: `isValid?: boolean`, `error?: string | null`
5. **Loading/validation props**: `isValidating?: boolean`, `disabled?: boolean`

### Common Props Pattern

```typescript
interface Props {
    // v-model binding
    modelValue?: string | number | string[];

    // Display
    label?: string;
    placeholder?: string;

    // Validation & state
    error?: string | null;
    required?: boolean;
    disabled?: boolean;
    isValid?: boolean;
    isValidating?: boolean;

    // Behavior
    readonly?: boolean;
    hideError?: boolean;
}
```

## Emits Interface Guidelines

1. **Type-safe event signatures** with parameters array
2. **Standard events**: `update:modelValue`, `blur`, `input`, `change`
3. **Custom events**: Define with specific payload types

```typescript
interface Emits {
    // v-model update
    "update:modelValue": [value: string];

    // Standard events
    blur: [];
    input: [];
    change: [value: string];

    // Custom events
    save: [];
    cancel: [];
    delete: [id: number];
}
```

## Composable Usage

### Always Import These Composables

```typescript
import { useI18n } from "vue-i18n";
import { useUsersStore } from "../../stores/usersStore";

const { t } = useI18n();
const usersStore = useUsersStore();
```

### Validation Composables (For Forms)

```typescript
import { useEquipmentFormValidation } from "../../Composables/ValidationComposables/useEquipmentFormValidation";

const {
    fieldValidationStates,
    validateField,
    isFormValid,
} = useEquipmentFormValidation(formData);
```

## State Management

### Component-Level State

```typescript
// Refs for mutable state
const isOpen = ref(false);
const searchTerm = ref("");
const containerRef = ref<HTMLElement>();

// Computed for derived state
const hasValue = computed(() => props.modelValue !== "");
const displayText = computed(() => t(props.label || ""));

// Watchers for reactive side effects
watch(() => props.visible, (isVisible) => {
    if (isVisible) {
        // Handle visibility change
    }
});
```

## Template Structure

### Standard Layout

```html
<template>
    <!-- Wrapper with composable component if available (FormInput, UnifiedFormContainer) -->
    <FormInput
        :label="label"
        :error="error"
        :required="required"
        :is-valid="isValid"
        :is-validating="isValidating"
        @blur="handleBlur"
        @input="handleInput"
    >
        <!-- Slot content with actual input/component -->
        <template #default="{ inputProps, inputClasses }">
            <input
                type="text"
                :class="inputClasses"
                v-bind="inputProps"
                :value="modelValue"
                @input="handleChange"
                @blur="handleBlur"
            />
        </template>
    </FormInput>
</template>
```

### Form Component Template Pattern

```html
<template>
    <UnifiedFormContainer>
        <!-- Optional tabs slot -->
        <template #tabs>
            <div class="flex gap-2">
                <!-- Tab buttons -->
            </div>
        </template>

        <!-- Main form content (default slot) -->
        <div class="space-y-6">
            <!-- Form sections -->
            <FormSectionHeader>{{ $t('section_title') }}</FormSectionHeader>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <!-- Form fields -->
                <TextInput
                    v-model="formData.name"
                    :label="$t('name')"
                    :error="fieldValidationStates.name?.error"
                    :is-valid="fieldValidationStates.name?.isValid"
                    :is-validating="fieldValidationStates.name?.isValidating"
                    required
                />
            </div>
        </div>

        <!-- Actions slot -->
        <template #actions>
            <CancelButton @cancel="handleCancel" />
            <SaveButton
                @save="handleSave"
                :is-submitting="isSubmitting"
            />
        </template>
    </UnifiedFormContainer>
</template>
```

## Component Composition

### Use Custom Components First

Always prefer custom components over DevExtreme:

```typescript
// ✅ CORRECT - Use custom components
import TextInput from "./Child-Components/TextInput.vue";
import SelectBox from "./Child-Components/SelectBox.vue";
import TagBox from "./Child-Components/TagBox.vue";
import SaveButton from "./Child-Components/SaveButton.vue";

// ❌ AVOID - DevExtreme (unless no custom alternative exists)
import { DxTextBox } from "devextreme-vue/text-box";
```

### Component Hierarchy

1. **Layout Components**: `UnifiedFormContainer`, `FormPageHeader`
2. **Section Components**: `FormSectionHeader`
3. **Input Components**: `TextInput`, `NumberInput`, `SelectBox`, `TagBox`, `FileUploader`
4. **Action Components**: `SaveButton`, `CancelButton`, `Button`
5. **Feedback Components**: `ErrorPopup`, `SuccessPopup`

### Wrapper Components (FormInput)

Use `FormInput` as a base for all input components:

```typescript
// TextInput.vue uses FormInput
<FormInput
    :label="label"
    :error="error"
    :required="required"
    :is-valid="isValid"
    :is-validating="isValidating"
>
    <template #default="{ inputProps, inputClasses }">
        <input
            type="text"
            :class="inputClasses"
            v-bind="inputProps"
            :value="modelValue"
            @input="handleChange"
        />
    </template>
</FormInput>
```

## Event Handling

### Standard Event Pattern

```typescript
// Emit update for v-model
const handleChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    emit("update:modelValue", target.value);
    emit("input"); // Trigger validation if needed
};

// Emit blur event
const handleBlur = () => {
    emit("blur"); // Trigger validation
};

// Custom actions
const handleSave = async () => {
    if (!isFormValid()) return;

    try {
        // Save logic
        emit("save");
    } catch (error) {
        // Error handling
    }
};
```

## Validation Integration

### With Validation Composable

```typescript
import { useEquipmentFormValidation } from "../../Composables/ValidationComposables/useEquipmentFormValidation";
import { getValidationState } from "../../utils/validationTypeGuards";

// Initialize validation
const {
    fieldValidationStates,
    validateField,
    isFormValid,
} = useEquipmentFormValidation(formData);

// Use safe validation state access
const nameValidation = computed(() =>
    getValidationState(fieldValidationStates.value, 'name')
);

// Validate on blur
const handleBlur = async (field: string) => {
    await validateField(field);
};
```

### Bind to Template

```html
<TextInput
    v-model="formData.name"
    :error="nameValidation.error"
    :is-valid="nameValidation.isValid"
    :is-validating="nameValidation.isValidating"
    @blur="() => handleBlur('name')"
    @input="() => handleBlur('name')"
/>
```

## Accessibility Patterns

### Focus Management

```typescript
import { ref, nextTick, watch } from "vue";

const inputRef = ref<HTMLInputElement>();
let previouslyFocusedElement: HTMLElement | null = null;

// Store and restore focus
watch(() => props.visible, async (isVisible) => {
    if (isVisible) {
        previouslyFocusedElement = document.activeElement as HTMLElement;
        await nextTick();
        inputRef.value?.focus();
    } else {
        previouslyFocusedElement?.focus();
        previouslyFocusedElement = null;
    }
});
```

### Keyboard Navigation

```typescript
const handleKeydown = (event: KeyboardEvent) => {
    switch (event.key) {
        case 'Escape':
            event.preventDefault();
            handleClose();
            break;
        case 'Enter':
            if (!event.shiftKey) {
                event.preventDefault();
                handleSubmit();
            }
            break;
    }
};
```

## Internationalization (i18n)

### Translation Usage

```typescript
// In script
const { t } = useI18n();
const translatedLabel = computed(() => t('label_key'));

// In template
{{ $t('translation_key') }}
{{ $t('validation_error', { field: $t('field_name') }) }}
```

### Translation Keys

- Use dot notation: `errors.validation_failed`, `resources.equipment`
- Resource names: `resources.equipment`, `resources.vehicle`
- Action labels: `save`, `cancel`, `delete`, `edit`
- Validation messages: `validation.required`, `validation.email`

## Lifecycle Hooks

### Mount/Unmount Pattern

```typescript
import { onMounted, onUnmounted } from "vue";

onMounted(() => {
    document.addEventListener("click", handleClickOutside);
    window.addEventListener("scroll", handleScroll);
});

onUnmounted(() => {
    document.removeEventListener("click", handleClickOutside);
    window.removeEventListener("scroll", handleScroll);
});
```

## Teleport for Overlays

```html
<Teleport to="body">
    <div
        v-if="isOpen"
        class="fixed inset-0 z-[9999] flex items-center justify-center"
    >
        <!-- Modal/dropdown content -->
    </div>
</Teleport>
```

## Best Practices

1. **No inline comments** - Code should be self-documenting
2. **Computed over methods** - Use computed for derived state
3. **Type everything** - Leverage TypeScript fully
4. **Extract reusable logic** - Create composables for shared functionality
5. **Component slots** - Use slots for flexible composition
6. **Defensive programming** - Check for null/undefined, use optional chaining
7. **Consistent naming** - `handle*` for methods, `is*` for booleans, `*Ref` for refs
