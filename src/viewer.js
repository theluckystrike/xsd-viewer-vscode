'use strict';
// The XSD Viewer: a custom text editor, so the schema stays a normal VS Code text document and the viewer redraws when
// the text changes (also when it is edited in a text editor next to it). It is registered with priority "option":
// .xsd and .wsdl files keep opening as text, and the viewer opens through Open in XSD Viewer (title bar, Explorer,
// Command Palette) or Reopen Editor With. The viewer never writes the file.
const vscode = require('vscode');
const { SchemaSet, baseName, BUILTIN_XML_URL } = require('./core/schema');
const { Model } = require('./core/model');
const { viewerHtml } = require('./html');
const support = require('./support');

const VIEW_TYPE = 'xsdViewer.viewer';
const PREFIX = 'xsdViewer';

/** A display path for a file URL: relative to the workspace when it is inside it. */
function displayPath(url) {
  if (url === BUILTIN_XML_URL) return 'xml.xsd (built in)';
  try {
    const u = vscode.Uri.parse(url);
    const r = vscode.workspace.asRelativePath(u, false);
    return r || baseName(url);
  } catch (e) { return baseName(url); }
}

/** Loads the schema set of a document: { set, model, root, error }. */
async function loadSet(io, uri) {
  const set = new SchemaSet(io);
  await set.load(uri.toString());
  const root = set.files.get(set.root);
  return { set, model: new Model(set), root, error: root && root.error ? root.error : null };
}

class XsdViewerProvider {
  constructor(ctx, hooks) {
    this.ctx = ctx;
    this.hooks = hooks; // { io, rating, reach, isSample(uri) }
    this.sessions = new Map();
    this.lastActive = null;
  }

  html(webview) {
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
    const reach = this.hooks.reach;
    return viewerHtml({
      cspSource: webview.cspSource,
      media: (name) => webview.asWebviewUri(vscode.Uri.joinPath(media, ...name.split('/'))).toString(),
      title: 'XSD', showSupportLinks: support.showLinks(vscode, PREFIX),
      head: reach ? (n) => reach.headHtml(n) : undefined,
    });
  }

  webviewOptions() {
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
    const reach = this.hooks.reach;
    return { enableScripts: true, enableCommandUris: [...new Set([...support.commandUris(PREFIX), ...(reach ? reach.commandIds() : [])])], localResourceRoots: [media] };
  }

  async resolveCustomTextEditor(document, panel) {
    const key = document.uri.toString();
    const s = { document, panel, data: null, gen: 0, timer: null, counted: false, ready: null, readyResolve: null, loaded: null, loadedResolve: null, selected: null };
    s.ready = new Promise((r) => { s.readyResolve = r; });
    s.loaded = new Promise((r) => { s.loadedResolve = r; });
    this.sessions.set(key, s);
    this.lastActive = s;
    const wv = panel.webview;
    wv.options = this.webviewOptions();
    wv.html = this.html(wv);
    const reach = this.hooks.reach;
    const subs = [];
    if (reach) subs.push(reach.attach(wv, panel));
    s.post = (m) => { try { const p = wv.postMessage(m); return p && p.then ? p.then(undefined, () => false) : Promise.resolve(true); } catch (e) { return Promise.resolve(false); } };

    subs.push(wv.onDidReceiveMessage((m) => this.onMessage(s, m)));
    subs.push(vscode.workspace.onDidChangeTextDocument((e) => {
      if (!s.data || !e.contentChanges.length) return;
      const k = e.document.uri.toString();
      if (k === key || s.data.set.files.has(k)) this.schedule(s);
    }));
    subs.push(vscode.workspace.onDidSaveTextDocument((d) => { if (s.data && d.uri.toString() !== key && s.data.set.files.has(d.uri.toString())) this.schedule(s); }));
    if (panel.onDidChangeViewState) subs.push(panel.onDidChangeViewState(() => { if (panel.active) this.lastActive = s; if (panel.visible && reach) reach.refresh(); }));
    panel.onDidDispose(() => {
      clearTimeout(s.timer);
      for (const d of subs) { try { d.dispose(); } catch (e) { /* gone */ } }
      if (this.sessions.get(key) === s) this.sessions.delete(key);
      if (this.lastActive === s) this.lastActive = null;
    });
  }

  schedule(s) { clearTimeout(s.timer); s.timer = setTimeout(() => this.load(s), 350); }

