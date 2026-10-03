// Stones, sized from their MEASURED dimensions as a grading report gives them
// (dec:the-first-increment, widened 2026-10-03: "fitted to the GIA report, not to
// a chart"): a round is diameter × depth, an emerald cut is length × width × depth,
// all in mm. A carat weight is kept for reference only and never sizes anything.
//
// A stone is NEVER part of the casting file. It is built only to cut its seat in
// the metal and to be drawn in the preview.
//
// Proportions inside the measured depth (how much is crown, girdle and pavilion)
// are modelling assumptions, not casting limits:
//   · round brilliant: crown 16.2 % and pavilion 43.1 % of the diameter in the
//     Tolkowsky proportions (GIA, Hemphill et al., Gems & Gemology 1998, Table 1:
//     https://www.gia.edu/doc/Modeling-the-Appearance-of-the-Round-Brilliant-Cut-Diamond-An-Analysis-of-Brilliance.pdf),
//     scaled to fill the measured depth after a 2 % girdle; table 53 %;
//   · emerald cut: no primary source publishes crown and pavilion shares, so the
//     same crown : pavilion split as the round is used; table 65 % of the width
//     (retail guidance 61-68 %, https://beyond4cs.com/shapes/emerald/); corners cut
//     at 15 % of the width; the pavilion closes to a keel of length L - W.

import type { Vec3 } from '../kernel/manifold.js';

export type StoneShape = 'round' | 'emerald';
export type Orientation = 'east_west' | 'north_south';

export interface StoneSpec {
  shape: StoneShape;
  /** Long side (emerald) or diameter (round), mm. */
  lengthMm: number;
  /** Short side (emerald) or diameter (round), mm. */
  widthMm: number;
  depthMm: number;
  orientation: Orientation;
}

export interface StoneShapeInfo {
  /** Girdle outline in the piece's XY plane, counter-clockwise, centred on the stone. */
  outline: [number, number][];
  girdle: number;
  crown: number;
  pavilion: number;
  /** Hull points of the stone solid with the girdle's BOTTOM at z = 0. */
  points(clearance: number): Vec3[];
}

const CROWN_SHARE = 16.2 / (16.2 + 43.1);

function roundOutline(r: number, segments: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

/** A cut-corner rectangle, long side along X, counter-clockwise. */
function emeraldOutline(L: number, W: number, corner: number): [number, number][] {
  const x = L / 2, y = W / 2, c = corner;
  return [
    [x, -y + c],
    [x, y - c],
    [x - c, y],
    [-x + c, y],
    [-x, y - c],
    [-x, -y + c],
    [-x + c, -y],
    [x - c, -y],
  ];
}

function rotateToOrientation(pts: [number, number][], o: Orientation): [number, number][] {
  // east_west: the long axis runs across the finger (X). north_south: along it (Y).
  return o === 'east_west' ? pts : pts.map(([x, y]) => [-y, x] as [number, number]);
}

/** Offsets a convex CCW polygon outward by d (exact for straight sides; corners mitred within the convex hull). */
function scaleAbout(pts: [number, number][], s: number): [number, number][] {
  return pts.map(([x, y]) => [x * s, y * s]);
}

export function stoneShape(spec: StoneSpec, tol: number): StoneShapeInfo {
  const minor = Math.min(spec.lengthMm, spec.widthMm);
  const girdle = Math.max(0.08, 0.02 * minor);
  const rest = Math.max(0.2, spec.depthMm - girdle);
  const crown = rest * CROWN_SHARE;
  const pavilion = rest - crown;
  if (spec.shape === 'round') {
    const r = spec.lengthMm / 2;
    const n = Math.max(24, Math.ceil(Math.PI / Math.acos(1 - Math.min(tol, r / 4) / r)));
    const outline = roundOutline(r, n);
    return {
      outline,
      girdle,
      crown,
      pavilion,
      points(c: number) {
        const pts: Vec3[] = [];
        const rr = r + c;
        for (const [x, y] of roundOutline(rr, n)) {
          pts.push([x, y, -c * 0.5]);
          pts.push([x, y, girdle + c * 0.5]);
        }
        for (const [x, y] of roundOutline((r * 0.53) + c, Math.max(16, n / 2))) pts.push([x, y, girdle + crown + c]);
        pts.push([0, 0, -pavilion - c]);
        return pts;
      },
    };
  }
  const L = spec.lengthMm, W = spec.widthMm;
  const corner = 0.15 * W;
  const base = emeraldOutline(L, W, corner);
  const outline = rotateToOrientation(base, spec.orientation);
  return {
    outline,
    girdle,
    crown,
    pavilion,
    points(c: number) {
      const pts: Vec3[] = [];
      const grown = emeraldOutline(L + 2 * c, W + 2 * c, corner + c * 0.4142);
      for (const [x, y] of rotateToOrientation(grown, spec.orientation)) {
        pts.push([x, y, -c * 0.5]);
        pts.push([x, y, girdle + c * 0.5]);
      }
      const inset = (W * (1 - 0.65)) / 2;
      const table = emeraldOutline(L - 2 * inset + 2 * c, W - 2 * inset + 2 * c, corner * 0.65);
      for (const [x, y] of rotateToOrientation(table, spec.orientation)) pts.push([x, y, girdle + crown + c]);
      const keel = (L - W) / 2;
      for (const [x, y] of rotateToOrientation(
        [
          [keel + 0.05, 0.05],
          [keel + 0.05, -0.05],
          [-keel - 0.05, 0.05],
          [-keel - 0.05, -0.05],
        ],
        spec.orientation,
      ))
        pts.push([x, y, -pavilion - c]);
      return pts;
    },
  };
}

export { scaleAbout };
