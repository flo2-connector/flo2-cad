// THE BLEND IS THE SAME, READ FASTER, AND ITS SURFACE IS CHECKED ON ITS OWN SURFACE
// (cap:the-casting-check-finishes-in-time-for-any-piece;
// fact:check-time-is-the-blend-field-and-the-wall-ball).
//
// A smooth_union's level set read its distance field in full at every grid sample: on the
// openwork ring, 4.9 µs a sample, 94 % of the level set's time. The field is now read
// exactly only where Manifold's levelSet reads a value (src/library/field.ts), so these
// pin that the kernel's output is BIT FOR BIT what the full field gives, against the field
// exactly as main 0b432a3 defined it (copied below), on blends of every blendable kind.
//
// And the surface check's reference no longer re-tessellates a blend with a second, finer
// level set (687 MiB of grid on the openwork ring): the library declares points on the
// blend's own surface over every facet the file has from it, and the check measures them.
// These pin that those points lie on the surface, and that a facet off it is refused.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runChecks } from '../src/checker/check.js';
import { CallError } from '../src/errors.js';
import { checkPiece, limitsFor } from '../src/engine.js';
import { writeBinaryStl } from '../src/files/stl.js';
import { kernel, type Vec3 } from '../src/kernel/manifold.js';
import { buildPiece, EXPORT_TOL } from '../src/library/build.js';
import { BlendField, fieldOf, levelSetStep } from '../src/library/field.js';
import { METALS } from '../src/metals.js';
import { treeFromTemplate, type PieceTree, type TreeNode } from '../src/piece/tree.js';
import { angleDeg, lengthMm } from '../src/units.js';

// ------------------------------------------- the field as main 0b432a3 defined it (ops.ts)

type Params = Record<string, unknown>;
const L = (p: Params, k: string, dflt = 0): number => (p[k] === undefined ? dflt : lengthMm(p[k], k));
const D = (p: Params, k: string, dflt = 0): number => (p[k] === undefined ? dflt : angleDeg(p[k], k));
const pts3 = (v: unknown): Vec3[] => (v as unknown[][]).map((pt) => [lengthMm(pt[0], 'x'), lengthMm(pt[1], 'y'), lengthMm(pt[2], 'z')] as Vec3);

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

