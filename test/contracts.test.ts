// EACH PUBLISHED CONTRACT HAS A CHECK THAT FAILS ON AN UNDECLARED CHANGE
// (dec:how-interfaces-are-encoded publishes three: the engine's tools, the casting file and its
// check report; integrated-flo epoch:planned-the-physical-piece-loop-runs-like-a-well-oiled-machine,
// step 5, "replies fit and contracts hold").
//
//   · THE TOOLS (ifc:engine-tools-over-mcp): contracts/tools.json says each tool's name,
//     annotations and the shape of its arguments; the shipped server (dist/main.js) must list
//     exactly that in both protocol eras, so a change to the tool surface changes that file on
//     purpose (scripts/contracts.mjs, `npm run contracts`).
//   · THE CHECK REPORT (ifc:check-report): contracts/check-report.schema.json, a JSON Schema
//     every report must meet: here for each kind of report (a pass, a refusal, each check
//     failing, no verdict, supplied limits, a program, a check that could not run), and in
//     every other test by the preload test/hold-reports.ts. Every list the report can carry is
//     present, empty when there is nothing in it (flo2's gateway read a list a report left out as
//     none: flo2 fact:root-cause-a-list-the-report-leaves-out-read-as-none-by-the-check-and-as-
//     not-given-by-its-record-2026-11-03).
//   · THE CASTING FILE (ifc:casting-file): contracts/casting-file.json says what the STL's
//     80-byte header and the 3MF's metadata say: engine and kernel and their versions, the piece,
//     its revision, its metal or material, its process, its shrinkage and the units; files the
//     engine wrote are read back and held to it.
// Observed failing on main e316d60 before the change (see the PR).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import * as engine from '../src/engine.js';
import { checkPiece } from '../src/engine.js';
import { programPiece } from '../src/piece/program.js';
import { applySet, treeFromTemplate, type PieceTree } from '../src/piece/tree.js';
import { Session } from '../src/session.js';
import { ENGINE_VERSION, KERNEL_VERSION } from '../src/version.js';
import { holdToContract, reportProblems } from './report-contract.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONTRACTS = `${ROOT}contracts/`;
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
type Report = Record<string, any>;
type Block = { type: string; text?: string; resource?: { uri: string; mimeType: string; blob: string } };
type Reply = { content: Block[]; isError?: boolean };

// ----------------------------------------------------------------- the tools

describe("the engine's tools (ifc:engine-tools-over-mcp): contracts/tools.json is what the shipped server lists", () => {
  for (const mode of ['legacy', 'modern'] as const) {
    it(`${mode === 'legacy' ? 'the 2025 initialize handshake' : 'the 2026-07-28 era'}: each tool's name, annotations and argument shape are the file's`, async () => {
      assert.ok(existsSync(`${CONTRACTS}tools.json`), 'contracts/tools.json does not exist');
      const { toolContract } = (await import(pathToFileURL(`${ROOT}scripts/contracts.mjs`).href)) as { toolContract: (t: unknown[]) => Record<string, unknown> };
      const client =
        mode === 'legacy'
          ? new Client({ name: 'flo2-cad-contract', version: '0' })
          : new Client({ name: 'flo2-cad-contract', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [`${ROOT}dist/main.js`], stderr: 'pipe' }));
      try {
        const { tools } = await client.listTools();
        assert.deepEqual(
          toolContract(tools),
          json(`${CONTRACTS}tools.json`),
          'the tool surface differs from contracts/tools.json. If the change is meant, it is a change to flo2\'s door too: run `npm run contracts` and commit the file.',
        );
      } finally {
        await client.close();
      }
    });
  }

  it('the comparison sees a change: one more argument, a renamed tool or a tool turned from read to write each differ from the file', async () => {
    const { toolContract } = (await import(pathToFileURL(`${ROOT}scripts/contracts.mjs`).href)) as { toolContract: (t: unknown[]) => Record<string, any> };
    const { TOOLS } = await import('../src/tools.js');
    const file = json(`${CONTRACTS}tools.json`);
    assert.deepEqual(toolContract(structuredClone(TOOLS)), file);
    const more = structuredClone(TOOLS) as any[];
    more[0].inputSchema.properties.colour = { type: 'string' };
    const renamed = structuredClone(TOOLS) as any[];
    renamed[3].name = 'check_it';
    const write = structuredClone(TOOLS) as any[];
    write[3].annotations.readOnlyHint = false;
    for (const t of [more, renamed, write]) assert.notDeepEqual(toolContract(t), file);
    // Prose is not shape: a reworded description is the same contract.
    const reworded = structuredClone(TOOLS) as any[];
    reworded[0].description = 'Begin a piece.';
    reworded[0].inputSchema.properties.name.description = 'Its name.';
    assert.deepEqual(toolContract(reworded), file);
  });
});

