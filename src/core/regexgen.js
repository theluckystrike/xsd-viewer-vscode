'use strict';
// Builds an example string that matches an XML Schema pattern facet (the XSD regex dialect: always anchored,
// character classes with subtraction, \i \c \d \w \s, \p{...} categories, quantifiers and groups). It picks plain
// characters (A, a, 1) so the example reads well. toJsRegExp() turns a pattern into a JavaScript RegExp for the check
// (null when the pattern uses something JavaScript cannot express).

function parse(src) {
  let i = 0;
  const peek = () => src[i];
  const eat = () => src[i++];
  function branches() {
    const alts = [seq()];
    while (peek() === '|') { eat(); alts.push(seq()); }
    return { t: 'alt', alts };
  }
  function seq() {
    const items = [];
    while (i < src.length && peek() !== '|' && peek() !== ')') {
      const a = atom();
      items.push(quant(a));
    }
    return { t: 'seq', items };
  }
  function quant(a) {
    const c = peek();
    if (c === '?') { eat(); return { t: 'rep', a, min: 0, max: 1 }; }
    if (c === '*') { eat(); return { t: 'rep', a, min: 0, max: -1 }; }
    if (c === '+') { eat(); return { t: 'rep', a, min: 1, max: -1 }; }
    if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
      if (m) { i += m[0].length; const min = parseInt(m[1], 10); const max = m[2] ? (m[3] === '' ? -1 : parseInt(m[3], 10)) : min; return { t: 'rep', a, min, max }; }
    }
    return a;
  }
  function atom() {
    const c = eat();
    if (c === '(') { const b = branches(); if (peek() === ')') eat(); return b; }
    if (c === '[') return cls();
    if (c === '.') return { t: 'set', pick: 'a', any: true };
    if (c === '\\') return esc(true);
    return { t: 'char', c };
  }
  function esc(asAtom) {
    const c = eat();
    const single = { n: '\n', r: '\r', t: '\t' };
    if (single[c]) return { t: 'char', c: single[c] };
    if ('dDsSwWiIcC'.includes(c)) return { t: 'set', cat: c };
    if (c === 'p' || c === 'P') {
      const m = /^\{([^}]*)\}/.exec(src.slice(i));
      if (m) i += m[0].length;
      return { t: 'set', prop: (m ? m[1] : 'L'), neg: c === 'P' };
    }
    void asAtom;
    return { t: 'char', c };
  }
  function cls() {
    const node = { t: 'set', neg: false, ranges: [], cats: [], sub: null };
    if (peek() === '^') { eat(); node.neg = true; }
    let first = true;
    while (i < src.length && (peek() !== ']' || first)) {
      first = false;
      if (peek() === '-' && src[i + 1] === '[') { eat(); eat(); node.sub = cls(); continue; }
      let c = eat();
      let lo;
      if (c === '\\') { const e = esc(false); if (e.t === 'set') { node.cats.push(e); continue; } lo = e.c; } else lo = c;
      if (peek() === '-' && src[i + 1] !== ']' && src[i + 1] !== '[' && src[i + 1] !== undefined) {
        eat();
        let hi = eat();
        if (hi === '\\') hi = esc(false).c || '\\';
        node.ranges.push([lo, hi]);
      } else node.ranges.push([lo, lo]);
    }
    if (peek() === ']') eat();
    return node;
  }
  const tree = branches();
  return tree;
}

const CANDIDATES = ['A', 'a', '1', 'B', 'b', '2', 'x', 'X', '0', '5', '9', 'Z', 'z', 'm', '-', '_', '.', ' ', '@', '+', '/', ':', '#', '(', ')', ',', '='];

