'use strict';
// XML Schema validation with libxml2 2.13.8 compiled to WebAssembly (npm xmllint-wasm 5.3.0, MIT, vendored unchanged
// in lib/xmllint). It runs in a worker thread of the editor's own Node.js, offline: libxml2 gets every file of the
// schema set as an in-memory file, with each schemaLocation rewritten to the local file this extension resolved, so
// it never needs the network. Schemas inside a WSDL file are cut out into files of their own first.
const X = require('./xml');
const { baseName } = require('./schema');

let lint = null;
function xmllint() { if (!lint) lint = require('../../lib/xmllint/index-node.js'); return lint; }
const LIBXML2_VERSION = '2.13.8';

/** Offsets of each line start in text. */
function lineStarts(t) { const s = [0]; for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) s.push(i + 1); return s; }

/** The text with the schemaLocation attribute of the element starting at (line, col) set to value. */
function setLocation(text, starts, line, col, value) {
  const at = (starts[line - 1] || 0) + Math.max(0, col - 1);
  const end = text.indexOf('>', at);
  if (end < 0) return text;
  const tag = text.slice(at, end);
  const m = /\bschemaLocation\s*=\s*(["'])([^"']*)\1/.exec(tag);
  const esc = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  if (m) return text.slice(0, at + m.index) + `schemaLocation="${esc}"` + text.slice(at + m.index + m[0].length);
  const close = tag.endsWith('/') ? tag.length - 1 : tag.length;
  return text.slice(0, at + close) + ` schemaLocation="${esc}"` + text.slice(at + close);
}

/** Serializes an embedded schema element (WSDL) as a file with the namespace declarations in scope on its root. */
function cutOutSchema(el) {
  const { XMLSerializer } = require('../../lib/xmldom');
  const decl = new Map();
  for (let n = el.parentNode; n && n.attributes; n = n.parentNode) {
    for (let i = 0; i < n.attributes.length; i++) {
      const a = n.attributes[i];
      const key = a.prefix === 'xmlns' ? a.localName : (a.name === 'xmlns' ? '' : null);
      if (key !== null && !decl.has(key)) decl.set(key, a.value);
    }
  }
  let s = new XMLSerializer().serializeToString(el);
  const own = new Set();
  for (let i = 0; i < el.attributes.length; i++) { const a = el.attributes[i]; if (a.prefix === 'xmlns') own.add(a.localName); else if (a.name === 'xmlns') own.add(''); }
  let add = '';
  for (const [k, v] of decl) if (!own.has(k) && !new RegExp(`\\sxmlns${k ? ':' + k : ''}=`).test(s.slice(0, s.indexOf('>')))) add += k ? ` xmlns:${k}="${v.replace(/"/g, '&quot;')}"` : ` xmlns="${v.replace(/"/g, '&quot;')}"`;
  s = s.replace(/^<([^\s>/]+)/, (m) => m + add);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${s}`;
}

/**
 * The in-memory files for libxml2: { files: [{ fileName, contents }], names: Map(virtual -> url), main: virtual name of
 * the wrapper schema that imports (or includes) each root schema }.
 * roots: [{ url, ns }] the schemas the instance names (or the opened schema).
 */
function buildInputs(set, roots) {
  const names = new Map();
  const byKey = new Map();
  const files = [];
  let n = 0;
  const vname = (key, base) => {
    if (!byKey.has(key)) { const v = `s${++n}_${base.replace(/[^\w.-]/g, '_')}`; byKey.set(key, v); }
    return byKey.get(key);
  };
  // one virtual file per schema record (a WSDL with 2 schemas gives 2 files)
  const recName = new Map();
  for (const s of set.schemas) {
    const f = s.fileRec;
    if (f.kind === 'wsdl') recName.set(s, vname(`${f.url}#${f.schemas.indexOf(s)}`, `${baseName(f.url).replace(/\.wsdl$/i, '')}-${f.schemas.indexOf(s) + 1}.xsd`));
    else recName.set(s, vname(f.url, baseName(f.url)));
  }
  const fileVirtual = (url, ns) => {
    const f = set.files.get(url);
    if (!f || !f.schemas.length) return null;
    const s = f.schemas.find((x) => x.ens === ns) || f.schemas[0];
    return recName.get(s);
  };
  const nsVirtual = (ns) => { const s = set.schemas.find((x) => x.ens === ns && !x.chameleon); return s ? recName.get(s) : null; };
  const done = new Set();
  for (const s of set.schemas) {
    const v = recName.get(s);
    if (done.has(v)) continue;
    done.add(v);
    const f = s.fileRec;
    let text = f.kind === 'wsdl' ? cutOutSchema(s.el) : f.text;
    if (f.kind === 'wsdl') {
      // the cut-out text has new line numbers: rewrite imports by parsing it again
      const p = X.parseXml(text);
      if (p.doc) {
        const starts = lineStarts(text);
        const edits = [];
        for (const c of X.xsKids(p.doc.documentElement, 'import', 'include')) {
          const ns = X.attr(c, 'namespace') || '';
          const ref = s.refs.find((r) => r.kind === c.localName && (r.ns || '') === ns && (r.loc || '') === (X.attr(c, 'schemaLocation') || ''));
          const target = ref && ref.url ? fileVirtual(ref.url, c.localName === 'import' ? ns : s.ens) : (c.localName === 'import' ? nsVirtual(ns) : null);
          if (target) edits.push([c.lineNumber, c.columnNumber, target]);
        }
        for (const [l, col, t] of edits.reverse()) text = setLocation(text, starts, l, col, t);
      }
    } else {
      const starts = lineStarts(text);
      const edits = [];
      for (const r of s.refs) {
        let target = null;
        if (r.url) target = fileVirtual(r.url, r.kind === 'import' ? r.ns : s.ens);
        else if (r.kind === 'import' && r.ns) target = nsVirtual(r.ns);
        if (target) edits.push([r.line, r.col, target]);
      }
      edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
      for (const [l, col, t] of edits) text = setLocation(text, starts, l, col, t);
    }
    files.push({ fileName: v, contents: text });
    names.set(v, f.url);
  }
  // the wrapper: imports each root namespace (or includes a no-namespace root)
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">`);
  const seen = new Set();
  for (const r of roots) {
    const v = fileVirtual(r.url, r.ns) || nsVirtual(r.ns);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    if (r.ns) lines.push(`  <xs:import namespace="${r.ns.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" schemaLocation="${v}"/>`);
    else lines.push(`  <xs:include schemaLocation="${v}"/>`);
  }
  lines.push('</xs:schema>');
  const main = '__zovo_main.xsd';
  files.unshift({ fileName: main, contents: lines.join('\n') + '\n' });
  return { files, names, main };
}

/** The namespace of the root element and the schema hints of an XML instance. */
function instanceInfo(text) {
  const p = X.parseXml(text);
  if (p.error) return { error: p.error };
  const root = p.doc.documentElement;
  const hints = [];
  const sl = root.getAttributeNS(X.XSI, 'schemaLocation');
  if (sl) { const parts = sl.trim().split(/\s+/); for (let i = 0; i + 1 < parts.length; i += 2) hints.push({ ns: parts[i], loc: parts[i + 1] }); }
  const nsl = root.getAttributeNS(X.XSI, 'noNamespaceSchemaLocation');
  if (nsl) hints.push({ ns: '', loc: nsl.trim() });
  const prefixes = {};
  for (let i = 0; i < root.attributes.length; i++) { const a = root.attributes[i]; if (a.prefix === 'xmlns') prefixes[a.value] = a.localName; else if (a.name === 'xmlns' && !(a.value in prefixes)) prefixes[a.value] = ''; }
  return { ns: root.namespaceURI || '', local: root.localName, hints, prefixes, doc: p.doc };
}

/** "{urn:x}Name" -> "pfx:Name" with the instance's own prefixes. */
function shortenNames(msg, prefixes) {
  return msg.replace(/\{([^}]*)\}([\w.-]+)/g, (m, ns, local) => {
    if (!ns) return local;
    if (prefixes && Object.prototype.hasOwnProperty.call(prefixes, ns)) return prefixes[ns] ? `${prefixes[ns]}:${local}` : local;
    return m;
  });
}