// ------------------------------------------------------------ the check report

const ring = (template: string, set: Record<string, unknown> = {}, name = 'c'): PieceTree => {
  const t = treeFromTemplate(template as never, { ring_size: { system: 'US', size: '7' }, name });
  return Object.keys(set).length ? applySet(t, set).tree : t;
};

/** A plain band with a block on top, a 0.2 mm slot sawn into it. */
function slotted(): PieceTree {
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
  return t;
}

/** Limits a person supplies, each with its source (no person or firm is named in a public test). */
function supplied(): Record<string, unknown> {
  const src = "the foundry's design guide for this alloy, rev. 3, 2026-10-01";
  const v = (value: string) => ({ value, source: src });
  return { wall: v('1.0 mm'), band: v('1.2 mm'), prong: v('1.0 mm'), detail: v('0.5 mm'), gap: v('0.5 mm'), surface_deviation: v('0.01 mm'), shrinkage: v('1.6 %') };
}

const SHANK = "const band = ringShank({ ring_size: { system: 'US', size: '7' }, band_width: 2.2, band_thickness: 1.6 });";

/** Every kind of report the engine makes, by what it is. */
const KINDS: { name: string; make: () => Promise<Report> }[] = [
  { name: 'a ring that passes, checked', make: async () => (await checkPiece(ring('solitaire_ring'), 'check')).report },
  { name: 'an emerald bezel solitaire in platinum, exported', make: async () => (await checkPiece(ring('emerald_bezel_solitaire'), 'export')).report },
  { name: 'a plain band in 14k gold, shrinkage on, exported', make: async () => (await checkPiece(ring('plain_band', { metal: 'gold_14k_yellow', shrinkage: 'on' }), 'export')).report },
  { name: 'a too-thin prong, refused', make: async () => (await checkPiece(ring('solitaire_ring', { 'head.prong_overrides': [{ prong: 2, thickness: '0.7 mm' }] }), 'export')).report },
  { name: 'a too-thin bezel wall, failing', make: async () => (await checkPiece(ring('emerald_bezel_solitaire', { bezel_wall: '0.6 mm' }), 'check')).report },
  { name: 'a 0.2 mm slot, failing the gap check', make: async () => (await checkPiece(slotted(), 'check')).report },
  { name: 'a bronze piece: no verdict', make: async () => (await checkPiece(ring('plain_band', { material: 'bronze' }), 'check')).report },
  { name: 'a bronze piece: no verdict, export refused', make: async () => (await checkPiece(ring('plain_band', { material: 'bronze' }), 'export')).report },
  { name: 'a bronze piece with supplied limits', make: async () => (await checkPiece(ring('plain_band', { material: 'bronze', process: 'lost_wax', limits: supplied() }), 'check')).report },
  {
    name: 'a program: a cabochon in a bezel, exported',
    make: async () => (await checkPiece(JSON.parse(readFileSync(`${ROOT}test/fixtures/cabochon-in-bezel.tree.json`, 'utf8')), 'export')).report,
  },
  {
    name: 'a program with a shape too thin, named and not',
    make: async () => (await checkPiece(programPiece(`${SHANK}\nreturn union(band, box(0.5, 2, 2).translate([0, 0, 11]).named('fin'), box(0.5, 2, 2).translate([0, 3, 11]));`, { name: 'p' }), 'check')).report,
  },
  { name: 'a program that cannot run: every check could not run', make: async () => (await checkPiece(programPiece("throw new Error('no');", { name: 'p' }), 'check')).report },
];

