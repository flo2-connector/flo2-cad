// THE SURFACE CHECK MEASURES ONLY POINTS IT FOUND ON THE BLEND'S SURFACE
// (con:surface-deviation-tolerance; fact:root-cause-the-surface-check-measured-points-its-own-
// projection-left-off-the-blends-surface-2026-11-16).
//
// The symptom: on a local branch that meshed a blend more coarsely, two wavy wires blended
// read "surface_deviation fail 0.053 mm"; the facets there stand 0.002-0.003 mm off.
//
// The cause, measured: the check measures the written facets against points the library
// declares on the blend's own surface, each found from a point of a facet by looking along
// that facet's normal (field.ts, projectOntoSurface). A needle-thin facet's normal can lie
// almost along the surface (86-88 degrees off it); in a concave hollow that line stays inside
// the solid, meets no surface within the 0.2 mm reach, and the point was WRITTEN AT THE REACH
// ANYWAY, 0.04 mm inside the solid, and measured as if it were on the surface. The 19 points
// over the limit were exactly the 19 not on the surface.
//
// The class: an instrument writes a value it did not find. These pin that a point is reported
// on the surface only where it was found there, and that the check never measures a point
// that was not.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runChecks, SURFACE_REACH } from '../src/checker/check.js';
import { limitsFor } from '../src/engine.js';
import { writeBinaryStl } from '../src/files/stl.js';
import { buildPiece, EXPORT_TOL } from '../src/library/build.js';
import { fieldOf, placeOnSurface, projectOntoSurface, SURFACE_REACH_MM } from '../src/library/field.js';
import { METALS } from '../src/metals.js';
import { treeFromTemplate, type PieceTree, type TreeNode } from '../src/piece/tree.js';
import { readRun } from '../src/program/verify.js';

const mm = (x: number) => `${x} mm`;

/** Two spheres of 1 mm blended with a 0.5 mm fillet: at x = 0 a neck, concave along the x axis. */
const TWO_SPHERES: TreeNode = {
  id: 'pair',
  op: 'smooth_union',
  params: { radius: mm(0.5) },
  children: [
    { id: 'l', op: 'translate', params: { x: mm(-0.9) }, children: [{ id: 'ls', op: 'sphere', params: { radius: mm(1) } }] },
    { id: 'r', op: 'translate', params: { x: mm(0.9) }, children: [{ id: 'rs', op: 'sphere', params: { radius: mm(1) } }] },
  ],
};

