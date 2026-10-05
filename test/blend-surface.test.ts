// A SMOOTH BLEND'S CASTING FACETS LIE WITHIN THE SURFACE LIMIT OF ITS OWN SURFACE, AT ITS
// CREASES TOO (con:surface-deviation-tolerance, req:smooth-surfaces;
// fact:a-blends-level-set-chamfers-the-creases-of-its-own-field-2026-10-05).
//
// The symptom: on flo2.io, 2026-10-05, check_piece on moonstone-openwork-ring (flo2-cad
// c678b62) read "Surface smoothness (limit 0.01 mm): FAIL, 0.012 mm ... on the head: bezel
// (at 6:00 seen from above, the finger pointing to 12)". Main 0b432a3 had read 0.010 mm
// (0.0102, also a fail) at the same place.
//
// The cause, measured:
//  · The place is not the bezel. It is a point on the smooth blend's own surface, the
//    underside of the rail where the wire bends at its peak (x = 0, y = -3.07, z = 10.47),
//    seen through the bezel's open back. The checker named it by region: anything inside
//    the bezel's outline and above its foot was "the bezel". The bezel's own facets read
//    at most 0.007 mm, on 0b432a3 and c678b62 alike.
//  · There the rail's two straight runs meet at 25.6 degrees, and a sweep's runs are joined
//    by a plain min, so the blend's field has a CREASE on the inside of the bend. A level
//    set cannot follow a crease: its facets cut across it, and stand off it by about half a
//    grid step times the sine of half the bend (0.06 x sin 12.8 deg = 0.013 mm). Sampled
//    densely, the file's facets there stand 0.0129 mm off the field's zero level; the check
//    read 0.012 at its seven points a facet, main's finer reference 0.0102. The same wire
//    built as a plain sweep, by the kernel, reads 0.007 mm: the crease is the blend's.
//  · The class: the level set's grid was sized for a smooth surface (the facet's sag, from
//    the blend radius) and nothing measured what it made. A crease (a wire's bend, a box's
//    or a cylinder's edge inside a blend) stands off by a length proportional to the grid
//    step, not its square: a box in a blend read 0.036 mm.
//
// The fix (src/library/field.ts, holdToSurface): after the level set, every edge or facet
// whose points stand off the field by more than the casting tolerance is split, the new
// corner put ON the surface (on the crease itself where it crosses one), each split guarded
// so no facet turns over or passes through another, until none stands off. The check is
// unchanged: it reads the file, as before. Observed failing on main c678b62 before the fix.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runChecks } from '../src/checker/check.js';
import { checkPiece, limitsFor } from '../src/engine.js';
import { writeBinaryStl } from '../src/files/stl.js';
import { kernel } from '../src/kernel/manifold.js';
import { Arena, buildPiece, EXPORT_TOL, polygonsToMesh } from '../src/library/build.js';
import { fieldOf } from '../src/library/field.js';
import { buildOp } from '../src/library/ops.js';
import { IDENTITY } from '../src/library/thicken.js';
import { METALS } from '../src/metals.js';
import { treeFromTemplate, type PieceTree, type TreeNode } from '../src/piece/tree.js';

/** The surface limit every casting file is held to (con:surface-deviation-tolerance). */
const LIMIT = 0.01;

const mm = (x: number) => `${x} mm`;
const P = (x: number, y: number, z: number) => [mm(x), mm(y), mm(z)];

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const moonstone = JSON.parse(readFileSync(`${ROOT}test/fixtures/moonstone-openwork-ring.tree.json`, 'utf8')) as PieceTree;

/** Blends whose fields have creases: a sweep's bends, a box's and a cylinder's edges. */
const CREASED: { name: string; node: TreeNode }[] = [
  {
    name: 'a wire bent 40 degrees at its peak',
    node: { id: 'wire', op: 'smooth_union', params: { radius: '0.4 mm' }, children: [{ id: 'w', op: 'sweep', params: { radius: '0.6 mm', path: [P(-3, 0, 0), P(0, 0, 1.1), P(3, 0, 0)] } }] },
  },
  {
    name: 'a box and a sphere',
    node: { id: 'blob', op: 'smooth_union', params: { radius: '0.4 mm' }, children: [
      { id: 'bx', op: 'box', params: { x: '3 mm', y: '1.5 mm', z: '1.2 mm' } },
      { id: 'sp', op: 'translate', params: { x: '2 mm' }, children: [{ id: 'spp', op: 'sphere', params: { radius: '0.9 mm' } }] },
    ] },
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
  },
  {
    name: "the moonstone ring's four wires (flo2.io's revision 3)",
    node: moonstone.root.children!.find((c) => c.op === 'smooth_union')!,
  },
];

/**
 * How far the blend's casting facets stand off its own surface: the largest |field| over every
 * facet of its level set, at its edges' quarter points and centroid, and, where those stand
 * off at all, on a grid of 45 points over the facet. Across a crease this is the distance
 * itself (outside a wire's bend the field is the exact distance to it; inside a box, to its
 * nearest face); where a blend's bridge between two shapes begins it is at most the distance,
 * and those points (a cone point of the surface, neither smooth nor a crease) are not what
 * this pins. And the blend alone, written as a casting file, is one closed solid that does
 * not pass through itself, as the casting check reads it: the refinement guards every split.
 */
