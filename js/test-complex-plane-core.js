// profpi — complex-plane-core.js test suite
// Run with: node test-complex-plane-core.js
//
// The hard problem this file solves: there's no WebGL context in Node, so
// we can't literally run the generated fragment shader here. Instead, since
// the codegen's output (see complex-plane-core.js's nodeToGLSL) NEVER uses
// a raw JS-incompatible GLSL construct — no swizzles, no raw arithmetic on
// vec2, everything complex-valued goes through named function calls like
// cAdd/cMul/cSin — the generated GLSL expression text is *also* valid JS,
// given JS shims for vec2()/cAdd()/sin()/etc. that reproduce GLSL's exact
// semantics. That lets us literally execute the shader body via
// `new Function(...)` in Node and compare it, point by point, against the
// independent CPU reference evaluator (mathcore.Complex-based). This is
// the same spirit as phase 3's finite-difference gradient check: an actual
// executable proof, not just a read-through.

const MathCore = require('./mathcore.js');
const CPCore = require('./complex-plane-core.js');
const { Complex } = MathCore;

let checks = 0;
let failures = [];
function expect(label, condition) {
  checks++;
  if (!condition) failures.push(label);
}

// Seeded LCG, same convention as fuzz-mathcore.js, so failures reproduce.
let seed = 99;
function rand() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
function randRange(a, b) { return a + rand() * (b - a); }

// ── JS shims reproducing GLSL semantics exactly (see file header) ──────
function makeShims() {
  const gSinh = (x) => (Math.exp(x) - Math.exp(-x)) * 0.5;
  const gCosh = (x) => (Math.exp(x) + Math.exp(-x)) * 0.5;
  const gTanh = (x) => { const e2 = Math.exp(2 * x); return (e2 - 1) / (e2 + 1); };
  const gCbrt = (x) => Math.sign(x) * Math.pow(Math.abs(x), 1 / 3);
  const gLog10 = (x) => Math.log(x) / Math.log(10);
  const gRound = (x) => Math.floor(x + 0.5);
  const gMod = (a, b) => a - b * Math.floor(a / b);
  const vec2 = (a, b) => [a, b];
  const cAdd = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const cSub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const cNeg = (a) => [-a[0], -a[1]];
  const cMul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const cDiv = (a, b) => {
    const d = Math.max(b[0] * b[0] + b[1] * b[1], 1e-20);
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
  };
  const cAbs = (a) => Math.hypot(a[0], a[1]);
  const cExp = (a) => { const r = Math.exp(a[0]); return [r * Math.cos(a[1]), r * Math.sin(a[1])]; };
  const cLog = (a) => { const m = Math.hypot(a[0], a[1]); return [Math.log(Math.max(m, 1e-20)), Math.atan2(a[1], a[0])]; };
  const cSqrt = (a) => {
    const r = Math.hypot(a[0], a[1]);
    const re = Math.sqrt(Math.max((r + a[0]) * 0.5, 0));
    const imSign = a[1] < 0 ? -1 : 1;
    const im = imSign * Math.sqrt(Math.max((r - a[0]) * 0.5, 0));
    return [re, im];
  };
  const cSin = (a) => [Math.sin(a[0]) * gCosh(a[1]), Math.cos(a[0]) * gSinh(a[1])];
  const cCos = (a) => [Math.cos(a[0]) * gCosh(a[1]), -Math.sin(a[0]) * gSinh(a[1])];
  const cTan = (a) => cDiv(cSin(a), cCos(a));
  const cPow = (base, expo) => {
    if (base[0] === 0 && base[1] === 0) {
      if (expo[1] === 0 && expo[0] > 0) return [0, 0];
      return [NaN, NaN];
    }
    return cExp(cMul(cLog(base), expo));
  };
  const atan = (y, x) => (x === undefined ? Math.atan(y) : Math.atan2(y, x));
  return {
    gSinh, gCosh, gTanh, gCbrt, gLog10, gRound, gMod, vec2,
    cAdd, cSub, cNeg, cMul, cDiv, cAbs, cExp, cLog, cSqrt, cSin, cCos, cTan, cPow, atan,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, sqrt: Math.sqrt, log: Math.log,
    asin: Math.asin, acos: Math.acos, sign: Math.sign, floor: Math.floor, ceil: Math.ceil,
    log2: Math.log2, pow: Math.pow, min: Math.min, max: Math.max, abs: Math.abs,
  };
}

function evalGLSLBody(glslBody, zRe, zIm) {
  const shims = makeShims();
  const names = Object.keys(shims);
  const fn = new Function(...names, 'z', `return ${glslBody};`);
  return fn(...names.map((n) => shims[n]), [zRe, zIm]);
}

// ── 1. Type-checker must reject real-only functions given complex args ──
const shouldReject = [
  'asin(z)', 'acos(z)', 'atan(z)', 'sinh(z)', 'cosh(z)', 'tanh(z)',
  'cbrt(z)', 'log10(z)', 'log2(z)', 'sign(z)', 'floor(z)', 'ceil(z)', 'round(z)',
  'atan2(z, 1)', 'atan2(1, z)', 'pow(z, 2)', 'mod(z, 1)', 'min(z, 1)', 'max(z, 1, 2)',
];
shouldReject.forEach((expr) => {
  let threw = false, isRightType = false;
  try { CPCore.compileComplexExpr(expr); } catch (e) { threw = true; isRightType = e instanceof CPCore.ComplexPlaneError; }
  expect(`"${expr}" is rejected with ComplexPlaneError (real-only fn on complex arg)`, threw && isRightType);
});

