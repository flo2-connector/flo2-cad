// A ROUND WIRE ALONG A PATH (the `sweep` operation), BUILT AS A TUBE
// (fact:root-cause-a-swept-wire-costs-memory-by-how-it-is-built-not-what-it-is-2026-11-10).
//
// The wire is every point within `r` of the path: a ball rolled along it. It used to be built
// as that definition reads, the hull of a ball at each end of every segment, all unioned, which
// made about 8 times a tube's triangles and grew with every path point and with the build's
// fineness (one 200-point wire of radius 0.6 mm needed 556 MiB at the surface check's
// reference). Here it is a tube, made directly as one mesh:
//   · a ring of `n` points round each path point, in the plane that bisects the joint there
//     (a mitre), so the tube's surface is the two segments' cylinders meeting in that plane;
//   · a half ball on each open end, its equator the end ring;
//   · the path split into RUNS wherever a mitre would not hold the round wire: where the
//     mitre's outer corner would stand off the wire's round elbow by more than the casting
//     file's tolerance (EXPORT_TOL, for every build, so a picture, the casting file and the
//     surface check's finer reference are one shape drawn more or less finely), where the two segments' rings would cross (a bend tighter than the wire), or
//     where the wire comes back within its own width (a scroll curling in, a coil). Each run is
//     a tube of its own with half balls on its ends, and the runs are unioned, so at a split
//     the joint is round as the old chain made it, and where the wire meets itself the union
//     makes one solid of it.
// A smooth path at the casting file's fineness is one run: one mesh, no boolean at all.
// Everything this makes for itself is freed before it returns; only the wire is kept.

import { sphereSegments, type Kernel, type Manifold, type Vec3 } from '../kernel/manifold.js';
import { EXPORT_TOL } from './tolerances.js';

type V = Vec3;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => mul(a, 1 / len(a));

/** `v` turned the way that takes unit `from` onto unit `to`, about their common normal (Rodrigues). */
function turn(v: V, from: V, to: V): V {
  const axis = cross(from, to);
  const s = len(axis), c = dot(from, to);
  if (s < 1e-12) return c > 0 ? v : mul(v, -1);
  const k = mul(axis, 1 / s);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}

/** The nearest distance between segments ab and cd. */
function segmentGap(a: V, b: V, c: V, d: V): number {
  const u = sub(b, a), v = sub(d, c), w = sub(a, c);
  const A = dot(u, u), B = dot(u, v), C = dot(v, v), D = dot(u, w), E = dot(v, w);
  const den = A * C - B * B;
  let s = den > 1e-18 ? Math.min(1, Math.max(0, (B * E - C * D) / den)) : 0;
  let t = C > 1e-18 ? (B * s + E) / C : 0;
  if (t < 0) { t = 0; s = A > 1e-18 ? Math.min(1, Math.max(0, -D / A)) : 0; }
  else if (t > 1) { t = 1; s = A > 1e-18 ? Math.min(1, Math.max(0, (B - D) / A)) : 0; }
  return len(sub(add(a, mul(u, s)), add(c, mul(v, t))));
}

/** Where the path's runs break: a joint whose mitre would not hold the round wire at `tol`. */
function mitreBreaks(p: V[], closed: boolean, r: number, tol: number): Set<number> {
  const m = p.length, breaks = new Set<number>();
  for (let i = closed ? 0 : 1; i < (closed ? m : m - 1); i++) {
    const a = p[(i - 1 + m) % m]!, b = p[i]!, c = p[(i + 1) % m]!;
    const u = sub(b, a), v = sub(c, b);
    const lu = len(u), lv = len(v);
    const theta = Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (lu * lv))));
    const crosses = r * Math.tan(theta / 2) >= 0.5 * Math.min(lu, lv); // the two rings would meet inside the wire
    const standsOff = r * (1 / Math.cos(theta / 2) - 1) > tol; // the mitre's outer corner, past the round elbow
    if (theta > 1e-9 && (crosses || standsOff || theta > Math.PI / 2)) breaks.add(i);
  }
  return breaks;
}

/**
 * The runs of path indices, each a list of consecutive points, split at `breaks` and wherever
 * the wire would come back within its own width (2r) of a part of the same run more than half
 * a turn of its own radius away along the path.
 */
