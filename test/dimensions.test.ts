// describe_piece REPORTS THE DIMENSIONS A CHECK OR A DECISION RESTS ON
// (fact:describe-piece-does-not-report-the-bezel-seat-so-a-chat-assumed-it-2026-10-05).
//
// A chat asked "will my 7.5 mm cabochon fit this bezel with 1 mm walls" and had to
// ASSUME the seat (7.5 mm, 0 mm clearance) because describe_piece never said it. The
// engine builds the bezel's inner wall 0.05 mm off the girdle, so the seat is 7.6 mm
// and the bezel 9.6 mm across. Each value describe_piece now reports is pinned here
// against the piece as BUILT: measured on the metal and stone meshes by casting rays,
// or read from the independent checker's measurement of the written file.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPiece } from '../src/engine.js';
import { buildPiece, EXPORT_TOL, type MeshOut } from '../src/library/build.js';
import { applySet, readPiece, treeFromTemplate, type PieceTree } from '../src/piece/tree.js';
import { Session } from '../src/session.js';

type V3 = [number, number, number];

/** Every distance along the ray o + t·d (t > 0) at which it crosses a triangle of the mesh, nearest first. */
function hits(m: MeshOut, o: V3, d: V3): number[] {
  const P = m.positions, T = m.triangles;
  const out: number[] = [];
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t]! * 3, b = T[t + 1]! * 3, c = T[t + 2]! * 3;
    const e1: V3 = [P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!];
    const e2: V3 = [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, P[c + 2]! - P[a + 2]!];
    const p: V3 = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-14) continue;
    const s: V3 = [o[0] - P[a]!, o[1] - P[a + 1]!, o[2] - P[a + 2]!];
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (u < 0 || u > 1) continue;
    const q: V3 = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (dist > 1e-9) out.push(dist);
  }
  return out.sort((x, y) => x - y);
}

const first = (m: MeshOut, o: V3, d: V3): number => {
  const h = hits(m, o, d);
  assert.ok(h.length, `the ray from ${JSON.stringify(o)} along ${JSON.stringify(d)} meets no metal`);
  return h[0]!;
};

/** How far apart the metal's outermost faces are along an axis through `at`, from rays sent in from 50 mm out on each side. */
function across(m: MeshOut, at: V3, axis: 0 | 1): number {
  const from = (sign: number): V3 => (axis === 0 ? [sign * 50, at[1], at[2]] : [at[0], sign * 50, at[2]]);
  const along = (sign: number): V3 => (axis === 0 ? [sign, 0, 0] : [0, sign, 0]);
  return 100 - first(m, from(1), along(-1)) - first(m, from(-1), along(1));
}

/** How far apart the metal's innermost faces are along an axis, from rays sent out from the stone's axis at height z. */
function inside(m: MeshOut, z: number, axis: 0 | 1): number {
  const along = (sign: number): V3 => (axis === 0 ? [sign, 0, 0] : [0, sign, 0]);
  return first(m, [0, 0, z], along(1)) + first(m, [0, 0, z], along(-1));
}

function zRange(m: MeshOut, keep: (x: number, y: number) => boolean = () => true): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m.positions.length; i += 3) {
    if (!keep(m.positions[i]!, m.positions[i + 1]!)) continue;
    lo = Math.min(lo, m.positions[i + 2]!);
    hi = Math.max(hi, m.positions[i + 2]!);
  }
  return [lo, hi];
}

function extent(m: MeshOut, axis: 0 | 1 | 2): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = axis; i < m.positions.length; i += 3) {
    lo = Math.min(lo, m.positions[i]!);
    hi = Math.max(hi, m.positions[i]!);
  }
  return hi - lo;
}

/** What the built piece measures: the band from rays up through its bottom, the stone's girdle, crown and culet from its own mesh. */
async function measured(tree: PieceTree) {
  const b = await buildPiece(tree, { tol: EXPORT_TOL, applyShrinkage: false });
  const up = hits(b.metal, [0, 0, -100], [0, 0, 1]);
  const rOut = 100 - up[0]!, rIn = 100 - up[1]!;
  const zMid = -(rIn + rOut) / 2;
  const width = across(b.metal, [0, 0, zMid], 1);
  const out = { b, rIn, rOut, width, stone: undefined as undefined | { girdleBottom: number; girdleTop: number; table: number; culet: number } };
  if (b.stone) {
    let rMax = 0;
    for (let i = 0; i < b.stone.positions.length; i += 3) rMax = Math.max(rMax, Math.hypot(b.stone.positions[i]!, b.stone.positions[i + 1]!));
    // The girdle: the stone's widest vertices, at its bottom and top.
    const girdle = zRange(b.stone, (x, y) => Math.hypot(x, y) > rMax - 1e-3);
    const all = zRange(b.stone);
    out.stone = { girdleBottom: girdle[0], girdleTop: girdle[1], table: all[1], culet: all[0] };
  }
  return out;
}

