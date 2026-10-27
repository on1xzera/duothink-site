import { reducedMotion, scheduleFrame } from './dom.js?v=2.0.12';

const TEXT_EASING = 'cubic-bezier(.16,1,.3,1)';

/** Preserve rich text boundaries and the original line-breaking behavior. */
export function prepareAnimatedText(element, mode = 'reveal') {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  const characters = [];
  for (const text of textNodes) {
    const fragment = document.createDocumentFragment();
    const pieces = text.textContent.split(/(\s+)/u);
    const lastWord = pieces.findLastIndex((piece) => piece && !/^\s+$/u.test(piece));
    for (const [index, word] of pieces.entries()) {
      if (!word) continue;
      if (/^\s+$/u.test(word)) {
        fragment.append(document.createTextNode(word));
        continue;
      }
      const wrapper = document.createElement('span');
      wrapper.className = 'animated-word';
      if (index === lastWord && mode !== 'scroll') wrapper.classList.add('animated-word--flow');
      for (const character of word) {
        const span = document.createElement('span');
        span.className = mode === 'scroll' ? 'scroll-character' : 'reveal-character';
        span.textContent = character;
        span.setAttribute('aria-hidden', 'true');
        wrapper.append(span);
        characters.push(span);
      }
      fragment.append(wrapper);
    }
    text.replaceWith(fragment);
  }
  element.setAttribute('aria-label', element.textContent.trim().replace(/\s+/gu, ' '));
  return characters;
}

/** Characters on the same visual line enter together, with a delay between lines. */
export function revealTextLines(element, characters, lineDelay = 80) {
  if (reducedMotion.matches) return;
  const lines = [];
  for (const character of characters) {
    const top = character.getBoundingClientRect().top;
    let line = lines.find((entry) => Math.abs(entry.top - top) < 2);
    if (!line) {
      line = { top, characters: [] };
      lines.push(line);
    }
    line.characters.push(character);
  }
  const offset = Number(element.dataset.revealOffset || 34);
  lines.forEach((line, index) => {
    line.characters.forEach((character) => {
      const animation = character.animate(
        [
          { opacity: 0.001, transform: `translateY(${offset}px)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 1200, delay: index * lineDelay, easing: TEXT_EASING, fill: 'both' },
      );
      animation.finished.then(() => animation.cancel()).catch(() => {});
    });
  });
}

function revealElement(element) {
  const offset = Number(element.dataset.revealOffset || 150);
  const horizontalOffset = Number(element.dataset.revealX || 0);
  const scale = Number(element.dataset.revealScale || 1);
  const opacity = Number(element.dataset.revealOpacity || 0.001);
  const animation = element.animate(
    [
      { opacity, transform: `translate(${horizontalOffset}px, ${offset}px) scale(${scale})` },
      { opacity: 1, transform: 'none' },
    ],
    {
      duration: Number(element.dataset.revealDuration || 1200),
      delay: Number(element.dataset.revealDelay || 0),
      easing: element.dataset.revealEase || TEXT_EASING,
      fill: 'both',
    },
  );
  animation.finished.then(() => animation.cancel()).catch(() => {});
}

export function initializeMotion() {
  const characters = new WeakMap();
  const elements = [...document.querySelectorAll('[data-reveal]')];
  function enter(entries, observer) {
    for (const { target: element, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      observer.unobserve(element);
      if (!reducedMotion.matches) {
        if (characters.has(element)) revealTextLines(element, characters.get(element));
        else revealElement(element);
      }
      element.classList.remove('is-reveal-ready');
    }
  }
  const textObserver = new IntersectionObserver(enter, { threshold: 0.5 });
  const elementObserver = new IntersectionObserver(enter, { threshold: 0.01 });
  elements.forEach((element) => {
    if (element.dataset.reveal === 'characters')
      characters.set(element, prepareAnimatedText(element));
    if (!reducedMotion.matches) element.classList.add('is-reveal-ready');
  });
  document.fonts.ready.then(() => {
    elements.forEach((element) => {
      if (element.dataset.revealTrigger === 'mount') {
        if (!reducedMotion.matches) {
          if (characters.has(element)) revealTextLines(element, characters.get(element), 50);
          else revealElement(element);
        }
        element.classList.remove('is-reveal-ready');
      } else {
        (characters.has(element) ? textObserver : elementObserver).observe(element);
      }
    });
  });

  const scrollText = [...document.querySelectorAll('[data-scroll-text]')].map((element) => {
    // Each word occupies an equal part of the scroll interval, including indentation.
    const words = element.textContent.trimEnd().split(/\s/u);
    const ranges = words.flatMap((word, wordIndex) =>
      [...word].map((character, index) => ({
        start: (wordIndex + index / word.length) / words.length,
        end: (wordIndex + (index + 1) / word.length) / words.length,
      })),
    );
    return {
      element,
      characters: prepareAnimatedText(element, 'scroll').map((character, index) => ({
        element: character,
        ...ranges[index],
        channel: -1,
      })),
      top: 0,
      enabled: false,
      previous: -1,
    };
  });
  const hero = document.querySelector('.home-hero');
  const parallax = [
    ...document.querySelectorAll(
      '.home-hero__content, .home-hero__gradient, .home-hero__ripple-layer',
    ),
  ];
  let viewportHeight = window.innerHeight;
  let heroBottom = hero?.offsetHeight || 0;
  let previousParallax = -1;

  function measure() {
    viewportHeight = window.innerHeight;
    heroBottom = hero?.offsetHeight || 0;
    scrollText.forEach((entry) => {
      entry.enabled = entry.element.getClientRects().length > 0;
      entry.top = entry.element.getBoundingClientRect().top + window.scrollY;
      entry.previous = -1;
    });
    update();
  }
  function update() {
    for (const entry of scrollText) {
      if (!entry.enabled) continue;
      const progress = reducedMotion.matches
        ? 1
        : Math.max(
            0,
            Math.min(
              1,
              (window.scrollY + viewportHeight * 0.75 - entry.top) / (viewportHeight * 0.6),
            ),
          );
      if (progress === entry.previous) continue;
      entry.previous = progress;
      entry.characters.forEach((character) => {
        const { element, start, end } = character;
        const position = Math.max(0, Math.min(1, (progress - start) / (end - start)));
        const channel = Math.round(Math.sqrt(102 ** 2 + (255 ** 2 - 102 ** 2) * position));
        if (channel === character.channel) return;
        character.channel = channel;
        element.style.color = `rgb(${channel}, ${channel}, ${channel})`;
      });
    }
    if (hero && window.scrollY <= heroBottom + viewportHeight) {
      const offset = reducedMotion.matches ? 0 : Math.min(window.scrollY, heroBottom) * 0.4;
      if (offset !== previousParallax) {
        previousParallax = offset;
        parallax.forEach((element) => {
          element.style.translate = `0 ${offset}px`;
        });
      }
    }
  }
  const requestUpdate = scheduleFrame(update);
  const requestMeasure = scheduleFrame(measure);
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestMeasure, { passive: true });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      elements.forEach((element) => {
        element.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
        element.classList.remove('is-reveal-ready');
      });
    }
    requestMeasure();
  });
  document.fonts.ready.then(requestMeasure);
  new ResizeObserver(requestMeasure).observe(document.body);
  measure();
}
