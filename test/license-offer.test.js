'use strict';
// OFFER (license module 2026-11-14.offer, lane OFFER2, 14 Nov 2026): the vscode://<id>/activate?key= link from the
// license page (ACT1 contract), the Pro panel text (value line, tries used per tool, seller line), the Not now link
// and ?lang= on the card links. No network, no browser. Run: node --test test/offer.test.js
// In an extension repo apply.sh copies this file to test/license-offer.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = ['..', '../src/license', '../src/zovo'].find((d) => fs.existsSync(path.join(__dirname, d, 'index.js')) && fs.existsSync(path.join(__dirname, d, 'proinfo.js'))) || '../src/license';
const lic = require(`${dir}/license.js`);
const IDX = require(`${dir}/index.js`);

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function sign(payload, key = privateKey) {
  const p = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.sign(null, Buffer.from(lic.SIG_CONTEXT + p), key);
  return `${lic.KEY_PREFIX}${p}.${b64url(sig)}`;
}
const base = { v: 1, sku: 'zovo-pro', eh: 'a'.repeat(24), sid: 'cs_live_abcdefghijklmnop', iat: '2026-11-14', lm: true };
const NOW = Date.UTC(2026, 10, 14, 6);
const CARD = 'https://license.zovo.one/buy/zovo-pro';
const INFO = {
  triesKey: 'hexViewer.proTrial',
  tools: [
    { id: 'checksums', title: 'Checksums of File', line: 'Hashes.' },
    { id: 'entropy', title: 'Entropy and Byte Histogram', line: 'Entropy.' },
    { id: 'strings', title: 'Extract Strings', line: 'Strings.' },
  ],
};
const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uri = (query, p = '/activate') => ({ scheme: 'vscode', authority: 'zovo.zovo-hex-viewer', path: p, query });
const keyQuery = (k) => 'key=' + encodeURIComponent(k);

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zovo-offer-'));
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
let nfile = 0;
const tmpFile = () => path.join(tmpRoot, `h${++nfile}`, '.zovo', 'pro.json');

function ext(id, displayName, prefix) {
  return { id, packageJSON: { displayName, contributes: { commands: [{ command: `${prefix}.enterLicenseKey`, title: 'Enter Zovo Pro license key', category: 'Zovo Pro' }] } } };
}

function fakeVscode(answers = {}, installed = []) {
  const log = { info: [], warn: [], error: [], modal: [], opened: [], commands: {}, input: [], picks: [], exec: [], panels: [] };
  const vscode = {
    Uri: { parse: (s) => ({ toString: () => s, s }) },
    env: { openExternal: async (u) => { log.opened.push(u.s); return true; } },
    extensions: { all: installed },
    window: {
      showInformationMessage: async (msg, ...rest) => {
        if (rest[0] && rest[0].modal) { log.modal.push({ msg, detail: rest[0].detail, buttons: rest.slice(1) }); return answers.modal; }
        log.info.push({ msg, buttons: rest });
        return answers.info ? answers.info(msg, rest) : undefined;
      },
      showWarningMessage: async (msg) => { log.warn.push(msg); },
      showErrorMessage: async (msg) => { log.error.push(msg); },
      showInputBox: async (o) => { log.input.push(o); return undefined; },
      showQuickPick: async (items) => { log.picks.push(items.map((i) => i.label)); return undefined; },
      state: { focused: true },
      onDidChangeWindowState: (fn) => { log.win = fn; return { dispose() {} }; },
      createWebviewPanel: () => {
        const panel = { webview: { html: '', onDidReceiveMessage: () => ({ dispose() {} }) }, onDidDispose: () => ({ dispose() {} }), reveal() {} };
        log.panels.push(panel);
        return panel;
      },
    },
    commands: {
      registerCommand: (id, fn) => { log.commands[id] = fn; return { dispose() {} }; },
      executeCommand: async (id, arg) => { log.exec.push({ id, arg }); return { pro: true, reason: 'ok' }; },
    },
  };
  const secrets = new Map(); const global = new Map();
  const context = {
    subscriptions: [],
    secrets: { get: async (k) => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async (k) => { secrets.delete(k); }, onDidChange: () => ({ dispose() {} }) },
    globalState: { get: (k) => global.get(k), update: async (k, v) => { global.set(k, v); } },
  };
  return { vscode, context, log, secrets, global };
}
const mk = (f, extra = {}) => IDX.createLicense({
  vscode: f.vscode, context: f.context, sku: 'hex-pro', name: 'Zovo', product: 'Hex Viewer', commandPrefix: 'hexViewer',
  cardBuyUrl: CARD, listing: 'hex', proInfo: INFO, sharedFile: '', publicKey: PUB, now: () => NOW, ...extra,
});
const refOf = (u) => new URL(u).searchParams.get('client_reference_id');

