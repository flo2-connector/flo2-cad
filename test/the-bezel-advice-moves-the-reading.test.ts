// THE ADVICE FOR A FAILING BEZEL NAMES THE CHANGE THAT MOVES ITS READING
//
// On flo2.io (2026-11-12, flo2-cad 0.4.4) a chat set an oval moonstone cabochon (8 x 6 mm,
// 3.5 mm dome) in a bezel that stands free of the band, as an openwork ring holds it. The
// bezel wall check read 0.584 mm and the reply said "In the program, set wall in its bezel call
// to at least 1.4 mm". The chat did; the reading stayed 0.584 mm, and the next reply said
// 1.8 mm. Measured on main 13b8419 with this file's piece: the reading is 0.584 mm at wall 1.0,
// 1.4 and 1.8 mm alike, and 0.584, 0.784 and 0.984 mm at culet_clearance 0.3, 0.5 and 0.7 mm.
// The thin place is not the wall beside the stone: it is the bezel's seat, the floor under the
// stone's edge (the ball the check grows there is centred 0.26 mm inside the girdle and below
// it), whose thickness is the 0.3 mm the bezel reaches below its origin plus the culet
// clearance, less the seat's cut. The check measures the rim "around and above the girdle (its
// own faces and its seat's)", so the seat's floor is in it; the advice named `wall` whatever the
// place was. Pinned here, as a class, not an instance: for a failing bezel, doing exactly what
// the advice says moves the failing reading to the limit.
//   · a free-standing cabochon bezel at the library's defaults, oval and round: the reading is
//     the floor under the stone; the advice names culet_clearance and where the floor is, and
//     following it passes;
//   · a bezel whose wall really is thin: the advice still names wall, and following it passes;
//   · the readings and verdicts are what main 13b8419 read.
// Observed failing on main 13b8419 before the change (see the PR).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPiece } from '../src/engine.js';
import { programPiece } from '../src/piece/program.js';

type Opts = Record<string, number>;

/** A bezel standing on its own (no band), as a pendant's or an openwork ring's bezel stands. */
const program = (stone: string, opts: Opts) => `const s = ${stone};
return bezel({ stone: s, ${Object.entries(opts).map(([k, v]) => `${k}: ${v}`).join(', ')} });`;

const OVAL = "cabochon({ length: 8, width: 6, height: 3.5, name: 'moonstone' })";
const ROUND = "cabochon({ diameter: 8, height: 3, name: 'moonstone' })";

async function bezelCheck(stone: string, opts: Opts) {
  const r = await checkPiece(programPiece(program(stone, opts), { name: 'bezel-advice', metal: 'gold_14k_yellow' }), 'check');
  const e = r.entries.find((x) => x.id === 'bezel_wall');
  assert.ok(e, 'the piece has a bezel wall check');
  return { r, e };
}

/** The bezel call's setting the advice names, and the least value it says to set it to. */
function advised(fix: string): { key: string; to: number } {
  const m = /set (\w+) in its bezel call to at least ([\d.]+) mm/.exec(fix);
  assert.ok(m, `the advice names a setting of the bezel call and a value: ${fix}`);
  return { key: m[1]!, to: Number(m[2]) };
}

/** Check the piece, do what the advice says, and check it again. */
async function followTheAdvice(stone: string, opts: Opts) {
  const before = await bezelCheck(stone, opts);
  assert.equal(before.e.result, 'fail', `the bezel fails as built: ${before.e.measured}`);
  const fix = before.r.fixes.find((f) => /bezel call/.test(f));
  assert.ok(fix, `a fix names the bezel call: ${JSON.stringify(before.r.fixes)}`);
  const { key, to } = advised(fix);
  const after = await bezelCheck(stone, { ...opts, [key]: to });
  return { before, fix, key, to, after };
}

describe('the advice for a failing bezel names the change that moves its reading', () => {
  for (const [name, stone, read] of [['an oval', OVAL, 0.584], ['a round', ROUND, 0.589]] as const) {
    it(`${name} cabochon in a free-standing bezel at the library's defaults: the thin place is the seat's floor, and the advice that thickens it passes`, async () => {
      const { before, fix, key, to, after } = await followTheAdvice(stone, { wall: 1 });
      // The reading main 13b8419 read: the floor under the stone, 0.3 mm below the origin up to the seat.
      assert.equal(before.e.value, read);
      assert.equal(before.e.result, 'fail');
      assert.equal(key, 'culet_clearance', `the advice names what sets the floor's thickness: ${fix}`);
      assert.match(fix, /under the stone/, `the advice says where the thin place is, in a maker's words: ${fix}`);
      assert.match(before.e.problem ?? '', /under the stone/, `the problem says where the thin place is: ${before.e.problem}`);
      assert.match(before.e.where?.description ?? '', /under the stone/, `the place says it is under the stone: ${before.e.where?.description}`);
      assert.ok((after.e.value ?? 0) >= 0.8, `following it (${key} ${to} mm) moves the reading to the limit: it read ${after.e.value} mm`);
      assert.equal(after.e.result, 'pass');
    });
  }

  it('a bezel whose wall is thin: the advice names the wall, and following it passes', async () => {
    const { before, fix, key, to, after } = await followTheAdvice(OVAL, { wall: 0.6, culet_clearance: 0.7 });
    assert.equal(before.e.value, 0.599);
    assert.equal(key, 'wall', fix);
    assert.doesNotMatch(fix, /under the stone/, fix);
    assert.ok((after.e.value ?? 0) >= 0.8, `following it (${key} ${to} mm) moves the reading to the limit: it read ${after.e.value} mm`);
    assert.equal(after.e.result, 'pass');
  });
});
