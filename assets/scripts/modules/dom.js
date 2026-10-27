/** Keep keyboard behavior consistent for custom controls in the original layout. */
export function onActivate(element, callback) {
  element.addEventListener('click', callback);
  if (!['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) {
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      callback(event);
    });
  }
}

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Run at most one update per display frame, regardless of event frequency. */
export function scheduleFrame(callback) {
  let frameId = 0;
  return () => {
    if (frameId) return;
    frameId = requestAnimationFrame(() => {
      frameId = 0;
      callback();
    });
  };
}
