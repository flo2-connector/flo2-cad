// THE SMOOTH BLEND'S DISTANCE FIELD (smooth_union), and how it is read
// (cap:the-casting-check-finishes-in-time-for-any-piece).
//
// A smooth_union is evaluated as a level set of its distance field (Manifold's
// levelSet). The kernel samples the field at every point of a grid over the
// blend's whole box, so most samples lie far from any surface. Reading the field
// in full at each of them took a min over every capsule of every sweep: on a ring
// with four sweeps of 72 points in all, 4.9 µs a sample and 94 % of the level
// set's time (the kernel's own sampling is 0.27 µs); at one CPU on main 0b432a3,
// 44 s of the export build and 218 s of the old reference build
// (fact:check-time-is-the-blend-field-and-the-wall-ball).
//
// The field is the same; how it is READ changes, and the kernel's output does not:
//
//  · Exact where the kernel reads a value. Manifold 3.5.4's level set (src/sdf.cpp)
//    uses a sample's MAGNITUDE only at a grid point with a sign change on one of its
//    edges (NearSurface, ComputeVerts) and at points along such an edge (FindSurface);
//    everywhere else it reads only the SIGN. Every field here is 1-Lipschitz (exact
//    distances, their min, and the polynomial smooth min, whose gradient is a convex
//    combination of its arguments'), so a point with a sign change within one grid
//    step lies within one grid step of the surface. Where a whole cell of space lies
//    further than two grid steps from the surface, the field is not read there at all:
//    a value of the right sign stands in, and the mesh is bit for bit the one the full
//    field gives (test/check-time.test.ts holds this).
//  · Pruned where it is read. Within a cell, a capsule or a child that cannot be the
//    nearest anywhere in the cell, or that cannot change a smooth min there, is left
//    out. The arithmetic over what remains is the definition's, in the definition's
//    order, so each value is the same double.
//
// The same reader serves the casting check's points on the blend's own surface
// (projectOntoSurface), which are always near the surface and so always exact.

import { CallError } from '../errors.js';
import type { TreeNode } from '../piece/tree.js';
import { angleDeg, lengthMm } from '../units.js';

type Params = Record<string, unknown>;
type Vec3 = [number, number, number];

const L = (p: Params, k: string, dflt = 0): number => (p[k] === undefined ? dflt : lengthMm(p[k], k));
const D = (p: Params, k: string, dflt = 0): number => (p[k] === undefined ? dflt : angleDeg(p[k], k));
const pts3 = (v: unknown): Vec3[] => (v as unknown[][]).map((pt) => [lengthMm(pt[0], 'x'), lengthMm(pt[1], 'y'), lengthMm(pt[2], 'z')] as Vec3);

// ---------------------------------------------------------------- the definition

export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

export function capsule(x: number, y: number, z: number, a: Vec3, b: Vec3, r: number): number {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = x - a[0], pay = y - a[1], paz = z - a[2];
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1)));
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

function rotInverse(xd: number, yd: number, zd: number): (x: number, y: number, z: number) => Vec3 {
  const [cx, sx] = [Math.cos((-xd * Math.PI) / 180), Math.sin((-xd * Math.PI) / 180)];
  const [cy, sy] = [Math.cos((-yd * Math.PI) / 180), Math.sin((-yd * Math.PI) / 180)];
  const [cz, sz] = [Math.cos((-zd * Math.PI) / 180), Math.sin((-zd * Math.PI) / 180)];
  return (x, y, z) => {
    // Undo Z, then Y, then X (the forward rotation is X, then Y, then Z).
    let x1 = cz * x - sz * y, y1 = sz * x + cz * y, z1 = z;
    const x2 = cy * x1 + sy * z1, z2 = -sy * x1 + cy * z1;
    x1 = x2;
    z1 = z2;
    const y3 = cx * y1 - sx * z1, z3 = sx * y1 + cx * z1;
    return [x1, y3, z3];
  };
}

/**
 * One node of a blend's field. `value` is the definition's arithmetic over the
 * node's children; `within` returns the node restricted to a ball (centre, radius
 * rho), with every child left out that cannot change its value anywhere in the
 * ball, and the node's exact value at the centre.
 */
interface FieldNode {
  value(x: number, y: number, z: number): number;
  within(cx: number, cy: number, cz: number, rho: number): { node: FieldNode; v: number };
}

/** Floating-point slack on the Lipschitz bounds, far above the rounding of any value here. */
const SLACK = 1e-9;

class Leaf implements FieldNode {
  constructor(readonly f: (x: number, y: number, z: number) => number) {}
  value(x: number, y: number, z: number): number {
    return this.f(x, y, z);
  }
  within(cx: number, cy: number, cz: number): { node: FieldNode; v: number } {
    return { node: this, v: this.f(cx, cy, cz) };
  }
}

class Capsule implements FieldNode {
  constructor(readonly a: Vec3, readonly b: Vec3, readonly r: number) {}
  value(x: number, y: number, z: number): number {
    return capsule(x, y, z, this.a, this.b, this.r);
  }
  within(cx: number, cy: number, cz: number): { node: FieldNode; v: number } {
    return { node: this, v: capsule(cx, cy, cz, this.a, this.b, this.r) };
  }
}

/**
 * The least of its children, after mapping the point into their frame (a sweep's
 * capsules, a union's children, a transform's children). A child is left out of a
 * ball when even its least value there exceeds the others' greatest least: it is
 * never the minimum there, and Math.min over the rest is the same double.
 */
