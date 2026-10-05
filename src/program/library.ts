// What a PROGRAM can call (cap:the-agent-writes-a-piece-as-a-program,
// cap:todays-parts-are-library-functions-a-program-calls): the kernel's general
// operations and the jewelry library, on the HOST side of the confinement. It runs in
// the evaluation child (child.ts), never in the engine's own process.
//
// THE PROGRAM HOLDS HANDLES, NEVER GEOMETRY OR DECLARATIONS. Every solid, 2D profile and
// stone the program makes lives here, in this table; the program gets back a number
// wrapped in an object of its own realm (prelude.ts). Every call arrives as a name and
// JSON text and leaves as JSON text, and nothing else crosses: no object, function or
// error of this realm ever reaches the program. So a checker declaration (a band, a
// stone's seat, a prong, a bezel, a sheet, a blend's surface) can come ONLY from a
// library call made here, and it follows its solid through every transform and boolean
// by the rules below; a program cannot write one.
//
// ONE SOURCE OF TRUTH. The parts are the template's parts: ringShank, prongHead and
// bezel take start_piece's settings, checked by the tree's own checks (checkParam,
// checkHeadSettings), sized by pieceDims and built by buildBand and buildHead (build.ts).
// The kernel shapes a tree also has (sphere, cylinder, box, torus, sweep, smooth_union,
// thicken) are built by the tree's own buildOp from a tree node, and op() takes any tree
// operation subtree as it is. So a program-built ring is the template ring.
//
// UNITS. A bare number is a length in mm, or an angle in degrees where an angle is asked
// for; a string must carry its unit and is read by the engine's own unit parser, which
// refuses a foreign unit with the conversion (program.ts says why).
//
// WHAT A DECLARATION SURVIVES. The checker measures a band round the y axis through the
// origin, and prongs, a bezel and a stone's seat upright, along z (checker/features.ts).
//  · translate, rotate and mirror move every declaration with its solid, if they keep
//    that frame: a band may only turn about y; a setting may move anywhere and turn
//    about z. Anything else is refused, naming the part, never applied silently.
//  · scale and hull are refused on a solid that carries a part's declaration (they would
//    change what the part was built to, or swallow it).
//  · union and intersection keep every operand's declarations; a piece has at most one
//    band and one stone setting, as a tree does.
//  · difference keeps the first operand's, and the cutters' blend surfaces (a blend's
//    surface cut into the piece is the piece's surface), as a tree's difference does.
// The engine then checks, in its own process, that each declaration still has metal
// where it says (verify.ts).

import type { AddedDecl, BandDecl, BezelDecl, FeatureDecl, P2, P3, ProngDecl, SheetDecl, StoneDecl } from '../checker/features.js';
import { CallError, at } from '../errors.js';
import { segmentsFor, type CrossSection, type Kernel, type Manifold, type Vec2, type Vec3 } from '../kernel/manifold.js';
import { Arena, buildBand, buildHead, clockOf, finishMetal, pieceDims, polygonsToMesh, type HeadDims, type MeshOut, type PieceDims } from '../library/build.js';
import { buildOp } from '../library/ops.js';
import { outsideConvex, stoneShape, type StoneShapeInfo } from '../library/stones.js';
import { compose, IDENTITY, reflection, rotation, translation, type Affine, type BlendMeshes, type BlendRecord, type OpContext } from '../library/thicken.js';
import { bandDefaults, checkHeadSettings, checkParam, HEAD_DEFAULTS, headView, PARAM_BY_KEY, stoneView, validateOpNode, type PieceView, type StoneView, type TreeNode } from '../piece/tree.js';
import { angleDeg, caratText, lengthMm, ringInnerDiameterMm } from '../units.js';

/** No coordinate of a program's piece lies further than this from the origin (a model ship included). */
export const MAX_REACH_MM = 1000;

/** Every name a program can call: the kernel's operations, the library's parts, and the methods of what they return. */
export const PROGRAM_CALLS = [
  // kernel: solids
  'sphere', 'cylinder', 'box', 'torus', 'sweep', 'extrude', 'revolve', 'hull', 'hullPoints',
  'union', 'difference', 'intersection', 'smoothUnion', 'op', 'segments',
  // kernel: 2D profiles
  'circle', 'rect', 'polygon',
  // library
  'ringShank', 'roundStone', 'emeraldStone', 'cabochon', 'stone', 'prongHead', 'bezel', 'thicken', 'relief',
  // methods of a solid
  'translate', 'rotate', 'mirror', 'scale', 'named', 'bounds', 'volume', 'slice', 'project', 'trim',
  // methods of a profile
  'p_offset', 'p_add', 'p_subtract', 'p_intersect', 'p_translate', 'p_rotate', 'p_scale', 'p_mirror', 'p_hull', 'p_bounds', 'p_area',
] as const;
export type ProgramCall = (typeof PROGRAM_CALLS)[number];

/** The dimensions a library call reports: what describe_piece prints for a program piece. */
export type PartReport =
  | { call: 'ringShank'; ringSize: { system: string; size: string }; band: PieceDims['band'] }
  | { call: 'prongHead' | 'bezel'; onBand: PieceDims['band'] | null; head: HeadDims; stone: { shape: 'round' | 'emerald' | 'custom'; name?: string; kind?: 'cabochon' } };

interface Decls {
  band?: BandDecl;
  stone?: StoneDecl;
  prongs: ProngDecl[];
  bezel?: BezelDecl;
  sheets: SheetDecl[];
  blends: BlendRecord[];
  added: AddedDecl[];
}

interface SolidRec {
  kind: 'solid';
  m: Manifold;
  d: Decls;
  /** The stones the solid's settings hold: drawn in a preview, never in a casting file. */
  stones: Manifold[];
  parts: PartReport[];
  /** What the program reads back as `.dims`: a library part's own dimensions. */
  dims?: unknown;
  /** The solid as a tree node, when it is one a smooth blend can take (sphere, cylinder, box, torus, sweep, their moves and unions). */
  node?: TreeNode;
}
interface StoneRec {
  kind: 'stone';
  view: StoneView;
  shape: StoneShapeInfo;
  custom: boolean;
  /** Declared a cabochon (cabochon(), or stone(..., { kind: 'cabochon' })): its bezel lip is held to the cabochon's rule. */
  cabochon: boolean;
  name?: string;
}
interface ProfileRec {
  kind: 'profile';
  cs: CrossSection;
}
type Rec = SolidRec | StoneRec | ProfileRec;

/** One evaluation's finished result, in the written file's coordinates (shrinkage applied). */
export interface ProgramResult {
  metal: MeshOut;
  stone?: MeshOut;
  decl: FeatureDecl;
  parts: PartReport[];
}

const emptyDecls = (): Decls => ({ prongs: [], sheets: [], blends: [], added: [] });
const NAME_ID = /^[a-z][a-z0-9_]{0,39}$/;

