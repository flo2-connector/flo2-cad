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
//  · fact:wall-check-reads-overhang-beside-band-edge (found 2026-10-04, pinned by tests
//    that failed on main d513ba8). A pedestal added over a 1.7 mm band and overhanging its
//    flat sides read as a 0.80 mm wall "on the band", with advice to raise band_thickness.
//    Cause, measured: the ball beside the band's edge was stopped at a corner where the
//    pedestal's underside meets the band's side, a corner it reached from the side (59
//    degrees), because the 105-degree test judged the underside's whole triangle (134
//    degrees) rather than the direction the ball met it from. And the advice named the
//    band because anything within 0.3 mm of the band's envelope was labelled band.
//
//  · fact:wall-ball-stopped-at-a-crease-it-reached-through-a-face (found 2026-10-04, pinned
//    by tests that failed on main 75d8a1a). A solitaire with a 1.2 mm ball added beside its
//    head was refused at 0.728 mm, with advice to thicken the ball. Cause, measured: a ball on
//    the rail's top 0.01 mm from the rail's outer edge grew straight down, out through the
//    rail's outer wall (a convex edge's neighbour, rightly ignored), and was stopped at the
//    crease where the added ball's underside meets that wall. The crease was met from
//    straight across (177 degrees), so the rule above let it count, but the ball had passed
//    through the wall to reach it: the wall lay 0.01 mm from the ball's centre, the crease
//    0.36 mm. Under the rail are 2.79 mm of metal, and the reading wandered 0.61-0.73 mm with
//    the tessellation. An edge or corner now stops the ball only if the ball meets it
//    square-on: no face that meets there lies nearer the ball's centre.
//
// A genuinely thin band under an ornament, a genuinely thin plate with slivers, a
// genuinely thin overhang and a thin tab off the rail are still refused, the overhang and
// the tab naming the added shape.

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

// ------------------------------------------------- shapes beside the band

/**
 * A US 7 half-round band (2.6 mm wide, 1.7 mm thick, 14k) with one added shape over
 * its top. `pedestal`: a cylinder 2.4 mm tall, sunk `sinkMm` into the band's top, so
 * where it is wider than the band its underside overhangs the band's flat sides.
 * `flange`: a plate `thick` mm thick, sunk so its underside sits 0.9 mm above the
 * finger, wider than the band by `overhang` mm on each side: a genuinely thin overhang.
 */
function bandWith(shape: { pedestal: { radius: number; sinkMm: number } } | { flange: { thick: number; overhang: number } } | null): PieceTree {
  const tree = treeFromTemplate('plain_band', {
    ring_size: { system: 'US', size: '7' },
    name: 'beside',
    band_profile: 'half_round',
    band_width: '2.6 mm',
    band_thickness: '1.7 mm',
    metal: 'gold_14k_yellow',
  });
  const v = readPiece(tree);
  const rIn = v.innerDiameterMm / 2, rOut = rIn + v.bandThicknessMm;
  if (shape && 'pedestal' in shape) {
    const { radius, sinkMm } = shape.pedestal;
    tree.root.children!.push({ id: 'pedestal', op: 'translate', params: { z: `${rOut - sinkMm} mm` }, children: [{ id: 'ped', op: 'cylinder', params: { radius: `${radius} mm`, height: '2.4 mm' } }] });
  } else if (shape) {
    const { thick, overhang } = shape.flange;
    tree.root.children!.push({
      id: 'flange',
      op: 'translate',
      params: { z: `${rIn + 0.9 + thick / 2} mm` },
      children: [{ id: 'plate', op: 'box', params: { x: '3 mm', y: `${v.bandWidthMm + 2 * overhang} mm`, z: `${thick} mm` } }],
    });
  }
  return tree;
}