test('OFFER module version and exports', () => {
  assert.equal(IDX.MODULE_VERSION, '2026-11-15.tries1');
  assert.equal(IDX.VALUE_LINE, 'One key turns on Pro in every Zovo extension, for life. USD 19 once.');
  assert.equal(IDX.SELLER_LINE, 'The card page shows BeLikeNative, our payments account.');
  assert.equal(IDX.ACTIVATE_ERROR, 'This link has no valid Zovo Pro key. Use Copy key on the license page.');
  // TRIES1 (15 Nov): 1 free try per Pro tool; the texts follow the number
  assert.equal(IDX.TRIES_MAX, 1);
  assert.equal(IDX.triesCount(0), '0 of 1 free try used');
  assert.equal(IDX.triesCount(9), '1 of 1 free try used');
  assert.equal(IDX.triesUsedLine(1, 'Extract Strings'), 'You used the free try of Extract Strings on this computer.');
  assert.equal(IDX.triesUsedLine(3, 'Extract Strings'), 'You used the free try of Extract Strings on this computer.', 'an old count of 2 or 3 reads the same');
  // a listing that still counts 3 (pro_info.triesMax): the old words
  assert.equal(IDX.triesCount(2, 3), '2 of 3 free tries used');
  assert.equal(IDX.triesUsedLine(3, 'Extract Strings', 3), 'You used the 3 free tries of Extract Strings on this computer.');
  assert.equal(IDX.triesUsedLine(1, 'Extract Strings', 3), 'Extract Strings: 1 of 3 free tries used');
  assert.equal(IDX.langParam('pt-BR'), 'pt-br');
  assert.equal(IDX.langParam('zh_CN'), 'zh-cn');
  assert.equal(IDX.langParam('en'), 'en');
  for (const bad of ['', 'x', 'en-"><script>', '../../x', 'english', null, 42]) assert.equal(IDX.langParam(bad), '', String(bad));
});

test('activate link: a good key turns Pro on with one message, no modal, no error; the key is stored like Enter a key', async () => {
  const f = fakeVscode();
  const p = mk(f);
  await p.ready;
  assert.equal(p.isPro(), false);
  const k = sign(base);
  assert.equal(await p.handleUri(uri(keyQuery(k))), true);
  assert.equal(p.isPro(), true);
  assert.deepEqual(f.log.info.map((m) => m.msg), ['Zovo Pro is on in Hex Viewer. Thank you.']);
  assert.equal(f.log.modal.length + f.log.warn.length + f.log.error.length + f.log.input.length + f.log.opened.length, 0);
  assert.equal([...f.secrets.values()].includes(k), true, 'stored in SecretStorage, as Enter a key does');
  // the same link again: the same message, no error
  assert.equal(await p.handleUri(uri(keyQuery(k) + '&src=page&utm=x')), true, 'unknown parameters are ignored');
  assert.equal(f.log.info.length, 2);
  assert.equal(f.log.error.length, 0);
  // trailing slash, and the key with copy noise (spaces) still works
  const g = fakeVscode();
  const q = mk(g);
  assert.equal(await q.handleUri(uri('key=' + encodeURIComponent(` ${k} `), '/activate/')), true);
  assert.equal(q.isPro(), true);
});