/** The neck's radius: where the field is zero on the y axis, by bisection. */
function neckRadius(f: (x: number, y: number, z: number) => number): number {
  let lo = 0, hi = 2;
  assert.ok(f(0, lo, 0) < 0 && f(0, hi, 0) > 0, 'the neck is not bracketed');
  for (let i = 0; i < 100; i++) {
    const m = (lo + hi) / 2;
    if (f(0, m, 0) < 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

describe('a point is reported on the blend\'s surface only where it was found there', () => {
  it("looking along a sliver's normal that lies almost along a concave hollow: the point written is on the surface, or the call says it found none", () => {
    const f = fieldOf(TWO_SPHERES);
    const r = neckRadius(f);
    // A point of a facet 0.002 mm inside the neck (as the needle facets stood), and that
    // facet's normal 87 degrees off the surface's (which is +y there), along the hollow.
    const p: [number, number, number] = [0, r - 0.002, 0];
    const off = (87 * Math.PI) / 180;
    const d: [number, number, number] = [Math.sin(off), Math.cos(off), 0];
    // The line meets no surface within the reach, both ways: what the sliver met.
    for (let s = -SURFACE_REACH_MM; s <= SURFACE_REACH_MM; s += SURFACE_REACH_MM / 400) assert.ok(f(p[0] + s * d[0], p[1] + s * d[1], p[2]) < 0, `the line leaves the solid at ${s} mm`);
    const out = new Float64Array(3);
    const found: unknown = projectOntoSurface(f, p, d, out, 0);
    const v = Math.abs(f(out[0]!, out[1]!, out[2]!));
    assert.ok(found === false || (found === true && v < 1e-6), `the call returned ${String(found)} and wrote a point ${v.toFixed(4)} mm off the surface`);
  });
});

/** The sliver of the observed failure: a point 0.002 mm inside the neck, and a normal 87 degrees off the surface's, along the hollow. */
function sliver(): { f: (x: number, y: number, z: number) => number; p: [number, number, number]; d: [number, number, number] } {
  const f = fieldOf(TWO_SPHERES);
  const off = (87 * Math.PI) / 180;
  return { f, p: [0, neckRadius(f) - 0.002, 0], d: [Math.sin(off), Math.cos(off), 0] };
}

describe("a point of a blend's surface is found where a sliver's normal finds none", () => {
  it("placeOnSurface looks along the field's gradient and finds the surface the normal missed", () => {
    const { f, p, d } = sliver();
    const out = new Float64Array(3);
    assert.equal(projectOntoSurface(f, p, d, out, 0), false);
    assert.equal(placeOnSurface(f, p, d, out, 0), true);
    assert.ok(Math.abs(f(out[0]!, out[1]!, out[2]!)) < 1e-6, `${f(out[0]!, out[1]!, out[2]!)} mm`);
    // The nearest point of the surface: 0.002 mm out, along the surface's own normal (+y).
    assert.ok(Math.abs(Math.hypot(out[0]! - p[0], out[1]! - p[1], out[2]! - p[2]) - 0.002) < 1e-4, `${Math.hypot(out[0]! - p[0], out[1]! - p[1], out[2]! - p[2])} mm away`);
  });

  it('a point with no surface within the reach either way is reported as not found', () => {
    const f = fieldOf(TWO_SPHERES);
    const out = new Float64Array(3);
    // 0.5 mm out from the neck: the nearest surface is further than the reach.
    const p: [number, number, number] = [0, neckRadius(f) + 0.5, 0];
    assert.equal(placeOnSurface(f, p, [1, 0, 0], out, 0), false);
  });

  it("the checker's reach is the library's", () => {
    assert.equal(SURFACE_REACH, SURFACE_REACH_MM);
  });
});

const mm2 = (x: number, y: number, z: number) => [mm(x), mm(y), mm(z)];
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const moonstone = JSON.parse(readFileSync(`${ROOT}test/fixtures/moonstone-openwork-ring.tree.json`, 'utf8')) as PieceTree;

/** A US 7 plain band with a blend standing on its top, lifted by z. */
function bandWith(node: TreeNode, z: number): PieceTree {
  const tree = treeFromTemplate('plain_band', { ring_size: { system: 'US', size: '7' }, name: node.id, band_thickness: '1.6 mm' });
  tree.root.children!.push({ id: 'on_top', op: 'translate', params: { x: '0 mm', y: '0 mm', z: mm(z) }, children: [node] });
  return tree;
}

/** Every blend kind the suite builds, each with how far it is lifted (the moonstone's wires are the ring's own, unmoved). */
const PIECES: { name: string; tree: PieceTree; node: TreeNode; lift: number }[] = [
  { name: 'two spheres', tree: bandWith(TWO_SPHERES, 11), node: TWO_SPHERES, lift: 11 },
  ...[
    { name: 'a wire bent 40 degrees', node: { id: 'wire', op: 'smooth_union', params: { radius: '0.4 mm' }, children: [{ id: 'w', op: 'sweep', params: { radius: '0.6 mm', path: [mm2(-3, 0, 0), mm2(0, 0, 1.1), mm2(3, 0, 0)] } }] } as TreeNode, lift: 10.2 },
    { name: 'a box and a sphere', node: { id: 'blob', op: 'smooth_union', params: { radius: '0.4 mm' }, children: [
      { id: 'bx', op: 'box', params: { x: '3 mm', y: '1.5 mm', z: '1.2 mm' } },
      { id: 'sp', op: 'translate', params: { x: '2 mm' }, children: [{ id: 'spp', op: 'sphere', params: { radius: '0.9 mm' } }] },
    ] } as TreeNode, lift: 10.6 },
  ].map((x) => ({ ...x, tree: bandWith(x.node, x.lift) })),
  { name: "the moonstone ring's four wires", tree: moonstone, node: moonstone.root.children!.find((c) => c.op === 'smooth_union')!, lift: 0 },
];

describe("every point a blend declares lies on the blend's own surface", () => {
  for (const { name, tree, node, lift } of PIECES) {
    it(name, { timeout: 300_000 }, async () => {
      const built = await buildPiece(tree, { tol: EXPORT_TOL, applyShrinkage: false, blendSurface: true });
      const b = (built.decl.blends ?? []).find((x) => x.label === node.id)!;
      assert.ok(b, `no blend "${node.id}" declared`);
      assert.ok(b.points.length / 3 > 1000, `${b.points.length / 3} points`);
      assert.equal(b.unplaced, undefined, `${(b.unplaced?.length ?? 0) / 3} points not found on the surface`);
      const f = fieldOf(node);
      let worst = 0;
      for (let i = 0; i < b.points.length; i += 3) worst = Math.max(worst, Math.abs(f(b.points[i]!, b.points[i + 1]!, b.points[i + 2]! - lift)));
      // On the surface to within the float32 the points are kept in (about 1e-6 mm at 10 mm).
      assert.ok(worst < 5e-6, `a declared point lies ${worst} mm off the blend's surface`);
    });
  }
});

describe('the surface check never measures a point that was not found on the surface', () => {
  it('a blend that declares points it could not place reads could-not-run there, named on the blend, and the file is not passed', async () => {
    const built = await buildPiece(bandWith(TWO_SPHERES, 11), { tol: EXPORT_TOL, applyShrinkage: false, blendSurface: true });
    const stl = writeBinaryStl(built.metal, 'x');
    const L = limitsFor(METALS.sterling_silver_925);
    const b = built.decl.blends![0]!;
    const ok = runChecks(stl, built.decl, L, stl).entries.find((e) => e.id === 'surface_deviation')!;
    assert.equal(ok.result, 'pass', ok.measured ?? '');
    // Two of its points declared as not found, where they stand.
    const unplaced = b.points.slice(0, 6);
    const r = runChecks(stl, { ...built.decl, blends: [{ ...b, unplaced }] }, L, stl);
    const s = r.entries.find((e) => e.id === 'surface_deviation')!;
    assert.equal(s.result, 'could_not_run', s.measured ?? '');
    assert.match(s.measured!, /^at 2 points of a smooth blend's facets no point of its own surface was found within 0\.2 mm/);
    assert.equal(s.where?.part, 'blend', JSON.stringify(s.where));
    assert.equal(s.where?.feature, 'pair');
    assert.match(s.problem!, /nothing is exported until it can/);
  });

  it("a program's run carries a blend's unplaced points to the checker", () => {
    const f32 = (a: number[]) => Buffer.from(new Float32Array(a).buffer);
    const blobs = [f32([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), Buffer.from(new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]).buffer), f32([0.1, 0.1, 0.1]), f32([0.2, 0.2, 0.2, 0.3, 0.3, 0.3])];
    const v = { metal: { positions: 0, triangles: 1 }, decl: { scale: 1, prongs: [], blends: [{ label: 'wires', points: 2, unplaced: 3 }] }, parts: [], named: [] };
    const run = readRun(v, blobs, { tol: EXPORT_TOL, scale: 1, blendSurface: true });
    const b = run.decl!.blends![0]!;
    assert.deepEqual([...b.points], [...new Float32Array([0.1, 0.1, 0.1])]);
    assert.deepEqual([...b.unplaced!], [...new Float32Array([0.2, 0.2, 0.2, 0.3, 0.3, 0.3])]);
    const none = readRun({ ...v, decl: { ...v.decl, blends: [{ label: 'wires', points: 2 }] } }, blobs, { tol: EXPORT_TOL, scale: 1, blendSurface: true });
    assert.equal(none.decl!.blends![0]!.unplaced, undefined);
  });
});
