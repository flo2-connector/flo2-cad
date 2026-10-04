// A piece is a TREE of operations and jewelry parts, as data; no agent code runs
// (dec:how-a-piece-is-described, owner round 1, Q3). The tree is what travels
// through flo2 (contract §3): every tool that changes a piece takes and returns
// it, and flo2 keeps each version as `<name>.tree.json`, so any call may carry a
// tree to resume from.
//
// Every number in a tree carries its unit ("1.2 mm", "30 deg", "2.00 ct"),
// except counts (prong_count, prong) and the revision. A plain band, a 4- or
// 6-prong head and a full bezel are PARAMETERS of one tree, not separate code:
// `stone_setting` picks the head, `prong_count` picks 4 or 6, `stone_shape` the
// stone.

import { CallError, at } from '../errors.js';
import { METAL_IDS, METALS, type MetalId } from '../metals.js';
import { anyQuantity, caratText, lengthMm, looksLikeQuantity, percent, ringInnerDiameterMm, type RingSize } from '../units.js';
import {
  CYLINDER_MAX_DEG,
  MIN_RADIUS_PER_THICKNESS,
  RADIUS_MAX_MM,
  reachDeg,
  ROUND_CORNERS_MAX_MM,
  SHEET_AXES,
  signedArea2,
  SPHERE_MAX_DEG,
  SURFACES,
  THICKNESS_RANGE_MM,
  type Surface,
} from '../library/thicken.js';

export const TREE_FORMAT = 'flo2-cad.tree/1';

export interface TreeNode {
  id: string;
  /** A jewelry part from the library (ring_shank, prong_head, bezel). */
  part?: string;
  /** An operation (union, difference, smooth_union, sweep, ...). */
  op?: string;
  /** What the checker measures this node's faces as. */
  feature?: string;
  params?: Record<string, unknown>;
  children?: TreeNode[];
}

export interface PieceTree {
  format: typeof TREE_FORMAT;
  name: string;
  revision: number;
  template: string;
  metal: MetalId;
  /** "off" (the default), "on" (the metal's cited allowance) or an allowance such as "1.5 %". */
  shrinkage: string;
  root: TreeNode;
}

export const TEMPLATES = ['solitaire_ring', 'plain_band', 'emerald_bezel_solitaire'] as const;
export type Template = (typeof TEMPLATES)[number];

/** Operations a tree may hold, beyond the library parts. */
export const OPERATIONS = [
  'union',
  'difference',
  'intersection',
  'smooth_union',
  'translate',
  'rotate',
  'mirror',
  'sweep',
  'revolve',
  'extrude',
  'sphere',
  'cylinder',
  'box',
  'torus',
  'thicken',
] as const;
export type Operation = (typeof OPERATIONS)[number];

/** Operations a smooth blend can take as children: shapes with a distance function. */
export const BLENDABLE: ReadonlySet<string> = new Set(['sphere', 'cylinder', 'box', 'torus', 'sweep', 'translate', 'rotate', 'mirror', 'union', 'smooth_union']);

export const PARTS = ['ring_shank', 'prong_head', 'bezel'] as const;
export const FEATURES = ['wall', 'band', 'prong', 'seat', 'detail'] as const;
export const BAND_PROFILES = ['comfort_fit', 'half_round', 'flat', 'round'] as const;
export const STONE_SETTINGS = ['prong_head', 'bezel', 'none'] as const;
export const STONE_SHAPES = ['round', 'emerald'] as const;
export const ORIENTATIONS = ['east_west', 'north_south'] as const;

/** Keys in a tree whose numbers are counts, not measurements, so carry no unit. */
const COUNT_KEYS = new Set(['prong_count', 'prong', 'count', 'segments']);

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const NODE_ID = /^[a-z][a-z0-9_]{0,39}$/;

// --------------------------------------------------------------------- stones

/**
 * Template stone sizes. They are PLACEHOLDERS until the person gives the stone's
 * measured dimensions, and the preview and replies say so.
 *  · round: 6.5 × 4.0 mm, about a 1.00 ct round brilliant (International Gem
 *    Society chart, https://www.gemsociety.org/article/standard-gem-sizes-chart/;
 *    depth 61 %, between Tolkowsky's 59.3 % and typical graded stones);
 *  · emerald: 8.5 × 6.0 × 4.1 mm, a typical 2.00 ct emerald cut (Stuller's
 *    mm-to-carat chart gives 8.5 × 6 mm for 2.00 ct,
 *    https://blog.stuller.com/wp-content/uploads/2023/12/Millimeter-to-Diamond-Carat-Weight-Conversion-Chart-2.pdf;
 *    depth 4.1 mm, within three GIA-graded 2.00 ct emerald cuts of 3.98-4.33 mm
 *    listed by Blue Nile, e.g. https://www.bluenile.com/diamond-details/19095454).
 */
export const STONE_DEFAULTS = {
  round: { diameter: '6.5 mm', depth: '4.0 mm', carat: '1.00 ct' },
  emerald: { length: '8.5 mm', width: '6.0 mm', depth: '4.1 mm', carat: '2.00 ct' },
} as const;

function defaultStone(shape: 'round' | 'emerald', orientation = 'east_west'): Record<string, unknown> {
  if (shape === 'round') {
    const d = STONE_DEFAULTS.round;
    return { shape, diameter: d.diameter, depth: d.depth, carat: d.carat, placeholder: ['diameter', 'depth', 'carat'] };
  }
  const d = STONE_DEFAULTS.emerald;
  return { shape, length: d.length, width: d.width, depth: d.depth, carat: d.carat, orientation, placeholder: ['length', 'width', 'depth', 'carat'] };
}

// ------------------------------------------------------------------ parameters

/** One named setting of a piece, as start_piece takes it and change_piece's `set` changes it. */
export interface ParamSpec {
  readonly key: string;
  readonly help: string;
  readonly kind: 'name' | 'ring_size' | 'length' | 'enum' | 'shrinkage' | 'carat' | 'lip';
  readonly values?: readonly (string | number)[];
  readonly min?: number;
  readonly max?: number;
  readonly default?: string | number;
  /** The casting or setting limit the checker holds it to, when there is one. */
  readonly limit?: string;
}

