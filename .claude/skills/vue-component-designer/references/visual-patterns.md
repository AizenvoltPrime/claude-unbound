# Visual Style Patterns

This document outlines the visual styling patterns used across all Vue components in the IEMIS project.

## Core Principles

1. **Tailwind-First**: Use Tailwind utility classes for all styling. Custom CSS should only be used for complex animations not available in Tailwind.
2. **Dark Mode Support**: Every component must support both light and dark modes using `usersStore.isDarkMode` (never use Tailwind's `dark:` prefix).
3. **Custom Components First**: Always use project custom components (Button, TextInput, etc.) instead of native HTML elements or DevExtreme components.
4. **Consistent Spacing**: Use standardized Tailwind spacing values across components.
5. **Smooth Transitions**: Apply consistent transition animations for state changes.
6. **Accessibility**: Include proper focus states, keyboard navigation, and translations.

## Color Schemes

### Light Mode
- **Background**: `bg-white`, `bg-gentle-moonlight-50/95`, `bg-gray-100`
- **Text**: `text-gray-900`, `text-gray-700`, `text-gray-600`
- **Borders**: `border-gray-300`, `border-gentle-moonlight-200/60`
- **Primary Actions**: `bg-blue-500 hover:bg-blue-600 text-white`
- **Secondary Actions**: `bg-gray-100 text-gray-700 border-gray-300`
- **Danger/Error**: `bg-red-500 text-white`, `border-red-500 text-red-600`
- **Shadows**: `shadow-2xl shadow-gentle-moonlight-900/10`

### Dark Mode
- **Background**: `bg-slate-800`, `bg-slate-700`, `bg-gray-700`
- **Text**: `text-white`, `text-gray-300`, `text-gray-400`
- **Borders**: `border-slate-600`, `border-slate-700/50`
- **Primary Actions**: `bg-blue-600/90 hover:bg-blue-700/90 text-white`
- **Secondary Actions**: `bg-gray-700 text-gray-100 border-gray-600`
- **Danger/Error**: `bg-red-600/90 text-white`, `border-red-400 text-red-400`
- **Shadows**: `shadow-2xl shadow-black/40`

## Typography

- **Headers**: `text-2xl font-bold` (page headers), `text-lg font-semibold` (section headers)
- **Body Text**: `text-sm` or `text-base` for regular content
- **Labels**: `text-sm font-medium`
- **Helper Text**: `text-xs opacity-75`
- **Font Weights**: `font-medium` for emphasis, `font-semibold` for headers, `font-bold` for main titles

## Spacing Patterns

- **Padding**: Use `p-6 lg:p-8` for containers, `px-3 py-2` for inputs, `px-4 py-2` for buttons
- **Gaps**: `gap-3` for form elements, `gap-2` for small spacing, `space-y-4` or `space-y-8` for vertical spacing
- **Margins**: `mb-2` for label spacing, `mt-1` for error messages

## Border & Rounding

- **Inputs**: `rounded-md` or `rounded-lg`
- **Containers**: `rounded-xl`
- **Buttons**: `rounded-lg`, `rounded-md`, or `rounded-full` based on design
- **Border Width**: `border` (1px) standard, `border-2` for checkboxes, `border-l-4` for alerts

## Transitions & Animations

- **Standard Transitions**: `transition-all duration-200` or `transition-colors duration-200`
- **Hover Effects**: `hover:shadow-xl`, `hover:bg-blue-500`
- **Focus States**: `focus:outline-none focus:ring-2 focus:ring-blue-500`
- **Loading Spinners**: `animate-spin` with border trick: `border-2 border-blue-500 border-t-transparent rounded-full`
- **Fade Animations**: Opacity transitions for modals/dropdowns

## Focus & Interaction States

### Focus Rings
```
focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
focus:ring-offset-white (light mode)
focus:ring-offset-slate-800 (dark mode)
```

### Disabled States
```
disabled:opacity-50 disabled:cursor-not-allowed
bg-gray-100 text-gray-500 (light mode)
bg-slate-800 text-gray-400 (dark mode)
```

### Hover States
```
hover:bg-blue-600 (buttons)
hover:bg-gray-50 (list items - light)
hover:bg-slate-600 (list items - dark)
```

## Loading States

### Spinner Animation
```html
<div class="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
```

### Button Loading
```html
<div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
```

### Inline Validation Loading
```html
<div class="absolute right-2 top-1/2 transform -translate-y-1/2">
    <div class="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
</div>
```

## Error & Validation States

### Input Error State
```
border-red-500 focus:ring-red-500 focus:border-red-500 (light)
border-red-400 focus:ring-red-400 focus:border-red-400 (dark)
```

### Error Message Display
```html
<div
    :class="[
        'mt-1 text-sm',
        usersStore.isDarkMode ? 'text-red-400' : 'text-red-500',
    ]"
>
    {{ error }}
</div>
```

### Validation Success
```
border-green-500 (optional - usually just normal state)
```

## Shadow Patterns

- **Buttons**: `shadow-sm hover:shadow-md`, `shadow-lg shadow-blue-900/25`
- **Dropdowns**: `shadow-xl`
- **Containers**: `shadow-2xl` with color-specific opacity (e.g., `shadow-black/40`, `shadow-gentle-moonlight-900/10`)

## Gradient Backgrounds

### Container Gradients
```
bg-gradient-to-br from-white/95 to-gentle-moonlight-50/95 (light)
bg-gradient-to-br from-slate-800/95 to-slate-900/95 (dark)
```

### Button Gradients (Special Cases)
```
bg-gradient-to-br from-red-300 to-red-400 (light warning)
bg-gradient-to-br from-red-400 to-red-500 (dark warning)
```

## Icon Patterns

- **Icon Library**: Font Awesome (`fa-solid`, `fa-regular`)
- **Icon Sizing**: `text-xs`, `text-sm`, `text-base`, `text-lg` matching component size
- **Icon Spacing**: `mr-2` when before text, `ml-2` when after text
- **Icon Colors**: Inherit from parent text color or explicitly set

## Responsive Design

- **Mobile-First**: Base styles for mobile, use `lg:` prefix for desktop
- **Container Max Width**: `max-w-5xl` for forms, `max-w-md` for dialogs
- **Viewport Units**: Use `max-h-[80vh]` for modals, `min-h-0` for flex containers
- **Breakpoint Prefixes**: Primarily use `lg:` for desktop variations

## Component-Specific Patterns

### Form Containers
```
class="w-full max-w-5xl max-h-full flex flex-col"
class="rounded-xl border backdrop-blur-sm flex flex-col max-h-full"
class="overflow-y-auto flex-1 min-h-0" (scrollable content)
```

### Input Fields
```
class="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
```

### Buttons
```
class="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
```

### Dropdowns
```
class="rounded-lg border shadow-xl overflow-hidden"
position: fixed (with Teleport to body)
```

## Custom CSS Usage (Minimal)

**Avoid custom CSS.** Scrollbar styling is handled globally. Only use custom CSS for:

1. **Complex Animations**: `@keyframes` for custom animations not available in Tailwind (e.g., modal transitions with specific easing)

### Example: Custom Animation
```css
@keyframes fade-in-up {
    from {
        opacity: 0;
        transform: translateY(0.625rem);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

.animate-fade-in-up {
    animation: fade-in-up 0.3s ease-out forwards;
}
```

## Conditional Styling Pattern

Use computed properties with `usersStore.isDarkMode`:

```typescript
const containerClasses = computed(() => [
    'base-class-1 base-class-2',
    usersStore.isDarkMode
        ? 'dark-mode-classes'
        : 'light-mode-classes',
]);
```

Or inline with template `:class`:

```html
:class="[
    'base classes',
    usersStore.isDarkMode
        ? 'dark-mode-classes'
        : 'light-mode-classes',
]"
```