function definedField(n: TreeNode): Sdf {
  const p = (n.params ?? {}) as Params;
  const kids = (n.children ?? []).map(definedField);
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

// ------------------------------------------------------------------------- the cases

const mm = (x: number) => `${x} mm`;
const P = (x: number, y: number, z: number) => [mm(x), mm(y), mm(z)];

/** Blends of every blendable kind: sweeps, spheres, boxes, cylinders, tori, every transform, a union and a smooth_union inside. */
const BLENDS: { name: string; node: TreeNode; edges: number[] }[] = [
  {
    name: 'two spheres',
    node: { id: 'b1', op: 'smooth_union', params: { radius: '0.5 mm' }, children: [
      { id: 'b1a', op: 'sphere', params: { radius: '1 mm' } },
      { id: 'b1b', op: 'translate', params: { x: '1.5 mm' }, children: [{ id: 'b1c', op: 'sphere', params: { radius: '0.8 mm' } }] },
    ] },
    edges: [0.25, 0.12, 0.05],
  },
  {
    name: 'four wires, two open rails crossing and two short scrolls',
    node: { id: 'b2', op: 'smooth_union', params: { radius: '0.4 mm' }, children: [
      { id: 'r1', op: 'sweep', params: { radius: '0.8 mm', path: [P(-4, 0.2, -3), P(-3, 1, 0), P(0, 3, 2), P(3, 1, 0), P(4, 0.2, -3)] } },
      { id: 'r2', op: 'sweep', params: { radius: '0.8 mm', path: [P(-4, -0.2, -3), P(-3, -1, 0), P(0, -3, 2), P(3, -1, 0), P(4, -0.2, -3)] } },
      { id: 's1', op: 'sweep', params: { radius: '0.75 mm', path: [P(2, 2, 1.2), P(2.5, 0.5, 1), P(3, -1, 0.5)] } },
      { id: 's2', op: 'sweep', params: { radius: '0.75 mm', closed: true, path: [P(-2, 2, 1.2), P(-2.5, 0.5, 1), P(-3, -1, 0.5)] } },
    ] },
    edges: [0.25, 0.12],
  },
  {
    name: 'a box, a cylinder and a torus, rotated, mirrored and moved, with a union and a smooth_union inside',
    node: { id: 'b3', op: 'smooth_union', params: { radius: '0.3 mm' }, children: [
      { id: 'b3a', op: 'rotate', params: { x: '20 deg', y: '35 deg', z: '-10 deg' }, children: [{ id: 'b3b', op: 'box', params: { x: '2 mm', y: '1.2 mm', z: '0.9 mm' } }] },
      { id: 'b3c', op: 'mirror', params: { plane: 'yz' }, children: [{ id: 'b3d', op: 'translate', params: { x: '1.1 mm', z: '0.2 mm' }, children: [{ id: 'b3e', op: 'cylinder', params: { radius: '0.5 mm', height: '1.6 mm' } }] }] },
      { id: 'b3f', op: 'union', children: [
        { id: 'b3g', op: 'translate', params: { y: '1.2 mm' }, children: [{ id: 'b3h', op: 'torus', params: { major_radius: '0.9 mm', minor_radius: '0.3 mm' } }] },
        { id: 'b3i', op: 'smooth_union', params: { radius: '0.2 mm' }, children: [
          { id: 'b3j', op: 'translate', params: { y: '-1.3 mm' }, children: [{ id: 'b3k', op: 'sphere', params: { radius: '0.6 mm' } }] },
          { id: 'b3l', op: 'translate', params: { y: '-1.3 mm', x: '0.7 mm' }, children: [{ id: 'b3m', op: 'sphere', params: { radius: '0.4 mm' } }] },
        ] },
      ] },
    ] },
    edges: [0.25, 0.12, 0.06],
  },
];

/** A box round the blend, as smoothUnion's is: the shapes' reach grown by the blend radius and 0.3 mm. */
function boxOf(f: Sdf, guess: number): { min: Vec3; max: Vec3 } {
  // The solid lies within `guess` of the origin for every case here; the field says how far it reaches.
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const n = 40;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k <= n; k++) {
    const p: Vec3 = [-guess + (2 * guess * i) / n, -guess + (2 * guess * j) / n, -guess + (2 * guess * k) / n];
    if (f(p[0], p[1], p[2]) < 0) for (let c = 0; c < 3; c++) ((lo[c] = Math.min(lo[c]!, p[c]!)), (hi[c] = Math.max(hi[c]!, p[c]!)));
  }
  const g = 0.7 + (2 * guess) / n;
  return { min: [lo[0] - g, lo[1] - g, lo[2] - g], max: [hi[0] + g, hi[1] + g, hi[2] + g] };
}

describe('the blend field, read where the kernel reads it, gives the very level set the full field gives', () => {
  for (const { name, node, edges } of BLENDS) {
    for (const edge of edges) {
      it(`${name}, grid ${edge} mm: the same mesh, bit for bit, and the same value wherever a value is read`, async () => {
        const k = await kernel();
        const defined = definedField(node);
        const box = boxOf(defined, 6);
        const step = levelSetStep(box.min, box.max, edge);
        const field = new BlendField(node, box, step);
        // The new definition of the field, read in full, is the old one exactly.
        const full = fieldOf(node);
        for (let i = 0; i < 20000; i++) {
          const x = box.min[0] + Math.random() * (box.max[0] - box.min[0]), y = box.min[1] + Math.random() * (box.max[1] - box.min[1]), z = box.min[2] + Math.random() * (box.max[2] - box.min[2]);
          const v = defined(x, y, z);
          assert.equal(full(x, y, z), v);
          assert.equal(field.value(x, y, z), v);
          const s = field.sample(x, y, z);
          assert.equal(s > 0, v > 0);
          if (Math.abs(v) <= 2 * step) assert.equal(s, v);
        }
        const mesh = (f: Sdf) => {
          const m = k.Manifold.levelSet((q: Vec3) => -f(q[0], q[1], q[2]), box, edge, 0, EXPORT_TOL / 2);
          const g = m.getMesh();
          m.delete();
          return { pos: Buffer.from(g.vertProperties.buffer), tri: Buffer.from(g.triVerts.buffer), n: g.triVerts.length / 3 };
        };
        const a = mesh(defined), b = mesh((x, y, z) => field.sample(x, y, z));
        assert.ok(a.n > 100, `${a.n} triangles`);
        assert.equal(b.n, a.n);
        assert.ok(b.pos.equals(a.pos), 'vertex positions differ');
        assert.ok(b.tri.equals(a.tri), 'triangles differ');
      });
    }
  }
});

