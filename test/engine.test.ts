// The engine end to end, below the MCP layer: the solitaire in several sizes and
// systems passes and exports; Emily's preset passes; a too-thin prong and a
// too-thin bezel are refused with what to thicken and where; the checker reads
// the bytes that were written; a check that cannot run is a fail; the stone is
// never in the casting file; every tree operation is one closed solid.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { runChecks } from '../src/checker/check.js';
import { readBinaryStl } from '../src/checker/stl.js';
import { checkPiece, limitsFor } from '../src/engine.js';
import { buildPiece, EXPORT_TOL, PREVIEW_TOL } from '../src/library/build.js';
import { METALS } from '../src/metals.js';
import { applySet, treeFromTemplate, type PieceTree, type TreeNode } from '../src/piece/tree.js';

const sizes = [
  { system: 'US', size: '7' },
  { system: 'UK', size: 'N' },
  { system: 'EU', size: 60 },
];

function failing(r: Awaited<ReturnType<typeof checkPiece>>): string[] {
  return r.entries.filter((e) => e.result !== 'pass').map((e) => `${e.id}: ${e.measured}`);
}

/** Whether point p is inside the mesh: ray-crossing parity along +X. */
function insideMesh(stl: Buffer, p: [number, number, number]): boolean {
  const m = readBinaryStl(stl);
  const P = m.positions, T = m.triangles;
  let crossings = 0;
  for (let t = 0; t < m.count; t++) {
    const v = [0, 1, 2].map((k) => [P[T[t * 3 + k]! * 3]!, P[T[t * 3 + k]! * 3 + 1]!, P[T[t * 3 + k]! * 3 + 2]!]);
    // Intersect the ray y = p.y, z = p.z, x > p.x with the triangle (barycentric in the YZ plane).
    const [a, b, c] = v as [number[], number[], number[]];
    const d = (b[1]! - a[1]!) * (c[2]! - a[2]!) - (c[1]! - a[1]!) * (b[2]! - a[2]!);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((p[1] - a[1]!) * (c[2]! - a[2]!) - (c[1]! - a[1]!) * (p[2] - a[2]!)) / d;
    const w = ((b[1]! - a[1]!) * (p[2] - a[2]!) - (p[1] - a[1]!) * (b[2]! - a[2]!)) / d;
    if (u < 0 || w < 0 || u + w > 1) continue;
    const x = a[0]! + u * (b[0]! - a[0]!) + w * (c[0]! - a[0]!);
    if (x > p[0]) crossings++;
  }
  return crossings % 2 === 1;
}

describe('the solitaire passes and exports in several sizes and systems', () => {
  for (const [i, size] of sizes.entries()) {
    const prongs = i === 1 ? 6 : 4;
    it(`${size.system} ${size.size}, ${prongs} prongs`, async () => {
      const tree = treeFromTemplate('solitaire_ring', { ring_size: size, name: `sol-${i}`, prong_count: prongs });
      const r = await checkPiece(tree, 'export');
      assert.deepEqual(failing(r), []);
      assert.equal(r.verdict, 'pass');
      assert.ok(r.stl && r.threeMf);
      assert.equal(r.report['export'], 'released');
    });
  }
  it('a plain band in EU 60 passes too', async () => {
    const r = await checkPiece(treeFromTemplate('plain_band', { ring_size: { system: 'EU', size: 60 }, name: 'band' }), 'export');
    assert.deepEqual(failing(r), []);
  });
});

describe("Emily's emerald-cut bezel solitaire", () => {
  it('passes every check in platinum, says so, and leaves the stone out of the file', async () => {
    const tree = treeFromTemplate('emerald_bezel_solitaire', { ring_size: { system: 'US', size: '6.5' }, name: 'emily' });
    const r = await checkPiece(tree, 'export');
    assert.deepEqual(failing(r), []);
    const metal = r.report['metal'] as { id: string; casting_note: string };
    assert.equal(metal.id, 'platinum_950');
    assert.match(metal.casting_note, /SPECIALIST platinum caster/);
    assert.equal((r.report['stone'] as { in_casting_file: boolean }).in_casting_file, false);
    const built = await buildPiece(tree, { tol: PREVIEW_TOL, applyShrinkage: false });
    const st = built.decl.stone!;
    // The middle of the stone, just above its girdle, is empty space in the casting file.
    assert.equal(insideMesh(r.stl!, [0, 0, st.girdleTopZ + 0.3]), false);
    assert.equal(insideMesh(r.stl!, [0, 0, st.girdleBottomZ - 0.3]), false);
  });
  it('turned north-south and set in 6 prongs, it still passes', async () => {
    let tree = treeFromTemplate('emerald_bezel_solitaire', { ring_size: { system: 'US', size: '7' }, name: 'ns' });
    tree = applySet(tree, { stone_setting: 'prong_head', stone_orientation: 'north_south', prong_count: 6 }).tree;
    const r = await checkPiece(tree, 'export');
    assert.deepEqual(failing(r), []);
  });
});

