// The tree's general operations (dec:how-a-piece-is-described: "a structured tree
// of operations and jewelry parts, as data"; req:the-tree-has-sweeps-and-smooth-blends):
// primitives, booleans, transforms, extrude, revolve, a SWEEP of a round wire along
// a path, and a SMOOTH BLEND (smooth_union) evaluated as a level set of distance
// functions (Manifold's levelSet). Every one evaluates to a closed solid; the
// kernel guarantees manifold output.

import { segmentsFor, sphereSegments, type Kernel, type Manifold, type Vec2, type Vec3 } from '../kernel/manifold.js';
import { CallError } from '../errors.js';
import type { TreeNode } from '../piece/tree.js';
import { angleDeg, lengthMm } from '../units.js';
import type { Arena } from './build.js';

type Params = Record<string, unknown>;

const L = (p: Params, k: string, dflt = 0): number => (p[k] === undefined ? dflt : lengthMm(p[k], k));
const D = (p: Params, k: string, dflt = 0): number => (p[k] === undefined ? dflt : angleDeg(p[k], k));
const pts2 = (v: unknown): Vec2[] => (v as unknown[][]).map((pt) => [lengthMm(pt[0], 'x'), lengthMm(pt[1], 'y')] as Vec2);
const pts3 = (v: unknown): Vec3[] => (v as unknown[][]).map((pt) => [lengthMm(pt[0], 'x'), lengthMm(pt[1], 'y'), lengthMm(pt[2], 'z')] as Vec3);

function ccw(pts: Vec2[]): Vec2[] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? [...pts].reverse() : pts;
}

export function buildOp(k: Kernel, A: Arena, n: TreeNode, tol: number): Manifold {
  const { Manifold, CrossSection } = k;
  const p = (n.params ?? {}) as Params;
  const kids = () => (n.children ?? []).map((c) => buildOp(k, A, c, tol));
  const all = (): Manifold => {
    const ms = kids();
    return ms.length === 1 ? ms[0]! : A.t(Manifold.union(ms));
  };
  switch (n.op) {
    case 'sphere': {
      const r = L(p, 'radius');
      return A.t(Manifold.sphere(r, sphereSegments(r, tol)));
    }
    case 'cylinder': {
      const r = L(p, 'radius');
      return A.t(Manifold.cylinder(L(p, 'height'), r, r, segmentsFor(r, tol, 16)));
    }
    case 'box':
      return A.t(Manifold.cube([L(p, 'x'), L(p, 'y'), L(p, 'z')], true));
    case 'torus': {
      const R = L(p, 'major_radius'), r = L(p, 'minor_radius');
      if (r >= R) throw new CallError(`${n.id}.params.minor_radius`, 'must be smaller than major_radius.');
      const n2 = segmentsFor(r, tol, 16);
      const ring = Array.from({ length: n2 }, (_, i) => [R + r * Math.cos((2 * Math.PI * i) / n2), r * Math.sin((2 * Math.PI * i) / n2)] as Vec2);
      return A.t(Manifold.revolve(A.t(new CrossSection([ring])), segmentsFor(R + r, tol, 32)));
    }
    case 'extrude':
      return A.t(Manifold.extrude(A.t(new CrossSection([ccw(pts2(p['points']))])), L(p, 'height')));
    case 'revolve': {
      const prof = ccw(pts2(p['points']));
      const rMax = Math.max(...prof.map((q) => q[0]));
      return A.t(Manifold.revolve(A.t(new CrossSection([prof])), segmentsFor(rMax, tol, 32), D(p, 'degrees', 360)));
    }
    case 'sweep': {
      const r = L(p, 'radius');
      const path = pts3(p['path']);
      const seg = sphereSegments(r, tol);
      // Each segment's end balls are turned a different amount, so where two segments
      // meet their spheres cross instead of coinciding face for face.
      const ball = (q: Vec3, i: number) => A.t(A.t(A.t(Manifold.sphere(r, seg)).rotate([0, 0, 7.31 * i + 3.7])).translate(q));
      const pieces: Manifold[] = [];
      const m = p['closed'] === true ? path.length : path.length - 1;
      for (let i = 0; i < m; i++) pieces.push(A.t(Manifold.hull([ball(path[i]!, i), ball(path[(i + 1) % path.length]!, i)])));
      return pieces.length === 1 ? pieces[0]! : A.t(Manifold.union(pieces));
    }
    case 'union':
      return all();
    case 'difference': {
      const ms = kids();
      return ms.length === 1 ? ms[0]! : A.t(ms[0]!.subtract(A.t(Manifold.union(ms.slice(1)))));
    }
    case 'intersection': {
      const ms = kids();
      return ms.length === 1 ? ms[0]! : A.t(Manifold.intersection(ms));
    }
    case 'translate':
      return A.t(all().translate([L(p, 'x'), L(p, 'y'), L(p, 'z')]));
    case 'rotate':
      return A.t(all().rotate([D(p, 'x'), D(p, 'y'), D(p, 'z')]));
    case 'mirror':
      return A.t(all().mirror(p['plane'] === 'xy' ? [0, 0, 1] : p['plane'] === 'yz' ? [1, 0, 0] : [0, 1, 0]));
    case 'smooth_union':
      return smoothUnion(k, A, n, tol);
  }
  throw new CallError(`${n.id}.op`, `"${String(n.op ?? n.part)}" cannot be used here.`);
}

