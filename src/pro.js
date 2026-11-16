'use strict';
// Zovo Pro for XSD Viewer & Schema Diagram, on top of the shared license module (src/license, copied unchanged from
// factory/sprint/license by apply.sh). Three Pro tools, 1 free try each on this computer (owner decision 15 Nov). A try
// counts only after the tool showed its result (the sample XML written and open, the validation result in the Problems
// panel, the documentation folder written); Escape, Cancel or an error never uses one.
// Nothing about Pro shows on open or activation: the panel appears only after a click on a Pro tool with no tries left.
const { createLicense } = require('./license');
const { currentSurface } = require('./reach');

const SKU = 'xsd-viewer-pro';
// The one place this listing sets its free tries (the license module counts 1 too, TRIES1).
const TRIAL_USES = 1;
const TRIAL_KEY = 'xsdViewer.proTrial';

const FEATURES = {
  sample: {
    title: 'Generate sample XML',
    detail: 'Writes a sample XML document for any global element of the schema set: required content always, optional elements and attributes, repeats and comments at choices if you want them, values that keep enumerations, patterns, lengths and number limits.',
  },
  validate: {
    title: 'Validate XML',
    detail: 'Checks an XML file against the schema set with libxml2 on this computer (no Java, no network) and puts every error with its line in the Problems panel. With Zovo Pro it checks again each time you save the file.',
  },
  docs: {
    title: 'HTML documentation',
    detail: 'Writes a folder of HTML pages for the schema set: an index of files, imports and components, and one page per element and type with its diagram, content, attributes, values, documentation and where it is used.',
  },
};
const TOOLS = Object.values(FEATURES).map((f) => f.title);

function surfaceOf(arg) {
  const s = currentSurface();
  if (s) return s;
  if (arg && typeof arg === 'object' && typeof arg.surface === 'string') return arg.surface;
  return undefined;
}

function createPro({ vscode, context, license, prefix = 'xsdViewer', productName = 'XSD Viewer & Schema Diagram' }) {
  const emitter = new vscode.EventEmitter();
  const lic = license || createLicense({ vscode, context, sku: SKU, name: 'Zovo', product: productName, commandPrefix: prefix, proTools: TOOLS });
  if (lic.onDidChange) lic.onDidChange(() => emitter.fire(lic.isPro(SKU)));

  // Counts never go down in a session: globalState can hand back an older value for a moment after a write, so the
  // highest count seen here wins.
  const seen = {};
  const used = (f) => Math.max(Number((context.globalState.get(TRIAL_KEY) || {})[f]) || 0, seen[f] || 0);
  const left = (f) => (FEATURES[f] ? Math.max(0, TRIAL_USES - used(f)) : 0);
  const licensed = () => lic.isPro(SKU);

  /** Before a Pro tool runs: true when it may run (licensed, or a free try left). Otherwise the one panel. */
  async function allowed(f, arg) {
    if (licensed()) { if (lic.refresh) lic.refresh(); return true; }
    if (left(f) > 0) return true;
    const feat = FEATURES[f] || { title: 'This tool', detail: '' };
    const surface = surfaceOf(arg);
    // No `tools` list here: the module then lists the other Pro tools with their used tries (config.js pro_info).
    return !!(await lic.requirePro(feat.title, { detail: feat.detail, triesUsed: used(f), toolId: f, ...(surface ? { surface } : {}) }));
  }

  /** After the tool showed its result: counts one free try (nothing when licensed). */
  async function produced(f) {
    if (licensed() || !FEATURES[f]) return;
    const m = { ...(context.globalState.get(TRIAL_KEY) || {}) };
    for (const k of Object.keys(seen)) m[k] = Math.max(Number(m[k]) || 0, seen[k]);
    m[f] = used(f) + 1;
    seen[f] = m[f];
    await context.globalState.update(TRIAL_KEY, m);
    const l = left(f);
    vscode.window.setStatusBarMessage(TRIAL_USES === 1
      ? `Zovo Pro: the free try of "${FEATURES[f].title}" is used on this computer.`
      : `Zovo Pro: free try ${used(f)} of ${TRIAL_USES} of "${FEATURES[f].title}" used${l ? `, ${l} left` : ''} on this computer.`, 8000);
    emitter.fire(false);
  }

  context.subscriptions.push(emitter);
  return {
    SKU, FEATURES, TRIAL_USES,
    get licensed() { return licensed(); },
    ready: lic.ready,
    allowed, produced, left, used,
    tries: () => Object.fromEntries(Object.keys(FEATURES).map((f) => [f, left(f)])),
    handleUri: (uri) => (lic.handleUri ? lic.handleUri(uri) : undefined),
    onDidChange: emitter.event,
    license: lic,
  };
}

module.exports = { createPro, FEATURES, SKU, TRIAL_USES, TRIAL_KEY, TOOLS, surfaceOf };