class MinOf implements FieldNode {
  constructor(
    readonly kids: FieldNode[],
    readonly map: ((x: number, y: number, z: number) => Vec3) | null,
  ) {}
  value(x: number, y: number, z: number): number {
    if (this.map) [x, y, z] = this.map(x, y, z);
    let m = Infinity;
    for (const k of this.kids) m = Math.min(m, k.value(x, y, z));
    return m;
  }
  within(cx: number, cy: number, cz: number, rho: number): { node: FieldNode; v: number } {
    if (this.map) [cx, cy, cz] = this.map(cx, cy, cz);
    const parts = this.kids.map((k) => k.within(cx, cy, cz, rho));
    let v = Infinity;
    for (const p of parts) v = Math.min(v, p.v);
    const keep = parts.filter((p) => p.v - rho <= v + rho + SLACK);
    const same = keep.length === parts.length && keep.every((p, i) => p.node === this.kids[i]);
    return { node: same ? this : new MinOf(keep.map((p) => p.node), this.map), v };
  }
}

/**
 * The smooth min of its children, folded in order as the definition folds it. In a
 * ball, a child that lies at least the blend radius above the running min everywhere
 * leaves it unchanged (smin returns min exactly when |a - b| >= k), and one that lies
 * at least the radius below it everywhere replaces it, so the children before it drop
 * out. The fold over the children that remain is the same arithmetic.
 */
class SmoothMin implements FieldNode {
  constructor(
    readonly kids: FieldNode[],
    readonly k: number,
  ) {}
  value(x: number, y: number, z: number): number {
    let m = Infinity;
    for (const kid of this.kids) {
      const f = kid.value(x, y, z);
      m = m === Infinity ? f : smin(m, f, this.k);
    }
    return m;
  }
  within(cx: number, cy: number, cz: number, rho: number): { node: FieldNode; v: number } {
    const parts = this.kids.map((kid) => kid.within(cx, cy, cz, rho));
    const k = this.k;
    let keep: number[] = [];
    let m = Infinity;
    for (let i = 0; i < parts.length; i++) {
      const vi = parts[i]!.v;
      if (m === Infinity) {
        keep = [i];
        m = vi;
        continue;
      }
      // The running min is 1-Lipschitz, so within the ball it lies in [m - rho, m + rho].
      if (vi - rho >= m + rho + k + SLACK) {
        m = smin(m, vi, k);
        continue;
      }
      if (m - rho >= vi + rho + k + SLACK) keep = [i];
      else keep.push(i);
      m = smin(m, vi, k);
    }
    const same = keep.length === parts.length && keep.every((j, i) => j === i && parts[i]!.node === this.kids[i]);
    return { node: same ? this : new SmoothMin(keep.map((j) => parts[j]!.node), k), v: m };
  }
}

function compile(n: TreeNode): FieldNode {
  const p = (n.params ?? {}) as Params;
  const kids = () => (n.children ?? []).map(compile);
  switch (n.op) {
    case 'sphere': {
      const r = L(p, 'radius');
      return new Leaf((x, y, z) => Math.hypot(x, y, z) - r);
    }
    case 'box': {
      const bx = L(p, 'x') / 2, by = L(p, 'y') / 2, bz = L(p, 'z') / 2;
      return new Leaf((x, y, z) => {
        const qx = Math.abs(x) - bx, qy = Math.abs(y) - by, qz = Math.abs(z) - bz;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
      });
    }
    case 'cylinder': {
      const r = L(p, 'radius'), h = L(p, 'height');
      return new Leaf((x, y, z) => {
        const dx = Math.hypot(x, y) - r, dz = Math.abs(z - h / 2) - h / 2;
        return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
      });
    }
    case 'torus': {
      const R = L(p, 'major_radius'), r = L(p, 'minor_radius');
      return new Leaf((x, y, z) => Math.hypot(Math.hypot(x, y) - R, z) - r);
    }
    case 'sweep': {
      const r = L(p, 'radius');
      const path = pts3(p['path']);
      const m = p['closed'] === true ? path.length : path.length - 1;
      const caps: FieldNode[] = [];
      for (let i = 0; i < m; i++) caps.push(new Capsule(path[i]!, path[(i + 1) % path.length]!, r));
      return new MinOf(caps, null);
    }
    case 'translate': {
      const tx = L(p, 'x'), ty = L(p, 'y'), tz = L(p, 'z');
      return new MinOf(kids(), (x, y, z) => [x - tx, y - ty, z - tz]);
    }
    case 'rotate':
      return new MinOf(kids(), rotInverse(D(p, 'x'), D(p, 'y'), D(p, 'z')));
    case 'mirror': {
      const pl = p['plane'];
      return new MinOf(kids(), (x, y, z) => [pl === 'yz' ? -x : x, pl === 'xz' ? -y : y, pl === 'xy' ? -z : z]);
    }
    case 'union':
      return new MinOf(kids(), null);
    case 'smooth_union':
      return new SmoothMin(kids(), L(p, 'radius'));
  }
  throw new CallError(`${n.id}.op`, `"${String(n.op)}" cannot be blended.`);
}

/** The blend's field as the tree defines it, read in full at every point: the definition the reader below must match. */
export function fieldOf(n: TreeNode): (x: number, y: number, z: number) => number {
  const root = compile(n);
  return (x, y, z) => root.value(x, y, z);
}

/**
 * Manifold 3.5.4's grid for levelSet(bounds, edgeLength): gridSize = trunc(size / edge + 1)
 * points along each axis, spaced size / (gridSize - 1). The largest step bounds the length
 * of every grid edge it reads (axis neighbours; the body diagonals are 0.87 of it).
 */
export function levelSetStep(min: Vec3, max: Vec3, edge: number): number {
  let step = 0;
  for (let i = 0; i < 3; i++) {
    const size = max[i]! - min[i]!;
    const n = Math.trunc(size / edge + 1);
    step = Math.max(step, n > 1 ? size / (n - 1) : size);
  }
  return step;
}

const FINE_PER_COARSE = 8;

interface Cell {
  node: FieldNode;
  /** A value of the right sign, where the whole cell lies further than `far` from the surface; NaN where it does not. */
  stand: number;
}

/**
 * A blend's field for its level set over `box`, whose largest grid step is `step`.
 * `sample` is what the kernel reads; `value` is exact everywhere.
 */