/**
 * Validates xml text (named xmlName for messages) against the schema set. roots: [{ url, ns }].
 * Returns { valid, problems: [{ file: url|null (null = the XML), line, message, severity }], raw }.
 */
async function validate(set, xmlText, xmlName, roots, prefixes) {
  const inp = buildInputs(set, roots);
  const name = 'instance.xml';
  let r;
  try {
    r = await xmllint().validateXML({ xml: [{ fileName: name, contents: xmlText }], schema: [inp.files[0]], preload: inp.files.slice(1), maxMemoryPages: 16384, initialMemoryPages: 512 });
  } catch (e) {
    // libxml2 could not build the schema (an error in a schema file): exit code other than 3/4
    return { valid: false, schemaError: true, problems: parseRaw(String(e && e.message || e), inp, name, prefixes), raw: String(e && e.message || e) };
  }
  return { valid: r.valid, problems: r.valid ? [] : parseRaw(r.rawOutput || '', inp, name, prefixes), raw: r.rawOutput || '' };
}

function parseRaw(raw, inp, name, prefixes) {
  const out = [];
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t || / validates$/.test(t) || /fails to validate$/.test(t) || /^WXS schema .* failed to compile$/.test(t)) continue;
    const m = /^(.*?):(\d+): (.*)$/.exec(t);
    let file = null, ln = 0, msg = t;
    if (m) {
      ln = parseInt(m[2], 10);
      msg = m[3];
      if (m[1] === name) file = null;
      else if (inp.names.has(m[1])) file = inp.names.get(m[1]);
      else if (m[1] === inp.main) file = '';
      else file = '';
    } else file = '';
    const warning = /warning/i.test(msg) && !/error/i.test(msg);
    msg = msg.replace(/^(element|attribute) [^:]+: /, '').replace(/^Schemas (validity|parser) (error|warning) : /, '').replace(/^parser error : /, '');
    msg = shortenNames(msg, prefixes);
    for (const [v, url] of inp.names) msg = msg.split(v).join(baseName(url));
    out.push({ file, line: ln, message: msg, severity: warning ? 'warning' : 'error' });
  }
  return out;
}

module.exports = { validate, buildInputs, instanceInfo, shortenNames, setLocation, cutOutSchema, LIBXML2_VERSION };
