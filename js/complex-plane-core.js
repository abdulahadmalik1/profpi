// profpi — Complex Plane / Domain Coloring core engine
//
// Phase 5. Takes a user-typed f(z) (still parsed by the SAME whitelisted
// expr-parser.js used everywhere else on the site — no new eval surface)
// and produces two things off the exact same validated AST:
//
//   1. GLSL source for a WebGL fragment shader, so panning/zooming can
//      re-evaluate f(z) at every pixel in real time.
//   2. A JS closure (evalAt) that evaluates the identical AST using
//      mathcore.js's already-tested Complex class, used for: the
//      click-to-inspect readout, a canvas-2D fallback renderer when
//      WebGL isn't available, and as the reference implementation that
//      test-complex-plane-core.js checks the GLSL output against.
//
// Why a typed subset, not the full expr-parser grammar:
// Not every whitelisted function has a well-defined complex generalization
// (or one implemented in mathcore.js's Complex class). Rather than guess,
// this file does real type inference over the AST (every node is either
// 'real' or 'complex') and REJECTS — with a specific, actionable
// ComplexPlaneError — any use of a real-only function (asin, sinh, floor,
// atan2, mod, min, max, the pow(...) function form, etc.) on a
// complex-valued sub-expression. Complex-capable functions (sin, cos, tan,
// exp, sqrt, log/ln, abs) work on either. This mirrors the site's existing
// "stay strictly scoped" philosophy (see Laplace phase 6 notes) rather
// than bundling in an incomplete complex-analysis library.
//
// Poles/zeros: exact root-finding needs known numerator/denominator
// coefficients (via mathcore.polynomialRoots). There is no general,
// reliable way to extract "the" rational form from an arbitrary user
// expression tree without a CAS, so poles/zeros are only ever shown for
// the curated PRESETS below, where the coefficients are known exactly —
// never guessed from a free-typed expression.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./mathcore.js'), require('./expr-parser.js'));
  } else {
    root.ComplexPlaneCore = factory(root.MathCore, root.ExprParser);
  }
})(typeof self !== 'undefined' ? self : this, function (MathCore, ExprParser) {
  'use strict';

  const { Complex } = MathCore;

  class ComplexPlaneError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ComplexPlaneError';
    }
  }

  // ── Hard limits ─────────────────────────────────────────────────────
  // Independent of expr-parser's own MAX_EXPR_LENGTH/MAX_TOKENS/MAX_AST_DEPTH
  // (still enforced for free, since we go through ExprParser.parseToAst).
  const MIN_HALF_HEIGHT = 1e-6;   // zoom-in cap: below this, float32 in the
                                  // shader hits its precision wall well
                                  // before any conceptual limit does.
  const MAX_HALF_HEIGHT = 1e6;    // zoom-out cap, purely to keep numbers sane.
  const MAX_FALLBACK_PIXELS = 260; // canvas-2D (no WebGL) fallback resolution
                                    // cap per side — a JS per-pixel loop at
                                    // full canvas resolution would hang the tab.

  // ── Function classification (single source of truth for BOTH the GLSL
  //    codegen and the CPU evaluator below, so they can't drift apart) ──
  const COMPLEX_CAPABLE = new Set(['sin', 'cos', 'tan', 'exp', 'sqrt', 'log', 'ln']);
  // Real-only: no complex generalization is implemented (or, for
  // atan2/mod/min/max, no well-defined one exists at all).
  const REAL_ONLY_1 = new Set([
    'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
    'cbrt', 'log10', 'log2', 'sign', 'floor', 'ceil', 'round',
  ]);
  const REAL_ONLY_2 = new Set(['atan2', 'pow', 'mod']);
  const REAL_ONLY_VARIADIC = new Set(['min', 'max']);

  // ── Pass 1: type inference + validation over the shared AST ──────────
  // Annotates every node with node.exprType = 'real' | 'complex' in place.
  // Throws ComplexPlaneError (never silently coerces) on invalid mixing.
  function annotateTypes(ast) {
    switch (ast.type) {
      case 'num':
        ast.exprType = 'real';
        return ast;
      case 'var':
        ast.exprType = ast.name === 'z' ? 'complex' : 'real'; // pi, e
        return ast;
      case 'unary':
        annotateTypes(ast.expr);
        ast.exprType = ast.expr.exprType;
        return ast;
      case 'binary':
        annotateTypes(ast.left);
        annotateTypes(ast.right);
        ast.exprType = (ast.left.exprType === 'complex' || ast.right.exprType === 'complex') ? 'complex' : 'real';
        return ast;
      case 'call': {
        ast.args.forEach(annotateTypes);
        const anyComplex = ast.args.some((a) => a.exprType === 'complex');
        if (ast.name === 'abs') {
          ast.exprType = 'real'; // modulus of a complex input is always real
        } else if (COMPLEX_CAPABLE.has(ast.name)) {
          ast.exprType = anyComplex ? 'complex' : 'real';
        } else {
          if (anyComplex) {
            const hint = ast.name === 'pow'
              ? ' Use the ^ operator for complex exponents instead (e.g. z^2, not pow(z,2)).'
              : '';
            throw new ComplexPlaneError(
              `"${ast.name}(...)" only supports real-valued inputs in Complex Plane mode, but it was given a complex-valued argument here.${hint}`
            );
          }
          ast.exprType = 'real';
        }
        return ast;
      }
      default:
        throw new ComplexPlaneError('Internal error: unknown AST node during type inference');
    }
  }

  // ── Pass 2a: GLSL codegen ──────────────────────────────────────────────
  function formatGLSLFloat(x) {
    if (!Number.isFinite(x)) throw new ComplexPlaneError(`Cannot embed non-finite constant ${x} in shader`);
    let s = x.toString();
    if (!s.includes('.') && !s.includes('e') && !s.includes('E')) s += '.0';
    return s;
  }

  const REAL_GLSL_1 = {
    sin: 'sin', cos: 'cos', tan: 'tan', exp: 'exp', sqrt: 'sqrt', log: 'log', ln: 'log',
    asin: 'asin', acos: 'acos', atan: 'atan', sign: 'sign', floor: 'floor', ceil: 'ceil',
    sinh: 'gSinh', cosh: 'gCosh', tanh: 'gTanh', cbrt: 'gCbrt', log10: 'gLog10',
    log2: 'log2', round: 'gRound',
  };
  const COMPLEX_GLSL_1 = { sin: 'cSin', cos: 'cCos', tan: 'cTan', exp: 'cExp', sqrt: 'cSqrt', log: 'cLog', ln: 'cLog' };
  const BINARY_COMPLEX_FN = { '+': 'cAdd', '-': 'cSub', '*': 'cMul', '/': 'cDiv' };

  function nodeToGLSL(ast) {
    switch (ast.type) {
      case 'num':
        return formatGLSLFloat(ast.value);
      case 'var':
        if (ast.name === 'z') return 'z';
        if (ast.name === 'pi') return formatGLSLFloat(Math.PI);
        return formatGLSLFloat(Math.E); // 'e'
      case 'unary': {
        const inner = nodeToGLSL(ast.expr);
        if (ast.op === '+') return inner;
        return ast.expr.exprType === 'complex' ? `cNeg(${inner})` : `(-(${inner}))`;
      }
      case 'binary': {
        const l = nodeToGLSL(ast.left);
        const r = nodeToGLSL(ast.right);
        const bothReal = ast.left.exprType === 'real' && ast.right.exprType === 'real';
        if (ast.op === '^') {
          if (bothReal) return `pow(${l}, ${r})`;
          const lc = ast.left.exprType === 'complex' ? l : `vec2(${l}, 0.0)`;
          const rc = ast.right.exprType === 'complex' ? r : `vec2(${r}, 0.0)`;
          return `cPow(${lc}, ${rc})`;
        }
        if (bothReal) return `(${l} ${ast.op} ${r})`;
        const lc = ast.left.exprType === 'complex' ? l : `vec2(${l}, 0.0)`;
        const rc = ast.right.exprType === 'complex' ? r : `vec2(${r}, 0.0)`;
        return `${BINARY_COMPLEX_FN[ast.op]}(${lc}, ${rc})`;
      }
      case 'call': {
        const argsGLSL = ast.args.map(nodeToGLSL);
        const a = argsGLSL[0];
        const argType = ast.args[0].exprType;
        if (ast.name === 'abs') return argType === 'complex' ? `cAbs(${a})` : `abs(${a})`;
        if (COMPLEX_CAPABLE.has(ast.name) && argType === 'complex') return `${COMPLEX_GLSL_1[ast.name]}(${a})`;
        if (ast.name in REAL_GLSL_1) return `${REAL_GLSL_1[ast.name]}(${a})`;
        if (ast.name === 'atan2') return `atan(${argsGLSL[0]}, ${argsGLSL[1]})`;
        if (ast.name === 'pow') return `pow(${argsGLSL[0]}, ${argsGLSL[1]})`;
        if (ast.name === 'mod') return `gMod(${argsGLSL[0]}, ${argsGLSL[1]})`;
        if (ast.name === 'min' || ast.name === 'max') {
          return argsGLSL.reduce((acc, cur) => (acc === null ? cur : `${ast.name}(${acc}, ${cur})`), null);
        }
        throw new ComplexPlaneError(`Internal error: no GLSL codegen registered for "${ast.name}"`);
      }
      default:
        throw new ComplexPlaneError('Internal error: unknown AST node during GLSL codegen');
    }
  }

  // Fixed GLSL helper library, prepended to every generated shader.
  // GLSL ES 1.00 (WebGL1) has no sinh/cosh/tanh/cbrt/log10/round built in,
  // so those are hand-rolled (gSinh etc.) rather than assumed available —
  // this is what keeps the shader running on the widest set of GPUs/browsers.
  const GLSL_HELPERS = `
float gSinh(float x){ return (exp(x) - exp(-x)) * 0.5; }
float gCosh(float x){ return (exp(x) + exp(-x)) * 0.5; }
float gTanh(float x){ float e2 = exp(2.0*x); return (e2 - 1.0) / (e2 + 1.0); }
float gCbrt(float x){ return sign(x) * pow(abs(x), 1.0/3.0); }
float gLog10(float x){ return log(x) / log(10.0); }
float gRound(float x){ return floor(x + 0.5); }
float gMod(float a, float b){ return a - b * floor(a / b); }

vec2 cAdd(vec2 a, vec2 b){ return a + b; }
vec2 cSub(vec2 a, vec2 b){ return a - b; }
vec2 cNeg(vec2 a){ return -a; }
vec2 cMul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
vec2 cDiv(vec2 a, vec2 b){
  float d = max(dot(b, b), 1e-20);
  return vec2(a.x*b.x + a.y*b.y, a.y*b.x - a.x*b.y) / d;
}
float cAbs(vec2 a){ return length(a); }
vec2 cExp(vec2 a){ float r = exp(a.x); return vec2(r*cos(a.y), r*sin(a.y)); }
vec2 cLog(vec2 a){ float m = length(a); return vec2(log(max(m, 1e-20)), atan(a.y, a.x)); }
vec2 cSqrt(vec2 a){
  float r = length(a);
  float re = sqrt(max((r + a.x) * 0.5, 0.0));
  float imSign = a.y < 0.0 ? -1.0 : 1.0;
  float im = imSign * sqrt(max((r - a.x) * 0.5, 0.0));
  return vec2(re, im);
}
vec2 cSin(vec2 a){ return vec2(sin(a.x)*gCosh(a.y),  cos(a.x)*gSinh(a.y)); }
vec2 cCos(vec2 a){ return vec2(cos(a.x)*gCosh(a.y), -sin(a.x)*gSinh(a.y)); }
vec2 cTan(vec2 a){ return cDiv(cSin(a), cCos(a)); }
vec2 cPow(vec2 base, vec2 expo){
  if (base.x == 0.0 && base.y == 0.0) {
    if (expo.y == 0.0 && expo.x > 0.0) return vec2(0.0, 0.0);
    float nan = 0.0 / 0.0;
    return vec2(nan, nan);
  }
  return cExp(cMul(cLog(base), expo));
}`;

  function buildFragmentShader(bodyGLSL) {
    return `precision highp float;
uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_halfHeight;
uniform float u_ringStrength;
${GLSL_HELPERS}

vec3 hsv2rgb(vec3 c) {
  vec4 k = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  vec2 z = u_center + uv * (2.0 * u_halfHeight);

  vec2 w = ${bodyGLSL};

  if (w.x != w.x || w.y != w.y) { // NaN guard: undefined value, not garbage
    gl_FragColor = vec4(0.5, 0.5, 0.5, 1.0);
    return;
  }

  float m = length(w);
  float hue = atan(w.y, w.x) / (2.0 * 3.14159265359) + 0.5;
  float logm = log2(max(m, 1e-8));
  float ring = fract(logm);
  float ringBrightness = mix(0.35, 1.0, ring);
  float flatBrightness = 0.75;
  float brightness = mix(flatBrightness, ringBrightness, u_ringStrength);

  float towardBlack = m / (m + 0.12);           // zeros fade to black
  float towardWhite = (m*m*m) / (m*m*m + 4000.0); // poles fade to white
  brightness = mix(brightness * towardBlack, 1.0, towardWhite);

  gl_FragColor = vec4(hsv2rgb(vec3(hue, 0.85, brightness)), 1.0);
}`;
  }

  // ── Pass 2b: CPU reference evaluator (mathcore.Complex) ────────────────
  // Deliberately mirrors nodeToGLSL's dispatch 1:1 — this is the "ground
  // truth" test-complex-plane-core.js checks generated GLSL against.
  function evalNode(ast, zVal) {
    switch (ast.type) {
      case 'num':
        return ast.value;
      case 'var':
        if (ast.name === 'z') return zVal;
        return ast.name === 'pi' ? Math.PI : Math.E;
      case 'unary': {
        const v = evalNode(ast.expr, zVal);
        if (ast.op === '+') return v;
        return v instanceof Complex ? v.neg() : -v;
      }
      case 'binary': {
        const l = evalNode(ast.left, zVal);
        const r = evalNode(ast.right, zVal);
        const bothReal = !(l instanceof Complex) && !(r instanceof Complex);
        if (ast.op === '^') {
          if (bothReal) return Math.pow(l, r);
          const lz = l instanceof Complex ? l : new Complex(l, 0);
          const rz = r instanceof Complex ? r : new Complex(r, 0);
          return lz.pow(rz);
        }
        if (bothReal) {
          switch (ast.op) {
            case '+': return l + r;
            case '-': return l - r;
            case '*': return l * r;
            case '/': return l / r;
          }
        }
        const lz = l instanceof Complex ? l : new Complex(l, 0);
        const rz = r instanceof Complex ? r : new Complex(r, 0);
        switch (ast.op) {
          case '+': return lz.add(rz);
          case '-': return lz.sub(rz);
          case '*': return lz.mul(rz);
          case '/': return lz.div(rz);
        }
        throw new ComplexPlaneError(`Internal error: unknown operator "${ast.op}"`);
      }
      case 'call': {
        const args = ast.args.map((a) => evalNode(a, zVal));
        return evalCall(ast.name, args);
      }
      default:
        throw new ComplexPlaneError('Internal error: unknown AST node during evaluation');
    }
  }

  const REAL_JS_1 = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, sqrt: Math.sqrt, log: Math.log, ln: Math.log,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    cbrt: Math.cbrt, log10: Math.log10, log2: Math.log2, sign: Math.sign,
    floor: Math.floor, ceil: Math.ceil, round: Math.round,
  };

  function evalCall(name, args) {
    const a = args[0];
    const isComplex = a instanceof Complex;
    if (name === 'abs') return isComplex ? a.abs() : Math.abs(a);
    if (COMPLEX_CAPABLE.has(name) && isComplex) {
      switch (name) {
        case 'sin': return a.sin();
        case 'cos': return a.cos();
        case 'tan': return a.sin().div(a.cos());
        case 'exp': return a.exp();
        case 'sqrt': return a.sqrt();
        case 'log': case 'ln': return a.log();
      }
    }
    if (name in REAL_JS_1) return REAL_JS_1[name](a);
    if (name === 'atan2') return Math.atan2(args[0], args[1]);
    if (name === 'pow') return Math.pow(args[0], args[1]);
    if (name === 'mod') return args[0] - args[1] * Math.floor(args[0] / args[1]);
    if (name === 'min') return Math.min(...args);
    if (name === 'max') return Math.max(...args);
    throw new ComplexPlaneError(`Internal error: no evaluator registered for "${name}"`);
  }

  // ── Public compile step ────────────────────────────────────────────────
  // compileComplexExpr("z^2 - 1") ->
  //   { source, ast, glsl (fragment shader body only), fragmentShader
  //     (full shader source), evalAt(complexZ) -> Complex }
  function compileComplexExpr(exprString) {
    const { ast, source } = ExprParser.parseToAst(exprString, ['z']);
    annotateTypes(ast);
    if (ast.exprType !== 'complex') {
      throw new ComplexPlaneError(
        `"${source}" evaluates to a real number, not a complex one. Domain coloring plots f(z) as a ` +
        `complex value — try z^2, 1/z, or exp(z), or wrap this expression so it stays complex (e.g. "${source} + 0*z").`
      );
    }
    const glslBody = nodeToGLSL(ast);
    return {
      source,
      ast,
      glsl: glslBody,
      fragmentShader: buildFragmentShader(glslBody),
      evalAt: (zComplex) => evalNode(ast, zComplex),
    };
  }

  // ── Curated presets (coefficients known exactly -> safe pole/zero calc) ─
  // numerator/denominator: [a_n, ..., a_0], highest degree first, same
  // format mathcore.polynomialRoots already expects. null = "not a known
  // rational function" -> poles/zeros overlay is simply not offered for it.
  const PRESETS = [
    { id: 'z2', label: 'z\u00B2', expr: 'z^2', numerator: [1, 0, 0], denominator: null },
    { id: 'z3-1', label: 'z\u00B3 \u2212 1', expr: 'z^3 - 1', numerator: [1, 0, 0, -1], denominator: null },
    { id: 'inv-z', label: '1/z', expr: '1/z', numerator: [1], denominator: [1, 0] },
    { id: 'mobius', label: '(z\u22121)/(z+1)', expr: '(z-1)/(z+1)', numerator: [1, -1], denominator: [1, 1] },
    { id: 'rational', label: '(z\u00B2\u22121)/(z\u00B2+1)', expr: '(z^2-1)/(z^2+1)', numerator: [1, 0, -1], denominator: [1, 0, 1] },
    { id: 'exp', label: 'exp(z)', expr: 'exp(z)', numerator: null, denominator: null },
    { id: 'sin', label: 'sin(z)', expr: 'sin(z)', numerator: null, denominator: null },
    { id: 'log', label: 'log(z)', expr: 'log(z)', numerator: null, denominator: null },
  ];

  // Returns { available, zeros, zerosConverged, poles, polesConverged }.
  // Never throws for a well-formed preset; degree-0 numerator/denominator
  // (a bare constant) legitimately has zero roots, which is not an error.
  function polesAndZeros(preset) {
    if (!preset || (!preset.numerator && !preset.denominator)) {
      return { available: false, zeros: [], zerosConverged: true, poles: [], polesConverged: true };
    }
    const zerosResult = preset.numerator && preset.numerator.length > 1
      ? MathCore.polynomialRoots(preset.numerator)
      : { roots: [], converged: true };
    const polesResult = preset.denominator && preset.denominator.length > 1
      ? MathCore.polynomialRoots(preset.denominator)
      : { roots: [], converged: true };
    return {
      available: true,
      zeros: zerosResult.roots,
      zerosConverged: zerosResult.converged,
      poles: polesResult.roots,
      polesConverged: polesResult.converged,
    };
  }

  return {
    ComplexPlaneError,
    compileComplexExpr,
    polesAndZeros,
    PRESETS,
    MIN_HALF_HEIGHT,
    MAX_HALF_HEIGHT,
    MAX_FALLBACK_PIXELS,
    // exposed for test-complex-plane-core.js's shader/CPU consistency check
    _internal: { annotateTypes, nodeToGLSL, evalNode, GLSL_HELPERS },
  };
});