export class BlendField {
  readonly #root: FieldNode;
  readonly #o: Vec3;
  readonly #fine: number;
  readonly #coarse: number;
  readonly #n: [number, number, number];
  readonly #far: number;
  readonly #cells: (Cell & { fine?: (Cell | undefined)[] } | undefined)[];

  constructor(n: TreeNode, box: { min: Vec3; max: Vec3 }, step: number) {
    this.#root = compile(n);
    // Two grid steps of clearance: the kernel reads a magnitude only within one.
    this.#far = 2 * step;
    this.#fine = 2 * step;
    this.#coarse = this.#fine * FINE_PER_COARSE;
    // Cells cover the box and one step round it (the body-centred points sit half a step outside).
    this.#o = [box.min[0] - step, box.min[1] - step, box.min[2] - step];
    this.#n = [0, 1, 2].map((i) => Math.max(1, Math.ceil((box.max[i]! + step - this.#o[i]!) / this.#coarse))) as [number, number, number];
    this.#cells = new Array(this.#n[0] * this.#n[1] * this.#n[2]);
  }

  #cell(node: FieldNode, cx: number, cy: number, cz: number, size: number): Cell {
    const rho = (size * Math.sqrt(3)) / 2;
    const { node: pruned, v } = node.within(cx, cy, cz, rho);
    // Lipschitz: within the cell the field lies in [v - rho, v + rho].
    const stand = v - rho > this.#far ? v - rho : v + rho < -this.#far ? v + rho : NaN;
    return { node: pruned, stand };
  }

  #find(x: number, y: number, z: number): Cell | null {
    const o = this.#o, C = this.#coarse;
    const i = Math.floor((x - o[0]) / C), j = Math.floor((y - o[1]) / C), k = Math.floor((z - o[2]) / C);
    if (i < 0 || j < 0 || k < 0 || i >= this.#n[0] || j >= this.#n[1] || k >= this.#n[2]) return null;
    const ci = (i * this.#n[1] + j) * this.#n[2] + k;
    let coarse = this.#cells[ci];
    if (!coarse) {
      coarse = this.#cell(this.#root, o[0] + (i + 0.5) * C, o[1] + (j + 0.5) * C, o[2] + (k + 0.5) * C, C);
      this.#cells[ci] = coarse;
    }
    if (!Number.isNaN(coarse.stand)) return coarse;
    const F = this.#fine;
    const bx = o[0] + i * C, by = o[1] + j * C, bz = o[2] + k * C;
    // Clamped: a point on a coarse cell's face can round to just outside it.
    const fi = Math.max(0, Math.min(FINE_PER_COARSE - 1, Math.floor((x - bx) / F)));
    const fj = Math.max(0, Math.min(FINE_PER_COARSE - 1, Math.floor((y - by) / F)));
    const fk = Math.max(0, Math.min(FINE_PER_COARSE - 1, Math.floor((z - bz) / F)));
    const fine = (coarse.fine ??= new Array(FINE_PER_COARSE ** 3));
    const fx = (fi * FINE_PER_COARSE + fj) * FINE_PER_COARSE + fk;
    let cell = fine[fx];
    if (!cell) {
      cell = this.#cell(coarse.node, bx + (fi + 0.5) * F, by + (fj + 0.5) * F, bz + (fk + 0.5) * F, F);
      fine[fx] = cell;
    }
    return cell;
  }

  /** What the level set reads: the exact value, or one of the right sign where only the sign is read. */
  sample(x: number, y: number, z: number): number {
    const c = this.#find(x, y, z);
    if (!c) return this.#root.value(x, y, z);
    return Number.isNaN(c.stand) ? c.node.value(x, y, z) : c.stand;
  }

  /** The exact value, everywhere. */
  value(x: number, y: number, z: number): number {
    const c = this.#find(x, y, z);
    return c ? c.node.value(x, y, z) : this.#root.value(x, y, z);
  }
}

// ------------------------------------------------------ points on the blend's surface

/** How far along the normal a facet's point is looked for on the surface; past it the point is declared there, so the check fails it. */
export const SURFACE_REACH_MM = 0.2;

/**
 * The point of the blend's surface (value 0) on the line through p along unit d,
 * near p: a bracket from the first sign change found stepping out both ways, then
 * the Illinois method until the value is within 1e-9 mm of zero. Where the line
 * meets no surface within SURFACE_REACH_MM, the point that far along d towards the
 * surface is written instead, so a facet that far off its surface is measured as at
 * least that far off and fails. Writes x, y, z at out[at..at + 2].
 */
export function projectOntoSurface(f: (x: number, y: number, z: number) => number, p: Vec3, d: Vec3, out: Float64Array, at: number): void {
  const g = (s: number) => f(p[0] + s * d[0], p[1] + s * d[1], p[2] + s * d[2]);
  const put = (s: number) => {
    out[at] = p[0] + s * d[0];
    out[at + 1] = p[1] + s * d[1];
    out[at + 2] = p[2] + s * d[2];
  };
  const g0 = g(0);
  if (Math.abs(g0) <= 1e-9) return put(0);
  // The field is close to a distance, so a step a little longer than the value itself,
  // towards the surface, usually crosses it; otherwise double, both ways, up to the reach.
  const toward = -Math.sign(g0);
  let a = 0, ga = g0, b = NaN, gb = NaN;
  for (let step = 1.25 * Math.abs(g0); Number.isNaN(b); step *= 2) {
    const s0 = Math.min(step, SURFACE_REACH_MM);
    for (const s of [toward * s0, -toward * s0]) {
      const gs = g(s);
      if (gs > 0 !== g0 > 0 || gs === 0) {
        b = s;
        gb = gs;
        break;
      }
    }
    if (s0 >= SURFACE_REACH_MM) break;
  }
  if (Number.isNaN(b)) return put(toward * SURFACE_REACH_MM);
  if (gb === 0) return put(b);
  // Illinois: regula falsi that halves the weight of an end kept twice running.
  let kept = 0;
  for (let it = 0; it < 100; it++) {
    const s = (a * gb - b * ga) / (gb - ga);
    const gs = g(s);
    if (Math.abs(gs) <= 1e-9 || Math.abs(b - a) <= 1e-12) return put(s);
    if (gs > 0 === gb > 0) {
      b = s;
      gb = gs;
      if (kept === 1) ga /= 2;
      kept = 1;
    } else {
      a = s;
      ga = gs;
      if (kept === -1) gb /= 2;
      kept = -1;
    }
  }
  put(Math.abs(ga) < Math.abs(gb) ? a : b);
}

