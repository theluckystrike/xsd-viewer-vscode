'use strict';
// HTML documentation for a schema set (Zovo Pro tool "Export HTML documentation"): index.html with the files, their
// imports and includes and every global component, then one page per element, complex type, simple type, model group,
// attribute group and global attribute, each with its diagram (the same SVG as the viewer), content, attributes,
// facets, documentation and the components that use it. Plain HTML and one style sheet, no script, no web fonts:
// the folder opens from disk or from any web server.
const X = require('./xml');
const { Model } = require('./model');
const { baseName } = require('./schema');
const D = require('../../media/diagram.js');

const KIND_LABEL = { element: 'Element', complexType: 'Complex type', simpleType: 'Simple type', group: 'Model group', attributeGroup: 'Attribute group', attribute: 'Attribute', notation: 'Notation' };
const KIND_ORDER = ['element', 'complexType', 'simpleType', 'group', 'attributeGroup', 'attribute'];
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS = `body{font:14px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d2433;background:#fff;margin:0}
header{background:#13334c;color:#fff;padding:14px 28px}header a{color:#bfe3ff}header h1{margin:0;font-size:20px}header p{margin:2px 0 0;opacity:.85}
main{padding:20px 28px;max-width:1280px}h2{font-size:17px;margin:26px 0 8px;border-bottom:1px solid #dde3ea;padding-bottom:4px}
table{border-collapse:collapse;width:100%;margin:6px 0 14px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #e8ecf1;vertical-align:top}th{background:#f4f7fa;font-weight:600}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}a{color:#0b62a8;text-decoration:none}a:hover{text-decoration:underline}
.doc{white-space:pre-wrap;background:#f7f9fb;border-left:3px solid #2f8f83;padding:8px 12px;margin:8px 0}.muted{color:#5b6675}.warn{color:#a3470f}
.diagram{overflow:auto;border:1px solid #e1e6ec;border-radius:6px;padding:6px;background:#fbfcfd}.cols{columns:3 260px}.cols li{break-inside:avoid}
.xsd-diagram .edges path{fill:none;stroke:#8795a8;stroke-width:1.2}
.xsd-diagram .box .bg{fill:#ffffff;stroke:#5b7b99;stroke-width:1.2}.xsd-diagram .box .strip{fill:#2f8f83}.xsd-diagram .box.opt .strip{fill:#ffffff;stroke:#2f8f83;stroke-width:1.2}
.xsd-diagram .box.root .bg{fill:#eef6ff;stroke:#13334c;stroke-width:1.6}.xsd-diagram .box.warn .bg{stroke:#c0581b}
.xsd-diagram .t-name{font:600 12.5px -apple-system,"Segoe UI",sans-serif;fill:#1d2433}.xsd-diagram .box.opt .t-name{fill:#3d4a5c}
.xsd-diagram .t-type,.xsd-diagram .t-attr{font:11px ui-monospace,Menlo,Consolas,monospace;fill:#5b6675}.xsd-diagram .t-attr.req{fill:#1d2433}.xsd-diagram .sep{stroke:#d5dce4}
.xsd-diagram .comp rect{fill:#e9f4f2;stroke:#2f8f83}.xsd-diagram .comp.choice rect{fill:#fff3e6;stroke:#c97a1d}.xsd-diagram .comp.all rect{fill:#f1ecfb;stroke:#7756c0}
.xsd-diagram .t-comp{font:600 11px -apple-system,"Segoe UI",sans-serif;fill:#1d2433}.xsd-diagram .small rect{fill:#f4f6f9;stroke:#8795a8;stroke-dasharray:4 3}.xsd-diagram .t-small{font:11.5px -apple-system,"Segoe UI",sans-serif;fill:#3d4a5c}
.xsd-diagram .t-occ{font:10.5px ui-monospace,Menlo,monospace;fill:#5b6675}.xsd-diagram .tg circle{fill:#fff;stroke:#5b7b99}.xsd-diagram .tg path{stroke:#13334c;stroke-width:1.5}
footer{padding:16px 28px;color:#5b6675;font-size:12px}`;

function slug(s) { return String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'x'; }

