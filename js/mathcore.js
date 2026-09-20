// profpi — Shared Math Core Library
//
// Pure computational logic, no DOM access. Used by the graphing calculator
// and every advanced-math tool (ODE visualizer, Fourier explorer, complex
// plane, Laplace explorer) so numerical routines are written and tested
// exactly once.
//
// Design rules this file follows:
//  1. Every public function validates its inputs and throws a MathCoreError
//     with a specific, actionable message on invalid input. Nothing fails
//     silently and nothing produces NaN/Infinity without saying so.
//  2. Iterative processes (root finding, ODE integration) have hard caps on
//     iteration/step count. Nothing can hang the tab.
//  3. Numerically expected "failures" (an ODE blowing up, a root-finder not
//     converging) are reported via a status flag on the return value, not
//     thrown as errors — that's real math behavior, not a bug.
//  4. No dependencies. Works identically in the browser (as a global
//     `MathCore` object) and in Node (via module.exports) so it can be unit
//     tested without a browser.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MathCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Errors & validation ──────────────────────────────────────────────

  class MathCoreError extends Error {
    constructor(message) {
      super(message);
      this.name = 'MathCoreError';
    }
  }

  function isFiniteNumber(x) {
    return typeof x === 'number' && Number.isFinite(x);
  }

  function assertFiniteNumber(x, label) {
    if (!isFiniteNumber(x)) {
      throw new MathCoreError(`${label} must be a finite number, got ${JSON.stringify(x)}`);
    }
  }

  function assertFiniteArray(arr, label, { minLength = 1 } = {}) {
    if (!Array.isArray(arr)) {
      throw new MathCoreError(`${label} must be an array, got ${typeof arr}`);
    }
    if (arr.length < minLength) {
      throw new MathCoreError(`${label} must have at least ${minLength} element(s), got ${arr.length}`);
    }
    arr.forEach((v, i) => {
      const val = v instanceof Complex ? v.re : v;
      const val2 = v instanceof Complex ? v.im : 0;
      if (!isFiniteNumber(val) || !isFiniteNumber(val2)) {
        throw new MathCoreError(`${label}[${i}] must be a finite number, got ${JSON.stringify(v)}`);
      }
    });
  }

  function assertPositiveInteger(x, label, { max = Infinity } = {}) {
    if (!Number.isInteger(x) || x <= 0) {
      throw new MathCoreError(`${label} must be a positive integer, got ${JSON.stringify(x)}`);
    }
    if (x > max) {
      throw new MathCoreError(`${label} is capped at ${max} to keep this in the browser responsive, got ${x}`);
    }
  }

  function isPowerOfTwo(n) {
    return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
  }

  // ── Complex numbers ───────────────────────────────────────────────────

  class Complex {
    constructor(re = 0, im = 0) {
      assertFiniteNumber(re, 're');
      assertFiniteNumber(im, 'im');
      this.re = re;
      this.im = im;
    }

    static from(x) {
      if (x instanceof Complex) return x;
      if (typeof x === 'number') return new Complex(x, 0);
      throw new MathCoreError(`Cannot convert ${JSON.stringify(x)} to Complex`);
    }

    static fromPolar(r, theta) {
      assertFiniteNumber(r, 'r');
      assertFiniteNumber(theta, 'theta');
      return new Complex(r * Math.cos(theta), r * Math.sin(theta));
    }

    add(o) { o = Complex.from(o); return new Complex(this.re + o.re, this.im + o.im); }
    sub(o) { o = Complex.from(o); return new Complex(this.re - o.re, this.im - o.im); }
    mul(o) {
      o = Complex.from(o);
      return new Complex(this.re * o.re - this.im * o.im, this.re * o.im + this.im * o.re);
    }
    div(o) {
      o = Complex.from(o);
      const denom = o.re * o.re + o.im * o.im;
      if (denom === 0) {
        throw new MathCoreError('Division by zero (0+0i) in Complex.div');
      }
      return new Complex(
        (this.re * o.re + this.im * o.im) / denom,
        (this.im * o.re - this.re * o.im) / denom
      );
    }
    neg() { return new Complex(-this.re, -this.im); }
    conj() { return new Complex(this.re, -this.im); }
    scale(k) {
      assertFiniteNumber(k, 'k');
      return new Complex(this.re * k, this.im * k);
    }
    abs() { return Math.hypot(this.re, this.im); }
    arg() { return Math.atan2(this.im, this.re); }

    exp() {
      const ea = Math.exp(this.re);
      return new Complex(ea * Math.cos(this.im), ea * Math.sin(this.im));
    }
    log() {
      if (this.re === 0 && this.im === 0) {
        throw new MathCoreError('log(0) is undefined');
      }
      return new Complex(Math.log(this.abs()), this.arg());
    }
    pow(exponent) {
      if (this.re === 0 && this.im === 0) {
        const e = Complex.from(exponent);
        if (e.re > 0 && e.im === 0) return new Complex(0, 0);
        throw new MathCoreError('0 raised to a non-positive or complex power is undefined');
      }
      return this.log().mul(Complex.from(exponent)).exp();
    }
    sqrt() {
      const r = this.abs();
      const re = Math.sqrt((r + this.re) / 2);
      const imSign = this.im < 0 ? -1 : 1;
      const im = imSign * Math.sqrt((r - this.re) / 2);
      return new Complex(re, im);
    }
    sin() {
      return new Complex(
        Math.sin(this.re) * Math.cosh(this.im),
        Math.cos(this.re) * Math.sinh(this.im)
      );
    }
    cos() {
      return new Complex(
        Math.cos(this.re) * Math.cosh(this.im),
        -Math.sin(this.re) * Math.sinh(this.im)
      );
    }
    equals(o, eps = 1e-9) {
      o = Complex.from(o);
      return Math.hypot(this.re - o.re, this.im - o.im) < eps;
    }
    toString(precision = 4) {
      const re = this.re.toFixed(precision);
      const imAbs = Math.abs(this.im).toFixed(precision);
      const sign = this.im < 0 ? '-' : '+';
      return `${re} ${sign} ${imAbs}i`;
    }
  }

  // ── Discrete Fourier Transform (always correct, any length) ──────────

  function dft(samples) {
    assertFiniteArray(samples, 'samples');
    const x = samples.map(Complex.from);
    const N = x.length;
    const out = new Array(N);
    for (let k = 0; k < N; k++) {
      let sum = new Complex(0, 0);
      for (let n = 0; n < N; n++) {
        const angle = (-2 * Math.PI * k * n) / N;
        sum = sum.add(x[n].mul(Complex.fromPolar(1, angle)));
      }
      out[k] = sum;
    }
    return out;
  }

  function idft(samples) {
    assertFiniteArray(samples, 'samples');
    const x = samples.map(Complex.from);
    const N = x.length;
    const out = new Array(N);
    for (let n = 0; n < N; n++) {
      let sum = new Complex(0, 0);
      for (let k = 0; k < N; k++) {
        const angle = (2 * Math.PI * k * n) / N;
        sum = sum.add(x[k].mul(Complex.fromPolar(1, angle)));
      }
      out[n] = sum.scale(1 / N);
    }
    return out;
  }

  // ── Fast Fourier Transform (radix-2, requires power-of-two length) ───

  function fftRecursive(x) {
    const N = x.length;
    if (N === 1) return [x[0]];
    if (N % 2 !== 0) {
      throw new MathCoreError(`Internal error: fft recursion hit odd length ${N}`);
    }
    const even = fftRecursive(x.filter((_, i) => i % 2 === 0));
    const odd = fftRecursive(x.filter((_, i) => i % 2 === 1));
    const out = new Array(N);
    for (let k = 0; k < N / 2; k++) {
      const twiddle = Complex.fromPolar(1, (-2 * Math.PI * k) / N).mul(odd[k]);
      out[k] = even[k].add(twiddle);
      out[k + N / 2] = even[k].sub(twiddle);
    }
    return out;
  }

  function fft(samples) {
    assertFiniteArray(samples, 'samples');
    const N = samples.length;
    if (!isPowerOfTwo(N)) {
      throw new MathCoreError(
        `fft() requires a power-of-two length, got ${N}. Use transform() for arbitrary lengths (it falls back to a direct DFT automatically).`
      );
    }
    return fftRecursive(samples.map(Complex.from));
  }

  function ifft(samples) {
    assertFiniteArray(samples, 'samples');
    const N = samples.length;
    const conjugated = samples.map((c) => Complex.from(c).conj());
    const transformed = fft(conjugated);
    return transformed.map((c) => c.conj().scale(1 / N));
  }

  // Dispatchers: fast path when possible, always-correct fallback otherwise.
  function transform(samples) {
    assertFiniteArray(samples, 'samples');
    return isPowerOfTwo(samples.length) ? fft(samples) : dft(samples);
  }
  function inverseTransform(samples) {
    assertFiniteArray(samples, 'samples');
    return isPowerOfTwo(samples.length) ? ifft(samples) : idft(samples);
  }

  // ── RK4 ODE integration ────────────────────────────────────────────────

  const MAX_ODE_STEPS = 200000;

  function rk4Step(f, t, y, h) {
    const isVec = Array.isArray(y);
    const combine = (base, delta, s) =>
      isVec ? base.map((v, i) => v + s * delta[i]) : base + s * delta;

    const k1 = f(t, y);
    const k2 = f(t + h / 2, combine(y, k1, h / 2));
    const k3 = f(t + h / 2, combine(y, k2, h / 2));
    const k4 = f(t + h, combine(y, k3, h));

    if (isVec) {
      return y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    }
    return y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
  }

  // Integrates dy/dt = f(t, y) from t0 for `steps` steps of size h.
  // Never throws on numerical blow-up (that's expected behavior for some
  // systems) — instead stops early and reports blewUp: true.
  function integrateODE(f, { t0, y0, h, steps, maxMagnitude = 1e8 } = {}) {
    if (typeof f !== 'function') {
      throw new MathCoreError('integrateODE: f must be a function (t, y) => dy/dt');
    }
    assertFiniteNumber(t0, 't0');
    assertFiniteNumber(h, 'h');
    if (h === 0) throw new MathCoreError('integrateODE: step size h cannot be 0');
    assertPositiveInteger(steps, 'steps', { max: MAX_ODE_STEPS });
    const isVec = Array.isArray(y0);
    if (isVec) assertFiniteArray(y0, 'y0');
    else assertFiniteNumber(y0, 'y0');

    const trajectory = [{ t: t0, y: y0 }];
    let t = t0;
    let y = y0;
    let blewUp = false;

    for (let i = 0; i < steps; i++) {
      const yNext = rk4Step(f, t, y, h);
      const mag = isVec ? Math.hypot(...yNext) : Math.abs(yNext);
      if (!Number.isFinite(mag) || mag > maxMagnitude) {
        blewUp = true;
        break;
      }
      t += h;
      y = yNext;
      trajectory.push({ t, y });
    }

    return { trajectory, blewUp, stepsCompleted: trajectory.length - 1 };
  }

  // ── Polynomial root finding ───────────────────────────────────────────

  function solveLinear(a, b) {
    assertFiniteNumber(a, 'a');
    assertFiniteNumber(b, 'b');
    if (a === 0) {
      throw new MathCoreError('solveLinear: leading coefficient a cannot be 0');
    }
    return { roots: [new Complex(-b / a, 0)], converged: true, iterations: 0 };
  }

  function solveQuadratic(a, b, c) {
    assertFiniteNumber(a, 'a');
    assertFiniteNumber(b, 'b');
    assertFiniteNumber(c, 'c');
    if (a === 0) {
      const { roots } = solveLinear(b, c);
      return { roots, converged: true, iterations: 0 };
    }
    const disc = b * b - 4 * a * c;
    const sqrtDisc = disc >= 0 ? new Complex(Math.sqrt(disc), 0) : new Complex(0, Math.sqrt(-disc));
    const twoA = 2 * a;
    const negB = new Complex(-b, 0);
    return {
      roots: [negB.add(sqrtDisc).scale(1 / twoA), negB.sub(sqrtDisc).scale(1 / twoA)],
      converged: true,
      iterations: 0,
    };
  }

  // Durand-Kerner / Weierstrass simultaneous iteration for degree >= 3.
  // Converges reliably for well-separated roots; for repeated or very
  // close roots it may not fully converge within the iteration cap, in
  // which case converged: false is reported alongside the best estimate.
  function durandKerner(coeffs) {
    const n = coeffs.length - 1;
    const monic = coeffs.map((c) => c / coeffs[0]);

    const evalMonic = (z) => {
      let result = new Complex(0, 0);
      for (const co of monic) result = result.mul(z).add(new Complex(co, 0));
      return result;
    };

    const cauchyBound = 1 + Math.max(...monic.slice(1).map((v) => Math.abs(v)));
    let roots = Array.from({ length: n }, (_, k) =>
      Complex.fromPolar(Math.max(cauchyBound * 0.5, 0.4), (2 * Math.PI * k) / n + 0.5)
    );

    const maxIter = 500;
    const tol = 1e-10;
    let converged = false;
    let iter = 0;

    for (iter = 0; iter < maxIter; iter++) {
      let maxDelta = 0;
      const newRoots = roots.map((ri, idx) => {
        let denom = new Complex(1, 0);
        for (let j = 0; j < n; j++) {
          if (j !== idx) denom = denom.mul(ri.sub(roots[j]));
        }
        if (denom.abs() < 1e-14) denom = new Complex(1e-14, 0);
        const delta = evalMonic(ri).div(denom);
        maxDelta = Math.max(maxDelta, delta.abs());
        return ri.sub(delta);
      });
      roots = newRoots;
      if (maxDelta < tol) {
        converged = true;
        iter += 1;
        break;
      }
    }

    return { roots, converged, iterations: iter };
  }

  // coeffs: [a_n, a_{n-1}, ..., a_0], highest degree first, real numbers.
  function polynomialRoots(coeffs) {
    assertFiniteArray(coeffs, 'coeffs', { minLength: 1 });
    let c = coeffs.slice();
    while (c.length > 1 && c[0] === 0) c.shift();

    const degree = c.length - 1;
    if (degree === 0) {
      if (c[0] === 0) {
        throw new MathCoreError('polynomialRoots: the zero polynomial has every value as a root');
      }
      return { roots: [], converged: true, iterations: 0 };
    }
    if (degree === 1) return solveLinear(c[0], c[1]);
    if (degree === 2) return solveQuadratic(c[0], c[1], c[2]);
    return durandKerner(c);
  }

  // ── 2x2 eigenvalues, for Jacobian / equilibrium classification ───────
  // Matrix [[a, b], [c, d]]. Characteristic polynomial: λ² - trace·λ + det = 0.

  function eigen2x2(a, b, c, d) {
    assertFiniteNumber(a, 'a');
    assertFiniteNumber(b, 'b');
    assertFiniteNumber(c, 'c');
    assertFiniteNumber(d, 'd');

    const trace = a + d;
    const det = a * d - b * c;
    const { roots } = solveQuadratic(1, -trace, det);
    const [l1, l2] = roots;

    const eps = 1e-9;
    const bothReal = Math.abs(l1.im) < eps && Math.abs(l2.im) < eps;

    let classification;
    let stability;

    if (bothReal) {
      if (Math.abs(l1.re - l2.re) < eps) {
        classification = 'degenerate node';
        stability = l1.re < 0 ? 'stable' : l1.re > 0 ? 'unstable' : 'neutral';
      } else if (l1.re * l2.re < 0) {
        classification = 'saddle';
        stability = 'unstable';
      } else {
        classification = 'node';
        stability = l1.re < 0 && l2.re < 0 ? 'stable' : 'unstable';
      }
    } else {
      if (Math.abs(l1.re) < eps) {
        classification = 'center';
        stability = 'neutral';
      } else {
        classification = 'spiral';
        stability = l1.re < 0 ? 'stable' : 'unstable';
      }
    }

    return { eigenvalues: [l1, l2], trace, determinant: det, classification, stability };
  }

  return {
    MathCoreError,
    Complex,
    isFiniteNumber,
    isPowerOfTwo,
    dft,
    idft,
    fft,
    ifft,
    transform,
    inverseTransform,
    rk4Step,
    integrateODE,
    MAX_ODE_STEPS,
    solveLinear,
    solveQuadratic,
    polynomialRoots,
    eigen2x2,
  };
});
