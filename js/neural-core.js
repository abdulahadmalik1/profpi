// profpi — Neural Network Explorer: core engine
// A real (tiny) multi-layer perceptron: forward pass, backprop, batch gradient
// descent, all implemented from scratch — nothing here is faked for show.
// This file has zero DOM/canvas code so it can be unit-tested or reused.

const NNCore = (() => {
  'use strict';

  // ── Random init ──────────────────────────────────────────────────────
  function randn() {
    // Box-Muller transform
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // ── Activations ──────────────────────────────────────────────────────
  // f: value given z. d: derivative given (z, a) — a is f(z), passed in so
  // callers who already have it (every callsite here) avoid recomputing.
  const ACTIVATIONS = {
    tanh: {
      f: (z) => Math.tanh(z),
      d: (z, a) => 1 - a * a,
    },
    relu: {
      f: (z) => Math.max(0, z),
      d: (z) => (z > 0 ? 1 : 0),
    },
    sigmoid: {
      f: (z) => 1 / (1 + Math.exp(-z)),
      d: (z, a) => a * (1 - a),
    },
  };

  function activationFn(name) {
    return ACTIVATIONS[name] || ACTIVATIONS.tanh;
  }

  // ── Network ──────────────────────────────────────────────────────────
  // layerSizes e.g. [2, 4, 4, 1] — input dim 2, two hidden layers of 4,
  // output dim 1 (binary classification probability via sigmoid).
  class Network {
    constructor(layerSizes, hiddenActivation) {
      this.layerSizes = layerSizes.slice();
      this.hiddenActivation = hiddenActivation;
      this.weights = []; // weights[l][j][i]: layer l -> l+1, neuron j, input i
      this.biases = [];  // biases[l][j]
      for (let l = 0; l < layerSizes.length - 1; l++) {
        const nIn = layerSizes[l];
        const nOut = layerSizes[l + 1];
        const scale = Math.sqrt(2 / nIn); // He-style init
        const W = [];
        for (let j = 0; j < nOut; j++) {
          const row = [];
          for (let i = 0; i < nIn; i++) row.push(randn() * scale);
          W.push(row);
        }
        this.weights.push(W);
        this.biases.push(new Array(nOut).fill(0));
      }
    }

    get numWeightLayers() {
      return this.weights.length;
    }

    // Forward pass. Returns zs/as arrays indexed 0..numWeightLayers, where
    // as[0] is the raw input (no z for the input layer, zs[0] = null).
    forward(input) {
      const as = [input.slice()];
      const zs = [null];
      const L = this.weights.length;
      for (let l = 0; l < L; l++) {
        const W = this.weights[l];
        const b = this.biases[l];
        const isOutput = l === L - 1;
        const act = activationFn(isOutput ? 'sigmoid' : this.hiddenActivation);
        const prevA = as[l];
        const z = new Array(W.length);
        const a = new Array(W.length);
        for (let j = 0; j < W.length; j++) {
          let sum = b[j];
          const row = W[j];
          for (let i = 0; i < prevA.length; i++) sum += row[i] * prevA[i];
          z[j] = sum;
          a[j] = act.f(sum);
        }
        zs.push(z);
        as.push(a);
      }
      return { zs, as };
    }

    // Full forward + backward pass for ONE labeled sample, without mutating
    // weights. Used both to accumulate training gradients and to drive the
    // "probe" inspector so the UI can show exactly what backprop computed.
    // Loss is binary cross-entropy; because the output activation is
    // sigmoid, dL/dz at the output simplifies neatly to (yhat - y).
    backwardSingle(input, label) {
      const { zs, as } = this.forward(input);
      const L = this.weights.length;
      const deltas = new Array(L + 1); // deltas[l] aligns with as[l]; deltas[0] unused
      const gradW = new Array(L);
      const gradB = new Array(L);

      const yhat = as[L][0];
      const epsClamp = 1e-12;
      const loss = -(
        label * Math.log(Math.max(yhat, epsClamp)) +
        (1 - label) * Math.log(Math.max(1 - yhat, epsClamp))
      );

      deltas[L] = as[L].map((a) => a - label);

      for (let l = L; l >= 1; l--) {
        const W = this.weights[l - 1];
        const nOut = W.length;
        const nIn = W[0].length;
        const gW = [];
        const gB = new Array(nOut);
        for (let j = 0; j < nOut; j++) {
          gB[j] = deltas[l][j];
          const row = new Array(nIn);
          for (let i = 0; i < nIn; i++) row[i] = deltas[l][j] * as[l - 1][i];
          gW.push(row);
        }
        gradW[l - 1] = gW;
        gradB[l - 1] = gB;

        if (l > 1) {
          const act = activationFn(this.hiddenActivation);
          const prevDelta = new Array(nIn).fill(0);
          for (let i = 0; i < nIn; i++) {
            let sum = 0;
            for (let j = 0; j < nOut; j++) sum += W[j][i] * deltas[l][j];
            prevDelta[i] = sum * act.d(zs[l - 1][i], as[l - 1][i]);
          }
          deltas[l - 1] = prevDelta;
        }
      }

      return { zs, as, deltas, gradW, gradB, loss, yhat };
    }

    // One batch-gradient-descent step over the full dataset. Mutates
    // weights/biases in place. Returns the mean loss for this step.
    trainStep(data, lr) {
      const L = this.weights.length;
      const accGradW = this.weights.map((W) => W.map((row) => row.map(() => 0)));
      const accGradB = this.biases.map((b) => b.map(() => 0));
      let totalLoss = 0;

      for (let n = 0; n < data.length; n++) {
        const point = data[n];
        const { gradW, gradB, loss } = this.backwardSingle([point.x, point.y], point.label);
        totalLoss += loss;
        for (let l = 0; l < L; l++) {
          for (let j = 0; j < accGradW[l].length; j++) {
            accGradB[l][j] += gradB[l][j];
            const accRow = accGradW[l][j];
            const gRow = gradW[l][j];
            for (let i = 0; i < accRow.length; i++) accRow[i] += gRow[i];
          }
        }
      }

      const n = data.length;
      for (let l = 0; l < L; l++) {
        for (let j = 0; j < this.weights[l].length; j++) {
          this.biases[l][j] -= (lr * accGradB[l][j]) / n;
          const row = this.weights[l][j];
          const accRow = accGradW[l][j];
          for (let i = 0; i < row.length; i++) row[i] -= (lr * accRow[i]) / n;
        }
      }

      return totalLoss / n;
    }

    predict(x, y) {
      const { as } = this.forward([x, y]);
      return as[as.length - 1][0];
    }

    accuracy(data) {
      let correct = 0;
      for (const p of data) {
        const pred = this.predict(p.x, p.y) >= 0.5 ? 1 : 0;
        if (pred === p.label) correct++;
      }
      return correct / data.length;
    }

    meanLoss(data) {
      let total = 0;
      for (const p of data) {
        const yhat = this.predict(p.x, p.y);
        total += -(
          p.label * Math.log(Math.max(yhat, 1e-12)) +
          (1 - p.label) * Math.log(Math.max(1 - yhat, 1e-12))
        );
      }
      return total / data.length;
    }
  }

  // ── Toy 2D datasets (points roughly in [-1, 1]) ─────────────────────
  function genCircle(n, noise) {
    const pts = [];
    const noiseAmt = noise / 100;
    for (let i = 0; i < n; i++) {
      const label = i < n / 2 ? 0 : 1;
      const angle = Math.random() * 2 * Math.PI;
      const r = label === 0 ? Math.random() * 0.5 : 0.75 + Math.random() * 0.3;
      let x = r * Math.cos(angle);
      let y = r * Math.sin(angle);
      x += (Math.random() * 2 - 1) * noiseAmt * 0.35;
      y += (Math.random() * 2 - 1) * noiseAmt * 0.35;
      pts.push({ x: clamp(x, -1.2, 1.2), y: clamp(y, -1.2, 1.2), label });
    }
    return pts;
  }

  function genXor(n, noise) {
    const pts = [];
    const noiseAmt = noise / 100;
    for (let i = 0; i < n; i++) {
      let x = Math.random() * 2 - 1;
      let y = Math.random() * 2 - 1;
      x += x >= 0 ? 0.06 : -0.06;
      y += y >= 0 ? 0.06 : -0.06;
      const label = x * y >= 0 ? 1 : 0;
      x += (Math.random() * 2 - 1) * noiseAmt * 0.5;
      y += (Math.random() * 2 - 1) * noiseAmt * 0.5;
      pts.push({ x: clamp(x, -1.2, 1.2), y: clamp(y, -1.2, 1.2), label });
    }
    return pts;
  }

  function genGaussian(n, noise) {
    const pts = [];
    const spread = 0.35 + (noise / 100) * 0.45;
    for (let i = 0; i < n; i++) {
      const label = i < n / 2 ? 0 : 1;
      const cx = label === 0 ? -0.55 : 0.55;
      const cy = label === 0 ? -0.55 : 0.55;
      const x = cx + randn() * spread * 0.45;
      const y = cy + randn() * spread * 0.45;
      pts.push({ x: clamp(x, -1.2, 1.2), y: clamp(y, -1.2, 1.2), label });
    }
    return pts;
  }

  function genSpiral(n, noise) {
    const pts = [];
    const noiseAmt = noise / 100;
    function arm(deltaT, label, count) {
      for (let i = 0; i < count; i++) {
        const r = (i / count) * 1.0;
        const t = 1.75 * (i / count) * 2 * Math.PI + deltaT;
        let x = r * Math.sin(t);
        let y = r * Math.cos(t);
        x += (Math.random() * 2 - 1) * noiseAmt * 0.25;
        y += (Math.random() * 2 - 1) * noiseAmt * 0.25;
        pts.push({ x: clamp(x, -1.2, 1.2), y: clamp(y, -1.2, 1.2), label });
      }
    }
    arm(0, 0, Math.floor(n / 2));
    arm(Math.PI, 1, Math.ceil(n / 2));
    return pts;
  }

  function generateDataset(type, n, noise) {
    switch (type) {
      case 'xor':
        return genXor(n, noise);
      case 'gaussian':
        return genGaussian(n, noise);
      case 'spiral':
        return genSpiral(n, noise);
      case 'circle':
      default:
        return genCircle(n, noise);
    }
  }

  return { Network, activationFn, generateDataset, randn, clamp };
})();

// Zero-effect in the browser; lets this file be sanity-checked under Node.
if (typeof module !== 'undefined' && module.exports) module.exports = NNCore;