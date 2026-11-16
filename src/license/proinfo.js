'use strict';
// PROINFO (wave18 lane PROMOD, 13 Nov 2026): the Zovo Pro info panel and the per-listing checkout tag.
//
// Why: 6 real checkouts, all from in-editor buttons, 0 of 6 reached the email field on Stripe. The buyer left between
// "opened Stripe" and "typed an email", so the editor now says what they buy, what it costs, how the key arrives and
// who the seller on the card page is, BEFORE the browser opens.
//
// - showInfo(...) opens ONE VS Code webview panel (editor tab), only from a user's click on Get Zovo Pro (toolbar row,
//   Pro panel, right-click entry, tool pick, palette, footer). Never on open, never a popup or a toast. A second click
//   reveals the same panel. It lists the Pro tools of this listing with one line each and the free tries left, the
//   price, the team price, how the key arrives, the seller name, and two buttons: "Pay by card" and "Other ways
//   (GitHub Sponsors, PayPal)". No network, no remote content: strict CSP, inline style and script by nonce only.
// - refOf(installId, surface, listing) = <install id>_<surface>_<listing>, so kpi_fetch.py can count checkouts per
//   listing. The listing short id is [a-z0-9]{1,16} (config.js "listing", written by apply.sh). Without it the
//   CARD2 tag <install id>_<surface> stays.
// Pure helpers are exported for the unit tests (test/proinfo.test.js).

const PROINFO_VERSION = '2026-11-13.proinfo'; // unchanged API; OFFER (2026-11-14) changed only the English price and key steps
const VIEW_TYPE = 'zovoProInfo';
const LISTING_RE = /^[a-z0-9]{1,16}$/;
const REF_RE = /^[A-Za-z0-9_-]{1,199}$/;
const SELLER = 'BeLikeNative';
const CARD_BUTTON = 'Pay by card';
const OTHER_BUTTON = 'Other ways (GitHub Sponsors, PayPal)';
const ENTER_KEY_COMMAND = 'Zovo Pro: Enter a key';
const MAX_TOOLS = 12;
const MAX_TEXT = 200;

function listingOf(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return LISTING_RE.test(s) ? s : '';
}

// <install id>_<surface>_<listing>; falls back to <id>_<surface>, then <id>, when a part would break REF_RE.
function refOf(id, surface, listing) {
  const l = listingOf(listing);
  const tries = [l ? `${id}_${surface}_${l}` : '', `${id}_${surface}`, String(id)];
  for (const t of tries) if (t && REF_RE.test(t)) return t;
  return '';
}

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '');

// info = { triesKey, tools: [{ id, title, line }] } (config.js pro_info or the createLicense option proInfo).
// proTools = plain titles (older products) when there is no info. Returns [{ id, title, line, left }]; left is a
// number only when a tries key and a tool id are known, else null.
// TRIES1: maximum = info.triesMax when the listing sets it, else TRIES_MAX (1 free try per Pro tool since 15 Nov).
const TRIES_MAX = 1;
function triesMaxOf(info) {
  const m = info && Number(info.triesMax);
  return Number.isInteger(m) && m >= 1 && m <= 99 ? m : TRIES_MAX;
}
function toolsWithTries(info, globalState, proTools = [], maximum = triesMaxOf(info)) {
  const list = info && Array.isArray(info.tools) && info.tools.length
    ? info.tools.map((t) => ({ id: clean(t && t.id), title: clean(t && t.title), line: clean(t && t.line) }))
    : (Array.isArray(proTools) ? proTools : []).map((t) => ({ id: '', title: clean(t), line: '' }));
  let used = {};
  const key = info && typeof info.triesKey === 'string' ? info.triesKey : '';
  if (key && globalState && typeof globalState.get === 'function') {
    const v = globalState.get(key);
    if (v && typeof v === 'object') used = v;
  }
  return list.filter((t) => t.title).slice(0, MAX_TOOLS).map((t) => ({
    ...t,
    left: key && t.id ? Math.max(0, maximum - (Number(used[t.id]) || 0)) : null,
  }));
}

