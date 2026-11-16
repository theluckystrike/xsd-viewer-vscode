'use strict';
// Core tests: XML parsing, the schema set (include, import, chameleon include, web addresses mapped to workspace files,
// the built-in XML namespace, WSDL), the content model, example values, sample XML, validation with libxml2, HTML
// documentation and the diagram.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const X = require('../src/core/xml');
const { SchemaSet, BUILTIN_XML_URL, resolveLocation, namespacesInText } = require('../src/core/schema');
const { Model } = require('../src/core/model');
const { example, toJsRegExp } = require('../src/core/regexgen');
const { valueFor, numberFor } = require('../src/core/values');
const { generate } = require('../src/core/sample');
const V = require('../src/core/validate');
const { buildDocs } = require('../src/core/docs');
const D = require('../media/diagram.js');
const { fileIo, url } = require('./support/io');

const ROOT = path.join(__dirname, '..');
const PO = path.join(ROOT, 'samples', 'purchase-order');
const FIX = path.join(__dirname, 'fixtures');
const load = async (file, ws) => { const io = fileIo(ws || path.dirname(file)); const s = await new SchemaSet(io).load(url(file)); s._io = io; return s; };
const comp = (s, kind, name) => [...s.comps[kind].values()].find((c) => c.name === name);
const children = (n) => (n.children || []).flatMap((c) => (c.k === 'element' ? [c] : children(c)));

// ---------- xml ----------
test('parseXml: line and column of each element; a broken file gives the place of the error', () => {
  const ok = X.parseXml('<a>\n  <b x="1"/>\n</a>');
  assert.equal(ok.doc.documentElement.firstChild.nextSibling.lineNumber, 2);
  const bad = X.parseXml(fs.readFileSync(path.join(FIX, 'broken.xsd'), 'utf8'));
  assert.ok(bad.error);
  assert.match(bad.error.message, /mismatch|end tag|closing/i);
  assert.ok(bad.error.line >= 4, JSON.stringify(bad.error));
  assert.match(X.parseXml('').error.message, /empty/);
  assert.match(X.parseXml('hello').error.message, /no root element/i);
  assert.equal(X.decode(Buffer.from([0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e])), '<a/>');
  assert.equal(X.decode(Buffer.from('﻿<a/>', 'utf16le')), '<a/>');
});

// ---------- schema set ----------
test('schema set: the sample follows its import and its chameleon include; components get the right namespace', async () => {
  const s = await load(path.join(PO, 'purchase-order.xsd'));
  assert.equal(s.files.size, 3);
  assert.deepEqual(s.problems(), []);
  const refs = s.fileList().find((f) => f.name === 'purchase-order.xsd').refs;
  assert.deepEqual(refs.map((r) => [r.kind, r.status]), [['import', 'ok'], ['include', 'ok']]);
  assert.equal(comp(s, 'complexType', 'OrderLineType').ns, 'urn:example:purchase-order', 'chameleon include takes the including namespace');
  assert.equal(comp(s, 'complexType', 'PartyType').ns, 'urn:example:common');
  assert.deepEqual(s.counts(s.root), { element: 2, complexType: 3, simpleType: 2, group: 0, attributeGroup: 0, attribute: 0, notation: 0 });
  assert.deepEqual(s.counts(), { element: 2, complexType: 10, simpleType: 5, group: 0, attributeGroup: 0, attribute: 0, notation: 0 });
});

test('schema set: a web address is never read; the workspace file with that namespace is used; a missing one is reported', async () => {
  const s = await load(path.join(FIX, 'remote', 'main.xsd'), path.join(FIX, 'remote'));
  assert.ok(s._io.reads.every((u) => u.startsWith('file:')), 'only local files read');
  const refs = s.fileList().find((f) => f.name === 'main.xsd').refs;
  assert.equal(refs[0].status, 'remote-mapped');
  assert.match(refs[0].url, /remote\/lib\/lib\.xsd$/);
  assert.equal(refs[1].status, 'remote-missing');
  assert.match(refs[1].note, /never downloaded/);
  assert.equal(refs[2].status, 'builtin');
  assert.equal(refs[2].url, BUILTIN_XML_URL);
  assert.ok(comp(s, 'element', 'Item'));
  assert.ok(s.comps.attribute.get('{http://www.w3.org/XML/1998/namespace}lang'));
  const p = s.problems();
  assert.equal(p.length, 1);
  assert.match(p[0].message, /urn:test:nowhere/);
});

