'use strict';
// The content model of a schema set as plain nodes for the tree, the diagram, the HTML documentation and the sample
// generator. Elements are expanded one level at a time: a node with element content has a content key (ck) and its
// children come from childrenOf(ck), so recursive types (a part list that holds parts) are no problem.
const X = require('./xml');
const { baseName } = require('./schema');

const { XS } = X;
const FACETS = ['length', 'minLength', 'maxLength', 'pattern', 'enumeration', 'whiteSpace', 'maxInclusive', 'maxExclusive', 'minInclusive', 'minExclusive', 'totalDigits', 'fractionDigits', 'assertion', 'explicitTimezone'];
const DOC_MAX = 4000;
const BUILTINS = new Set(('anySimpleType anyAtomicType string normalizedString token language Name NCName NMTOKEN NMTOKENS ID IDREF IDREFS ENTITY ENTITIES '
  + 'QName NOTATION anyURI boolean decimal integer long int short byte nonNegativeInteger positiveInteger nonPositiveInteger negativeInteger '
  + 'unsignedLong unsignedInt unsignedShort unsignedByte float double duration yearMonthDuration dayTimeDuration dateTime dateTimeStamp time date '
  + 'gYearMonth gYear gMonthDay gDay gMonth hexBinary base64Binary').split(' '));

function occurs(el) {
  const mi = X.attr(el, 'minOccurs');
  const ma = X.attr(el, 'maxOccurs');
  return { min: mi == null ? 1 : Math.max(0, parseInt(mi, 10) || 0), max: ma == null ? 1 : (ma === 'unbounded' ? -1 : Math.max(0, parseInt(ma, 10) || 0)) };
}
const occText = (min, max) => `${min}..${max === -1 ? '∞' : max}`;

class Model {
  constructor(set) {
    this.set = set;
    this.seq = 0;
    this.fileIdx = new Map();
    this.fileList = [];
  }
  fileNo(url) {
    if (!this.fileIdx.has(url)) { this.fileIdx.set(url, this.fileList.length); this.fileList.push(url); }
    return this.fileIdx.get(url);
  }
  src(el) {
    if (!el) return null;
    const s = this.set.schemaOf(el);
    const file = s ? s.file : this.set.root;
    return { f: this.fileNo(file), l: el.lineNumber || 0, c: el.columnNumber || 0 };
  }
  schemaFor(el) { return this.set.schemaOf(el); }

  // ---------- types ----------
  /** The type of an element or attribute declaration: { kind: complex|simple|builtin|none, el, comp, label, builtin }. */
  typeOf(decl, wantAttr) {
    const s = this.schemaFor(decl);
    const t = X.attr(decl, 'type');
    if (t) {
      const r = X.resolveQName(decl, t);
      if (!wantAttr) {
        const c = this.set.lookup('complexType', decl, t, s);
        if (c.comp) return { kind: 'complex', el: c.comp.el, comp: c.comp, label: t };
      }
      const st = this.set.lookup('simpleType', decl, t, s);
      if (st.comp) return { kind: 'simple', el: st.comp.el, comp: st.comp, label: t };
      if (r.ns === XS) return { kind: 'builtin', builtin: r.local, label: t };
      return { kind: 'missing', label: t, note: `type ${t} is not defined in the schema set` };
    }
    const anonC = wantAttr ? null : X.firstXs(decl, 'complexType');
    if (anonC) return { kind: 'complex', el: anonC, label: '(anonymous)' };
    const anonS = X.firstXs(decl, 'simpleType');
    if (anonS) return { kind: 'simple', el: anonS, label: '(anonymous)' };
    // an element with a substitution group head and no type takes the head's type
    const sg = !wantAttr && X.attr(decl, 'substitutionGroup');
    if (sg) {
      const h = this.set.lookup('element', decl, sg.trim().split(/\s+/)[0], s);
      if (h.comp && h.comp.el !== decl) return this.typeOf(h.comp.el, false);
    }
    return { kind: 'builtin', builtin: 'anyType', label: wantAttr ? 'xs:anySimpleType' : 'xs:anyType', implicit: true };
  }

