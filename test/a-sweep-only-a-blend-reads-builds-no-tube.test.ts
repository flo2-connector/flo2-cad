// A WIRE A PROGRAM MAKES ONLY TO BLEND BUILDS NO TUBE OF ITS OWN
// (dec:a-blend-is-meshed-finely-only-near-its-fillets-and-a-sweep-read-only-by-a-blend-builds-no-tube-2026-11-15;
// fact:root-cause-a-blend-over-a-whole-ring-outgrows-a-programs-limits-2026-11-15).
//
// A program's sweep() built its tube as it was called, at the build's own fineness, though a
// smoothUnion reads only the wire's tree node (its distance field): on the chat's openwork ring
// that was 1.1 s and 48 MiB in the casting build and 3.5 s and 144 MiB of kernel in the surface
// check's reference build, whose blend is the casting build's own, for tubes nothing read.
// Now a sweep, and a move or union of one, is built when something reads its mesh. The call
// tally a refusal at a limit names counts it when, and if, it is built.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { kernel } from '../src/kernel/manifold.js';
import { Arena, EXPORT_TOL, REFERENCE_TOL } from '../src/library/build.js';
import { ProgramLibrary } from '../src/program/library.js';

const wave = (sign: number) => Array.from({ length: 72 }, (_, i) => {
  const phi = (i / 72) * 2 * Math.PI;
  return [9.46 * Math.sin(phi), sign * 2.2 * Math.sin(6 * phi), 9.46 * Math.cos(phi)];
});

/** A program's calls, made in this process: each answer's value, or a failure. */
function caller(lib: ProgramLibrary) {
  return (name: string, ...args: unknown[]) => {
    const r = JSON.parse(lib.call(name, JSON.stringify(args))) as { ok?: unknown; error?: string };
    assert.equal(r.error, undefined, `${name}: ${r.error}`);
    return r.ok;
  };
}

describe('a sweep only a smooth blend reads builds no tube', () => {
  for (const [build, tol] of [['the casting build', EXPORT_TOL], ["the surface check's reference build", REFERENCE_TOL]] as const) {
    it(`${build}: two wires, moved, blended, are counted as built only by the blend`, async () => {
      const k = await kernel();
      const A = new Arena();
      try {
        const lib = new ProgramLibrary(k, A, tol);
        const call = caller(lib);
        const a = call('sweep', 0.5, wave(1), { closed: true });
        const b = call('translate', call('sweep', 0.5, wave(-1), { closed: true }), [0, 0.1, 0]);
        call('smoothUnion', 0.4, a, b, { name: 'wires' });
        const tally = lib.progress(10).heaviest;
        assert.equal(tally.find((t) => t.call === 'sweep'), undefined, `the wires were built: ${JSON.stringify(tally)}`);
        assert.ok(tally.find((t) => t.call === 'smoothUnion')!.triangles > 1000, JSON.stringify(tally));
      } finally {
        A.free();
      }
    });
  }

  it('a sweep whose mesh the program reads is built, and counted, once', async () => {
    const k = await kernel();
    const A = new Arena();
    try {
      const lib = new ProgramLibrary(k, A, EXPORT_TOL);
      const call = caller(lib);
      const w = call('sweep', 0.5, wave(1), { closed: true });
      const box = call('bounds', w) as { min: number[]; max: number[] };
      assert.ok(box.max[0]! > 9.9 && box.min[0]! < -9.9, JSON.stringify(box));
      call('bounds', w);
      const sweep = lib.progress(10).heaviest.find((t) => t.call === 'sweep');
      assert.equal(sweep?.calls, 1, JSON.stringify(sweep));
      assert.ok(sweep!.triangles > 1000, JSON.stringify(sweep));
    } finally {
      A.free();
    }
  });
});
