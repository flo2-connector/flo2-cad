// A PROGRAM THAT CUTS AWAY A LIBRARY PART'S METAL IS REFUSED WHEN IT IS BUILT, NOT ONLY WHEN IT IS CHECKED
// (flo2-cad fact:root-cause-a-cut-library-part-was-said-only-at-the-check-2026-11-09).
//
// A library part declares where its metal is (ringShank a whole band, prongHead each prong's
// column, bezel its wall, thicken its sheet), and a check of a program's piece runs only when
// the piece holds that metal (verify.ts, declarationProblems): a cut part would be measured
// as what it no longer is, and a forged declaration as what it never was. That test ran only
// in the check. start_piece and change_piece built the piece, drew it and kept it, and said
// nothing, though the same test reads the mesh they had just built. In CAD step 7
// (2026-11-09) a chat cut openwork windows into a ringShank, was told nothing, and learned it
// one revision later, when every check of the version read COULD_NOT_RUN. The guide said a
// band may only turn about Y and that scale() and hull() refuse a library part, and nothing
// about cutting one. Now the build says it, in the check's words, and nothing changes; the
// check still tests it, for a piece brought back in a file. A cut that leaves the declared
// metal (a groove round the band) is no cut of it. The check report gives the casting file's
// real triangles when its checks cannot run, where it said 0.
// Observed failing on main a811acf before the change (see the PR).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPiece } from '../src/engine.js';
import { programPiece } from '../src/piece/program.js';
import { PROGRAM_RULES } from '../src/program/guide.js';
import type { ProgramLimits } from '../src/program/run.js';
import { Session } from '../src/session.js';

const QUICK: ProgramLimits = { seconds: 10, memoryMiB: 512 };
const SHANK = "const band = ringShank({ ring_size: { system: 'US', size: '7' }, band_width: 6, band_thickness: 1.6 });";
const SETTING = "const setting = bezel({ stone: cabochon({ length: 8, width: 6, height: 3.5, orientation: 'east_west' }), on: band, wall: 1.0 });";
/** The band opened through at its right side, 90 degrees round from the top, as openwork windows open it. */
const OPENED = [SHANK, SETTING, 'return union(difference(band, box(4, 8, 4).translate([9.5, 0, 0])), setting);'].join('\n');
/** A groove 0.3 mm deep round the outside of the band: the band's own metal is all still there. */
const GROOVED = [SHANK, SETTING, 'return union(difference(band, torus(band.dims.outerDiameterMm / 2, 0.3).rotate([90, 0, 0])), setting);'].join('\n');
const WHOLE = [SHANK, SETTING, 'return union(band, setting);'].join('\n');
/** A prong cut off its head. */
const PRONG_CUT = `const band = ringShank({ ring_size: { system: 'US', size: '7' } });
const ring = union(band, prongHead({ on: band, stone: roundStone({ diameter: 6.5, depth: 4.0 }) }));
return difference(ring, box(4, 4, 30).translate([3.5, 3.5, 12]));`;

const texts = (r: { content: { type: string; text?: string }[] }) => r.content.filter((b) => b.type === 'text').map((b) => b.text!);

describe("a program that cuts away a library part's metal is refused when it is built", () => {
  it('start_piece refuses a band opened through, in the words a check would use, and opens no piece', async () => {
    const s = new Session(QUICK);
    const r = await s.call('start_piece', { program: OPENED, name: 'opened', preview: false });
    assert.equal(r.isError, true, texts(r).join('\n'));
    assert.match(texts(r).join('\n'), /^Malformed call\. program: the piece does not hold what its library parts declared: the ring band \(ringShank\) has no metal 90° round from the top: something cut it there\..* Nothing was changed\.$/s);
    assert.equal((await s.call('check_piece', {})).isError, true, 'no piece was opened');
  });

  it('change_piece refuses it and keeps the piece as it was', async () => {
    const s = new Session(QUICK);
    assert.equal((await s.call('start_piece', { program: WHOLE, name: 'ring', preview: false })).isError, false);
    const r = await s.call('change_piece', { program: OPENED, preview: false });
    assert.equal(r.isError, true, texts(r).join('\n'));
    assert.match(texts(r).join('\n'), /has no metal 90° round from the top.* Nothing was changed\./s);
    const c = await s.call('check_piece', {});
    assert.match(texts(c).join('\n'), /revision 1\b/);
    assert.doesNotMatch(texts(c).join('\n'), /COULD_NOT_RUN/);
  });

  it('a prong cut off its head is refused when built, naming the prong', async () => {
    const r = await new Session(QUICK).call('start_piece', { program: PRONG_CUT, name: 'cut', preview: false });
    assert.equal(r.isError, true);
    assert.match(texts(r).join('\n'), /prong 1 of 4 \(prongHead\) at 1:30 has no metal in its column: something cut it away\..* Nothing was changed\./s);
  });

  it("a cut that leaves the part's declared metal is no cut of it: a grooved band is built, and checked", async () => {
    const s = new Session(QUICK);
    const r = await s.call('start_piece', { program: GROOVED, name: 'grooved', preview: false });
    assert.equal(r.isError, false, texts(r).join('\n'));
    assert.doesNotMatch(texts(await s.call('check_piece', {})).join('\n'), /COULD_NOT_RUN/);
  });

  it('the guide says so before anyone tries, and says how to build a band you cut into', () => {
    const rules = PROGRAM_RULES.join('\n');
    assert.match(rules, /cuts that metal away[^.]*is refused when it is started or changed, naming the part/);
    assert.match(rules, /A band you cut into[^.]*revolve its section round the Y axis/);
  });
});

describe('the check still tests a piece brought back in a file, and its report says the file it wrote', () => {
  it('a cut piece read from a file cannot be checked, and the report gives the casting file its real triangles', async () => {
    const r = await checkPiece(programPiece(PRONG_CUT, { name: 'cut' }), 'check');
    assert.ok(r.entries.every((e) => e.result === 'could_not_run'));
    const stl = r.report['stl'] as { triangles: number; bytes: number };
    assert.ok(stl.triangles > 0, `the report says ${stl.triangles} triangles`);
    assert.equal(stl.triangles, (stl.bytes - 84) / 50, 'the count is the one the STL holds');
  });
});