async function described(tree: PieceTree): Promise<string> {
  const r = await new Session().call('describe_piece', { tree });
  assert.equal(r.isError, false);
  return r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
}

/** The number(s) a pattern captures from a reply, or a failure naming the line that is missing. */
function nums(text: string, re: RegExp): number[] {
  const m = re.exec(text);
  assert.ok(m, `describe_piece does not report ${re}; it said:\n${text.slice(0, 1500)}`);
  return m.slice(1).map(Number);
}

const near = (got: number, want: number, tol: number, what: string) =>
  assert.ok(Math.abs(got - want) <= tol, `${what}: reported ${want} mm, measured ${got.toFixed(4)} mm on the built piece (allowed ±${tol} mm)`);

// The chord tolerance of a built surface is 0.0045 mm a side, and reports are to 0.01 mm.
const ACROSS = 0.015;
const ONE_SIDE = 0.01;

const MOONSTONE = () =>
  treeFromTemplate('solitaire_ring', {
    ring_size: { system: 'US', size: '9' },
    name: 'moonstone',
    metal: 'gold_14k_yellow',
    stone_setting: 'bezel',
    stone_diameter: '7.5 mm',
    stone_depth: '4 mm',
    bezel_wall: '1.0 mm',
  });

describe('describe_piece reports the band it builds', () => {
  it('inner and outer diameter, width and thickness, each in mm, as measured on the band', async () => {
    for (const tree of [MOONSTONE(), treeFromTemplate('plain_band', { ring_size: { system: 'EU', size: 60 }, band_profile: 'flat', band_width: '4 mm', band_thickness: '1.8 mm' })]) {
      const text = await described(tree);
      const [inner, outer, width, thick] = nums(text, /Band: inner diameter (\d+\.\d\d) mm, outer diameter (\d+\.\d\d) mm, (\d+\.\d\d) mm wide, (\d+\.\d\d) mm thick/);
      const m = await measured(tree);
      near(2 * m.rIn, inner!, ACROSS, 'inner diameter');
      near(2 * m.rOut, outer!, ACROSS, 'outer diameter');
      near(m.width, width!, ACROSS, 'band width');
      near(m.rOut - m.rIn, thick!, ACROSS, 'band thickness');
    }
  });
});

