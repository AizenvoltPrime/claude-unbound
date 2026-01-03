# Component Examples

This document provides annotated examples of well-structured custom components.

## Example 1: FormInput (Base Wrapper Component)

**Location**: `resources/ts/Pages/Child-Components/FormInput.vue`

**Purpose**: Base wrapper providing label, error display, and validation states for all input components.

```vue
<script setup lang="ts">
import { computed } from "vue";
import { useUsersStore } from "../../stores/usersStore";

interface Props {
    label?: string;
    modelValue?: any;
    error?: string | null;
    required?: boolean;
    disabled?: boolean;
    placeholder?: string;
    isValid?: boolean;
    isValidating?: boolean;
    hideError?: boolean;
}

interface Emits {
    "update:modelValue": [value: any];
    blur: [];
    input: [];
}

const props = withDefaults(defineProps<Props>(), {
    isValid: true,
    isValidating: false,
    hideError: false,
});

const emit = defineEmits<Emits>();
const usersStore = useUsersStore();

// Provide input props to child via slot
const inputProps = computed(() => ({
    value: props.modelValue,
    disabled: props.disabled,
    placeholder: props.placeholder,
    required: props.required,
    "onUpdate:modelValue": (value: any) => emit("update:modelValue", value),
    onBlur: () => emit("blur"),
    onInput: () => emit("input"),
}));

// Dynamic input classes based on validation state
const inputClasses = computed(() => {
    const baseClasses = [
        "w-full px-3 py-2 border rounded-md",
        "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500",
        "transition-colors duration-200",
    ];

    // Error state (highest priority)
    if (props.error || !props.isValid) {
        baseClasses.push(
            usersStore.isDarkMode
                ? "border-red-400 focus:ring-red-400 focus:border-red-400"
                : "border-red-500 focus:ring-red-500 focus:border-red-500"
        );
    } else if (props.isValidating) {
        // Validating state
        baseClasses.push(
            usersStore.isDarkMode
                ? "border-blue-400 focus:ring-blue-400 focus:border-blue-400"
                : "border-blue-500 focus:ring-blue-500 focus:border-blue-500"
        );
    } else {
        // Normal state
        baseClasses.push(
            usersStore.isDarkMode ? "border-gray-600" : "border-gray-300"
        );
    }

    // Background and text
    if (usersStore.isDarkMode) {
        baseClasses.push("bg-gray-700", "text-white");
    } else {
        baseClasses.push("bg-white", "text-gray-900");
    }

    // Disabled state
    if (props.disabled) {
        baseClasses.push(
            usersStore.isDarkMode
                ? "bg-gray-800 text-gray-400 cursor-not-allowed"
                : "bg-gray-100 text-gray-500 cursor-not-allowed"
        );
    }

    return baseClasses.join(" ");
});
</script>

<template>
    <div>
        <!-- Label with required indicator -->
        <label
            v-if="label"
            :class="[
                'block text-sm font-medium mb-2',
                usersStore.isDarkMode ? 'text-gray-300' : 'text-gray-700',
                required
                    ? 'after:content-[\'*\'] after:text-red-500 after:ml-1'
                    : '',
            ]"
        >
            {{ label }}
        </label>

        <!-- Input wrapper with loading indicator -->
        <div class="relative">
            <slot :inputProps="inputProps" :inputClasses="inputClasses" />

            <!-- Loading indicator (absolute positioned) -->
            <div
                v-if="isValidating"
                class="absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none"
            >
                <div
                    class="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"
                ></div>
            </div>
        </div>

        <!-- Error message -->
        <div
            v-if="error && !hideError"
            :class="[
                'mt-1 text-sm',
                usersStore.isDarkMode ? 'text-red-400' : 'text-red-500',
            ]"
        >
            {{ error }}
        </div>
    </div>
</template>
```

**Key Patterns**:
- Slot-based design provides `inputProps` and `inputClasses` to children
- Validation states: `isValid`, `isValidating`, `error`
- Required field indicator using `after:content` pseudo-element
- Loading spinner absolute positioned in input
- Dark mode support throughout

---

## Example 2: TextInput (Simple Input Component)

**Location**: `resources/ts/Pages/Child-Components/TextInput.vue`

**Purpose**: Standard text input wrapping FormInput with proper v-model binding.

