// profpi — Fourier Explorer Core (epicycles + frequency spectrum)
//
// Pure computational logic, no DOM access. Turns a 2D path — either drawn
// freehand or a typed parametric curve x(t), y(t) compiled via ExprParser —
// into a complex Fourier series: a sorted chain of rotating "epicycle"
// vectors whose sum traces the path, plus the frequency-magnitude spectrum
// behind it. Used by fourier-explorer.js, which owns no math of its own.
//
// Design rules (kept consistent with mathcore.js / neural-ode-core.js):
//  1. Every public function validates its inputs and throws a typed
//     FourierError with a specific, actionable message on invalid input.
//  2. Hard caps on every point/sample/harmonic count so pathological input
//     (a huge freehand stroke, a dense parametric sample, an unbounded
//     harmonic slider) can never hang the tab.
//  3. Numerically expected "failures" are reported via a status flag, not
//     thrown — a truncated harmonic count that loses fidelity still
//     returns something drawable, with a `fidelity` score attached, same
//     philosophy as `converged` on polynomialRoots / `blewUp` on
//     integrateODE.
//  4. No dependencies except MathCore (Complex + transform). Works
//     identically in the browser (as global `FourierCore`) and in Node
//     (module.exports), so it can be unit tested without a browser.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./mathcore.js'));
  } else {
    root.FourierCore = factory(root.MathCore);
  }
})(typeof self !== 'undefined' ? self : this, function (MathCore) {
  'use strict';

  if (!MathCore) {
    throw new Error('fourier-core.js requires mathcore.js to be loaded first.');
  }
  const { Complex } = MathCore;

  class FourierError extends Error {
    constructor(message) {
      super(message);
      this.name = 'FourierError';
    }
  }

  // ── Hard caps ───────────────────────────────────────────────────────
  const MAX_RAW_STROKE_POINTS = 5000; // guard against a runaway pointermove flood
  const MAX_SAMPLES = 512;            // resample target fed to the transform — smooth enough, bounded cost
  const MIN_SAMPLES = 8;              // below this a "curve" is too degenerate to have a meaningful spectrum
  const MAX_PARAM_SAMPLES = 2000;     // pre-resample density when sampling a typed x(t), y(t)
  const MAX_HARMONICS = 200;          // cap on rendered epicycles, independent of transform size
  const MAX_TRACE_RESOLUTION = 2000;  // cap on points used to draw the static traced-curve preview
  const MIN_PATH_SPAN = 1e-9;         // paths shorter than this (in whatever units points are in) are "zero-length"

  // ── Small validation helpers ─────────────────────────────────────────
  function assertFiniteNumber(x, label) {
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw new FourierError(`${label} must be a finite number, got ${JSON.stringify(x)}`);
    }
  }

  function assertPositiveInteger(x, label, max) {
    if (!Number.isInteger(x) || x <= 0) {
      throw new FourierError(`${label} must be a positive integer, got ${JSON.stringify(x)}`);
    }
    if (max !== undefined && x > max) {
      throw new FourierError(`${label} is capped at ${max} to keep this in the browser responsive, got ${x}`);
    }
  }

  function isFinitePoint(p) {
    return !!p && typeof p.x === 'number' && typeof p.y === 'number' &&
      Number.isFinite(p.x) && Number.isFinite(p.y);
  }

  // ── Path resampling ───────────────────────────────────────────────────
  //
  // Arc-length resample: given a polyline (array of {x,y}, e.g. raw
  // pointermove samples), returns exactly `count` points evenly spaced by
  // arc length — NOT by array index. A freehand stroke where the pointer
  // paused bunches up raw samples in one spot; resampling by arc length
  // means that pause doesn't bias the spectrum toward whatever the mouse
  // happened to dawdle on. Treats the path as one closed loop covering
  // parameter t in [0, 2π) (i.e. it does not duplicate the start point at
  // the end — the loop closes implicitly, same convention the DFT and
  // evaluateEpicycleChain below both assume).
  function resamplePolyline(points, count) {
    if (!Array.isArray(points)) {
      throw new FourierError(`points must be an array, got ${typeof points}`);
    }
    if (points.length > MAX_RAW_STROKE_POINTS) {
      throw new FourierError(
        `Raw path has ${points.length} points, over the ${MAX_RAW_STROKE_POINTS} cap — stroke was too long/detailed.`
      );
    }
    assertPositiveInteger(count, 'count', MAX_SAMPLES);

    // Drop non-finite and consecutive-duplicate points (malformed pointer
    // events, or the pointer sitting still) before measuring arc length.
    const cleaned = [];
    for (const p of points) {
      if (!isFinitePoint(p)) continue; // silently drop — pointer/input glitches happen constantly, not exceptional
      const prev = cleaned[cleaned.length - 1];
      if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-9) cleaned.push({ x: p.x, y: p.y });
    }
    if (cleaned.length === 0) {
      throw new FourierError('No usable points in the path (every point was missing, non-finite, or a duplicate).');
    }
    if (cleaned.length === 1) {
      throw new FourierError('The path has zero length — draw a stroke with some extent, not a single dot.');
    }

    const cum = [0];
    for (let i = 1; i < cleaned.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(cleaned[i].x - cleaned[i - 1].x, cleaned[i].y - cleaned[i - 1].y));
    }
    const total = cum[cum.length - 1];
    if (total < MIN_PATH_SPAN) {
      throw new FourierError('The path has zero length — draw a stroke with some extent, not a single dot.');
    }

    const out = new Array(count);
    let seg = 1;
    for (let k = 0; k < count; k++) {
      const target = (k / count) * total; // half-open [0, total): loop closes back to point 0 implicitly
      while (seg < cum.length - 1 && cum[seg] < target) seg++;
      const segStart = cum[seg - 1];
      const segEnd = cum[seg];
      const frac = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
      const a = cleaned[seg - 1];
      const b = cleaned[seg];
      out[k] = { x: a.x + frac * (b.x - a.x), y: a.y + frac * (b.y - a.y) };
    }
    return out;
  }

  // Samples a typed parametric curve x(t), y(t) for t in [0, 2π) using
  // compiled ExprParser closures (never eval, never new Function — the
  // caller is expected to have produced xFn/yFn via ExprParser.compile).
  // Skips any sample where either expression goes non-finite instead of
  // aborting the whole path — same convention as PhasePortrait's field
  // sampling (a bad domain point is excluded and reported, not fatal).
  function sampleParametric(xFn, yFn, { samples = 400 } = {}) {
    if (typeof xFn !== 'function' || typeof yFn !== 'function') {
      throw new FourierError('sampleParametric requires compiled x(t) and y(t) functions (see ExprParser.compile).');
    }
    assertPositiveInteger(samples, 'samples', MAX_PARAM_SAMPLES);

    const points = [];
    let skipped = 0;
    for (let i = 0; i < samples; i++) {
      const t = (2 * Math.PI * i) / samples;
      let x, y;
      try { x = xFn(t); } catch (e) { x = NaN; }
      try { y = yFn(t); } catch (e) { y = NaN; }
      if (Number.isFinite(x) && Number.isFinite(y)) {
        points.push({ x, y });
      } else {
        skipped++;
      }
    }
    if (points.length < MIN_SAMPLES) {
      throw new FourierError(
        `x(t)/y(t) produced fewer than ${MIN_SAMPLES} finite points over [0, 2\u03c0) (${skipped} of ${samples} were NaN/Infinity) ` +
        `— check the expressions for domain issues (e.g. dividing by t at t=0).`
      );
    }
    return { points, skipped, totalSamples: samples };
  }

  // ── Fourier series construction ─────────────────────────────────────
  //
  // Turns a path (array of {x,y}, already resampled/sampled to N points
  // evenly indexed over one period) into a sorted list of epicycle terms
  // { freq, amplitude, phase }, one per transform bin, sorted by
  // amplitude descending so truncating the array keeps the most visually
  // important circles first.
  //
  // `freq` is a signed integer harmonic index (…,-2,-1,0,1,2,…): negative
  // frequencies rotate clockwise, positive counter-clockwise, 0 is the
  // path's centroid (DC offset). That's the traditional "epicycles"
  // enumeration, folded from the DFT's natural [0..N-1] bin order — the
  // fold matters because it's what makes evaluateEpicycleChain interpolate
  // smoothly *between* the original N samples instead of aliasing.
  function buildEpicycles(points, { maxHarmonics = MAX_HARMONICS } = {}) {
    if (!Array.isArray(points)) {
      throw new FourierError(`points must be an array, got ${typeof points}`);
    }
    if (points.length < MIN_SAMPLES) {
      throw new FourierError(`buildEpicycles needs at least ${MIN_SAMPLES} points, got ${points.length}`);
    }
    if (points.length > MAX_SAMPLES) {
      throw new FourierError(`buildEpicycles is capped at ${MAX_SAMPLES} input points, got ${points.length}`);
    }
    points.forEach((p, i) => {
      if (!isFinitePoint(p)) throw new FourierError(`points[${i}] must be a finite {x, y} point, got ${JSON.stringify(p)}`);
    });
    assertPositiveInteger(maxHarmonics, 'maxHarmonics', MAX_HARMONICS);

    const N = points.length;
    const complexSamples = points.map((p) => new Complex(p.x, p.y));
    const coeffs = MathCore.transform(complexSamples); // length N, natural bin order 0..N-1

    const terms = coeffs.map((c, k) => {
      const freq = k <= N / 2 ? k : k - N; // fold to signed frequency range (-N/2, N/2]
      return { freq, amplitude: c.abs() / N, phase: c.arg() };
    });

    terms.sort((a, b) => b.amplitude - a.amplitude);
    const kept = terms.slice(0, Math.min(maxHarmonics, terms.length));

    const totalAmplitude = terms.reduce((s, t) => s + t.amplitude, 0);
    const keptAmplitude = kept.reduce((s, t) => s + t.amplitude, 0);
    // Fidelity is the fraction of total spectral energy (by amplitude,
    // not power — matches how visibly "close" the truncated trace looks)
    // retained after truncation. A blank/degenerate path has totalAmplitude
    // 0; treat that as perfect fidelity rather than 0/0 = NaN.
    const fidelity = totalAmplitude > 1e-12 ? keptAmplitude / totalAmplitude : 1;

    // totalAmplitude is exposed so a caller (e.g. a harmonics slider in the
    // UI) can compute fidelity for any smaller slice of `terms` locally —
    // fidelity(n) = sum(terms.slice(0,n).amplitude) / totalAmplitude —
    // without re-invoking the transform on every slider tick.
    return { terms: kept, N, harmonicsAvailable: terms.length, fidelity, totalAmplitude };
  }

  // Evaluates the (possibly truncated) epicycle sum at parameter t,
  // returning both the final traced point and the intermediate chain of
  // vector tips — the chain is what you draw as the classic "circles
  // spinning on circles" animation frame.
  function evaluateEpicycleChain(terms, t) {
    if (!Array.isArray(terms)) {
      throw new FourierError(`terms must be an array (the .terms from buildEpicycles), got ${typeof terms}`);
    }
    assertFiniteNumber(t, 't');
    let x = 0, y = 0;
    const chain = new Array(terms.length);
    for (let i = 0; i < terms.length; i++) {
      const { freq, amplitude, phase } = terms[i];
      const angle = freq * t + phase;
      const dx = amplitude * Math.cos(angle);
      const dy = amplitude * Math.sin(angle);
      chain[i] = { x, y, freq, amplitude, dx, dy };
      x += dx;
      y += dy;
    }
    return { x, y, chain };
  }

  // Traces the full curve at `resolution` points over one period, for
  // drawing the static "ghost" path the epicycles sum up to — independent
  // of animation playback state.
  function traceCurve(terms, { resolution = 300 } = {}) {
    assertPositiveInteger(resolution, 'resolution', MAX_TRACE_RESOLUTION);
    const path = new Array(resolution);
    for (let i = 0; i < resolution; i++) {
      const t = (2 * Math.PI * i) / resolution;
      const { x, y } = evaluateEpicycleChain(terms, t);
      path[i] = { x, y };
    }
    return path;
  }

  // Spectrum for the bar chart: { freq, amplitude } per kept term, in the
  // same amplitude-descending order buildEpicycles already sorted them in
  // — callers that want frequency-axis order can sort by freq themselves.
  function spectrum(terms) {
    if (!Array.isArray(terms)) {
      throw new FourierError(`terms must be an array (the .terms from buildEpicycles), got ${typeof terms}`);
    }
    return terms.map((t) => ({ freq: t.freq, amplitude: t.amplitude }));
  }

  // Axis-aligned bounding box of a point list, with optional symmetric
  // padding (as a fraction of the larger span) — used by the page
  // controller to auto-fit the view around whatever was drawn/typed
  // without needing its own bounding-box math.
  function boundingBox(points, { padding = 0.12 } = {}) {
    if (!Array.isArray(points) || points.length === 0) {
      throw new FourierError('boundingBox needs a non-empty array of points');
    }
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const p of points) {
      if (!isFinitePoint(p)) continue;
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) {
      throw new FourierError('boundingBox: no finite points to bound');
    }
    const spanX = Math.max(xMax - xMin, MIN_PATH_SPAN);
    const spanY = Math.max(yMax - yMin, MIN_PATH_SPAN);
    const span = Math.max(spanX, spanY);
    const pad = span * padding;
    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;
    const half = span / 2 + pad;
    return { xMin: cx - half, xMax: cx + half, yMin: cy - half, yMax: cy + half };
  }

  return {
    FourierError,
    MAX_RAW_STROKE_POINTS,
    MAX_SAMPLES,
    MIN_SAMPLES,
    MAX_PARAM_SAMPLES,
    MAX_HARMONICS,
    MAX_TRACE_RESOLUTION,
    resamplePolyline,
    sampleParametric,
    buildEpicycles,
    evaluateEpicycleChain,
    traceCurve,
    spectrum,
    boundingBox,
  };
});
