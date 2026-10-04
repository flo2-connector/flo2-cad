// The checker reads the SHAPE, not what touches it and not how it was cut into
// triangles. Two defects found by a real chat on 2026-10-03, each pinned here by a
// test that failed on main (a64b445) before the fix:
//
//  · fact:band-check-measures-added-shapes-as-band. A plain band with a pedestal and a
//    cup added over the top, all through the published tree operations, read 0.78 mm
//    on a 1.7 mm band; changing only the pedestal moved the reading, and following the
//    advice to thicken the band made it worse (0.69 mm at 2.0 mm). Cause, measured: the
//    band's sections were cut through a window round the band, so wherever other metal
//    joined it the window cut the outline open (2 open ends at every such section) and
//    the inside-or-outside test went wrong. The whole section, clipped to the band's own
//    declared section afterwards, reads 1.700 mm there.
//
//  · fact:wall-check-reads-sliver-facets-as-zero-thickness. Slivers 0.002 mm below the
//    90-degree rim of a 1.0 mm plate, every corner on the true surface, read 0.001 mm at
//    three mesh densities, somewhere different each time. Cause, measured: each sliver's
//    own normal leans 33-68 degrees (its long edge is a chord of the curve), which made
//    the rim look sharper than the 105-degree test that tells a wall's far side from a
//    corner. Tightening that test only moves the line (135 degrees fixed the 0.2 mm mesh
//    and not the others); giving each sliver the direction of the surface it was cut from
//    reads 0.999 / 0.95 / 0.998 mm, as the same plate without slivers does.
//
// A genuinely thin band under an ornament, and a genuinely thin plate with slivers, are
// still refused.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runChecks, type CheckEntry } from '../src/checker/check.js';
import { checkPiece, limitsFor } from '../src/engine.js';
import { writeBinaryStl } from '../src/files/stl.js';
import { METALS } from '../src/metals.js';
import { applySet, readPiece, treeFromTemplate, type PieceTree } from '../src/piece/tree.js';

// ------------------------------------------------------------- the band

/** A US 7 half-round band (2.6 mm wide, 14k) with a pedestal and a trumpet cup added over its top, through tree operations. */
function bandWithOrnament(bandThickness: string, pedestalRadius = '2.6 mm', ornamentFromMm?: number): { tree: PieceTree; base: number } {
  const tree = treeFromTemplate('plain_band', {
    ring_size: { system: 'US', size: '7' },
    name: 'ornament',
    band_profile: 'half_round',
    band_width: '2.6 mm',
    band_thickness: bandThickness,
    metal: 'gold_14k_yellow',
  });
  const v = readPiece(tree);
  // The pedestal sinks into the band's top below its domed edges (0.8 mm, or to 0.3 mm short of the finger on a thin band), so it overhangs no crevice.
  const base = ornamentFromMm ?? v.innerDiameterMm / 2 + v.bandThicknessMm - Math.min(0.8, v.bandThicknessMm - 0.3);
  const top = base + 2.4;
  tree.root.children!.push(
    { id: 'pedestal', op: 'translate', params: { z: `${base} mm` }, children: [{ id: 'ped', op: 'cylinder', params: { radius: pedestalRadius, height: '2.4 mm' } }] },
    {
      id: 'cup',
      op: 'translate',
      params: { z: `${top - 0.2} mm` },
      children: [{ id: 'cupr', op: 'revolve', params: { points: [['1.0 mm', '0 mm'], ['2.4 mm', '0 mm'], ['2.4 mm', '1.6 mm'], ['1.4 mm', '1.6 mm']] } }],
    },
  );
  return { tree, base };
}

const entry = (entries: CheckEntry[], id: CheckEntry['id']) => entries.find((e) => e.id === id)!;

