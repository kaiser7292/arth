/**
 * Safe BODMAS formula evaluator — no eval(), no external deps.
 *
 * Supports: + - * / ( ) unary-minus unary-plus % (postfix, treated as /100)
 * Ignores: spaces, commas (locale number separators)
 *
 * Usage:
 *   evaluateFormula("5000+2500")  → 7500
 *   evaluateFormula("10000*18%") → 1800
 *   evaluateFormula("(1+18%)*5000") → 5900
 *   evaluateFormula("bad")       → null
 */

function stripFormatting(expr: string): string {
  // Remove commas (1,000 → 1000) and trim whitespace
  return expr.replace(/,/g, "").trim();
}

function tokenize(expr: string): string[] | null {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === " " || ch === "\t") { i++; continue; }
    if ("+-*/()%".includes(ch)) { tokens.push(ch); i++; continue; }
    if (/\d/.test(ch)) {
      let num = "";
      let dotSeen = false;
      while (i < expr.length && /[\d.]/.test(expr[i])) {
        if (expr[i] === ".") {
          if (dotSeen) return null; // two dots → invalid
          dotSeen = true;
        }
        num += expr[i++];
      }
      tokens.push(num);
      continue;
    }
    return null; // unknown character
  }
  return tokens;
}

export function evaluateFormula(raw: string): number | null {
  const expr = stripFormatting(raw);
  if (!expr) return null;

  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const consume = (): string => tokens[pos++];

  function parseExpression(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parseFactor();
      if (right === null) return null;
      if (op === "/" && right === 0) return null; // division by zero
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  function parseFactor(): number | null {
    // Unary minus / plus
    if (peek() === "-") { consume(); const v = parseFactor(); return v === null ? null : -v; }
    if (peek() === "+") { consume(); return parseFactor(); }

    // Parenthesised expression
    if (peek() === "(") {
      consume();
      const v = parseExpression();
      if (v === null || peek() !== ")") return null;
      consume();
      return applyPercent(v);
    }

    // Number literal
    const t = peek();
    if (t !== undefined && /^\d+(\.\d*)?$/.test(t)) {
      consume();
      return applyPercent(parseFloat(t));
    }

    return null;
  }

  // Postfix % → divide by 100
  function applyPercent(v: number): number {
    if (peek() === "%") { consume(); return v / 100; }
    return v;
  }

  const result = parseExpression();
  // Ensure we consumed all tokens (no trailing garbage)
  if (result === null || pos !== tokens.length) return null;
  if (!isFinite(result)) return null;
  // Round to 2 decimal places to avoid floating-point noise
  return Math.round(result * 100) / 100;
}

/** True when the raw input value is in formula mode (starts with "="). */
export function isFormulaMode(value: string): boolean {
  return value.startsWith("=");
}

/** Extract the expression part from a formula value ("=5+3" → "5+3"). */
export function getFormulaExpr(value: string): string {
  return value.startsWith("=") ? value.slice(1) : value;
}
