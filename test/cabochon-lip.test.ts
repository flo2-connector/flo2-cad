// A CABOCHON IN A BEZEL IS CHECKED BY ITS OWN LIP RULE
// (dec:a-cabochon-bezel-has-its-own-lip-rule-from-a-cited-reference, accepted 2026-10-05).
//
// The faceted stone's rule, a lip covering 50-75 % of the crown (Revere, JCK 2010), refuses
// a common low cabochon bezel. PR #12's moonstone passed it only because its auto lip, 60 %
// of a 2.6 mm dome, happened to fall inside it. A stone DECLARED a cabochon (cabochon(), or
// stone(..., { kind: 'cabochon' })) is held to the cabochon's own rule from a cited source:
// the bezel rises at least a third of the stone's height, its dome above the girdle. That is
// the stricter end of J. Cogswell's "a third to a quarter" (Creative Stonesetting, metals.ts
// SETTING). Pinned here:
//   · a low bezel at about a third of the dome passes, round or oval;
//   · one too low fails, naming the lip, what to change in mm, and the source;
//   · the engine never guesses a cabochon from the shape: undeclared, the faceted rule holds;
//   · faceted stones read exactly as main fff1d99 read them;
//   · PR #12's cabochon program, as it was written, still passes.
// Observed failing on main fff1d99 before the change (cabochon() and kind did not exist).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { checkPiece } from '../src/engine.js';
import { programPiece, validatePiece } from '../src/piece/program.js';
import { treeFromTemplate } from '../src/piece/tree.js';
import { ProgramFailed, runProgram } from '../src/program/run.js';

const FIXTURE = new URL('../../test/fixtures/cabochon-in-bezel.tree.json', import.meta.url);

type Outcome = Awaited<ReturnType<typeof checkPiece>>;
const failing = (r: Outcome) => r.entries.filter((e) => e.result !== 'pass').map((e) => `${e.id}: ${e.measured}`);
const lipOf = (r: Outcome) => r.entries.find((e) => e.id === 'bezel_lip')!;
const readings = (r: Outcome) => r.entries.map((e) => [e.id, e.result, e.value ?? null, e.measured]);

/** A cabochon in a bezel on a US 7 band, as the worked example sets it. */
const onBand = (stone: string, lip: string) => `
  const band = ringShank({ ring_size: { system: 'US', size: '7' }, band_width: 2.2, band_thickness: 1.6 });
  const cab = ${stone};
  return union(band, bezel({ stone: cab, on: band, wall: 1.0, lip: ${lip} }));`;

/** The worked example's dome (a quarter ellipse turned round z), as a program draws it. */
const dome = (r: number, h: number, opts: string, shape = '') => `(() => {
    const n = Math.ceil(segments(${r}) / 4), profile = [[0, 0]];
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; profile.push([${r} * Math.cos(a), ${h} * Math.sin(a)]); }
    return stone(revolve(polygon(profile))${shape}, ${opts});
  })()`;

/** PR #12's worked example exactly as it was merged (fff1d99): its stone is not declared a cabochon. */
const PR12_PROGRAM = String.raw`// An 8 mm round cabochon moonstone, 2.6 mm high, in a bezel on a US 7 band.
const band = ringShank({ ring_size: { system: 'US', size: '7' }, band_width: 2.2, band_thickness: 1.6 });

// The cabochon: a quarter ellipse from its edge up to its top, turned round the Z axis.
const r = 4, h = 2.6, n = Math.ceil(segments(r) / 4);
const profile = [[0, 0]];
for (let i = 0; i <= n; i++) {
  const a = (i / n) * Math.PI / 2;
  profile.push([r * Math.cos(a), h * Math.sin(a)]);
}
const moonstone = stone(revolve(polygon(profile)), { name: 'moonstone' });

// The bezel seats it on a flat ledge and rises over its curve.
const setting = bezel({ stone: moonstone, on: band, wall: 1.0 });
return union(band, setting);`;

async function refusal(source: string): Promise<string> {
  try {
    await runProgram(source, [{ tol: 0.03, scale: 1 }], { seconds: 10, memoryMiB: 512 });
  } catch (e) {
    if (e instanceof ProgramFailed) return e.plain;
    throw e;
  }
  assert.fail(`the program was not refused:\n${source}`);
}

