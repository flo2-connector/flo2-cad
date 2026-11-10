// A SWEPT WIRE COSTS WHAT IT IS, NOT HOW IT IS BUILT
// (flo2-cad fact:root-cause-a-swept-wire-costs-memory-by-how-it-is-built-not-what-it-is-2026-11-10).
//
// A sweep was built as a chain: for every segment of its path, the hull of a ball at each end,
// then one union of every hull, with each ball (a sphere, turned, moved) handed to the build's
// Arena and kept until the build ended. The mesh came to about 8 times a tube's triangles
// (one 200-point wire of radius 0.6 mm: 122,310 at the casting file's fineness, where a tube of
// the same 36 segments round is about 14,400) and grew with every point and with the check's
// fineness: at the surface check's reference that one wire alone needed 556 MiB. In CAD step 7
// re-run 2 (2026-11-09) four checks of two chats' pieces (openwork bands of round wires, petals
// with swept flutes) ran out of the 512 MiB a program has, on flo2-cad 0.4.3, though each piece
// drew fine. Now a sweep is a tube: rings round each point of its path, joined, a half ball on
// each open end, and the path split into runs only where a joint's mitre would stand off the
// round wire by more than the build's tolerance or the wire comes back within its own width;
// the runs are unioned, and nothing the sweep makes for itself outlives the call. A check that
// still runs out of memory says which calls were heaviest and how to make the piece lighter.
// Observed failing on main 4287fc4 before the change (see the PR).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { checkPiece } from '../src/engine.js';
import { EXPORT_TOL, REFERENCE_TOL } from '../src/library/tolerances.js';
import { programPiece } from '../src/piece/program.js';
import { runProgram, type ProgramLimits } from '../src/program/run.js';

const STEP7 = (JSON.parse(readFileSync(new URL('../../test/fixtures/swept-wires-step-7.json', import.meta.url), 'utf8')) as { programs: Record<string, string> }).programs;
const CASTING = { tol: EXPORT_TOL, scale: 1, blendSurface: true, nameFaces: true };
const REFERENCE = { tol: REFERENCE_TOL, scale: 1, reuseBlends: true, positionsOnly: true };
const CHECK_LIMITS: ProgramLimits = { seconds: 120, memoryMiB: 512 };
const QUICK: ProgramLimits = { seconds: 30, memoryMiB: 512 };

/** A solid's volume in mm³, from its triangles (the divergence theorem). */
function volume(m: { positions: Float32Array; triangles: Uint32Array }): number {
  const P = m.positions, T = m.triangles;
  let v = 0;
  for (let i = 0; i < T.length; i += 3) {
    const a = T[i]! * 3, b = T[i + 1]! * 3, c = T[i + 2]! * 3;
    v += P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) - P[a + 1]! * (P[b]! * P[c + 2]! - P[b + 2]! * P[c]!) + P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!);
  }
  return v / 6;
}

async function built(program: string, tol = EXPORT_TOL) {
  const r = await runProgram(program, [{ tol, scale: 1 }], QUICK);
  return r.runs[0]!.metal;
}

/** The moonstone chat's wavy wire: radius 0.6 mm, five waves over 240 degrees of a US 7 band, 200 path points. */
const WAVE = `const pts = [];
for (let i = 0; i <= 200; i++) {
  const phi = (60 + 240 * i / 200) * Math.PI / 180, t = (i / 200) * 5 * 2 * Math.PI, r = 9.46;
  pts.push([r * Math.sin(phi), 3 * (0.5 + 0.5 * Math.cos(t)), r * Math.cos(phi)]);
}
return sweep(0.6, pts);`;