  /** The base complex type of an extension or restriction, or null. */
  baseOf(typeEl) {
    const cc = X.firstXs(typeEl, 'complexContent', 'simpleContent');
    const d = cc && X.firstXs(cc, 'extension', 'restriction');
    if (!d || !X.attr(d, 'base')) return null;
    const s = this.schemaFor(d);
    const base = X.attr(d, 'base');
    const r = X.resolveQName(d, base);
    let c = this.set.lookup('complexType', d, base, s);
    // a type in xs:redefine that extends itself means the original
    if (c.comp && c.comp.el === typeEl && this.set.comps.complexType.has(c.key + '#orig')) c = { ...c, comp: this.set.comps.complexType.get(c.key + '#orig') };
    if (c.comp && c.comp.el !== typeEl) return { how: d.localName, kind: 'complex', comp: c.comp, el: c.comp.el, label: base, deriv: d, simple: cc.localName === 'simpleContent' };
    const st = this.set.lookup('simpleType', d, base, s);
    if (st.comp) return { how: d.localName, kind: 'simple', comp: st.comp, el: st.comp.el, label: base, deriv: d, simple: true };
    if (r.ns === XS) return { how: d.localName, kind: 'builtin', builtin: r.local, label: base, deriv: d, simple: cc.localName === 'simpleContent' };
    return { how: d.localName, kind: 'missing', label: base, deriv: d, simple: cc.localName === 'simpleContent' };
  }

  /** True when a complex type has element content (its own or inherited). */
  hasContent(typeEl, depth = 0) {
    if (!typeEl || depth > 30) return false;
    if (X.firstXs(typeEl, 'simpleContent')) return false;
    const cc = X.firstXs(typeEl, 'complexContent');
    const holder = cc ? X.firstXs(cc, 'extension', 'restriction') : typeEl;
    if (!holder) return false;
    if (X.firstXs(holder, 'sequence', 'choice', 'all', 'group')) return true;
    if (cc && holder.localName === 'extension') { const b = this.baseOf(typeEl); return !!(b && b.kind === 'complex' && this.hasContent(b.el, depth + 1)); }
    return false;
  }

  // ---------- nodes ----------
  node(o) { return { id: ++this.seq, ...o }; }

  doc(el) { const d = X.documentation(el); return d.length > DOC_MAX ? d.slice(0, DOC_MAX) + ' ...' : d; }

