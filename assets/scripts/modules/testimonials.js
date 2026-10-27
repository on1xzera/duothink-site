import { testimonials } from '../data/testimonials.js?v=2.0.12';
import { onActivate, reducedMotion } from './dom.js?v=2.0.12';
import { prepareAnimatedText, revealTextLines } from './motion.js?v=2.0.12';

export function initializeTestimonials() {
  document.querySelectorAll('[data-testimonials]').forEach((slider) => {
    let activeIndex = 0;
    let pointerStart = null;
    const quote = slider.querySelector('[data-testimonial-quote]');
    const author = slider.querySelector('[data-testimonial-author]');
    const portraits = [
      ...slider.querySelectorAll('[class*="testimonial-slider__portrait-"]'),
    ].filter((element) => element.querySelector('img'));
    const dots = [...slider.querySelectorAll('[data-slide-index]')];
    quote?.setAttribute('aria-live', 'polite');

    function displaySlide(index, animate = true) {
      const previousHeight = slider.getBoundingClientRect().height;
      activeIndex = (index + testimonials.length) % testimonials.length;
      const entry = testimonials[activeIndex];
      const paragraph = quote.querySelector('p');
      const mutedAt = entry.quote.indexOf(entry.muted);
      const muted = document.createElement('span');
      muted.className = 'testimonial-muted';
      muted.textContent = entry.muted;
      paragraph.replaceChildren(
        entry.quote.slice(0, mutedAt),
        muted,
        entry.quote.slice(mutedAt + entry.muted.length),
      );
      const name = document.createElement('span');
      name.className = 'testimonial-author-name';
      name.textContent = entry.author;
      author.querySelector('p').replaceChildren(name, `, ${entry.role}`);
      dots.forEach((dot) => {
        const active = Number(dot.dataset.slideIndex) === activeIndex;
        dot.classList.toggle('is-active', active);
        dot.setAttribute('aria-pressed', String(active));
      });
      portraits.forEach((portrait, index) => {
        const position = (index - activeIndex + testimonials.length) % testimonials.length;
        portrait.style.zIndex = String(testimonials.length - position);
        portrait.style.opacity = position === 0 ? '1' : '0';
        portrait.style.transform = 'none';
      });
      if (animate) {
        const letters = prepareAnimatedText(paragraph);
        const nextHeight = slider.getBoundingClientRect().height;
        if (!reducedMotion.matches) {
          revealTextLines(paragraph, letters, 50);
          const authorAnimation = author.animate(
            [
              { opacity: 0.001, transform: 'translateY(150px)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 1200, delay: 50, easing: 'cubic-bezier(.16,1,.3,1)' },
          );
          if (Math.abs(previousHeight - nextHeight) > 1) {
            const layout = slider.animate(
              [{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }],
              { duration: 400, easing: 'cubic-bezier(.22,1,.36,1)' },
            );
            layout.finished.catch(() => {});
          }
          authorAnimation.finished.catch(() => {});
        }
      }
    }

    slider
      .querySelectorAll('[data-slide-direction]')
      .forEach((arrow) =>
        onActivate(arrow, () => displaySlide(activeIndex + Number(arrow.dataset.slideDirection))),
      );
    dots.forEach((dot) => onActivate(dot, () => displaySlide(Number(dot.dataset.slideIndex))));
    slider.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      displaySlide(activeIndex + (event.key === 'ArrowRight' ? 1 : -1));
    });
    slider.addEventListener('pointerdown', (event) => {
      pointerStart = event.clientX;
    });
    slider.addEventListener('pointerup', (event) => {
      if (pointerStart !== null && Math.abs(event.clientX - pointerStart) > 50)
        displaySlide(activeIndex + (event.clientX < pointerStart ? 1 : -1));
      pointerStart = null;
    });
    slider.addEventListener('pointercancel', () => {
      pointerStart = null;
    });
    displaySlide(0, false);
  });
}
