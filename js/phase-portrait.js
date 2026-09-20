// profpi — ODE & Phase Portrait module (Phase 2)
//
// Consumes MathCore (RK4 integrator + eigen2x2) and ExprParser (safe
// expression compiler) to turn user-typed equations into:
//   - slope fields for a single ODE dy/dx = f(x,y)
//   - vector fields for a 2D autonomous system dx/dt=f(x,y), dy/dt=g(x,y)
//   - equilibrium points + stability classification for that system
//   - integrated trajectories (forward/backward/both) through either
//
// Design rules (same as mathcore.js):
//  1. Every public function validates inputs and throws a typed,
//     documented error (PhasePortraitError, or a propagated
//     ExprParseError / MathCoreError) — nothing fails silently.
//  2. Grid sizes, equilibrium-search seed counts, and Newton iterations
//     all have hard caps so a public-facing request can never hang or
//     DoS the tab/server, regardless of what a user types or requests.
//  3. Points where the user's expression is mathematically undefined
//     (NaN/Infinity — e.g. sqrt of a negative, log of zero) are skipped
//     per-point rather than aborting the whole field computation.
//  4. No dependencies beyond MathCore + ExprParser. Works in browser
//     (global PhasePortrait) and Node (module.exports).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const MathCore = require('./mathcore.js');
    const ExprParser = require('./expr-parser.js');
    module.exports = factory(MathCore, ExprParser);
  } else {
    root.PhasePortrait = factory(root.MathCore, root.ExprParser);
  }
})(typeof self !== 'undefined' ? self : this, function (MathCore, ExprParser) {
  'use strict';

  if (!MathCore || !ExprParser) {
    throw new Error(
      'PhasePortrait requires MathCore and ExprParser to be loaded first ' +
      '(include mathcore.js and expr-parser.js before phase-portrait.js).'
    );
  }

  class PhasePortraitError extends Error {
    constructor(message) {
      super(message);
      this.name = 'PhasePortraitError';
    }
  }

  // ── Hard caps: protects a live site from hostile or accidental huge requests ──
  const MAX_GRID_POINTS = 10000;      // e.g. 100x100
  const MAX_EQUILIBRIUM_SEEDS = 400;  // e.g. 20x20 seed grid
  const MAX_NEWTON_ITERS = 60;
  const MAX_TRAJECTORY_STEPS = 20000; // per direction; well under MathCore's own 200k cap
  const EQUILIBRIUM_DEDUPE_EPS = 1e-4;
  const NEWTON_TOL = 1e-9;
  const JACOBIAN_EPS = 1e-6;

  // ── Shared validation helpers ────────────────────────────────────────
  function assertFinite(x, label) {
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw new PhasePortraitError(`${label} must be a finite number, got ${JSON.stringify(x)}`);
    }
  }

  function assertBounds(xMin, xMax, yMin, yMax) {
    assertFinite(xMin, 'xMin'); assertFinite(xMax, 'xMax');
    assertFinite(yMin, 'yMin'); assertFinite(yMax, 'yMax');
    if (xMin >= xMax) throw new PhasePortraitError(`xMin (${xMin}) must be less than xMax (${xMax})`);
    if (yMin >= yMax) throw new PhasePortraitError(`yMin (${yMin}) must be less than yMax (${yMax})`);
  }

  function assertGridSize(cols, rows) {
    if (!Number.isInteger(cols) || cols < 2 || !Number.isInteger(rows) || rows < 2) {
      throw new PhasePortraitError(`cols and rows must be integers >= 2, got cols=${cols}, rows=${rows}`);
    }
    if (cols * rows > MAX_GRID_POINTS) {
      throw new PhasePortraitError(
        `Requested grid (${cols}x${rows}=${cols * rows} points) exceeds the cap of ${MAX_GRID_POINTS} points, kept in place to stay responsive on live traffic.`
      );
    }
  }

  function makeAxis(min, max, count) {
    const vals = new Array(count);
    for (let i = 0; i < count; i++) vals[i] = min + ((max - min) * i) / (count - 1);
    return vals;
  }

  // ── Slope field: single ODE dy/dx = f(x, y) ───────────────────────────
  function computeSlopeField(exprString, opts = {}) {
    const { xMin = -5, xMax = 5, yMin = -5, yMax = 5, cols = 25, rows = 25 } = opts;
    assertBounds(xMin, xMax, yMin, yMax);
    assertGridSize(cols, rows);

    const f = ExprParser.compile(exprString, ['x', 'y']);
    const xs = makeAxis(xMin, xMax, cols);
    const ys = makeAxis(yMin, yMax, rows);

    const points = [];
    for (const y of ys) {
      for (const x of xs) {
        let slope;
        try { slope = f(x, y); } catch (e) { slope = NaN; }
        if (!Number.isFinite(slope)) {
          points.push({ x, y, defined: false });
          continue;
        }
        // Unit direction vector (1, slope) normalized — keeps arrow length
        // constant across the field regardless of how steep the slope is.
        const norm = Math.hypot(1, slope);
        points.push({
          x, y, defined: true,
          slope,
          dirX: 1 / norm,
          dirY: slope / norm,
          steepness: norm, // sqrt(1+slope^2); large = near-vertical
        });
      }
    }
    return { points, bounds: { xMin, xMax, yMin, yMax }, cols, rows, source: f.source };
  }

  // ── Vector field: 2D autonomous system dx/dt=f(x,y), dy/dt=g(x,y) ────
  function computeVectorField(fExprString, gExprString, opts = {}) {
    const { xMin = -5, xMax = 5, yMin = -5, yMax = 5, cols = 25, rows = 25 } = opts;
    assertBounds(xMin, xMax, yMin, yMax);
    assertGridSize(cols, rows);

    const f = ExprParser.compile(fExprString, ['x', 'y']);
    const g = ExprParser.compile(gExprString, ['x', 'y']);
    const xs = makeAxis(xMin, xMax, cols);
    const ys = makeAxis(yMin, yMax, rows);

    const points = [];
    for (const y of ys) {
      for (const x of xs) {
        let dx, dy;
        try { dx = f(x, y); dy = g(x, y); } catch (e) { dx = NaN; dy = NaN; }
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
          points.push({ x, y, defined: false });
          continue;
        }
        const magnitude = Math.hypot(dx, dy);
        const norm = magnitude === 0 ? 1 : magnitude;
        points.push({
          x, y, defined: true,
          dx, dy, magnitude,
          dirX: dx / norm,
          dirY: dy / norm,
        });
      }
    }
    return { points, bounds: { xMin, xMax, yMin, yMax }, cols, rows, fSource: f.source, gSource: g.source };
  }

  // ── Equilibria: solve f(x,y)=0, g(x,y)=0 via multi-seed 2D Newton ────
  function numericJacobian(f, g, x, y) {
    const h = JACOBIAN_EPS;
    const fx = (f(x + h, y) - f(x - h, y)) / (2 * h);
    const fy = (f(x, y + h) - f(x, y - h)) / (2 * h);
    const gx = (g(x + h, y) - g(x - h, y)) / (2 * h);
    const gy = (g(x, y + h) - g(x, y - h)) / (2 * h);
    return [fx, fy, gx, gy]; // [[fx,fy],[gx,gy]]
  }

  function newtonSolve(f, g, x0, y0) {
    let x = x0, y = y0;
    for (let iter = 0; iter < MAX_NEWTON_ITERS; iter++) {
      const F0 = f(x, y), F1 = g(x, y);
      if (!Number.isFinite(F0) || !Number.isFinite(F1)) return null;
      if (Math.hypot(F0, F1) < NEWTON_TOL) return { x, y };

      const [a, b, c, d] = numericJacobian(f, g, x, y);
      const det = a * d - b * c;
      if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null; // singular Jacobian, give up on this seed

      // Solve J*delta = -F via the explicit 2x2 inverse.
      const dx = (-F0 * d + F1 * b) / det;
      const dy = (-F1 * a + F0 * c) / det;
      x += dx; y += dy;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    }
    const F0 = f(x, y), F1 = g(x, y);
    return Number.isFinite(F0) && Number.isFinite(F1) && Math.hypot(F0, F1) < 1e-4 ? { x, y } : null;
  }

  // Finds equilibria of the system by seeding Newton's method from a grid
  // across the given bounds and de-duplicating converged results. This is
  // a numerical search, not a symbolic solver: it can miss equilibria far
  // outside the search bounds, or equilibria in a degenerate/flat region
  // where the Jacobian stays singular. converged reflects that per-point,
  // and the overall result is a best-effort list, not a guarantee of
  // completeness — exactly like polynomialRoots' `converged` flag in
  // mathcore.js.
  function computeEquilibria(fExprString, gExprString, opts = {}) {
    const { xMin = -5, xMax = 5, yMin = -5, yMax = 5, seedCols = 15, seedRows = 15 } = opts;
    assertBounds(xMin, xMax, yMin, yMax);
    if (!Number.isInteger(seedCols) || seedCols < 2 || !Number.isInteger(seedRows) || seedRows < 2) {
      throw new PhasePortraitError(`seedCols and seedRows must be integers >= 2, got ${seedCols}, ${seedRows}`);
    }
    if (seedCols * seedRows > MAX_EQUILIBRIUM_SEEDS) {
      throw new PhasePortraitError(
        `Requested equilibrium search seeds (${seedCols}x${seedRows}) exceeds the cap of ${MAX_EQUILIBRIUM_SEEDS}.`
      );
    }

    const f = ExprParser.compile(fExprString, ['x', 'y']);
    const g = ExprParser.compile(gExprString, ['x', 'y']);
    const xs = makeAxis(xMin, xMax, seedCols);
    const ys = makeAxis(yMin, yMax, seedRows);

    const found = [];
    for (const y0 of ys) {
      for (const x0 of xs) {
        const sol = newtonSolve(f, g, x0, y0);
        if (!sol) continue;
        if (sol.x < xMin - 1e-6 || sol.x > xMax + 1e-6 || sol.y < yMin - 1e-6 || sol.y > yMax + 1e-6) continue;
        const dup = found.some((p) => Math.hypot(p.x - sol.x, p.y - sol.y) < EQUILIBRIUM_DEDUPE_EPS);
        if (dup) continue;
        found.push(sol);
      }
    }

    const equilibria = found.map(({ x, y }) => {
      const [a, b, c, d] = numericJacobian(f, g, x, y);
      const classification = MathCore.eigen2x2(a, b, c, d);
      return {
        x, y,
        jacobian: [[a, b], [c, d]],
        eigenvalues: classification.eigenvalues,
        trace: classification.trace,
        determinant: classification.determinant,
        classification: classification.classification,
        stability: classification.stability,
      };
    });

    return { equilibria, fSource: f.source, gSource: g.source, seedsSearched: seedCols * seedRows };
  }

  // ── Trajectories: integrate through either a scalar ODE or a system ──
  //
  // Scalar mode (gExprString === null): dy/dx = f(x, y), same convention as
  // computeSlopeField, integrated from start = { t0, y0 } (t0 is the
  // starting x-value; kept as t0 to share this signature with system mode).
  // System mode (gExprString given):    dx/dt=f(x,y), dy/dt=g(x,y),
  //                                     start = { t0, x0, y0 }.
  function computeTrajectory(fExprString, gExprString, start, opts = {}) {
    const { h = 0.01, steps = 1000, direction = 'forward', maxMagnitude = 1e8 } = opts;
    if (!['forward', 'backward', 'both'].includes(direction)) {
      throw new PhasePortraitError(`direction must be 'forward', 'backward', or 'both', got ${JSON.stringify(direction)}`);
    }
    assertFinite(h, 'h');
    if (h <= 0) throw new PhasePortraitError(`h must be a positive number (direction is controlled separately), got ${h}`);
    if (!Number.isInteger(steps) || steps <= 0 || steps > MAX_TRAJECTORY_STEPS) {
      throw new PhasePortraitError(`steps must be an integer in (0, ${MAX_TRAJECTORY_STEPS}], got ${steps}`);
    }
    if (!start || typeof start !== 'object') {
      throw new PhasePortraitError('start must be an object with t0 and either y0 (scalar mode) or x0,y0 (system mode)');
    }
    assertFinite(start.t0, 'start.t0');

    const isSystem = gExprString !== null && gExprString !== undefined;
    let vectorField, y0;

    if (isSystem) {
      assertFinite(start.x0, 'start.x0');
      assertFinite(start.y0, 'start.y0');
      const f = ExprParser.compile(fExprString, ['x', 'y']);
      const g = ExprParser.compile(gExprString, ['x', 'y']);
      vectorField = (t, y) => [f(y[0], y[1]), g(y[0], y[1])];
      y0 = [start.x0, start.y0];
    } else {
      assertFinite(start.y0, 'start.y0');
      // Scalar mode shares its expression with computeSlopeField, which
      // uses dy/dx = f(x, y) — so the independent variable must be named
      // 'x' here too, not 't'. (integrateODE's own (t, y) callback
      // signature is just a generic positional convention internally;
      // it doesn't dictate what identifier the user's expression uses.)
      const f = ExprParser.compile(fExprString, ['x', 'y']);
      vectorField = (t, y) => f(t, y);
      y0 = start.y0;
    }

    function run(hSigned, stepCount) {
      const { trajectory, blewUp } = MathCore.integrateODE(vectorField, {
        t0: start.t0, y0, h: hSigned, steps: stepCount, maxMagnitude,
      });
      return { trajectory, blewUp };
    }

    if (direction === 'forward') return run(h, steps);
    if (direction === 'backward') {
      const { trajectory, blewUp } = run(-h, steps);
      return { trajectory: trajectory.slice().reverse(), blewUp };
    }
    // both: stitch backward (reversed, excluding duplicate start) + forward
    const fwd = run(h, steps);
    const bwd = run(-h, steps);
    const bwdRev = bwd.trajectory.slice(1).reverse();
    return {
      trajectory: bwdRev.concat(fwd.trajectory),
      blewUp: fwd.blewUp || bwd.blewUp,
    };
  }

  return {
    PhasePortraitError,
    MAX_GRID_POINTS,
    MAX_EQUILIBRIUM_SEEDS,
    MAX_TRAJECTORY_STEPS,
    computeSlopeField,
    computeVectorField,
    computeEquilibria,
    computeTrajectory,
  };
});
