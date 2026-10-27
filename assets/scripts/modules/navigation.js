import { onActivate, reducedMotion } from './dom.js?v=2.0.12';

export function initializeNavigation() {
  const triggers = [...document.querySelectorAll('[data-menu-toggle]')];
  const panels = [...document.querySelectorAll('[data-navigation-panel]')];
  const containers = [
    ...new Set(panels.map((panel) => panel.closest('.navigation-menu, .site-header'))),
  ];
  const animations = new Map();
  let open = false;
  let previousFocus = null;
  let openedByHover = false;
  let dismissTimer;
  let lastPointerType = 'mouse';

  function setOpen(nextOpen, restoreFocus = false) {
    if (nextOpen === open) return;
    const previousHeights = new Map(
      containers.map((container) => [container, container.getBoundingClientRect().height]),
    );
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    open = nextOpen;
    for (const trigger of triggers) trigger.setAttribute('aria-expanded', String(open));
    for (const panel of panels) {
      panel.hidden = !open;
      panel.inert = !open;
      panel.setAttribute('aria-hidden', String(!open));
      panel.closest('.navigation-menu')?.classList.toggle('is-open', open);
    }
    document
      .querySelectorAll('.site-header')
      .forEach((header) => header.classList.toggle('is-menu-open', open));
    if (!reducedMotion.matches) {
      containers.forEach((container) => {
        if (!container.getBoundingClientRect().width) return;
        const from = previousHeights.get(container);
        const to = container.getBoundingClientRect().height;
        const children = panels.filter(
          (panel) => panel.closest('.navigation-menu, .site-header') === container,
        );
        children.forEach((panel) => {
          panel.hidden = false;
        });
        // Damping 30, mass 1 and stiffness 300 reproduce the menu's original spring.
        const frames = Array.from({ length: 49 }, (_, index) => {
          const time = index / 60;
          const displacement =
            Math.exp(-15 * time) *
            (Math.cos(Math.sqrt(75) * time) + Math.sqrt(3) * Math.sin(Math.sqrt(75) * time));
          return { height: `${to + (from - to) * displacement}px` };
        });
        frames[frames.length - 1] = { height: `${to}px` };
        const animation = container.animate(frames, {
          duration: 800,
          easing: 'linear',
          fill: 'both',
        });
        animations.set(container, animation);
        animation.finished
          .then(() => {
            children.forEach((panel) => {
              panel.hidden = !open;
            });
            animations.delete(container);
            animation.cancel();
          })
          .catch(() => {});
      });
    }
    if (!open && restoreFocus) previousFocus?.focus();
  }

  for (const trigger of triggers) {
    onActivate(trigger, () => {
      openedByHover = false;
      previousFocus = trigger;
      setOpen(!open);
    });
  }
  document.querySelectorAll('.navigation-menu').forEach((menu) => {
    const enter = (event) => {
      if (event.pointerType) lastPointerType = event.pointerType;
      if (lastPointerType !== 'mouse' || event.sourceCapabilities?.firesTouchEvents) return;
      clearTimeout(dismissTimer);
      openedByHover = true;
      setOpen(true);
    };
    menu.addEventListener('pointerenter', enter);
    menu.addEventListener('mouseenter', enter);
    menu.addEventListener('pointerleave', () => {
      clearTimeout(dismissTimer);
      dismissTimer = setTimeout(() => {
        if (openedByHover && !menu.matches(':hover') && !menu.contains(document.activeElement))
          setOpen(false);
      }, 150);
    });
    menu.addEventListener('focusout', () => {
      queueMicrotask(() => {
        if (!menu.contains(document.activeElement) && !menu.matches(':hover')) setOpen(false);
      });
    });
  });
  document.addEventListener('pointerdown', (event) => {
    if (open && !event.target.closest('[data-navigation-panel], [data-menu-toggle]'))
      setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) setOpen(false, true);
  });
  document
    .querySelectorAll('[data-navigation-panel] a')
    .forEach((link) => link.addEventListener('click', () => setOpen(false)));
  window.matchMedia('(max-width: 809.98px)').addEventListener('change', () => setOpen(false));

  // The reference displays the visitor's local time beside its location label.
  const clocks = [...document.querySelectorAll('[data-local-time]')];
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const updateClocks = () =>
    clocks.forEach((clock) => {
      clock.textContent = formatter.format(new Date());
    });
  updateClocks();
  const clockTimer = clocks.length ? window.setInterval(updateClocks, 30_000) : null;
  window.addEventListener('pagehide', () => clearInterval(clockTimer), { once: true });
}