  /** A node for an element declaration (global, local or a ref). */
  elementNode(el, extra) {
    const s = this.schemaFor(el);
    const oc = occurs(el);
    let decl = el, isRef = false, global = !!(el.parentNode && el.parentNode.namespaceURI === XS && el.parentNode.localName === 'schema');
    const ref = X.attr(el, 'ref');
    let ns, name, missing = '';
    if (ref) {
      isRef = true;
      const r = this.set.lookup('element', el, ref, s);
      ns = r.ns; name = r.local;
      if (r.comp) { decl = r.comp.el; global = true; } else missing = `element ${ref} is not defined in the schema set`;
    } else {
      name = X.attr(el, 'name') || '?';
      const form = X.attr(el, 'form');
      ns = global ? (s ? s.ens : '') : ((form ? form === 'qualified' : (s && s.efd)) ? (s ? s.ens : '') : '');
    }
    const t = missing ? { kind: 'missing', label: ref } : this.typeOf(decl, false);
    const keys = {};
    if (t.comp) keys.tkey = { k: t.comp.kind, key: t.comp.qn };
    if (isRef && !missing) keys.ekey = { k: 'element', key: this.keyOf(decl) };
    const n = this.node({
      k: 'element', name, ns, ref: isRef, global, min: oc.min, max: oc.max,
      type: t.label, tk: t.kind,
      abstract: X.attr(decl, 'abstract') === 'true', nillable: X.attr(decl, 'nillable') === 'true',
      def: X.attr(decl, 'default'), fixed: X.attr(decl, 'fixed'),
      doc: this.doc(decl) || (decl !== el ? this.doc(el) : ''),
      src: this.src(decl), at: decl !== el ? this.src(el) : null,
      ...(missing || t.note ? { warn: missing || t.note } : {}),
      ...keys,
      ...(extra || {}),
    });
    if (t.kind === 'complex') {
      n.mixed = X.attr(t.el, 'mixed') === 'true' || X.attr(X.firstXs(t.el, 'complexContent') || t.el, 'mixed') === 'true';
      if (this.hasContent(t.el)) n.ck = this.set.idOf(t.el);
      n.attrs = this.attributesOf(t.el);
      if (X.attr(t.el, 'abstract') === 'true' && t.comp) { n.typeAbstract = true; n.typeKey = t.comp.qn; }
      const st = this.simpleContentType(t.el);
      if (st) n.text = st;
    } else if (t.kind === 'simple' || t.kind === 'builtin') {
      n.text = this.simpleInfo(t);
    }
    if (global) {
      const subs = this.set.substitutes(this.keyOf(decl));
      if (subs.length) n.subs = subs.slice(0, 50).map((c) => c.name);
    }
    const sg = X.attr(decl, 'substitutionGroup');
    if (sg) n.sg = sg;
    return n;
  }
  keyOf(globalEl) { const s = this.schemaFor(globalEl); return `{${s ? s.ens : ''}}${X.attr(globalEl, 'name')}`; }

  /** Children of a content key (the id of a complex type element): the particles of its content model. */
  childrenOf(ck) {
    const el = this.set.elById(ck);
    if (!el) return [];
    return this.contentOf(el, []);
  }

  contentOf(typeEl, stack) {
    if (!typeEl || stack.includes(typeEl) || stack.length > 40) return [];
    const st = [...stack, typeEl];
    if (X.firstXs(typeEl, 'simpleContent')) return [];
    const cc = X.firstXs(typeEl, 'complexContent');
    if (cc) {
      const d = X.firstXs(cc, 'extension', 'restriction');
      if (!d) return [];
      const own = this.particlesOf(d, st);
      if (d.localName === 'extension') {
        const b = this.baseOf(typeEl);
        const baseParts = b && b.kind === 'complex' ? this.contentOf(b.el, st) : [];
        if (baseParts.length) return [this.node({ k: 'base', name: b.label, how: 'extension', children: baseParts, src: this.src(b.el) }), ...own];
      }
      return own;
    }
    return this.particlesOf(typeEl, st);
  }

  particlesOf(holder, stack) {
    const out = [];
    for (const c of X.xsKids(holder, 'sequence', 'choice', 'all', 'group')) {
      const p = this.particle(c, stack);
      if (p) out.push(p);
    }
    return out;
  }

  particle(el, stack) {
    const k = el.localName;
    const oc = occurs(el);
    if (k === 'element') return this.elementNode(el);
    if (k === 'any') return this.node({ k: 'any', name: 'any', ns: X.attr(el, 'namespace') || '##any', pc: X.attr(el, 'processContents') || 'strict', min: oc.min, max: oc.max, doc: this.doc(el), src: this.src(el) });
    if (k === 'sequence' || k === 'choice' || k === 'all') {
      const children = [];
      for (const c of X.xsKids(el, 'element', 'sequence', 'choice', 'group', 'any', 'all')) { const p = this.particle(c, stack); if (p) children.push(p); }
      return this.node({ k, min: oc.min, max: oc.max, children, doc: this.doc(el), src: this.src(el) });
    }
    if (k === 'group') {
      const ref = X.attr(el, 'ref');
      if (!ref) return null;
      const r = this.set.lookup('group', el, ref, this.schemaFor(el));
      if (!r.comp) return this.node({ k: 'group', name: ref, min: oc.min, max: oc.max, children: [], warn: `group ${ref} is not defined in the schema set`, src: this.src(el) });
      if (stack.includes(r.comp.el)) return this.node({ k: 'group', name: ref, min: oc.min, max: oc.max, children: [], rec: true, src: this.src(r.comp.el) });
      return this.node({ k: 'group', name: ref, min: oc.min, max: oc.max, children: this.particlesOf(r.comp.el, [...stack, r.comp.el]), doc: this.doc(r.comp.el), src: this.src(r.comp.el), at: this.src(el) });
    }
    return null;
  }

