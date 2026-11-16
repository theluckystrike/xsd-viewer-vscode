'use strict';
// A schema set: the opened .xsd (or the schemas inside a .wsdl) plus every file it reaches through xs:include,
// xs:import, xs:redefine and xs:override, resolved by this code on local files only. A schemaLocation that is a web
// address is never downloaded: the host looks for a workspace file with the same target namespace (and, when there
// are several, the same file name). Files are named by URL strings (file:///..., or another workspace scheme), so the
// same code runs in tests on plain files.
const X = require('./xml');

const { XS, XML_NS, WSDL1, WSDL2 } = X;
const KINDS = ['element', 'complexType', 'simpleType', 'group', 'attributeGroup', 'attribute', 'notation'];
const qn = (ns, local) => `{${ns || ''}}${local}`;
const REMOTE_RE = /^(https?|ftp|urn):/i;
// The XML namespace (xml:lang, xml:space, xml:base, xml:id), written for this extension. Used when no file of the
// workspace defines that namespace, because its usual schemaLocation is a web address that is never downloaded.
const BUILTIN_XML_URL = 'zovo-builtin:/xml.xsd';
const BUILTIN_XML_TEXT = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="http://www.w3.org/XML/1998/namespace">
  <xs:annotation><xs:documentation>The attributes of the XML namespace, built into the XSD Viewer.</xs:documentation></xs:annotation>
  <xs:attribute name="lang">
    <xs:annotation><xs:documentation>Language of the content (BCP 47 tag), or empty.</xs:documentation></xs:annotation>
    <xs:simpleType><xs:union memberTypes="xs:language"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value=""/></xs:restriction></xs:simpleType></xs:union></xs:simpleType>
  </xs:attribute>
  <xs:attribute name="space">
    <xs:annotation><xs:documentation>Whether white space in the content is kept (preserve) or not (default).</xs:documentation></xs:annotation>
    <xs:simpleType><xs:restriction base="xs:NCName"><xs:enumeration value="default"/><xs:enumeration value="preserve"/></xs:restriction></xs:simpleType>
  </xs:attribute>
  <xs:attribute name="base" type="xs:anyURI"/>
  <xs:attribute name="id" type="xs:ID"/>
  <xs:attributeGroup name="specialAttrs">
    <xs:attribute ref="xml:base"/>
    <xs:attribute ref="xml:lang"/>
    <xs:attribute ref="xml:space"/>
    <xs:attribute ref="xml:id"/>
  </xs:attributeGroup>