test('activate link: missing, damaged, foreign, test-mode, expired or wrong-sku keys change nothing and show one error', async () => {
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  const good = sign(base);
  const cases = {
    'no key': '',
    'empty key': 'key=',
    'not a Zovo key': 'key=hello',
    'a Gumroad key': 'key=A1B2C3D4-E5F60718-293A4B5C-6D7E8F90',
    'damaged': keyQuery(good.slice(0, -4) + 'AAAA'),
    'other signer': keyQuery(sign(base, other)),
    'test mode': keyQuery(sign({ ...base, lm: false, sid: 'cs_test_abcdefghijklmnop' })),
    'expired': keyQuery(sign({ ...base, exp: '2026-11-01' })),
    'wrong sku': keyQuery(sign({ ...base, sku: 'docx-pro' })),
    'too long': keyQuery('ZOVO1.' + 'A'.repeat(5000)),
  };
  for (const [name, query] of Object.entries(cases)) {
    const f = fakeVscode();
    const p = mk(f);
    await p.ready;
    assert.equal(await p.handleUri(uri(query)), false, name);
    assert.deepEqual(f.log.error, [IDX.ACTIVATE_ERROR], name);
    assert.equal(f.log.info.length + f.log.modal.length + f.log.warn.length + f.log.input.length + f.log.opened.length, 0, name);
    assert.equal(f.secrets.size, 0, `${name}: nothing stored`);
    assert.equal(p.isPro(), false, name);
  }
  // a bad link never removes Pro that is already on
  const f = fakeVscode();
  const p = mk(f);
  await p.handleUri(uri(keyQuery(good)));
  await p.handleUri(uri('key=hello'));
  assert.equal(p.isPro(), true);
  assert.equal(f.log.error.length, 1);
  // other paths: nothing at all
  const g = fakeVscode();
  const q = mk(g);
  assert.equal(await q.handleUri(uri(keyQuery(good), '/other')), false);
  assert.equal(await q.handleUri(uri(keyQuery(good), '/activatex')), false);
  assert.equal(await q.handleUri(null), false);
  assert.equal(g.log.info.length + g.log.error.length + g.log.modal.length, 0);
});

test('activate link: the old /license path still asks first', async () => {
  const f = fakeVscode();
  const p = mk(f);
  await p.ready;
  assert.equal(await p.handleUri(uri(keyQuery(sign(base)), '/license')), false, 'no Add key answer: nothing stored');
  assert.equal(f.log.modal.length, 1);
  assert.match(f.log.modal[0].msg, /^Add a Zovo Pro license key/);
  assert.equal(f.secrets.size, 0);
});

test('activate link: other installed Zovo extensions get the existing carry-over offer (one message), the shared file gets the key', async () => {
  const file = tmpFile();
  const installed = [ext('zovo.docx-viewer', 'DOCX Viewer', 'docxViewer'), ext('zovo.sqlite-editor', 'SQLite Editor', 'sqliteEditor')];
  const f = fakeVscode({ info: (msg) => (/Turn it on in your other Zovo tools too\?/.test(msg) ? 'Turn on' : undefined) }, installed);
  const p = mk(f, { sharedFile: file });
  await p.ready;
  const k = sign(base);
  assert.equal(await p.handleUri(uri(keyQuery(k))), true);
  assert.equal(f.log.info[0].msg, 'Zovo Pro is on in Hex Viewer. Turn it on in your other Zovo tools too? (DOCX Viewer and SQLite Editor)');
  assert.deepEqual(f.log.exec.map((e) => e.id), ['docxViewer.enterLicenseKey', 'sqliteEditor.enterLicenseKey']);
  assert.ok(f.log.exec.every((e) => e.arg.carryOver === true && e.arg.key === k));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).key, k);
  assert.equal(f.log.error.length, 0);
});