```vue
<script setup lang="ts">
import FormInput from "./FormInput.vue";

interface Props {
    label?: string;
    modelValue?: string;
    error?: string | null;
    required?: boolean;
    disabled?: boolean;
    placeholder?: string;
    isValid?: boolean;
    isValidating?: boolean;
}

interface Emits {
    "update:modelValue": [value: string];
    blur: [];
    input: [];
}

withDefaults(defineProps<Props>(), {
    modelValue: "",
    isValid: true,
    isValidating: false,
});

const emit = defineEmits<Emits>();

const handleInputChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    emit("update:modelValue", target.value);
};

const handleBlur = () => {
    emit("blur");
};

const handleInput = () => {
    emit("input");
};
</script>

<template>
    <FormInput
        :label="label"
        :error="error"
        :required="required"
        :is-valid="isValid"
        :is-validating="isValidating"
        @blur="handleBlur"
        @input="handleInput"
    >
        <template #default="{ inputProps, inputClasses }">
            <input
                type="text"
                :class="inputClasses"
                v-bind="inputProps"
                :value="modelValue"
                @input="handleInputChange"
                @blur="handleBlur"
            />
        </template>
    </FormInput>
</template>
```

**Key Patterns**:
- Wraps FormInput for consistent styling
- Forwards all events and props
- Simple, focused responsibility
- Uses slot to inject actual input element

---

## Example 3: Button (Versatile Action Component)

**Location**: `resources/ts/Pages/Child-Components/Button.vue`

**Purpose**: Reusable button component with variants, sizes, and loading states.

```vue
<script setup lang="ts">
import { computed } from "vue";
import { useUsersStore } from "../../stores/usersStore";

interface Props {
    icon?: string;
    text?: string;
    variant?: "primary" | "secondary" | "danger" | "ghost" | "text";
    size?: "xs" | "sm" | "md" | "lg";
    disabled?: boolean;
    loading?: boolean;
    rounded?: "none" | "sm" | "md" | "lg" | "full";
    iconPosition?: "left" | "right";
}

const props = withDefaults(defineProps<Props>(), {
    variant: "primary",
    size: "md",
    disabled: false,
    loading: false,
    rounded: "md",
    iconPosition: "left",
});

const emit = defineEmits<{
    click: [event: MouseEvent];
}>();

const usersStore = useUsersStore();

// Base classes for all button variants
const baseClasses = computed(() => [
    "inline-flex items-center justify-center font-medium transition-all duration-200",
    "disabled:opacity-50 disabled:cursor-not-allowed",

    // Size-based padding and text
    {
        "px-2 py-1 text-xs": props.size === "xs",
        "px-3 py-1.5 text-sm": props.size === "sm",
        "px-4 py-2 text-sm": props.size === "md",
        "px-6 py-3 text-base": props.size === "lg",
    },

    // Rounded corners
    {
        "rounded-none": props.rounded === "none",
        "rounded-sm": props.rounded === "sm",
        "rounded-md": props.rounded === "md",
        "rounded-lg": props.rounded === "lg",
        "rounded-full": props.rounded === "full",
    },
]);

// Variant-specific colors and effects
const variantClasses = computed(() => {
    const isDark = usersStore.isDarkMode;

    switch (props.variant) {
        case "primary":
            return [
                isDark
                    ? "bg-blue-600/90 hover:bg-blue-700/90 text-white border border-blue-600/90"
                    : "bg-blue-500 hover:bg-blue-600 text-white border border-blue-500",
                "shadow-sm hover:shadow-md",
            ];
        case "secondary":
            return [
                isDark
                    ? "bg-gray-700 text-gray-100 border border-gray-600"
                    : "bg-gray-100 text-gray-700 border border-gray-300",
                "shadow-sm",
            ];
        case "danger":
            return [
                isDark
                    ? "bg-red-600/90 text-white border border-red-600/90"
                    : "bg-red-500 text-white border border-red-500",
                "shadow-sm",
            ];
        case "ghost":
            return [
                isDark
                    ? "bg-transparent text-gray-300 border border-gray-600"
                    : "bg-transparent text-gray-600 border border-gray-300",
            ];
        case "text":
            return [
                isDark
                    ? "bg-transparent text-gray-400"
                    : "bg-transparent text-gray-500",
                "border-0",
            ];
        default:
            return [];
    }
});

const handleClick = (event: MouseEvent) => {
    if (props.disabled || props.loading) return;
    emit("click", event);
};

const iconClasses = computed(() => [
    "flex-shrink-0",
    {
        "w-3 h-3 text-xs": props.size === "xs",
        "w-4 h-4 text-sm": props.size === "sm",
        "w-5 h-5 text-base": props.size === "md",
        "w-6 h-6 text-lg": props.size === "lg",
    },
]);
</script>

<template>
    <button
        :class="[baseClasses, variantClasses]"
        :disabled="disabled || loading"
        @click="handleClick"
        type="button"
    >
        <!-- Loading spinner (left) -->
        <svg
            v-if="loading && iconPosition === 'left' && text"
            :class="[iconClasses, 'mr-2']"
            class="animate-spin"
            fill="none"
            viewBox="0 0 24 24"
        >
            <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
            ></circle>
            <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
        </svg>

        <!-- Icon (left) -->
        <i
            v-else-if="icon && iconPosition === 'left' && text"
            :class="[icon, iconClasses, 'mr-2']"
        ></i>

        <!-- Button text -->
        <span v-if="text">{{ text }}</span>

        <!-- Icon (right) or loading -->
        <i
            v-if="icon && iconPosition === 'right' && text && !loading"
            :class="[icon, iconClasses, 'ml-2']"
        ></i>

        <!-- Icon-only button -->
        <i v-if="icon && !text && !loading" :class="[icon, iconClasses]"></i>
    </button>
</template>
```

