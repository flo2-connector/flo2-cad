// LIMITS FOLLOW THE PIECE'S MATERIAL, PROCESS AND SIZE, AS NAMED PROFILES
// (req:limits-follow-the-material-process-and-size; dec:idea-limit-profiles-by-material-process-and-size,
// accepted 2026-11-04, options (a) and (b)).
//
// Pinned here, through the tool surface (the Session, as flo2's door and a laptop reach it):
//   · today's limits are the FIRST named profile, "precious metals cast by lost wax, at jewelry
//     scale", each limit and its size range cited, and rings check exactly as main 362c473 did:
//     the same readings, verdicts, fixes and report, the report and replies only adding the
//     profile's name and where the limits came from;
//   · a piece states its material (one of the four metals by its id, or any other by name) and
//     its process; one that states no process is checked as lost wax, and the reply says so;
//     its size is measured from the model (the largest side of its bounding box);
//   · no profile covering all three means NO VERDICT, naming which did not match and how to
//     go on, and never another profile's numbers; export refuses without a verdict;
//   · a piece may carry limits the person supplies, each with its source, kept in its file;
//     they are used in place of a profile's, and every check and export names them as the
//     person's; a supplied set missing a limit or a source is refused by its field path.
// Observed failing on main 362c473 before the change (see the PR): a 300 mm silver box passed
// every check against jewelry limits, and "material", "process" and "limits" were refused.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { Session } from '../src/session.js';
import { TOOLS } from '../src/tools.js';

const FIXTURE = new URL('../../test/fixtures/main-362c473-replies.json', import.meta.url);
const PROFILE_NAME = 'precious metals cast by lost wax, at jewelry scale';

type Block = { type: string; text?: string; resource?: { uri: string; mimeType: string; blob: string } };
type Reply = { content: Block[]; isError?: boolean };
type Report = Record<string, any>;

const textsOf = (r: Reply) => r.content.filter((b) => b.type === 'text').map((b) => b.text!);
const text = (r: Reply) => textsOf(r).join('\n');
const fileNames = (r: Reply) => r.content.filter((b) => b.type === 'resource').map((b) => b.resource!.uri);
function reportOf(r: Reply): Report {
  const b = r.content.find((x) => x.type === 'resource' && x.resource!.uri.endsWith('.check.json'));
  assert.ok(b, `no check report in the reply:\n${text(r)}`);
  return JSON.parse(Buffer.from(b.resource!.blob, 'base64').toString('utf8')) as Report;
}

async function call(s: Session, tool: string, args: Record<string, unknown>): Promise<Reply> {
  return (await s.call(tool, args)) as unknown as Reply;
}

/** A session holding a program piece, started with these settings. */
async function program(src: string, settings: Record<string, unknown>): Promise<{ s: Session; started: Reply }> {
  const s = new Session();
  const started = await call(s, 'start_piece', { program: src, preview: false, ...settings });
  return { s, started };
}

/** Limits a person supplies for a piece, each with its source (no person or firm is named in a public test). */
function supplied(over: Record<string, unknown> = {}): Record<string, unknown> {
  const src = "the foundry's design guide for this alloy, rev. 3, 2026-10-01";
  return {
    wall: { value: '1.5 mm', source: src },
    band: { value: '1.8 mm', source: src },
    prong: { value: '1.6 mm', source: src },
    detail: { value: '0.5 mm', source: src },
    gap: { value: '0.6 mm', source: "the caster's written figures, 2026-10-30" },
    surface_deviation: { value: '0.01 mm', source: 'the printer maker\'s stated XY accuracy' },
    shrinkage: { value: '1.4 %', source: "the caster's written figures, 2026-10-30" },
    ...over,
  };
}

// ------------------------------------------------------------ the first profile

