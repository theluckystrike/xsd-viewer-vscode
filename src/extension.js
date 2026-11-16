'use strict';
// XSD Viewer & Schema Diagram by Zovo. Free core: .xsd files and the schemas inside .wsdl files open in a viewer with
// a component tree, a diagram and a details pane; xs:include, xs:import, xs:redefine and xs:override are followed on
// local files (a web address is never downloaded; a workspace file with that namespace is used instead); search across
// the whole schema set; double-click to jump to the line. The viewer is an optional editor: schemas keep opening as
// text. No network and no telemetry; nothing shows on activation. Pro tools (pro.js) ask only when used: sample XML,
// validation with libxml2 (WebAssembly, offline), HTML documentation.
const vscode = require('vscode');
const { XsdViewerProvider, VIEW_TYPE } = require('./viewer');
const { createTools, SCHEMA_RE } = require('./tools');
const { createIo } = require('./host');
const { createPro } = require('./pro');
const { createRatingPrompt } = require('./rate');
const support = require('./support');
const { createReach } = require('./reach');
const reachConfig = require('./reach-config');

const EXT_ID = 'zovo.zovo-xsd-viewer';
const PREFIX = 'xsdViewer';
const SAMPLE_FILES = ['purchase-order.xsd', 'common-types.xsd', 'order-lines.xsd', 'order.xml', 'order-with-errors.xml'];

let pro, reach, viewer, tools, ctxRef;

function setting(key, dflt) { try { const v = vscode.workspace.getConfiguration(PREFIX).get(key, dflt); return v === undefined ? dflt : v; } catch (e) { return dflt; } }
const isSample = (uri) => !!(ctxRef && uri && uri.scheme === 'file' && (uri.fsPath.startsWith(ctxRef.extensionUri.fsPath) || (ctxRef.globalStorageUri && uri.fsPath.startsWith(ctxRef.globalStorageUri.fsPath))));
function refreshPro() { if (reach) reach.refresh(); }

function activate(context) {
  ctxRef = context;
  let rating = { success() {}, failure() {} };
  try { rating = createRatingPrompt({ vscode, context, extensionId: EXT_ID, section: PREFIX, name: 'XSD Viewer' }); } catch (e) { /* rating is optional */ }
  support.registerSupport({ vscode, context, prefix: PREFIX, selfId: EXT_ID });
  pro = createPro({ vscode, context });
  context.subscriptions.push(pro.onDidChange(() => refreshPro()));
  reach = createReach({ vscode, ...reachConfig, context, licensed: () => !!pro.licensed, shown: () => setting('showProTools', true) !== false });
  reach.registerCtx();
  const io = createIo();
  viewer = new XsdViewerProvider(context, { io, rating, reach, isSample });
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, viewer, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }));
  tools = createTools({ context, pro, viewer, io, setting, refresh: refreshPro });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration(`${PREFIX}.showProTools`)) refreshPro(); }));
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{xsd,wsdl}');
  context.subscriptions.push(watcher, watcher.onDidCreate(() => io.invalidate()), watcher.onDidDelete(() => io.invalidate()));

  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, async (...a) => {
    try { return await fn(...a); } catch (e) { vscode.window.showErrorMessage(String((e && e.message) || e).split('\n')[0]); return undefined; }
  }));
  const target = (uri) => {
    if (uri && uri.scheme) return uri;
    const v = viewer.activeUri();
    const ed = vscode.window.activeTextEditor;
    if (ed && SCHEMA_RE.test(ed.document.uri.path)) return ed.document.uri;
    return v;
  };
  reg(`${PREFIX}.openViewer`, async (uri) => {
    const u = target(uri);
    if (!u) { vscode.window.showInformationMessage('Open a .xsd or .wsdl file first.'); return; }
    // from the title bar of the schema's text editor: the viewer opens next to it, the text tab stays
    const ed = vscode.window.activeTextEditor;
    const fromText = !!(ed && ed.document.uri.toString() === u.toString());
    await vscode.commands.executeCommand('vscode.openWith', u, VIEW_TYPE, { preview: false, ...(fromText ? { viewColumn: vscode.ViewColumn.Beside } : {}) });
  });
  reg(`${PREFIX}.openAsText`, async (uri) => {
    const u = (uri && uri.scheme) ? uri : viewer.activeUri();
    if (!u) { vscode.window.showInformationMessage('Open a schema in the XSD Viewer first.'); return; }
    await vscode.commands.executeCommand('vscode.openWith', u, 'default', { viewColumn: vscode.ViewColumn.Beside, preview: false });
  });
  reg(`${PREFIX}.openSample`, async () => {
    // A copy in the extension's storage, so the imports resolve and edits never touch the installed extension.
    const dst = vscode.Uri.joinPath(context.globalStorageUri, 'purchase-order');
    await vscode.workspace.fs.createDirectory(dst);
    for (const f of SAMPLE_FILES) {
      const to = vscode.Uri.joinPath(dst, f);
      let there = true; try { await vscode.workspace.fs.stat(to); } catch (e) { there = false; }
      if (!there) await vscode.workspace.fs.writeFile(to, await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'samples', 'purchase-order', f)));
    }
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.joinPath(dst, 'purchase-order.xsd'), VIEW_TYPE, { preview: false });
  });
  reg(`${PREFIX}.openWalkthrough`, () => vscode.commands.executeCommand('workbench.action.openWalkthrough', `${EXT_ID}#${PREFIX}.start`, false));
  reg(`${PREFIX}.sample`, reach.wrap((uri, opt) => tools.sampleTool(uri && uri.scheme ? uri : null, opt)));
  reg(`${PREFIX}.validate`, reach.wrap((uri, opt) => tools.validateTool(uri && uri.scheme ? uri : null, opt)));
  reg(`${PREFIX}.docs`, reach.wrap((uri, opt) => tools.docsTool(uri && uri.scheme ? uri : null, opt)));
  context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: (uri) => pro.handleUri(uri) }));
  return { viewer: () => viewer, pro: () => pro, tools: () => tools, reach: () => reach };
}

function deactivate() {}

module.exports = { activate, deactivate, _internal: { viewer: () => viewer, pro: () => pro, tools: () => tools } };
