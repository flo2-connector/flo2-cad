// THE CASTING CHECK FINISHES IN TIME FOR A WIRE-AND-BLEND PIECE
// (cap:the-casting-check-finishes-in-time-for-any-piece;
// fact:check-time-is-the-blend-field-and-the-wall-ball).
//
// The symptom: on flo2.io, 2026-10-05, check_piece on moonstone-openwork-ring (revision 3:
// the template band and bezel, plus four sweeps of 72 points under a 0.4 mm smooth_union)
// was stopped four times at the door's 60 s. Measured on main 0b432a3 at one CPU, the check
// took 352 s and peaked at 1.37 GB, and in flo2's cad slot (1 CPU, 384 MiB, no swap) it was
// killed for memory at 158 s. Where the time went: the blend's distance field read in full
// at every grid sample of its level set (44 s at the export's grid), a second level set 1.7
// times finer for the surface check's reference (218 s, and 687 MiB of grid by Manifold's
// own sizing), and the wall ball walking the tree eleven times a sample (75 s).
//
// This pins the CLASS on a representative piece, the very tree flo2.io kept: the check
// finishes at one CPU within three quarters of flo2's 60 s door, inside the 1 GiB the CAD
// design gives a session (con:session-memory-in-flo2s-slot), and reads what main reads.
// Observed failing on main 0b432a3 before the fix (stopped at the time budget).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE = `${ROOT}test/fixtures/moonstone-openwork-ring.tree.json`;
const ENGINE = new URL('../src/engine.js', import.meta.url).href;

/** Three quarters of the door flo2 puts round every engine call (services/edge-gateway, DEFAULT_CALL_MS = 60 s). */
const TIME_BUDGET_S = 45;
/** The session's memory, as the CAD design states it (con:session-memory-in-flo2s-slot). */
const MEMORY_BUDGET_MIB = 1024;

interface Run {
  ms: number;
  hwmMiB: number;
  verdict: string;
  entries: { id: string; result: string; value?: number }[];
}

/** check_piece on the tree in a fresh process, held to one CPU where taskset is there to do it. */
function checkInOwnProcess(treePath: string): Run {
  const script = `
    import { readFileSync } from 'node:fs';
    const { checkPiece } = await import(${JSON.stringify(ENGINE)});
    const tree = JSON.parse(readFileSync(${JSON.stringify(treePath)}, 'utf8'));
    const t0 = performance.now();
    const r = await checkPiece(tree, 'check');
    const ms = performance.now() - t0;
    const hwm = /VmHWM:\\s+(\\d+)/.exec(readFileSync('/proc/self/status', 'utf8'));
    process.stdout.write(JSON.stringify({ ms, hwmMiB: hwm ? Number(hwm[1]) / 1024 : NaN, verdict: r.verdict, entries: r.entries.map((e) => ({ id: e.id, result: e.result, value: e.value })) }));
  `;
  const node = [process.execPath, '--input-type=module', '-e', script];
  const pinned = existsSync('/usr/bin/taskset') ? ['/usr/bin/taskset', '-c', '0', ...node] : node;
  const run = spawnSync(pinned[0]!, pinned.slice(1), { encoding: 'utf8', timeout: (TIME_BUDGET_S + 5) * 1000, killSignal: 'SIGKILL', maxBuffer: 1 << 24 });
  assert.equal(run.signal, null, `the check did not finish within ${TIME_BUDGET_S + 5} s at one CPU (stopped by ${run.signal})`);
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout) as Run;
}

describe('the casting check finishes in time for a wire-and-blend piece', () => {
  it(`moonstone-openwork-ring (four sweeps under a smooth_union, on the bezel template) is checked at one CPU within ${TIME_BUDGET_S} s and ${MEMORY_BUDGET_MIB} MiB, and reads what main reads`, { timeout: (TIME_BUDGET_S + 30) * 1000 }, () => {
    const run = checkInOwnProcess(FIXTURE);
    const at = (id: string) => run.entries.find((e) => e.id === id)!;
    // Strictness unchanged: every reading main 0b432a3 gave this piece, once its check was let
    // run to the end (352 s). The piece is refused, as it was, for a 0 mm gap where its wires
    // meet: the chat's own layout.
    assert.deepEqual(
      ['watertight', 'wall', 'detail', 'band', 'bezel_wall', 'bezel_lip', 'gap'].map((id) => [id, at(id).result, at(id).value]),
      [
        ['watertight', 'pass', undefined],
        ['wall', 'pass', 0.999],
        ['detail', 'pass', 0.999],
        ['band', 'pass', 1.594],
        ['bezel_wall', 'pass', 0.999],
        ['bezel_lip', 'pass', 0.63],
        ['gap', 'fail', 0],
      ],
    );
    // The surface is no longer refused, and the check is as strict as it was: it read 0.010 mm
    // on 0b432a3 and 0.012 on c678b62 (both fails) where the rails bend at their peak, the
    // blend's facets cutting across a crease of its own field (blend-surface.test.ts). The
    // build now holds those facets to the surface.
    assert.equal(at('surface_deviation').result, 'pass', `surface ${at('surface_deviation').value} mm`);
    assert.ok(at('surface_deviation').value! <= 0.01, `surface ${at('surface_deviation').value} mm`);
    assert.equal(run.verdict, 'fail');
    assert.ok(run.ms <= TIME_BUDGET_S * 1000, `the check took ${(run.ms / 1000).toFixed(1)} s at one CPU; the budget is ${TIME_BUDGET_S} s`);
    assert.ok(run.hwmMiB <= MEMORY_BUDGET_MIB, `the check peaked at ${run.hwmMiB.toFixed(0)} MiB; the budget is ${MEMORY_BUDGET_MIB} MiB`);
    console.error(`moonstone-openwork-ring: checked in ${(run.ms / 1000).toFixed(1)} s at one CPU, peak ${run.hwmMiB.toFixed(0)} MiB`);
  });

  it('the fixture is the tree flo2.io kept for revision 3', () => {
    const tree = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { name: string; revision: number; root: { children: { id: string; op?: string; children?: { op: string }[] }[] } };
    assert.equal(tree.name, 'moonstone-openwork-ring');
    assert.equal(tree.revision, 3);
    const blend = tree.root.children.find((c) => c.op === 'smooth_union')!;
    assert.deepEqual(blend.children!.map((c) => c.op), ['sweep', 'sweep', 'sweep', 'sweep']);
  });
});