// Library defaults sit ABOVE each casting limit with a margin, never at it
// (con:library-defaults-above-the-limits). The allowed ranges are what the
// library can BUILD; they deliberately reach below the casting limits, so a
// too-thin prong or bezel can be drawn and previewed and is then refused.
export const PARAMS: readonly ParamSpec[] = [
  {
    key: 'name',
    kind: 'name',
    help: 'A short name for the piece, used to name its files (e.g. "emily-solitaire" gives emily-solitaire.stl). Letters, digits, "-" and "_" only.',
  },
  {
    key: 'ring_size',
    kind: 'ring_size',
    help: 'The finger size, in a named system: {"system": "US", "size": "7"}, {"system": "UK", "size": "N"} or {"system": "EU", "size": "54"}. A size without its system is refused.',
  },
  {
    key: 'metal',
    kind: 'enum',
    values: METAL_IDS,
    default: 'sterling_silver_925',
    help: 'The metal it will be cast in: sterling_silver_925, gold_14k_yellow, gold_18k_yellow or platinum_950. Each has its own cited casting limits and shrinkage; platinum goes to a specialist caster.',
  },
  { key: 'band_width', kind: 'length', min: 1.0, max: 12, default: '2.2 mm', help: 'How wide the band is, measured along the finger.' },
  {
    key: 'band_thickness',
    kind: 'length',
    min: 0.3,
    max: 4,
    default: '1.6 mm',
    limit: '1.0 mm',
    help: 'How thick the band metal is, from the inside of the ring to the outside.',
  },
  {
    key: 'band_profile',
    kind: 'enum',
    values: BAND_PROFILES,
    default: 'comfort_fit',
    help: "The band's cross-section: comfort_fit (rounded inside and out), half_round (flat inside, domed outside), flat, or round (a round wire; set band_width and band_thickness equal for a true circle).",
  },
  {
    key: 'stone_setting',
    kind: 'enum',
    values: STONE_SETTINGS,
    default: 'prong_head',
    help: 'How the stone is held: prong_head (4 or 6 prongs), bezel (a full metal rim around the stone, no prongs), or none for a plain band.',
  },
  { key: 'stone_shape', kind: 'enum', values: STONE_SHAPES, default: 'round', help: 'round (a round brilliant) or emerald (a rectangular step cut with cut corners).' },
  {
    key: 'stone_diameter',
    kind: 'length',
    min: 2,
    max: 14,
    default: STONE_DEFAULTS.round.diameter,
    help: "A round stone's diameter, as MEASURED on its grading report (not from a carat chart).",
  },
  { key: 'stone_length', kind: 'length', min: 3, max: 20, default: STONE_DEFAULTS.emerald.length, help: "An emerald cut's length (its long side), as measured on its grading report." },
  { key: 'stone_width', kind: 'length', min: 2, max: 15, default: STONE_DEFAULTS.emerald.width, help: "An emerald cut's width (its short side), as measured on its grading report." },
  {
    key: 'stone_depth',
    kind: 'length',
    min: 1,
    max: 12,
    help: "The stone's total depth, table to culet, as measured on its grading report. Until given, a placeholder: 4.0 mm for the round, 4.1 mm for the emerald cut.",
  },
  {
    key: 'stone_carat',
    kind: 'carat',
    help: 'The carat weight from the grading report, e.g. "2.00 ct". For reference only: the stone is always sized from its measured dimensions.',
  },
  {
    key: 'stone_orientation',
    kind: 'enum',
    values: ORIENTATIONS,
    default: 'east_west',
    help: "Which way an emerald cut's long side runs: east_west (across the finger) or north_south (along the finger).",
  },
  { key: 'prong_count', kind: 'enum', values: [4, 6], default: 4, help: 'How many prongs grip the stone: 4 or 6.' },
  {
    key: 'prong_thickness',
    kind: 'length',
    min: 0.3,
    max: 3,
    default: '1.4 mm',
    limit: '1.0 mm at its narrowest, where the seat is cut (about prong_thickness minus 0.2 mm)',
    help: 'How thick each prong is. A thinner prong can be drawn and previewed, but the piece will not export until every prong is at least the limit at its narrowest.',
  },
  {
    key: 'bezel_wall',
    kind: 'length',
    min: 0.3,
    max: 3,
    default: '1.0 mm',
    limit: '0.8 mm',
    help: "How thick the bezel's metal rim around the stone is.",
  },
  {
    key: 'bezel_lip',
    kind: 'lip',
    default: 'auto',
    limit: 'covers 50 % to 75 % of the crown',
    help: 'How far the bezel rises above the girdle, to be pushed over the stone: "auto" (60 % of the crown height), or a height like "0.7 mm".',
  },
  {
    key: 'shrinkage',
    kind: 'shrinkage',
    default: 'off',
    help: '"off", "on" (the metal\'s cited allowance, 1.5 %), or an allowance such as "1.2 %" that enlarges the piece so it shrinks back to size in casting. Every export says whether it was applied.',
  },
];

export const PARAM_BY_KEY: ReadonlyMap<string, ParamSpec> = new Map(PARAMS.map((p) => [p.key, p] as const));

/** Where each named setting lives in the tree: "band.<field>", "head.<field>", "head.stone.<field>". */
const PARAM_TARGET: Readonly<Record<string, { node: 'band' | 'head'; field: readonly string[]; part?: 'prong_head' | 'bezel' }>> = {
  ring_size: { node: 'band', field: ['ring_size'] },
  band_width: { node: 'band', field: ['width'] },
  band_thickness: { node: 'band', field: ['thickness'] },
  band_profile: { node: 'band', field: ['profile'] },
  stone_diameter: { node: 'head', field: ['stone', 'diameter'] },
  stone_length: { node: 'head', field: ['stone', 'length'] },
  stone_width: { node: 'head', field: ['stone', 'width'] },
  stone_depth: { node: 'head', field: ['stone', 'depth'] },
  stone_carat: { node: 'head', field: ['stone', 'carat'] },
  stone_orientation: { node: 'head', field: ['stone', 'orientation'] },
  prong_count: { node: 'head', field: ['prong_count'], part: 'prong_head' },
  prong_thickness: { node: 'head', field: ['prong_thickness'], part: 'prong_head' },
  bezel_wall: { node: 'head', field: ['wall'], part: 'bezel' },
  bezel_lip: { node: 'head', field: ['lip'], part: 'bezel' },
};

function checkParam(spec: ParamSpec, v: unknown, path: string): void {
  switch (spec.kind) {
    case 'name':
      if (typeof v !== 'string' || !NAME.test(v)) {
        throw new CallError(path, 'a piece name is 1 to 64 letters, digits, "-" or "_", starting with a letter or digit, for example "emily-solitaire".');
      }
      return;
    case 'ring_size':
      ringInnerDiameterMm(v, path);
      return;
    case 'length': {
      const mm = lengthMm(v, path);
      if (spec.min !== undefined && mm < spec.min) throw new CallError(path, `${mm} mm is below the smallest the library can build (${spec.min} mm).`);
      if (spec.max !== undefined && mm > spec.max) throw new CallError(path, `${mm} mm is above the largest the library builds (${spec.max} mm).`);
      return;
    }
    case 'enum':
      if (!spec.values!.includes(v as string | number)) {
        throw new CallError(path, `must be one of ${spec.values!.map((x) => JSON.stringify(x)).join(', ')}; got ${JSON.stringify(v)}.`);
      }
      return;
    case 'shrinkage':
      shrinkagePercent(v, 'sterling_silver_925', path);
      return;
    case 'carat':
      caratText(v, path);
      return;
    case 'lip':
      if (v === 'auto') return;
      {
        const mm = lengthMm(v, path);
        if (mm < 0.1 || mm > 4) throw new CallError(path, `${mm} mm is outside what the library builds (0.1 to 4 mm), or "auto".`);
      }
      return;
  }
}

