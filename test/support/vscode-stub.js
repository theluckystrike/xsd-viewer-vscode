'use strict';
// A small stand-in for the vscode module (copied from the iCalendar Viewer tests, which copied the Texture Viewer tests): enough
// for activation, the custom editor provider, the content provider, the Pro tools and the license facade. Tests script
// dialogs through `ui` and read `log`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const TMP = [];
/** A temp folder that cleanup() removes. */
function tmpDir(prefix) { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TMP.push(d); return d; }
function cleanup() { for (const d of TMP.splice(0)) fs.rmSync(d, { recursive: true, force: true }); }

function create() {
  const log = { info: [], warn: [], error: [], status: [], opened: [], external: [], commands: [], posted: [], decorations: [], types: [], edits: [], saved: [], progress: [], clipboard: null };
  const ui = { open: [], save: [], input: [], quick: [], info: [], warn: [] };
  const commands = new Map();
  const providers = { color: [], hover: [], views: new Map(), actions: [], symbols: [], format: [], definition: [], completion: [] };
  const diags = new Map();
  const state = new Map();
  const config = { showProTools: true, showSupportLinks: true, askForRating: false };
  const listeners = { visible: [], active: [], change: [], config: [], save: [], selection: [], open: [], close: [] };
  class EventEmitter { constructor() { this.l = new Set(); this.event = (f) => { this.l.add(f); return { dispose: () => this.l.delete(f) }; }; } fire(v) { for (const f of this.l) f(v); } dispose() { this.l.clear(); } }
  class Uri {
    constructor(scheme, p) { this.scheme = scheme; this.path = p; this.fsPath = p; }
    static file(p) { return new Uri('file', path.resolve(p)); }
    static parse(s) { const u = new Uri(s.split(':')[0], s.replace(/^[a-z-]+:/, '')); u.str = s; return u; }
    static joinPath(u, ...parts) { return new Uri(u.scheme, path.join(u.path, ...parts)); }
    toString() { return this.str || `${this.scheme}://${this.path}`; }
    with(o) { const u = new Uri(this.scheme, (o && o.path) || this.path); return u; }
    static from(o) { const u = new Uri(o.scheme, o.path); u.query = o.query; u.str = `${o.scheme}:${o.path}?${o.query}`; return u; }
  }
  class Position { constructor(l, c) { this.line = l; this.character = c; } }
  class Range {
    constructor(a, b, c, d) { if (typeof a === 'object') { this.start = a; this.end = b; } else { this.start = new Position(a, b); this.end = new Position(c, d); } }
    isEqual(o) { return o && o.start.line === this.start.line && o.start.character === this.start.character && o.end.line === this.end.line && o.end.character === this.end.character; }
  }
  const lineStarts = (t) => { const s = [0]; for (let i = 0; i < t.length; i++) if (t[i] === '\n') s.push(i + 1); return s; };
  function makeDoc(uri, text, languageId) {
    const d = {
      uri, languageId, version: 1, isDirty: false, _text: text,
      getText() { return this._text; },
      offsetAt(p) { return lineStarts(this._text)[p.line] + p.character; },
      lineAt(l) { return { text: this._text.split('\n')[l] || '' }; },
      positionAt(o) { const s = lineStarts(this._text); let l = 0; while (l + 1 < s.length && s[l + 1] <= o) l++; return new Position(l, o - s[l]); },
      async save() { log.saved.push(this.uri.fsPath); if (this.uri.scheme === 'file') fs.writeFileSync(this.uri.fsPath, this._text); this.isDirty = false; return true; },
      _set(t) { this._text = t; this.version++; this.isDirty = true; },
    };
    return d;
  }
  function applyRangeEdits(doc, edits) {
    let t = doc._text;
    const offs = edits.map((e) => ({ s: doc.offsetAt(e.range.start), e: doc.offsetAt(e.range.end), text: e.text })).sort((a, b) => b.s - a.s);
    for (const o of offs) t = t.slice(0, o.s) + o.text + t.slice(o.e);
    doc._set(t);
  }
  function makeEditor(doc) {
    const ed = {
      document: doc, viewColumn: 1, selection: { active: new Position(0, 0), start: new Position(0, 0), end: new Position(0, 0), isEmpty: true }, decorations: new Map(),
      setDecorations(t, ranges) { ed.decorations.set(t, ranges); log.decorations.push({ t: t.id, n: ranges.length }); },
      async edit(cb) { const edits = []; cb({ replace: (range, text) => edits.push({ range, text }) }); applyRangeEdits(doc, edits); log.edits.push(edits); return true; },
      revealRange() {},
    };
    return ed;
  }
  let typeId = 0;
  const workspace = {
    workspaceFolders: undefined,
    textDocuments: [],
    getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d), update: async (k, v) => { config[k] = v; for (const f of listeners.config) f({ affectsConfiguration: () => true }); } }),
    onDidChangeConfiguration: (f) => { listeners.config.push(f); return { dispose() {} }; },
    onDidChangeTextDocument: (f) => { listeners.change.push(f); return { dispose() {} }; },
    onDidSaveTextDocument: (f) => { listeners.save.push(f); return { dispose() {} }; },
    onDidOpenTextDocument: (f) => { listeners.open.push(f); return { dispose() {} }; },
    onDidCloseTextDocument: (f) => { listeners.close.push(f); return { dispose() {} }; },
    createFileSystemWatcher: () => ({ onDidChange: () => ({ dispose() {} }), onDidCreate: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }), dispose() {} }),
    asRelativePath: (u) => (workspace.workspaceFolders ? path.relative(workspace.workspaceFolders[0].uri.fsPath, u.fsPath) : u.fsPath),
    findFiles: async (include) => {
      if (!workspace.workspaceFolders) return [];
      const root = workspace.workspaceFolders[0].uri.fsPath;
      const glob = typeof include === 'string' ? include : include.pattern;
      const toRe = (g) => new RegExp('^' + g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\{([^}]*)\}/g, (m, a) => `(${a.split(',').join('|')})`).replace(/\*\*\//g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?') + '$');
      const okRe = toRe(glob);
      const ok = { test: (name, rel) => okRe.test(rel) };
      const out = [];
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p); } else if (ok.test(e.name, path.relative(root, p))) out.push(Uri.file(p)); } };
      walk(root);
      return out.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    },
    fs: {
      stat: async (u) => { const st = fs.statSync(u.fsPath); return { size: st.size, type: st.isDirectory() ? 2 : 1 }; },
      readFile: async (u) => fs.readFileSync(u.fsPath),
      writeFile: async (u, b) => { fs.mkdirSync(path.dirname(u.fsPath), { recursive: true }); fs.writeFileSync(u.fsPath, b); },
      readDirectory: async (u) => fs.readdirSync(u.fsPath, { withFileTypes: true }).map((e) => [e.name, e.isDirectory() ? 2 : 1]),
      createDirectory: async (u) => { fs.mkdirSync(u.fsPath, { recursive: true }); },
      delete: async (u) => { fs.rmSync(u.fsPath, { recursive: true, force: true }); },
    },
    registerTextDocumentContentProvider: (scheme, p) => { providers.content = providers.content || new Map(); providers.content.set(scheme, p); return { dispose() {} }; },
    openTextDocument: async (o) => {
      if (o && o.scheme) {
        let d = workspace.textDocuments.find((x) => x.uri.toString() === o.toString());
        const cp = providers.content && providers.content.get(o.scheme);
        if (!d) { d = makeDoc(o, cp ? await cp.provideTextDocumentContent(o) : fs.readFileSync(o.fsPath, 'utf8'), langOf(o.fsPath)); workspace.textDocuments.push(d); }
        return d;
      }
      const d = makeDoc(Uri.parse(`untitled:Untitled-${workspace.textDocuments.length + 1}`), (o && o.content) || '', (o && o.language) || 'plaintext');
      workspace.textDocuments.push(d);
      return d;
    },
    applyEdit: async (we) => {
      for (const [k, edits] of we.map) {
        const uri = we.uris.get(k);
        let d = workspace.textDocuments.find((x) => x.uri.toString() === k);
        if (!d) { d = makeDoc(uri, fs.readFileSync(uri.fsPath, 'utf8'), langOf(uri.fsPath)); workspace.textDocuments.push(d); }
        applyRangeEdits(d, edits);
      }
      for (const [a, b] of we.renames || []) { fs.mkdirSync(path.dirname(b.fsPath), { recursive: true }); fs.renameSync(a.fsPath, b.fsPath); }
      log.edits.push(we);
      return true;
    },
    isTrusted: true,
  };
  const langOf = (p) => (/(^|\/)\.env(\.[^/]*)?$|\.env$/.test(p) ? 'dotenv' : null) || ({ '.css': 'css', '.scss': 'scss', '.less': 'less', '.html': 'html', '.kt': 'kotlin', '.dart': 'dart', '.swift': 'swift', '.ts': 'typescript', '.js': 'javascript', '.vue': 'vue' })[path.extname(p)] || 'plaintext';
  const msg = (kind, q) => async (text, ...rest) => {
    const opts = rest[0] && typeof rest[0] === 'object' && !Array.isArray(rest[0]) ? rest.shift() : {};
    log[kind].push({ text, opts, buttons: rest.map((b) => (typeof b === 'string' ? b : b.title)) });
    return q && q.length ? q.shift() : undefined;
  };
  const nextOf = (q, dflt) => (q.length ? q.shift() : dflt);
  const window = {
    state: { focused: true },
    visibleTextEditors: [],
    activeTextEditor: undefined,
    onDidChangeWindowState: () => ({ dispose() {} }),
    onDidChangeVisibleTextEditors: (f) => { listeners.visible.push(f); return { dispose() {} }; },
    onDidChangeTextEditorSelection: (f) => { listeners.selection.push(f); return { dispose() {} }; },
    createStatusBarItem: () => { const it = { text: '', shown: false, show() { it.shown = true; }, hide() { it.shown = false; }, dispose() {} }; log.statusItem = it; return it; },
    onDidChangeActiveTextEditor: (f) => { listeners.active.push(f); return { dispose() {} }; },
    createTextEditorDecorationType: (o) => { const t = { id: ++typeId, o, disposed: false, dispose() { this.disposed = true; } }; log.types.push(t); return t; },
    registerWebviewViewProvider: (id, p) => { providers.views.set(id, p); return { dispose() {} }; },
    registerUriHandler: () => ({ dispose() {} }),
    registerCustomEditorProvider: (id, p, o) => { providers.custom = { id, p, o }; return { dispose() {} }; },
    createWebviewPanel: (id, title) => {
      let onMsg;
      const panel = {
        id, title, visible: true, posted: [], disposeCbs: [],
        webview: { options: {}, html: '', cspSource: 'vscode-resource:', asWebviewUri: (u) => u, postMessage: async (m) => { panel.posted.push(m); log.posted.push(m); if (log.onPost) setTimeout(() => log.onPost(panel, m), 0); return true; }, onDidReceiveMessage: (f) => { onMsg = f; setTimeout(() => f({ type: 'ready' }), 0); return { dispose() {} }; } },
        onDidDispose: (f) => { panel.disposeCbs.push(f); return { dispose() {} }; }, reveal() {}, dispose() { panel.disposeCbs.forEach((f) => f()); },
        send: (m) => onMsg(m),
      };
      log.panel = panel;
      return panel;
    },
    showInformationMessage: msg('info', ui.info), showWarningMessage: msg('warn', ui.warn), showErrorMessage: msg('error'),
    setStatusBarMessage: (t) => { log.status.push(t); return { dispose() {} }; },
    showOpenDialog: async () => nextOf(ui.open, undefined),
    showSaveDialog: async () => nextOf(ui.save, undefined),
    showInputBox: async () => nextOf(ui.input, undefined),
    showQuickPick: async (items, opts) => { const f = nextOf(ui.quick, undefined); log.lastPick = { items: await items, opts }; return typeof f === 'function' ? f(await items) : f; },
    showTextDocument: async (d) => { log.opened.push(d); const ed = makeEditor(d.document || d); return ed; },
    withProgress: async (o, fn) => { log.progress.push(o.title); return fn({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }); },
    createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
  };
  class WorkspaceEdit { constructor() { this.map = new Map(); this.uris = new Map(); this.renames = []; } renameFile(a, b, o) { this.renames.push([a, b, o]); } replace(uri, range, text) { const k = uri.toString(); if (!this.map.has(k)) { this.map.set(k, []); this.uris.set(k, uri); } this.map.get(k).push({ range, text }); } }
  class MarkdownString { constructor(v = '') { this.value = v; } appendMarkdown(s) { this.value += s; return this; } }
  const vscode = {
    version: '1.90.2', EventEmitter, Uri, Range, Position, WorkspaceEdit, MarkdownString,
    Selection: class { constructor(a, b) { this.anchor = a; this.active = b; this.start = a; this.end = b; this.isEmpty = a.line === b.line && a.character === b.character; } },
    Color: class { constructor(r, g, b, a) { Object.assign(this, { red: r, green: g, blue: b, alpha: a }); } },
    ColorInformation: class { constructor(range, color) { Object.assign(this, { range, color }); } },
    ColorPresentation: class { constructor(label) { this.label = label; } },
    TextEdit: Object.assign(class { constructor(range, newText) { Object.assign(this, { range, newText }); } }, { replace: (range, newText) => ({ range, newText }) }),
    Hover: class { constructor(contents, range) { Object.assign(this, { contents, range }); } },
    ThemeColor: class { constructor(id) { this.id = id; } },
    StatusBarAlignment: { Left: 1, Right: 2 },
    Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    CodeAction: class { constructor(title, kind) { Object.assign(this, { title, kind }); } },
    CodeActionKind: { QuickFix: 'quickfix' },
    DocumentSymbol: class { constructor(name, detail, kind, range, selectionRange) { Object.assign(this, { name, detail, kind, range, selectionRange }); } },
    SymbolKind: { Constant: 13, Variable: 12 },
    Location: class { constructor(uri, pos) { Object.assign(this, { uri, pos }); } },
    CompletionItem: class { constructor(label, kind) { Object.assign(this, { label, kind }); } },
    CompletionItemKind: { Variable: 5 },
    RelativePattern: class { constructor(base, pattern) { Object.assign(this, { base, pattern }); } },
    DecorationRangeBehavior: { ClosedClosed: 1 },
    TextEditorRevealType: { InCenter: 2, InCenterIfOutsideViewport: 2 },
    ConfigurationTarget: { Global: 1 },
    ViewColumn: { Beside: -2, Active: -1, One: 1 },
    ProgressLocation: { Notification: 15, Window: 10 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    FileType: { File: 1, Directory: 2 },
    env: { appName: 'Visual Studio Code', uriScheme: 'vscode', machineId: 'test', clipboard: { writeText: async (t) => { log.clipboard = t; }, readText: async () => '' }, openExternal: async (u) => { log.external.push(String(u)); return true; }, asExternalUri: async (u) => u },
    workspace, window,
    languages: {
      createDiagnosticCollection: () => ({ set: (u, d) => diags.set(String(u), d), get: (u) => diags.get(String(u)), delete: (u) => diags.delete(String(u)), clear: () => diags.clear(), dispose() {} }),
      registerCodeActionsProvider: (sel, p) => { providers.actions.push(p); return { dispose() {} }; },
      registerDocumentSymbolProvider: (sel, p) => { providers.symbols.push(p); return { dispose() {} }; },
      registerDocumentFormattingEditProvider: (sel, p) => { providers.format.push(p); return { dispose() {} }; },
      registerDefinitionProvider: (sel, p) => { providers.definition.push(p); return { dispose() {} }; },
      registerCompletionItemProvider: (sel, p) => { providers.completion.push(p); return { dispose() {} }; },
      registerColorProvider: (sel, p) => { providers.color.push(p); return { dispose() {} }; },
      registerHoverProvider: (sel, p) => { providers.hover.push(p); return { dispose() {} }; },
      setTextDocumentLanguage: async (d, l) => { d.languageId = l; return d; },
    },
    commands: {
      registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; },
      executeCommand: async (id, ...a) => { log.commands.push([id, ...a]); if (commands.has(id)) return commands.get(id)(...a); return undefined; },
    },
    extensions: { all: [], getExtension: () => undefined, onDidChange: () => ({ dispose() {} }) },
    authentication: { getSession: async () => undefined, onDidChangeSessions: () => ({ dispose() {} }) },
    l10n: { t: (s) => s },
  };
  const secrets = new Map();
  const context = {
    subscriptions: [],
    extensionUri: Uri.file(path.join(__dirname, '..', '..')),
    extensionPath: path.join(__dirname, '..', '..'),
    globalStorageUri: Uri.file(tmpDir('xsd-gs-')),
    globalState: { get: (k, d) => (state.has(k) ? state.get(k) : d), update: async (k, v) => { state.set(k, v); }, keys: () => [...state.keys()], setKeysForSync() {} },
    workspaceState: { get: (k, d) => d, update: async () => {}, keys: () => [] },
    secrets: { get: async (k) => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async (k) => { secrets.delete(k); }, onDidChange: () => ({ dispose() {} }) },
  };
  /** Opens text as a visible, active editor and fires the visible-editors event. */
  function show(text, languageId = 'css', file) {
    const uri = file ? Uri.file(file) : Uri.parse(`untitled:t${workspace.textDocuments.length}.${languageId}`);
    const doc = makeDoc(uri, text, languageId);
    workspace.textDocuments.push(doc);
    const ed = makeEditor(doc);
    window.visibleTextEditors = [ed];
    window.activeTextEditor = ed;
    for (const f of listeners.visible) f(window.visibleTextEditors);
    return ed;
  }
  return { vscode, context, log, ui, commands, providers, state, config, listeners, show, makeDoc, makeEditor, diags };
}

/** Load src/extension.js with a fresh stub; returns the stub and the module. */
function loadExtension() {
  const stub = create();
  const orig = Module._load;
  Module._load = function (req, parent, isMain) { if (req === 'vscode') return stub.vscode; return orig.call(this, req, parent, isMain); };
  const root = path.join(__dirname, '..', '..', 'src');
  for (const k of Object.keys(require.cache)) if (k.startsWith(root)) delete require.cache[k];
  stub.ext = require(path.join(root, 'extension.js'));
  stub.restore = () => { Module._load = orig; };
  return stub;
}

module.exports = { create, loadExtension, tmpDir, cleanup };
