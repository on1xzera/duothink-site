import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSiteServer } from '../tools/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = process.argv.includes('--production')
  ? path.join(projectRoot, 'dist')
  : projectRoot;
const server = process.env.BROWSER_TEST_BASE_URL ? null : createSiteServer(siteRoot);
if (server) await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = process.env.BROWSER_TEST_BASE_URL || `http://127.0.0.1:${server.address().port}`;
const screenshotDirectory = process.env.BROWSER_TEST_SCREENSHOTS_DIR;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
  args:
    process.env.BROWSER_TEST_NO_SANDBOX === '1'
      ? ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader']
      : [],
});
const errors = [],
  failedResources = [],
  measurements = [];
const routes = [
  '/',
  '/about',
  '/contact',
  '/projects/paulo-padilha',
  '/projects/bloom-co',
  '/projects/pulse-fitness',
  '/legal/privacy-policy',
  '/legal/terms-of-service',
  '/404',
];
let inspectedImages = 0,
  inspectedVideos = 0;
const widths = process.env.BROWSER_TEST_WIDTHS
  ? process.env.BROWSER_TEST_WIDTHS.split(',').map(Number)
  : [1440, 1024, 390, 360];
assert.ok(
  widths.every((width) => Number.isInteger(width) && width > 0),
  'Invalid viewport widths',
);

async function screenshot(page, name) {
  if (screenshotDirectory)
    await page.screenshot({ path: path.join(screenshotDirectory, name + '.png') });
}
async function open(page, route) {
  await page.goto(origin + route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    `${route}: horizontal overflow`,
  );
}
async function settleAnimations(locator) {
  await locator.evaluate(async (element) => {
    const animations = element
      .getAnimations({ subtree: true })
      .filter((animation) => Number.isFinite(animation.effect.getComputedTiming().endTime));
    await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
  });
}
async function inspectMedia(page) {
  const images = page.locator('img');
  for (const image of await images.all()) {
    const hidden = await image.evaluate((element) => {
      for (let parent = element; parent; parent = parent.parentElement)
        if (parent.hidden || getComputedStyle(parent).display === 'none') return true;
      return false;
    });
    if (hidden) continue;
    await image.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    await image.evaluate((element) => {
      // Inspect hidden hover artwork as well as images currently intersecting the viewport.
      element.loading = 'eager';
      return Promise.race([
        element.decode(),
        new Promise((resolve, reject) =>
          setTimeout(() => reject(new Error(`Image did not decode: ${element.currentSrc}`)), 8000),
        ),
      ]);
    });
    const geometry = await image.evaluate((element) => ({
      src: element.currentSrc,
      width: element.clientWidth,
      height: element.clientHeight,
      natural: element.naturalWidth,
    }));
    assert.ok(
      geometry.natural > 0 && geometry.width > 0 && geometry.height > 0,
      JSON.stringify(geometry),
    );
    inspectedImages++;
  }
  assert.equal(await page.locator('video').count(), 0, 'The site uses static images.');
}
async function ripplePixels(page) {
  return page.evaluate(() => window.lastRipplePixels);
}

