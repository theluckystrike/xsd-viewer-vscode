# Changelog

## 0.1.0

- First release. Opens .xsd files and the schemas inside .wsdl files as a component tree, a diagram and a details pane, offline.
- Follows xs:include, xs:import, xs:redefine and xs:override on local files, chameleon includes too. Web addresses are never downloaded; a workspace file with the same namespace is used.
- Search in every file of the schema set, double-click to open the text at a line, a Files tab with each import and where it was found.
- The viewer is an optional editor: .xsd and .wsdl files keep opening as text.
- Zovo Pro tools: Generate sample XML; Validate XML (libxml2 in WebAssembly, errors in the Problems panel); HTML documentation (1 free try each).