function runsOf(p: V[], closed: boolean, r: number, breaks: Set<number>): { pts: number[]; closed: boolean }[] {
  const m = p.length;
  // A closed path with no break is one closed run; otherwise it is opened at a break.
  // A closed path is walked all the way round, back to where it starts (at a break if it has one).
  const start = closed && breaks.size ? Math.min(...breaks) : 0;
  const order = closed ? [...Array(m + 1).keys()].map((i) => (start + i) % m) : [...p.keys()];
  const near = 2 * r * (1 + 1e-6);
  const runs: { pts: number[]; closed: boolean }[] = [];
  let cur: number[] = [order[0]!];
  let arc: number[] = [0]; // the arc length along the run to each of its points
  // A grid of the run's segments, cell size 2r plus the longest segment, so only nearby ones are measured.
  let cellsOf = new Map<string, number[]>();
  let longest = 0;
  for (let i = 1; i < order.length; i++) longest = Math.max(longest, len(sub(p[order[i]!]!, p[order[i - 1]!]!)));
  const cell = near + longest;
  const key = (q: V) => `${Math.floor(q[0] / cell)},${Math.floor(q[1] / cell)},${Math.floor(q[2] / cell)}`;
  const addSeg = (j: number) => {
    const a = p[cur[j]!]!, b = p[cur[j + 1]!]!;
    const k = key(mul(add(a, b), 0.5));
    (cellsOf.get(k) ?? cellsOf.set(k, []).get(k)!).push(j);
  };
  const tooNear = (a: V, b: V, arcA: number): boolean => {
    const mid = mul(add(a, b), 0.5);
    const [cx, cy, cz] = [Math.floor(mid[0] / cell), Math.floor(mid[1] / cell), Math.floor(mid[2] / cell)];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of cellsOf.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        // Parts of the wire within half a turn of its own radius along the path are its own bend.
        if (arcA - arc[j + 1]! <= Math.PI * r * 1.05) continue;
        if (segmentGap(a, b, p[cur[j]!]!, p[cur[j + 1]!]!) < near) return true;
      }
    }
    return false;
  };
  for (let i = 1; i < order.length; i++) {
    const a = p[order[i - 1]!]!, b = p[order[i]!]!;
    const arcA = arc[arc.length - 1]!;
    if (cur.length > 1 && tooNear(a, b, arcA)) {
      runs.push({ pts: cur, closed: false });
      cur = [order[i - 1]!];
      arc = [0];
      cellsOf = new Map();
    }
    cur.push(order[i]!);
    arc.push(arc[arc.length - 1]! + len(sub(b, a)));
    addSeg(cur.length - 2);
    if (breaks.has(order[i]!) && i < order.length - 1) {
      runs.push({ pts: cur, closed: false });
      cur = [order[i]!];
      arc = [0];
      cellsOf = new Map();
    }
  }
  if (cur.length > 1) {
    // A closed path that nothing split is one closed run: its last point is its first.
    if (closed && !breaks.size && !runs.length) runs.push({ pts: cur.slice(0, -1), closed: true });
    else runs.push({ pts: cur, closed: false });
  }
  return runs;
}

