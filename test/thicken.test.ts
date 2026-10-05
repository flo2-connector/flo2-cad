// THE THICKEN OPERATION (cap:thicken-a-curved-sheet-in-the-tree), proved as
// ver:a-thickened-cupped-petal-is-one-solid-the-checker-reads describes it:
//  · a cupped petal, given a stated thickness along its surface, evaluates to ONE
//    closed solid with no self-intersection, its edges square to the surface;
//  · the wall check reads it at the stated thickness, not near zero at its edges,
//    and the sheet check reads each sheet square to its surface where it declared
//    itself;
//  · a too-thin petal is refused with what to thicken (the petal, by its id), and
//    following the advice clears it;
//  · a 5-petal cupped flower joined to a band passes every casting check and
//    exports.
// The flower is the motivating piece: the first hibiscus ring could only use flat
// petals tilted 25° (dec:idea-thin-curved-sheet-forms-in-the-tree).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { SheetDecl } from '../src/checker/features.js';
import { runChecks, type CheckEntry } from '../src/checker/check.js';
import { checkPiece, limitsFor } from '../src/engine.js';
import { CallError } from '../src/errors.js';
import { writeBinaryStl } from '../src/files/stl.js';
import { kernel } from '../src/kernel/manifold.js';
import { Arena, buildPiece, EXPORT_TOL, polygonsToMesh, PREVIEW_TOL, REFERENCE_TOL } from '../src/library/build.js';
import { buildOp } from '../src/library/ops.js';
import { IDENTITY } from '../src/library/thicken.js';
import { METALS } from '../src/metals.js';
import { applySet, readPiece, treeFromTemplate, validateTree, type PieceTree, type TreeNode } from '../src/piece/tree.js';

const mm = (x: number) => `${Math.round(x * 1000) / 1000} mm`;
const entry = (entries: CheckEntry[], id: CheckEntry['id']) => entries.find((e) => e.id === id)!;
const SILVER = limitsFor(METALS.sterling_silver_925);

/** An oval leaf or petal laid flat, centred on (0, cy): wide everywhere, so its narrowest metal is its thickness. */
function oval(a: number, b: number, cy = 0, n = 48): string[][] {
  return Array.from({ length: n }, (_, i) => {
    const u = (2 * Math.PI * i) / n;
    return [mm(a * Math.cos(u)), mm(cy + b * Math.sin(u))];
  });
}

/** A petal laid flat: its base on the origin, its tip along +y, widest at 60 % of its length, narrow at the base. */
function petal(len: number, width: number, base: number, n = 24): string[][] {
  const right: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const rise = Math.sin(Math.min(Math.PI / 2, (Math.PI / 2) * (s / 0.6)));
    const fall = s > 0.6 ? Math.sqrt(Math.max(0, 1 - ((s - 0.6) / 0.4) ** 2)) : 1;
    right.push([base / 2 + (width / 2 - base / 2) * rise * fall, len * s]);
  }
  const left = right.slice().reverse().map(([x, y]) => [-x, y] as [number, number]);
  return [...right, ...left].map(([x, y]) => [mm(x), mm(y)]);
}

/** One node built alone, as an export would, with its declarations and a reference tessellation for the surface check. */
async function buildAlone(node: TreeNode, tol = EXPORT_TOL) {
  const k = await kernel();
  const A = new Arena();
  try {
    const sheets: SheetDecl[] = [];
    const solid = buildOp(k, A, node, tol, { m: IDENTITY, sheets });
    const mesh = polygonsToMesh(solid);
    const ref = polygonsToMesh(buildOp(k, A, node, REFERENCE_TOL));
    return { mesh, sheets, stl: writeBinaryStl(mesh, 'x'), ref: writeBinaryStl(ref, 'ref'), genus: solid.genus(), status: solid.status() };
  } finally {
    A.free();
  }
}

async function checkAlone(node: TreeNode) {
  const b = await buildAlone(node);
  return { ...b, run: runChecks(b.stl, { prongs: [], scale: 1, sheets: b.sheets }, SILVER, b.ref) };
}

const thicken = (id: string, params: Record<string, unknown>): TreeNode => ({ id, op: 'thicken', params });

// ------------------------------------------------------------- one solid