async function standOff(node: TreeNode): Promise<{ worst: number; at: number[]; facets: number; watertight: string }> {
  const k = await kernel();
  const A = new Arena();
  try {
    const m = buildOp(k, A, node, EXPORT_TOL, { m: IDENTITY, sheets: [], blends: [] });
    const stl = writeBinaryStl(polygonsToMesh(m), 'blend');
    const w = runChecks(stl, { prongs: [], scale: 1 }, limitsFor(METALS.gold_14k_yellow), stl).entries.find((e) => e.id === 'watertight')!;
    const mesh = m.getMesh();
    const np = mesh.numProp, V = mesh.vertProperties, T = mesh.triVerts;
    const f = fieldOf(node);
    let worst = 0, at: number[] = [];
    const n = T.length / 3;
    const look = (x: number, y: number, z: number) => {
      const v = Math.abs(f(x, y, z));
      if (v > worst) ((worst = v), (at = [x, y, z]));
      return v;
    };
    for (let t = 0; t < n; t++) {
      const a = T[t * 3]! * np, b = T[t * 3 + 1]! * np, c = T[t * 3 + 2]! * np;
      const pt = (u: number, v: number): [number, number, number] => {
        const w = 1 - u - v;
        return [u * V[a]! + v * V[b]! + w * V[c]!, u * V[a + 1]! + v * V[b + 1]! + w * V[c + 1]!, u * V[a + 2]! + v * V[b + 2]! + w * V[c + 2]!];
      };
      let screen = look(...pt(1 / 3, 1 / 3));
      for (const s of [0.25, 0.5, 0.75]) screen = Math.max(screen, look(...pt(s, 1 - s)), look(...pt(0, s)), look(...pt(s, 0)));
      if (screen <= 0.002) continue;
      const N = 8;
      for (let i = 0; i <= N; i++) for (let j = 0; i + j <= N; j++) look(...pt(i / N, j / N));
    }
    return { worst, at, facets: n, watertight: w.result === 'pass' ? 'pass' : (w.measured ?? 'fail') };
  } finally {
    A.free();
  }
}

describe("a smooth blend's casting facets stand within the surface limit of the blend's own surface, creases included", () => {
  for (const { name, node } of CREASED) {
    it(`${name}: no point of any facet stands more than ${LIMIT} mm off the field's zero level`, { timeout: 300_000 }, async () => {
      const r = await standOff(node);
      assert.equal(r.watertight, 'pass', 'the blend, refined, is not one closed solid that keeps clear of itself');
      assert.ok(r.worst <= LIMIT, `a facet stands ${r.worst.toFixed(4)} mm off the blend's surface at [${r.at.map((v) => v.toFixed(3)).join(', ')}] (${r.facets} facets)`);
    });
  }
});

/** A US 7 plain band (1.6 mm thick, top of the band at z = 10.275 mm) with a blend standing on its top. */
function bandWith(node: TreeNode, z: number): PieceTree {
  const tree = treeFromTemplate('plain_band', { ring_size: { system: 'US', size: '7' }, name: node.id, band_thickness: '1.6 mm' });
  tree.root.children!.push({ id: 'on_top', op: 'translate', params: { x: '0 mm', y: '0 mm', z: mm(z) }, children: [node] });
  return tree;
}

describe('the casting check reads a creased blend within the limit', () => {
  for (const [name, node, z] of [
    ['a wire bent 40 degrees, standing on a band', CREASED[0]!.node, 10.2],
    ['a box and a sphere, standing on a band', CREASED[1]!.node, 10.6],
  ] as const) {
    it(name, { timeout: 120_000 }, async () => {
      const r = await checkPiece(bandWith(node, z), 'check');
      const s = r.entries.find((e) => e.id === 'surface_deviation')!;
      assert.equal(s.result, 'pass', `${s.measured} ${s.where?.description ?? ''}`);
      assert.ok(s.value! <= LIMIT, `${s.value} mm`);
      assert.equal(r.entries.find((e) => e.id === 'watertight')!.result, 'pass');
    });
  }
});

describe('the surface check names a place on a blend by the blend, not by the region round it', () => {
  it("a blend point under a bezel's outline is named as the blend's", { timeout: 120_000 }, async () => {
    const tree = bandWith(CREASED[0]!.node, 10.2);
    const built = await buildPiece(tree, { tol: EXPORT_TOL, applyShrinkage: true, blendSurface: true });
    const stl = writeBinaryStl(built.metal, 'x');
    const b = built.decl.blends![0]!;
    // Every declared point 0.03 mm up, so the worst place is on the blend; and a bezel whose
    // outline covers the whole piece, as the moonstone's covers its rails' peaks.
    const off = new Float32Array(b.points);
    for (let i = 2; i < off.length; i += 3) off[i] = off[i]! + 0.03;
    const decl = { ...built.decl, blends: [{ ...b, points: off }], bezel: { outer: [[-20, -20], [20, -20], [20, 20], [-20, 20]] as [number, number][], zBottom: 0, nominalWall: 1 } };
    const s = runChecks(stl, decl, limitsFor(METALS.gold_14k_yellow), stl).entries.find((e) => e.id === 'surface_deviation')!;
    assert.equal(s.result, 'fail', s.measured ?? '');
    assert.equal(s.where?.part, 'blend', JSON.stringify(s.where));
    assert.equal(s.where?.feature, 'wire');
    assert.match(s.where!.description, /on the smooth blend "wire"/);
  });
});
