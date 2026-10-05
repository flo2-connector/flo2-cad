// The casting checker (cmp:casting-checker). It reads back the WRITTEN STL with
// its own parser and measures it; it never calls the kernel or the library
// (con:checker-independent-of-the-kernel). The library's feature declarations
// say where the prongs, band, stone and bezel are; every number in the report is
// measured from the file's own triangles.
//
// Three rules keep the readings about the SHAPE rather than about how it was cut
// into triangles or what else touches it:
//  · thickness and gaps follow the surface's direction: a sliver too narrow to
//    have one of its own takes it from the surface it was cut from (surface.ts;
//    fact:wall-check-reads-sliver-facets-as-zero-thickness);
//  · a thickness ball is stopped only by metal's far side, met square-on and from
//    across, never by a crease or corner it reaches from the side or through a face
//    (sampleThickness, below; fact:wall-check-reads-overhang-beside-band-edge,
//    fact:wall-ball-stopped-at-a-crease-it-reached-through-a-face);
//  · a section is the whole mesh cut by a plane, clipped afterwards to the part
//    the declaration names (sections, below; fact:band-check-measures-added-shapes-as-band).
// And a thin place is named by the part whose metal holds it: the band only inside
// the band's own declared section, an added shape by its id (partAt, below).
//
// A sheet from the tree's thicken operation (a cupped petal, a leaf) declares its
// middle surface and nominal thickness; the sheet check measures the file square to
// that surface and holds it to the wall minimum, and a thin place on a sheet is
// reported under the sheet's own name (sheets, below).
//
// A check that cannot run is a FAIL (owner, round 1, Q6): any exception inside
// a check becomes result "could_not_run", which blocks the export.

import { Bvh, CORNER, EDGE, IN_FACE } from './bvh.js';
import type { AddedDecl, BandDecl, FeatureDecl, P2, ProngDecl, SheetDecl } from './features.js';
import { segmentCrossesTri, type V3 } from './geom.js';
import { readBinaryStl, type ReadMesh } from './stl.js';
import { surfaceDirections } from './surface.js';

export interface CheckLimits {
  wall: number;
  band: number;
  prong: number;
  detail: number;
  gap: number;
  surfaceDeviation: number;
  gripMin: number;
  lipMinOfCrown: number;
  lipMaxOfCrown: number;
}

export interface Where {
  part: string;
  feature?: string;
  clock?: string;
  /** On a sheet: the other sheets that meet it here, when the place lies on more than one. */
  meets?: string[];
  point_mm: [number, number, number];
  description: string;
}

export interface CheckEntry {
  id: 'watertight' | 'wall' | 'band' | 'prong' | 'bezel_wall' | 'bezel_lip' | 'prong_grip' | 'sheet' | 'detail' | 'gap' | 'surface_deviation';
  name: string;
  limit: string;
  result: 'pass' | 'fail' | 'could_not_run';
  measured: string | null;
  /** The measured value in mm, when there is one. */
  value?: number;
  where: Where | null;
  /** Every failing feature, when more than one fails (e.g. each thin prong). `nominal` is what the feature was declared to be, when it says. */
  failing?: { label: string; value: number; nominal?: number; where: Where }[];
  method: string;
}

export interface CheckRunResult {
  entries: CheckEntry[];
  mesh: { triangles: number; vertices: number; shells: number; volumeMm3: number };
  ms: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const mm = (x: number) => `${r3(x)} mm`;
const pt = (p: V3): [number, number, number] => [r3(p[0]), r3(p[1]), r3(p[2])];

/** Clock position seen from above, the finger pointing to 12 o'clock (+Y). */
export function clockAt(x: number, y: number): string {
  let deg = (Math.atan2(x, y) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const total = Math.round((deg / 30) * 60);
  let h = Math.floor(total / 60) % 12;
  if (h === 0) h = 12;
  return `${h}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Runs every check on the written STL. `reference` is the same piece tessellated
 * far more finely (also STL bytes, read with the same parser): the surface check
 * measures how far the true surface stands off the written facets
 * (ver:surface-deviation-check).
 */
export function runChecks(stl: Uint8Array, decl: FeatureDecl, L: CheckLimits, reference?: Uint8Array): CheckRunResult {
  const t0 = performance.now();
  let mesh: ReadMesh;
  try {
    mesh = readBinaryStl(stl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const ids: CheckEntry['id'][] = ['watertight', 'wall', 'band', 'detail', 'gap', 'surface_deviation'];
    return {
      entries: ids.map((id) => ({ id, name: id, limit: '-', result: 'could_not_run', measured: `the STL could not be read back: ${msg}`, where: null, method: 'read-back' })),
      mesh: { triangles: 0, vertices: 0, shells: 0, volumeMm3: 0 },
      ms: performance.now() - t0,
    };
  }
  const bvh = new Bvh(mesh.positions, mesh.triangles);
  const entries: CheckEntry[] = [];
  const guard = (id: CheckEntry['id'], name: string, limit: string, fn: () => CheckEntry | CheckEntry[]) => {
    try {
      const r = fn();
      entries.push(...(Array.isArray(r) ? r : [r]));
    } catch (e) {
      entries.push({ id, name, limit, result: 'could_not_run', measured: `the check could not run: ${e instanceof Error ? e.message : String(e)}`, where: null, method: 'error' });
    }
  };

  let shells = 0, volume = 0;
  guard('watertight', 'One watertight solid', 'manifold edges, no self-intersections, faces outward, exactly one shell', () => {
    const w = watertight(mesh, bvh);
    shells = w.shells;
    volume = w.volume;
    return w.entry;
  });

  // The surface's direction at each triangle: its own normal, except that a sliver takes the surface's it was cut from (surface.ts).
  const surface = surfaceDirections(bvh, L.surfaceDeviation).normal;
  const samples = sampleThickness(bvh, surface);
  guard('wall', 'Wall thickness', mm(L.wall), () => wallEntry(bvh, samples, L, decl));
  guard('detail', 'Smallest detail', mm(L.detail), () => detailEntry(bvh, samples, L, decl));
  if (decl.band) guard('band', 'Ring band thickness', mm(L.band), () => bandEntry(bvh, decl.band!, L));
  if (decl.prongs.length) {
    guard('prong', 'Prong thickness', mm(L.prong), () => prongEntry(bvh, decl.prongs, L));
    if (decl.stone) guard('prong_grip', 'Prongs grip the stone', `each reaches ${mm(L.gripMin)} over the girdle`, () => gripEntry(bvh, decl, L));
  }
  if (decl.bezel && decl.stone) {
    guard('bezel_wall', 'Bezel wall thickness', mm(L.wall), () => bezelWallEntry(bvh, samples, decl, L));
    guard('bezel_lip', 'Bezel lip height', `${Math.round(L.lipMinOfCrown * 100)}-${Math.round(L.lipMaxOfCrown * 100)} % of the crown`, () => bezelLipEntry(bvh, decl, L));
  }
  if (decl.sheets?.length) guard('sheet', 'Sheet thickness', `${mm(L.wall)}, square to the surface`, () => sheetEntry(bvh, surface, decl.sheets!, L));
  guard('gap', 'Smallest gap', mm(L.gap), () => gapEntry(bvh, surface, L));
  guard('surface_deviation', 'Surface smoothness', mm(L.surfaceDeviation), () => {
    if (!reference) throw new Error('no finer reference tessellation was supplied');
    return surfaceEntry(bvh, L, readBinaryStl(reference), decl);
  });
  return { entries, mesh: { triangles: mesh.count, vertices: mesh.positions.length / 3, shells, volumeMm3: volume }, ms: performance.now() - t0 };
}

// ------------------------------------------------------------- watertight

function watertight(mesh: ReadMesh, bvh: Bvh): { entry: CheckEntry; shells: number; volume: number } {
  const tri = mesh.triangles;
  const n = mesh.count;
  const edges = new Map<string, number>();
  let degenerate = 0;
  for (let t = 0; t < n; t++) {
    const a = tri[t * 3]!, b = tri[t * 3 + 1]!, c = tri[t * 3 + 2]!;
    if (a === b || b === c || a === c) degenerate++;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = `${u}>${v}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let open = 0, nonManifold = 0, flipped = 0;
  for (const [key, count] of edges) {
    const [u, v] = key.split('>');
    const back = edges.get(`${v}>${u}`) ?? 0;
    if (count > 1) nonManifold++;
    if (back === 0) open++;
    else if (back !== count) flipped++;
  }
  // Shells: union-find over triangles that share an edge.
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const owner = new Map<string, number>();
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const u = tri[t * 3 + k]!, v = tri[t * 3 + ((k + 1) % 3)]!;
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      const o = owner.get(key);
      if (o === undefined) owner.set(key, t);
      else parent[find(t)] = find(o);
    }
  }
  const roots = new Set<number>();
  for (let t = 0; t < n; t++) roots.add(find(t));
  const shells = roots.size;
  // Signed volume: positive when the faces point outward.
  const p = mesh.positions;
  let vol = 0;
  for (let t = 0; t < n; t++) {
    const a = tri[t * 3]! * 3, b = tri[t * 3 + 1]! * 3, c = tri[t * 3 + 2]! * 3;
    vol += (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) / 6;
  }
  // Self-intersections: an edge of one triangle crossing the inside of another that shares no vertex with it.
  let crossings = 0;
  let firstCross: V3 | null = null;
  bvh.forEachOverlap((a, b) => {
    const ta = [tri[a * 3]!, tri[a * 3 + 1]!, tri[a * 3 + 2]!], tb = [tri[b * 3]!, tri[b * 3 + 1]!, tri[b * 3 + 2]!];
    if (ta.some((x) => tb.includes(x))) return;
    const A = [bvh.vertex(a, 0), bvh.vertex(a, 1), bvh.vertex(a, 2)] as const;
    const B = [bvh.vertex(b, 0), bvh.vertex(b, 1), bvh.vertex(b, 2)] as const;
    for (let k = 0; k < 3; k++) {
      if (segmentCrossesTri(A[k]!, A[(k + 1) % 3]!, B[0], B[1], B[2]) || segmentCrossesTri(B[k]!, B[(k + 1) % 3]!, A[0], A[1], A[2])) {
        crossings++;
        firstCross ??= A[k]!;
        return;
      }
    }
  });
  const problems: string[] = [];
  if (open) problems.push(`${open} open edge(s)`);
  if (nonManifold) problems.push(`${nonManifold} edge(s) shared by more than two faces`);
  if (flipped) problems.push(`${flipped} edge(s) with inconsistent winding`);
  if (degenerate) problems.push(`${degenerate} degenerate triangle(s)`);
  if (shells !== 1) problems.push(`${shells} separate shells (loose parts or internal voids)`);
  if (vol <= 0) problems.push(`faces point inward (signed volume ${r3(vol)} mm³)`);
  if (crossings) problems.push(`${crossings} self-intersecting triangle pair(s)`);
  const cross = firstCross as V3 | null;
  return {
    entry: {
      id: 'watertight',
      name: 'One watertight solid',
      limit: 'manifold edges, no self-intersections, faces outward, exactly one shell',
      result: problems.length ? 'fail' : 'pass',
      measured: problems.length ? problems.join('; ') : `closed and manifold, ${shells} shell, consistently wound, no self-intersection, volume ${r3(vol)} mm³`,
      where: cross ? { part: 'piece', point_mm: pt(cross), description: 'the first self-intersection found' } : null,
      method: 'read back from the written STL: edge pairing, union-find shells, signed volume, triangle-triangle crossing tests',
    },
    shells,
    volume: vol,
  };
}