  // ---------- attributes ----------
  /** Attributes of a complex type, inherited ones first: [{ name, ns, type, use, def, fixed, doc, src, from? }]. */
  attributesOf(typeEl, stack = []) {
    if (!typeEl || stack.includes(typeEl) || stack.length > 30) return [];
    const st = [...stack, typeEl];
    const cc = X.firstXs(typeEl, 'complexContent', 'simpleContent');
    const holder = cc ? X.firstXs(cc, 'extension', 'restriction') : typeEl;
    let list = [];
    const b = cc ? this.baseOf(typeEl) : null;
    if (b && b.kind === 'complex') list = this.attributesOf(b.el, st).map((a) => ({ ...a, from: a.from || b.label }));
    const own = holder ? this.ownAttributes(holder, st) : [];
    for (const a of own) {
      const i = list.findIndex((x) => x.name === a.name && x.ns === a.ns);
      if (a.use === 'prohibited') { if (i >= 0) list.splice(i, 1); continue; }
      if (i >= 0) list[i] = a; else list.push(a);
    }
    return list;
  }
  ownAttributes(holder, stack) {
    const out = [];
    for (const c of X.xsKids(holder, 'attribute', 'attributeGroup', 'anyAttribute')) {
      if (c.localName === 'attribute') out.push(this.attributeInfo(c));
      else if (c.localName === 'anyAttribute') out.push({ name: '*', ns: X.attr(c, 'namespace') || '##any', any: true, type: 'any attribute', use: 'optional', pc: X.attr(c, 'processContents') || 'strict', src: this.src(c) });
      else {
        const ref = X.attr(c, 'ref');
        const r = ref && this.set.lookup('attributeGroup', c, ref, this.schemaFor(c));
        if (r && r.comp && !stack.includes(r.comp.el)) out.push(...this.ownAttributes(r.comp.el, [...stack, r.comp.el]).map((a) => ({ ...a, group: a.group || ref })));
        else if (ref && !(r && r.comp)) out.push({ name: ref, warn: `attribute group ${ref} is not defined in the schema set`, type: '', use: 'optional', src: this.src(c) });
      }
    }
    return out;
  }
  attributeInfo(el) {
    const s = this.schemaFor(el);
    const ref = X.attr(el, 'ref');
    let decl = el, ns = '', name;
    if (ref) {
      const r = this.set.lookup('attribute', el, ref, s);
      name = r.local; ns = r.ns;
      if (r.comp) decl = r.comp.el; else return { name: ref, local: r.local, ns, type: '', use: X.attr(el, 'use') || 'optional', warn: `attribute ${ref} is not defined in the schema set`, src: this.src(el) };
      name = ns ? ref : r.local;
    } else {
      name = X.attr(el, 'name') || '?';
      const global = el.parentNode && el.parentNode.localName === 'schema';
      const form = X.attr(el, 'form');
      ns = (global || (form ? form === 'qualified' : (s && s.afd))) ? (s ? s.ens : '') : '';
    }
    const t = this.typeOf(decl, true);
    return {
      name, local: ref ? X.resolveQName(el, ref).local : name, ns, type: t.label, use: X.attr(el, 'use') || 'optional',
      def: X.attr(el, 'default') ?? X.attr(decl, 'default'), fixed: X.attr(el, 'fixed') ?? X.attr(decl, 'fixed'),
      doc: this.doc(decl) || this.doc(el), src: this.src(decl), text: this.simpleInfo(t), ...(t.note ? { warn: t.note } : {}),
    };
  }

