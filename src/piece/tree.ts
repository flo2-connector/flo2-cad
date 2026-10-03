// A piece is a TREE of operations and jewelry parts, as data; no agent code runs
// (dec:how-a-piece-is-described, owner round 1, Q3). The tree is what travels
// through flo2 (contract §3): every tool that changes a piece takes and returns
// it, and flo2 keeps each version as `<name>.tree.json`, so any call may carry a
// tree to resume from.
//
// Every number in a tree carries its unit ("1.2 mm", "30 deg"), except counts
// (prong_count) and the revision. A plain band and a 4- or 6-prong head are
// PARAMETERS of the same tree, not separate code: `stone_setting` adds or
// removes the head, `prong_count` picks 4 or 6.

import { CallError, at } from '../errors.js';
import { anyQuantity, lengthMm, percent, ringInnerDiameterMm, looksLikeQuantity, type RingSize } from '../units.js';

export const TREE_FORMAT = 'flo2-cad.tree/1';

export interface TreeNode {
  id: string;
  /** A jewelry part from the library (ring_shank, prong_head). */
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
  /** "off" (the default) or an allowance such as "1.5 %". */
  shrinkage: string;
  root: TreeNode;
}

export const TEMPLATES = ['solitaire_ring', 'plain_band'] as const;
export type Template = (typeof TEMPLATES)[number];

/** Operations a tree may hold. Phase 1 validates their units; Phase 2 evaluates them. */
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
] as const;

export const PARTS = ['ring_shank', 'prong_head'] as const;
export const FEATURES = ['wall', 'band', 'prong', 'seat', 'detail'] as const;
export const BAND_PROFILES = ['comfort_fit', 'half_round', 'flat'] as const;
export const STONE_SETTINGS = ['prong_head', 'none'] as const;

/** Keys in a tree whose numbers are counts, not measurements, so carry no unit. */
const COUNT_KEYS = new Set(['prong_count', 'prong', 'count', 'segments']);

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const NODE_ID = /^[a-z][a-z0-9_]{0,39}$/;

// ------------------------------------------------------------------ parameters

/** One named setting of a piece, as start_piece takes it and change_piece's `set` changes it. */
export interface ParamSpec {
  readonly key: string;
  readonly help: string;
  readonly kind: 'name' | 'ring_size' | 'length' | 'enum' | 'shrinkage';
  readonly values?: readonly (string | number)[];
  readonly min?: number;
  readonly max?: number;
  readonly default?: string | number;
  /** The casting limit the checker holds it to, when there is one. */
  readonly limit?: string;
}

// Library defaults sit ABOVE each casting limit with a margin, never at it
// (con:library-defaults-above-the-limits). The allowed ranges are what the
// library can BUILD; they deliberately reach below the casting limits, so a
// too-thin prong can be drawn and previewed and is then refused at export.
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
    help: "The band's cross-section: comfort_fit (rounded inside and out), half_round (flat inside, domed outside) or flat.",
  },
  {
    key: 'stone_setting',
    kind: 'enum',
    values: STONE_SETTINGS,
    default: 'prong_head',
    help: 'prong_head holds one round stone in prongs on top of the band; none makes a plain band.',
  },
  { key: 'stone_diameter', kind: 'length', min: 2, max: 14, default: '6.5 mm', help: 'Diameter of the round stone at its widest point (its girdle). 6.5 mm is about a one-carat diamond.' },
  { key: 'prong_count', kind: 'enum', values: [4, 6], default: 4, help: 'How many prongs grip the stone: 4 or 6.' },
  {
    key: 'prong_thickness',
    kind: 'length',
    min: 0.3,
    max: 3,
    default: '1.2 mm',
    limit: '1.0 mm',
    help: 'How thick each prong is. A thinner prong can be drawn and previewed, but the piece will not export until every prong is at least the limit.',
  },
  {
    key: 'shrinkage',
    kind: 'shrinkage',
    default: 'off',
    help: '"off", or an allowance such as "1.5 %" that enlarges the piece so it shrinks back to size in casting. Every export says whether it was applied.',
  },
];

const PARAM_BY_KEY = new Map(PARAMS.map((p) => [p.key, p] as const));

