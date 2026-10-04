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
    assert.ok(Math.abs(Math.min(...zs) + 0.4) < 1e-6 && Math.abs(Math.max(...zs) - 0.4) < 1e-6);
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
