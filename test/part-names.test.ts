// A FAILING CHECK SAYS THE PROBLEM IN A MAKER'S TERMS AND NAMES THE PART IT IS IN
// (integrated-flo epoch:planned-the-physical-piece-loop-runs-like-a-well-oiled-machine, step 5;
// ifc:solid-mesh: "each face tagged by the part feature it came from").
//
// A place the checker reports (a thin wall, the finest detail, a narrow gap, a surface reading)
// is named by the part whose faces hold it, by that part's own name: a tree node's id (a shape
// added beside the band and head), a program shape's .named("...") name, or the library's part
// (the band, the head, the bezel, prong N of M, the stone seat). It is never guessed from the
// region round it: named by region, a point on the moonstone ring's openwork blend was called
// "the bezel" (flo2-cad fact:surface-check-named-a-blend-point-the-bezel-2026-10-05, the surface
// reading fixed by PR #13, the wall, detail and gap readings left named by region). Where the
// file's faces come from no named part, the report says so ("in no named part") and names none.
// Each failing check carries `part` and a `problem` in plain words, and the refusal says it.
// Observed failing on main e316d60 before the change (see the PR).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPiece } from '../src/engine.js';
import { programPiece } from '../src/piece/program.js';
import { applySet, treeFromTemplate, type PieceTree } from '../src/piece/tree.js';
import { Session } from '../src/session.js';

type Outcome = Awaited<ReturnType<typeof checkPiece>>;
type Entry = Outcome['entries'][number] & { part?: string | null; problem?: string | null };
type Where = NonNullable<Entry['where']> & { part_name?: string | null; other_parts?: string[] };
const entry = (r: Outcome, id: string) => r.entries.find((e) => e.id === id) as Entry;
const where = (e: Entry) => e.where as Where;

const ring = (template: string, set: Record<string, unknown> = {}, name = 'n'): PieceTree => {
  const t = treeFromTemplate(template as never, { ring_size: { system: 'US', size: '7' }, name });
  return Object.keys(set).length ? applySet(t, set).tree : t;
};

/** A plain band with a 0.5 mm plate standing on its top, added as the tree node `id`. */
function bandWithFin(id: string): PieceTree {
  const t = ring('plain_band', {}, 'fin');
  t.root.children!.push({ id, op: 'translate', params: { z: '11 mm' }, children: [{ id: `${id}_plate`, op: 'box', params: { x: '0.5 mm', y: '2 mm', z: '2 mm' } }] });
  return t;
}

const SHANK = "const band = ringShank({ ring_size: { system: 'US', size: '7' }, band_width: 2.2, band_thickness: 1.6 });";
const SIDE = '(on the (left|right) of|on the (fingertip|hand) side of)';