// --------------------------------------------------------------- thickness

interface Sample {
  t: number;
  p: V3;
  thickness: number;
  /** The ball's centre: the middle of the metal the reading is about, which names the part it belongs to. */
  centre: V3;
}

/**
 * Local thickness at each triangle's centroid: the diameter of the largest ball
 * inside the solid that touches the surface there (a max-inscribed-sphere
 * measure, as ver:wall-thickness-check names). The ball grows along the
 * surface's direction at the centroid (`S`, surface.ts), and only surfaces facing
 * back towards it (more than 105° away) can stop it, so a convex edge does not
 * read as a thin wall. A sliver's own lean is not trusted for either: one
 * beside a 90° edge leaned far enough to make that edge look sharper than 105°,
 * and the ball then stopped within a few thousandths of a millimetre.
 *
 * The 105° test is applied where the ball MEETS a surface, not to the whole of
 * any triangle it touches. Where the ball reaches a triangle inside its face, the
 * face's direction is the surface's there, as before. Where it reaches one only at
 * an edge or a corner, that point is a crease or a corner of the surface, and the
 * direction it is met from decides. Judging the whole triangle let a crease stop
 * the ball from the side: on a band with an added pedestal overhanging its flat
 * side, a ball beside the band's edge was held by that flat side (the convex
 * edge's neighbour, rightly ignored) and stopped at the one point of it where the
 * pedestal's underside met it, a corner it reached from 59° though the underside
 * faces 134° away, and 1.56 mm of metal read 0.80 mm
 * (fact:wall-check-reads-overhang-beside-band-edge). Metal's real far side is met
 * from across, so a thin wall or a thin overhang reads as thin as it is.
 *
 * And that direction is the surface's there only if the ball meets the edge or corner
 * SQUARE-ON: the point must be the nearest to the ball's centre of every triangle that
 * meets at it, as a face's foot is the nearest point of that face. If one of them lies
 * nearer, the ball passed through that face to reach the point, from outside the metal
 * there; any face it passed and did not stop at is one the 105° test ignores, a convex
 * edge's neighbour. On a solitaire with a 1.2 mm ball added beside its head, a ball on
 * the rail's top 0.01 mm from the rail's outer edge grew straight down, out through the
 * rail's outer wall (rightly ignored, 0.01 mm from its centre), and was stopped 0.36 mm
 * down at the crease where the added ball's underside meets that wall: met from
 * straight across, but through the wall. The rail and band under it are 2.79 mm, and
 * the piece was refused at 0.73 mm, a reading that wandered 0.61-0.73 mm with the
 * tessellation (fact:wall-ball-stopped-at-a-crease-it-reached-through-a-face). The two
 * conditions are the two halves of one test, the 105° line applied to the surface where
 * the ball meets it: square-on says the direction is the surface's there, across says it
 * faces back. Neither alone is enough: a crease met square-on from the side (a pedestal
 * overhanging the band) needs the second, a crease met from across through a face the
 * first.
 */
