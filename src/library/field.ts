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