/** The shrinkage allowance in percent: 0 when "off", the metal's cited figure when "on". */
export function shrinkagePercent(v: unknown, metal: MetalId, path: string): number {
  if (v === 'off') return 0;
  if (v === 'on') return METALS[metal].shrinkagePct;
  const pct = percent(v, path);
  if (pct <= 0 || pct > 5) {
    throw new CallError(path, `a shrinkage allowance is "off", "on", or between 0 and 5 %, for example "1.5 %"; got "${String(v)}".`);
  }
  return pct;
}

// ------------------------------------------------------------------- templates

const HEAD_DEFAULTS = {
  /** How far each prong reaches in over the stone's girdle (Stuller: 0.15 mm; the default sits above it). */
  prong_grip: '0.2 mm',
  /** Gap between the stone's culet (its point) and the top of the band. */
  culet_clearance: '0.3 mm',
};

function bandNode(o: Record<string, unknown>, profile: string): TreeNode {
  return {
    id: 'band',
    part: 'ring_shank',
    feature: 'band',
    params: {
      ring_size: o['ring_size'],
      width: o['band_width'] ?? (profile === 'round' ? '2.0 mm' : PARAM_BY_KEY.get('band_width')!.default),
      thickness: o['band_thickness'] ?? (profile === 'round' ? '2.0 mm' : PARAM_BY_KEY.get('band_thickness')!.default),
      profile,
    },
  };
}

function stoneFrom(o: Record<string, unknown>, shape: 'round' | 'emerald'): Record<string, unknown> {
  const stone = defaultStone(shape, (o['stone_orientation'] as string | undefined) ?? 'east_west');
  const placeholder = new Set(stone['placeholder'] as string[]);
  const take = (arg: string, field: string) => {
    if (o[arg] !== undefined) {
      stone[field] = o[arg];
      placeholder.delete(field);
    }
  };
  if (shape === 'round') take('stone_diameter', 'diameter');
  else {
    take('stone_length', 'length');
    take('stone_width', 'width');
  }
  take('stone_depth', 'depth');
  take('stone_carat', 'carat');
  stone['placeholder'] = [...placeholder];
  return stone;
}

function headNode(setting: 'prong_head' | 'bezel', stone: Record<string, unknown>, o: Record<string, unknown>): TreeNode {
  if (setting === 'bezel') {
    return {
      id: 'head',
      part: 'bezel',
      feature: 'wall',
      params: {
        stone,
        wall: o['bezel_wall'] ?? PARAM_BY_KEY.get('bezel_wall')!.default,
        lip: o['bezel_lip'] ?? 'auto',
        culet_clearance: HEAD_DEFAULTS.culet_clearance,
      },
    };
  }
  return {
    id: 'head',
    part: 'prong_head',
    feature: 'prong',
    params: {
      stone,
      prong_count: o['prong_count'] ?? PARAM_BY_KEY.get('prong_count')!.default,
      prong_thickness: o['prong_thickness'] ?? PARAM_BY_KEY.get('prong_thickness')!.default,
      prong_grip: HEAD_DEFAULTS.prong_grip,
      culet_clearance: HEAD_DEFAULTS.culet_clearance,
      prong_overrides: [],
    },
  };
}

/** What each template starts from, before the call's own settings. */
const TEMPLATE_PRESETS: Readonly<Record<Template, Record<string, unknown>>> = {
  solitaire_ring: { stone_setting: 'prong_head', stone_shape: 'round', metal: 'sterling_silver_925', band_profile: 'comfort_fit' },
  plain_band: { stone_setting: 'none', metal: 'sterling_silver_925', band_profile: 'comfort_fit' },
  // Emily's first design (dec:the-first-increment, widened 2026-10-03): a 2 ct
  // emerald cut in a full Pt950 bezel, east-west, on a plain round band.
  emerald_bezel_solitaire: { stone_setting: 'bezel', stone_shape: 'emerald', stone_orientation: 'east_west', metal: 'platinum_950', band_profile: 'round' },
};

/** start_piece's arguments, already checked, as a new tree at revision 1. */
export function treeFromTemplate(template: Template, args: Record<string, unknown>): PieceTree {
  const o = { ...TEMPLATE_PRESETS[template], ...args };
  const setting = o['stone_setting'] as 'prong_head' | 'bezel' | 'none';
  const children = [bandNode(o, o['band_profile'] as string)];
  if (setting !== 'none') children.push(headNode(setting, stoneFrom(o, (o['stone_shape'] as 'round' | 'emerald') ?? 'round'), o));
  const fallbackName = template === 'plain_band' ? 'band' : template === 'emerald_bezel_solitaire' ? 'emerald-bezel' : 'solitaire';
  return {
    format: TREE_FORMAT,
    name: (args['name'] as string | undefined) ?? fallbackName,
    revision: 1,
    template,
    metal: o['metal'] as MetalId,
    shrinkage: (args['shrinkage'] as string | undefined) ?? 'off',
    root: { id: 'ring', op: 'union', children },
  };
}