test('schema set: a non-schema root and a broken file are errors of the root file; WSDL schemas are read', async () => {
  const a = await load(path.join(FIX, 'notschema.xsd'));
  assert.match(a.files.get(a.root).error.message, /not xs:schema/);
  const b = await load(path.join(FIX, 'broken.xsd'));
  assert.ok(b.files.get(b.root).error.line > 0);
  const w = await load(path.join(FIX, 'service.wsdl'));
  const f = w.files.get(w.root);
  assert.equal(f.kind, 'wsdl');
  assert.equal(f.schemas.length, 2);
  assert.ok(comp(w, 'element', 'GetQuote'));
  assert.equal(comp(w, 'complexType', 'Money').ns, 'urn:test:svc:types');
  assert.deepEqual(w.problems(), [], 'the namespace-only import finds the sibling schema');
});

test('resolveLocation and namespacesInText', () => {
  assert.deepEqual(resolveLocation('file:///a/b/c.xsd', '../d/e.xsd'), { url: 'file:///a/d/e.xsd' });
  assert.equal(resolveLocation('file:///a/b/c.xsd', 'https://x.org/y.xsd').remote, true);
  assert.equal(resolveLocation('file:///a/b/c.xsd', 'urn:x').remote, true);
  assert.deepEqual(namespacesInText('<xs:schema targetNamespace="urn:a"><x/></xs:schema>'), ['urn:a']);
  assert.deepEqual(namespacesInText('<schema xmlns="http://www.w3.org/2001/XMLSchema"/>'), ['']);
});

// ---------- model ----------
test('model: PurchaseOrder content with the choice, the inherited address content and the attributes', async () => {
  const s = await load(path.join(PO, 'purchase-order.xsd'));
  const m = new Model(s);
  const n = m.componentNode(comp(s, 'element', 'PurchaseOrder'));
  assert.equal(n.type, 'po:PurchaseOrderType');
  assert.deepEqual(n.attrs.map((a) => [a.name, a.use, a.def]), [['currency', 'required', null], ['priority', 'optional', 'normal']]);
  assert.equal(n.children.length, 1);
  assert.equal(n.children[0].k, 'sequence');
  const seq = n.children[0].children;
  assert.deepEqual(seq.map((c) => c.k === 'element' ? c.name : c.k), ['OrderNumber', 'IssueDate', 'Buyer', 'Seller', 'choice', 'Line', 'Note']);
  assert.deepEqual([seq[3].min, seq[5].max, seq[6].max], [0, -1, 5]);
  assert.match(seq[0].doc, /unique per buyer/);
  assert.equal(seq[0].text.facets.pattern[0], '[A-Z]{2,4}-[0-9]{6}');
  // the Line type comes from the included file; its content loads on demand
  const line = seq[5];
  assert.equal(m.childrenOf(line.ck)[0].src.f, m.fileNo(url(path.join(PO, 'order-lines.xsd'))));
  const lineKids = children({ children: m.childrenOf(line.ck) });
  assert.deepEqual(lineKids.map((c) => c.name), ['Product', 'Quantity', 'UnitPrice', 'DeliveryDate']);
  const qty = lineKids[1];
  assert.equal(qty.ck, undefined, 'simple content has no child elements');
  assert.equal(qty.text.builtin, 'decimal');
  assert.equal(qty.text.facets.minExclusive, '0');
  assert.deepEqual(qty.attrs[0].text.facets.enumeration.map((e) => e.value), ['piece', 'box', 'kg']);
  // extension: PickupPoint shows the inherited address content first
  const pp = m.componentNode(comp(s, 'complexType', 'PickupPointType'));
  assert.equal(pp.children[0].k, 'base');
  assert.equal(pp.children[0].name, 'cmn:AddressType');
  assert.deepEqual(children(pp.children[0]).map((c) => c.name), ['Street', 'City', 'PostalCode', 'Country']);
  assert.equal(pp.base, 'extension of cmn:AddressType');
  assert.deepEqual(pp.attrs.map((a) => a.name), ['pointId']);
  const idx = m.index(s.root);
  assert.equal(idx.filter((i) => i.own).length, 7);
  assert.equal(idx.length, 17);
});

