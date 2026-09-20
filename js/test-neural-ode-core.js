// Numerical gradient check for neural-ode-core.js's forward/backward,
// and an end-to-end sanity check that both training generators actually
// reduce loss on toy problems, before shipping.
const fs = require('fs');
// expr-parser.js is required by neural-ode-core.js via require('./expr-parser.js')
// relative to itself, so just make sure it's present alongside.
const NeuralODE = require('./neural-ode-core.js');

function approxEqual(a, b, tol) { return Math.abs(a - b) < tol; }

// ── 1. Gradient check on a single MLP forward/backward ─────────────────
(function gradCheckMLP() {
  const mlp = NeuralODE.createMLP([3, 5, 4, 2], 123);
  const input = [0.3, -0.7, 0.2];
  const { output, cache } = NeuralODE.forward(mlp, input);
  const dOutput = [1.3, -0.6]; // arbitrary upstream gradient
  NeuralODE.zeroGrad(mlp);
  const dInput = NeuralODE.backward(mlp, cache, dOutput);

  const loss = (out) => out[0] * dOutput[0] + out[1] * dOutput[1]; // linear "loss" whose true gradient IS dOutput

  const eps = 1e-5;
  let maxErr = 0;

  // check dInput via finite differences
  for (let i = 0; i < input.length; i++) {
    const plus = input.slice(); plus[i] += eps;
    const minus = input.slice(); minus[i] -= eps;
    const lp = loss(NeuralODE.forward(mlp, plus).output);
    const lm = loss(NeuralODE.forward(mlp, minus).output);
    const numeric = (lp - lm) / (2 * eps);
    maxErr = Math.max(maxErr, Math.abs(numeric - dInput[i]));
  }

  // check a handful of weight gradients via finite differences
  let checked = 0;
  for (let l = 0; l < mlp.layers.length && checked < 15; l++) {
    const layer = mlp.layers[l];
    for (let o = 0; o < layer.W.length && checked < 15; o++) {
      for (let i = 0; i < layer.W[o].length && checked < 15; i++) {
        const orig = layer.W[o][i];
        layer.W[o][i] = orig + eps;
        const lp = loss(NeuralODE.forward(mlp, input).output);
        layer.W[o][i] = orig - eps;
        const lm = loss(NeuralODE.forward(mlp, input).output);
        layer.W[o][i] = orig;
        const numeric = (lp - lm) / (2 * eps);
        maxErr = Math.max(maxErr, Math.abs(numeric - layer.gradW[o][i]));
        checked++;
      }
    }
  }

  console.log(`[gradCheckMLP] max abs error vs finite-difference: ${maxErr.toExponential(3)} (should be < 1e-6)`);
  if (maxErr > 1e-6) { console.error('GRADIENT CHECK FAILED'); process.exit(1); }
})();