/** Checks start_piece's piece settings, each under its own argument name. */
export function checkStartArgs(args: Record<string, unknown>): Template {
  const template = args['template'];
  if (template === undefined) throw new CallError('template', `choose a starting design: ${TEMPLATES.map((t) => `"${t}"`).join(', ')}.`);
  if (!TEMPLATES.includes(template as Template)) {
    throw new CallError('template', `"${String(template)}" is not a starting design this engine has; use ${TEMPLATES.map((t) => `"${t}"`).join(', ')}.`);
  }
  if (args['ring_size'] === undefined) {
    throw new CallError('ring_size', 'give the finger size with its system, for example {"system": "US", "size": "7"}.');
  }
  for (const spec of PARAMS) {
    if (args[spec.key] !== undefined) checkParam(spec, args[spec.key], spec.key);
  }
  const o = { ...TEMPLATE_PRESETS[template as Template], ...args };
  const setting = o['stone_setting'];
  const shape = o['stone_shape'];
  if (setting === 'none') {
    for (const k of PARAMS.filter((p) => p.key.startsWith('stone_') || p.key.startsWith('prong_') || p.key.startsWith('bezel_')).map((p) => p.key)) {
      if (k !== 'stone_setting' && args[k] !== undefined) throw new CallError(k, 'a plain band has no stone; leave this out, or choose a stone_setting.');
    }
  }
  if (setting === 'bezel') {
    for (const k of ['prong_count', 'prong_thickness']) if (args[k] !== undefined) throw new CallError(k, 'a bezel has no prongs; leave this out, or set "stone_setting": "prong_head".');
  }
  if (setting === 'prong_head') {
    for (const k of ['bezel_wall', 'bezel_lip']) if (args[k] !== undefined) throw new CallError(k, 'a prong head has no bezel; leave this out, or set "stone_setting": "bezel".');
  }
  if (shape === 'round') {
    for (const k of ['stone_length', 'stone_width']) if (args[k] !== undefined) throw new CallError(k, 'a round stone has a diameter, not a length and width; use stone_diameter, or set "stone_shape": "emerald".');
  }
  if (shape === 'emerald' && args['stone_diameter'] !== undefined) {
    throw new CallError('stone_diameter', 'an emerald cut has a length and a width, not a diameter; use stone_length and stone_width.');
  }
  if (shape === 'emerald' && args['stone_length'] !== undefined && args['stone_width'] !== undefined) {
    if (lengthMm(args['stone_width'], 'stone_width') > lengthMm(args['stone_length'], 'stone_length')) {
      throw new CallError('stone_width', 'the width is the SHORT side of an emerald cut; it cannot be more than its length. Swap them.');
    }
  }
  return template as Template;
}

// ------------------------------------------------------------------ validation

/** Validates a tree an agent or flo2 passed in, returning it typed. Every refusal names its path under `path`. */
export function validateTree(v: unknown, path = 'tree'): PieceTree {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new CallError(path, `a piece tree is a JSON object with "format": "${TREE_FORMAT}", as a previous reply or the saved <name>.tree.json gave it.`);
  }
  const t = v as Record<string, unknown>;
  if (t['format'] !== TREE_FORMAT) throw new CallError(at(path, 'format'), `must be "${TREE_FORMAT}"; got ${JSON.stringify(t['format'])}.`);
  checkParam(PARAM_BY_KEY.get('name')!, t['name'], at(path, 'name'));
  if (!Number.isInteger(t['revision']) || (t['revision'] as number) < 1) {
    throw new CallError(at(path, 'revision'), 'must be a whole number, 1 or more (it counts the changes, so it has no unit).');
  }
  if (!TEMPLATES.includes(t['template'] as Template)) throw new CallError(at(path, 'template'), `must be one of ${TEMPLATES.map((x) => `"${x}"`).join(', ')}.`);
  checkParam(PARAM_BY_KEY.get('metal')!, t['metal'], at(path, 'metal'));
  shrinkagePercent(t['shrinkage'], t['metal'] as MetalId, at(path, 'shrinkage'));
  for (const k of Object.keys(t)) {
    if (!['format', 'name', 'revision', 'template', 'metal', 'shrinkage', 'root'].includes(k)) throw new CallError(at(path, k), 'is not a field of a piece tree.');
  }
  const root = t['root'] as Record<string, unknown> | undefined;
  if (!root || typeof root !== 'object' || root['op'] !== 'union') {
    throw new CallError(at(path, 'root'), 'the root of a piece is a union node, {"id": "ring", "op": "union", "children": [...]}.');
  }
  const ids = new Set<string>();
  validateNode(root, at(path, 'root'), ids, false);
  const kids = (root['children'] as TreeNode[] | undefined) ?? [];
  const bands = kids.filter((c) => c.part === 'ring_shank');
  const heads = kids.filter((c) => c.part === 'prong_head' || c.part === 'bezel');
  if (bands.length !== 1 || bands[0]!.id !== 'band') throw new CallError(at(path, 'root.children'), 'a ring has exactly one ring_shank part, with id "band".');
  if (heads.length > 1 || (heads[0] && heads[0].id !== 'head')) throw new CallError(at(path, 'root.children'), 'a ring has at most one head (prong_head or bezel), with id "head".');
  return v as PieceTree;
}

function validateNode(v: unknown, path: string, ids: Set<string>, inBlend: boolean): void {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new CallError(path, 'a tree node is an object with an "id" and either a "part" or an "op".');
  }
  const n = v as Record<string, unknown>;
  const id = n['id'];
  if (typeof id !== 'string' || !NODE_ID.test(id)) {
    throw new CallError(at(path, 'id'), 'a node id is lower-case letters, digits and "_", starting with a letter, for example "band" or "head".');
  }
  if (ids.has(id)) throw new CallError(at(path, 'id'), `"${id}" is used by another node; ids must be unique in a piece.`);
  ids.add(id);
  const hasPart = n['part'] !== undefined;
  const hasOp = n['op'] !== undefined;
  if (hasPart === hasOp) throw new CallError(path, 'a node has exactly one of "part" (a jewelry part) or "op" (an operation).');
  if (hasPart && !PARTS.includes(n['part'] as (typeof PARTS)[number])) {
    throw new CallError(at(path, 'part'), `"${String(n['part'])}" is not a library part; the parts are ${PARTS.join(', ')}.`);
  }
  if (hasOp && !OPERATIONS.includes(n['op'] as Operation)) {
    throw new CallError(at(path, 'op'), `"${String(n['op'])}" is not an operation; the operations are ${OPERATIONS.join(', ')}.`);
  }
  if (inBlend && (hasPart || !BLENDABLE.has(n['op'] as string))) {
    throw new CallError(path, `a smooth_union can blend only ${[...BLENDABLE].join(', ')}; "${String(n['part'] ?? n['op'])}" is not one of them.`);
  }
  if (n['feature'] !== undefined && !FEATURES.includes(n['feature'] as (typeof FEATURES)[number])) {
    throw new CallError(at(path, 'feature'), `must be one of ${FEATURES.join(', ')}.`);
  }
  for (const k of Object.keys(n)) {
    if (!['id', 'part', 'op', 'feature', 'params', 'children'].includes(k)) throw new CallError(at(path, k), 'is not a field of a tree node.');
  }
  const params = n['params'] ?? {};
  if (params === null || typeof params !== 'object' || Array.isArray(params)) throw new CallError(at(path, 'params'), 'must be an object of settings.');
  const pPath = at(path, 'params');
  const p = params as Record<string, unknown>;
  if (n['part'] === 'ring_shank') validateBand(p, pPath);
  else if (n['part'] === 'prong_head') validateProngHead(p, pPath);
  else if (n['part'] === 'bezel') validateBezel(p, pPath);
  else validateOp(n['op'] as Operation, p, pPath);
  const children = n['children'];
  if (children !== undefined) {
    if (!Array.isArray(children)) throw new CallError(at(path, 'children'), 'must be a list of nodes.');
    if (hasPart && children.length) throw new CallError(at(path, 'children'), 'a library part has no children.');
    children.forEach((c, i) => validateNode(c, at(at(path, 'children'), i), ids, inBlend || n['op'] === 'smooth_union'));
  }
  const kids = (children as unknown[] | undefined)?.length ?? 0;
  const op = n['op'] as string | undefined;
  if (op && ['union', 'difference', 'intersection', 'smooth_union', 'translate', 'rotate', 'mirror'].includes(op) && kids === 0) {
    throw new CallError(at(path, 'children'), `a ${op} needs at least one child.`);
  }
  if (op && ['sphere', 'cylinder', 'box', 'torus', 'sweep', 'revolve', 'extrude', 'thicken'].includes(op) && kids > 0) {
    throw new CallError(at(path, 'children'), `a ${op} is a shape and has no children.`);
  }
}

