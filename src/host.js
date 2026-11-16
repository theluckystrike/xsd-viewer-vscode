'use strict';
// The schema-set io for VS Code: reads files through the workspace file system (the unsaved text of an open editor
// wins), and keeps a small index of the workspace's .xsd and .wsdl files by target namespace, used only when an import
// names a web address or a file that is not where schemaLocation says. Nothing is downloaded.
const vscode = require('vscode');
const { decode } = require('./core/xml');
const { namespacesInText, baseName } = require('./core/schema');

const GLOB = '**/*.{xsd,XSD,Xsd,wsdl,WSDL,Wsdl}';
const EXCLUDE = '**/{node_modules,.git}/**';
const MAX_FILES = 5000;

function createIo() {
  let index = null; // Promise<[{ url, name, ns: [] }]>
  let builtAt = 0;
  const norm = (u) => { try { return vscode.Uri.parse(u).toString(); } catch (e) { return u; } };
  async function read(url) {
    const uri = vscode.Uri.parse(url);
    const key = uri.toString();
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
    if (open) return open.getText();
    try {
      const st = await vscode.workspace.fs.stat(uri);
      if (st.type === vscode.FileType.Directory) return null;
      return decode(await vscode.workspace.fs.readFile(uri));
    } catch (e) { return null; }
  }
  async function buildIndex() {
    if (!vscode.workspace.workspaceFolders || !vscode.workspace.workspaceFolders.length) return [];
    let uris = [];
    try { uris = await vscode.workspace.findFiles(GLOB, EXCLUDE, MAX_FILES); } catch (e) { uris = []; }
    const out = [];
    for (const u of uris) {
      let head = '';
      try { const b = await vscode.workspace.fs.readFile(u); head = decode(b.length > 400000 ? b.slice(0, 400000) : b); } catch (e) { continue; }
      out.push({ url: u.toString(), name: baseName(u.path), ns: namespacesInText(head) });
    }
    return out;
  }
  function getIndex() {
    if (!index || Date.now() - builtAt > 60000) { builtAt = Date.now(); index = buildIndex(); }
    return index;
  }
  return {
    read, norm,
    async findByNamespace(ns, hint) {
      const list = (await getIndex()).filter((e) => e.ns.includes(ns || ''));
      return list.sort((a, b) => (b.name === hint) - (a.name === hint)).map((e) => e.url);
    },
    async findByName(name) {
      const n = String(name || '').toLowerCase();
      return (await getIndex()).filter((e) => e.name.toLowerCase() === n).map((e) => e.url);
    },
    invalidate() { index = null; },
  };
}

module.exports = { createIo };
