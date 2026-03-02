/**
 * DiceFormulaParser.js
 *
 * Parses and evaluates D&D dice notation strings.
 *
 * Supported syntax:
 *   NdX        — Roll N dice with X sides (e.g. 2d6, 1d20)
 *   dX         — Implied 1dX (e.g. d20 = 1d20)
 *   NdXkhK     — Roll N, keep highest K (e.g. 4d6kh3)
 *   NdXklK     — Roll N, keep lowest K (e.g. 2d20kl1)
 *   NdXadv     — Advantage: roll 2dX, keep highest (sugar for 2dXkh1, count must be 1)
 *   NdXdis     — Disadvantage: roll 2dX, keep lowest (sugar for 2dXkl1, count must be 1)
 *   +N / -N    — Constant modifier
 *   Combinations: 2d8+1d6+4, 1d20adv+5, 4d6kh3-2
 */

/**
 * Tokenize a formula string into dice groups and modifiers.
 * @param {string} formula
 * @returns {Array<{ type: 'dice'|'modifier', ... }>}
 */
function tokenize(formula) {
  const tokens = [];
  // Normalize: lowercase, strip spaces
  const f = formula.toLowerCase().replace(/\s+/g, '');

  // Regex to match dice groups and modifiers
  // Dice: optional count, d, sides, optional keep/adv/dis
  // Modifier: +N or -N (standalone number)
  const pattern = /([+-]?)(\d*)d(\d+)(kh\d+|kl\d+|adv|dis)?|([+-]?\d+)/g;

  let match;
  let firstToken = true;

  while ((match = pattern.exec(f)) !== null) {
    if (match[3] !== undefined) {
      // Dice group: [sign, count, sides, keep]
      const sign = match[1] === '-' ? -1 : 1;
      const count = match[2] ? parseInt(match[2], 10) : 1;
      const sides = parseInt(match[3], 10);
      const keepStr = match[4] || null;

      let keep = null;
      let actualCount = count;

      if (keepStr === 'adv') {
        // Advantage: roll 2, keep highest 1
        actualCount = 2;
        keep = { type: 'highest', count: 1 };
      } else if (keepStr === 'dis') {
        // Disadvantage: roll 2, keep lowest 1
        actualCount = 2;
        keep = { type: 'lowest', count: 1 };
      } else if (keepStr) {
        const keepType = keepStr.startsWith('kh') ? 'highest' : 'lowest';
        const keepCount = parseInt(keepStr.slice(2), 10);
        keep = { type: keepType, count: keepCount };
      }

      tokens.push({
        type: 'dice',
        sign,
        count: actualCount,
        sides,
        keep,
        raw: match[0],
      });
    } else if (match[5] !== undefined) {
      // Constant modifier
      let val = parseInt(match[5], 10);
      // If this is the first token and has no explicit sign, treat as positive
      if (firstToken && !match[5].startsWith('+') && !match[5].startsWith('-')) {
        val = Math.abs(val);
      }
      tokens.push({
        type: 'modifier',
        value: val,
      });
    }
    firstToken = false;
  }

  return tokens;
}

/**
 * Roll a single die with the given number of sides.
 * @param {number} sides
 * @returns {number}
 */
function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Parse and evaluate a dice formula string.
 * @param {string} formula - e.g. "2d6+5", "1d20adv+3", "4d6kh3"
 * @returns {{
 *   formula: string,
 *   groups: Array<{ count: number, sides: number, results: number[], kept: number[], dropped: number[], sign: number, keep: object|null }>,
 *   modifier: number,
 *   total: number,
 *   breakdown: string
 * }}
 */