// ------------------------------------------------- the blend's facets held to its surface
//
// A level set puts every corner ON the surface (measured: within 0.0002 mm on every blend in
// the tests), and bounds nothing else about its facets. The grid is sized for a smooth
// surface: a facet's sag is about its length squared over 8 R, R the blend radius (ops.ts,
// smoothUnion). Three things break that.
//
//  · A CREASE in the field. A sweep's straight runs are joined by a plain min, so where a
//    wire bends there is a crease on the inside of the bend; a box's and a cylinder's edges
//    and corners are creases too. A facet cuts across a crease and stands off it by a
//    length, not a length squared: about half a grid step times the sine of half the angle.
//    On moonstone-openwork-ring, where each rail bends 25.6 degrees at its peak, the casting
//    file stood 0.0129 mm off the rail's underside, seen through the bezel's open back, and
//    the check refused it at 0.012 mm (main 0b432a3's finer reference read 0.0102); a box in
//    a blend read 0.036 mm
//    (fact:a-blends-level-set-chamfers-the-creases-of-its-own-field-2026-10-05).
//  · A facet longer than the grid step (the grid's diagonals are 1.4 and 1.7 times it) on a
//    fillet tighter than the blend radius sags past the tolerance: 0.0159 mm between the
//    moonstone's rails, where the band hides it.
//  · A narrow neck, where a blend bridges two shapes that nearly touch: the field is far
//    from a distance there (its gradient 0.16 long between the moonstone's rails), so |f|
//    understates how far a facet stands off six times over.
//
// So the level set is measured against the field and refined where it stands off, and only
// there. How far a point stands off is taken to first order, |f| over the length of f's
// gradient, and measured along the gradient where only that figure would call it off. An edge whose points at a quarter, a half and three quarters of its length stand
// off by more than the tolerance is split; so is a facet's longest edge where its centroid
// does. (Where a crease crosses a facet, the facet stands off it most on an edge, so the
// edge's points find it; on a smooth surface the centroid and the middles find at least
// 93.9 % of a facet's sag.) The new corner is put ON the surface: on the crease itself where
// the edge crosses one (where the tangent planes at its ends, or at its ends and a facet's
// far corner, meet), else moved from the chord's middle square to the facets it splits, else
// along the field's gradient. The two facets beside the edge are each cut in two, so the
// cuts on both sides meet: no T-junction, and the solid stays closed. A facet is cut along
// one edge a pass, the worst first, so every cut made is the one that was checked; a few
// passes, along the crease alone, bring it within the tolerance (each one halves what a
// crease stands off, and quarters a sag).
//
// A new corner is not made, and that edge is not tried again, where the surface is not found
// near (within the edge's length, and eight times how far the edge stood off), where it falls
// within a tenth of the edge of either end, where a cut facet would turn over (facing away
// from both the facet it was cut from and the surface), where a cut facet would pass through
// a facet near it that shares no corner with it (a self-intersection as the casting check
// counts one, tested at the float32 the file holds: unguarded, a box's corner and the
// moonstone's necks made 32 and 1,308 such pairs, and the kernel's booleans need a solid that
// does not cross itself), or past HOLD_GENERATIONS. The facets there stand off as the level
// set made them, and the casting check, which reads the written file, says so.

/** A field: negative inside, close to a distance near the surface. */
type Field = (x: number, y: number, z: number) => number;

/** The level set held to its surface: the refined mesh, or null where nothing stood off. */
export interface HeldMesh {
  positions: Float32Array;
  triVerts: Uint32Array;
  /** Edges split, passes made, and edges given up on: in all, where the surface was not found near, where a cut facet would have turned over, where one would have passed through a facet near it, and where the corner would have been too deep. */
  split: number;
  passes: number;
  kept: number;
  notFound: number;
  leaned: number;
  crossed: number;
  deep: number;
}

/** At most this many passes; each splits at most one edge of each facet. */
const HOLD_PASSES = 40;
/**
 * A new corner is one generation deeper than the deeper end of the edge it splits, and none
 * deeper than this is made. A crease converges in a few (each halves what it stands off: six
 * take 0.04 mm to 0.0006 mm; a box's edges and corners took at most six). A place that has not
 * by then is a point where the surface itself is not smooth and not a crease either: where a
 * smooth blend's bridge between two shapes begins, the field has a saddle on its own surface,
 * a cone point. There, splits only churn: on the moonstone's rails, inside the band, a cap of
 * 12 made 2,744 splits where 6 made 604, with the same readings everywhere else.
 */
const HOLD_GENERATIONS = 6;
/** A cut facet is turned over when it faces away from the facet it was cut from and lies more than this (cos 104.5°) from the surface's own normal. */
const HOLD_TURNED_COS = -0.25;
/** The step of the central differences that give the field's gradient, in mm. */
const GRAD_STEP = 1e-6;
/** A point standing off by less than this share of the tolerance is taken at |f|: it would need a gradient under 1/16 long to matter. */
const GRAD_FLOOR = 1 / 16;
/** An edge whose ends' surface normals differ by more than this (cos 10°) may cross a crease, so a corner on it is tried first. */
const CREASE_COS = Math.cos((10 * Math.PI) / 180);
/** Vertex indices are paired into one number as lo * 2^26 + hi: exact below 2^52. */
const PAIR = 2 ** 26;

