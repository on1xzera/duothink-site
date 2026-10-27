import { reducedMotion } from './dom.js?v=2.0.12';

/** Match the original 0.8-second easing while retaining native touch scrolling. */
export function initializeSmoothScroll() {
  const precisePointer = matchMedia('(pointer: fine)');
  let target = window.scrollY;
  let position = target;
  let frame = 0;
  let lastTime = 0;
  let targetUpdatedAt = 0;
  const duration = 800;
  const maximum = () => Math.max(0, document.documentElement.scrollHeight - innerHeight);

  function tick(time) {
    const delta = Math.max(0, time - lastTime);
    lastTime = time;
    // The same exponential easing, integrated per frame: new wheel events
    // update the destination without restarting the animation at zero progress.
    const blend = 1 - 2 ** ((-10 * delta) / duration);
    position += (target - position) * blend;
    if (time - targetUpdatedAt >= duration || Math.abs(target - position) < 0.5)
      position = target;
    window.scrollTo(0, position);
    if (position !== target) frame = requestAnimationFrame(tick);
    else {
      frame = 0;
      lastTime = 0;
    }
  }
  function scrollTo(top) {
    target = Math.max(0, Math.min(maximum(), top));
    targetUpdatedAt = performance.now();
    if (reducedMotion.matches) {
      stop();
      window.scrollTo(0, Math.max(0, Math.min(maximum(), top)));
      return;
    }
    if (frame) return;
    position = window.scrollY;
    lastTime = targetUpdatedAt;
    frame = requestAnimationFrame(tick);
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    position = target = window.scrollY;
  }

  document.addEventListener(
    'wheel',
    (event) => {
      if (
        !precisePointer.matches ||
        reducedMotion.matches ||
        event.ctrlKey ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return;
      let parent = event.target instanceof Element ? event.target : null;
      while (parent && parent !== document.body) {
        if (
          parent.scrollHeight > parent.clientHeight &&
          /(auto|scroll)/u.test(getComputedStyle(parent).overflowY) &&
          ((event.deltaY > 0 && parent.scrollTop + parent.clientHeight < parent.scrollHeight) ||
            (event.deltaY < 0 && parent.scrollTop > 0))
        )
          return;
        parent = parent.parentElement;
      }
      event.preventDefault();
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
      scrollTo((frame ? target : scrollY) + event.deltaY * multiplier);
    },
    { passive: false },
  );

  document.addEventListener('click', (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank') return;
    const destination = new URL(link.href, location.href);
    if (
      destination.origin !== location.origin ||
      destination.pathname !== location.pathname ||
      !destination.hash
    )
      return;
    const element = document.getElementById(decodeURIComponent(destination.hash.slice(1)));
    if (!element) return;
    event.preventDefault();
    history.pushState(null, '', destination.hash);
    scrollTo(element.getBoundingClientRect().top + scrollY);
  });
  window.addEventListener('keydown', stop);
  window.addEventListener('pointerdown', stop);
  window.addEventListener('resize', stop);
  window.addEventListener('hashchange', stop);
}
