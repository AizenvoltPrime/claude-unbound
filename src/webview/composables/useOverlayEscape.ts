import { onKeyStroke } from '@vueuse/core';

/**
 * Composable for standardized escape key handling in full-screen overlays.
 * Uses VueUse's onKeyStroke which automatically handles component lifecycle.
 */
export function useOverlayEscape(onClose: () => void): void {
  onKeyStroke('Escape', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClose();
  }, { target: document });
}