describe('a thickened sheet is one closed solid, its edges square to its surface', () => {
  const cases: { name: string; node: TreeNode; centre: (p: number[]) => number[] }[] = [
    {
      name: 'a cupped petal (sphere, radius 7 mm)',
      node: thicken('cup', { outline: oval(2.5, 4, 3.5), thickness: '1.0 mm', surface: 'sphere', radius: '7 mm' }),
      centre: () => [0, 0, 7],
    },
    {
      name: 'a deep 0.9 mm cup reaching 77° round a 4.5 mm sphere, as tight as the tree allows (radius 5 × thickness)',
      node: thicken('deep', { outline: oval(6, 6), thickness: '0.9 mm', surface: 'sphere', radius: '4.5 mm' }),
      centre: () => [0, 0, 4.5],
    },
    {
      name: 'a petal curled along its length (cylinder round x, radius 5 mm)',
      node: thicken('curl', { outline: oval(2, 4, 3), thickness: '0.9 mm', surface: 'cylinder', radius: '5 mm', axis: 'x' }),
      centre: (p) => [p[0]!, 0, 5],
    },
    {
      name: 'a fluted petal (a channel along it: cylinder round y, radius 4.5 mm)',
      node: thicken('flute', { outline: oval(2, 4, 3), thickness: '0.9 mm', surface: 'cylinder', radius: '4.5 mm', axis: 'y' }),
      centre: (p) => [0, p[1]!, 4.5],
    },
  ];
  for (const c of cases) {
    it(`${c.name}: one shell, no self-intersection, read at its stated thickness everywhere, edges included`, async () => {
      const { run, sheets, mesh, status, genus } = await checkAlone(c.node);
      const t = Number(String(c.node.params!['thickness']).split(' ')[0]);
      assert.equal(status, 'NoError');
      assert.equal(genus, 0);
      const w = entry(run.entries, 'watertight');
      assert.equal(w.result, 'pass', w.measured ?? '');
      assert.equal(run.mesh.shells, 1);
      // The wall check measures every triangle, the rim and the faces beside it included: nowhere near zero.
      const wall = entry(run.entries, 'wall');
      assert.ok(Math.abs(wall.value! - t) < 0.01, `wall ${wall.value} on a ${t} mm sheet, at ${wall.where?.description}`);
      assert.equal(wall.where?.part, 'sheet');
      // The sheet check reads it square to the surface where it declared itself, a row just inside its edge included.
      const sheet = entry(run.entries, 'sheet');
      assert.equal(sheet.result, 'pass', sheet.measured ?? '');
      assert.ok(Math.abs(sheet.value! - t) < 0.01, `sheet ${sheet.value} on a ${t} mm sheet`);
      assert.equal(sheets.length, 1);
      assert.equal(sheets[0]!.nominalThickness, t);
      assert.ok(sheets[0]!.points.length > 100, `${sheets[0]!.points.length} declared points`);
      assert.equal(entry(run.entries, 'surface_deviation').result, 'pass', entry(run.entries, 'surface_deviation').measured ?? '');
      // Square to the surface: every face triangle lies on one of the two offset surfaces (within its chord), and
      // every rim triangle contains the normal there (the line through the centre of curvature): no knife edge.
      const P = mesh.positions, T = mesh.triangles;
      let rim = 0, worstLean = 0;
      for (let i = 0; i < T.length / 3; i++) {
        const v = [0, 1, 2].map((j) => [P[T[i * 3 + j]! * 3]!, P[T[i * 3 + j]! * 3 + 1]!, P[T[i * 3 + j]! * 3 + 2]!]);
        const rs = v.map((p) => {
          const o = c.centre(p);
          return Math.hypot(p[0]! - o[0]!, p[1]! - o[1]!, p[2]! - o[2]!);
        });
        if (Math.max(...rs) - Math.min(...rs) < 0.1 * t) continue;
        const u = [v[1]![0]! - v[0]![0]!, v[1]![1]! - v[0]![1]!, v[1]![2]! - v[0]![2]!], w2 = [v[2]![0]! - v[0]![0]!, v[2]![1]! - v[0]![1]!, v[2]![2]! - v[0]![2]!];
        const n = [u[1]! * w2[2]! - u[2]! * w2[1]!, u[2]! * w2[0]! - u[0]! * w2[2]!, u[0]! * w2[1]! - u[1]! * w2[0]!];
        const area2 = Math.hypot(n[0]!, n[1]!, n[2]!);
        if (area2 < 1e-3) continue; // too small for float32 corners to give a direction
        rim++;
        const g = [0, 1, 2].map((k) => (v[0]![k]! + v[1]![k]! + v[2]![k]!) / 3);
        const o = c.centre(g);
        const radial = [g[0]! - o[0]!, g[1]! - o[1]!, g[2]! - o[2]!];
        const rl = Math.hypot(radial[0]!, radial[1]!, radial[2]!);
        worstLean = Math.max(worstLean, Math.abs((n[0]! * radial[0]! + n[1]! * radial[1]! + n[2]! * radial[2]!) / (area2 * rl)));
      }
      assert.ok(rim > 20, `${rim} rim triangles`);
      // The rim's lean from the surface's normal (the sine of the angle): under 1° anywhere.
      assert.ok(worstLean < Math.sin(Math.PI / 180), `a rim facet leans ${((Math.asin(worstLean) * 180) / Math.PI).toFixed(2)}° from the normal`);
    });
  }

  it('a flat sheet is a plain plate of its thickness, centred on z = 0', async () => {
    const { run, mesh } = await checkAlone(thicken('leaf', { outline: oval(3, 2), thickness: '0.8 mm' }));
    assert.equal(entry(run.entries, 'watertight').result, 'pass');
    assert.ok(Math.abs(entry(run.entries, 'sheet').value! - 0.8) < 0.005);
    const zs = Array.from({ length: mesh.positions.length / 3 }, (_, i) => mesh.positions[i * 3 + 2]!);
    // Each face 0.4 mm from the middle, moved out by the float32 allowance alone (about 1e-6 mm here), never in.
    const lo = Math.min(...zs), hi = Math.max(...zs);
    assert.ok(lo <= -0.4 && lo > -0.4 - 1e-5 && hi >= 0.4 && hi < 0.4 + 1e-5, `the faces lie at ${lo} and ${hi} mm`);
    assert.ok(Math.abs(lo + hi) < 1e-7, `the faces lie at ${lo} and ${hi} mm`);
  });

  it('the same tree builds the same mesh, every time', async () => {
    const node = thicken('again', { outline: petal(7, 4.4, 1.2), thickness: '1.0 mm', surface: 'sphere', radius: '7 mm', round_corners: '0.5 mm' });
    const a = await buildAlone(node), b = await buildAlone(node);
    assert.deepEqual(Buffer.from(a.stl), Buffer.from(b.stl));
  });

  it('declares itself where it was placed: turned, mirrored and moved, it still reads its own thickness', async () => {
    const node: TreeNode = {
      id: 'moved',
      op: 'translate',
      params: { x: '3 mm', y: '-2 mm', z: '5 mm' },
      children: [
        {
          id: 'turned',
          op: 'rotate',
          params: { x: '35 deg', y: '-20 deg', z: '50 deg' },
          children: [{ id: 'flipped', op: 'mirror', params: { plane: 'yz' }, children: [thicken('placed', { outline: oval(2.5, 4, 3.5), thickness: '1.1 mm', surface: 'sphere', radius: '6 mm' })] }],
        },
      ],
    };
    const { run, sheets } = await checkAlone(node);
    const sheet = entry(run.entries, 'sheet');
    assert.ok(Math.abs(sheet.value! - 1.1) < 0.01, sheet.measured ?? '');
    // Every declared point was measured, so every one lies inside the metal where it was placed.
    assert.match(sheet.method, new RegExp(`${sheets[0]!.points.length} on placed`));
  });

  it('cut by a difference, it is measured where it remains; inside a cutter it declares nothing', async () => {
    const cut: TreeNode = {
      id: 'notched',
      op: 'difference',
      children: [
        thicken('kept', { outline: oval(2.5, 4, 3.5), thickness: '1.0 mm', surface: 'sphere', radius: '7 mm' }),
        { id: 'notch', op: 'translate', params: { y: '6 mm' }, children: [{ id: 'notch_box', op: 'box', params: { x: '2 mm', y: '3 mm', z: '6 mm' } }] },
        thicken('cutter', { outline: oval(1, 1, 2), thickness: '3 mm', surface: 'flat' }),
      ],
    };
    const { run, sheets } = await checkAlone(cut);
    assert.deepEqual(sheets.map((s) => s.label), ['kept']);
    const sheet = entry(run.entries, 'sheet');
    assert.equal(sheet.result, 'pass', sheet.measured ?? '');
    assert.ok(Math.abs(sheet.value! - 1.0) < 0.01, sheet.measured ?? '');
    const measured = Number(new RegExp('(\\d+) on kept').exec(sheet.method)?.[1]);
    assert.ok(measured > 50 && measured < sheets[0]!.points.length, `${measured} of ${sheets[0]!.points.length} points measured`);
  });

  it('two sheets crossing at a shallow angle: the thin wedge between them is reported where they meet', async () => {
    const pair: TreeNode = {
      id: 'pair',
      op: 'union',
      children: [
        thicken('lower', { outline: oval(3, 2), thickness: '1.0 mm' }),
        { id: 'tipped', op: 'rotate', params: { y: '12 deg' }, children: [thicken('upper', { outline: oval(3, 2), thickness: '1.0 mm' })] },
      ],
    };
    const { run } = await checkAlone(pair);
    const wall = entry(run.entries, 'wall');
    assert.equal(wall.result, 'fail');
    assert.equal(wall.where?.part, 'sheet');
    assert.deepEqual([wall.where!.feature, ...(wall.where!.meets ?? [])].sort(), ['lower', 'upper']);
    assert.match(wall.where!.description, /where it meets/);
    assert.equal(entry(run.entries, 'sheet').result, 'pass');
  });
});