test('activate link arriving right after the window regains focus: no "Back from the checkout?" message', async () => {
  const f = fakeVscode();
  const p = mk(f, { returnDelayMs: 40 });
  await p.ready;
  await p.payByCard('panel'); // arms the return message
  f.log.win({ focused: false });
  const w = f.log.win({ focused: true }); // the browser hands the window back ...
  await p.handleUri(uri(keyQuery(sign(base)))); // ... and VS Code passes the link a moment later
  void w; await sleep(60); await tick();
  assert.deepEqual(f.log.info.map((m) => m.msg), ['Zovo Pro is on in Hex Viewer. Thank you.']);
  // without a link the message still comes after the pause
  const g = fakeVscode();
  const q = mk(g, { returnDelayMs: 10 });
  await q.ready;
  await q.payByCard('panel');
  g.log.win({ focused: false });
  g.log.win({ focused: true });
  await sleep(30); await tick();
  assert.match(g.log.info[0].msg, /^Back from the checkout\?/);
});

test('Pro panel: value line first, the tries of the clicked tool, N of 1 used for the others, seller line last', async () => {
  const f = fakeVscode();
  const p = mk(f);
  await p.ready;
  await f.context.globalState.update('hexViewer.proTrial', { checksums: 1, entropy: 1 });
  await p.requirePro('Checksums', { detail: 'Computes hashes.', triesUsed: 1, toolId: 'checksums' });
  const { msg, detail, buttons } = f.log.modal[0];
  assert.equal(msg, 'Checksums is part of Zovo Pro.');
  assert.equal(detail, [
    'One key turns on Pro in every Zovo extension, for life. USD 19 once.',
    'You used the free try of Checksums on this computer.\nComputes hashes.',
    'Other Pro tools in Hex Viewer:\nEntropy and Byte Histogram: 1 of 1 free try used\nExtract Strings: 0 of 1 free try used',
    'Everything that is free today stays free.',
    'VS Code will ask to open license.zovo.one, our Stripe checkout. Choose Open.\nThe card page shows BeLikeNative, our payments account.',
  ].join('\n\n'));
  assert.deepEqual(buttons, ['Pay by card (USD 19)', 'Get Zovo Pro with GitHub Sponsors', 'Pay with PayPal', 'Enter a key', 'Not now (tell us why)']);
  assert.doesNotMatch(detail, /\b(22|79|86)\b/, 'no count of extensions');
  // the clicked tool is left out by its title when the product passes no toolId
  const d2 = p.panelDetail('Extract Strings', { triesUsed: 1 });
  assert.match(d2, /Checksums of File: 1 of 1 free try used\nEntropy and Byte Histogram: 1 of 1 free try used/);
  assert.doesNotMatch(d2, /Extract Strings: /);
  assert.ok(d2.startsWith(IDX.VALUE_LINE));
  // a user who used 2 of the old 3 tries: the Pro panel reads "used the free try" (nobody sees "2 of 1")
  assert.match(p.panelDetail('Extract Strings', { triesUsed: 2 }), /\n\nYou used the free try of Extract Strings on this computer\.\n\n/);
  await f.context.globalState.update('hexViewer.proTrial', { checksums: 3, entropy: 2 });
  assert.match(p.panelDetail('Extract Strings', { triesUsed: 1 }), /Checksums of File: 1 of 1 free try used\nEntropy and Byte Histogram: 1 of 1 free try used/);
  // a listing that still counts 3 sets pro_info.triesMax: the old numbers
  const p3 = mk(f, { proInfo: { ...INFO, triesMax: 3 } });
  assert.match(p3.panelDetail('Extract Strings', { triesUsed: 2 }), /\n\nExtract Strings: 2 of 3 free tries used\n\n/);
  assert.match(p3.panelDetail('Extract Strings', { triesUsed: 3 }), /You used the 3 free tries of Extract Strings on this computer\.[^]*Checksums of File: 3 of 3 free tries used\nEntropy and Byte Histogram: 2 of 3 free tries used/);
  // refund line (owner value) sits before free stays free
  assert.match(mk(f, { refundDays: '14' }).panelDetail('Checksums', { triesUsed: 3 }), /\n\nNot happy\? Full refund within 14 days\. Everything that is free today stays free\./);
  // older Pro tools with no entry in the tries list are still named (Hex: Nested fields, Bookmarks, ...)
  const o = mk(fakeVscode(), { proTools: ['Checksums', 'Entropy and byte histogram', 'Bookmarks and notes', 'Compare report export'] });
  const od = o.panelDetail('Bookmarks and notes', { triesUsed: 3, toolId: 'bookmarks' });
  assert.match(od, /\n\nIt also turns on Compare report export here\. Everything that is free today stays free\./);
  assert.match(od, /Checksums of File: 0 of 1 free try used/);
  assert.doesNotMatch(od, /turns on [^\n]*(Checksums|Entropy|Bookmarks)/);
  // no tries store: the tool names as before, no tries numbers
  const n = mk(fakeVscode(), { proInfo: null, proTools: ['Checksums', 'Bookmarks'] }).panelDetail('Checksums', { triesUsed: 3 });
  assert.match(n, /\n\nIt also turns on Bookmarks here\. Everything that is free today stays free\./);
  assert.doesNotMatch(n, /of \d free tr(y|ies) used/);
  // nothing on the free path: building the facade shows nothing
  assert.equal(fakeVscode().log.info.length, 0);
});

