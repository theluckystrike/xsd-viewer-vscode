'use strict';
// A schema-set io on plain files for the tests: read by file URL, and a workspace index over one folder
// (what the extension does with vscode.workspace.findFiles).
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const { decode } = require('../../src/core/xml');
const { namespacesInText, baseName } = require('../../src/core/schema');

function walk(dir, out = []) {
  if (!dir || !fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p, out); } else if (/\.(xsd|wsdl)$/i.test(e.name)) out.push(p);
  }
  return out;
}

function fileIo(wsRoot) {
  const files = () => walk(wsRoot).map((p) => pathToFileURL(p).href);
  return {
    reads: [],
    async read(url) {
      this.reads.push(url);
      if (!/^file:/.test(url)) throw new Error('only file URLs in tests: ' + url);
      const p = fileURLToPath(url);
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return null;
      return decode(fs.readFileSync(p));
    },
    async findByNamespace(ns, hint) {
      const out = [];
      for (const u of files()) { const t = decode(fs.readFileSync(fileURLToPath(u))).slice(0, 200000); if (namespacesInText(t).includes(ns || '')) out.push(u); }
      return out.sort((a, b) => (baseName(b) === hint) - (baseName(a) === hint));
    },
    async findByName(name) { return files().filter((u) => baseName(u).toLowerCase() === String(name).toLowerCase()); },
  };
}
const url = (p) => pathToFileURL(p).href;
module.exports = { fileIo, url, walk };