function sampleThickness(bvh: Bvh, S: Float64Array): Sample[] {
  const out: Sample[] = [];
  const C = bvh.centroid, P = bvh.pos, T = bvh.tri;
  const fans = vertexFans(bvh);
  const near = new Float64Array(3);
  const near0 = { list: new Int32Array(1024) };
  let nearC: V3 = [0, 0, 0], nearR = -1, nNear = 0;
  let nearData: Float64Array = new Float64Array(1024 * PACKED);
  const balls = new BallCandidates();
  for (let t = 0; t < bvh.n; t++) {
    if (bvh.area[t]! < 1e-10) continue;
    const n: V3 = [S[t * 3]!, S[t * 3 + 1]!, S[t * 3 + 2]!];
    const p: V3 = [C[t * 3]!, C[t * 3 + 1]!, C[t * 3 + 2]!];
    const opposing = (u: number) => S[u * 3]! * n[0] + S[u * 3 + 1]! * n[1] + S[u * 3 + 2]! * n[2] < -0.25;
    const inward: V3 = [-n[0], -n[1], -n[2]];
    const hit = bvh.ray(p, inward, 50, opposing);
    if (!hit) continue;
    let lo = 0, hi = hit.dist / 2;
    let cx = 0, cy = 0, cz = 0;
    // A surface bounds the ball only if the ball's centre lies behind it, inside the metal:
    // a ball that has slipped out past a side face must not be stopped from outside.
    // And only where the ball meets it square-on and from across: at an edge or a corner
    // of the triangle, no other triangle meeting at that point may lie nearer the centre,
    // and the direction from the centre to the point must face back too.
    const bounds = (u: number) => {
      if (!opposing(u)) return false;
      const v = T[u * 3]! * 3;
      return (cx - P[v]!) * S[u * 3]! + (cy - P[v + 1]!) * S[u * 3 + 1]! + (cz - P[v + 2]!) * S[u * 3 + 2]! < 1e-7;
    };
    const metFromAcross = (u: number, q: Float64Array, inFace: boolean, where: number) => {
      if (inFace) return true;
      const dx = q[0]! - cx, dy = q[1]! - cy, dz = q[2]! - cz;
      const l2 = dx * dx + dy * dy + dz * dz;
      if (l2 === 0) return true;
      if ((dx * n[0] + dy * n[1] + dz * n[2]) / Math.sqrt(l2) >= -0.25) return false;
      // Square-on. The triangles meeting at the point: those round the corner it is, or the
      // one across the edge it lies on (it holds both of that edge's corners).
      const k = where >= EDGE ? where - EDGE : where - CORNER;
      const v = T[u * 3 + k]!, across = where >= EDGE ? T[u * 3 + ((k + 1) % 3)]! : -1;
      for (let j = fans.start[v]!; j < fans.start[v + 1]!; j++) {
        const w = fans.tris[j]!;
        if (w === u || bvh.area[w]! < 1e-10) continue;
        if (across >= 0 && T[w * 3] !== across && T[w * 3 + 1] !== across && T[w * 3 + 2] !== across) continue;
        bvh.closestPoint(cx, cy, cz, w, near);
        if ((near[0]! - cx) ** 2 + (near[1]! - cy) ** 2 + (near[2]! - cz) ** 2 < l2 * (1 - 1e-9)) return false;
      }
      return true;
    };
    // Every ball tried is tangent to the surface at p, on the same side, so each lies inside
    // any larger one tried before it: every ball still to be tried lies inside the ball of
    // radius hi, the bracket's top, and only triangles in that ball which face back can
    // bound one. Those are laid out once (BallCandidates) and every trial asks exactly
    // anyWithin's question of them alone. Neighbouring triangles come in turn (the kernel
    // sorts them by place), so the tree is walked for a ball a little larger than the one
    // needed, facing any way, and the next samples whose balls lie inside it take their
    // triangles from that list. A sample whose first ball the list does not hold answers
    // its trials from the tree, nearest boxes first, until one ball fits (a large ball
    // meets metal at once), and then walks for the ball of radius hi then.
    // Answering every trial from the tree had walked every face near the ball, about 11
    // times a sample: 75 s of the check on an openwork ring of 143,234 triangles
    // (fact:check-time-is-the-blend-field-and-the-wall-ball). The answers are the same.
    // (Every bound here takes the direction to be a unit vector, as the surface's are; one
    // that is not is answered from the tree alone.)
    const unit = Math.abs(n[0] * n[0] + n[1] * n[1] + n[2] * n[2] - 1) < 1e-9;
    const holds = (gx: number, gy: number, gz: number, gr: number) => unit && Math.hypot(gx - nearC[0], gy - nearC[1], gz - nearC[2]) + gr <= nearR;
    let laid = false;
    {
      const gx = p[0] - n[0] * hi, gy = p[1] - n[1] * hi, gz = p[2] - n[2] * hi, gr = hi * (1 + 1e-9) + 1e-9;
      if (holds(gx, gy, gz, gr)) {
        balls.lay(nearData, nNear, p, n, hi);
        laid = true;
      }
    }
    for (let i = 0; i < 16 && hi - lo > 0.0005; i++) {
      const r = (lo + hi) / 2;
      cx = p[0] - n[0] * r;
      cy = p[1] - n[1] * r;
      cz = p[2] - n[2] * r;
      const rr = r * (1 - 1e-6) - 1e-5;
      let met: boolean;
      if (laid) met = balls.any(bvh, r, cx, cy, cz, rr, bounds, metFromAcross);
      else {
        met = bvh.anyWithinNearestFirst(cx, cy, cz, rr, bounds, metFromAcross);
        if (!met && unit) {
          const gx = p[0] - n[0] * hi, gy = p[1] - n[1] * hi, gz = p[2] - n[2] * hi, gr = hi * (1 + 1e-9) + 1e-9;
          if (!holds(gx, gy, gz, gr)) {
            nearC = [gx, gy, gz];
            nearR = gr + NEAR_MARGIN;
            nNear = bvh.collectNear(gx, gy, gz, nearR, near0);
            nearData = pack(bvh, S, near0.list, nNear, nearData);
          }
          balls.lay(nearData, nNear, p, n, hi);
          laid = true;
        }
      }
      if (met) hi = r;
      else lo = r;
    }
    out.push({ t, p, thickness: 2 * lo, centre: [p[0] - n[0] * lo, p[1] - n[1] * lo, p[2] - n[2] * lo] });
  }
  return out;
}

/**
 * The triangles that may bound one sample's balls, laid out for its trials. A ball tried
 * has its centre at p - r n; a triangle's holding sphere (centroid g, radius R) reaches
 * that ball only once r passes tau = (|g - p|^2 - R^2) / (2 (R - n.(g - p))), and its
 * plane lies |alpha + beta r| from the centre; and a triangle met at distance d from the
 * centre of an earlier trial at radius r0 lies at least d - |r - r0| from this one's
 * (the centre moves |r - r0|). Each test rules a triangle out only when it lies provably
 * further than the trial's radius (with a margin far above rounding); what remains is
 * asked anyWithin's own question.
 */
class BallCandidates {
  tri = new Int32Array(256);
  tau = new Float64Array(256);
  alpha = new Float64Array(256);
  beta = new Float64Array(256);
  lastD = new Float64Array(256);
  lastR = new Float64Array(256);
  n = 0;
  /** The candidates in order of tau, in BUCKETS: those of bucket b are [start[b], start[b + 1]), every tau in it at least floor[b]. */
  start = new Int32Array(BUCKETS + 1);
  floor = new Float64Array(BUCKETS);
  #q = new Float64Array(3);
  #tmp = { tri: new Int32Array(256), tau: new Float64Array(256), alpha: new Float64Array(256), beta: new Float64Array(256), b: new Int32Array(256) };

