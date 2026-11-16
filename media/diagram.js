/* XSD Viewer & Schema Diagram by Zovo: the schema diagram as SVG text, from the content-model nodes of
   src/core/model.js. Runs in the viewer's webview (window.XsdDiagram) and in Node for the HTML documentation, so both
   draw the same picture. Layout: a left-to-right tree; an element box shows its name and type, a pill shows each
   sequence, choice or all; occurs other than 1..1 are written under the box. No inline styles: colours come from
   CSS classes (the viewer's theme or the documentation's style sheet). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XsdDiagram = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var CH = 7.1, CHB = 7.7, PAD = 12, EL_H = 38, PILL_H = 22, PILL_W = 70, SMALL_H = 28, HGAP = 34, VGAP = 12, OCC_H = 13, ATTR_H = 15;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function occ(n) { if (n.min == null) return ''; var max = n.max === -1 ? '∞' : n.max; return (n.min === 1 && n.max === 1) ? '' : n.min + '..' + max; }
  function hasKids(n) { return n.ck != null || (n.children && n.children.length > 0); }
  function typeLine(n) {
    var parts = [];
    if (n.k === 'element') { if (n.type && n.type !== '(anonymous)') parts.push(n.type); else if (n.tk === 'complex') parts.push('complex type'); else if (n.text) parts.push(n.text.base || 'text'); }
    if (n.k === 'complexType') parts.push(n.base || 'complex type');
    if (n.k === 'simpleType' && n.text) parts.push((n.text.builtin === 'list' ? 'list' : n.text.builtin === 'union' ? 'union' : 'restriction of ' + (n.text.base || n.text.builtin)));
    if (n.k === 'attribute') parts.push(n.type || 'attribute');
    if (n.k === 'attributeGroup') parts.push((n.attrs || []).length + ' attributes');
    if (n.k === 'groupDef') parts.push('model group');
    if (n.attrs && n.attrs.length && n.k !== 'attributeGroup') parts.push('@' + n.attrs.length);
    return parts.join(' · ');
  }
  function title(n) {
    if (n.k === 'any') return 'any ' + (n.ns || '##any');
    if (n.k === 'base') return 'extends ' + n.name;
    if (n.k === 'group') return 'group ' + n.name;
    if (n.k === 'complexType' || n.k === 'simpleType' || n.k === 'groupDef' || n.k === 'attributeGroup' || n.k === 'attribute') return n.name;
    return n.name || '';
  }
  function size(n, isRoot) {
    if (n.k === 'sequence' || n.k === 'choice' || n.k === 'all') return { w: PILL_W, h: PILL_H };
    if (n.k === 'any' || n.k === 'base' || n.k === 'group') return { w: Math.max(80, title(n).length * CH + PAD * 2 + 14), h: SMALL_H };
    var w = Math.max(title(n).length * CHB, typeLine(n).length * (CH - 0.6)) + PAD * 2 + 10 + (hasKids(n) ? 12 : 0);
    var h = EL_H;
    if (isRoot && n.attrs && n.attrs.length) {
      var shown = Math.min(n.attrs.length, 8);
      for (var i = 0; i < shown; i++) { var a = n.attrs[i]; w = Math.max(w, (attrText(a)).length * (CH - 0.6) + PAD * 2 + 4); }
      h += shown * ATTR_H + (n.attrs.length > 8 ? ATTR_H : 0) + 6;
    }
    if (isRoot && n.k === 'simpleType' && n.text) { var f = facetLine(n.text); if (f) { w = Math.max(w, f.length * (CH - 0.6) + PAD * 2); h += ATTR_H + 4; } }
    return { w: Math.min(Math.round(w), 520), h: h };
  }
  function attrText(a) { return '@' + a.name + (a.type ? '  ' + a.type : '') + (a.use === 'required' ? '  required' : ''); }
  function facetLine(t) {
    var f = t.facets || {};
    if (f.enumeration) return 'one of: ' + f.enumeration.slice(0, 6).map(function (e) { return e.value; }).join(', ') + (f.enumeration.length > 6 ? ', ... (' + f.enumeration.length + ')' : '');
    var parts = [];
    ['length', 'minLength', 'maxLength', 'minInclusive', 'maxInclusive', 'minExclusive', 'maxExclusive', 'totalDigits', 'fractionDigits'].forEach(function (k) { if (f[k] != null) parts.push(k + ' ' + f[k]); });
    if (f.pattern) parts.push('pattern ' + f.pattern[0]);
    return parts.join(', ');
  }
  function clip(s, w) { var max = Math.max(4, Math.floor((w - PAD * 2) / CH)); return s.length > max ? s.slice(0, max - 1) + '…' : s; }

  /**
   * render(root, opts) -> { svg, w, h }
   * opts: { isOpen(node) -> bool (default: children loaded), selected: node id, idAttr: true to add data-id }
   */
  function render(rootNode, opts) {
    opts = opts || {};
    var isOpen = opts.isOpen || function (n) { return !!(n.children && n.children.length); };
    var boxes = [], edges = [];
    function lay(n, x, top, isRoot) {
      var s = size(n, isRoot);
      var o = occ(n);
      var oh = o ? OCC_H : 0;
      var kids = isOpen(n) && n.children ? n.children : [];
      if (!kids.length) { boxes.push({ n: n, x: x, y: top, w: s.w, h: s.h, o: o, root: isRoot }); return s.h + oh; }
      var cx = x + s.w + HGAP, y = top, centers = [];
      for (var i = 0; i < kids.length; i++) {
        var before = boxes.length;
        var hk = lay(kids[i], cx, y, false);
        var kb = null;
        for (var j = before; j < boxes.length; j++) if (boxes[j].n === kids[i]) { kb = boxes[j]; break; }
        if (kb) centers.push(kb.y + kb.h / 2);
        y += hk + VGAP;
      }
      var total = y - VGAP - top;
      var ny = Math.max(top, top + (centers.length ? (centers[0] + centers[centers.length - 1]) / 2 - top - s.h / 2 : (total - s.h) / 2));
      boxes.push({ n: n, x: x, y: ny, w: s.w, h: s.h, o: o, root: isRoot });
      var px = x + s.w, py = ny + (isRoot && s.h > EL_H ? EL_H / 2 : s.h / 2), mid = px + HGAP / 2;
      for (var c = 0; c < centers.length; c++) edges.push('M' + px + ' ' + py + 'H' + mid + 'V' + centers[c] + 'H' + cx);
      return Math.max(total, ny - top + s.h + oh);
    }
    var H = lay(rootNode, 8, 8, true) + 16;
    var W = 0;
    boxes.forEach(function (b) { W = Math.max(W, b.x + b.w + 16); });
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" class="xsd-diagram" width="' + Math.ceil(W) + '" height="' + Math.ceil(H) + '" viewBox="0 0 ' + Math.ceil(W) + ' ' + Math.ceil(H) + '" role="img">');
    out.push('<g class="edges"><path d="' + edges.join('') + '"/></g>');
    boxes.forEach(function (b) {
      var n = b.n, id = opts.idAttr ? ' data-id="' + n.id + '"' : '', sel = opts.selected === n.id ? ' sel' : '';
      var cls, body = '';
      if (n.k === 'sequence' || n.k === 'choice' || n.k === 'all') {
        cls = 'n comp ' + n.k;
        body = '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="11"/>'
          + '<text class="t-comp" x="' + (b.x + b.w / 2) + '" y="' + (b.y + 15) + '" text-anchor="middle">' + n.k + '</text>';
      } else if (n.k === 'any' || n.k === 'base' || n.k === 'group') {
        cls = 'n small ' + n.k + (n.warn ? ' warn' : '');
        body = '<rect x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="4"/>'
          + '<text class="t-small" x="' + (b.x + PAD) + '" y="' + (b.y + 18) + '">' + esc(clip(title(n), b.w - 12)) + '</text>';
      } else {
        var optional = n.min === 0;
        cls = 'n box k-' + n.k + (optional ? ' opt' : '') + (n.max === -1 || n.max > 1 ? ' rep' : '') + (n.warn ? ' warn' : '') + (n.abstract ? ' abstract' : '') + (b.root ? ' root' : '');
        body = '<rect class="bg" x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="5"/>'
          + '<rect class="strip" x="' + b.x + '" y="' + b.y + '" width="5" height="' + b.h + '" rx="2"/>'
          + '<text class="t-name" x="' + (b.x + PAD) + '" y="' + (b.y + 16) + '">' + esc(clip(title(n), b.w - (hasKids(n) ? 14 : 0))) + '</text>'
          + '<text class="t-type" x="' + (b.x + PAD) + '" y="' + (b.y + 31) + '">' + esc(clip(typeLine(n), b.w)) + '</text>';
        if (b.root && n.attrs && n.attrs.length) {
          var ay = b.y + EL_H + 2;
          body += '<line class="sep" x1="' + (b.x + 6) + '" y1="' + (ay - 1) + '" x2="' + (b.x + b.w - 6) + '" y2="' + (ay - 1) + '"/>';
          for (var i = 0; i < Math.min(n.attrs.length, 8); i++) body += '<text class="t-attr' + (n.attrs[i].use === 'required' ? ' req' : '') + '" x="' + (b.x + PAD) + '" y="' + (ay + 12 + i * ATTR_H) + '">' + esc(clip(attrText(n.attrs[i]), b.w)) + '</text>';
          if (n.attrs.length > 8) body += '<text class="t-attr" x="' + (b.x + PAD) + '" y="' + (ay + 12 + 8 * ATTR_H) + '">' + esc('+ ' + (n.attrs.length - 8) + ' more') + '</text>';
        }
        if (b.root && n.k === 'simpleType' && n.text) { var fl = facetLine(n.text); if (fl) body += '<text class="t-attr" x="' + (b.x + PAD) + '" y="' + (b.y + EL_H + 12) + '">' + esc(clip(fl, b.w)) + '</text>'; }
        if (hasKids(n) && !b.root) {
          var open = isOpen(n);
          body += '<g class="tg"' + (opts.idAttr ? ' data-tg="' + n.id + '"' : '') + '><circle cx="' + (b.x + b.w) + '" cy="' + (b.y + b.h / 2) + '" r="7"/>'
            + '<path d="M' + (b.x + b.w - 3.5) + ' ' + (b.y + b.h / 2) + 'h7' + (open ? '' : 'M' + (b.x + b.w) + ' ' + (b.y + b.h / 2 - 3.5) + 'v7') + '"/></g>';
        }
      }
      out.push('<g class="' + cls + sel + '"' + id + '><title>' + esc(tooltip(n)) + '</title>' + body + '</g>');
      if (b.o) out.push('<text class="t-occ" x="' + (b.x + b.w - 2) + '" y="' + (b.y + b.h + 11) + '" text-anchor="end">' + esc(b.o) + '</text>');
    });
    out.push('</svg>');
    return { svg: out.join(''), w: Math.ceil(W), h: Math.ceil(H) };
  }
  function tooltip(n) {
    var t = title(n);
    var tl = typeLine(n);
    var o = occ(n);
    return t + (tl ? '\n' + tl : '') + (o ? '\noccurs ' + o : '') + (n.doc ? '\n' + String(n.doc).slice(0, 300) : '') + (n.warn ? '\n' + n.warn : '');
  }

  return { render: render, occ: occ, typeLine: typeLine, title: title, esc: esc, facetLine: facetLine };
}));