/**
 * Builds the documentation. o: { title, rootFile, onlyRoot (only the opened file's components), relPath(url) -> string,
 * generator } -> { files: [{ path, content }], pages, components }
 */
function buildDocs(set, o) {
  const opts = o || {};
  const m = new Model(set);
  const rel = opts.relPath || ((u) => baseName(u));
  const comps = [];
  for (const k of KIND_ORDER) for (const [key, c] of set.comps[k]) if (c.el && !key.endsWith('#orig') && (!opts.onlyRoot || c.file === set.root)) comps.push(c);
  // page names
  const page = new Map();
  const used = new Set();
  for (const c of comps) {
    let p = `${c.kind}-${slug(c.name)}.html`;
    let i = 2;
    while (used.has(p.toLowerCase())) p = `${c.kind}-${slug(c.name)}-${i++}.html`;
    used.add(p.toLowerCase());
    page.set(c, p);
  }
  const linkComp = (kind, ctxEl, value) => {
    if (!value || !ctxEl) return esc(value || '');
    const r = set.lookup(kind, ctxEl, value, set.schemaOf(ctxEl));
    return r.comp && page.has(r.comp) ? `<a href="${page.get(r.comp)}">${esc(value)}</a>` : esc(value);
  };
  // "used by": who names each component in type, ref, base, itemType, memberTypes or substitutionGroup
  const usedBy = new Map();
  for (const c of comps) {
    const walk = (el) => {
      for (const [attrName, kinds] of [['type', ['complexType', 'simpleType']], ['ref', [el.localName === 'attribute' ? 'attribute' : el.localName === 'group' ? 'group' : el.localName === 'attributeGroup' ? 'attributeGroup' : 'element']], ['base', ['complexType', 'simpleType']], ['itemType', ['simpleType']], ['substitutionGroup', ['element']]]) {
        const v = X.attr(el, attrName);
        if (!v) continue;
        for (const one of attrName === 'substitutionGroup' ? v.trim().split(/\s+/) : [v]) {
          for (const k of kinds) {
            const r = set.lookup(k, el, one, set.schemaOf(el));
            if (r.comp && r.comp !== c) { if (!usedBy.has(r.comp)) usedBy.set(r.comp, new Set()); usedBy.get(r.comp).add(c); }
          }
        }
      }
      for (const k of X.xsKids(el)) walk(k);
    };
    walk(c.el);
  }
  const files = [];
  const title = opts.title || baseName(set.root);
  const head = (t) => `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)}</title><link rel="stylesheet" href="style.css"></head><body>`;
  const foot = `<footer>Made with XSD Viewer &amp; Schema Diagram by Zovo${opts.generator ? ' · ' + esc(opts.generator) : ''}.</footer></body></html>\n`;

  // ---------- index ----------
  const fl = set.fileList();
  let idx = head(`${title}: schema documentation`) + `<header><h1>${esc(title)}</h1><p>Schema documentation · ${fl.length} file${fl.length === 1 ? '' : 's'} · ${comps.length} global components</p></header><main>`;
  idx += '<h2>Files</h2><table><tr><th>File</th><th>Target namespace</th><th>Imports and includes</th></tr>';
  for (const f of fl) {
    const refs = f.refs.map((r) => `${esc(r.kind)} ${r.ns ? `<span class="mono">${esc(r.ns)}</span> ` : ''}${r.url ? '→ ' + esc(r.url.startsWith('zovo-builtin:') ? 'built in' : rel(r.url)) : `<span class="warn">not found (${esc(r.loc || 'no location')})</span>`}`).join('<br>');
    idx += `<tr><td class="mono">${esc(f.url.startsWith('zovo-builtin:') ? 'xml.xsd (built in)' : rel(f.url))}${f.error ? `<br><span class="warn">${esc(f.error)}</span>` : ''}</td><td class="mono">${esc(f.namespaces.join(', ') || '(none)')}</td><td>${refs || '<span class="muted">none</span>'}</td></tr>`;
  }
  idx += '</table>';
  for (const k of KIND_ORDER) {
    const list = comps.filter((c) => c.kind === k).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) continue;
    idx += `<h2>${KIND_LABEL[k]}s (${list.length})</h2><ul class="cols">` + list.map((c) => `<li><a href="${page.get(c)}">${esc(c.name)}</a></li>`).join('') + '</ul>';
  }
  idx += '</main>' + foot;
  files.push({ path: 'index.html', content: idx });
  files.push({ path: 'style.css', content: CSS + '\n' });

  // ---------- one page per component ----------
  for (const c of comps) {
    const n = m.componentNode(c);
    let h = head(`${c.name}: ${KIND_LABEL[c.kind]}`);
    h += `<header><p><a href="index.html">${esc(title)}</a></p><h1>${KIND_LABEL[c.kind]} ${esc(c.name)}</h1><p class="mono">${esc(c.ns || '(no namespace)')}</p></header><main>`;
    h += `<p class="muted">Defined in <span class="mono">${esc(rel(c.file))}</span>, line ${c.line}.</p>`;
    if (n.doc) h += `<div class="doc">${esc(n.doc)}</div>`;
    const facts = [];
    if (c.kind === 'element') {
      facts.push(['Type', linkComp('complexType', c.el, X.attr(c.el, 'type')) || esc(n.type)]);
      if (n.sg) facts.push(['Substitution group', linkComp('element', c.el, n.sg)]);
      if (n.subs) facts.push(['Substitutes', n.subs.map(esc).join(', ')]);
      if (n.abstract) facts.push(['Abstract', 'yes']);
      if (n.nillable) facts.push(['Nillable', 'yes']);
      if (n.def != null) facts.push(['Default', `<code>${esc(n.def)}</code>`]);
      if (n.fixed != null) facts.push(['Fixed', `<code>${esc(n.fixed)}</code>`]);
    }
    if (c.kind === 'complexType') {
      if (n.base) { const d = X.firstXs(X.firstXs(c.el, 'complexContent', 'simpleContent') || c.el, 'extension', 'restriction'); facts.push(['Derived', d ? `${esc(d.localName)} of ${linkComp('complexType', d, X.attr(d, 'base'))}` : esc(n.base)]); }
      if (n.abstract) facts.push(['Abstract', 'yes']);
      if (n.mixed) facts.push(['Mixed content', 'yes']);
      if (n.derived) facts.push(['Derived types', n.derived.map(esc).join(', ')]);
    }
    if (facts.length) h += '<table>' + facts.map(([a, b]) => `<tr><th style="width:180px">${a}</th><td>${b}</td></tr>`).join('') + '</table>';
    const svg = D.render(n, {}).svg;
    h += `<h2>Diagram</h2><div class="diagram">${svg}</div>`;
    if (n.children && n.children.length) {
      h += '<h2>Content</h2><table><tr><th>Element</th><th>Type</th><th>Occurs</th><th>Documentation</th></tr>';
      const rows = [];
      const walk = (list, depth, note) => {
        for (const p of list) {
          if (p.k === 'element') rows.push(`<tr><td style="padding-left:${8 + depth * 16}px">${note ? `<span class="muted">${esc(note)}</span> ` : ''}${p.global && p.ref ? linkByKey(set, page, 'element', p.ns, p.name) : esc(p.name)}</td><td class="mono">${linkByLabel(set, page, p)}</td><td class="mono">${esc(D.occ(p) || '1..1')}</td><td>${esc(firstPara(p.doc))}</td></tr>`);
          else if (p.k === 'any') rows.push(`<tr><td style="padding-left:${8 + depth * 16}px"><em>any element</em></td><td class="mono">${esc(p.ns)}</td><td class="mono">${esc(D.occ(p) || '1..1')}</td><td>processContents ${esc(p.pc)}</td></tr>`);
          else if (p.k === 'base') { rows.push(`<tr><td colspan="4" style="padding-left:${8 + depth * 16}px" class="muted">from ${esc(p.name)}:</td></tr>`); walk(p.children || [], depth + 1, ''); }
          else if (p.k === 'group') { rows.push(`<tr><td colspan="4" style="padding-left:${8 + depth * 16}px" class="muted">group ${esc(p.name)} ${esc(D.occ(p))}</td></tr>`); walk(p.children || [], depth + 1, ''); }
          else { rows.push(`<tr><td colspan="4" style="padding-left:${8 + depth * 16}px" class="muted">${esc(p.k)} ${esc(D.occ(p))}</td></tr>`); walk(p.children || [], depth + 1, ''); }
        }
      };
      walk(n.children, 0, '');
      h += rows.join('') + '</table>';
    }
    if (n.attrs && n.attrs.length) {
      h += '<h2>Attributes</h2><table><tr><th>Name</th><th>Type</th><th>Use</th><th>Default or fixed</th><th>Documentation</th></tr>';
      h += n.attrs.map((a) => `<tr><td class="mono">${esc(a.any ? `any attribute (${a.ns})` : a.name)}</td><td class="mono">${esc(a.type || '')}</td><td>${esc(a.use || '')}</td><td class="mono">${a.fixed != null ? 'fixed ' + esc(a.fixed) : (a.def != null ? esc(a.def) : '')}</td><td>${esc(firstPara(a.doc))}${a.from ? ` <span class="muted">(from ${esc(a.from)})</span>` : ''}</td></tr>`).join('');
      h += '</table>';
    }
    if (n.text && (n.text.facets && Object.keys(n.text.facets).length || n.text.list || n.text.union)) {
      h += '<h2>Values</h2>' + facetHtml(n.text);
    }
    const ub = usedBy.get(c);
    if (ub && ub.size) h += `<h2>Used by (${ub.size})</h2><ul class="cols">` + [...ub].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500).map((u) => `<li>${KIND_LABEL[u.kind]} <a href="${page.get(u)}">${esc(u.name)}</a></li>`).join('') + '</ul>';
    h += '</main>' + foot;
    files.push({ path: page.get(c), content: h });
  }
  return { files, pages: comps.length + 1, components: comps.length };
}

