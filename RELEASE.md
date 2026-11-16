# XSD Viewer & Schema Diagram 0.1.0 (zovo.zovo-xsd-viewer)

New listing, staged only. NICHE6 row 8, built by lane NEWB13.

- vsix: out/NEWB13-dist/zovo.zovo-xsd-viewer/zovo.zovo-xsd-viewer-0.1.0.vsix
- sha256: 2f5656b669f8a5c4a971ded0c5ab08e9beb35435ff325a3308471678567b230c (652,920 bytes, 58 files)
- Product repo: factory/products/xsd-viewer-vscode, one local commit (no remote).
- Unit tests: 234 of 234 pass with `npm test` (scripts/test.js); `node --test` in the repo runs 237 of 237. They cover the XML parser with lines, the schema set (include, import, chameleon include, redefine, web addresses mapped to workspace files, the built-in XML namespace, WSDL), the content model, example values and pattern examples, sample XML (checked with libxml2), validation, HTML documentation, the diagram, the extension and the three Pro tools against a vscode stub (A-then-B for each tool, Escape uses no try, a reload keeps the count, validate on save), and the license and rating tests copied by apply.sh.
- Real-app gate: VS Code 1.142.0 on port 9448 through buildslot, run r3 on this exact vsix: 71 PASS, 0 FAIL (out/NEWB13-data/xsd/xsd-gate-r3.json and .tsv, screenshots in out/NEWB13-data/xsd/shots/xsd-r3-*.png). Runs r1 and r2 (70 PASS, 1 FAIL each) were on an earlier build without the screenshot; both FAILs were gate timing (see below).

## What it is

- Display name: XSD Viewer & Schema Diagram (27 characters). The phrase "xsd" comes first, and the description starts with "XSD viewer".
- Keywords: xsd, xml schema, schema, xml, diagram. Engines: ^1.75.0, so it installs in Cursor and Windsurf.
- Free core: a custom text editor with priority "option" for .xsd and .wsdl, so schemas keep opening as text. It opens from the title bar, the Explorer or the Command Palette. It shows a component tree (this file or every file of the set), a left-to-right diagram with element boxes, sequence, choice and all pills and min and max occurs, and a details pane with type, occurs, defaults, documentation, facets and attributes. It follows xs:include, xs:import, xs:redefine and xs:override on local files. A web address is never downloaded; the workspace file with that namespace is used. It has search across the set, a double-click to the text at a line, a Files tab, and the schemas inside WSDL 1.1 and 2.0 files. It redraws when the text changes.
- Zovo Pro tools (1 free try each, module 2026-11-15.tries1, listing tag "xsd", tries key xsdViewer.proTrial, TRIAL_USES = 1 in src/pro.js):
  - Generate sample XML: for any global element, written next to the schema and opened. Optional parts, repeats and comments at choices are options.
  - Validate XML: libxml2 2.13.8 in WebAssembly (xmllint-wasm 5.3.0, MIT), run in a worker thread. Errors go to the Problems panel. With Pro, the file is checked again on save.
  - HTML documentation: an index and one page per component, each with its diagram.
- Nothing pops up on open. The webview CSP is default-src 'none' with nonce scripts. The extension makes no network calls. The Pro panel shows only after a click on a Pro tool with no tries left. Activation: onUri plus the implicit customEditor and command events.
- Vendored: @xmldom/xmldom 0.9.12 (MIT) and xmllint-wasm 5.3.0 (MIT), both unchanged in lib/ and listed in THIRD-PARTY-NOTICES.md.

## Samples used

