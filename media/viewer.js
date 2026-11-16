/* XSD Viewer & Schema Diagram by Zovo: the viewer page. The extension sends the list of global components of the
   schema set; this page draws the tree, asks for one component's content model when it is picked (and for the
   content of a box when its + is clicked), draws the diagram (diagram.js) and the details. No network: the page's
   content security policy allows no remote load. */
(function () {
  'use strict';
  var vscode = acquireVsCodeApi();
  var $ = function (id) { return document.getElementById(id); };
  var KINDS = ['element', 'complexType', 'simpleType', 'group', 'attributeGroup', 'attribute', 'notation'];
  var KIND_LABEL = { element: 'Elements', complexType: 'Complex types', simpleType: 'Simple types', group: 'Model groups', attributeGroup: 'Attribute groups', attribute: 'Attributes', notation: 'Notations' };
  var KIND_ONE = { element: 'Element', complexType: 'Complex type', simpleType: 'Simple type', group: 'Model group', groupDef: 'Model group', attributeGroup: 'Attribute group', attribute: 'Attribute', notation: 'Notation', sequence: 'Sequence', choice: 'Choice', all: 'All', any: 'Any element', base: 'Inherited content', group_ref: 'Group' };
  var KIND_ICON = { element: 'E', complexType: 'C', simpleType: 'S', group: 'G', attributeGroup: 'A', attribute: '@', notation: 'N' };
  var ROW_LIMIT = 3000;

  var data = null, items = [], root = null, rootItem = null, selected = null, scale = 1, view = 'diagram';
  var open = {}, collapsed = {}, topen = {}, tnodes = {};
  var pending = {}, reqSeq = 0;
  var state = vscode.getState() || {};

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function request(type, payload) {
    var id = ++reqSeq;
    return new Promise(function (res) { pending[id] = res; var m = { type: type, reqId: id }; for (var k in payload) m[k] = payload[k]; vscode.postMessage(m); });
  }
  function occ(n) { return XsdDiagram.occ(n); }
  function setStatus(t) { $('status').textContent = t; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function countsText(c) {
    var parts = [];
    if (c.element) parts.push(plural(c.element, 'element', 'elements'));
    if (c.complexType) parts.push(plural(c.complexType, 'complex type', 'complex types'));
    if (c.simpleType) parts.push(plural(c.simpleType, 'simple type', 'simple types'));
    if (c.group) parts.push(plural(c.group, 'group', 'groups'));
    if (c.attributeGroup) parts.push(plural(c.attributeGroup, 'attribute group', 'attribute groups'));
    if (c.attribute) parts.push(plural(c.attribute, 'attribute', 'attributes'));
    return parts.join(', ') || 'no global components';
  }

  // ---------- tree ----------
  function visibleItems() {
    var q = $('q').value.trim().toLowerCase();
    var scope = $('scope').value;
    var list = items.filter(function (it) {
      if (q) return it.n.toLowerCase().indexOf(q) >= 0;
      return scope === 'all' || it.own;
    });
    if (q) list.sort(function (a, b) { var ea = a.n.toLowerCase() === q, eb = b.n.toLowerCase() === q; if (ea !== eb) return ea ? -1 : 1; if (a.own !== b.own) return b.own - a.own; return a.n.localeCompare(b.n); });
    else list.sort(function (a, b) { return a.n.localeCompare(b.n); });
    return { list: list, q: q };
  }
  function renderTree() {
    var tree = $('tree');
    if (!data) { tree.innerHTML = ''; return; }
    if (!items.length) {
      tree.innerHTML = '<p class="empty">' + (data.kind === 'wsdl' ? 'This WSDL file has no embedded XML Schema (wsdl:types is empty or missing).' : 'This schema has no global components.') + '</p>';
      $('hits').textContent = '';
      return;
    }
    var v = visibleItems();
    $('hits').textContent = v.q ? plural(v.list.length, 'match', 'matches') : '';
    var html = [];
    var shown = 0;
    KINDS.forEach(function (k) {
      var group = v.list.filter(function (it) { return it.k === k; });
      if (!group.length) return;
      var isCol = collapsed[k] && !v.q;
      html.push('<div class="grp-h' + (isCol ? ' col' : '') + '" data-grp="' + k + '" role="treeitem" aria-expanded="' + (!isCol) + '"><span class="tw"></span>' + KIND_LABEL[k] + ' <span class="muted">' + group.length + '</span></div>');
      if (isCol) return;
      for (var i = 0; i < group.length; i++) {
        if (shown >= ROW_LIMIT) break;
        shown++;
        var it = group[i], path = 'c' + it.i, canOpen = it.k === 'element' || it.k === 'complexType' || it.k === 'group' || it.k === 'attributeGroup';
        var isOpen = topen[path] === true;
        html.push('<div class="row' + (rootItem === it ? ' sel' : '') + '" role="treeitem" data-path="' + path + '" data-item="' + it.i + '" title="' + esc((data.nsList[it.s] || '(no namespace)') + '\n' + data.fileNames[it.f] + ':' + it.l + (it.d ? '\n' + it.d : '')) + '">'
          + '<span class="tw' + (canOpen ? (isOpen ? ' open' : ' closed') : '') + '" data-tw="' + path + '"></span><span class="ic k-' + it.k + '">' + KIND_ICON[it.k] + '</span><span class="nm">' + hl(it.n, v.q) + '</span>'
          + (it.own ? '' : '<span class="fn">' + esc(shortFile(data.fileNames[it.f])) + '</span>') + '</div>');
        if (isOpen && tnodes[path]) html.push(renderNested(tnodes[path], path, 1));
      }
    });
    if (shown >= ROW_LIMIT) html.push('<p class="empty">Showing the first ' + ROW_LIMIT + ' of ' + v.list.length + '. Type in the search box to find the others.</p>');
    tree.innerHTML = html.join('');
  }
  function shortFile(p) { var s = String(p || ''); var i = s.lastIndexOf('/'); return i >= 0 ? s.slice(i + 1) : s; }
  function hl(name, q) {
    if (!q) return esc(name);
    var i = name.toLowerCase().indexOf(q);
    if (i < 0) return esc(name);
    return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + q.length)) + '</mark>' + esc(name.slice(i + q.length));
  }
  function nestedLabel(n) {
    if (n.k === 'element') return '<span class="nm">' + esc(n.name) + '</span>' + (occ(n) ? ' <span class="occ">' + esc(occ(n)) + '</span>' : '') + (n.type ? ' <span class="ty">' + esc(n.type) + '</span>' : '');
    if (n.k === 'sequence' || n.k === 'choice' || n.k === 'all') return '<span class="comp-l ' + n.k + '">' + n.k + '</span>' + (occ(n) ? ' <span class="occ">' + esc(occ(n)) + '</span>' : '');
    if (n.k === 'any') return '<span class="nm">any</span> <span class="ty">' + esc(n.ns) + '</span>';
    if (n.k === 'base') return '<span class="muted">extends</span> <span class="nm">' + esc(n.name) + '</span>';
    if (n.k === 'group') return '<span class="muted">group</span> <span class="nm">' + esc(n.name) + '</span>' + (occ(n) ? ' <span class="occ">' + esc(occ(n)) + '</span>' : '');
    if (n.k === 'attr') return '<span class="nm">@' + esc(n.a.name) + '</span> <span class="ty">' + esc(n.a.type || '') + '</span>' + (n.a.use === 'required' ? ' <span class="occ">required</span>' : '');
    return esc(n.name || n.k);
  }
  function nestedKids(n) {
    var kids = (n.children || []).slice();
    if ((n.k === 'element' || n.k === 'complexType' || n.k === 'attributeGroup') && n.attrs && n.attrs.length && n.comp) kids = n.attrs.map(function (a) { return { k: 'attr', a: a, id: 'a' + Math.random() }; }).concat(kids);
    return kids;
  }
  function renderNested(n, path, depth) {
    var kids = nestedKids(n);
    if (!kids.length) return '<div class="row nested muted" data-depth="' + depth + '"><span class="pad" data-d="' + depth + '"></span>no element content</div>';
    var html = [];
    kids.forEach(function (c, i) {
      var p = path + '/' + i;
      tnodes[p] = c;
      var canOpen = c.k !== 'attr' && (c.ck != null || (c.children && c.children.length));
      // sequences, choices and groups start open; element content waits for a click
      var isOpen = topen[p] === undefined ? (c.k !== 'element' && !!(c.children && c.children.length)) : topen[p];
      html.push('<div class="row nested' + (selected === c ? ' sel' : '') + '" role="treeitem" data-path="' + p + '" data-depth="' + depth + '"><span class="pad" data-d="' + Math.min(depth, 12) + '"></span><span class="tw' + (canOpen ? (isOpen ? ' open' : ' closed') : '') + '" data-tw="' + p + '"></span>' + nestedLabel(c) + '</div>');
      if (isOpen && canOpen && c.children) html.push(renderNested(c, p, depth + 1));
    });
    return html.join('');
  }
  async function toggleTree(path) {
    var n = tnodes[path];
    var nowOpen = topen[path] === undefined ? (path.indexOf('/') >= 0 && n && n.k !== 'element' && !!(n.children && n.children.length)) : topen[path];
    if (nowOpen) { topen[path] = false; renderTree(); return; }
    if (path.indexOf('/') < 0) {
      var it = items[Number(path.slice(1))];
      if (!n) { var r = await request('node', { key: { k: it.k, key: it.key }, peek: true }); if (!r.node) return; n = tnodes[path] = r.node; }
    } else if (n && !n.children && n.ck != null) {
      var rc = await request('children', { ck: n.ck });
      n.children = rc.nodes;
    }
    topen[path] = true;
    renderTree();
  }

  // ---------- diagram ----------
  function walk(n, fn) { if (!n) return null; if (fn(n)) return n; var k = n.children || []; for (var i = 0; i < k.length; i++) { var r = walk(k[i], fn); if (r) return r; } return null; }
  function byId(id) { return walk(root, function (n) { return String(n.id) === String(id); }); }
  function renderDiagram() {
    var host = $('diagram');
    if (!root) { host.innerHTML = '<p class="empty">Pick a component in the tree.</p>'; return; }
    var r = XsdDiagram.render(root, { isOpen: function (n) { return n === root ? !!n.children : (!!open[n.id] && !!n.children); }, selected: selected ? selected.id : null, idAttr: true });
    host.innerHTML = r.svg;
    var svg = host.firstChild;
    svg.setAttribute('width', Math.round(r.w * scale));
    svg.setAttribute('height', Math.round(r.h * scale));
    host.dataset.w = r.w; host.dataset.h = r.h;
  }
  function applyScale() {
    var svg = $('diagram').firstChild;
    if (!svg || !svg.setAttribute) return;
    svg.setAttribute('width', Math.round(Number($('diagram').dataset.w) * scale));
    svg.setAttribute('height', Math.round(Number($('diagram').dataset.h) * scale));
  }
  async function toggleBox(id) {
    var n = byId(id);
    if (!n) return;
    if (open[n.id]) { delete open[n.id]; renderDiagram(); return; }
    if (!n.children && n.ck != null) { var r = await request('children', { ck: n.ck }); n.children = r.nodes; }
    open[n.id] = true;
    // compositors inside the new content are open at once: only element boxes wait for a click
    (n.children || []).forEach(function (c) { openCompositors(c); });
    renderDiagram();
  }
  function openCompositors(n) { if (n.k !== 'element' && n.children) { open[n.id] = true; n.children.forEach(openCompositors); } }
  async function expandAll() {
    if (!root) return;
    var leaves = [];
    walk(root, function (n) { if (n !== root && n.k === 'element' && n.ck != null && !open[n.id]) leaves.push(n); return false; });
    var isVisible = function (n) { var path = []; var found = (function f(x) { if (x === n) return true; var k = x.children || []; for (var i = 0; i < k.length; i++) { if (f(k[i])) { path.push(x); return true; } } return false; })(root); return found && path.every(function (p) { return p === root || open[p.id]; }); };
    leaves = leaves.filter(isVisible).slice(0, 60);
    for (var i = 0; i < leaves.length; i++) {
      var n = leaves[i];
      if (!n.children) { var r = await request('children', { ck: n.ck }); n.children = r.nodes; }
      open[n.id] = true;
      n.children.forEach(openCompositors);
    }
    renderDiagram();
    setStatus(leaves.length ? 'Opened ' + plural(leaves.length, 'box', 'boxes') + ' one level further.' : 'Every box with content is open.');
  }
  function fit() {
    var wrap = $('diagramWrap');
    var w = Number($('diagram').dataset.w || 0), h = Number($('diagram').dataset.h || 0);
    if (!w || !h) return;
    scale = Math.max(0.25, Math.min(1.5, (wrap.clientWidth - 16) / w, (wrap.clientHeight - 16) / h));
    applyScale();
  }

  // ---------- details ----------
  function srcLink(src, label) { if (!src) return ''; return '<a href="#" class="src" data-f="' + src.f + '" data-l="' + src.l + '" data-c="' + src.c + '">' + esc(label || (shortFile(data.fileNames[src.f]) + ':' + src.l)) + '</a>'; }
  function factsRow(a, b) { return b ? '<tr><th>' + a + '</th><td>' + b + '</td></tr>' : ''; }
  function valuesHtml(t) {
    if (!t) return '';
    var f = t.facets || {}, rows = [];
    rows.push(factsRow('Based on', '<code>' + esc(t.base || t.builtin) + '</code>' + (t.builtin && t.base && t.builtin !== t.base && t.builtin !== 'list' && t.builtin !== 'union' ? ' <span class="muted">(' + esc(t.builtin) + ')</span>' : '')));
    if (t.list) rows.push(factsRow('List of', '<code>' + esc(t.list.base || t.list.builtin) + '</code>'));
    if (t.union) rows.push(factsRow('Union of', t.union.map(function (u) { return '<code>' + esc(u.base || u.builtin) + '</code>'; }).join(', ')));
    Object.keys(f).forEach(function (k) {
      if (k === 'enumeration') rows.push(factsRow('One of (' + f[k].length + ')', '<div class="enum">' + f[k].slice(0, 200).map(function (e) { return '<code>' + esc(e.value) + '</code>' + (e.doc ? ' <span class="muted">' + esc(e.doc) + '</span>' : ''); }).join('<br>') + (f[k].length > 200 ? '<br>...' : '') + '</div>'));
      else if (k === 'pattern' || k === 'basePattern') rows.push(factsRow(k === 'pattern' ? 'Pattern' : 'Base pattern', f[k].map(function (p) { return '<code>' + esc(p) + '</code>'; }).join('<br>')));
      else rows.push(factsRow(esc(k), '<code>' + esc(f[k]) + '</code>'));
    });
    return '<h4>Values</h4><table class="facts">' + rows.join('') + '</table>';
  }
  function attrsHtml(attrs) {
    if (!attrs || !attrs.length) return '';
    return '<h4>Attributes (' + attrs.length + ')</h4><table class="attrs"><tr><th>Name</th><th>Type</th><th>Use</th></tr>' + attrs.map(function (a) {
      return '<tr title="' + esc((a.doc || '') + (a.from ? '\nfrom ' + a.from : '') + (a.group ? '\ngroup ' + a.group : '')) + '"><td><code>' + esc(a.any ? 'any (' + a.ns + ')' : a.name) + '</code>' + (a.src ? ' ' + srcLink(a.src, '↗') : '') + '</td><td><code>' + esc(a.type || '') + '</code>' + (a.text && a.text.facets && a.text.facets.enumeration ? '<div class="muted small">' + esc(a.text.facets.enumeration.slice(0, 8).map(function (e) { return e.value; }).join(' | ')) + (a.text.facets.enumeration.length > 8 ? ' | ...' : '') + '</div>' : '') + '</td><td>' + esc(a.use || '') + (a.fixed != null ? '<div class="muted small">fixed ' + esc(a.fixed) + '</div>' : (a.def != null ? '<div class="muted small">default ' + esc(a.def) + '</div>' : '')) + (a.warn ? '<div class="warn small">' + esc(a.warn) + '</div>' : '') + '</td></tr>';
    }).join('') + '</table>';
  }
  function renderDetails(n) {
    var d = $('details');
    if (!n) { d.innerHTML = ''; return; }
    if (n.k === 'attr') n = { k: 'attribute', name: n.a.name, type: n.a.type, doc: n.a.doc, src: n.a.src, text: n.a.text, def: n.a.def, fixed: n.a.fixed, warn: n.a.warn };
    var kind = n.k === 'group' ? 'Group' : (KIND_ONE[n.k] || n.k);
    var h = '<h3><span class="kind">' + esc(kind) + '</span> ' + esc(XsdDiagram.title(n)) + '</h3>';
    if (n.ns) h += '<div class="ns">' + esc(n.ns) + '</div>';
    var rows = [];
    if (n.k === 'element') {
      rows.push(factsRow('Type', '<code>' + esc(n.type) + '</code>' + (n.tkey ? ' <a href="#" class="goto" data-k="' + esc(n.tkey.k) + '" data-key="' + esc(n.tkey.key) + '">open</a>' : '')));
      rows.push(factsRow('Occurs', esc(occ(n) || '1..1') + (n.min === 0 ? ' <span class="muted">(optional)</span>' : '')));
      if (n.ref && n.ekey) rows.push(factsRow('Global element', '<a href="#" class="goto" data-k="element" data-key="' + esc(n.ekey.key) + '">open</a>'));
    }
    if (n.k === 'sequence' || n.k === 'choice' || n.k === 'all' || n.k === 'group' || n.k === 'any') rows.push(factsRow('Occurs', esc(occ(n) || '1..1')));
    if (n.k === 'any') rows.push(factsRow('Namespaces', '<code>' + esc(n.ns) + '</code>'), factsRow('processContents', esc(n.pc)));
    if (n.k === 'attribute' && n.type) rows.push(factsRow('Type', '<code>' + esc(n.type) + '</code>'));
    if (n.base) rows.push(factsRow('Derived', esc(n.base)));
    if (n.mixed) rows.push(factsRow('Mixed', 'text between the child elements'));
    if (n.abstract) rows.push(factsRow('Abstract', 'yes'));
    if (n.nillable) rows.push(factsRow('Nillable', 'yes'));
    if (n.def != null) rows.push(factsRow('Default', '<code>' + esc(n.def) + '</code>'));
    if (n.fixed != null) rows.push(factsRow('Fixed', '<code>' + esc(n.fixed) + '</code>'));
    if (n.sg) rows.push(factsRow('Substitution group', '<code>' + esc(n.sg) + '</code>'));
    if (n.subs) rows.push(factsRow('Substitutes', esc(n.subs.join(', '))));
    if (n.derived) rows.push(factsRow('Derived types', esc(n.derived.join(', '))));
    rows.push(factsRow('Defined in', srcLink(n.src)));
    if (n.at) rows.push(factsRow('Used at', srcLink(n.at)));
    h += '<table class="facts">' + rows.join('') + '</table>';
    if (n.warn) h += '<p class="warn">' + esc(n.warn) + '</p>';
    if (n.doc) h += '<h4>Documentation</h4><div class="doc">' + esc(n.doc) + '</div>';
    if (n.text) h += valuesHtml(n.text);
    h += attrsHtml(n.attrs);
    var btns = [];
    if (n.src) btns.push('<button class="src-btn" data-f="' + n.src.f + '" data-l="' + n.src.l + '" data-c="' + n.src.c + '">Go to source</button>');
    if (n.k === 'element' && (n.comp || n.ekey)) btns.push('<button id="sampleBtn" title="Zovo Pro tool: write a sample XML document with this element as its root">Sample XML (Pro)</button>');
    if (btns.length) h += '<p class="btns">' + btns.join(' ') + '</p>';
    d.innerHTML = h;
    d.dataset.ekey = n.comp && n.k === 'element' && rootItem ? rootItem.key : (n.ekey ? n.ekey.key : '');
  }

  // ---------- selection ----------
  async function selectItem(it, keepView) {
    if (!it) return;
    var r = await request('node', { key: { k: it.k, key: it.key } });
    if (!r.node) { setStatus('That component is no longer in the schema.'); return; }
    rootItem = it;
    root = r.node;
    open = {};
    open[root.id] = true;
    (root.children || []).forEach(openCompositors);
    selected = root;
    state.sel = { k: it.k, key: it.key };
    vscode.setState(state);
    if (!keepView) scale = 1;
    renderTree();
    renderDiagram();
    renderDetails(root);
    if (view !== 'diagram') showView('diagram');
    var row = document.querySelector('.row.sel'); if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }
  function itemByKey(k, key) { for (var i = 0; i < items.length; i++) if (items[i].k === k && items[i].key === key) return items[i]; return null; }
  function reveal(f, l, c) { vscode.postMessage({ type: 'reveal', f: Number(f), l: Number(l), c: Number(c) }); }

  // ---------- files ----------
  var STATUS = { ok: 'found', moved: 'found elsewhere', builtin: 'built in', 'remote-mapped': 'web address, local file used', missing: 'not found', 'remote-missing': 'web address, not downloaded', nolocation: 'not found' };
  function renderFiles() {
    if (!data) return;
    var h = '<table class="files"><tr><th>File</th><th>Namespace</th><th>Imports and includes</th></tr>';
    data.files.forEach(function (f, i) {
      var refs = f.refs.map(function (r) {
        var bad = r.status === 'missing' || r.status === 'remote-missing' || r.status === 'nolocation';
        return '<div class="' + (bad ? 'warn' : '') + '"><code>' + esc(r.kind) + '</code> ' + (r.ns ? '<span class="muted">' + esc(r.ns) + '</span> ' : '') + (r.path ? '→ ' + esc(r.path) : esc(r.loc || '')) + ' <span class="st">' + esc(STATUS[r.status] || r.status) + '</span>' + (r.note && bad ? '<div class="small">' + esc(r.note) + '</div>' : '') + '</div>';
      }).join('');
      h += '<tr><td><a href="#" class="openfile" data-url="' + esc(f.url) + '">' + esc(f.path) + '</a>' + (f.kind === 'wsdl' ? ' <span class="muted">(WSDL)</span>' : '') + (f.error ? '<div class="warn small">' + esc(f.error) + '</div>' : '') + '</td><td><code>' + esc(f.namespaces.join(', ') || '(none)') + '</code></td><td>' + (refs || '<span class="muted">none</span>') + '</td></tr>';
    });
    h += '</table>';
    if (data.problems.length) h = '<h4>Problems (' + data.problemCount + ')</h4><ul class="problems">' + data.problems.map(function (p) { return '<li>' + esc(p.message) + '</li>'; }).join('') + '</ul>' + h;
    $('filesView').innerHTML = h;
  }
  function showView(v) {
    view = v;
    $('tabDiagram').classList.toggle('on', v === 'diagram'); $('tabDiagram').setAttribute('aria-selected', v === 'diagram');
    $('tabFiles').classList.toggle('on', v === 'files'); $('tabFiles').setAttribute('aria-selected', v === 'files');
    $('diagramWrap').hidden = v !== 'diagram';
    $('filesView').hidden = v !== 'files';
    if (v === 'files') renderFiles();
  }

  // ---------- messages ----------
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.reqId && pending[m.reqId]) { var f = pending[m.reqId]; delete pending[m.reqId]; f(m); return; }
    if (m.type === 'load') onLoad(m);
    else if (m.type === 'error') onError(m);
    else if (m.type === 'notice') setStatus(m.message);
  });
  function onLoad(m) {
    data = m;
    items = m.items.map(function (it, i) { it.i = i; return it; });
    tnodes = {}; topen = {};
    $('err').hidden = true; $('main').hidden = false;
    $('name').textContent = m.name + ' · ' + plural(m.files.length, 'file', 'files');
    var b = $('banner');
    var bad = m.problemCount;
    if (bad) { b.hidden = false; b.innerHTML = esc(plural(bad, 'problem', 'problems')) + ' in the schema set (imports that could not be resolved, files that could not be read or names defined twice). <a href="#" id="showFiles">Show</a>'; } else b.hidden = true;
    setStatus(m.name + (m.kind === 'wsdl' ? ' (WSDL, ' + plural(m.schemas, 'embedded schema', 'embedded schemas') + ')' : '') + ' · this file: ' + countsText(m.own) + (m.files.length > 1 ? ' · whole set (' + plural(m.files.length, 'file', 'files') + '): ' + countsText(m.all) : ''));
    var want = m.select || state.sel;
    var it = want ? itemByKey(want.k, want.key) : null;
    if (!it) { var own = items.filter(function (x) { return x.own; }); it = own.filter(function (x) { return x.k === 'element'; })[0] || own[0] || items[0]; }
    if (view === 'files') renderFiles();
    if (it) selectItem(it, !!want); else { root = null; rootItem = null; renderTree(); renderDiagram(); renderDetails(null); }
  }
  function onError(m) {
    data = null; items = []; root = null;
    $('main').hidden = true; $('err').hidden = false; $('banner').hidden = true;
    $('name').textContent = m.name;
    $('errTitle').textContent = m.notSchema ? 'This is not an XML Schema file' : 'This file could not be read';
    $('errText').textContent = (m.line ? 'Line ' + m.line + (m.col ? ', column ' + m.col : '') + ': ' : '') + m.message;
    setStatus(m.name + ': ' + m.message);
  }

  // ---------- events ----------
  $('tree').addEventListener('click', function (e) {
    var g = e.target.closest('[data-grp]');
    if (g) { var k = g.dataset.grp; collapsed[k] = !collapsed[k]; renderTree(); return; }
    var tw = e.target.closest('[data-tw]');
    if (tw && (tw.classList.contains('open') || tw.classList.contains('closed'))) { toggleTree(tw.dataset.tw); return; }
    var row = e.target.closest('.row[data-path]');
    if (!row) return;
    if (row.dataset.item != null) selectItem(items[Number(row.dataset.item)]);
    else { var n = tnodes[row.dataset.path]; if (n) { selected = n; renderDetails(n); document.querySelectorAll('#tree .row.sel').forEach(function (r) { r.classList.remove('sel'); }); row.classList.add('sel'); } }
  });
  $('tree').addEventListener('dblclick', function (e) {
    var row = e.target.closest('.row[data-path]');
    if (!row) return;
    if (row.dataset.item != null) { var it = items[Number(row.dataset.item)]; reveal(it.f, it.l, it.c); return; }
    var n = tnodes[row.dataset.path];
    var src = n && (n.k === 'attr' ? n.a.src : (n.at || n.src));
    if (src) reveal(src.f, src.l, src.c);
  });
  $('diagram').addEventListener('click', function (e) {
    var tg = e.target.closest('[data-tg]');
    if (tg) { toggleBox(tg.getAttribute('data-tg')); return; }
    var g = e.target.closest('[data-id]');
    if (!g) return;
    var n = byId(g.getAttribute('data-id'));
    if (!n) return;
    selected = n;
    document.querySelectorAll('#diagram .n.sel').forEach(function (x) { x.classList.remove('sel'); });
    g.classList.add('sel');
    renderDetails(n);
  });
  $('diagram').addEventListener('dblclick', function (e) {
    var g = e.target.closest('[data-id]');
    if (!g || e.target.closest('[data-tg]')) return;
    var n = byId(g.getAttribute('data-id'));
    var src = n && (n.at || n.src);
    if (src) reveal(src.f, src.l, src.c);
  });
  $('details').addEventListener('click', function (e) {
    var a = e.target.closest('.src, .src-btn');
    if (a) { e.preventDefault(); reveal(a.dataset.f, a.dataset.l, a.dataset.c); return; }
    var go = e.target.closest('.goto');
    if (go) { e.preventDefault(); var it = itemByKey(go.dataset.k, go.dataset.key); if (it) selectItem(it); return; }
    if (e.target.id === 'sampleBtn') {
      var key = selected && selected.ekey ? selected.ekey : (rootItem && rootItem.k === 'element' && selected === root ? { k: 'element', key: rootItem.key } : null);
      vscode.postMessage({ type: 'sample', key: key });
    }
  });
  $('filesView').addEventListener('click', function (e) { var a = e.target.closest('.openfile'); if (a) { e.preventDefault(); vscode.postMessage({ type: 'openFile', url: a.dataset.url }); } });
  $('banner').addEventListener('click', function (e) { if (e.target.id === 'showFiles') { e.preventDefault(); showView('files'); } });
  $('q').addEventListener('input', function () { renderTree(); });
  $('q').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var v = visibleItems(); if (v.list.length) selectItem(v.list[0]); }
    if (e.key === 'Escape') { $('q').value = ''; renderTree(); }
  });
  $('scope').addEventListener('change', function () { state.scope = $('scope').value; vscode.setState(state); renderTree(); });
  $('tabDiagram').addEventListener('click', function () { showView('diagram'); });
  $('tabFiles').addEventListener('click', function () { showView('files'); });
  $('zoomIn').addEventListener('click', function () { scale = Math.min(3, scale * 1.2); applyScale(); });
  $('zoomOut').addEventListener('click', function () { scale = Math.max(0.2, scale / 1.2); applyScale(); });
  $('fit').addEventListener('click', fit);
  $('expandAll').addEventListener('click', function () { expandAll(); });
  $('openText').addEventListener('click', function () { vscode.postMessage({ type: 'openText' }); });
  $('errOpenText').addEventListener('click', function () { vscode.postMessage({ type: 'reopenText' }); });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); $('q').select(); }
  });
  if (state.scope) $('scope').value = state.scope;
  vscode.postMessage({ type: 'ready' });
}());