// Panel text per VS Code display language (vscode.env.language). Tool titles, tool lines, product and command names
// stay English. Wording checked by lane PROMOD from the Hermes drafts out/HPRO/1-4.md (13 Nov), fixed where they
// were wrong or mixed English in. {p} = product, {c} = the Enter a key command. P = price values.
const slav = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const STRINGS = {
  en: {
    price: (P) => `One key turns on Pro in every Zovo extension, for life. USD ${P.one} once.`, // OFFER: WHY1 value line
    team: (P) => `Team: ${P.seats} seats USD ${P.team}. Everything that is free today stays free.`,
    toolsHead: 'Pro tools in {p}', toolsNone: 'The tools marked Pro in this extension.',
    keyHead: 'How the key arrives',
    step1: 'Pay on the Stripe card page. No account needed.',
    step2: 'Your key shows on the next page. Click Open in VS Code and Pro turns on.',
    step3: 'Or click Copy key, then run {c} from the Command Palette. The key turns Pro on in every Zovo extension on this computer.',
    keyNoCard: 'After you pay, run {c} from the Command Palette and paste your key.',
    whoHead: 'Who you pay', seller: (S) => `Made by Zovo. The seller name on the card page is ${S}.`,
    card: 'Pay by card', other: 'Other ways (GitHub Sponsors, PayPal)',
    tries: (n) => (n === 0 ? 'no free tries left' : `${n} free ${n === 1 ? 'try' : 'tries'} left`),
  },
  de: {
    price: (P) => `Einmal USD ${P.one}, alle Zovo Viewer, für immer.`,
    team: (P) => `Team: ${P.seats} Plätze USD ${P.team}. Alles, was heute kostenlos ist, bleibt kostenlos.`,
    toolsHead: 'Pro-Tools in {p}', toolsNone: 'Die als Pro markierten Tools dieser Erweiterung.',
    keyHead: 'So kommt der Schlüssel',
    step1: 'Bezahlen Sie auf der Stripe-Kartenseite. Kein Konto nötig.',
    step2: 'Der Schlüssel erscheint auf der Stripe-Erfolgsseite. Klicken Sie auf Copy key.',
    step3: 'Führen Sie in VS Code {c} aus der Befehlspalette aus. Der Schlüssel schaltet Pro in allen Zovo-Erweiterungen auf diesem Computer frei.',
    keyNoCard: 'Führen Sie nach dem Bezahlen {c} aus der Befehlspalette aus und fügen Sie Ihren Schlüssel ein.',
    whoHead: 'Wen Sie bezahlen', seller: (S) => `Made by Zovo. Der Verkäufername auf der Kartenseite ist ${S}.`,
    card: 'Mit Karte zahlen', other: 'Andere Wege (GitHub Sponsors, PayPal)',
    tries: (n) => (n === 0 ? 'keine Gratis-Versuche mehr' : `noch ${n} ${n === 1 ? 'Gratis-Versuch' : 'Gratis-Versuche'}`),
  },
  fr: {
    price: (P) => `USD ${P.one} une seule fois, tous les visualiseurs Zovo, à vie.`,
    team: (P) => `Équipe : ${P.seats} places, USD ${P.team}. Tout ce qui est gratuit aujourd'hui reste gratuit.`,
    toolsHead: 'Outils Pro dans {p}', toolsNone: 'Les outils marqués Pro dans cette extension.',
    keyHead: 'Comment arrive la clé',
    step1: 'Payez sur la page de carte Stripe. Aucun compte requis.',
    step2: 'La clé s\'affiche sur la page de confirmation Stripe. Cliquez sur Copy key.',
    step3: 'De retour dans VS Code, lancez {c} depuis la palette de commandes. La clé active Pro dans toutes les extensions Zovo de cet ordinateur.',
    keyNoCard: 'Après le paiement, lancez {c} depuis la palette de commandes et collez votre clé.',
    whoHead: 'Qui vous payez', seller: (S) => `Made by Zovo. Le nom du vendeur sur la page de paiement est ${S}.`,
    card: 'Payer par carte', other: 'Autres moyens (GitHub Sponsors, PayPal)',
    tries: (n) => (n === 0 ? 'plus d\'essai gratuit' : `encore ${n} ${n === 1 ? 'essai gratuit' : 'essais gratuits'}`),
  },
  es: {
    price: (P) => `USD ${P.one} una sola vez, todos los visores Zovo, para siempre.`,
    team: (P) => `Equipo: ${P.seats} puestos, USD ${P.team}. Todo lo que hoy es gratis sigue siendo gratis.`,
    toolsHead: 'Herramientas Pro en {p}', toolsNone: 'Las herramientas marcadas como Pro en esta extensión.',
    keyHead: 'Cómo llega la clave',
    step1: 'Paga en la página de tarjeta de Stripe. No necesitas cuenta.',
    step2: 'La clave aparece en la página de confirmación de Stripe. Pulsa Copy key.',
    step3: 'De vuelta en VS Code, ejecuta {c} desde la paleta de comandos. La clave activa Pro en todas las extensiones Zovo de este equipo.',
    keyNoCard: 'Después de pagar, ejecuta {c} desde la paleta de comandos y pega tu clave.',
    whoHead: 'A quién pagas', seller: (S) => `Hecho por Zovo. El nombre del vendedor en la página de pago es ${S}.`,
    card: 'Pagar con tarjeta', other: 'Otras formas (GitHub Sponsors, PayPal)',
    tries: (n) => (n === 0 ? 'sin intentos gratis' : n === 1 ? 'queda 1 intento gratis' : `quedan ${n} intentos gratis`),
  },
  pt: {
    price: (P) => `USD ${P.one} uma única vez, todos os visualizadores Zovo, para sempre.`,
    team: (P) => `Equipe: ${P.seats} lugares, USD ${P.team}. Tudo o que é grátis hoje continua grátis.`,
    toolsHead: 'Ferramentas Pro em {p}', toolsNone: 'As ferramentas marcadas como Pro nesta extensão.',
    keyHead: 'Como a chave chega',
    step1: 'Pague na página de cartão do Stripe. Não precisa de conta.',
    step2: 'A chave aparece na página de confirmação do Stripe. Clique em Copy key.',
    step3: 'De volta ao VS Code, execute {c} pela paleta de comandos. A chave ativa o Pro em todas as extensões Zovo deste computador.',
    keyNoCard: 'Depois de pagar, execute {c} pela paleta de comandos e cole sua chave.',
    whoHead: 'Para quem você paga', seller: (S) => `Feito pela Zovo. O nome do vendedor na página de pagamento é ${S}.`,
    card: 'Pagar com cartão', other: 'Outras formas (GitHub Sponsors, PayPal)',
    tries: (n) => (n === 0 ? 'sem tentativas grátis' : n === 1 ? 'resta 1 tentativa grátis' : `restam ${n} tentativas grátis`),
  },
  ja: {
    price: (P) => `USD ${P.one} の一回払いで、すべての Zovo ビューアーをずっと使えます。`,
    team: (P) => `チーム: ${P.seats} 席で USD ${P.team}。今無料の機能はこれからも無料です。`,
    toolsHead: '{p} の Pro ツール', toolsNone: 'この拡張機能で Pro と表示されているツール。',
    keyHead: 'キーの受け取り方',
    step1: 'Stripe のカード決済ページで支払います。アカウントは不要です。',
    step2: 'Stripe の支払い完了ページにキーが表示されます。Copy key をクリックします。',
    step3: 'VS Code に戻り、コマンドパレットから {c} を実行します。このコンピューターのすべての Zovo 拡張機能で Pro が有効になります。',
    keyNoCard: '支払い後、コマンドパレットから {c} を実行してキーを貼り付けます。',
    whoHead: '支払い先', seller: (S) => `開発元は Zovo です。カード決済ページの販売者名は ${S} と表示されます。`,
    card: 'カードで支払う', other: 'その他の方法 (GitHub Sponsors, PayPal)',
    tries: (n) => (n === 0 ? '無料のお試しは残っていません' : `無料のお試し残り ${n} 回`),
  },
  zh: {
    price: (P) => `USD ${P.one} 一次付费，所有 Zovo 查看器，终身可用。`,
    team: (P) => `团队：${P.seats} 个席位 USD ${P.team}。现在免费的功能以后仍然免费。`,
    toolsHead: '{p} 中的 Pro 工具', toolsNone: '此扩展中标为 Pro 的工具。',
    keyHead: '如何获得密钥',
    step1: '在 Stripe 银行卡付款页面付款，无需注册账号。',
    step2: 'Stripe 付款成功页面会显示密钥。点击 Copy key。',
    step3: '回到 VS Code，在命令面板中运行 {c}。这台电脑上的所有 Zovo 扩展都会启用 Pro。',
    keyNoCard: '付款后，在命令面板中运行 {c} 并粘贴密钥。',
    whoHead: '收款方', seller: (S) => `由 Zovo 开发。银行卡付款页面上显示的卖家名称是 ${S}。`,
    card: '用银行卡付款', other: '其他方式 (GitHub Sponsors, PayPal)',
    tries: (n) => (n === 0 ? '免费试用次数已用完' : `还剩 ${n} 次免费试用`),
  },
  pl: {
    price: (P) => `USD ${P.one} jednorazowo, wszystkie przeglądarki Zovo, na zawsze.`,
    team: (P) => `Zespół: ${P.seats} stanowisk, USD ${P.team}. Wszystko, co dziś jest darmowe, zostaje darmowe.`,
    toolsHead: 'Narzędzia Pro w {p}', toolsNone: 'Narzędzia oznaczone jako Pro w tym rozszerzeniu.',
    keyHead: 'Jak dostaniesz klucz',
    step1: 'Zapłać kartą na stronie płatności Stripe. Konto nie jest potrzebne.',
    step2: 'Klucz pojawi się na stronie potwierdzenia Stripe. Kliknij Copy key.',
    step3: 'Wróć do VS Code i uruchom {c} z palety poleceń. Klucz włącza Pro we wszystkich rozszerzeniach Zovo na tym komputerze.',
    keyNoCard: 'Po zapłacie uruchom {c} z palety poleceń i wklej klucz.',
    whoHead: 'Komu płacisz', seller: (S) => `Twórca: Zovo. Sprzedawca widoczny na stronie płatności to ${S}.`,
    card: 'Zapłać kartą', other: 'Inne sposoby (GitHub Sponsors, PayPal)',
    tries: (n) => (n === 0 ? 'nie ma już darmowych prób' : slav(n, 'została 1 darmowa próba', `zostały ${n} darmowe próby`, `zostało ${n} darmowych prób`)),
  },
  ru: {
    price: (P) => `USD ${P.one} один раз, все просмотрщики Zovo, навсегда.`,
    team: (P) => `Команда: ${P.seats} мест, USD ${P.team}. Всё, что бесплатно сейчас, останется бесплатным.`,
    toolsHead: 'Pro-инструменты в {p}', toolsNone: 'Инструменты этого расширения, отмеченные как Pro.',
    keyHead: 'Как приходит ключ',
    step1: 'Оплатите картой на странице оплаты Stripe. Аккаунт не нужен.',
    step2: 'Ключ появится на странице подтверждения Stripe. Нажмите Copy key.',
    step3: 'Вернитесь в VS Code и выполните {c} из палитры команд. Ключ включает Pro во всех расширениях Zovo на этом компьютере.',
    keyNoCard: 'После оплаты выполните {c} из палитры команд и вставьте ключ.',
    whoHead: 'Кому вы платите', seller: (S) => `Разработчик: Zovo. Продавец на странице оплаты: ${S}.`,
    card: 'Оплатить картой', other: 'Другие способы (GitHub Sponsors, PayPal)',
    tries: (n) => (n === 0 ? 'бесплатные попытки закончились' : slav(n, 'осталась 1 бесплатная попытка', `осталось ${n} бесплатные попытки`, `осталось ${n} бесплатных попыток`)),
  },
};
// 'de-DE' -> de, 'pt-br' -> pt, 'zh-cn' -> zh (Simplified only; zh-tw and zh-hk stay English), else en.
function localeOf(language) {
  const l = typeof language === 'string' ? language.trim().toLowerCase() : '';
  if (/^zh-(tw|hk|hant)/.test(l)) return 'en';
  const base = l.split(/[-_]/)[0];
  return STRINGS[base] ? base : 'en';
}