describe('refusals say what to thicken and where', () => {
  it('a deliberately too-thin prong is refused, naming the prong and its clock position', async () => {
    let tree = treeFromTemplate('solitaire_ring', { ring_size: { system: 'US', size: '7' }, name: 'thin' });
    tree = applySet(tree, { 'head.prong_overrides': [{ prong: 2, thickness: '0.7 mm' }] }).tree;
    const r = await checkPiece(tree, 'export');
    assert.equal(r.verdict, 'fail');
    assert.equal(r.stl === null || r.report['export'] === 'refused', true);
    assert.equal(r.threeMf, null);
    const prong = r.entries.find((e) => e.id === 'prong')!;
    assert.equal(prong.result, 'fail');
    assert.deepEqual(prong.failing?.map((f) => f.label), ['prong 2 of 4']);
    assert.equal(prong.failing?.[0]?.where.clock, '4:30');
    assert.ok(prong.failing![0]!.value < 1.0);
    assert.ok(r.fixes.some((f) => /Thicken prong 2 of 4 at 4:30/.test(f) && /needs 1\.0 mm/.test(f)));
  });
  it('a too-thin bezel wall is refused, naming where on the rim', async () => {
    let tree = treeFromTemplate('emerald_bezel_solitaire', { ring_size: { system: 'US', size: '7' }, name: 'thinbezel' });
    tree = applySet(tree, { bezel_wall: '0.6 mm' }).tree;
    const r = await checkPiece(tree, 'export');
    assert.equal(r.verdict, 'fail');
    assert.equal(r.threeMf, null);
    const bz = r.entries.find((e) => e.id === 'bezel_wall')!;
    assert.equal(bz.result, 'fail');
    assert.ok(bz.value! < 0.8 && bz.value! > 0.5);
    assert.match(bz.where!.clock!, /^\d+:\d\d$/);
    assert.ok(r.fixes.some((f) => /Thicken the bezel rim/.test(f) && /bezel_wall/.test(f)));
  });
});

describe('two parts too close together are refused (the gap check)', () => {
  it('a 0.2 mm slot is refused with where it is', async () => {
    const tree: PieceTree = treeFromTemplate('plain_band', { ring_size: { system: 'US', size: '7' }, name: 'slot' });
    // A block on the band with a 0.2 mm slot sawn into it: two walls facing each other 0.2 mm apart.
    tree.root.children!.push({
      id: 'block',
      op: 'translate',
      params: { x: '0 mm', y: '0 mm', z: '10.6 mm' },
      children: [
        {
          id: 'slotted',
          op: 'difference',
          children: [
            { id: 'solid', op: 'box', params: { x: '4 mm', y: '2 mm', z: '2 mm' } },
            { id: 'cut', op: 'translate', params: { z: '0.5 mm' }, children: [{ id: 'saw', op: 'box', params: { x: '0.2 mm', y: '3 mm', z: '2 mm' } }] },
          ],
        },
      ],
    });
    const r = await checkPiece(tree, 'export');
    assert.equal(r.verdict, 'fail');
    assert.equal(r.threeMf, null);
    const gap = r.entries.find((e) => e.id === 'gap')!;
    assert.equal(gap.result, 'fail');
    assert.ok(Math.abs(gap.value! - 0.2) < 0.01, `gap ${gap.value}`);
    assert.ok(r.fixes.some((f) => /only 0\.2 mm apart/.test(f) && /open the gap to at least 0\.3 mm/.test(f)));
  });
});

describe('the checker reads the file that was written', () => {
  it("the report's STL checksum is the released file's, and the 3MF holds the same mesh in mm", async () => {
    const tree = treeFromTemplate('solitaire_ring', { ring_size: { system: 'US', size: '8' }, name: 'sum' });
    const r = await checkPiece(tree, 'export');
    const stl = r.report['stl'] as { sha256: string; triangles: number };
    assert.equal(stl.sha256, createHash('sha256').update(r.stl!).digest('hex'));
    assert.equal(r.stl!.readUInt32LE(80), stl.triangles);
    // The 3MF is a zip whose model says millimetres.
    const z = r.threeMf!;
    const end = z.length - 22;
    let cd = z.readUInt32LE(end + 16);
    let model = '';
    for (let i = 0; i < z.readUInt16LE(end + 10); i++) {
      const csize = z.readUInt32LE(cd + 20), nlen = z.readUInt16LE(cd + 28), off = z.readUInt32LE(cd + 42);
      const name = z.subarray(cd + 46, cd + 46 + nlen).toString();
      if (name === '3D/3dmodel.model') model = inflateRawSync(z.subarray(off + 30 + z.readUInt16LE(off + 26), off + 30 + z.readUInt16LE(off + 26) + csize)).toString();
      cd += 46 + nlen;
    }
    assert.match(model, /unit="millimeter"/);
    assert.equal((model.match(/<triangle /g) ?? []).length, stl.triangles);
  });
  it('a damaged file fails the watertight check, and an unreadable one cannot pass', async () => {
    const tree = treeFromTemplate('plain_band', { ring_size: { system: 'US', size: '7' }, name: 'dmg' });
    const built = await buildPiece(tree, { tol: EXPORT_TOL, applyShrinkage: true });
    const { writeBinaryStl } = await import('../src/files/stl.js');
    const stl = writeBinaryStl(built.metal, 'x');
    const L = limitsFor(METALS.sterling_silver_925);
    // Drop the last triangle: the header count and size are fixed up, so it parses, but the solid is open.
    const n = stl.readUInt32LE(80);
    const cut = Buffer.from(stl.subarray(0, 84 + 50 * (n - 1)));
    cut.writeUInt32LE(n - 1, 80);
    const open = runChecks(cut, built.decl, L, stl);
    assert.equal(open.entries.find((e) => e.id === 'watertight')!.result, 'fail');
    const broken = runChecks(stl.subarray(0, 500), built.decl, L, stl);
    assert.ok(broken.entries.every((e) => e.result === 'could_not_run'));
  });
});