/** A plain band with a blend of two spheres standing on its top. */
function bandWithBlend(): { tree: PieceTree; node: TreeNode; lift: number } {
  const tree = treeFromTemplate('plain_band', { ring_size: { system: 'US', size: '7' }, name: 'blend', band_thickness: '1.6 mm' });
  const node: TreeNode = BLENDS[0]!.node;
  const lift = 9.8;
  tree.root.children!.push({ id: 'lift', op: 'translate', params: { x: '0 mm', y: '0 mm', z: `${lift} mm` }, children: [node] });
  return { tree, node, lift };
}

describe("a blend's surface is checked on its own surface", () => {
  it('the export declares points over every facet the file has from the blend, each on the blend\'s surface, and the check measures them', async () => {
    const { tree, node, lift } = bandWithBlend();
    const built = await buildPiece(tree, { tol: EXPORT_TOL, applyShrinkage: true, blendSurface: true });
    const blends = built.decl.blends ?? [];
    assert.equal(blends.length, 1);
    assert.equal(blends[0]!.label, node.id);
    const pts = blends[0]!.points;
    assert.ok(pts.length / 3 > 1000, `${pts.length / 3} points`);
    const f = fieldOf(node);
    let worst = 0;
    for (let i = 0; i < pts.length; i += 3) worst = Math.max(worst, Math.abs(f(pts[i]!, pts[i + 1]!, pts[i + 2]! - lift)));
    // On the surface to within the float32 the points are kept in (about 1e-6 mm at 10 mm).
    assert.ok(worst < 5e-6, `a declared point lies ${worst} mm off the blend's surface`);
    const r = await checkPiece(tree, 'check');
    const surface = r.entries.find((e) => e.id === 'surface_deviation')!;
    assert.match(surface.measured!, /points on the smooth blends' own surfaces/);
    assert.equal(surface.result, 'pass', surface.measured ?? '');
  });

  it('a facet standing 0.02 mm off the blend\'s surface is refused', async () => {
    const { tree } = bandWithBlend();
    const built = await buildPiece(tree, { tol: EXPORT_TOL, applyShrinkage: true, blendSurface: true });
    const stl = writeBinaryStl(built.metal, 'x');
    const L = limitsFor(METALS.sterling_silver_925);
    const ok = runChecks(stl, built.decl, L, stl).entries.find((e) => e.id === 'surface_deviation')!;
    assert.equal(ok.result, 'pass', ok.measured ?? '');
    // Move every declared point 0.02 mm up: as if the blend's true surface stood that far off its facets.
    const b = built.decl.blends![0]!;
    const off = new Float32Array(b.points);
    for (let i = 2; i < off.length; i += 3) off[i] = off[i]! + 0.02;
    const bad = runChecks(stl, { ...built.decl, blends: [{ ...b, points: off }] }, L, stl).entries.find((e) => e.id === 'surface_deviation')!;
    assert.equal(bad.result, 'fail', bad.measured ?? '');
    assert.ok(bad.value! >= 0.01, `${bad.value} mm`);
  });
});