- Shipped: samples/purchase-order (ours, a made-up company: purchase-order.xsd with an import and an include, common-types.xsd, order-lines.xsd, order.xml, order-with-errors.xml with 3 mistakes).
- Unit-test fixtures (ours, not in the vsix): features.xsd, service.wsdl, broken.xsd, notschema.xsd, bad-schema.xsd, remote/ (imports by web address).
- Real-app gate (not shipped, downloaded into newb13-work/xsd/dl, never executed; URLs in out/NEWB13-scripts/xsd/samples.tsv, bytes rechecked against the URLs on 15 Nov):
  - OASIS UBL 2.1 OS: the Invoice, Order and CreditNote main schemas, the 14 common files and the 3 example instances (docs.oasis-open.org/ubl/os-UBL-2.1; OASIS copyright notice, copies allowed).
  - ISO 20022 pain.001.001.11.xsd (raw from raphaelm/python-sepaxml, MIT repo; the same bytes are in hbci4j/hbci4java and phoughton/pyiso20022).
  - W3C XMLSchema.xsd and xml.xsd (w3.org/2001; W3C Software and Document License).
  - Apache CXF wsdl_first CustomerService.wsdl (apache/cxf, Apache-2.0).

## Gate coverage (r3)

- The sample opens from the Command Palette with nothing popping up. The gate reads the status counts, the 7 tree rows, the diagram boxes and the choice, and the details with the documentation and 2 attributes. The toolbar row says "1 free try" for each tool. The + on Line opens the included OrderLineType.
- On a workspace file opened from the Explorer: search finds a type in the included file, and Enter opens it. The + on Buyer opens the imported cmn:PartyType. Expand and the Files tab work. A double-click on a box opens the text at the right line (Ln 27). A change on disk redraws the tree.
- 8 real and own schemas: 3 UBL documents (14 files, 1,621 elements, 1,218 complex types, 4 simple types; 2,843 tree rows with All files), ISO 20022, XMLSchema.xsd, 2 WSDL files and ORDER.XSD. Python's XML parser gives the same per-file counts. Each opens in about 2 seconds. The web-address fixture shows the mapped and the missing imports. The broken and not-a-schema files show plain messages with no toast.
- The Explorer right-click on ORDER.XSD and ORDER.XML (upper case) shows the right entries.
- Each Pro tool runs on file A, and its output is checked:
  - The sample validates with the macOS xmllint, a separate libxml2.
  - Validation finds the 3 errors on lines 6, 7 and 26, the same lines the macOS xmllint reports.
  - Documentation writes 18 pages, and every link from the index points to a written file.
- The second use on file B (another file, from the details button, the Explorer or the toolbar row) opens the Pro panel after the click and writes nothing. The info tab shows "no free tries left" and "1 free try left". After Reload Window the row shows 0 tries left and the panel opens again.
- With the TEST key (license-page link, on the installed copy only): a UBL Invoice sample is written and passes the macOS xmllint against the 14 UBL files. The OASIS example invoice is valid. A fix typed in the editor and saved is checked again (2 errors left). The ISO 20022 documentation has 170 pages, which matches Python's count of 169 components plus the index.
- At the end: no error toasts, no CSP errors, no webview network requests, no extension-host sockets, no webview console errors, and no URL opened.

## Defects found and fixed

- README: the HTML documentation size for UBL 2.1 said "about 25 MB". The measured size is 19.5 MB, so it now says "about 20 MB".
- Release blockers fixed in this build: THIRD-PARTY-NOTICES.md and .vscodeignore were missing. test/rate-link.test.js was the pre-EXEC16 copy and failed against the Zovo Pro footer; it now matches the template listings.
- Gate (not product): the r1 screenshot showed the breadcrumb path with the home folder, so breadcrumbs are now off and the window title is neutral. The details check read the pane before it was drawn (r1), and the sample tab check ran before the editor opened (r2). Both checks now wait.

## Known limits

- Sample XML ignores identity constraints (xs:key, xs:unique). A type that contains itself stops after one level, and optional content stops at 5,000 elements.
- XML Schema 1.0 only: XSD 1.1 assertions and conditional types are not drawn, and libxml2 checks 1.0.
- libxml2 reports lines, not columns, so a problem marks its whole line.
- The 4th Pro idea in the row (schema diff) is not built.
- The gate used VS Code's simple file dialog setting, and the docs folder was picked from the quick pick, not a native dialog.
