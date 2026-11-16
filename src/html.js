'use strict';
// Webview HTML for the XSD Viewer. Kept free of the vscode module so tests can check the CSP: no remote origin anywhere
// (default-src 'none'), scripts and styles only from the extension's media folder or with the page nonce, no inline
// style attributes (the diagram is drawn with CSS classes).
const crypto = require('crypto');
const { footerHtml, FOOTER_CSS } = require('./support');

const PREFIX = 'xsdViewer';

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function csp(cspSource, n) {
  return ["default-src 'none'", `style-src ${cspSource} 'nonce-${n}'`, `script-src 'nonce-${n}'`, `img-src ${cspSource} data:`, `font-src ${cspSource}`].join('; ');
}

/** p: { cspSource, media(name) -> uri string, title, nonce?, showSupportLinks?, head?(nonce) } */
function viewerHtml(p) {
  const n = p.nonce || crypto.randomBytes(24).toString('base64url');
  const footer = footerHtml(PREFIX, p.showSupportLinks !== false, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(p.cspSource, n)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escapeAttr(p.media('viewer.css'))}">
${footer ? `<style nonce="${n}">${FOOTER_CSS}</style>` : ''}
${typeof p.head === 'function' ? p.head(n) : ''}
<title>${escapeAttr(p.title || 'XSD')}</title>
</head>
<body>
<div id="app">
  <div id="toolbar" role="toolbar" aria-label="XSD Viewer">
    <span id="name" class="chip" title="The opened file"></span>
    <input id="q" type="search" placeholder="Search elements and types" aria-label="Search elements and types in every file of the schema set" spellcheck="false">
    <span id="hits" class="muted"></span>
    <select id="scope" aria-label="Components shown in the tree"><option value="own">This file</option><option value="all">All files</option></select>
    <span class="tabs" role="tablist"><button id="tabDiagram" role="tab" class="on" aria-selected="true">Diagram</button><button id="tabFiles" role="tab" aria-selected="false">Files</button></span>
    <span class="spacer"></span>
    <span class="grp"><button id="fit" title="Fit the diagram to the window">Fit</button><button id="zoomOut" title="Zoom out" aria-label="Zoom out">&minus;</button><button id="zoomIn" title="Zoom in" aria-label="Zoom in">+</button></span>
    <button id="expandAll" title="Open every box of the diagram one level further">Expand</button>
    <button id="openText" title="Open the schema text next to the viewer">Text</button>
    <span class="reach-slot"></span>
  </div>
  <div id="banner" hidden></div>
  <div id="main">
    <nav id="side" aria-label="Components"><div id="tree" role="tree"></div></nav>
    <section id="center">
      <div id="diagramWrap" tabindex="0"><div id="diagram"></div></div>
      <div id="filesView" hidden></div>
    </section>
    <aside id="details" aria-live="polite"></aside>
  </div>
  <div id="err" hidden><h2 id="errTitle">This file could not be read</h2><p id="errText"></p><p><button id="errOpenText">Open as text</button></p></div>
  <div id="statusbar"><span id="status" class="muted">Reading the schema...</span></div>
  <div id="footer">${footer}</div>
</div>
<script nonce="${n}" src="${escapeAttr(p.media('diagram.js'))}"></script>
<script nonce="${n}" src="${escapeAttr(p.media('viewer.js'))}"></script>
</body>
</html>`;
}

module.exports = { viewerHtml, csp, escapeAttr };
