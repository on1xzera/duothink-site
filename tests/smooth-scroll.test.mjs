import test from 'node:test';
import assert from 'node:assert/strict';

const originals = new Map();
function setGlobal(name, value) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value });
}
const reduced = { matches: false, addEventListener() {} };
let initializeSmoothScroll;

function fixture() {
  let time = 0, nextFrame = 0;
  const frames = new Map(), documentEvents = new Map(), windowEvents = new Map();
  class Element {
    scrollHeight = 0;
    clientHeight = 0;
    scrollTop = 0;
    parentElement = null;
    overflowY = 'visible';
  }
  const body = new Element();
  const target = new Element();
  target.parentElement = body;
  const match = (query) => query.includes('prefers-reduced-motion') ? reduced : { matches: true };
  const window = {
    scrollY: 0,
    matchMedia: match,
    // A standard-density viewport exposes whole CSS scroll pixels.
    scrollTo(_x, y) { this.scrollY = Math.round(y); },
    addEventListener(name, callback) { windowEvents.set(name, callback); },
  };
  setGlobal('Element', Element);
  setGlobal('window', window);
  setGlobal('document', {
    body,
    documentElement: { scrollHeight: 10_000 },
    addEventListener(name, callback) { documentEvents.set(name, callback); },
  });
  setGlobal('matchMedia', match);
  setGlobal('innerHeight', 900);
  Object.defineProperty(globalThis, 'scrollY', { configurable: true, get: () => window.scrollY });
  setGlobal('getComputedStyle', (element) => ({ overflowY: element.overflowY }));
  setGlobal('performance', { now: () => time });
  setGlobal('requestAnimationFrame', (callback) => { frames.set(++nextFrame, callback); return nextFrame; });
  setGlobal('cancelAnimationFrame', (id) => frames.delete(id));
  return {
    window, frames, target,
    wheel(deltaY, element = target) {
      let prevented = false;
      documentEvents.get('wheel')({ target: element, deltaY, deltaX: 0, deltaMode: 0, ctrlKey: false, preventDefault() { prevented = true; } });
      return prevented;
    },
    step(delta = 16) {
      time += delta;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(time));
    },
    stop() { windowEvents.get('pointerdown')(); },
  };
}

test.before(async () => {
  originals.set('scrollY', Object.getOwnPropertyDescriptor(globalThis, 'scrollY'));
  fixture();
  ({ initializeSmoothScroll } = await import('../assets/scripts/modules/smooth-scroll.js'));
});
test.after(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

test('continuous wheel input moves the page before the wheel stream stops', () => {
  const page = fixture();
  initializeSmoothScroll();
  for (let input = 0; input < 12; input++) {
    const before = page.window.scrollY;
    assert.equal(page.wheel(100), true);
    page.step();
    assert.ok(page.window.scrollY > before, `wheel event ${input} restarted scrolling`);
    assert.equal(page.frames.size, 1, 'only one animation loop may be active');
  }
  for (let frame = 0; frame < 60 && page.frames.size; frame++) page.step();
  assert.equal(page.window.scrollY, 1200);
  assert.equal(page.frames.size, 0, 'idle scrolling releases its animation loop');
});

test('a scrollable inner control retains native wheel handling', () => {
  const page = fixture();
  initializeSmoothScroll();
  page.target.scrollHeight = 800;
  page.target.clientHeight = 100;
  page.target.overflowY = 'auto';
  assert.equal(page.wheel(100), false);
  assert.equal(page.frames.size, 0);
  assert.equal(page.window.scrollY, 0);
});

test('direct pointer interaction interrupts pending smooth scrolling', () => {
  const page = fixture();
  initializeSmoothScroll();
  page.wheel(500);
  page.step();
  const stoppedAt = page.window.scrollY;
  page.stop();
  page.step();
  assert.equal(page.window.scrollY, stoppedAt);
  assert.equal(page.frames.size, 0);
});