test('Not now: Pro panel only; opens <card_buy_url>?nn=1&ref=<tag>&lang=<language>; no return message', async () => {
  const f = fakeVscode({ modal: 'Not now (tell us why)' });
  f.vscode.env.language = 'de';
  const p = mk(f);
  await p.ready;
  assert.equal(await p.requirePro('Checksums', { triesUsed: 3, surface: 'ctx' }), false);
  assert.equal(f.log.opened.length, 1);
  const u = new URL(f.log.opened[0]);
  assert.equal(`${u.origin}${u.pathname}`, CARD);
  assert.equal(u.searchParams.get('nn'), '1');
  assert.match(u.searchParams.get('ref'), /^[0-9a-f-]{36}_ctx_hex$/);
  assert.equal(u.searchParams.get('lang'), 'de');
  assert.equal(u.searchParams.get('client_reference_id'), null);
  await p.requirePro('Checksums', { triesUsed: 3 });
  assert.match(new URL(f.log.opened[1]).searchParams.get('ref'), /_panel_hex$/);
  assert.equal(f.log.win, undefined, 'Not now arms no back-from-browser message');
  assert.equal(f.log.info.length, 0);
  // not in the buy pick, the info tab or the palette
  const g = fakeVscode();
  const q = mk(g, { proInfo: false });
  await q.getPro('footer');
  assert.ok(!g.log.picks[0].some((l) => /Not now/.test(l)));
  const h = fakeVscode();
  await mk(h).getPro('toolbar');
  assert.ok(!/Not now/.test(h.log.panels[0].webview.html));
  assert.ok(!Object.keys(h.log.commands).some((c) => /notNow/i.test(c)));
  // test host keeps its host
  const t = fakeVscode({ modal: 'Not now (tell us why)' });
  await mk(t, { cardBuyUrl: 'https://license-test.zovo.one/buy/zovo-pro' }).requirePro('Checksums', { triesUsed: 3 });
  assert.match(t.log.opened[0], /^https:\/\/license-test\.zovo\.one\/buy\/zovo-pro\?nn=1&ref=[0-9a-f-]{36}_panel_hex$/);
});

