import { reducedMotion } from './dom.js?v=2.0.12';

export function initializeProcess() {
  document.querySelectorAll('.process-card').forEach((process) => {
    const steps = [...process.querySelectorAll('.process-step')];
    const markers = [...process.querySelectorAll('.process-marker')];
    let visible = false;
    let frame = 0;
    let elapsed = 0;
    let lastTime = 0;
    let previousStage = -1;
    const previousProgress = markers.map(() => -1);

    function render(time) {
      frame = 0;
      if (!visible || document.hidden) return;
      const delta = lastTime ? Math.min(time - lastTime, 100) : 0;
      lastTime = time;
      elapsed = reducedMotion.matches ? 4_500 : (elapsed + delta) % 5_000;
      const stage = Math.min(2, Math.floor(elapsed / 2_000));
      if (stage !== previousStage) {
        steps.forEach((step, index) => {
          step.style.opacity = index <= stage ? '1' : '.4';
        });
        previousStage = stage;
      }
      markers.forEach((marker, index) => {
        const progress = Math.max(0, Math.min(1, (elapsed - index * 2_000) / 2_000));
        if (progress === previousProgress[index]) return;
        previousProgress[index] = progress;
        marker.style.setProperty('--step-progress', String(progress));
      });
      if (!reducedMotion.matches) frame = requestAnimationFrame(render);
    }
    function synchronize() {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      if (visible && !document.hidden) frame = requestAnimationFrame(render);
    }
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      synchronize();
    }).observe(process);
    document.addEventListener('visibilitychange', synchronize);
    reducedMotion.addEventListener('change', synchronize);
  });
}
