/**
 * Calculator utility for evaluating mathematical expressions
 * Supports basic arithmetic: +, -, *, /
 * Safe evaluation without using eval()
 */

/**
 * Safely evaluates a mathematical expression
 * @param expression - The mathematical expression to evaluate (e.g., "3*24 + 7" or "0.5 + 0.33")
 * @returns The result of the calculation, or null if the expression is invalid
 */
export function evaluateExpression(expression: string): number | null {
  if (!expression || expression.trim() === '') {
    return null;
  }

  try {
    // Remove all whitespace
    const cleaned = expression.replace(/\s/g, '');
    
    // Validate expression contains only numbers, operators, and decimal points
    if (!/^[0-9+\-*/.()]+$/.test(cleaned)) {
      return null;
    }

    // Check for invalid patterns
    if (
      cleaned.includes('..') || // Multiple consecutive dots
      cleaned.includes('++') || // Multiple consecutive operators (except --)
      cleaned.includes('**') ||
      cleaned.includes('//') ||
      /[+\-*/]{3,}/.test(cleaned) || // Three or more consecutive operators
      /^[*/]/.test(cleaned) || // Starts with * or /
      /[+\-*/]$/.test(cleaned) // Ends with an operator
    ) {
      return null;
    }

    // Parse and evaluate the expression using a simple parser
    const result = parseExpression(cleaned);
    
    // Check if result is valid
    if (result === null || isNaN(result) || !isFinite(result)) {
      return null;
    }

    return result;
  } catch (error) {
    return null;
  }
}

/**
 * Parse and evaluate a mathematical expression
 * Uses recursive descent parser to handle operator precedence
 */
function parseExpression(expr: string): number | null {
  let pos = 0;

  function peek(): string {
    return expr[pos] || '';
  }

  function consume(): string {
    return expr[pos++] || '';
  }

  function parseNumber(): number | null {
    let num = '';
    
    // Handle negative numbers
    if (peek() === '-') {
      num += consume();
    }
    
    while (pos < expr.length && (peek() >= '0' && peek() <= '9' || peek() === '.')) {
      num += consume();
    }
    
    const value = parseFloat(num);
    return isNaN(value) ? null : value;
  }

  function parseFactor(): number | null {
    // Handle parentheses
    if (peek() === '(') {
      consume(); // consume '('
      const value = parseAddSub();
      if (peek() !== ')') {
        return null; // Missing closing parenthesis
      }
      consume(); // consume ')'
      return value;
    }
    
    // Parse number
    return parseNumber();
  }

  function parseMulDiv(): number | null {
    let left = parseFactor();
    if (left === null) return null;

    while (peek() === '*' || peek() === '/') {
      const op = consume();
      const right = parseFactor();
      if (right === null) return null;

      if (op === '*') {
        left = left * right;
      } else {
        if (right === 0) return null; // Division by zero
        left = left / right;
      }
    }

    return left;
  }

  function parseAddSub(): number | null {
    let left = parseMulDiv();
    if (left === null) return null;

    while (peek() === '+' || (peek() === '-' && pos > 0)) {
      const op = consume();
      const right = parseMulDiv();
      if (right === null) return null;

      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  const result = parseAddSub();
  
  // Check if we consumed the entire expression
  if (pos !== expr.length) {
    return null;
  }

  return result;
}

/**
 * Formats a number for display, removing unnecessary trailing zeros
 */
export function formatCalculatorResult(value: number): string {
  // Round to a reasonable precision to avoid floating point issues
  const rounded = Math.round(value * 1000000) / 1000000;
  
  // Convert to string and remove trailing zeros after decimal point
  const str = rounded.toString();
  if (str.includes('.')) {
    return str.replace(/\.?0+$/, '');
  }
  return str;
}