  /** Lays out the first `count` triangles packed in `data` (pack) for the trials of the sample at p (unit direction nrm) whose radii are all below `top`. */
  lay(data: Float64Array, count: number, p: V3, nrm: V3, top: number): void {
    const T = this.#tmp;
    if (T.tri.length < count) {
      const size = Math.max(count, T.tri.length * 2);
      this.#tmp = { tri: new Int32Array(size), tau: new Float64Array(size), alpha: new Float64Array(size), beta: new Float64Array(size), b: new Int32Array(size) };
      this.tri = new Int32Array(size);
      this.tau = new Float64Array(size);
      this.alpha = new Float64Array(size);
      this.beta = new Float64Array(size);
      this.lastD = new Float64Array(size);
      this.lastR = new Float64Array(size);
    }
    const tmp = this.#tmp;
    const never = top * (1 + 1e-9) + 1e-9;
    // The centre of the largest ball still to be tried: a triangle whose holding sphere lies
    // wholly outside that ball cannot reach any of them.
    const hx = p[0] - nrm[0] * top, hy = p[1] - nrm[1] * top, hz = p[2] - nrm[2] * top;
    let k = 0, lo = Infinity;
    for (let i = 0; i < count; i++) {
      const o = i * PACKED;
      const R = data[o + 3]! + 1e-7;
      const ex = data[o]! - hx, ey = data[o + 1]! - hy, ez = data[o + 2]! - hz, reach = never + R;
      if (ex * ex + ey * ey + ez * ez >= reach * reach) continue;
      // Only a triangle facing back (the wall check's "opposing") can bound a ball.
      if (!(data[o + 4]! * nrm[0] + data[o + 5]! * nrm[1] + data[o + 6]! * nrm[2] < -0.25)) continue;
      const t = data[o + 10]!;
      const dx = data[o]! - p[0], dy = data[o + 1]! - p[1], dz = data[o + 2]! - p[2];
      const a = nrm[0] * dx + nrm[1] * dy + nrm[2] * dz;
      const d2 = dx * dx + dy * dy + dz * dz;
      let tau: number;
      if (R - a > 0) tau = (d2 - R * R) / (2 * (R - a));
      else if (d2 < R * R) tau = -Infinity;
      else continue; // its holding sphere never reaches a ball tangent at p
      if (tau >= never) continue; // nor one of the radii still to be tried
      tmp.tri[k] = t;
      tmp.tau[k] = tau;
      // (p - n r - g).N = -(d.N) - r (n.N)
      tmp.alpha[k] = -(dx * data[o + 7]! + dy * data[o + 8]! + dz * data[o + 9]!);
      tmp.beta[k] = -(nrm[0] * data[o + 7]! + nrm[1] * data[o + 8]! + nrm[2] * data[o + 9]!);
      if (tau > -Infinity) lo = Math.min(lo, tau);
      k++;
    }
    // Counting sort into buckets of tau between its least (finite) value and `top`.
    if (!(lo < top)) lo = top - 1;
    const width = (top - lo) / BUCKETS;
    const start = this.start, floor = this.floor;
    start.fill(0);
    for (let i = 0; i < k; i++) {
      const tau = tmp.tau[i]!;
      const b = tau <= lo ? 0 : Math.min(BUCKETS - 1, Math.floor((tau - lo) / width));
      tmp.b[i] = b;
      start[b + 1]!++;
    }
    for (let b = 0; b < BUCKETS; b++) {
      start[b + 1] = start[b + 1]! + start[b]!;
      // A shade low, so rounding in the bucket's index never leaves a tau below its floor.
      floor[b] = b === 0 ? -Infinity : lo + (b - 1e-6) * width;
    }
    const at = start.slice(0, BUCKETS);
    for (let i = 0; i < k; i++) {
      const j = at[tmp.b[i]!]!++;
      this.tri[j] = tmp.tri[i]!;
      this.tau[j] = tmp.tau[i]!;
      this.alpha[j] = tmp.alpha[i]!;
      this.beta[j] = tmp.beta[i]!;
      this.lastD[j] = -1;
    }
    this.n = k;
  }

  /** anyWithin's answer for the ball of radius r (asked at radius rr < r) centred at (cx, cy, cz), from these triangles. */
  any(bvh: Bvh, r: number, cx: number, cy: number, cz: number, rr: number, keep: (t: number) => boolean, meets: (t: number, q: Float64Array, inFace: boolean, where: number) => boolean): boolean {
    const r2 = rr * rr, edge = r * (1 + 1e-9) + 1e-9, inner = rr + 1e-9;
    const q = this.#q, tau = this.tau, alpha = this.alpha, beta = this.beta, tri = this.tri, lastD = this.lastD, lastR = this.lastR;
    // Only buckets whose least tau is below the edge can hold a triangle the ball reaches.
    let b = 0;
    while (b < BUCKETS && this.floor[b]! < edge) b++;
    const end = this.start[b]!;
    for (let k = 0; k < end; k++) {
      if (tau[k]! >= edge) continue;
      if (Math.abs(alpha[k]! + beta[k]! * r) >= edge) continue;
      if (lastD[k]! - Math.abs(r - lastR[k]!) * (1 + 1e-9) >= inner) continue;
      const t = tri[k]!;
      if (!keep(t)) continue;
      const where = bvh.nearestOn(cx, cy, cz, t, q);
      const dx = cx - q[0]!, dy = cy - q[1]!, dz = cz - q[2]!;
      const d2 = dx * dx + dy * dy + dz * dz;
      lastD[k] = Math.sqrt(d2) * (1 - 1e-12);
      lastR[k] = r;
      if (d2 < r2 && meets(t, q, where === IN_FACE, where)) return true;
    }
    return false;
  }
}

const BUCKETS = 32;

/** Per gathered triangle, side by side for lay: centroid (3), holding radius, surface direction (3), plane normal (3), its index. */
const PACKED = 11;

function pack(bvh: Bvh, S: Float64Array, list: Int32Array, count: number, into: Float64Array): Float64Array {
  const out = into.length >= count * PACKED ? into : new Float64Array(Math.max(count * PACKED, into.length * 2));
  const C = bvh.centroid, Rc = bvh.reach, N = bvh.normal;
  for (let i = 0; i < count; i++) {
    const t = list[i]!, t3 = t * 3, o = i * PACKED;
    out[o] = C[t3]!;
    out[o + 1] = C[t3 + 1]!;
    out[o + 2] = C[t3 + 2]!;
    out[o + 3] = Rc[t]!;
    out[o + 4] = S[t3]!;
    out[o + 5] = S[t3 + 1]!;
    out[o + 6] = S[t3 + 2]!;
    out[o + 7] = N[t3]!;
    out[o + 8] = N[t3 + 1]!;
    out[o + 9] = N[t3 + 2]!;
    out[o + 10] = t;
  }
  return out;
}
/** How much larger than a sample's ball the walked one is, for the samples after it. */
const NEAR_MARGIN = 0.15;

/** The triangles round each vertex: those of vertex v are tris[start[v] .. start[v + 1]). */
function vertexFans(bvh: Bvh): { start: Int32Array; tris: Int32Array } {
  const T = bvh.tri;
  let nv = 0;
  for (let i = 0; i < T.length; i++) nv = Math.max(nv, T[i]! + 1);
  const start = new Int32Array(nv + 1);
  for (let i = 0; i < T.length; i++) start[T[i]! + 1] = start[T[i]! + 1]! + 1;
  for (let v = 0; v < nv; v++) start[v + 1] = start[v + 1]! + start[v]!;
  const fill = start.slice(0, nv);
  const tris = new Int32Array(T.length);
  for (let i = 0; i < T.length; i++) {
    const v = T[i]!;
    tris[fill[v]!] = (i / 3) | 0;
    fill[v] = fill[v]! + 1;
  }
  return { start, tris };
}

function minSample(samples: Sample[], keep: (s: Sample) => boolean = () => true): Sample | null {
  let best: Sample | null = null;
  for (const s of samples) if (keep(s) && (!best || s.thickness < best.thickness)) best = s;
  return best;
}

/**
 * Which part a place belongs to. `p` is the place on the surface; `centre`, for a
 * thickness reading, is the middle of the metal the reading is about, and it decides
 * between the band and a shape the tree added: the band only when it lies inside the
 * band's own declared section (the band check's region), otherwise the added shape
 * whose bounds hold it. Labelling by the band's envelope instead, 0.3 mm round it,
 * called a thin overhang beside the band "the band" and advised a thicker band, which
 * does not reach it (fact:wall-check-reads-overhang-beside-band-edge). A sheet from the
 * thicken operation is named before the added shape round it: the place lies within
 * half its thickness of the sheet's middle surface, and every sheet that close is named
 * (where two meet).
 */
