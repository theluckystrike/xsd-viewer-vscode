'use strict';
// PROINFO (2026-11-13.proinfo, lane PROMOD): the Zovo Pro info panel and the per-listing card tag.
// No network, no browser. Run: node --test test/proinfo.test.js
// In an extension repo apply.sh copies this file to test/license-proinfo.test.js and the module to src/license/.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// factory folder, or an extension repo (src/license, or src/zovo for XLSX: apply.sh with ZOVO_LICENSE_DIR=src/zovo)
const dir = ['..', '../src/license', '../src/zovo'].find((d) => fs.existsSync(path.join(__dirname, d, 'proinfo.js'))) || '../src/license';
const P = require(`${dir}/proinfo.js`);
const IDX = require(`${dir}/index.js`);

const CARD = 'https://license.zovo.one/buy/zovo-pro';
const ID = '0b5c3c2e-1111-4a2b-9c3d-1234567890ab';
const INFO = {
  triesKey: 'hexViewer.proTrial',
  tools: [
    { id: 'checksums', title: 'Checksums of File', line: 'CRC-32, MD5 and SHA hashes of the file or the selection.' },
    { id: 'strings', title: 'Extract Strings', line: 'Lists the text strings of a file with their offsets.' },
  ],
};
const refOfUrl = (u) => new URL(u).searchParams.get('client_reference_id');
const tick = () => new Promise((r) => setImmediate(r));

// A fake VS Code API with webview panels. log.panels: every created panel; panel.send(msg) plays a button click.
function fakeVscode({ pick, webview = true } = {}) {
  const log = { info: [], warn: [], opened: [], commands: {}, picks: [], pickCalls: [], panels: [] };
  const vscode = {
    Uri: { parse: (s) => ({ toString: () => s, s }) },
    ViewColumn: { Active: -1, One: 1 },
    env: { openExternal: async (u) => { log.opened.push(u.s); return true; } },
    window: {
      showInformationMessage: async (msg, ...rest) => { log.info.push(msg); return log.modalAnswer && rest[0] && rest[0].modal ? log.modalAnswer : undefined; },
      showWarningMessage: async (msg) => { log.warn.push(msg); },
      showErrorMessage: async (msg) => { log.warn.push(msg); },
      showInputBox: async () => undefined,
      showQuickPick: async (items, o) => {
        log.picks.push(items.map((i) => i.label));
        log.pickCalls.push({ items, o });
        const want = typeof pick === 'function' ? pick(items) : pick;
        return want ? items.find((i) => i.label === want) : undefined;
      },
      state: { focused: true },
      onDidChangeWindowState: (fn) => { log.win = fn; return { dispose() {} }; },
    },
    commands: { registerCommand: (id, fn) => { log.commands[id] = fn; return { dispose() {} }; } },
  };
  if (webview) {
    vscode.window.createWebviewPanel = (viewType, title, column, options) => {
      let onMsg = null; let onDispose = null;
      const panel = {
        viewType, title, column, options, reveals: 0,
        webview: { html: '', cspSource: 'vscode-webview://x', onDidReceiveMessage: (fn) => { onMsg = fn; return { dispose() { onMsg = null; } }; } },
        reveal() { panel.reveals += 1; },
        onDidDispose: (fn) => { onDispose = fn; return { dispose() {} }; },
        send: (m) => (onMsg ? onMsg(m) : undefined),
        dispose() { if (onDispose) onDispose(); },
      };
      log.panels.push(panel);
      return panel;
    };
  }
  const global = new Map();
  const context = {
    subscriptions: [],
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) },
    globalState: { get: (k) => global.get(k), update: async (k, v) => { global.set(k, v); } },
  };
  return { vscode, context, log, global };
}

const sponsorsStub = () => ({ id: 'github-sponsors', ready: Promise.resolve(), isPro: () => false, unlock: async () => ({ pro: false, reason: 'cancelled', message: '' }), refresh: async () => false, remove: async () => {}, state: () => null, onDidChange: () => ({ dispose() {} }) });
const mk = (f, extra = {}) => IDX.createLicense({
  vscode: f.vscode, context: f.context, sku: 'hex-pro', name: 'Zovo', product: 'Hex Viewer', commandPrefix: 'hexViewer',
  cardBuyUrl: CARD, listing: 'hex', proInfo: INFO, rails: [sponsorsStub()], sharedFile: '', ...extra,
});