  // ---------- simple types ----------
  /** The text type of a complex type with simple content, or null. */
  simpleContentType(typeEl, depth = 0) {
    const sc = X.firstXs(typeEl, 'simpleContent');
    if (!sc || depth > 30) return null;
    const d = X.firstXs(sc, 'extension', 'restriction');
    if (!d) return null;
    const b = this.baseOf(typeEl);
    let info;
    if (!b) info = { builtin: 'string', base: 'xs:string', facets: {} };
    else if (b.kind === 'complex') info = this.simpleContentType(b.el, depth + 1) || { builtin: 'string', base: b.label, facets: {} };
    else info = this.simpleInfo(b);
    if (d.localName === 'restriction') {
      const inner = X.firstXs(d, 'simpleType');
      if (inner) info = this.simpleInfo({ kind: 'simple', el: inner, label: '(anonymous)' });
      info = this.mergeFacets(info, d);
    }
    return info;
  }

  /** { builtin (primitive name), base (label), facets: { enumeration: [...], pattern: [...], minLength, ... }, list?, union? } */
  simpleInfo(t, depth = 0) {
    if (!t) return null;
    if (t.kind === 'builtin') return { builtin: t.builtin, base: t.label, facets: {} };
    // the schema for schemas defines the built-in types itself: treat them as the built-ins they are
    if (t.kind === 'simple' && t.comp && t.comp.ns === XS && BUILTINS.has(t.comp.name)) return { builtin: t.comp.name, base: t.label, facets: {} };
    if (t.kind !== 'simple' || !t.el || depth > 30) return { builtin: 'string', base: t.label || '', facets: {} };
    const el = t.el;
    const s = this.schemaFor(el);
    const r = X.firstXs(el, 'restriction');
    const l = X.firstXs(el, 'list');
    const u = X.firstXs(el, 'union');
    if (l) {
      const it = X.attr(l, 'itemType');
      const inner = X.firstXs(l, 'simpleType');
      const item = it ? this.namedSimple(l, it, s) : (inner ? { kind: 'simple', el: inner, label: '(anonymous)' } : null);
      return { builtin: 'list', base: 'list', list: this.simpleInfo(item, depth + 1), facets: {} };
    }
    if (u) {
      const members = [];
      for (const m of (X.attr(u, 'memberTypes') || '').trim().split(/\s+/).filter(Boolean)) members.push(this.simpleInfo(this.namedSimple(u, m, s), depth + 1));
      for (const inner of X.xsKids(u, 'simpleType')) members.push(this.simpleInfo({ kind: 'simple', el: inner, label: '(anonymous)' }, depth + 1));
      return { builtin: 'union', base: 'union', union: members.filter(Boolean), facets: {} };
    }
    if (r) {
      const baseName_ = X.attr(r, 'base');
      let info;
      if (baseName_) info = this.simpleInfo(this.namedSimple(r, baseName_, s), depth + 1);
      else { const inner = X.firstXs(r, 'simpleType'); info = inner ? this.simpleInfo({ kind: 'simple', el: inner, label: '(anonymous)' }, depth + 1) : { builtin: 'string', facets: {} }; }
      info = { ...info, base: baseName_ || info.base };
      return this.mergeFacets(info, r);
    }
    return { builtin: 'string', base: t.label, facets: {} };
  }
  namedSimple(ctx, value, s) {
    const r = X.resolveQName(ctx, value);
    const c = this.set.lookup('simpleType', ctx, value, s);
    if (c.comp && c.comp.el !== ctx.parentNode) return { kind: 'simple', el: c.comp.el, comp: c.comp, label: value };
    if (r.ns === X.XS) return { kind: 'builtin', builtin: r.local, label: value };
    return { kind: 'builtin', builtin: 'string', label: value, missing: true };
  }
  mergeFacets(info, restriction) {
    const facets = { ...(info.facets || {}) };
    const enums = [];
    const pats = [];
    for (const f of X.xsKids(restriction, ...FACETS)) {
      const v = X.attr(f, 'value');
      if (f.localName === 'enumeration') enums.push({ value: v == null ? '' : v, doc: X.documentation(f).slice(0, 300) });
      else if (f.localName === 'pattern') pats.push(v || '');
      else if (v != null) facets[f.localName] = v;
    }
    if (enums.length) facets.enumeration = enums;
    if (pats.length) facets.pattern = [...pats]; // a derived pattern replaces the base's for display; both apply in validation
    if (pats.length && info.facets && info.facets.pattern) facets.basePattern = info.facets.pattern;
    return { ...info, facets };
  }