function partAt(p: V3, decl: FeatureDecl, centre?: V3): { part: string; feature?: string; clock?: string; meets?: string[] } {
  for (const pr of decl.prongs) {
    if (Math.hypot(p[0] - pr.axis[0], p[1] - pr.axis[1]) <= pr.nominalDiameter / 2 + 0.3 && p[2] >= pr.sectionFromZ - 0.6) {
      return { part: 'head', feature: pr.label, clock: pr.clock };
    }
  }
  if (decl.bezel && inPolygon(decl.bezel.outer, p[0], p[1], 0.2) && p[2] >= decl.bezel.zBottom - 0.1) return { part: 'head', feature: 'bezel', clock: clockAt(p[0], p[1]) };
  const bandAt = () => ({ part: 'band', feature: `${Math.round(((Math.atan2(p[0], p[2]) * 180) / Math.PI + 360) % 360)}° round the band from the top` });
  const sheetPart = (q: V3) => {
    const [sheet, ...others] = sheetsAt(q, decl);
    return sheet ? { part: 'sheet', feature: sheet.label, ...(others.length ? { meets: others.map((o) => o.label) } : {}) } : null;
  };
  if (centre) {
    const b = decl.band;
    if (b) {
      const rho = Math.hypot(centre[0], centre[2]);
      if (rho >= b.innerRadius && rho <= b.outerRadius && Math.abs(centre[1]) <= b.halfWidth) return bandAt();
    }
    const sheet = sheetPart(centre);
    if (sheet) return sheet;
    const holding = (decl.added ?? []).filter((a) => inBox(a, centre));
    if (holding.length) return { part: 'added shape', feature: holding.map((a) => a.id).join(', ') };
    return { part: 'piece' };
  }
  const sheet = sheetPart(p);
  if (sheet) return sheet;
  if (decl.band) {
    const rho = Math.hypot(p[0], p[2]);
    if (rho <= decl.band.outerRadius + 0.3 && Math.abs(p[1]) <= decl.band.halfWidth + 0.3) return bandAt();
  }
  return { part: 'piece' };
}

/** Whether a point lies in an added shape's bounds (a hair's tolerance for points on them). */
function inBox(a: AddedDecl, c: V3): boolean {
  return [0, 1, 2].every((k) => c[k]! >= a.min[k]! - 1e-3 && c[k]! <= a.max[k]! + 1e-3);
}

/** "flange", or "a" or "b" when the bounds of more than one added shape hold the place. */
export function quoteIds(ids: string): string {
  return ids
    .split(', ')
    .map((id) => `"${id}"`)
    .join(' or ');
}

function whereOf(p: V3, decl: FeatureDecl, what: string, centre?: V3): Where {
  const a = partAt(p, decl, centre);
  const where = { part: a.part, ...(a.feature ? { feature: a.feature } : {}), ...(a.clock ? { clock: a.clock } : {}), ...(a.meets ? { meets: a.meets } : {}), point_mm: pt(p) };
  if (a.part === 'added shape') return { ...where, description: `${what} in the added shape ${quoteIds(a.feature!)}` };
  if (a.part === 'sheet') return { ...where, description: `${what} on the sheet "${a.feature}"${a.meets ? `, where it meets ${a.meets.map((m) => `"${m}"`).join(' and ')}` : ''}` };
  const at = a.feature ? `${a.feature}${a.clock && a.part === 'head' ? ` (at ${a.clock} seen from above, the finger pointing to 12)` : ''}` : a.part;
  return { ...where, description: `${what} on the ${a.part === 'head' ? 'head' : a.part}: ${at}` };
}

/**
 * A place on a smooth blend's own surface, named by the blend. It is one of the points the
 * blend declares on its surface, so which part it lies on is known, not guessed from the
 * region round it: named by region, the moonstone ring's rail under its bezel's open back
 * was called "the bezel", and the bezel was suspected of an engine fault it did not have
 * (fact:a-blends-level-set-chamfers-the-creases-of-its-own-field-2026-10-05).
 */
function onBlend(p: V3, label: string, what: string): Where {
  const clock = clockAt(p[0], p[1]);
  return { part: 'blend', feature: label, clock, point_mm: pt(p), description: `${what} on the smooth blend "${label}" (at ${clock} seen from above, the finger pointing to 12)` };
}

const MAXSPHERE = "largest inscribed sphere at every triangle centroid of the written STL, grown along the surface's direction there (a triangle's own normal, except that a sliver too narrow to have a direction takes the direction of the surface it was cut from), only surfaces facing back (more than 105° away) bounding it, and a crease or corner only when the sphere meets it square-on (no face meeting there lies nearer the sphere's centre) and from more than 105° away; the place is named by the part that holds the sphere's centre (the band only inside its own section)";

/** Whether a point is on a prong's column (above its foot), which the prong check judges by its narrowest section. */
function onProngColumn(p: V3, decl: FeatureDecl): boolean {
  return decl.prongs.some((pr) => p[2] >= pr.sectionFromZ - 0.05 && Math.hypot(p[0] - pr.axis[0], p[1] - pr.axis[1]) <= pr.nominalDiameter / 2 + 0.05);
}

function wallEntry(bvh: Bvh, samples: Sample[], L: CheckLimits, decl: FeatureDecl): CheckEntry {
  const m = minSample(samples, (s) => !onProngColumn(s.p, decl));
  if (!m) throw new Error('no thickness could be measured');
  return {
    id: 'wall',
    name: 'Wall thickness',
    limit: mm(L.wall),
    result: m.thickness >= L.wall ? 'pass' : 'fail',
    measured: mm(m.thickness),
    value: r3(m.thickness),
    where: whereOf(m.p, decl, 'thinnest wall', m.centre),
    method: `${MAXSPHERE}; prong columns are judged by the prong check's narrowest section instead`,
  };
}

function detailEntry(_bvh: Bvh, samples: Sample[], L: CheckLimits, decl: FeatureDecl): CheckEntry {
  const m = minSample(samples);
  if (!m) throw new Error('no thickness could be measured');
  return {
    id: 'detail',
    name: 'Smallest detail',
    limit: mm(L.detail),
    result: m.thickness >= L.detail ? 'pass' : 'fail',
    measured: `${mm(m.thickness)} (the thinnest feature anywhere)`,
    value: r3(m.thickness),
    where: whereOf(m.p, decl, 'the thinnest feature', m.centre),
    method: MAXSPHERE,
  };
}

// ------------------------------------------------------------------ sheets
//
// A sheet's thickness is measured SQUARE TO ITS SURFACE, where it was declared: from
// each declared point on its middle surface, a ray along the normal to the first face
// the file has on each side. That is the thickness a jeweler means by a 1.0 mm petal,
// and it reads the same at the sheet's edge as in its middle. A reading counts only
// where both rays leave through faces that face along them (within 45°), as the
// sheet's own two faces do: a point cut away from the metal (its first face faces back
// at it), or one beside a rim or a slanting cut that a ray grazes, is not a reading of
// the sheet's thickness and is skipped, and the wall check still measures what is
// there. Where the sheet runs into other metal (its base buried in the flower's
// centre), the reading is thicker there, never thinner.