describe("describe_piece reports a bezel's seat, wall, lip and outside (the moonstone: US 9, 14k, 7.5 mm round 4 mm deep, 1.0 mm wall)", () => {
  it('the seat is 7.6 mm across with 0.05 mm a side, the bezel 9.6 mm across, and each figure is what was built', async () => {
    const tree = MOONSTONE();
    const text = await described(tree);
    const [seat] = nums(text, /Seat: (\d+\.\d\d) mm across inside the bezel at the girdle/);
    const [clear] = nums(text, /Seat: [^\n]*?(\d+\.\d\d) mm clearance a side/);
    const [wall, outside] = nums(text, /Bezel: wall (\d+\.\d\d) mm thick and (\d+\.\d\d) mm across outside/);
    const [lip, crown] = nums(text, /lip rises (\d+\.\d\d) mm above the girdle \((?:auto|set): \d+ % of the stone's (\d+\.\d\d) mm crown\)/);
    const [stands] = nums(text, /stands (\d+\.\d\d) mm above the top of the band/);
    const [culet] = nums(text, /Culet clearance: (\d+\.\d\d) mm/);

    // The numbers the chat needed, as the engine builds them (build.ts: inner wall 0.05 mm off the girdle).
    assert.equal(seat, 7.6);
    assert.equal(clear, 0.05);
    assert.equal(outside, 9.6);
    assert.equal(wall, 1.0);

    const m = await measured(tree);
    const st = m.stone!;
    const top = zRange(m.b.metal)[1];
    // Inside the lip, from the stone's axis out to the bezel's inner wall, four ways.
    const zIn = st.girdleTop + (top - st.girdleTop) / 2;
    const acrossX = inside(m.b.metal, zIn, 0);
    const acrossY = inside(m.b.metal, zIn, 1);
    near(acrossX, seat!, ACROSS, 'seat across the hand');
    near(acrossY, seat!, ACROSS, 'seat along the finger');
    near((acrossX - 7.5) / 2, clear!, ONE_SIDE, 'seat clearance a side');
    // From outside, just under the bezel's top, in to its outer wall.
    const zOut = top - 0.1;
    const outX = across(m.b.metal, [0, 0, zOut], 0);
    const outY = across(m.b.metal, [0, 0, zOut], 1);
    near(outX, outside!, ACROSS, 'bezel outside across the hand');
    near(outY, outside!, ACROSS, 'bezel outside along the finger');
    near((outX - acrossX) / 2, wall!, ONE_SIDE, 'bezel wall');
    near(top - st.girdleTop, lip!, ONE_SIDE, 'lip above the girdle');
    near(st.table - st.girdleTop, crown!, ONE_SIDE, "stone's crown");
    near(top - m.rOut, stands!, ONE_SIDE, 'bezel height above the band');
    near(st.culet - m.rOut, culet!, ONE_SIDE, 'culet clearance');
  });

  it('the lip says whether it is auto, and a set lip is reported as set', async () => {
    const auto = await described(MOONSTONE());
    assert.match(auto, /lip rises 0\.63 mm above the girdle \(auto: 60 % of the stone's 1\.05 mm crown\)/);
    const set = await described(applySet(MOONSTONE(), { bezel_lip: '0.7 mm' }).tree);
    assert.match(set, /lip rises 0\.70 mm above the girdle \(set: 67 % of the stone's 1\.05 mm crown\)/);
  });

  it("an emerald cut's seat and outside are length × width, measured both ways (Emily's preset)", async () => {
    const tree = treeFromTemplate('emerald_bezel_solitaire', { ring_size: { system: 'US', size: '6.5' }, name: 'emily' });
    const text = await described(tree);
    const [sl, sw] = nums(text, /Seat: (\d+\.\d\d) × (\d+\.\d\d) mm across inside the bezel at the girdle/);
    const [, ol, ow] = nums(text, /Bezel: wall (\d+\.\d\d) mm thick and (\d+\.\d\d) × (\d+\.\d\d) mm across outside/);
    assert.deepEqual([sl, sw], [8.6, 6.1]);
    const m = await measured(tree);
    const st = m.stone!;
    const top = zRange(m.b.metal)[1];
    const zIn = st.girdleTop + (top - st.girdleTop) / 2;
    // East-west: the long side runs across the hand (X).
    near(inside(m.b.metal, zIn, 0), sl!, ACROSS, 'seat length');
    near(inside(m.b.metal, zIn, 1), sw!, ACROSS, 'seat width');
    near(across(m.b.metal, [0, 0, top - 0.1], 0), ol!, ACROSS, 'outside length');
    near(across(m.b.metal, [0, 0, top - 0.1], 1), ow!, ACROSS, 'outside width');
    near(extent(m.b.metal, 1), ow!, ACROSS, 'outside width (the head is the widest metal along the finger)');
  });
});

describe('describe_piece reports a prong head: the seat, each prong at its narrowest, the reach and the culet clearance', () => {
  const cases: [string, () => PieceTree][] = [
    ['the solitaire, US 7, 4 prongs', () => treeFromTemplate('solitaire_ring', { ring_size: { system: 'US', size: '7' }, name: 'sol' })],
    ['one prong thinned to 0.7 mm', () => applySet(treeFromTemplate('solitaire_ring', { ring_size: { system: 'US', size: '7' }, name: 'thin' }), { 'head.prong_overrides': [{ prong: 2, thickness: '0.7 mm' }] }).tree],
    [
      'an emerald cut north-south in 6 prongs',
      () => applySet(treeFromTemplate('emerald_bezel_solitaire', { ring_size: { system: 'US', size: '7' }, name: 'ns' }), { stone_setting: 'prong_head', stone_orientation: 'north_south', prong_count: 6 }).tree,
    ],
  ];
  for (const [name, make] of cases) {
    it(name, async () => {
      const tree = make();
      const text = await described(tree);
      const seat = nums(text, /Seat: (\d+\.\d\d)(?: × (\d+\.\d\d))? mm across at the girdle/).filter((x) => !Number.isNaN(x));
      const [clear] = nums(text, /Seat: [^\n]*?(\d+\.\d\d) mm clearance a side/);
      const [reach] = nums(text, /reaches (\d+\.\d\d) mm in over the girdle/);
      const [culet] = nums(text, /Culet clearance: (\d+\.\d\d) mm/);
      const head = nums(text, /head is (\d+\.\d\d)(?: × (\d+\.\d\d))? mm across at its widest/).filter((x) => !Number.isNaN(x));
      // Each prong's narrowest section: one figure for all, or prong by prong.
      const count = /Prongs: (\d)/.exec(text) ? Number(/Prongs: (\d)/.exec(text)![1]) : 0;
      assert.ok(count === 4 || count === 6, `describe_piece does not say how many prongs; it said:\n${text.slice(0, 1500)}`);
      const each = /each (\d+\.\d\d) mm thick and (\d+\.\d\d) mm at its narrowest/.exec(text);
      const narrowest: number[] = each
        ? Array.from({ length: count }, () => Number(each[2]))
        : [...text.matchAll(/prong (\d) at \d+:\d\d is (\d+\.\d\d) mm thick and (\d+\.\d\d) mm at its narrowest/g)].map((x) => Number(x[3]));
      assert.equal(narrowest.length, count, `describe_piece reports ${narrowest.length} prongs' narrowest sections, not ${count}`);

      const m = await measured(tree);
      const st = m.stone!;
      const stone = readPiece(tree).head!.stone;
      // The seat: from the stone's axis, through the middle of the girdle, out to a prong's cut face.
      const zG = (st.girdleBottom + st.girdleTop) / 2;
      if (stone.shape === 'round') {
        const ax = m.b.decl.prongs[0]!.axis;
        const toFace = first(m.b.metal, [0, 0, zG], [ax[0] / Math.hypot(...ax), ax[1] / Math.hypot(...ax), 0]);
        near(2 * toFace, seat[0]!, ACROSS, 'seat across, at the first prong');
        near(toFace - stone.lengthMm / 2, clear!, ONE_SIDE, 'seat clearance a side');
      } else {
        // North-south in 6 prongs: two prongs stand at the middles of the long sides, across the hand.
        const w = inside(m.b.metal, zG, 0);
        near(w, seat[1]!, ACROSS, "seat width, between the long sides' prongs");
        near((w - stone.widthMm) / 2, clear!, ONE_SIDE, 'seat clearance a side');
        assert.equal(seat[0], Math.round((stone.lengthMm + 2 * clear!) * 100) / 100);
      }
      near(st.culet - m.rOut, culet!, ONE_SIDE, 'culet clearance');
      // The head's widest metal along the finger (the band is narrower there): a round's diameter, a north-south emerald's length.
      near(extent(m.b.metal, 1), head[0]!, ACROSS, 'head across at its widest');

      // The independent checker's measurement of the written file.
      const r = await checkPiece(tree, 'check');
      const prong = r.entries.find((e) => e.id === 'prong')!;
      const measuredEach = [...prong.measured!.matchAll(/prong (\d+) (\d+\.\d+)/g)].map((x) => Number(x[2]));
      assert.equal(measuredEach.length, count);
      measuredEach.forEach((v, i) => near(v, narrowest[i]!, ACROSS, `prong ${i + 1}'s narrowest section`));
      near(r.entries.find((e) => e.id === 'prong_grip')!.value!, reach!, ONE_SIDE, 'reach over the girdle');
    });
  }
});

describe('start_piece and change_piece say the seat and the outside in one short line', () => {
  it('the moonstone bezel', async () => {
    const s = new Session();
    const r = await s.call('start_piece', {
      template: 'solitaire_ring',
      ring_size: { system: 'US', size: '9' },
      metal: 'gold_14k_yellow',
      stone_setting: 'bezel',
      stone_diameter: '7.5 mm',
      stone_depth: '4 mm',
      bezel_wall: '1.0 mm',
      preview: false,
    });
    const text = r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
    assert.match(text, /Seat 7\.60 mm across, 0\.05 mm clearance a side; bezel 9\.60 mm across outside/);
    const c = await s.call('change_piece', { set: { bezel_wall: '1.2 mm' }, preview: false });
    const ctext = c.content.map((x) => (x.type === 'text' ? x.text : '')).join('\n');
    assert.match(ctext, /Seat 7\.60 mm across, 0\.05 mm clearance a side; bezel 10\.00 mm across outside/);
  });
  it('a plain band has no seat line', async () => {
    const r = await new Session().call('start_piece', { template: 'plain_band', ring_size: { system: 'US', size: '7' }, preview: false });
    const text = r.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
    assert.doesNotMatch(text, /Seat /);
  });
});