describe('today\'s limits are the first named profile, every limit cited', () => {
  it('precious metals cast by lost wax, at jewelry scale: the four metals, lost wax, a cited size range, each limit with its source', async () => {
    const P = await import(new URL('../src/limits/profiles.js', import.meta.url).href).catch((e: Error) => assert.fail(`src/limits/profiles.ts does not exist: ${e.message}`));
    const profile = (P.PROFILES as any[])[0];
    assert.equal(profile.name, PROFILE_NAME);
    assert.deepEqual(Object.keys(profile.materials).sort(), ['gold_14k_yellow', 'gold_18k_yellow', 'platinum_950', 'sterling_silver_925']);
    assert.deepEqual(profile.processes, ['lost_wax']);
    assert.equal(profile.size.minMm.value, 2.4);
    assert.equal(profile.size.maxMm.value, 88);
    assert.match(profile.size.maxMm.source, /Maximum part dimensions.*88 x 88 x 125 mm/);
    assert.match(profile.size.maxMm.source, /Maximum Bounding Box 89 × 89 × 100 mm/);
    assert.match(profile.size.minMm.source, /Minimum Bounding Box 2\.4 × 2\.4 × 0\.6 mm/);
    const engine = await import(new URL('../src/engine.js', import.meta.url).href);
    const { METALS } = await import(new URL('../src/metals.js', import.meta.url).href);
    for (const [id, m] of Object.entries(profile.materials) as [string, any][]) {
      for (const k of ['wall', 'band', 'prong', 'detail', 'gap', 'surfaceDeviation']) {
        assert.equal(typeof m.limits[k].value, 'number', `${id}.${k}`);
        assert.ok(/https?:\/\/|con:/.test(m.limits[k].source), `${id}.${k} cites no source: ${m.limits[k].source}`);
        // What the checker reads for that metal is the profile's figure.
        assert.equal(engine.limitsFor(METALS[id])[k], m.limits[k].value, `${id}.${k}`);
      }
      assert.equal(m.shrinkagePct.value, 1.5);
      assert.match(m.shrinkagePct.source, /shapeways/i);
    }
    // The values main 362c473 held, per metal: platinum's gap is Stuller's 0.8 mm.
    assert.deepEqual(engine.limitsFor(METALS.platinum_950), { wall: 0.8, band: 1, prong: 1, detail: 0.35, gap: 0.8, surfaceDeviation: 0.01, gripMin: 0.15, lipMinOfCrown: 0.5, lipMaxOfCrown: 0.75, lipMinOfCabochon: 1 / 3 });
    assert.deepEqual(engine.limitsFor(METALS.sterling_silver_925), { wall: 0.8, band: 1, prong: 1, detail: 0.35, gap: 0.3, surfaceDeviation: 0.01, gripMin: 0.15, lipMinOfCrown: 0.5, lipMaxOfCrown: 0.75, lipMinOfCabochon: 1 / 3 });
  });

  it('a silver piece within the range is checked against the profile, and the report and reply name it', async () => {
    const { s } = await program('return box(80, 20, 10);', { name: 'bar' });
    const r = await call(s, 'check_piece', {});
    const rep = reportOf(r);
    assert.equal(rep['verdict'], 'pass');
    assert.equal(rep['limits_from']?.kind, 'profile');
    assert.equal(rep['limits_from'].name, PROFILE_NAME);
    assert.equal(rep['limits_from'].size.largest_mm, 80);
    assert.deepEqual(rep['limits_from'].size.range_mm, [2.4, 88]);
    assert.match(text(r), /from the limit profile "precious metals cast by lost wax, at jewelry scale"/);
  });
});

// ------------------------------------------------------------- the process

