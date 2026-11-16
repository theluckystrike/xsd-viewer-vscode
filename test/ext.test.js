'use strict';
// Extension tests with the vscode stub: listing, activation (nothing shows), the viewer's messages, the CSP, the three
// Pro tools with 1 free try each (used on file A, then the Pro panel on file B; a reload keeps the count), validation
// on save, README and support links.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ZOVO_PRO_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xsd-pro-')), 'pro.json');
const { loadExtension, tmpDir, cleanup } = require('./support/vscode-stub');
const { viewerHtml } = require('../src/html');

const ROOT = path.join(__dirname, '..');
const PO = path.join(ROOT, 'samples', 'purchase-order');
const FIX = path.join(__dirname, 'fixtures');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await f(); if (v) return v; await tick(10); } return f(); };
test.after(() => { cleanup(); fs.rmSync(path.dirname(process.env.ZOVO_PRO_FILE), { recursive: true, force: true }); });

function activate(folder, state) {
  const s = loadExtension();
  if (folder) s.vscode.workspace.workspaceFolders = [{ uri: s.vscode.Uri.file(folder), name: 'ws' }];
  if (state) for (const [k, v] of state) s.state.set(k, v);
  s.api = s.ext.activate(s.context);
  s.pro = s.api.pro();
  s.tools = s.api.tools();
  return s;
}
function tmpWs() {
  const dir = tmpDir('xsd-ws-');
  fs.mkdirSync(path.join(dir, 'po'), { recursive: true });
  for (const f of fs.readdirSync(PO)) fs.copyFileSync(path.join(PO, f), path.join(dir, 'po', f));
  fs.mkdirSync(path.join(dir, 'other'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'features.xsd'), path.join(dir, 'other', 'features.xsd'));
  fs.copyFileSync(path.join(FIX, 'broken.xsd'), path.join(dir, 'other', 'broken.xsd'));
  fs.copyFileSync(path.join(FIX, 'service.wsdl'), path.join(dir, 'other', 'service.wsdl'));
  return dir;
}
function fakePanel() {
  let onMsg;
  const posted = [];
  return {
    posted, viewColumn: 1, active: true, visible: true,
    webview: { options: {}, html: '', cspSource: 'vscode-resource:', asWebviewUri: (u) => u, postMessage: async (m) => { posted.push(m); return true; }, onDidReceiveMessage: (f) => { onMsg = f; return { dispose() {} }; } },
    onDidChangeViewState: () => ({ dispose() {} }), onDidDispose: () => ({ dispose() {} }), reveal() {},
    send: (m) => onMsg(m),
  };
}
async function openViewer(s, file) {
  const prov = s.providers.custom.p;
  const doc = await s.vscode.workspace.openTextDocument(s.vscode.Uri.file(file));
  const panel = fakePanel();
  await prov.resolveCustomTextEditor(doc, panel);
  await panel.send({ type: 'ready' });
  const load = await until(() => panel.posted.find((m) => m.type === 'load' || m.type === 'error'));
  return { prov, doc, panel, load };
}
const proPanel = (s, title) => s.log.info.find((m) => m.opts && m.opts.modal && m.text === `${title} is part of Zovo Pro.`);

