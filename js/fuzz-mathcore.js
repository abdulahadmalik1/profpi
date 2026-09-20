// profpi — mathcore.js fuzz test
// Run with: node fuzz-mathcore.js
// Deterministic (seeded RNG) so failures are reproducible.

const MathCore = require('./mathcore.js');
const { Complex, MathCoreError } = MathCore;

// Small seeded LCG so a failing run can be reproduced exactly.
let seed = 42;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function randRange(min, max) { return min + rand() * (max - min); }
function randInt(min, max) { return Math.floor(randRange(min, max + 1)); }

let checks = 0;
let failures = [];

function expect(label, condition) {
  checks++;
  if (!condition) failures.push(label);
}

function isMathCoreErrorOnly(fn) {
  try {
    fn();
    return { threw: false };
  } catch (e) {
    return { threw: true, isMathCoreError: e instanceof MathCoreError };
  }
}

const TRIALS = 500;
const start = Date.now();

// ── Fuzz Complex arithmetic ───────────────────────────────────────────
for (let i = 0; i < TRIALS; i++) {
  const a = new Complex(randRange(-1e6, 1e6), randRange(-1e6, 1e6));
  const b = new Complex(randRange(-1e6, 1e6), randRange(-1e6, 1e6));
  const sum = a.add(b);
  const back = sum.sub(b);
  expect(`Complex round-trip add/sub #${i}`, Math.abs(back.re - a.re) < 1e-6 && Math.abs(back.im - a.im) < 1e-6);
  expect(`Complex abs is non-negative #${i}`, a.abs() >= 0);

  if (b.re !== 0 || b.im !== 0) {
    const quotient = a.div(b);
    const restored = quotient.mul(b);
    expect(`Complex round-trip mul/div #${i}`, Math.abs(restored.re - a.re) < 1e-3 && Math.abs(restored.im - a.im) < 1e-3);
  }
}
// Division by zero must always throw MathCoreError, never crash differently.
for (let i = 0; i < 20; i++) {
  const a = new Complex(randRange(-10, 10), randRange(-10, 10));
  const result = isMathCoreErrorOnly(() => a.div(new Complex(0, 0)));
  expect(`div by zero throws MathCoreError cleanly #${i}`, result.threw && result.isMathCoreError);
}

// ── Fuzz DFT/FFT at random lengths, including odd/prime/huge-ish ─────
const sizesToTry = [1, 2, 3, 5, 6, 7, 8, 13, 16, 17, 31, 32, 63, 64];
for (const N of sizesToTry) {
  const signal = Array.from({ length: N }, () => randRange(-10, 10));
  const result = isMathCoreErrorOnly(() => MathCore.transform(signal));
  expect(`transform() never throws for length ${N}`, !result.threw);

  const spectrum = MathCore.transform(signal);
  const restored = MathCore.inverseTransform(spectrum);
  const roundTripOk = restored.every((c, idx) => Math.abs(c.re - signal[idx]) < 1e-6 && Math.abs(c.im) < 1e-6);
  expect(`inverseTransform(transform(x)) round-trips at length ${N}`, roundTripOk);
}
// fft() specifically must reject every non-power-of-two length, cleanly.
for (const N of [3, 5, 6, 7, 9, 10, 11, 13, 15]) {
  const signal = Array.from({ length: N }, () => 1);
  const result = isMathCoreErrorOnly(() => MathCore.fft(signal));
  expect(`fft() cleanly rejects length ${N}`, result.threw && result.isMathCoreError);
}

