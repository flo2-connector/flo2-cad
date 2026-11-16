// A REFUSAL AT A PROGRAM'S LIMIT SAYS WHERE IT STOPPED AND WHAT TO CHANGE
// (flo2-cad fact:root-cause-a-blend-over-a-whole-ring-outgrows-a-programs-limits-2026-11-15).
//
// On flo2.io, 2026-11-12, flo2-cad 0.4.4: a chat's openwork ring joined its two rails (tori), two
// wavy wires (closed sweeps of 72 points) and four posts in one smoothUnion with a 0.4 mm fillet.
// It drew fine; every check came back COULD_NOT_RUN, "the program ran past its time limit
// (20 s)", six times over under "What to do:", naming no call and nothing to change, so the chat
// guessed (it rejoined them with union(), which checked). The same program on a faster machine
// stops on memory instead, and that refusal said "it ran out in a smoothUnion call" but then
// advised fewer sweep points and "draw a round ring with torus()", for a piece whose rings
// already were tori. Which limit is met first is a race: on one CPU the blend's run passes
// 512 MiB at about three quarters of its way, and a slower CPU reaches 20 s before that.
//
// What the blend costs (measured, flo2-cad 13b8419): its level set meshes the whole surface of
// everything it blends at the fillet's grid (0.12 mm here), 289,518 triangles where the same
// shapes joined with union() make 30,900, on a grid filling the box round them (4.9 million
// samples); every later step of the build grows with those triangles. A check builds it twice.
// One CPU of an i5-10300H took 15.5 s for the check (memory 512 MiB passed at 7.8 s); one CPU
// of an Intel N95 shared with another job ran past 20 s at 424 MiB. Whether that cost should
// come down (a blend meshed finely only near its fillets) or the limits go up is the owner's
// choice, so this pins the refusal: at either limit, by whichever path the evaluation was
// stopped, it names the call it stopped in (or the program's own code), and a check gives ONE
// piece of advice that fits that call. Observed failing on main 13b8419 (see the PR).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPiece } from '../src/engine.js';
import { programPiece } from '../src/piece/program.js';

/** The ring's two rails, blended: the blend's box is the whole ring, as in the chat's piece, but with no wires. */
const RAILS = "const rail = (y) => torus(9.46, 0.8).rotate([90, 0, 0]).translate([0, y, 0]);\nreturn smoothUnion(0.4, rail(2.2), rail(-2.2), { name: 'rails' });";

async function refused(program: string, limits: { seconds: number; memoryMiB: number }) {
  const r = await checkPiece(programPiece(program, { name: 'rails', metal: 'gold_14k_yellow' }), 'check', limits);
  assert.ok(r.entries.every((e) => e.result === 'could_not_run'), JSON.stringify(r.entries.map((e) => [e.id, e.result])));
  return { measured: r.entries[0]!.measured ?? '', fixes: r.fixes };
}

describe('a refusal at a program\'s limit says where it stopped and what to change', () => {
  it('a check that runs past its time limit in a blend names the blend, once, and says how to make it quicker to build', async () => {
    const { measured, fixes } = await refused(RAILS, { seconds: 1, memoryMiB: 512 });
    assert.match(measured, /ran past its time limit \(1 s\); it was in a smoothUnion call/);
    assert.equal(fixes.length, 1, `one piece of advice, not one a check: ${JSON.stringify(fixes)}`);
    assert.match(fixes[0]!, /quicker to build/);
    assert.match(fixes[0]!, /smoothUnion/);
    assert.match(fixes[0]!, /union\(\)/);
  });

  it('a check that runs out of memory in a blend is advised about the blend, not about sweeps it does not have', async () => {
    const { measured, fixes } = await refused(RAILS, { seconds: 60, memoryMiB: 256 });
    assert.match(measured, /it ran out in a smoothUnion call/);
    assert.equal(fixes.length, 1, JSON.stringify(fixes));
    assert.match(fixes[0]!, /lighter/);
    assert.match(fixes[0]!, /smoothUnion/);
    assert.match(fixes[0]!, /union\(\)/);
    assert.doesNotMatch(fixes[0]!, /sweep/, 'the piece has no sweep');
  });

  it('a program stopped by its resident memory, outside any call, says so and names its heaviest calls', async () => {
    // Typed arrays lie outside the JavaScript heap and the kernel's, so only the engine's watch on
    // the process's resident memory stops it: the child is killed and cannot say anything itself.
    const { measured } = await refused('const s = sphere(2);\nconst keep = [];\nwhile (true) keep.push(new Float64Array(1 << 24).fill(1));\nreturn s;', { seconds: 60, memoryMiB: 256 });
    assert.match(measured, /memory limit \(256 MiB\) and was stopped; it ran out in the program's own code, between library calls/);
    assert.match(measured, /its heaviest calls before it stopped: sphere \(1 call, [\d,]+ triangles\)/);
  });

  it('a program that runs past its time limit in its own code says so and names its slowest calls', async () => {
    const { measured, fixes } = await refused('const s = sphere(2);\nlet i = 0;\nwhile (true) i++;\nreturn s;', { seconds: 1, memoryMiB: 512 });
    assert.match(measured, /ran past its time limit \(1 s\); it was in the program's own code, between library calls/);
    assert.match(measured, /its slowest calls: sphere \(1 call, [\d.]+ s\)/);
    assert.equal(fixes.length, 1, JSON.stringify(fixes));
  });
});