// Whole-expression-must-be-complex guard
const shouldRejectTopLevelReal = ['abs(z)', 'floor(abs(z))', 'abs(z) + sign(z-1)'];
shouldRejectTopLevelReal.forEach((expr) => {
  let threw = false, isRightType = false;
  try { CPCore.compileComplexExpr(expr); } catch (e) { threw = true; isRightType = e instanceof CPCore.ComplexPlaneError; }
  expect(`"${expr}" (real overall) is rejected`, threw && isRightType);
});

// These mix real-only functions on genuinely real sub-expressions and must be ACCEPTED
const shouldAccept = ['floor(abs(z)) + 0*z', 'z^2 + sign(pi)*z', 'z * min(2, 3)'];
shouldAccept.forEach((expr) => {
  let ok = true;
  try { CPCore.compileComplexExpr(expr); } catch (e) { ok = false; }
  expect(`"${expr}" (real-only fn on a real sub-expr) compiles cleanly`, ok);
});

// ── 2. CPU evaluator matches hand-computed values at known points ──────
function approxEqualComplex(c, re, im, tol = 1e-9) {
  return Math.abs(c.re - re) < tol && Math.abs(c.im - im) < tol;
}
(function knownValues() {
  const z2 = CPCore.compileComplexExpr('z^2').evalAt(new Complex(2, 3));
  expect('z^2 at z=2+3i == -5+12i', approxEqualComplex(z2, -5, 12));

  const invZ = CPCore.compileComplexExpr('1/z').evalAt(new Complex(0, 2));
  expect('1/z at z=2i == 0 - 0.5i', approxEqualComplex(invZ, 0, -0.5));

  const expZ = CPCore.compileComplexExpr('exp(z)').evalAt(new Complex(0, Math.PI));
  expect('exp(z) at z=i*pi == -1+0i (Euler)', approxEqualComplex(expZ, -1, 0, 1e-6));

  const sinZ = CPCore.compileComplexExpr('sin(z)').evalAt(new Complex(Math.PI / 2, 0));
  expect('sin(z) at z=pi/2 == 1+0i', approxEqualComplex(sinZ, 1, 0, 1e-6));
})();

// ── 3. Executable GLSL-vs-CPU consistency check (the real proof) ───────
const exprsToFuzz = [
  'z^2', 'z^3 - 1', '1/z', '(z-1)/(z+1)', '(z^2-1)/(z^2+1)',
  'exp(z)', 'sin(z)', 'cos(z)', 'tan(z)', 'log(z)', 'sqrt(z)',
  'z^2 + sign(pi)*z', 'floor(abs(z)) + 0*z', 'z * min(2,3) - exp(-z)',
];
let consistencyChecks = 0;
exprsToFuzz.forEach((expr) => {
  const compiled = CPCore.compileComplexExpr(expr);
  for (let i = 0; i < 25; i++) {
    const zRe = randRange(-4, 4);
    const zIm = randRange(-4, 4);
    // Skip the rare case that lands (numerically) exactly on a pole the CPU
    // evaluator legitimately throws on (Complex.div by exact 0+0i) — that's
    // correct MathCoreError behavior, not something to fuzz through.
    let cpuResult;
    try {
      cpuResult = compiled.evalAt(new Complex(zRe, zIm));
    } catch (e) {
      continue;
    }
    const shaderResult = evalGLSLBody(compiled.glsl, zRe, zIm);
    consistencyChecks++;
    const tol = 1e-6; // both sides are double-precision JS here, should agree tightly
    expect(
      `GLSL vs CPU match for "${expr}" at z=${zRe.toFixed(3)}+${zIm.toFixed(3)}i`,
      Math.abs(shaderResult[0] - cpuResult.re) < tol && Math.abs(shaderResult[1] - cpuResult.im) < tol
    );
  }
});
console.log(`[GLSL-vs-CPU] ${consistencyChecks} point-by-point comparisons across ${exprsToFuzz.length} expressions.`);

// ── 4. Presets: poles/zeros are real roots of the stated polynomial ────
function evalPolyAt(coeffs, z) {
  let result = new Complex(0, 0);
  for (const c of coeffs) result = result.mul(z).add(new Complex(c, 0));
  return result;
}
CPCore.PRESETS.forEach((preset) => {
  // Every preset's expr must itself compile (dogfooding the same path the UI uses).
  let compiled;
  try { compiled = CPCore.compileComplexExpr(preset.expr); } catch (e) { compiled = null; }
  expect(`preset "${preset.id}" expr compiles`, !!compiled);

  const pz = CPCore.polesAndZeros(preset);
  if (!pz.available) return;
  if (pz.zerosConverged) {
    const maxResidual = Math.max(0, ...pz.zeros.map((r) => evalPolyAt(preset.numerator, r).abs()));
    expect(`preset "${preset.id}" zeros satisfy numerator`, maxResidual < 1e-3);
  }
  if (pz.polesConverged) {
    const maxResidual = Math.max(0, ...pz.poles.map((r) => evalPolyAt(preset.denominator, r).abs()));
    expect(`preset "${preset.id}" poles satisfy denominator`, maxResidual < 1e-3);
  }
});

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`${checks} checks run.`);
if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURES:`);
  failures.slice(0, 40).forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
} else {
  console.log('No failures. Type-checker, CPU evaluator, GLSL codegen (executed via JS shim), and preset poles/zeros all verified.');
  process.exit(0);
}
