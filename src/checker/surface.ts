// The SURFACE's direction at each triangle, as opposed to the triangle's own.
//
// A triangle whose corners all lie on the intended surface leans from that surface by
// up to about atan(d / w), where d is how far the written facets may stand off the
// surface (the surface limit, 0.01 mm, con:surface-deviation-tolerance, which the
// surface check holds on every export) and w is the triangle's smallest width (its
// shortest altitude). A triangle at least d / tan(15°) wide (0.037 mm at the 0.01 mm
// limit) therefore leans less than 15°, and has a direction of its own. A SLIVER does
// not: 0.002 mm wide, with its long edge a chord of a curve, it can lean 30-70°
// while every corner sits on the surface.
//
// The thickness and gap checks used every triangle's own normal as the surface's, so
// slivers beside a 90° rim made the rim look sharper than the 105° test that tells a
// wall's far side from a corner, and the wall read 0.001 mm on a 1.0 mm plate at three
// mesh densities, somewhere different each time
// (fact:wall-check-reads-sliver-facets-as-zero-thickness).
//
// The rule here: every triangle that is not a sliver keeps its own normal, so creases
// stay sharp and no direction is invented that belongs to neither side of one. A sliver
// takes the normal of the well-shaped triangle near it (within its own length, and at
// least 0.1 mm) whose normal is closest to its own: the surface it was cut from, since
// a lean of less than 45° leaves it nearer its own surface than a 90° neighbour. A
// sliver with no well-shaped triangle that near keeps its own.
//
// Three other rules were measured and rejected, on a band with an added pedestal and
// on a petal ring:
//  · averaging normals over 0.1 mm gave a facet of the band's side wall, at the corner
//    under the pedestal's overhang, a direction 45° off both surfaces there, and the
//    wall read 0.81 mm on 1.7 mm metal and 0.58 mm on 0.8 mm metal;
//  · giving a sliver its LARGEST edge-neighbour's direction turned an exact sliver on
//    the flat top of the pedestal sideways, to an added stem's, and the wall read 0.71 mm;
//  · letting a sliver keep its normal when it agreed with a neighbouring sliver let the
//    lean drift along a fan of slivers, 10-30° a step, and a petal's 90° rim read 0.03 mm.

import type { Bvh } from './bvh.js';

/** A triangle leaning less than this from the surface cannot make a 90° edge look like a wall's far side (the 105° test). */
const LEAN_MARGIN_DEG = 15;
/** A sliver is thin for its length: its longest edge is several times its width. */
const SLIVER_ASPECT = 4;
/** The least distance searched round a sliver for the surface it was cut from. */
const SEARCH_MM = 0.1;

export interface SurfaceDirections {
  /** Per triangle: the unit normal of the surface it lies on. */
  normal: Float64Array;
  /** How many triangles were slivers, and how many of those took another triangle's direction. */
  slivers: number;
  borrowed: number;
  /** The width below which a thin triangle counts as a sliver, in mm. */
  sliverWidthMm: number;
}

export function surfaceDirections(bvh: Bvh, surfaceDeviationMm: number): SurfaceDirections {
  const n = bvh.n, P = bvh.pos, T = bvh.tri, N = bvh.normal, A = bvh.area, C = bvh.centroid;
  const widthLimit = surfaceDeviationMm / Math.tan((LEAN_MARGIN_DEG * Math.PI) / 180);
  const out = Float64Array.from(N);
  const sliver = new Uint8Array(n);
  const longest = new Float64Array(n);
  let slivers = 0;
  for (let t = 0; t < n; t++) {
    let l = 0;
    for (let k = 0; k < 3; k++) {
      const a = T[t * 3 + k]! * 3, b = T[t * 3 + ((k + 1) % 3)]! * 3;
      l = Math.max(l, Math.hypot(P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!));
    }
    longest[t] = l;
    const width = l > 0 ? (2 * A[t]!) / l : 0;
    if (width < widthLimit && l > SLIVER_ASPECT * width) {
      sliver[t] = 1;
      slivers++;
    }
  }
  let borrowed = 0;
  for (let t = 0; t < n; t++) {
    if (!sliver[t]) continue;
    const nx = N[t * 3]!, ny = N[t * 3 + 1]!, nz = N[t * 3 + 2]!;
    let best = -1, bestCos = -2;
    bvh.forEachWithin(C[t * 3]!, C[t * 3 + 1]!, C[t * 3 + 2]!, Math.max(SEARCH_MM, longest[t]!), (u) => {
      if (sliver[u]) return;
      const c = nx * N[u * 3]! + ny * N[u * 3 + 1]! + nz * N[u * 3 + 2]!;
      if (c > bestCos) {
        bestCos = c;
        best = u;
      }
    });
    if (best < 0) continue;
    out[t * 3] = N[best * 3]!;
    out[t * 3 + 1] = N[best * 3 + 1]!;
    out[t * 3 + 2] = N[best * 3 + 2]!;
    borrowed++;
  }
  return { normal: out, slivers, borrowed, sliverWidthMm: widthLimit };
}
