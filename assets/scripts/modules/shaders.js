import { reducedMotion } from './dom.js?v=2.0.12';
import { readThemeColor } from './theme.js?v=2.0.12';

const VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec2 position;
out vec2 v_uv;
void main() { v_uv = position * .5 + .5; gl_Position = vec4(position, 0.0, 1.0); }
`;
const GRADIENT_SETTINGS = {
  u_contrast: 1.1,
  u_distBias: 0,
  u_dither: 0.2,
  u_ditherMode: 1,
  u_exposure: 1.1,
  u_jellify: 0,
  u_loop: 0,
  u_saturation: 1,
  u_scale: 1.1,
  u_seed: 487,
  u_speed: 0.1,
  u_turbAmp: 0.13,
  u_turbFreq: 0.1,
  u_turbIter: 7,
  u_waveFreq: 0.9,
};
const RIPPLE_SETTINGS = {
  u_simDetail: 400,
  u_centerFade: 0.25,
  u_clickRipple: 1,
  u_clickSpeed: 1,
  u_dispersion: 1,
  u_trailDecay: 0.34,
  u_trailDisplacement: 0.098,
  u_trailRadius: 0.1,
  u_trailSoftness: 0.5,
  u_trailStrength: 1.02,
};
const sourceCache = new Map();
function loadShader(name) {
  if (!sourceCache.has(name))
    sourceCache.set(
      name,
      fetch(`/assets/shaders/${name}.glsl?v=2.0.12`).then((response) => {
        if (!response.ok) throw new Error('Shader source is unavailable.');
        return response.text();
      }),
    );
  return sourceCache.get(name);
}

/** A small WebGL 2 renderer, owned by the site and independent of UI libraries. */
class AnimatedSurface {
  constructor(element) {
    this.element = element;
    this.canvas = element.querySelector('canvas');
    this.kind = element.dataset.shader;
    this.visible = false;
    this.frame = 0;
    this.elapsed = 0;
    this.lastTime = 0;
    this.pointer = [0.5, 0.5, 0, 0];
    this.previousPointer = [0.5, 0.5];
    this.hover = 0;
    this.pressed = 0;
    this.hoverPulse = 0;
    this.hoverRippleRequested = false;
    this.lastHoverRipple = -1;
    this.interactionUntil = 0;
    this.pendingResize = true;
    this.disposed = false;
    this.buffers = [];
    const primary = readThemeColor(element, '--color-brand', '#820ad1').normalized;
    const accent = readThemeColor(element, '--color-accent', '#a855f7').normalized;
    const background =
      element.dataset.shaderVariant === 'footer'
        ? readThemeColor(element, '--color-background', '#0a0a0a').normalized
        : [0, 0, 0];
    this.colors = new Float32Array(
      element.dataset.shaderVariant === 'page'
        ? [
            ...primary,
            0.8,
            ...accent,
            0.8,
            ...readThemeColor(element, '--color-background', '#0a0a0a').normalized,
            1,
          ]
        : [...background, 1, ...primary, 1, ...background, 1],
    );
    this.settings =
      this.kind === 'ripple'
        ? RIPPLE_SETTINGS
        : {
            ...GRADIENT_SETTINGS,
            ...(element.dataset.shaderVariant === 'footer'
              ? { u_turbAmp: 1, u_turbIter: 3, u_waveFreq: 1 }
              : {}),
            ...(element.dataset.shaderVariant === 'page'
              ? {
                  u_dither: 0.05,
                  u_ditherMode: 0,
                  u_scale: 0.1,
                  u_seed: 895,
                  u_speed: 0.08,
                  u_turbAmp: 0,
                  u_turbFreq: 0.35,
                  u_turbIter: 7,
                  u_waveFreq: 3.8,
                }
              : {}),
          };
    this.tick = this.tick.bind(this);
    this.resizeObserver = new ResizeObserver(() => {
      this.pendingResize = true;
      this.resume();
    });
    this.resizeObserver.observe(element);
    this.abortController = new AbortController();
    this.canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        this.pause();
        element.classList.remove('has-live-shader');
        this.ready = false;
      },
      { signal: this.abortController.signal },
    );
    this.canvas.addEventListener('webglcontextrestored', () => this.initialize().catch(() => {}), {
      signal: this.abortController.signal,
    });
  }

  async initialize() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
    });
    if (!gl) return;
    this.gl = gl;
    if (this.kind === 'ripple' && !gl.getExtension('EXT_color_buffer_float')) return;
    const vertexArray = gl.createVertexArray();
    gl.bindVertexArray(vertexArray);
    this.vertexArray = vertexArray;
    this.geometry = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geometry);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    if (this.kind === 'gradient')
      this.mainPass = this.createProgram(await loadShader('liquid-gradient'));
    else {
      const sources = await Promise.all(
        ['ripple-trail', 'ripple-clicks', 'ripple-image'].map(loadShader),
      );
      this.bufferPasses = [this.createProgram(sources[0]), this.createProgram(sources[1])];
      this.mainPass = this.createProgram(sources[2]);
      this.imageTexture = await this.loadTexture(
        this.element.querySelector('.shader-fallback img'),
      );
      this.bindPointer();
    }
    if (this.disposed) return;
    this.ready = true;
    this.pendingResize = true;
    this.resume();
  }

  createProgram(source) {
    const gl = this.gl;
    const declarations = [
      'uniform float u_time, u_deltaTime, u_pixelRatio, u_mouseHover, u_mousePointerDown, u_hoverPulse;',
      'uniform vec2 u_resolution;',
      'uniform vec4 u_mousePosition;',
      'uniform vec4 u_colors[8];',
      'uniform int u_colors_length;',
      'uniform sampler2D u_texture, u_rippleTrail_buffer, u_clickState_buffer;',
      ...Object.keys(this.settings).map((name) => `uniform float ${name};`),
    ].join('\n');
    const fragmentSource = `#version 300 es\nprecision highp float;\nprecision highp int;\nin vec2 v_uv;\nout vec4 fragColor;\n${declarations}\n${source}`;
    const compile = (type, text) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SOURCE);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program));
    const locations = new Map();
    const uniform = (name) => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name);
    };
    return { program, uniform };
  }

  async loadTexture(picture) {
    const gl = this.gl;
    await picture.decode();
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
    return texture;
  }

  createTarget(width, height) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('This device cannot render the ripple simulation.');
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, framebuffer, width, height };
  }

  resize() {
    const gl = this.gl;
    const bounds = this.element.getBoundingClientRect();
    // Gradients contain no text or sharp edges; render them at a smaller native surface.
    const budget = this.kind === 'ripple' ? 720_000 : 180_000;
    const scale = Math.min(
      1,
      Math.sqrt(budget / (this.element.clientWidth * this.element.clientHeight)),
    );
    const width = Math.max(1, Math.round(this.element.clientWidth * scale));
    const height = Math.max(1, Math.round(this.element.clientHeight * scale));
    if (this.canvas.width === width && this.canvas.height === height && !this.pendingResize) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.bounds = bounds;
    for (const buffer of this.buffers)
      for (const target of buffer) {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
      }
    this.buffers = [];
    if (this.kind === 'ripple') {
      const simulationScale = Math.min(1, this.settings.u_simDetail / Math.sqrt(width * height));
      const simulationWidth = Math.max(1, Math.round(width * simulationScale));
      const simulationHeight = Math.max(1, Math.round(height * simulationScale));
      this.buffers = [
        [this.createTarget(simulationWidth, simulationHeight), this.createTarget(simulationWidth, simulationHeight)],
        // The click simulation stores nine uniform bands; nine texels contain the same state.
        [this.createTarget(9, 1), this.createTarget(9, 1)],
      ];
    }
    this.pendingResize = false;
  }

  bindPointer() {
    if (this.pointerBound) return;
    this.pointerBound = true;
    const container = this.element.closest('.home-hero') || this.element;
    const options = { passive: true, signal: this.abortController.signal };
    const updatePointer = (event) => {
      // Coalesce high-frequency input; geometry is read once by the render frame.
      this.pendingPointer = {
        clientX: event.clientX,
        clientY: event.clientY,
        entering: this.pendingPointer?.entering ?? !this.hover,
      };
      this.pressed = event.buttons & 1 ? 1 : 0;
      this.hover = 1;
      this.interactionUntil = performance.now() + 4000;
      if (!event.pointerType || event.pointerType === 'mouse') this.hoverRippleRequested = true;
      this.resume();
    };
    container.addEventListener('pointerenter', updatePointer, options);
    container.addEventListener('pointermove', updatePointer, options);
    container.addEventListener(
      'pointerleave',
      () => {
        this.hover = 0;
        this.pressed = 0;
        this.hoverRippleRequested = false;
      },
      options,
    );
    container.addEventListener(
      'pointerdown',
      (event) => {
        updatePointer(event);
        this.pressed = 1;
        this.hover = 1;
        this.resume();
      },
      options,
    );
    window.addEventListener(
      'pointerup',
      () => {
        this.pressed = 0;
        this.resume();
      },
      options,
    );
    window.addEventListener(
      'pointercancel',
      () => {
        this.pressed = 0;
        this.hover = 0;
        this.resume();
      },
      options,
    );
  }

  draw(pass, target, delta) {
    const gl = this.gl;
    gl.useProgram(pass.program);
    gl.bindVertexArray(this.vertexArray);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer || null);
    gl.viewport(0, 0, target?.width || this.canvas.width, target?.height || this.canvas.height);
    gl.uniform2f(pass.uniform('u_resolution'), this.canvas.width, this.canvas.height);
    gl.uniform1f(pass.uniform('u_time'), this.elapsed);
    gl.uniform1f(pass.uniform('u_deltaTime'), delta);
    gl.uniform1f(pass.uniform('u_mouseHover'), this.hover);
    gl.uniform1f(pass.uniform('u_mousePointerDown'), this.pressed);
    gl.uniform1f(pass.uniform('u_hoverPulse'), this.hoverPulse);
    gl.uniform4fv(pass.uniform('u_mousePosition'), this.pointer);
    if (!pass.configured) {
      gl.uniform1f(pass.uniform('u_pixelRatio'), 1);
      gl.uniform1i(pass.uniform('u_colors_length'), 3);
      gl.uniform4fv(pass.uniform('u_colors'), this.colors);
      for (const [name, value] of Object.entries(this.settings))
        gl.uniform1f(pass.uniform(name), value);
      pass.configured = true;
    }
    if (this.kind === 'ripple') {
      for (const [unit, name, texture] of [
        [0, 'u_texture', this.imageTexture],
        [1, 'u_rippleTrail_buffer', this.buffers[0][0].texture],
        [2, 'u_clickState_buffer', this.buffers[1][0].texture],
      ]) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(pass.uniform(name), unit);
      }
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  tick(time) {
    this.frame = 0;
    if (!this.ready || this.disposed || !this.visible || document.hidden) return;
    const interval = 1000 / 30;
    if (!this.pendingResize && this.lastTime && time - this.lastTime < interval - 1) {
      this.frame = requestAnimationFrame(this.tick);
      return;
    }
    const frameDelta = this.lastTime ? Math.max((time - this.lastTime) / 1_000, 0.001) : 1 / 60;
    const delta = Math.min(frameDelta, 1 / 30);
    this.lastTime = time;
    const interactive = this.kind === 'ripple' && time < this.interactionUntil;
    if (!reducedMotion.matches || interactive) this.elapsed += Math.min(frameDelta, 0.1);
    if (this.pendingResize) this.resize();
    if (this.pendingPointer) {
      const { clientX, clientY, entering } = this.pendingPointer;
      const bounds = this.element.getBoundingClientRect();
      const x = (clientX - bounds.left) / bounds.width;
      const y = 1 - (clientY - bounds.top) / bounds.height;
      if (entering) {
        this.previousPointer[0] = x;
        this.previousPointer[1] = y;
      }
      this.pointer[0] = x;
      this.pointer[1] = y;
      this.pendingPointer = null;
    }
    if (this.kind === 'ripple' && !interactive && this.interactionUntil) {
      // Once the waves have decayed, release the simulation until the next input.
      this.pressed = 0;
      this.hoverPulse = 0;
      this.hoverRippleRequested = false;
      this.previousPointer = this.pointer.slice(0, 2);
      this.interactionUntil = 0;
      for (const pair of this.buffers)
        for (const target of pair) {
          this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
          this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        }
    }
    const emitHoverRipple =
      this.hoverRippleRequested &&
      this.hover &&
      !this.hoverPulse &&
      this.elapsed - this.lastHoverRipple >= 0.12;
    this.hoverPulse = emitHoverRipple ? 1 : 0;
    if (emitHoverRipple) {
      this.hoverRippleRequested = false;
      this.lastHoverRipple = this.elapsed;
    }
    // The simulation expects normalized movement per second, rather than per event.
    this.pointer[2] = (this.pointer[0] - this.previousPointer[0]) / frameDelta;
    this.pointer[3] = (this.pointer[1] - this.previousPointer[1]) / frameDelta;
    this.bufferPasses?.forEach((pass, index) => this.draw(pass, this.buffers[index][1], delta));
    this.buffers.forEach((buffer) => buffer.reverse());
    this.draw(this.mainPass, null, delta);
    this.previousPointer[0] = this.pointer[0];
    this.previousPointer[1] = this.pointer[1];
    this.element.classList.add('has-live-shader');
    if (this.kind === 'gradient' ? !reducedMotion.matches : interactive)
      this.frame = requestAnimationFrame(this.tick);
    else this.lastTime = 0;
  }

  resume() {
    if (!this.ready || this.frame || !this.visible || document.hidden || this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
  }
  pause() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastTime = 0;
  }
  dispose() {
    this.pause();
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.abortController.abort();
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

export function initializeShaders() {
  const surfaces = new Map();
  const visibility = new IntersectionObserver(
    (entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        let surface = surfaces.get(target);
        if (!surface && isIntersecting) {
          surface = new AnimatedSurface(target);
          surfaces.set(target, surface);
          surface.visible = true;
          surface.initialize().catch(() => {
            target.classList.remove('has-live-shader');
            surface.pause();
          });
        }
        if (!surface) return;
        surface.visible = isIntersecting;
        if (isIntersecting) surface.resume();
        else surface.pause();
      });
    },
    { rootMargin: '80px 0px' },
  );
  document.querySelectorAll('[data-shader]').forEach((element) => visibility.observe(element));
  document.addEventListener('visibilitychange', () =>
    surfaces.forEach((surface) => (document.hidden ? surface.pause() : surface.resume())),
  );
  reducedMotion.addEventListener('change', () =>
    surfaces.forEach((surface) => {
      surface.pause();
      surface.resume();
    }),
  );
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) surfaces.forEach((surface) => surface.pause());
    else {
      visibility.disconnect();
      surfaces.forEach((surface) => surface.dispose());
    }
  });
  window.addEventListener('pageshow', () => surfaces.forEach((surface) => surface.resume()));
}