function nearestSheetPoint(sh: SheetDecl, p: V3): number {
  let best = Infinity;
  for (const q of sh.points) best = Math.min(best, (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2);
  return Math.sqrt(best);
}

/**
 * The declared sheets a point of the file lies on, nearest first: within half a
 * sheet's thickness of its middle surface, give or take the declaration's spacing.
 * More than one means the point is where sheets meet.
 */
function sheetsAt(p: V3, decl: FeatureDecl): SheetDecl[] {
  const near: { sh: SheetDecl; d: number }[] = [];
  for (const sh of decl.sheets ?? []) {
    const d = nearestSheetPoint(sh, p);
    if (d <= sh.nominalThickness / 2 + sh.spacing) near.push({ sh, d });
  }
  return near.sort((a, b) => a.d - b.d).map((x) => x.sh);
}

/** A face "faces along" a ray within 45°. */
const ALONG = Math.SQRT1_2;

function sheetEntry(bvh: Bvh, S: Float64Array, sheets: SheetDecl[], L: CheckLimits): CheckEntry {
  const results: { label: string; value: number; nominal: number; where: Where; measured: number }[] = [];
  const any = () => true;
  for (const sh of sheets) {
    let worst: { d: number; p: V3 } | null = null;
    let measured = 0;
    const reach = Math.max(10, sh.nominalThickness * 10);
    sh.points.forEach((p, i) => {
      const n = sh.normals[i]!;
      const up = bvh.ray(p, n, reach, any);
      const down = bvh.ray(p, [-n[0], -n[1], -n[2]], reach, any);
      if (!up || !down) return;
      // The sheet's own faces: the first face met each way faces along the ray.
      if (S[up.t * 3]! * n[0] + S[up.t * 3 + 1]! * n[1] + S[up.t * 3 + 2]! * n[2] < ALONG) return;
      if (-(S[down.t * 3]! * n[0] + S[down.t * 3 + 1]! * n[1] + S[down.t * 3 + 2]! * n[2]) < ALONG) return;
      measured++;
      const d = up.dist + down.dist;
      if (!worst || d < worst.d) worst = { d, p };
    });
    if (!worst) throw new Error(`no declared point of the sheet "${sh.label}" lies inside the metal, so the file and the sheet's declaration disagree and it cannot be measured`);
    const w = worst as { d: number; p: V3 };
    results.push({
      label: sh.label,
      value: r3(w.d),
      nominal: r3(sh.nominalThickness),
      measured,
      where: { part: 'sheet', feature: sh.label, point_mm: pt(w.p), description: `the sheet "${sh.label}", its thinnest place measured square to its surface` },
    });
  }
  const failing = results.filter((r) => r.value < L.wall);
  const thinnest = results.reduce((a, b) => (b.value < a.value ? b : a));
  return {
    id: 'sheet',
    name: 'Sheet thickness',
    limit: `${mm(L.wall)}, square to the surface`,
    result: failing.length ? 'fail' : 'pass',
    measured: `${mm(thinnest.value)} ("${thinnest.label}"); each, measured (declared): ${results.map((r) => `${r.label} ${r.value} (${r.nominal})`).join(', ')} mm`,
    value: thinnest.value,
    where: thinnest.where,
    ...(failing.length ? { failing: failing.map(({ label, value, nominal, where }) => ({ label, value, nominal, where })) } : {}),
    method: `each sheet made by the thicken operation, measured square to its surface at the points on its middle surface it declares (${results.map((r) => `${r.measured} on ${r.label}`).join(', ')}): a ray each way along the surface's normal to the first face of the written STL, the two distances summed, where both faces face along the rays within 45° (the sheet's own faces); points cut away, or beside a rim or a slanting cut, are skipped and left to the wall check`,
  };
}

// --------------------------------------------------------------- sections
//
// A section is the WHOLE mesh cut by a plane, and only then clipped to the region
// the declaration names: the band's own section (inner and outer radius, width) or a
// disc round a prong's axis. The largest circle is the largest that fits inside BOTH
// the metal and that region.
//
// Cutting first and clipping afterwards is what keeps the outline closed. The checker
// used to keep only the cut segments inside a window round the band, so wherever other
// metal joined the band (a head, or a shape added by a tree operation), the window cut
// the outline open, the inside-or-outside test along it went wrong, and a 1.7 mm band
// read 0.78 mm under an added pedestal, moving when only the pedestal changed and never
// converging on the advice to thicken (fact:band-check-measures-added-shapes-as-band).
// A skip zone over the head hid that for library heads only; clipping to the band's own
// section needs no skip zone, so the band is now measured all the way round, under a
// head or an added shape too, and a thin band there is refused like anywhere else.

type Seg = [P2, P2];

/** Where a plane (normal · p = offset) cuts the candidate triangles, in the plane's 2D coordinates; `want` drops segments that cannot matter. */
function slice(bvh: Bvh, normal: V3, offset: number, to2d: (x: number, y: number, z: number) => P2, candidates: Uint32Array, want: (a: P2, b: P2) => boolean): Seg[] {
  const segs: Seg[] = [];
  const P = bvh.pos, T = bvh.tri;
  const ends: P2[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i]!;
    ends.length = 0;
    for (let k = 0; k < 3; k++) {
      // Each edge from its lower-numbered vertex, so the two triangles sharing it cut it at bit-identical points.
      let u = T[t * 3 + k]!, v = T[t * 3 + ((k + 1) % 3)]!;
      if (u > v) [u, v] = [v, u];
      const du = P[u * 3]! * normal[0] + P[u * 3 + 1]! * normal[1] + P[u * 3 + 2]! * normal[2] - offset;
      const dv = P[v * 3]! * normal[0] + P[v * 3 + 1]! * normal[1] + P[v * 3 + 2]! * normal[2] - offset;
      if ((du < 0 && dv >= 0) || (du >= 0 && dv < 0)) {
        const s = du / (du - dv);
        ends.push(to2d(P[u * 3]! + s * (P[v * 3]! - P[u * 3]!), P[u * 3 + 1]! + s * (P[v * 3 + 1]! - P[u * 3 + 1]!), P[u * 3 + 2]! + s * (P[v * 3 + 2]! - P[u * 3 + 2]!)));
      }
    }
    if (ends.length === 2 && want(ends[0]!, ends[1]!)) segs.push([ends[0]!, ends[1]!]);
  }
  return segs;
}

/** Inside the closed section: crossings of the ray from (x, y) towards +x. */
function inside(segs: Seg[], x: number, y: number): boolean {
  let c = false;
  for (const [a, b] of segs) {
    if (a[1] > y !== b[1] > y) {
      const xi = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      if (xi > x) c = !c;
    }
  }
  return c;
}

function distToSegs(segs: Seg[], x: number, y: number): number {
  let best = Infinity;
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const s = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - a[0] - s * dx, y - a[1] - s * dy));
  }
  return best;
}

/** The region a section is clipped to: its bounding box, and how far a point lies inside its edge (negative outside). */
interface Region {
  box: [number, number, number, number];
  depth(x: number, y: number): number;
}

/**
 * Diameter of the largest circle inside both the metal (the closed section `segs`) and
 * `region` (grid search, then five refinements); null when no point of the region is metal.
 */
export function largestCircleIn(segs: Seg[], region: Region): { d: number; at: P2 } | null {
  const [x0, x1, y0, y1] = region.box;
  let best = { r: -1, x: 0, y: 0 };
  const scan = (cx0: number, cx1: number, cy0: number, cy1: number, n: number) => {
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const x = cx0 + ((cx1 - cx0) * i) / n, y = cy0 + ((cy1 - cy0) * j) / n;
        const edge = region.depth(x, y);
        if (edge <= 0 || edge <= best.r || !inside(segs, x, y)) continue;
        const r = Math.min(edge, distToSegs(segs, x, y));
        if (r > best.r) best = { r, x, y };
      }
  };
  scan(x0, x1, y0, y1, 24);
  if (best.r < 0) return null;
  let span = Math.max(x1 - x0, y1 - y0) / 12;
  for (let k = 0; k < 5; k++) {
    scan(best.x - span, best.x + span, best.y - span, best.y + span, 8);
    span /= 3.5;
  }
  return { d: 2 * best.r, at: [best.x, best.y] };
}

/** Triangles whose bounds pass `keep` (min and max x, y, z, and the largest distance of a corner from the Y axis). */
function trianglesWhere(bvh: Bvh, keep: (lo: V3, hi: V3, rhoMax: number) => boolean): Uint32Array {
  const out: number[] = [];
  const P = bvh.pos, T = bvh.tri;
  const lo: V3 = [0, 0, 0], hi: V3 = [0, 0, 0];
  for (let t = 0; t < bvh.n; t++) {
    let rhoMax = 0;
    for (let k = 0; k < 3; k++) {
      const v = T[t * 3 + k]! * 3;
      for (let c = 0; c < 3; c++) {
        const x = P[v + c]!;
        if (k === 0 || x < lo[c]!) lo[c] = x;
        if (k === 0 || x > hi[c]!) hi[c] = x;
      }
      rhoMax = Math.max(rhoMax, Math.hypot(P[v]!, P[v + 2]!));
    }
    if (keep(lo, hi, rhoMax)) out.push(t);
  }
  return Uint32Array.from(out);
}

