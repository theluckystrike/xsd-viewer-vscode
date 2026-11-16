'use strict';
// Example values for simple types: the built-in type the value derives from, then the facets (enumeration first,
// pattern, length limits, numeric bounds and digits). Used by the sample XML generator.
const { example } = require('./regexgen');

const INTS = {
  integer: [null, null], long: ['-9223372036854775808', '9223372036854775807'], int: [-2147483648, 2147483647], short: [-32768, 32767], byte: [-128, 127],
  nonNegativeInteger: [0, null], positiveInteger: [1, null], nonPositiveInteger: [null, 0], negativeInteger: [null, -1],
  unsignedLong: [0, '18446744073709551615'], unsignedInt: [0, 4294967295], unsignedShort: [0, 65535], unsignedByte: [0, 255],
};
const FIXED = {
  boolean: 'true', float: '1.5', double: '1.5', duration: 'P1D', yearMonthDuration: 'P1Y', dayTimeDuration: 'P1D',
  dateTime: '2026-01-15T09:30:00', dateTimeStamp: '2026-01-15T09:30:00Z', time: '09:30:00', date: '2026-01-15',
  gYearMonth: '2026-01', gYear: '2026', gMonthDay: '--01-15', gDay: '---15', gMonth: '--01',
  anyURI: 'https://example.com/', language: 'en', NMTOKEN: 'token', NMTOKENS: 'token', QName: 'name', NOTATION: 'name',
  ENTITY: 'entity', ENTITIES: 'entity', anySimpleType: 'text', anyType: 'text', anyAtomicType: 'text',
};

function ncName(s) {
  const t = String(s || '').replace(/[^A-Za-z0-9._-]/g, '');
  return /^[A-Za-z_]/.test(t) ? t : 'n' + t;
}
function fitLength(s, f) {
  let v = String(s);
  const len = f.length != null ? Number(f.length) : null;
  const min = len != null ? len : (f.minLength != null ? Number(f.minLength) : 0);
  const max = len != null ? len : (f.maxLength != null ? Number(f.maxLength) : Infinity);
  if (v.length > max) v = v.slice(0, max);
  while (v.length < min) v += 'x';
  return v;
}
function num(v) { return v == null || v === '' ? null : Number(v); }

/** A number that keeps min/max (inclusive or exclusive), totalDigits and fractionDigits. */
function numberFor(f, integer, lo0, hi0) {
  let lo = lo0 == null ? null : Number(lo0), hi = hi0 == null ? null : Number(hi0);
  let loX = false, hiX = false;
  if (num(f.minInclusive) != null && (lo == null || num(f.minInclusive) >= lo)) { lo = num(f.minInclusive); loX = false; }
  if (num(f.minExclusive) != null && (lo == null || num(f.minExclusive) >= lo)) { lo = num(f.minExclusive); loX = true; }
  if (num(f.maxInclusive) != null && (hi == null || num(f.maxInclusive) <= hi)) { hi = num(f.maxInclusive); hiX = false; }
  if (num(f.maxExclusive) != null && (hi == null || num(f.maxExclusive) <= hi)) { hi = num(f.maxExclusive); hiX = true; }
  const frac = f.fractionDigits != null ? Number(f.fractionDigits) : null;
  const step = integer || frac === 0 ? 1 : 0.5;
  let v = 1;
  if (lo != null && (v < lo || (loX && v <= lo))) v = loX ? lo + step : lo;
  if (hi != null && (v > hi || (hiX && v >= hi))) v = hiX ? hi - step : hi;
  if (lo != null && hi != null && (v < lo || v > hi)) v = (lo + hi) / 2;
  if (integer || frac === 0) v = Math.round(v);
  let s = Number.isInteger(v) ? String(v) : String(Number(v.toFixed(frac == null ? 2 : Math.min(frac, 6))));
  if (f.totalDigits != null && s.replace(/[-.]/g, '').length > Number(f.totalDigits)) s = lo != null && lo > 0 ? String(lo) : '1';
  return s;
}

let idCounter = 0;
function resetIds() { idCounter = 0; }

/** An example value for simple type info { builtin, facets, list?, union? }; hint is the element or attribute name. */
function valueFor(info, hint) {
  if (!info) return 'text';
  const f = info.facets || {};
  if (f.enumeration && f.enumeration.length) return f.enumeration[0].value;
  if (info.builtin === 'list') return info.list ? valueFor(info.list, hint) : 'item';
  if (info.builtin === 'union') return info.union && info.union.length ? valueFor(info.union[0], hint) : 'text';
  const b = info.builtin || 'string';
  if (f.pattern && f.pattern.length) {
    const s = example(f.pattern[0], f);
    if (s != null) return s;
  }
  if (b in INTS) return numberFor(f, true, INTS[b][0] == null ? null : Number(INTS[b][0]), INTS[b][1] == null ? null : Number(INTS[b][1]));
  if (b === 'decimal') return numberFor(f, false, null, null);
  if (b === 'float' || b === 'double') return (f.minInclusive || f.maxInclusive || f.minExclusive || f.maxExclusive) ? numberFor(f, false, null, null) : FIXED[b];
  if (b === 'hexBinary') return '0A'.repeat(Math.max(1, Number(f.length || f.minLength || 2))).slice(0, 2 * Number(f.length || f.maxLength || 64));
  if (b === 'base64Binary') { const n = Number(f.length || f.minLength || 6); return Buffer.from('Sample'.repeat(Math.ceil(n / 6) + 1).slice(0, Math.max(n, 1))).toString('base64'); }
  if (b === 'ID') return `id${++idCounter}`;
  if (b === 'IDREF' || b === 'IDREFS') return 'id1';
  if (b === 'Name' || b === 'NCName') return fitLength(ncName(hint || 'name'), f);
  if (b in FIXED) return f.length != null || f.minLength != null || f.maxLength != null ? fitLength(FIXED[b], f) : FIXED[b];
  return fitLength(String(hint || 'text').replace(/[^\w .-]/g, '') || 'text', f);
}

module.exports = { valueFor, resetIds, numberFor };