// ── Fuzz integrateODE with random *linear* systems (bounded, so we know
//    analytically whether blow-up is expected) ────────────────────────
for (let i = 0; i < 100; i++) {
  const k = randRange(-5, 5); // dy/dt = k*y  =>  y = y0 * e^(k*t)
  const y0 = randRange(0.1, 5);
  const h = 0.001;
  const steps = 500;
  const result = isMathCoreErrorOnly(() =>
    MathCore.integrateODE((t, y) => k * y, { t0: 0, y0, h, steps })
  );
  expect(`integrateODE never throws on a bounded linear system #${i}`, !result.threw);

  const { trajectory, blewUp } = MathCore.integrateODE((t, y) => k * y, { t0: 0, y0, h, steps });
  const analyticalFinal = y0 * Math.exp(k * h * steps);
  const numericalFinal = trajectory[trajectory.length - 1].y;
  if (Number.isFinite(analyticalFinal) && Math.abs(analyticalFinal) < 1e7) {
    expect(`integrateODE matches analytical e^(kt) solution #${i}`, !blewUp && Math.abs(numericalFinal - analyticalFinal) / Math.max(1, Math.abs(analyticalFinal)) < 0.01);
  }
  expect(`integrateODE trajectory has no NaN/Infinity #${i}`, trajectory.every((p) => Number.isFinite(p.y)));
}
// Malformed ODE inputs must throw MathCoreError, never hang or crash oddly.
const badOdeInputs = [
  { t0: NaN, y0: 1, h: 0.1, steps: 10 },
  { t0: 0, y0: 1, h: 0.1, steps: 0 },
  { t0: 0, y0: 1, h: 0.1, steps: 1.5 },
  { t0: 0, y0: [1, NaN], h: 0.1, steps: 10 },
];
badOdeInputs.forEach((cfg, i) => {
  const result = isMathCoreErrorOnly(() => MathCore.integrateODE((t, y) => y, cfg));
  expect(`malformed ODE input #${i} throws MathCoreError`, result.threw && result.isMathCoreError);
});

// ── Fuzz polynomialRoots at random degrees, verify roots actually solve
//    the polynomial (residual check), and that bad input never hangs ──
function evalPolyAt(coeffs, z) {
  let result = new Complex(0, 0);
  for (const c of coeffs) result = result.mul(z).add(new Complex(c, 0));
  return result;
}
for (let i = 0; i < 100; i++) {
  const degree = randInt(1, 6);
  const coeffs = [randRange(0.5, 3)]; // nonzero leading coefficient
  for (let d = 0; d < degree; d++) coeffs.push(randRange(-10, 10));

  const result = isMathCoreErrorOnly(() => MathCore.polynomialRoots(coeffs));
  expect(`polynomialRoots never throws unexpectedly for degree ${degree} #${i}`, !result.threw);

  const { roots, converged } = MathCore.polynomialRoots(coeffs);
  if (converged) {
    const maxResidual = Math.max(...roots.map((r) => evalPolyAt(coeffs, r).abs()));
    // Residual tolerance is loose relative to coefficient scale — Durand-Kerner
    // on ill-conditioned random polynomials can leave small numerical slack.
    const scale = Math.max(1, ...coeffs.map(Math.abs));
    expect(`polynomialRoots roots satisfy the polynomial within tolerance #${i}`, maxResidual < scale * 1e-3);
  }
}
// Malformed polynomial input must throw cleanly, never hang.
const badPolyInputs = [[], [0, 0, 0], 'nope', [1, NaN], [Infinity, 1]];
badPolyInputs.forEach((input, i) => {
  const result = isMathCoreErrorOnly(() => MathCore.polynomialRoots(input));
  expect(`malformed polynomial input #${i} throws MathCoreError`, result.threw && result.isMathCoreError);
});

// ── Fuzz eigen2x2: trace/determinant invariants must always hold ─────
for (let i = 0; i < 200; i++) {
  const a = randRange(-10, 10);
  const b = randRange(-10, 10);
  const c = randRange(-10, 10);
  const d = randRange(-10, 10);
  const r = MathCore.eigen2x2(a, b, c, d);
  const [l1, l2] = r.eigenvalues;
  const sumRe = l1.re + l2.re;
  const sumIm = l1.im + l2.im;
  const prod = l1.mul(l2);
  expect(`eigen2x2 eigenvalues sum to trace #${i}`, Math.abs(sumRe - r.trace) < 1e-6 && Math.abs(sumIm) < 1e-6);
  expect(`eigen2x2 eigenvalues multiply to determinant #${i}`, Math.abs(prod.re - r.determinant) < 1e-6 && Math.abs(prod.im) < 1e-6);
  expect(`eigen2x2 always returns a known classification #${i}`, ['node', 'saddle', 'spiral', 'center', 'degenerate node'].includes(r.classification));
}

// ── Summary ────────────────────────────────────────────────────────────
const elapsed = Date.now() - start;
console.log(`${checks} checks run in ${elapsed}ms`);
if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURES:`);
  failures.slice(0, 30).forEach((f) => console.log(`  - ${f}`));
  if (failures.length > 30) console.log(`  ...and ${failures.length - 30} more`);
  process.exit(1);
} else {
  console.log('No failures. Nothing hung, nothing threw an undocumented error, all invariants held.');
  process.exit(0);
}