// ---- pure helpers ----
test('PROINFO version and surfaces', () => {
  assert.equal(IDX.MODULE_VERSION, '2026-11-15.tries1');
  assert.equal(P.PROINFO_VERSION, '2026-11-13.proinfo');
  for (const s of ['toolbar', 'ctx', 'panel', 'title', 'status', 'pick', 'footer', 'palette']) assert.ok(IDX.SURFACES.includes(s), s);
  assert.equal(IDX.surfaceOf('pick'), 'pick');
  assert.equal(IDX.surfaceOf({ surface: 'status' }), 'status');
});

test('refOf: <install id>_<surface>_<listing>, bad listing falls back to the CARD2 tag', () => {
  assert.equal(P.refOf(ID, 'toolbar', 'hex'), `${ID}_toolbar_hex`);
  assert.equal(P.refOf(ID, 'panel', 'XLSX'), `${ID}_panel_xlsx`, 'lower case');
  assert.equal(P.refOf(ID, 'ctx', ''), `${ID}_ctx`);
  assert.equal(P.refOf(ID, 'ctx', undefined), `${ID}_ctx`);
  for (const bad of ['hex_viewer', 'a-b', '../x', 'x'.repeat(17), 42, { a: 1 }]) assert.equal(P.refOf(ID, 'menu', bad), `${ID}_menu`, String(bad));
  assert.equal(P.listingOf(' Hex '), 'hex');
  assert.equal(P.listingOf('pdf2'), 'pdf2');
  assert.match(P.refOf(ID, 'toolbar', 'hex'), /^[A-Za-z0-9_-]{1,199}$/);
});

test('toolsWithTries reads the listing tries store; triesText words', () => {
  const gs = { get: (k) => (k === 'hexViewer.proTrial' ? { checksums: 1, strings: 3 } : undefined) };
  // TRIES1: 1 free try per Pro tool; an old count of 2 or 3 reads as 0 left
  assert.equal(P.TRIES_MAX, 1);
  const t = P.toolsWithTries(INFO, gs);
  assert.deepEqual(t.map((x) => [x.id, x.left]), [['checksums', 0], ['strings', 0]]);
  assert.equal(P.toolsWithTries(INFO, { get: () => undefined })[0].left, 1);
  // pro_info.triesMax (a listing that still counts 3)
  assert.deepEqual(P.toolsWithTries({ ...INFO, triesMax: 3 }, gs).map((x) => x.left), [2, 0]);
  assert.equal(P.triesMaxOf({ triesMax: 'x' }), 1);
  assert.equal(P.triesMaxOf({ triesMax: 0 }), 1);
  assert.equal(P.triesMaxOf(null), 1);
  // older product: titles only, no tries shown
  const old = P.toolsWithTries(null, gs, ['Merge PDFs', 'Split PDF']);
  assert.deepEqual(old.map((x) => [x.title, x.left]), [['Merge PDFs', null], ['Split PDF', null]]);
  assert.equal(P.triesText(3), '3 free tries left');
  assert.equal(P.triesText(1), '1 free try left');
  assert.equal(P.triesText(0), 'no free tries left');
  assert.equal(P.triesText(null), '');
  // junk in the store or the info never throws
  assert.equal(P.toolsWithTries({ triesKey: 'k', tools: [{ id: 'a', title: 'A' }, null, { title: '' }] }, { get: () => 'x' }).length, 1);
});

