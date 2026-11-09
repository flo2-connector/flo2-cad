// A CHECK NEEDS THE MEMORY OF ITS LARGER BUILD, NOT OF BOTH ITS BUILDS TOGETHER
// (flo2-cad fact:root-cause-a-checks-two-builds-held-each-others-memory-in-one-child-2026-11-09).
//
// A check of a piece written as a program evaluates it twice in one confined child: once for
// the casting file (EXPORT_TOL) and once, finer, for the surface check's reference
// (REFERENCE_TOL). A tree piece's build frees every kernel object it made when it ends
// (build.ts, buildPiece); the program child kept one Arena for all its runs and freed none of
// it until the child exited, so the reference run built on top of everything the casting
// run had left in the kernel's heap. In CAD step 7 (2026-11-09) a chat's openwork ring built
// and previewed fine, and its check stopped at "the geometry kernel reached its memory limit
// (512 MiB)": measured, the casting build alone peaks at 179 MiB and the reference alone at
// 436 MiB, and the two in one child needed 538 MiB. Freed after each run, the pair peaks at
// 441 MiB, the larger of the two, and the meshes that come back are the same.
// Observed failing on main a811acf before the change (see the PR).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { EXPORT_TOL, REFERENCE_TOL } from '../src/library/tolerances.js';
import { runProgram } from '../src/program/run.js';

/** An openwork ring with a bezel on a saddle and two swept scrolls, as a step-7 chat wrote it (its comments left out). CI also checks it in the image at 768 MiB (scripts/slot-check.mjs must-run). */
const OPENWORK = (JSON.parse(readFileSync(new URL('../../test/fixtures/openwork-ring-with-swept-scrolls.program.json', import.meta.url), 'utf8')) as { program: string }).program;
const CASTING = { tol: EXPORT_TOL, scale: 1, blendSurface: true, nameFaces: true };
const REFERENCE = { tol: REFERENCE_TOL, scale: 1, reuseBlends: true, positionsOnly: true };

describe("a program's builds in one child each free what they made", () => {
  it("a check's two builds fit in the default 512 MiB, where each fits alone (the step-7 ring)", async () => {
    const r = await runProgram(OPENWORK, [CASTING, REFERENCE], { seconds: 120, memoryMiB: 512 });
    assert.equal(r.runs.length, 2);
    assert.ok(r.runs[0]!.metal.triangles.length > 0 && r.runs[1]!.metal.positions.length > r.runs[0]!.metal.positions.length, 'the reference is the finer build');
  });

  it('three casting builds in one child need no more than one does: 256 MiB holds one, and so holds three', async () => {
    const limits = { seconds: 120, memoryMiB: 256 };
    const one = await runProgram(OPENWORK, [CASTING], limits);
    const three = await runProgram(OPENWORK, [CASTING, CASTING, CASTING], limits);
    // Freeing between runs changes no build: each run's mesh is the one a run alone makes.
    for (const run of three.runs) {
      assert.deepEqual(run.metal.positions, one.runs[0]!.metal.positions);
      assert.deepEqual(run.metal.triangles, one.runs[0]!.metal.triangles);
    }
  });
});