describe('a piece states its process; left out, lost wax is assumed and the reply says so', () => {
  it('no process stated: checked as lost wax, and the check and the export say it was assumed', async () => {
    const { s } = await program('return box(20, 10, 5);', { name: 'plain' });
    const r = await call(s, 'check_piece', {});
    const rep = reportOf(r);
    assert.equal(rep['verdict'], 'pass');
    assert.deepEqual({ id: rep['limits_from'].process.id, stated: rep['limits_from'].process.stated }, { id: 'lost_wax', stated: false });
    assert.match(text(r), /lost wax \(assumed: the piece states no process/);
    assert.match(text(await call(s, 'export_for_casting', {})), /lost wax \(assumed: the piece states no process/);
  });

  it('"lost_wax" stated: no assumption to report', async () => {
    const { s, started } = await program('return box(20, 10, 5);', { name: 'stated', process: 'lost_wax' });
    assert.equal(started.isError, false, text(started));
    const r = await call(s, 'check_piece', {});
    assert.equal(reportOf(r)['limits_from'].process.stated, true);
    assert.doesNotMatch(text(r), /assumed/);
  });

  it('a process no profile covers gets no verdict, naming the process', async () => {
    const { s, started } = await program('return box(20, 10, 5);', { name: 'sand', process: 'sand casting' });
    assert.equal(started.isError, false, text(started));
    const r = await call(s, 'check_piece', {});
    const rep = reportOf(r);
    assert.equal(rep['verdict'], 'no_verdict');
    assert.deepEqual(rep['limits_from'].unmatched[0].did_not_match, ['process']);
    assert.match(text(r), /NO VERDICT/);
    assert.match(text(r), /sand casting/);
  });
});

// ------------------------------------------------------------ no verdict

describe('no profile covering the material, process and size means no verdict, and no export', () => {
  it('a silver piece far larger than jewelry scale gets no verdict, naming its size; export refuses', async () => {
    const { s } = await program('return box(300, 40, 40);', { name: 'big', metal: 'sterling_silver_925' });
    const r = await call(s, 'check_piece', {});
    const rep = reportOf(r);
    assert.equal(rep['verdict'], 'no_verdict', 'main 362c473 judged a 300 mm silver box against jewelry limits');
    assert.deepEqual(rep['checks'], [], 'no other profile\'s numbers are applied');
    assert.equal(rep['limits'], null);
    assert.equal(rep['limits_from'].kind, 'none');
    assert.deepEqual(rep['limits_from'].unmatched[0].did_not_match, ['size']);
    assert.equal(rep['limits_from'].size.largest_mm, 300);
    const t = text(r);
    assert.match(t, /^NO VERDICT: flo2-cad has no cited casting limits for this piece's material, process and size together/);
    assert.match(t, /300 mm at its largest/);
    assert.match(t, /2\.4 to 88 mm/);
    assert.match(t, /How to go on:/);
    assert.doesNotMatch(t, /PASS|FAIL/);
    const e = await call(s, 'export_for_casting', {});
    assert.equal(e.isError, false);
    assert.deepEqual(fileNames(e), ['cadfile:///big.check.json']);
    assert.match(text(e), /^NOT EXPORTED: "big" revision 1 has no verdict/);
    assert.equal(reportOf(e)['export'], 'refused');
  });

  it('a piece in a material no profile covers gets no verdict, naming the material; export refuses', async () => {
    const { s, started } = await program('return box(20, 10, 5);', { name: 'bronze', material: 'bronze' });
    assert.equal(started.isError, false, text(started));
    assert.match(text(started), /in bronze/);
    const r = await call(s, 'check_piece', {});
    const rep = reportOf(r);
    assert.equal(rep['verdict'], 'no_verdict');
    assert.deepEqual(rep['limits_from'].unmatched[0].did_not_match, ['material']);
    assert.equal(rep['weight_g'], null, 'no density is claimed for a material the engine does not know');
    assert.match(text(r), /bronze/);
    const e = await call(s, 'export_for_casting', {});
    assert.deepEqual(fileNames(e), ['cadfile:///bronze.check.json']);
    assert.match(text(e), /NOT EXPORTED/);
  });

  it('a template ring in bronze gets no verdict too, and every unmatched part is named', async () => {
    const s = new Session();
    const started = await call(s, 'start_piece', { template: 'plain_band', ring_size: { system: 'US', size: '7' }, name: 'bronze-band', material: 'bronze', process: 'ceramic shell', preview: false });
    assert.equal(started.isError, false, text(started));
    const rep = reportOf(await call(s, 'check_piece', {}));
    assert.equal(rep['verdict'], 'no_verdict');
    assert.deepEqual(rep['limits_from'].unmatched[0].did_not_match, ['material', 'process']);
    const d = text(await call(s, 'describe_piece', {}));
    assert.match(d, /no cited casting limits/);
  });

  it('shrinkage "on" in a material no profile covers is refused, naming the field, unless supplied limits give it', async () => {
    const s = new Session();
    const bad = await call(s, 'start_piece', { program: 'return box(20, 10, 5);', material: 'bronze', shrinkage: 'on', preview: false });
    assert.equal(bad.isError, true);
    assert.match(text(bad), /shrinkage: "on" uses the cited allowance/);
    const ok = await call(s, 'start_piece', { program: 'return box(20, 10, 5);', material: 'bronze', shrinkage: 'on', limits: supplied(), preview: false });
    assert.equal(ok.isError, false, text(ok));
    assert.equal(reportOf(await call(s, 'check_piece', {}))['shrinkage'].allowance, '1.4 %');
  });

  it('metal or material, not both', async () => {
    const s = new Session();
    const r = await call(s, 'start_piece', { program: 'return box(20, 10, 5);', metal: 'sterling_silver_925', material: 'bronze', preview: false });
    assert.equal(r.isError, true);
    assert.match(text(r), /^Malformed call\. material: give metal or material, not both/);
  });
});

// -------------------------------------------------------- supplied limits

describe("limits the person supplies, with their sources, are used in place of a profile's and named as theirs", () => {
  it('a bronze piece with supplied limits gets a verdict, and the check and the export name them, with their sources', async () => {
    const { s, started } = await program('return box(20, 10, 5);', { name: 'cast-bronze', material: 'bronze', limits: supplied() });
    assert.equal(started.isError, false, text(started));
    // Kept in the piece's own file.
    const file = JSON.parse(Buffer.from(started.content.find((b) => b.resource?.uri === 'cadfile:///cast-bronze.tree.json')!.resource!.blob, 'base64').toString('utf8'));
    assert.deepEqual(file.limits, supplied());
    const r = await call(s, 'check_piece', {});
    const rep = reportOf(r);
    assert.equal(rep['verdict'], 'pass');
    assert.equal(rep['limits_from'].kind, 'supplied');
    assert.equal(rep['limits_from'].each.gap.source, "the caster's written figures, 2026-10-30");
    assert.equal(rep['limits'].wall, 1.5);
    assert.ok((rep['limits'].sources as string[]).some((x) => x.includes("the foundry's design guide for this alloy")));
    assert.match(text(r), /against the limits supplied with the piece/);
    assert.match(text(r), /Limits: the person's own, supplied with the piece/);
    const e = await call(s, 'export_for_casting', {});
    assert.deepEqual(fileNames(e).sort(), ['cadfile:///cast-bronze.3mf', 'cadfile:///cast-bronze.check.json', 'cadfile:///cast-bronze.stl']);
    assert.match(text(e), /Limits: the person's own, supplied with the piece/);
    assert.match(text(e), /walls 1\.5 mm \(the foundry's design guide/);
    assert.equal(reportOf(e)['limits_from'].kind, 'supplied');
  });

  it('they are held to their own numbers: a wall under the supplied 1.5 mm fails, naming it', async () => {
    const { s } = await program('return box(20, 10, 1.2);', { name: 'thin-bronze', material: 'bronze', limits: supplied() });
    const r = await call(s, 'check_piece', {});
    assert.equal(reportOf(r)['verdict'], 'fail');
    assert.match(text(r), /a wall needs 1\.5 mm/);
  });

  it('on a silver piece past the profile\'s size, supplied limits are used in its place', async () => {
    const { s } = await program('return box(300, 40, 40);', { name: 'big-own', limits: supplied() });
    const rep = reportOf(await call(s, 'check_piece', {}));
    assert.equal(rep['verdict'], 'pass');
    assert.equal(rep['limits_from'].kind, 'supplied');
  });

  it('change_piece sets them on a ring, and the ring is then held to them', async () => {
    const s = new Session();
    await call(s, 'start_piece', { template: 'plain_band', ring_size: { system: 'US', size: '7' }, name: 'own-band', preview: false });
    const c = await call(s, 'change_piece', { set: { limits: supplied() }, preview: false });
    assert.equal(c.isError, false, text(c));
    const r = await call(s, 'check_piece', {});
    // The band is 1.6 mm thick; the supplied band limit is 1.8 mm.
    assert.equal(reportOf(r)['verdict'], 'fail');
    assert.match(text(r), /a band needs 1\.8 mm/);
  });

  it('a supplied set missing a source, or a limit, or a unit, is refused by its field path', async () => {
    const s = new Session();
    const noSource = await call(s, 'start_piece', { program: 'return box(20, 10, 5);', material: 'bronze', limits: supplied({ gap: { value: '0.6 mm' } }), preview: false });
    assert.equal(noSource.isError, true);
    assert.match(text(noSource), /^Malformed call\. limits\.gap\.source: /);
    const { band: _band, ...noBand } = supplied();
    const missing = await call(s, 'start_piece', { program: 'return box(20, 10, 5);', material: 'bronze', limits: noBand, preview: false });
    assert.equal(missing.isError, true);
    assert.match(text(missing), /^Malformed call\. limits\.band: /);
    const bare = await call(s, 'start_piece', { program: 'return box(20, 10, 5);', material: 'bronze', limits: supplied({ wall: { value: 1.5, source: 'x' } }), preview: false });
    assert.match(text(bare), /^Malformed call\. limits\.wall\.value: /);
    const empty = await call(s, 'start_piece', { program: 'return box(20, 10, 5);', material: 'bronze', limits: supplied({ detail: { value: '0.5 mm', source: '  ' } }), preview: false });
    assert.match(text(empty), /^Malformed call\. limits\.detail\.source: /);
    // In a piece's file passed back as "tree", the path starts at the tree.
    const file = { format: 'flo2-cad.program/1', name: 'p', revision: 1, material: 'bronze', shrinkage: 'off', units: 'mm', program: 'return box(20, 10, 5);', limits: supplied({ prong: { value: '1.6 mm' } }) };
    const t = await call(s, 'check_piece', { tree: file });
    assert.equal(t.isError, true);
    assert.match(text(t), /^Malformed call\. tree\.limits\.prong\.source: /);
  });
});

// --------------------------------------------------------- the tool surface

describe('the tools describe a general cast-piece engine, with jewelry its first profile and layer', () => {
  it('start_piece and change_piece take material, process and limits; check_piece says what a profile is and when there is no verdict', () => {
    const start = TOOLS.find((t) => t.name === 'start_piece')!;
    for (const k of ['metal', 'material', 'process', 'limits']) assert.ok((start.inputSchema.properties as Record<string, unknown>)[k], `start_piece takes ${k}`);
    const set = (TOOLS.find((t) => t.name === 'change_piece')!.inputSchema.properties as Record<string, { properties: Record<string, unknown> }>)['set']!;
    for (const k of ['material', 'process', 'limits']) assert.ok(set.properties[k], `change_piece's set takes ${k}`);
    const check = TOOLS.find((t) => t.name === 'check_piece')!.description!;
    assert.match(check, /limit profile/);
    assert.match(check, /no verdict/i);
  });
});

// ------------------------------------------------ rings check exactly as before

/** What main 362c473 replied, for each case, against what this engine replies now. */
describe('rings check exactly as main 362c473 did: the same readings, verdicts, fixes, report and replies, adding only where the limits came from', () => {
  const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    cases: { name: string; calls: { tool: string; args: Record<string, unknown> }[]; replies: { tool: string; isError: boolean; texts: string[]; report: Report | null; files: string[] }[] }[];
  };
  // The engine's version is in every STL's header (so in its checksum) and in the report.
  const sha = (t: string) => t.replace(/sha256 [0-9a-f]{12}\.\.\./g, 'sha256 <the file>...');
  const DESCRIBE_DROP = ["Settings change_piece can set:", "A tree's parts:", 'A shape the parts and operations above cannot make', 'This piece is written as a program.', "The piece's tree, revision", "The piece's file, revision"];
  const nowTexts = (tool: string, texts: string[]) =>
    texts
      .filter((t) => !t.startsWith('Limits: ') && !(tool === 'describe_piece' && DESCRIBE_DROP.some((d) => t.startsWith(d))))
      .map((t) => sha(t.replace(/, from the limit profile "precious metals cast by lost wax, at jewelry scale"/g, '')));
  const norm = (rep: Report | null) => {
    if (!rep) return rep;
    const c = structuredClone(rep);
    delete c['timing_ms'];
    c['engine'].version = '<version>';
    if (c['stl']) c['stl'].sha256 = '<the file>';
    if (c['program']) c['program'].evaluated = '<evaluated>';
    return c;
  };
  for (const g of golden.cases) {
    it(g.name, async () => {
      const s = new Session();
      for (const [i, c] of g.calls.entries()) {
        const want = g.replies[i]!;
        const r = await call(s, c.tool, structuredClone(c.args));
        assert.equal(r.isError ?? false, want.isError, `${c.tool}: ${text(r)}`);
        assert.deepEqual(fileNames(r), want.files, c.tool);
        assert.deepEqual(nowTexts(c.tool, textsOf(r)), want.texts.map(sha), `${c.tool}'s reply`);
        if (want.report) {
          const rep = reportOf(r);
          assert.equal(rep['limits_from']?.kind, 'profile', `${c.tool}: the report names where its limits came from`);
          assert.equal(rep['limits_from'].name, PROFILE_NAME);
          const { limits_from: _, ...rest } = rep;
          assert.deepEqual(norm(rest), norm(want.report), `${c.tool}'s report`);
        }
      }
    });
  }
});