function only(o: Record<string, unknown>, path: string, keys: readonly string[]): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new CallError(at(path, k), `is not a setting of this part; its settings are ${keys.join(', ')}.`);
}

function validateBand(p: Record<string, unknown>, path: string): void {
  only(p, path, ['ring_size', 'width', 'thickness', 'profile']);
  checkParam(PARAM_BY_KEY.get('ring_size')!, p['ring_size'], at(path, 'ring_size'));
  checkParam(PARAM_BY_KEY.get('band_width')!, p['width'], at(path, 'width'));
  checkParam(PARAM_BY_KEY.get('band_thickness')!, p['thickness'], at(path, 'thickness'));
  checkParam(PARAM_BY_KEY.get('band_profile')!, p['profile'], at(path, 'profile'));
}

function validateStone(s: unknown, path: string): void {
  if (s === null || typeof s !== 'object' || Array.isArray(s)) {
    throw new CallError(path, 'the stone is {"shape": "round", "diameter": "6.5 mm", "depth": "4.0 mm"} or {"shape": "emerald", "length": "8.5 mm", "width": "6.0 mm", "depth": "4.1 mm", "orientation": "east_west"}.');
  }
  const o = s as Record<string, unknown>;
  checkParam(PARAM_BY_KEY.get('stone_shape')!, o['shape'], at(path, 'shape'));
  if (o['shape'] === 'round') {
    only(o, path, ['shape', 'diameter', 'depth', 'carat', 'placeholder', 'orientation']);
    checkParam(PARAM_BY_KEY.get('stone_diameter')!, o['diameter'], at(path, 'diameter'));
  } else {
    only(o, path, ['shape', 'length', 'width', 'depth', 'carat', 'placeholder', 'orientation']);
    checkParam(PARAM_BY_KEY.get('stone_length')!, o['length'], at(path, 'length'));
    checkParam(PARAM_BY_KEY.get('stone_width')!, o['width'], at(path, 'width'));
    if (lengthMm(o['width'], at(path, 'width')) > lengthMm(o['length'], at(path, 'length'))) {
      throw new CallError(at(path, 'width'), 'the width is the SHORT side of an emerald cut; it cannot be more than its length.');
    }
    checkParam(PARAM_BY_KEY.get('stone_orientation')!, o['orientation'], at(path, 'orientation'));
  }
  checkParam(PARAM_BY_KEY.get('stone_depth')!, o['depth'], at(path, 'depth'));
  if (o['carat'] !== undefined) caratText(o['carat'], at(path, 'carat'));
  const ph = o['placeholder'] ?? [];
  if (!Array.isArray(ph) || ph.some((x) => !['diameter', 'length', 'width', 'depth', 'carat'].includes(x as string))) {
    throw new CallError(at(path, 'placeholder'), 'lists which of the stone\'s dimensions are still template placeholders, e.g. ["depth"].');
  }
}

function headCommon(p: Record<string, unknown>, path: string): void {
  validateStone(p['stone'], at(path, 'stone'));
  const cc = lengthMm(p['culet_clearance'], at(path, 'culet_clearance'));
  if (cc < 0.1 || cc > 5) throw new CallError(at(path, 'culet_clearance'), `${cc} mm is outside what the library builds (0.1 to 5 mm).`);
}

function validateProngHead(p: Record<string, unknown>, path: string): void {
  only(p, path, ['stone', 'prong_count', 'prong_thickness', 'prong_grip', 'culet_clearance', 'prong_overrides']);
  headCommon(p, path);
  checkParam(PARAM_BY_KEY.get('prong_count')!, p['prong_count'], at(path, 'prong_count'));
  checkParam(PARAM_BY_KEY.get('prong_thickness')!, p['prong_thickness'], at(path, 'prong_thickness'));
  const grip = lengthMm(p['prong_grip'], at(path, 'prong_grip'));
  if (grip < 0.05 || grip > 1) throw new CallError(at(path, 'prong_grip'), `${grip} mm is outside what the library builds (0.05 to 1 mm).`);
  const ov = p['prong_overrides'] ?? [];
  if (!Array.isArray(ov)) throw new CallError(at(path, 'prong_overrides'), 'a list like [{"prong": 2, "thickness": "0.7 mm"}].');
  const count = p['prong_count'] as number;
  ov.forEach((o, i) => {
    const op = at(at(path, 'prong_overrides'), i);
    if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new CallError(op, 'each override is {"prong": 2, "thickness": "0.7 mm"}.');
    const r = o as Record<string, unknown>;
    only(r, op, ['prong', 'thickness']);
    if (!Number.isInteger(r['prong']) || (r['prong'] as number) < 1 || (r['prong'] as number) > count) {
      throw new CallError(at(op, 'prong'), `which prong, counted 1 to ${count} clockwise from 12 o'clock seen from above.`);
    }
    checkParam(PARAM_BY_KEY.get('prong_thickness')!, r['thickness'], at(op, 'thickness'));
  });
}

function validateBezel(p: Record<string, unknown>, path: string): void {
  only(p, path, ['stone', 'wall', 'lip', 'culet_clearance']);
  headCommon(p, path);
  checkParam(PARAM_BY_KEY.get('bezel_wall')!, p['wall'], at(path, 'wall'));
  checkParam(PARAM_BY_KEY.get('bezel_lip')!, p['lip'], at(path, 'lip'));
}

/** Each operation's settings, with the unit each takes. */
export const OP_PARAMS: Readonly<Record<Operation, Readonly<Record<string, 'length' | 'angle' | 'points2' | 'points3' | 'plane' | 'boolean' | 'word'>>>> = {
  union: {},
  difference: {},
  intersection: {},
  smooth_union: { radius: 'length' },
  translate: { x: 'length', y: 'length', z: 'length' },
  rotate: { x: 'angle', y: 'angle', z: 'angle' },
  mirror: { plane: 'plane' },
  sphere: { radius: 'length' },
  cylinder: { radius: 'length', height: 'length' },
  box: { x: 'length', y: 'length', z: 'length' },
  torus: { major_radius: 'length', minor_radius: 'length' },
  extrude: { points: 'points2', height: 'length' },
  revolve: { points: 'points2', degrees: 'angle' },
  sweep: { radius: 'length', path: 'points3', closed: 'boolean' },
  thicken: { outline: 'points2', thickness: 'length', surface: 'word', radius: 'length', axis: 'word', round_corners: 'length' },
};

