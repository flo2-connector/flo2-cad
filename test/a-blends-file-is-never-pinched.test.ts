// A BLEND'S CASTING FILE IS NEVER PINCHED
// (fact:root-cause-a-blends-level-set-can-pinch-two-sheets-at-one-point-and-nothing-before-the-file-checks-by-position-2026-11-16;
// req:every-export-is-watertight).
//
// The kernel calls a mesh sound by vertex INDEX; a casting file holds only POSITIONS. On some
// grid placements a blend's level set puts two distinct vertices at one point, joined by no
// edge: sound for the kernel (status NoError), but in the STL the two sheets meet there, and
// the checker reads edges shared by more than two faces. Measured 2026-11-16 on main 1d8bbf6:
// the four wires below, at their own 0.12 mm grid, held 4 such pairs (0 to 7e-8 mm apart is
// not it: they were exactly 0 apart), and the file read "2 edge(s) shared by more than two
// faces". The float32 step (build.ts, atFilePrecision) collapses only vertices an edge joins,
// so it could not close them. On 13 of 15 grid placements and sizes the same blend was clean.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runChecks } from '../src/checker/check.js';
import { limitsFor } from '../src/engine.js';
import { writeBinaryStl } from '../src/files/stl.js';
import { kernel } from '../src/kernel/manifold.js';
import { Arena, atFilePrecision, EXPORT_TOL, polygonsToMesh } from '../src/library/build.js';
import { buildOp } from '../src/library/ops.js';
import { pinchedPositions } from '../src/library/pinch.js';
import { IDENTITY } from '../src/library/thicken.js';
import { METALS } from '../src/metals.js';
import type { TreeNode } from '../src/piece/tree.js';

/** Distinct vertices of a mesh at one float32 point: what an STL, which holds positions only, welds. */
function sharedPoints(mesh: { numProp: number; vertProperties: ArrayLike<number> }): number {
  const np = mesh.numProp, V = mesh.vertProperties, seen = new Set<string>();
  let shared = 0;
  for (let i = 0; i < V.length / np; i++) {
    const key = `${Math.fround(V[i * np]!)},${Math.fround(V[i * np + 1]!)},${Math.fround(V[i * np + 2]!)}`;
    if (seen.has(key)) shared++;
    else seen.add(key);
  }
  return shared;
}

const mm = (x: number) => `${x} mm`;
const P = (x: number, y: number, z: number) => [mm(x), mm(y), mm(z)];

const BLENDS: { name: string; node: TreeNode }[] = [
  {
    // test/blend-field.test.ts's; the one main pinched.
    name: 'four wires, two open rails crossing and two short scrolls',
    node: { id: 'b2', op: 'smooth_union', params: { radius: '0.4 mm' }, children: [
      { id: 'r1', op: 'sweep', params: { radius: '0.8 mm', path: [P(-4, 0.2, -3), P(-3, 1, 0), P(0, 3, 2), P(3, 1, 0), P(4, 0.2, -3)] } },
      { id: 'r2', op: 'sweep', params: { radius: '0.8 mm', path: [P(-4, -0.2, -3), P(-3, -1, 0), P(0, -3, 2), P(3, -1, 0), P(4, -0.2, -3)] } },
      { id: 's1', op: 'sweep', params: { radius: '0.75 mm', path: [P(2, 2, 1.2), P(2.5, 0.5, 1), P(3, -1, 0.5)] } },
      { id: 's2', op: 'sweep', params: { radius: '0.75 mm', closed: true, path: [P(-2, 2, 1.2), P(-2.5, 0.5, 1), P(-3, -1, 0.5)] } },
    ] },
  },
  {
    name: 'two spheres',
    node: { id: 'b1', op: 'smooth_union', params: { radius: '0.5 mm' }, children: [
      { id: 'b1a', op: 'sphere', params: { radius: '1 mm' } },
      { id: 'b1b', op: 'translate', params: { x: '1.5 mm' }, children: [{ id: 'b1c', op: 'sphere', params: { radius: '0.8 mm' } }] },
    ] },
  },
  {
    name: 'a box and a sphere',
    node: { id: 'blob', op: 'smooth_union', params: { radius: '0.4 mm' }, children: [
      { id: 'bx', op: 'box', params: { x: '3 mm', y: '1.5 mm', z: '1.2 mm' } },
      { id: 'sp', op: 'translate', params: { x: '2 mm' }, children: [{ id: 'spp', op: 'sphere', params: { radius: '0.9 mm' } }] },
    ] },
  },
  {
    name: 'one wire bent 40 degrees',
    node: { id: 'wire', op: 'smooth_union', params: { radius: '0.4 mm' }, children: [{ id: 'w', op: 'sweep', params: { radius: '0.6 mm', path: [P(-3, 0, 0), P(0, 0, 1.1), P(3, 0, 0)] } }] },
  },
];