describe('a shape added over the band and overhanging its sides', () => {
  // fact:wall-check-reads-overhang-beside-band-edge, measured on main d513ba8: with the
  // pedestal sunk 1.0 mm the wall read 0.799 mm "on the band, 346 deg" and the advice was to
  // raise band_thickness, on metal that reads 1.56 mm without the pedestal. The thinnest
  // sample sits on the band's dome 0.11 mm from its edge, leaning 46 degrees towards the
  // band's flat side. Its ball is held by that flat side (a convex edge's neighbour, which the
  // 105-degree test rightly ignores), and was stopped at the one point of it where the
  // pedestal's underside meets it: the corner (-2.25, -1.30, 9.36). The underside's triangles
  // face 134.5 degrees away, so they counted, though the ball met them only at that corner,
  // from 58.7 degrees, from the side and not from across the metal. Without the 105-degree
  // test the same sample reads 0.46 mm: the edge itself. Every combination below read
  // 0.80-0.90 mm on main; none of them adds any metal thinner than the band's own.
  for (const [radius, sinkMm] of [
    [2.6, 1.0],
    [2.6, 1.06],
    [2.2, 1.0],
    [3.0, 1.06],
  ] as const) {
    it(`a pedestal (radius ${radius} mm, sunk ${sinkMm} mm) reads as the band does without it, and no advice touches the band`, async () => {
      const plain = entry((await checkPiece(bandWith(null), 'check')).entries, 'wall');
      const r = await checkPiece(bandWith({ pedestal: { radius, sinkMm } }), 'check');
      const wall = entry(r.entries, 'wall');
      assert.equal(wall.result, 'pass', `wall ${wall.measured} at ${wall.where?.description}`);
      assert.ok(wall.value! > plain.value! - 0.03, `wall ${wall.value} at ${wall.where?.description}; the band alone reads ${plain.value}`);
      assert.deepEqual(r.fixes, []);
    });
  }

  it('a genuinely thin overhang (0.5 mm) is refused at 0.5 mm, and the advice names the added shape, not the band', async () => {
    const r = await checkPiece(bandWith({ flange: { thick: 0.5, overhang: 1.0 } }), 'check');
    const wall = entry(r.entries, 'wall');
    assert.equal(wall.result, 'fail');
    assert.ok(Math.abs(wall.value! - 0.5) < 0.01, `wall ${wall.value}`);
    assert.equal(wall.where?.part, 'added shape', JSON.stringify(wall.where));
    assert.equal(wall.where?.feature, 'flange');
    const advice = r.entries.find((e) => e.id === 'wall')!.fix!;
    assert.match(advice, /"flange"/);
    assert.doesNotMatch(advice, /Raise band_thickness|Thicken the band/);
    assert.equal(entry(r.entries, 'band').result, 'pass');
  });

  it('a thin overhang only 0.25 mm past the band\'s side is the added shape\'s too, not the band\'s', async () => {
    const r = await checkPiece(bandWith({ flange: { thick: 0.5, overhang: 0.25 } }), 'check');
    const wall = entry(r.entries, 'wall');
    assert.equal(wall.result, 'fail', `wall ${wall.measured} at ${wall.where?.description}`);
    assert.equal(wall.where?.part, 'added shape', JSON.stringify(wall.where));
    assert.doesNotMatch(r.entries.find((e) => e.id === 'wall')!.fix!, /Raise band_thickness|Thicken the band/);
  });

  it('a 1.0 mm overhang reads 1.0 mm, not the corner where it meets the band\'s side', async () => {
    // Main read 0.894 mm "on the band, 9 deg" here: the same corner, met from the side.
    const r = await checkPiece(bandWith({ flange: { thick: 1.0, overhang: 1.0 } }), 'check');
    const wall = entry(r.entries, 'wall');
    assert.equal(wall.result, 'pass', `wall ${wall.measured} at ${wall.where?.description}`);
    assert.ok(Math.abs(wall.value! - 1.0) < 0.01, `wall ${wall.value} at ${wall.where?.description}`);
    assert.deepEqual(r.fixes, []);
  });
});

// -------------------------------------------- a shape added beside other metal's edge

/**
 * A US 7 solitaire (14k) with one added shape, placed relative to the band's top: the
 * solitaire's head stands on a rail, a flat ring through the prongs' feet whose top lies
 * 0.09 mm above the band's top.
 */
function solitaireWith(extra: ((top: number) => PieceTree['root']['children']) | null): PieceTree {
  const tree = treeFromTemplate('solitaire_ring', { ring_size: { system: 'US', size: '7' }, name: 'beside', metal: 'gold_14k_yellow' });
  const v = readPiece(tree);
  if (extra) tree.root.children!.push(...extra(v.innerDiameterMm / 2 + v.bandThicknessMm)!);
  return tree;
}

/**
 * The same thing away from the library's head: a 1.5 mm block on the half-round band of
 * bandWith, and, when asked, a 1.2 mm ball whose centre lies `inset` mm inside the block's
 * side and whose top stands `above` mm above the block's top, so it bulges out of both.
 */
function blockWith(ball: { inset: number; above: number } | null): PieceTree {
  const tree = bandWith(null);
  const v = readPiece(tree);
  const top = v.innerDiameterMm / 2 + v.bandThicknessMm + 0.9;
  tree.root.children!.push({ id: 'block', op: 'translate', params: { z: `${top - 0.75} mm` }, children: [{ id: 'blk', op: 'box', params: { x: '3 mm', y: '3 mm', z: '1.5 mm' } }] });
  if (ball) {
    tree.root.children!.push({
      id: 'knob',
      op: 'translate',
      params: { x: `${1.5 - ball.inset} mm`, z: `${top + ball.above - 1.2} mm` },
      children: [{ id: 'kb', op: 'sphere', params: { radius: '1.2 mm' } }],
    });
  }
  return tree;
}