function bandEntry(bvh: Bvh, band: BandDecl, L: CheckLimits): CheckEntry {
  const { innerRadius: rIn, outerRadius: rOut, halfWidth: hw } = band;
  // Every triangle a section's inside test could need: anything in the band's slab along the
  // finger that reaches out past the inside of the band (a corner's distance from the axis is
  // a triangle's farthest point from it). Rays run outward, so nothing else can be crossed.
  const cand = trianglesWhere(bvh, (lo, hi, rhoMax) => lo[1] <= hw && hi[1] >= -hw && rhoMax >= rIn);
  const region: Region = { box: [rIn, rOut, -hw, hw], depth: (x, y) => Math.min(x - rIn, rOut - x, y + hw, hw - y) };
  let worst: { d: number; deg: number; p: V3 } | null = null;
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const dir: V3 = [Math.sin(a), 0, Math.cos(a)];
    const normal: V3 = [Math.cos(a), 0, -Math.sin(a)];
    const segs = slice(bvh, normal, 0, (x, y, z) => [x * dir[0] + z * dir[2], y], cand, (p, q) => Math.max(p[0], q[0]) >= rIn && Math.max(p[1], q[1]) >= -hw && Math.min(p[1], q[1]) <= hw);
    const ins = largestCircleIn(segs, region);
    if (!ins) throw new Error(`the band's own section ${deg}° round from the top holds no metal, so the file and the band's declaration disagree and the band cannot be measured there`);
    if (!worst || ins.d < worst.d) worst = { d: ins.d, deg, p: [dir[0] * ins.at[0], ins.at[1], dir[2] * ins.at[0]] };
  }
  return {
    id: 'band',
    name: 'Ring band thickness',
    limit: mm(L.band),
    result: worst!.d >= L.band ? 'pass' : 'fail',
    measured: mm(worst!.d),
    value: r3(worst!.d),
    where: { part: 'band', feature: `${worst!.deg}° round the band from the top`, point_mm: pt(worst!.p), description: `the band's thinnest section, ${worst!.deg}° round from the top` },
    method: "the band's cross-section every 5° all the way round, cut from the whole piece and then clipped to the band's own section (its inner and outer radius and its width), measured as the largest circle that fits inside it; metal outside the band's own section, a head or an added shape, is not counted as band",
  };
}

function prongEntry(bvh: Bvh, prongs: ProngDecl[], L: CheckLimits): CheckEntry {
  const results: { label: string; value: number; where: Where }[] = [];
  for (const pr of prongs) {
    let worst: { d: number; z: number; at: P2 } | null = null;
    const R = pr.nominalDiameter / 2 + 0.35;
    const [ax, ay] = pr.axis;
    const cand = trianglesWhere(bvh, (lo, hi) => lo[2] <= pr.sectionToZ && hi[2] >= pr.sectionFromZ && lo[1] <= ay + R && hi[1] >= ay - R && hi[0] >= ax - R);
    const region: Region = { box: [ax - R, ax + R, ay - R, ay + R], depth: (x, y) => R - Math.hypot(x - ax, y - ay) };
    const at = (z: number) => {
      const segs = slice(bvh, [0, 0, 1], z, (x, y) => [x, y], cand, (p, q) => Math.max(p[0], q[0]) >= ax - R && Math.max(p[1], q[1]) >= ay - R && Math.min(p[1], q[1]) <= ay + R);
      const ins = largestCircleIn(segs, region);
      if (ins && (!worst || ins.d < worst.d)) worst = { d: ins.d, z, at: ins.at };
    };
    // Every 0.1 mm up the column, then every 0.02 mm around the narrowest.
    const steps = Math.max(8, Math.ceil((pr.sectionToZ - pr.sectionFromZ) / 0.1));
    for (let i = 0; i <= steps; i++) at(pr.sectionFromZ + ((pr.sectionToZ - pr.sectionFromZ) * i) / steps);
    const zc = (worst as { z: number } | null)?.z;
    if (zc !== undefined) for (let dz = -0.1; dz <= 0.1001; dz += 0.02) if (zc + dz >= pr.sectionFromZ && zc + dz <= pr.sectionToZ) at(zc + dz);
    if (!worst) throw new Error(`no section of ${pr.label} could be measured`);
    const w = worst as { d: number; z: number; at: P2 };
    results.push({
      label: pr.label,
      value: r3(w.d),
      where: {
        part: 'head',
        feature: pr.label,
        clock: pr.clock,
        point_mm: pt([w.at[0], w.at[1], w.z]),
        description: `${pr.label}, at ${pr.clock} seen from above with the finger pointing to 12 o'clock, ${r3(w.z)} mm up`,
      },
    });
  }
  const failing = results.filter((r) => r.value < L.prong);
  const thinnest = results.reduce((a, b) => (b.value < a.value ? b : a));
  return {
    id: 'prong',
    name: 'Prong thickness',
    limit: mm(L.prong),
    result: failing.length ? 'fail' : 'pass',
    measured: `${mm(thinnest.value)} (${thinnest.label}); each: ${results.map((r) => `${r.label.split(' of ')[0]} ${r.value}`).join(', ')} mm`,
    value: thinnest.value,
    where: thinnest.where,
    ...(failing.length ? { failing } : {}),
    method: "each prong's cross-section every 0.1 mm up its column (0.02 mm around the narrowest), cut from the whole piece and clipped to a disc round the prong's axis, measured as the largest circle that fits inside it (the narrowest section, con:minimum-prong-thickness)",
  };
}

function gripEntry(bvh: Bvh, decl: FeatureDecl, L: CheckLimits): CheckEntry {
  const s = decl.stone!;
  const results: { label: string; value: number; where: Where }[] = [];
  const P = bvh.pos;
  for (const pr of decl.prongs) {
    let reach = -Infinity;
    let at: V3 = [pr.axis[0], pr.axis[1], s.girdleTopZ];
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i]!, y = P[i + 1]!, z = P[i + 2]!;
      if (z < s.girdleTopZ + 0.02 || Math.hypot(x - pr.axis[0], y - pr.axis[1]) > pr.nominalDiameter / 2 + 0.05) continue;
      const inset = signedInset(s.outline, x, y);
      if (inset > reach) {
        reach = inset;
        at = [x, y, z];
      }
    }
    results.push({ label: pr.label, value: r3(Math.max(0, reach)), where: { part: 'head', feature: pr.label, clock: pr.clock, point_mm: pt(at), description: `${pr.label}, at ${pr.clock}` } });
  }
  const failing = results.filter((r) => r.value < L.gripMin);
  const least = results.reduce((a, b) => (b.value < a.value ? b : a));
  return {
    id: 'prong_grip',
    name: 'Prongs grip the stone',
    limit: `each prong reaches at least ${mm(L.gripMin)} in over the girdle`,
    result: failing.length ? 'fail' : 'pass',
    measured: `${mm(least.value)} (${least.label})`,
    value: least.value,
    where: least.where,
    ...(failing.length ? { failing } : {}),
    method: 'how far each prong\'s metal above the girdle reaches inside the girdle outline, from the written STL',
  };
}

/** How far (x, y) lies INSIDE a convex outline (positive inside). */
function signedInset(poly: P2[], x: number, y: number): number {
  let best = Infinity;
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sign = area >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const l = Math.hypot(ex, ey) || 1;
    // Distance to the edge's line, positive on the inner side.
    const d = (sign * (ex * (y - a[1]) - ey * (x - a[0]))) / l;
    best = Math.min(best, d);
  }
  return best;
}

function inPolygon(poly: P2[], x: number, y: number, grow = 0): boolean {
  if (grow > 0) return signedInset(poly, x, y) > -grow;
  return signedInset(poly, x, y) >= 0;
}

