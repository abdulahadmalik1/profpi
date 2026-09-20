// profpi — Neural Network Explorer: UI + rendering
// Depends on neural-core.js (NNCore) being loaded first.

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // ── Shared header behavior (nav toggle + theme toggle) ───────────────
  // Tool pages don't load home.js, so each tool page owns this itself —
  // same IDs/behavior as the rest of the site.
  (function headerSetup() {
    const navToggle = document.getElementById('nav-toggle');
    const siteNav = document.getElementById('site-nav');
    if (navToggle && siteNav) {
      navToggle.addEventListener('click', () => {
        const isOpen = siteNav.classList.toggle('open');
        navToggle.setAttribute('aria-expanded', String(isOpen));
      });
      siteNav.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
          siteNav.classList.remove('open');
          navToggle.setAttribute('aria-expanded', 'false');
        });
      });
    }

    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        requestRender();
      });
    }
  })();

  // ── DOM refs ───────────────────────────────────────────────────────
  const datasetChips = document.getElementById('datasetChips');
  const noiseInput = document.getElementById('noiseInput');
  const noiseValue = document.getElementById('noiseValue');
  const hiddenLayersEditor = document.getElementById('hiddenLayersEditor');
  const addLayerBtn = document.getElementById('addLayerBtn');
  const activationSelect = document.getElementById('activationSelect');
  const lrSelect = document.getElementById('lrSelect');
  const speedInput = document.getElementById('speedInput');
  const speedValue = document.getElementById('speedValue');
  const showGradientsCheckbox = document.getElementById('showGradientsCheckbox');
  const playPauseBtn = document.getElementById('playPauseBtn');
  const stepBtn = document.getElementById('stepBtn');
  const resetBtn = document.getElementById('resetBtn');
  const statusBadge = document.getElementById('statusBadge');
  const errorBanner = document.getElementById('errorBanner');
  const boundaryCanvas = document.getElementById('boundaryCanvas');
  const networkCanvas = document.getElementById('networkCanvas');
  const lossCanvas = document.getElementById('lossCanvas');
  const probeStatus = document.getElementById('probeStatus');
  const probeInspector = document.getElementById('probeInspector');

  // ── State ──────────────────────────────────────────────────────────
  const DOMAIN = 1.3; // data coords roughly in [-DOMAIN, DOMAIN]
  const N_POINTS = 180;

  const state = {
    datasetType: 'circle',
    noise: 10,
    hiddenLayers: [4, 4],
    activation: 'tanh',
    lr: 0.3,
    speed: 8,
    showGradients: false,
    data: [],
    net: null,
    epoch: 0,
    lastLoss: 0,
    lossHistory: [],
    probe: { x: 0, y: 0, label: null, sampleIndex: null },
    inspectedNode: null,
    nodePositions: [],
    playing: false,
    intervalId: null,
  };

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function colors() {
    return {
      accent: cssVar('--accent', '#6366f1'),
      class0: '#f59e0b',
      class1: cssVar('--accent', '#6366f1'),
      text: cssVar('--text-main', '#0f172a'),
      textMuted: cssVar('--text-muted', '#64748b'),
      border: cssVar('--border-color', '#e2e8f0'),
      cardBg: cssVar('--card-bg', '#ffffff'),
      danger: cssVar('--danger', '#ef4444'),
    };
  }

  // ── Dataset + network lifecycle ───────────────────────────────────
  function regenerateDataset(resetProbe) {
    state.data = NNCore.generateDataset(state.datasetType, N_POINTS, state.noise);
    if (resetProbe !== false) {
      state.probe = { x: state.data[0].x, y: state.data[0].y, label: state.data[0].label, sampleIndex: 0 };
    }
  }

    function rebuildNetwork() {
    const sizes = [2, ...state.hiddenLayers, 1];
    state.net = new NNCore.Network(sizes, state.activation);
    state.epoch = 0;
    state.lossHistory = [];
    state.lastLoss = state.net.meanLoss(state.data);
    state.inspectedNode = { layer: sizes.length - 1, index: 0 };
    hideError();
    if (typeof updateAdvancedStateText === 'function') {
      updateAdvancedStateText();
    }
  }

  function fullReset() {
    pauseTraining();
    regenerateDataset(true);
    rebuildNetwork();
    requestRender();
  }

  // ── Training loop ─────────────────────────────────────────────────
  function trainingTick() {
    const loss = state.net.trainStep(state.data, state.lr);
    state.epoch += 1;
    if (!isFinite(loss) || Number.isNaN(loss)) {
      pauseTraining();
      showError('The loss diverged (blew up to NaN/Infinity). Try a smaller learning rate, then Reset.');
      return;
    }
    state.lastLoss = loss;
    state.lossHistory.push(loss);
    if (state.lossHistory.length > 400) state.lossHistory.shift();
    requestRender();
  }

  function playTraining() {
    if (state.playing) return;
    state.playing = true;
    playPauseBtn.textContent = 'Pause';
    const delay = Math.max(20, 1000 / state.speed);
    state.intervalId = setInterval(trainingTick, delay);
  }

  function pauseTraining() {
    state.playing = false;
    playPauseBtn.textContent = 'Play';
    if (state.intervalId) clearInterval(state.intervalId);
    state.intervalId = null;
  }

  function toggleTraining() {
    if (state.playing) pauseTraining();
    else playTraining();
  }

  function stepTraining() {
    pauseTraining();
    trainingTick();
  }

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.classList.remove('is-hidden');
  }
  function hideError() {
    errorBanner.classList.add('is-hidden');
  }

  // ── Coordinate mapping (data space <-> canvas CSS pixels) ─────────
  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function dataToPx(x, y, w, h) {
    const scaleX = w / (2 * DOMAIN);
    const scaleY = h / (2 * DOMAIN);
    return { x: w / 2 + x * scaleX, y: h / 2 - y * scaleY };
  }

  function pxToData(px, py, w, h) {
    const scaleX = w / (2 * DOMAIN);
    const scaleY = h / (2 * DOMAIN);
    return { x: (px - w / 2) / scaleX, y: (h / 2 - py) / scaleY };
  }

  // ── Rendering: decision boundary ──────────────────────────────────
  function probColor(p, c) {
    // p = predicted probability of class 1. Diverging: class0 <- white -> class1
    const t = Math.abs(p - 0.5) * 2;
    const base = p >= 0.5 ? hexToRgb(c.class1) : hexToRgb(c.class0);
    const r = Math.round(255 + (base.r - 255) * t);
    const g = Math.round(255 + (base.g - 255) * t);
    const b = Math.round(255 + (base.b - 255) * t);
    return `rgb(${r},${g},${b})`;
  }

  function hexToRgb(color) {
    const c = (color || '').trim();
    const rgbMatch = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgbMatch) {
      return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
    }
    const hex = c.replace('#', '');
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      const full = hex.split('').map((ch) => ch + ch).join('');
      const bigint = parseInt(full, 16);
      return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
    }
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      const bigint = parseInt(hex, 16);
      return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
    }
    return { r: 99, g: 102, b: 241 }; // safe fallback: indigo
  }

  function drawBoundary() {
    const { ctx, w, h } = fitCanvas(boundaryCanvas);
    const c = colors();
    const res = 42;
    const cellW = w / res;
    const cellH = h / res;
    for (let gx = 0; gx < res; gx++) {
      for (let gy = 0; gy < res; gy++) {
        const px = (gx + 0.5) * cellW;
        const py = (gy + 0.5) * cellH;
        const { x, y } = pxToData(px, py, w, h);
        const p = state.net.predict(x, y);
        ctx.fillStyle = probColor(p, c);
        ctx.fillRect(gx * cellW - 0.5, gy * cellH - 0.5, cellW + 1, cellH + 1);
      }
    }

    // axes
    const origin = dataToPx(0, 0, w, h);
    ctx.strokeStyle = 'rgba(15,23,42,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, origin.y); ctx.lineTo(w, origin.y);
    ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, h);
    ctx.stroke();

    // data points
    state.data.forEach((pt) => {
      const p = dataToPx(pt.x, pt.y, w, h);
      ctx.beginPath();
      ctx.fillStyle = pt.label === 1 ? c.class1 : c.class0;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.2;
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // probe marker
    const pp = dataToPx(state.probe.x, state.probe.y, w, h);
    ctx.beginPath();
    ctx.arc(pp.x, pp.y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pp.x, pp.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  // ── Rendering: network diagram ─────────────────────────────────────
  function drawNetwork(probeForward, probeBackward) {
    const { ctx, w, h } = fitCanvas(networkCanvas);
    const c = colors();
    const sizes = state.net.layerSizes;
    const numLayers = sizes.length;
    const marginX = 46;
    const marginY = 26;
    const usableW = w - marginX * 2;

    const positions = [];
    for (let l = 0; l < numLayers; l++) {
      const n = sizes[l];
      const x = numLayers === 1 ? w / 2 : marginX + (usableW * l) / (numLayers - 1);
      const spacing = (h - marginY * 2) / (n + 1);
      const layerPositions = [];
      for (let i = 0; i < n; i++) layerPositions.push({ x, y: marginY + spacing * (i + 1) });
      positions.push(layerPositions);
    }
    state.nodePositions = positions;

    // edges
    for (let l = 0; l < numLayers - 1; l++) {
      const W = state.net.weights[l];
      for (let j = 0; j < W.length; j++) {
        for (let i = 0; i < W[j].length; i++) {
          const wv = W[j][i];
          const p0 = positions[l][i];
          const p1 = positions[l + 1][j];
          const t = Math.min(Math.abs(wv) / 3, 1);
          const rgb = wv >= 0 ? hexToRgb(c.class1) : hexToRgb(c.class0);
          // Increase base opacity to 0.3 for better visibility in both modes
          ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${0.4 + 0.6 * t})`;
          // Increase base line width from 0.6 to 1.2
          ctx.lineWidth = 1.2 + t * 3.5;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
      }
    }

    // nodes
    for (let l = 0; l < numLayers; l++) {
      for (let i = 0; i < sizes[l]; i++) {
        const p = positions[l][i];
        const aVal = probeForward.as[l][i];
        const r = 15;
        const isSelected = state.inspectedNode && state.inspectedNode.layer === l && state.inspectedNode.index === i;

        const t = Math.min(Math.abs(aVal), 1);
        const rgb = aVal >= 0 ? hexToRgb(c.class1) : hexToRgb(c.class0);
        const bgRgb = hexToRgb(c.cardBg);
        const fr = Math.round(bgRgb.r + (rgb.r - bgRgb.r) * t);
        const fg = Math.round(bgRgb.g + (rgb.g - bgRgb.g) * t);
        const fb = Math.round(bgRgb.b + (rgb.b - bgRgb.b) * t);

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${fr},${fg},${fb})`;
        ctx.fill();
        ctx.lineWidth = isSelected ? 2.6 : 1.4;
        ctx.strokeStyle = isSelected ? c.accent : 'rgba(15,23,42,0.28)';
        ctx.stroke();

        const L = 0.299 * fr + 0.587 * fg + 0.114 * fb;
        ctx.fillStyle = L > 140 ? '#0f172a' : '#f8fafc';
        ctx.font = '600 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(aVal.toFixed(2), p.x, p.y);

        if (state.showGradients && probeBackward && l > 0) {
          ctx.fillStyle = c.textMuted;
          ctx.font = '600 9px SFMono-Regular, Menlo, monospace';
          ctx.fillText('δ' + probeBackward.deltas[l][i].toFixed(2), p.x, p.y + r + 11);
        }
      }
    }
  }

  // ── Rendering: loss chart ───────────────────────────────────────────
  function drawLossChart() {
    const { ctx, w, h } = fitCanvas(lossCanvas);
    const c = colors();
    const hist = state.lossHistory;
    if (hist.length < 2) {
      ctx.fillStyle = c.textMuted;
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Press Play or Step to start training', w / 2, h / 2);
      return;
    }
    const maxLoss = Math.max(...hist, 0.05);
    ctx.strokeStyle = 'rgba(15,23,42,0.1)';
    ctx.lineWidth = 1;
    for (let gy = 0; gy <= 4; gy++) {
      const y = 8 + ((h - 16) * gy) / 4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.beginPath();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    hist.forEach((loss, i) => {
      const x = (i / (hist.length - 1)) * w;
      const y = h - 8 - (loss / maxLoss) * (h - 16);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = c.textMuted;
    ctx.font = '11px SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('max ' + maxLoss.toFixed(2), 6, 6);
  }

  // ── Probe inspector ─────────────────────────────────────────────────
  function computeProbe() {
    const forward = state.net.forward([state.probe.x, state.probe.y]);
    let backward = null;
    if (state.probe.label !== null) {
      backward = state.net.backwardSingle([state.probe.x, state.probe.y], state.probe.label);
    }
    return { forward, backward };
  }

  function renderProbeStatus() {
    if (state.probe.sampleIndex !== null) {
      probeStatus.innerHTML = `Probing training point <strong>#${state.probe.sampleIndex + 1}</strong> — true class <strong>${state.probe.label}</strong>`;
    } else {
      probeStatus.innerHTML = `Probing point <strong>(${state.probe.x.toFixed(2)}, ${state.probe.y.toFixed(2)})</strong> — not a training point, no ground truth`;
    }
  }

  function renderInspector(forward, backward) {
    const node = state.inspectedNode;
    const numLayers = state.net.layerSizes.length;
    const isInput = node.layer === 0;
    const isOutput = node.layer === numLayers - 1;
    const aVal = forward.as[node.layer][node.index];

    let rows = '';
    rows += row('Layer', isInput ? 'Input' : isOutput ? 'Output' : `Hidden ${node.layer}`);
    rows += row('Neuron', '#' + (node.index + 1));
    if (!isInput) {
      rows += row('Weighted sum  Σ(w·x) + b', forward.zs[node.layer][node.index].toFixed(4));
    }
    rows += row(isInput ? 'Input value' : 'Activation output  a', aVal.toFixed(4));
    if (isOutput) {
      rows += row('Predicted class', (aVal >= 0.5 ? 'Class 1' : 'Class 0') + `  (${(aVal * 100).toFixed(1)}%)`);
    }

    let extra = '';
    if (backward) {
      let brows = '';
      brows += row('Sample loss (cross-entropy)', backward.loss.toFixed(4));
      if (!isInput) {
        brows += row('δ = ∂Loss/∂z', backward.deltas[node.layer][node.index].toFixed(4));
        const gW = backward.gradW[node.layer - 1][node.index];
        const gB = backward.gradB[node.layer - 1][node.index];
        brows += row('∂Loss/∂bias', gB.toFixed(4));
        extra = `<div class="probe-divider"></div>${brows}<div class="probe-weights-label">Incoming weight gradients (∂Loss/∂w)</div><div class="probe-weights-list">${gW.map((g, i) => `<div class="probe-weight-item"><span>w${i + 1}</span><strong>${g.toFixed(4)}</strong></div>`).join('')}</div>`;
      } else {
        extra = `<div class="probe-divider"></div>${brows}`;
      }
    } else if (!isInput) {
      extra = `<div class="probe-hint">Pick a training point (a filled dot, not empty space) on the plot to see its error and gradients here.</div>`;
    }

    probeInspector.innerHTML = rows + extra;
  }

  function row(label, value) {
    return `<div class="probe-row"><span>${label}</span><strong>${value}</strong></div>`;
  }

  // ── Status badge ─────────────────────────────────────────────────────
  function renderStatus() {
    const acc = state.net.accuracy(state.data);
    statusBadge.innerHTML = `Epoch <strong>${state.epoch}</strong> &nbsp;·&nbsp; Loss <strong>${state.lastLoss.toFixed(4)}</strong> &nbsp;·&nbsp; Accuracy <strong>${(acc * 100).toFixed(1)}%</strong>`;
  }

  // ── Master render ─────────────────────────────────────────────────
  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderAll();
    });
  }

  function renderAll() {
    if (!state.net) return;
    const { forward, backward } = computeProbe();
    drawBoundary();
    drawNetwork(forward, backward);
    drawLossChart();
    renderProbeStatus();
    renderInspector(forward, backward);
    renderStatus();
  }

  // ── Architecture editor ─────────────────────────────────────────────
  function renderLayerEditor() {
    hiddenLayersEditor.innerHTML = '';
    state.hiddenLayers.forEach((count, idx) => {
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.innerHTML = `
        <span class="layer-row-label">Hidden ${idx + 1}</span>
        <div class="stepper">
          <button type="button" class="stepper-btn" data-action="dec" data-layer="${idx}" aria-label="Fewer neurons">−</button>
          <span class="stepper-value">${count}</span>
          <button type="button" class="stepper-btn" data-action="inc" data-layer="${idx}" aria-label="More neurons">+</button>
        </div>
        <button type="button" class="layer-remove" data-action="remove" data-layer="${idx}" ${state.hiddenLayers.length <= 1 ? 'disabled' : ''} aria-label="Remove layer">×</button>`;
      hiddenLayersEditor.appendChild(row);
    });
    addLayerBtn.disabled = state.hiddenLayers.length >= 3;
  }

  hiddenLayersEditor.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const layerIdx = Number(btn.dataset.layer);
    const action = btn.dataset.action;
    if (action === 'inc') state.hiddenLayers[layerIdx] = Math.min(8, state.hiddenLayers[layerIdx] + 1);
    else if (action === 'dec') state.hiddenLayers[layerIdx] = Math.max(1, state.hiddenLayers[layerIdx] - 1);
    else if (action === 'remove' && state.hiddenLayers.length > 1) state.hiddenLayers.splice(layerIdx, 1);
    renderLayerEditor();
    pauseTraining();
    rebuildNetwork();
    requestRender();
  });

  addLayerBtn.addEventListener('click', () => {
    if (state.hiddenLayers.length >= 3) return;
    state.hiddenLayers.push(4);
    renderLayerEditor();
    pauseTraining();
    rebuildNetwork();
    requestRender();
  });

  // ── Wire up remaining controls ──────────────────────────────────────
  datasetChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.preset-chip');
    if (!chip) return;
    datasetChips.querySelectorAll('.preset-chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    state.datasetType = chip.dataset.dataset;
    fullReset();
  });

  noiseInput.addEventListener('input', () => {
    state.noise = Number(noiseInput.value);
    noiseValue.textContent = state.noise + '%';
    regenerateDataset(false);
    requestRender();
  });

  activationSelect.addEventListener('change', () => {
    state.activation = activationSelect.value;
    pauseTraining();
    rebuildNetwork();
    requestRender();
  });

  lrSelect.addEventListener('change', () => {
    state.lr = Number(lrSelect.value);
  });

  speedInput.addEventListener('input', () => {
    state.speed = Number(speedInput.value);
    speedValue.textContent = state.speed + '/s';
    if (state.playing) { pauseTraining(); playTraining(); }
  });

  showGradientsCheckbox.addEventListener('change', () => {
    state.showGradients = showGradientsCheckbox.checked;
    requestRender();
  });

  playPauseBtn.addEventListener('click', toggleTraining);
  stepBtn.addEventListener('click', stepTraining);
  resetBtn.addEventListener('click', fullReset);

  boundaryCanvas.addEventListener('click', (e) => {
    const rect = boundaryCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { x, y } = pxToData(mx, my, rect.width, rect.height);
    let nearestIdx = -1, bestDist = Infinity;
    state.data.forEach((p, idx) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) { bestDist = d; nearestIdx = idx; }
    });
    if (nearestIdx >= 0 && bestDist < 0.07) {
      const p = state.data[nearestIdx];
      state.probe = { x: p.x, y: p.y, label: p.label, sampleIndex: nearestIdx };
    } else {
      state.probe = { x: NNCore.clamp(x, -1.2, 1.2), y: NNCore.clamp(y, -1.2, 1.2), label: null, sampleIndex: null };
    }
    requestRender();
  });

  networkCanvas.addEventListener('click', (e) => {
    const rect = networkCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let found = null;
    let bestDist = 22;
    state.nodePositions.forEach((layerPositions, l) => {
      layerPositions.forEach((p, i) => {
        const d = Math.hypot(p.x - mx, p.y - my);
        if (d < bestDist) { bestDist = d; found = { layer: l, index: i }; }
      });
    });
    if (found) {
      state.inspectedNode = found;
      requestRender();
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(requestRender, 80);
  });


  // ── Advanced Mode ────────────────────────────────────────────────
  const advancedStateInput = document.getElementById('advancedStateInput');
  const advancedApplyBtn = document.getElementById('advancedApplyBtn');
  const advancedFormatBtn = document.getElementById('advancedFormatBtn');
  const advancedError = document.getElementById('advancedError');

  const advLayerSelect = document.getElementById('advLayerSelect');
  const advNeuronSelect = document.getElementById('advNeuronSelect');
  const advInputsContainer = document.getElementById('advInputsContainer');
  
    function updateAdvancedStateText() {
    const errorBanner = document.getElementById('errorBanner');
    try {
      if (!state) {
        throw new Error("global state is undefined!");
      }
      if (!state.net) {
        throw new Error("state.net is null/undefined!");
      }
      if (!advLayerSelect) {
        throw new Error("advLayerSelect element is null!");
      }
      if (!state.net.weights) {
        throw new Error("state.net.weights is null/undefined!");
      }
      if (state.net.weights.length === 0) {
        throw new Error("state.net.weights has 0 length!");
      }

      // Save current selection to restore if possible
      const curLayer = advLayerSelect.value;
      const curNeuron = advNeuronSelect.value;
      
      advLayerSelect.innerHTML = '';
      for (let l = 0; l < state.net.weights.length; l++) {
        const opt = document.createElement('option');
        opt.value = l;
        opt.textContent = `Hidden Layer ${l + 1}`;
        if (l === state.net.weights.length - 1) opt.textContent = 'Output Layer';
        advLayerSelect.appendChild(opt);
      }
      
      if (curLayer && Number(curLayer) < state.net.weights.length) {
        advLayerSelect.value = curLayer;
      }
      
      updateAdvNeuronDropdown(curNeuron);
    } catch (err) {
      if (errorBanner) {
        errorBanner.textContent = "Advanced Mode Error: " + err.message + "\n" + err.stack;
        errorBanner.classList.remove('is-hidden');
        errorBanner.style.display = 'block';
      } else {
        alert("Error: " + err.message);
      }
    }
  }
  
  function updateAdvNeuronDropdown(restoreNeuron) {
    if (!advNeuronSelect) return;
    advNeuronSelect.innerHTML = '';
    const l = Number(advLayerSelect.value);
    if (isNaN(l) || !state.net.weights[l]) return;
    
    for (let i = 0; i < state.net.weights[l].length; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `Neuron ${i + 1}`;
      advNeuronSelect.appendChild(opt);
    }
    
    if (restoreNeuron && Number(restoreNeuron) < state.net.weights[l].length) {
      advNeuronSelect.value = restoreNeuron;
    }
    
    renderAdvInputs();
  }
  
  function renderAdvInputs() {
    if (!advInputsContainer) return;
    advInputsContainer.innerHTML = '';
    const l = Number(advLayerSelect.value);
    const n = Number(advNeuronSelect.value);
    if (isNaN(l) || isNaN(n) || !state.net.weights[l] || !state.net.weights[l][n]) return;
    
    const wArr = state.net.weights[l][n];
    const b = state.net.biases[l][n];
    
    // Bias input
    advInputsContainer.insertAdjacentHTML('beforeend', `
      <label style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
        <span>Bias</span>
        <input type="number" step="0.01" class="adv-bias" value="${b.toFixed(4)}" style="width: 80px; padding: 2px 4px; background: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--radius-sm);">
      </label>
    `);
    
    // Weight inputs
    for (let i = 0; i < wArr.length; i++) {
      let srcName = l === 0 ? (i === 0 ? 'Input X' : 'Input Y') : `L${l} Neuron ${i + 1}`;
      advInputsContainer.insertAdjacentHTML('beforeend', `
        <label style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
          <span>Weight from ${srcName}</span>
          <input type="number" step="0.01" class="adv-weight" data-idx="${i}" value="${wArr[i].toFixed(4)}" style="width: 80px; padding: 2px 4px; background: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-main); border-radius: var(--radius-sm);">
        </label>
      `);
    }
  }

  if (advancedApplyBtn) {
    if (advLayerSelect) advLayerSelect.addEventListener('change', () => updateAdvNeuronDropdown());
    if (advNeuronSelect) advNeuronSelect.addEventListener('change', renderAdvInputs);

    advancedApplyBtn.addEventListener('click', () => {
      try {
        advancedError.style.display = 'none';
        const l = Number(advLayerSelect.value);
        const n = Number(advNeuronSelect.value);
        
        const biasInput = advInputsContainer.querySelector('.adv-bias');
        if (biasInput) state.net.biases[l][n] = Number(biasInput.value);
        
        const weightInputs = advInputsContainer.querySelectorAll('.adv-weight');
        weightInputs.forEach(inp => {
          const idx = Number(inp.getAttribute('data-idx'));
          state.net.weights[l][n][idx] = Number(inp.value);
        });
        
        state.epoch = 0;
        state.lossHistory = [];
        state.lastLoss = state.net.meanLoss(state.data);
        requestRender();
      } catch (err) {
        advancedError.textContent = err.message;
        advancedError.style.display = 'block';
      }
    });

    const advPanel = document.getElementById('advancedPanel');
    const advToggle = document.getElementById('advancedToggle');
    if (advToggle && advPanel) {
      advToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isCurrentlyHidden = advPanel.classList.contains('is-hidden');
        if (isCurrentlyHidden) {
          advPanel.classList.remove('is-hidden');
          advToggle.style.transform = 'rotate(180deg)';
          updateAdvancedStateText();
        } else {
          advPanel.classList.add('is-hidden');
          advToggle.style.transform = 'rotate(0deg)';
        }
      });
    }
  }

  // ── Init ─────────────────────────────────────────────────────────
  noiseValue.textContent = state.noise + '%';
  speedValue.textContent = state.speed + '/s';
  renderLayerEditor();
  regenerateDataset(true);
  rebuildNetwork();
  requestRender();

  // Stylesheets can finish applying after DOMContentLoaded, which would
  // leave the canvases measured at the wrong size on first paint.
  window.addEventListener('load', requestRender);
  setTimeout(requestRender, 200);
});