describe('the check report (ifc:check-report): every report meets contracts/check-report.schema.json', () => {
  it('the schema is a JSON Schema (2020-12) that compiles, strict', () => {
    assert.ok(existsSync(`${CONTRACTS}check-report.schema.json`), 'contracts/check-report.schema.json does not exist');
    assert.deepEqual(reportProblems({}).length > 0, true, 'an empty object is not a report');
  });

  for (const k of KINDS) {
    it(`${k.name}: the report meets the schema`, async () => {
      const rep = await k.make();
      holdToContract(rep, k.name);
    });
  }

  it('the schema refuses an undeclared change: a field removed, renamed or added, or a list left out', async () => {
    const rep = (await checkPiece(ring('emerald_bezel_solitaire', { bezel_wall: '0.6 mm' }), 'check')).report;
    holdToContract(rep);
    const breaks: [string, (r: Report) => void][] = [
      ['the verdict removed', (r) => delete r['verdict']],
      ['the weight renamed', (r) => ((r['weight_grams'] = r['weight_g']), delete r['weight_g'])],
      ['a field added', (r) => (r['colour'] = 'gold')],
      ["a check's empty failing list left out", (r) => delete r['checks'][0]['failing']],
      ["a place's empty meets list left out", (r) => delete r['checks'].find((c: Report) => c['where'])['where']['meets']],
      ['a failing check with no part', (r) => delete r['checks'].find((c: Report) => c['result'] === 'fail')['part']],
      ['a failing check with no problem in words', (r) => (r['checks'].find((c: Report) => c['result'] === 'fail')['problem'] = null)],
      ["the limits' sources left out", (r) => delete r['limits']['sources']],
      ['the profiles that do not match left out', (r) => delete r['limits_from']['unmatched']],
    ];
    for (const [what, edit] of breaks) {
      const r = structuredClone(rep);
      edit(r);
      assert.ok(reportProblems(r).length > 0, `the schema let through: ${what}`);
    }
  });

  it('every report the engine makes in a test is held to the schema as it is made (test/hold-reports.ts, preloaded by npm test)', () => {
    assert.ok(((engine as Record<string, unknown>)['REPORT_WATCHERS'] as unknown[] | undefined)?.length, 'nothing watches the reports: run the tests through `npm test`, which preloads build/test/hold-reports.js');
  });
});

describe('an empty list is said, never left out', () => {
  it('a passing report: each check carries failing: [], each place meets: [] and other_parts: [], and limits_from carries unmatched: []', async () => {
    const rep = (await checkPiece(ring('solitaire_ring'), 'check')).report as Report;
    for (const c of rep['checks'] as Report[]) {
      assert.deepEqual(c['failing'], [], `${c['id']}: failing`);
      if (c['where']) {
        assert.deepEqual(c['where']['meets'], [], `${c['id']}: where.meets`);
        assert.ok(Array.isArray(c['where']['other_parts']), `${c['id']}: where.other_parts`);
      }
      assert.ok('part' in c && 'problem' in c, `${c['id']}: part and problem are said`);
    }
    assert.deepEqual(rep['limits_from']['unmatched'], []);
    assert.deepEqual(rep['stone']['placeholder'], ['diameter', 'depth', 'carat']);
  });

  it('a no-verdict report says checks: [], the profiles that do not match, and an unmeasured size as an empty bounding box', async () => {
    const rep = (await checkPiece(ring('plain_band', { material: 'bronze' }), 'check')).report as Report;
    assert.deepEqual(rep['checks'], []);
    assert.equal(rep['limits_from']['unmatched'].length, 1);
    const broken = (await checkPiece(programPiece("throw new Error('no');", { name: 'p', material: 'bronze' }), 'check')).report as Report;
    assert.equal(broken['limits_from']['size']['largest_mm'], null);
    assert.deepEqual(broken['limits_from']['size']['bounding_box_mm'], []);
  });
});

// ------------------------------------------------------------ the casting file

