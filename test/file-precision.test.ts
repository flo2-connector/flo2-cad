// A SOLID STAYS ONE CLOSED SOLID AT THE PRECISION ITS CASTING FILES HOLD
// (fact:a-round-stone-in-a-bezel-fails-the-watertight-check-2026-10-05).
//
// Every round stone in a full bezel was refused: the moonstone (US 9, 14k, 7.5 × 4 mm round,
// 1.0 mm wall) with "200 edge(s) shared by more than two faces; 80 degenerate triangle(s)",
// while the emerald-cut bezel passed. THE CAUSE, measured: the round seat's cone and the
// bezel's back hole are drawn from the same outline, so they share their vertex angles and
// meet edge on edge. The kernel resolves each crossing in double precision as two vertices
// 1e-10 to 1e-7 mm apart, joined by an edge, which it keeps (its tolerance is about 4e-11 mm)
// and calls sound. The STL holds float32, about 1e-6 mm at that height, so 40 of those 64
// pairs became one point each: 80 triangles of zero area and 200 edges in three or more
// faces. The file was really broken, not misread: the checker welds only bit-identical
// float32 vertices. The 3MF, at six fixed decimals, was coarser still (114 collapsed
// triangles), and nothing read it back.
//
// These tests pin the CLASS, not the bezel: whatever the tree builds, no two vertices of the
// casting mesh may land on one point in the file, no triangle may collapse there, and the
// 3MF must hold the very vertices the checker read back from the STL. Observed failing on
// main 22921dd before the fix (build.ts atFilePrecision, threemf.ts float32Text).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { readBinaryStl } from '../src/checker/stl.js';
import { checkPiece } from '../src/engine.js';
import { write3mf } from '../src/files/threemf.js';
import { buildPiece, EXPORT_TOL, PREVIEW_TOL, type MeshOut } from '../src/library/build.js';
import { applySet, treeFromTemplate, type PieceTree, type TreeNode } from '../src/piece/tree.js';

/** Where the mesh breaks once its vertices are written as float32: distinct vertices that land on one point, and triangles that collapse. */
function atFloat32(m: MeshOut): { merged: number; collapsed: number; first: string | null } {
  const P = m.positions;
  const at = new Map<string, number>();
  const id = new Int32Array(P.length / 3);
  let merged = 0;
  let first: string | null = null;
  for (let i = 0; i < id.length; i++) {
    const key = `${Math.fround(P[3 * i]!)},${Math.fround(P[3 * i + 1]!)},${Math.fround(P[3 * i + 2]!)}`;
    const j = at.get(key);
    if (j === undefined) {
      at.set(key, i);
      id[i] = i;
    } else {
      merged++;
      first ??= key;
      id[i] = j;
    }
  }
  let collapsed = 0;
  const T = m.triangles;
  for (let t = 0; t < T.length; t += 3) {
    const a = id[T[t]!]!, b = id[T[t + 1]!]!, c = id[T[t + 2]!]!;
    if (a === b || b === c || a === c) collapsed++;
  }
  return { merged, collapsed, first };
}

function failing(r: Awaited<ReturnType<typeof checkPiece>>): string[] {
  return r.entries.filter((e) => e.result !== 'pass').map((e) => `${e.id}: ${e.measured}`);
}

/** The 3MF's model XML, out of its zip. */
function modelOf(z: Buffer): string {
  const end = z.length - 22;
  let cd = z.readUInt32LE(end + 16);
  for (let i = 0; i < z.readUInt16LE(end + 10); i++) {
    const csize = z.readUInt32LE(cd + 20), nlen = z.readUInt16LE(cd + 28), off = z.readUInt32LE(cd + 42);
    const name = z.subarray(cd + 46, cd + 46 + nlen).toString();
    const data = off + 30 + z.readUInt16LE(off + 26);
    if (name === '3D/3dmodel.model') return inflateRawSync(z.subarray(data, data + csize)).toString();
    cd += 46 + nlen;
  }
  throw new Error('no 3D/3dmodel.model in the 3MF');
}

const bezel = (diameter: string, size: string, wall = '1.0 mm', metal = 'gold_14k_yellow'): PieceTree =>
  treeFromTemplate('solitaire_ring', { ring_size: { system: 'US', size }, name: `bezel-${size}`, metal, stone_setting: 'bezel', stone_diameter: diameter, stone_depth: '4 mm', bezel_wall: wall });

const MOONSTONE = () => bezel('7.5 mm', '9');

/** Four wires on the shoulders under one smooth_union of 0.4 mm beside the round bezel: the shape of the owner's openwork moonstone ring (a stand-in, not its tree). */
function openwork(): PieceTree {
  const tree = MOONSTONE();
  const R = 18.95 / 2 + 1.6 + 0.2;
  const wires: TreeNode[] = [];
  for (const s of [1, -1])
    for (const y0 of [-1.1, 1.1]) {
      const path: [string, string, string][] = [];
      for (let i = 0; i < 18; i++) {
        const t = i / 17, phi = ((14 + 46 * t) * Math.PI) / 180;
        const y = y0 * (1 - 0.4 * t) + 0.25 * Math.sin(3 * Math.PI * t) * Math.sign(y0);
        path.push([`${(s * R * Math.sin(phi)).toFixed(4)} mm`, `${y.toFixed(4)} mm`, `${(R * Math.cos(phi)).toFixed(4)} mm`]);
      }
      wires.push({ id: `wire${wires.length + 1}`, op: 'sweep', params: { radius: '0.5 mm', path } });
    }
  tree.root.children!.push({ id: 'openwork', op: 'smooth_union', params: { radius: '0.4 mm' }, children: wires });
  return tree;
}