type V3 = [number, number, number];

/** The field's unit gradient at a point, by central differences; zeros where it has none. */
function gradient(f: Field, x: number, y: number, z: number): V3 {
  const h = GRAD_STEP;
  const g: V3 = [f(x + h, y, z) - f(x - h, y, z), f(x, y + h, z) - f(x, y - h, z), f(x, y, z + h) - f(x, y, z - h)];
  const l = Math.hypot(g[0], g[1], g[2]);
  return l > 0 ? [g[0] / l, g[1] / l, g[2] / l] : [0, 0, 0];
}

/**
 * The point nearest `p` where the planes through points `at` with unit normals `n` meet (two
 * planes: a line; three: a point), or null where they are too near parallel to meet well:
 * p minus the combination of the normals that puts it on every plane.
 */
function meetOfPlanes(n: V3[], at: V3[], p: V3): V3 | null {
  // Solve G l = r, G the normals' Gram matrix and r_i = n_i . (p - at_i); then x = p - sum l_i n_i.
  const G = n.map((u) => n.map((v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  const r = n.map((u, i) => u[0] * (p[0] - at[i]![0]) + u[1] * (p[1] - at[i]![1]) + u[2] * (p[2] - at[i]![2]));
  const l = solveSmall(G, r);
  if (!l) return null;
  const x: V3 = [p[0], p[1], p[2]];
  for (let i = 0; i < n.length; i++) for (let c = 0; c < 3; c++) x[c] = x[c]! - l[i]! * n[i]![c]!;
  return x;
}

/** Gaussian elimination with partial pivoting on a 2x2 or 3x3 system; null when it is near singular. */
function solveSmall(A: number[][], b: number[]): number[] | null {
  const k = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let i = c + 1; i < k; i++) if (Math.abs(M[i]![c]!) > Math.abs(M[piv]![c]!)) piv = i;
    if (Math.abs(M[piv]![c]!) < 0.03) return null;
    [M[c], M[piv]] = [M[piv]!, M[c]!];
    for (let i = 0; i < k; i++) {
      if (i === c) continue;
      const q = M[i]![c]! / M[c]![c]!;
      for (let j = c; j <= k; j++) M[i]![j] = M[i]![j]! - q * M[c]![j]!;
    }
  }
  return M.map((row, i) => row[k]! / row[i]!);
}

/** Whether segment pq passes through the inside of triangle abc (strictly, ends and edges excluded). */
function segmentThrough(p: V3, q: V3, a: V3, b: V3, c: V3): boolean {
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-18) return false;
  const inv = 1 / det;
  const sx = p[0] - a[0], sy = p[1] - a[1], sz = p[2] - a[2];
  const u = (sx * hx + sy * hy + sz * hz) * inv;
  if (u <= 1e-9 || u >= 1 - 1e-9) return false;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v <= 1e-9 || u + v >= 1 - 1e-9) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-7 && t < 1 - 1e-7;
}

/** The side of a cell of the spatial hash the refinement keeps its facets in, in mm (a level set's facets are at most about 0.2 mm). */
const HASH_CELL = 0.1;

/**
 * The level set `V` (numProp values a vertex, x y z first) and `triVerts`, with every facet
 * held within `tol` of the zero level of `f`, as the section above says; null where no facet
 * stood off.
 */