**Key Patterns**:
- Variant system for different button types
- Size variants with responsive classes
- Loading state with spinner animation
- Icon positioning (left/right)
- Disabled state handling
- No custom CSS - all Tailwind

---

## Example 4: SaveButton (Specialized Button)

**Location**: `resources/ts/Pages/Child-Components/SaveButton.vue`

**Purpose**: Specialized button for save actions with i18n support.

```vue
<script setup lang="ts">
import { useUsersStore } from "../../stores/usersStore";
import { useI18n } from "vue-i18n";

interface Props {
    isSubmitting?: boolean;
    saveButtonText?: string;
    savingText?: string;
    disabled?: boolean;
    showBorder?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    isSubmitting: false,
    saveButtonText: "save",
    savingText: "saving",
    disabled: false,
    showBorder: true,
});

const emit = defineEmits<{
    save: [];
}>();

const { t } = useI18n();
const usersStore = useUsersStore();

const handleSaveClick = () => {
    if (!props.isSubmitting && !props.disabled) {
        emit("save");
    }
};
</script>

<template>
    <div
        :class="[
            showBorder && usersStore.isDarkMode
                ? 'border-t border-slate-700/50'
                : showBorder
                ? 'border-t border-gentle-moonlight-200/50'
                : '',
        ]"
    >
        <div class="flex justify-end">
            <button
                @click="handleSaveClick"
                :disabled="isSubmitting || disabled"
                :class="[
                    'relative px-6 py-4 rounded-xl text-base font-semibold transition-all duration-300',
                    'flex items-center space-x-3 justify-center min-w-[11rem] text-white',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    usersStore.isDarkMode
                        ? 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/25'
                        : 'bg-slate-700 hover:bg-slate-600 shadow-lg shadow-slate-900/25',
                    !isSubmitting && !disabled ? 'hover:shadow-xl' : '',
                ]"
            >
                <!-- Loading state -->
                <div v-if="isSubmitting" class="flex items-center space-x-3">
                    <div
                        class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"
                    ></div>
                    <span>{{ t(savingText) }}</span>
                </div>

                <!-- Normal state -->
                <div v-else class="flex items-center space-x-3">
                    <i class="fa-solid fa-save text-lg"></i>
                    <span>{{ t(saveButtonText) }}</span>
                </div>
            </button>
        </div>
    </div>
</template>
```

**Key Patterns**:
- i18n integration with `useI18n()` and `t()`
- Loading state with custom spinner
- Conditional rendering for loading vs normal state
- Optional border styling
- Shadow effects with color-specific opacity

---

## Example 5: UnifiedFormContainer (Layout Component)

**Location**: `resources/ts/Pages/Child-Components/UnifiedFormContainer.vue`

**Purpose**: Standardized container for all form pages with slots for tabs, content, and actions.

