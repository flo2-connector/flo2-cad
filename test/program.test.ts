// A piece written as a PROGRAM (cap:the-agent-writes-a-piece-as-a-program,
// cap:todays-parts-are-library-functions-a-program-calls), and the confinement it runs in
// (dec:idea-how-a-program-is-confined, proposed):
//   · a program-built ring is its template ring: the same checks read the same;
//   · a cabochon in a bezel is built, checked and exported from a program alone;
//   · a program that runs too long or takes too much memory is killed and refused plainly;
//   · a program reaches nothing but the library: no require, process, file system, timers,
//     code from strings, or an object of the engine's own;
//   · nothing a program does reaches the checker, which runs in the engine's process on
//     what came back, and a declaration with no metal under it fails the check.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readBinaryStl } from '../src/checker/stl.js';
import { checkPiece, evaluateProgram } from '../src/engine.js';
import { programPiece, validatePiece, type ProgramPiece } from '../src/piece/program.js';
import { treeFromTemplate, type PieceTree } from '../src/piece/tree.js';
import { treeAsProgram } from '../src/program/from-tree.js';
import { CABOCHON_EXAMPLE } from '../src/program/guide.js';
import { ProgramFailed, runProgram, type ProgramLimits } from '../src/program/run.js';
import { declarationProblems } from '../src/program/verify.js';
import { Session } from '../src/session.js';

const FIXTURE = new URL('../../test/fixtures/cabochon-in-bezel.tree.json', import.meta.url);
const QUICK: ProgramLimits = { seconds: 3, memoryMiB: 256 };

type Outcome = Awaited<ReturnType<typeof checkPiece>>;
const failing = (r: Outcome) => r.entries.filter((e) => e.result !== 'pass').map((e) => `${e.id}: ${e.measured}`);
const readings = (r: Outcome) => Object.fromEntries(r.entries.map((e) => [e.id, e.value ?? e.measured]));

/** Whether a point is inside a written STL: ray-crossing parity along +X. */
function insideStl(stl: Buffer, p: [number, number, number]): boolean {
  const m = readBinaryStl(stl);
  const P = m.positions, T = m.triangles;
  let crossings = 0;
  for (let t = 0; t < m.count; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => [P[T[t * 3 + k]! * 3]!, P[T[t * 3 + k]! * 3 + 1]!, P[T[t * 3 + k]! * 3 + 2]!]) as [number[], number[], number[]];
    const d = (b[1]! - a[1]!) * (c[2]! - a[2]!) - (c[1]! - a[1]!) * (b[2]! - a[2]!);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((p[1] - a[1]!) * (c[2]! - a[2]!) - (c[1]! - a[1]!) * (p[2] - a[2]!)) / d;
    const w = ((b[1]! - a[1]!) * (p[2] - a[2]!) - (p[1] - a[1]!) * (b[2]! - a[2]!)) / d;
    if (u < 0 || w < 0 || u + w > 1) continue;
    if (a[0]! + u * (b[0]! - a[0]!) + w * (c[0]! - a[0]!) > p[0]) crossings++;
  }
  return crossings % 2 === 1;
}

async function refusal(source: string, limits: ProgramLimits = QUICK): Promise<ProgramFailed> {
  try {
    await runProgram(source, [{ tol: 0.03, scale: 1 }], limits);
  } catch (e) {
    if (e instanceof ProgramFailed) return e;
    throw e;
  }
  assert.fail(`the program was not refused:\n${source}`);
}