// ── 2. Gradient check through the full BPTT unroll used in Mode B ──────
(function gradCheckFlow() {
  // Build one unrolled forward+backward pass exactly like
  // trainFlowClassifierGen's inner loop, and finite-difference-check the
  // resulting weight gradients directly (most sensitive place for a
  // sign/indexing error in the tied-weight backprop).
  const mlp = NeuralODE.createMLP([3, 6, 6, 2], 7);
  const head = { w: [0.4, -0.3], b: 0.1 };
  const steps = 5, h = 0.2, useTime = true;
  const point = { x: 0.6, y: -0.4, label: 1 };

  function runLoss(mlpLocal) {
    let z = [point.x, point.y];
    const stepCache = [];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const input = useTime ? [z[0], z[1], t] : [z[0], z[1]];
      const { output: dz, cache } = NeuralODE.forward(mlpLocal, input);
      stepCache.push(cache);
      z = [z[0] + h * dz[0], z[1] + h * dz[1]];
    }
    const score = head.w[0] * z[0] + head.w[1] * z[1] + head.b;
    const prob = 1 / (1 + Math.exp(-score));
    const loss = -(point.label * Math.log(prob + 1e-7) + (1 - point.label) * Math.log(1 - prob + 1e-7));
    return { loss, z, stepCache, prob };
  }

  const { z, stepCache, prob } = runLoss(mlp);
  NeuralODE.zeroGrad(mlp);
  const dScore = prob - point.label;
  let dz = [head.w[0] * dScore, head.w[1] * dScore];
  for (let k = steps - 1; k >= 0; k--) {
    const dOutput = [h * dz[0], h * dz[1]];
    const dInput = NeuralODE.backward(mlp, stepCache[k], dOutput);
    dz = [dz[0] + dInput[0], dz[1] + dInput[1]];
  }

  const eps = 1e-5;
  let maxErr = 0, checked = 0;
  for (let l = 0; l < mlp.layers.length && checked < 20; l++) {
    const layer = mlp.layers[l];
    for (let o = 0; o < layer.W.length && checked < 20; o++) {
      for (let i = 0; i < layer.W[o].length && checked < 20; i++) {
        const orig = layer.W[o][i];
        layer.W[o][i] = orig + eps;
        const lp = runLoss(mlp).loss;
        layer.W[o][i] = orig - eps;
        const lm = runLoss(mlp).loss;
        layer.W[o][i] = orig;
        const numeric = (lp - lm) / (2 * eps);
        maxErr = Math.max(maxErr, Math.abs(numeric - layer.gradW[o][i]));
        checked++;
      }
    }
  }
  console.log(`[gradCheckFlow/BPTT] max abs error vs finite-difference: ${maxErr.toExponential(3)} (should be < 1e-5)`);
  if (maxErr > 1e-5) { console.error('BPTT GRADIENT CHECK FAILED'); process.exit(1); }
})();

// ── 3. End-to-end: does Mode A actually fit a known system? ────────────
(function trainModeA() {
  let result;
  const gen = NeuralODE.fitVectorFieldGen('x - y', '-x - y', {
    xMin: -2, xMax: 2, yMin: -2, yMax: 2, samples: 80, noise: 0, hidden: 12, epochs: 120, lr: 0.08, seed: 1,
  });
  let last;
  while (!(last = gen.next()).done) {}
  result = last.value;
  const firstLoss = result.lossHistory[0];
  const lastLoss = result.lossHistory[result.lossHistory.length - 1];
  console.log(`[Mode A] blewUp=${result.blewUp} firstLoss=${firstLoss.toFixed(4)} lastLoss=${lastLoss.toFixed(6)}`);
  if (result.blewUp || !(lastLoss < firstLoss * 0.05)) { console.error('MODE A DID NOT CONVERGE AS EXPECTED'); process.exit(1); }
  // spot check the learned field against the true field at a fresh point
  const [px, py] = [0.5, -1.1];
  const [predDx, predDy] = result.predictFn(px, py);
  const trueDx = px - py, trueDy = -px - py;
  console.log(`[Mode A] at (${px},${py}): predicted=(${predDx.toFixed(2)},${predDy.toFixed(2)}) true=(${trueDx},${trueDy})`);
})();

// ── 4. End-to-end: does Mode B separate the shipped presets using pure
//    library defaults (this is what the page will actually call)? ──────
(function trainModeB() {
  ['spirals', 'moons', 'circles'].forEach((kind) => {
    const points = NeuralODE.generateDataset(kind, { n: 80, noise: 0.06, seed: 11 });
    const gen = NeuralODE.trainFlowClassifierGen(points, { seed: 11 }); // defaults only
    let last;
    while (!(last = gen.next()).done) {}
    const result = last.value;
    const firstAcc = result.accHistory[0];
    const lastAcc = result.accHistory[result.accHistory.length - 1];
    console.log(`[Mode B/${kind}] blewUp=${result.blewUp} firstAcc=${firstAcc.toFixed(2)} lastAcc=${lastAcc.toFixed(2)}`);
    if (result.blewUp || lastAcc < 0.75) { console.error(`MODE B (${kind}) DID NOT SEPARATE WELL ENOUGH`); process.exit(1); }
  });
})();

console.log('\nAll gradient checks and end-to-end sanity checks passed.');