function triesText(left, lang = 'en') {
  if (left === null || left === undefined) return '';
  const n = Math.max(0, Number(left) || 0);
  return (STRINGS[lang] || STRINGS.en).tries(n);
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// The panel page. product = the listing's name ("Hex Viewer"); price = { one, team, seats }; extensions = count.
function renderHtml({ product = 'this extension', tools = [], price = { one: 19, team: 59, seats: 5 }, nonce = '', cspSource = '', cardOn = true, trust = '', lang = 'en' } = {}) {
  const L = STRINGS[lang] ? lang : 'en';
  const T = STRINGS[L];
  const cmd = `<code>${esc(ENTER_KEY_COMMAND)}</code>`;
  const fill = (s) => esc(s).replace('{p}', esc(product)).replace('{c}', cmd);
  const rows = tools.map((t) => {
    const tries = triesText(t.left, L);
    return `<li><b>${esc(t.title)}</b>${t.line ? `<span class="line">${esc(t.line)}</span>` : ''}${tries ? `<span class="tries${t.left === 0 ? ' out' : ''}">${esc(tries)}</span>` : ''}</li>`;
  }).join('');
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'${cspSource ? `; img-src ${cspSource}` : ''}`;
  const css = 'body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);'
    + 'max-width:620px;margin:0 auto;padding:18px 20px 30px;line-height:1.5}h1{font-size:1.5em;margin:0 0 4px}'
    + 'h2{font-size:1.1em;margin:22px 0 6px}.price{font-size:1.15em;margin:0 0 4px}.mut{color:var(--vscode-descriptionForeground)}'
    + 'ul{padding-left:18px;margin:6px 0}li{margin:7px 0}li .line{display:block}li .tries{display:block;color:var(--vscode-descriptionForeground);font-size:.92em}'
    + 'li .tries.out{color:var(--vscode-errorForeground)}ol{padding-left:20px;margin:6px 0}ol li{margin:4px 0}'
    + '.btns{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 8px}button{font:inherit;padding:7px 14px;border-radius:2px;cursor:pointer;'
    + 'border:1px solid var(--vscode-button-border,transparent)}button.pri{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}'
    + 'button.pri:hover{background:var(--vscode-button-hoverBackground)}button.sec{background:var(--vscode-button-secondaryBackground);'
    + 'color:var(--vscode-button-secondaryForeground)}button.sec:hover{background:var(--vscode-button-secondaryHoverBackground)}'
    + 'button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}code{font-family:var(--vscode-editor-font-family)}';
  const P = { one: Number(price.one) || 0, team: Number(price.team) || 0, seats: Number(price.seats) || 0 };
  const toolsBlock = `<h2>${fill(T.toolsHead)}</h2>` + (rows ? `<ul>${rows}</ul>` : `<p>${fill(T.toolsNone)}</p>`);
  const keySteps = cardOn
    ? `<ol><li>${fill(T.step1)}</li><li>${fill(T.step2)}</li><li>${fill(T.step3)}</li></ol>`
    : `<p>${fill(T.keyNoCard)}</p>`;
  // OFFER (WHY1, 12:45 note): the buttons come right under the price, so Pay is above the fold at 1400x900.
  const body = `<h1>Zovo Pro</h1>`
    + `<p class="price">${esc(T.price(P))}</p>`
    + `<p class="mut">${esc(T.team(P))}</p>`
    + `<div class="btns">${cardOn ? `<button class="pri" id="card" type="button">${esc(T.card)}</button>` : ''}`
    + `<button class="${cardOn ? 'sec' : 'pri'}" id="other" type="button">${esc(T.other)}</button></div>`
    + (trust ? `<p class="mut">${esc(trust)}</p>` : '')
    + toolsBlock
    + `<h2>${fill(T.keyHead)}</h2>${keySteps}`
    + `<h2>${fill(T.whoHead)}</h2><p>${esc(T.seller(SELLER))}</p>`;
  const script = `(function(){const api=acquireVsCodeApi();for(const id of ['card','other']){const b=document.getElementById(id);`
    + `if(b)b.addEventListener('click',function(){api.postMessage({type:id});});}})();`;
  return `<!DOCTYPE html><html lang="${esc(L === 'zh' ? 'zh-Hans' : L)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(csp)}">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Zovo Pro</title><style nonce="${esc(nonce)}">${css}</style></head>`
    + `<body>${body}<script nonce="${esc(nonce)}">${script}</script></body></html>`;
}

function makeNonce(crypto) {
  return crypto.randomBytes(16).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 22) || 'zovo';
}