describe('a cabochon in a bezel is checked by its own lip rule (J. Cogswell, Creative Stonesetting)', () => {
  it('a low bezel, about a third of a round cabochon\'s 3 mm dome, passes every check and exports', async () => {
    const r = await checkPiece(programPiece(onBand(`cabochon({ diameter: 8, height: 3, name: 'moonstone' })`, '1.05'), { name: 'low' }), 'export');
    assert.deepEqual(failing(r), []);
    assert.equal(r.report['export'], 'released');
    const lip = lipOf(r);
    assert.equal(lip.value, 1.05);
    assert.equal(lip.measured, '1.05 mm above the girdle, 35 % of the 3 mm dome');
    assert.equal(lip.limit, "at least a third of the cabochon's 3 mm dome (at least 1 mm for this stone; J. Cogswell, Creative Stonesetting)");
    assert.match(lip.method, /declared a cabochon/);
  });

  it('so does an oval one, declared through stone(..., { kind: "cabochon" }), and the library\'s oval cabochon() reads the same', async () => {
    // 10 x 8 mm, 3.2 mm high, its long side along the finger; the lip 1.1 mm, 34 % of the dome.
    const ownOval = onBand(dome(5, 3.2, "{ name: 'oval', kind: 'cabochon' }", '.scale([1, 0.8, 1]).rotate([0, 0, 90])'), '1.1');
    const lib = onBand(`cabochon({ length: 10, width: 8, height: 3.2, orientation: 'north_south', name: 'oval' })`, '1.1');
    const [a, b] = [await checkPiece(programPiece(ownOval, { name: 'own' }), 'check'), await checkPiece(programPiece(lib, { name: 'lib' }), 'check')];
    assert.deepEqual(failing(a), []);
    assert.equal(lipOf(a).measured, '1.1 mm above the girdle, 34 % of the 3.2 mm dome');
    assert.deepEqual(readings(b), readings(a), 'cabochon() is the dome a program draws itself');
  });

  it('a lip too low by the rule fails, naming the lip, what to change in mm, and the source', async () => {
    // 0.6 mm on a 3 mm dome is 20 %, below even Cogswell's floor of a quarter.
    const r = await checkPiece(programPiece(onBand(`cabochon({ diameter: 8, height: 3 })`, '0.6'), { name: 'too_low' }), 'export');
    assert.deepEqual(failing(r), ['bezel_lip: 0.6 mm above the girdle, 20 % of the 3 mm dome']);
    assert.equal(r.report['export'], 'refused');
    const lip = lipOf(r);
    assert.equal(lip.result, 'fail');
    assert.equal(
      (lip as { fix?: string }).fix,
      'Raise the bezel lip: it rises 0.6 mm above the girdle, and a cabochon\'s bezel must rise at least a third of its 3 mm dome, 1 mm, to be pushed over the stone and hold it (J. Cogswell, Creative Stonesetting). In the program, set lip in its bezel call to 1.1 mm or more (or "auto").',
    );
    // Between a quarter and a third (0.9 mm, 30 %) also fails: the stricter third is the rule.
    const between = await checkPiece(programPiece(onBand(`cabochon({ diameter: 8, height: 3 })`, '0.9'), { name: 'between' }), 'check');
    assert.equal(lipOf(between).result, 'fail');
    assert.equal(lipOf(between).measured, '0.9 mm above the girdle, 30 % of the 3 mm dome');
  });

  it('the engine never guesses a cabochon from its shape: the same low bezel round an undeclared dome is held to the faceted rule', async () => {
    const r = await checkPiece(programPiece(onBand(dome(4, 3, "{ name: 'moonstone' }"), '1.05'), { name: 'undeclared' }), 'check');
    const lip = lipOf(r);
    assert.equal(lip.result, 'fail');
    assert.equal(lip.limit, '50-75 % of the crown (1.5 mm to 2.25 mm for this stone)');
    assert.equal(lip.measured, '1.05 mm above the girdle, 35 % of the 3 mm crown');
  });

  it('cabochon() and kind refuse what they cannot read, naming the field', async () => {
    assert.match(await refusal(`return stone(sphere(3), { kind: 'round' });`), /stone\.options\.kind: is "cabochon" .* or "faceted"/);
    assert.match(await refusal(`return cabochon({ diameter: 8 });`), /cabochon\.height: give the dome's height, measured from the flat base to the top of the dome/);
    assert.match(await refusal(`return cabochon({ length: 10, height: 3 });`), /cabochon\.width: give the flat base measured across/);
    assert.match(await refusal(`return cabochon({ diameter: 8, length: 10, width: 8, height: 3 });`), /cabochon: give a round cabochon its diameter, or an oval one its length and width/);
    assert.match(await refusal(`return cabochon({ length: 8, width: 10, height: 3 });`), /cabochon\.width: the width is the SHORT side/);
    assert.match(await refusal(`return cabochon({ diameter: '0.3 in', height: 3 });`), /cabochon\.diameter: .*mm/);
  });
});

describe('faceted stones read exactly as before (main fff1d99)', () => {
  // Every reading main fff1d99 gave each piece, taken before the change.
  const PINNED: [string, () => ReturnType<typeof treeFromTemplate>, unknown[][], string | null][] = [
    [
      'the solitaire, US 7, 4 prongs',
      () => treeFromTemplate('solitaire_ring', { ring_size: { system: 'US', size: '7' }, name: 'sol' }),
      [
        ['watertight', 'pass', null, 'closed and manifold, 1 shell, consistently wound, no self-intersection, volume 279.488 mm³'],
        ['wall', 'pass', 1.434, '1.434 mm'],
        ['detail', 'pass', 0.963, '0.963 mm (the thinnest feature anywhere)'],
        ['band', 'pass', 1.595, '1.595 mm'],
        ['prong', 'pass', 1.17, '1.17 mm (prong 1 of 4); each: prong 1 1.17, prong 2 1.17, prong 3 1.17, prong 4 1.17 mm'],
        ['prong_grip', 'pass', 0.191, '0.191 mm (prong 1 of 4)'],
        ['gap', 'pass', 1.552, '1.552 mm'],
        ['surface_deviation', 'pass', 0.008, '0.008 mm (checked at 14404 points of a 0.0015 mm reference)'],
      ],
      null,
    ],
    [
      "Emily's emerald-cut bezel solitaire, US 6.5, in platinum",
      () => treeFromTemplate('emerald_bezel_solitaire', { ring_size: { system: 'US', size: '6.5' }, name: 'emily' }),
      [
        ['watertight', 'pass', null, 'closed and manifold, 1 shell, consistently wound, no self-intersection, volume 411.427 mm³'],
        ['wall', 'pass', 0.998, '0.998 mm'],
        ['detail', 'pass', 0.998, '0.998 mm (the thinnest feature anywhere)'],
        ['band', 'pass', 1.994, '1.994 mm'],
        ['bezel_wall', 'pass', 0.998, '0.998 mm'],
        ['bezel_lip', 'pass', 0.65, '0.65 mm above the girdle, 60 % of the 1.087 mm crown'],
        ['gap', 'pass', 1.604, '1.604 mm'],
        ['surface_deviation', 'pass', 0.004, '0.004 mm (checked at 12058 points of a 0.0015 mm reference)'],
      ],
      '50-75 % of the crown (0.544 mm to 0.815 mm for this stone)',
    ],
    [
      'the round bezel (the moonstone: US 9, 14k, 7.5 mm round 4 mm deep, 1.0 mm wall)',
      () =>
        treeFromTemplate('solitaire_ring', {
          ring_size: { system: 'US', size: '9' },
          name: 'moonstone',
          metal: 'gold_14k_yellow',
          stone_setting: 'bezel',
          stone_diameter: '7.5 mm',
          stone_depth: '4 mm',
          bezel_wall: '1.0 mm',
        }),
      [
        ['watertight', 'pass', null, 'closed and manifold, 1 shell, consistently wound, no self-intersection, volume 391.735 mm³'],
        ['wall', 'pass', 0.999, '0.999 mm'],
        ['detail', 'pass', 0.999, '0.999 mm (the thinnest feature anywhere)'],
        ['band', 'pass', 1.595, '1.595 mm'],
        ['bezel_wall', 'pass', 0.999, '0.999 mm'],
        ['bezel_lip', 'pass', 0.63, '0.63 mm above the girdle, 60 % of the 1.052 mm crown'],
        ['gap', 'pass', 1.917, '1.917 mm'],
        ['surface_deviation', 'pass', 0.007, '0.007 mm (checked at 11934 points of a 0.0015 mm reference)'],
      ],
      '50-75 % of the crown (0.526 mm to 0.789 mm for this stone)',
    ],
  ];
  for (const [what, tree, expected, lipLimit] of PINNED) {
    it(`${what}: every reading, and the lip's limit, as main read them`, async () => {
      const r = await checkPiece(tree(), 'check');
      assert.deepEqual(readings(r), expected);
      if (lipLimit) assert.equal(lipOf(r).limit, lipLimit);
      assert.equal(r.verdict, 'pass');
    });
  }
});

describe("PR #12's cabochon program", () => {
  it('as it was written (its stone undeclared), still passes, reading as main read it', async () => {
    const r = await checkPiece(programPiece(PR12_PROGRAM, { name: 'cab' }), 'export');
    assert.deepEqual(failing(r), []);
    assert.equal(r.report['export'], 'released');
    assert.equal(lipOf(r).measured, '1.56 mm above the girdle, 60 % of the 2.6 mm crown');
    assert.equal(lipOf(r).limit, '50-75 % of the crown (1.3 mm to 1.95 mm for this stone)');
  });
  it('the worked example now declares its moonstone a cabochon, and passes by the cabochon\'s rule', async () => {
    const p = validatePiece(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    const r = await checkPiece(p, 'check');
    assert.deepEqual(failing(r), []);
    assert.equal(lipOf(r).measured, '1.56 mm above the girdle, 60 % of the 2.6 mm dome');
    assert.equal(lipOf(r).limit, "at least a third of the cabochon's 2.6 mm dome (at least 0.867 mm for this stone; J. Cogswell, Creative Stonesetting)");
    // Declaring it changed nothing but the rule: every other reading is main's.
    const undeclared = await checkPiece(programPiece(PR12_PROGRAM, { name: 'cab' }), 'check');
    const others = (x: Outcome) => readings(x).filter(([id]) => id !== 'bezel_lip');
    assert.deepEqual(others(r), others(undeclared));
  });
});