/** The 3MF's model XML, out of its zip. */
function modelOf(z: Buffer): string {
  const end = z.length - 22;
  let cd = z.readUInt32LE(end + 16);
  for (let i = 0; i < z.readUInt16LE(end + 10); i++) {
    const csize = z.readUInt32LE(cd + 20), nlen = z.readUInt16LE(cd + 28), off = z.readUInt32LE(cd + 42);
    const name = z.subarray(cd + 46, cd + 46 + nlen).toString();
    if (name === '3D/3dmodel.model') return inflateRawSync(z.subarray(off + 30 + z.readUInt16LE(off + 26), off + 30 + z.readUInt16LE(off + 26) + csize)).toString();
    cd += 46 + nlen;
  }
  throw new Error('no 3D/3dmodel.model in the 3MF');
}

const unxml = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The STL header's fields and the 3MF's metadata, read from the files an export released, against contracts/casting-file.json. */
async function released(piece: Parameters<typeof checkPiece>[0]): Promise<{ header: Record<string, string>; raw: string; meta: Record<string, string>; model: string; report: Report }> {
  assert.ok(existsSync(`${CONTRACTS}casting-file.json`), 'contracts/casting-file.json does not exist');
  const contract = json(`${CONTRACTS}casting-file.json`);
  const r = await checkPiece(piece, 'export');
  assert.equal(r.verdict, 'pass', JSON.stringify(r.entries.filter((e) => e.result !== 'pass')));
  const raw = r.stl!.subarray(0, 80);
  assert.equal(raw.length, contract.stl.header.bytes);
  for (const b of raw) assert.ok(b >= 0x20 && b < 0x7f, `the STL header holds a byte that is not printable ASCII: ${b}`);
  const text = raw.toString('ascii');
  assert.ok(!/^solid/i.test(text), 'the STL header begins with "solid"');
  const m = new RegExp(contract.stl.header.pattern).exec(text);
  assert.ok(m?.groups, `the STL header does not read as contracts/casting-file.json lays it out:\n  ${JSON.stringify(text)}\n  ${contract.stl.header.layout}`);
  const model = modelOf(r.threeMf!);
  assert.match(model, new RegExp(`<model unit="${contract['3mf'].model_unit}"`));
  assert.match(model, new RegExp(`xmlns:${contract['3mf'].namespace.prefix}="${contract['3mf'].namespace.uri.replace(/[.]/g, '\\.')}"`));
  const meta = Object.fromEntries([...model.matchAll(/<metadata name="([^"]+)">([^<]*)<\/metadata>/g)].map((x) => [x[1]!, unxml(x[2]!)]));
  for (const k of Object.keys(contract['3mf'].metadata)) assert.ok(k in meta, `the 3MF's metadata does not say ${k}`);
  return { header: { ...m.groups }, raw: text, meta, model, report: r.report };
}

/** A header word as the contract writes it: whole, or cut to fit and its last character "~". */
function sameOrCut(got: string | undefined, want: string): void {
  assert.ok(got === want || (got !== undefined && got.endsWith('~') && got.length >= 2 && want.startsWith(got.slice(0, -1))), `the STL header says ${JSON.stringify(got)} for ${JSON.stringify(want)}`);
}

describe('the casting file (ifc:casting-file): the STL header and the 3MF metadata say what contracts/casting-file.json says they say', () => {
  it('a ring in 14k gold with the shrinkage allowance on, its process stated: engine, kernel, units, piece, revision, metal, process and shrinkage', async () => {
    const tree = ring('plain_band', { metal: 'gold_14k_yellow', shrinkage: 'on', process: 'lost_wax' }, 'gold-band');
    const { header, meta } = await released(tree);
    assert.deepEqual(header, { engine_version: ENGINE_VERSION, kernel_version: KERNEL_VERSION, units: 'mm', revision: String(tree.revision), shrinkage: '1.5%', material: 'Au585Y', process: 'lost_wax', piece: 'gold-band' });
    assert.equal(meta['flo2:engine'], `flo2-cad ${ENGINE_VERSION}`);
    assert.equal(meta['flo2:kernel'], `manifold-3d ${KERNEL_VERSION}`);
    assert.equal(meta['flo2:piece'], 'gold-band');
    assert.equal(meta['flo2:revision'], String(tree.revision));
    assert.equal(meta['flo2:metal'], 'gold_14k_yellow');
    assert.equal(meta['flo2:material'], '14k yellow gold');
    assert.equal(meta['flo2:process'], 'lost_wax');
    assert.equal(meta['flo2:process_assumed'], 'false');
    assert.equal(meta['flo2:shrinkage'], '1.5 %');
    assert.equal(meta['flo2:units'], 'mm');
    assert.equal(meta['flo2:check_report'], 'gold-band.check.json');
    assert.equal(meta['Title'], 'gold-band');
    assert.equal(meta['Application'], `flo2-cad ${ENGINE_VERSION} (manifold-3d ${KERNEL_VERSION})`);
  });

  it('a long name is cut to fit the 80 bytes, marked "~", and whole in the 3MF; no process stated says lost wax, assumed', async () => {
    const tree = ring('solitaire_ring', {}, 'a-very-long-piece-name-for-the-solitaire-with-its-four-prongs');
    const { header, meta } = await released(tree);
    assert.equal(header['material'], 'Ag925');
    assert.equal(header['process'], 'lost_wax');
    assert.equal(header['shrinkage'], 'off');
    assert.match(header['piece']!, /^a-very-long.*~$/);
    sameOrCut(header['piece'], 'a-very-long-piece-name-for-the-solitaire-with-its-four-prongs');
    assert.equal(meta['flo2:piece'], 'a-very-long-piece-name-for-the-solitaire-with-its-four-prongs');
    assert.equal(meta['flo2:process'], 'lost_wax');
    assert.equal(meta['flo2:process_assumed'], 'true');
    assert.equal(meta['flo2:shrinkage'], 'off');
  });

  it('a bronze piece cast in a ceramic shell, against supplied limits: the material and process in words', async () => {
    const tree = ring('plain_band', { material: 'silicon bronze', process: 'ceramic shell', limits: supplied(), shrinkage: 'on' }, 'bronze-band');
    const { header, meta } = await released(tree);
    assert.equal(header['shrinkage'], '1.6%');
    sameOrCut(header['material'], 'silicon_bronze');
    sameOrCut(header['process'], 'ceramic_shell');
    sameOrCut(header['piece'], 'bronze-band');
    assert.equal(meta['flo2:metal'], 'none');
    assert.equal(meta['flo2:material'], 'silicon bronze');
    assert.equal(meta['flo2:process'], 'ceramic shell');
  });

  it('a piece written as a program: the same header and metadata', async () => {
    const piece = JSON.parse(readFileSync(`${ROOT}test/fixtures/cabochon-in-bezel.tree.json`, 'utf8'));
    const { header, meta } = await released(piece);
    assert.deepEqual([header['engine_version'], header['kernel_version'], header['units'], header['revision'], header['material'], header['process']], [ENGINE_VERSION, KERNEL_VERSION, 'mm', '1', 'Ag925', 'lost_wax']);
    sameOrCut(header['piece'], 'cabochon-in-bezel');
    assert.equal(meta['flo2:piece'], 'cabochon-in-bezel');
  });

  it('the check report released with the files names the same versions', async () => {
    const s = new Session();
    await s.call('start_piece', { template: 'plain_band', ring_size: { system: 'US', size: '7' }, name: 'sent', preview: false });
    const r = (await s.call('export_for_casting', {})) as unknown as Reply;
    const file = (n: string) => Buffer.from(r.content.find((b) => b.resource?.uri === `cadfile:///${n}`)!.resource!.blob, 'base64');
    const rep = JSON.parse(file('sent.check.json').toString('utf8')) as Report;
    holdToContract(rep);
    const header = file('sent.stl').subarray(0, 80).toString('ascii');
    assert.ok(header.startsWith(`flo2-cad ${rep['engine'].version} manifold-3d ${rep['kernel'].version} mm r${rep['revision']} `), header);
    assert.match(modelOf(file('sent.3mf')), new RegExp(`<metadata name="flo2:check_report">sent\\.check\\.json</metadata>`));
  });
});