export function rollFormula(formula) {
  const tokens = tokenize(formula);

  if (tokens.length === 0) {
    return {
      formula,
      groups: [],
      modifier: 0,
      total: 0,
      breakdown: 'Invalid formula',
    };
  }

  const groups = [];
  let modifier = 0;

  for (const token of tokens) {
    if (token.type === 'modifier') {
      modifier += token.value;
    } else if (token.type === 'dice') {
      // Roll all dice
      const results = [];
      for (let i = 0; i < token.count; i++) {
        results.push(rollDie(token.sides));
      }

      let kept = [...results];
      let dropped = [];

      if (token.keep) {
        const sorted = [...results].map((v, i) => ({ v, i }));

        if (token.keep.type === 'highest') {
          sorted.sort((a, b) => b.v - a.v);
        } else {
          sorted.sort((a, b) => a.v - b.v);
        }

        const keepIndices = new Set(sorted.slice(0, token.keep.count).map(x => x.i));
        kept = [];
        dropped = [];

        for (let i = 0; i < results.length; i++) {
          if (keepIndices.has(i)) {
            kept.push(results[i]);
          } else {
            dropped.push(results[i]);
          }
        }
      }

      groups.push({
        count: token.count,
        sides: token.sides,
        sign: token.sign,
        keep: token.keep,
        results,
        kept,
        dropped,
      });
    }
  }

  // Calculate total
  let total = modifier;
  for (const g of groups) {
    const groupSum = g.kept.reduce((a, b) => a + b, 0);
    total += groupSum * g.sign;
  }

  // Build breakdown string
  const parts = [];
  for (const g of groups) {
    const prefix = g.sign === -1 ? '-' : (parts.length > 0 ? '+' : '');
    const diceStr = g.results.map((v, i) => {
      if (g.dropped.length > 0) {
        // Check if this specific result at this index was dropped
        // We need to track which indices were dropped
        const sorted = [...g.results].map((val, idx) => ({ val, idx }));
        if (g.keep.type === 'highest') {
          sorted.sort((a, b) => b.val - a.val);
        } else {
          sorted.sort((a, b) => a.val - b.val);
        }
        const keepIndices = new Set(sorted.slice(0, g.keep.count).map(x => x.idx));
        return keepIndices.has(i) ? String(v) : `~~${v}~~`;
      }
      return String(v);
    }).join(', ');

    const label = `${g.count}d${g.sides}${g.keep ? (g.keep.type === 'highest' ? `kh${g.keep.count}` : `kl${g.keep.count}`) : ''}`;
    parts.push(`${prefix}${label}[${diceStr}]`);
  }

  if (modifier !== 0) {
    parts.push(`${modifier > 0 ? '+' : ''}${modifier}`);
  }

  parts.push(`= ${total}`);
  const breakdown = parts.join(' ');

  return {
    formula: formula.trim(),
    groups,
    modifier,
    total,
    breakdown,
  };
}

/**
 * Validate a formula string without rolling.
 * @param {string} formula
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFormula(formula) {
  if (!formula || typeof formula !== 'string') {
    return { valid: false, error: 'Formula is required' };
  }

  const f = formula.toLowerCase().replace(/\s+/g, '');

  if (f.length === 0) {
    return { valid: false, error: 'Formula is empty' };
  }

  // Check for invalid characters
  if (/[^0-9d+\-khladvsi]/.test(f)) {
    return { valid: false, error: 'Formula contains invalid characters' };
  }

  const tokens = tokenize(formula);

  if (tokens.length === 0) {
    return { valid: false, error: 'Could not parse formula' };
  }

  // Must contain at least one dice group
  const hasDice = tokens.some(t => t.type === 'dice');
  if (!hasDice) {
    return { valid: false, error: 'Formula must contain at least one dice roll (e.g. 1d20)' };
  }

  // Validate each dice group
  for (const token of tokens) {
    if (token.type === 'dice') {
      if (token.count < 1 || token.count > 100) {
        return { valid: false, error: 'Dice count must be between 1 and 100' };
      }
      if (token.sides < 2 || token.sides > 1000) {
        return { valid: false, error: 'Dice sides must be between 2 and 1000' };
      }
      if (token.keep && token.keep.count >= token.count) {
        return { valid: false, error: `Cannot keep ${token.keep.count} dice when only rolling ${token.count}` };
      }
      if (token.keep && token.keep.count < 1) {
        return { valid: false, error: 'Keep count must be at least 1' };
      }
    }
  }

  return { valid: true };
}