test('model: recursion, substitution groups, abstract types, groups, attribute groups, list and union', async () => {
  const s = await load(path.join(FIX, 'features.xsd'));
  const m = new Model(s);
  const cat = m.componentNode(comp(s, 'element', 'Catalog'));
  assert.deepEqual(cat.attrs.map((a) => [a.name, a.group]), [['created', 'Audit'], ['by', 'Audit']]);
  const seq = cat.children[0].children;
  assert.deepEqual(seq.map((c) => c.k), ['element', 'element', 'element', 'group', 'any']);
  assert.equal(seq[3].name, 'Extras');
  assert.deepEqual(children(seq[3]).map((c) => c.name), ['Tags', 'Size']);
  assert.equal(children(seq[3])[0].text.builtin, 'list');
  assert.equal(children(seq[3])[1].text.union.length, 2);
  assert.deepEqual(m.componentNode(comp(s, 'element', 'Shape')).subs, ['Circle']);
  const part = m.childrenOf(seq[0].ck);
  const inner = children({ children: part })[1];
  assert.equal(inner.name, 'Part');
  assert.equal(inner.ck, seq[0].ck, 'a part holds parts: same content key, loaded only when opened');
  assert.deepEqual(m.componentNode(comp(s, 'complexType', 'AbstractKind')).derived, ['PersonKind']);
});

// ---------- values ----------
test('regexgen: examples match their pattern (ISO 20022 and UBL style patterns)', () => {
  for (const p of ['[A-Z]{2,4}-[0-9]{6}', '[A-Z0-9]{4,4}[A-Z]{2,2}[A-Z0-9]{2,2}([A-Z0-9]{3,3}){0,1}', '\\+[0-9]{1,3}-[0-9()+\\-]{1,30}', '[a-z]+(\\.[a-z]+)*@[a-z]+\\.(com|org)', '\\d{3}\\s?\\p{Lu}+', '[^@\\s]+@[^@\\s]+\\.[a-z]{2,}', '\\i\\c*', 'SKU-[0-9]{5}']) {
    const s = example(p);
    assert.ok(s != null, p);
    const re = toJsRegExp(p);
    assert.ok(re && re.test(s), `${p} -> ${s}`);
  }
  assert.equal(example('[A-Z]{2,10}', { minLength: 5 }).length >= 5, true);
});
test('values: enumerations, numbers with bounds and digits, dates, lengths, IDs', () => {
  assert.equal(valueFor({ builtin: 'token', facets: { enumeration: [{ value: 'rush' }] } }), 'rush');
  assert.equal(numberFor({ minExclusive: '0', maxInclusive: '100000', fractionDigits: '3' }, false), '1');
  assert.equal(numberFor({ minInclusive: '10', maxInclusive: '20' }, true), '10');
  assert.equal(numberFor({ maxExclusive: '1' }, true), '0');
  assert.equal(valueFor({ builtin: 'positiveInteger', facets: {} }), '1');
  assert.equal(valueFor({ builtin: 'date', facets: {} }), '2026-01-15');
  assert.equal(valueFor({ builtin: 'string', facets: { minLength: '6' } }, 'Name'), 'Namexx');
  assert.equal(valueFor({ builtin: 'string', facets: { maxLength: '2' } }, 'Country'), 'Co');
  assert.equal(valueFor({ builtin: 'hexBinary', facets: { length: '2' } }), '0A0A');
  assert.match(valueFor({ builtin: 'ID', facets: {} }), /^id\d+$/);
});

