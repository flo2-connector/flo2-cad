// DESCRIBE_PIECE NAMES A PROGRAM'S OWN NAMED SHAPES, BY THE NAMES A CHECK REPORT NAMES THEM BY
// (flo2-cad fact:describe-piece-lists-only-a-programs-library-parts-not-its-named-shapes-2026-11-07).
//
// A failing check names a place by the part whose faces hold it: a library part (band, head,
// bezel), a program shape's .named("...") name, a smooth blend's { name }, or an op(node)'s id
// (test/part-names.test.ts). describe_piece used to report only the library parts and the stones,
// so flo2, which maps a piece's parts to the design's components by what describe_piece reports,
// refused every named shape: two chats in CAD step 7 (2026-11-07) could not record which
// component "cup", "petals" or "rails" realizes, though a failing check named each of them.
// Now describe_piece lists every shape the program names that is part of the piece it returns,
// one line each, and the piece's summary (start_piece, change_piece, preview, describe) says them.
// A shape named and then left out of the returned piece is not listed: it is not in the piece.
// Observed failing on main 89a1a94 before the change (see the PR).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPiece } from '../src/engine.js';
import { programPiece } from '../src/piece/program.js';
import type { ProgramLimits } from '../src/program/run.js';
import { Session } from '../src/session.js';

const QUICK: ProgramLimits = { seconds: 3, memoryMiB: 256 };
const SHANK = "const band = ringShank({ ring_size: { system: 'US', size: '7' }, band_width: 2.2, band_thickness: 1.6 });";

/** A flower on a band: a cup, its petals and a stem joined by a named blend, a flange added as a tree node, and a spare shape named but never used. */
const FLOWER = [
  SHANK,
  "const cup = cylinder(3, 2).translate([0, 0, 11]).named('cup');",
  "const petals = union(box(8, 1.2, 1.2), box(1.2, 8, 1.2)).translate([0, 0, 12.4]).named('petals');",
  "const stem = smoothUnion(0.4, cylinder(0.9, 2).translate([0, 0, 9.4]), sphere(1.2).translate([0, 0, 11]), { name: 'stem_join' });",
  "const flange = op({ id: 'flange', op: 'translate', params: { z: '10.6 mm' }, children: [{ id: 'flange_disc', op: 'cylinder', params: { radius: '3.6 mm', height: '0.9 mm' } }] });",
  "const spare = sphere(2).translate([20, 0, 0]).named('spare');",
  'return union(band, cup, petals, stem, flange);',
].join('\n');

const texts = (r: { content: { type: string; text?: string }[] }) => r.content.filter((b) => b.type === 'text').map((b) => b.text!);

/** The shapes describe_piece's named-shape lines report, as flo2 reads them: `- Shape "x"` / `- Smooth blend "x"`. */
const namedLines = (all: string[]) => [...all.join('\n').matchAll(/^- (Shape|Smooth blend) "([a-z][a-z0-9_]*)"$/gm)].map((m) => `${m[1]} ${m[2]}`);

describe("describe_piece names a program's own named shapes", () => {
  it('lists each shape the returned piece holds, by its name, one line each; a shape named but left out is not listed', async () => {
    const s = new Session(QUICK);
    const start = await s.call('start_piece', { program: FLOWER, name: 'flower', preview: false });
    assert.equal(start.isError, false, texts(start).join('\n'));
    const d = await s.call('describe_piece', {});
    assert.equal(d.isError, false);
    const all = texts(d);
    // In the order the returned piece joins them.
    assert.deepEqual(namedLines(all), ['Shape cup', 'Shape petals', 'Smooth blend stem_join', 'Shape flange']);
    const block = all.find((t) => t.startsWith('Shapes the program names'));
    assert.ok(block, 'describe_piece has a block of the shapes the program names');
    assert.match(block!, /a check report names a place on each by the same name/);
    assert.doesNotMatch(all.join('\n'), /"spare"/, 'a shape named but not in the returned piece is not reported');
    // The summary every reply leads with says them too, after the library parts.
    assert.match(all[0]!, /: a ring shank, US size 7 [^;]*; the shapes it names: "cup", "petals", "stem_join", "flange"\. Shrinkage allowance/);
    assert.match(texts(start)[0]!, /the shapes it names: "cup", "petals", "stem_join", "flange"/);
  });

  it('every name a failing check gives a part is one describe_piece reports', async () => {
    const thin = `${SHANK}\nconst fin = box(0.5, 2, 2).translate([0, 0, 11]).named('fin');\nconst rib = smoothUnion(0.3, cylinder(0.25, 3).translate([2, 0, 10]), sphere(0.4).translate([2, 0, 13]), { name: 'rib' });\nreturn union(band, fin, rib);`;
    const r = await checkPiece(programPiece(thin, { name: 'p' }), 'check');
    const named = new Set(r.entries.flatMap((e) => [e.part, ...e.failing.map((f) => f.part)]).filter((x): x is string => !!x && !['band', 'head', 'bezel'].includes(x)));
    assert.ok(named.has('fin'), `a failing check names the fin (it names: ${[...named].join(', ')})`);
    const s = new Session(QUICK);
    await s.call('start_piece', { program: thin, name: 'p', preview: false });
    const reported = namedLines(texts(await s.call('describe_piece', {}))).map((x) => x.replace(/^(Shape|Smooth blend) /, ''));
    for (const n of named) assert.ok(reported.includes(n), `"${n}", named by a failing check, is reported by describe_piece (${reported.join(', ')})`);
  });

  it("a named cutter is listed: the cut's faces carry its name, so a check can name a place on them", async () => {
    const s = new Session(QUICK);
    await s.call('start_piece', { program: `${SHANK}\nreturn band.subtract(cylinder(0.6, 4, { center: true }).rotate([90, 0, 0]).translate([0, 0, 9.5]).named('hole'));`, name: 'cut', preview: false });
    assert.deepEqual(namedLines(texts(await s.call('describe_piece', {}))), ['Shape hole']);
  });

  it('a program with no named shape reads as before: no block, and the summary unchanged', async () => {
    const s = new Session(QUICK);
    await s.call('start_piece', { program: 'return union(sphere(3), cylinder(1.5, 6));', name: 'plain', preview: false });
    const all = texts(await s.call('describe_piece', {}));
    assert.equal(all.find((t) => t.startsWith('Shapes the program names')), undefined);
    assert.match(all[0]!, /written as a program, in [^:]+: shapes of its own \(no library part\)\. Shrinkage allowance/);
    assert.deepEqual(namedLines(all), []);
  });
});