// ---------- listing ----------
test('listing: display name with the phrase first, 30 characters or less, 5 keywords, engines low enough for Cursor and Windsurf', () => {
  assert.equal(pkg.displayName, 'XSD Viewer & Schema Diagram');
  assert.ok(pkg.displayName.length <= 30);
  assert.ok(pkg.description.startsWith('XSD viewer'));
  assert.deepEqual(pkg.keywords, ['xsd', 'xml schema', 'schema', 'xml', 'diagram']);
  assert.equal(pkg.engines.vscode, '^1.75.0');
  assert.equal(`${pkg.publisher}.${pkg.name}`, 'zovo.zovo-xsd-viewer');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.repository.url, 'https://github.com/theluckystrike/xsd-viewer-vscode');
  assert.deepEqual(pkg.activationEvents, ['onUri']);
  assert.ok(fs.existsSync(path.join(ROOT, pkg.icon)));
});
test('listing: the viewer is an optional editor for .xsd and .wsdl (schemas keep opening as text, no "multiple default editors")', () => {
  assert.equal(pkg.contributes.customEditors.length, 1);
  const ed = pkg.contributes.customEditors[0];
  assert.equal(ed.priority, 'option');
  assert.deepEqual(ed.selector.map((x) => x.filenamePattern), ['*.xsd', '*.wsdl']);
  assert.equal(pkg.contributes.languages, undefined, 'no language claim: VS Code and XML extensions keep .xsd');
});
test('listing: menus have no title keys; Explorer Pro entries are wrapper commands with real titles, hidden in the palette; regexes work', () => {
  const ctx = pkg.contributes.menus['explorer/context'];
  for (const m of ctx) { assert.equal(m.title, undefined); assert.ok(pkg.contributes.commands.some((c) => c.command === m.command)); }
  for (const list of Object.values(pkg.contributes.menus)) for (const m of list) assert.equal(m.title, undefined);
  const reOf = (w) => new RegExp(w.match(/=~ \/(.*?)\/i/)[1], 'i');
  const schemaRe = reOf(ctx[0].when);
  for (const f of ['a.xsd', 'ORDER.XSD', 'svc.wsdl', 'X.WSDL']) assert.ok(schemaRe.test(f), f);
  for (const f of ['a.xml', 'a.xsd.bak', 'a.xslt']) assert.ok(!schemaRe.test(f), f);
  const v = ctx.find((m) => m.command === 'xsdViewer.zovoPro.validate');
  assert.ok(reOf(v.when).test('order.xml') && reOf(v.when).test('ORDER.XML') && !reOf(v.when).test('order.xsd'));
  assert.ok(!/\\\\\\\\/.test(JSON.stringify(pkg.contributes.menus)), 'no doubled escaping in the menu regexes');
  const titles = Object.fromEntries(pkg.contributes.commands.map((c) => [c.command, c.title]));
  for (const id of ['sample', 'validate', 'docs']) {
    assert.match(titles[`xsdViewer.zovoPro.${id}`], /^Zovo Pro: /);
    assert.ok(pkg.contributes.menus.commandPalette.some((m) => m.command === `xsdViewer.zovoPro.${id}` && m.when === 'false'));
  }
});
test('pro.js keeps the free tries in one constant (1); proinfo JSON has no triesMax; tries key matches', () => {
  const pro = require('../src/pro');
  assert.equal(pro.TRIAL_USES, 1);
  assert.equal(pro.TRIAL_KEY, 'xsdViewer.proTrial');
  const cfg = require('../src/license/config');
  assert.equal(cfg.listing, 'xsd');
  assert.equal(cfg.pro_info.triesKey, pro.TRIAL_KEY);
  assert.equal(cfg.pro_info.triesMax, undefined);
  assert.deepEqual(cfg.pro_info.tools.map((t) => t.id), Object.keys(pro.FEATURES));
  assert.deepEqual(cfg.pro_info.tools.map((t) => t.title), Object.values(pro.FEATURES).map((f) => f.title));
  assert.deepEqual(require('../src/reach-config').tools.map((t) => t.title), Object.values(pro.FEATURES).map((f) => f.title));
  assert.equal(require('../src/license').MODULE_VERSION, '2026-11-15.tries1');
});

// ---------- activation ----------
test('activation shows nothing: no message, no panel, no editor, no browser; every contributed command is registered', () => {
  const s = activate();
  assert.equal(s.log.info.length + s.log.warn.length + s.log.error.length, 0);
  assert.equal(s.log.panel, undefined);
  assert.equal(s.log.opened.length, 0);
  assert.equal(s.log.external.length, 0);
  for (const c of pkg.contributes.commands) assert.ok(s.commands.has(c.command), `registered: ${c.command}`);
});

