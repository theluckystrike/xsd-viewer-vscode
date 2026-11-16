'use strict';
// XML parsing for the XSD Viewer: @xmldom/xmldom (MIT, vendored unchanged in lib/xmldom) with the locator on, so every
// element carries lineNumber and columnNumber (1-based). A file that is not well-formed gives { error: { message,
// line, col } } instead of a half-read tree: a schema must be well-formed, and libxml2 would refuse it too.
const { DOMParser } = require('../../lib/xmldom');

const XS = 'http://www.w3.org/2001/XMLSchema';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const WSDL1 = 'http://schemas.xmlsoap.org/wsdl/';
const WSDL2 = 'http://www.w3.org/ns/wsdl';

/** Text of a file's bytes: UTF-8 (BOM dropped) or UTF-16 with a BOM. */
function decode(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.slice(2).toString('utf16le');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) { const c = Buffer.from(b.slice(2)); c.swap16(); return c.toString('utf16le'); }
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.slice(3).toString('utf8');
  return b.toString('utf8');
}

function cleanMessage(m) {
  let t = String(m || 'not well-formed');
  const inner = /caused (?:Error: )?(.*)$/s.exec(t);
  if (/^Reporting fatalError/.test(t) && inner) t = inner[1];
  return t.replace(/^\[xmldom [a-z ]+\]\s*/i, '').replace(/\|\|@#\[line:\d+,col:\d+\]\s*$/, '').replace(/\s+/g, ' ').trim();
}

/** Parses XML text: { doc } or { error: { message, line, col } }. Warnings (for example an unknown entity) are kept. */
function parseXml(text) {
  const warnings = [];
  let where = null;
  const onError = (level, message, builder) => {
    const loc = builder && builder.locator ? { line: builder.locator.lineNumber || 0, col: builder.locator.columnNumber || 0 } : null;
    if (level === 'warning') { warnings.push({ message: cleanMessage(message), ...(loc || {}) }); return; }
    where = loc;
    throw new Error(cleanMessage(message));
  };
  const src = String(text == null ? '' : text);
  if (!src.trim()) return { error: { message: 'The file is empty.', line: 1, col: 1 }, warnings };
  try {
    const doc = new DOMParser({ locator: true, onError }).parseFromString(src, 'text/xml');
    if (!doc || !doc.documentElement) return { error: { message: 'There is no root element.', line: 1, col: 1 }, warnings };
    return { doc, warnings };
  } catch (e) {
    const loc = (e && e.locator) ? { line: e.locator.lineNumber || 0, col: e.locator.columnNumber || 0 } : (where || { line: 0, col: 0 });
    let msg = cleanMessage(e && e.message);
    if (/missing root element/i.test(msg)) msg = 'There is no root element; this is not an XML file.';
    return { error: { message: msg, line: loc.line, col: loc.col }, warnings };
  }
}

/** Child elements of a node (optionally only those in namespace ns with one of the local names). */
function kids(node, ns, names) {
  const out = [];
  if (!node || !node.childNodes) return out;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    if (ns && c.namespaceURI !== ns) continue;
    if (names && !names.includes(c.localName)) continue;
    out.push(c);
  }
  return out;
}
const xsKids = (node, ...names) => kids(node, XS, names.length ? names : null);
const firstXs = (node, ...names) => xsKids(node, ...names)[0] || null;
const attr = (el, name) => (el && el.hasAttribute && el.hasAttribute(name) ? el.getAttribute(name) : null);

/** The text of an element's xs:annotation/xs:documentation children, whitespace tidied. */
function documentation(el) {
  const parts = [];
  for (const a of xsKids(el, 'annotation')) {
    for (const d of xsKids(a, 'documentation')) {
      const t = (d.textContent || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
      if (t) parts.push(t);
    }
  }
  return parts.join('\n\n');
}

/** Resolves a QName attribute value in the scope of an element: { ns, local, prefix }. */
function resolveQName(el, value) {
  const v = String(value || '').trim();
  const i = v.indexOf(':');
  const prefix = i > 0 ? v.slice(0, i) : '';
  const local = i > 0 ? v.slice(i + 1) : v;
  let ns = null;
  try { ns = el.lookupNamespaceURI(prefix || ''); } catch (e) { ns = null; }
  if (prefix === 'xml') ns = XML_NS;
  return { ns: ns || '', local, prefix, unbound: !!prefix && !ns };
}

module.exports = { parseXml, decode, kids, xsKids, firstXs, attr, documentation, resolveQName, XS, XSI, XML_NS, WSDL1, WSDL2 };
