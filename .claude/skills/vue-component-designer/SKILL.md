---
name: vue-component-designer
description: Expert guidance for designing Vue 3 components following IEMIS project visual styles, component patterns, and architectural principles. Use this skill when designing new Vue components, refactoring existing components, or ensuring component consistency across the application.
---

# Vue Component Designer

Design Vue 3 components that seamlessly integrate with the IEMIS project's established visual language, architectural patterns, and component ecosystem.

## When to Use This Skill

Invoke this skill when:

- Designing new Vue 3 components from scratch
- Refactoring existing components to match project standards
- Creating form inputs, layout components, or interactive elements
- Ensuring visual consistency across the application
- Implementing dark mode support in components
- Integrating validation and loading states
- Adding i18n support to components
- Questions about component styling, structure, or patterns arise

## Core Design Principles

### 1. Tailwind-First Styling

**Never write custom CSS unless absolutely necessary.** Use Tailwind utility classes for all styling:

```vue
<!-- ✅ CORRECT - Use Tailwind classes -->
<div class="px-4 py-2 rounded-lg border border-gray-300 bg-white">

<!-- ❌ AVOID - Custom CSS -->
<div class="custom-container" style="padding: 0.5rem 1rem;">
```

**Only use custom CSS for**: Complex keyframe animations not available in Tailwind (e.g., modal transitions). Scrollbar styling is handled globally.

### 2. Custom Components First

**Always use project custom components instead of native HTML elements or DevExtreme components:**

```vue
<!-- ✅ CORRECT - Use custom components -->
<script setup lang="ts">
import TextInput from "./Child-Components/TextInput.vue";
import Button from "./Child-Components/Button.vue";
import SaveButton from "./Child-Components/SaveButton.vue";
</script>

<template>
    <TextInput v-model="name" label="Name" />
    <Button text="Cancel" variant="secondary" />
    <SaveButton @save="handleSave" />
</template>

<!-- ❌ AVOID - Native HTML elements -->
<input type="text" v-model="name" />
<button @click="handleCancel">Cancel</button>

<!-- ❌ AVOID - DevExtreme when custom exists -->
<DxTextBox v-model="name" />
<DxButton text="Cancel" />
```

**Available custom components**: See `references/component-examples.md` for complete list.

**Use DevExtreme only when**: No custom alternative exists (e.g., DxDateBox for date pickers).

### 3. Dark Mode Support

**Every component must support both light and dark modes** using `usersStore.isDarkMode`. **Never use Tailwind's `dark:` prefix.**

```vue
<script setup lang="ts">
import { useUsersStore } from "../../stores/usersStore";

const usersStore = useUsersStore();
</script>

<template>
    <!-- ✅ CORRECT - Use usersStore.isDarkMode -->
    <div
        :class="[
            'base-classes',
            usersStore.isDarkMode
                ? 'bg-slate-700 text-white'
                : 'bg-white text-gray-900',
        ]"
    >

    <!-- ❌ AVOID - Tailwind dark: prefix -->
    <div class="bg-white dark:bg-slate-700">
```

### 4. TypeScript-First

**All components use `<script setup lang="ts">`** with proper type definitions:

```typescript
interface Props {
    modelValue?: string;
    label?: string;
    required?: boolean;
    disabled?: boolean;
}

interface Emits {
    "update:modelValue": [value: string];
    blur: [];
}

const props = withDefaults(defineProps<Props>(), {
    modelValue: "",
    required: false,
});

const emit = defineEmits<Emits>();
```

### 5. Internationalization (i18n)

**All user-facing text must use i18n** via `useI18n()`:

```vue
<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
    <label>{{ $t('label_key') }}</label>
    <button>{{ t('save') }}</button>
</template>
```

## Component Design Workflow

Follow these steps when designing a new component:

### Step 1: Determine Component Type

Identify what type of component to create:

1. **Form Input Component** → Wrap `FormInput.vue`, follow TextInput pattern
2. **Action Button** → Use or extend `Button.vue`, or create specialized button like `SaveButton.vue`
3. **Layout Component** → Follow `UnifiedFormContainer.vue` pattern with slots
4. **Feedback Component** → Follow `ErrorPopup.vue` pattern with Teleport
5. **Interactive Component** → Follow `TagBox.vue` pattern with state management

### Step 2: Review Reference Patterns

Before coding, review the relevant reference files:

- **Visual Patterns**: Read `references/visual-patterns.md` for color schemes, spacing, typography, transitions
- **Component Structure**: Read `references/component-structure-patterns.md` for TypeScript, props, emits, composables
- **Component Examples**: Read `references/component-examples.md` for similar component implementations