function firstPara(s) { const t = String(s || '').split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim(); return t.length > 300 ? t.slice(0, 297) + '...' : t; }
function linkByKey(set, page, kind, ns, name) { const c = set.comps[kind].get(`{${ns || ''}}${name}`); return c && page.has(c) ? `<a href="${page.get(c)}">${esc(name)}</a>` : esc(name); }
function linkByLabel(set, page, p) {
  if (!p.type || p.type === '(anonymous)') return esc(p.type || '');
  for (const kind of ['complexType', 'simpleType']) for (const c of set.comps[kind].values()) if (c.el && page.has(c) && (p.type === c.name || p.type.endsWith(':' + c.name))) {
    // the same local name in two namespaces: no link rather than a wrong one
    const same = [...set.comps[kind].values()].filter((x) => x.name === c.name);
    return same.length === 1 ? `<a href="${page.get(c)}">${esc(p.type)}</a>` : esc(p.type);
  }
  return esc(p.type);
}
function facetHtml(t) {
  const f = t.facets || {};
  let h = `<p>Based on <code>${esc(t.base || t.builtin)}</code>${t.builtin && t.builtin !== t.base ? ` (built-in <code>${esc(t.builtin)}</code>)` : ''}.</p>`;
  if (t.list) h += `<p>A space-separated list of <code>${esc(t.list.base || t.list.builtin)}</code> values.</p>`;
  if (t.union) h += `<p>One of: ${t.union.map((u) => `<code>${esc(u.base || u.builtin)}</code>`).join(', ')}.</p>`;
  const rows = [];
  for (const [k, v] of Object.entries(f)) {
    if (k === 'enumeration') rows.push(`<tr><th>enumeration (${v.length})</th><td>${v.slice(0, 400).map((e) => `<code>${esc(e.value)}</code>${e.doc ? ` <span class="muted">${esc(e.doc)}</span>` : ''}`).join('<br>')}</td></tr>`);
    else if (k === 'pattern' || k === 'basePattern') rows.push(`<tr><th>${k === 'basePattern' ? 'pattern of the base' : 'pattern'}</th><td>${v.map((p) => `<code>${esc(p)}</code>`).join('<br>')}</td></tr>`);
    else rows.push(`<tr><th>${esc(k)}</th><td><code>${esc(v)}</code></td></tr>`);
  }
  if (rows.length) h += '<table>' + rows.join('') + '</table>';
  return h;
}

module.exports = { buildDocs, CSS };