describe('a shape added beside the edge of other metal', () => {
  // fact:wall-check-reads-rail-top-beside-added-ball, measured on main 75d8a1a: the wall read
  // 0.728 mm "in the added shape side", refused, with advice to thicken the ball. The thinnest
  // sample is on the rail's flat top where the ball comes up through it, 0.01 mm inside the
  // rail's outer wall. Its ball grew straight down, out through that wall (90 degrees from its
  // direction, a convex edge's neighbour, rightly ignored), and was stopped 0.364 mm down at
  // the crease where the added ball's underside (a facet 109.7 degrees away) meets the wall.
  // The crease lies straight across (177 degrees), so the direction rule counted it, but the
  // wall it passed through lay 0.0102 mm from the ball's centre: the ball reached the crease
  // from outside the metal. Straight down from the sample are 2.79 mm of rail and band. At
  // five tessellations (0.0025-0.008 mm) main read 0.61-0.73 mm, somewhere different each time.
  it('a solitaire with a 1.2 mm ball beside its head reads as the solitaire does without it, and is not refused', async () => {
    const plain = entry((await checkPiece(solitaireWith(null), 'check')).entries, 'wall');
    const r = await checkPiece(
      solitaireWith((top) => [{ id: 'side', op: 'translate', params: { x: '4 mm', z: `${top - 0.3} mm` }, children: [{ id: 'ball', op: 'sphere', params: { radius: '1.2 mm' } }] }]),
      'check',
    );
    const wall = entry(r.entries, 'wall');
    assert.equal(wall.result, 'pass', `wall ${wall.measured} at ${wall.where?.description}`);
    assert.ok(wall.value! > plain.value! - 0.03, `wall ${wall.value} at ${wall.where?.description}; the solitaire alone reads ${plain.value}`);
    assert.deepEqual(r.fixes, []);
  });

  // The same mechanism with no library head: main read 0.810 / 0.866 / 1.022 / 0.961 mm here,
  // on the block's top beside the ball, where the block alone reads 1.499 mm.
  for (const [inset, above] of [
    [0.6, 0.81],
    [0.5, 0.6],
    [0.7, 1.0],
    [0.6, 0.4],
  ] as const) {
    it(`a ball bulging out of a block's side and top (centre ${inset} mm inside the side, top ${above} mm above) reads as the block does without it`, async () => {
      const plain = entry((await checkPiece(blockWith(null), 'check')).entries, 'wall');
      const wall = entry((await checkPiece(blockWith({ inset, above }), 'check')).entries, 'wall');
      assert.ok(wall.value! > plain.value! - 0.03, `wall ${wall.value} at ${wall.where?.description}; the block alone reads ${plain.value}`);
    });
  }

  // The library's own head did it too. On main the plain solitaire read 1.163 mm "on the band,
  // 27 deg": a ball on the band's inner edge passed out through the band's flat side and the
  // rail's underside (both ignored, 0.31 and 0.55 mm from its centre) and was stopped at the
  // corner where the rail's outer wall meets them, 0.58 mm away. The same band without the head
  // read 1.304 mm.
  it("the plain solitaire's thinnest wall reads as its band does without the head, not the corner where the rail meets the band's side", async () => {
    const head = entry((await checkPiece(solitaireWith(null), 'check')).entries, 'wall');
    const band = entry((await checkPiece(treeFromTemplate('plain_band', { ring_size: { system: 'US', size: '7' }, name: 'same band' }), 'check')).entries, 'wall');
    assert.ok(head.value! > band.value! - 0.05, `the solitaire reads ${head.value} at ${head.where?.description}; its band alone reads ${band.value}`);
  });

  // Genuinely thin metal beside the same edge is still refused, at its own thickness and in its
  // own name. Main read this 0.5 mm tab at 0.479 mm, thinner than it is, on the rail's top beside
  // it: the same crease, reached through the rail's wall.
  it('a genuinely thin 0.5 mm tab off the rail is refused at 0.5 mm, and the advice names the tab', async () => {
    const r = await checkPiece(
      solitaireWith((top) => [{ id: 'tab', op: 'translate', params: { x: '5 mm', z: `${top - 0.1} mm` }, children: [{ id: 'tb', op: 'box', params: { x: '2 mm', y: '2 mm', z: '0.5 mm' } }] }]),
      'check',
    );
    const wall = entry(r.entries, 'wall');
    assert.equal(wall.result, 'fail');
    assert.ok(Math.abs(wall.value! - 0.5) < 0.01, `wall ${wall.value} at ${wall.where?.description}`);
    assert.equal(wall.where?.part, 'added shape', JSON.stringify(wall.where));
    assert.equal(wall.where?.feature, 'tab');
    assert.match(r.entries.find((e) => e.id === 'wall')!.fix!, /"tab"/);
  });
});