/** Where each named setting lives in the tree. */
const PARAM_TARGET: Readonly<Record<string, { node: string; field: readonly string[] }>> = {
  ring_size: { node: 'band', field: ['ring_size'] },
  band_width: { node: 'band', field: ['width'] },
  band_thickness: { node: 'band', field: ['thickness'] },
  band_profile: { node: 'band', field: ['profile'] },
  stone_diameter: { node: 'head', field: ['stone', 'diameter'] },
  prong_count: { node: 'head', field: ['prong_count'] },
  prong_thickness: { node: 'head', field: ['prong_thickness'] },
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
      if (spec.min !== undefined && mm < spec.min) {
        throw new CallError(path, `${mm} mm is below the smallest the library can build (${spec.min} mm).`);
      }
      if (spec.max !== undefined && mm > spec.max) {
        throw new CallError(path, `${mm} mm is above the largest the library builds (${spec.max} mm).`);
      }
      return;
    }
    case 'enum':
      if (!spec.values!.includes(v as string | number)) {
        throw new CallError(path, `must be one of ${spec.values!.map((x) => JSON.stringify(x)).join(', ')}.`);
      }
      return;
    case 'shrinkage':
      shrinkagePercent(v, path);
      return;
  }
}

/** The shrinkage allowance in percent, 0 when "off". */
export function shrinkagePercent(v: unknown, path: string): number {
  if (v === 'off') return 0;
  const pct = percent(v, path);
  if (pct <= 0 || pct > 5) {
    throw new CallError(path, `a shrinkage allowance is "off" or between 0 and 5 %, for example "1.5 %"; got "${String(v)}".`);
  }
  return pct;
}

// ------------------------------------------------------------------- templates

const HEAD_DEFAULTS = {
  /** How far the stone's girdle sits above the top of the band. */
  seat_height: '2.5 mm',
  /** How far each prong tip reaches over the stone's girdle, to grip it. */
  prong_grip: '0.5 mm',
};

function bandNode(o: Record<string, unknown>): TreeNode {
  return {
    id: 'band',
    part: 'ring_shank',
    feature: 'band',
    params: {
      ring_size: o['ring_size'],
      width: o['band_width'] ?? PARAM_BY_KEY.get('band_width')!.default,
      thickness: o['band_thickness'] ?? PARAM_BY_KEY.get('band_thickness')!.default,
      profile: o['band_profile'] ?? PARAM_BY_KEY.get('band_profile')!.default,
    },
  };
}

function headNode(o: Record<string, unknown>): TreeNode {
  return {
    id: 'head',
    part: 'prong_head',
    feature: 'prong',
    params: {
      stone: { shape: 'round', diameter: o['stone_diameter'] ?? PARAM_BY_KEY.get('stone_diameter')!.default },
      prong_count: o['prong_count'] ?? PARAM_BY_KEY.get('prong_count')!.default,
      prong_thickness: o['prong_thickness'] ?? PARAM_BY_KEY.get('prong_thickness')!.default,
      seat_height: HEAD_DEFAULTS.seat_height,
      prong_grip: HEAD_DEFAULTS.prong_grip,
      prong_overrides: [],
    },
  };
}

/** start_piece's arguments, already checked, as a new tree at revision 1. */
export function treeFromTemplate(template: Template, args: Record<string, unknown>): PieceTree {
  const setting = args['stone_setting'] ?? (template === 'plain_band' ? 'none' : 'prong_head');
  const children = [bandNode(args)];
  if (setting === 'prong_head') children.push(headNode(args));
  return {
    format: TREE_FORMAT,
    name: (args['name'] as string | undefined) ?? (template === 'plain_band' ? 'band' : 'solitaire'),
    revision: 1,
    template,
    shrinkage: (args['shrinkage'] as string | undefined) ?? 'off',
    root: { id: 'ring', op: 'union', children },
  };
}

