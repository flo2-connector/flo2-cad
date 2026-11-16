// A PINCH: a point the casting file would weld that the kernel keeps apart
// (fact:root-cause-a-blends-level-set-can-pinch-two-sheets-at-one-point-and-nothing-before-the-file-checks-by-position-2026-11-16).
//
// The kernel calls a mesh sound by vertex INDEX. A casting file holds only POSITIONS, at
// float32 (build.ts, atFilePrecision). Two distinct vertices at one float32 point are welded
// into one by the file. Where an edge joins them, the float32 step collapses that edge in the
// kernel first and the solid stays sound. Where no edge joins them, two sheets of the surface
// meet at that point, and the file holds edges shared by more than two faces. A blend's level
// set leaves such points on some grid placements (ops.ts, smoothUnion).

/** The points of a mesh that two of its vertices share at float32 with no edge between them. */
export function pinchedPositions(mesh: { numProp: number; vertProperties: ArrayLike<number>; triVerts: ArrayLike<number> }): number {
  const np = mesh.numProp, V = mesh.vertProperties, T = mesh.triVerts;
  const n = V.length / np;
  const P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) P[i * 3 + c] = V[i * np + c]!;
  // Sorted by position, so vertices at one point sit side by side; a typed array keeps it small.
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => P[a * 3]! - P[b * 3]! || P[a * 3 + 1]! - P[b * 3 + 1]! || P[a * 3 + 2]! - P[b * 3 + 2]!);
  const same = (a: number, b: number) => P[a * 3] === P[b * 3] && P[a * 3 + 1] === P[b * 3 + 1] && P[a * 3 + 2] === P[b * 3 + 2];
  // Each run of vertices at one point: its members, by the run's first vertex.
  const runOf = new Map<number, number>();
  const runs: number[][] = [];
  for (let s = 0; s < n; ) {
    let e = s + 1;
    while (e < n && same(order[s]!, order[e]!)) e++;
    if (e - s > 1) {
      const members = Array.from(order.subarray(s, e));
      for (const v of members) runOf.set(v, runs.length);
      runs.push(members);
    }
    s = e;
  }
  if (!runs.length) return 0;
  // The edges inside a run join its vertices into groups the float32 step collapses into one.
  const parent = new Map<number, number>();
  const root = (v: number): number => {
    let r = v;
    while (parent.has(r)) r = parent.get(r)!;
    return r;
  };
  for (let t = 0; t < T.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = T[t + e]!, b = T[t + ((e + 1) % 3)]!;
      const ra = runOf.get(a);
      if (ra === undefined || ra !== runOf.get(b)) continue;
      const x = root(a), y = root(b);
      if (x !== y) parent.set(x, y);
    }
  }
  // A point is pinched when, after those collapses, it is still held by more than one vertex.
  let pinched = 0;
  for (const members of runs) if (new Set(members.map(root)).size > 1) pinched++;
  return pinched;
}
