/** Read the shared CSS palette for canvas and WebGL artwork. */
export function readThemeColor(element, property, fallback) {
  const css = getComputedStyle(element).getPropertyValue(property).trim() || fallback;
  const hex = css.replace('#', '');
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return { css, rgb, normalized: rgb.map((channel) => channel / 255) };
}