/** Checks start_piece's piece settings, each under its own argument name. */
export function checkStartArgs(args: Record<string, unknown>): Template {
  const template = args['template'];
  if (template === undefined) throw new CallError('template', `choose a starting design: ${TEMPLATES.map((t) => `"${t}"`).join(' or ')}.`);
  if (!TEMPLATES.includes(template as Template)) {
    throw new CallError('template', `"${String(template)}" is not a starting design this engine has; use ${TEMPLATES.map((t) => `"${t}"`).join(' or ')}.`);
  }
  if (args['ring_size'] === undefined) {
    throw new CallError('ring_size', 'give the finger size with its system, for example {"system": "US", "size": "7"}.');
  }
  for (const spec of PARAMS) {
    if (args[spec.key] !== undefined) checkParam(spec, args[spec.key], spec.key);
  }
  if (template === 'plain_band' || args['stone_setting'] === 'none') {
    for (const k of ['stone_diameter', 'prong_count', 'prong_thickness']) {
      if (args[k] !== undefined) {
        throw new CallError(k, 'a plain band has no stone or prongs; leave this out, or start a "solitaire_ring".');
      }
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
  if (t['format'] !== TREE_FORMAT) {
    throw new CallError(at(path, 'format'), `must be "${TREE_FORMAT}"; got ${JSON.stringify(t['format'])}.`);
  }
  checkParam(PARAM_BY_KEY.get('name')!, t['name'], at(path, 'name'));
  if (!Number.isInteger(t['revision']) || (t['revision'] as number) < 1) {
    throw new CallError(at(path, 'revision'), 'must be a whole number, 1 or more (it counts the changes, so it has no unit).');
  }
  if (!TEMPLATES.includes(t['template'] as Template)) {
    throw new CallError(at(path, 'template'), `must be one of ${TEMPLATES.map((x) => `"${x}"`).join(', ')}.`);
  }
  shrinkagePercent(t['shrinkage'], at(path, 'shrinkage'));
  for (const k of Object.keys(t)) {
    if (!['format', 'name', 'revision', 'template', 'shrinkage', 'root'].includes(k)) {
      throw new CallError(at(path, k), 'is not a field of a piece tree.');
    }
  }
  const ids = new Set<string>();
  validateNode(t['root'], at(path, 'root'), ids);
  return v as PieceTree;
}

function validateNode(v: unknown, path: string, ids: Set<string>): void {
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
  if (hasOp && !OPERATIONS.includes(n['op'] as (typeof OPERATIONS)[number])) {
    throw new CallError(at(path, 'op'), `"${String(n['op'])}" is not an operation; the operations are ${OPERATIONS.join(', ')}.`);
  }
  if (n['feature'] !== undefined && !FEATURES.includes(n['feature'] as (typeof FEATURES)[number])) {
    throw new CallError(at(path, 'feature'), `must be one of ${FEATURES.join(', ')}.`);
  }
  for (const k of Object.keys(n)) {
    if (!['id', 'part', 'op', 'feature', 'params', 'children'].includes(k)) throw new CallError(at(path, k), 'is not a field of a tree node.');
  }
  const params = n['params'] ?? {};
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new CallError(at(path, 'params'), 'must be an object of settings.');
  }
  const pPath = at(path, 'params');
  if (n['part'] === 'ring_shank') validateBand(params as Record<string, unknown>, pPath);
  else if (n['part'] === 'prong_head') validateHead(params as Record<string, unknown>, pPath);
  else validateUnitsDeep(params, pPath, '');
  const children = n['children'];
  if (children !== undefined) {
    if (!Array.isArray(children)) throw new CallError(at(path, 'children'), 'must be a list of nodes.');
    children.forEach((c, i) => validateNode(c, at(at(path, 'children'), i), ids));
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

function validateHead(p: Record<string, unknown>, path: string): void {
  only(p, path, ['stone', 'prong_count', 'prong_thickness', 'seat_height', 'prong_grip', 'prong_overrides']);
  const stone = p['stone'];
  if (stone === null || typeof stone !== 'object' || Array.isArray(stone)) {
    throw new CallError(at(path, 'stone'), 'the stone is {"shape": "round", "diameter": "6.5 mm"}.');
  }
  const s = stone as Record<string, unknown>;
  only(s, at(path, 'stone'), ['shape', 'diameter']);
  if (s['shape'] !== 'round') throw new CallError(at(at(path, 'stone'), 'shape'), 'only "round" stones are in the first increment.');
  checkParam(PARAM_BY_KEY.get('stone_diameter')!, s['diameter'], at(at(path, 'stone'), 'diameter'));
  checkParam(PARAM_BY_KEY.get('prong_count')!, p['prong_count'], at(path, 'prong_count'));
  checkParam(PARAM_BY_KEY.get('prong_thickness')!, p['prong_thickness'], at(path, 'prong_thickness'));
  const seat = lengthMm(p['seat_height'], at(path, 'seat_height'));
  if (seat < 0.5 || seat > 8) throw new CallError(at(path, 'seat_height'), `${seat} mm is outside what the library builds (0.5 to 8 mm).`);
  const grip = lengthMm(p['prong_grip'], at(path, 'prong_grip'));
  if (grip < 0.2 || grip > 2) throw new CallError(at(path, 'prong_grip'), `${grip} mm is outside what the library builds (0.2 to 2 mm).`);
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

/** For operations whose settings Phase 1 does not know by name: every number must still carry an accepted unit. */
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

/**
 * change_piece's `set`: each key is a named setting (see PARAMS) or "<node id>.<setting>".
 * Returns a NEW tree one revision on; the input is not touched.
 */
export function applySet(tree: PieceTree, set: Record<string, unknown>): { tree: PieceTree; changed: string[] } {
  const next = structuredClone(tree);
  const changed: string[] = [];
  for (const [key, value] of Object.entries(set)) {
    const path = at('set', key);
    const spec = PARAM_BY_KEY.get(key);
    if (spec) {
      checkParam(spec, value, path);
      if (key === 'name') next.name = value as string;
      else if (key === 'shrinkage') next.shrinkage = value as string;
      else if (key === 'stone_setting') setStoneSetting(next, value as string);
      else {
        const target = PARAM_TARGET[key]!;
        const node = findNode(next.root, target.node);
        if (!node) {
          throw new CallError(path, target.node === 'head' ? 'this piece has no stone setting (it is a plain band); set "stone_setting": "prong_head" first, in the same call if you like.' : `this piece has no "${target.node}" part.`);
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
      throw new CallError(path, `"${key}" is not a setting. Use one of ${PARAMS.map((p) => p.key).join(', ')}, or "<part id>.<setting>" such as "head.seat_height"; describe_piece lists them all.`);
    }
    const node = findNode(next.root, m[1]!);
    if (!node) throw new CallError(path, `this piece has no part with id "${m[1]}"; describe_piece lists its parts.`);
    (node.params ??= {})[m[2]!] = value;
    changed.push(key);
  }
  // Settings that depend on each other (a stone_setting and a prong_count in one call)
  // are applied in key order above; whatever results must be a valid tree.
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
  if (key === 'stone_setting') return findNode(tree.root, 'head') ? 'prong_head' : 'none';
  const target = PARAM_TARGET[key];
  const m = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/.exec(key);
  const node = findNode(tree.root, target ? target.node : (m?.[1] ?? ''));
  if (!node) return undefined;
  let o: unknown = node.params;
  for (const f of target ? target.field : [m![2]!]) o = o && typeof o === 'object' ? (o as Record<string, unknown>)[f] : undefined;
  return o;
}

function setStoneSetting(t: PieceTree, setting: string): void {
  const root = t.root;
  const kids = (root.children ??= []);
  const i = kids.findIndex((c) => c.id === 'head');
  if (setting === 'none' && i >= 0) kids.splice(i, 1);
  if (setting === 'prong_head' && i < 0) kids.push(headNode({}));
}

/** The values the stub engine and describe_piece read off a template-shaped tree. */
export interface TemplateView {
  ringSize: RingSize;
  innerDiameterMm: number;
  bandWidthMm: number;
  bandThicknessMm: number;
  profile: string;
  head?: {
    stoneDiameterMm: number;
    prongCount: number;
    prongThicknessMm: number[];
    seatHeightMm: number;
    gripMm: number;
  };
  shrinkagePct: number;
}

export function readTemplate(tree: PieceTree): TemplateView {
  const band = findNode(tree.root, 'band');
  if (!band || band.part !== 'ring_shank') throw new CallError('tree.root', 'this piece has no ring_shank part with id "band".');
  const bp = band.params!;
  const { size, diameterMm } = ringInnerDiameterMm(bp['ring_size'], 'tree.band.ring_size');
  const view: TemplateView = {
    ringSize: size,
    innerDiameterMm: diameterMm,
    bandWidthMm: lengthMm(bp['width'], 'tree.band.width'),
    bandThicknessMm: lengthMm(bp['thickness'], 'tree.band.thickness'),
    profile: bp['profile'] as string,
    shrinkagePct: shrinkagePercent(tree.shrinkage, 'tree.shrinkage'),
  };
  const head = findNode(tree.root, 'head');
  if (head && head.part === 'prong_head') {
    const hp = head.params!;
    const count = hp['prong_count'] as number;
    const base = lengthMm(hp['prong_thickness'], 'tree.head.prong_thickness');
    const each = Array.from({ length: count }, () => base);
    for (const o of (hp['prong_overrides'] as { prong: number; thickness: string }[] | undefined) ?? []) {
      each[o.prong - 1] = lengthMm(o.thickness, 'tree.head.prong_overrides');
    }
    view.head = {
      stoneDiameterMm: lengthMm((hp['stone'] as Record<string, unknown>)['diameter'], 'tree.head.stone.diameter'),
      prongCount: count,
      prongThicknessMm: each,
      seatHeightMm: lengthMm(hp['seat_height'], 'tree.head.seat_height'),
      gripMm: lengthMm(hp['prong_grip'], 'tree.head.prong_grip'),
    };
  }
  return view;
}