```vue
<script setup lang="ts">
import { useUsersStore } from "../../stores/usersStore";

const usersStore = useUsersStore();
</script>

<template>
    <div class="flex-1 flex justify-center items-center p-4 lg:p-6 min-h-0">
        <div class="w-full max-w-5xl max-h-full flex flex-col">
            <div
                :class="[
                    'relative overflow-hidden rounded-xl border backdrop-blur-sm flex flex-col max-h-full',
                    'transition-all duration-300',
                    usersStore.isDarkMode
                        ? 'bg-gradient-to-br from-slate-800/95 to-slate-900/95 border-slate-700/50 shadow-2xl shadow-black/40'
                        : 'bg-gradient-to-br from-white/95 to-gentle-moonlight-50/95 border-gentle-moonlight-200/60 shadow-2xl shadow-gentle-moonlight-900/10',
                ]"
            >
                <!-- Subtle background pattern -->
                <div
                    :class="[
                        'absolute inset-0 opacity-[0.02] pointer-events-none',
                        usersStore.isDarkMode
                            ? 'bg-gradient-to-br from-blue-400 via-transparent to-purple-400'
                            : 'bg-gradient-to-br from-blue-300 via-transparent to-purple-300',
                    ]"
                ></div>

                <!-- Tabs slot (optional) -->
                <div
                    v-if="$slots.tabs"
                    class="flex-shrink-0 border-b p-6"
                    :class="[
                        usersStore.isDarkMode
                            ? 'border-slate-700/50'
                            : 'border-gentle-moonlight-200/50',
                    ]"
                >
                    <slot name="tabs" />
                </div>

                <!-- Scrollable content area -->
                <div class="relative space-y-8 p-6 lg:p-8 flex-1 overflow-y-auto min-h-0">
                    <div class="space-y-4">
                        <slot />
                    </div>
                </div>

                <!-- Actions footer -->
                <div
                    class="flex-shrink-0 border-t p-6 lg:p-8"
                    :class="[
                        usersStore.isDarkMode
                            ? 'border-slate-700/50'
                            : 'border-gentle-moonlight-200/50',
                    ]"
                >
                    <div class="flex justify-between items-center">
                        <slot name="actions" />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
```

**Key Patterns**:
- Flexbox layout with proper overflow handling
- Named slots for tabs, content, and actions
- Gradient backgrounds with subtle patterns
- Responsive padding (`p-6 lg:p-8`)
- Flex-based sections: header (shrink-0), content (flex-1 overflow-y-auto), footer (shrink-0)
- `min-h-0` for proper flex overflow

---

## Example 6: ErrorPopup (Feedback Component)

**Location**: `resources/ts/Pages/Child-Components/ErrorPopup.vue`

**Purpose**: Modal popup for displaying validation and error messages with accessibility.

**Key Features**:
- Teleport to body for proper z-index layering
- Focus management with ref and watch
- Keyboard navigation (Escape, Tab)
- Transition animations
- Supports both single error and multiple validation errors
- i18n translation support
- Focus restoration after close

**Key Patterns** (from previous read):
- `<Teleport to="body">` for modals
- Focus trap with single focusable element
- Escape key handler
- `previouslyFocusedElement` storage for focus restoration
- Backdrop click-to-close
- Transition animations with `<Transition>` component
- Animated error list with staggered delays
- Translation key detection and interpolation

---

## Common Custom Components Reference

### Available Custom Components

**Form Inputs** (Prefer over DevExtreme):
- `TextInput.vue` - Standard text input
- `NumberInput.vue` - Number input with validation
- `SelectBox.vue` - Single-select dropdown
- `TagBox.vue` - Multi-select with tags
- `FileUploader.vue` - File upload with progress

**Layout**:
- `UnifiedFormContainer.vue` - Main form container
- `FormPageHeader.vue` - Page title section
- `FormSectionHeader.vue` - Section dividers

**Actions**:
- `Button.vue` - Generic button with variants
- `SaveButton.vue` - Save action button
- `CancelButton.vue` - Cancel action button

**Feedback**:
- `ErrorPopup.vue` - Error/validation display
- `SuccessPopup.vue` - Success confirmation

**Base Components**:
- `FormInput.vue` - Input wrapper (don't use directly, use TextInput, etc.)

### When to Use DevExtreme

Only use DevExtreme components when no custom alternative exists:

```vue
<!-- ✅ Use DevExtreme when needed -->
<DxDateBox
    v-model="formData.date"
    type="date"
    display-format="dd/MM/yyyy"
/>

<!-- No custom date picker exists yet -->
```