// ------------------------------------------------------------- at least its stated thickness
//
// The owner settled it on 2026-10-04 (dec:idea-four-choices-left-by-the-thicken-build,
// choice 3): the library compensates, so a stated thickness is always built at least
// that thick, whatever the material, and a stated number means what it says. It must
// hold for any thickness, radius, tessellation and scale
// (req:limits-follow-the-material-process-and-size), so it is proved two ways on every
// sheet below: the sheet check's own reading, and an exact look at every face triangle
// of the written file, which the declared points only sample.

/**
 * The most a sheet may come out over its stated thickness in a casting file: the
 * convex face's own chord sagitta, which the grid spacing holds near 1.8 x the chord
 * tolerance, plus a float32 allowance far below a micrometre. Never more than twice
 * the chord tolerance (thicken.ts, AT LEAST THE STATED THICKNESS; the README).
 */
const EXCESS_MAX = 2 * EXPORT_TOL;

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.sqrt(dot(a, a));

function segmentDist(p: V, a: V, b: V): number {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const u = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return len(sub(p, [a[0] + u * ab[0], a[1] + u * ab[1], a[2] + u * ab[2]]));
}

/** The exact distance from p to the nearest point of triangle abc (a degenerate one too). */
function triangleDist(p: V, a: V, b: V, c: V): number {
  let best = Math.min(segmentDist(p, a, b), segmentDist(p, b, c), segmentDist(p, c, a));
  const n = cross(sub(b, a), sub(c, a)), nn = dot(n, n);
  if (nn > 1e-24) {
    const s = dot(sub(p, a), n) / nn;
    const q: V = [p[0] - s * n[0], p[1] - s * n[1], p[2] - s * n[2]];
    if (dot(cross(sub(b, a), sub(q, a)), n) >= 0 && dot(cross(sub(c, b), sub(q, b)), n) >= 0 && dot(cross(sub(a, c), sub(q, c)), n) >= 0) best = Math.min(best, Math.abs(s) * Math.sqrt(nn));
  }
  return best;
}

