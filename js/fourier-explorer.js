// profpi — Fourier Series Explorer (page controller)
//
// Wires the tested MathCore / ExprParser / FourierCore modules (loaded as
// globals before this script) to the canvas UI on fourier-explorer.html.
// This file owns NO math logic of its own — every number on screen comes
// from FourierCore, exactly as fuzzed and unit-tested in
// test-fourier-core.js. This file only reads input (pointer strokes or
// form fields), calls the library, and draws the result.
//
// Design rules (kept consistent with ode-explorer.js / neural-ode-explorer.js):
//  1. Every library call is wrapped in try/catch. A bad expression or a
//     degenerate drawing can only ever produce a friendly message in the
//     error banner — never a broken page.
//  2. Hard caps mirror the library's own caps (sample counts, harmonics
//     slider range, raw stroke length) so nothing here can out-request
//     what FourierCore already guards against.
//  3. No dependencies beyond MathCore, ExprParser, FourierCore.

(function () {
  'use strict';

  if (!window.MathCore || !window.ExprParser || !window.FourierCore) {
    console.error('fourier-explorer.js requires mathcore.js, expr-parser.js and fourier-core.js to be loaded first.');
    return;
  }
  const FourierCore = window.FourierCore;

  const BASE_ANGULAR_SPEED = (2 * Math.PI) / 6; // one full loop every 6s at speed = 1
  const MAX_TRAIL_POINTS = 3000;                // safety net; a completed loop normally resets the trail well before this
  const DEFAULT_TRACE_RESOLUTION = 300;

  const PRESETS = {
    circle: { x: 'cos(t)', y: 'sin(t)' },
    heart: { x: 'sin(t)^3', y: '(13*cos(t) - 5*cos(2*t) - 2*cos(3*t) - cos(4*t)) / 16' },
    star: { x: '(1 + 0.4*cos(5*t))*cos(t)', y: '(1 + 0.4*cos(5*t))*sin(t)' },
    lissajous: { x: 'cos(3*t)', y: 'sin(2*t)' },
    astroid: { x: 'cos(t)^3', y: 'sin(t)^3' },
  };

  // ── DOM refs ────────────────────────────────────────────────────────
  const form = document.getElementById('controlForm');
  const modeDrawBtn = document.getElementById('modeDrawBtn');
  const modeParametricBtn = document.getElementById('modeParametricBtn');
  const drawFields = document.getElementById('drawFields');
  const parametricFields = document.getElementById('parametricFields');
  const clearDrawingBtn = document.getElementById('clearDrawingBtn');
  const exprXInput = document.getElementById('exprX');
  const exprYInput = document.getElementById('exprY');
  const harmonicsInput = document.getElementById('harmonicsInput');
  const harmonicsValue = document.getElementById('harmonicsValue');
  const sampleCountSelect = document.getElementById('sampleCountSelect');
  const speedInput = document.getElementById('speedInput');
  const speedValue = document.getElementById('speedValue');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const resetAnimationBtn = document.getElementById('resetAnimationBtn');
  const fidelityBadge = document.getElementById('fidelityBadge');
  const errorBanner = document.getElementById('errorBanner');
  const canvasStage = document.getElementById('canvasStage');
  const canvasHint = document.getElementById('canvasHint');
  const plotCanvas = document.getElementById('plotCanvas');
  const canvasLegend = document.getElementById('canvasLegend');
  const spectrumCanvas = document.getElementById('spectrumCanvas');
  const themeToggle = document.getElementById('themeToggle');
  const navToggle = document.getElementById('navToggle');
  const siteNav = document.getElementById('siteNav');

  const plotCtx = plotCanvas.getContext('2d');
  const spectrumCtx = spectrumCanvas.getContext('2d');

  // ── State ───────────────────────────────────────────────────────────
  const state = {
    mode: 'draw',            // 'draw' | 'parametric'
    isPointerDown: false,
    rawStroke: [],           // live pointer capture, in canvas CSS-pixel coords
    lastSource: null,        // { type: 'draw', points } | { type: 'parametric', exprX, exprY }
    sampleCount: 256,
    allTerms: null,          // full sorted term list from buildEpicycles (up to FourierCore.MAX_HARMONICS)
    totalAmplitude: 0,
    harmonicsCount: 30,
    terms: null,             // allTerms.slice(0, harmonicsCount) — what's actually drawn
    ghostPath: null,         // traceCurve(terms) — the static "you'll end up here" preview
    viewBox: null,           // {xMin,xMax,yMin,yMax} — fixed per-shape so the harmonics slider doesn't jitter the view
    currentChain: [],        // evaluateEpicycleChain(...).chain for the current animation frame
    t: 0,
    speed: 1,
    playing: true,
    penTrail: [],
  };

  // ── Small utilities (same conventions as ode-explorer.js) ───────────
  function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.remove('is-hidden');
  }

  function clearError() {
    errorBanner.textContent = '';
    errorBanner.classList.add('is-hidden');
  }

  function markFieldError(input, hasError) {
    input.classList.toggle('has-error', !!hasError);
  }

  function getPixelSize(canvasEl) {
    return { width: canvasEl.clientWidth, height: canvasEl.clientHeight };
  }

  // ── Build pipeline ──────────────────────────────────────────────────
  // Every path into "we have a shape" — a freehand drawing or a typed
  // parametric curve — ends up here with a plain {x,y}[] already sampled
  // to state.sampleCount points. This is the one place buildEpicycles is
  // called, so the rest of the file never touches the transform directly.
  function applyBuiltPoints(points) {
    const result = FourierCore.buildEpicycles(points, { maxHarmonics: FourierCore.MAX_HARMONICS });
    state.allTerms = result.terms;
    state.totalAmplitude = result.totalAmplitude;
    state.viewBox = FourierCore.boundingBox(points, { padding: 0.18 });
    const requested = parseInt(harmonicsInput.value, 10) || 30;
    state.harmonicsCount = Math.max(1, Math.min(requested, state.allTerms.length));
    harmonicsInput.max = String(state.allTerms.length);
    applyHarmonicsCount();
    state.t = 0;
    state.playing = true;
    updatePlayPauseBtn();
    clearError();
  }

  function applyHarmonicsCount() {
    if (!state.allTerms) return;
    state.terms = state.allTerms.slice(0, state.harmonicsCount);
    state.ghostPath = FourierCore.traceCurve(state.terms, { resolution: DEFAULT_TRACE_RESOLUTION });
    state.penTrail = [];
    state.t = 0;
    const keptAmplitude = state.terms.reduce((sum, t) => sum + t.amplitude, 0);
    const fidelity = state.totalAmplitude > 1e-12 ? keptAmplitude / state.totalAmplitude : 1;
    fidelityBadge.innerHTML =
      `<strong>${state.harmonicsCount}</strong> of ${state.allTerms.length} circles kept — ` +
      `<strong>${(fidelity * 100).toFixed(1)}%</strong> fidelity`;
  }

  // Re-derives points from whatever produced the current shape (the raw
  // drawn stroke, or the typed x(t)/y(t) pair) at the *current*
  // state.sampleCount. Called on sample-resolution change and on first
  // load — never duplicated inline, so draw/parametric always agree on
  // how a rebuild happens.
  function rebuildFromLastSource() {
    if (!state.lastSource) return;
    clearError();
    try {
      let points;
      if (state.lastSource.type === 'draw') {
        points = FourierCore.resamplePolyline(state.lastSource.points, state.sampleCount);
      } else {
        const xFn = ExprParser.compile(state.lastSource.exprX, ['t']);
        const yFn = ExprParser.compile(state.lastSource.exprY, ['t']);
        const sampled = FourierCore.sampleParametric(xFn, yFn, { samples: state.sampleCount });
        points = sampled.points;
        if (sampled.skipped > 0) {
          fidelityBadge.innerHTML += ` <span class="field-hint">(${sampled.skipped} sample(s) skipped — undefined at those t)</span>`;
        }
      }
      applyBuiltPoints(points);
    } catch (e) {
      showError(e.message);
      state.allTerms = null;
      state.terms = null;
    }
    draw();
  }

  function rebuildParametric() {
    markFieldError(exprXInput, false);
    markFieldError(exprYInput, false);
    let xOk = true, yOk = true;
    try { ExprParser.compile(exprXInput.value, ['t']); } catch (e) { xOk = false; markFieldError(exprXInput, true); }
    try { ExprParser.compile(exprYInput.value, ['t']); } catch (e) { yOk = false; markFieldError(exprYInput, true); }
    if (!xOk || !yOk) {
      let message = '';
      try { ExprParser.compile(exprXInput.value, ['t']); } catch (e) { message = e.message; }
      if (!message) { try { ExprParser.compile(exprYInput.value, ['t']); } catch (e) { message = e.message; } }
      showError(message || 'x(t)/y(t) could not be parsed.');
      state.allTerms = null;
      state.terms = null;
      draw();
      return;
    }
    state.lastSource = { type: 'parametric', exprX: exprXInput.value, exprY: exprYInput.value };
    rebuildFromLastSource();
  }

  // ── Drawing capture (pointer events on the canvas) ──────────────────
  let activePointerId = null;

  function addPointFromEvent(e) {
    const rect = plotCanvas.getBoundingClientRect();
    state.rawStroke.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (state.rawStroke.length > FourierCore.MAX_RAW_STROKE_POINTS) state.rawStroke.shift();
    draw();
  }

  function commitDrawing() {
    if (state.rawStroke.length < 2) {
      state.rawStroke = [];
      return;
    }
    // Canvas y grows downward; flip it here so "up" is positive, the
    // normal math convention, before it ever reaches FourierCore.
    const mathPoints = state.rawStroke.map((p) => ({ x: p.x, y: -p.y }));
    state.rawStroke = [];
    state.lastSource = { type: 'draw', points: mathPoints };
    canvasHint.classList.add('is-hidden');
    rebuildFromLastSource();
  }

  canvasStage.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'draw') return;
    activePointerId = e.pointerId;
    try { canvasStage.setPointerCapture(e.pointerId); } catch (err) { /* not all browsers need/allow this */ }
    state.isPointerDown = true;
    state.rawStroke = [];
    clearError();
    addPointFromEvent(e);
  });
  canvasStage.addEventListener('pointermove', (e) => {
    if (!state.isPointerDown || e.pointerId !== activePointerId) return;
    addPointFromEvent(e);
  });
  function endStroke(e) {
    if (!state.isPointerDown) return;
    if (activePointerId !== null && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
    state.isPointerDown = false;
    activePointerId = null;
    commitDrawing();
  }
  canvasStage.addEventListener('pointerup', endStroke);
  canvasStage.addEventListener('pointercancel', endStroke);
  canvasStage.addEventListener('pointerleave', (e) => { if (state.isPointerDown) endStroke(e); });

  // ── Mode switching ──────────────────────────────────────────────────
  function setMode(mode) {
    state.mode = mode;
    modeDrawBtn.classList.toggle('is-active', mode === 'draw');
    modeDrawBtn.setAttribute('aria-selected', String(mode === 'draw'));
    modeParametricBtn.classList.toggle('is-active', mode === 'parametric');
    modeParametricBtn.setAttribute('aria-selected', String(mode === 'parametric'));
    drawFields.classList.toggle('is-hidden', mode !== 'draw');
    parametricFields.classList.toggle('is-hidden', mode !== 'parametric');

    if (mode === 'parametric') {
      rebuildParametric();
    } else if (state.lastSource && state.lastSource.type === 'draw') {
      canvasHint.classList.add('is-hidden');
      rebuildFromLastSource();
    } else {
      state.allTerms = null;
      state.terms = null;
      canvasHint.classList.remove('is-hidden');
      clearError();
      draw();
    }
  }

  modeDrawBtn.addEventListener('click', () => setMode('draw'));
  modeParametricBtn.addEventListener('click', () => setMode('parametric'));

  form.addEventListener('submit', (e) => e.preventDefault());

  clearDrawingBtn.addEventListener('click', () => {
    state.lastSource = null;
    state.allTerms = null;
    state.terms = null;
    clearError();
    canvasHint.classList.remove('is-hidden');
    draw();
  });

  const debouncedParametricRebuild = debounce(() => { if (state.mode === 'parametric') rebuildParametric(); }, 500);
  [exprXInput, exprYInput].forEach((input) => {
    input.addEventListener('input', debouncedParametricRebuild);
    input.addEventListener('change', () => { if (state.mode === 'parametric') rebuildParametric(); });
  });

  document.querySelectorAll('.preset-chip[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = PRESETS[btn.dataset.preset];
      if (!preset) return;
      exprXInput.value = preset.x;
      exprYInput.value = preset.y;
      setMode('parametric');
    });
  });

  harmonicsInput.addEventListener('input', () => {
    harmonicsValue.textContent = harmonicsInput.value;
    if (!state.allTerms) return;
    state.harmonicsCount = Math.max(1, Math.min(parseInt(harmonicsInput.value, 10), state.allTerms.length));
    applyHarmonicsCount();
    draw();
  });

  sampleCountSelect.addEventListener('change', () => {
    state.sampleCount = parseInt(sampleCountSelect.value, 10);
    rebuildFromLastSource();
  });

  speedInput.addEventListener('input', () => {
    state.speed = parseFloat(speedInput.value);
    speedValue.textContent = state.speed.toFixed(1) + '\u00d7';
  });

  function updatePlayPauseBtn() {
    playPauseBtn.textContent = state.playing ? 'Pause' : 'Play';
  }
  playPauseBtn.addEventListener('click', () => {
    state.playing = !state.playing;
    updatePlayPauseBtn();
  });
  resetAnimationBtn.addEventListener('click', () => {
    state.t = 0;
    state.penTrail = [];
    draw();
  });

  // ── Canvas: coordinate transform (uniform scale, so circles stay circles) ─
  function computeTransform(canvasEl) {
    const { width, height } = getPixelSize(canvasEl);
    const { xMin, xMax, yMin, yMax } = state.viewBox;
    const spanX = Math.max(xMax - xMin, 1e-9);
    const spanY = Math.max(yMax - yMin, 1e-9);
    const scale = Math.min(width / spanX, height / spanY);
    const offsetX = (width - scale * spanX) / 2;
    const offsetY = (height - scale * spanY) / 2;
    return { scale, offsetX, offsetY, xMin, yMax };
  }

  function mathToPixel(x, y) {
    const { scale, offsetX, offsetY, xMin, yMax } = computeTransform(plotCanvas);
    return [offsetX + (x - xMin) * scale, offsetY + (yMax - y) * scale];
  }

  // ── Canvas: drawing ─────────────────────────────────────────────────
  function renderLegend() {
    canvasLegend.innerHTML = '';
    const chips = [];
    if (state.terms) {
      chips.push(['Traced path', cssVar('--border-color', '#cbd5e1')]);
      chips.push(['Epicycles', cssVar('--accent', '#6366f1')]);
      chips.push(['Pen trail', cssVar('--accent-secondary', '#06b6d4')]);
    }
    chips.forEach(([label, color]) => {
      const chip = document.createElement('span');
      chip.className = 'legend-chip';
      const swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      swatch.style.background = color;
      chip.appendChild(swatch);
      chip.appendChild(document.createTextNode(label));
      canvasLegend.appendChild(chip);
    });
  }

  function drawPlot() {
    const { width, height } = getPixelSize(plotCanvas);
    if (width === 0 || height === 0) return;
    plotCtx.clearRect(0, 0, width, height);

    const mutedColor = cssVar('--text-muted', '#64748b');
    const accent = cssVar('--accent', '#6366f1');
    const accent2 = cssVar('--accent-secondary', '#06b6d4');
    const borderColor = cssVar('--border-color', '#cbd5e1');

    if (state.isPointerDown) {
      plotCtx.strokeStyle = accent;
      plotCtx.lineWidth = 2.5;
      plotCtx.lineJoin = 'round';
      plotCtx.lineCap = 'round';
      plotCtx.beginPath();
      state.rawStroke.forEach((p, i) => { if (i === 0) plotCtx.moveTo(p.x, p.y); else plotCtx.lineTo(p.x, p.y); });
      plotCtx.stroke();
      renderLegend();
      return;
    }

    if (!state.terms) {
      plotCtx.fillStyle = mutedColor;
      plotCtx.font = '13px Inter, sans-serif';
      plotCtx.textAlign = 'center';
      plotCtx.fillText(
        state.mode === 'draw' ? 'Draw a shape to see its epicycles.' : 'Fix the expression above to see its epicycles.',
        width / 2, height / 2
      );
      plotCtx.textAlign = 'left';
      renderLegend();
      return;
    }

    const { scale } = computeTransform(plotCanvas);

    // Ghost path — the full traced curve at the current harmonic count.
    plotCtx.strokeStyle = borderColor;
    plotCtx.lineWidth = 1.5;
    plotCtx.beginPath();
    state.ghostPath.forEach((p, i) => {
      const [px, py] = mathToPixel(p.x, p.y);
      if (i === 0) plotCtx.moveTo(px, py); else plotCtx.lineTo(px, py);
    });
    plotCtx.closePath();
    plotCtx.stroke();

    // Epicycle circles + arms.
    plotCtx.lineWidth = 1.2;
    state.currentChain.forEach((link) => {
      const [cx, cy] = mathToPixel(link.x, link.y);
      const [tx, ty] = mathToPixel(link.x + link.dx, link.y + link.dy);
      const rPix = Math.max(0, link.amplitude * scale);
      plotCtx.globalAlpha = 0.45;
      plotCtx.strokeStyle = borderColor;
      plotCtx.beginPath();
      plotCtx.arc(cx, cy, rPix, 0, Math.PI * 2);
      plotCtx.stroke();
      plotCtx.globalAlpha = 1;
      plotCtx.strokeStyle = accent;
      plotCtx.beginPath();
      plotCtx.moveTo(cx, cy);
      plotCtx.lineTo(tx, ty);
      plotCtx.stroke();
    });

    // Pen trail (the part of the loop already traced this cycle).
    plotCtx.strokeStyle = accent2;
    plotCtx.lineWidth = 2.5;
    plotCtx.lineJoin = 'round';
    plotCtx.beginPath();
    state.penTrail.forEach((p, i) => {
      const [px, py] = mathToPixel(p.x, p.y);
      if (i === 0) plotCtx.moveTo(px, py); else plotCtx.lineTo(px, py);
    });
    plotCtx.stroke();

    // Pen tip.
    if (state.currentChain.length) {
      const last = state.currentChain[state.currentChain.length - 1];
      const [px, py] = mathToPixel(last.x + last.dx, last.y + last.dy);
      plotCtx.fillStyle = accent2;
      plotCtx.beginPath();
      plotCtx.arc(px, py, 4, 0, Math.PI * 2);
      plotCtx.fill();
    }

    renderLegend();
  }

  function drawSpectrum() {
    const { width, height } = getPixelSize(spectrumCanvas);
    if (width === 0 || height === 0) return;
    spectrumCtx.clearRect(0, 0, width, height);

    const mutedColor = cssVar('--text-muted', '#64748b');
    const accent = cssVar('--accent', '#6366f1');
    const faded = cssVar('--border-color', '#cbd5e1');

    if (!state.allTerms || !state.allTerms.length) {
      spectrumCtx.fillStyle = mutedColor;
      spectrumCtx.font = '12px Inter, sans-serif';
      spectrumCtx.textAlign = 'center';
      spectrumCtx.fillText('Spectrum will appear once a shape is built.', width / 2, height / 2);
      spectrumCtx.textAlign = 'left';
      return;
    }

    const keptFreqs = new Set(state.terms.map((t) => t.freq));
    const sorted = state.allTerms.slice().sort((a, b) => a.freq - b.freq);
    const maxAmp = Math.max(1e-9, ...sorted.map((t) => t.amplitude));
    const bottomMargin = 16;
    const barAreaH = height - bottomMargin;
    const barW = width / sorted.length;

    sorted.forEach((t, i) => {
      const h = (t.amplitude / maxAmp) * barAreaH;
      const x = i * barW;
      const y = barAreaH - h;
      spectrumCtx.fillStyle = keptFreqs.has(t.freq) ? accent : faded;
      spectrumCtx.fillRect(x + 0.5, y, Math.max(1, barW - 1), h);
    });

    spectrumCtx.fillStyle = mutedColor;
    spectrumCtx.font = '10px Inter, sans-serif';
    spectrumCtx.textAlign = 'center';
    spectrumCtx.fillText('\u2190 lower frequency        higher frequency \u2192', width / 2, height - 4);
    spectrumCtx.textAlign = 'left';
  }

  function draw() {
    drawPlot();
    drawSpectrum();
  }

  // ── Animation loop ──────────────────────────────────────────────────
  let lastFrameTime = null;
  function tick(now) {
    if (state.playing && state.terms && state.terms.length && !state.isPointerDown) {
      if (lastFrameTime !== null) {
        const dt = Math.min((now - lastFrameTime) / 1000, 0.05); // clamp so a backgrounded tab doesn't jump on return
        state.t += dt * state.speed * BASE_ANGULAR_SPEED;
        if (state.t >= 2 * Math.PI) {
          state.t = state.t % (2 * Math.PI);
          state.penTrail = []; // loop complete — start the trail fresh
        }
      }
      lastFrameTime = now;
      const { x, y, chain } = FourierCore.evaluateEpicycleChain(state.terms, state.t);
      state.currentChain = chain;
      state.penTrail.push({ x, y });
      if (state.penTrail.length > MAX_TRAIL_POINTS) state.penTrail.shift();
    } else {
      lastFrameTime = now;
    }
    draw();
    requestAnimationFrame(tick);
  }

  // ── Canvas resizing ─────────────────────────────────────────────────
  function resizeCanvasBackingStore(canvasEl, ctx) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvasEl.clientWidth, h = canvasEl.clientHeight;
    if (w === 0 || h === 0) return;
    canvasEl.width = Math.round(w * dpr);
    canvasEl.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resizeAll() {
    resizeCanvasBackingStore(plotCanvas, plotCtx);
    resizeCanvasBackingStore(spectrumCanvas, spectrumCtx);
    draw();
  }

  if (window.ResizeObserver) {
    new ResizeObserver(debounce(resizeAll, 60)).observe(canvasStage);
    new ResizeObserver(debounce(resizeAll, 60)).observe(spectrumCanvas);
  } else {
    window.addEventListener('resize', debounce(resizeAll, 100));
  }

  // ── Header niceties (mobile nav + theme toggle) ─────────────────────
  if (navToggle && siteNav) {
    navToggle.addEventListener('click', () => {
      const open = siteNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
  }

  if (themeToggle) {
    try {
      const saved = localStorage.getItem('profpi-theme');
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    } catch (e) { /* privacy mode or storage disabled — theme just won't persist */ }

    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const next = isDark ? 'light' : 'dark';
      if (next === 'light') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', 'dark');
      try { localStorage.setItem('profpi-theme', next); } catch (e) { /* ignore */ }
      draw();
    });
  }

  // ── Init ────────────────────────────────────────────────────────────
  harmonicsValue.textContent = harmonicsInput.value;
  speedValue.textContent = parseFloat(speedInput.value).toFixed(1) + '\u00d7';
  resizeAll();
  setMode('parametric'); // open on the circle preset so the tool demos itself immediately
  requestAnimationFrame(tick);
})();