// ---------- sample + validate ----------
test('sample XML: the PurchaseOrder sample validates with libxml2, with and without optional parts and repeats', async () => {
  const s = await load(path.join(PO, 'purchase-order.xsd'));
  const po = comp(s, 'element', 'PurchaseOrder');
  for (const opts of [{}, { optional: true }, { optional: true, repeat: true }]) {
    const r = generate(s, po, { ...opts, comments: true, schemaHint: 'purchase-order.xsd', header: 'test' });
    assert.match(r.xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!-- test -->\n<PurchaseOrder xmlns="urn:example:purchase-order"/);
    assert.match(r.xml, /xsi:schemaLocation="urn:example:purchase-order purchase-order.xsd"/);
    assert.match(r.xml, /<OrderNumber>AA-000000<\/OrderNumber>|<OrderNumber>[A-Z]{2,4}-[0-9]{6}<\/OrderNumber>/);
    assert.match(r.xml, /<!-- choice: one of ShipTo \| PickupPoint -->/);
    const info = V.instanceInfo(r.xml);
    const v = await V.validate(s, r.xml, 'sample.xml', [{ url: po.file, ns: po.ns }], info.prefixes);
    assert.equal(v.valid, true, JSON.stringify(v.problems));
    if (opts.optional) assert.match(r.xml, /<ns\d+:TaxId>|<cmn:TaxId>/);
    if (opts.repeat) assert.equal((r.xml.match(/<Line /g) || []).length, 2);
  }
});
test('sample XML: recursion stops, abstract element and type get a substitute and xsi:type, lax any gets a placeholder; it validates', async () => {
  const s = await load(path.join(FIX, 'features.xsd'));
  const c = comp(s, 'element', 'Catalog');
  for (const opts of [{}, { optional: true, maxDepth: 4 }]) {
    const r = generate(s, c, { ...opts, comments: true });
    assert.match(r.xml, /<Circle>/);
    assert.match(r.xml, /xsi:type="PersonKind"/);
    assert.match(r.xml, /anyElement/);
    const v = await V.validate(s, r.xml, 'c.xml', [{ url: c.file, ns: c.ns }], V.instanceInfo(r.xml).prefixes);
    assert.equal(v.valid, true, r.xml + JSON.stringify(v.problems));
  }
});
test('validate: the sample order is valid; the order with errors gives 3 errors with lines and short names', async () => {
  const s = await load(path.join(PO, 'purchase-order.xsd'));
  const ok = fs.readFileSync(path.join(PO, 'order.xml'), 'utf8');
  const r1 = await V.validate(s, ok, 'order.xml', [{ url: s.root, ns: 'urn:example:purchase-order' }], V.instanceInfo(ok).prefixes);
  assert.equal(r1.valid, true);
  const bad = fs.readFileSync(path.join(PO, 'order-with-errors.xml'), 'utf8');
  const r2 = await V.validate(s, bad, 'order-with-errors.xml', [{ url: s.root, ns: 'urn:example:purchase-order' }], V.instanceInfo(bad).prefixes);
  assert.equal(r2.valid, false);
  assert.deepEqual(r2.problems.map((p) => [p.file, p.line, p.severity]), [[null, 6, 'error'], [null, 7, 'error'], [null, 26, 'error']]);
  assert.match(r2.problems[0].message, /^Element 'PurchaseOrder', attribute 'currency': \[facet 'enumeration'\] The value 'EURO'/);
  assert.match(r2.problems[1].message, /pattern '\[A-Z\]\{2,4\}-\[0-9\]\{6\}'/);
  assert.match(r2.problems[2].message, /'crate'/);
});
test('validate: the import by web address uses the mapped workspace file and the built-in XML namespace; schema errors name the schema file', async () => {
  const s = await load(path.join(FIX, 'remote', 'main.xsd'), path.join(FIX, 'remote'));
  const okXml = '<m:Doc xmlns:m="urn:test:main" xmlns:l="urn:test:lib" xml:lang="en"><l:Item><l:Code>A1</l:Code></l:Item></m:Doc>';
  const r = await V.validate(s, okXml, 'd.xml', [{ url: s.root, ns: 'urn:test:main' }], V.instanceInfo(okXml).prefixes);
  assert.equal(r.problems.filter((p) => p.severity === 'error').length, 0, JSON.stringify(r.problems));
  const noLang = okXml.replace(' xml:lang="en"', '');
  const r2 = await V.validate(s, noLang, 'd.xml', [{ url: s.root, ns: 'urn:test:main' }], V.instanceInfo(noLang).prefixes);
  assert.ok(r2.problems.some((p) => /lang/.test(p.message) && p.severity === 'error'), JSON.stringify(r2.problems));
  const b = await load(path.join(FIX, 'bad-schema.xsd'));
  const r3 = await V.validate(b, '<Root/>', 'r.xml', [{ url: b.root, ns: '' }], {});
  assert.equal(r3.valid, false);
  assert.ok(r3.problems.some((p) => p.file === b.root && /UndefinedType/.test(p.message)), JSON.stringify(r3.problems));
});
test('validate: schemas inside a WSDL are cut out with their namespaces and checked', async () => {
  const s = await load(path.join(FIX, 'service.wsdl'));
  const xml = '<GetQuoteResponse xmlns="urn:test:svc"><Price ccy="EUR">12.5</Price></GetQuoteResponse>';
  const r = await V.validate(s, xml, 'q.xml', [{ url: s.root, ns: 'urn:test:svc' }], V.instanceInfo(xml).prefixes);
  assert.equal(r.valid, true, JSON.stringify(r.problems));
  const bad = xml.replace(' ccy="EUR"', '');
  const r2 = await V.validate(s, bad, 'q.xml', [{ url: s.root, ns: 'urn:test:svc' }], V.instanceInfo(bad).prefixes);
  assert.equal(r2.valid, false);
  assert.match(r2.problems[0].message, /ccy/);
  const inp = V.buildInputs(s, [{ url: s.root, ns: 'urn:test:svc' }]);
  assert.match(inp.files.find((f) => /service-2\.xsd$/.test(f.fileName)).contents, /schemaLocation="s\d+_service-1\.xsd"/);
});
test('buildInputs: each schemaLocation points at the in-memory copy of the resolved file; line numbers stay', async () => {
  const s = await load(path.join(PO, 'purchase-order.xsd'));
  const inp = V.buildInputs(s, [{ url: s.root, ns: 'urn:example:purchase-order' }]);
  assert.equal(inp.main, '__zovo_main.xsd');
  assert.equal(inp.files.length, 4);
  const po = inp.files.find((f) => /purchase-order\.xsd$/.test(f.fileName));
  assert.match(po.contents, /<xs:import namespace="urn:example:common" schemaLocation="s\d+_common-types\.xsd"\/>/);
  assert.equal(po.contents.split('\n').length, fs.readFileSync(path.join(PO, 'purchase-order.xsd'), 'utf8').split('\n').length);
});

