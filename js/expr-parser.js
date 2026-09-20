// profpi — Safe expression parser/compiler
//
// Compiles user-typed math strings (e.g. "x*y - sin(x)") into evaluatable
// closures WITHOUT ever using eval() or new Function(). Real tokenizer ->
// recursive-descent parser -> AST -> tree-walking evaluator over a fixed,
// whitelisted grammar. Malformed or malicious input can only ever produce
// a clean rejected-parse (ExprParseError), never code execution.
//
// Same UMD pattern as mathcore.js: global `ExprParser` in the browser,
// module.exports in Node.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ExprParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class ExprParseError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ExprParseError';
    }
  }

  // ── Hard limits (prevent pathological input from hanging/crashing) ────
  const MAX_EXPR_LENGTH = 300;
  const MAX_TOKENS = 400;
  const MAX_AST_DEPTH = 60;

  // ── Whitelisted vocabulary ─────────────────────────────────────────────
  // IMPORTANT: these are Object.create(null) (no prototype chain), not
  // plain {} literals. With plain objects, `'__proto__' in obj` or
  // `'constructor' in obj` returns true via the inherited Object.prototype
  // chain even though the key was never set — that would let a malicious
  // expression like "__proto__" or "constructor" slip past an `in` check.
  // A null-prototype object has no inherited keys, so `in` only ever
  // matches keys we actually whitelisted below.
  const CONSTANTS = Object.assign(Object.create(null), { pi: Math.PI, e: Math.E });

  const FUNCS_1 = Object.assign(Object.create(null), {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    exp: Math.exp, sqrt: Math.sqrt, cbrt: Math.cbrt,
    log: Math.log, ln: Math.log, log10: Math.log10, log2: Math.log2,
    abs: Math.abs, sign: Math.sign,
    floor: Math.floor, ceil: Math.ceil, round: Math.round,
  });
  const FUNCS_2 = Object.assign(Object.create(null), {
    atan2: Math.atan2, pow: Math.pow,
    mod: (a, b) => a - b * Math.floor(a / b),
  });
  const FUNCS_VARIADIC = Object.assign(Object.create(null), { min: Math.min, max: Math.max });

  // ── Tokenizer ───────────────────────────────────────────────────────────
  function tokenize(src) {
    const tokens = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
      if (/[0-9.]/.test(ch)) {
        let j = i;
        let seenDot = false, seenExp = false;
        while (j < n) {
          const c = src[j];
          if (/[0-9]/.test(c)) { j++; continue; }
          if (c === '.' && !seenDot && !seenExp) { seenDot = true; j++; continue; }
          if ((c === 'e' || c === 'E') && !seenExp && j > i) {
            const next = src[j + 1];
            if (/[0-9]/.test(next) || ((next === '+' || next === '-') && /[0-9]/.test(src[j + 2] || ''))) {
              seenExp = true; j += (next === '+' || next === '-') ? 2 : 1; continue;
            }
          }
          break;
        }
        const text = src.slice(i, j);
        const value = Number(text);
        if (!Number.isFinite(value)) throw new ExprParseError(`Invalid number literal "${text}"`);
        tokens.push({ type: 'NUM', value });
        i = j;
        continue;
      }
      if (/[a-zA-Z_]/.test(ch)) {
        let j = i;
        while (j < n && /[a-zA-Z0-9_]/.test(src[j])) j++;
        tokens.push({ type: 'IDENT', value: src.slice(i, j) });
        i = j;
        continue;
      }
      if ('+-*/^%(),'.includes(ch)) {
        tokens.push({ type: ch === ',' ? 'COMMA' : 'OP', value: ch });
        i++;
        continue;
      }
      throw new ExprParseError(`Unexpected character "${ch}" at position ${i}`);
    }
    if (tokens.length > MAX_TOKENS) {
      throw new ExprParseError(`Expression is too complex (${tokens.length} tokens, max ${MAX_TOKENS})`);
    }
    tokens.push({ type: 'EOF' });
    return tokens;
  }

  // ── Recursive-descent parser -> AST ─────────────────────────────────────
  // expr    := term (('+'|'-') term)*
  // term    := unary (('*'|'/'|'%'|implicit) unary)*
  // unary   := ('-'|'+') unary | power
  // power   := atom ('^' unary)?          (right-assoc)
  // atom    := NUMBER | IDENT | IDENT '(' args ')' | '(' expr ')'
  function parse(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const advance = () => tokens[pos++];

    function atomStarts(tok) {
      return tok.type === 'NUM' || tok.type === 'IDENT' || (tok.type === 'OP' && tok.value === '(');
    }

    function parseAtom() {
      const tok = peek();
      if (tok.type === 'NUM') { advance(); return { type: 'num', value: tok.value }; }
      if (tok.type === 'IDENT') {
        advance();
        const name = tok.value;
        if (peek().type === 'OP' && peek().value === '(') {
          advance(); // consume '('
          const args = [];
          if (!(peek().type === 'OP' && peek().value === ')')) {
            args.push(parseExpr());
            while (peek().type === 'COMMA') { advance(); args.push(parseExpr()); }
          }
          if (!(peek().type === 'OP' && peek().value === ')')) {
            throw new ExprParseError(`Expected ")" after arguments to ${name}(...)`);
          }
          advance();
          return { type: 'call', name, args };
        }
        return { type: 'var', name };
      }
      if (tok.type === 'OP' && tok.value === '(') {
        advance();
        const inner = parseExpr();
        if (!(peek().type === 'OP' && peek().value === ')')) {
          throw new ExprParseError('Expected closing ")"');
        }
        advance();
        return inner;
      }
      throw new ExprParseError(`Unexpected token: ${tok.type === 'EOF' ? 'end of expression' : JSON.stringify(tok.value)}`);
    }

    function parsePower() {
      const base = parseAtom();
      if (peek().type === 'OP' && peek().value === '^') {
        advance();
        const exp = parseUnary();
        return { type: 'binary', op: '^', left: base, right: exp };
      }
      return base;
    }

    function parseUnary() {
      const tok = peek();
      if (tok.type === 'OP' && (tok.value === '-' || tok.value === '+')) {
        advance();
        return { type: 'unary', op: tok.value, expr: parseUnary() };
      }
      return parsePower();
    }

    function parseTerm() {
      let left = parseUnary();
      for (;;) {
        const tok = peek();
        if (tok.type === 'OP' && (tok.value === '*' || tok.value === '/' || tok.value === '%')) {
          advance();
          left = { type: 'binary', op: tok.value, left, right: parseUnary() };
        } else if (atomStarts(tok)) {
          // implicit multiplication: "2x", "3sin(x)", "(x+1)(x-1)"
          left = { type: 'binary', op: '*', left, right: parseUnary() };
        } else {
          break;
        }
      }
      return left;
    }

    function parseExpr() {
      let left = parseTerm();
      for (;;) {
        const tok = peek();
        if (tok.type === 'OP' && (tok.value === '+' || tok.value === '-')) {
          advance();
          left = { type: 'binary', op: tok.value, left, right: parseTerm() };
        } else break;
      }
      return left;
    }

    const ast = parseExpr();
    if (peek().type !== 'EOF') {
      throw new ExprParseError(`Unexpected trailing input near ${JSON.stringify(peek().value)}`);
    }
    return ast;
  }

  // ── Static validation: every identifier whitelisted, depth bounded ────
  function validate(ast, allowedVars, depth = 0) {
    if (depth > MAX_AST_DEPTH) {
      throw new ExprParseError(`Expression is nested too deeply (max depth ${MAX_AST_DEPTH})`);
    }
    switch (ast.type) {
      case 'num':
        return;
      case 'var':
        if (!allowedVars.has(ast.name) && !(ast.name in CONSTANTS)) {
          throw new ExprParseError(
            `Unknown identifier "${ast.name}". Allowed variables: ${[...allowedVars].join(', ')}; constants: pi, e`
          );
        }
        return;
      case 'call': {
        const inFuncs1 = ast.name in FUNCS_1;
        const inFuncs2 = ast.name in FUNCS_2;
        const inVariadic = ast.name in FUNCS_VARIADIC;
        if (!inFuncs1 && !inFuncs2 && !inVariadic) {
          throw new ExprParseError(`Unknown function "${ast.name}"`);
        }
        if (inFuncs1 && ast.args.length !== 1) {
          throw new ExprParseError(`${ast.name}(...) expects exactly 1 argument, got ${ast.args.length}`);
        }
        if (inFuncs2 && ast.args.length !== 2) {
          throw new ExprParseError(`${ast.name}(...) expects exactly 2 arguments, got ${ast.args.length}`);
        }
        if (inVariadic && ast.args.length < 2) {
          throw new ExprParseError(`${ast.name}(...) expects at least 2 arguments, got ${ast.args.length}`);
        }
        ast.args.forEach((a) => validate(a, allowedVars, depth + 1));
        return;
      }
      case 'unary':
        validate(ast.expr, allowedVars, depth + 1);
        return;
      case 'binary':
        validate(ast.left, allowedVars, depth + 1);
        validate(ast.right, allowedVars, depth + 1);
        return;
      default:
        throw new ExprParseError('Internal parser error: unknown AST node');
    }
  }

  // ── Tree-walking evaluator ──────────────────────────────────────────────
  function evaluate(ast, scope) {
    switch (ast.type) {
      case 'num':
        return ast.value;
      case 'var':
        return ast.name in scope ? scope[ast.name] : CONSTANTS[ast.name];
      case 'unary': {
        const v = evaluate(ast.expr, scope);
        return ast.op === '-' ? -v : v;
      }
      case 'binary': {
        const l = evaluate(ast.left, scope);
        const r = evaluate(ast.right, scope);
        switch (ast.op) {
          case '+': return l + r;
          case '-': return l - r;
          case '*': return l * r;
          case '/': return l / r;
          case '%': return l % r;
          case '^': return Math.pow(l, r);
          default: throw new ExprParseError(`Internal error: unknown operator "${ast.op}"`);
        }
      }
      case 'call': {
        const args = ast.args.map((a) => evaluate(a, scope));
        if (ast.name in FUNCS_1) return FUNCS_1[ast.name](args[0]);
        if (ast.name in FUNCS_2) return FUNCS_2[ast.name](args[0], args[1]);
        if (ast.name in FUNCS_VARIADIC) return FUNCS_VARIADIC[ast.name](...args);
        throw new ExprParseError(`Internal error: unresolved function "${ast.name}"`);
      }
      default:
        throw new ExprParseError('Internal parser error: unknown AST node');
    }
  }

  // ── AST access for downstream codegen (e.g. Complex Plane's GLSL backend) ─
  // parseToAst("z^2 - 1", ["z"]) -> { ast, source, variables }
  // Runs the exact same tokenize -> parse -> validate pipeline as compile(),
  // but returns the validated AST instead of a JS closure, so a second
  // evaluator/codegen backend can walk the identical tree rather than
  // re-implementing (and potentially drifting from) the tokenizer/parser/
  // whitelist. Throws ExprParseError under the same conditions compile()
  // does; never exposes anything compile() doesn't already expose.
  function parseToAst(exprString, varNames) {
    if (typeof exprString !== 'string') {
      throw new ExprParseError(`Expression must be a string, got ${typeof exprString}`);
    }
    const trimmed = exprString.trim();
    if (trimmed.length === 0) {
      throw new ExprParseError('Expression cannot be empty');
    }
    if (trimmed.length > MAX_EXPR_LENGTH) {
      throw new ExprParseError(`Expression is too long (${trimmed.length} chars, max ${MAX_EXPR_LENGTH})`);
    }
    if (!Array.isArray(varNames) || varNames.some((v) => typeof v !== 'string')) {
      throw new ExprParseError('varNames must be an array of strings');
    }
    const allowed = new Set(varNames);
    for (const v of varNames) {
      if (v in CONSTANTS) throw new ExprParseError(`"${v}" collides with a reserved constant name`);
    }
    const tokens = tokenize(trimmed);
    const ast = parse(tokens);
    validate(ast, allowed);
    return { ast, source: trimmed, variables: varNames.slice() };
  }

  // ── Public API ───────────────────────────────────────────────────────────
  // compile("x*y - sin(x)", ["x","y"]) -> function(x, y) -> number
  // Never throws mid-evaluation for domain issues (sqrt(-1), log(0), 1/0
  // all just produce NaN/Infinity like plain JS Math does) — callers that
  // sample a grid should check Number.isFinite() per point rather than
  // expect a throw. It DOES throw (ExprParseError) at compile time for
  // anything outside the whitelisted grammar.
  function compile(exprString, varNames) {
    if (typeof exprString !== 'string') {
      throw new ExprParseError(`Expression must be a string, got ${typeof exprString}`);
    }
    const trimmed = exprString.trim();
    if (trimmed.length === 0) {
      throw new ExprParseError('Expression cannot be empty');
    }
    if (trimmed.length > MAX_EXPR_LENGTH) {
      throw new ExprParseError(`Expression is too long (${trimmed.length} chars, max ${MAX_EXPR_LENGTH})`);
    }
    if (!Array.isArray(varNames) || varNames.some((v) => typeof v !== 'string')) {
      throw new ExprParseError('varNames must be an array of strings');
    }
    const allowed = new Set(varNames);
    for (const v of varNames) {
      if (v in CONSTANTS) throw new ExprParseError(`"${v}" collides with a reserved constant name`);
    }

    const tokens = tokenize(trimmed);
    const ast = parse(tokens);
    validate(ast, allowed);

    const fn = (...values) => {
      if (values.length !== varNames.length) {
        throw new ExprParseError(`Compiled expression expects ${varNames.length} argument(s), got ${values.length}`);
      }
      const scope = Object.create(null);
      for (let i = 0; i < varNames.length; i++) scope[varNames[i]] = values[i];
      return evaluate(ast, scope);
    };
    fn.source = trimmed;
    fn.variables = varNames.slice();
    return fn;
  }

  return { ExprParseError, compile, parseToAst, CONSTANTS, FUNCS_1, FUNCS_2, FUNCS_VARIADIC };
});