/** One run's tube as a solid: rings at its points (mitred at each joint), half balls on its ends unless it is closed. */
function runTube(k: Kernel, pts: V[], closed: boolean, r: number, n: number, twist: number): Manifold {
  const m = pts.length;
  const segs = closed ? m : m - 1;
  const t: V[] = [];
  for (let i = 0; i < segs; i++) t.push(unit(sub(pts[(i + 1) % m]!, pts[i]!)));
  // A frame normal to the first segment, carried along the path without twisting (parallel transport).
  const t0 = t[0]!;
  const seed: V = Math.abs(t0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let N = unit(cross(cross(t0, seed), t0));
  const frames: { N: V; B: V }[] = [];
  for (let i = 0; i < segs; i++) {
    if (i > 0) N = unit(turn(N, t[i - 1]!, t[i]!));
    frames.push({ N, B: cross(t[i]!, N) });
  }
  // A closed run's frame comes back turned about the first segment: spread that turn along it.
  let closeTurn = 0;
  if (closed) {
    const back = unit(turn(frames[segs - 1]!.N, t[segs - 1]!, t0));
    closeTurn = Math.atan2(dot(cross(back, frames[0]!.N), t0), dot(back, frames[0]!.N));
  }
  const verts: number[] = [];
  const ringAt = (i: number): number => {
    // The ring round point i, in the plane bisecting its joint (or square to its one segment at an open end).
    const p = pts[i]!;
    const segIn = closed ? (i - 1 + segs) % segs : i - 1;
    const segOut = closed ? i % segs : i;
    const useIn = segIn >= 0 && (closed || i > 0);
    const useOut = segOut < segs && (closed || i < m - 1);
    const s = useIn ? segIn : segOut;
    const along = t[s]!;
    const { N: Ni, B: Bi } = frames[s]!;
    const plane = useIn && useOut ? unit(add(t[segIn]!, t[segOut]!)) : along;
    const spin = twist + (closed ? (closeTurn * s) / segs : 0);
    const first = verts.length / 3;
    for (let j = 0; j < n; j++) {
      const a = (2 * Math.PI * j) / n + spin;
      const q = add(p, add(mul(Ni, r * Math.cos(a)), mul(Bi, r * Math.sin(a))));
      // Slid along the incoming segment onto the bisecting plane: the mitre.
      const d = dot(sub(q, p), plane) / dot(along, plane);
      const w = sub(q, mul(along, d));
      verts.push(w[0], w[1], w[2]);
    }
    return first;
  };
  const tri: number[] = [];
  const band = (a: number, b: number) => {
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      tri.push(a + j, b + j, b + j1, a + j, b + j1, a + j1);
    }
  };
  const rings: number[] = [];
  for (let i = 0; i < m; i++) rings.push(ringAt(i));
  for (let i = 0; i < segs; i++) band(rings[i]!, rings[(i + 1) % m]!);
  if (!closed) {
    // A half ball on each end: latitude rings from the end ring to a pole, on the end's own frame.
    const cap = (ring: number, centre: V, out: V, Nc: V, Bc: V, spin: number, back: boolean) => {
      const h = Math.max(2, Math.ceil(n / 4));
      let prev = ring;
      for (let l = 1; l < h; l++) {
        const beta = (l * Math.PI) / 2 / h;
        const first = verts.length / 3;
        for (let j = 0; j < n; j++) {
          const a = (2 * Math.PI * j) / n + spin;
          const q = add(add(centre, mul(out, r * Math.sin(beta))), add(mul(Nc, r * Math.cos(beta) * Math.cos(a)), mul(Bc, r * Math.cos(beta) * Math.sin(a))));
          verts.push(q[0], q[1], q[2]);
        }
        if (back) band(first, prev); else band(prev, first);
        prev = first;
      }
      const pole = verts.length / 3;
      const q = add(centre, mul(out, r));
      verts.push(q[0], q[1], q[2]);
      for (let j = 0; j < n; j++) {
        if (back) tri.push(pole, prev + j, prev + ((j + 1) % n));
        else tri.push(prev + j, pole, prev + ((j + 1) % n));
      }
    };
    cap(rings[m - 1]!, pts[m - 1]!, t[segs - 1]!, frames[segs - 1]!.N, frames[segs - 1]!.B, twist, false);
    cap(rings[0]!, pts[0]!, mul(t[0]!, -1), frames[0]!.N, frames[0]!.B, twist, true);
  }
  // Wound outward: the triangles above run one way along a ring; turn them all if the volume says inward.
  const P = verts;
  let vol = 0;
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i]! * 3, b = tri[i + 1]! * 3, c = tri[i + 2]! * 3;
    vol += P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) - P[a + 1]! * (P[b]! * P[c + 2]! - P[b + 2]! * P[c]!) + P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!);
  }
  if (vol < 0) for (let i = 0; i < tri.length; i += 3) { const x = tri[i + 1]!; tri[i + 1] = tri[i + 2]!; tri[i + 2] = x; }
  return new k.Manifold(new k.Mesh({ numProp: 3, vertProperties: Float32Array.from(verts), triVerts: Uint32Array.from(tri) }));
}

/** The round wire of radius `r` along `path` (closed back to its first point when `closed`), at fineness `tol`. The caller owns the result. */
export function buildSweep(k: Kernel, r: number, path: V[], closed: boolean, tol: number): Manifold {
  // Points that repeat their neighbour make no segment.
  const p: V[] = [];
  for (const q of path) if (!p.length || len(sub(q, p[p.length - 1]!)) > 1e-9) p.push(q);
  if (closed && p.length > 1 && len(sub(p[0]!, p[p.length - 1]!)) <= 1e-9) p.pop();
  const n = sphereSegments(r, tol);
  if (p.length === 1) return k.Manifold.sphere(r, n).translate(p[0]!);
  const isClosed = closed && p.length > 2;
  const runs = runsOf(p, isClosed, r, mitreBreaks(p, isClosed, r, EXPORT_TOL));
  // Each run's half balls are turned a different amount, so where two runs meet their balls cross instead of coinciding face for face.
  const tubes = runs.map((run, i) => runTube(k, run.pts.map((j) => p[j]!), run.closed, r, n, ((7.31 * i + 3.7) * Math.PI) / 180));
  if (tubes.length === 1) return tubes[0]!;
  const out = k.Manifold.union(tubes);
  for (const x of tubes) x.delete();
  return out;
}