// The panel controller, one per createLicense. available() is false when the VS Code API has no webview panels (old
// test fakes): the caller then keeps the CARD2 pick.
// show({ surface }) opens or reveals the panel; the buttons call onCard(surface) / onOther(surface) with the surface
// of the LAST click that opened it.
function createInfoPanel({ vscode, context, crypto, product, info, proTools, price, cardOn, trust, onCard, onOther }) {
  let panel = null;
  let surface = 'palette';
  const available = () => !!(vscode && vscode.window && typeof vscode.window.createWebviewPanel === 'function');
  const page = () => renderHtml({
    product,
    tools: toolsWithTries(typeof info === 'function' ? info() : info, context && context.globalState, proTools),
    price,
    nonce: makeNonce(crypto),
    cspSource: panel && panel.webview && panel.webview.cspSource,
    cardOn: cardOn(),
    trust: trust(),
    lang: localeOf(vscode && vscode.env && vscode.env.language),
  });
  function show(opts = {}) {
    surface = opts.surface || 'palette';
    if (panel) {
      panel.webview.html = page(); // the tries may have changed since the last open
      if (typeof panel.reveal === 'function') panel.reveal();
      return panel;
    }
    const column = (vscode.ViewColumn && (vscode.ViewColumn.Active || vscode.ViewColumn.One)) || 1;
    panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Zovo Pro', column, { enableScripts: true, enableCommandUris: false, localResourceRoots: [], retainContextWhenHidden: false });
    panel.webview.html = page();
    const subs = [];
    subs.push(panel.webview.onDidReceiveMessage((m) => {
      const type = m && typeof m === 'object' ? m.type : '';
      if (type === 'card' && cardOn()) return onCard(surface);
      if (type === 'other') return onOther(surface);
      return undefined;
    }));
    subs.push(panel.onDidDispose(() => { for (const s of subs) { try { s.dispose(); } catch (e) { /* gone */ } } panel = null; }));
    if (context && Array.isArray(context.subscriptions)) context.subscriptions.push(panel); // closed on deactivate
    return panel;
  }
  return { available, show, get panel() { return panel; }, get surface() { return surface; } };
}

module.exports = {
  PROINFO_VERSION, VIEW_TYPE, LISTING_RE, SELLER, CARD_BUTTON, OTHER_BUTTON, ENTER_KEY_COMMAND,
  listingOf, refOf, toolsWithTries, triesText, TRIES_MAX, triesMaxOf, renderHtml, createInfoPanel, localeOf, STRINGS,
};
