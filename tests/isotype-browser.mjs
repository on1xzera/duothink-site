import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSiteServer } from '../tools/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const referenceImage =
  'data:image/png;base64,' +
  (await readFile(path.join(root, 'tests/fixtures/isotype-reference.png'))).toString('base64');
const server = process.env.BROWSER_TEST_BASE_URL
  ? null
  : createSiteServer(process.argv.includes('--production') ? path.join(root, 'dist') : root);
if (server) await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = process.env.BROWSER_TEST_BASE_URL || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
  args:
    process.env.BROWSER_TEST_NO_SANDBOX === '1'
      ? ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader']
      : [],
});
const widths = process.env.BROWSER_TEST_WIDTHS?.split(',').map(Number) || [1440, 1024, 390, 360];

async function metrics(logo) {
  return logo.evaluate((element) => window.isotypeFrames.get(element.querySelector('canvas')));
}
async function waitForMotion(logo, previous) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const current = await metrics(logo);
    if (current.hash !== previous.hash && current.frames > previous.frames) return current;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The isotype did not render changing 3D pixels after input.');
}
function unchangedBounds(before, after) {
  for (const field of ['x', 'y', 'width', 'height'])
    assert.ok(Math.abs(before[field] - after[field]) < 0.5, `Interaction moved the ${field} bound`);
}