/**
 * What each operation makes, for describe_piece: the words an agent reads to add a
 * shape of its own. Each starts at the origin; place it with translate and rotate.
 */
export const OP_HELP: Readonly<Record<Operation, string>> = {
  union: 'joins its children into one solid.',
  difference: 'its first child, with every later child cut away.',
  intersection: 'only what all its children share.',
  smooth_union: 'joins its children with a fillet of `radius`; it can blend sphere, cylinder, box, torus, sweep and the transforms and unions of those.',
  translate: 'moves its children by x, y and z.',
  rotate: 'turns its children about x, then y, then z.',
  mirror: 'reflects its children through the plane "xy", "yz" or "xz".',
  sphere: 'a ball of `radius`, centred on the origin.',
  cylinder: 'a round rod of `radius`, standing `height` tall on the origin along z.',
  box: 'a block x by y by z, centred on the origin.',
  torus: 'a ring round z, `major_radius` to the middle of its wire, the wire `minor_radius` thick.',
  extrude: 'a closed 2D outline `points` [["x mm", "y mm"], ...] raised `height` along z.',
  revolve: 'a closed 2D profile `points` (x the radius, y the height) turned round z, all the way or `degrees`.',
  sweep: 'a round wire of `radius` along the 3D `path` [["x mm", "y mm", "z mm"], ...]; `closed` joins its ends.',
  thicken:
    'a thin sheet, such as a cupped or curled petal or a leaf, given a `thickness` along its surface, square to it. `outline` is the sheet laid flat, as cut from sheet metal: [["x mm", "y mm"], ...] round its edge. `surface` is "flat", "sphere" (a cup, curved equally every way) or "cylinder" (a curl, curved one way round `axis` "x" or "y"), and `radius` is how tightly it curves: smaller is deeper, at least 5 times the thickness. The surface touches the origin there and opens upward (+z), with the sheet\'s middle on it. Distances from the origin are kept along the surface; on a sphere, widths narrow a little as it curves away (84 % at 60°). The outline stays within 90° round a sphere and 150° round a cylinder. `round_corners` rounds every corner of the outline to that radius. A casting needs the wall minimum (0.8 mm); the check measures each sheet square to its surface and names it, by its id, in what to thicken.',
};

const REQUIRED_OP_PARAMS: Readonly<Partial<Record<Operation, readonly string[]>>> = {
  smooth_union: ['radius'],
  mirror: ['plane'],
  sphere: ['radius'],
  cylinder: ['radius', 'height'],
  box: ['x', 'y', 'z'],
  torus: ['major_radius', 'minor_radius'],
  extrude: ['points', 'height'],
  revolve: ['points'],
  sweep: ['radius', 'path'],
  thicken: ['outline', 'thickness'],
};

function validateOp(op: Operation, p: Record<string, unknown>, path: string): void {
  const spec = OP_PARAMS[op];
  only(p, path, Object.keys(spec));
  for (const k of REQUIRED_OP_PARAMS[op] ?? []) if (p[k] === undefined) throw new CallError(at(path, k), `a ${op} needs "${k}".`);
  for (const [k, kind] of Object.entries(spec)) {
    const v = p[k];
    if (v === undefined) continue;
    const kp = at(path, k);
    if (kind === 'length') {
      const mm = lengthMm(v, kp);
      if (mm < 0 && !['x', 'y', 'z'].includes(k)) throw new CallError(kp, 'must not be negative.');
    } else if (kind === 'angle') validateUnitsDeep(v, kp, k);
    else if (kind === 'plane') {
      if (!['xy', 'yz', 'xz'].includes(v as string)) throw new CallError(kp, 'the mirror plane is "xy", "yz" or "xz".');
    } else if (kind === 'boolean') {
      if (typeof v !== 'boolean') throw new CallError(kp, 'must be true or false.');
    } else if (kind === 'word') {
      if (typeof v !== 'string') throw new CallError(kp, 'must be a word in quotes, such as "sphere".');
    } else {
      const dim = kind === 'points2' ? 2 : 3;
      if (!Array.isArray(v) || v.length < 2) throw new CallError(kp, `a list of at least 2 points, each [${dim === 2 ? '"x mm", "y mm"' : '"x mm", "y mm", "z mm"'}].`);
      v.forEach((pt, i) => {
        if (!Array.isArray(pt) || pt.length !== dim) throw new CallError(at(kp, i), `a point is ${dim} lengths, e.g. [${dim === 2 ? '"1 mm", "2 mm"' : '"1 mm", "2 mm", "0 mm"'}].`);
        pt.forEach((c, j) => lengthMm(c, at(at(kp, i), j)));
      });
      if (kind === 'points2' && v.length < 3) throw new CallError(kp, 'a profile needs at least 3 points.');
    }
  }
  if (op === 'thicken') validateThicken(p, path);
}

/**
 * A thicken's settings beyond their units (library/thicken.ts has the form). What the
 * library can BUILD is checked here; the casting limit on the thickness is the
 * checker's, so a too-thin sheet can still be drawn and previewed, and is then refused.
 */