function inCat(ch, cat) {
  switch (cat) {
    case 'd': return /[0-9]/.test(ch);
    case 'D': return !/[0-9]/.test(ch);
    case 's': return /[ \t\n\r]/.test(ch);
    case 'S': return !/[ \t\n\r]/.test(ch);
    case 'w': return /[\p{L}\p{N}\p{M}\p{S}]/u.test(ch); // \w in XSD: not punctuation, separator or other
    case 'W': return !/[\p{L}\p{N}\p{M}\p{S}]/u.test(ch);
    case 'i': return /[A-Za-z_:]/.test(ch);
    case 'I': return !/[A-Za-z_:]/.test(ch);
    case 'c': return /[A-Za-z0-9._:-]/.test(ch);
    case 'C': return !/[A-Za-z0-9._:-]/.test(ch);
    default: return false;
  }
}
function inProp(ch, prop) {
  try { return new RegExp(`\\p{${/^Is/.test(prop) ? 'Script=' + prop.slice(2) : prop}}`, 'u').test(ch); } catch (e) { return /[A-Za-z]/.test(ch); }
}
function setHas(node, ch) {
  if (node.any) return ch !== '\n' && ch !== '\r';
  if (node.cat) return inCat(ch, node.cat);
  if (node.prop) return node.neg ? !inProp(ch, node.prop) : inProp(ch, node.prop);
  let hit = node.ranges.some(([lo, hi]) => ch >= lo && ch <= hi) || node.cats.some((c) => setHas(c, ch));
  if (node.neg) hit = !hit;
  if (hit && node.sub && setHas(node.sub, ch)) hit = false;
  return hit;
}
function pickChar(node) {
  for (const c of CANDIDATES) if (setHas(node, c)) return c;
  if (node.ranges && node.ranges.length && !node.neg) {
    for (const [lo] of node.ranges) if (setHas(node, lo)) return lo;
  }
  for (let code = 33; code < 0x3000; code++) { const c = String.fromCharCode(code); if (setHas(node, c)) return c; }
  return 'a';
}

/** strategy: 'min' (fewest repeats), 'one' (at least one of each optional part), 'more' (a few more) */
function gen(node, strategy) {
  switch (node.t) {
    case 'alt': return gen(node.alts[0], strategy);
    case 'seq': return node.items.map((x) => gen(x, strategy)).join('');
    case 'char': return node.c;
    case 'set': return pickChar(node);
    case 'rep': {
      let n = node.min;
      if (strategy === 'one') n = Math.max(node.min, node.max === 0 ? 0 : 1);
      if (strategy === 'more') n = node.max === -1 ? Math.max(node.min, 1) + 3 : Math.min(node.max, Math.max(node.min, 1) + 3);
      let s = '';
      for (let k = 0; k < n; k++) s += gen(node.a, strategy);
      return s;
    }
    default: return '';
  }
}

/** A JavaScript RegExp (anchored, unicode) for an XSD pattern, or null. */
function toJsRegExp(p) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') {
      const n = p[i + 1];
      i++;
      if (n === 'i') out += inClass ? 'A-Za-z_:' : '[A-Za-z_:]';
      else if (n === 'I') out += inClass ? '' : '[^A-Za-z_:]';
      else if (n === 'c') out += inClass ? 'A-Za-z0-9._:\\-' : '[A-Za-z0-9._:\\-]';
      else if (n === 'C') out += inClass ? '' : '[^A-Za-z0-9._:\\-]';
      else if (n === 'w') out += inClass ? '\\p{L}\\p{N}\\p{M}\\p{S}' : '[\\p{L}\\p{N}\\p{M}\\p{S}]';
      else if (n === 'W') out += inClass ? '' : '[^\\p{L}\\p{N}\\p{M}\\p{S}]';
      else if (n === 'p' || n === 'P') {
        const m = /^\{([^}]*)\}/.exec(p.slice(i + 1));
        if (!m) return null;
        i += m[0].length;
        if (/^Is/.test(m[1])) return null;
        out += `\\${n}{${m[1]}}`;
      } else if ('dDsSnrt\\|.-^?*+{}()[]'.includes(n)) out += '\\' + n;
      else out += '\\' + n;
      continue;
    }
    if (c === '[') { if (inClass && p[i - 1] === '-') return null; inClass = true; out += c; continue; }
    if (c === ']') { inClass = false; out += c; continue; }
    out += c;
  }
  try { return new RegExp(`^(?:${out})$`, 'u'); } catch (e) { return null; }
}

/** An example string for the pattern that also keeps the length limits when it can, or null. */
function example(pattern, limits) {
  let tree;
  try { tree = parse(String(pattern)); } catch (e) { return null; }
  const re = toJsRegExp(String(pattern));
  const lim = limits || {};
  const okLen = (s) => (lim.length == null || s.length === Number(lim.length)) && (lim.minLength == null || s.length >= Number(lim.minLength)) && (lim.maxLength == null || s.length <= Number(lim.maxLength));
  let fallback = null;
  for (const st of ['one', 'min', 'more']) {
    const s = gen(tree, st);
    if (re && !re.test(s)) continue;
    if (fallback === null) fallback = s;
    if (okLen(s)) return s;
  }
  return fallback;
}

module.exports = { example, toJsRegExp, parse };