// ---------- viewer ----------
test('viewer: the sample loads its 3 files, the component list, a node, its children, and opens the source at a line', async () => {
  const dir = tmpWs();
  const s = activate(dir);
  const v = await openViewer(s, path.join(dir, 'po', 'purchase-order.xsd'));
  const l = v.load;
  assert.equal(l.type, 'load');
  assert.equal(l.files.length, 3);
  assert.deepEqual(l.files.map((f) => f.path), ['po/purchase-order.xsd', 'po/common-types.xsd', 'po/order-lines.xsd']);
  assert.equal(l.items.length, 17);
  assert.equal(l.items.filter((i) => i.own).length, 7);
  assert.equal(l.problemCount, 0);
  const po = l.items.find((i) => i.n === 'PurchaseOrder');
  await v.panel.send({ type: 'node', reqId: 1, key: { k: po.k, key: po.key } });
  const node = v.panel.posted.find((m) => m.type === 'node' && m.reqId === 1).node;
  assert.equal(node.name, 'PurchaseOrder');
  const line = node.children[0].children.find((c) => c.name === 'Line');
  await v.panel.send({ type: 'children', reqId: 2, ck: line.ck });
  const kids = v.panel.posted.find((m) => m.type === 'children' && m.reqId === 2).nodes;
  assert.deepEqual(kids[0].children.map((c) => c.name), ['Product', 'Quantity', 'UnitPrice', 'DeliveryDate']);
  await v.panel.send({ type: 'reveal', f: kids[0].children[1].src.f, l: kids[0].children[1].src.l, c: kids[0].children[1].src.c });
  const opened = s.log.opened[s.log.opened.length - 1];
  assert.match((opened.uri || opened.document.uri).fsPath, /order-lines\.xsd$/);
  assert.equal(s.log.info.length + s.log.warn.length + s.log.error.length, 0, 'nothing popped up');
});
test('viewer: a broken file and a file that is not a schema give a plain message; a WSDL lists its embedded schemas', async () => {
  const dir = tmpWs();
  const s = activate(dir);
  const b = await openViewer(s, path.join(dir, 'other', 'broken.xsd'));
  assert.equal(b.load.type, 'error');
  assert.ok(b.load.line >= 4);
  assert.doesNotMatch(b.load.message, /Reporting fatalError/);
  const w = await openViewer(s, path.join(dir, 'other', 'service.wsdl'));
  assert.equal(w.load.kind, 'wsdl');
  assert.equal(w.load.schemas, 2);
  assert.deepEqual(w.load.items.filter((i) => i.k === 'element').map((i) => i.n).sort(), ['GetQuote', 'GetQuoteResponse']);
});
test('html: CSP allows no remote origin and no inline style; scripts by nonce only; the toolbar has the Pro slot', () => {
  const h = viewerHtml({ cspSource: 'vscode-resource:', media: (n) => `vscode-resource:/media/${n}`, nonce: 'abc' });
  const csp = h.match(/content="(default-src[^"]+)"/)[1];
  assert.match(csp, /^default-src 'none'/);
  assert.ok(!/https?:/.test(csp));
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  assert.match(csp, /script-src 'nonce-abc'/);
  for (const m of h.matchAll(/<script\b[^>]*>/g)) assert.match(m[0], /nonce="abc"/);
  assert.ok(!/\sstyle="/.test(h));
  assert.match(h, /class="reach-slot"/);
  const js = fs.readFileSync(path.join(ROOT, 'media', 'viewer.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'media', 'diagram.js'), 'utf8');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|\.style\.|setAttribute\('style'/.test(js), 'no network and no inline styles in the page scripts');
});
test('viewer message "sample" runs the Pro tool for that element with the pill surface', async () => {
  const dir = tmpWs();
  const s = activate(dir);
  const v = await openViewer(s, path.join(dir, 'po', 'purchase-order.xsd'));
  const po = v.load.items.find((i) => i.n === 'PurchaseOrder');
  s.ui.quick.push((items) => items.filter((i) => i.picked));
  await v.panel.send({ type: 'sample', key: { k: 'element', key: po.key } });
  const c = s.log.commands.find((x) => x[0] === 'xsdViewer.sample');
  assert.equal(c[2].surface, 'pill');
  await until(() => fs.existsSync(path.join(dir, 'po', 'purchase-order-PurchaseOrder-sample.xml')));
  assert.ok(fs.existsSync(path.join(dir, 'po', 'purchase-order-PurchaseOrder-sample.xml')));
});

// ---------- Pro tools: 1 free try each, A then B ----------
test('Pro sample: file A writes and opens a valid sample and uses the try; file B opens the Pro panel at once (no pick, no file)', async () => {
  const dir = tmpWs();
  const s = activate(dir);
  assert.equal(s.pro.left('sample'), 1);
  s.ui.quick.push((items) => items.find((i) => i.label === 'PurchaseOrder'), (items) => items.filter((i) => i.picked));
  const r = await s.tools.sampleTool(s.vscode.Uri.file(path.join(dir, 'po', 'purchase-order.xsd')));
  assert.equal(r.element, 'PurchaseOrder');
  const xml = fs.readFileSync(r.uri.fsPath, 'utf8');
  assert.match(xml, /xsi:schemaLocation="urn:example:purchase-order purchase-order\.xsd"/);
  assert.ok(s.log.opened.some((d) => (d.uri || d.document.uri).fsPath === r.uri.fsPath));
  assert.equal(s.pro.left('sample'), 0);
  assert.match(s.log.status.join('\n'), /Zovo Pro: the free try of "Generate sample XML" is used on this computer\./);
  // the sample validates
  const v = await s.tools.runValidation(r.uri, [{ url: s.vscode.Uri.file(path.join(dir, 'po', 'purchase-order.xsd')).toString(), ns: 'urn:example:purchase-order' }]);
  assert.equal(v.valid, true, JSON.stringify(v.problems));
  const picks = s.log.lastPick;
  const r2 = await s.tools.sampleTool(s.vscode.Uri.file(path.join(dir, 'other', 'features.xsd')));
  assert.equal(r2, undefined);
  assert.ok(proPanel(s, 'Generate sample XML'), 'the Pro panel');
  assert.match(proPanel(s, 'Generate sample XML').opts.detail, /You used the free try of Generate sample XML on this computer\./);
  assert.equal(s.log.lastPick, picks, 'no pick after the panel');
  assert.ok(!fs.readdirSync(path.join(dir, 'other')).some((f) => /sample/.test(f)));
});
test('Pro sample: Escape at the element pick uses no try', async () => {
  const dir = tmpWs();
  const s = activate(dir);
  s.ui.quick.push(undefined);
  assert.equal(await s.tools.sampleTool(s.vscode.Uri.file(path.join(dir, 'po', 'purchase-order.xsd'))), undefined);
  assert.equal(s.pro.left('sample'), 1);
});
test('Pro validate: file A (3 errors) fills the Problems panel and uses the try; file B opens the Pro panel at once', async () => {
  const dir = tmpWs();
  const s = activate(dir);
  const a = s.vscode.Uri.file(path.join(dir, 'po', 'order-with-errors.xml'));
  const r = await s.tools.validateTool(a);
  assert.equal(r.valid, false);
  assert.equal(r.errors, 3);
  const dg = s.diags.get(a.toString());
  assert.deepEqual(dg.map((d) => d.range.start.line + 1), [6, 7, 26]);
  assert.match(dg[1].message, /pattern/);
  assert.equal(dg[0].source, 'XSD (libxml2)');
  assert.ok(s.log.commands.some((c) => c[0] === 'workbench.actions.view.problems'));
  assert.match(s.log.warn[0].text, /order-with-errors\.xml: 3 errors against purchase-order\.xsd/);
  assert.equal(s.pro.left('validate'), 0);
  const b = s.vscode.Uri.file(path.join(dir, 'po', 'order.xml'));
  assert.equal(await s.tools.validateTool(b), undefined);
  assert.ok(proPanel(s, 'Validate XML'));
  assert.equal(s.diags.get(b.toString()), undefined, 'file B was not checked');
});
test('Pro validate: a valid file says so; from a schema it asks for the XML file; Escape there uses no try', async () => {
  const dir = tmpWs();
  const s = activate(dir);
  s.ui.quick.push(undefined);
  assert.equal(await s.tools.validateTool(s.vscode.Uri.file(path.join(dir, 'po', 'purchase-order.xsd'))), undefined);
  assert.equal(s.pro.left('validate'), 1);
  s.ui.quick.push((items) => items.find((i) => i.label === 'order.xml'));
  const r = await s.tools.validateTool(s.vscode.Uri.file(path.join(dir, 'po', 'purchase-order.xsd')));
  assert.equal(r.valid, true);
  assert.match(s.log.info[s.log.info.length - 1].text, /^order\.xml is valid against purchase-order\.xsd \(libxml2 2\.13\.8, on this computer\)\.$/);
  assert.equal(s.pro.left('validate'), 0);
});
test('Pro docs: file A writes the HTML folder and uses the try; file B opens the Pro panel at once (no folder)', async () => {
  const dir = tmpWs();
  const s = activate(dir);
  s.ui.quick.push((items) => items[0], (items) => items[0]);
  const r = await s.tools.docsTool(s.vscode.Uri.file(path.join(dir, 'po', 'purchase-order.xsd')));
  assert.equal(r.pages, 18);
  assert.match(r.folder.fsPath, /po\/purchase-order-docs$/);
  const idx = fs.readFileSync(path.join(r.folder.fsPath, 'index.html'), 'utf8');
  assert.match(idx, /common-types\.xsd/);
  assert.ok(fs.existsSync(path.join(r.folder.fsPath, 'element-PurchaseOrder.html')));
  assert.equal(s.pro.left('docs'), 0);
  assert.match(s.log.info[s.log.info.length - 1].text, /^Wrote 18 HTML pages to po\/purchase-order-docs\.$/);
  assert.equal(await s.tools.docsTool(s.vscode.Uri.file(path.join(dir, 'other', 'features.xsd'))), undefined);
  assert.ok(proPanel(s, 'HTML documentation'));
  assert.ok(!fs.existsSync(path.join(dir, 'other', 'features-docs')));
});
test('a reload keeps the count: a new session with the same state opens the Pro panel for the used tool only', async () => {
  const dir = tmpWs();
  const s = activate(dir);
  s.ui.quick.push((items) => items[0], (items) => items[0]);
  await s.tools.docsTool(s.vscode.Uri.file(path.join(dir, 'po', 'purchase-order.xsd')));
  const s2 = activate(dir, s.state);
  assert.equal(s2.pro.left('docs'), 0);
  assert.equal(s2.pro.left('sample'), 1);
  assert.equal(await s2.tools.docsTool(s2.vscode.Uri.file(path.join(dir, 'po', 'purchase-order.xsd'))), undefined);
  assert.ok(proPanel(s2, 'HTML documentation'));
  assert.match(proPanel(s2, 'HTML documentation').opts.detail, /Generate sample XML: 0 of 1 free try used/);
});
test('validate on save: without Zovo Pro the old results are cleared; with Zovo Pro the file is checked again', async () => {
  const dir = tmpWs();
  const s = activate(dir);
  const a = s.vscode.Uri.file(path.join(dir, 'po', 'order-with-errors.xml'));
  await s.tools.validateTool(a);
  assert.equal(s.diags.get(a.toString()).length, 3);
  await s.tools.onSave({ uri: a });
  assert.equal(s.diags.get(a.toString()), undefined);
  assert.match(s.log.status.join('\n'), /Checking again on save is part of Zovo Pro/);
  // licensed: fix one error on disk, save, and the count drops to 2
  s.pro.license.isPro = () => true;
  await s.tools.validateTool(a);
  fs.writeFileSync(a.fsPath, fs.readFileSync(a.fsPath, 'utf8').replace('currency="EURO"', 'currency="EUR"'));
  await s.tools.onSave({ uri: a });
  assert.equal(s.diags.get(a.toString()).length, 2);
});

// ---------- README, support ----------
test('README: first screen has the main use, a screenshot of this product, the free list and the price; by Zovo; no rival names', () => {
  const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const first = md.split('\n').slice(0, 30).join('\n');
  assert.match(first, /^# XSD Viewer & Schema Diagram/);
  assert.match(first, /images\/screenshot\.png/);
  assert.match(first, /Zovo Pro: USD 19 once/);
  assert.match(md, /Made by Zovo/);
  assert.doesNotMatch(md, /XMLSpy|Oxygen|Altova|VolcanicBytes|xsd-navigator|sh17ck|pixelbyaj|Kryzen|Tituya|Red Hat|LemMinX/i);
  assert.ok(fs.existsSync(path.join(ROOT, 'images', 'screenshot.png')));
});
test('support links name this listing and related Zovo tools; walkthrough cross-sells listings that exist', () => {
  const support = require('../src/support');
  assert.equal(support.SELF_ID, 'zovo.zovo-xsd-viewer');
  assert.ok(support.RELATED.length >= 3 && !support.RELATED.includes(support.SELF_ID));
  assert.equal(support.PRO.getPro, 'xsdViewer.getPro');
  const steps = JSON.stringify(pkg.contributes.walkthroughs);
  const products = path.join(ROOT, '..');
  const ids = new Set(fs.readdirSync(products).map((d) => { try { const p = JSON.parse(fs.readFileSync(path.join(products, d, 'package.json'), 'utf8')); return `${p.publisher}.${p.name}`; } catch (e) { return ''; } }));
  for (const m of steps.matchAll(/extension\.open\?%5B%22([^%]+)%22%5D/g)) assert.ok(ids.has(m[1]), m[1]);
  for (const m of pkg.contributes.walkthroughs[0].steps.map((x) => x.media.markdown).filter(Boolean)) assert.ok(fs.existsSync(path.join(ROOT, m)), m);
});
