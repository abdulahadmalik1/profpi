// profpi — Neural ODE core engine (Phase 3)
//
// Everything a "Neural ODE" needs, built on the same rules as mathcore.js /
// expr-parser.js / phase-portrait.js:
//   1. No eval/Function anywhere — training data for "fit a system" comes
//      from ExprParser-compiled closures, never raw code execution.
//   2. Hard caps on every user-scalable quantity (hidden width, epochs,
//      sample/point counts, unrolled integration steps, grid size) so
//      nothing typed or dragged can hang a tab.
//   3. Typed errors (NeuralODEError) for bad input; numerical blow-up
//      during training is reported via a `blewUp` flag (same name/shape as
//      MathCore.integrateODE's own flag), never a silent wrong answer.
//   4. Training is exposed as JS generators that yield once per epoch, so
//      a page can drive it a few epochs per animation frame and the tab
//      never freezes, even at the caps.
//
// Two modes:
//   A) fitVectorFieldGen  — supervised regression: learn dx/dt=f(x,y),
//      dy/dt=g(x,y) directly from sampled (x, y, dx, dy) points.
//   B) trainFlowClassifierGen — the classic Neural ODE demo: a tiny MLP
//      defines dz/dt = NN(z, t); points are integrated forward through
//      time (Euler, weights tied across steps — mathematically identical
//      to backprop through a residual network with shared weights) and a
//      linear+sigmoid head classifies the final position. This
//      "discretize-then-optimize" approach is what's actually trained;
//      inference reuses the exact same fixed-step Euler integrator, so
//      there is no train/inference discretization mismatch.
//
// No dependencies beyond ExprParser. Works in browser (global NeuralODE)
// and Node (module.exports).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const ExprParser = require('./expr-parser.js');
    module.exports = factory(ExprParser);
  } else {
    root.NeuralODE = factory(root.ExprParser);
  }
})(typeof self !== 'undefined' ? self : this, function (ExprParser) {
  'use strict';

  if (!ExprParser) {
    throw new Error('NeuralODE requires ExprParser to be loaded first (include expr-parser.js before neural-ode-core.js).');
  }

  class NeuralODEError extends Error {
    constructor(message) {
      super(message);
      this.name = 'NeuralODEError';
    }
  }

  // ── Hard caps ───────────────────────────────────────────────────────
  const MAX_HIDDEN = 24;
  const MAX_EPOCHS = 300;
  const MAX_FIT_SAMPLES = 300;
  const MAX_FIT_GRID_POINTS = 3000;
  const MAX_FLOW_POINTS = 220;
  const MAX_UNROLL_STEPS = 16;
  const MAX_FLOW_GRID_POINTS = 3000;
  const GRAD_CLIP_NORM = 5;
  const MIN_VALID_FIT_SAMPLES = 8;

  // ── Small helpers ───────────────────────────────────────────────────
  function assertFinite(x, label) {
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw new NeuralODEError(`${label} must be a finite number, got ${JSON.stringify(x)}`);
    }
  }
  function assertPositiveInt(x, label, max) {
    if (!Number.isInteger(x) || x < 1) {
      throw new NeuralODEError(`${label} must be a positive integer, got ${JSON.stringify(x)}`);
    }
    if (max !== undefined && x > max) {
      throw new NeuralODEError(`${label} (${x}) exceeds the cap of ${max}, kept in place to stay responsive.`);
    }
  }
  function assertBounds(xMin, xMax, yMin, yMax) {
    [['xMin', xMin], ['xMax', xMax], ['yMin', yMin], ['yMax', yMax]].forEach(([l, v]) => assertFinite(v, l));
    if (xMin >= xMax) throw new NeuralODEError(`xMin (${xMin}) must be less than xMax (${xMax})`);
    if (yMin >= yMax) throw new NeuralODEError(`yMin (${yMin}) must be less than yMax (${yMax})`);
  }
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function rng() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function linspace(min, max, count) {
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = min + ((max - min) * i) / (count - 1);
    return out;
  }

  // ── MLP: plain dense layers, tanh hidden activations, linear output ──
  // sizes = [in, hidden1, ..., out]. Weights are Xavier-ish initialized
  // from a seeded RNG so results are reproducible.
  function createMLP(sizes, seed) {
    if (!Array.isArray(sizes) || sizes.length < 2 || sizes.some((s) => !Number.isInteger(s) || s < 1)) {
      throw new NeuralODEError('MLP sizes must be an array of positive integers with at least 2 entries.');
    }
    for (let l = 1; l < sizes.length - 1; l++) {
      if (sizes[l] > MAX_HIDDEN) {
        throw new NeuralODEError(`Hidden layer width (${sizes[l]}) exceeds the cap of ${MAX_HIDDEN}.`);
      }
    }
    const rng = makeRng(seed);
    const layers = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      const fanIn = sizes[l], fanOut = sizes[l + 1];
      const scale = Math.sqrt(2 / (fanIn + fanOut));
      const W = new Array(fanOut);
      const gradW = new Array(fanOut);
      for (let o = 0; o < fanOut; o++) {
        W[o] = new Array(fanIn);
        gradW[o] = new Array(fanIn).fill(0);
        for (let i = 0; i < fanIn; i++) W[o][i] = (rng() * 2 - 1) * scale;
      }
      layers.push({ W, b: new Array(fanOut).fill(0), gradW, gradB: new Array(fanOut).fill(0) });
    }
    return { sizes, layers };
  }

  // Forward pass. Returns { output, cache } — cache holds per-layer
  // pre-activations (zs) and layer inputs (inputs), needed by backward().
  function forward(mlp, input) {
    let a = input;
    const cache = { inputs: [input], zs: [] };
    for (let l = 0; l < mlp.layers.length; l++) {
      const { W, b } = mlp.layers[l];
      const isOutput = l === mlp.layers.length - 1;
      const z = new Array(W.length);
      for (let o = 0; o < W.length; o++) {
        let sum = b[o];
        const Wo = W[o];
        for (let i = 0; i < Wo.length; i++) sum += Wo[i] * a[i];
        z[o] = sum;
      }
      const out = isOutput ? z.slice() : z.map(Math.tanh);
      cache.zs.push(z);
      cache.inputs.push(out);
      a = out;
    }
    return { output: a, cache };
  }

  // Backward pass. dOutput is dLoss/dOutput. Accumulates into
  // mlp.layers[*].gradW / gradB (call zeroGrad first). Returns
  // dLoss/dInput, so callers can chain gradients through whatever fed
  // this MLP's input (e.g. the previous Euler step).
  function backward(mlp, cache, dOutput) {
    let dA = dOutput;
    for (let l = mlp.layers.length - 1; l >= 0; l--) {
      const { W, gradW, gradB } = mlp.layers[l];
      const isOutput = l === mlp.layers.length - 1;
      const aPrev = cache.inputs[l];
      const aOut = cache.inputs[l + 1]; // = tanh(z) for hidden layers, = z for output layer
      const dZ = new Array(W.length);
      for (let o = 0; o < W.length; o++) {
        const dAct = isOutput ? 1 : (1 - aOut[o] * aOut[o]);
        dZ[o] = dA[o] * dAct;
      }
      for (let o = 0; o < W.length; o++) {
        gradB[o] += dZ[o];
        const Wo = W[o], gWo = gradW[o];
        for (let i = 0; i < Wo.length; i++) gWo[i] += dZ[o] * aPrev[i];
      }
      const dAPrev = new Array(aPrev.length).fill(0);
      for (let o = 0; o < W.length; o++) {
        const Wo = W[o];
        for (let i = 0; i < Wo.length; i++) dAPrev[i] += Wo[i] * dZ[o];
      }
      dA = dAPrev;
    }
    return dA;
  }

  function zeroGrad(mlp) {
    mlp.layers.forEach(({ gradW, gradB }) => {
      for (let o = 0; o < gradW.length; o++) gradW[o].fill(0);
      gradB.fill(0);
    });
  }
  function scaleGrads(mlp, factor) {
    mlp.layers.forEach(({ gradW, gradB }) => {
      for (let o = 0; o < gradW.length; o++) for (let i = 0; i < gradW[o].length; i++) gradW[o][i] *= factor;
      for (let o = 0; o < gradB.length; o++) gradB[o] *= factor;
    });
  }
  function clipGlobalNorm(mlp, maxNorm, extra) {
    let sumSq = 0;
    mlp.layers.forEach(({ gradW, gradB }) => {
      gradW.forEach((row) => row.forEach((v) => { sumSq += v * v; }));
      gradB.forEach((v) => { sumSq += v * v; });
    });
    if (extra) extra.forEach((v) => { sumSq += v * v; });
    const norm = Math.sqrt(sumSq);
    if (!Number.isFinite(norm) || norm <= maxNorm || norm === 0) return norm;
    const scale = maxNorm / norm;
    mlp.layers.forEach(({ gradW, gradB }) => {
      for (let o = 0; o < gradW.length; o++) for (let i = 0; i < gradW[o].length; i++) gradW[o][i] *= scale;
      for (let o = 0; o < gradB.length; o++) gradB[o] *= scale;
    });
    if (extra) for (let i = 0; i < extra.length; i++) extra[i] *= scale;
    return norm;
  }
  function sgdStep(mlp, lr) {
    mlp.layers.forEach(({ W, b, gradW, gradB }) => {
      for (let o = 0; o < W.length; o++) for (let i = 0; i < W[o].length; i++) W[o][i] -= lr * gradW[o][i];
      for (let o = 0; o < b.length; o++) b[o] -= lr * gradB[o];
    });
  }
  function mlpFinite(mlp) {
    return mlp.layers.every(({ W, b }) =>
      W.every((row) => row.every(Number.isFinite)) && b.every(Number.isFinite)
    );
  }
  function toVectorFn(mlp) {
    return (x, y) => forward(mlp, [x, y]).output;
  }

  // ── Mode A: learn a vector field from sampled data ────────────────────
  function computeFieldGrid(fn, bounds, cols, rows) {
    assertBounds(bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax);
    assertPositiveInt(cols, 'cols');
    assertPositiveInt(rows, 'rows');
    if (cols * rows > MAX_FIT_GRID_POINTS) {
      throw new NeuralODEError(`Requested grid (${cols}x${rows}) exceeds the cap of ${MAX_FIT_GRID_POINTS} points.`);
    }
    const xs = linspace(bounds.xMin, bounds.xMax, cols);
    const ys = linspace(bounds.yMin, bounds.yMax, rows);
    const points = [];
    for (const y of ys) {
      for (const x of xs) {
        let dx, dy;
        try { [dx, dy] = fn(x, y); } catch (e) { dx = NaN; dy = NaN; }
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) { points.push({ x, y, defined: false }); continue; }
        const mag = Math.hypot(dx, dy);
        const norm = mag === 0 ? 1 : mag;
        points.push({ x, y, defined: true, dx, dy, magnitude: mag, dirX: dx / norm, dirY: dy / norm });
      }
    }
    return { points, bounds, cols, rows };
  }

  // Generator: yields { epoch, epochs, loss } once per epoch; returns
  // { mlp, predictFn, data, lossHistory, blewUp } when done.
  function* fitVectorFieldGen(fExprString, gExprString, opts) {
    const {
      xMin = -5, xMax = 5, yMin = -5, yMax = 5,
      samples = 120, noise = 0, hidden = 16, epochs = 150, lr = 0.05, seed = 42,
    } = opts || {};
    assertBounds(xMin, xMax, yMin, yMax);
    assertPositiveInt(samples, 'samples', MAX_FIT_SAMPLES);
    assertPositiveInt(hidden, 'hidden', MAX_HIDDEN);
    assertPositiveInt(epochs, 'epochs', MAX_EPOCHS);
    assertFinite(noise, 'noise');
    assertFinite(lr, 'lr');

    const f = ExprParser.compile(fExprString, ['x', 'y']);
    const g = ExprParser.compile(gExprString, ['x', 'y']);
    const rng = makeRng(seed);

    const data = [];
    for (let i = 0; i < samples; i++) {
      const x = xMin + rng() * (xMax - xMin);
      const y = yMin + rng() * (yMax - yMin);
      let dx, dy;
      try { dx = f(x, y); dy = g(x, y); } catch (e) { dx = NaN; dy = NaN; }
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue; // per-point skip, like phase-portrait's field sampling
      const nx = noise ? (rng() * 2 - 1) * noise : 0;
      const ny = noise ? (rng() * 2 - 1) * noise : 0;
      data.push({ x, y, dx: dx + nx, dy: dy + ny });
    }
    if (data.length < MIN_VALID_FIT_SAMPLES) {
      throw new NeuralODEError('Not enough valid sample points in these bounds to train — the system may be undefined almost everywhere here. Try widening the view bounds.');
    }

    const mlp = createMLP([2, hidden, hidden, 2], seed);
    const lossHistory = [];
    let blewUp = false;

    for (let epoch = 0; epoch < epochs; epoch++) {
      zeroGrad(mlp);
      let totalLoss = 0;
      for (const d of data) {
        const { output, cache } = forward(mlp, [d.x, d.y]);
        const ex = output[0] - d.dx, ey = output[1] - d.dy;
        totalLoss += ex * ex + ey * ey;
        backward(mlp, cache, [2 * ex, 2 * ey]);
      }
      scaleGrads(mlp, 1 / data.length);
      clipGlobalNorm(mlp, GRAD_CLIP_NORM);
      if (!Number.isFinite(totalLoss)) { blewUp = true; break; }
      sgdStep(mlp, lr);
      if (!mlpFinite(mlp)) { blewUp = true; break; }
      const avgLoss = totalLoss / data.length;
      lossHistory.push(avgLoss);
      yield { epoch: epoch + 1, epochs, loss: avgLoss };
    }

    return { mlp, predictFn: toVectorFn(mlp), data, lossHistory, blewUp };
  }

  // ── Mode B: learn a flow that classifies two point sets ──────────────
  function generateDataset(kind, opts) {
    const { n = 160, noise = 0.06, seed = 7 } = opts || {};
    assertPositiveInt(n, 'n', MAX_FLOW_POINTS);
    assertFinite(noise, 'noise');
    const rng = makeRng(seed);
    const perClass = Math.floor(n / 2);
    const pts = [];
    const jitter = () => (rng() * 2 - 1) * noise;

    if (kind === 'moons') {
      for (let i = 0; i < perClass; i++) {
        const t = Math.PI * (i / perClass);
        pts.push({ x: Math.cos(t) + jitter(), y: Math.sin(t) + jitter(), label: 0 });
        pts.push({ x: 1 - Math.cos(t) + jitter(), y: 0.5 - Math.sin(t) + jitter(), label: 1 });
      }
    } else if (kind === 'circles') {
      for (let i = 0; i < perClass; i++) {
        const a1 = rng() * 2 * Math.PI, a2 = rng() * 2 * Math.PI;
        pts.push({ x: 0.5 * Math.cos(a1) + jitter(), y: 0.5 * Math.sin(a1) + jitter(), label: 0 });
        pts.push({ x: 1.5 * Math.cos(a2) + jitter(), y: 1.5 * Math.sin(a2) + jitter(), label: 1 });
      }
    } else if (kind === 'xor') {
      // Supported here for completeness, but deliberately not offered as a
      // default UI preset: a 4-quadrant checkerboard is topologically
      // locked for a 2D flow for the same reason a tight spiral is (see
      // above) — training plateaus around ~60-80% no matter how long you
      // run it, which would look like a broken demo rather than a feature.
      for (let i = 0; i < perClass * 2; i++) {
        const qx = rng() < 0.5 ? -1 : 1, qy = rng() < 0.5 ? -1 : 1;
        const label = (qx * qy > 0) ? 0 : 1;
        pts.push({ x: qx * 0.8 + jitter() * 3, y: qy * 0.8 + jitter() * 3, label });
      }
    } else { // 'spirals' (default) — a gentle half-turn. A 2D flow map is a
      // continuous bijection of the plane, so it can only ever separate
      // classes it can pull apart *without crossing trajectories*. A tight
      // multi-turn spiral (or concentric rings wound too many times) is
      // topologically locked for a 2D state and will never separate no
      // matter how long you train — a real, documented limitation of
      // low-dimensional Neural ODEs (see "Augmented Neural ODEs", Dupont
      // et al. 2019), confirmed empirically here, not a training bug.
      for (let i = 0; i < perClass; i++) {
        const t = i / perClass;
        const r = 0.3 + 0.7 * t;
        const angle = t * Math.PI; // half turn
        pts.push({ x: r * Math.cos(angle) + jitter(), y: r * Math.sin(angle) + jitter(), label: 0 });
        pts.push({ x: r * Math.cos(angle + Math.PI) + jitter(), y: r * Math.sin(angle + Math.PI) + jitter(), label: 1 });
      }
    }
    return pts;
  }

  // Generator: yields { epoch, epochs, loss, accuracy } once per epoch;
  // returns { mlp, head, steps, h, useTime, lossHistory, accHistory, blewUp }.
  //
  // Training is "discretize-then-optimize": dz/dt = NN(z,t) is discretized
  // with fixed-step Euler *before* differentiating, so the unrolled steps
  // are exactly a residual network with weights tied across depth — the
  // same backprop-through-time math as an RNN, just with the "recurrence"
  // being Euler integration. Inference (integrateFlow, below) reuses the
  // identical h/steps, so there's no train/inference mismatch.
  function* trainFlowClassifierGen(points, opts) {
    // Defaults below are not arbitrary — they're the smallest shared config
    // that was verified (see profpi's test suite) to reliably reach >90%
    // separation across every preset in generateDataset(), across multiple
    // seeds, not just a single lucky run.
    const { hidden = 18, steps = 14, h = 0.18, epochs = 260, lr = 0.2, seed = 11, useTime = true } = opts || {};
    if (!Array.isArray(points) || points.length === 0) {
      throw new NeuralODEError('trainFlowClassifierGen requires a non-empty array of {x,y,label} points.');
    }
    assertPositiveInt(points.length, 'points.length', MAX_FLOW_POINTS);
    assertPositiveInt(hidden, 'hidden', MAX_HIDDEN);
    assertPositiveInt(steps, 'steps', MAX_UNROLL_STEPS);
    assertPositiveInt(epochs, 'epochs', MAX_EPOCHS);
    assertFinite(h, 'h');
    assertFinite(lr, 'lr');
    if (h <= 0) throw new NeuralODEError(`h must be positive, got ${h}`);

    const inputSize = useTime ? 3 : 2;
    const mlp = createMLP([inputSize, hidden, hidden, 2], seed);
    const rng = makeRng(seed + 1);
    const head = { w: [(rng() * 2 - 1) * 0.5, (rng() * 2 - 1) * 0.5], b: 0 };

    const lossHistory = [];
    const accHistory = [];
    let blewUp = false;

    for (let epoch = 0; epoch < epochs; epoch++) {
      zeroGrad(mlp);
      const headGrad = { w: [0, 0], b: 0 };
      let totalLoss = 0, correct = 0;

      for (const p of points) {
        let z = [p.x, p.y];
        const stepCache = [];
        for (let k = 0; k < steps; k++) {
          const t = k / steps;
          const input = useTime ? [z[0], z[1], t] : [z[0], z[1]];
          const { output: dz, cache } = forward(mlp, input);
          stepCache.push(cache);
          z = [z[0] + h * dz[0], z[1] + h * dz[1]];
        }
        const score = head.w[0] * z[0] + head.w[1] * z[1] + head.b;
        const prob = 1 / (1 + Math.exp(-score));
        const eps = 1e-7;
        totalLoss += -(p.label * Math.log(prob + eps) + (1 - p.label) * Math.log(1 - prob + eps));
        if ((prob >= 0.5 ? 1 : 0) === p.label) correct++;

        const dScore = prob - p.label; // dBCE/dScore for a sigmoid head — standard closed form
        headGrad.w[0] += z[0] * dScore;
        headGrad.w[1] += z[1] * dScore;
        headGrad.b += dScore;

        let dz = [head.w[0] * dScore, head.w[1] * dScore];
        for (let k = steps - 1; k >= 0; k--) {
          const dOutput = [h * dz[0], h * dz[1]]; // d(z_{k+1})/d(NN output) = h, via the Euler update
          const dInput = backward(mlp, stepCache[k], dOutput);
          dz = [dz[0] + dInput[0], dz[1] + dInput[1]]; // skip-connection term + MLP's contribution; dInput[2] (time) is dropped, time isn't a parameter
        }
      }

      scaleGrads(mlp, 1 / points.length);
      headGrad.w[0] /= points.length; headGrad.w[1] /= points.length; headGrad.b /= points.length;
      clipGlobalNorm(mlp, GRAD_CLIP_NORM, headGrad.w.concat([headGrad.b]));

      if (!Number.isFinite(totalLoss)) { blewUp = true; break; }
      sgdStep(mlp, lr);
      head.w[0] -= lr * headGrad.w[0]; head.w[1] -= lr * headGrad.w[1]; head.b -= lr * headGrad.b;
      if (!mlpFinite(mlp) || ![head.w[0], head.w[1], head.b].every(Number.isFinite)) { blewUp = true; break; }

      const avgLoss = totalLoss / points.length;
      const acc = correct / points.length;
      lossHistory.push(avgLoss);
      accHistory.push(acc);
      yield { epoch: epoch + 1, epochs, loss: avgLoss, accuracy: acc };
    }

    return { mlp, head, steps, h, useTime, lossHistory, accHistory, blewUp };
  }

  // Inference-time integration — plain numeric forward passes, no
  // gradient bookkeeping. Reuses the exact same h/steps/useTime the
  // model was trained with. Returns one path (array of {x,y}, length
  // steps+1) per input point.
  function integrateFlow(mlp, points, opts) {
    const { steps, h, useTime } = opts;
    assertPositiveInt(steps, 'steps', MAX_UNROLL_STEPS);
    assertFinite(h, 'h');
    return points.map((p) => {
      let z = [p.x, p.y];
      const path = [{ x: z[0], y: z[1] }];
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const input = useTime ? [z[0], z[1], t] : [z[0], z[1]];
        const { output: dz } = forward(mlp, input);
        z = [z[0] + h * dz[0], z[1] + h * dz[1]];
        path.push({ x: z[0], y: z[1] });
      }
      return path;
    });
  }

  // Decision-boundary field: integrate a grid of points through the
  // trained flow and score each with the trained head. Capped like any
  // other grid computation in this codebase.
  function computeDecisionField(mlp, head, bounds, cols, rows, flowOpts) {
    assertBounds(bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax);
    assertPositiveInt(cols, 'cols');
    assertPositiveInt(rows, 'rows');
    if (cols * rows > MAX_FLOW_GRID_POINTS) {
      throw new NeuralODEError(`Requested decision grid (${cols}x${rows}) exceeds the cap of ${MAX_FLOW_GRID_POINTS} points.`);
    }
    const xs = linspace(bounds.xMin, bounds.xMax, cols);
    const ys = linspace(bounds.yMin, bounds.yMax, rows);
    const gridPoints = [];
    for (const y of ys) for (const x of xs) gridPoints.push({ x, y });
    const paths = integrateFlow(mlp, gridPoints, flowOpts);
    return gridPoints.map((p, i) => {
      const zFinal = paths[i][paths[i].length - 1];
      const score = head.w[0] * zFinal.x + head.w[1] * zFinal.y + head.b;
      const prob = 1 / (1 + Math.exp(-score));
      return { x: p.x, y: p.y, prob };
    });
  }

  return {
    NeuralODEError,
    MAX_HIDDEN, MAX_EPOCHS, MAX_FIT_SAMPLES, MAX_FIT_GRID_POINTS,
    MAX_FLOW_POINTS, MAX_UNROLL_STEPS, MAX_FLOW_GRID_POINTS,
    createMLP, forward, backward, zeroGrad, sgdStep, toVectorFn,
    computeFieldGrid, fitVectorFieldGen,
    generateDataset, trainFlowClassifierGen, integrateFlow, computeDecisionField,
  };
});