describe('every tree operation evaluates to one closed solid', () => {
  const ops: TreeNode[] = [
    { id: 'o1', op: 'sphere', params: { radius: '1 mm' } },
    { id: 'o2', op: 'cylinder', params: { radius: '0.8 mm', height: '2 mm' } },
    { id: 'o3', op: 'box', params: { x: '2 mm', y: '1.5 mm', z: '1 mm' } },
    { id: 'o4', op: 'torus', params: { major_radius: '2 mm', minor_radius: '0.6 mm' } },
    { id: 'o5', op: 'extrude', params: { points: [['0 mm', '0 mm'], ['2 mm', '0 mm'], ['1 mm', '2 mm']], height: '1 mm' } },
    { id: 'o6', op: 'revolve', params: { points: [['1 mm', '0 mm'], ['2 mm', '0 mm'], ['1.5 mm', '1 mm']] } },
    { id: 'o7', op: 'sweep', params: { radius: '0.5 mm', path: [['0 mm', '0 mm', '0 mm'], ['3 mm', '0 mm', '0 mm'], ['3 mm', '3 mm', '1 mm']] } },
    {
      id: 'o8',
      op: 'smooth_union',
      params: { radius: '0.5 mm' },
      children: [
        { id: 'o8a', op: 'sphere', params: { radius: '1 mm' } },
        { id: 'o8b', op: 'translate', params: { x: '1.5 mm' }, children: [{ id: 'o8c', op: 'sphere', params: { radius: '0.8 mm' } }] },
      ],
    },
    {
      id: 'o9',
      op: 'difference',
      children: [
        { id: 'o9a', op: 'box', params: { x: '3 mm', y: '3 mm', z: '3 mm' } },
        { id: 'o9b', op: 'rotate', params: { x: '30 deg' }, children: [{ id: 'o9c', op: 'cylinder', params: { radius: '0.6 mm', height: '5 mm' } }] },
      ],
    },
    {
      id: 'o10',
      op: 'intersection',
      children: [
        { id: 'o10a', op: 'sphere', params: { radius: '1.5 mm' } },
        { id: 'o10b', op: 'mirror', params: { plane: 'xy' }, children: [{ id: 'o10c', op: 'box', params: { x: '2 mm', y: '2 mm', z: '2 mm' } }] },
      ],
    },
  ];
  for (const op of ops) {
    it(`${op.op}`, async () => {
      // Each operation stands on top of a plain band, joined to it, and the whole must be one watertight solid.
      const tree: PieceTree = treeFromTemplate('plain_band', { ring_size: { system: 'US', size: '7' }, name: op.id, band_thickness: '1.6 mm' });
      tree.root.children!.push({ id: `lift_${op.id}`, op: 'translate', params: { x: '0 mm', y: '0 mm', z: '9.8 mm' }, children: [op] });
      const built = await buildPiece(tree, { tol: 0.01, applyShrinkage: false });
      const { writeBinaryStl } = await import('../src/files/stl.js');
      const run = runChecks(writeBinaryStl(built.metal, 'x'), built.decl, limitsFor(METALS.sterling_silver_925), writeBinaryStl(built.metal, 'x'));
      const w = run.entries.find((e) => e.id === 'watertight')!;
      assert.equal(w.result, 'pass', w.measured ?? '');
      assert.equal(run.mesh.shells, 1);
      // Changing a parameter re-evaluates deterministically: the same tree builds the same mesh.
      const again = await buildPiece(tree, { tol: 0.01, applyShrinkage: false });
      assert.deepEqual(Buffer.from(again.metal.positions.buffer), Buffer.from(built.metal.positions.buffer));
    });
  }
});
