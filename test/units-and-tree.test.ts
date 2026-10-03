// Units and the piece tree: refusals name the field path (ver:unit-refusal-check),
// ring sizes in each system, a tree round-trips, and the head and stone are
// parameters of one tree.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallError } from '../src/errors.js';
import { applySet, checkStartArgs, readPiece, treeFromTemplate, validateTree } from '../src/piece/tree.js';
import { caratText, lengthMm, ringInnerDiameterMm } from '../src/units.js';

const refuses = (fn: () => unknown, path: string, words: RegExp) => {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof CallError, `expected a CallError, got ${String(e)}`);
    assert.equal(e.path, path);
    assert.match(e.problem, words);
    return true;
  });
};

describe('units', () => {
  it('turns each ring-size system into an inner diameter in mm', () => {
    assert.equal(ringInnerDiameterMm({ system: 'US', size: '7' }, 'x').diameterMm, 17.32);
    assert.equal(ringInnerDiameterMm({ system: 'US', size: 7.5 }, 'x').diameterMm, 17.726);
    assert.equal(ringInnerDiameterMm({ system: 'EU', size: 54 }, 'x').diameterMm, 17.189);
    // BS 6820: C = 40 mm circumference, 1.25 mm per letter, so N = 53.75 mm (Goldsmiths: 53.8).
    assert.equal(ringInnerDiameterMm({ system: 'UK', size: 'N' }, 'x').diameterMm, 17.109);
    assert.equal(ringInnerDiameterMm({ system: 'UK', size: 'N½' }, 'x').diameterMm, 17.308);
  });
  it('takes mm only, and shows the conversion when refusing another unit', () => {
    assert.equal(lengthMm('1.2 mm', 'x'), 1.2);
    refuses(() => lengthMm(1.2, 'a.b'), 'a.b', /1\.2 has no unit/);
    refuses(() => lengthMm('1.2', 'a.b'), 'a.b', /has no unit/);
    refuses(() => lengthMm('0.12 cm', 'p'), 'p', /0\.12 cm × 10 = 1\.2 mm/);
    refuses(() => lengthMm('0.05 in', 'p'), 'p', /0\.05 in × 25\.4 = 1\.27 mm/);
  });
  it('refuses a ring size with no system, or an unknown one', () => {
    refuses(() => ringInnerDiameterMm({ size: '7' }, 'ring_size'), 'ring_size.system', /must name its system/);
    refuses(() => ringInnerDiameterMm({ system: 'JP', size: '13' }, 'ring_size'), 'ring_size.system', /US.*UK.*EU/);
    refuses(() => ringInnerDiameterMm({ system: 'US', size: '17' }, 'ring_size'), 'ring_size.size', /3 to 16/);
  });
  it('keeps a carat weight for reference only, with its unit', () => {
    assert.equal(caratText('2.00 ct', 'x'), '2 ct');
    refuses(() => caratText('2', 'stone_carat'), 'stone_carat', /"ct"/);
  });
});

describe('the piece tree', () => {
  const us7 = { ring_size: { system: 'US', size: '7' } };

  it('round-trips through JSON unchanged and valid', () => {
    for (const tpl of ['solitaire_ring', 'plain_band', 'emerald_bezel_solitaire'] as const) {
      const t = treeFromTemplate(tpl, us7);
      const back = JSON.parse(JSON.stringify(t));
      assert.deepEqual(validateTree(back), t);
    }
  });

  it("Emily's preset: emerald cut, full bezel, Pt950, east-west, round band, with placeholder stone sizes", () => {
    const v = readPiece(treeFromTemplate('emerald_bezel_solitaire', us7));
    assert.equal(v.metal, 'platinum_950');
    assert.equal(v.profile, 'round');
    assert.equal(v.head?.kind, 'bezel');
    assert.equal(v.head?.stone.shape, 'emerald');
    assert.equal(v.head?.stone.orientation, 'east_west');
    assert.deepEqual([v.head?.stone.lengthMm, v.head?.stone.widthMm, v.head?.stone.depthMm], [8.5, 6, 4.1]);
    assert.deepEqual(v.head?.stone.placeholder, ['length', 'width', 'depth', 'carat']);
  });

  it('a plain band, a 4- or 6-prong head and a bezel are parameters of one tree', () => {
    let t = treeFromTemplate('solitaire_ring', us7);
    assert.equal(readPiece(t).head?.kind, 'prong_head');
    t = applySet(t, { prong_count: 6 }).tree;
    assert.equal(readPiece(t).head?.kind === 'prong_head' && readPiece(t).head?.kind && (readPiece(t).head as { prongCount: number }).prongCount, 6);
    t = applySet(t, { stone_setting: 'bezel', bezel_wall: '1.2 mm' }).tree;
    assert.equal(readPiece(t).head?.kind, 'bezel');
    t = applySet(t, { stone_setting: 'none' }).tree;
    assert.equal(readPiece(t).head, undefined);
    assert.equal(t.revision, 4);
  });

  it('measured stone sizes clear the placeholder, one dimension at a time', () => {
    let t = treeFromTemplate('emerald_bezel_solitaire', us7);
    t = applySet(t, { stone_length: '8.21 mm', stone_width: '6.02 mm' }).tree;
    assert.deepEqual(readPiece(t).head?.stone.placeholder, ['depth', 'carat']);
    t = applySet(t, { stone_depth: '4.05 mm', stone_carat: '2.01 ct' }).tree;
    assert.deepEqual(readPiece(t).head?.stone.placeholder, []);
  });

  it('refuses wrong settings, naming the field path', () => {
    const t = treeFromTemplate('solitaire_ring', us7);
    refuses(() => applySet(t, { prong_thickness: 1.4 }), 'set.prong_thickness', /has no unit/);
    refuses(() => applySet(t, { stone_length: '8 mm' }), 'set.stone_length', /round/);
    refuses(() => applySet(t, { bezel_wall: '1 mm' }), 'set.bezel_wall', /prong head/);
    refuses(() => checkStartArgs({ template: 'solitaire_ring', ring_size: { system: 'US', size: '7' }, bezel_wall: '1 mm' }), 'bezel_wall', /no bezel/);
    refuses(() => checkStartArgs({ template: 'emerald_bezel_solitaire', ring_size: { system: 'US', size: '7' }, stone_length: '6 mm', stone_width: '8 mm' }), 'stone_width', /SHORT side/);
    const bad = JSON.parse(JSON.stringify(treeFromTemplate('emerald_bezel_solitaire', us7)));
    bad.root.children[1].params.stone.width = 6;
    refuses(() => validateTree(bad), 'tree.root.children[1].params.stone.width', /6 has no unit/);
  });

  it('validates the general operations, including sweeps and smooth blends', () => {
    const t = treeFromTemplate('plain_band', us7);
    t.root.children!.push({
      id: 'charm',
      op: 'smooth_union',
      params: { radius: '0.4 mm' },
      children: [
        { id: 'b1', op: 'sphere', params: { radius: '1 mm' } },
        { id: 'w1', op: 'sweep', params: { radius: '0.5 mm', path: [['0 mm', '0 mm', '0 mm'], ['2 mm', '0 mm', '1 mm']] } },
      ],
    });
    assert.ok(validateTree(t));
    const bad = structuredClone(t);
    bad.root.children![1]!.children![0]!.op = 'extrude';
    refuses(() => validateTree(bad), 'tree.root.children[1].children[0]', /smooth_union can blend only/);
  });
});