describe('no two vertices of a casting mesh land on one point when written as float32', () => {
  const pieces: [string, () => PieceTree][] = [
    ['the moonstone: a 7.5 mm round in a 1.0 mm bezel, US 9, 14k', MOONSTONE],
    ['the default round (6.5 mm) in a bezel, US 7', () => applySet(treeFromTemplate('solitaire_ring', { ring_size: { system: 'US', size: '7' }, name: 'default-bezel' }), { stone_setting: 'bezel' }).tree],
    ['a 7.0 mm round in a bezel, US 9', () => bezel('7.0 mm', '9')],
    ['a 5.0 mm round in a 1.2 mm bezel, US 5, silver', () => bezel('5.0 mm', '5', '1.2 mm', 'sterling_silver_925')],
    ['a 9.0 mm round in a bezel, US 11, platinum', () => bezel('9.0 mm', '11', '1.0 mm', 'platinum_950')],
    ["Emily's emerald-cut bezel", () => treeFromTemplate('emerald_bezel_solitaire', { ring_size: { system: 'US', size: '6.5' }, name: 'emily' })],
    ['a 4-prong solitaire', () => treeFromTemplate('solitaire_ring', { ring_size: { system: 'US', size: '7' }, name: 'sol' })],
  ];
  for (const [name, make] of pieces) {
    it(name, async () => {
      for (const shrinkage of ['off', 'on']) {
        const tree = make();
        tree.shrinkage = shrinkage;
        const built = await buildPiece(tree, { tol: EXPORT_TOL, applyShrinkage: true });
        const r = atFloat32(built.metal);
        assert.deepEqual(
          { merged: r.merged, collapsed: r.collapsed },
          { merged: 0, collapsed: 0 },
          `shrinkage ${shrinkage}: ${r.merged} vertices land on another and ${r.collapsed} triangles collapse, the first at ${r.first}`,
        );
      }
    });
  }
  it('four wires under a smooth_union beside the round bezel, in the preview and the casting file', async () => {
    for (const tol of [PREVIEW_TOL, EXPORT_TOL]) {
      const r = atFloat32((await buildPiece(openwork(), { tol, applyShrinkage: false })).metal);
      assert.deepEqual({ merged: r.merged, collapsed: r.collapsed }, { merged: 0, collapsed: 0 }, `at ${tol} mm: the first at ${r.first}`);
    }
  });
});

describe('a round stone in a full bezel exports, and both casting files hold the mesh the checker read', () => {
  it('the moonstone passes every check on the written file and is released', async () => {
    const r = await checkPiece(MOONSTONE(), 'export');
    assert.deepEqual(failing(r), []);
    assert.equal(r.report['export'], 'released');
    assert.match(r.entries.find((e) => e.id === 'watertight')!.measured ?? '', /^closed and manifold, 1 shell/);

    // The 3MF's vertices are the STL's, number for number: each reads back as the float32 the
    // STL holds, the two lists hold the same points, and no two 3MF vertices share one.
    const stl = readBinaryStl(r.stl!);
    const model = modelOf(r.threeMf!);
    const verts = [...model.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((m) => [m[1]!, m[2]!, m[3]!].map(Number) as [number, number, number]);
    assert.equal(verts.length, stl.positions.length / 3, 'the 3MF has one vertex for each point the STL welds');
    const stlPoints = new Set<string>();
    for (let i = 0; i < stl.positions.length; i += 3) stlPoints.add(`${stl.positions[i]},${stl.positions[i + 1]},${stl.positions[i + 2]}`);
    const mfPoints = new Set<string>();
    for (const [x, y, z] of verts) mfPoints.add(`${Math.fround(x)},${Math.fround(y)},${Math.fround(z)}`);
    assert.equal(mfPoints.size, verts.length, 'no two 3MF vertices land on one point');
    for (const p of mfPoints) assert.ok(stlPoints.has(p), `the 3MF vertex ${p} is a point of the STL`);
    assert.equal((model.match(/<triangle /g) ?? []).length, stl.count);
  });
});

describe("a 3MF coordinate is the shortest plain decimal that reads back as the STL's float32", () => {
  const values = [0, -0, 1, 100, 14.170729637145996, -3.3495330810546875, 31.999998092651367, 1.5e-7, -2.384185791015625e-7, 7.006492321624085e-45, 123456.7890625];
  // One triangle per value, the value as every coordinate, written by the 3MF writer itself.
  const positions = Float32Array.from(values.flatMap((v) => [v, v, v, v, v, v, v, v, v]));
  const model = modelOf(write3mf({ positions, triangles: Uint32Array.from(values.flatMap((_, i) => [3 * i, 3 * i + 1, 3 * i + 2])) }, {}));
  const written = [...model.matchAll(/<vertex x="([^"]+)"/g)].map((m) => m[1]!);
  for (const [i, v] of values.entries()) {
    it(String(Object.is(v, -0) ? '-0' : v), () => {
      const s = written[3 * i]!;
      assert.match(s, /^-?\d+(\.\d+)?$/, `${s} is a plain decimal`);
      // === and not Object.is: -0 written "0" is the same coordinate.
      assert.ok(Math.fround(Number(s)) === Math.fround(v), `${s} reads back as the float32 of ${v}, ${Math.fround(v)}`);
      assert.ok(!/\.\d*0$/.test(s), `${s} has no trailing zero`);
      // The shortest: one digit fewer does not read back as the same float32.
      const digits = s.replace('-', '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length;
      if (digits > 1) assert.notEqual(Math.fround(Number(Math.fround(v).toPrecision(digits - 1))), Math.fround(v), `${s} is the shortest`);
    });
  }
});