describe('a failing place is named by the part that holds it, in a maker\'s words', () => {
  it('a bezel too thin: the bezel wall check names "bezel" and says where on it, in a jeweler\'s words; so does the refusal', async () => {
    const r = await checkPiece(ring('emerald_bezel_solitaire', { bezel_wall: '0.6 mm' }), 'export');
    const bz = entry(r, 'bezel_wall');
    assert.equal(bz.result, 'fail');
    assert.equal(bz.part, 'bezel');
    assert.equal(where(bz).part_name, 'bezel');
    assert.match(bz.problem ?? '', new RegExp(`^The bezel wall is 0\\.\\d+ mm at its thinnest, ${SIDE} the bezel(, toward the (fingertip|hand))? \\(at \\d+:\\d\\d seen from above, the finger pointing to 12\\); it must be at least \\d(\\.\\d+)? mm\\.$`));
    // The wall check that tripped on the same rim names the same part.
    const wall = entry(r, 'wall');
    assert.equal(wall.result, 'fail');
    assert.equal(wall.part, 'bezel');
    const s = new Session();
    await s.call('start_piece', { template: 'emerald_bezel_solitaire', ring_size: { system: 'US', size: '7' }, name: 'thinbezel', bezel_wall: '0.6 mm', preview: false });
    const reply = (await s.call('export_for_casting', {})) as unknown as { content: { type: string; text?: string }[] };
    const words = reply.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    assert.match(words, /NOT EXPORTED/);
    assert.match(words, /The bezel wall is 0\.\d+ mm at its thinnest, .*of the bezel/);
  });

  it('a prong too thin: the prong check names "prong 2 of 4", on the check and on its failing prong', async () => {
    const r = await checkPiece(ring('solitaire_ring', { 'head.prong_overrides': [{ prong: 2, thickness: '0.7 mm' }] }), 'export');
    const prong = entry(r, 'prong');
    assert.equal(prong.result, 'fail');
    assert.equal(prong.part, 'prong 2 of 4');
    assert.deepEqual(
      (prong.failing as (NonNullable<Entry['failing']>[number] & { part?: string | null })[]).map((f) => f.part),
      ['prong 2 of 4'],
    );
    assert.match(prong.problem ?? '', /^Prong 2 of 4 \(at 4:30\) is 0\.\d+ mm across at its narrowest; a prong must be at least 1(\.0)? mm\.$/);
    // The finest detail is on the same prong, at its seat: named by the prong, so it needs no second fix.
    const detail = entry(r, 'detail');
    assert.equal(detail.result, 'fail');
    assert.equal(detail.part, 'prong 2 of 4');
    assert.equal(detail.fix, null);
  });

  it('a plate too thin added to a band is named by its tree node id, and the advice reaches it', async () => {
    const r = await checkPiece(bandWithFin('fin'), 'check');
    const wall = entry(r, 'wall');
    assert.equal(wall.result, 'fail');
    assert.ok(Math.abs(wall.value! - 0.5) < 0.01, `wall ${wall.value}`);
    assert.equal(wall.part, 'fin');
    assert.equal(where(wall).part, 'added shape');
    assert.match(wall.problem ?? '', /^The wall of "fin" is 0\.(5|49\d) mm at its thinnest, (where it meets the band, )?at \[.*\] mm; it must be at least 0\.8 mm\.$/);
    assert.match(wall.fix ?? '', /"fin"/);
    assert.equal(entry(r, 'band').part, 'band');
  });

  it('a 0.2 mm slot sawn in a block on the band is named by the block, across the slot', async () => {
    const t = ring('plain_band', {}, 'slot');
    t.root.children!.push({
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
    const r = await checkPiece(t, 'check');
    const gap = entry(r, 'gap');
    assert.equal(gap.result, 'fail');
    assert.equal(gap.part, 'block');
    assert.deepEqual(where(gap).other_parts, []);
    assert.match(gap.problem ?? '', /^A gap in "block" is only 0\.2 mm across, at \[.*\] mm; it must be at least 0\.3 mm, or closed\.$/);
  });

  it('a program\'s shape named with .named("fin") is named "fin"', async () => {
    const r = await checkPiece(programPiece(`${SHANK}\nreturn union(band, box(0.5, 2, 2).translate([0, 0, 11]).named('fin'));`, { name: 'p' }), 'check');
    const wall = entry(r, 'wall');
    assert.equal(wall.result, 'fail');
    assert.equal(wall.part, 'fin');
    assert.match(wall.problem ?? '', /The wall of "fin" is 0\.(5|49\d) mm/);
    assert.match(wall.fix ?? '', /"fin"/);
  });

  it('a program\'s shape with no name: the report says the place is in no named part, and guesses none', async () => {
    const r = await checkPiece(programPiece(`${SHANK}\nreturn union(band, box(0.5, 2, 2).translate([0, 0, 11]));`, { name: 'p' }), 'check');
    const wall = entry(r, 'wall');
    assert.equal(wall.result, 'fail');
    assert.equal(wall.part, null);
    assert.equal(where(wall).part_name, null);
    assert.equal(where(wall).part, 'piece');
    assert.match(wall.problem ?? '', /^The wall is 0\.(5|49\d) mm at its thinnest, in no named part, (where it meets the band, )?at \[.*\] mm; it must be at least 0\.8 mm\.$/);
    assert.match(wall.fix ?? '', /\.named\("\.\.\."\)/);
  });

  it('a passing ring names the part of every place it reports: the band, the head, a prong', async () => {
    const r = await checkPiece(ring('solitaire_ring'), 'check');
    assert.equal(r.verdict, 'pass');
    assert.equal(entry(r, 'band').part, 'band');
    assert.match(entry(r, 'prong').part ?? '', /^prong \d of 4$/);
    for (const e of r.entries as Entry[]) {
      assert.equal(e.problem, null, `${e.id} passes, so it states no problem`);
      if (e.where) assert.ok('part_name' in e.where, `${e.id}: where.part_name is said`);
    }
  });
});