interface SheetCase {
  name: string;
  t: number;
  surface: 'flat' | 'sphere' | 'cylinder';
  radius?: number;
  axis?: 'x' | 'y';
  outline: string[][];
  /** Also read by the casting checker (every check runs, and the wall check takes 15-60 s on a thick 100 mm leaf). */
  read: boolean;
}

/**
 * Where the two faces of a sheet built in its own frame lie, from every triangle of the
 * file: each point's offset s from the middle surface along its normal (positive towards
 * the centre of curvature, the side the inner face is on, as the slab's z). A face
 * triangle is told by its normal (within 25° of the surface's); the rim's are skipped.
 * For a curved face s = R - (distance to the centre, or to a cylinder's axis), so its
 * range over a triangle is exact: the nearest point of the triangle, and its furthest
 * corner.
 */
function faceOffsets(c: SheetCase, mesh: { positions: Float32Array; triangles: Uint32Array }) {
  const R = c.radius ?? Infinity;
  // Project out the cylinder's axis: the distance to the axis is the distance to the centre in what remains.
  const proj = (p: V): V => (c.surface === 'cylinder' ? (c.axis === 'x' ? [0, p[1], p[2] - R] : [p[0], 0, p[2] - R]) : c.surface === 'sphere' ? [p[0], p[1], p[2] - R] : p);
  /** The direction s decreases in: away from the centre of curvature (or -z when flat). */
  const away = (g: V): V => {
    if (c.surface === 'flat') return [0, 0, -1];
    const r = proj(g), l = len(r);
    return [r[0] / l, r[1] / l, r[2] / l];
  };
  const P = mesh.positions, T = mesh.triangles;
  const out = { outer: { hi: -Infinity, lo: Infinity, n: 0 }, inner: { hi: -Infinity, lo: Infinity, n: 0 } };
  for (let i = 0; i < T.length / 3; i++) {
    const v = [0, 1, 2].map((j) => [P[T[i * 3 + j]! * 3]!, P[T[i * 3 + j]! * 3 + 1]!, P[T[i * 3 + j]! * 3 + 2]!] as V) as [V, V, V];
    const n = cross(sub(v[1], v[0]), sub(v[2], v[0])), area2 = len(n);
    const longest = Math.max(len(sub(v[1], v[0])), len(sub(v[2], v[1])), len(sub(v[0], v[2])));
    if (area2 / longest < 1e-3) continue; // too narrow for float32 corners to give a direction
    const g: V = [(v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3, (v[0][2] + v[1][2] + v[2][2]) / 3];
    const facing = dot(n, away(g)) / area2;
    if (Math.abs(facing) < Math.cos((25 * Math.PI) / 180)) continue; // the rim
    let sHi: number, sLo: number;
    if (c.surface === 'flat') {
      sHi = Math.max(v[0][2], v[1][2], v[2][2]);
      sLo = Math.min(v[0][2], v[1][2], v[2][2]);
    } else {
      const q = v.map(proj) as [V, V, V];
      sHi = R - triangleDist([0, 0, 0], q[0], q[1], q[2]);
      sLo = R - Math.max(len(q[0]), len(q[1]), len(q[2]));
    }
    const f = facing > 0 ? out.outer : out.inner;
    f.hi = Math.max(f.hi, sHi);
    f.lo = Math.min(f.lo, sLo);
    f.n++;
  }
  return out;
}

const sheetNode = (c: SheetCase): TreeNode =>
  thicken('leaf', { outline: c.outline, thickness: mm(c.t), surface: c.surface, ...(c.radius ? { radius: mm(c.radius) } : {}), ...(c.axis ? { axis: c.axis } : {}) });

/** One sheet built as a casting file is, and, if asked, read by the casting checker (no reference: only the sheet's reading is wanted). */
async function buildAndRead(c: SheetCase) {
  const node = sheetNode(c);
  // Within what the tree accepts (the 5 x thickness floor, the outline's reach round the surface).
  const tree = treeFromTemplate('plain_band', { ring_size: { system: 'US', size: '7' } });
  tree.root.children!.push(node);
  validateTree(tree);
  const k = await kernel();
  const A = new Arena();
  try {
    const sheets: SheetDecl[] = [];
    const mesh = polygonsToMesh(buildOp(k, A, node, EXPORT_TOL, { m: IDENTITY, sheets }));
    if (!c.read) return { mesh, sheet: null };
    const run = runChecks(writeBinaryStl(mesh, 'x'), { prongs: [], scale: 1, sheets }, SILVER);
    return { mesh, sheet: entry(run.entries, 'sheet') };
  } finally {
    A.free();
  }
}

describe('a stated thickness is built at least that thick, at any thickness, radius and scale', () => {
  it('a cupped petal stated at exactly the wall minimum, 0.8 mm, reads at least 0.8 mm and passes (it read 0.799 mm and was refused)', async () => {
    const { run } = await checkAlone(thicken('limit', { outline: oval(2.5, 4, 3.5), thickness: '0.8 mm', surface: 'sphere', radius: '7 mm' }));
    const sheet = entry(run.entries, 'sheet');
    assert.ok(sheet.value! >= 0.8, `the sheet reads ${sheet.value} mm`);
    assert.equal(sheet.result, 'pass', sheet.measured ?? '');
    const wall = entry(run.entries, 'wall');
    assert.equal(wall.result, 'pass', `${wall.measured} at ${wall.where?.description}`);
    assert.equal(entry(run.entries, 'surface_deviation').result, 'pass', entry(run.entries, 'surface_deviation').measured ?? '');
  });

  // Ring petals 7 mm long, and a sculpture leaf 100 mm long and 40 mm wide; from 0.5 to 5 mm thick; each surface
  // from as tight as the tree allows (5 x the thickness, or the radius the outline's reach needs) to gentle. Every
  // sheet's faces are read exactly, triangle by triangle; the casting checker also reads every ring petal, every
  // leaf 0.8 mm thick and one 5 mm thick.
  const cases: SheetCase[] = [];
  const ring = petal(7, 4.4, 1.0);
  for (const t of [0.5, 0.8, 1.0, 1.5]) {
    const tight = 5 * t;
    cases.push(
      { name: `a ring petal ${t} mm thick, cupped on a ${Math.max(tight, 4.5)} mm sphere`, t, surface: 'sphere', radius: Math.max(tight, 4.5), outline: ring, read: true },
      { name: `a ring petal ${t} mm thick, cupped on a 25 mm sphere`, t, surface: 'sphere', radius: 25, outline: ring, read: true },
      { name: `a ring petal ${t} mm thick, curled along its length on a ${Math.max(tight, 2.7)} mm cylinder`, t, surface: 'cylinder', radius: Math.max(tight, 2.7), axis: 'x', outline: ring, read: true },
      { name: `a ring petal ${t} mm thick, fluted on a ${tight} mm cylinder`, t, surface: 'cylinder', radius: tight, axis: 'y', outline: ring, read: true },
      { name: `a ring petal ${t} mm thick, flat`, t, surface: 'flat', outline: ring, read: true },
    );
  }
  const leaf = oval(20, 50, 0, 96);
  for (const t of [0.8, 2, 5]) {
    const read = t === 0.8;
    cases.push(
      { name: `a 100 mm sculpture leaf ${t} mm thick, cupped on a 40 mm sphere`, t, surface: 'sphere', radius: 40, outline: leaf, read },
      { name: `a 100 mm sculpture leaf ${t} mm thick, cupped on a 1000 mm sphere`, t, surface: 'sphere', radius: 1000, outline: leaf, read },
      { name: `a 100 mm sculpture leaf ${t} mm thick, curled along its length on a 25 mm cylinder`, t, surface: 'cylinder', radius: 25, axis: 'x', outline: leaf, read },
      { name: `a 100 mm sculpture leaf ${t} mm thick, fluted on a ${Math.max(5 * t, 10)} mm cylinder`, t, surface: 'cylinder', radius: Math.max(5 * t, 10), axis: 'y', outline: leaf, read: read || t === 5 },
      { name: `a 100 mm sculpture leaf ${t} mm thick, flat`, t, surface: 'flat', outline: leaf, read: true },
    );
  }
  for (const c of cases) {
    it(`${c.name}: no thinner than stated anywhere, and no thicker than stated plus the tessellation's error`, async (ctx) => {
      const { mesh, sheet } = await buildAndRead(c);
      if (sheet) {
        // The casting checker's reading, square to the surface at every declared point.
        assert.ok(sheet.value! >= c.t, `the sheet check reads ${sheet.value} mm on a sheet stated at ${c.t} mm`);
        assert.ok(sheet.value! <= c.t + EXCESS_MAX + 0.0005, `the sheet check reads ${sheet.value} mm on a sheet stated at ${c.t} mm`);
      }
      // Every face triangle of the file, exactly: the outer face lies on or beyond the stated outer surface, the inner
      // face on or beyond the stated inner one, so measured square to the surface anywhere the sheet is at least t.
      const f = faceOffsets(c, mesh);
      const um = (x: number) => `${(x * 1000).toFixed(3)} um`;
      ctx.diagnostic(
        `${sheet ? `sheet check ${sheet.value} mm; ` : ''}outer face ${um(-c.t / 2 - f.outer.hi)} to ${um(-c.t / 2 - f.outer.lo)} beyond the stated surface, inner face ${um(f.inner.lo - c.t / 2)} to ${um(f.inner.hi - c.t / 2)}`,
      );
      assert.ok(f.outer.n > 20 && f.inner.n > 20, `${f.outer.n} outer and ${f.inner.n} inner face triangles`);
      assert.ok(f.outer.hi <= -c.t / 2, `the outer face comes ${(f.outer.hi + c.t / 2).toExponential(2)} mm inside the stated outer surface`);
      assert.ok(f.inner.lo >= c.t / 2, `the inner face comes ${(c.t / 2 - f.inner.lo).toExponential(2)} mm inside the stated inner surface`);
      // And neither face stands further out than the tessellation's error.
      assert.ok(-c.t / 2 - f.outer.lo <= EXCESS_MAX, `the outer face stands ${(-c.t / 2 - f.outer.lo).toFixed(5)} mm out`);
      assert.ok(f.inner.hi - c.t / 2 <= EXCESS_MAX, `the inner face stands ${(f.inner.hi - c.t / 2).toFixed(5)} mm out`);
    });
  }
});

// ------------------------------------------------------------- the tree

describe('the thicken operation in the tree', () => {
  const us7 = { ring_size: { system: 'US', size: '7' } };
  const withSheet = (params: Record<string, unknown>, extra: Partial<TreeNode> = {}) => {
    const t = treeFromTemplate('plain_band', us7);
    t.root.children!.push({ id: 'petal', op: 'thicken', params, ...extra });
    return t;
  };
  const refuses = (tree: PieceTree, path: string, words: RegExp) =>
    assert.throws(
      () => validateTree(tree),
      (e: unknown) => {
        assert.ok(e instanceof CallError, String(e));
        assert.equal(e.path, path);
        assert.match(e.problem, words);
        return true;
      },
    );
  const ok = { outline: oval(2, 3, 3), thickness: '1 mm', surface: 'sphere', radius: '8 mm' };

  it('is a valid operation that round-trips through JSON', () => {
    const t = withSheet({ ...ok, round_corners: '0.4 mm' });
    assert.deepEqual(validateTree(JSON.parse(JSON.stringify(t))), t);
    assert.ok(validateTree(withSheet({ outline: oval(2, 3), thickness: '0.8 mm' })));
    assert.ok(validateTree(withSheet({ outline: oval(2, 3), thickness: '0.8 mm', surface: 'cylinder', radius: '4 mm', axis: 'y' })));
  });

  it('refuses what it cannot build, naming the field path', () => {
    const at = 'tree.root.children[1].params';
    refuses(withSheet({ ...ok, thickness: 1 }), `${at}.thickness`, /1 has no unit/);
    refuses(withSheet({ ...ok, thickness: '0.04 in' }), `${at}.thickness`, /0\.04 in × 25\.4 = 1\.016 mm/);
    refuses(withSheet({ outline: oval(2, 3) }), `${at}.thickness`, /a thicken needs "thickness"/);
    refuses(withSheet({ ...ok, surface: 'cone' }), `${at}.surface`, /"flat", "sphere".*"cylinder"/);
    refuses(withSheet({ ...ok, radius: undefined }), `${at}.radius`, /needs the radius/);
    refuses(withSheet({ ...ok, radius: '0.8 mm' }), `${at}.radius`, /at least 5 times the thickness \(5 mm here\)/);
    refuses(withSheet({ ...ok, radius: '4.9 mm' }), `${at}.radius`, /curves a 1 mm sheet too tightly/);
    refuses(withSheet({ outline: oval(2, 3), thickness: '1 mm', radius: '5 mm' }), `${at}.radius`, /a flat sheet has no radius/);
    refuses(withSheet({ ...ok, axis: 'x' }), `${at}.axis`, /only a cylinder has an axis/);
    refuses(withSheet({ ...ok, surface: 'cylinder', axis: 'z' }), `${at}.axis`, /"x".*"y"/);
    refuses(withSheet({ ...ok, thickness: '6 mm', radius: '8 mm' }), `${at}.thickness`, /outside what the library builds/);
    refuses(withSheet({ ...ok, outline: [['0 mm', '0 mm'], ['1 mm', '0 mm'], ['2 mm', '0 mm']] }), `${at}.outline`, /encloses no area/);
    // A quarter of the way round a 4 mm sphere is 6.28 mm from the origin.
    refuses(withSheet({ ...ok, thickness: '0.8 mm', radius: '4 mm', outline: oval(2, 3.5, 3.5) }), `${at}.outline`, /more than a quarter of the way round a sphere of radius 4 mm.*at least 4\.5 mm/);
    refuses(withSheet({ ...ok, thickness: '0.4 mm', surface: 'cylinder', radius: '2 mm', outline: oval(2, 3.5, 3.5) }), `${at}.outline`, /more than 150° round a cylinder/);
    refuses(withSheet(ok, { children: [{ id: 'kid', op: 'sphere', params: { radius: '1 mm' } }] }), 'tree.root.children[1].children', /a thicken is a shape and has no children/);
    const blended = treeFromTemplate('plain_band', us7);
    blended.root.children!.push({ id: 'blend', op: 'smooth_union', params: { radius: '0.3 mm' }, children: [{ id: 'b1', op: 'sphere', params: { radius: '1 mm' } }, { id: 'petal', op: 'thicken', params: ok }] });
    refuses(blended, 'tree.root.children[1].children[1]', /smooth_union can blend only/);
  });

  it('a round_corners that leaves nothing of the outline is refused at that setting', async () => {
    const k = await kernel();
    const A = new Arena();
    try {
      assert.throws(
        () => buildOp(k, A, thicken('slim', { outline: oval(0.4, 3), thickness: '1 mm', round_corners: '0.6 mm' }), PREVIEW_TOL),
        (e: unknown) => e instanceof CallError && e.path === 'slim.params.round_corners' && /leaves nothing of the outline/.test(e.problem),
      );
    } finally {
      A.free();
    }
  });

  it('with shrinkage on, its declaration grows with the piece', async () => {
    const t = withSheet(ok);
    t.root.children!.pop();
    const v = readPiece(t);
    t.root.children!.push({ id: 'lift', op: 'translate', params: { z: mm(v.innerDiameterMm / 2 + v.bandThicknessMm) }, children: [{ id: 'petal', op: 'thicken', params: ok }] });
    t.shrinkage = 'on';
    const plain = await buildPiece(t, { tol: PREVIEW_TOL, applyShrinkage: false });
    const grown = await buildPiece(t, { tol: PREVIEW_TOL, applyShrinkage: true });
    assert.equal(plain.decl.sheets![0]!.nominalThickness, 1);
    assert.ok(Math.abs(grown.decl.sheets![0]!.nominalThickness - 1.015) < 1e-9);
    assert.ok(Math.abs(grown.decl.sheets![0]!.points[0]![2] - plain.decl.sheets![0]!.points[0]![2] * 1.015) < 1e-9);
  });
});

// ------------------------------------------------------------- pieces

/**
 * The hibiscus: a US 7 silver band with a post rising from its top to a disc, and
 * `count` cupped petals round the disc, each tilted `tilt` up about its own base. The
 * petals are 7 mm long and 4.4 mm wide, cupped on a 7 mm sphere, their corners
 * rounded to 0.5 mm, their bases buried in the disc.
 */
function flower(count: number, thickness: string, opts: { round?: string | null; tilt?: number } = {}): PieceTree {
  const tree = treeFromTemplate('plain_band', { ring_size: { system: 'US', size: '7' }, name: 'hibiscus', band_width: '3.0 mm', band_thickness: '1.8 mm', metal: 'sterling_silver_925' });
  const v = readPiece(tree);
  const top = v.innerDiameterMm / 2 + v.bandThicknessMm;
  const centre = top + 2;
  const round = opts.round === undefined ? '0.5 mm' : opts.round;
  const petals: TreeNode[] = Array.from({ length: count }, (_, i) => ({
    id: `petal_${i + 1}_turn`,
    op: 'rotate',
    params: { z: `${(360 / 5) * i} deg` },
    children: [
      {
        id: `petal_${i + 1}_place`,
        op: 'translate',
        params: { y: '1.8 mm' },
        children: [
          {
            id: `petal_${i + 1}_tilt`,
            op: 'rotate',
            params: { x: `${opts.tilt ?? 20} deg` },
            children: [
              {
                id: `petal_${i + 1}`,
                op: 'thicken',
                params: { outline: petal(7, 4.4, 1.0), thickness, surface: 'sphere', radius: '7 mm', ...(round ? { round_corners: round } : {}) },
              },
            ],
          },
        ],
      },
    ],
  }));
  tree.root.children!.push(
    { id: 'post', op: 'translate', params: { z: mm(top - 0.6) }, children: [{ id: 'post_rod', op: 'cylinder', params: { radius: '1.2 mm', height: '2.6 mm' } }] },
    {
      id: 'flower',
      op: 'translate',
      params: { z: mm(centre) },
      children: [{ id: 'disc_lift', op: 'translate', params: { z: '-1.2 mm' }, children: [{ id: 'disc', op: 'cylinder', params: { radius: '2.6 mm', height: '2.4 mm' } }] }, ...petals],
    },
  );
  return validateTree(tree);
}

const failing = (r: Awaited<ReturnType<typeof checkPiece>>) => r.entries.filter((e) => e.result !== 'pass').map((e) => `${e.id}: ${e.measured} [${e.where?.description}]`);

/**
 * The flower the design-jewelry skill teaches, built from the skill's own text: its
 * JSON example (the post, the disc and petal_1), with petal_2 to petal_5 added the
 * way it says, turned 72, 144, 216 and 288 deg.
 */
function skillFlower(): PieceTree {
  const skill = readFileSync(new URL('../../skills/design-jewelry/SKILL.md', import.meta.url), 'utf8');
  const block = /### Cupped and curled petals[\s\S]*?```json\n([\s\S]*?)```/.exec(skill)?.[1];
  assert.ok(block, 'the skill has a JSON example under "Cupped and curled petals"');
  const nodes = JSON.parse(`[${block}]`) as TreeNode[];
  const flowerNode = nodes.find((n) => n.id === 'flower')!;
  const first = flowerNode.children!.find((n) => n.id === 'petal_1_turn')!;
  for (let i = 2; i <= 5; i++) {
    const copy = JSON.parse(JSON.stringify(first).replaceAll('petal_1', `petal_${i}`)) as TreeNode;
    copy.params!['z'] = `${72 * (i - 1)} deg`;
    flowerNode.children!.push(copy);
  }
  const tree = treeFromTemplate('plain_band', { ring_size: { system: 'US', size: '7' }, name: 'hibiscus', band_width: '3.0 mm', band_thickness: '1.8 mm' });
  const v = readPiece(tree);
  // The skill's z positions are for this band: its top at 10.46 mm.
  assert.ok(Math.abs(v.innerDiameterMm / 2 + v.bandThicknessMm - 10.46) < 0.005);
  tree.root.children!.push(...nodes);
  return validateTree(tree);
}

describe('cupped petals on a ring', () => {
  it("a 5-petal cupped flower joined to a band (the skill's own example) passes every casting check and exports", async () => {
    const tree = skillFlower();
    assert.equal(tree.metal, 'sterling_silver_925');
    const r = await checkPiece(tree, 'export');
    assert.deepEqual(failing(r), []);
    assert.equal(r.verdict, 'pass');
    assert.equal(r.report['export'], 'released');
    assert.ok(r.stl && r.threeMf);
    const sheet = entry(r.entries, 'sheet');
    assert.deepEqual(
      [...sheet.measured!.matchAll(/(petal_\d) ([\d.]+) \(([\d.]+)\)/g)].map((m) => [m[1], Math.abs(Number(m[2]) - 1) < 0.01, Number(m[3])]),
      [1, 2, 3, 4, 5].map((i) => [`petal_${i}`, true, 1]),
    );
    // Its thinnest wall anywhere is a petal's own thickness: nothing thinner at an edge or where a petal joins the disc.
    const wall = entry(r.entries, 'wall');
    assert.ok(Math.abs(wall.value! - 1.0) < 0.01, `wall ${wall.value} at ${wall.where?.description}`);
    assert.equal(entry(r.entries, 'watertight').result, 'pass');
  });

  it('a too-thin cupped petal is refused, naming the petal and what to set, and following the advice clears it', async () => {
    const thin = flower(1, '0.6 mm');
    const r = await checkPiece(thin, 'export');
    assert.equal(r.verdict, 'fail');
    assert.equal(r.threeMf, null);
    assert.equal(r.report['export'], 'refused');
    const sheet = entry(r.entries, 'sheet');
    assert.equal(sheet.result, 'fail');
    assert.deepEqual(sheet.failing?.map((f) => f.label), ['petal_1']);
    assert.ok(Math.abs(sheet.failing![0]!.value - 0.6) < 0.01, `${sheet.failing![0]!.value}`);
    assert.equal(sheet.failing![0]!.nominal, 0.6);
    const advice = r.fixes.find((f) => /Thicken the sheet "petal_1"/.test(f));
    assert.ok(advice, r.fixes.join(' | '));
    assert.match(advice!, /measured square to its surface it is 0\.\d+ mm \(its thickness is set to 0\.6 mm\), and a wall needs 0\.8 mm/);
    // One instruction per place: the wall check's own reading of the thin petal adds no second one.
    assert.equal(r.fixes.filter((f) => /petal_1/.test(f)).length, 1, r.fixes.join(' | '));
    const set = JSON.parse(/Change: set (\{.*\})\./.exec(advice!)![1]!) as Record<string, string>;
    assert.deepEqual(Object.keys(set), ['petal_1.thickness']);
    const followed = applySet(thin, set).tree;
    const again = await checkPiece(followed, 'check');
    assert.deepEqual(failing(again), []);
    assert.ok(Math.abs(entry(again.entries, 'sheet').value! - Number.parseFloat(set['petal_1.thickness']!)) < 0.01);
  });

  it('a petal with a pointed tip is refused at the tip, with the rounding that clears it', async () => {
    const pointed = flower(1, '1.0 mm', { round: null });
    // A sharp tip: replace the rounded petal with one that narrows to a point.
    const node = (function find(n: TreeNode): TreeNode | undefined {
      if (n.id === 'petal_1') return n;
      for (const c of n.children ?? []) {
        const f = find(c);
        if (f) return f;
      }
      return undefined;
    })(pointed.root)!;
    node.params!['outline'] = [['-0.6 mm', '0 mm'], ['0.6 mm', '0 mm'], ['2.2 mm', '3 mm'], ['0 mm', '7 mm'], ['-2.2 mm', '3 mm']];
    const r = await checkPiece(validateTree(pointed), 'check');
    assert.equal(r.verdict, 'fail');
    assert.equal(entry(r.entries, 'sheet').result, 'pass', 'the sheet itself is thick enough');
    const wall = entry(r.entries, 'wall');
    assert.equal(wall.result, 'fail');
    assert.equal(wall.where?.feature, 'petal_1');
    const advice = r.fixes.find((f) => /petal_1\.round_corners/.test(f));
    assert.ok(advice, r.fixes.join(' | '));
    const rc = /"petal_1\.round_corners": "([\d.]+) mm"/.exec(advice!)![1]!;
    const again = await checkPiece(applySet(pointed, { 'petal_1.round_corners': `${rc} mm` }).tree, 'check');
    assert.deepEqual(failing(again), []);
  });
});
