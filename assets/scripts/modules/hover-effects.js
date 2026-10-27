import { onActivate } from './dom.js?v=2.0.12';

export function initializeHoverEffects() {
  document.querySelectorAll('[data-folder]').forEach((folder) => {
    const setOpen = (open) => folder.classList.toggle('is-open', open);
    folder.addEventListener('pointerenter', () => setOpen(true));
    folder.addEventListener('pointerleave', () => setOpen(false));
    onActivate(folder, () => setOpen(!folder.classList.contains('is-open')));
    folder.addEventListener('focus', () => setOpen(true));
    folder.addEventListener('blur', () => setOpen(false));
  });
}