test('renderHtml: the facts the buyer needs, two buttons, strict CSP, no remote content, escaped text', () => {
  const html = P.renderHtml({ product: 'Hex Viewer', tools: P.toolsWithTries(INFO, { get: () => ({ checksums: 1 }) }), nonce: 'abc123', trust: 'VS Code will ask to open license.zovo.one, our Stripe checkout. Choose Open.' });
  for (const want of [
    'One key turns on Pro in every Zovo extension, for life. USD 19 once.',
    'Team: 5 seats USD 59.',
    'Pro tools in Hex Viewer',
    'Checksums of File', 'CRC-32, MD5 and SHA hashes', 'no free tries left', 'Extract Strings', '1 free try left',
    'Your key shows on the next page. Click Open in VS Code and Pro turns on.', 'Or click Copy key',
    'Zovo Pro: Enter a key',
    'Made by Zovo. The seller name on the card page is BeLikeNative.',
    '>Pay by card</button>', '>Other ways (GitHub Sponsors, PayPal)</button>',
    'Choose Open.',
  ]) assert.ok(html.includes(want), want);
  assert.equal((html.match(/<button /g) || []).length, 2);
  // the CSP sits in an attribute, so its quotes are HTML-escaped (the browser reads them back as ')
  assert.ok(html.includes("content=\"default-src &#39;none&#39;; style-src &#39;nonce-abc123&#39;; script-src &#39;nonce-abc123&#39;\""));
  assert.ok(!/https?:\/\//.test(html), 'no links or remote loads in the page');
  assert.ok(!/<a /.test(html));
  const evil = P.renderHtml({ tools: [{ title: '<img src=x onerror=alert(1)>', line: '"quoted" & more', left: 3 }], nonce: 'n' });
  assert.ok(!evil.includes('<img'));
  assert.ok(evil.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(evil.includes('&quot;quoted&quot; &amp; more'));
  // without the card rail: one button, no card
  const nocard = P.renderHtml({ tools: [], cardOn: false, nonce: 'n' });
  assert.equal((nocard.match(/<button /g) || []).length, 1);
  assert.ok(!nocard.includes('>Pay by card<'));
});

// ---- the facade ----
test('Get Zovo Pro opens the info panel first: nothing at activation, no browser, no popup or toast', async () => {
  const f = fakeVscode();
  const pro = mk(f);
  await pro.ready;
  f.log.win && f.log.win({ focused: false }); f.log.win && f.log.win({ focused: true }); await tick();
  assert.equal(f.log.panels.length, 0, 'no panel at activation');
  assert.equal(await f.log.commands['hexViewer.getPro']({ surface: 'toolbar' }), false);
  assert.equal(f.log.panels.length, 1);
  const p = f.log.panels[0];
  assert.equal(p.viewType, 'zovoProInfo');
  assert.equal(p.title, 'Zovo Pro');
  assert.equal(p.options.enableScripts, true);
  assert.equal(p.options.enableCommandUris, false);
  assert.deepEqual(p.options.localResourceRoots, []);
  assert.ok(p.webview.html.includes('Checksums of File'));
  assert.ok(p.webview.html.includes('1 free try left'));
  assert.deepEqual(f.log.opened, [], 'the browser waits for Pay by card');
  assert.equal(f.log.info.length + f.log.warn.length + f.log.picks.length, 0, 'no toast, no popup, no pick');
  assert.equal(f.global.size, 0, 'no install id until a card click');
});

test('Pay by card in the panel opens the Worker link tagged <install id>_<surface>_<listing>', async () => {
  const f = fakeVscode();
  const pro = mk(f);
  await pro.ready;
  await pro.getPro({ surface: 'toolbar' });
  await f.log.panels[0].send({ type: 'card' });
  assert.equal(f.log.opened.length, 1);
  assert.match(f.log.opened[0], /^https:\/\/license\.zovo\.one\/buy\/zovo-pro\?client_reference_id=[0-9a-f-]{36}_toolbar_hex$/);
  // a second click elsewhere reveals the same panel, with that click's surface
  await f.log.commands['hexViewer.getPro']([{ scheme: 'file', path: '/w/a.bin' }]);
  assert.equal(f.log.panels.length, 1);
  assert.equal(f.log.panels[0].reveals, 1);
  await f.log.panels[0].send({ type: 'card' });
  assert.ok(refOfUrl(f.log.opened[1]).endsWith('_menu_hex'));
  assert.equal(refOfUrl(f.log.opened[0]).slice(0, 36), refOfUrl(f.log.opened[1]).slice(0, 36), 'one install id');
  // every surface the brief names
  for (const s of ['ctx', 'pick', 'palette', 'footer', 'title', 'status']) {
    await pro.getPro(s === 'palette' ? undefined : { surface: s });
    await f.log.panels[0].send({ type: 'card' });
    assert.ok(refOfUrl(f.log.opened.at(-1)).endsWith(`_${s}_hex`), s);
  }
  // unknown messages do nothing
  const n = f.log.opened.length;
  await f.log.panels[0].send({ type: 'evil', url: 'https://example.com' });
  await f.log.panels[0].send('card');
  await f.log.panels[0].send(null);
  assert.equal(f.log.opened.length, n);
  // closed panel: the next click makes a new one
  f.log.panels[0].dispose();
  await pro.getPro('footer');
  assert.equal(f.log.panels.length, 2);
});

test('Other ways: GitHub Sponsors, PayPal, team by card, Enter a key; no single-seat card row', async () => {
  const f = fakeVscode({ pick: undefined });
  const pro = mk(f);
  await pro.ready;
  await pro.getPro({ surface: 'toolbar' });
  await f.log.panels[0].send({ type: 'other' });
  assert.deepEqual(f.log.picks[0], ['GitHub Sponsors', 'PayPal', 'Team of 5 by card, USD 59', 'Enter a key']);
  assert.deepEqual(f.log.opened, [], 'Escape opens nothing');
  const t = fakeVscode({ pick: 'Team of 5 by card, USD 59' });
  const tp = mk(t);
  await tp.getPro({ surface: 'ctx' });
  await t.log.panels[0].send({ type: 'other' });
  assert.match(t.log.opened[0], /^https:\/\/license\.zovo\.one\/buy\/zovo-pro-team\?client_reference_id=[0-9a-f-]{36}_ctx_hex$/);
  const s = fakeVscode({ pick: 'GitHub Sponsors' });
  const sp = mk(s);
  await sp.getPro('footer');
  await s.log.panels[0].send({ type: 'other' });
  assert.deepEqual(s.log.opened, ['https://github.com/sponsors/theluckystrike/sponsorships?tier_id=679878']);
  // a direct Stripe Payment Link as card_buy_url: no team row (no known team link)
  const d = fakeVscode();
  const dp = mk(d, { cardBuyUrl: 'https://buy.stripe.com/test_eVq3cw2oagsgeklaYZ43S0Q' });
  await dp.getPro('footer');
  await d.log.panels[0].send({ type: 'other' });
  assert.deepEqual(d.log.picks[0], ['GitHub Sponsors', 'PayPal', 'Enter a key']);
});

test('OFFER: the Pro panel card button goes straight to the Worker link with its surface (no info tab)', async () => {
  const f = fakeVscode();
  f.log.modalAnswer = 'Pay by card (USD 19)';
  const pro = mk(f);
  await pro.ready;
  assert.equal(await pro.requirePro('Checksums of File', { detail: 'x', triesUsed: 3, surface: 'ctx' }), false);
  assert.equal(f.log.panels.length, 0, 'no info tab from the Pro panel');
  assert.equal(f.log.opened.length, 1);
  assert.ok(refOfUrl(f.log.opened[0]).endsWith('_ctx_hex'));
  await pro.requirePro('Checksums of File', { triesUsed: 3 });
  assert.ok(refOfUrl(f.log.opened[1]).endsWith('_panel_hex'));
  assert.equal(f.log.panels.length, 0);
});

test('payByCard command stays direct (no panel) and tagged with the listing; enterKey command exists', async () => {
  const f = fakeVscode();
  await mk(f).ready;
  await f.log.commands['hexViewer.payByCard']({ surface: 'pill' });
  assert.equal(f.log.panels.length, 0);
  assert.ok(refOfUrl(f.log.opened[0]).endsWith('_pill_hex'));
  assert.ok('hexViewer.enterKey' in f.log.commands);
  f.vscode.env.clipboard = { readText: async () => 'not a key' };
  const r = await f.log.commands['hexViewer.enterKey']();
  assert.deepEqual(Object.keys(r).sort(), ['pro', 'reason']);
  assert.equal(r.pro, false);
});

test('fallbacks: no listing = CARD2 tag; no webview API or proInfo false = CARD2 pick; no card rail = no panel', async () => {
  const a = fakeVscode();
  const ap = mk(a, { listing: '' });
  await ap.getPro('footer');
  await a.log.panels[0].send({ type: 'card' });
  assert.match(refOfUrl(a.log.opened[0]), /^[0-9a-f-]{36}_footer$/);
  const b = fakeVscode({ webview: false, pick: 'Pay by card, USD 19, no account' });
  await mk(b).getPro('footer');
  assert.deepEqual(b.log.picks[0], IDX.PICK_LABELS);
  assert.ok(refOfUrl(b.log.opened[0]).endsWith('_footer_hex'));
  const c = fakeVscode({ pick: undefined });
  await mk(c, { proInfo: false }).getPro('footer');
  assert.equal(c.log.panels.length, 0);
  assert.deepEqual(c.log.picks[0], IDX.PICK_LABELS);
  const d = fakeVscode();
  const dp = mk(d, { cardBuyUrl: '' });
  await dp.getPro('footer');
  assert.equal(d.log.panels.length, 0);
  assert.deepEqual(d.log.opened, ['https://github.com/sponsors/theluckystrike/sponsorships?tier_id=679878']);
  assert.ok(!('hexViewer.enterKey' in d.log.commands));
  // without proInfo the panel lists the proTools titles (no tries line)
  const e = fakeVscode();
  const ep = mk(e, { proInfo: null, proTools: ['Merge PDFs'] });
  await ep.getPro('footer');
  assert.ok(e.log.panels[0].webview.html.includes('Merge PDFs'));
  assert.ok(!e.log.panels[0].webview.html.includes('free tries left'));
});

test('the panel shows the tries left at each open', async () => {
  const f = fakeVscode();
  const pro = mk(f);
  await pro.getPro('toolbar');
  assert.ok(f.log.panels[0].webview.html.includes('1 free try left'));
  assert.ok(!f.log.panels[0].webview.html.includes('3 free tries left'));
  await f.context.globalState.update('hexViewer.proTrial', { checksums: 1 });
  await pro.getPro('toolbar');
  const h = f.log.panels[0].webview.html;
  assert.ok(h.includes('no free tries left'));
  assert.ok(h.includes('1 free try left'));
});

test('panel language follows vscode.env.language; tool names, lines and the command stay English', async () => {
  assert.equal(P.localeOf('de-DE'), 'de');
  assert.equal(P.localeOf('pt-br'), 'pt');
  assert.equal(P.localeOf('zh-cn'), 'zh');
  assert.equal(P.localeOf('zh-tw'), 'en');
  assert.equal(P.localeOf('ko'), 'en');
  assert.equal(P.localeOf(undefined), 'en');
  for (const lang of Object.keys(P.STRINGS)) {
    const T = P.STRINGS[lang];
    for (const k of ['price', 'team', 'toolsHead', 'toolsNone', 'keyHead', 'step1', 'step2', 'step3', 'keyNoCard', 'whoHead', 'seller', 'card', 'other', 'tries']) assert.ok(T[k], `${lang}.${k}`);
    const html = P.renderHtml({ product: 'Hex Viewer', tools: [{ title: 'Checksums of File', line: 'Computes hashes.', left: 2 }], nonce: 'n', lang });
    for (const want of ['USD 19', 'USD 59', 'BeLikeNative', 'Zovo Pro: Enter a key', 'Hex Viewer', 'Checksums of File', 'Computes hashes.', 'Copy key', 'Stripe', 'GitHub Sponsors, PayPal']) assert.ok(html.includes(want), `${lang}: ${want}`);
    assert.ok(!html.includes('{p}') && !html.includes('{c}'), lang);
    assert.equal((html.match(/<button /g) || []).length, 2, lang);
    for (const n of [0, 1, 2, 3]) assert.ok(T.tries(n).length > 3, `${lang} tries ${n}`);
  }
  assert.equal(P.triesText(1, 'ru'), 'осталась 1 бесплатная попытка');
  assert.equal(P.triesText(3, 'pl'), 'zostały 3 darmowe próby');
  assert.equal(P.triesText(2, 'de'), 'noch 2 Gratis-Versuche');
  const f = fakeVscode();
  f.vscode.env.language = 'fr';
  await mk(f).getPro('toolbar');
  const h = f.log.panels[0].webview.html;
  assert.ok(h.includes('<html lang="fr">'));
  assert.ok(h.includes('Payer par carte'));
  assert.ok(h.includes('USD 19 une seule fois, tous les visualiseurs Zovo, à vie.'));
  assert.ok(h.includes('Checksums of File'));
  await f.log.panels[0].send({ type: 'card' });
  assert.ok(refOfUrl(f.log.opened[0]).endsWith('_toolbar_hex'));
});
