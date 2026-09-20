// profpi — Neural ODE Explorer (page controller)
//
// Owns no math/training logic of its own — everything numeric comes from
// NeuralODE / ExprParser, exactly as gradient-checked and tested. This
// file reads form inputs, drives training a few epochs per animation
// frame (so the tab never blocks even at the caps), and draws results.

(function () {
  'use strict';

  if (!window.ExprParser || !window.NeuralODE) {
    console.error('neural-ode-explorer.js requires expr-parser.js and neural-ode-core.js to be loaded first.');
    return;
  }

  const FLOW_BOUNDS = { xMin: -2.2, xMax: 2.2, yMin: -2.2, yMax: 2.2 };
  const FIT_FIELD_GRID = 20;
  const FLOW_DECISION_GRID = 40;

  const SYSTEM_PRESETS = {
    saddle: { f: 'x', g: '-y' },
    center: { f: 'y', g: '-x' },
    duffing: { f: 'y', g: 'x - x^3' },
    vanderpol: { f: 'y', g: '(1 - x^2)*y - x' },
  };

  // ── DOM refs ────────────────────────────────────────────────────────
  const modeFitBtn = document.getElementById('modeFitBtn');
  const modeFlowBtn = document.getElementById('modeFlowBtn');
  const fitFields = document.getElementById('fitFields');
  const flowFields = document.getElementById('flowFields');

  const fitExprF = document.getElementById('fitExprF');
  const fitExprG = document.getElementById('fitExprG');
  const fitXMin = document.getElementById('fitXMin');
  const fitXMax = document.getElementById('fitXMax');
  const fitYMin = document.getElementById('fitYMin');
  const fitYMax = document.getElementById('fitYMax');
  const fitSamplesInput = document.getElementById('fitSamples');
  const fitSamplesValue = document.getElementById('fitSamplesValue');
  const fitNoiseInput = document.getElementById('fitNoise');
  const fitNoiseValue = document.getElementById('fitNoiseValue');
  const trainFitBtn = document.getElementById('trainFitBtn');

  const flowNoiseInput = document.getElementById('flowNoise');
  const flowNoiseValue = document.getElementById('flowNoiseValue');
  const showDecisionInput = document.getElementById('showDecision');
  const trainFlowBtn = document.getElementById('trainFlowBtn');
  const flowScrubGroup = document.getElementById('flowScrubGroup');
  const flowScrub = document.getElementById('flowScrub');
  const flowScrubValue = document.getElementById('flowScrubValue');
  const playFlowBtn = document.getElementById('playFlowBtn');

  const errorBanner = document.getElementById('errorBanner');
  const canvas = document.getElementById('plotCanvas');
  const canvasLegend = document.getElementById('canvasLegend');
  const statsPanel = document.getElementById('statsPanel');
  const statsList = document.getElementById('statsList');
  const lossSparkline = document.getElementById('lossSparkline');
  const themeToggle = document.getElementById('themeToggle');
  const navToggle = document.getElementById('navToggle');
  const siteNav = document.getElementById('siteNav');
  const ctx = canvas.getContext('2d');
  const sparkCtx = lossSparkline.getContext('2d');

  // ── State ───────────────────────────────────────────────────────────
  const state = {
    mode: 'fit', // 'fit' | 'flow'
    trainRunId: 0,
    fit: { bounds: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 }, progress: null, result: null, trueField: null, learnedField: null },
    flow: { dataset: 'spirals', points: [], progress: null, result: null, paths: null, decisionField: null, playing: false, playStart: 0 },
  };

  // ── Small utilities (same conventions as ode-explorer.js) ────────────
  function debounce(fn, wait) {
    let t = null;
    return function debounced(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
  }
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function showError(message) { errorBanner.textContent = message; errorBanner.classList.remove('is-hidden'); }
  function clearError() { errorBanner.textContent = ''; errorBanner.classList.add('is-hidden'); }
  function markFieldError(input, hasError) { input.classList.toggle('has-error', !!hasError); }

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

  // ── Chunked training driver — a few epochs per animation frame, so a
  //    run at the hard caps still can't freeze the tab. A run token lets
  //    a fresh "Train" click cleanly abandon an in-flight run. ──────────
  function runTraining(generator, { onProgress, onDone, onError, epochsPerFrame = 4 }) {
    const runId = ++state.trainRunId;
    function step() {
      if (runId !== state.trainRunId) return; // superseded by a newer run
      let result;
      try {
        for (let i = 0; i < epochsPerFrame; i++) {
          result = generator.next();
          if (result.done) break;
        }
      } catch (e) {
        onError(e);
        return;
      }
      if (result.done) { onDone(result.value); return; }
      onProgress(result.value);
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function freshSeed() { return Math.floor(Date.now() % 100000) + 1; }

  // ── Mode A: Fit a system ───────────────────────────────────────────
  function readFitBounds() {
    const xMin = parseFloat(fitXMin.value), xMax = parseFloat(fitXMax.value);
    const yMin = parseFloat(fitYMin.value), yMax = parseFloat(fitYMax.value);
    if (![xMin, xMax, yMin, yMax].every(Number.isFinite)) throw new Error('View bounds must all be numbers.');
    if (xMin >= xMax) throw new Error('x min must be less than x max.');
    if (yMin >= yMax) throw new Error('y min must be less than y max.');
    return { xMin, xMax, yMin, yMax };
  }

  function trainFit() {
    clearError();
    let bounds;
    try { bounds = readFitBounds(); } catch (e) { showError(e.message); return; }
    const errF = tryCompile(fitExprF.value, fitExprF);
    const errG = tryCompile(fitExprG.value, fitExprG);
    if (errF || errG) { showError([errF, errG].filter(Boolean).join(' — ')); return; }

    state.fit.bounds = bounds;
    trainFitBtn.disabled = true;
    trainFitBtn.textContent = 'Training…';

    let gen;
    try {
      gen = window.NeuralODE.fitVectorFieldGen(fitExprF.value, fitExprG.value, {
        ...bounds,
        samples: parseInt(fitSamplesInput.value, 10),
        noise: parseFloat(fitNoiseInput.value),
        seed: freshSeed(),
      });
    } catch (e) {
      showError(e.message);
      trainFitBtn.disabled = false; trainFitBtn.textContent = 'Train on sampled data';
      return;
    }

    runTraining(gen, {
      onProgress: (p) => { state.fit.progress = p; renderStatsPanel(); },
      onError: (e) => {
        showError(e.message || String(e));
        trainFitBtn.disabled = false; trainFitBtn.textContent = 'Train on sampled data';
      },
      onDone: (result) => {
        trainFitBtn.disabled = false; trainFitBtn.textContent = 'Train on sampled data';
        state.fit.result = result;
        state.fit.progress = null;
        if (result.blewUp) showError('Training diverged (weights blew up) — try fewer samples or less noise, then train again.');

        try {
          const f = window.ExprParser.compile(fitExprF.value, ['x', 'y']);
          const g = window.ExprParser.compile(fitExprG.value, ['x', 'y']);
          state.fit.trueField = window.NeuralODE.computeFieldGrid((x, y) => [f(x, y), g(x, y)], bounds, FIT_FIELD_GRID, FIT_FIELD_GRID);
        } catch (e) { state.fit.trueField = null; }

        try {
          state.fit.learnedField = window.NeuralODE.computeFieldGrid(result.predictFn, bounds, FIT_FIELD_GRID, FIT_FIELD_GRID);
        } catch (e) { state.fit.learnedField = null; }

        renderStatsPanel();
        draw();
      },
    });
  }

  // ── Mode B: Classify with a flow ──────────────────────────────────
  const DATASET_SEEDS = { spirals: 3, moons: 5, circles: 9 };

  function regenerateDataset(kind) {
    state.flow.dataset = kind;
    state.flow.points = window.NeuralODE.generateDataset(kind, {
      n: 140, noise: parseFloat(flowNoiseInput.value), seed: DATASET_SEEDS[kind] || 3,
    });
    state.flow.result = null;
    state.flow.paths = null;
    state.flow.decisionField = null;
    flowScrubGroup.classList.remove('is-visible');
    stopPlaying();
    renderStatsPanel();
    clearError();
    draw();
  }

  function trainFlow() {
    clearError();
    if (!state.flow.points.length) { showError('No dataset generated yet.'); return; }
    trainFlowBtn.disabled = true;
    trainFlowBtn.textContent = 'Training…';

    let gen;
    try {
      gen = window.NeuralODE.trainFlowClassifierGen(state.flow.points, { seed: freshSeed() });
    } catch (e) {
      showError(e.message);
      trainFlowBtn.disabled = false; trainFlowBtn.textContent = 'Train flow classifier';
      return;
    }

    runTraining(gen, {
      onProgress: (p) => { state.flow.progress = p; renderStatsPanel(); },
      onError: (e) => {
        showError(e.message || String(e));
        trainFlowBtn.disabled = false; trainFlowBtn.textContent = 'Train flow classifier';
      },
      onDone: (result) => {
        trainFlowBtn.disabled = false; trainFlowBtn.textContent = 'Train flow classifier';
        state.flow.result = result;
        state.flow.progress = null;
        if (result.blewUp) {
          showError('Training diverged — click Train again (it restarts from a fresh random seed) or lower the dataset noise.');
        } else {
          const flowOpts = { steps: result.steps, h: result.h, useTime: result.useTime };
          state.flow.paths = window.NeuralODE.integrateFlow(result.mlp, state.flow.points, flowOpts);
          if (showDecisionInput.checked) {
            try {
              state.flow.decisionField = window.NeuralODE.computeDecisionField(
                result.mlp, result.head, FLOW_BOUNDS, FLOW_DECISION_GRID, FLOW_DECISION_GRID, flowOpts
              );
            } catch (e) { state.flow.decisionField = null; }
          }
          flowScrubGroup.classList.add('is-visible');
          flowScrub.value = '1';
          flowScrubValue.textContent = 't = 1.00';
        }
        renderStatsPanel();
        draw();
      },
    });
  }

  function stopPlaying() {
    state.flow.playing = false;
    playFlowBtn.classList.remove('is-playing');
    playFlowBtn.textContent = '▶ Play flow';
  }

  function playFlow() {
    if (!state.flow.paths) return;
    state.flow.playing = true;
    playFlowBtn.classList.add('is-playing');
    playFlowBtn.textContent = '⏸ Pause';
    const durationMs = 1800;
    const startTime = performance.now();
    function frame(now) {
      if (!state.flow.playing) return;
      const t = Math.min(1, (now - startTime) / durationMs);
      flowScrub.value = String(t);
      flowScrubValue.textContent = `t = ${t.toFixed(2)}`;
      draw();
      if (t < 1) requestAnimationFrame(frame); else stopPlaying();
    }
    requestAnimationFrame(frame);
  }

  // ── Stats panel + loss sparkline ──────────────────────────────────
  function renderStatsPanel() {
    const d = state.mode === 'fit' ? state.fit : state.flow;
    const progress = d.progress;
    const result = d.result;
    statsPanel.classList.remove('is-hidden');
    statsList.innerHTML = '';

    const rows = [];
    if (progress) {
      rows.push(['Epoch', `${progress.epoch} / ${progress.epochs}`]);
      rows.push(['Loss', progress.loss.toFixed(5)]);
      if (progress.accuracy !== undefined) rows.push(['Accuracy', `${(progress.accuracy * 100).toFixed(1)}%`]);
    } else if (result) {
      rows.push(['Epochs run', String(result.lossHistory.length)]);
      rows.push(['Final loss', result.lossHistory[result.lossHistory.length - 1].toFixed(5)]);
      if (result.accHistory) rows.push(['Final accuracy', `${(result.accHistory[result.accHistory.length - 1] * 100).toFixed(1)}%`]);
      if (result.blewUp) rows.push(['Status', 'Diverged — retrain']);
    } else {
      rows.push(['Epoch', '–']);
      rows.push(['Loss', '–']);
    }
    rows.forEach(([label, value]) => {
      const li = document.createElement('li');
      li.className = 'stat-row' + (label === 'Status' ? ' is-warning' : '');
      li.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
      statsList.appendChild(li);
    });

    drawSparkline(result ? result.lossHistory : null);
  }

  function drawSparkline(lossHistory) {
    const dpr = window.devicePixelRatio || 1;
    const w = lossSparkline.clientWidth || 260, h = lossSparkline.clientHeight || 40;
    lossSparkline.width = w * dpr; lossSparkline.height = h * dpr;
    sparkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sparkCtx.clearRect(0, 0, w, h);
    if (!lossHistory || lossHistory.length < 2) return;
    const maxLoss = Math.max(...lossHistory), minLoss = Math.min(...lossHistory);
    const span = Math.max(1e-9, maxLoss - minLoss);
    sparkCtx.strokeStyle = cssVar('--accent', '#6366f1');
    sparkCtx.lineWidth = 1.5;
    sparkCtx.beginPath();
    lossHistory.forEach((v, i) => {
      const px = (i / (lossHistory.length - 1)) * w;
      const py = h - ((v - minLoss) / span) * (h - 4) - 2;
      if (i === 0) sparkCtx.moveTo(px, py); else sparkCtx.lineTo(px, py);
    });
    sparkCtx.stroke();
  }

  // ── Drawing ─────────────────────────────────────────────────────────
  function currentBounds() { return state.mode === 'fit' ? state.fit.bounds : FLOW_BOUNDS; }

  function mathToPixel(x, y) {
    const b = currentBounds();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return [((x - b.xMin) / (b.xMax - b.xMin)) * w, h - ((y - b.yMin) / (b.yMax - b.yMin)) * h];
  }
  function pixelToMath(px, py) {
    const b = currentBounds();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return [b.xMin + (px / w) * (b.xMax - b.xMin), b.yMin + ((h - py) / h) * (b.yMax - b.yMin)];
  }

  function drawArrow(x1, y1, x2, y2, headLen) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    if (!headLen) return;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 7), y2 - headLen * Math.sin(angle - Math.PI / 7));
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 7), y2 - headLen * Math.sin(angle + Math.PI / 7));
    ctx.stroke();
  }

  function drawFieldArrows(field, color, alpha, cols, rows) {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const segLen = Math.min(width / cols, height / rows) * 0.42;
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 1.3;
    field.points.forEach((p) => {
      if (!p.defined) return;
      const [cx, cy] = mathToPixel(p.x, p.y);
      const dx = (p.dirX * segLen) / 2, dy = -(p.dirY * segLen) / 2;
      drawArrow(cx - dx, cy - dy, cx + dx, cy + dy, 0);
    });
    ctx.globalAlpha = 1;
  }

  function draw() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const bgColor = cssVar('--card-bg', '#ffffff');
    const textColor = cssVar('--text-main', '#0f172a');
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    if (state.mode === 'fit') drawFitMode(width, height, textColor);
    else drawFlowMode(width, height, textColor);

    renderLegend();
  }

  function drawFitMode(width, height, textColor) {
    if (!state.fit.trueField && !state.fit.learnedField) {
      ctx.fillStyle = textColor; ctx.globalAlpha = 0.6; ctx.font = '14px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Train to see the true field (faint) vs. the learned field.', width / 2, height / 2);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      return;
    }
    if (state.fit.trueField) drawFieldArrows(state.fit.trueField, cssVar('--text-muted', '#64748b'), 0.35, FIT_FIELD_GRID, FIT_FIELD_GRID);
    if (state.fit.learnedField) drawFieldArrows(state.fit.learnedField, cssVar('--accent', '#6366f1'), 0.85, FIT_FIELD_GRID, FIT_FIELD_GRID);
    if (state.fit.result && state.fit.result.data) {
      ctx.fillStyle = cssVar('--accent-secondary', '#06b6d4');
      state.fit.result.data.forEach((d) => {
        const [px, py] = mathToPixel(d.x, d.y);
        ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  function drawFlowMode(width, height, textColor) {
    const t = parseFloat(flowScrub.value);
    const result = state.flow.result;

    // decision boundary background
    if (result && state.flow.decisionField && showDecisionInput.checked) {
      const cellW = width / FLOW_DECISION_GRID, cellH = height / FLOW_DECISION_GRID;
      state.flow.decisionField.forEach((cell) => {
        const [cx, cy] = mathToPixel(cell.x, cell.y);
        const blue = [99, 102, 241], red = [239, 68, 68];
        const mix = cell.prob;
        const r = Math.round(blue[0] * (1 - mix) + red[0] * mix);
        const g = Math.round(blue[1] * (1 - mix) + red[1] * mix);
        const bch = Math.round(blue[2] * (1 - mix) + red[2] * mix);
        ctx.fillStyle = `rgba(${r},${g},${bch},0.16)`;
        ctx.fillRect(cx - cellW / 2, cy - cellH / 2, cellW + 1, cellH + 1);
      });
    }

    if (!state.flow.points.length) {
      ctx.fillStyle = textColor; ctx.globalAlpha = 0.6; ctx.font = '14px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Pick a dataset to begin.', width / 2, height / 2);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      return;
    }

    const classColor = (label) => cssVar(label === 0 ? '--accent' : '--danger', label === 0 ? '#6366f1' : '#ef4444');

    // faint full trajectories once trained
    if (result && state.flow.paths) {
      state.flow.paths.forEach((path, i) => {
        ctx.strokeStyle = classColor(state.flow.points[i].label);
        ctx.globalAlpha = 0.15; ctx.lineWidth = 1;
        ctx.beginPath();
        path.forEach((p, k) => {
          const [px, py] = mathToPixel(p.x, p.y);
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // points at current scrub time
    state.flow.points.forEach((p, i) => {
      let pos = p;
      if (result && state.flow.paths) {
        const idx = Math.round(t * (state.flow.paths[i].length - 1));
        pos = state.flow.paths[i][idx];
      }
      const [px, py] = mathToPixel(pos.x, pos.y);
      ctx.beginPath();
      ctx.fillStyle = classColor(p.label);
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function renderLegend() {
    canvasLegend.innerHTML = '';
    const chips = [];
    if (state.mode === 'fit') {
      chips.push(['True field', cssVar('--text-muted', '#64748b')]);
      chips.push(['Learned field', cssVar('--accent', '#6366f1')]);
      if (state.fit.result) chips.push(['Sampled points', cssVar('--accent-secondary', '#06b6d4')]);
    } else {
      chips.push(['Class A', cssVar('--accent', '#6366f1')]);
      chips.push(['Class B', cssVar('--danger', '#ef4444')]);
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
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  if (window.ResizeObserver) new ResizeObserver(debounce(resizeCanvasBackingStore, 60)).observe(canvas);
  else window.addEventListener('resize', debounce(resizeCanvasBackingStore, 100));

  // ── Event wiring ────────────────────────────────────────────────────
  function setMode(mode) {
    state.mode = mode;
    modeFitBtn.classList.toggle('is-active', mode === 'fit');
    modeFitBtn.setAttribute('aria-checked', String(mode === 'fit'));
    modeFlowBtn.classList.toggle('is-active', mode === 'flow');
    modeFlowBtn.setAttribute('aria-checked', String(mode === 'flow'));
    fitFields.classList.toggle('is-hidden', mode !== 'fit');
    flowFields.classList.toggle('is-hidden', mode !== 'flow');
    clearError();
    renderStatsPanel();
    draw();
  }
  modeFitBtn.addEventListener('click', () => setMode('fit'));
  modeFlowBtn.addEventListener('click', () => setMode('flow'));

  document.querySelectorAll('#fitFields .preset-chip[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = SYSTEM_PRESETS[btn.dataset.preset];
      if (!preset) return;
      fitExprF.value = preset.f; fitExprG.value = preset.g;
    });
  });

  fitSamplesInput.addEventListener('input', () => { fitSamplesValue.textContent = fitSamplesInput.value; });
  fitNoiseInput.addEventListener('input', () => { fitNoiseValue.textContent = parseFloat(fitNoiseInput.value).toFixed(2); });
  trainFitBtn.addEventListener('click', trainFit);

  document.querySelectorAll('#flowFields .preset-chip[data-dataset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#flowFields .preset-chip[data-dataset]').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      regenerateDataset(btn.dataset.dataset);
    });
  });
  flowNoiseInput.addEventListener('input', () => {
    flowNoiseValue.textContent = parseFloat(flowNoiseInput.value).toFixed(2);
  });
  flowNoiseInput.addEventListener('change', () => regenerateDataset(state.flow.dataset));
  showDecisionInput.addEventListener('change', draw);
  trainFlowBtn.addEventListener('click', trainFlow);
  flowScrub.addEventListener('input', () => {
    stopPlaying();
    flowScrubValue.textContent = `t = ${parseFloat(flowScrub.value).toFixed(2)}`;
    draw();
  });
  playFlowBtn.addEventListener('click', () => {
    if (state.flow.playing) stopPlaying(); else playFlow();
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
  fitSamplesValue.textContent = fitSamplesInput.value;
  fitNoiseValue.textContent = parseFloat(fitNoiseInput.value).toFixed(2);
  flowNoiseValue.textContent = parseFloat(flowNoiseInput.value).toFixed(2);
  regenerateDataset('spirals');
  resizeCanvasBackingStore();
  renderStatsPanel();
  draw();
})();