  async load(s) {
    const gen = ++s.gen;
    let d;
    try { d = await loadSet(this.hooks.io, s.document.uri); } catch (e) { d = { error: { message: String((e && e.message) || e), line: 0, col: 0 } }; }
    if (gen !== s.gen) return;
    if (d.error) {
      s.data = d.set ? d : null;
      s.post({ type: 'error', name: baseName(s.document.uri.path), message: d.error.message, line: d.error.line, col: d.error.col, notSchema: !!d.error.notSchema });
      if (!s.counted) { s.counted = true; if (this.hooks.rating) this.hooks.rating.failure(); }
      s.loadedResolve({ error: d.error.message });
      return;
    }
    s.data = d;
    const rootUrl = d.set.root;
    const index = d.model.index(rootUrl);
    const nsList = [...new Set(index.map((i) => i.ns))];
    const nsIdx = new Map(nsList.map((n, i) => [n, i]));
    const items = index.map((i) => ({ k: i.k, n: i.n, s: nsIdx.get(i.ns), f: i.f, l: i.l, own: i.own ? 1 : 0, key: i.key, ...(i.own && i.doc ? { d: i.doc } : {}) }));
    const files = d.set.fileList().map((f) => ({ ...f, path: displayPath(f.url), refs: f.refs.map((r) => ({ ...r, path: r.url ? displayPath(r.url) : '' })) }));
    const fileNames = d.model.fileList.map((u) => displayPath(u));
    const own = d.set.counts(rootUrl);
    const all = d.set.counts();
    const rootRec = d.root;
    const problems = d.set.problems();
    s.post({
      type: 'load', gen, name: baseName(s.document.uri.path), kind: rootRec.kind, schemas: rootRec.schemas.length,
      items, nsList, files, fileNames, own, all, problems: problems.slice(0, 200), problemCount: problems.length,
      select: s.selected,
    });
    if (!s.counted) {
      s.counted = true;
      if (this.hooks.rating && !(this.hooks.isSample && this.hooks.isSample(s.document.uri))) this.hooks.rating.success(s.document.uri);
    }
    s.loadedResolve({ ok: true, items: items.length, files: files.length });
  }

  async onMessage(s, m) {
    const reach = this.hooks.reach;
    if (reach && reach.onMessage(m)) return;
    if (!m || typeof m !== 'object') return;
    try {
      switch (m.type) {
        case 'ready': s.readyResolve(); await this.load(s); break;
        case 'node': {
          if (!s.data || !s.data.model) return;
          const comp = this.compByKey(s.data.set, m.key);
          if (!m.peek) s.selected = m.key;
          if (!comp) { s.post({ type: 'node', reqId: m.reqId, node: null }); return; }
          s.post({ type: 'node', reqId: m.reqId, key: m.key, node: s.data.model.componentNode(comp) });
          break;
        }
        case 'children': {
          if (!s.data || !s.data.model) return;
          s.post({ type: 'children', reqId: m.reqId, nodes: s.data.model.childrenOf(m.ck) });
          break;
        }
        case 'reveal': await this.reveal(s, m.f, m.l, m.c); break;
        case 'openText': await vscode.commands.executeCommand('vscode.openWith', s.document.uri, 'default', { viewColumn: vscode.ViewColumn.Beside, preview: false }); break;
        case 'reopenText': await vscode.commands.executeCommand('vscode.openWith', s.document.uri, 'default', { preview: false }); break;
        case 'openFile': {
          const url = s.data && s.data.model ? s.data.model.fileList[m.f] || m.url : m.url;
          if (url && url !== BUILTIN_XML_URL) await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(url), /\.(xsd|wsdl)$/i.test(url) ? VIEW_TYPE : 'default', { preview: false });
          break;
        }
        case 'sample': await vscode.commands.executeCommand(`${PREFIX}.sample`, s.document.uri, { key: m.key, surface: 'pill' }); break;
        default: break;
      }
    } catch (e) {
      s.post({ type: 'notice', message: String((e && e.message) || e).split('\n')[0] });
    }
  }

  compByKey(set, key) {
    if (!key || typeof key !== 'object') return null;
    const map = set.comps[key.k];
    return map ? map.get(key.key) || null : null;
  }

  /** Opens the text of a file of the set next to the viewer, with the cursor on the line. */
  async reveal(s, f, line, col) {
    const url = s.data && s.data.model ? s.data.model.fileList[f] : null;
    if (!url || url === BUILTIN_XML_URL) return;
    const uri = vscode.Uri.parse(url);
    const doc = await vscode.workspace.openTextDocument(uri);
    const l = Math.max(0, (Number(line) || 1) - 1);
    const c = Math.max(0, (Number(col) || 1) - 1);
    const pos = new vscode.Position(l, c);
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false, selection: new vscode.Range(pos, pos) });
  }

  /** The session of the active (or last active) viewer. */
  activeSession() {
    for (const s of this.sessions.values()) if (s.panel.active) return s;
    return this.lastActive && this.sessions.has(this.lastActive.document.uri.toString()) ? this.lastActive : null;
  }
  activeUri() { const s = this.activeSession(); return s ? s.document.uri : null; }
}

module.exports = { XsdViewerProvider, VIEW_TYPE, loadSet, displayPath };