  // ---------- global components ----------
  /** The root node of the diagram for a global component, with its first level of children loaded. */
  componentNode(comp) {
    const k = comp.kind;
    if (k === 'element') {
      const n = this.elementNode(comp.el, { comp: true });
      if (n.ck != null) n.children = this.childrenOf(n.ck);
      return n;
    }
    if (k === 'complexType') {
      const b = this.baseOf(comp.el);
      const n = this.node({ k: 'complexType', name: comp.name, ns: comp.ns, comp: true, doc: this.doc(comp.el), src: this.src(comp.el),
        abstract: X.attr(comp.el, 'abstract') === 'true', attrs: this.attributesOf(comp.el), base: b ? `${b.how} of ${b.label}` : '' });
      n.mixed = X.attr(comp.el, 'mixed') === 'true';
      const st = this.simpleContentType(comp.el);
      if (st) n.text = st;
      if (this.hasContent(comp.el)) { n.ck = this.set.idOf(comp.el); n.children = this.childrenOf(n.ck); }
      const d = this.set.derivedTypes(comp.qn);
      if (d.length) n.derived = d.slice(0, 50).map((c) => c.name);
      return n;
    }
    if (k === 'simpleType') return this.node({ k: 'simpleType', name: comp.name, ns: comp.ns, comp: true, doc: this.doc(comp.el), src: this.src(comp.el), text: this.simpleInfo({ kind: 'simple', el: comp.el, label: comp.name }) });
    if (k === 'group') return this.node({ k: 'groupDef', name: comp.name, ns: comp.ns, comp: true, doc: this.doc(comp.el), src: this.src(comp.el), children: this.particlesOf(comp.el, [comp.el]) });
    if (k === 'attributeGroup') return this.node({ k: 'attributeGroup', name: comp.name, ns: comp.ns, comp: true, doc: this.doc(comp.el), src: this.src(comp.el), attrs: this.ownAttributes(comp.el, [comp.el]) });
    if (k === 'attribute') { const a = this.attributeInfo(comp.el); return this.node({ k: 'attribute', name: comp.name, ns: comp.ns, comp: true, type: a.type, doc: a.doc || '', src: comp.el ? this.src(comp.el) : null, text: a.text, def: a.def, fixed: a.fixed }); }
    return this.node({ k, name: comp.name, ns: comp.ns, comp: true, doc: comp.el ? this.doc(comp.el) : '', src: comp.el ? this.src(comp.el) : null });
  }

  /** The list of global components for the viewer's tree: [{ k, n, ns, f, l, c, own, key }]. */
  index(rootFile) {
    const out = [];
    for (const [kind, map] of Object.entries(this.set.comps)) {
      for (const [key, c] of map) {
        if (!c.el || key.endsWith('#orig')) continue;
        out.push({ k: kind, n: c.name, ns: c.ns, f: this.fileNo(c.file), l: c.line, c: c.col, own: c.file === rootFile, key, doc: firstLine(X.documentation(c.el)) });
      }
    }
    return out;
  }
}

function firstLine(s) { const t = String(s || '').split('\n')[0]; return t.length > 140 ? t.slice(0, 137) + '...' : t; }

/** "0..1", "1..∞" */
module.exports = { Model, occurs, occText, baseName, FACETS };
