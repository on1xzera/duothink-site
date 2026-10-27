const EPSILON = 1e-8;
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const key = (point) => point.map((value) => Math.round(value * 1e6)).join(':');

/** Follow the supplied SVG curves; straight edges only need their endpoints. */
function samplePath(path, viewBox) {
  const tokens = path.match(/[MLCQHVZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/giu);
  const points = [];
  let index = 0;
  let current = [0, 0];
  const number = () => Number(tokens[index++]);
  const point = () => [number(), number()];
  const append = (value) => {
    current = value;
    if (
      !points.length ||
      Math.hypot(value[0] - points.at(-1)[0], value[1] - points.at(-1)[1]) > EPSILON
    )
      points.push(value);
  };
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M' || command === 'L') append(point());
    else if (command === 'H') append([number(), current[1]]);
    else if (command === 'V') append([current[0], number()]);
    else if (command === 'C' || command === 'Q') {
      const start = current,
        first = point(),
        second = point();
      const end = command === 'C' ? point() : second;
      const steps = command === 'C' ? 32 : 16;
      for (let step = 1; step <= steps; step++) {
        const t = step / steps,
          s = 1 - t;
        append(
          [0, 1].map((axis) =>
            command === 'C'
              ? s ** 3 * start[axis] +
                3 * s ** 2 * t * first[axis] +
                3 * s * t ** 2 * second[axis] +
                t ** 3 * end[axis]
              : s ** 2 * start[axis] + 2 * s * t * first[axis] + t ** 2 * end[axis],
          ),
        );
      }
    } else if (command !== 'Z') throw new Error('Unsupported isotype path command.');
  }
  if (key(points[0]) === key(points.at(-1))) points.pop();
  const [left, top, width, height] = viewBox;
  const result = points.map(([x, y]) => [
    (x - left - width / 2) / (height / 2),
    (top + height / 2 - y) / (height / 2),
  ]);
  const area = result.reduce((sum, p, i) => {
    const next = result[(i + 1) % result.length];
    return sum + p[0] * next[1] - next[0] * p[1];
  }, 0);
  if (area < 0) result.reverse();
  return result;
}

function edgeData(contour) {
  return contour.map((point, i) => {
    const previous = contour[(i + contour.length - 1) % contour.length];
    const next = contour[(i + 1) % contour.length];
    const incoming = [point[0] - previous[0], point[1] - previous[1]];
    const outgoing = [next[0] - point[0], next[1] - point[1]];
    const firstLength = Math.hypot(...incoming),
      secondLength = Math.hypot(...outgoing);
    const first = [-incoming[1] / firstLength, incoming[0] / firstLength];
    const second = [-outgoing[1] / secondLength, outgoing[0] / secondLength];
    const denominator = Math.max(EPSILON, 1 + first[0] * second[0] + first[1] * second[1]);
    const inset = [(first[0] + second[0]) / denominator, (first[1] + second[1]) / denominator];
    const length = Math.hypot(...inset);
    return { point, inset, normal: [-inset[0] / length, -inset[1] / length] };
  });
}

/** Ear clipping respects the two concave corners instead of drawing a fan across them. */
function triangulate(contour) {
  const remaining = contour.map((point, i) => i);
  const triangles = [];
  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length];
      const b = remaining[i],
        c = remaining[(i + 1) % remaining.length];
      if (cross(contour[a], contour[b], contour[c]) <= EPSILON) continue;
      const contains = remaining.some(
        (p) =>
          p !== a &&
          p !== b &&
          p !== c &&
          cross(contour[a], contour[b], contour[p]) >= -EPSILON &&
          cross(contour[b], contour[c], contour[p]) >= -EPSILON &&
          cross(contour[c], contour[a], contour[p]) >= -EPSILON,
      );
      if (contains) continue;
      triangles.push(a, b, c);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error('The isotype face could not be triangulated.');
  }
  triangles.push(...remaining);
  return triangles;
}

/** Preserve both original tabs as separate, flat metal pieces with a fine edge. */
export function buildIsotypeGeometry(svg) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const paths = [...document.querySelectorAll('path')];
  if (paths.length !== 2) throw new Error('The isotype must retain its two vector paths.');
  const viewBox = document.documentElement.getAttribute('viewBox').split(/\s+/u).map(Number);
  const vertices = [],
    indices = [];
  const halfDepth = 0.1,
    bevel = 0.006;
  for (const [part, path] of paths.entries()) {
    const contour = samplePath(path.getAttribute('d'), viewBox);
    // Subpixel separation avoids coincident internal walls without changing the outline.
    const direction = part === 0 ? 1 : -1;
    for (const point of contour) point[1] += direction * 0.001;
    const edges = edgeData(contour),
      rings = [];
    const offset = direction * 0.035;
    for (let step = 0; step <= 4; step++) {
      const angle = ((step / 4) * Math.PI) / 2;
      rings.push({
        inset: bevel * (1 - Math.sin(angle)),
        z: offset + halfDepth - bevel * (1 - Math.cos(angle)),
        side: Math.sin(angle),
        face: Math.cos(angle),
      });
    }
    for (let step = 0; step <= 4; step++) {
      const angle = ((step / 4) * Math.PI) / 2;
      rings.push({
        inset: bevel * (1 - Math.cos(angle)),
        z: offset - halfDepth + bevel * (1 - Math.sin(angle)),
        side: Math.cos(angle),
        face: -Math.sin(angle),
      });
    }
    const base = vertices.length / 7,
      count = contour.length;
    for (const ring of rings) {
      for (const { point, inset, normal } of edges) {
        vertices.push(
          point[0] + inset[0] * ring.inset,
          point[1] + inset[1] * ring.inset,
          ring.z,
          normal[0] * ring.side,
          normal[1] * ring.side,
          ring.face,
          0.94 + Math.abs(ring.face) * 0.06,
        );
      }
    }
    for (let ring = 0; ring < rings.length - 1; ring++) {
      for (let i = 0; i < count; i++) {
        const next = (i + 1) % count,
          a = base + ring * count + i,
          b = base + ring * count + next;
        indices.push(a, a + count, b, b, a + count, b + count);
      }
    }
    const face = edges.map(({ point, inset }) => [
      point[0] + inset[0] * bevel,
      point[1] + inset[1] * bevel,
    ]);
    const triangles = triangulate(face),
      back = base + (rings.length - 1) * count;
    for (let i = 0; i < triangles.length; i += 3) {
      indices.push(base + triangles[i], base + triangles[i + 1], base + triangles[i + 2]);
      indices.push(back + triangles[i + 2], back + triangles[i + 1], back + triangles[i]);
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}