**Important**: Use Grep or Read tools to search these reference files for specific patterns:

```bash
# Search for button styling patterns
grep -n "button" references/visual-patterns.md

# Search for validation patterns
grep -n "validation" references/component-structure-patterns.md

# Find dropdown examples
grep -n "dropdown" references/component-examples.md
```

### Step 3: Define Component Interface

Design the component's Props and Emits:

```typescript
// Define what the component accepts
interface Props {
    // v-model binding
    modelValue?: string;

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
}

// Define what the component emits
interface Emits {
    "update:modelValue": [value: string];
    blur: [];
    input: [];
    change: [value: string];
}
```

### Step 4: Plan Component Structure

Organize the component following the standard structure:

```vue
<script setup lang="ts">
// 1. Imports (Vue, composables, stores, types)
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useUsersStore } from "../../stores/usersStore";

// 2. Interfaces (Props, Emits)
interface Props { /* ... */ }
interface Emits { /* ... */ }

// 3. Props and Emits
const props = withDefaults(defineProps<Props>(), { /* defaults */ });
const emit = defineEmits<Emits>();

// 4. Composables
const { t } = useI18n();
const usersStore = useUsersStore();

// 5. Component State (refs, reactive)
const isOpen = ref(false);

// 6. Computed Properties
const displayLabel = computed(() => t(props.label || ""));

// 7. Methods
const handleChange = (event: Event) => {
    // Implementation
};

// 8. Lifecycle Hooks (if needed)
onMounted(() => { /* ... */ });
</script>

<template>
    <!-- Component template -->
</template>

<style scoped>
/* Only if absolutely necessary for complex animations */
</style>
```

### Step 5: Implement Visual Styling

Apply consistent visual patterns from `references/visual-patterns.md`:

**Color Scheme**:
```vue
:class="[
    usersStore.isDarkMode
        ? 'bg-slate-700 text-white border-slate-600'
        : 'bg-white text-gray-900 border-gray-300',
]"
```

**Spacing**:
```vue
class="px-3 py-2 gap-3 space-y-4"
```

**Transitions**:
```vue
class="transition-all duration-200 hover:shadow-xl"
```

**Focus States**:
```vue
class="focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
```

### Step 6: Add Validation Integration

For form components, integrate validation states:

```vue
<script setup lang="ts">
interface Props {
    error?: string | null;
    isValid?: boolean;
    isValidating?: boolean;
}

// Compute input classes based on validation state
const inputClasses = computed(() => {
    const classes = ["base-classes"];

    if (props.error || !props.isValid) {
        classes.push("border-red-500 focus:ring-red-500");
    } else if (props.isValidating) {
        classes.push("border-blue-500");
    } else {
        classes.push("border-gray-300");
    }

    return classes;
});
</script>

<template>
    <!-- Input with validation classes -->
    <input :class="inputClasses" />

    <!-- Loading indicator -->
    <div v-if="isValidating" class="absolute right-2 top-1/2 -translate-y-1/2">
        <div class="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
    </div>

    <!-- Error message -->
    <div v-if="error" class="mt-1 text-sm text-red-500">
        {{ error }}
    </div>
</template>
```

### Step 7: Add Loading States

Implement consistent loading indicators:

**Button Loading**:
```vue
<button :disabled="loading || disabled">
    <div v-if="loading" class="flex items-center gap-2">
        <div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
        <span>{{ $t('saving') }}</span>
    </div>
    <div v-else class="flex items-center gap-2">
        <i class="fa-solid fa-save"></i>
        <span>{{ $t('save') }}</span>
    </div>
</button>
```

### Step 8: Implement Accessibility

Add proper accessibility features:

**Focus Management**:
```typescript
const inputRef = ref<HTMLInputElement>();
let previouslyFocusedElement: HTMLElement | null = null;

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

**Keyboard Navigation**:
```typescript
const handleKeydown = (event: KeyboardEvent) => {
    switch (event.key) {
        case 'Escape':
            event.preventDefault();
            handleClose();
            break;
        case 'Enter':
            event.preventDefault();
            handleSubmit();
            break;
    }
};
```

### Step 9: Review Checklist

Before finalizing, verify:

- [ ] Uses Tailwind classes exclusively (custom CSS only for complex animations)
- [ ] Supports both light and dark modes via `usersStore.isDarkMode` (never use `dark:` prefix)
- [ ] Uses custom components instead of native HTML elements or DevExtreme
- [ ] All text uses i18n via `$t()` or `t()`
- [ ] TypeScript interfaces for Props and Emits
- [ ] Validation states integrated (error, isValid, isValidating)
- [ ] Loading states with consistent spinner animation
- [ ] Proper focus management for accessibility
- [ ] Keyboard navigation (Escape, Enter, Tab)
- [ ] No inline comments (self-documenting code)
- [ ] Follows naming conventions (handle*, is*, *Ref)
- [ ] Emits proper events (update:modelValue, blur, input)

## Common Patterns Reference

### Pattern: Form Input Component

When creating a new input type, wrap `FormInput.vue`:

```vue
<script setup lang="ts">
import FormInput from "./FormInput.vue";

// Define props matching FormInput expectations
interface Props {
    modelValue?: string;
    label?: string;
    error?: string | null;
    required?: boolean;
    disabled?: boolean;
    isValid?: boolean;
    isValidating?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    modelValue: "",
    isValid: true,
    isValidating: false,
});

const emit = defineEmits<{
    "update:modelValue": [value: string];
    blur: [];
    input: [];
}>();

const handleChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    emit("update:modelValue", target.value);
};
</script>

<template>
    <FormInput
        :label="label"
        :error="error"
        :required="required"
        :is-valid="isValid"
        :is-validating="isValidating"
        @blur="() => emit('blur')"
        @input="() => emit('input')"
    >
        <template #default="{ inputProps, inputClasses }">
            <!-- Your custom input element -->
            <input
                type="text"
                :class="inputClasses"
                v-bind="inputProps"
                :value="modelValue"
                @input="handleChange"
                @blur="() => emit('blur')"
            />
        </template>
    </FormInput>
</template>
```

### Pattern: Modal/Popup Component

Use Teleport for overlays:

```vue
<template>
    <Teleport to="body">
        <Transition name="backdrop">
            <div
                v-if="visible"
                class="fixed inset-0 z-[9999] flex items-center justify-center p-4"
                @click.stop="handleClose"
                @keydown="handleKeydown"
            >
                <!-- Backdrop -->
                <div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>

                <!-- Modal content -->
                <Transition name="popup" appear>
                    <div
                        v-if="visible"
                        @click.stop
                        :class="[
                            'relative rounded-2xl shadow-2xl border max-w-md w-full',
                            usersStore.isDarkMode
                                ? 'bg-slate-800 border-slate-700'
                                : 'bg-white border-gray-200',
                        ]"
                    >
                        <!-- Modal content -->
                    </div>
                </Transition>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.backdrop-enter-active,
.backdrop-leave-active {
    transition: opacity 0.3s ease;
}

.backdrop-enter-from,
.backdrop-leave-to {
    opacity: 0;
}

.popup-enter-active {
    transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.popup-leave-active {
    transition: all 0.2s ease-in;
}

.popup-enter-from {
    opacity: 0;
    transform: translateY(-1rem) scale(0.9);
}

.popup-leave-to {
    opacity: 0;
    transform: translateY(0.5rem) scale(0.95);
}
</style>
```

### Pattern: Dropdown/Select Component

Complex dropdown with positioning:

```vue
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useDropdownPositioning } from "../../Composables/useDropdownPositioning";

const containerRef = ref<HTMLElement>();
const dropdownRef = ref<HTMLElement>();
const isOpen = ref(false);

// Use composable for smart positioning
const dropdownStyle = computed(() => {
    return useDropdownPositioning({
        triggerRef: containerRef.value || null,
        dropdownRef: dropdownRef.value || null,
        isOpen: isOpen.value,
        estimatedWidth: 200,
        estimatedHeight: 300,
    }).position.value;
});

// Click outside handler
const handleClickOutside = (event: Event) => {
    const target = event.target as Node;
    if (
        containerRef.value &&
        !containerRef.value.contains(target) &&
        dropdownRef.value &&
        !dropdownRef.value.contains(target)
    ) {
        isOpen.value = false;
    }
};

onMounted(() => {
    document.addEventListener("click", handleClickOutside);
});

onUnmounted(() => {
    document.removeEventListener("click", handleClickOutside);
});
</script>

