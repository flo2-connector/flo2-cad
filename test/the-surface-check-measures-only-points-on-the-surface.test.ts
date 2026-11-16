// THE SURFACE CHECK MEASURES ONLY POINTS IT FOUND ON THE BLEND'S SURFACE
// (con:surface-deviation-tolerance; fact:root-cause-the-surface-check-measured-points-its-own-
// projection-left-off-the-blends-surface-2026-11-16).
//
// The symptom: on a local branch that meshed a blend more coarsely, two wavy wires blended
// read "surface_deviation fail 0.053 mm"; the facets there stand 0.002-0.003 mm off.
//
// The cause, measured: the check measures the written facets against points the library
// declares on the blend's own surface, each found from a point of a facet by looking along
// that facet's normal (field.ts, projectOntoSurface). A needle-thin facet's normal can lie
// almost along the surface (86-88 degrees off it); in a concave hollow that line stays inside
// the solid, meets no surface within the 0.2 mm reach, and the point was WRITTEN AT THE REACH
// ANYWAY, 0.04 mm inside the solid, and measured as if it were on the surface. The 19 points
// over the limit were exactly the 19 not on the surface.
//
// The class: an instrument writes a value it did not find. These pin that a point is reported
// on the surface only where it was found there, and that the check never measures a point
// that was not.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fieldOf, projectOntoSurface, SURFACE_REACH_MM } from '../src/library/field.js';
import type { TreeNode } from '../src/piece/tree.js';

const mm = (x: number) => `${x} mm`;

/** Two spheres of 1 mm blended with a 0.5 mm fillet: at x = 0 a neck, concave along the x axis. */
const TWO_SPHERES: TreeNode = {
  id: 'pair',
  op: 'smooth_union',
  params: { radius: mm(0.5) },
  children: [
    { id: 'l', op: 'translate', params: { x: mm(-0.9) }, children: [{ id: 'ls', op: 'sphere', params: { radius: mm(1) } }] },
    { id: 'r', op: 'translate', params: { x: mm(0.9) }, children: [{ id: 'rs', op: 'sphere', params: { radius: mm(1) } }] },
  ],
};

/** The neck's radius: where the field is zero on the y axis, by bisection. */
function neckRadius(f: (x: number, y: number, z: number) => number): number {
  let lo = 0, hi = 2;
  assert.ok(f(0, lo, 0) < 0 && f(0, hi, 0) > 0, 'the neck is not bracketed');
  for (let i = 0; i < 100; i++) {
    const m = (lo + hi) / 2;
    if (f(0, m, 0) < 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

describe('a point is reported on the blend\'s surface only where it was found there', () => {
  it("looking along a sliver's normal that lies almost along a concave hollow: the point written is on the surface, or the call says it found none", () => {
    const f = fieldOf(TWO_SPHERES);
    const r = neckRadius(f);
    // A point of a facet 0.002 mm inside the neck (as the needle facets stood), and that
    // facet's normal 87 degrees off the surface's (which is +y there), along the hollow.
    const p: [number, number, number] = [0, r - 0.002, 0];
    const off = (87 * Math.PI) / 180;
    const d: [number, number, number] = [Math.sin(off), Math.cos(off), 0];
    // The line meets no surface within the reach, both ways: what the sliver met.
    for (let s = -SURFACE_REACH_MM; s <= SURFACE_REACH_MM; s += SURFACE_REACH_MM / 400) assert.ok(f(p[0] + s * d[0], p[1] + s * d[1], p[2]) < 0, `the line leaves the solid at ${s} mm`);
    const out = new Float64Array(3);
    const found: unknown = projectOntoSurface(f, p, d, out, 0);
    const v = Math.abs(f(out[0]!, out[1]!, out[2]!));
    assert.ok(found === false || (found === true && v < 1e-6), `the call returned ${String(found)} and wrote a point ${v.toFixed(4)} mm off the surface`);
  });
});
