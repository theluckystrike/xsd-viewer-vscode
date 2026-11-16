'use strict';
// The three Zovo Pro tools. Each one checks the free try (src/pro.js) first, on every use, so the second use of a tool
// opens the Pro panel at once (before any pick), whatever file it is used on. A try counts only after the tool showed
// its result.
//   sample:   sample XML for a global element, written next to the schema and opened
//   validate: an XML file against its schema set with libxml2 (WebAssembly, offline), errors in the Problems panel;
//             with Zovo Pro the file is checked again on each save
//   docs:     a folder of HTML pages for the schema set
const vscode = require('vscode');
const { loadSet, displayPath } = require('./viewer');
const { baseName, resolveLocation } = require('./core/schema');
const { generate } = require('./core/sample');
const V = require('./core/validate');
const { buildDocs } = require('./core/docs');
const { decode } = require('./core/xml');

const SCHEMA_RE = /\.(xsd|wsdl)$/i;
const IGNORE = { ignoreFocusOut: true };

function createTools({ context, pro, viewer, io, setting, refresh }) {
  const diag = vscode.languages.createDiagnosticCollection('xsdViewer');
  context.subscriptions.push(diag);
  const validated = new Map(); // xml uri string -> { roots: [{ url, ns }], schemaName }

  const isUri = (a) => !!(a && typeof a === 'object' && a.scheme && typeof a.path === 'string');
  function activeSchemaUri() {
    const v = viewer.activeUri();
    const ed = vscode.window.activeTextEditor;
    if (v && viewer.activeSession() && viewer.activeSession().panel.active) return v;
    if (ed && SCHEMA_RE.test(ed.document.uri.path)) return ed.document.uri;
    return v || null;
  }
  async function pickWorkspaceFile(glob, placeHolder) {
    let uris = [];
    try { uris = await vscode.workspace.findFiles(glob, '**/{node_modules,.git}/**', 2000); } catch (e) { uris = []; }
    if (!uris.length) { vscode.window.showInformationMessage(`No ${glob.includes('xml}') || glob.endsWith('.xml') ? 'XML' : 'schema'} files found in this workspace.`); return null; }
    const items = uris.map((u) => ({ label: baseName(u.path), description: vscode.workspace.asRelativePath(u, false), uri: u })).sort((a, b) => a.description.localeCompare(b.description));
    const pick = await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true, ...IGNORE });
    return pick ? pick.uri : null;
  }
  async function schemaTarget(arg, verb) {
    if (isUri(arg) && SCHEMA_RE.test(arg.path)) return arg;
    return activeSchemaUri() || pickWorkspaceFile('**/*.{xsd,wsdl}', `Pick the schema to ${verb}`);
  }
  async function readText(uri) {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) return open.getText();
    return decode(await vscode.workspace.fs.readFile(uri));
  }
  async function exists(uri) { try { await vscode.workspace.fs.stat(uri); return true; } catch (e) { return false; } }
  async function uniqueFile(dir, base, ext) {
    let u = vscode.Uri.joinPath(dir, `${base}${ext}`);
    for (let i = 2; await exists(u); i++) u = vscode.Uri.joinPath(dir, `${base}-${i}${ext}`);
    return u;
  }
  const dirOf = (uri) => vscode.Uri.joinPath(uri, '..');

  // ---------- Generate sample XML ----------
  async function sampleTool(arg, opt) {
    const o = (opt && typeof opt === 'object' && !Array.isArray(opt)) ? opt : {};
    if (!(await pro.allowed('sample', o))) return undefined;
    const schemaUri = await schemaTarget(arg, 'make a sample for');
    if (!schemaUri) return undefined;
    const d = await loadSet(io, schemaUri);
    if (d.error) { vscode.window.showErrorMessage(`${baseName(schemaUri.path)}: ${d.error.message}`); return undefined; }
    const rootUrl = d.set.root;
    const els = [...d.set.comps.element.values()].filter((c) => c.el);
    if (!els.length) { vscode.window.showInformationMessage(`${baseName(schemaUri.path)} and the files it uses have no global element, so there is nothing to make a sample of.`); return undefined; }
    let comp = null;
    if (o.key && o.key.key) comp = d.set.comps.element.get(o.key.key) || null;
    if (!comp && o.element) comp = els.find((c) => c.name === o.element) || null;
    if (!comp) {
      const own = els.filter((c) => c.file === rootUrl);
      const list = (own.length ? own : els).concat(own.length ? els.filter((c) => c.file !== rootUrl) : []);
      if (list.length === 1) comp = list[0];
      else {
        const items = list.map((c) => ({ label: c.name, description: c.ns || '(no namespace)', detail: c.file === rootUrl ? undefined : displayPath(c.file), comp: c }));
        const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Pick the root element of the sample', matchOnDescription: true, ...IGNORE });
        if (!pick) return undefined;
        comp = pick.comp;
      }
    }
    let flags = o.options;
    if (!flags) {
      const choices = [
        { label: 'Optional elements and attributes', id: 'optional', picked: false, detail: 'One of each, down to the depth set in xsdViewer.sampleMaxDepth' },
        { label: 'Two copies of elements that may repeat', id: 'repeat', picked: false },
        { label: 'Comments at choices', id: 'comments', picked: true, detail: 'Names the branches the sample did not take' },
      ];
      const picked = await vscode.window.showQuickPick(choices, { canPickMany: true, placeHolder: `Sample of <${comp.name}>: what goes in (Enter for the checked ones)`, ...IGNORE });
      if (!picked) return undefined;
      flags = picked.map((p) => p.id);
    }
    const isWsdl = /\.wsdl$/i.test(schemaUri.path);
    const schemaFileName = baseName(comp.file);
    const sameDir = dirOf(vscode.Uri.parse(comp.file)).toString() === dirOf(schemaUri).toString();
    const r = generate(d.set, comp, {
      optional: flags.includes('optional'), repeat: flags.includes('repeat'), comments: flags.includes('comments'),
      maxDepth: Math.max(1, Math.min(30, Number(setting('sampleMaxDepth', 8)) || 8)),
      schemaHint: !isWsdl && sameDir ? schemaFileName : (!isWsdl ? baseName(schemaUri.path) : ''),
      header: `Sample of ${comp.name} from ${schemaFileName}, made by XSD Viewer & Schema Diagram.${flags.includes('optional') ? '' : ' Optional parts are left out.'}`,
    });
    const out = await uniqueFile(dirOf(schemaUri), `${baseName(schemaUri.path).replace(SCHEMA_RE, '')}-${comp.name}-sample`, '.xml');
    await vscode.workspace.fs.writeFile(out, Buffer.from(r.xml, 'utf8'));
    const doc = await vscode.workspace.openTextDocument(out);
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    await pro.produced('sample');
    vscode.window.setStatusBarMessage(`Sample XML: ${r.elements} elements written to ${baseName(out.path)}${r.truncated ? ' (optional elements stopped at 5,000 elements)' : ''}.`, 10000);
    refresh();
    return { uri: out, elements: r.elements, truncated: r.truncated, element: comp.name };
  }

  // ---------- Validate XML ----------
  async function rootsFor(xmlUri, info, schemaHint) {
    const roots = [];
    for (const h of info.hints) {
      const res = resolveLocation(xmlUri.toString(), h.loc);
      if (res.url && (await exists(vscode.Uri.parse(res.url)))) { roots.push({ url: io.norm(res.url), ns: h.ns }); continue; }
      const hits = await io.findByNamespace(h.ns, baseName(h.loc));
      if (hits.length) roots.push({ url: io.norm(hits[0]), ns: h.ns });
    }
    if (!roots.length && schemaHint) roots.push({ url: schemaHint.toString(), ns: info.ns });
    if (!roots.length) {
      const hits = await io.findByNamespace(info.ns, '');
      if (hits.length === 1) roots.push({ url: io.norm(hits[0]), ns: info.ns });
      else if (hits.length > 1) {
        const pick = await vscode.window.showQuickPick(hits.map((h) => ({ label: baseName(h), description: displayPath(h), url: h })), { placeHolder: `Several schemas have namespace ${info.ns || '(none)'}: pick the one to validate against`, ...IGNORE });
        if (!pick) return null;
        roots.push({ url: io.norm(pick.url), ns: info.ns });
      }
    }
    if (!roots.length) {
      const u = await pickWorkspaceFile('**/*.{xsd,wsdl}', `No schema found for ${info.ns ? `namespace ${info.ns}` : 'this file'}: pick the schema to validate against`);
      if (!u) return null;
      roots.push({ url: u.toString(), ns: info.ns });
    }
    return roots;
  }

  /** Runs libxml2 and fills the Problems panel. Returns { valid, errors, warnings, problems, schemaName }. */
  async function runValidation(xmlUri, roots) {
    const text = await readText(xmlUri);
    const info = V.instanceInfo(text);
    const set = (await loadSet(io, vscode.Uri.parse(roots[0].url))).set;
    for (const r of roots.slice(1)) await set.load(r.url);
    const res = await V.validate(set, text, baseName(xmlUri.path), roots, info.prefixes || {});
    const byFile = new Map();
    const add = (uri, p) => { const k = uri.toString(); if (!byFile.has(k)) byFile.set(k, { uri, list: [] }); byFile.get(k).list.push(p); };
    for (const p of res.problems) {
      const target = p.file ? vscode.Uri.parse(p.file) : xmlUri;
      const line = Math.max(0, (p.line || 1) - 1);
      const range = new vscode.Range(line, 0, line, 10000);
      const dg = new vscode.Diagnostic(range, p.file === '' ? `Schema: ${p.message}` : p.message, p.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
      dg.source = 'XSD (libxml2)';
      add(target, dg);
    }
    // clear the earlier results of this XML file and its schema files, then set the new ones
    const prev = validated.get(xmlUri.toString());
    for (const u of [xmlUri.toString(), ...(prev && prev.files ? prev.files : [])]) diag.delete(vscode.Uri.parse(u));
    for (const { uri, list } of byFile.values()) diag.set(uri, list);
    const schemaName = roots.map((r) => baseName(r.url)).join(', ');
    validated.set(xmlUri.toString(), { roots, schemaName, files: [...byFile.keys()].filter((k) => k !== xmlUri.toString()) });
    const errors = res.problems.filter((p) => p.severity === 'error').length;
    return { valid: res.valid, errors, warnings: res.problems.length - errors, problems: res.problems, schemaName, schemaError: !!res.schemaError, info };
  }

  async function validateTool(arg, opt) {
    const o = (opt && typeof opt === 'object' && !Array.isArray(opt)) ? opt : {};
    if (!(await pro.allowed('validate', o))) return undefined;
    let xmlUri = null, schemaHint = null;
    if (isUri(arg) && !SCHEMA_RE.test(arg.path)) xmlUri = arg;
    else if (isUri(arg)) schemaHint = arg;
    if (!xmlUri) {
      const ed = vscode.window.activeTextEditor;
      const vs = viewer.activeSession();
      if (!schemaHint && ed && !SCHEMA_RE.test(ed.document.uri.path) && /^\s*(<\?xml|<)/.test(ed.document.getText().slice(0, 200)) && !(vs && vs.panel.active)) xmlUri = ed.document.uri;
      else {
        schemaHint = schemaHint || viewer.activeUri() || (ed && SCHEMA_RE.test(ed.document.uri.path) ? ed.document.uri : null);
        xmlUri = o.xml ? o.xml : await pickWorkspaceFile('**/*.xml', schemaHint ? `Pick the XML file to validate against ${baseName(schemaHint.path)}` : 'Pick the XML file to validate');
      }
    }
    if (!xmlUri) return undefined;
    let text;
    try { text = await readText(xmlUri); } catch (e) { vscode.window.showErrorMessage(`${baseName(xmlUri.path)} could not be read.`); return undefined; }
    const info = V.instanceInfo(text);
    if (info.error) {
      // not well-formed: that is the result (libxml2 would say the same)
      const line = Math.max(0, (info.error.line || 1) - 1);
      const dg = new vscode.Diagnostic(new vscode.Range(line, 0, line, 10000), `Not well-formed XML: ${info.error.message}`, vscode.DiagnosticSeverity.Error);
      dg.source = 'XSD (libxml2)';
      diag.set(xmlUri, [dg]);
      await vscode.commands.executeCommand('workbench.actions.view.problems');
      vscode.window.showWarningMessage(`${baseName(xmlUri.path)} is not well-formed XML (line ${info.error.line}): ${info.error.message}`);
      await pro.produced('validate');
      refresh();
      return { valid: false, errors: 1, notWellFormed: true };
    }
    const roots = await rootsFor(xmlUri, info, schemaHint);
    if (!roots) return undefined;
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Validating XML' }, () => runValidation(xmlUri, roots));
    const name = baseName(xmlUri.path);
    if (r.valid && !r.problems.length) vscode.window.showInformationMessage(`${name} is valid against ${r.schemaName} (libxml2 ${V.LIBXML2_VERSION}, on this computer).`);
    else {
      await vscode.commands.executeCommand('workbench.actions.view.problems');
      vscode.window.showWarningMessage(r.schemaError
        ? `The schema set of ${r.schemaName} has errors, so ${name} could not be checked. See the Problems panel.`
        : `${name}: ${r.errors} error${r.errors === 1 ? '' : 's'}${r.warnings ? ` and ${r.warnings} warning${r.warnings === 1 ? '' : 's'}` : ''} against ${r.schemaName}. See the Problems panel.`);
    }
    await pro.produced('validate');
    refresh();
    return { ...r, xml: xmlUri };
  }

  /** On save: with Zovo Pro, files validated in this window are checked again; without it, old results are cleared. */
  async function onSave(doc) {
    const k = doc.uri.toString();
    const pairs = [...validated.entries()].filter(([x, v]) => x === k || v.roots.some((r) => r.url === k) || (v.files || []).includes(k));
    if (!pairs.length) return;
    if (!pro.licensed) {
      for (const [x, v] of pairs) { diag.delete(vscode.Uri.parse(x)); for (const f of v.files || []) diag.delete(vscode.Uri.parse(f)); validated.delete(x); }
      vscode.window.setStatusBarMessage('XSD Viewer: the validation results of this file were cleared after the save. Checking again on save is part of Zovo Pro.', 8000);
      return;
    }
    if (setting('validateOnSave', true) === false) return;
    for (const [x, v] of pairs) {
      try {
        const r = await runValidation(vscode.Uri.parse(x), v.roots);
        vscode.window.setStatusBarMessage(`XSD: ${baseName(x)} ${r.valid ? 'is valid' : `has ${r.errors} error${r.errors === 1 ? '' : 's'}`} against ${r.schemaName}.`, 8000);
      } catch (e) { /* keep the old results */ }
    }
  }
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((d) => { onSave(d); }));

  // ---------- HTML documentation ----------
  async function docsTool(arg, opt) {
    const o = (opt && typeof opt === 'object' && !Array.isArray(opt)) ? opt : {};
    if (!(await pro.allowed('docs', o))) return undefined;
    const schemaUri = await schemaTarget(arg, 'document');
    if (!schemaUri) return undefined;
    const d = await loadSet(io, schemaUri);
    if (d.error) { vscode.window.showErrorMessage(`${baseName(schemaUri.path)}: ${d.error.message}`); return undefined; }
    const all = Object.values(d.set.counts()).reduce((a, b) => a + b, 0);
    const own = Object.values(d.set.counts(d.set.root)).reduce((a, b) => a + b, 0);
    let onlyRoot = !!o.onlyRoot;
    if (o.onlyRoot === undefined && own < all && own > 0) {
      const pick = await vscode.window.showQuickPick([
        { label: `Every file of the schema set (${all} components)`, only: false },
        { label: `Only ${baseName(schemaUri.path)} (${own} components)`, only: true },
      ], { placeHolder: 'What goes into the documentation', ...IGNORE });
      if (!pick) return undefined;
      onlyRoot = pick.only;
    }
    let folder = o.folder || null;
    if (!folder) {
      const def = await uniqueFile(dirOf(schemaUri), `${baseName(schemaUri.path).replace(SCHEMA_RE, '')}-docs`, '');
      const pick = await vscode.window.showQuickPick([
        { label: `Write to ${vscode.workspace.asRelativePath(def, false)}`, uri: def },
        { label: 'Choose another folder...', choose: true },
      ], { placeHolder: 'Where the HTML pages go', ...IGNORE });
      if (!pick) return undefined;
      if (pick.choose) {
        const sel = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, defaultUri: dirOf(schemaUri), openLabel: 'Write here' });
        if (!sel || !sel.length) return undefined;
        folder = sel[0];
      } else folder = pick.uri;
    }
    const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Writing HTML documentation' }, async () => {
      const r = buildDocs(d.set, { title: baseName(schemaUri.path), onlyRoot, relPath: (u) => displayPath(u), generator: new Date().toISOString().slice(0, 10) });
      await vscode.workspace.fs.createDirectory(folder);
      for (const f of r.files) await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, f.path), Buffer.from(f.content, 'utf8'));
      return r;
    });
    await pro.produced('docs');
    refresh();
    const index = vscode.Uri.joinPath(folder, 'index.html');
    vscode.window.showInformationMessage(`Wrote ${res.pages} HTML pages to ${vscode.workspace.asRelativePath(folder, false)}.`, 'Reveal in Explorer', 'Open in Browser').then((b) => {
      if (b === 'Reveal in Explorer') vscode.commands.executeCommand('revealInExplorer', index);
      if (b === 'Open in Browser') vscode.env.openExternal(index);
    });
    return { folder, pages: res.pages, components: res.components };
  }

  return { sampleTool, validateTool, docsTool, onSave, diag, validated, runValidation };
}

module.exports = { createTools, SCHEMA_RE };
