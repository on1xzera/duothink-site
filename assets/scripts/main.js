import { initializeProcess } from './modules/process.js?v=2.0.12';
import { initializeNavigation } from './modules/navigation.js?v=2.0.12';
import { initializeAccordions } from './modules/accordion.js?v=2.0.12';
import { initializeTestimonials } from './modules/testimonials.js?v=2.0.12';
import { initializeMotion } from './modules/motion.js?v=2.0.12';
import { initializeSmoothScroll } from './modules/smooth-scroll.js?v=2.0.12';
import { initializeContactForm } from './modules/contact-form.js?v=2.0.12';
import { initializeHoverEffects } from './modules/hover-effects.js?v=2.0.12';

initializeNavigation();
initializeProcess();
initializeAccordions();
initializeTestimonials();
initializeMotion();
initializeSmoothScroll();
initializeContactForm();
initializeHoverEffects();

if (document.querySelector('[data-isotype]')) {
  import('./modules/isotype.js?v=2.0.12')
    .then(({ initializeIsotypes }) => initializeIsotypes())
    .catch(() => {});
}

if (document.querySelector('[data-globe]')) {
  import('./modules/globe.js?v=2.0.12')
    .then(({ initializeGlobe }) => initializeGlobe())
    .catch(() => {});
}

// Load the graphics renderer only on pages that contain an animated surface.
if (document.querySelector('[data-shader]')) {
  import('./modules/shaders.js?v=2.0.12')
    .then(({ initializeShaders }) => initializeShaders())
    .catch(() => {
      // The original local artwork remains visible if WebGL is unavailable.
    });
}