describe('the band check measures the band, not what is added over it', () => {
  for (const radius of ['2.6 mm', '1.8 mm']) {
    it(`a 1.7 mm band under a pedestal (radius ${radius}) and a cup reads 1.7 mm, and the piece passes`, async () => {
      const r = await checkPiece(bandWithOrnament('1.7 mm', radius).tree, 'check');
      const band = entry(r.entries, 'band');
      assert.equal(band.result, 'pass', `band ${band.measured} at ${band.where?.feature}`);
      assert.ok(Math.abs(band.value! - 1.7) < 0.01, `band ${band.value}`);
      assert.deepEqual(
        r.entries.filter((e) => e.result !== 'pass').map((e) => `${e.id}: ${e.measured}`),
        [],
      );
    });
  }
  it('a too-thin band (0.8 mm) under the same ornament is still refused, and its advice converges', async () => {
    const { tree, base } = bandWithOrnament('0.8 mm');
    const r = await checkPiece(tree, 'check');
    const band = entry(r.entries, 'band');
    assert.equal(band.result, 'fail');
    assert.ok(Math.abs(band.value! - 0.8) < 0.01, `band ${band.value}`);
    const advice = r.entries.find((e) => e.id === 'band')!.fix;
    assert.ok(advice && /Thicken the band/.test(advice), r.fixes.join(' | '));
    const suggested = /"band_thickness": "([\d.]+) mm"/.exec(advice!)?.[1];
    assert.ok(suggested, advice);
    // Follow the advice, leaving the ornament where it was: the band now reads what it was set to.
    const followed = applySet(tree, { band_thickness: `${suggested} mm` }).tree;
    assert.equal(followed.root.children!.find((c) => c.id === 'pedestal')!.params!['z'], `${base} mm`);
    const again = entry((await checkPiece(followed, 'check')).entries, 'band');
    assert.equal(again.result, 'pass', `band ${again.measured}`);
    assert.ok(Math.abs(again.value! - Number(suggested)) < 0.01, `band ${again.value} after setting ${suggested} mm`);
  });
});

// ------------------------------------------------------------- the walls

/**
 * A curved plate of known thickness: a segment of a thick cylindrical shell (inner
 * radius 3 mm, a 90° arc, 4 mm long), closed, with flat 90° rims and every vertex ON
 * the true surfaces. `seam` cuts slivers into the outer face the way a boolean seam
 * leaves them, their long edges chords of the curve, so each leans by
 * atan(sagitta / eps):
 *  · 'rim': a seam eps below the top rim, the slivers leaning away from the rim;
 *  · 'middle': two rows fanned from points eps either side of a grid line, so slivers
 *    meet along it leaning opposite ways.
 */
