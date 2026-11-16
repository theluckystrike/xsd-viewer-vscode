'use strict';
// Sample XML from a global element of a schema set (Zovo Pro tool "Generate sample XML"). Options:
//   optional: also write optional elements and attributes (one of each, down to maxDepth)
//   repeat:   write 2 copies of elements that may repeat
//   comments: a comment at each choice naming the other branches
// Required content always goes in, so the result validates against the schema in the usual cases. Choices take the
// first branch that does not loop back into a type being written; abstract elements and types are replaced by the
// first concrete substitute or derived type (with xsi:type).
const X = require('./xml');
const { Model } = require('./model');
const { valueFor, resetIds } = require('./values');

const OPTIONAL_BUDGET = 5000; // optional elements stop after this many elements; required ones always go in
const HARD_DEPTH = 40;

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
const escComment = (s) => String(s).replace(/--+/g, '-').replace(/-$/, '- ');

class Gen {
  constructor(set, opts) {
    this.set = set;
    this.m = new Model(set);
    this.o = { optional: false, repeat: false, comments: true, maxDepth: 8, ...(opts || {}) };
    this.count = 0;
    this.truncated = false;
    this.anyNs = 'urn:example:any';
  }

  /** XML nodes for one element particle (0 or more copies). */
  element(node, depth, stack) {
    let n = node;
    if (n.abstract) {
      const comp = this.set.comps.element.get(`{${n.ns}}${n.name}`);
      const subs = comp ? this.set.substitutes(comp.qn).filter((c) => X.attr(c.el, 'abstract') !== 'true') : [];
      if (!subs.length) return n.min > 0 ? [{ comment: `${n.name} is abstract and has no substitute in the schema set` }] : [];
      const sub = this.m.elementNode(subs[0].el);
      n = { ...sub, min: n.min, max: n.max };
    }
    let copies = n.min;
    if (copies === 0 && this.o.optional && depth < this.o.maxDepth) {
      if (this.count < OPTIONAL_BUDGET) copies = 1; else this.truncated = true;
    }
    if (copies > 0 && this.o.repeat && (n.max === -1 || n.max > copies)) copies = Math.max(copies, 2);
    if (copies > 100) copies = n.min > 100 ? n.min : 100;
    const key = n.ck != null ? `t${n.ck}` : null;
    const looping = key && stack.includes(key);
    if (looping && n.min === 0) return [];
    if (depth >= HARD_DEPTH && n.min === 0) return [];
    const out = [];
    for (let i = 0; i < copies; i++) {
      this.count++;
      out.push(this.one(n, depth, looping ? stack : (key ? [...stack, key] : stack), looping));
    }
    return out;
  }

  one(n, depth, stack, looping) {
    const el = { ns: n.ns || '', name: n.name, attrs: [], children: [], text: null };
    let ck = n.ck, attrs = n.attrs || [], text = n.text || null;
    if (n.typeAbstract && n.typeKey) {
      const d = this.set.derivedTypes(n.typeKey).find((c) => X.attr(c.el, 'abstract') !== 'true');
      if (d) {
        el.xsiType = { ns: d.ns, name: d.name };
        ck = this.m.hasContent(d.el) ? this.set.idOf(d.el) : null;
        attrs = this.m.attributesOf(d.el);
        text = this.m.simpleContentType(d.el);
      }
    }
    for (const a of attrs) {
      if (a.any || a.warn || !a.name) continue;
      if (a.use === 'prohibited') continue;
      if (a.use !== 'required' && !(this.o.optional && depth < this.o.maxDepth) && a.fixed == null) continue;
      const v = a.fixed != null ? a.fixed : (a.def != null ? a.def : valueFor(a.text, a.local || a.name));
      el.attrs.push({ ns: a.ns || '', name: a.local || a.name, value: v });
    }
    if (looping) {
      if (ck != null) el.children.push({ comment: `${n.type} repeats inside itself; the sample stops here` });
      return el;
    }
    if (ck != null) {
      const parts = this.m.childrenOf(ck);
      for (const p of parts) el.children.push(...this.particle(p, depth + 1, stack));
    }
    if (text && ck == null) el.text = n.fixed != null ? n.fixed : (n.def != null ? n.def : valueFor(text, n.name));
    else if (n.fixed != null && ck == null) el.text = n.fixed;
    return el;
  }

