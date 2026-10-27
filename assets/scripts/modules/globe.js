import { reducedMotion } from './dom.js?v=2.0.12';
import { readThemeColor } from './theme.js?v=2.0.12';

const RADIANS = Math.PI / 180;
const TILT_COS = Math.cos(0.2);
const TILT_SIN = Math.sin(0.2);
const LAND_OUTLINES = [
  [
    [-168, 72],
    [-130, 72],
    [-105, 82],
    [-55, 62],
    [-60, 48],
    [-82, 25],
    [-98, 15],
    [-116, 30],
    [-130, 52],
    [-168, 60],
  ],
  [
    [-81, 12],
    [-60, 10],
    [-35, -6],
    [-48, -28],
    [-68, -56],
    [-76, -37],
    [-82, -12],
  ],
  [
    [-18, 36],
    [7, 38],
    [34, 30],
    [51, 12],
    [42, -12],
    [20, -35],
    [10, -28],
    [-7, 5],
    [-18, 15],
  ],
  [
    [-11, 36],
    [-10, 58],
    [20, 71],
    [60, 78],
    [110, 74],
    [170, 58],
    [140, 35],
    [120, 22],
    [105, 2],
    [80, 8],
    [62, 27],
    [35, 30],
    [25, 40],
  ],
  [
    [112, -12],
    [136, -10],
    [154, -25],
    [145, -39],
    [119, -34],
  ],
  [
    [-56, 60],
    [-24, 68],
    [-38, 83],
    [-62, 80],
  ],
];

function containsPoint(longitude, latitude, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, y] = polygon[index],
      [previousX, previousY] = polygon[previous];
    if (
      y > latitude !== previousY > latitude &&
      longitude < ((previousX - x) * (latitude - y)) / (previousY - y) + x
    )
      inside = !inside;
  }
  return inside;
}

function spherePoint(latitude, longitude) {
  const latitudeRadians = latitude * RADIANS,
    longitudeRadians = longitude * RADIANS;
  return [
    Math.cos(latitudeRadians) * Math.sin(longitudeRadians),
    Math.sin(latitudeRadians),
    Math.cos(latitudeRadians) * Math.cos(longitudeRadians),
  ];
}

/** A local canvas globe; no map service, graphics framework or network request. */
export function initializeGlobe() {
  document.querySelectorAll('[data-globe]').forEach((element) => {
    const canvas = element.querySelector('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    const colors = {
      highlight: readThemeColor(element, '--color-brand-soft', '#d6b3ff'),
      accent: readThemeColor(element, '--color-accent', '#a855f7'),
      shadow: readThemeColor(element, '--color-brand-shadow', '#2d1248'),
      deep: readThemeColor(element, '--color-brand-deep', '#140b1d'),
      background: readThemeColor(element, '--color-background', '#0a0a0a'),
    };
    const land = [];
    for (let latitude = -60; latitude <= 80; latitude += 4) {
      for (let longitude = -180; longitude < 180; longitude += 4) {
        if (LAND_OUTLINES.some((outline) => containsPoint(longitude, latitude, outline)))
          land.push(spherePoint(latitude, longitude));
      }
    }
    const lines = [];
    for (let latitude = -60; latitude <= 60; latitude += 20)
      lines.push(Array.from({ length: 121 }, (_, index) => spherePoint(latitude, index * 3)));
    for (let longitude = 0; longitude < 180; longitude += 20)
      lines.push(Array.from({ length: 121 }, (_, index) => spherePoint(index * 3, longitude)));
    let width = 0,
      visible = false,
      suspended = false,
      frame = 0,
      lastTime = 0,
      rotation = -0.55;
    let rotationCos = Math.cos(rotation), rotationSin = Math.sin(rotation), light;

    function project([x, y, z]) {
      const rotatedX = x * rotationCos + z * rotationSin;
      const rotatedZ = z * rotationCos - x * rotationSin;
      const tiltedY = y * TILT_COS - rotatedZ * TILT_SIN;
      const depth = rotatedZ * TILT_COS + y * TILT_SIN;
      return [width * 0.5 + rotatedX * width * 0.39, width * 0.5 - tiltedY * width * 0.39, depth];
    }
    function draw() {
      rotationCos = Math.cos(rotation);
      rotationSin = Math.sin(rotation);
      const radius = width * 0.39,
        center = width * 0.5;
      context.clearRect(0, 0, width, width);
      context.fillStyle = light;
      context.beginPath();
      context.arc(center, center, radius, 0, Math.PI * 2);
      context.fill();
      context.lineWidth = 0.7;
      for (const line of lines) {
        let previous = null;
        for (const point of line) {
          const current = project(point);
          if (previous && current[2] > 0 && previous[2] > 0) {
            context.strokeStyle = `rgba(${colors.highlight.rgb},${0.08 + current[2] * 0.23})`;
            context.beginPath();
            context.moveTo(previous[0], previous[1]);
            context.lineTo(current[0], current[1]);
            context.stroke();
          }
          previous = current;
        }
      }
      for (const point of land) {
        const [x, y, depth] = project(point);
        if (depth <= 0) continue;
        context.fillStyle = `rgba(${colors.accent.rgb},${0.25 + depth * 0.7})`;
        context.beginPath();
        context.arc(x, y, 0.6 + depth * 0.75, 0, Math.PI * 2);
        context.fill();
      }
      context.strokeStyle = `rgba(${colors.highlight.rgb},.4)`;
      context.lineWidth = 1;
      context.beginPath();
      context.arc(center, center, radius, 0, Math.PI * 2);
      context.stroke();
      element.classList.add('is-ready');
    }
    function resize() {
      width = element.clientWidth;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(width * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const radius = width * 0.39, center = width * 0.5;
      light = context.createRadialGradient(
        center - radius * 0.5,
        center - radius * 0.6,
        0,
        center,
        center,
        radius * 1.1,
      );
      light.addColorStop(0, colors.shadow.css);
      light.addColorStop(0.55, colors.deep.css);
      light.addColorStop(1, colors.background.css);
      draw();
    }
    function tick(time) {
      frame = 0;
      if (!visible || document.hidden || reducedMotion.matches) return;
      if (time - lastTime >= 1000 / 30) {
        rotation += Math.min(lastTime ? (time - lastTime) / 1000 : 0, 0.1) * 0.12;
        lastTime = time;
        draw();
      }
      frame = requestAnimationFrame(tick);
    }
    function synchronize() {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      if (visible && !suspended && !document.hidden && !reducedMotion.matches)
        frame = requestAnimationFrame(tick);
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element);
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      synchronize();
    });
    visibility.observe(element);
    document.addEventListener('visibilitychange', synchronize);
    reducedMotion.addEventListener('change', synchronize);
    window.addEventListener('pagehide', () => {
      suspended = true;
      synchronize();
    });
    window.addEventListener('pageshow', () => {
      suspended = false;
      synchronize();
    });
    resize();
  });
}