test('?lang=: card and team links to the license Worker carry the VS Code language; Stripe links and odd values do not', async () => {
  const f = fakeVscode({ modal: 'Pay by card (USD 19)' });
  f.vscode.env.language = 'pt-br';
  const p = mk(f);
  await p.ready;
  await p.requirePro('Checksums', { triesUsed: 3 });
  assert.match(f.log.opened[0], /^https:\/\/license\.zovo\.one\/buy\/zovo-pro\?client_reference_id=[0-9a-f-]{36}_panel_hex&lang=pt-br$/);
  assert.equal(f.log.panels.length, 0, 'Pay by card in the Pro panel goes straight to the Worker page');
  await f.log.commands['hexViewer.payByCard']({ surface: 'pill' });
  assert.ok(f.log.opened[1].endsWith('_pill_hex&lang=pt-br'));
  assert.ok(refOf(f.log.opened[1]).endsWith('_pill_hex'));
  // English is sent too
  const e = fakeVscode();
  e.vscode.env.language = 'en';
  await mk(e).payByCard('footer');
  assert.ok(e.log.opened[0].endsWith('_footer_hex&lang=en'));
  // a strange language id is dropped
  const x = fakeVscode();
  x.vscode.env.language = 'en"><b>';
  await mk(x).payByCard('footer');
  assert.ok(x.log.opened[0].endsWith('_footer_hex'));
  // a direct Stripe Payment Link: no lang (Stripe does not know it)
  const s = fakeVscode();
  s.vscode.env.language = 'fr';
  await mk(s, { cardBuyUrl: 'https://buy.stripe.com/test_eVq3cw2oagsgeklaYZ43S0Q' }).payByCard('footer');
  assert.ok(!/lang=/.test(s.log.opened[0]));
});

test('OFFER keeps the rules: nothing at activation, no network in index.js, no new price', async () => {
  const f = fakeVscode();
  const p = mk(f);
  await p.ready;
  f.log.win && f.log.win({ focused: false }); f.log.win && await f.log.win({ focused: true }); await tick();
  assert.equal(f.log.info.length + f.log.modal.length + f.log.error.length + f.log.opened.length + f.log.panels.length, 0);
  const src = fs.readFileSync(path.join(__dirname, dir, 'index.js'), 'utf8');
  assert.ok(!/require\(['"](https?|net|tls|dgram)['"]\)|\bfetch\(/.test(src));
  const amounts = new Set((src.match(/USD \d+|\$\d+/g) || []));
  for (const a of amounts) assert.ok(['USD 19', 'USD 59', '$19'].includes(a) || /\$\{/.test(a), a);
  assert.deepEqual(IDX.PRICE, { one: 19, team: 59, seats: 5 });
});

test('OFFER info tab: Pay by card and Other ways come right after the price, before the tool list (above the fold)', () => {
  const P = require(`${dir}/proinfo.js`);
  const html = P.renderHtml({ product: 'Hex Viewer', tools: [{ title: 'Checksums of File', line: 'Computes hashes.', left: 2 }], nonce: 'n', trust: 'VS Code will ask to open license.zovo.one, our Stripe checkout. Choose Open.' });
  const at = (s) => html.indexOf(s);
  assert.ok(at('class="price"') < at('id="card"') && at('id="card"') < at('id="other"') && at('id="other"') < at('<h2>') && at('<h2>') < at('Checksums of File'));
  assert.ok(at('Choose Open.') < at('<h2>'), 'the trust line stays next to the buttons');
  assert.ok(at('BeLikeNative') > at('Checksums of File'), 'the seller section stays');
  const nocard = P.renderHtml({ tools: [], cardOn: false, nonce: 'n' });
  assert.ok(!nocard.includes('id="card"') && nocard.indexOf('id="other"') < nocard.indexOf('<h2>'));
});