  particle(p, depth, stack) {
    switch (p.k) {
      case 'element': return this.element(p, depth, stack);
      case 'base': return p.children.flatMap((c) => this.particle(c, depth, stack));
      case 'sequence': case 'all': case 'group': {
        let times = p.min;
        if (times === 0 && this.o.optional && depth < this.o.maxDepth) times = 1;
        if (times > 0 && this.o.repeat && (p.max === -1 || p.max > times) && p.k !== 'all') times = Math.max(times, 2);
        times = Math.min(times, 100);
        const out = [];
        for (let i = 0; i < times; i++) for (const c of (p.children || [])) out.push(...this.particle(c, depth, stack));
        return out;
      }
      case 'choice': {
        let times = p.min;
        if (times === 0 && this.o.optional && depth < this.o.maxDepth) times = 1;
        times = Math.min(times, 100);
        if (!times) return [];
        const kids = p.children || [];
        const loops = (c) => c.k === 'element' && c.ck != null && stack.includes(`t${c.ck}`);
        const pick = kids.find((c) => !loops(c) && c.k !== 'any') || kids.find((c) => !loops(c)) || kids[0];
        const out = [];
        if (this.o.comments && kids.length > 1) out.push({ comment: `choice: one of ${kids.map(label).join(' | ')}` });
        for (let i = 0; i < times; i++) if (pick) out.push(...this.particle(pick, depth, stack));
        return out;
      }
      case 'any': {
        if (p.min === 0 && !(this.o.optional && depth < this.o.maxDepth)) return [];
        const nsc = String(p.ns || '##any').trim();
        const tns = this.tns || '';
        if (p.pc !== 'strict') {
          let ns = this.anyNs;
          if (nsc === '##local') ns = '';
          else if (nsc === '##targetNamespace') ns = tns;
          else if (!['##any', '##other'].includes(nsc)) { const first = nsc.split(/\s+/)[0]; ns = first === '##targetNamespace' ? tns : (first === '##local' ? '' : first); }
          return [{ ns, name: 'anyElement', attrs: [], children: [{ comment: `any element (${nsc}, processContents ${p.pc}) may go here` }], text: null }];
        }
        const ok = (ns) => nsc === '##any' || (nsc === '##other' && ns !== tns && ns !== '') || nsc.split(/\s+/).some((x) => x === ns || (x === '##targetNamespace' && ns === tns) || (x === '##local' && ns === ''));
        const g = [...this.set.comps.element.values()].find((c) => c.el && ok(c.ns) && X.attr(c.el, 'abstract') !== 'true');
        if (!g) return p.min > 0 ? [{ comment: `any element from ${nsc} goes here (none is declared in the schema set)` }] : [];
        return this.element({ ...this.m.elementNode(g.el), min: Math.max(1, p.min), max: p.max }, depth, stack);
      }
      default: return [];
    }
  }
}

function label(c) {
  if (c.k === 'element') return c.name;
  if (c.k === 'any') return 'any element';
  if (c.k === 'group') return `group ${c.name}`;
  return `${c.k}(${(c.children || []).map(label).join(', ')})`;
}