<template>
    <div ref="containerRef">
        <!-- Trigger -->
        <button @click="isOpen = !isOpen">
            Toggle Dropdown
        </button>

        <!-- Dropdown -->
        <Teleport to="body">
            <div
                v-if="isOpen"
                ref="dropdownRef"
                :style="{
                    position: 'fixed',
                    top: dropdownStyle.top,
                    left: dropdownStyle.left,
                    width: dropdownStyle.width,
                    zIndex: dropdownStyle.zIndex,
                }"
                class="rounded-lg border shadow-xl bg-white dark:bg-slate-700"
            >
                <!-- Dropdown content -->
            </div>
        </Teleport>
    </div>
</template>
```

### Pattern: Button with Variants

Versatile button with size and variant support:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { useUsersStore } from "../../stores/usersStore";

interface Props {
    variant?: "primary" | "secondary" | "danger";
    size?: "sm" | "md" | "lg";
    loading?: boolean;
    disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    variant: "primary",
    size: "md",
    loading: false,
    disabled: false,
});

const usersStore = useUsersStore();

const buttonClasses = computed(() => [
    "inline-flex items-center justify-center font-medium transition-all duration-200",
    "disabled:opacity-50 disabled:cursor-not-allowed",

    // Size
    {
        "px-3 py-1.5 text-sm": props.size === "sm",
        "px-4 py-2 text-sm": props.size === "md",
        "px-6 py-3 text-base": props.size === "lg",
    },

    // Variant
    props.variant === "primary" && [
        usersStore.isDarkMode
            ? "bg-blue-600 hover:bg-blue-700 text-white"
            : "bg-blue-500 hover:bg-blue-600 text-white",
    ],

    props.variant === "secondary" && [
        usersStore.isDarkMode
            ? "bg-gray-700 text-gray-100 border border-gray-600"
            : "bg-gray-100 text-gray-700 border border-gray-300",
    ],

    props.variant === "danger" && [
        usersStore.isDarkMode
            ? "bg-red-600 text-white"
            : "bg-red-500 text-white",
    ],
]);
</script>

<template>
    <button
        :class="buttonClasses"
        :disabled="loading || disabled"
        type="button"
    >
        <slot />
    </button>
</template>
```

## Troubleshooting

### Issue: Custom CSS Needed

**Question**: Should I write custom CSS for this styling need?

**Answer**: Review `references/visual-patterns.md` first. 99% of styling can be done with Tailwind. Only use custom CSS for complex keyframe animations. Scrollbar styling is handled globally.

### Issue: Should I Use Custom Components or Native HTML?

**Question**: Should I use `<Button>` or `<button>`? `<TextInput>` or `<input>`?

**Answer**: **Always use custom components** from `Child-Components/` instead of native HTML elements or DevExtreme. Check `references/component-examples.md` for available components. Only use DevExtreme when no custom alternative exists (e.g., DxDateBox).

### Issue: Dark Mode Implementation

**Question**: Should I use `dark:` prefix or `usersStore.isDarkMode`?

**Answer**: **Never use Tailwind's `dark:` prefix.** Always use `usersStore.isDarkMode` with ternary operators:
```vue
:class="[
    usersStore.isDarkMode
        ? 'bg-slate-700 text-white'
        : 'bg-white text-gray-900',
]"
```

Reference `references/visual-patterns.md` "Color Schemes" for correct colors:
- Dark backgrounds: `bg-slate-800`, `bg-slate-700`
- Dark text: `text-white`, `text-gray-300`
- Dark borders: `border-slate-600`, `border-slate-700/50`

### Issue: Validation Not Working

**Question**: How do I integrate validation states?

**Answer**: Follow the validation pattern in `references/component-structure-patterns.md`. Use:
- Props: `error`, `isValid`, `isValidating`
- Conditional classes based on these props
- Loading spinner for `isValidating`
- Error message display for `error`

## Summary

When designing Vue components for IEMIS:

1. **Start with references**: Read `visual-patterns.md`, `component-structure-patterns.md`, and `component-examples.md`
2. **Use Tailwind exclusively**: No custom CSS except complex animations (scrollbars are global)
3. **Always use custom components**: Use `Button`, `TextInput`, etc. instead of native HTML or DevExtreme
4. **Support dark mode**: Use `usersStore.isDarkMode` ternaries (never `dark:` prefix)
5. **TypeScript everything**: Define Props and Emits interfaces
6. **Integrate i18n**: All text via `$t()` or `t()`
7. **Add validation states**: error, isValid, isValidating props
8. **Implement loading states**: Consistent spinner animations
9. **Ensure accessibility**: Focus management, keyboard navigation, translations
10. **Review checklist**: Verify all requirements before finalizing

The goal is seamless integration with the existing component ecosystem, maintaining visual consistency, and providing excellent user experience in both light and dark modes.