try {
  for (const width of widths) {
    const page = await browser.newPage({
      viewport: { width, height: width < 810 ? 844 : 1000 },
      hasTouch: width < 810,
      isMobile: width < 810,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.isotypeFrames = new WeakMap();
      const prototype = WebGL2RenderingContext.prototype;
      const buffer = prototype.bufferData;
      const draw = prototype.drawElements;
      prototype.bufferData = function (target, data, ...arguments_) {
        if (this.canvas.closest('[data-isotype]') && data instanceof Float32Array) {
          const depths = [],
            frontPlanes = new Set();
          for (let index = 2; index < data.length; index += 7) {
            depths.push(data[index]);
            if (data[index + 3] > 0.999) frontPlanes.add(data[index].toFixed(4));
          }
          window.isotypeFrames.set(this.canvas, {
            frames: 0,
            depth: Math.max(...depths) - Math.min(...depths),
            finite: data.every(Number.isFinite),
            frontPlanes: frontPlanes.size,
          });
        }
        return buffer.call(this, target, data, ...arguments_);
      };
      prototype.drawElements = function (...arguments_) {
        const result = draw.apply(this, arguments_);
        const state = window.isotypeFrames.get(this.canvas);
        if (state) {
          const width = Math.min(this.canvas.width, 128);
          const height = Math.min(this.canvas.height, 128);
          const pixels = new Uint8Array(width * height * 4);
          this.readPixels(
            Math.floor((this.canvas.width - width) / 2),
            Math.floor((this.canvas.height - height) / 2),
            width,
            height,
            this.RGBA,
            this.UNSIGNED_BYTE,
            pixels,
          );
          let hash = 2166136261;
          const shades = new Set();
          for (let index = 0; index < pixels.length; index++) {
            hash = Math.imul(hash ^ pixels[index], 16777619);
            if (index % 4 === 0 && pixels[index + 3] > 240) shades.add(pixels[index]);
          }
          state.frames++;
          state.hash = hash;
          state.shades = shades.size;
          if (!state.initialImage) state.initialImage = this.canvas.toDataURL('image/png');
        }
        return result;
      };
    });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => Number.isFinite(animation.effect.getComputedTiming().endTime))
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    for (const section of ['.home-hero__wordmark', '.site-footer']) {
      const logo = page.locator(`${section} [data-isotype]`).filter({ visible: true });
      await page.mouse.move(1, 1);
      await logo.scrollIntoViewIfNeeded();
      await logo.evaluate(
        (element) =>
          new Promise((resolve, reject) => {
            const deadline = performance.now() + 8000;
            function check() {
              if (element.classList.contains('is-ready')) return resolve();
              if (performance.now() > deadline)
                return reject(new Error('3D renderer did not start'));
              setTimeout(check, 50);
            }
            check();
          }),
      );
      const bounds = await logo.boundingBox();
      const initial = await metrics(logo);
      assert.ok(initial.finite && initial.depth > 0.25, 'A finite extruded 3D mesh is required');
      assert.equal(
        initial.frontPlanes,
        2,
        'The original tabs must remain two separate front faces',
      );
      assert.ok(initial.shades > 15, 'White metal must retain lighting and shaded relief');
      const silhouette = await logo.evaluate(async (element, referenceImage) => {
        const actual = new Image(),
          vector = new Image();
        actual.src = window.isotypeFrames.get(element.querySelector('canvas')).initialImage;
        vector.src = referenceImage;
        await Promise.all([actual.decode(), vector.decode()]);
        const canvas = document.createElement('canvas');
        canvas.width = actual.naturalWidth;
        canvas.height = actual.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(actual, 0, 0);
        const mask = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const luminance = (x, y) => {
          const scale = 0.94 * Math.min(canvas.width / 647, canvas.height / 602);
          const px = Math.round(
            (canvas.width - 647 * scale) / 2 - canvas.width * 0.025 + x * scale,
          );
          const py = Math.round((canvas.height - 602 * scale) / 2 + y * scale);
          const i = (py * canvas.width + px) * 4;
          return (mask[i] + mask[i + 1] + mask[i + 2]) / 3;
        };
        const seamContrast = luminance(300, 273) - luminance(300, 286);
        context.clearRect(0, 0, canvas.width, canvas.height);
        const scale = 0.94 * Math.min(canvas.width / 647, canvas.height / 602);
        context.drawImage(
          vector,
          (canvas.width - 647 * scale) / 2 - canvas.width * 0.025,
          (canvas.height - 602 * scale) / 2,
          647 * scale,
          602 * scale,
        );
        const expected = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let intersection = 0,
          union = 0;
        let minimumX = canvas.width,
          maximumX = 0,
          minimumY = canvas.height,
          maximumY = 0;
        for (let index = 3; index < mask.length; index += 4) {
          const a = mask[index] > 127,
            b = expected[index] > 127;
          if (a) {
            const pixel = (index - 3) / 4;
            minimumX = Math.min(minimumX, pixel % canvas.width);
            maximumX = Math.max(maximumX, pixel % canvas.width);
            minimumY = Math.min(minimumY, Math.floor(pixel / canvas.width));
            maximumY = Math.max(maximumY, Math.floor(pixel / canvas.width));
          }
          if (a && b) intersection++;
          if (a || b) union++;
        }
        const bounds = element.getBoundingClientRect();
        const visible = {
          left: bounds.left + (minimumX / canvas.width) * bounds.width,
          right: bounds.left + ((maximumX + 1) / canvas.width) * bounds.width,
          top: bounds.top + (minimumY / canvas.height) * bounds.height,
          bottom: bounds.top + ((maximumY + 1) / canvas.height) * bounds.height,
        };
        const clipping = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent),
            box = parent.getBoundingClientRect();
          if (style.display === 'contents') continue;
          const cutsX = ['clip', 'hidden', 'auto', 'scroll'].includes(style.overflowX);
          const cutsY = ['clip', 'hidden', 'auto', 'scroll'].includes(style.overflowY);
          if (
            (cutsX && (visible.left < box.left - 1 || visible.right > box.right + 1)) ||
            (cutsY && (visible.top < box.top - 1 || visible.bottom > box.bottom + 1))
          )
            clipping.push(parent.className);
        }
        return {
          overlap: intersection / union,
          left: bounds.left + (minimumX / canvas.width) * bounds.width,
          anchor: element.closest('h1').getBoundingClientRect().left,
          height: ((maximumY - minimumY + 1) / canvas.height) * bounds.height,
          fontSize: parseFloat(getComputedStyle(element).fontSize),
          clipping,
          seamContrast,
        };
      }, referenceImage);
      assert.ok(silhouette.overlap > 0.99, 'The neutral 3D silhouette must match the original PNG');
      assert.ok(
        silhouette.seamContrast > 10,
        'The original horizontal overlap must remain visible',
      );
      assert.deepEqual(silhouette.clipping, [], 'Containers must not clip the isotype outline');
      assert.ok(
        Math.abs(silhouette.left - silhouette.anchor) < 3,
        'Visible isotype must align to the content edge',
      );
      if (section === '.home-hero__wordmark')
        assert.ok(
          silhouette.height > silhouette.fontSize * 1.3,
          'Hero isotype must be visibly enlarged',
        );
      await logo.hover({ position: { x: bounds.width * 0.85, y: bounds.height * 0.25 } });
      const hover = await waitForMotion(logo, initial);
      unchangedBounds(bounds, await logo.boundingBox());
      await logo.click({ position: { x: bounds.width * 0.5, y: bounds.height * 0.5 } });
      const clicked = await waitForMotion(logo, hover);
      unchangedBounds(bounds, await logo.boundingBox());
      const center = { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.5 };
      await page.mouse.move(center.x, center.y);
      await page.mouse.down();
      await page.mouse.move(center.x + 30, center.y - 15, { steps: 8 });
      await page.mouse.up();
      const dragged = await waitForMotion(logo, clicked);
      unchangedBounds(bounds, await logo.boundingBox());
      await logo.focus();
      await page.keyboard.press('ArrowLeft');
      await waitForMotion(logo, dragged);
      await page.keyboard.press('Home');
      if (width < 810) {
        const beforeTap = await metrics(logo);
        await page.touchscreen.tap(center.x, center.y);
        await waitForMotion(logo, beforeTap);
        unchangedBounds(bounds, await logo.boundingBox());
      }
    }
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    const footer = page.locator('.site-footer [data-isotype]').filter({ visible: true });
    await page.waitForTimeout(300);
    const paused = await metrics(footer);
    await page.waitForTimeout(350);
    assert.equal(
      (await metrics(footer)).frames,
      paused.frames,
      'Offscreen sculptures must stop rendering',
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${width}px: mesh, metallic shading, hover, click, drag, keyboard, fixed bounds, offscreen pause${width < 810 ? ', touch' : ''}.`,
    );
    await page.close();
  }
  const fallback = await browser.newPage();
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...arguments_) {
      if (type === 'webgl2' && this.closest('[data-isotype]')) return null;
      return original.call(this, type, ...arguments_);
    };
  });
  await fallback.goto(origin, { waitUntil: 'networkidle' });
  const logo = fallback.locator('.home-hero__wordmark [data-isotype]').filter({ visible: true });
  assert.equal(
    await logo.evaluate((element) => getComputedStyle(element.querySelector('img')).visibility),
    'visible',
  );
  assert.ok(
    await logo.locator('img').evaluate(async (image) => {
      await image.decode();
      return image.naturalWidth > 0;
    }),
  );
  const svg = await (await fallback.request.get(origin + '/assets/images/isotype.svg')).text();
  assert.match(svg, /fill="#fff"/u);
  assert.equal((svg.match(/<path\b/gu) || []).length, 2);
  assert.doesNotMatch(svg, /<image\b|data:image/iu);
  console.log('PASS white SVG fallback: two vector paths, no embedded bitmap.');
  await fallback.close();
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