function curvedPlate(thick: number, step: number, seam: 'none' | 'rim' | 'middle', eps = 0.002): { positions: Float32Array; triangles: Uint32Array } {
  const pos: number[] = [], tri: number[] = [];
  const rIn = 3, rOut = rIn + thick, span = Math.PI / 2, len = 4;
  const nA = Math.round((span * rOut) / step), nZ = Math.round(len / step);
  const a0 = -span / 2, da = span / nA;
  const ang = (i: number) => a0 + i * da;
  const zs = Array.from({ length: nZ + 1 }, (_, j) => -len / 2 + (len * j) / nZ);
  const index = new Map<string, number>();
  const V = (r: number, a: number, z: number) => {
    const p = [r * Math.cos(a), r * Math.sin(a), z];
    const k = p.map((x) => Math.fround(x)).join(',');
    let i = index.get(k);
    if (i === undefined) {
      i = pos.length / 3;
      index.set(k, i);
      pos.push(...p);
    }
    return i;
  };
  const at = (i: number) => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
  // Wind each triangle so its normal points the way `want` says (outward).
  const face = (a: number, b: number, c: number, want: number[]) => {
    const A = at(a), B = at(b), C = at(c);
    const u = [B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!], v = [C[0]! - A[0]!, C[1]! - A[1]!, C[2]! - A[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    if (n[0]! * want[0]! + n[1]! * want[1]! + n[2]! * want[2]! >= 0) tri.push(a, b, c);
    else tri.push(a, c, b);
  };
  const poly = (vs: number[], want: number[]) => {
    for (let k = 1; k + 1 < vs.length; k++) face(vs[0]!, vs[k]!, vs[k + 1]!, want);
  };
  const O = (i: number, j: number) => V(rOut, ang(i), zs[j]!), I = (i: number, j: number) => V(rIn, ang(i), zs[j]!);
  const S = (i: number) => V(rOut, ang(i), zs[nZ]! - eps), M = (i: number) => V(rOut, ang(i + 0.5), zs[nZ]!);
  const mid = Math.floor(nZ / 2);
  for (let j = 0; j < nZ; j++) {
    for (let i = 0; i < nA; i++) {
      const w = [Math.cos(ang(i + 0.5)), Math.sin(ang(i + 0.5)), 0];
      if (seam === 'rim' && j === nZ - 1) {
        poly([O(i, j), O(i + 1, j), S(i + 1), S(i)], w);
        face(S(i), S(i + 1), M(i), w); // the sliver: a chord below, its apex on the rim
        face(S(i), M(i), O(i, nZ), w);
        face(S(i + 1), O(i + 1, nZ), M(i), w);
      } else if (seam === 'middle' && (j === mid || j === mid - 1)) {
        const F = V(rOut, ang(i + 0.5), j === mid ? zs[mid]! + eps : zs[mid]! - eps);
        face(O(i, j), O(i + 1, j), F, w);
        face(O(i + 1, j), O(i + 1, j + 1), F, w);
        face(O(i + 1, j + 1), O(i, j + 1), F, w);
        face(O(i, j + 1), O(i, j), F, w);
      } else poly([O(i, j), O(i + 1, j), O(i + 1, j + 1), O(i, j + 1)], w);
      poly([I(i, j), I(i + 1, j), I(i + 1, j + 1), I(i, j + 1)], w.map((x) => -x));
    }
  }
  for (let i = 0; i < nA; i++) {
    poly([O(i, 0), O(i + 1, 0), I(i + 1, 0), I(i, 0)], [0, 0, -1]);
    if (seam === 'rim') {
      face(O(i, nZ), M(i), I(i, nZ), [0, 0, 1]);
      face(M(i), O(i + 1, nZ), I(i + 1, nZ), [0, 0, 1]);
      face(M(i), I(i + 1, nZ), I(i, nZ), [0, 0, 1]);
    } else poly([O(i, nZ), O(i + 1, nZ), I(i + 1, nZ), I(i, nZ)], [0, 0, 1]);
  }
  const ends: [number, number[]][] = [
    [0, [Math.sin(a0), -Math.cos(a0), 0]],
    [nA, [-Math.sin(ang(nA)), Math.cos(ang(nA)), 0]],
  ];
  for (const [i, want] of ends) {
    for (let j = 0; j < nZ; j++) {
      if (seam === 'rim' && j === nZ - 1) poly([I(i, nZ), I(i, j), O(i, j), S(i), O(i, nZ)], want);
      else poly([O(i, j), O(i, j + 1), I(i, j + 1), I(i, j)], want);
    }
  }
  return { positions: Float32Array.from(pos), triangles: Uint32Array.from(tri) };
}

function checkPlate(thick: number, step: number, seam: 'none' | 'rim' | 'middle', eps?: number): CheckEntry[] {
  const stl = writeBinaryStl(curvedPlate(thick, step, seam, eps), 'plate');
  return runChecks(stl, { prongs: [], scale: 1 }, limitsFor(METALS.gold_14k_yellow), stl).entries;
}

describe('thickness and gaps read the shape, not how it was cut into triangles', () => {
  for (const step of [0.2, 0.3, 0.4]) {
    it(`a 1.0 mm plate with slivers beside its rim reads as the same plate without them (mesh ${step} mm)`, () => {
      const plain = checkPlate(1.0, step, 'none');
      const slivers = checkPlate(1.0, step, 'rim');
      assert.equal(entry(slivers, 'watertight').result, 'pass', entry(slivers, 'watertight').measured ?? '');
      for (const id of ['wall', 'detail'] as const) {
        const want = entry(plain, id), got = entry(slivers, id);
        assert.equal(got.result, 'pass', `${id} ${got.measured} at ${JSON.stringify(got.where?.point_mm)}`);
        assert.ok(Math.abs(got.value! - want.value!) < 0.005, `${id}: ${got.value} with slivers, ${want.value} without`);
        assert.ok(got.value! > 0.9, `${id} ${got.value}`);
      }
    });
    it(`slivers leaning opposite ways along a seam are not two walls 0.001 mm apart (mesh ${step} mm)`, () => {
      const got = checkPlate(1.0, step, 'middle', 0.001);
      assert.equal(entry(got, 'watertight').result, 'pass');
      const gap = entry(got, 'gap');
      assert.equal(gap.result, 'pass', `gap ${gap.measured} at ${JSON.stringify(gap.where?.point_mm)}`);
      assert.equal(entry(got, 'wall').result, 'pass', `wall ${entry(got, 'wall').measured}`);
    });
    it(`a too-thin 0.6 mm plate with the same slivers is still refused at 0.6 mm (mesh ${step} mm)`, () => {
      const wall = entry(checkPlate(0.6, step, 'rim'), 'wall');
      assert.equal(wall.result, 'fail');
      assert.ok(Math.abs(wall.value! - 0.6) < 0.01, `wall ${wall.value}`);
    });
  }
});