describe("a blend's casting file is never pinched", () => {
  for (const { name, node } of BLENDS) {
    it(`${name}: no point is held by two vertices, and the written file reads watertight`, async () => {
      const k = await kernel();
      const A = new Arena();
      try {
        const m = buildOp(k, A, node, EXPORT_TOL, { m: IDENTITY, sheets: [], blends: [] });
        const file = atFilePrecision(A, m);
        assert.equal(sharedPoints(file.getMesh()), 0, "the casting mesh holds a point two of its vertices share");
        const stl = writeBinaryStl(polygonsToMesh(file), 'blend');
        const w = runChecks(stl, { prongs: [], scale: 1 }, limitsFor(METALS.gold_14k_yellow), stl).entries.find((e) => e.id === 'watertight')!;
        assert.equal(w.result, 'pass', w.measured ?? '');
      } finally {
        A.free();
      }
    });
  }
});

describe('pinchedPositions counts the points a casting file would weld that no edge joins', () => {
  /** A unit cube's mesh at `o`, with its own eight vertices numbered from `first`. */
  const cube = (o: [number, number, number], first: number) => {
    const v: number[] = [];
    for (let i = 0; i < 8; i++) v.push(o[0] + (i & 1), o[1] + ((i >> 1) & 1), o[2] + ((i >> 2) & 1));
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    const t: number[] = [];
    for (const [a, b, c, d] of quads) t.push(a! + first, b! + first, c! + first, a! + first, c! + first, d! + first);
    return { v, t };
  };
  const mesh = (parts: { v: number[]; t: number[] }[]) => ({
    numProp: 3,
    vertProperties: new Float32Array(parts.flatMap((p) => p.v)),
    triVerts: new Uint32Array(parts.flatMap((p) => p.t)),
  });

  it('one cube: none', () => {
    assert.equal(pinchedPositions(mesh([cube([0, 0, 0], 0)])), 0);
  });
  it('two cubes touching at one corner, each with its own vertex there: one', () => {
    assert.equal(pinchedPositions(mesh([cube([0, 0, 0], 0), cube([1, 1, 1], 8)])), 1);
  });
  it('two cubes touching along an edge, each with its own vertices there: two', () => {
    assert.equal(pinchedPositions(mesh([cube([0, 0, 0], 0), cube([1, 1, 0], 8)])), 2);
  });
  it('two cubes apart: none', () => {
    assert.equal(pinchedPositions(mesh([cube([0, 0, 0], 0), cube([3, 0, 0], 8)])), 0);
  });
  it('two vertices at one point joined by an edge, which the float32 step collapses: none', () => {
    // A tetrahedron (0, 1, 2, 3) whose corner 0 is split into 0 and 4 at the same point, with the edge (0, 4) between them.
    const v = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    const t = [0, 2, 1, 4, 1, 3, 4, 3, 2, 1, 2, 3, 0, 4, 2, 0, 1, 4];
    assert.equal(pinchedPositions({ numProp: 3, vertProperties: new Float32Array(v), triVerts: new Uint32Array(t) }), 0);
  });
});
