// profpi — fourier-core.js fuzz + regression test
// Run with: node test-fourier-core.js
// Deterministic (seeded RNG) so failures are reproducible.

const MathCore = require('./mathcore.js');
const ExprParser = require('./expr-parser.js');
const FourierCore = require('./fourier-core.js');
const { FourierError } = FourierCore;

// Small seeded LCG, same recipe as fuzz-mathcore.js, so a failing run can
// be reproduced exactly.
let seed = 1337;
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

function isFourierErrorOnly(fn) {
  try {
    fn();
    return { threw: false };
  } catch (e) {
    return { threw: true, isFourierError: e instanceof FourierError };
  }
}

const start = Date.now();

// ── Helpers to build known ground-truth shapes ─────────────────────────
function circlePoints(n, radius, cx = 0, cy = 0) {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  });
}
function squarePoints(pointsPerSide, half) {
  const pts = [];
  const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
  for (let c = 0; c < 4; c++) {
    const [ax, ay] = corners[c];
    const [bx, by] = corners[(c + 1) % 4];
    for (let i = 0; i < pointsPerSide; i++) {
      const t = i / pointsPerSide;
      pts.push({ x: ax + t * (bx - ax), y: ay + t * (by - ay) });
    }
  }
  return pts;
}

// ── 1. resamplePolyline: known-exact behavior on a straight segment ───
(function resampleStraightLine() {
  // A 3-point polyline (0,0) -> (10,0) -> (10,10): total arc length 20.
  // Resampling to 5 points at arc-length k/5*20 should land at predictable spots.
  const raw = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  const out = FourierCore.resamplePolyline(raw, 5);
  expect('resample output length matches requested count', out.length === 5);
  // k=0 -> arc length 0 -> (0,0)
  expect('resample k=0 lands at start', Math.abs(out[0].x) < 1e-9 && Math.abs(out[0].y) < 1e-9);
  // k=1 -> arc length 4 -> still on first leg -> (4,0)
  expect('resample k=1 lands on first leg', Math.abs(out[1].x - 4) < 1e-9 && Math.abs(out[1].y) < 1e-9);
  // k=2 -> arc length 8 -> still first leg -> (8,0)
  expect('resample k=2 lands on first leg', Math.abs(out[2].x - 8) < 1e-9 && Math.abs(out[2].y) < 1e-9);
  // k=3 -> arc length 12 -> second leg, 2 units in -> (10,2)
  expect('resample k=3 lands on second leg', Math.abs(out[3].x - 10) < 1e-9 && Math.abs(out[3].y - 2) < 1e-9);
})();

