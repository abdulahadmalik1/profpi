// ────────────────────────────────────────────────────────────────
    //  Inlined GraphEngine class from graph-engine.js
    // ────────────────────────────────────────────────────────────────

    // Functions with a 1:1 Math.* equivalent (identifier name === Math method name)
    const DIRECT_MATH = new Set([
      'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
      'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
      'sqrt', 'cbrt', 'abs', 'exp', 'floor', 'ceil', 'round', 'trunc', 'sign', 'log2',
    ]);

    // Reciprocal trig/hyperbolic functions JS has no native method for — routed through M (see compileExpression).
    const MATH_EXT = {
      cot: (x) => 1 / Math.tan(x),
      sec: (x) => 1 / Math.cos(x),
      csc: (x) => 1 / Math.sin(x),
      cosec: (x) => 1 / Math.sin(x),
      acot: (x) => Math.PI / 2 - Math.atan(x),
      asec: (x) => Math.acos(1 / x),
      acsc: (x) => Math.asin(1 / x),
      acosec: (x) => Math.asin(1 / x),
      coth: (x) => 1 / Math.tanh(x),
      sech: (x) => 1 / Math.cosh(x),
      csch: (x) => 1 / Math.sinh(x),
      acoth: (x) => Math.atanh(1 / x),
      asech: (x) => Math.acosh(1 / x),
      acsch: (x) => Math.asinh(1 / x),
    };

    const FUNCTIONS = new Set([
      ...DIRECT_MATH, 'ln', 'log', ...Object.keys(MATH_EXT),
    ]);

    function tokenize(input) {
      const tokens = [];
      let pos = 0;
      while (pos < input.length) {
        const ch = input[pos];
        if (/\s/.test(ch)) { pos++; continue; }
        if (/[0-9.]/.test(ch)) {
          let s = '';
          while (pos < input.length && /[0-9.]/.test(input[pos])) s += input[pos++];
          if ((s.match(/\./g) || []).length > 1) throw new Error(`Malformed number: ${s}`);
          tokens.push({ type: 'NUMBER', value: s });
          continue;
        }
        if (/[a-zA-Z_]/.test(ch)) {
          let s = '';
          while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) s += input[pos++];
          tokens.push({ type: 'IDENTIFIER', value: s });
          continue;
        }
        if ('+-*/^(),'.includes(ch)) {
          tokens.push({ type: 'OPERATOR', value: ch });
          pos++;
          continue;
        }
        throw new Error(`Unexpected character '${ch}'`);
      }
      return tokens;
    }

    function expandImplicitMultiplication(tokens) {
      const out = [];
      for (let i = 0; i < tokens.length; i++) {
        out.push(tokens[i]);
        const cur = tokens[i];
        const nxt = tokens[i + 1];
        if (!nxt) continue;

        const curIsFunctionName = cur.type === 'IDENTIFIER' && FUNCTIONS.has(cur.value);
        const nxtIsOpenParen = nxt.type === 'OPERATOR' && nxt.value === '(';
        if (curIsFunctionName && nxtIsOpenParen) continue;

        const curEndsOperand = cur.type === 'NUMBER' || cur.type === 'IDENTIFIER' ||
          (cur.type === 'OPERATOR' && cur.value === ')');
        const nxtStartsOperand = nxt.type === 'NUMBER' || nxt.type === 'IDENTIFIER' || nxtIsOpenParen;
        if (curEndsOperand && nxtStartsOperand) out.push({ type: 'OPERATOR', value: '*' });
      }
      return out;
    }

    class ExprParser {
      constructor(tokens) { this.tokens = tokens; this.pos = 0; }
      peek() { return this.tokens[this.pos]; }
      next() { return this.tokens[this.pos++]; }
      match(type, value) {
        const t = this.peek();
        if (t && t.type === type && (value === undefined || t.value === value)) return this.next();
        return null;
      }
      parse() {
        const expr = this.parseExpr();
        if (this.pos < this.tokens.length) {
          throw new Error(`Unexpected token near '${this.tokens[this.pos].value}'`);
        }
        return expr;
      }
      parseExpr() {
        let left = this.parseTerm();
        let op;
        while ((op = this.match('OPERATOR', '+') || this.match('OPERATOR', '-'))) {
          left = `(${left} ${op.value} ${this.parseTerm()})`;
        }
        return left;
      }
      parseTerm() {
        let left = this.parseFactor();
        let op;
        while ((op = this.match('OPERATOR', '*') || this.match('OPERATOR', '/'))) {
          left = `(${left} ${op.value} ${this.parseFactor()})`;
        }
        return left;
      }
      parseFactor() {
        const sign = this.match('OPERATOR', '+') || this.match('OPERATOR', '-');
        if (sign) return `(${sign.value}${this.parseFactor()})`;
        const base = this.parsePrimary();
        if (this.match('OPERATOR', '^')) return `Math.pow(${base}, ${this.parseFactor()})`;
        return base;
      }
      parsePrimary() {
        const tok = this.peek();
        if (!tok) throw new Error('Unexpected end of expression');

        if (tok.type === 'NUMBER') { this.next(); return tok.value; }

        if (tok.type === 'IDENTIFIER') {
          const id = this.next().value;
          if (this.match('OPERATOR', '(')) {
            const arg = this.parseExpr();
            if (!this.match('OPERATOR', ')')) throw new Error(`Missing ')' after ${id}(`);
            if (!FUNCTIONS.has(id)) throw new Error(`Unknown function '${id}'`);
            if (id === 'ln') return `Math.log(${arg})`;
            if (id === 'log') return `Math.log10(${arg})`;
            if (DIRECT_MATH.has(id)) return `Math.${id}(${arg})`;
            return `M.${id}(${arg})`;
          }
          if (id === 'x') return 'x';
          if (id === 'y') return 'y';
          if (id === 'pi' || id === 'PI') return 'Math.PI';
          if (id === 'e') return 'Math.E';
          throw new Error(`Unknown identifier '${id}'`);
        }

        if (this.match('OPERATOR', '(')) {
          const inner = this.parseExpr();
          if (!this.match('OPERATOR', ')')) throw new Error("Missing ')'");
          return `(${inner})`;
        }

        throw new Error(`Unexpected token '${tok.value}'`);
      }
    }

    function compileBody(text) {
      if (!text || !text.trim()) throw new Error('Empty expression');
      const tokens = expandImplicitMultiplication(tokenize(text));
      return new ExprParser(tokens).parse();
    }

    // f(x) only — used for the classic "y = ..." fast path (unused y arg is harmless).
    function compileExpression(text) {
      const body = compileBody(text);
      const raw = new Function('x', 'y', 'M', `
        const v = ${body};
        return (typeof v === 'number' && isFinite(v)) ? v : NaN;
      `);
      return (x) => { try { return raw(x, NaN, MATH_EXT); } catch { return NaN; } };
    }

    // Compiles a full equation the user typed. Accepts either a bare expression
    // ("x^2", meaning y = x^2" — kept for backward compatibility) or a full
    // equation with exactly one '=' where either side may use x and/or y
    // ("x^2 + y^2 = 4"). Returns { fn, implicit }:
    //   implicit=false → fn(x) -> y   (fast path, supports POIs/hover as before)
    //   implicit=true  → fn(x, y) -> value; the curve is where fn(x,y) === 0
    function compileEquation(text) {
      if (!text || !text.trim()) throw new Error('Empty expression');
      const eqIdx = text.indexOf('=');
      if (eqIdx === -1) return { fn: compileExpression(text), implicit: false };
      if (text.indexOf('=', eqIdx + 1) !== -1) throw new Error("Only one '=' is allowed");

      const lhsText = text.slice(0, eqIdx).trim();
      const rhsText = text.slice(eqIdx + 1).trim();
      if (!lhsText || !rhsText) throw new Error("Both sides of '=' need an expression");

      const lhsBody = compileBody(lhsText);
      const rhsBody = compileBody(rhsText);
      const usesY = (body) => /\by\b/.test(body);

      // Fast path: "y = f(x)" or "f(x) = y" — behaves exactly like the old explicit form.
      if (lhsText.toLowerCase() === 'y' && !usesY(rhsBody)) {
        const raw = new Function('x', 'y', 'M', `const v = ${rhsBody}; return (typeof v === 'number' && isFinite(v)) ? v : NaN;`);
        return { fn: (x) => { try { return raw(x, NaN, MATH_EXT); } catch { return NaN; } }, implicit: false };
      }
      if (rhsText.toLowerCase() === 'y' && !usesY(lhsBody)) {
        const raw = new Function('x', 'y', 'M', `const v = ${lhsBody}; return (typeof v === 'number' && isFinite(v)) ? v : NaN;`);
        return { fn: (x) => { try { return raw(x, NaN, MATH_EXT); } catch { return NaN; } }, implicit: false };
      }

      // General implicit relation: curve is where lhs - rhs === 0.
      const raw = new Function('x', 'y', 'M', `
        const l = ${lhsBody}, r = ${rhsBody};
        const v = l - r;
        return (typeof v === 'number' && isFinite(v)) ? v : NaN;
      `);
      return { fn: (x, y) => { try { return raw(x, y, MATH_EXT); } catch { return NaN; } }, implicit: true };
    }

    function mathToScreen(mx, my, view, width, height) {
      return {
        x: ((mx - view.xMin) / (view.xMax - view.xMin)) * width,
        y: ((view.yMax - my) / (view.yMax - view.yMin)) * height,
      };
    }

    function screenToMath(sx, sy, view, width, height) {
      return {
        x: view.xMin + (sx / width) * (view.xMax - view.xMin),
        y: view.yMax - (sy / height) * (view.yMax - view.yMin),
      };
    }

    function niceGridSpacing(range) {
      const exp = Math.floor(Math.log10(range));
      const frac = range / 10 ** exp;
      const nice = frac < 1.5 ? 0.1 : frac < 3 ? 0.2 : frac < 7 ? 0.5 : 1;
      return nice * 10 ** exp;
    }

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

    function formatTick(v, spacing) {
      if (Math.abs(v) < spacing * 1e-6) return '0';
      if (spacing < 1e-4 || spacing >= 1e6) return v.toExponential(2);
      const decimals = spacing >= 1 ? 0 : Math.min(10, Math.ceil(-Math.log10(spacing)));
      return v.toFixed(decimals);
    }

    function sampleCurve(f, view, width, height, quality) {
      const points = [];
      const baseSamples = quality === 'low' ? 90 : 260;
      const maxDepth = quality === 'low' ? 5 : 10;
      const dx = (view.xMax - view.xMin) / baseSamples;

      const evalPt = (x) => {
        const y = f(x);
        if (Number.isNaN(y) || !Number.isFinite(y)) return null;
        const s = mathToScreen(x, y, view, width, height);
        // Treat wildly off-screen values (e.g. log(x) as x -> 0+) as a domain edge
        // rather than a real point — otherwise the sampler keeps deep-recursing on
        // the near-vertical runaway and it visibly "keeps rendering" while zooming.
        if (!Number.isFinite(s.y) || Math.abs(s.y) > height * 50) return null;
        return { x, y, sx: s.x, sy: s.y };
      };

      function subdivide(x1, p1, x2, p2, depth) {
        if (!p1 && !p2) return;
        // If one side is null (domain boundary like log), keep subdividing to find exact boundary
        if (!p1 || !p2) {
          if (depth < maxDepth) {
            const xm = (x1 + x2) / 2;
            const pm = evalPt(xm);
            subdivide(x1, p1, xm, pm, depth + 1);
            if (pm) points.push(pm); else points.push(null);
            subdivide(xm, pm, x2, p2, depth + 1);
          } else {
            // At max depth, insert a break between the valid and invalid regions
            points.push(null);
          }
          return;
        }

        const xm = (x1 + x2) / 2;
        const pm = evalPt(xm);

        if (!pm) {
          // midpoint is in gap — subdivide both sides to find edges precisely
          if (depth < maxDepth) {
            subdivide(x1, p1, xm, pm, depth + 1);
            points.push(null);
            subdivide(xm, pm, x2, p2, depth + 1);
          } else {
            points.push(null);
          }
          return;
        }

        // Asymptote guard: huge vertical jump in screen-space
        if (Math.abs(p1.sy - p2.sy) > height * 1.5) {
          if (depth < maxDepth + 1) {
            subdivide(x1, p1, xm, pm, depth + 1);
            if (pm) points.push(pm); else points.push(null);
            subdivide(xm, pm, x2, p2, depth + 1);
          } else {
            points.push(null);
          }
          return;
        }

        // Curvature test
        const A = p2.sy - p1.sy, B = p1.sx - p2.sx;
        const C = p2.sx * p1.sy - p1.sx * p2.sy;
        const distSq = (A * pm.sx + B * pm.sy + C) ** 2 / (A * A + B * B + 1e-9);

        if (distSq > 0.25 && depth < maxDepth) {
          subdivide(x1, p1, xm, pm, depth + 1);
          points.push(pm);
          subdivide(xm, pm, x2, p2, depth + 1);
        } else {
          points.push(pm);
        }
      }

      // Anchor the grid to absolute math coordinates so it doesn't slide during pan
      const startX = Math.floor(view.xMin / dx) * dx;
      const endX = Math.ceil(view.xMax / dx) * dx;
      
      let prevX = startX;
      let prevPt = evalPt(prevX);
      if (prevPt) points.push(prevPt); else points.push(null);

      // Add a small epsilon to endX to prevent floating point issues dropping the last point
      for (let x = startX + dx; x <= endX + dx * 0.1; x += dx) {
        const nextX = x;
        const nextPt = evalPt(nextX);
        subdivide(prevX, prevPt, nextX, nextPt, 0);
        if (nextPt) points.push(nextPt); else points.push(null);
        prevX = nextX;
        prevPt = nextPt;
      }
      return points;
    }

    // Standard marching-squares edge table. Edges: 0=top,1=right,2=bottom,3=left.
    // Each case lists pairs of edges to connect with a segment. Cases 5/10 are the
    // ambiguous "saddle" cases, split into two independent segments (a tiny, rare
    // visual imperfection is an acceptable trade-off for a simple, fast implementation).
    const MS_EDGES = [
      [], [[0, 3]], [[0, 1]], [[1, 3]],
      [[1, 2]], [[0, 3], [1, 2]], [[0, 2]], [[2, 3]],
      [[2, 3]], [[0, 2]], [[0, 1], [2, 3]], [[1, 2]],
      [[1, 3]], [[0, 1]], [[0, 3]], [],
    ];

    // Traces an implicit curve g(x,y) = 0 using marching squares over a screen-space
    // grid. Returns a flat points array in the SAME shape sampleCurve() produces
    // ({x,y,sx,sy} with `null` separators) so it can reuse the existing stroke/hover code.
    function sampleImplicitCurve(g, view, width, height, quality) {
      const cell = quality === 'low' ? 14 : 7;
      const cols = Math.max(2, Math.ceil(width / cell) + 1);
      const rows = Math.max(2, Math.ceil(height / cell) + 1);
      const vals = new Float64Array(cols * rows);
      for (let j = 0; j < rows; j++) {
        const sy = j * cell;
        for (let i = 0; i < cols; i++) {
          const sx = i * cell;
          const m = screenToMath(sx, sy, view, width, height);
          const v = g(m.x, m.y);
          vals[j * cols + i] = Number.isFinite(v) ? v : NaN;
        }
      }

      const points = [];
      const at = (i, j) => vals[j * cols + i];
      const interp = (sx1, sy1, v1, sx2, sy2, v2) => {
        const t = v1 / (v1 - v2);
        const sx = sx1 + t * (sx2 - sx1);
        const sy = sy1 + t * (sy2 - sy1);
        const m = screenToMath(sx, sy, view, width, height);
        return { x: m.x, y: m.y, sx, sy };
      };

      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const v00 = at(i, j), v10 = at(i + 1, j), v01 = at(i, j + 1), v11 = at(i + 1, j + 1);
          if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) continue;
          const caseIdx = (v00 >= 0 ? 1 : 0) | (v10 >= 0 ? 2 : 0) | (v11 >= 0 ? 4 : 0) | (v01 >= 0 ? 8 : 0);
          const segs = MS_EDGES[caseIdx];
          if (!segs.length) continue;

          const sx0 = i * cell, sx1c = (i + 1) * cell, sy0 = j * cell, sy1c = (j + 1) * cell;
          const edgePt = [
            () => interp(sx0, sy0, v00, sx1c, sy0, v10),   // 0 top
            () => interp(sx1c, sy0, v10, sx1c, sy1c, v11), // 1 right
            () => interp(sx0, sy1c, v01, sx1c, sy1c, v11), // 2 bottom
            () => interp(sx0, sy0, v00, sx0, sy1c, v01),   // 3 left
          ];
          for (const [a, b] of segs) {
            points.push(edgePt[a](), edgePt[b](), null);
          }
        }
      }
      return points;
    }

    function findPOIs(f, view) {
      const steps = 180;
      const dx = (view.xMax - view.xMin) / steps;
      const h = 1e-5;
      const df = (x) => {
        const y1 = f(x - h), y2 = f(x + h);
        return Number.isNaN(y1) || Number.isNaN(y2) ? NaN : (y2 - y1) / (2 * h);
      };
      const bisect = (lo, hi, fn) => {
        let l = lo, r = hi, m = l;
        for (let i = 0; i < 30; i++) {
          m = (l + r) / 2;
          const fm = fn(m);
          if (Math.abs(fm) < 1e-10) break;
          if (fm * fn(l) < 0) r = m; else l = m;
        }
        return m;
      };

      const pois = [];
      let px = view.xMin, py = f(px), pdf = df(px);
      for (let i = 1; i <= steps; i++) {
        const nx = view.xMin + i * dx;
        const ny = f(nx);
        const ndf = df(nx);

        if (isFinite(py) && isFinite(ny) && (py * ny < 0 || py === 0)) {
          const rx = py === 0 ? px : bisect(px, nx, f);
          if (Math.abs(f(rx)) < 1e-4) pois.push({ x: rx, y: 0, type: 'root', label: `Root (${rx.toFixed(3)}, 0)` });
        }
        if (isFinite(pdf) && isFinite(ndf) && (pdf * ndf < 0 || pdf === 0)) {
          const ex = pdf === 0 ? px : bisect(px, nx, df);
          const ey = f(ex);
          if (isFinite(ey)) {
            const kind = df(ex - h) > 0 ? 'max' : 'min';
            pois.push({ x: ex, y: ey, type: kind, label: `${kind === 'max' ? 'Max' : 'Min'} (${ex.toFixed(3)}, ${ey.toFixed(3)})` });
          }
        }
        px = nx; py = ny; pdf = ndf;
      }
      if (view.xMin <= 0 && view.xMax >= 0) {
        const y0 = f(0);
        if (isFinite(y0)) pois.push({ x: 0, y: y0, type: 'yint', label: `y-intercept (0, ${y0.toFixed(3)})` });
      }
      return pois;
    }

    class GraphEngine {
      constructor(canvas, opts = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onHover = opts.onHover || null;
        this.onStatusChange = opts.onStatusChange || null;
        this.theme = Object.assign({
          bg: '#ffffff', grid: '#e2e8f0', axis: '#475569', tick: '#64748b',
          poiFill: '#94a3b8', poiStroke: '#ffffff', lineWidth: 3,
        }, opts.theme);

        this.view = { xMin: -10, xMax: 10, yMin: -6, yMax: 6 };
        this.equations = [];
        this.pointSets = []; // { id, color, points: [{x,y}] } — user-plotted points, connected piecewise-linear
        this.showCurves = true;
        this._nextId = 1;
        this.showAxes = true;
        this.showGrid = true;
        this.gridStyle = 'lines'; // 'lines' | 'dots'

        this._width = 0; this._height = 0; this._dpr = 1;
        this._quality = 'high';
        this._dirty = true;
        this._status = 'idle';
        this._lastRender = [];
        this._settleTimer = null;
        this._wheelIdleTimer = null;

        this._pointers = new Map();
        this._panStart = null;
        this._pinchStart = null;
        this._animFrame = null;
        this._viewAnimFrame = null;

        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(canvas);
        this._resize();
        this._bindEvents();
        this._loop = this._loop.bind(this);
        requestAnimationFrame(this._loop);
      }

      destroy() {
        this._resizeObserver.disconnect();
        if (this._animFrame) cancelAnimationFrame(this._animFrame);
        if (this._viewAnimFrame) cancelAnimationFrame(this._viewAnimFrame);
        clearTimeout(this._settleTimer);
        clearTimeout(this._wheelIdleTimer);
        this._unbindEvents();
      }

      addEquation(text = '', color = '#6366f1', visible = true) {
        const eq = { id: this._nextId++, text, color, visible, fn: null, implicit: false, error: null };
        this._compile(eq);
        this.equations.push(eq);
        this._markDirty(true);
        return eq.id;
      }
      removeEquation(id) {
        this.equations = this.equations.filter((e) => e.id !== id);
        this._markDirty(true);
      }
      setEquationText(id, text) {
        const eq = this.equations.find((e) => e.id === id);
        if (!eq) return null;
        eq.text = text;
        this._compile(eq);
        this._markDirty(true);
        return eq.error;
      }
      setEquationColor(id, color) {
        const eq = this.equations.find((e) => e.id === id);
        if (eq) { eq.color = color; this._markDirty(true); }
      }
      setEquationVisible(id, visible) {
        const eq = this.equations.find((e) => e.id === id);
        if (eq) { eq.visible = visible; this._markDirty(true); }
      }

      // ── Point Plotter: separate feature, user-supplied (x, y) points
      // connected into a piecewise-linear graph. Fully independent of
      // the equations array above. ──────────────────────────────────
      addPointSet(color = '#f59e0b') {
        const set = { id: this._nextId++, color, points: [] };
        this.pointSets.push(set);
        this._markDirty(true);
        return set.id;
      }
      removePointSet(id) {
        this.pointSets = this.pointSets.filter((s) => s.id !== id);
        this._markDirty(true);
      }
      setPointSetPoints(id, points) {
        const set = this.pointSets.find((s) => s.id === id);
        if (!set) return;
        set.points = points;
        this._markDirty(true);
      }

      _compile(eq) {
        try {
          const { fn, implicit } = compileEquation(eq.text);
          eq.fn = fn; eq.implicit = implicit; eq.error = null;
        } catch (err) { eq.fn = null; eq.implicit = false; eq.error = err.message; }
      }

      resetView(animate = true) { this.setView({ xMin: -10, xMax: 10, yMin: -6, yMax: 6 }, animate); }

      setView(next, animate = false, duration = 260) {
        if (this._viewAnimFrame) {
          cancelAnimationFrame(this._viewAnimFrame);
          this._viewAnimFrame = null;
        }
        if (!animate) { this.view = { ...next }; this._markDirty(true); return; }
        const from = { ...this.view };
        let start = null;
        this._setStatus('animating');
        const step = (now) => {
          if (!start) start = now;
          const t = clamp((now - start) / duration, 0, 1);
          const e = easeInOutCubic(t);
          this.view = {
            xMin: from.xMin + (next.xMin - from.xMin) * e,
            xMax: from.xMax + (next.xMax - from.xMax) * e,
            yMin: from.yMin + (next.yMin - from.yMin) * e,
            yMax: from.yMax + (next.yMax - from.yMax) * e,
          };
          this._quality = 'low';
          this._dirty = true;
          if (t < 1) { this._viewAnimFrame = requestAnimationFrame(step); }
          else { this._viewAnimFrame = null; this._settle(); this._setStatus('idle'); }
        };
        this._viewAnimFrame = requestAnimationFrame(step);
      }

      zoomAt(sx, sy, factor) {
        // Always zoom around the current viewport center
        const cx = (this.view.xMin + this.view.xMax) / 2;
        const cy = (this.view.yMin + this.view.yMax) / 2;
        const nextXMin = cx - (cx - this.view.xMin) * factor;
        const nextXMax = cx + (this.view.xMax - cx) * factor;
        const nextYMin = cy - (cy - this.view.yMin) * factor;
        const nextYMax = cy + (this.view.yMax - cy) * factor;
        const rangeX = nextXMax - nextXMin;
        const rangeY = nextYMax - nextYMin;
        if (rangeX > 1e12 || rangeY > 1e12 || rangeX < 1e-12 || rangeY < 1e-12) return;
        this.view = { xMin: nextXMin, xMax: nextXMax, yMin: nextYMin, yMax: nextYMax };
        this._quality = 'low';
        this._markDirty(true);
        this._settle();
      }

      zoomStep(factor) {
        const cx = (this.view.xMin + this.view.xMax) / 2;
        const cy = (this.view.yMin + this.view.yMax) / 2;
        const rangeX = (this.view.xMax - this.view.xMin) * factor;
        const rangeY = (this.view.yMax - this.view.yMin) * factor;
        if (rangeX > 1e12 || rangeY > 1e12 || rangeX < 1e-12 || rangeY < 1e-12) return;
        this.setView({
          xMin: cx - rangeX / 2, xMax: cx + rangeX / 2,
          yMin: cy - rangeY / 2, yMax: cy + rangeY / 2
        }, true, 180);
      }

      // Scales the y-range so every visible equation fits snugly in the current x-window.
      fitView() {
        const eqs = this.equations.filter(e => e.visible && e.fn && !e.error);
        if (!eqs.length) { this.resetView(true); return; }
        const xMin = this.view.xMin, xMax = this.view.xMax;
        const N = 400;
        let yMin = Infinity, yMax = -Infinity;
        for (const eq of eqs) {
          if (eq.implicit) continue;
          for (let i = 0; i <= N; i++) {
            const x = xMin + (i / N) * (xMax - xMin);
            const y = eq.fn(x);
            if (Number.isFinite(y)) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
          }
        }
        if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { this.resetView(true); return; }
        if (yMin === yMax) { yMin -= 1; yMax += 1; }
        const pad = (yMax - yMin) * 0.15 || 1;
        this.setView({ xMin, xMax, yMin: yMin - pad, yMax: yMax + pad }, true, 260);
      }

      _resize() {
        const rect = this.canvas.getBoundingClientRect();
        this._dpr = window.devicePixelRatio || 1;
        this._width = Math.max(1, rect.width);
        this._height = Math.max(1, rect.height);
        this.canvas.width = Math.round(this._width * this._dpr);
        this.canvas.height = Math.round(this._height * this._dpr);
        this._markDirty(true);
      }

      _bindEvents() {
        const c = this.canvas;
        this._onPointerDown = (e) => this._pointerDown(e);
        this._onPointerMove = (e) => this._pointerMove(e);
        this._onPointerUp = (e) => this._pointerUp(e);
        this._onWheel = (e) => this._wheel(e);
        this._onLeave = (e) => {
          if (e && e.pointerType !== 'mouse') return; // Do not hide tooltip when touch/pen leaves screen
          if (this.onHover) this.onHover(null);
        };

        c.addEventListener('pointerdown', this._onPointerDown);
        window.addEventListener('pointermove', this._onPointerMove);
        window.addEventListener('pointerup', this._onPointerUp);
        window.addEventListener('pointercancel', this._onPointerUp);
        c.addEventListener('wheel', this._onWheel, { passive: false });
        c.addEventListener('pointerleave', this._onLeave);
      }
      _unbindEvents() {
        const c = this.canvas;
        c.removeEventListener('pointerdown', this._onPointerDown);
        window.removeEventListener('pointermove', this._onPointerMove);
        window.removeEventListener('pointerup', this._onPointerUp);
        window.removeEventListener('pointercancel', this._onPointerUp);
        c.removeEventListener('wheel', this._onWheel);
        c.removeEventListener('pointerleave', this._onLeave);
      }

      _pointerDown(e) {
        if (this._viewAnimFrame) {
          cancelAnimationFrame(this._viewAnimFrame);
          this._viewAnimFrame = null;
        }
        const rect = this.canvas.getBoundingClientRect();
        this._pointers.set(e.pointerId, {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          clientX: e.clientX,
          clientY: e.clientY
        });
        if (this._pointers.size === 1) {
          this._tapStartPos = { x: e.clientX, y: e.clientY, sx: e.clientX - rect.left, sy: e.clientY - rect.top };
          this._panStart = { mouse: { x: e.clientX, y: e.clientY }, view: { ...this.view } };
          this._setStatus('panning');
        } else if (this._pointers.size === 2) {
          this._tapStartPos = null;
          const pts = [...this._pointers.values()];
          this._pinchStart = {
            dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
            view: { ...this.view },
            mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
          };
          this._setStatus('zooming');
        }
      }

      _pointerMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

        if (this._pointers.has(e.pointerId)) {
          this._pointers.set(e.pointerId, {
            x: sx,
            y: sy,
            clientX: e.clientX,
            clientY: e.clientY
          });
        }

        // Remove the tap cancellation logic entirely to make touch coordinate display foolproof

        if (this._pointers.size === 1 && this._panStart) {
          const dx = e.clientX - this._panStart.mouse.x;
          const dy = e.clientY - this._panStart.mouse.y;
          const sxr = (this._panStart.view.xMax - this._panStart.view.xMin) / this._width;
          const syr = (this._panStart.view.yMax - this._panStart.view.yMin) / this._height;
          this.view = {
            xMin: this._panStart.view.xMin - dx * sxr,
            xMax: this._panStart.view.xMax - dx * sxr,
            yMin: this._panStart.view.yMin + dy * syr,
            yMax: this._panStart.view.yMax + dy * syr,
          };
          this._quality = 'low';
          this._markDirty(true);
          this._settle();
          return;
        }

        if (this._pointers.size === 2 && this._pinchStart) {
          const pts = [...this._pointers.values()];
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
          const factor = this._pinchStart.dist / dist;

          const cx = (this._pinchStart.view.xMin + this._pinchStart.view.xMax) / 2;
          const cy = (this._pinchStart.view.yMin + this._pinchStart.view.yMax) / 2;
          const dx = (this._pinchStart.view.xMax - this._pinchStart.view.xMin) * factor / 2;
          const dy = (this._pinchStart.view.yMax - this._pinchStart.view.yMin) * factor / 2;

          const nextXMin = cx - dx;
          const nextXMax = cx + dx;
          const nextYMin = cy - dy;
          const nextYMax = cy + dy;

          // Prevent zooming out too far or in too close
          const rangeX = nextXMax - nextXMin;
          const rangeY = nextYMax - nextYMin;
          if (rangeX > 1e12 || rangeY > 1e12 || rangeX < 1e-12 || rangeY < 1e-12) return;

          this.view = { xMin: nextXMin, xMax: nextXMax, yMin: nextYMin, yMax: nextYMax };
          this._quality = 'low';
          this._markDirty(true);
          this._settle();
          return;
        }

        if (this._pointers.size === 0) this._hoverAt(sx, sy);
      }

      _pointerUp(e) {
        const rect = this.canvas.getBoundingClientRect();
        // Fallback for Android browsers that don't provide clientX/Y on pointerup
        let cx = e.clientX;
        let cy = e.clientY;
        if ((cx === undefined || cx === 0) && this._tapStartPos) {
          cx = this._tapStartPos.x;
          cy = this._tapStartPos.y;
        }
        const sx = cx - rect.left;
        const sy = cy - rect.top;

        this._pointers.delete(e.pointerId);
        if (this._pointers.size === 0) {
          this._panStart = null;
          this._setStatus('idle');
          this._settle();
          // Always try to show a coordinate on pointer lift!
          // This makes it foolproof: wherever you lift your finger, if there is a curve nearby, you get the coordinate!
          this._hoverAt(sx, sy);
        } else if (this._pointers.size === 1) {
          // Reset panning anchor to the remaining finger to prevent coordinate jump
          const remaining = [...this._pointers.values()][0];
          this._panStart = {
            mouse: { x: remaining.clientX, y: remaining.clientY },
            view: { ...this.view }
          };
          this._setStatus('panning');
        }
        if (this._pointers.size < 2) this._pinchStart = null;
      }

      _wheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        // Exp zoom based on scroll speed, clamped and scaled down to reduce sensitivity
        const factor = Math.exp(clamp(e.deltaY, -120, 120) * 0.02);
        this._setStatus('zooming');
        this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
        clearTimeout(this._wheelIdleTimer);
        this._wheelIdleTimer = setTimeout(() => this._setStatus('idle'), 150);
      }

      _hoverAt(sx, sy) {
        if (!this.onHover) return;
        let best = 48; // Snapping threshold: increased from 16px to 48px to allow easy, forgiving taps on mobile lines
        let hit = null;
        for (const group of this._lastRender) {
          for (const poi of group.pois) {
            const p = mathToScreen(poi.x, poi.y, this.view, this._width, this._height);
            const d = Math.hypot(p.x - sx, p.y - sy);
            if (d < best) { best = d; hit = { screenX: p.x, screenY: p.y, mathX: poi.x, mathY: poi.y, color: group.color, label: poi.label }; }
          }
        }
        if (!hit) {
          for (const group of this._lastRender) {
            for (const p of group.points) {
              const d = Math.hypot(p.sx - sx, p.sy - sy);
              if (d < best) { best = d; hit = { screenX: p.sx, screenY: p.sy, mathX: p.x, mathY: p.y, color: group.color, label: `(${p.x.toFixed(3)}, ${p.y.toFixed(3)})` }; }
            }
          }
        }
        this.onHover(hit);
      }

      _settle() {
        clearTimeout(this._settleTimer);
        this._settleTimer = setTimeout(() => {
          this._quality = 'high';
          this._markDirty(true);
        }, 120);
      }
      _setStatus(status) {
        if (status === this._status) return;
        this._status = status;
        if (status !== 'idle' && this.onHover) this.onHover(null);
        if (this.onStatusChange) this.onStatusChange(status);
      }
      _markDirty(v) { this._dirty = v; }

      _loop() {
        if (this._dirty) { this._render(); this._dirty = false; }
        this._animFrame = requestAnimationFrame(this._loop);
      }

      _render() {
        const { ctx, view, theme } = this;
        const w = this._width, h = this._height;
        ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = theme.bg;
        ctx.fillRect(0, 0, w, h);

        this._drawGrid();

        const results = [];
        for (const eq of this.equations) {
          if (!this.showCurves || !eq.visible || eq.error || !eq.fn) continue;
          const points = eq.implicit
            ? sampleImplicitCurve(eq.fn, view, w, h, this._quality)
            : sampleCurve(eq.fn, view, w, h, this._quality);
          const pois = (!eq.implicit && this._quality === 'high') ? findPOIs(eq.fn, view) : [];

          ctx.strokeStyle = eq.color;
          ctx.lineWidth = theme.lineWidth;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.beginPath();
          let active = false;
          for (const p of points) {
            if (p === null) { ctx.stroke(); ctx.beginPath(); active = false; continue; }
            const y = clamp(p.sy, -1000, h + 1000);
            if (!active) { ctx.moveTo(p.sx, y); active = true; } else { ctx.lineTo(p.sx, y); }
          }
          ctx.stroke();

          for (const poi of pois) {
            const p = mathToScreen(poi.x, poi.y, view, w, h);
            if (p.x < -5 || p.x > w + 5 || p.y < -5 || p.y > h + 5) continue;
            ctx.fillStyle = theme.poiFill;
            ctx.strokeStyle = theme.poiStroke;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }

          results.push({ id: eq.id, color: eq.color, points: points.filter((p) => p !== null), pois });
        }

        // Point Plotter overlay — draw each point set as connected, dashed
        // piecewise-linear segments (sorted by x) plus solid markers.
        for (const set of this.pointSets) {
          if (!set.points || set.points.length === 0) continue;
          const sorted = [...set.points].sort((a, b) => a.x - b.x);
          const screenPts = sorted.map((p) => {
            const s = mathToScreen(p.x, p.y, view, w, h);
            return { x: p.x, y: p.y, sx: s.x, sy: s.y };
          });

          if (screenPts.length > 1) {
            ctx.strokeStyle = set.color;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.setLineDash([7, 5]);
            ctx.beginPath();
            screenPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy)));
            ctx.stroke();
            ctx.setLineDash([]);
          }

          for (const p of screenPts) {
            if (p.sx < -10 || p.sx > w + 10 || p.sy < -10 || p.sy > h + 10) continue;
            ctx.fillStyle = set.color;
            ctx.strokeStyle = theme.poiStroke;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(p.sx, p.sy, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }

          results.push({ id: `pointset-${set.id}`, color: set.color, points: screenPts, pois: [] });
        }

        this._lastRender = results;
      }

      _drawGrid() {
        const { ctx, view, theme } = this;
        const w = this._width, h = this._height;
        const gx = niceGridSpacing(view.xMax - view.xMin);
        const gy = niceGridSpacing(view.yMax - view.yMin);
        const startX = Math.ceil(view.xMin / gx) * gx;
        const startY = Math.ceil(view.yMin / gy) * gy;
        const origin = mathToScreen(0, 0, view, w, h);

        if (this.showGrid) {
          if (this.gridStyle === 'dots') {
            ctx.fillStyle = theme.grid;
            for (let x = startX; x <= view.xMax; x += gx) {
              for (let y = startY; y <= view.yMax; y += gy) {
                const p = mathToScreen(x, y, view, w, h);
                ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill();
              }
            }
          } else {
            ctx.strokeStyle = theme.grid;
            ctx.lineWidth = 1;
            for (let x = startX; x <= view.xMax; x += gx) {
              const p = mathToScreen(x, 0, view, w, h);
              ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, h); ctx.stroke();
            }
            for (let y = startY; y <= view.yMax; y += gy) {
              const p = mathToScreen(0, y, view, w, h);
              ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(w, p.y); ctx.stroke();
            }
          }
        }

        if (this.showAxes) {
          ctx.strokeStyle = theme.axis;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, h); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, origin.y); ctx.lineTo(w, origin.y); ctx.stroke();
        }

        if (this.showGrid) {
          ctx.fillStyle = theme.tick;
          ctx.font = '11px JetBrains Mono, monospace';
          const stickyY = clamp(origin.y + 16, 18, h - 10);
          for (let x = startX; x <= view.xMax; x += gx) {
            if (Math.abs(x) < gx * 1e-6) continue;
            const p = mathToScreen(x, 0, view, w, h);
            ctx.fillText(formatTick(x, gx), p.x - 6, stickyY);
          }
          const stickyX = clamp(origin.x + 8, 8, w - 35);
          for (let y = startY; y <= view.yMax; y += gy) {
            if (Math.abs(y) < gy * 1e-6) continue;
            const p = mathToScreen(0, y, view, w, h);
            ctx.fillText(formatTick(y, gy), stickyX, p.y + 4);
          }
        }
      }
    }

    // ────────────────────────────────────────────────────────────────
    //  UI & Reactive Equations Binding
    // ────────────────────────────────────────────────────────────────

    const canvas = document.getElementById('c');
    const tooltip = document.getElementById('tooltip');
    const hoverDot = document.getElementById('hover-dot');
    const eqList = document.getElementById('eq-list');

    // Create the engine instance
    const engine = new GraphEngine(canvas, {
      onHover(hit) {
        if (!hit) {
          tooltip.style.display = 'none';
          if (hoverDot) hoverDot.style.display = 'none';
          return;
        }
        tooltip.style.display = 'block';
        tooltip.style.left = `${hit.screenX + 15}px`;
        tooltip.style.top = `${hit.screenY - 15}px`;
        tooltip.style.borderColor = hit.color;
        tooltip.textContent = hit.label;
        
        if (hoverDot) {
          hoverDot.style.display = 'block';
          hoverDot.style.left = `${hit.screenX}px`;
          hoverDot.style.top = `${hit.screenY}px`;
          hoverDot.style.borderColor = hit.color;
        }
      }
    });



    function checkSymmetry(fn, view) {
      const span = Math.min(Math.max(Math.abs(view.xMax), Math.abs(view.xMin)), 25) || 5;
      let even = true, odd = true, any = false;
      for (let i = 1; i <= 40; i++) {
        const x = (i / 40) * span;
        const a = fn(x), b = fn(-x);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        any = true;
        const scale = Math.abs(a) + Math.abs(b) + 1;
        if (Math.abs(a - b) > 1e-6 * scale) even = false;
        if (Math.abs(a + b) > 1e-6 * scale) odd = false;
      }
      if (!any) return 'not enough defined points to determine symmetry';
      if (even) return 'even — symmetric about the y-axis, since f(−x) = f(x)';
      if (odd) return 'odd — symmetric about the origin, since f(−x) = −f(x)';
      return 'neither even nor odd (no simple symmetry)';
    }

    function endBehavior(fn) {
      const describe = (vals) => {
        if (vals.some((v) => !Number.isFinite(v))) return 'is undefined that far out, so no clear trend can be read off';
        const [a, b, c] = vals;
        if (c > b && b > a && c > 1e6) return 'grows without bound (heads toward +∞)';
        if (c < b && b < a && c < -1e6) return 'falls without bound (heads toward −∞)';
        if (Math.abs(c - b) < 1e-4 * (Math.abs(c) + 1)) return `levels off near y ≈ ${c.toFixed(3)} (a likely horizontal asymptote)`;
        return 'keeps changing rather than settling (e.g. oscillating)';
      };
      return {
        right: describe([1e2, 1e3, 1e4].map((v) => fn(v))),
        left: describe([1e2, 1e3, 1e4].map((v) => fn(-v))),
      };
    }

    function buildExplicitSteps(text, fn, view) {
      const pois = findPOIs(fn, view);
      const roots = pois.filter((p) => p.type === 'root');
      const extrema = pois.filter((p) => p.type === 'max' || p.type === 'min');
      const yint = pois.find((p) => p.type === 'yint');
      const sym = checkSymmetry(fn, view);
      const end = endBehavior(fn);

      return [
        { title: 'Identify the equation type', detail: `y = ${text} is ${classifyExplicit(text)}.` },
        {
          title: 'Find the y-intercept (set x = 0)',
          detail: yint ? `f(0) = ${yint.y.toFixed(3)}, so the curve crosses the y-axis at (0, ${yint.y.toFixed(3)}).`
            : 'f(0) is undefined, so the curve never crosses the y-axis.',
        },
        {
          title: 'Find the x-intercept(s) — set y = 0',
          detail: roots.length
            ? `Solving y = 0 in the visible range gives ${roots.length} root${roots.length > 1 ? 's' : ''}: ${roots.map((r) => `x ≈ ${r.x.toFixed(3)}`).join(', ')}.`
            : 'No point in the visible range solves y = 0 — the curve does not cross the x-axis here.',
        },
        { title: 'Check for symmetry', detail: `Comparing f(x) with f(−x), this function is ${sym}.` },
        {
          title: 'Locate turning points (local max/min)',
          detail: extrema.length
            ? extrema.map((e) => `a local ${e.type === 'max' ? 'maximum' : 'minimum'} at (${e.x.toFixed(3)}, ${e.y.toFixed(3)})`).join(', ') + ' — found where the slope changes sign.'
            : 'No sign change in the slope was found in view, so the curve is monotonic (purely increasing or decreasing) here.',
        },
        {
          title: 'Describe the end behavior',
          detail: `Moving right (x → +∞) the graph ${end.right}. Moving left (x → −∞) the graph ${end.left}.`,
        },
      ];
    }

    function classifyImplicit(lhsText, rhsText) {
      const t = (lhsText + '=' + rhsText).replace(/\s+/g, '');
      const hasX2 = /x\^2\b/i.test(t), hasY2 = /y\^2\b/i.test(t);
      const higherX = /x\^([3-9]|\d{2,})/i.test(t), higherY = /y\^([3-9]|\d{2,})/i.test(t);
      if (hasX2 && hasY2 && !higherX && !higherY) return 'a conic-type curve — both x and y appear squared, as in a circle or ellipse';
      if ((hasX2 && !hasY2) || (hasY2 && !hasX2)) return 'a curve where only one variable is squared — parabola-like';
      return 'a general implicit relation between x and y';
    }

    function checkImplicitSymmetry(g, view) {
      let symY = true, symX = true, symOrigin = true, symSwap = true, any = false;
      for (let i = 0; i < 35; i++) {
        const x = view.xMin + Math.random() * (view.xMax - view.xMin);
        const y = view.yMin + Math.random() * (view.yMax - view.yMin);
        const v = g(x, y);
        if (!Number.isFinite(v)) continue;
        any = true;
        const eps = 1e-4 * (Math.abs(v) + 1);
        if (Math.abs(g(-x, y) - v) > eps) symY = false;
        if (Math.abs(g(x, -y) - v) > eps) symX = false;
        if (Math.abs(g(-x, -y) - v) > eps) symOrigin = false;
        if (Math.abs(g(y, x) - v) > eps) symSwap = false;
      }
      if (!any) return [];
      const found = [];
      if (symY) found.push('the y-axis');
      if (symX) found.push('the x-axis');
      if (symOrigin) found.push('the origin');
      if (symSwap) found.push('the line y = x');
      return found;
    }

    function buildImplicitSteps(text, g, view, points) {
      const [lhsText, rhsText] = text.split('=').map((s) => s.trim());
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      for (const p of points) {
        if (!p) continue;
        if (p.x < xMin) xMin = p.x; if (p.x > xMax) xMax = p.x;
        if (p.y < yMin) yMin = p.y; if (p.y > yMax) yMax = p.y;
      }
      const hasExtent = Number.isFinite(xMin);
      const symmetries = checkImplicitSymmetry(g, view);

      const steps = [
        { title: 'Identify the equation type', detail: `${lhsText} = ${rhsText} describes ${classifyImplicit(lhsText, rhsText)}.` },
        {
          title: 'Understand what "implicit" means here',
          detail: 'Neither side isolates y, so this is not a single function y = f(x). For a given x there can be zero, one, or several y-values that satisfy the equation (and the same going the other way for x).',
        },
        {
          title: 'Check for symmetry',
          detail: symmetries.length
            ? `Testing points across the equation shows it is symmetric about ${symmetries.join(', ')}.`
            : 'No exact symmetry about the axes, origin, or the line y = x was detected.',
        },
        {
          title: 'Visible extent of the curve',
          detail: hasExtent
            ? `Within the current view, the curve spans roughly x ∈ [${xMin.toFixed(2)}, ${xMax.toFixed(2)}] and y ∈ [${yMin.toFixed(2)}, ${yMax.toFixed(2)}].`
            : 'No points of this curve fall inside the current view — try zooming out.',
        },
      ];
      return steps;
    }



    // Preset equations
    const palette = ['#6366f1', '#10b981', '#ef4444', '#f59e0b', '#ec4899', '#06b6d4'];
    let colorIdx = 0;

    let eqData = [];

    // Render Equations Cards List in DOM
    function renderCards() {
      eqList.innerHTML = '';
      eqData.forEach((eq) => {
        const engineEq = engine.equations.find(e => e.id === eq.id);
        let errorMsg = engineEq ? engineEq.error : null;
        if (eq.text.trim() === '' && !eq.visualized) {
          errorMsg = null;
        }

        const card = document.createElement('div');
        card.className = `eq-card ${errorMsg ? 'error' : ''}`;
        card.innerHTML = `
          <div class="eq-row">
            <div class="eq-input-wrapper">
              <input type="text" class="eq-input" value="${eq.text}" placeholder="" spellcheck="false" autocomplete="off">
            </div>
            <button class="btn-icon delete" title="Delete equation">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
          <div class="eq-error" style="display: ${errorMsg ? 'block' : 'none'}">${errorMsg}</div>
        `;

        const textInput = card.querySelector('.eq-input');
        const inputWrapper = card.querySelector('.eq-input-wrapper');
        const deleteBtn = card.querySelector('.btn-icon.delete');
        const errBox = card.querySelector('.eq-error');

        // Focused styling
        textInput.addEventListener('focus', () => {
          card.classList.add('active-focus');
          if (activeEqId !== eq.id) {
            activeEqId = eq.id;
            if (typeof refreshPPSelector === 'function') refreshPPSelector();
          }
        });
        textInput.addEventListener('blur', () => {
          card.classList.remove('active-focus');
          engine.setEquationText(eq.id, eq.text);
          if (typeof refreshPPSelector === 'function') refreshPPSelector();
        });

        // Text input: store text locally only (no live render).
        textInput.addEventListener('input', (e) => {
          const val = e.target.value;
          const pos = e.target.selectionStart;
          const newVal = val.replace(/X/g, 'x').replace(/Y/g, 'y');
          if (val !== newVal) {
            e.target.value = newVal;
            e.target.setSelectionRange(pos, pos);
          }
          eq.text = e.target.value;
          eq.visualized = false;
          card.classList.remove('error');
          errBox.style.display = 'none';
          if (typeof refreshPPSelector === 'function') refreshPPSelector();
        });

        // Enter key: add a new equation row
        textInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addBlankEquation(true);
          }
        });

        // Delete button
        deleteBtn.addEventListener('click', () => {
          engine.removeEquation(eq.id);
          eqData = eqData.filter(item => item.id !== eq.id);
          if (eqData.length === 0) {
            addBlankEquation(false);
          } else {
            renderCards();
          }
        });

        eqList.appendChild(card);
      });
      if (typeof refreshPPSelector === 'function') refreshPPSelector();
    }

    // ── Point Plotter ─────────────────────────────────────────────
    // Reads compiled equations from the shared eqData — no separate
    // equation input. The user picks which equation to use from the
    // dropdown, then enters x values one by one.
    const pointsPanel    = document.getElementById('points-panel');
    const pointsToggle   = document.getElementById('points-toggle');
    const ppActiveEqContainer = document.getElementById('pp-active-eq-container');
    const ppActiveEqSelect = document.getElementById('pp-active-eq-select');
    const ppStep2        = document.getElementById('pp-step2');
    const ppNoEq         = document.getElementById('pp-no-eq');
    const pointsXInput   = document.getElementById('points-x-input');
    const pointsYPreview = document.getElementById('points-y-preview');
    const pointsXError   = document.getElementById('points-x-error');
    const ppTableSection  = document.getElementById('pp-table-section');
    const pointsClearBtn  = document.getElementById('points-clear-btn');
    const emptyStateEl    = document.getElementById('empty-state');

    const pointSetId = engine.addPointSet('#f59e0b');
    let plottedPoints = [];
    let pointsFn = null; // the currently selected compiled fn

    pointsToggle.addEventListener('click', () => {
      const collapsed = pointsPanel.classList.toggle('collapsed');
      engine.showCurves = collapsed;
      engine._markDirty(true);
    });

    let activeEqId = null;
    let lastActiveEqId = null;

    // Rebuild the equation selector whenever eqData changes
    function refreshPPSelector() {
      const validEqs = eqData.filter(eq => {
        const eng = engine.equations.find(e => e.id === eq.id);
        return eq.text.trim() && eng && !eng.error && eng.fn && !eng.implicit;
      });

      let activeEq = validEqs.find(eq => eq.id === activeEqId);
      if (!activeEq && validEqs.length > 0) {
        activeEq = validEqs[0];
        activeEqId = activeEq.id;
      }

      const isValid = activeEq !== undefined;

      ppActiveEqContainer.style.display = isValid ? 'flex' : 'none';
      ppStep2.style.display  = isValid ? 'flex' : 'none';
      ppNoEq.style.display   = isValid ? 'none' : 'block';

      if (isValid) {
        ppActiveEqSelect.innerHTML = validEqs.map(eq => {
          const text = eq.text.includes('=') ? eq.text : `y = ${eq.text}`;
          return `<option value="${eq.id}" ${eq.id === activeEqId ? 'selected' : ''}>${text}</option>`;
        }).join('');
        
        const eng = engine.equations.find(e => e.id === activeEqId);
        pointsFn = eng ? eng.fn : null;
      } else {
        ppActiveEqSelect.innerHTML = '';
        pointsFn = null;
      }

      // Reset plotted points ONLY if activeEqId actually changed to a different equation
      if (activeEqId !== lastActiveEqId) {
        lastActiveEqId = activeEqId;
        plottedPoints = [];
        syncPointSet();
      }
    }

    ppActiveEqSelect.addEventListener('change', () => {
      activeEqId = Number(ppActiveEqSelect.value);
      refreshPPSelector();
    });

    // This function is no longer needed since refreshPPSelector directly reads activeEqId
    // keeping it empty or deleting references to it.

    function revealGraphIfNeeded() {
      if (!emptyStateEl.classList.contains('hidden')) emptyStateEl.classList.add('hidden');
    }

    function renderPointsSummary() {
      const n = plottedPoints.length;
      pointsClearBtn.disabled = (n === 0);
      pointsClearBtn.style.opacity = n ? '1' : '0.3';
      pointsClearBtn.style.cursor = n ? 'pointer' : 'default';
    }

    function syncPointSet() {
      engine.setPointSetPoints(pointSetId, plottedPoints);
      renderPointsSummary();
    }

    pointsClearBtn.addEventListener('click', () => { plottedPoints = []; syncPointSet(); });

    function updateYPreview() {
      pointsXError.style.display = 'none';
      const xRaw = pointsXInput.value.trim();
      if (xRaw === '') {
        pointsYPreview.textContent = '';
        return;
      }
      const x = Number(xRaw);
      if (!Number.isFinite(x)) {
        pointsYPreview.textContent = '';
        return;
      }
      if (!pointsFn) {
        pointsYPreview.textContent = '';
        return;
      }
      const y = pointsFn(x);
      if (!Number.isFinite(y)) {
        pointsYPreview.textContent = 'y = undefined';
        pointsYPreview.style.color = 'var(--text-muted)';
      } else {
        const yStr = Number.isInteger(y) ? y : y.toFixed(4).replace(/\.?0+$/, '');
        pointsYPreview.textContent = `y = ${yStr}`;
        pointsYPreview.style.color = 'var(--accent)';
      }
    }

    pointsXInput.addEventListener('input', updateYPreview);

    function plotPointFromInput() {
      pointsXError.style.display = 'none';
      if (!pointsFn) {
        pointsXError.textContent = 'Select a valid equation first.';
        pointsXError.style.display = 'block';
        return;
      }
      const xRaw = pointsXInput.value.trim();
      if (xRaw === '') { pointsXInput.focus(); return; }
      const x = Number(xRaw);
      if (!Number.isFinite(x)) {
        pointsXError.textContent = 'Please enter a valid number.';
        pointsXError.style.display = 'block';
        return;
      }
      const y = pointsFn(x);
      if (!Number.isFinite(y)) {
        pointsXError.textContent = `f(${x}) is undefined for this equation.`;
        pointsXError.style.display = 'block';
        return;
      }
      plottedPoints.push({ x, y });
      syncPointSet();
      revealGraphIfNeeded();
      pointsXInput.value = '';
      pointsYPreview.textContent = '';
      pointsXInput.focus();
    }

    pointsXInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); plotPointFromInput(); }
    });

    // Initial state
    refreshPPSelector();

    function addBlankEquation(focused = false) {
      const color = palette[colorIdx++ % palette.length];
      const newEq = {
        id: null,
        text: '',
        color: color,
        visible: true,
        visualized: false
      };
      newEq.id = engine.addEquation('', newEq.color, newEq.visible);
      eqData.push(newEq);
      renderCards();

      if (focused) {
        // Auto-focus the newly added card's input
        const inputs = eqList.querySelectorAll('.eq-input');
        if (inputs.length) inputs[inputs.length - 1].focus();
      }
    }

    // Visualize — commit all equations, then show a static preview before entering interactive view
    const previewOverlay = document.getElementById('preview-overlay');
    const previewImg = document.getElementById('preview-img');
    let previewDataUrl = null;

    function enterInteractiveView() {
      // Collapse the sidebar instantly behind the modal to prevent visual layout stretching
      sidebar.classList.add('no-transition');
      sidebar.classList.add('collapsed');
      sidebarIcon.innerHTML = hamburgerPath;
      document.getElementById('empty-state').classList.add('hidden');

      // Resize the canvas instantly while it is still covered by the modal
      engine._resize();
      engine._render();

      // Trigger reflow to apply the transition-less state, then re-enable transition for future toggles
      sidebar.offsetHeight;
      sidebar.classList.remove('no-transition');

      // Finally close the preview overlay modal smoothly
      previewOverlay.classList.remove('open');
    }

    document.getElementById('visualize-btn').addEventListener('click', () => {
      // If on mobile/tablet, collapse the sidebar so the graph is visible
      if (window.innerWidth <= 768) {
        sidebar.classList.add('collapsed');
        sidebarIcon.innerHTML = hamburgerPath;
        setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
      }
      pointsPanel.classList.add('collapsed');
      engine.showCurves = true;
      eqData.forEach(eq => {
        eq.visualized = true;
        const err = engine.setEquationText(eq.id, eq.text);
        // Reflect any compile errors back onto the cards
        const card = [...eqList.querySelectorAll('.eq-card')][eqData.indexOf(eq)];
        if (card) {
          const errBox = card.querySelector('.eq-error');
          if (err) {
            card.classList.add('error');
            errBox.textContent = err;
            errBox.style.display = 'block';
          } else {
            card.classList.remove('error');
            errBox.style.display = 'none';
          }
        }
      });
      if (typeof refreshPPSelector === 'function') refreshPPSelector();
      // Wait a couple of frames so the engine's render loop has drawn the latest equations,
      // then snapshot the canvas as a still image for the preview.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        previewDataUrl = canvas.toDataURL('image/png');
        previewImg.src = previewDataUrl;
        previewOverlay.classList.add('open');
      }));
    });

    document.getElementById('preview-close').addEventListener('click', () => {
      previewOverlay.classList.remove('open');
    });



    document.getElementById('preview-interact').addEventListener('click', enterInteractiveView);

    document.getElementById('preview-download').addEventListener('click', () => {
      if (!previewDataUrl) return;
      const a = document.createElement('a');
      a.href = previewDataUrl;
      a.download = 'profpi-graph.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    // Control buttons bindings
    document.getElementById('zoom-fit').addEventListener('click', () => engine.fitView());
    document.getElementById('zoom-in').addEventListener('click', () => engine.zoomStep(0.8));
    document.getElementById('zoom-out').addEventListener('click', () => engine.zoomStep(1.25));
    document.getElementById('reset-view').addEventListener('click', () => engine.resetView());

    // ─── Graph settings menu (axes / grid / grid style) ──────────────
    const settingsBtn = document.getElementById('graph-settings-btn');
    const settingsMenu = document.getElementById('settings-menu');
    const toggleAxes = document.getElementById('toggle-axes');
    const toggleGrid = document.getElementById('toggle-grid');
    const gridStyleBtns = [...document.querySelectorAll('.grid-style-btn')];

    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsMenu.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (settingsMenu.classList.contains('open') && !settingsMenu.contains(e.target) && e.target !== settingsBtn) {
        settingsMenu.classList.remove('open');
      }
    });

    function setActiveGridStyle(style) {
      gridStyleBtns.forEach(b => b.classList.toggle('active', b.dataset.style === style));
    }

    toggleAxes.addEventListener('change', () => {
      engine.showAxes = toggleAxes.checked;
      engine._markDirty(true);
      setActiveGridStyle(null); // custom combo, no single preset matches
    });
    toggleGrid.addEventListener('change', () => {
      engine.showGrid = toggleGrid.checked;
      engine._markDirty(true);
      setActiveGridStyle(null);
    });

    gridStyleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const style = btn.dataset.style;
        if (style === 'grid-axes') { engine.showGrid = true; engine.showAxes = true; engine.gridStyle = 'lines'; }
        else if (style === 'grid-only') { engine.showGrid = true; engine.showAxes = false; engine.gridStyle = 'lines'; }
        else if (style === 'axes-only') { engine.showGrid = false; engine.showAxes = true; }
        else if (style === 'blank') { engine.showGrid = false; engine.showAxes = false; }
        else if (style === 'dots') { engine.showGrid = true; engine.showAxes = true; engine.gridStyle = 'dots'; }
        toggleAxes.checked = engine.showAxes;
        toggleGrid.checked = engine.showGrid;
        setActiveGridStyle(style);
        engine._markDirty(true);
      });
    });

    document.getElementById('open-settings-link').addEventListener('click', () => {
      settingsMenu.classList.remove('open');
    });

    // Initial render of equation list (add one blank box to start with)
    addBlankEquation(false);

    // Sidebar toggle
    const sidebar = document.getElementById('sidebar');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle');
    const sidebarIcon = document.getElementById('sidebar-toggle-icon');
    const hamburgerPath = `<line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line>`;
    const closePath = `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>`;

    sidebarToggleBtn.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('collapsed');
      sidebarIcon.innerHTML = hamburgerPath;
      // Trigger resize so the canvas redraws to fill new space
      setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
    });
    
    document.getElementById('mobile-sidebar-close')?.addEventListener('click', () => {
      sidebar.classList.add('collapsed');
      sidebarIcon.innerHTML = hamburgerPath;
      setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
    });

    // ─── Dark mode ──────────────────────────────────────────────────
    const themeToggleBtn = document.getElementById('theme-toggle');
    const LIGHT_CANVAS_THEME = { bg: '#ffffff', grid: '#e2e8f0', axis: '#475569', tick: '#64748b', poiFill: '#94a3b8', poiStroke: '#ffffff' };
    const DARK_CANVAS_THEME = { bg: '#0f172a', grid: '#1e293b', axis: '#64748b', tick: '#94a3b8', poiFill: '#64748b', poiStroke: '#0f172a' };
    const sunIcon = `<circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"></line><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"></line><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"></line>`;
    const moonIcon = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;

    function applyTheme(mode) {
      document.documentElement.setAttribute('data-theme', mode);
      Object.assign(engine.theme, mode === 'dark' ? DARK_CANVAS_THEME : LIGHT_CANVAS_THEME);
      engine._markDirty(true);
      document.getElementById('theme-toggle-icon').innerHTML = mode === 'dark' ? sunIcon : moonIcon;
    }

    let currentTheme = 'light';
    try { currentTheme = localStorage.getItem('profpi-theme') || 'light'; } catch (_) { }
    applyTheme(currentTheme);

    themeToggleBtn.addEventListener('click', () => {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(currentTheme);
      try { localStorage.setItem('profpi-theme', currentTheme); } catch (_) { }
    });

    // Math keyboard: insert at cursor in the last focused eq-input
    // ─── Autocomplete ───────────────────────────────────────────────
    const AC_SUGGESTIONS = [
      // Trig
      { label: 'sin(x)', word: 'sin', insert: 'sin(', badge: 'trig', desc: 'Sine' },
      { label: 'cos(x)', word: 'cos', insert: 'cos(', badge: 'trig', desc: 'Cosine' },
      { label: 'tan(x)', word: 'tan', insert: 'tan(', badge: 'trig', desc: 'Tangent' },
      { label: 'cot(x)', word: 'cot', insert: 'cot(', badge: 'trig', desc: 'Cotangent' },
      { label: 'sec(x)', word: 'sec', insert: 'sec(', badge: 'trig', desc: 'Secant' },
      { label: 'csc(x)', word: 'csc', insert: 'csc(', badge: 'trig', desc: 'Cosecant' },
      // Inverse trig
      { label: 'asin(x)', word: 'asin', insert: 'asin(', badge: 'inv', desc: 'Arcsine' },
      { label: 'acos(x)', word: 'acos', insert: 'acos(', badge: 'inv', desc: 'Arccosine' },
      { label: 'atan(x)', word: 'atan', insert: 'atan(', badge: 'inv', desc: 'Arctangent' },
      { label: 'acot(x)', word: 'acot', insert: 'acot(', badge: 'inv', desc: 'Arccotangent' },
      { label: 'asec(x)', word: 'asec', insert: 'asec(', badge: 'inv', desc: 'Arcsecant' },
      { label: 'acsc(x)', word: 'acsc', insert: 'acsc(', badge: 'inv', desc: 'Arccosecant' },
      // Hyperbolic
      { label: 'sinh(x)', word: 'sinh', insert: 'sinh(', badge: 'hyp', desc: 'Hyperbolic sine' },
      { label: 'cosh(x)', word: 'cosh', insert: 'cosh(', badge: 'hyp', desc: 'Hyperbolic cosine' },
      { label: 'tanh(x)', word: 'tanh', insert: 'tanh(', badge: 'hyp', desc: 'Hyperbolic tangent' },
      { label: 'coth(x)', word: 'coth', insert: 'coth(', badge: 'hyp', desc: 'Hyperbolic cotangent' },
      { label: 'sech(x)', word: 'sech', insert: 'sech(', badge: 'hyp', desc: 'Hyperbolic secant' },
      { label: 'csch(x)', word: 'csch', insert: 'csch(', badge: 'hyp', desc: 'Hyperbolic cosecant' },
      // Inverse hyperbolic
      { label: 'asinh(x)', word: 'asinh', insert: 'asinh(', badge: 'ihyp', desc: 'Inverse hyperbolic sine' },
      { label: 'acosh(x)', word: 'acosh', insert: 'acosh(', badge: 'ihyp', desc: 'Inverse hyperbolic cosine' },
      { label: 'atanh(x)', word: 'atanh', insert: 'atanh(', badge: 'ihyp', desc: 'Inverse hyperbolic tangent' },
      { label: 'acoth(x)', word: 'acoth', insert: 'acoth(', badge: 'ihyp', desc: 'Inverse hyperbolic cotangent' },
      { label: 'asech(x)', word: 'asech', insert: 'asech(', badge: 'ihyp', desc: 'Inverse hyperbolic secant' },
      { label: 'acsch(x)', word: 'acsch', insert: 'acsch(', badge: 'ihyp', desc: 'Inverse hyperbolic cosecant' },
      // General functions
      { label: 'sqrt(x)', word: 'sqrt', insert: 'sqrt(', badge: 'fn', desc: 'Square root' },
      { label: 'cbrt(x)', word: 'cbrt', insert: 'cbrt(', badge: 'fn', desc: 'Cube root' },
      { label: 'abs(x)', word: 'abs', insert: 'abs(', badge: 'fn', desc: 'Absolute value' },
      { label: 'exp(x)', word: 'exp', insert: 'exp(', badge: 'fn', desc: 'e^x' },
      { label: 'ln(x)', word: 'ln', insert: 'ln(', badge: 'fn', desc: 'Natural log' },
      { label: 'log(x)', word: 'log', insert: 'log(', badge: 'fn', desc: 'Log base 10' },
      { label: 'log2(x)', word: 'log2', insert: 'log2(', badge: 'fn', desc: 'Log base 2' },
      { label: 'floor(x)', word: 'floor', insert: 'floor(', badge: 'fn', desc: 'Round down' },
      { label: 'ceil(x)', word: 'ceil', insert: 'ceil(', badge: 'fn', desc: 'Round up' },
      { label: 'round(x)', word: 'round', insert: 'round(', badge: 'fn', desc: 'Round nearest' },
      { label: 'trunc(x)', word: 'trunc', insert: 'trunc(', badge: 'fn', desc: 'Truncate decimal' },
      { label: 'sign(x)', word: 'sign', insert: 'sign(', badge: 'fn', desc: 'Sign of x' },
      // Constants
      { label: 'pi', word: 'pi', insert: 'pi', badge: 'var', desc: 'π ≈ 3.14159' },
      { label: 'e', word: 'e', insert: 'e', badge: 'var', desc: 'Euler\'s number ≈ 2.71828' },
    ];

    const acDrop = document.getElementById('ac-dropdown');
    let acActiveIdx = -1;
    let acVisible = false;
    let acMatchedInput = null;
    let acWordStart = 0;

    function acHide() {
      acDrop.style.display = 'none';
      acDrop.innerHTML = '';
      acVisible = false;
      acActiveIdx = -1;
    }

    function acAccept(suggestion, input) {
      if (!input) return;
      const before = input.value.slice(0, acWordStart);
      const after = input.value.slice(input.selectionStart);
      let newVal, cursor;
      if (suggestion.insert.endsWith('(')) {
        newVal = before + suggestion.insert + ')' + after;
        cursor = before.length + suggestion.insert.length;
      } else {
        newVal = before + suggestion.insert + after;
        cursor = before.length + suggestion.insert.length;
      }
      input.value = newVal;
      input.setSelectionRange(cursor, cursor);
      // sync to eqData
      const idx = [...eqList.querySelectorAll('.eq-input')].indexOf(input);
      if (idx >= 0 && eqData[idx]) eqData[idx].text = newVal;
      acHide();
    }

    // Ranked matches for a typed word: exact prefix matches first, then anywhere-substring matches.
    function acMatches(word) {
      const w = word.toLowerCase();
      if (!w) return [];
      const starts = AC_SUGGESTIONS.filter(s => s.word.startsWith(w));
      const contains = AC_SUGGESTIONS.filter(s => !s.word.startsWith(w) && s.word.includes(w));
      return [...starts, ...contains];
    }

    function acShow(input, word, rect) {
      const matches = acMatches(word);
      if (!matches.length) { acHide(); return; }

      acDrop.innerHTML = matches.map((s, i) => `
        <div class="ac-item" data-idx="${i}">
          <div class="ac-item-main">
            <span class="ac-item-name">${s.label}</span>
            <span class="ac-item-desc">${s.desc}</span>
          </div>
          <span class="ac-item-badge ac-badge-${s.badge}">${s.badge}</span>
        </div>
      `).join('');
      acDrop.style.display = 'flex';
      acDrop.style.left = rect.left + 'px';
      acDrop.style.top = (rect.bottom + 4) + 'px';
      acDrop.style.width = Math.max(rect.width, 220) + 'px';
      acVisible = true;
      acMatchedInput = input;

      acDrop.querySelectorAll('.ac-item').forEach((el, i) => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          acAccept(matches[i], input);
          input.focus();
        });
      });

      // Do not highlight a match by default so Enter just types the user's string.
      // They must use ArrowDown to select a suggestion.
      acSetActive(-1);
    }

    function acSetActive(idx) {
      const items = acDrop.querySelectorAll('.ac-item');
      items.forEach(el => el.classList.remove('ac-active'));
      if (idx >= 0 && idx < items.length) {
        items[idx].classList.add('ac-active');
        items[idx].scrollIntoView({ block: 'nearest' });
      }
      acActiveIdx = idx;
    }

    // Hook autocomplete onto each eq-input via delegation
    eqList.addEventListener('input', (e) => {
      const input = e.target;
      if (!input.classList.contains('eq-input')) return;
      const pos = input.selectionStart;
      const textBefore = input.value.slice(0, pos);
      const m = textBefore.match(/([a-zA-Z_]+)$/);
      const word = m ? m[1] : '';
      acWordStart = pos - word.length;
      const rect = input.getBoundingClientRect();
      acShow(input, word, rect);
    });

    eqList.addEventListener('keydown', (e) => {
      if (!acVisible) return;
      const items = acDrop.querySelectorAll('.ac-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        acSetActive(Math.min(acActiveIdx + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        acSetActive(acActiveIdx <= 0 ? -1 : acActiveIdx - 1);
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        if (acActiveIdx >= 0) {
          e.preventDefault();
          e.stopPropagation();
          const word = acMatchedInput.value.slice(acWordStart, acMatchedInput.selectionStart);
          const matches = acMatches(word);
          const pick = matches[acActiveIdx];
          if (pick) acAccept(pick, acMatchedInput);
        } else {
          acHide();
        }
      } else if (e.key === 'Escape') {
        acHide();
      }
    }, true);

    document.addEventListener('click', (e) => {
      if (!acDrop.contains(e.target)) acHide();
    });

// Global export
if (typeof window !== 'undefined') window.GraphEngine = GraphEngine;

// Revert pen feature - fresh build trigger for 82f7d07