function validateThicken(p: Record<string, unknown>, path: string): void {
  const surface = (p['surface'] ?? 'flat') as Surface;
  if (!SURFACES.includes(surface)) {
    throw new CallError(at(path, 'surface'), `must be "flat", "sphere" (a cup, curved equally every way) or "cylinder" (a curl, curved one way); got ${JSON.stringify(p['surface'])}.`);
  }
  const t = lengthMm(p['thickness'], at(path, 'thickness'));
  const [tMin, tMax] = THICKNESS_RANGE_MM;
  if (t < tMin || t > tMax) {
    throw new CallError(at(path, 'thickness'), `${t} mm is outside what the library builds (${tMin} to ${tMax} mm). It is measured square to the surface; a casting needs at least the metal's wall minimum (0.8 mm).`);
  }
  if (surface === 'flat') {
    for (const k of ['radius', 'axis']) {
      if (p[k] !== undefined) throw new CallError(at(path, k), `a flat sheet has no ${k}; leave it out, or set "surface" to "sphere" or "cylinder".`);
    }
  } else {
    if (p['radius'] === undefined) throw new CallError(at(path, 'radius'), `a ${surface} needs the radius its middle surface curves at, e.g. "8 mm": the smaller the radius, the deeper the ${surface === 'sphere' ? 'cup' : 'curl'}.`);
    const r = lengthMm(p['radius'], at(path, 'radius'));
    if (r < MIN_RADIUS_PER_THICKNESS * t - 1e-9) {
      throw new CallError(
        at(path, 'radius'),
        `${r} mm curves a ${t} mm sheet too tightly: the radius must be at least ${MIN_RADIUS_PER_THICKNESS} times the thickness (${Math.round(MIN_RADIUS_PER_THICKNESS * t * 1000) / 1000} mm here). Use a larger radius, or a thinner sheet. Below that the casting check reads the sheet's edge thinner than it is.`,
      );
    }
    if (r > RADIUS_MAX_MM) throw new CallError(at(path, 'radius'), `${r} mm is more than the library builds (${RADIUS_MAX_MM} mm); use "surface": "flat" for a sheet this flat.`);
  }
  if (p['axis'] !== undefined) {
    if (surface !== 'cylinder') throw new CallError(at(path, 'axis'), 'only a cylinder has an axis; leave it out.');
    if (!SHEET_AXES.includes(p['axis'] as 'x' | 'y')) throw new CallError(at(path, 'axis'), `the line the sheet curls round: "x" (it rises as y grows) or "y" (it rises as x grows); got ${JSON.stringify(p['axis'])}.`);
  }
  if (p['round_corners'] !== undefined) {
    const rc = lengthMm(p['round_corners'], at(path, 'round_corners'));
    if (rc < 0 || rc > ROUND_CORNERS_MAX_MM) throw new CallError(at(path, 'round_corners'), `${rc} mm is outside what the library builds (0 to ${ROUND_CORNERS_MAX_MM} mm).`);
  }
  const outline = (p['outline'] as unknown[][]).map((pt, i) => [lengthMm(pt[0], at(at(at(path, 'outline'), i), 0)), lengthMm(pt[1], at(at(at(path, 'outline'), i), 1))] as [number, number]);
  if (Math.abs(signedArea2(outline)) / 2 < 0.01) throw new CallError(at(path, 'outline'), 'the outline encloses no area; give the sheet\'s edge as a closed loop of points, in order round it.');
  if (surface !== 'flat') {
    const r = lengthMm(p['radius'], at(path, 'radius'));
    const axis = (p['axis'] as 'x' | 'y' | undefined) ?? 'x';
    const reach = reachDeg(outline, { surface, radius: r, axis });
    const max = surface === 'sphere' ? SPHERE_MAX_DEG : CYLINDER_MAX_DEG;
    if (reach > max + 1e-9) {
      const minR = Math.ceil(((reach / max) * r) * 10) / 10;
      throw new CallError(
        at(path, 'outline'),
        surface === 'sphere'
          ? `the outline reaches ${Math.round(((reach * Math.PI) / 180) * r * 100) / 100} mm from the origin (the bottom of the cup), more than a quarter of the way round a sphere of radius ${r} mm (${SPHERE_MAX_DEG}°). Use a radius of at least ${minR} mm, or a smaller outline.`
          : `the outline reaches ${Math.round(((reach * Math.PI) / 180) * r * 100) / 100} mm across the cylinder's axis from the origin, more than ${CYLINDER_MAX_DEG}° round a cylinder of radius ${r} mm. Use a radius of at least ${minR} mm, or a smaller outline.`,
      );
    }
  }
}

/** For settings the engine does not know by name: every number must still carry an accepted unit. */
function validateUnitsDeep(v: unknown, path: string, key: string): void {
  if (typeof v === 'number') {
    if (COUNT_KEYS.has(key) && Number.isInteger(v)) return;
    anyQuantity(v, path);
  } else if (typeof v === 'string') {
    if (looksLikeQuantity(v)) anyQuantity(v, path);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => validateUnitsDeep(x, at(path, i), key));
  } else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) validateUnitsDeep(x, at(path, k), k);
  }
}

// ------------------------------------------------------------------- changes

export function findNode(root: TreeNode, id: string): TreeNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return undefined;
}

const SET_ORDER = new Map(PARAMS.map((p, i) => [p.key, i] as const));

/**
 * change_piece's `set`: each key is a named setting (see PARAMS) or "<node id>.<setting>".
 * Applied in the order of PARAMS (so a stone_setting or stone_shape comes before
 * the sizes that depend on it). Returns a NEW tree one revision on.
 */
export function applySet(tree: PieceTree, set: Record<string, unknown>): { tree: PieceTree; changed: string[] } {
  const next = structuredClone(tree);
  const changed: string[] = [];
  const entries = Object.entries(set).sort(([a], [b]) => (SET_ORDER.get(a) ?? 999) - (SET_ORDER.get(b) ?? 999));
  for (const [key, value] of entries) {
    const path = at('set', key);
    const spec = PARAM_BY_KEY.get(key);
    if (spec) {
      checkParam(spec, value, path);
      if (key === 'name') next.name = value as string;
      else if (key === 'shrinkage') next.shrinkage = value as string;
      else if (key === 'metal') next.metal = value as MetalId;
      else if (key === 'stone_setting') setStoneSetting(next, value as string);
      else if (key === 'stone_shape') setStoneShape(next, value as 'round' | 'emerald', path);
      else {
        const target = PARAM_TARGET[key]!;
        const node = findNode(next.root, target.node);
        if (!node) {
          throw new CallError(path, target.node === 'head' ? 'this piece has no stone (it is a plain band); set "stone_setting" to "prong_head" or "bezel" first, in the same call if you like.' : `this piece has no "${target.node}" part.`);
        }
        if (target.part && node.part !== target.part) {
          throw new CallError(path, `this piece's stone is held by a ${node.part === 'bezel' ? 'bezel' : 'prong head'}; set "stone_setting": "${target.part}" first, in the same call if you like.`);
        }
        const stone = (node.params?.['stone'] ?? {}) as Record<string, unknown>;
        if (target.field[0] === 'stone') {
          if (key === 'stone_diameter' && stone['shape'] !== 'round') throw new CallError(path, 'this stone is an emerald cut; give its stone_length and stone_width, or set "stone_shape": "round".');
          if ((key === 'stone_length' || key === 'stone_width') && stone['shape'] !== 'emerald') {
            throw new CallError(path, 'this stone is round; give its stone_diameter, or set "stone_shape": "emerald".');
          }
          stone['placeholder'] = ((stone['placeholder'] as string[] | undefined) ?? []).filter((f) => f !== target.field[1]);
        }
        let o = (node.params ??= {});
        for (const f of target.field.slice(0, -1)) o = (o[f] ??= {}) as Record<string, unknown>;
        o[target.field[target.field.length - 1]!] = value;
      }
      changed.push(key);
      continue;
    }
    const m = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/.exec(key);
    if (!m) {
      throw new CallError(path, `"${key}" is not a setting. Use one of ${PARAMS.map((p) => p.key).join(', ')}, or "<part id>.<setting>" such as "head.culet_clearance"; describe_piece lists them all.`);
    }
    const node = findNode(next.root, m[1]!);
    if (!node) throw new CallError(path, `this piece has no part with id "${m[1]}"; describe_piece lists its parts.`);
    (node.params ??= {})[m[2]!] = value;
    changed.push(key);
  }
  next.revision = tree.revision + 1;
  try {
    validateTree(next);
  } catch (e) {
    if (e instanceof CallError) throw new CallError(e.path, `${e.problem} (This is the piece after applying set ${JSON.stringify(Object.keys(set))}.)`);
    throw e;
  }
  return { tree: next, changed };
}