// ------------------------------------------------------------- smooth blend

/** A signed distance (negative inside) for the blendable operations. */
type Sdf = (x: number, y: number, z: number) => number;

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

function capsule(x: number, y: number, z: number, a: Vec3, b: Vec3, r: number): number {
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

function sdfOf(n: TreeNode): Sdf {
  const p = (n.params ?? {}) as Params;
  const kids = (n.children ?? []).map(sdfOf);
  const unionAll: Sdf = (x, y, z) => kids.reduce((m, f) => Math.min(m, f(x, y, z)), Infinity);
  switch (n.op) {
    case 'sphere': {
      const r = L(p, 'radius');
      return (x, y, z) => Math.hypot(x, y, z) - r;
    }
    case 'box': {
      const bx = L(p, 'x') / 2, by = L(p, 'y') / 2, bz = L(p, 'z') / 2;
      return (x, y, z) => {
        const qx = Math.abs(x) - bx, qy = Math.abs(y) - by, qz = Math.abs(z) - bz;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
      };
    }
    case 'cylinder': {
      const r = L(p, 'radius'), h = L(p, 'height');
      return (x, y, z) => {
        const dx = Math.hypot(x, y) - r, dz = Math.abs(z - h / 2) - h / 2;
        return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
      };
    }
    case 'torus': {
      const R = L(p, 'major_radius'), r = L(p, 'minor_radius');
      return (x, y, z) => Math.hypot(Math.hypot(x, y) - R, z) - r;
    }
    case 'sweep': {
      const r = L(p, 'radius');
      const path = pts3(p['path']);
      const m = p['closed'] === true ? path.length : path.length - 1;
      return (x, y, z) => {
        let d = Infinity;
        for (let i = 0; i < m; i++) d = Math.min(d, capsule(x, y, z, path[i]!, path[(i + 1) % path.length]!, r));
        return d;
      };
    }
    case 'translate': {
      const tx = L(p, 'x'), ty = L(p, 'y'), tz = L(p, 'z');
      return (x, y, z) => unionAll(x - tx, y - ty, z - tz);
    }
    case 'rotate': {
      const inv = rotInverse(D(p, 'x'), D(p, 'y'), D(p, 'z'));
      return (x, y, z) => {
        const q = inv(x, y, z);
        return unionAll(q[0], q[1], q[2]);
      };
    }
    case 'mirror': {
      const pl = p['plane'];
      return (x, y, z) => unionAll(pl === 'yz' ? -x : x, pl === 'xz' ? -y : y, pl === 'xy' ? -z : z);
    }
    case 'union':
      return unionAll;
    case 'smooth_union': {
      const k = L(p, 'radius');
      return (x, y, z) => kids.reduce((m, f) => (m === Infinity ? f(x, y, z) : smin(m, f(x, y, z), k)), Infinity);
    }
  }
  throw new CallError(`${n.id}.op`, `"${String(n.op)}" cannot be blended.`);
}

function smoothUnion(k: Kernel, A: Arena, n: TreeNode, tol: number): Manifold {
  const { Manifold } = k;
  const p = (n.params ?? {}) as Params;
  const blend = L(p, 'radius');
  const f = sdfOf(n);
  // The plain union's bounding box, grown by the blend, bounds the blended solid.
  const plain = A.t(Manifold.union((n.children ?? []).map((c) => buildOp(k, A, c, Math.max(tol, 0.05)))));
  const bb = plain.boundingBox();
  const g = blend + 0.3;
  const edge = Math.min(0.25, Math.max(0.03, Math.sqrt(8 * Math.max(blend, 0.2) * tol)));
  const out = Manifold.levelSet((q: Vec3) => -f(q[0], q[1], q[2]), { min: [bb.min[0] - g, bb.min[1] - g, bb.min[2] - g], max: [bb.max[0] + g, bb.max[1] + g, bb.max[2] + g] }, edge, 0, tol / 2);
  return A.t(out);
}