/** A number for a tree's unit text: fixed-point (the unit parser takes no exponent), trailing zeros trimmed. */
function fixed(x: number): string {
  const s = x.toFixed(9).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
const mmText = (x: number) => `${fixed(x)} mm`;
const degText = (x: number) => `${fixed(x)} deg`;

/** The kernel's 4 × 3 column-major matrix for a 3 × 4 row-major affine map. */
function mat4(m: Affine): [number, number, number, number, number, number, number, number, number, number, number, number] {
  return [m[0]!, m[4]!, m[8]!, m[1]!, m[5]!, m[9]!, m[2]!, m[6]!, m[10]!, m[3]!, m[7]!, m[11]!];
}

const applyPoint = (m: Affine, p: readonly number[]): P3 => [
  m[0]! * p[0]! + m[1]! * p[1]! + m[2]! * p[2]! + m[3]!,
  m[4]! * p[0]! + m[5]! * p[1]! + m[6]! * p[2]! + m[7]!,
  m[8]! * p[0]! + m[9]! * p[1]! + m[10]! * p[2]! + m[11]!,
];
const applyDir = (m: Affine, d: readonly number[]): P3 => [m[0]! * d[0]! + m[1]! * d[1]! + m[2]! * d[2]!, m[4]! * d[0]! + m[5]! * d[1]! + m[6]! * d[2]!, m[8]! * d[0]! + m[9]! * d[1]! + m[10]! * d[2]!];

const tiny = (x: number) => Math.abs(x) < 1e-9;
/** z stays z: the map turns only about z, mirrors only across a vertical plane, and may move anywhere. */
const keepsUpright = (m: Affine) => tiny(m[2]!) && tiny(m[6]!) && tiny(m[8]!) && tiny(m[9]!) && Math.abs(m[10]! - 1) < 1e-9;
/** The y axis through the origin stays where it is (a turn about y, or a mirror through a plane holding or square to it). */
const keepsFingerAxis = (m: Affine) => tiny(m[1]!) && tiny(m[4]!) && tiny(m[6]!) && tiny(m[9]!) && tiny(m[3]!) && tiny(m[7]!) && tiny(m[11]!);

function ccw(pts: Vec2[]): Vec2[] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? [...pts].reverse() : pts;
}

/** The library and kernel for ONE evaluation of a program, at one tolerance. */
export class ProgramLibrary {
  readonly #k: Kernel;
  readonly #A: Arena;
  readonly #tol: number;
  readonly #blendMeshes: BlendMeshes | undefined;
  readonly #recs: Rec[] = [];
  #nextId = 0;

  constructor(k: Kernel, A: Arena, tol: number, blendMeshes?: BlendMeshes) {
    this.#k = k;
    this.#A = A;
    this.#tol = tol;
    this.#blendMeshes = blendMeshes;
  }

  /**
   * THE BRIDGE: a call by name, its arguments as JSON text; the answer as JSON text,
   * {"ok": value} or {"error": "what went wrong"}. It never throws, so no error object of
   * this realm can reach the program.
   */
  call(name: string, argsJson: string): string {
    try {
      if (typeof name !== 'string' || !(PROGRAM_CALLS as readonly string[]).includes(name)) throw new CallError(String(name), 'is not something a program can call.');
      if (typeof argsJson !== 'string' || argsJson.length > 20_000_000) throw new CallError(name, 'its arguments are too large.');
      const args = JSON.parse(argsJson) as unknown;
      if (!Array.isArray(args)) throw new CallError(name, 'takes a list of arguments.');
      const out = this.#dispatch(name as ProgramCall, args);
      return JSON.stringify({ ok: this.#encode(out) });
    } catch (e) {
      return JSON.stringify({ error: messageOf(e) });
    }
  }

  /** The solid a program returned, finished as a casting file would hold it. */
  finish(id: unknown, scale: number, withBlendSurface: boolean): ProgramResult {
    const rec = typeof id === 'number' ? this.#recs[id] : undefined;
    if (!rec || rec.kind !== 'solid') throw new CallError('program', 'must end by returning the piece: one solid, for example "return union(band, head);".');
    const d = rec.d;
    const decl: FeatureDecl = {
      prongs: d.prongs.map((p) => ({ ...p, axis: [...p.axis] as P2 })),
      scale: 1,
      ...(d.band ? { band: { ...d.band } } : {}),
      ...(d.stone ? { stone: { ...d.stone, outline: d.stone.outline.map((q) => [...q] as P2) } } : {}),
      ...(d.bezel ? { bezel: { ...d.bezel, outer: d.bezel.outer.map((q) => [...q] as P2) } } : {}),
      ...(d.sheets.length ? { sheets: d.sheets.map((s) => ({ ...s, points: s.points.map((q) => [...q] as P3), normals: s.normals.map((q) => [...q] as P3) })) } : {}),
      ...(d.added.length ? { added: d.added.map((a) => ({ ...a, min: [...a.min] as P3, max: [...a.max] as P3 })) } : {}),
    };
    const done = finishMetal(this.#A, rec.m, decl, d.blends, scale, withBlendSurface);
    for (const p of done.mesh.positions) {
      if (!(Math.abs(p) <= MAX_REACH_MM * Math.max(1, scale))) throw new CallError('program', `the piece reaches ${Math.round(Math.abs(p))} mm from the origin; a piece stays within ${MAX_REACH_MM} mm of it.`);
    }
    let stone: MeshOut | undefined;
    if (rec.stones.length) {
      const all = rec.stones.length === 1 ? rec.stones[0]! : this.#A.t(this.#k.Manifold.union(rec.stones));
      stone = polygonsToMesh(scale !== 1 ? this.#A.t(all.scale(scale)) : all);
    }
    return { metal: done.mesh, ...(stone ? { stone } : {}), decl, parts: rec.parts };
  }

  // ------------------------------------------------------------------ handles

  #add(r: Rec): number {
    this.#recs.push(r);
    return this.#recs.length - 1;
  }

  #encode(v: unknown): unknown {
    if (v && typeof v === 'object' && 'kind' in v) {
      const r = v as Rec;
      const id = this.#add(r);
      if (r.kind === 'solid') return { $solid: id, ...(r.dims !== undefined ? { dims: r.dims } : {}) };
      if (r.kind === 'stone') return { $stone: id, dims: stoneDimsOf(r) };
      return { $profile: id };
    }
    return v;
  }

  #ref(v: unknown, path: string): Rec | undefined {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const o = v as Record<string, unknown>;
    const id = o['$solid'] ?? o['$stone'] ?? o['$profile'];
    if (typeof id !== 'number' || !Number.isInteger(id)) return undefined;
    const r = this.#recs[id];
    if (!r) throw new CallError(path, 'is not something this program made.');
    return r;
  }

  #solid(v: unknown, path: string): SolidRec {
    const r = this.#ref(v, path);
    if (r?.kind === 'solid') return r;
    if (r?.kind === 'stone') throw new CallError(path, 'is a stone. A stone is never metal: hold it with prongHead or bezel.');
    if (r?.kind === 'profile') throw new CallError(path, 'is a 2D profile; make it a solid with extrude or revolve first.');
    throw new CallError(path, 'must be a solid (a shape made by sphere, extrude, ringShank and so on).');
  }