describe('a program-built ring is its template ring', () => {
  const templates: [string, PieceTree][] = [
    ['the solitaire, US 7, 4 prongs', treeFromTemplate('solitaire_ring', { ring_size: { system: 'US', size: '7' }, name: 'sol' })],
    ["Emily's emerald-cut bezel solitaire, US 6.5, in platinum", treeFromTemplate('emerald_bezel_solitaire', { ring_size: { system: 'US', size: '6.5' }, name: 'emily' })],
  ];
  for (const [what, tree] of templates) {
    it(`${what}: every check reads the same, and both export`, async () => {
      const program: ProgramPiece = { ...programPiece(treeAsProgram(tree), { name: tree.name, metal: tree.metal, shrinkage: tree.shrinkage }) };
      const [t, p] = [await checkPiece(tree, 'export'), await checkPiece(program, 'export')];
      assert.deepEqual(failing(t), []);
      assert.deepEqual(failing(p), []);
      assert.ok(p.stl && p.threeMf, 'the program piece exports');
      assert.deepEqual(readings(p), readings(t));
      assert.deepEqual(p.entries.map((e) => e.id), t.entries.map((e) => e.id), 'the same checks run: the library parts declared themselves');
      const vt = (t.report['volume_mm3'] as number), vp = (p.report['volume_mm3'] as number);
      assert.ok(Math.abs(vt - vp) <= 1e-4 * vt, `volume ${vp} against ${vt}`);
      assert.equal((p.report['stl'] as { triangles: number }).triangles, (t.report['stl'] as { triangles: number }).triangles);
    });
  }
  it('a program written by hand, with bare millimetres, is the same solitaire', async () => {
    const tree = treeFromTemplate('solitaire_ring', { ring_size: { system: 'US', size: '7' }, name: 'sol' });
    const program = programPiece(
      `const band = ringShank({ ring_size: { system: 'US', size: '7' } });
       const stone = roundStone({ diameter: 6.5, depth: 4.0 });
       return union(band, prongHead({ on: band, stone }));`,
      { name: 'sol' },
    );
    const [t, p] = [await checkPiece(tree, 'check'), await checkPiece(program, 'check')];
    assert.deepEqual(readings(p), readings(t));
  });
  it("reports the dimensions a fit rests on, the build's own: the seat, the prongs, the band", async () => {
    const v = await evaluateProgram(programPiece(`const band = ringShank({ ring_size: { system: 'US', size: '7' } }); return union(band, prongHead({ on: band, stone: roundStone({ diameter: 6.5, depth: 4.0 }) }));`, {}));
    const [shank, head] = v.run.parts!;
    assert.equal(shank?.call, 'ringShank');
    assert.equal(head?.call, 'prongHead');
    if (head?.call !== 'prongHead' || shank?.call !== 'ringShank') return;
    assert.equal(head.head.seat.lengthMm, 6.56);
    assert.equal(head.head.prongs!.length, 4);
    assert.equal(shank.band.thicknessMm, 1.6);
  });
});