describe('a swept wire costs what it is', () => {
  for (const [name, program] of Object.entries(STEP7)) {
    it(`a check of the step-7 piece "${name}" runs both its builds within 512 MiB`, async () => {
      const r = await runProgram(program, [CASTING, REFERENCE], CHECK_LIMITS);
      assert.equal(r.runs.length, 2);
    });
  }

  it("a 200-point wire's casting mesh is about a tube's size, not eight times it", async () => {
    const m = await built(WAVE);
    const tris = m.triangles.length / 3;
    // A tube of 36 segments round with 200 joints is about 14,400 triangles, plus its two half balls.
    assert.ok(tris < 25_000, `${tris} triangles`);
  });

  it('a straight wire is a capsule: its volume is a cylinder and a ball', async () => {
    const r = 0.5, L = 10;
    const m = await built(`return sweep(${r}, [[0, 0, 0], [${L}, 0, 0]]);`);
    const want = Math.PI * r * r * L + (4 / 3) * Math.PI * r ** 3;
    assert.ok(Math.abs(volume(m) - want) / want < 0.01, `${volume(m)} against ${want}`);
  });

  it('a closed wire round a circle is a torus: its volume is 2π²Rr²', async () => {
    const R = 9, r = 0.7;
    const m = await built(`const p = []; for (let i = 0; i < 180; i++) { const a = i * 2 * Math.PI / 180; p.push([${R} * Math.cos(a), ${R} * Math.sin(a), 0]); } return sweep(${r}, p, { closed: true });`);
    const want = 2 * Math.PI * Math.PI * R * r * r;
    assert.ok(Math.abs(volume(m) - want) / want < 0.01, `${volume(m)} against ${want}`);
  });

  it('a closed wire that does not lie flat closes on itself: one closed solid, its volume its length times its section', async () => {
    // Round a 9 mm circle, rising and falling 2 mm five times: its frame comes back turned, and the tube must still close.
    const program = 'const p = []; for (let i = 0; i < 240; i++) { const a = i * 2 * Math.PI / 240; p.push([9 * Math.cos(a), 9 * Math.sin(a), 2 * Math.sin(5 * a)]); } return sweep(0.5, p, { closed: true });';
    const r = await checkPiece(programPiece(program, { name: 'wavy-loop' }), 'check');
    assert.equal(r.entries.find((e) => e.id === 'watertight')?.result, 'pass');
    const m = await built(program);
    let length = 0;
    for (let i = 0; i < 240; i++) {
      const a = (i * 2 * Math.PI) / 240, b = ((i + 1) * 2 * Math.PI) / 240;
      length += Math.hypot(9 * Math.cos(b) - 9 * Math.cos(a), 9 * Math.sin(b) - 9 * Math.sin(a), 2 * Math.sin(5 * b) - 2 * Math.sin(5 * a));
    }
    const want = Math.PI * 0.25 * length;
    assert.ok(Math.abs(volume(m) - want) / want < 0.01, `${volume(m)} against ${want}`);
  });

  it('a wire with square corners keeps every corner round and is one closed solid', async () => {
    const program = 'return sweep(0.5, [[0, 0, 0], [6, 0, 0], [6, 6, 0], [0, 6, 0], [0, 6, 6]]);';
    const r = await checkPiece(programPiece(program, { name: 'corners' }), 'check');
    const watertight = r.entries.find((e) => e.id === 'watertight');
    assert.equal(watertight?.result, 'pass', JSON.stringify(watertight));
    const m = await built(program);
    // The same solid as the chain of hulled balls it replaces: 19.08 mm³ on main 4287fc4, at the casting file's fineness.
    assert.ok(Math.abs(volume(m) - 19.08) / 19.08 < 0.01, `${volume(m)} against 19.08`);
  });

  it('a scroll that curls back within its own width stays one closed solid', async () => {
    const program = `const p = []; for (let i = 0; i <= 160; i++) { const a = i * 4 * Math.PI / 160, rr = 3 - 0.18 * a; p.push([rr * Math.cos(a), rr * Math.sin(a), 0]); } return sweep(0.6, p);`;
    const piece = programPiece(program, { name: 'scroll' });
    const r = await checkPiece(piece, 'check');
    const watertight = r.entries.find((e) => e.id === 'watertight');
    assert.equal(watertight?.result, 'pass', JSON.stringify(watertight));
  });

  it('a check that still runs out of memory names its heaviest calls and says how to make the piece lighter', async () => {
    // A coil of 8,000 points of a 1.5 mm wire: far more than 128 MiB of kernel at the reference's fineness.
    // At 256 MiB a program's kernel may grow to 128 MiB, so the kernel's own limit is met before the process's.
    // A short coil first, which finishes, then the long one, which runs out.
    const heavy = 'const coil = (n) => { const p = []; for (let i = 0; i <= n; i++) p.push([i * 0.01, Math.sin(i * 0.05) * 6, Math.cos(i * 0.05) * 6]); return p; }; const a = sweep(1.5, coil(300)); const b = sweep(1.5, coil(8000)); return union(a, b);';
    const r = await checkPiece(programPiece(heavy, { name: 'heavy' }), 'check', { seconds: 90, memoryMiB: 256 });
    const all = JSON.stringify(r.entries) + JSON.stringify(r.fixes);
    assert.match(all, /memory limit/);
    assert.match(all, /it ran out in a sweep call/);
    assert.match(all, /heaviest calls before it stopped: sweep \(1 call, [\d,]+ triangles\)/);
    assert.equal(r.fixes.length, 1, `one piece of advice, not one a check: ${JSON.stringify(r.fixes)}`);
    assert.match(r.fixes[0]!, /lighter/);
    assert.match(r.fixes[0]!, /torus|revolve/);
  });
});