</xs:schema>
`;

function baseName(u) {
  const s = String(u || '').split(/[?#]/)[0];
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  try { return decodeURIComponent(i >= 0 ? s.slice(i + 1) : s); } catch (e) { return i >= 0 ? s.slice(i + 1) : s; }
}

/** Resolves a schemaLocation against the URL of the file it is in: { url } for a local file, { remote: true } for a
 *  web address (never fetched). */
function resolveLocation(base, loc) {
  const l = String(loc || '').trim();
  if (!l) return { none: true };
  if (REMOTE_RE.test(l)) return { remote: true, loc: l };
  try { return { url: new URL(l.replace(/\\/g, '/'), base).href }; } catch (e) { return { bad: true, loc: l }; }
}

/** The target namespaces declared in a file's text, read with a regex (used for the workspace index). */
function namespacesInText(text) {
  const out = new Set();
  const re = /<(?:[A-Za-z_][\w.-]*:)?schema\b[^>]*?\btargetNamespace\s*=\s*(["'])(.*?)\1/g;
  let m;
  while ((m = re.exec(text))) out.add(m[2]);
  if (!out.size && /<(?:[A-Za-z_][\w.-]*:)?schema\b/.test(text)) out.add('');
  return [...out];
}

class SchemaSet {
  /**
   * io: { read(url) -> Promise<string|null>, findByNamespace?(ns, nameHint) -> Promise<url[]>,
   *       findByName?(name) -> Promise<url[]>, norm?(url) -> url }
   */
  constructor(io) {
    this.io = io;
    this.norm = io.norm || ((u) => u);
    this.files = new Map(); // url -> file record
    this.schemas = [];
    this.comps = Object.fromEntries(KINDS.map((k) => [k, new Map()]));
    this.warnings = [];
    this.root = null;
    this.nodes = [];
    this.loadedKeys = new Set();
    this.subst = null;
    this.derived = null;
  }

  /** An id for a DOM element (used by the viewer to ask for the content of a node). */
  idOf(el) {
    if (el.__zid === undefined) { el.__zid = this.nodes.length; this.nodes.push(el); }
    return el.__zid;
  }
  elById(id) { return this.nodes[Number(id)] || null; }

  /** Loads the file at url and everything it reaches. */
  async load(url) {
    this.root = this.norm(url);
    const queue = [{ url: this.root, chameleon: null, from: null }];
    while (queue.length) {
      const job = queue.shift();
      const key = `${job.url}|${job.chameleon == null ? '' : job.chameleon}`;
      if (this.loadedKeys.has(key)) continue;
      this.loadedKeys.add(key);
      const f = await this.readFile(job.url);
      if (!f || f.error) continue;
      const schemaEls = this.schemaElements(f);
      for (const el of schemaEls) {
        const s = this.addSchema(f, el, job.chameleon);
        for (const r of s.refs) {
          await this.resolveRef(s, r);
          if (r.url) queue.push({ url: r.url, chameleon: (r.kind === 'import') ? null : s.ens, from: s });
        }
      }
      // WSDL 1.1 / 2.0 imports and includes of other WSDL or XSD files (local only)
      if (f.kind === 'wsdl') {
        for (const w of [...X.kids(f.doc.documentElement, WSDL1, ['import']), ...X.kids(f.doc.documentElement, WSDL2, ['import', 'include'])]) {
          const loc = X.attr(w, 'location');
          const r = resolveLocation(f.url, loc);
          const ref = { kind: 'wsdl:' + w.localName, ns: X.attr(w, 'namespace') || '', loc: loc || '', line: w.lineNumber, col: w.columnNumber, el: w, url: null, status: 'missing' };
          if (r.url && (await this.exists(r.url))) { ref.url = this.norm(r.url); ref.status = 'ok'; queue.push({ url: ref.url, chameleon: null }); } else if (r.remote) ref.status = 'remote-missing';
          f.wsdlRefs.push(ref);
        }
      }
    }
    // imports by namespace only (no schemaLocation) are fine when another file of the set has that namespace
    const nsSet = new Set(this.schemas.map((s) => s.ens));
    for (const s of this.schemas) for (const r of s.refs) if (r.status === 'nolocation' && nsSet.has(r.ns)) { r.status = 'ok'; r.note = 'namespace found in the set'; }
    return this;
  }

  async exists(url) { if (url === BUILTIN_XML_URL) return true; try { const t = await this.io.read(url); return t != null; } catch (e) { return false; } }

  async readFile(url) {
    const u = this.norm(url);
    if (this.files.has(u)) return this.files.get(u);
    let text = null;
    if (u === BUILTIN_XML_URL) text = BUILTIN_XML_TEXT;
    else { try { text = await this.io.read(u); } catch (e) { text = null; } }
    const f = { url: u, name: baseName(u), text, doc: null, error: null, kind: /\.wsdl$/i.test(u) ? 'wsdl' : 'xsd', schemas: [], wsdlRefs: [] };
    this.files.set(u, f);
    if (text == null) { f.error = { message: 'The file could not be read.', line: 0, col: 0 }; return f; }
    const p = X.parseXml(text);
    if (p.error) { f.error = p.error; return f; }
    f.doc = p.doc;
    const root = p.doc.documentElement;
    f.rootName = root.localName;
    f.rootNs = root.namespaceURI || '';
    if (root.namespaceURI === WSDL1 || root.namespaceURI === WSDL2) f.kind = 'wsdl';
    else if (!(root.namespaceURI === XS && root.localName === 'schema')) {
      f.error = { message: `The root element is <${root.tagName}>${root.namespaceURI ? ` in namespace ${root.namespaceURI}` : ''}, not xs:schema, so this is not an XML Schema file.`, line: root.lineNumber, col: root.columnNumber, notSchema: true };
    }
    return f;
  }

  schemaElements(f) {
    const root = f.doc.documentElement;
    if (root.namespaceURI === XS && root.localName === 'schema') return [root];
    if (f.kind === 'wsdl') {
      const types = [...X.kids(root, WSDL1, ['types']), ...X.kids(root, WSDL2, ['types'])];
      const out = [];
      for (const t of types) out.push(...X.xsKids(t, 'schema'));
      return out;
    }
    return [];
  }

  addSchema(f, el, chameleon) {
    const tns = X.attr(el, 'targetNamespace') || '';
    const s = {
      idx: this.schemas.length, file: f.url, fileRec: f, el, tns,
      ens: tns || (chameleon || ''), chameleon: !tns && !!chameleon,
      efd: X.attr(el, 'elementFormDefault') === 'qualified', afd: X.attr(el, 'attributeFormDefault') === 'qualified',
      refs: [],
    };
    this.schemas.push(s);
    f.schemas.push(s);
    for (const c of X.xsKids(el)) {
      const k = c.localName;
      if (k === 'include' || k === 'import' || k === 'redefine' || k === 'override') {
        s.refs.push({ kind: k, ns: X.attr(c, 'namespace') || '', loc: X.attr(c, 'schemaLocation') || '', line: c.lineNumber, col: c.columnNumber, el: c, url: null, status: 'missing' });
        if (k === 'redefine' || k === 'override') for (const d of X.xsKids(c)) if (KINDS.includes(d.localName)) this.addComp(s, d, true);
      } else if (KINDS.includes(k)) this.addComp(s, c, false);
    }
    return s;
  }

  addComp(s, el, redefined) {
    const name = X.attr(el, 'name');
    if (!name) return;
    const kind = el.localName;
    const key = qn(s.ens, name);
    const map = this.comps[kind];
    const comp = { kind, name, ns: s.ens, qn: key, el, schema: s, file: s.file, line: el.lineNumber, col: el.columnNumber, redefined };
    if (map.has(key)) {
      const old = map.get(key);
      if (redefined) { map.set(key + '#orig', old); map.set(key, comp); return; }
      if (old.file === comp.file && old.line === comp.line) return;
      if (old.redefined) return;
      this.warnings.push({ file: s.file, line: el.lineNumber, message: `${kind} "${name}" is defined twice (also in ${baseName(old.file)} line ${old.line}); the first one is used.` });
      return;
    }
    map.set(key, comp);
  }

  async resolveRef(s, r) {
    await this.resolveRef0(s, r);
    if (r.kind === 'import' && r.ns === XML_NS && !r.url) { r.url = BUILTIN_XML_URL; r.status = 'builtin'; r.note = 'xml:lang, xml:space, xml:base and xml:id are built in'; }
  }

  async resolveRef0(s, r) {
    const io = this.io;
    const res = resolveLocation(s.file, r.loc);
    if (res.url) {
      if (await this.exists(res.url)) { r.url = this.norm(res.url); r.status = 'ok'; return; }
      // the relative path is not there: look for a file with that name (and namespace) in the workspace
      const hits = io.findByName ? await io.findByName(baseName(res.url)) : [];
      const pick = await this.pickByNamespace(hits, r.kind === 'import' ? r.ns : s.ens, r.kind !== 'import');
      if (pick) { r.url = this.norm(pick); r.status = 'moved'; r.note = `not at ${r.loc}; found ${baseName(pick)} in the workspace`; return; }
      r.status = 'missing'; r.note = `${r.loc} was not found`;
      return;
    }
    if (res.remote || res.none) {
      const hint = res.remote ? baseName(res.loc) : '';
      let hits = [];
      if (r.kind === 'import' && io.findByNamespace) hits = await io.findByNamespace(r.ns, hint);
      else if (hint && io.findByName) hits = await io.findByName(hint);
      hits = hits.map((h) => this.norm(h)).filter((h) => h !== s.file);
      const pick = hits.find((h) => hint && baseName(h) === hint) || hits[0];
      if (pick) { r.url = pick; r.status = res.remote ? 'remote-mapped' : 'ok'; r.note = res.remote ? `web address not downloaded; using ${baseName(pick)} from the workspace` : `found ${baseName(pick)} by namespace`; return; }
      r.status = res.remote ? 'remote-missing' : 'nolocation';
      r.note = res.remote ? `${r.loc} is a web address; it is never downloaded and no workspace file has namespace ${r.ns || '(none)'}` : `no schemaLocation and no workspace file has namespace ${r.ns || '(none)'}`;
      return;
    }
    r.status = 'missing'; r.note = `schemaLocation "${r.loc}" is not a path`;
  }

  async pickByNamespace(urls, ns, anyNs) {
    for (const u of urls) {
      let t = null;
      try { t = await this.io.read(u); } catch (e) { t = null; }
      if (t == null) continue;
      const list = namespacesInText(t.slice(0, 200000));
      if (anyNs || list.includes(ns || '')) return u;
    }
    return null;
  }

  /** xml:lang, xml:space, xml:base and xml:id, when no file of the set defines the XML namespace. */
  builtinXmlNs() {
    if (this.schemas.some((s) => s.ens === XML_NS)) return;
    for (const [name, type] of [['lang', 'language'], ['space', 'NCName'], ['base', 'anyURI'], ['id', 'ID']]) {
      this.comps.attribute.set(qn(XML_NS, name), { kind: 'attribute', name, ns: XML_NS, qn: qn(XML_NS, name), el: null, builtin: type, schema: null, file: '', line: 0, col: 0 });
    }
  }

  /** A global component by kind and QName attribute value in the scope of element el. */
  lookup(kind, el, value, schema) {
    const r = X.resolveQName(el, value);
    let ns = r.ns;
    if (!ns && schema && schema.chameleon && !r.prefix) ns = schema.ens;
    const key = qn(ns, r.local);
    const map = this.comps[kind];
    return { comp: map.get(key) || null, ns, local: r.local, prefix: r.prefix, key };
  }
  /** The schema record an element belongs to. */
  schemaOf(el) {
    let n = el;
    while (n && !(n.namespaceURI === XS && n.localName === 'schema')) n = n.parentNode;
    if (!n) return null;
    return this.schemas.find((s) => s.el === n) || null;
  }

  /** Members of the substitution group headed by the global element with key. */
  substitutes(key) {
    if (!this.subst) {
      this.subst = new Map();
      for (const c of this.comps.element.values()) {
        const v = X.attr(c.el, 'substitutionGroup');
        if (!v) continue;
        for (const one of v.trim().split(/\s+/)) {
          const h = this.lookup('element', c.el, one, c.schema).key;
          if (!this.subst.has(h)) this.subst.set(h, []);
          this.subst.get(h).push(c);
        }
      }
    }
    return this.subst.get(key) || [];
  }
  /** Named complex types that extend or restrict the type with key (one level). */
  derivedTypes(key) {
    if (!this.derived) {
      this.derived = new Map();
      for (const c of this.comps.complexType.values()) {
        const cc = X.firstXs(c.el, 'complexContent', 'simpleContent');
        const d = cc && X.firstXs(cc, 'extension', 'restriction');
        if (!d || !X.attr(d, 'base')) continue;
        const b = this.lookup('complexType', d, X.attr(d, 'base'), c.schema).key;
        if (!this.derived.has(b)) this.derived.set(b, []);
        this.derived.get(b).push(c);
      }
    }
    return this.derived.get(key) || [];
  }

  /** A prefix for a namespace: the one the schemas declare for it, else ns1, ns2, ... */
  prefixFor(ns, taken) {
    if (!ns) return '';
    for (const s of this.schemas) {
      for (let n = s.el; n && n.attributes; n = n.parentNode) {
        for (let i = 0; i < n.attributes.length; i++) {
          const a = n.attributes[i];
          if (a.prefix === 'xmlns' && a.value === ns && a.localName !== 'xml' && (!taken || !taken.has(a.localName))) return a.localName;
        }
      }
    }
    return '';
  }

  /** Counts of global components: { element, complexType, ... } for the whole set or only the root file. */
  counts(onlyFile) {
    const out = {};
    for (const k of KINDS) { out[k] = 0; for (const c of this.comps[k].values()) if (c.el && (!onlyFile || c.file === onlyFile)) out[k]++; }
    return out;
  }
  /** Every include/import with its status, by file. */
  fileList() {
    return [...this.files.values()].map((f) => ({
      url: f.url, name: f.name, kind: f.kind, error: f.error ? f.error.message : '',
      namespaces: [...new Set(f.schemas.map((s) => s.ens))],
      refs: [...f.schemas.flatMap((s) => s.refs), ...f.wsdlRefs].map((r) => ({ kind: r.kind, ns: r.ns, loc: r.loc, line: r.line, url: r.url || '', status: r.status, note: r.note || '' })),
    }));
  }
  problems() {
    const out = [];
    for (const f of this.files.values()) {
      if (f.error && f.url !== this.root) out.push({ file: f.url, line: f.error.line, message: `${f.name}: ${f.error.message}` });
      for (const r of [...f.schemas.flatMap((s) => s.refs), ...f.wsdlRefs]) {
        if (['missing', 'remote-missing', 'nolocation'].includes(r.status)) out.push({ file: f.url, line: r.line, message: `${f.name} line ${r.line}: ${r.kind} ${r.ns ? `of ${r.ns} ` : ''}not resolved: ${r.note || r.loc}` });
      }
    }
    return out.concat(this.warnings.map((w) => ({ ...w, message: `${baseName(w.file)} line ${w.line}: ${w.message}` })));
  }
}

module.exports = { SchemaSet, KINDS, qn, baseName, resolveLocation, namespacesInText, REMOTE_RE, BUILTIN_XML_URL };