export function holdToSurface(V: ArrayLike<number>, numProp: number, triVerts: ArrayLike<number>, f: Field, tol: number): HeldMesh | null {
  const nv0 = V.length / numProp;
  if (nv0 >= PAIR / 4) throw new Error(`a blend's level set has ${nv0} vertices, more than its refinement indexes`);
  const P: number[] = new Array(nv0 * 3);
  for (let i = 0; i < nv0; i++) {
    P[i * 3] = V[i * numProp]!;
    P[i * 3 + 1] = V[i * numProp + 1]!;
    P[i * 3 + 2] = V[i * numProp + 2]!;
  }
  const gen: number[] = new Array(nv0).fill(0);
  // Facets only ever added: a split one is marked dead. `born` is the pass that made it.
  const T: number[] = Array.from(triVerts);
  const alive: number[] = new Array(T.length / 3).fill(1);
  const born: number[] = new Array(T.length / 3).fill(0);
  const pair = (a: number, b: number) => (a < b ? a * PAIR + b : b * PAIR + a);
  const at = (i: number): V3 => [P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!];
  const dist2 = (a: number, b: number) => (P[b * 3]! - P[a * 3]!) ** 2 + (P[b * 3 + 1]! - P[a * 3 + 1]!) ** 2 + (P[b * 3 + 2]! - P[a * 3 + 2]!) ** 2;
  /** The unit normal of facet (a, b, c), or zeros for a facet with no area. */
  const normal = (a: number, b: number, c: number): V3 => {
    const ux = P[b * 3]! - P[a * 3]!, uy = P[b * 3 + 1]! - P[a * 3 + 1]!, uz = P[b * 3 + 2]! - P[a * 3 + 2]!;
    const vx = P[c * 3]! - P[a * 3]!, vy = P[c * 3 + 1]! - P[a * 3 + 1]!, vz = P[c * 3 + 2]! - P[a * 3 + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    return l > 0 ? [nx / l, ny / l, nz / l] : [0, 0, 0];
  };
  const probe = new Float64Array(3);
  /** The length of f's gradient at each corner, found when first wanted (NaN until then). */
  const slope: number[] = new Array(nv0).fill(NaN);
  const slopeAt = (i: number) => {
    let g = slope[i]!;
    if (Number.isNaN(g)) {
      const x = P[i * 3]!, y = P[i * 3 + 1]!, z = P[i * 3 + 2]!, h = GRAD_STEP;
      g = Math.hypot(f(x + h, y, z) - f(x - h, y, z), f(x, y + h, z) - f(x, y - h, z), f(x, y, z + h) - f(x, y, z - h)) / (2 * h);
      slope[i] = g;
    }
    return g;
  };
  /**
   * How far a point of a facet stands off the surface, `v` being f there. The field is
   * 1-Lipschitz, so never less than |f|; to first order, |f| over the length of f's gradient,
   * taken as the least at the facet's corners a, b and c (c < 0 for an edge's two ends; on
   * the surface, by central differences, found once a corner). Where that first-order figure is all that would call the point off,
   * it is measured: the distance along the gradient at the point to the surface. Near a
   * saddle of the field (a neck) the gradient comes to nothing and the first-order figure
   * grows without bound; the measured one does not.
   */
  const standOffNear = (x: number, y: number, z: number, v: number, ca: number, cb: number, cc: number) => {
    const a = Math.abs(v);
    if (a > tol || a < tol * GRAD_FLOOR) return a;
    const g = Math.min(1, slopeAt(ca), slopeAt(cb), cc >= 0 ? slopeAt(cc) : 1);
    const first = a / Math.max(g, a / SURFACE_REACH_MM);
    if (first <= tol) return first;
    // Measured, along the gradient at the point itself.
    const h = GRAD_STEP;
    const gx = f(x + h, y, z) - f(x - h, y, z), gy = f(x, y + h, z) - f(x, y - h, z), gz = f(x, y, z + h) - f(x, y, z - h);
    const gl = Math.hypot(gx, gy, gz);
    if (!(gl > 0)) return first;
    projectOntoSurface(f, [x, y, z], [gx / gl, gy / gl, gz / gl], probe, 0);
    const along = Math.hypot(probe[0]! - x, probe[1]! - y, probe[2]! - z);
    return Math.max(a, Math.min(first, along));
  };
  /** How far the edge a-b stands off: of its points at a quarter, a half and three quarters along, the one furthest by |f|, to first order. */
  const edgeOff = (a: number, b: number) => {
    const ax = P[a * 3]!, ay = P[a * 3 + 1]!, az = P[a * 3 + 2]!;
    const dx = P[b * 3]! - ax, dy = P[b * 3 + 1]! - ay, dz = P[b * 3 + 2]! - az;
    let w = -1, at = 0.5, bv = 0;
    for (let i = 1; i <= 3; i++) {
      const s = i / 4, v = f(ax + dx * s, ay + dy * s, az + dz * s);
      if (Math.abs(v) > w) ((w = Math.abs(v)), (at = s), (bv = v));
    }
    return standOffNear(ax + dx * at, ay + dy * at, az + dz * at, bv, a, b, -1);
  };
  /** Whether facet (a, b, c), cut from a facet whose normal is `from`, is turned over: facing away from that facet and from the surface where it lies. */
  const turned = (a: number, b: number, c: number, from: V3) => {
    const n = normal(a, b, c);
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) return true;
    if (n[0] * from[0] + n[1] * from[1] + n[2] * from[2] > 0) return false;
    const g = gradient(f, (P[a * 3]! + P[b * 3]! + P[c * 3]!) / 3, (P[a * 3 + 1]! + P[b * 3 + 1]! + P[c * 3 + 1]!) / 3, (P[a * 3 + 2]! + P[b * 3 + 2]! + P[c * 3 + 2]!) / 3);
    return n[0] * g[0] + n[1] * g[1] + n[2] * g[2] <= HOLD_TURNED_COS;
  };
  // The facets near the edges being split, by the cells of a spatial hash their boxes touch,
  // so a new facet can be tested against the facets near it for crossing (dead ones are
  // skipped where met). Only the cells round those edges are kept (the REGION): a hash of
  // every facet of the moonstone's blend held 37 MiB more than flo2's slot could spare.
  const cells = new Map<number, number[]>();
  const region = new Set<number>();
  const cellOf = (x: number) => Math.floor(x / HASH_CELL) + 1024;
  const keyOf = (i: number, j: number, k: number) => (i * 2048 + j) * 2048 + k;
  const eachCell = (t: number, fn: (key: number) => void) => {
    const a = T[t * 3]! * 3, b = T[t * 3 + 1]! * 3, c = T[t * 3 + 2]! * 3;
    const i0 = cellOf(Math.min(P[a]!, P[b]!, P[c]!)), i1 = cellOf(Math.max(P[a]!, P[b]!, P[c]!));
    const j0 = cellOf(Math.min(P[a + 1]!, P[b + 1]!, P[c + 1]!)), j1 = cellOf(Math.max(P[a + 1]!, P[b + 1]!, P[c + 1]!));
    const k0 = cellOf(Math.min(P[a + 2]!, P[b + 2]!, P[c + 2]!)), k1 = cellOf(Math.max(P[a + 2]!, P[b + 2]!, P[c + 2]!));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) fn(keyOf(i, j, k));
  };
  const put = (key: number, t: number) => {
    const list = cells.get(key);
    if (list) list.push(t);
    else cells.set(key, [t]);
  };
  /** A new facet, in the cells of the region its box touches (the rest are filled when the region grows to them). */
  const index = (t: number) => eachCell(t, (key) => region.has(key) && put(key, t));
  /** Grows the region by these cells, filling each with every living facet that touches it. */
  const ensure = (keys: Iterable<number>) => {
    const fresh = new Set<number>();
    for (const key of keys) if (!region.has(key)) fresh.add(key);
    if (!fresh.size) return;
    for (const key of fresh) region.add(key);
    const nt = T.length / 3;
    for (let t = 0; t < nt; t++) if (alive[t]) eachCell(t, (key) => fresh.has(key) && put(key, t));
  };
  /** Whether facet (a, b, c) and any living facet near it that shares no corner with it pass through each other (as the casting check counts a self-intersection). */
  const crosses = (a: number, b: number, c: number) => {
    const A = at(a), B = at(b), C = at(c);
    const seen = new Set<number>();
    let hit = false;
    const lo = [0, 1, 2].map((k) => cellOf(Math.min(A[k]!, B[k]!, C[k]!)));
    const hi = [0, 1, 2].map((k) => cellOf(Math.max(A[k]!, B[k]!, C[k]!)));
    // Every cell it touches must be in the region (it is, but for a corner that moved far).
    const want: number[] = [];
    for (let i = lo[0]!; i <= hi[0]!; i++) for (let j = lo[1]!; j <= hi[1]!; j++) for (let k = lo[2]!; k <= hi[2]!; k++) if (!region.has(keyOf(i, j, k))) want.push(keyOf(i, j, k));
    if (want.length) ensure(want);
    for (let i = lo[0]!; i <= hi[0]! && !hit; i++)
      for (let j = lo[1]!; j <= hi[1]! && !hit; j++)
        for (let k = lo[2]!; k <= hi[2]! && !hit; k++) {
          for (const u of cells.get((i * 2048 + j) * 2048 + k) ?? []) {
            if (!alive[u] || seen.has(u)) continue;
            seen.add(u);
            const x = T[u * 3]!, y = T[u * 3 + 1]!, z = T[u * 3 + 2]!;
            if (x === a || x === b || x === c || y === a || y === b || y === c || z === a || z === b || z === c) continue;
            const X = at(x), Y = at(y), Z = at(z);
            if (segmentThrough(A, B, X, Y, Z) || segmentThrough(B, C, X, Y, Z) || segmentThrough(C, A, X, Y, Z) || segmentThrough(X, Y, A, B, C) || segmentThrough(Y, Z, A, B, C) || segmentThrough(Z, X, A, B, C)) {
              hit = true;
              break;
            }
          }
        }
    return hit;
  };
  // Edges given up on; edges marked and not split last pass (a facet beside them was cut
  // first), to be measured again; and the pass each corner was made in (-1: the level set's).
  // An edge between two corners older than the last pass was measured when it was made, and
  // stood within the tolerance unless it is one of these: its ends never move.
  const stuck = new Set<number>();
  let deferred = new Set<number>();
  const vborn: number[] = new Array(nv0).fill(-1);
  const out = new Float64Array(3);
  let split = 0, notFound = 0, leaned = 0, crossed = 0, deep = 0, passes = 0;
  for (; passes < HOLD_PASSES; passes++) {
    const nt = T.length / 3;
    // 1. Which edges to split: each measured once, on the facets the last pass made. (On the
    // level set, every edge is in two facets the opposite way round: it is measured from the
    // one where it runs from the lower index.)
    const marked = new Map<number, number>();
    const measured = new Set<number>();
    for (let t = 0; t < nt; t++) {
      if (!alive[t] || born[t] !== passes) continue;
      for (let e = 0; e < 3; e++) {
        const a = T[t * 3 + e]!, b = T[t * 3 + ((e + 1) % 3)]!;
        const k = pair(a, b);
        if (stuck.has(k)) continue;
        if (passes === 0) {
          if (a > b) continue;
        } else {
          if (vborn[a] !== passes - 1 && vborn[b] !== passes - 1 && !deferred.has(k)) continue;
          if (measured.has(k)) continue;
          measured.add(k);
        }
        if (Math.max(gen[a]!, gen[b]!) >= HOLD_GENERATIONS) {
          stuck.add(k);
          deep++;
          continue;
        }
        const w = edgeOff(a, b);
        if (w > tol) marked.set(k, w);
      }
    }
    // A facet none of whose edges is marked, but whose centroid stands off: its longest edge.
    for (let t = 0; t < nt; t++) {
      if (!alive[t] || born[t] !== passes) continue;
      const a = T[t * 3]!, b = T[t * 3 + 1]!, c = T[t * 3 + 2]!;
      if (marked.has(pair(a, b)) || marked.has(pair(b, c)) || marked.has(pair(c, a))) continue;
      const cx = (P[a * 3]! + P[b * 3]! + P[c * 3]!) / 3, cy = (P[a * 3 + 1]! + P[b * 3 + 1]! + P[c * 3 + 1]!) / 3, cz = (P[a * 3 + 2]! + P[b * 3 + 2]! + P[c * 3 + 2]!) / 3;
      const w = standOffNear(cx, cy, cz, f(cx, cy, cz), a, b, c);
      if (w <= tol) continue;
      // Its longest edge not given up on.
      let k = -1, longest = -1;
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        const kk = pair(p, q), l = dist2(p, q);
        if (!stuck.has(kk) && Math.max(gen[p]!, gen[q]!) < HOLD_GENERATIONS && l > longest) ((k = kk), (longest = l));
      }
      if (k >= 0) marked.set(k, w);
    }
    if (!marked.size) break;
    // The region round every marked edge: the cells within its length and two cells more of
    // its middle, which hold its facets, its new corner and the facets they could meet.
    const near = new Set<number>();
    for (const k of marked.keys()) {
      const a = Math.floor(k / PAIR), b = k - a * PAIR;
      const r = 2 + Math.ceil(Math.sqrt(dist2(a, b)) / HASH_CELL);
      const ci = cellOf((P[a * 3]! + P[b * 3]!) / 2), cj = cellOf((P[a * 3 + 1]! + P[b * 3 + 1]!) / 2), ck = cellOf((P[a * 3 + 2]! + P[b * 3 + 2]!) / 2);
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let kk = ck - r; kk <= ck + r; kk++) near.add(keyOf(i, j, kk));
    }
    ensure(near);
    // 2. The two facets beside an edge, [facet, the edge's ends in the facet's order, its far
    // corner]: in the hash's cell that holds the edge's middle, which every facet with the edge holds.
    const besideOf = (a: number, b: number) => {
      const list: [number, number, number, number][] = [];
      const key = keyOf(cellOf((P[a * 3]! + P[b * 3]!) / 2), cellOf((P[a * 3 + 1]! + P[b * 3 + 1]!) / 2), cellOf((P[a * 3 + 2]! + P[b * 3 + 2]!) / 2));
      for (const t of cells.get(key) ?? []) {
        if (!alive[t]) continue;
        for (let e = 0; e < 3; e++) {
          const p = T[t * 3 + e]!, q = T[t * 3 + ((e + 1) % 3)]!;
          if ((p === a && q === b) || (p === b && q === a)) list.push([t, p, q, T[t * 3 + ((e + 2) % 3)]!]);
        }
      }
      return list;
    };
    // 3. Split, the worst first, at most one edge of each facet: the new corner on the
    // surface, and the facets beside the edge each cut in two at once, so the next split
    // is tested against them.
    let made = 0;
    const waiting = new Set<number>();
    for (const [k, w] of [...marked].sort((x, y) => y[1] - x[1])) {
      const ka = Math.floor(k / PAIR);
      const side = besideOf(ka, k - ka * PAIR);
      // A facet beside it was cut this pass (so the edge is no longer whole, or no longer has
      // its two facets): the next pass measures what is there again.
      if (side.length !== 2 || side.some(([t]) => born[t] === passes + 1)) {
        waiting.add(k);
        continue;
      }
      const [, a, b] = side[0]!;
      const mid: V3 = [(P[a * 3]! + P[b * 3]!) / 2, (P[a * 3 + 1]! + P[b * 3 + 1]!) / 2, (P[a * 3 + 2]! + P[b * 3 + 2]!) / 2];
      const len = Math.sqrt(dist2(a, b));
      const limit = Math.min(len, 8 * w);
      const from = side.map(([t]) => normal(T[t * 3]!, T[t * 3 + 1]!, T[t * 3 + 2]!));
      const mean: V3 = [0, 0, 0];
      for (const n of from) ((mean[0] += n[0]), (mean[1] += n[1]), (mean[2] += n[2]));
      let on = false, found = false, turnedOver = false;
      const tryFrom = (start: V3 | null, d: V3) => {
        if (on || !start || Math.hypot(start[0] - mid[0], start[1] - mid[1], start[2] - mid[2]) > limit) return;
        const dl = Math.hypot(d[0], d[1], d[2]);
        if (!(dl > 1e-9)) return;
        projectOntoSurface(f, start, [d[0] / dl, d[1] / dl, d[2] / dl], out, 0);
        // At the float32 the mesh, and so the casting file, will hold it, so what is tested is what is written.
        for (let i = 0; i < 3; i++) out[i] = Math.fround(out[i]!);
        if (Math.abs(f(out[0]!, out[1]!, out[2]!)) > 1e-5 || Math.hypot(out[0]! - mid[0], out[1]! - mid[1], out[2]! - mid[2]) > limit) return;
        found = true;
        const da = Math.hypot(out[0]! - P[a * 3]!, out[1]! - P[a * 3 + 1]!, out[2]! - P[a * 3 + 2]!);
        const db = Math.hypot(out[0]! - P[b * 3]!, out[1]! - P[b * 3 + 1]!, out[2]! - P[b * 3 + 2]!);
        if (da < 0.1 * len || db < 0.1 * len) return;
        const m = P.length / 3;
        P.push(out[0]!, out[1]!, out[2]!);
        if (side.some(([, p, q, r], i) => turned(p, m, r, from[i]!) || turned(m, q, r, from[i]!))) turnedOver = true;
        else {
          // The facets being cut are out of the way while their halves are tested.
          for (const [t] of side) alive[t] = 0;
          on = !side.some(([, p, q, r]) => crosses(p, m, r) || crosses(m, q, r));
          for (const [t] of side) alive[t] = 1;
          if (!on) turnedOver = false;
        }
        P.length = m * 3;
      };
      const na = gradient(f, P[a * 3]!, P[a * 3 + 1]!, P[a * 3 + 2]!), nb = gradient(f, P[b * 3]!, P[b * 3 + 1]!, P[b * 3 + 2]!);
      let crossing = false;
      const attempt = (start: V3 | null, d: V3) => {
        const before = found;
        tryFrom(start, d);
        if (!on && found && !before && !turnedOver) crossing = true;
      };
      if (na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] < CREASE_COS) {
        attempt(meetOfPlanes([na, nb], [at(a), at(b)], mid), mean);
        for (const [, , , r] of side) attempt(meetOfPlanes([na, nb, gradient(f, P[r * 3]!, P[r * 3 + 1]!, P[r * 3 + 2]!)], [at(a), at(b), at(r)], mid), mean);
      }
      attempt(mid, mean);
      attempt(mid, gradient(f, mid[0], mid[1], mid[2]));
      if (!on) {
        if (!found) notFound++;
        else if (crossing) crossed++;
        else leaned++;
        stuck.add(k);
        continue;
      }
      const m = P.length / 3;
      P.push(out[0]!, out[1]!, out[2]!);
      gen[m] = Math.max(gen[a]!, gen[b]!) + 1;
      slope[m] = NaN;
      vborn[m] = passes;
      for (const [t, p, q, r] of side) {
        alive[t] = 0;
        const u = T.length / 3;
        T.push(p, m, r, m, q, r);
        alive.push(1, 1);
        born.push(passes + 1, passes + 1);
        index(u);
        index(u + 1);
      }
      made++;
    }
    split += made;
    if (!made) break;
    deferred = waiting;
  }
  if (!split) return null;
  const tv: number[] = [];
  for (let t = 0; t < T.length / 3; t++) if (alive[t]) tv.push(T[t * 3]!, T[t * 3 + 1]!, T[t * 3 + 2]!);
  return { positions: Float32Array.from(P), triVerts: Uint32Array.from(tv), split, passes, kept: notFound + leaned + crossed + deep, notFound, leaned, crossed, deep };
}
