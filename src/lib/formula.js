/**
 * Tiny safe arithmetic-formula evaluator for product component quantities.
 *
 * Supports: numbers, + - * / ^, parentheses, and variables (W, H, D — the
 * product's dimensions in feet; case-insensitive). No eval(), no function
 * calls, no property access — just a recursive-descent parser over a
 * whitelisted grammar, so a formula can never execute code.
 *
 *   evalFormula('H * D * 2', { W: 3, H: 2.9, D: 2 })  -> 11.6
 *   evalFormula('8', {})                              -> 8
 *   evalFormula('garbage(', {...})                    -> NaN
 */
export function evalFormula(expr, vars = {}) {
  if (expr === null || expr === undefined) return NaN;
  const src = String(expr).trim();
  if (!src) return NaN;

  // Normalize variable lookup to uppercase keys.
  const V = {};
  for (const [k, v] of Object.entries(vars)) V[k.toUpperCase()] = Number(v);

  // ---- tokenize ----
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      let n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) return NaN;
      // Unit suffixes: 4" = 4 inches (converted to feet); 4' = 4 feet.
      // Curly quotes from autocorrect count too.
      const suf = src[j];
      if (suf === '"' || suf === '”' || suf === '″') { n = n / 12; j++; }
      else if (suf === "'" || suf === '’' || suf === '′') { j++; }
      tokens.push({ t: 'num', v: n });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z_0-9]/.test(src[j])) j++;
      const word = src.slice(i, j).toUpperCase();
      // Estimators write "x" for multiply: (W * 4") x 4. X is not a
      // dimension variable, so treat it as the * operator.
      if (word === 'X') tokens.push({ t: '*' });
      else tokens.push({ t: 'var', v: word });
      i = j;
      continue;
    }
    if ('+-*/^()×'.includes(c)) {
      tokens.push({ t: c === '×' ? '*' : c });
      i++;
      continue;
    }
    return NaN;   // unknown character
  }

  // ---- parse (recursive descent) ----
  let p = 0;
  const peek = () => tokens[p];
  const eat  = () => tokens[p++];

  function parseExpr() {              // + -
    let left = parseTerm();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = eat().t;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {              // * /
    let left = parsePow();
    while (peek() && (peek().t === '*' || peek().t === '/')) {
      const op = eat().t;
      const right = parsePow();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }
  function parsePow() {               // ^ (right-assoc)
    const base = parseUnary();
    if (peek() && peek().t === '^') {
      eat();
      return Math.pow(base, parsePow());
    }
    return base;
  }
  function parseUnary() {
    if (peek() && peek().t === '-') { eat(); return -parseUnary(); }
    if (peek() && peek().t === '+') { eat(); return parseUnary(); }
    return parseAtom();
  }
  function parseAtom() {
    const tk = eat();
    if (!tk) return NaN;
    if (tk.t === 'num') return tk.v;
    if (tk.t === 'var') {
      if (!(tk.v in V)) return NaN;
      return V[tk.v];
    }
    if (tk.t === '(') {
      const v = parseExpr();
      const close = eat();
      if (!close || close.t !== ')') return NaN;
      return v;
    }
    return NaN;
  }

  const result = parseExpr();
  if (p !== tokens.length) return NaN;   // trailing junk
  return Number.isFinite(result) ? result : NaN;
}

/**
 * Factor that converts a per-instance quantity into a per-base-unit
 * quantity: perBase = perInstance / factor.
 *   base LF -> one instance spans W feet        -> factor W
 *   base SF -> one instance covers W*H sqft     -> factor W*H
 *   base EA -> one instance is one each         -> factor 1
 */
export function instanceFactor(unit, W, H) {
  const w = Number(W) || 1;
  const h = Number(H) || 1;
  if (unit === 'LF') return w > 0 ? w : 1;
  if (unit === 'SF') return (w * h) > 0 ? w * h : 1;
  return 1;
}
