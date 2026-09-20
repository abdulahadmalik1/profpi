// profpi — Complex Plane Explorer page controller (Phase 5)
(function () {
  'use strict';

  const exprInput = document.getElementById('exprZ');
  const presetRow = document.getElementById('presetRow');
  const ringSlider = document.getElementById('ringStrength');
  const ringValueLabel = document.getElementById('ringStrengthValue');
  const showPolesZerosBox = document.getElementById('showPolesZeros');
  const resetViewBtn = document.getElementById('resetView');
  const form = document.getElementById('controlForm');
  const errorBanner = document.getElementById('errorBanner');
  const fallbackBanner = document.getElementById('fallbackBanner');
  const glCanvas = document.getElementById('glCanvas');
  const overlayCanvas = document.getElementById('overlayCanvas');
  const canvasLegend = document.getElementById('canvasLegend');
  const statZ = document.getElementById('statZ');
  const statFz = document.getElementById('statFz');
  const statMag = document.getElementById('statMag');
  const statArg = document.getElementById('statArg');
  const inspectHint = document.getElementById('inspectHint');

  const MIN_H = ComplexPlaneCore.MIN_HALF_HEIGHT;
  const MAX_H = ComplexPlaneCore.MAX_HALF_HEIGHT;

  const state = {
    compiled: null,       // { source, ast, glsl, fragmentShader, evalAt }
    activePreset: null,   // preset object, only when input matches a chosen preset exactly
    center: { re: 0, im: 0 },
    halfHeight: 1.5,
    ringStrength: 0.7,
    lastInspect: null,    // { re, im } of last clicked point, for the overlay crosshair
    useWebGL: true,
    glCtx: null,
    glProgram: null,
    glLocs: null,
  };

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.remove('is-hidden');
  }
  function clearError() {
    errorBanner.textContent = '';
    errorBanner.classList.add('is-hidden');
  }
  function showFallbackBanner(message) {
    fallbackBanner.textContent = message;
    fallbackBanner.classList.remove('is-hidden');
  }

  // ── Preset chips ─────────────────────────────────────────────────────
  ComplexPlaneCore.PRESETS.forEach((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-chip';
    btn.textContent = preset.label;
    btn.addEventListener('click', () => {
      exprInput.value = preset.expr;
      state.activePreset = preset;
      compileAndRender();
    });
    presetRow.appendChild(btn);
  });
  exprInput.addEventListener('input', () => { state.activePreset = null; });

  // ── WebGL setup ──────────────────────────────────────────────────────
  const VERTEX_SRC = 'attribute vec2 a_pos;\nvoid main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }';
  const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

  function initWebGL() {
    const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
    if (!gl) return null;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    state.glCtx = gl;
    state.glQuadBuffer = buf;
    return gl;
  }

  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`Shader compile error: ${info}`);
    }
    return sh;
  }

  function buildProgram(gl, fragmentSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(prog);
      throw new Error(`Program link error: ${info}`);
    }
    return prog;
  }

  function useGLProgram(fragmentSrc) {
    const gl = state.glCtx;
    const prog = buildProgram(gl, fragmentSrc); // throws on failure — caller decides fallback
    if (state.glProgram) gl.deleteProgram(state.glProgram);
    state.glProgram = prog;
    gl.useProgram(prog);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, state.glQuadBuffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    state.glLocs = {
      resolution: gl.getUniformLocation(prog, 'u_resolution'),
      center: gl.getUniformLocation(prog, 'u_center'),
      halfHeight: gl.getUniformLocation(prog, 'u_halfHeight'),
      ringStrength: gl.getUniformLocation(prog, 'u_ringStrength'),
    };
  }

  function renderWebGL() {
    const gl = state.glCtx;
    const w = glCanvas.width, h = glCanvas.height;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(state.glLocs.resolution, w, h);
    gl.uniform2f(state.glLocs.center, state.center.re, state.center.im);
    gl.uniform1f(state.glLocs.halfHeight, state.halfHeight);
    gl.uniform1f(state.glLocs.ringStrength, state.ringStrength);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // ── Canvas-2D CPU fallback (no WebGL) ───────────────────────────────
  // Capped resolution — a JS per-pixel loop at full display resolution
  // would hang the tab, so this deliberately renders at a low, fixed
  // pixel budget and lets CSS scale it up (soft/blurry, but responsive).
  function hsv2rgb(h, s, v) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (((i % 6) + 6) % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      default: r = v; g = p; b = q; break;
    }
    return [r * 255, g * 255, b * 255];
  }

  function domainColor(w) {
    if (!Number.isFinite(w.re) || !Number.isFinite(w.im)) return [128, 128, 128];
    const m = Math.hypot(w.re, w.im);
    const hue = (Math.atan2(w.im, w.re) / (2 * Math.PI) + 0.5 + 1) % 1;
    const logm = Math.log2(Math.max(m, 1e-8));
    const ring = logm - Math.floor(logm);
    const ringBrightness = 0.35 + 0.65 * ring;
    const flatBrightness = 0.75;
    let brightness = flatBrightness + (ringBrightness - flatBrightness) * state.ringStrength;
    const towardBlack = m / (m + 0.12);
    const towardWhite = (m * m * m) / (m * m * m + 4000);
    brightness = brightness * towardBlack * (1 - towardWhite) + towardWhite;
    return hsv2rgb(hue, 0.85, brightness);
  }

  function renderFallback() {
    const ctx = glCanvas.getContext('2d');
    const cap = ComplexPlaneCore.MAX_FALLBACK_PIXELS;
    const aspect = glCanvas.width / glCanvas.height;
    const rw = aspect >= 1 ? cap : Math.max(1, Math.round(cap * aspect));
    const rh = aspect >= 1 ? Math.max(1, Math.round(cap / aspect)) : cap;
    const img = ctx.createImageData(rw, rh);
    const { Complex } = MathCore;
    for (let py = 0; py < rh; py++) {
      for (let px = 0; px < rw; px++) {
        const fragX = px, fragY = rh - py;
        const uvX = (fragX - 0.5 * rw) / rh;
        const uvY = (fragY - 0.5 * rh) / rh;
        const zRe = state.center.re + uvX * 2 * state.halfHeight;
        const zIm = state.center.im + uvY * 2 * state.halfHeight;
        let w;
        try { w = state.compiled.evalAt(new Complex(zRe, zIm)); } catch (e) { w = { re: NaN, im: NaN }; }
        const [r, g, b] = domainColor(w);
        const idx = (py * rw + px) * 4;
        img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = b; img.data[idx + 3] = 255;
      }
    }
    // Draw the low-res buffer scaled up to fill the canvas (nearest-neighbor
    // for the blocky-but-honest look of a deliberately capped fallback).
    const tmp = document.createElement('canvas');
    tmp.width = rw; tmp.height = rh;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, glCanvas.width, glCanvas.height);
    ctx.drawImage(tmp, 0, 0, glCanvas.width, glCanvas.height);
  }

  function render() {
    if (!state.compiled) return;
    if (state.useWebGL) renderWebGL(); else renderFallback();
    drawOverlay();
  }

  // ── Pixel <-> complex-plane mapping (shared by click, drag, zoom) ────
  // fragY flips DOM top-left-origin Y to the bottom-left origin gl_FragCoord
  // uses, so a clicked screen pixel maps to exactly the point the shader
  // rendered there.
  function pixelToUV(domX, domY, w, h) {
    const fragX = domX, fragY = h - domY;
    return { x: (fragX - 0.5 * w) / h, y: (fragY - 0.5 * h) / h };
  }
  function pixelToComplex(domX, domY, w, h, center, halfHeight) {
    const uv = pixelToUV(domX, domY, w, h);
    return { re: center.re + uv.x * 2 * halfHeight, im: center.im + uv.y * 2 * halfHeight };
  }

  // ── Overlay: poles/zeros + inspect crosshair ─────────────────────────
  function complexToPixel(z, w, h, center, halfHeight) {
    const uvX = (z.re - center.re) / (2 * halfHeight);
    const uvY = (z.im - center.im) / (2 * halfHeight);
    const fragX = uvX * h + 0.5 * w;
    const fragY = uvY * h + 0.5 * h;
    return { x: fragX, y: h - fragY };
  }

  function drawOverlay() {
    const ctx = overlayCanvas.getContext('2d');
    const w = overlayCanvas.width, h = overlayCanvas.height;
    ctx.clearRect(0, 0, w, h);

    let pz = { available: false };
    if (state.activePreset && showPolesZerosBox.checked) {
      pz = ComplexPlaneCore.polesAndZeros(state.activePreset);
    }
    canvasLegend.innerHTML = '';
    if (pz.available) {
      const markPoint = (z, color) => {
        const p = complexToPixel(z, w, h, state.center, state.halfHeight);
        if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        const s = 7;
        ctx.beginPath();
        ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s);
        ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s);
        ctx.stroke();
      };
      if (pz.polesConverged) pz.poles.forEach((z) => markPoint(z, '#ef4444'));
      if (pz.zerosConverged) pz.zeros.forEach((z) => markPoint(z, '#10b981'));
      canvasLegend.innerHTML =
        '<span class="legend-chip"><span class="legend-swatch pole"></span>Pole (\u00D7)</span>' +
        '<span class="legend-chip"><span class="legend-swatch zero"></span>Zero (\u00D7)</span>';
    } else if (state.activePreset && showPolesZerosBox.checked === false) {
      // checkbox off — no legend, nothing to draw
    }

    if (state.lastInspect) {
      const p = complexToPixel(state.lastInspect, w, h, state.center, state.halfHeight);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(15,23,42,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ── Inspect (click) ───────────────────────────────────────────────────
  function inspectAt(domX, domY) {
    if (!state.compiled) return;
    const w = glCanvas.width, h = glCanvas.height;
    const z = pixelToComplex(domX, domY, w, h, state.center, state.halfHeight);
    state.lastInspect = z;
    const { Complex } = MathCore;
    let fz, error = null;
    try { fz = state.compiled.evalAt(new Complex(z.re, z.im)); } catch (e) { error = e; }
    statZ.textContent = `${z.re.toFixed(4)} ${z.im >= 0 ? '+' : '\u2212'} ${Math.abs(z.im).toFixed(4)}i`;
    if (error) {
      statFz.textContent = 'undefined here';
      statMag.textContent = '\u2014';
      statArg.textContent = '\u2014';
      inspectHint.textContent = `f(z) is undefined at this point (${error.message}).`;
    } else if (!Number.isFinite(fz.re) || !Number.isFinite(fz.im)) {
      statFz.textContent = 'undefined here';
      statMag.textContent = '\u2014';
      statArg.textContent = '\u2014';
      inspectHint.textContent = 'f(z) is undefined (or blows up) at this point.';
    } else {
      statFz.textContent = `${fz.re.toFixed(4)} ${fz.im >= 0 ? '+' : '\u2212'} ${Math.abs(fz.im).toFixed(4)}i`;
      statMag.textContent = Math.hypot(fz.re, fz.im).toFixed(4);
      statArg.textContent = `${Math.atan2(fz.im, fz.re).toFixed(4)} rad`;
      inspectHint.textContent = 'Click anywhere else on the plot to inspect a different point.';
    }
    drawOverlay();
  }

  // ── Pan + zoom ─────────────────────────────────────────────────────────
  let dragging = false;
  let dragStartMouse = null;
  let dragStartCenter = null;
  let dragMoved = false;

  glCanvas.addEventListener('mousedown', (e) => {
    dragging = true;
    dragMoved = false;
    dragStartMouse = { x: e.offsetX * dpr(), y: e.offsetY * dpr() };
    dragStartCenter = { ...state.center };
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = glCanvas.width, h = glCanvas.height;
    const rect = glCanvas.getBoundingClientRect();
    const nowX = (e.clientX - rect.left) * dpr();
    const nowY = (e.clientY - rect.top) * dpr();
    if (Math.abs(nowX - dragStartMouse.x) > 2 || Math.abs(nowY - dragStartMouse.y) > 2) dragMoved = true;
    const zStart = pixelToComplex(dragStartMouse.x, dragStartMouse.y, w, h, dragStartCenter, state.halfHeight);
    const zNow = pixelToComplex(nowX, nowY, w, h, dragStartCenter, state.halfHeight);
    state.center = {
      re: dragStartCenter.re - (zNow.re - zStart.re),
      im: dragStartCenter.im - (zNow.im - zStart.im),
    };
    render();
  });
  window.addEventListener('mouseup', (e) => {
    if (dragging && !dragMoved) inspectAt(e.offsetX ? e.offsetX * dpr() : dragStartMouse.x, dragStartMouse.y);
    dragging = false;
  });
  glCanvas.addEventListener('click', (e) => {
    if (dragMoved) return; // click already handled as a drag release
    inspectAt(e.offsetX * dpr(), e.offsetY * dpr());
  });

  glCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const w = glCanvas.width, h = glCanvas.height;
    const rect = glCanvas.getBoundingClientRect();
    const domX = (e.clientX - rect.left) * dpr();
    const domY = (e.clientY - rect.top) * dpr();
    const uv = pixelToUV(domX, domY, w, h);
    const zUnderMouse = pixelToComplex(domX, domY, w, h, state.center, state.halfHeight);
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    state.halfHeight = Math.min(MAX_H, Math.max(MIN_H, state.halfHeight * factor));
    state.center = {
      re: zUnderMouse.re - uv.x * 2 * state.halfHeight,
      im: zUnderMouse.im - uv.y * 2 * state.halfHeight,
    };
    render();
  }, { passive: false });

  // Basic single-touch pan (pinch-zoom is a nice-to-have left for a later pass).
  let touchStart = null;
  glCanvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const rect = glCanvas.getBoundingClientRect();
    touchStart = {
      x: (e.touches[0].clientX - rect.left) * dpr(),
      y: (e.touches[0].clientY - rect.top) * dpr(),
      center: { ...state.center },
    };
  }, { passive: true });
  glCanvas.addEventListener('touchmove', (e) => {
    if (!touchStart || e.touches.length !== 1) return;
    const rect = glCanvas.getBoundingClientRect();
    const w = glCanvas.width, h = glCanvas.height;
    const nowX = (e.touches[0].clientX - rect.left) * dpr();
    const nowY = (e.touches[0].clientY - rect.top) * dpr();
    const zStart = pixelToComplex(touchStart.x, touchStart.y, w, h, touchStart.center, state.halfHeight);
    const zNow = pixelToComplex(nowX, nowY, w, h, touchStart.center, state.halfHeight);
    state.center = {
      re: touchStart.center.re - (zNow.re - zStart.re),
      im: touchStart.center.im - (zNow.im - zStart.im),
    };
    render();
  }, { passive: true });

  resetViewBtn.addEventListener('click', () => {
    state.center = { re: 0, im: 0 };
    state.halfHeight = 1.5;
    state.lastInspect = null;
    render();
  });

  ringSlider.addEventListener('input', () => {
    state.ringStrength = Number(ringSlider.value) / 100;
    ringValueLabel.textContent = `${ringSlider.value}%`;
    render();
  });
  showPolesZerosBox.addEventListener('change', render);

  // ── Compile + (re)build renderer for the current f(z) ────────────────
  function compileAndRender() {
    clearError();
    let compiled;
    try {
      compiled = ComplexPlaneCore.compileComplexExpr(exprInput.value);
    } catch (e) {
      showError(e.message || String(e));
      return;
    }
    state.compiled = compiled;

    if (state.useWebGL) {
      try {
        useGLProgram(compiled.fragmentShader);
      } catch (e) {
        // Codegen is type-checked, so this should be rare — but if a given
        // GPU/driver rejects the shader for some other reason, drop to the
        // CPU fallback instead of showing a blank canvas.
        state.useWebGL = false;
        showFallbackBanner('Your graphics driver rejected the live shader, so this is running on the slower fallback renderer instead. Everything still works, just at lower resolution.');
      }
    }
    render();
  }

  // ── Canvas sizing ──────────────────────────────────────────────────────
  function dpr() { return Math.min(window.devicePixelRatio || 1, 2); }
  function resizeCanvases() {
    const wrap = glCanvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr()));
    const h = Math.max(1, Math.round(rect.height * dpr()));
    [glCanvas, overlayCanvas].forEach((c) => { c.width = w; c.height = h; });
    render();
  }

  // ── Init ────────────────────────────────────────────────────────────────
  function init() {
    const gl = initWebGL();
    if (!gl) {
      state.useWebGL = false;
      showFallbackBanner('Your browser doesn\u2019t support WebGL here, so this is running on a slower canvas-2D fallback at reduced resolution. Panning, zooming, and click-to-inspect all still work.');
    }
    resizeCanvases();
    compileAndRender();
    window.addEventListener('resize', resizeCanvases);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    state.activePreset = (state.activePreset && state.activePreset.expr === exprInput.value) ? state.activePreset : null;
    compileAndRender();
  });

  init();
})();
