// Small browser helpers shared by the views: motion preference and scripted scrolling.

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 'smooth' unless the user asked for less motion. Use for every scripted scroll. */
export const scrollBehavior = () => (reducedMotion() ? 'auto' : 'smooth');

/** Scroll an element (or an element id) into view, honouring reduced motion and the sticky top bar (via scroll-margin). */
export function scrollToEl(target, block = 'start') {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  el?.scrollIntoView({ behavior: scrollBehavior(), block });
  return el;
}

/** True when a key event comes from somewhere that types or has its own keyboard handling. */
export function isTypingTarget(t) {
  if (!t || !(t instanceof Element)) return false;
  return Boolean(t.closest('input, select, textarea, [contenteditable="true"], [role="dialog"], [role="alertdialog"], dialog'));
}
