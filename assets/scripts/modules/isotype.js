import { reducedMotion } from './dom.js?v=2.0.12';
import { buildIsotypeGeometry } from './isotype-geometry.js?v=2.0.12';

const REST = [0, 0];
const PRESETS = [REST, [-0.2, 0.42], [0.26, -0.48], [-0.1, -0.02]];
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
let resources;

function loadResources() {
  if (!resources)
    resources = Promise.all(
      [
        '/assets/images/isotype.svg?v=2.0.12',
        '/assets/shaders/isotype-vertex.glsl?v=2.0.12',
        '/assets/shaders/isotype-metal.glsl?v=2.0.12',
      ].map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Isotype artwork is unavailable.');
        return response.text();
      }),
    ).then(([svg, vertex, fragment]) => ({
      geometry: buildIsotypeGeometry(svg),
      vertex,
      fragment,
    }));
  return resources;
}

class IsotypeSculpture {
  constructor(element) {
    this.element = element;
    this.canvas = element.querySelector('canvas');
    this.current = [...REST];
    this.target = [...REST];
    this.base = [...REST];
    this.preset = 0;
    this.visible = false;
    this.frame = 0;
    this.lastTime = 0;
    this.tick = this.tick.bind(this);
    this.resize = new ResizeObserver(() => {
      this.resume();
    });
    this.resize.observe(element);
    this.bindInteraction();
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.pause();
      this.ready = false;
      element.classList.remove('is-ready');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.loading = null;
      this.initialize();
    });
  }

  initialize() {
    if (this.loading) return this.loading;
    this.loading = this.createRenderer().catch(() => {
      // The white SVG remains visible if a browser cannot create the 3D surface.
      this.ready = false;
      this.element.classList.remove('is-ready');
    });
    return this.loading;
  }

  async createRenderer() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      powerPreference: 'low-power',
    });
    if (!gl) return;
    const { geometry, vertex, fragment } = await loadResources();
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(error);
      }
      return shader;
    };
    const vertexShader = compile(gl.VERTEX_SHADER, vertex);
    const fragmentShader = compile(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    this.gl = gl;
    this.program = program;
    this.vertexArray = gl.createVertexArray();
    gl.bindVertexArray(this.vertexArray);
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW);
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
    for (const [location, size, offset] of [
      [0, 3, 0],
      [1, 3, 3],
      [2, 1, 6],
    ]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 28, offset * 4);
    }
    this.indexCount = geometry.indices.length;
    this.rotationUniform = gl.getUniformLocation(program, 'u_rotation');
    this.resolutionUniform = gl.getUniformLocation(program, 'u_resolution');
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0, 0, 0, 0);
    this.ready = true;
    this.resume();
  }

  bindInteraction() {
    const element = this.element;
    const hover = (event) => {
      if (this.drag || event.pointerType === 'touch') return;
      const bounds = element.getBoundingClientRect();
      const width = Math.min(bounds.width, (bounds.height * 647) / 602);
      const height = (width * 602) / 647;
      const x = clamp((event.clientX - bounds.left - bounds.width / 2) / (width / 2), -1, 1);
      const y = clamp((event.clientY - bounds.top - bounds.height / 2) / (height / 2), -1, 1);
      this.target = [
        clamp(this.base[0] - y * 0.25, -0.6, 0.6),
        clamp(this.base[1] + x * 0.4, -0.8, 0.8),
      ];
      this.resume();
    };
    element.addEventListener('pointerenter', hover);
    element.addEventListener('pointermove', (event) => {
      if (!this.drag) return hover(event);
      const x = event.clientX - this.drag.x;
      const y = event.clientY - this.drag.y;
      this.drag.moved ||= Math.hypot(x, y) > 5;
      this.target = [
        clamp(this.drag.rotation[0] - y * 0.008, -0.6, 0.6),
        clamp(this.drag.rotation[1] + x * 0.008, -0.85, 0.85),
      ];
      this.resume();
    });
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        rotation: [...this.target],
        moved: false,
      };
      element.setPointerCapture(event.pointerId);
      element.classList.add('is-dragging');
    });
    const release = (event) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      this.suppressClick = this.drag.moved;
      if (this.drag.moved) this.base = [...this.target];
      this.drag = null;
      element.classList.remove('is-dragging');
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('lostpointercapture', release);
    element.addEventListener('pointerleave', () => {
      if (!this.drag) {
        this.target = [...this.base];
        this.resume();
      }
    });
    element.addEventListener('click', () => {
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      this.preset = (this.preset + 1) % PRESETS.length;
      this.base = [...PRESETS[this.preset]];
      this.target = [...this.base];
      this.resume();
    });
    element.addEventListener('keydown', (event) => {
      const changes = {
        ArrowLeft: [0, -0.12],
        ArrowRight: [0, 0.12],
        ArrowUp: [0.12, 0],
        ArrowDown: [-0.12, 0],
      };
      if (!(event.key in changes) && !['Home', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const change = changes[event.key];
      this.base = change
        ? [
            clamp(this.target[0] + change[0], -0.6, 0.6),
            clamp(this.target[1] + change[1], -0.85, 0.85),
          ]
        : [...REST];
      this.target = [...this.base];
      this.resume();
    });
  }

  draw() {
    const gl = this.gl;
    const bounds = this.element.getBoundingClientRect();
    const ratio = Math.min(
      devicePixelRatio || 1,
      2,
      Math.sqrt(600_000 / (bounds.width * bounds.height)),
    );
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.uniform2f(this.rotationUniform, ...this.current);
    gl.uniform2f(this.resolutionUniform, width, height);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    this.element.classList.add('is-ready');
  }

  tick(time) {
    this.frame = 0;
    if (!this.visible || document.hidden || !this.ready) return;
    const delta = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.05) : 1 / 60;
    this.lastTime = time;
    const blend = reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 13);
    let moving = false;
    for (let axis = 0; axis < 2; axis++) {
      this.current[axis] += (this.target[axis] - this.current[axis]) * blend;
      if (Math.abs(this.target[axis] - this.current[axis]) > 0.0001) moving = true;
      else this.current[axis] = this.target[axis];
    }
    this.draw();
    if (moving) this.frame = requestAnimationFrame(this.tick);
    else this.lastTime = 0;
  }

  resume() {
    if (!this.ready || !this.visible || document.hidden || this.frame) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  pause() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastTime = 0;
  }
}

/** Only visible copies create a renderer; resting sculptures do not run an animation loop. */
export function initializeIsotypes() {
  const sculptures = new Map();
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      const sculpture = sculptures.get(target);
      sculpture.visible = isIntersecting;
      if (isIntersecting) {
        sculpture.initialize();
        sculpture.resume();
      } else sculpture.pause();
    }
  });
  document.querySelectorAll('[data-isotype]').forEach((element) => {
    sculptures.set(element, new IsotypeSculpture(element));
    observer.observe(element);
  });
  document.addEventListener('visibilitychange', () => {
    sculptures.forEach((sculpture) => (document.hidden ? sculpture.pause() : sculpture.resume()));
  });
  window.addEventListener('pagehide', () => sculptures.forEach((sculpture) => sculpture.pause()));
  window.addEventListener('pageshow', () => sculptures.forEach((sculpture) => sculpture.resume()));
}