/** The current value of a setting, as `set` names it, for "what changed" lines. */
export function getSetting(tree: PieceTree, key: string): unknown {
  if (key === 'name') return tree.name;
  if (key === 'shrinkage') return tree.shrinkage;
  if (key === 'metal') return tree.metal;
  const head = findNode(tree.root, 'head');
  if (key === 'stone_setting') return head ? head.part : 'none';
  if (key === 'stone_shape') return (head?.params?.['stone'] as Record<string, unknown> | undefined)?.['shape'];
  const target = PARAM_TARGET[key];
  const m = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/.exec(key);
  const node = findNode(tree.root, target ? target.node : (m?.[1] ?? ''));
  if (!node) return undefined;
  if (target?.part && node.part !== target.part) return undefined;
  let o: unknown = node.params;
  for (const f of target ? target.field : [m![2]!]) o = o && typeof o === 'object' ? (o as Record<string, unknown>)[f] : undefined;
  return o;
}

function setStoneSetting(t: PieceTree, setting: string): void {
  const kids = (t.root.children ??= []);
  const i = kids.findIndex((c) => c.id === 'head');
  const old = i >= 0 ? kids[i]! : undefined;
  if (setting === 'none') {
    if (i >= 0) kids.splice(i, 1);
    return;
  }
  if (old && old.part === setting) return;
  const stone = (old?.params?.['stone'] as Record<string, unknown> | undefined) ?? defaultStone('round');
  const head = headNode(setting as 'prong_head' | 'bezel', stone, {});
  if (i >= 0) kids[i] = head;
  else kids.push(head);
}

function setStoneShape(t: PieceTree, shape: 'round' | 'emerald', path: string): void {
  const head = findNode(t.root, 'head');
  if (!head) throw new CallError(path, 'this piece has no stone (it is a plain band); set "stone_setting" first, in the same call if you like.');
  const old = head.params!['stone'] as Record<string, unknown>;
  if (old['shape'] === shape) return;
  head.params!['stone'] = defaultStone(shape, (old['orientation'] as string | undefined) ?? 'east_west');
}

// ------------------------------------------------------------------ the view

export interface StoneView {
  shape: 'round' | 'emerald';
  lengthMm: number;
  widthMm: number;
  depthMm: number;
  orientation: 'east_west' | 'north_south';
  carat?: string;
  placeholder: string[];
}

export type HeadView =
  | { kind: 'prong_head'; stone: StoneView; prongCount: number; prongThicknessMm: number[]; nominalProngMm: number; gripMm: number; culetClearanceMm: number }
  | { kind: 'bezel'; stone: StoneView; wallMm: number; lipMm: number | 'auto'; culetClearanceMm: number };

/** The values the library and describe_piece read off a validated tree. */
export interface PieceView {
  ringSize: RingSize;
  innerDiameterMm: number;
  bandWidthMm: number;
  bandThicknessMm: number;
  profile: string;
  metal: MetalId;
  head?: HeadView;
  shrinkagePct: number;
  /** Operation subtrees beside the band and head, unioned with them. */
  extras: TreeNode[];
}

function stoneView(s: Record<string, unknown>): StoneView {
  const shape = s['shape'] as 'round' | 'emerald';
  const depthMm = lengthMm(s['depth'], 'stone.depth');
  const v: StoneView =
    shape === 'round'
      ? { shape, lengthMm: lengthMm(s['diameter'], 'stone.diameter'), widthMm: lengthMm(s['diameter'], 'stone.diameter'), depthMm, orientation: 'east_west', placeholder: [] }
      : {
          shape,
          lengthMm: lengthMm(s['length'], 'stone.length'),
          widthMm: lengthMm(s['width'], 'stone.width'),
          depthMm,
          orientation: s['orientation'] as 'east_west' | 'north_south',
          placeholder: [],
        };
  if (s['carat'] !== undefined) v.carat = caratText(s['carat'], 'stone.carat');
  v.placeholder = [...((s['placeholder'] as string[] | undefined) ?? [])];
  return v;
}

export function readPiece(tree: PieceTree): PieceView {
  const band = findNode(tree.root, 'band')!;
  const bp = band.params!;
  const { size, diameterMm } = ringInnerDiameterMm(bp['ring_size'], 'tree.band.ring_size');
  const view: PieceView = {
    ringSize: size,
    innerDiameterMm: diameterMm,
    bandWidthMm: lengthMm(bp['width'], 'band.width'),
    bandThicknessMm: lengthMm(bp['thickness'], 'band.thickness'),
    profile: bp['profile'] as string,
    metal: tree.metal,
    shrinkagePct: shrinkagePercent(tree.shrinkage, tree.metal, 'tree.shrinkage'),
    extras: (tree.root.children ?? []).filter((c) => c.id !== 'band' && c.id !== 'head'),
  };
  const head = findNode(tree.root, 'head');
  if (head && head.part === 'prong_head') {
    const hp = head.params!;
    const count = hp['prong_count'] as number;
    const base = lengthMm(hp['prong_thickness'], 'head.prong_thickness');
    const each = Array.from({ length: count }, () => base);
    for (const o of (hp['prong_overrides'] as { prong: number; thickness: string }[] | undefined) ?? []) each[o.prong - 1] = lengthMm(o.thickness, 'head.prong_overrides');
    view.head = {
      kind: 'prong_head',
      stone: stoneView(hp['stone'] as Record<string, unknown>),
      prongCount: count,
      prongThicknessMm: each,
      nominalProngMm: base,
      gripMm: lengthMm(hp['prong_grip'], 'head.prong_grip'),
      culetClearanceMm: lengthMm(hp['culet_clearance'], 'head.culet_clearance'),
    };
  } else if (head && head.part === 'bezel') {
    const hp = head.params!;
    view.head = {
      kind: 'bezel',
      stone: stoneView(hp['stone'] as Record<string, unknown>),
      wallMm: lengthMm(hp['wall'], 'head.wall'),
      lipMm: hp['lip'] === 'auto' ? 'auto' : lengthMm(hp['lip'], 'head.lip'),
      culetClearanceMm: lengthMm(hp['culet_clearance'], 'head.culet_clearance'),
    };
  }
  return view;
}