// ── 2. resamplePolyline: fuzz random strokes, output is always well-formed ─
for (let i = 0; i < 200; i++) {
  const n = randInt(2, 400);
  const raw = Array.from({ length: n }, () => ({ x: randRange(-50, 50), y: randRange(-50, 50) }));
  const count = randInt(8, 300);
  const result = isFourierErrorOnly(() => FourierCore.resamplePolyline(raw, count));
  expect(`resamplePolyline never throws unexpectedly on random stroke #${i}`, !result.threw);
  if (!result.threw) {
    const out = FourierCore.resamplePolyline(raw, count);
    expect(`resamplePolyline #${i} returns exactly the requested count`, out.length === count);
    expect(`resamplePolyline #${i} output is all finite`, out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
}
// Degenerate strokes must throw FourierError cleanly, never hang or crash oddly.
const badStrokes = [
  [],
  [{ x: 1, y: 1 }],
  [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }], // all duplicates -> zero length
  [{ x: NaN, y: 0 }, { x: 1, y: 1 }],
  'not an array',
  null,
];
badStrokes.forEach((input, i) => {
  const result = isFourierErrorOnly(() => FourierCore.resamplePolyline(input, 32));
  expect(`degenerate stroke #${i} throws FourierError cleanly`, result.threw && result.isFourierError);
});
// A single non-NaN point plus one NaN point collapses to one usable point -> zero length -> throws.
expect(
  'stroke that reduces to a single usable point throws FourierError',
  isFourierErrorOnly(() => FourierCore.resamplePolyline([{ x: 1, y: 1 }, { x: NaN, y: NaN }], 16)).isFourierError
);
// Oversized raw stroke rejected.
expect(
  'stroke over MAX_RAW_STROKE_POINTS throws FourierError',
  isFourierErrorOnly(() => FourierCore.resamplePolyline(
    Array.from({ length: FourierCore.MAX_RAW_STROKE_POINTS + 1 }, (_, i) => ({ x: i, y: 0 })), 16
  )).isFourierError
);
// count beyond MAX_SAMPLES rejected.
expect(
  'count over MAX_SAMPLES throws FourierError',
  isFourierErrorOnly(() => FourierCore.resamplePolyline(circlePoints(50, 1), FourierCore.MAX_SAMPLES + 1)).isFourierError
);

// ── 3. sampleParametric: exact circle via ExprParser, and NaN-skipping ─
(function sampleParametricCircle() {
  const xFn = ExprParser.compile('cos(t)', ['t']);
  const yFn = ExprParser.compile('sin(t)', ['t']);
  const { points, skipped, totalSamples } = FourierCore.sampleParametric(xFn, yFn, { samples: 128 });
  expect('sampleParametric circle: no points skipped', skipped === 0 && points.length === totalSamples);
  expect('sampleParametric circle: all points on unit circle',
    points.every((p) => Math.abs(Math.hypot(p.x, p.y) - 1) < 1e-9));
})();
(function sampleParametricDomainIssue() {
  // x(t) = 1/t blows up at t=0 (the very first sample, i=0), which must be
  // skipped rather than aborting the whole sample.
  const xFn = ExprParser.compile('1/t', ['t']);
  const yFn = ExprParser.compile('t', ['t']);
  const { points, skipped } = FourierCore.sampleParametric(xFn, yFn, { samples: 200 });
  expect('sampleParametric skips the t=0 singularity, not the whole path', skipped >= 1 && points.length === 200 - skipped);
})();
(function sampleParametricAllBad() {
  // sqrt(-1 - t^2) is negative under the root for every t in [0, 2pi) -> always NaN.
  const xFn = ExprParser.compile('sqrt(-1 - t^2)', ['t']);
  const yFn = ExprParser.compile('t', ['t']);
  const result = isFourierErrorOnly(() => FourierCore.sampleParametric(xFn, yFn, { samples: 100 }));
  expect('sampleParametric throws FourierError when nearly everything is non-finite', result.threw && result.isFourierError);
})();
expect(
  'sampleParametric rejects non-function xFn/yFn',
  isFourierErrorOnly(() => FourierCore.sampleParametric('not a fn', () => 1)).isFourierError
);
expect(
  'sampleParametric rejects samples over MAX_PARAM_SAMPLES',
  isFourierErrorOnly(() => FourierCore.sampleParametric(() => 1, () => 1, { samples: FourierCore.MAX_PARAM_SAMPLES + 1 })).isFourierError
);

// ── 4. buildEpicycles: a perfect circle concentrates into one harmonic ─
(function circleIsOneHarmonic() {
  const R = 3.5;
  const pts = circlePoints(64, R, 1.25, -0.75); // off-center on purpose
  const { terms, fidelity, harmonicsAvailable } = FourierCore.buildEpicycles(pts, { maxHarmonics: 200 });
  expect('circle: harmonicsAvailable matches sample count', harmonicsAvailable === 64);
  // terms are sorted by amplitude descending; term[0] should be the DC
  // offset (the center, since |center| here is small-ish) OR the freq=+1
  // term, whichever is larger in magnitude — but freq=+1 amplitude should
  // be extremely close to R, and everything past the top two terms should
  // be numerically negligible.
  const freq1 = terms.find((t) => t.freq === 1);
  const dc = terms.find((t) => t.freq === 0);
  expect('circle: freq=+1 term exists and has amplitude ~= R', freq1 && Math.abs(freq1.amplitude - R) < 1e-9);
  expect('circle: DC term amplitude ~= distance from origin to center', dc && Math.abs(dc.amplitude - Math.hypot(1.25, -0.75)) < 1e-9);
  const restEnergy = terms.filter((t) => t.freq !== 0 && t.freq !== 1).reduce((s, t) => s + t.amplitude, 0);
  expect('circle: negligible energy outside freq 0 and 1', restEnergy < 1e-8);
  expect('circle: fidelity is ~1 with all harmonics kept', fidelity > 1 - 1e-9);
})();

// ── 4b. totalAmplitude exposes enough to reconstruct fidelity for ANY
//        slice locally, matching what the harmonics slider will do ──────
(function totalAmplitudeSupportsLocalFidelity() {
  const pts = squarePoints(16, 2);
  const { terms, totalAmplitude } = FourierCore.buildEpicycles(pts, { maxHarmonics: 200 });
  [1, 2, 5, 10, terms.length].forEach((n) => {
    const localFidelity = terms.slice(0, n).reduce((s, t) => s + t.amplitude, 0) / totalAmplitude;
    const { fidelity: libraryFidelity } = FourierCore.buildEpicycles(pts, { maxHarmonics: n });
    expect(`local fidelity formula matches library fidelity at n=${n}`, Math.abs(localFidelity - libraryFidelity) < 1e-9);
  });
})();

// ── 5. buildEpicycles: truncation reduces fidelity for a "busy" shape ──
(function squareTruncationLosesFidelity() {
  const pts = squarePoints(16, 2); // 64 points, a square has energy spread across many odd harmonics
  const full = FourierCore.buildEpicycles(pts, { maxHarmonics: 200 });
  const truncated = FourierCore.buildEpicycles(pts, { maxHarmonics: 2 });
  expect('square: full harmonics keep fidelity close to 1', full.fidelity > 0.999);
  expect('square: 2-harmonic truncation has lower fidelity than full', truncated.fidelity < full.fidelity);
  expect('square: truncated terms length matches requested cap', truncated.terms.length === 2);
  expect('square: terms stay amplitude-sorted descending', truncated.terms[0].amplitude >= truncated.terms[1].amplitude);
})();

// ── 6. evaluateEpicycleChain / traceCurve: round-trip reconstructs input
//     samples exactly at the sample points (all harmonics kept) ─────────
(function reconstructionRoundTrip() {
  const N = 48;
  const pts = circlePoints(N, 2, 0.5, 0.5);
  const { terms } = FourierCore.buildEpicycles(pts, { maxHarmonics: N });
  let maxErr = 0;
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / N;
    const { x, y } = FourierCore.evaluateEpicycleChain(terms, t);
    maxErr = Math.max(maxErr, Math.hypot(x - pts[i].x, y - pts[i].y));
  }
  expect(`full-harmonic reconstruction matches original samples (max err ${maxErr.toExponential(2)})`, maxErr < 1e-9);

  const traced = FourierCore.traceCurve(terms, { resolution: 100 });
  expect('traceCurve returns requested resolution', traced.length === 100);
  expect('traceCurve output is all finite', traced.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  // Every traced point should lie on the circle of radius 2 centered at (0.5,0.5).
  const maxRadiusErr = Math.max(...traced.map((p) => Math.abs(Math.hypot(p.x - 0.5, p.y - 0.5) - 2)));
  expect(`traceCurve stays on the circle (max radius err ${maxRadiusErr.toExponential(2)})`, maxRadiusErr < 1e-9);
})();

// ── 7. evaluateEpicycleChain: chain tips actually sum to the final point ─
(function chainSumsCorrectly() {
  const pts = squarePoints(10, 3);
  const { terms } = FourierCore.buildEpicycles(pts, { maxHarmonics: 15 });
  const { x, y, chain } = FourierCore.evaluateEpicycleChain(terms, 1.234);
  let sx = 0, sy = 0;
  chain.forEach((link) => { sx += link.dx; sy += link.dy; });
  expect('chain vector sum matches returned (x, y)', Math.abs(sx - x) < 1e-9 && Math.abs(sy - y) < 1e-9);
  // Each link's stored (x,y) should be the running sum of all previous links.
  let runX = 0, runY = 0, chainOk = true;
  chain.forEach((link) => {
    if (Math.abs(link.x - runX) > 1e-9 || Math.abs(link.y - runY) > 1e-9) chainOk = false;
    runX += link.dx; runY += link.dy;
  });
  expect('each chain link starts where the previous one ended', chainOk);
})();

// ── 8. Fuzz buildEpicycles/evaluateEpicycleChain/traceCurve/spectrum:
//    never throw unexpectedly, never produce NaN, on random point clouds ─
for (let i = 0; i < 150; i++) {
  const n = randInt(FourierCore.MIN_SAMPLES, 200);
  const pts = Array.from({ length: n }, () => ({ x: randRange(-20, 20), y: randRange(-20, 20) }));
  const maxHarmonics = randInt(1, Math.min(n, FourierCore.MAX_HARMONICS));
  const result = isFourierErrorOnly(() => FourierCore.buildEpicycles(pts, { maxHarmonics }));
  expect(`buildEpicycles never throws unexpectedly on random cloud #${i}`, !result.threw);
  if (result.threw) continue;

  const { terms, fidelity } = FourierCore.buildEpicycles(pts, { maxHarmonics });
  expect(`buildEpicycles #${i} respects maxHarmonics cap`, terms.length === Math.min(maxHarmonics, n));
  expect(`buildEpicycles #${i} fidelity is within [0,1]`, fidelity >= -1e-9 && fidelity <= 1 + 1e-9);
  expect(`buildEpicycles #${i} terms sorted descending`, terms.every((t, idx) => idx === 0 || terms[idx - 1].amplitude >= t.amplitude - 1e-9));

  const t = randRange(0, 2 * Math.PI);
  const { x, y, chain } = FourierCore.evaluateEpicycleChain(terms, t);
  expect(`evaluateEpicycleChain #${i} output finite`, Number.isFinite(x) && Number.isFinite(y));
  expect(`evaluateEpicycleChain #${i} chain length matches terms`, chain.length === terms.length);

  const spec = FourierCore.spectrum(terms);
  expect(`spectrum #${i} length matches terms`, spec.length === terms.length);
  expect(`spectrum #${i} amplitudes all non-negative`, spec.every((s) => s.amplitude >= 0));
}
// Malformed buildEpicycles input must throw cleanly.
const badEpicycleInputs = [
  [],
  Array.from({ length: 3 }, () => ({ x: 0, y: 0 })), // below MIN_SAMPLES
  Array.from({ length: FourierCore.MAX_SAMPLES + 1 }, () => ({ x: 0, y: 0 })), // above MAX_SAMPLES
  [{ x: NaN, y: 0 }, ...circlePoints(20, 1)],
  'nope',
];
badEpicycleInputs.forEach((input, i) => {
  const result = isFourierErrorOnly(() => FourierCore.buildEpicycles(input));
  expect(`malformed buildEpicycles input #${i} throws FourierError`, result.threw && result.isFourierError);
});
expect(
  'buildEpicycles rejects maxHarmonics over MAX_HARMONICS',
  isFourierErrorOnly(() => FourierCore.buildEpicycles(circlePoints(50, 1), { maxHarmonics: FourierCore.MAX_HARMONICS + 1 })).isFourierError
);

// ── 9. boundingBox: sanity + padding direction ─────────────────────────
(function boundingBoxChecks() {
  const points = [{ x: -1, y: -2 }, { x: 3, y: 4 }];
  const box = FourierCore.boundingBox(points, { padding: 0 });
  expect('boundingBox contains every input point', points.every((p) => p.x >= box.xMin && p.x <= box.xMax && p.y >= box.yMin && p.y <= box.yMax));
  expect('boundingBox is square (equal x/y span, so circles render as circles)',
    Math.abs((box.xMax - box.xMin) - (box.yMax - box.yMin)) < 1e-9);
  expect('boundingBox is well-ordered', box.xMin < box.xMax && box.yMin < box.yMax);

  const padded = FourierCore.boundingBox([{ x: 0, y: 0 }, { x: 10, y: 0 }], { padding: 0.5 });
  const tight = FourierCore.boundingBox([{ x: 0, y: 0 }, { x: 10, y: 0 }], { padding: 0 });
  expect('boundingBox padding widens the box', (padded.xMax - padded.xMin) > (tight.xMax - tight.xMin));
})();
expect(
  'boundingBox rejects empty input',
  isFourierErrorOnly(() => FourierCore.boundingBox([])).isFourierError
);

// ── 10. End-to-end pipeline exactly as the page controller will call it ─
(function endToEndPipeline() {
  // A wobbly hand-drawn-ish stroke: base circle plus 3rd-harmonic wobble.
  const raw = [];
  for (let i = 0; i < 300; i++) {
    const a = (2 * Math.PI * i) / 300;
    const r = 5 + 0.6 * Math.sin(3 * a);
    raw.push({ x: r * Math.cos(a) + randRange(-0.01, 0.01), y: r * Math.sin(a) + randRange(-0.01, 0.01) });
  }
  const resampled = FourierCore.resamplePolyline(raw, 256);
  const { terms, fidelity } = FourierCore.buildEpicycles(resampled, { maxHarmonics: 40 });
  // The underlying curve is exactly 3 harmonics wide (freq 1, 4, -2); arc-length
  // resampling reparametrizes by speed, which mildly spreads that into
  // neighboring bins, so this checks "well over 95%", not "near-perfect".
  expect('end-to-end: high fidelity for a smooth wobble well under the harmonic cap', fidelity > 0.95);
  const traced = FourierCore.traceCurve(terms, { resolution: 200 });
  const box = FourierCore.boundingBox(traced, { padding: 0.1 });
  expect('end-to-end: traced curve stays inside its own padded bounding box',
    traced.every((p) => p.x >= box.xMin && p.x <= box.xMax && p.y >= box.yMin && p.y <= box.yMax));
})();

// ── Summary ────────────────────────────────────────────────────────────
const elapsed = Date.now() - start;
console.log(`${checks} checks run in ${elapsed}ms`);
if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURES:`);
  failures.slice(0, 40).forEach((f) => console.log(`  - ${f}`));
  if (failures.length > 40) console.log(`  ...and ${failures.length - 40} more`);
  process.exit(1);
} else {
  console.log('No failures. Nothing hung, nothing threw an undocumented error, all invariants held.');
  process.exit(0);
}
