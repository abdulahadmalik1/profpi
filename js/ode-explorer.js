// profpi — ODE & Phase Portrait Explorer (page controller)
//
// Wires the tested MathCore / ExprParser / PhasePortrait modules (loaded
// as globals before this script) to the canvas UI on ode-explorer.html.
// This file owns NO math logic of its own — every number on screen comes
// from PhasePortrait / MathCore, exactly as fuzzed and unit-tested. This
// file only reads form inputs, calls the library, and draws the result.
//
// Design rules (kept consistent with the rest of profpi):
//  1. Every library call is wrapped in try/catch. A bad expression can
//     only ever produce a friendly message in the error banner — never a
//     broken page.
//  2. Hard caps mirror the library's own caps (trajectory count, field
//     density slider range) so nothing here can out-request what
//     PhasePortrait / MathCore already guard against.
//  3. No dependencies beyond MathCore, ExprParser, PhasePortrait.

(function () {
  'use strict';

  if (!window.MathCore || !window.ExprParser || !window.PhasePortrait) {
    console.error('ode-explorer.js requires mathcore.js, expr-parser.js and phase-portrait.js to be loaded first.');
    return;
  }

  const MAX_TRAJECTORIES = 12;
  const EQUILIBRIUM_SEED_DIM = 14; // 14x14 = 196 seeds, well under PhasePortrait's 400 cap

  // ── DOM refs ────────────────────────────────────────────────────────
  const form = document.getElementById('controlForm');
  const modeSingleBtn = document.getElementById('modeSingleBtn');
  const modeSystemBtn = document.getElementById('modeSystemBtn');
  const singleFields = document.getElementById('singleFields');
  const systemFields = document.getElementById('systemFields');
  const exprSingleInput = document.getElementById('exprSingle');
  const exprFInput = document.getElementById('exprF');
  const exprGInput = document.getElementById('exprG');
  const xMinInput = document.getElementById('xMin');
  const xMaxInput = document.getElementById('xMax');
  const yMinInput = document.getElementById('yMin');
  const yMaxInput = document.getElementById('yMax');
  const densityInput = document.getElementById('density');
  const densityValue = document.getElementById('densityValue');
  const densityValue2 = document.getElementById('densityValue2');
  const showEquilibriaInput = document.getElementById('showEquilibria');
  const equilibriaToggleGroup = document.getElementById('equilibriaToggleGroup');
  const clearTrajectoriesBtn = document.getElementById('clearTrajectories');
  const errorBanner = document.getElementById('errorBanner');
  const canvas = document.getElementById('plotCanvas');
  const canvasLegend = document.getElementById('canvasLegend');
  const equilibriaPanel = document.getElementById('equilibriaPanel');
  const equilibriaList = document.getElementById('equilibriaList');
  const themeToggle = document.getElementById('themeToggle');
  const navToggle = document.getElementById('navToggle');
  const siteNav = document.getElementById('siteNav');
  const ctx = canvas.getContext('2d');

  const SYSTEM_PRESETS = {
    saddle: { f: 'x', g: '-y' },
    center: { f: 'y', g: '-x' },
    duffing: { f: 'y', g: 'x - x^3' },
    vanderpol: { f: 'y', g: '(1 - x^2)*y - x' },
  };

  // ── State ───────────────────────────────────────────────────────────
  const state = {
    mode: 'single',           // 'single' | 'system'
    bounds: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
    cols: 28,
    rows: 28,
    field: null,              // result of computeSlopeField / computeVectorField
    equilibria: [],
    trajectories: [],         // [{ points: [[x,y],...], blewUp }]
  };

  // ── Small utilities ─────────────────────────────────────────────────
  function debounce(fn, wait) {
    let t = null;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
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

  // ── Reading bounds from the form (validated, with sane fallback) ────
  function readBounds() {
    const xMin = parseFloat(xMinInput.value);
    const xMax = parseFloat(xMaxInput.value);
    const yMin = parseFloat(yMinInput.value);
    const yMax = parseFloat(yMaxInput.value);
    if (![xMin, xMax, yMin, yMax].every(Number.isFinite)) {
      throw new Error('View bounds must all be numbers.');
    }
    if (xMin >= xMax) throw new Error('x min must be less than x max.');
    if (yMin >= yMax) throw new Error('y min must be less than y max.');
    return { xMin, xMax, yMin, yMax };
  }

  // ── Compiling expressions with per-field error highlighting ─────────
  function tryCompile(exprString, inputEl) {
    try {
      window.ExprParser.compile(exprString, ['x', 'y']);
      markFieldError(inputEl, false);
      return null;
    } catch (e) {
      markFieldError(inputEl, true);
      return e.message;
    }
  }

  // ── Recompute field (+ optionally equilibria) from current form state ─
  function recomputeField({ clearTraj = false, recomputeEquilibria = true } = {}) {
    let bounds;
    try {
      bounds = readBounds();
    } catch (e) {
      showError(e.message);
      state.field = null;
      state.equilibria = [];
      draw();
      return;
    }
    state.bounds = bounds;

    const cols = state.cols, rows = state.rows;

    if (state.mode === 'single') {
      markFieldError(exprFInput, false);
      markFieldError(exprGInput, false);
      const err = tryCompile(exprSingleInput.value, exprSingleInput);
      if (err) {
        showError(err);
        state.field = null;
        state.equilibria = [];
        draw();
        return;
      }
      try {
        state.field = window.PhasePortrait.computeSlopeField(exprSingleInput.value, {
          ...bounds, cols, rows,
        });
        state.equilibria = [];
        clearError();
      } catch (e) {
        showError(e.message);
        state.field = null;
      }
    } else {
      const errF = tryCompile(exprFInput.value, exprFInput);
      const errG = tryCompile(exprGInput.value, exprGInput);
      if (errF || errG) {
        showError([errF, errG].filter(Boolean).join(' — '));
        state.field = null;
        state.equilibria = [];
        draw();
        return;
      }
      try {
        state.field = window.PhasePortrait.computeVectorField(exprFInput.value, exprGInput.value, {
          ...bounds, cols, rows,
        });
        if (recomputeEquilibria) {
          const { equilibria } = window.PhasePortrait.computeEquilibria(exprFInput.value, exprGInput.value, {
            ...bounds, seedCols: EQUILIBRIUM_SEED_DIM, seedRows: EQUILIBRIUM_SEED_DIM,
          });
          state.equilibria = equilibria;
        }
        clearError();
      } catch (e) {
        showError(e.message);
        state.field = null;
        state.equilibria = [];
      }
    }

    if (clearTraj) state.trajectories = [];
    renderEquilibriaPanel();
    draw();
  }

  // ── Trajectories ────────────────────────────────────────────────────
  function trajectoryStepParams() {
    const span = Math.max(
      state.bounds.xMax - state.bounds.xMin,
      state.bounds.yMax - state.bounds.yMin
    );
    return { h: span / 1200, steps: 1200 };
  }

  function addTrajectoryAt(mx, my) {
    if (!state.field) return; // don't plot trajectories through an invalid/uncompiled field
    const { h, steps } = trajectoryStepParams();
    try {
      let result;
      if (state.mode === 'single') {
        result = window.PhasePortrait.computeTrajectory(
          exprSingleInput.value, null, { t0: mx, y0: my }, { h, steps, direction: 'both' }
        );
        const points = result.trajectory.map((p) => [p.t, p.y]);
        state.trajectories.push({ points, blewUp: result.blewUp });
      } else {
        result = window.PhasePortrait.computeTrajectory(
          exprFInput.value, exprGInput.value, { t0: 0, x0: mx, y0: my }, { h, steps, direction: 'both' }
        );
        const points = result.trajectory.map((p) => p.y);
        state.trajectories.push({ points, blewUp: result.blewUp });
      }
      if (state.trajectories.length > MAX_TRAJECTORIES) state.trajectories.shift();
      clearError();
    } catch (e) {
      showError(e.message);
    }
    draw();
  }

  // ── Equilibria side panel ───────────────────────────────────────────
  function classificationColor(stability) {
    if (stability === 'stable') return cssVar('--success', '#10b981');
    if (stability === 'unstable') return cssVar('--danger', '#ef4444');
    return cssVar('--neutral-accent', '#8b5cf6');
  }

  function renderEquilibriaPanel() {
    const shouldShow = state.mode === 'system' && showEquilibriaInput.checked && state.equilibria.length > 0;
    equilibriaPanel.classList.toggle('is-hidden', !shouldShow);
    equilibriaToggleGroup.classList.toggle('is-hidden', state.mode !== 'system');
    if (!shouldShow) return;

    equilibriaList.innerHTML = '';
    state.equilibria.forEach((eq) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'eq-dot';
      dot.style.background = classificationColor(eq.stability);
      const text = document.createElement('div');
      text.innerHTML = `<strong>${eq.classification} (${eq.stability})</strong>` +
        `(${eq.x.toFixed(3)}, ${eq.y.toFixed(3)})`;
      li.appendChild(dot);
      li.appendChild(text);
      equilibriaList.appendChild(li);
    });
  }

  // ── Canvas: coordinate transforms ───────────────────────────────────
  function getPixelSize() {
    return { width: canvas.clientWidth, height: canvas.clientHeight };
  }

  function mathToPixel(x, y) {
    const { width, height } = getPixelSize();
    const { xMin, xMax, yMin, yMax } = state.bounds;
    const px = ((x - xMin) / (xMax - xMin)) * width;
    const py = height - ((y - yMin) / (yMax - yMin)) * height;
    return [px, py];
  }

  function pixelToMath(px, py) {
    const { width, height } = getPixelSize();
    const { xMin, xMax, yMin, yMax } = state.bounds;
    const x = xMin + (px / width) * (xMax - xMin);
    const y = yMin + ((height - py) / height) * (yMax - yMin);
    return [x, y];
  }

  function niceStep(range, targetTicks) {
    const rough = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    return step * mag;
  }

  // ── Canvas: drawing ─────────────────────────────────────────────────
  function drawArrow(x1, y1, x2, y2, headLen) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (!headLen) return;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  function draw() {
    const { width, height } = getPixelSize();
    if (width === 0 || height === 0) return;
    ctx.clearRect(0, 0, width, height);

    const textColor = cssVar('--text-main', '#0f172a');
    const mutedColor = cssVar('--text-muted', '#64748b');
    const gridColor = cssVar('--border-color', '#e2e8f0');
    const fieldColor = cssVar('--accent', '#6366f1');
    const trajColor = cssVar('--accent-secondary', '#06b6d4');
    const { xMin, xMax, yMin, yMax } = state.bounds;

    // Gridlines + axes
    ctx.lineWidth = 1;
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = mutedColor;
    ctx.font = '10px Inter, sans-serif';
    const stepX = niceStep(xMax - xMin, 8);
    const stepY = niceStep(yMax - yMin, 8);
    for (let gx = Math.ceil(xMin / stepX) * stepX; gx <= xMax; gx += stepX) {
      const [px] = mathToPixel(gx, 0);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
      if (Math.abs(gx) > stepX * 1e-6) ctx.fillText(Number(gx.toFixed(6)).toString(), px + 3, height - 4);
    }
    for (let gy = Math.ceil(yMin / stepY) * stepY; gy <= yMax; gy += stepY) {
      const [, py] = mathToPixel(0, gy);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke();
      if (Math.abs(gy) > stepY * 1e-6) ctx.fillText(Number(gy.toFixed(6)).toString(), 4, py - 3);
    }
    // Bold axes at x=0 / y=0, if in view
    ctx.strokeStyle = mutedColor;
    ctx.lineWidth = 1.5;
    if (xMin <= 0 && xMax >= 0) {
      const [px] = mathToPixel(0, 0);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
    }
    if (yMin <= 0 && yMax >= 0) {
      const [, py] = mathToPixel(0, 0);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke();
    }

    if (!state.field) {
      ctx.fillStyle = mutedColor;
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Fix the equation above to see the field.', width / 2, height / 2);
      ctx.textAlign = 'left';
      renderLegend();
      return;
    }

    // Field (slope segments or vector arrows)
    const cellW = width / state.cols;
    const cellH = height / state.rows;
    const segLen = Math.min(cellW, cellH) * 0.42;
    ctx.strokeStyle = fieldColor;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.4;

    if (state.mode === 'single') {
      state.field.points.forEach((p) => {
        if (!p.defined) return;
        const [cx, cy] = mathToPixel(p.x, p.y);
        const dx = (p.dirX * segLen) / 2;
        const dy = -(p.dirY * segLen) / 2;
        drawArrow(cx - dx, cy - dy, cx + dx, cy + dy, 0);
      });
    } else {
      const maxMag = Math.max(1e-9, ...state.field.points.filter((p) => p.defined).map((p) => p.magnitude));
      state.field.points.forEach((p) => {
        if (!p.defined) return;
        const [cx, cy] = mathToPixel(p.x, p.y);
        const scale = 0.45 + 0.55 * Math.min(1, p.magnitude / maxMag);
        const dx = p.dirX * segLen * scale;
        const dy = -p.dirY * segLen * scale;
        drawArrow(cx - dx * 0.15, cy - dy * 0.15, cx + dx, cy + dy, segLen * 0.28);
      });
    }
    ctx.globalAlpha = 1;

    // Trajectories
    ctx.strokeStyle = trajColor;
    ctx.lineWidth = 2;
    state.trajectories.forEach((traj) => {
      ctx.beginPath();
      traj.points.forEach(([x, y], i) => {
        const [px, py] = mathToPixel(x, y);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    });

    // Equilibria
    if (state.mode === 'system' && showEquilibriaInput.checked) {
      state.equilibria.forEach((eq) => {
        const [px, py] = mathToPixel(eq.x, eq.y);
        ctx.beginPath();
        ctx.fillStyle = classificationColor(eq.stability);
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = cssVar('--card-bg', '#ffffff');
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = textColor;
        ctx.font = '11px Inter, sans-serif';
        ctx.fillText(eq.classification, px + 10, py - 8);
      });
    }

    renderLegend();
  }

  function renderLegend() {
    canvasLegend.innerHTML = '';
    const chips = [];
    if (state.mode === 'single') {
      chips.push(['Slope field', cssVar('--accent', '#6366f1')]);
    } else {
      chips.push(['Vector field', cssVar('--accent', '#6366f1')]);
      if (showEquilibriaInput.checked && state.equilibria.length) {
        chips.push(['Stable', cssVar('--success', '#10b981')]);
        chips.push(['Unstable', cssVar('--danger', '#ef4444')]);
        chips.push(['Neutral', cssVar('--neutral-accent', '#8b5cf6')]);
      }
    }
    if (state.trajectories.length) {
      chips.push([`Trajectories (${state.trajectories.length})`, cssVar('--accent-secondary', '#06b6d4')]);
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

  // ── Canvas resizing ─────────────────────────────────────────────────
  function resizeCanvasBackingStore() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  if (window.ResizeObserver) {
    new ResizeObserver(debounce(resizeCanvasBackingStore, 60)).observe(canvas);
  } else {
    window.addEventListener('resize', debounce(resizeCanvasBackingStore, 100));
  }

  // ── Event wiring ────────────────────────────────────────────────────
  function setMode(mode) {
    state.mode = mode;
    modeSingleBtn.classList.toggle('is-active', mode === 'single');
    modeSingleBtn.setAttribute('aria-checked', String(mode === 'single'));
    modeSystemBtn.classList.toggle('is-active', mode === 'system');
    modeSystemBtn.setAttribute('aria-checked', String(mode === 'system'));
    singleFields.classList.toggle('is-hidden', mode !== 'single');
    systemFields.classList.toggle('is-hidden', mode !== 'system');
    equilibriaToggleGroup.classList.toggle('is-hidden', mode !== 'system');
    recomputeField({ clearTraj: true });
  }

  modeSingleBtn.addEventListener('click', () => setMode('single'));
  modeSystemBtn.addEventListener('click', () => setMode('system'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    recomputeField({ clearTraj: true });
  });

  const debouncedExprRecompute = debounce(() => recomputeField({ clearTraj: true }), 600);
  [exprSingleInput, exprFInput, exprGInput].forEach((input) => {
    input.addEventListener('input', debouncedExprRecompute);
    input.addEventListener('change', () => recomputeField({ clearTraj: true }));
  });

  [xMinInput, xMaxInput, yMinInput, yMaxInput].forEach((input) => {
    input.addEventListener('change', () => recomputeField({ clearTraj: false }));
  });

  const debouncedDensityRecompute = debounce(() => recomputeField({ clearTraj: false, recomputeEquilibria: false }), 80);
  densityInput.addEventListener('input', () => {
    state.cols = state.rows = parseInt(densityInput.value, 10);
    densityValue.textContent = densityValue2.textContent = densityInput.value;
    debouncedDensityRecompute();
  });

  showEquilibriaInput.addEventListener('change', () => {
    renderEquilibriaPanel();
    draw();
  });

  clearTrajectoriesBtn.addEventListener('click', () => {
    state.trajectories = [];
    clearError();
    draw();
  });

  document.querySelectorAll('.preset-chip[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      target.value = btn.dataset.value;
      recomputeField({ clearTraj: true });
    });
  });

  document.querySelectorAll('.preset-chip[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = SYSTEM_PRESETS[btn.dataset.preset];
      if (!preset) return;
      exprFInput.value = preset.f;
      exprGInput.value = preset.g;
      recomputeField({ clearTraj: true });
    });
  });

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const [mx, my] = pixelToMath(px, py);
    addTrajectoryAt(mx, my);
  });

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
  densityValue.textContent = densityValue2.textContent = densityInput.value;
  resizeCanvasBackingStore();
  recomputeField({ clearTraj: true });
})();
