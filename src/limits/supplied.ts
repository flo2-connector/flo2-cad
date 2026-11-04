// LIMITS THE PERSON SUPPLIES (dec:idea-limit-profiles-by-material-process-and-size, option (b):
// "a person may supply limits with their source ... and they are recorded on the piece").
//
// Where no profile covers a piece (a bronze figure, a copper piece sand cast), or where the
// person's caster or foundry holds the piece to figures of its own, the piece may carry its own
// limits in its file, as "limits": every limit the checker reads and the shrinkage allowance,
// each with its source. They are used in place of any profile's, and every check report and
// export names them as the person's, with their sources. A set missing a limit, a value's unit
// or a source is refused, naming the field path: a figure nobody stands behind is worse than no
// verdict.
//
//   "limits": {
//     "wall":              { "value": "1.5 mm", "source": "the foundry's design guide, rev. 3, 2026-10-01" },
//     "band":              { "value": "1.8 mm", "source": "..." },
//     "prong":             { "value": "1.6 mm", "source": "..." },
//     "detail":            { "value": "0.5 mm", "source": "..." },
//     "gap":               { "value": "0.6 mm", "source": "..." },
//     "surface_deviation": { "value": "0.01 mm", "source": "..." },
//     "shrinkage":         { "value": "1.4 %", "source": "..." }
//   }

import { CallError, at } from '../errors.js';
import { lengthMm, percent } from '../units.js';
import type { Limits } from './profiles.js';

/** The fields of a supplied set, as the piece's file names them, with the checker's name for each. */
export const SUPPLIED_FIELDS = [
  { key: 'wall', limit: 'wall', words: 'walls', help: 'the thinnest wall anywhere' },
  { key: 'band', limit: 'band', words: 'band', help: "a ring's band across its narrowest section (checked only where the piece has a ring band)" },
  { key: 'prong', limit: 'prong', words: 'prongs', help: 'a wire joined at one end only, such as a prong, across its narrowest section (checked only where the piece has prongs)' },
  { key: 'detail', limit: 'detail', words: 'details', help: 'the smallest raised detail' },
  { key: 'gap', limit: 'gap', words: 'gaps', help: 'the smallest gap between two parts of the piece' },
  { key: 'surface_deviation', limit: 'surfaceDeviation', words: 'surface within', help: 'the most the file\'s facets may stand off the intended surface' },
] as const satisfies readonly { key: string; limit: keyof Limits; words: string; help: string }[];

export const SUPPLIED_KEYS = [...SUPPLIED_FIELDS.map((f) => f.key), 'shrinkage'] as const;

/** A supplied set as the piece's file holds it: each entry the person's own words. */
export type SuppliedFile = Record<(typeof SUPPLIED_KEYS)[number], { value: string; source: string }>;

/** A supplied set, read. */
export interface Supplied {
  limits: Limits;
  shrinkagePct: number;
  /** Each field's value as written and its source, by the file's key. */
  each: SuppliedFile;
}

const SOURCE_MAX = 600;
const EXAMPLE = '{"value": "1.0 mm", "source": "the foundry\'s design guide, rev. 3, 2026-10-01"}';

/** How a supplied set is written, for a tool's description. */
export const SUPPLIED_HELP = `Casting limits the person supplies, kept in the piece's file and used in place of any limit profile's: every limit the checker reads, ${SUPPLIED_FIELDS.map((f) => `"${f.key}" (${f.help})`).join(', ')}, and "shrinkage" (the linear shrinkage allowance in %, which shrinkage "on" then applies), each as ${EXAMPLE}. Every one needs its value with its unit and its source: the caster's or foundry's word (with its date) or a datasheet. A set missing any of them is refused.`;

/** Reads a supplied set, refusing anything missing or malformed by its field path under `path`. */
export function readSupplied(v: unknown, path: string): Supplied {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new CallError(path, `supplied limits are an object giving ${SUPPLIED_KEYS.join(', ')}, each as ${EXAMPLE}.`);
  }
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(SUPPLIED_KEYS as readonly string[]).includes(k)) throw new CallError(at(path, k), `is not a limit the checker reads; a supplied set gives ${SUPPLIED_KEYS.join(', ')}.`);
  }
  const entry = (k: string): { value: unknown; source: string } => {
    const p = at(path, k);
    const e = o[k];
    if (e === undefined) {
      throw new CallError(p, `missing. A supplied set gives every limit the checker reads and the shrinkage allowance (${SUPPLIED_KEYS.join(', ')}), each with its source, for example ${EXAMPLE}; ask the caster or foundry for any you do not have.`);
    }
    if (e === null || typeof e !== 'object' || Array.isArray(e)) throw new CallError(p, `each supplied limit is its value and its source, for example ${EXAMPLE}.`);
    const r = e as Record<string, unknown>;
    for (const f of Object.keys(r)) if (f !== 'value' && f !== 'source') throw new CallError(at(p, f), 'is not part of a supplied limit; it has a "value" and a "source".');
    if (r['value'] === undefined) throw new CallError(at(p, 'value'), `missing: give the figure with its unit, for example ${k === 'shrinkage' ? '"1.5 %"' : '"1.0 mm"'}.`);
    const source = r['source'];
    if (typeof source !== 'string' || !source.trim()) {
      throw new CallError(at(p, 'source'), 'missing: every supplied limit says where it comes from, the caster\'s or foundry\'s word (with its date) or a datasheet, for example "the foundry\'s design guide, rev. 3, 2026-10-01".');
    }
    if (source.length > SOURCE_MAX) throw new CallError(at(p, 'source'), `is ${source.length} characters; a source is at most ${SOURCE_MAX}: name it, and keep the document itself in the design.`);
    return { value: r['value'], source };
  };
  const limits = {} as Record<keyof Limits, number>;
  const each = {} as Record<string, { value: string; source: string }>;
  for (const f of SUPPLIED_FIELDS) {
    const e = entry(f.key);
    const mm = lengthMm(e.value, at(at(path, f.key), 'value'));
    if (!(mm > 0)) throw new CallError(at(at(path, f.key), 'value'), 'must be more than 0 mm.');
    limits[f.limit] = mm;
    each[f.key] = { value: e.value as string, source: e.source };
  }
  const s = entry('shrinkage');
  const pct = percent(s.value, at(at(path, 'shrinkage'), 'value'));
  if (!(pct >= 0 && pct <= 5)) throw new CallError(at(at(path, 'shrinkage'), 'value'), `a shrinkage allowance is between 0 and 5 %, for example "1.5 %"; got "${String(s.value)}".`);
  each['shrinkage'] = { value: s.value as string, source: s.source };
  return { limits: limits as Limits, shrinkagePct: pct, each: each as SuppliedFile };
}

/** The supplied set in words, each figure with its source: "walls 1.5 mm (the foundry's ...); ...". */
export function suppliedWords(s: Supplied): string {
  return [...SUPPLIED_FIELDS.map((f) => `${f.words} ${s.each[f.key].value} (${s.each[f.key].source})`), `shrinkage ${s.each.shrinkage.value} (${s.each.shrinkage.source})`].join('; ');
}

/** Each supplied figure and its source, as a check report's list of sources. */
export function suppliedSources(s: Supplied): string[] {
  return [...SUPPLIED_FIELDS.map((f) => `${f.key} ${s.each[f.key].value}, supplied with the piece: ${s.each[f.key].source}`), `shrinkage ${s.each.shrinkage.value}, supplied with the piece: ${s.each.shrinkage.source}`];
}