function bezelWallEntry(_bvh: Bvh, samples: Sample[], decl: FeatureDecl, L: CheckLimits): CheckEntry {
  const bz = decl.bezel!, st = decl.stone!;
  const inBezel = (s: Sample) => s.p[2] > st.girdleBottomZ - 0.5 && inPolygon(bz.outer, s.p[0], s.p[1], 0.1) && signedInset(st.outline, s.p[0], s.p[1]) < 0.3;
  const m = minSample(samples, inBezel);
  if (!m) throw new Error('no point on the bezel could be measured');
  return {
    id: 'bezel_wall',
    name: 'Bezel wall thickness',
    limit: mm(L.wall),
    result: m.thickness >= L.wall ? 'pass' : 'fail',
    measured: mm(m.thickness),
    value: r3(m.thickness),
    where: { part: 'head', feature: 'bezel', clock: clockAt(m.p[0], m.p[1]), point_mm: pt(m.p), description: `the bezel rim at ${clockAt(m.p[0], m.p[1])} seen from above, ${r3(m.p[2] - st.girdleTopZ)} mm above the girdle` },
    method: MAXSPHERE + ', on the bezel rim around and above the girdle',
  };
}

function bezelLipEntry(bvh: Bvh, decl: FeatureDecl, L: CheckLimits): CheckEntry {
  const bz = decl.bezel!, st = decl.stone!;
  const P = bvh.pos;
  let top = -Infinity;
  let at: V3 = [0, 0, 0];
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i]!, y = P[i + 1]!, z = P[i + 2]!;
    if (!inPolygon(bz.outer, x, y, 0.05)) continue;
    if (z > top) {
      top = z;
      at = [x, y, z];
    }
  }
  const lip = top - st.girdleTopZ;
  const share = lip / st.crownHeight;
  const ok = share >= L.lipMinOfCrown - 1e-6 && share <= L.lipMaxOfCrown + 1e-6;
  return {
    id: 'bezel_lip',
    name: 'Bezel lip height',
    limit: `${Math.round(L.lipMinOfCrown * 100)}-${Math.round(L.lipMaxOfCrown * 100)} % of the crown (${mm(L.lipMinOfCrown * st.crownHeight)} to ${mm(L.lipMaxOfCrown * st.crownHeight)} for this stone)`,
    result: ok ? 'pass' : 'fail',
    measured: `${mm(lip)} above the girdle, ${Math.round(share * 100)} % of the ${mm(st.crownHeight)} crown`,
    value: r3(lip),
    where: { part: 'head', feature: 'bezel', point_mm: pt(at), description: 'the top of the bezel, measured from the top of the girdle' },
    method: "the highest point of the bezel in the written STL, less the girdle's top; the crown height comes from the stone's measured depth",
  };
}

// ------------------------------------------------------------------- gaps

function gapEntry(bvh: Bvh, S: Float64Array, L: CheckLimits): CheckEntry {
  // Along the surface's direction, and facing judged by it, for the same reason as the
  // thickness: two slivers leaning opposite ways looked like walls 0.001 mm apart.
  const C = bvh.centroid;
  let best: { d: number; p: V3 } | null = null;
  const reach = Math.max(2, L.gap * 3);
  for (let t = 0; t < bvh.n; t++) {
    const n: V3 = [S[t * 3]!, S[t * 3 + 1]!, S[t * 3 + 2]!];
    const p: V3 = [C[t * 3]! + n[0] * 1e-5, C[t * 3 + 1]! + n[1] * 1e-5, C[t * 3 + 2]! + n[2] * 1e-5];
    const facing = (u: number) => S[u * 3]! * n[0] + S[u * 3 + 1]! * n[1] + S[u * 3 + 2]! * n[2] < -0.9;
    const hit = bvh.ray(p, n, reach, facing);
    if (hit && (!best || hit.dist < best.d)) best = { d: hit.dist, p };
  }
  if (!best) {
    return {
      id: 'gap',
      name: 'Smallest gap',
      limit: mm(L.gap),
      result: 'pass',
      measured: `no gap narrower than ${mm(reach)} between facing surfaces`,
      where: null,
      method: "a ray outward from every triangle centroid along the surface's direction there (a sliver's taken from the surface it was cut from), to the nearest surface facing back (within 25° of opposite)",
    };
  }
  return {
    id: 'gap',
    name: 'Smallest gap',
    limit: mm(L.gap),
    result: best.d >= L.gap ? 'pass' : 'fail',
    measured: mm(best.d),
    value: r3(best.d),
    where: { part: 'piece', point_mm: pt(best.p), description: 'the narrowest gap between two facing surfaces' },
    method: "a ray outward from every triangle centroid along the surface's direction there (a sliver's taken from the surface it was cut from), to the nearest surface facing back (within 25° of opposite)",
  };
}

// --------------------------------------------------------------- surface

/**
 * How far the written facets stand off the intended curved surface: the largest
 * distance from any vertex of a much finer tessellation of the same piece (the
 * reference, built at 0.0015 mm) to the written mesh. Vertices of the reference
 * lie on the intended surface within its own tolerance, so this is the chord
 * deviation the printer would reproduce, measured, not estimated.
 *
 * A smooth blend's intended surface is its distance field's zero level, and its
 * facets already have their corners on it; the library declares points on that
 * surface over every facet the file has from the blend (FeatureDecl.blends), and
 * they are measured the same way. (A second level set 1.7 times finer had been the
 * blend's reference: 5 times the samples and, for one openwork ring, 687 MiB of
 * grid, more than flo2's slot; fact:check-time-is-the-blend-field-and-the-wall-ball.)
 *
 * Each distance is looked for first within twice the limit, where nearly every point
 * lies, and only past that out to the cap: the same distance as one search to the
 * cap, found without visiting everything within 0.2 mm of every point.
 */
function surfaceEntry(bvh: Bvh, L: CheckLimits, ref: ReadMesh, decl: FeatureDecl): CheckEntry {
  let worst: { dev: number; p: V3; blend?: string } = { dev: 0, p: [0, 0, 0] };
  const cap = Math.max(0.2, L.surfaceDeviation * 20);
  const first = Math.min(cap, L.surfaceDeviation * 2);
  const q: V3 = [0, 0, 0];
  const measure = (P: ArrayLike<number>, blend?: string) => {
    for (let i = 0; i < P.length; i += 3) {
      q[0] = P[i]!;
      q[1] = P[i + 1]!;
      q[2] = P[i + 2]!;
      let d2 = bvh.nearestDistSq(q, first);
      if (d2 >= first * first) d2 = bvh.nearestDistSq(q, cap);
      const d = Math.sqrt(d2);
      if (d > worst.dev) worst = { dev: d, p: [q[0], q[1], q[2]], ...(blend !== undefined ? { blend } : {}) };
    }
  };
  measure(ref.positions);
  const blends = decl.blends ?? [];
  let onBlends = 0;
  for (const b of blends) {
    measure(b.points, b.label);
    onBlends += b.points.length / 3;
  }
  return {
    id: 'surface_deviation',
    name: 'Surface smoothness',
    limit: mm(L.surfaceDeviation),
    result: worst.dev <= L.surfaceDeviation ? 'pass' : 'fail',
    measured: `${mm(worst.dev)} (checked at ${ref.positions.length / 3} points of a 0.0015 mm reference${onBlends ? ` and ${onBlends} points on the smooth blends' own surfaces` : ''})`,
    value: r3(worst.dev),
    where: worst.blend !== undefined ? onBlend(worst.p, worst.blend, 'the facets stand furthest from the curved surface') : whereOf(worst.p, decl, 'the facets stand furthest from the curved surface'),
    method: `the largest distance from the vertices of a much finer tessellation of the same piece to the written mesh${onBlends ? "; and, for each smooth blend, from points on its own surface (its distance field's zero level) at the corners, edge midpoints and centroid of every facet the file has from it" : ''}`,
  };
}