/** Writes the tree as indented XML with namespace prefixes. */
function serialize(set, root, header, hint) {
  const nss = new Set();
  let unqualified = false;
  const walk = (e) => {
    if (e.comment != null) return;
    if (e.ns) nss.add(e.ns); else unqualified = true;
    for (const a of e.attrs) if (a.ns && a.ns !== 'http://www.w3.org/XML/1998/namespace') nss.add(a.ns);
    if (e.xsiType && e.xsiType.ns) nss.add(e.xsiType.ns);
    for (const c of e.children) walk(c);
  };
  walk(root);
  const prefixes = new Map();
  const taken = new Set(['xml', 'xmlns', 'xsi']);
  const useDefault = !!root.ns && !unqualified;
  let k = 1;
  for (const ns of nss) {
    if (useDefault && ns === root.ns) { prefixes.set(ns, ''); continue; }
    let p = set.prefixFor(ns, taken);
    if (!p || taken.has(p)) { while (taken.has(`ns${k}`)) k++; p = `ns${k}`; }
    taken.add(p);
    prefixes.set(ns, p);
  }
  // attributes in a namespace need a prefix even when it is the default for elements
  const attrPrefix = (ns) => {
    if (ns === 'http://www.w3.org/XML/1998/namespace') return 'xml';
    let p = prefixes.get(ns);
    if (p) return p;
    if (!prefixes.has(`attr:${ns}`)) { let q = set.prefixFor(ns, taken); if (!q || taken.has(q)) { while (taken.has(`ns${k}`)) k++; q = `ns${k}`; } taken.add(q); prefixes.set(`attr:${ns}`, q); }
    return prefixes.get(`attr:${ns}`);
  };
  const qname = (ns, name) => { const p = ns ? prefixes.get(ns) : ''; return p ? `${p}:${name}` : name; };
  const needXsi = !!hint || (function has(e) { return e.comment == null && (!!e.xsiType || e.children.some(has)); })(root);
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  if (header) lines.push(`<!-- ${escComment(header)} -->`);
  const write = (e, ind, isRoot) => {
    const pad = '  '.repeat(ind);
    if (e.comment != null) { lines.push(`${pad}<!-- ${escComment(e.comment)} -->`); return; }
    const name = qname(e.ns, e.name);
    let a = '';
    if (isRoot) {
      for (const [ns, p] of prefixes) {
        if (ns.startsWith('attr:')) a += ` xmlns:${p}="${escAttr(ns.slice(5))}"`;
        else a += p ? ` xmlns:${p}="${escAttr(ns)}"` : ` xmlns="${escAttr(ns)}"`;
      }
      if (needXsi) a += ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
      if (hint) a += root.ns ? ` xsi:schemaLocation="${escAttr(root.ns)} ${escAttr(hint)}"` : ` xsi:noNamespaceSchemaLocation="${escAttr(hint)}"`;
    }
    if (e.xsiType) a += ` xsi:type="${escAttr(e.xsiType.ns ? `${prefixes.get(e.xsiType.ns) ? prefixes.get(e.xsiType.ns) + ':' : ''}${e.xsiType.name}` : e.xsiType.name)}"`;
    for (const at of e.attrs) a += ` ${at.ns ? `${attrPrefix(at.ns)}:` : ''}${at.name}="${escAttr(at.value)}"`;
    if (!e.children.length && (e.text == null || e.text === '')) { lines.push(`${pad}<${name}${a}/>`); return; }
    if (!e.children.length) { lines.push(`${pad}<${name}${a}>${escText(e.text)}</${name}>`); return; }
    lines.push(`${pad}<${name}${a}>`);
    for (const c of e.children) write(c, ind + 1, false);
    lines.push(`${pad}</${name}>`);
  };
  write(root, 0, true);
  return lines.join('\n') + '\n';
}

/**
 * Sample XML for the global element comp. opts: { optional, repeat, comments, maxDepth, schemaHint, header }.
 * Returns { xml, elements, truncated }.
 */
function generate(set, comp, opts) {
  resetIds();
  const g = new Gen(set, opts);
  g.tns = comp.ns;
  const node = g.m.elementNode(comp.el);
  const els = g.element({ ...node, min: 1, max: 1 }, 0, []);
  const root = els.find((e) => e.comment == null);
  if (!root) throw new Error(els[0] && els[0].comment ? els[0].comment : `No sample for ${comp.name}`);
  const xml = serialize(set, root, opts && opts.header, opts && opts.schemaHint);
  return { xml, elements: g.count, truncated: g.truncated };
}

module.exports = { generate, serialize, label };