describe('a cabochon in a bezel, from a program alone', () => {
  it('builds, passes every check, and exports, with the stone left out of the file', async () => {
    const p = validatePiece(JSON.parse(readFileSync(FIXTURE, 'utf8')));
    assert.equal(p.format, 'flo2-cad.program/1');
    if (p.format !== 'flo2-cad.program/1') return;
    assert.equal(p.program, CABOCHON_EXAMPLE, 'the fixture is the worked example the skill and describe_piece show');
    const r = await checkPiece(p, 'export');
    assert.deepEqual(failing(r), []);
    assert.equal(r.report['export'], 'released');
    assert.ok(r.stl && r.threeMf);
    // The bezel declared itself: its wall and lip were checked, against the cabochon's crown.
    assert.ok(r.entries.some((e) => e.id === 'bezel_wall' && e.result === 'pass'));
    const lip = r.entries.find((e) => e.id === 'bezel_lip')!;
    assert.match(lip.measured!, /60 % of the 2\.6 mm crown/);
    // The cabochon is drawn, never cast: above its flat seat the casting file is empty.
    assert.equal(insideStl(r.stl, [0, 0, 11.0]), false);
    assert.deepEqual((r.report['stone'] as { in_casting_file: boolean; shape: string }), { ...(r.report['stone'] as object), in_casting_file: false, shape: 'custom' });
  });
  it('is the worked example the skill gives, word for word', () => {
    const skill = readFileSync(new URL('../../skills/design-jewelry/SKILL.md', import.meta.url), 'utf8');
    assert.ok(skill.includes(CABOCHON_EXAMPLE), 'skills/design-jewelry/SKILL.md quotes CABOCHON_EXAMPLE exactly');
  });
  it('needs no feature of its own: the program uses only the kernel, stone() and bezel()', () => {
    const calls = new Set([...CABOCHON_EXAMPLE.matchAll(/\b([a-zA-Z]+)\(/g)].map((m) => m[1]));
    for (const c of calls) assert.ok(['ringShank', 'segments', 'ceil', 'cos', 'sin', 'push', 'stone', 'revolve', 'polygon', 'bezel', 'union'].includes(c!), `the example calls ${c}`);
  });
});

describe('a program runs in its own process, within a time and a memory limit', () => {
  it('an endless loop is stopped at its time limit and refused plainly', async () => {
    const t0 = performance.now();
    const e = await refusal('let i = 0;\nwhile (true) { i++; }');
    assert.equal(e.kind, 'time');
    assert.match(e.plain, /ran past its time limit \(3 s\)/);
    assert.ok(performance.now() - t0 < 3000 + 2500, 'it is stopped at the limit, not later');
  });
  it('an endless chain of promises is stopped too', async () => {
    const e = await refusal('const f = () => Promise.resolve().then(f); f(); return sphere(1);');
    assert.ok(e.kind === 'time' || e.kind === 'memory', e.plain);
  });
  it('a memory bomb in JavaScript is killed', async () => {
    const e = await refusal('const keep = [];\nwhile (true) keep.push(new Array(1e6).fill(Math.random()));');
    assert.equal(e.kind, 'memory');
    assert.match(e.plain, /memory limit/);
  });
  it('a memory bomb outside the JavaScript heap (typed arrays) is killed by its resident memory', async () => {
    const e = await refusal('const keep = [];\nwhile (true) keep.push(new Float64Array(1 << 24).fill(1));');
    assert.equal(e.kind, 'memory');
  });
  it('a memory bomb in the geometry kernel is refused, with its line', async () => {
    const e = await refusal('const keep = [];\nfor (let i = 0; i < 400; i++) keep.push(sphere(400));\nreturn keep[0];');
    assert.equal(e.kind, 'memory');
    assert.match(e.plain, /^line 2: the geometry kernel reached its memory limit/);
  });
  it('a failing call is refused with its line and what to fix', async () => {
    const e = await refusal("const band = ringShank({ ring_size: { system: 'US', size: '7' }, band_width: '0.1 in' });\nreturn band;");
    assert.equal(e.kind, 'program');
    assert.match(e.plain, /^line 1: .*ringShank\.band_width.*in/);
    const s = await refusal('const a = 1;\nconst b = ;');
    assert.match(s.plain, /^line 2: the program does not parse: SyntaxError/);
  });
});

describe('a program reaches nothing but the library', () => {
  it('has no require, import, process, Buffer, timers, fetch or WebAssembly', async () => {
    const r = await runProgram(
      `const names = ['require', 'process', 'Buffer', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'fetch', 'WebAssembly', 'module', 'global'];
       const there = names.filter((n) => typeof globalThis[n] !== 'undefined');
       if (there.length) throw new Error('reachable: ' + there.join(', '));
       return sphere(1);`,
      [{ tol: 0.03, scale: 1 }],
      QUICK,
    );
    assert.equal(r.runs.length, 1);
  });
  for (const [how, src] of [
    ['through a library function\'s constructor', "return ringShank.constructor('return process')();"],
    ["through the global's constructor", "return globalThis.constructor.constructor('return process')();"],
    ["through an error's constructor", "try { ringShank({}); } catch (e) { return e.constructor.constructor('return process')(); }"],
    ['through eval', "return eval('process');"],
    ['through a solid', "const s = sphere(1); return s.translate.constructor('return process')();"],
  ] as const) {
    it(`cannot make code from text ${how}`, async () => {
      const e = await refusal(src);
      assert.equal(e.kind, 'program');
      assert.match(e.plain, /Code generation from strings disallowed/);
    });
  }
  it('cannot import a module: a promise is refused, and a file it tries to write is never written', async () => {
    const e = await refusal("return import('node:fs');");
    assert.match(e.plain, /returned a promise/);
    const target = join(tmpdir(), `flo2-cad-escape-${process.pid}`);
    rmSync(target, { force: true });
    await runProgram(`import('node:fs').then((fs) => fs.writeFileSync(${JSON.stringify(target)}, 'x'), () => {}); return sphere(1);`, [{ tol: 0.03, scale: 1 }], QUICK);
    assert.equal(existsSync(target), false);
  });
  it("sees no function of the engine's on its stack (every frame's function and receiver hidden)", async () => {
    await runProgram(
      `Error.prepareStackTrace = (e, frames) => frames;
       const frames = new Error().stack;
       for (const f of frames) if (f.getFunction() !== undefined || f.getThis() !== undefined) throw new Error('reached a function in ' + f.getFileName());
       if (frames.length < 4) throw new Error('the stack is shorter than expected');
       return sphere(1);`,
      [{ tol: 0.03, scale: 1 }],
      QUICK,
    );
  });
  it('cannot hand back anything but a solid the library made', async () => {
    assert.match((await refusal('return { $solid: 0 };')).plain, /must end by returning the piece/);
    assert.match((await refusal('return 42;')).plain, /must end by returning the piece/);
  });
  it('cannot carry a setting or a band out of the frame the checker measures them in', async () => {
    const tilt = await refusal("const band = ringShank({ ring_size: { system: 'US', size: '7' } });\nconst head = bezel({ on: band, stone: roundStone({ diameter: 6, depth: 3.6 }) });\nreturn union(band, head.rotate([20, 0, 0]));");
    assert.match(tilt.plain, /^line 3: rotate\(\[20, 0, 0\]\): would tip the stone setting off upright/);
    const moved = await refusal("return ringShank({ ring_size: { system: 'US', size: '7' } }).translate([0, 0, 5]);");
    assert.match(moved.plain, /would move the ring band off the finger's axis/);
    const scaled = await refusal("return ringShank({ ring_size: { system: 'US', size: '7' } }).scale(1.1);");
    assert.match(scaled.plain, /scale would change the size it was built to/);
  });
});

describe('nothing a program does reaches the checker', () => {
  it("rewriting its own Math, JSON, Array and Object changes no reading: the check runs in the engine's process", async () => {
    const clean = programPiece(CABOCHON_EXAMPLE, { name: 'cab' });
    const vandal = programPiece(
      `Math.max = () => 0; Math.min = () => 0; Math.hypot = () => 0; Math.sqrt = () => 0;
       Array.prototype.reduce = () => 0; Object.keys = () => []; Number.isFinite = () => true;
       ${CABOCHON_EXAMPLE}`,
      { name: 'cab' },
    );
    const [a, b] = [await checkPiece(clean, 'check'), await checkPiece(vandal, 'check')];
    assert.equal(b.verdict, 'pass');
    assert.deepEqual(readings(b), readings(a));
    assert.equal(Math.max(1, 2), 2, "the engine's own Math is untouched");
  });
  it('a setting whose metal a program cut away fails the check, naming the part, and nothing is exported', async () => {
    const p = programPiece(
      `const band = ringShank({ ring_size: { system: 'US', size: '7' } });
       const ring = union(band, prongHead({ on: band, stone: roundStone({ diameter: 6.5, depth: 4.0 }) }));
       return difference(ring, box(4, 4, 30).translate([3.5, 3.5, 12]));`,
      { name: 'cut' },
    );
    const r = await checkPiece(p, 'export');
    assert.equal(r.verdict, 'fail');
    assert.equal(r.threeMf, null);
    assert.ok(r.entries.every((e) => e.result === 'could_not_run'));
    assert.match(r.entries[0]!.measured!, /prong 1 of 4 \(prongHead\) at 1:30 has no metal in its column/);
  });
  it("a declaration with no metal under it is caught before any check (as a forged answer's would be)", async () => {
    const r = await runProgram("const band = ringShank({ ring_size: { system: 'US', size: '7' } }); return union(band, prongHead({ on: band, stone: roundStone({ diameter: 6.5, depth: 4.0 }) }));", [{ tol: 0.03, scale: 1 }], QUICK);
    const run = r.runs[0]!;
    assert.deepEqual(declarationProblems(run.metal, run.decl!), []);
    const forged = { ...run.decl!, prongs: [...run.decl!.prongs, { ...run.decl!.prongs[0]!, label: 'prong 5 of 4', axis: [30, 30] as [number, number] }] };
    assert.match(declarationProblems(run.metal, forged).join(' '), /prong 5 of 4 \(prongHead\) at .* has no metal/);
  });
});

describe('the piece written as a program, over the session', () => {
  it('a template piece goes on as a program; set then takes only name, metal and shrinkage', async () => {
    const s = new Session(QUICK);
    await s.call('start_piece', { template: 'solitaire_ring', ring_size: { system: 'US', size: '7' }, name: 'sol', preview: false });
    const d = await s.call('describe_piece', {});
    const text = d.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    const program = /This piece, written as one \(the same piece\):\n([\s\S]*?)\nWhat a program can call:/.exec(text)?.[1];
    assert.ok(program, 'describe_piece shows the template piece as a program');
    const c = await s.call('change_piece', { program: program!.replace("prong_count\": 4", "prong_count\": 6"), preview: false });
    assert.equal(c.isError, false);
    const file = c.content.find((b) => b.type === 'resource');
    const piece = JSON.parse(Buffer.from((file as { resource: { blob: string } }).resource.blob, 'base64').toString('utf8'));
    assert.equal(piece.format, 'flo2-cad.program/1');
    assert.equal(piece.revision, 2);
    assert.match(c.content[0]!.type === 'text' ? c.content[0]!.text : '', /a 6-prong head/);
    const bad = await s.call('change_piece', { set: { prong_count: 4 } });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0]!.type === 'text' ? bad.content[0]!.text : '', /set\.prong_count: this piece is written as a program/);
    const metal = await s.call('change_piece', { set: { metal: 'gold_14k_yellow' }, preview: false });
    assert.equal(metal.isError, false);
  });
  it('start_piece takes a template or a program, not both, and a broken program changes nothing', async () => {
    const s = new Session(QUICK);
    const both = await s.call('start_piece', { template: 'plain_band', ring_size: { system: 'US', size: '7' }, program: 'return sphere(1);' });
    assert.equal(both.isError, true);
    const broken = await s.call('start_piece', { program: 'const a = sphere(1);\nreturn a.translate([1, 2]);' });
    assert.equal(broken.isError, true);
    assert.match(broken.content[0]!.type === 'text' ? broken.content[0]!.text : '', /program: line 2: translate: must be \[x, y, z\] in mm\. Nothing was changed\./);
    const none = await s.call('check_piece', {});
    assert.equal(none.isError, true, 'no piece was opened by the broken program');
  });
});