try {
  for (const width of widths) {
    const mobile = width < 810;
    const page = await browser.newPage({
      viewport: { width, height: mobile ? 844 : 1000 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/404'))
        failedResources.push(response.status() + ' ' + response.url());
    });
    if (width === 1440)
      await page.addInitScript(() => {
        const names = new WeakMap(),
          prototype = WebGL2RenderingContext.prototype;
        const getLocation = prototype.getUniformLocation,
          setVector = prototype.uniform4fv,
          setFloat = prototype.uniform1f,
          draw = prototype.drawArrays;
        window.pointerSpeed = 0;
        window.pointerPress = 0;
        window.hoverRipple = 0;
        prototype.drawArrays = function (...arguments_) {
          const result = draw.apply(this, arguments_);
          if (
            this.canvas.closest('[data-shader="ripple"]') &&
            !this.getParameter(this.FRAMEBUFFER_BINDING)
          ) {
            const width = Math.min(256, this.canvas.width),
              height = Math.min(256, this.canvas.height);
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
            let hash = 2166136261,
              alpha = 0;
            pixels.forEach((value, index) => {
              hash = Math.imul(hash ^ value, 16777619);
              if (index % 4 === 3) alpha += value;
            });
            window.lastRipplePixels = { hash, alpha };
          }
          return result;
        };
        prototype.getUniformLocation = function (program, name) {
          const location = getLocation.call(this, program, name);
          if (location) names.set(location, name);
          return location;
        };
        prototype.uniform4fv = function (location, value, ...rest) {
          if (names.get(location) === 'u_mousePosition')
            window.pointerSpeed = Math.max(window.pointerSpeed, Math.hypot(value[2], value[3]));
          return setVector.call(this, location, value, ...rest);
        };
        prototype.uniform1f = function (location, value) {
          if (names.get(location) === 'u_hoverPulse')
            window.hoverRipple = Math.max(window.hoverRipple, value);
          if (names.get(location) === 'u_mousePointerDown')
            window.pointerPress = Math.max(window.pointerPress, value);
          return setFloat.call(this, location, value);
        };
      });
    await open(page, '/');
    if (width === 1440) {
      await page.waitForFunction(() =>
        document.querySelector('[data-shader="ripple"]').classList.contains('has-live-shader'),
      );
      await page.waitForTimeout(2300);
      const before = await ripplePixels(page);
      await page.mouse.move(width * 0.3, 450);
      await page.mouse.move(width * 0.7, 520, { steps: 18 });
      await page.mouse.move(width * 0.5, 500, { steps: 12 });
      const after = await ripplePixels(page);
      assert.ok(before.alpha > 0 && after.alpha > 0, 'Ripple must render actual pixels');
      assert.notEqual(before.hash, after.hash, 'Hover must visibly distort the image');
      assert.ok(
        await page.evaluate(() => window.pointerSpeed > 0.05),
        'Hover velocity must be measured per second',
      );
      assert.equal(
        await page.evaluate(() => window.pointerPress),
        0,
        'Hover effect must work without clicking',
      );
      assert.equal(
        await page.evaluate(() => window.hoverRipple),
        1,
        'Hover must trigger the circular ripple generator',
      );
      await screenshot(page, 'hero-hover');
    }
    const toggle = page
      .locator(mobile ? '.site-header__mobile-toggle' : '.navigation-menu__icon')
      .filter({ visible: true })
      .first();
    if (mobile) await toggle.tap();
    else await page.locator('.navigation-menu').filter({ visible: true }).first().hover();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await settleAnimations(
      page
        .locator(mobile ? '.site-header--mobile' : '.navigation-menu')
        .filter({ visible: true })
        .first(),
    );
    const cross = await toggle.evaluate((element) => {
      const top = element.querySelector('.menu-icon__top').getBoundingClientRect(),
        bottom = element.querySelector('.menu-icon__bottom').getBoundingClientRect();
      return {
        dx: top.x + top.width / 2 - bottom.x - bottom.width / 2,
        dy: top.y + top.height / 2 - bottom.y - bottom.height / 2,
      };
    });
    assert.ok(
      Math.abs(cross.dx) < 0.15 && Math.abs(cross.dy) < 0.15,
      `Close icon is not centered: ${JSON.stringify(cross)}`,
    );
    await screenshot(page, `menu-${width}`);
    if (mobile) await toggle.tap();
    else {
      await page.mouse.move(10, 150);
      await page.waitForTimeout(900);
    }
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');

    const grid = page.locator('.home-founders .home-pricing__grid');
    for (const card of await grid.locator('.founder-card').all()) {
      await card.evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
      await card.evaluate(
        (element) =>
          new Promise((resolve) => {
            function ready() {
              if (!element.classList.contains('is-reveal-ready')) resolve();
              else requestAnimationFrame(ready);
            }
            ready();
          }),
      );
      await settleAnimations(card);
    }
    await grid.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    const cards = await grid.evaluate((element) =>
      [...element.children].map((card) => {
        const r = card.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    for (let index = 1; index < cards.length; index++) {
      const current = cards[index],
        earlier = cards.slice(0, index);
      const left = earlier
        .filter((card) => Math.abs(card.y - current.y) < 1)
        .sort((a, b) => b.x - a.x)[0];
      const above = earlier
        .filter((card) => Math.abs(card.x - current.x) < 1)
        .sort((a, b) => b.y - a.y)[0];
      for (const gap of [
        left ? current.x - left.x - left.w : null,
        above ? current.y - above.y - above.h : null,
      ].filter((gap) => gap !== null))
        assert.ok(Math.abs(gap - 16) < 1, `Founder cards must be separated by 16px: ${gap}`);
      for (const previous of earlier) {
        const overlapX =
          Math.min(current.x + current.w, previous.x + previous.w) -
          Math.max(current.x, previous.x);
        const overlapY =
          Math.min(current.y + current.h, previous.y + previous.h) -
          Math.max(current.y, previous.y);
        assert.ok(overlapX < 1 || overlapY < 1, 'Founder cards must not overlap');
      }
    }
    await screenshot(page, `founders-${width}`);
    const faqItems = page.locator('[data-accordion]');
    for (const item of await faqItems.all()) {
      await item.evaluate((element) =>
        element.scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
      await item.click();
      await settleAnimations(item);
      const answer = await item.evaluate((element) => {
        const title = element.querySelector('.faq-item__title').getBoundingClientRect(),
          box = element.querySelector('.faq-answer'),
          paragraph = box.querySelector('p').getBoundingClientRect(),
          bounds = element.getBoundingClientRect();
        return {
          dx: paragraph.x - title.x,
          right: bounds.right - paragraph.right,
          bottom: bounds.bottom - paragraph.bottom,
          radius: getComputedStyle(box).borderRadius,
          overflow: getComputedStyle(box).overflow,
        };
      });
      assert.ok(
        Math.abs(answer.dx) < 0.5 && answer.right >= 23 && answer.bottom >= 23,
        `FAQ answer does not align: ${JSON.stringify(answer)}`,
      );
      assert.equal(answer.radius, '0px');
      assert.equal(answer.overflow, 'visible');
    }
    await screenshot(page, `faq-${width}`);
    for (const route of routes) {
      if (route !== '/') await open(page, route);
      await inspectMedia(page);
      if (route === '/404') {
        await page
          .locator('[data-globe]')
          .evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForFunction(() =>
          document.querySelector('[data-globe]').classList.contains('is-ready'),
        );
        const ink = await page.locator('[data-globe] canvas').evaluate((canvas) =>
          canvas
            .getContext('2d')
            .getImageData(0, 0, canvas.width, canvas.height)
            .data.some((value, index) => index % 4 === 3 && value > 0),
        );
        assert.ok(ink, '404 globe must contain visible graphics');
        await screenshot(page, `not-found-${width}`);
      }
      measurements.push({ width, route });
      console.log(`Media verified: ${width}px ${route}`);
    }
    console.log(`Passed ${width}px: navigation, close icon, founders, FAQ, media and 404.`);
    await page.close();
  }
  const still = await browser.newPage({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  await open(still, '/');
  assert.ok(await still.locator('.home-services img').count(), 'Service imagery remains available with reduced motion');
  await inspectMedia(still);
  await still.close();
  const hybrid = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  await open(hybrid, '/');
  const hybridMenu = hybrid.locator('.navigation-menu').filter({ visible: true }).first();
  await hybridMenu.hover();
  assert.equal(
    await hybridMenu.locator('[data-menu-toggle]').first().getAttribute('aria-expanded'),
    'true',
    'A real mouse must open the menu even on a touch-capable computer',
  );
  await hybrid.keyboard.press('Escape');
  await hybrid.close();
  const tabletTouch = await browser.newPage({
    viewport: { width: 1024, height: 900 },
    hasTouch: true,
  });
  await open(tabletTouch, '/');
  const tabletToggle = tabletTouch
    .locator('.navigation-menu__icon')
    .filter({ visible: true })
    .first();
  await tabletToggle.tap();
  assert.equal(
    await tabletToggle.getAttribute('aria-expanded'),
    'true',
    'Touch must open the tablet menu on the first tap',
  );
  await tabletTouch.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(failedResources, []);
  console.log(
    JSON.stringify(
      {
        pageViewports: measurements.length,
        inspectedImages,
        inspectedVideos,
        errors,
        failedResources,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
}