// ---------- docs + diagram ----------
test('HTML documentation: index with files and components, one page per component with diagram, content, attributes, values, used by', async () => {
  const s = await load(path.join(PO, 'purchase-order.xsd'));
  const r = buildDocs(s, { title: 'purchase-order.xsd' });
  assert.equal(r.components, 17);
  assert.equal(r.files.length, 19);
  const idx = r.files.find((f) => f.path === 'index.html').content;
  assert.match(idx, /common-types\.xsd/);
  assert.match(idx, /Elements \(2\)/);
  assert.match(idx, /href="complexType-PartyType\.html"/);
  const po = r.files.find((f) => f.path === 'element-PurchaseOrder.html').content;
  assert.match(po, /<svg [^>]*class="xsd-diagram"/);
  assert.match(po, /Defined in <span class="mono">purchase-order\.xsd<\/span>, line 13/);
  assert.match(po, /<td class="mono">currency<\/td><td class="mono">cmn:CurrencyCode<\/td><td>required<\/td>/);
  const party = r.files.find((f) => f.path === 'complexType-PartyType.html').content;
  assert.match(party, /Used by \(1\)<\/h2><ul class="cols"><li>Complex type <a href="complexType-PurchaseOrderType\.html">/);
  const cc = r.files.find((f) => f.path === 'simpleType-CurrencyCode.html').content;
  assert.match(cc, /enumeration \(4\)/);
  assert.ok(!/<script/i.test(idx + po + party + cc));
  const only = buildDocs(s, { onlyRoot: true });
  assert.equal(only.components, 7);
});
test('diagram: boxes for elements, pills for compositors, occurs under the box, names escaped, no inline styles', async () => {
  const s = await load(path.join(PO, 'purchase-order.xsd'));
  const m = new Model(s);
  const n = m.componentNode(comp(s, 'element', 'PurchaseOrder'));
  const r = D.render(n, { idAttr: true, selected: n.id });
  assert.ok(r.w > 300 && r.h > 200, `${r.w}x${r.h}`);
  assert.equal((r.svg.match(/class="n box/g) || []).length, 9);
  assert.equal((r.svg.match(/class="n comp sequence/g) || []).length, 1);
  assert.equal((r.svg.match(/class="n comp choice/g) || []).length, 1);
  assert.match(r.svg, />1\.\.∞</);
  assert.match(r.svg, />0\.\.5</);
  assert.match(r.svg, /data-tg="\d+"/);
  assert.ok(!/style=/.test(r.svg));
  assert.match(D.render({ id: 1, k: 'element', name: '<x&y>', min: 1, max: 1 }).svg, /&lt;x&amp;y&gt;/);
});
