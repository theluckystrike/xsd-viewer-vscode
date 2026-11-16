'use strict';
// REACH1: this listing's Pro tools for the viewer toolbar row and the Explorer entries (src/reach.js).
module.exports = {
  prefix: 'xsdViewer',
  triesKey: 'xsdViewer.proTrial',
  slot: '.reach-slot',
  tools: [
    { id: 'sample', title: 'Generate sample XML', command: 'xsdViewer.sample' },
    { id: 'validate', title: 'Validate XML', command: 'xsdViewer.validate' },
    { id: 'docs', title: 'HTML documentation', command: 'xsdViewer.docs' },
  ],
};
