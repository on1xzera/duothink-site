import { onActivate, reducedMotion } from './dom.js?v=2.0.12';
import { prepareAnimatedText, revealTextLines } from './motion.js?v=2.0.12';

export function initializeAccordions() {
  document.querySelectorAll('[data-accordion]').forEach((item) => {
    const answer = item.querySelector('.faq-answer');
    let letters;
    let layout;
    onActivate(item, () => {
      const previousHeight = answer.hidden ? 0 : answer.getBoundingClientRect().height;
      const previousPadding = answer.hidden
        ? 0
        : parseFloat(getComputedStyle(answer).paddingBottom);
      layout?.cancel();
      const open = item.getAttribute('aria-expanded') !== 'true';
      item.setAttribute('aria-expanded', String(open));
      answer.hidden = false;
      answer.setAttribute('aria-hidden', String(!open));
      answer.inert = !open;
      if (open && !letters) letters = prepareAnimatedText(answer.querySelector('p'));
      const nextHeight = open ? answer.getBoundingClientRect().height : 0;
      if (!reducedMotion.matches) {
        if (open) revealTextLines(answer.querySelector('p'), letters, 50);
        layout = answer.animate(
          [
            {
              height: `${previousHeight}px`,
              paddingBottom: `${previousPadding}px`,
              overflow: 'hidden',
            },
            { height: `${nextHeight}px`, paddingBottom: open ? '24px' : '0px', overflow: 'hidden' },
          ],
          { duration: 600, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' },
        );
        const animation = layout;
        animation.finished
          .then(() => {
            answer.hidden = item.getAttribute('aria-expanded') !== 'true';
            animation.cancel();
          })
          .catch(() => {});
      } else answer.hidden = !open;
    });
  });
}