  #profile(v: unknown, path: string): ProfileRec {
    const r = this.#ref(v, path);
    if (r?.kind === 'profile') return r;
    throw new CallError(path, 'must be a 2D profile (made by circle, rect or polygon).');
  }

  #stone(v: unknown, path: string): StoneRec {
    const r = this.#ref(v, path);
    if (r?.kind === 'stone') return r;
    throw new CallError(path, 'must be a stone, made by roundStone, emeraldStone, cabochon or stone().');
  }

  #id(prefix: string): string {
    this.#nextId++;
    return `${prefix}_${this.#nextId}`;
  }

  #len(v: unknown, path: string, opts: { min?: number; positive?: boolean } = {}): number {
    const x = typeof v === 'number' ? v : lengthMm(v, path);
    if (!Number.isFinite(x)) throw new CallError(path, 'must be a finite number of millimetres.');
    if (Math.abs(x) > MAX_REACH_MM) throw new CallError(path, `${x} mm is more than a piece can be (${MAX_REACH_MM} mm).`);
    if (opts.positive && !(x > 0)) throw new CallError(path, 'must be more than 0 mm.');
    if (opts.min !== undefined && x < opts.min) throw new CallError(path, `must be at least ${opts.min} mm.`);
    return x;
  }

  #deg(v: unknown, path: string): number {
    const x = typeof v === 'number' ? v : angleDeg(v, path);
    if (!Number.isFinite(x)) throw new CallError(path, 'must be a finite number of degrees.');
    return x;
  }

  /** A length as a tree takes it: a bare number is mm; a string keeps its own unit, to be read (and a foreign one refused) by the tree's checks. */
  #lenText(v: unknown, path: string): unknown {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new CallError(path, 'must be a finite number of millimetres.');
      return mmText(v);
    }
    return v;
  }

  #vec3(v: unknown, path: string, unit: 'mm' | 'deg' = 'mm'): Vec3 {
    if (!Array.isArray(v) || v.length !== 3) throw new CallError(path, `must be [x, y, z]${unit === 'deg' ? ' in degrees' : ' in mm'}.`);
    return v.map((c, i) => (unit === 'deg' ? this.#deg(c, at(path, i)) : this.#len(c, at(path, i)))) as Vec3;
  }

  /** [x, y, z] as one array, or as three numbers. */
  #vecArgs(args: unknown[], from: number, path: string, unit: 'mm' | 'deg' = 'mm'): Vec3 {
    const a = args[from];
    if (Array.isArray(a)) return this.#vec3(a, path, unit);
    const xyz = [args[from] ?? 0, args[from + 1] ?? 0, args[from + 2] ?? 0];
    return this.#vec3(xyz, path, unit);
  }

  #pts2(v: unknown, path: string, min = 3): Vec2[] {
    if (!Array.isArray(v) || v.length < min) throw new CallError(path, `a list of at least ${min} points, each [x, y] in mm.`);
    if (v.length > 200_000) throw new CallError(path, 'has more points than a profile can.');
    return v.map((p, i) => {
      if (!Array.isArray(p) || p.length !== 2) throw new CallError(at(path, i), 'a point is [x, y] in mm.');
      return [this.#len(p[0], at(at(path, i), 0)), this.#len(p[1], at(at(path, i), 1))] as Vec2;
    });
  }

  #pts3(v: unknown, path: string, min = 2): Vec3[] {
    if (!Array.isArray(v) || v.length < min) throw new CallError(path, `a list of at least ${min} points, each [x, y, z] in mm.`);
    if (v.length > 200_000) throw new CallError(path, 'has more points than a path can.');
    return v.map((p, i) => this.#vec3(p, at(path, i)));
  }

  #opts(v: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
    if (v === undefined) return {};
    if (v === null || typeof v !== 'object' || Array.isArray(v) || this.#ref(v, path)) throw new CallError(path, `must be an object of settings: ${keys.join(', ')}.`);
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!keys.includes(k)) throw new CallError(at(path, k), `is not a setting here; the settings are ${keys.join(', ')}.`);
    return o;
  }

  #newSolid(m: Manifold, d: Decls = emptyDecls(), extra: Partial<Pick<SolidRec, 'stones' | 'parts' | 'dims' | 'node'>> = {}): SolidRec {
    return { kind: 'solid', m: this.#A.t(m), d, stones: extra.stones ?? [], parts: extra.parts ?? [], ...(extra.dims !== undefined ? { dims: extra.dims } : {}), ...(extra.node ? { node: extra.node } : {}) };
  }

  /** A tree operation node, built by the tree's own buildOp, with the sheets and blends it declares. */
  #fromNode(node: TreeNode, path: string, addedAs?: string): SolidRec {
    validateOpNode(node, path);
    const sheets: SheetDecl[] = [];
    const blends: BlendRecord[] = [];
    const ctx: OpContext = { m: IDENTITY, sheets, blends, moveReachMm: MAX_REACH_MM, ...(this.#blendMeshes ? { blendMeshes: this.#blendMeshes } : {}) };
    const m = buildOp(this.#k, this.#A, node, this.#tol, ctx);
    const d = emptyDecls();
    d.sheets = sheets;
    d.blends = blends;
    if (addedAs) {
      const bb = m.boundingBox();
      d.added.push({ id: addedAs, min: [...bb.min] as P3, max: [...bb.max] as P3 });
    }
    return this.#newSolid(m, d, { node });
  }

  // --------------------------------------------------------------- dispatch

  #dispatch(name: ProgramCall, a: unknown[]): unknown {
    const { Manifold, CrossSection } = this.#k;
    const A = this.#A;
    const tol = this.#tol;
    switch (name) {
      // ---------------------------------------------------------- solids
      case 'sphere':
        return this.#fromNode({ id: this.#id('sphere'), op: 'sphere', params: { radius: mmText(this.#len(a[0], 'sphere.radius', { positive: true })) } }, 'sphere');
      case 'cylinder': {
        const r = this.#len(a[0], 'cylinder.radius', { positive: true });
        const h = this.#len(a[1], 'cylinder.height', { positive: true });
        const o = this.#opts(a[2], 'cylinder.options', ['top', 'center']);
        const top = o['top'] === undefined ? r : this.#len(o['top'], 'cylinder.options.top', { min: 0 });
        const center = o['center'] === true;
        if (top !== r) {
          return this.#newSolid(Manifold.cylinder(h, r, top, segmentsFor(Math.max(r, top), tol, 16), center));
        }
        const node: TreeNode = { id: this.#id('cylinder'), op: 'cylinder', params: { radius: mmText(r), height: mmText(h) } };
        return this.#fromNode(center ? { id: this.#id('move'), op: 'translate', params: { z: mmText(-h / 2) }, children: [node] } : node, 'cylinder');
      }
      case 'box': {
        const v = this.#vecArgs(a, 0, 'box');
        if (!v.every((x) => x > 0)) throw new CallError('box', 'each side must be more than 0 mm.');
        return this.#fromNode({ id: this.#id('box'), op: 'box', params: { x: mmText(v[0]), y: mmText(v[1]), z: mmText(v[2]) } }, 'box');
      }
      case 'torus': {
        const R = this.#len(a[0], 'torus.major_radius', { positive: true });
        const r = this.#len(a[1], 'torus.minor_radius', { positive: true });
        return this.#fromNode({ id: this.#id('torus'), op: 'torus', params: { major_radius: mmText(R), minor_radius: mmText(r) } }, 'torus');
      }
      case 'sweep': {
        const r = this.#len(a[0], 'sweep.radius', { positive: true });
        const path = this.#pts3(a[1], 'sweep.path');
        const o = this.#opts(a[2], 'sweep.options', ['closed']);
        return this.#fromNode(
          { id: this.#id('wire'), op: 'sweep', params: { radius: mmText(r), path: path.map((p) => p.map(mmText)), ...(o['closed'] === true ? { closed: true } : {}) } },
          'sweep',
        );
      }
      case 'extrude': {
        const p = this.#profile(a[0], 'extrude.profile');
        const h = this.#len(a[1], 'extrude.height', { positive: true });
        const o = this.#opts(a[2], 'extrude.options', ['twist', 'scale_top', 'center']);
        const twist = o['twist'] === undefined ? 0 : this.#deg(o['twist'], 'extrude.options.twist');
        const top = o['scale_top'] === undefined ? undefined : typeof o['scale_top'] === 'number' ? o['scale_top'] : (() => { throw new CallError('extrude.options.scale_top', 'a number, how much the top is scaled (1 keeps it).'); })();
        if (top !== undefined && !(top >= 0 && top <= 100)) throw new CallError('extrude.options.scale_top', 'between 0 and 100.');
        const bb = p.cs.bounds();
        const rMax = Math.max(...[bb.min[0], bb.max[0]].flatMap((x) => [bb.min[1], bb.max[1]].map((y) => Math.hypot(x, y))));
        const div = twist ? Math.max(1, Math.ceil((Math.abs(twist) / 360) * segmentsFor(rMax, tol, 16))) : 0;
        return this.#newSolid(Manifold.extrude(p.cs, h, div, twist, top, o['center'] === true));
      }
      case 'revolve': {
        const p = this.#profile(a[0], 'revolve.profile');
        const o = this.#opts(a[1], 'revolve.options', ['degrees']);
        const deg = o['degrees'] === undefined ? 360 : this.#deg(o['degrees'], 'revolve.options.degrees');
        const bb = p.cs.bounds();
        if (bb.min[0] < -1e-9) throw new CallError('revolve.profile', `reaches x = ${fixed(bb.min[0])} mm; a revolved profile lies at x >= 0 (x is the distance from the z axis, y the height).`);
        return this.#newSolid(Manifold.revolve(p.cs, segmentsFor(Math.max(bb.max[0], tol), tol, 32), deg));
      }
      case 'hull': {
        if (!a.length) throw new CallError('hull', 'give the solids to wrap, e.g. hull(a, b).');
        const ms = a.map((s, i) => this.#plain(this.#solid(s, at('hull', i)), 'hull', 'wrap it in one convex shape').m);
        return this.#newSolid(Manifold.hull(ms));
      }
      case 'hullPoints': {
        const pts = this.#pts3(a[0], 'hullPoints.points', 4);
        return this.#newSolid(Manifold.hull(pts));
      }
      case 'union':
      case 'intersection': {
        if (!a.length) throw new CallError(name, 'give at least one solid.');
        const rs = a.map((s, i) => this.#solid(s, at(name, i)));
        if (rs.length === 1) return rs[0]!;
        const m = name === 'union' ? Manifold.union(rs.map((r) => r.m)) : Manifold.intersection(rs.map((r) => r.m));
        const d = mergeDecls(rs.map((r) => r.d), name);
        const node = name === 'union' && rs.every((r) => r.node) ? { id: this.#id('union'), op: 'union', children: rs.map((r) => r.node!) } : undefined;
        return this.#newSolid(m, d, { stones: rs.flatMap((r) => r.stones), parts: rs.flatMap((r) => r.parts), ...(node ? { node } : {}) });
      }
      case 'difference': {
        if (!a.length) throw new CallError('difference', 'give the solid to cut from, then the solids to cut away.');
        const keep = this.#solid(a[0], 'difference[0]');
        const cut = a.slice(1).map((s, i) => this.#solid(s, at('difference', i + 1)));
        if (!cut.length) return keep;
        const cutter = cut.length === 1 ? cut[0]!.m : A.t(Manifold.union(cut.map((r) => r.m)));
        const d: Decls = { ...keep.d, prongs: [...keep.d.prongs], sheets: [...keep.d.sheets], added: [...keep.d.added], blends: [...keep.d.blends, ...cut.flatMap((r) => r.d.blends)] };
        return this.#newSolid(keep.m.subtract(cutter), d, { stones: keep.stones, parts: keep.parts });
      }
      case 'smoothUnion': {
        const radius = this.#len(a[0], 'smoothUnion.radius', { positive: true });
        let rest = a.slice(1);
        let label: string | undefined;
        const last = rest[rest.length - 1];
        if (last && typeof last === 'object' && !Array.isArray(last) && !this.#ref(last, 'smoothUnion')) {
          const o = this.#opts(last, 'smoothUnion.options', ['name']);
          if (o['name'] !== undefined) label = nameId(o['name'], 'smoothUnion.options.name');
          rest = rest.slice(0, -1);
        }
        if (rest.length < 1) throw new CallError('smoothUnion', 'give the radius, then the solids to blend.');
        const rs = rest.map((s, i) => this.#solid(s, at('smoothUnion', i + 1)));
        rs.forEach((r, i) => {
          if (!r.node) {
            throw new CallError(at('smoothUnion', i + 1), 'a smooth blend takes spheres, cylinders, boxes, tori, swept wires, their moves and unions, and other blends: shapes with a distance from their surface. Blend those, then add or cut the rest.');
          }
        });
        const node: TreeNode = { id: label ?? this.#id('blend'), op: 'smooth_union', params: { radius: mmText(radius) }, children: rs.map((r) => r.node!) };
        return this.#fromNode(node, 'smoothUnion');
      }
      case 'op': {
        const node = validateOpNode(a[0], 'op');
        return this.#fromNode(node, 'op', node.id);
      }
      case 'segments':
        return segmentsFor(this.#len(a[0], 'segments.radius', { positive: true }), tol, 12);

      // ------------------------------------------------------- 2D profiles
      case 'circle': {
        const r = this.#len(a[0], 'circle.radius', { positive: true });
        return { kind: 'profile', cs: A.t(CrossSection.circle(r, segmentsFor(r, tol, 16))) } satisfies ProfileRec;
      }
      case 'rect': {
        const x = this.#len(a[0], 'rect.x', { positive: true });
        const y = this.#len(a[1], 'rect.y', { positive: true });
        const o = this.#opts(a[2], 'rect.options', ['center']);
        return { kind: 'profile', cs: A.t(CrossSection.square([x, y], o['center'] !== false)) } satisfies ProfileRec;
      }
      case 'polygon':
        return { kind: 'profile', cs: A.t(new CrossSection([ccw(this.#pts2(a[0], 'polygon.points'))])) } satisfies ProfileRec;
      case 'p_offset': {
        const p = this.#profile(a[0], 'offset');
        const d = this.#len(a[1], 'offset.distance');
        const o = this.#opts(a[2], 'offset.options', ['join']);
        const join = o['join'] ?? 'round';
        const J = { round: 'Round', square: 'Square', miter: 'Miter' } as const;
        if (!(typeof join === 'string' && join in J)) throw new CallError('offset.options.join', 'is "round", "square" or "miter".');
        return { kind: 'profile', cs: A.t(p.cs.offset(d, J[join as keyof typeof J], 2, segmentsFor(Math.max(Math.abs(d), tol), tol, 16))) } satisfies ProfileRec;
      }
      case 'p_add':
      case 'p_subtract':
      case 'p_intersect': {
        const p = this.#profile(a[0], name.slice(2));
        const q = this.#profile(a[1], `${name.slice(2)}[1]`);
        const cs = name === 'p_add' ? p.cs.add(q.cs) : name === 'p_subtract' ? p.cs.subtract(q.cs) : p.cs.intersect(q.cs);
        return { kind: 'profile', cs: A.t(cs) } satisfies ProfileRec;
      }
      case 'p_translate': {
        const p = this.#profile(a[0], 'translate');
        const v = Array.isArray(a[1]) ? a[1] : [a[1] ?? 0, a[2] ?? 0];
        if (v.length !== 2) throw new CallError('translate', 'a 2D profile moves by [x, y] in mm.');
        return { kind: 'profile', cs: A.t(p.cs.translate([this.#len(v[0], 'translate.x'), this.#len(v[1], 'translate.y')])) } satisfies ProfileRec;
      }
      case 'p_rotate':
        return { kind: 'profile', cs: A.t(this.#profile(a[0], 'rotate').cs.rotate(this.#deg(a[1], 'rotate.degrees'))) } satisfies ProfileRec;
      case 'p_scale': {
        const p = this.#profile(a[0], 'scale');
        const s = Array.isArray(a[1]) ? a[1] : [a[1], a[1]];
        if (s.length !== 2 || !s.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 1000)) throw new CallError('scale', 'a factor, or [x, y] factors, each more than 0.');
        return { kind: 'profile', cs: A.t(p.cs.scale(s as [number, number])) } satisfies ProfileRec;
      }
      case 'p_mirror': {
        const p = this.#profile(a[0], 'mirror');
        const n = a[1];
        if (!Array.isArray(n) || n.length !== 2 || !n.every((x) => typeof x === 'number' && Number.isFinite(x)) || Math.hypot(n[0], n[1]) < 1e-9) throw new CallError('mirror', 'a 2D profile mirrors across the line square to [x, y].');
        return { kind: 'profile', cs: A.t(p.cs.mirror(n as [number, number])) } satisfies ProfileRec;
      }
      case 'p_hull':
        return { kind: 'profile', cs: A.t(this.#profile(a[0], 'hull').cs.hull()) } satisfies ProfileRec;
      case 'p_bounds': {
        const b = this.#profile(a[0], 'bounds').cs.bounds();
        return { min: [b.min[0], b.min[1]], max: [b.max[0], b.max[1]] };
      }
      case 'p_area':
        return this.#profile(a[0], 'area').cs.area();

      // ---------------------------------------------------- moves and reads
      case 'translate': {
        const r = this.#solid(a[0], 'translate');
        const v = this.#vecArgs(a, 1, 'translate');
        return this.#moved(r, translation(v[0], v[1], v[2]), `translate([${v.map(fixed).join(', ')}])`, (m) => m.translate(v), (n) => ({ id: this.#id('move'), op: 'translate', params: { x: mmText(v[0]), y: mmText(v[1]), z: mmText(v[2]) }, children: [n] }));
      }
      case 'rotate': {
        const r = this.#solid(a[0], 'rotate');
        const v = this.#vecArgs(a, 1, 'rotate', 'deg');
        return this.#moved(r, rotation(v[0], v[1], v[2]), `rotate([${v.map(fixed).join(', ')}])`, (m) => m.rotate(v), (n) => ({ id: this.#id('turn'), op: 'rotate', params: { x: degText(v[0]), y: degText(v[1]), z: degText(v[2]) }, children: [n] }));
      }
      case 'mirror': {
        const r = this.#solid(a[0], 'mirror');
        const PLANES: Record<string, Vec3> = { xy: [0, 0, 1], yz: [1, 0, 0], xz: [0, 1, 0] };
        let plane: string | undefined;
        let n: Vec3;
        if (typeof a[1] === 'string') {
          plane = a[1];
          if (!(plane in PLANES)) throw new CallError('mirror', 'reflects through the plane "xy", "yz" or "xz", or the plane square to [x, y, z].');
          n = PLANES[plane]!;
        } else {
          const v = this.#vec3(a[1], 'mirror.normal');
          const l = Math.hypot(...v);
          if (l < 1e-9) throw new CallError('mirror.normal', 'must not be [0, 0, 0].');
          n = [v[0] / l, v[1] / l, v[2] / l];
        }
        return this.#moved(r, reflection(n), plane ? `mirror("${plane}")` : 'mirror', (m) => m.mirror(n), plane ? (c) => ({ id: this.#id('mirror'), op: 'mirror', params: { plane }, children: [c] }) : undefined);
      }
      case 'scale': {
        const r = this.#solid(a[0], 'scale');
        const s = Array.isArray(a[1]) ? a[1] : [a[1], a[1], a[1]];
        if (s.length !== 3 || !s.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 1000)) throw new CallError('scale', 'a factor, or [x, y, z] factors, each more than 0.');
        this.#plain(r, 'scale', 'change the size it was built to and is checked against; build it at the size you want instead', true);
        const d = { ...emptyDecls(), added: r.d.added.map((b) => boxThrough(b, [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0])) };
        return this.#newSolid(r.m.scale(s as Vec3), d);
      }
      case 'named': {
        const r = this.#solid(a[0], 'named');
        const id = nameId(a[1], 'named.name');
        const bb = r.m.boundingBox();
        return { ...r, d: { ...r.d, added: [...r.d.added, { id, min: [...bb.min] as P3, max: [...bb.max] as P3 }] } } satisfies SolidRec;
      }
      case 'bounds': {
        const b = this.#solid(a[0], 'bounds').m.boundingBox();
        return { min: [...b.min], max: [...b.max] };
      }
      case 'volume':
        return this.#solid(a[0], 'volume').m.volume();
      case 'slice':
        return { kind: 'profile', cs: A.t(this.#solid(a[0], 'slice').m.slice(this.#len(a[1], 'slice.height'))) } satisfies ProfileRec;
      case 'project':
        return { kind: 'profile', cs: A.t(this.#solid(a[0], 'project').m.project()) } satisfies ProfileRec;
      case 'trim': {
        const r = this.#solid(a[0], 'trim');
        const n = this.#vec3(a[1], 'trim.normal');
        if (Math.hypot(...n) < 1e-9) throw new CallError('trim.normal', 'must not be [0, 0, 0].');
        const off = this.#len(a[2] ?? 0, 'trim.offset');
        return { ...r, node: undefined, m: A.t(r.m.trimByPlane(n, off)) } satisfies SolidRec;
      }

      // --------------------------------------------------------- the library
      case 'ringShank':
        return this.#ringShank(a[0]);
      case 'roundStone':
      case 'emeraldStone':
        return this.#cutStone(name, a[0]);
      case 'cabochon':
        return this.#cabochon(a[0]);
      case 'stone':
        return this.#ownStone(a[0], a[1]);
      case 'prongHead':
      case 'bezel':
        return this.#head(name, a[0]);
      case 'thicken': {
        const o = this.#opts(a[0], 'thicken', ['id', 'outline', 'thickness', 'surface', 'radius', 'axis', 'round_corners']);
        const id = o['id'] === undefined ? this.#id('sheet') : nameId(o['id'], 'thicken.id');
        const outline = this.#pts2(o['outline'], 'thicken.outline');
        const params: Record<string, unknown> = { outline: outline.map((p) => p.map(mmText)), thickness: this.#lenText(o['thickness'], 'thicken.thickness') };
        for (const k of ['radius', 'round_corners'] as const) if (o[k] !== undefined) params[k] = this.#lenText(o[k], `thicken.${k}`);
        for (const k of ['surface', 'axis'] as const) if (o[k] !== undefined) params[k] = o[k];
        return this.#fromNode({ id, op: 'thicken', params }, 'thicken', id);
      }
      case 'relief': {
        const o = this.#opts(a[0], 'relief', ['id', 'image', 'width', 'height', 'depth', 'mode', 'surface', 'radius', 'base', 'smoothing']);
        const id = o['id'] === undefined ? this.#id('relief') : nameId(o['id'], 'relief.id');
        const params: Record<string, unknown> = {};
        for (const k of ['width', 'height', 'depth', 'radius', 'base', 'smoothing'] as const) if (o[k] !== undefined) params[k] = this.#lenText(o[k], `relief.${k}`);
        for (const k of ['image', 'mode', 'surface'] as const) if (o[k] !== undefined) params[k] = o[k];
        return this.#fromNode({ id, op: 'relief', params }, 'relief', id);
      }
    }
  }

  /** Refuses a solid that carries a part's declarations (or a stone) for an operation that would undo them. */
  #plain(r: SolidRec, what: string, why: string, allowAdded = false): SolidRec {
    const d = r.d;
    const parts = [d.band && 'a ring band (ringShank)', (d.stone || d.prongs.length || d.bezel) && 'a stone setting (prongHead or bezel)', d.sheets.length && `a sheet (thicken "${d.sheets[0]!.label}")`, d.blends.length && `a smooth blend ("${d.blends[0]!.label}")`, !allowAdded && d.added.length && `the named shape "${d.added[0]!.id}"`].filter(Boolean);
    if (parts.length) throw new CallError(what, `this solid holds ${parts.join(' and ')}; ${what} would ${why}. Do the ${what} on plain shapes, then join the parts to them.`);
    return r;
  }

  /** A rigid move (translate, rotate, mirror) of a solid and everything it declares, or a refusal naming the part it would carry out of the checker's frame. */
  #moved(r: SolidRec, M: Affine, how: string, kernelMove: (m: Manifold) => Manifold, wrap: ((n: TreeNode) => TreeNode) | undefined): SolidRec {
    const d = r.d;
    if (d.band && !keepsFingerAxis(M)) {
      throw new CallError(how, "would move the ring band off the finger's axis (the y axis through the origin), where the casting checker measures a band from ringShank. Turn it only about y, or move the other shapes to the ring instead.");
    }
    if ((d.stone || d.prongs.length || d.bezel) && !keepsUpright(M)) {
      throw new CallError(how, 'would tip the stone setting off upright. The casting checker measures prongs, a bezel and a stone\'s seat upright (along z): move the setting anywhere, and turn it only about z.');
    }
    const det = M[0]! * M[5]! - M[1]! * M[4]!;
    const xy = (p: P2): P2 => [M[0]! * p[0] + M[1]! * p[1] + M[3]!, M[4]! * p[0] + M[5]! * p[1] + M[7]!];
    const ring = (pts: P2[]) => {
      const out = pts.map(xy);
      return det < 0 ? out.reverse() : out;
    };
    const tz = M[11]!;
    const nd: Decls = {
      ...(d.band ? { band: { ...d.band } } : {}),
      ...(d.stone ? { stone: { ...d.stone, outline: ring(d.stone.outline), girdleBottomZ: d.stone.girdleBottomZ + tz, girdleTopZ: d.stone.girdleTopZ + tz } } : {}),
      prongs: d.prongs.map((p) => {
        const axis = xy(p.axis);
        return { ...p, axis, clock: clockOf(axis[0], axis[1]), sectionFromZ: p.sectionFromZ + tz, sectionToZ: p.sectionToZ + tz };
      }),
      ...(d.bezel ? { bezel: { ...d.bezel, outer: ring(d.bezel.outer), zBottom: d.bezel.zBottom + tz } } : {}),
      sheets: d.sheets.map((s) => ({ ...s, points: s.points.map((p) => applyPoint(M, p)), normals: s.normals.map((n) => applyDir(M, n)) })),
      blends: d.blends.map((b) => ({ ...b, m: compose(M, b.m) })),
      added: d.added.map((b) => boxThrough(b, M)),
    };
    const A = this.#A;
    return {
      kind: 'solid',
      m: A.t(kernelMove(r.m)),
      d: nd,
      stones: r.stones.map((s) => A.t(kernelMove(s))),
      parts: r.parts,
      ...(r.dims !== undefined ? { dims: r.dims } : {}),
      ...(r.node && wrap ? { node: wrap(r.node) } : {}),
    };
  }

  // --------------------------------------------------------------- the parts

  #ringShank(arg: unknown): SolidRec {
    const o = this.#opts(arg, 'ringShank', ['ring_size', 'band_width', 'band_thickness', 'band_profile']);
    if (o['ring_size'] === undefined) throw new CallError('ringShank.ring_size', 'give the finger size with its system, for example {"system": "US", "size": "7"}.');
    const profile = (o['band_profile'] ?? PARAM_BY_KEY.get('band_profile')!.default) as string;
    checkParam(PARAM_BY_KEY.get('band_profile')!, profile, 'ringShank.band_profile');
    const dflt = bandDefaults(profile);
    const width = this.#lenText(o['band_width'] ?? dflt.width, 'ringShank.band_width');
    const thickness = this.#lenText(o['band_thickness'] ?? dflt.thickness, 'ringShank.band_thickness');
    checkParam(PARAM_BY_KEY.get('ring_size')!, o['ring_size'], 'ringShank.ring_size');
    checkParam(PARAM_BY_KEY.get('band_width')!, width, 'ringShank.band_width');
    checkParam(PARAM_BY_KEY.get('band_thickness')!, thickness, 'ringShank.band_thickness');
    const { size, diameterMm } = ringInnerDiameterMm(o['ring_size'], 'ringShank.ring_size');
    const v: PieceView = {
      ringSize: size,
      innerDiameterMm: diameterMm,
      bandWidthMm: lengthMm(width, 'ringShank.band_width'),
      bandThicknessMm: lengthMm(thickness, 'ringShank.band_thickness'),
      profile,
      metal: 'sterling_silver_925',
      shrinkagePct: 0,
      extras: [],
    };
    const dims = pieceDims(v);
    const b = buildBand(this.#k, this.#A, dims, profile, this.#tol);
    const d = emptyDecls();
    d.band = b.decl;
    const ringSize = { system: size.system, size: String(size.size) };
    return this.#newSolid(b.band, d, { parts: [{ call: 'ringShank', ringSize, band: dims.band }], dims: { ...dims.band, ringSize } });
  }

  #cutStone(name: 'roundStone' | 'emeraldStone', arg: unknown): StoneRec {
    const round = name === 'roundStone';
    const o = this.#opts(arg, name, round ? ['diameter', 'depth', 'carat'] : ['length', 'width', 'depth', 'orientation', 'carat']);
    const need = round ? ['diameter', 'depth'] : ['length', 'width', 'depth'];
    for (const k of need) if (o[k] === undefined) throw new CallError(at(name, k), `give the stone's measured ${k} from its grading report, e.g. "${k === 'depth' ? '4.0' : '6.5'} mm".`);
    const s: Record<string, unknown> = { shape: round ? 'round' : 'emerald' };
    for (const k of need) s[k] = this.#lenText(o[k], at(name, k));
    if (round) checkParam(PARAM_BY_KEY.get('stone_diameter')!, s['diameter'], at(name, 'diameter'));
    else {
      checkParam(PARAM_BY_KEY.get('stone_length')!, s['length'], at(name, 'length'));
      checkParam(PARAM_BY_KEY.get('stone_width')!, s['width'], at(name, 'width'));
      if (lengthMm(s['width'], 'width') > lengthMm(s['length'], 'length')) throw new CallError(at(name, 'width'), 'the width is the SHORT side of an emerald cut; it cannot be more than its length.');
      s['orientation'] = o['orientation'] ?? 'east_west';
      checkParam(PARAM_BY_KEY.get('stone_orientation')!, s['orientation'], at(name, 'orientation'));
    }
    checkParam(PARAM_BY_KEY.get('stone_depth')!, s['depth'], at(name, 'depth'));
    if (o['carat'] !== undefined) s['carat'] = caratText(o['carat'], at(name, 'carat'));
    const view = stoneView(s);
    const shape = stoneShape({ shape: view.shape as 'round' | 'emerald', lengthMm: view.lengthMm, widthMm: view.widthMm, depthMm: view.depthMm, orientation: view.orientation }, this.#tol);
    return { kind: 'stone', view, shape, custom: false, cabochon: false };
  }

  /**
   * A stone of the program's own shape (a cabochon, a pear): never metal. `kind: 'cabochon'`
   * DECLARES it a cabochon, whose bezel lip is held to the cabochon's rule; the engine never
   * guesses that from the shape, so left out it is a faceted stone
   * (dec:a-cabochon-bezel-has-its-own-lip-rule-from-a-cited-reference).
   */
  #ownStone(solidArg: unknown, optsArg: unknown): StoneRec {
    const r = this.#plain(this.#solid(solidArg, 'stone'), 'stone', 'turn metal into a stone');
    const o = this.#opts(optsArg, 'stone.options', ['name', 'kind']);
    const name = o['name'] === undefined ? undefined : nameId(o['name'], 'stone.options.name');
    if (o['kind'] !== undefined && o['kind'] !== 'cabochon' && o['kind'] !== 'faceted') {
      throw new CallError('stone.options.kind', 'is "cabochon" (a domed stone; its bezel lip is held to the cabochon\'s rule) or "faceted" (the default).');
    }
    return this.#stoneOf(r.m, 'stone', name, o['kind'] === 'cabochon');
  }

  /**
   * A cabochon from the person's own measurements: its flat base, round (diameter) or oval
   * (length and width), and its dome's height from the base to the top. Its dome rises
   * from the base's edge to the top as a quarter ellipse, as the worked example's does: a
   * modelling assumption that only cuts the seat and draws the stone, since the lip rule
   * reads the height alone. Declared a cabochon.
   */
  #cabochon(arg: unknown): StoneRec {
    const o = this.#opts(arg, 'cabochon', ['diameter', 'length', 'width', 'height', 'orientation', 'name']);
    const round = o['diameter'] !== undefined;
    if (round && (o['length'] !== undefined || o['width'] !== undefined || o['orientation'] !== undefined)) {
      throw new CallError('cabochon', 'give a round cabochon its diameter, or an oval one its length and width (and orientation), not both.');
    }
    for (const k of round ? [] : ['length', 'width']) {
      if (o[k] === undefined) throw new CallError(at('cabochon', k), 'give the flat base measured across: a diameter for a round cabochon, or a length and width for an oval one, e.g. "8 mm".');
    }
    if (o['height'] === undefined) throw new CallError(at('cabochon', 'height'), 'give the dome\'s height, measured from the flat base to the top of the dome, e.g. "3 mm".');
    const L = this.#len(o[round ? 'diameter' : 'length'], at('cabochon', round ? 'diameter' : 'length'), { positive: true });
    const W = round ? L : this.#len(o['width'], at('cabochon', 'width'), { positive: true });
    if (W > L) throw new CallError(at('cabochon', 'width'), 'the width is the SHORT side of an oval; it cannot be more than its length.');
    const h = this.#len(o['height'], at('cabochon', 'height'), { positive: true });
    const orientation = o['orientation'] ?? 'east_west';
    if (!round) checkParam(PARAM_BY_KEY.get('stone_orientation')!, orientation, at('cabochon', 'orientation'));
    const name = o['name'] === undefined ? undefined : nameId(o['name'], 'cabochon.name');
    const { Manifold, CrossSection } = this.#k;
    const A = this.#A;
    const r = L / 2;
    // Counted as the worked example counts them (segments(r) / 4 up the quarter, and revolve's own).
    const q = Math.ceil(segmentsFor(r, this.#tol, 12) / 4);
    const profile: Vec2[] = [[0, 0]];
    for (let i = 0; i <= q; i++) {
      const a = (i / q) * Math.PI / 2;
      profile.push([r * Math.cos(a), h * Math.sin(a)]);
    }
    let m = A.t(Manifold.revolve(A.t(new CrossSection([ccw(profile)])), segmentsFor(Math.max(r, this.#tol), this.#tol, 32)));
    if (W < L) m = A.t(m.scale([1, W / L, 1]));
    if (orientation === 'north_south' && !round) m = A.t(m.rotate([0, 0, 90]));
    return this.#stoneOf(m, 'cabochon', name, true);
  }

  /**
   * A stone from a solid. Seen from above, its girdle is the convex hull of its outline; the
   * girdle runs where its slices are widest, the crown above and the pavilion below. It is
   * moved so its outline is centred on the z axis and its girdle's bottom is at z = 0,
   * as the library's own stones are, and a setting places it from there.
   */
  #stoneOf(m: Manifold, path: string, name: string | undefined, cabochon: boolean): StoneRec {
    const A = this.#A;
    const bb = m.boundingBox();
    const zMin = bb.min[2], zMax = bb.max[2];
    if (!(zMax - zMin > 0.2)) throw new CallError(path, 'the stone is less than 0.2 mm deep.');
    const proj = A.t(A.t(m.project()).hull());
    const polys = proj.toPolygons() as Vec2[][];
    const outline0 = polys.sort((p, q) => Math.abs(area2(q)) - Math.abs(area2(p)))[0];
    if (!outline0 || outline0.length < 3) throw new CallError(path, 'the stone has no outline seen from above.');
    const ob = proj.bounds();
    const cx = (ob.min[0] + ob.max[0]) / 2, cy = (ob.min[1] + ob.max[1]) / 2;
    const L = ob.max[0] - ob.min[0], W = ob.max[1] - ob.min[1];
    if (Math.min(L, W) < 1 || Math.max(L, W) > 30) throw new CallError(path, `the stone is ${fixed(L)} × ${fixed(W)} mm seen from above; the library sets stones 1 to 30 mm across.`);
    const outline = ccw(outline0.map(([x, y]) => [x - cx, y - cy] as Vec2)) as P2[];
    // Where it is widest: its slices, 96 of them through its depth.
    const N = 96;
    const areas = Array.from({ length: N }, (_, i) => {
      const z = zMin + ((i + 0.5) * (zMax - zMin)) / N;
      return A.t(m.slice(z)).area();
    });
    // The girdle is the run of slices as wide as the widest (to 1 part in 10,000): a
    // faceted girdle's straight band, or one height on a curved stone. Only slices of the
    // same polygon match that closely, so it reads the same at every build's fineness
    // (the casting file's and the check's finer reference agree on it). A girdle one slice
    // high has no height, and a stone widest at its flat base sits on it.
    const amax = Math.max(...areas);
    const wide = areas.map((x, i) => (x >= (1 - 1e-4) * amax ? i : -1)).filter((i) => i >= 0);
    const lo = wide[0]!, hi = wide[wide.length - 1]!;
    const at = (i: number) => (i === 0 ? zMin : i === N - 1 ? zMax : zMin + ((i + 0.5) * (zMax - zMin)) / N);
    const zGb = at(lo);
    const zGt = lo === hi ? zGb : at(hi);
    const pavilion = zGb - zMin, girdle = zGt - zGb, crown = zMax - zGt;
    if (!(crown > 0.05)) throw new CallError(path, 'the stone has no crown above its widest place; a setting holds a stone over its crown.');
    const mesh = A.t(m.hull()).getMesh();
    const verts: Vec3[] = [];
    for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) verts.push([mesh.vertProperties[i]! - cx, mesh.vertProperties[i + 1]! - cy, mesh.vertProperties[i + 2]! - zGb]);
    const mid: Vec3 = [0, 0, (zMax + zMin) / 2 - zGb];
    const grown = new Map<number, P2[]>();
    const grownOutline = (c: number): P2[] => {
      let g = grown.get(c);
      if (!g) {
        const cs = A.t(A.t(new this.#k.CrossSection([outline])).offset(c, 'Round', 2, segmentsFor(Math.max(c, 0.01), this.#tol, 16)));
        g = ccw((cs.toPolygons()[0] ?? outline) as Vec2[]) as P2[];
        grown.set(c, g);
      }
      return g;
    };
    const shape: StoneShapeInfo = {
      outline,
      girdle,
      crown,
      pavilion,
      points(c: number) {
        if (c === 0) return verts;
        // Each hull point pushed out from the stone's middle by c: its seat stands about c off it all round.
        return verts.map((p) => {
          const dx = p[0] - mid[0], dy = p[1] - mid[1], dz = p[2] - mid[2];
          const l = Math.hypot(dx, dy, dz) || 1;
          return [p[0] + (c * dx) / l, p[1] + (c * dy) / l, p[2] + (c * dz) / l] as Vec3;
        });
      },
      outsideGirdle(c: number, x: number, y: number) {
        return outsideConvex(grownOutline(c), x, y);
      },
    };
    const view: StoneView = { shape: 'custom', lengthMm: L, widthMm: W, depthMm: zMax - zMin, orientation: 'east_west', placeholder: [] };
    return { kind: 'stone', view, shape, custom: true, cabochon, ...(name ? { name } : {}) };
  }

  #head(name: 'prongHead' | 'bezel', arg: unknown): SolidRec {
    const kind = name === 'prongHead' ? 'prong_head' : 'bezel';
    const keys = kind === 'prong_head' ? ['stone', 'on', 'prong_count', 'prong_thickness', 'prong_grip', 'culet_clearance', 'prong_overrides'] : ['stone', 'on', 'wall', 'lip', 'culet_clearance'];
    const o = this.#opts(arg, name, keys);
    if (o['stone'] === undefined) throw new CallError(at(name, 'stone'), 'give the stone it holds: roundStone({...}), emeraldStone({...}), cabochon({...}) or stone(yourShape).');
    const st = this.#stone(o['stone'], at(name, 'stone'));
    let band: PieceDims['band'] | null = null;
    let ringSize: PieceView['ringSize'] = { system: 'US', size: '7' };
    if (o['on'] !== undefined) {
      const on = this.#solid(o['on'], at(name, 'on'));
      const shank = on.parts.find((p): p is Extract<PartReport, { call: 'ringShank' }> => p.call === 'ringShank');
      if (!shank || !on.d.band) throw new CallError(at(name, 'on'), 'is the ring shank the setting sits on: a solid from ringShank (or one holding it).');
      band = shank.band;
      ringSize = { system: shank.ringSize.system as PieceView['ringSize']['system'], size: shank.ringSize.size };
    }
    // The head's own settings, as a tree's head part takes them (checkHeadSettings), with the template's defaults.
    const p: Record<string, unknown> = { culet_clearance: this.#lenText(o['culet_clearance'] ?? HEAD_DEFAULTS.culet_clearance, at(name, 'culet_clearance')) };
    if (kind === 'prong_head') {
      p['prong_count'] = o['prong_count'] ?? PARAM_BY_KEY.get('prong_count')!.default;
      p['prong_thickness'] = this.#lenText(o['prong_thickness'] ?? PARAM_BY_KEY.get('prong_thickness')!.default, at(name, 'prong_thickness'));
      p['prong_grip'] = this.#lenText(o['prong_grip'] ?? HEAD_DEFAULTS.prong_grip, at(name, 'prong_grip'));
      const ov = o['prong_overrides'] ?? [];
      p['prong_overrides'] = Array.isArray(ov) ? ov.map((x, i) => (x && typeof x === 'object' && !Array.isArray(x) ? { ...x, ...('thickness' in x ? { thickness: this.#lenText((x as Record<string, unknown>)['thickness'], at(at(at(name, 'prong_overrides'), i), 'thickness')) } : {}) } : x)) : ov;
    } else {
      p['wall'] = this.#lenText(o['wall'] ?? PARAM_BY_KEY.get('bezel_wall')!.default, at(name, 'wall'));
      p['lip'] = o['lip'] === undefined || o['lip'] === 'auto' ? 'auto' : this.#lenText(o['lip'], at(name, 'lip'));
    }
    checkHeadSettings(kind, p, name);
    const v: PieceView = {
      ringSize,
      innerDiameterMm: band ? band.innerDiameterMm : 0,
      bandWidthMm: band ? band.widthMm : 0,
      bandThicknessMm: band ? band.thicknessMm : 0,
      profile: 'flat',
      metal: 'sterling_silver_925',
      shrinkagePct: 0,
      extras: [],
      head: headView(kind, p, st.view),
    };
    const dims = pieceDims(v, st.custom ? st.shape : undefined);
    const h = buildHead(this.#k, this.#A, v, dims, this.#tol, st.shape, band !== null);
    const d = emptyDecls();
    // A declared cabochon says so to the checker, which holds its bezel lip to the cabochon's rule.
    d.stone = st.cabochon ? { ...h.decl.stone, kind: 'cabochon' } : h.decl.stone;
    d.prongs = h.decl.prongs;
    if (h.decl.bezel) d.bezel = h.decl.bezel;
    const report: PartReport = { call: name, onBand: band, head: dims.head!, stone: { shape: st.view.shape, ...(st.name ? { name: st.name } : {}), ...(st.cabochon ? { kind: 'cabochon' as const } : {}) } };
    return this.#newSolid(h.head, d, { stones: [this.#A.t(h.stone)], parts: [report], dims: dims.head });
  }
}

// ------------------------------------------------------------------ helpers

function area2(p: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i]!, r = p[(i + 1) % p.length]!;
    a += q[0] * r[1] - r[0] * q[1];
  }
  return a;
}

function nameId(v: unknown, path: string): string {
  if (typeof v !== 'string' || !NAME_ID.test(v)) throw new CallError(path, 'a name is lower-case letters, digits and "_", starting with a letter, for example "petal_1".');
  return v;
}

function stoneDimsOf(r: StoneRec): Record<string, unknown> {
  return { shape: r.view.shape, ...(r.cabochon ? { kind: 'cabochon' } : {}), lengthMm: r.view.lengthMm, widthMm: r.view.widthMm, depthMm: r.view.depthMm, girdleMm: r.shape.girdle, crownMm: r.shape.crown, pavilionMm: r.shape.pavilion };
}

/** An added shape's bounds carried through a map: the box round its eight corners. */
function boxThrough(b: AddedDecl, M: Affine): AddedDecl {
  const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => applyPoint(M, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]));
  return { id: b.id, min: [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]!))) as P3, max: [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]!))) as P3 };
}

/** The declarations of several solids joined: every one kept, but at most one band and one stone setting, as in a tree. */
function mergeDecls(ds: Decls[], how: string): Decls {
  const out = emptyDecls();
  for (const d of ds) {
    if (d.band) {
      if (out.band) throw new CallError(how, 'two of these solids each hold a ring band from ringShank. A piece has one band the checker measures; build any second band yourself (revolve a profile).');
      out.band = d.band;
    }
    if (d.stone) {
      if (out.stone) throw new CallError(how, 'two of these solids each hold a stone setting (prongHead or bezel). The casting checker measures one stone setting a piece for now; build any other setting yourself from the kernel.');
      out.stone = d.stone;
      if (d.bezel) out.bezel = d.bezel;
    }
    out.prongs.push(...d.prongs);
    out.sheets.push(...d.sheets);
    out.blends.push(...d.blends);
    out.added.push(...d.added);
  }
  return out;
}

function messageOf(e: unknown): string {
  if (e instanceof CallError) return `${e.path}: ${e.problem}`;
  if (e instanceof RangeError && /call stack/i.test(e.message)) return 'the program called too deeply (the stack ran out).';
  if (e instanceof Error) {
    if (/abort|out of memory|memory access out of bounds|OOM/i.test(e.message)) return `the geometry kernel failed (${e.message.slice(0, 200)}); most often it ran out of memory.`;
    return e.message.slice(0, 500);
  }
  return String(e).slice(0, 500);
}
