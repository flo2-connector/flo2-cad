// The casting checker (cmp:casting-checker). It reads back the WRITTEN STL with
// its own parser and measures it; it never calls the kernel or the library
// (con:checker-independent-of-the-kernel). The library's feature declarations
// say where the prongs, band, stone and bezel are; every number in the report is
// measured from the file's own triangles.
//
// A check that cannot run is a FAIL (owner, round 1, Q6): any exception inside
// a check becomes result "could_not_run", which blocks the export.

import { Bvh } from './bvh.js';
import type { BandDecl, FeatureDecl, P2, ProngDecl } from './features.js';
import { segmentCrossesTri, type V3 } from './geom.js';
import { readBinaryStl, type ReadMesh } from './stl.js';

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
  point_mm: [number, number, number];
  description: string;
}

export interface CheckEntry {
  id: 'watertight' | 'wall' | 'band' | 'prong' | 'bezel_wall' | 'bezel_lip' | 'prong_grip' | 'detail' | 'gap' | 'surface_deviation';
  name: string;
  limit: string;
  result: 'pass' | 'fail' | 'could_not_run';
  measured: string | null;
  /** The measured value in mm, when there is one. */
  value?: number;
  where: Where | null;
  /** Every failing feature, when more than one fails (e.g. each thin prong). */
  failing?: { label: string; value: number; where: Where }[];
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

  const samples = sampleThickness(bvh);
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
  guard('gap', 'Smallest gap', mm(L.gap), () => gapEntry(bvh, L));
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
}

/**
 * Local thickness at each triangle's centroid: the diameter of the largest ball
 * inside the solid that touches the surface there (a max-inscribed-sphere
 * measure, as ver:wall-thickness-check names). Surfaces that do not face back
 * towards the sample (normals within 105° of its own) cannot stop the ball, so a
 * convex edge does not read as a thin wall.
 */
function sampleThickness(bvh: Bvh): Sample[] {
  const out: Sample[] = [];
  const N = bvh.normal, C = bvh.centroid, P = bvh.pos, T = bvh.tri;
  for (let t = 0; t < bvh.n; t++) {
    if (bvh.area[t]! < 1e-10) continue;
    const n: V3 = [N[t * 3]!, N[t * 3 + 1]!, N[t * 3 + 2]!];
    const p: V3 = [C[t * 3]!, C[t * 3 + 1]!, C[t * 3 + 2]!];
    const opposing = (u: number) => N[u * 3]! * n[0] + N[u * 3 + 1]! * n[1] + N[u * 3 + 2]! * n[2] < -0.25;
    const inward: V3 = [-n[0], -n[1], -n[2]];
    const hit = bvh.ray(p, inward, 50, opposing);
    if (!hit) continue;
    let lo = 0, hi = hit.dist / 2;
    let cx = 0, cy = 0, cz = 0;
    // A surface bounds the ball only if the ball's centre lies behind it, inside the metal:
    // a ball that has slipped out past a side face must not be stopped from outside.
    const bounds = (u: number) => {
      if (!opposing(u)) return false;
      const v = T[u * 3]! * 3;
      return (cx - P[v]!) * N[u * 3]! + (cy - P[v + 1]!) * N[u * 3 + 1]! + (cz - P[v + 2]!) * N[u * 3 + 2]! < 1e-7;
    };
    for (let i = 0; i < 16 && hi - lo > 0.0005; i++) {
      const r = (lo + hi) / 2;
      cx = p[0] - n[0] * r;
      cy = p[1] - n[1] * r;
      cz = p[2] - n[2] * r;
      if (bvh.anyWithin([cx, cy, cz], r * (1 - 1e-6) - 1e-5, bounds)) hi = r;
      else lo = r;
    }
    out.push({ t, p, thickness: 2 * lo });
  }
  return out;
}

function minSample(samples: Sample[], keep: (s: Sample) => boolean = () => true): Sample | null {
  let best: Sample | null = null;
  for (const s of samples) if (keep(s) && (!best || s.thickness < best.thickness)) best = s;
  return best;
}

function partAt(p: V3, decl: FeatureDecl): { part: string; feature?: string; clock?: string } {
  for (const pr of decl.prongs) {
    if (Math.hypot(p[0] - pr.axis[0], p[1] - pr.axis[1]) <= pr.nominalDiameter / 2 + 0.3 && p[2] >= pr.sectionFromZ - 0.6) {
      return { part: 'head', feature: pr.label, clock: pr.clock };
    }
  }
  if (decl.bezel && inPolygon(decl.bezel.outer, p[0], p[1], 0.2) && p[2] >= decl.bezel.zBottom - 0.1) return { part: 'head', feature: 'bezel', clock: clockAt(p[0], p[1]) };
  if (decl.band) {
    const rho = Math.hypot(p[0], p[2]);
    if (rho <= decl.band.outerRadius + 0.3 && Math.abs(p[1]) <= decl.band.halfWidth + 0.3) {
      const deg = ((Math.atan2(p[0], p[2]) * 180) / Math.PI + 360) % 360;
      return { part: 'band', feature: `${Math.round(deg)}° round the band from the top` };
    }
  }
  return { part: 'piece' };
}

function whereOf(p: V3, decl: FeatureDecl, what: string): Where {
  const a = partAt(p, decl);
  const at = a.feature ? `${a.feature}${a.clock && a.part === 'head' ? ` (at ${a.clock} seen from above, the finger pointing to 12)` : ''}` : a.part;
  return { part: a.part, ...(a.feature ? { feature: a.feature } : {}), ...(a.clock ? { clock: a.clock } : {}), point_mm: pt(p), description: `${what} on the ${a.part === 'head' ? 'head' : a.part}: ${at}` };
}

const MAXSPHERE = 'largest inscribed sphere at every triangle centroid of the written STL, only facing-back surfaces bounding it';

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
    where: whereOf(m.p, decl, 'thinnest wall'),
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
    where: whereOf(m.p, decl, 'the thinnest feature'),
    method: MAXSPHERE,
  };
}

// --------------------------------------------------------------- sections

/** Segments where a plane cuts the mesh, mapped into 2D by `to2d`. */
function slice(bvh: Bvh, normal: V3, offset: number, to2d: (p: V3) => P2, keep: (p: V3) => boolean, candidates?: Uint32Array): [P2, P2][] {
  const segs: [P2, P2][] = [];
  const count = candidates ? candidates.length : bvh.n;
  for (let i = 0; i < count; i++) {
    const t = candidates ? candidates[i]! : i;
    const v = [bvh.vertex(t, 0), bvh.vertex(t, 1), bvh.vertex(t, 2)];
    const d = v.map((q) => q[0] * normal[0] + q[1] * normal[1] + q[2] * normal[2] - offset);
    const pts: V3[] = [];
    for (let k = 0; k < 3; k++) {
      const a = v[k]!, b = v[(k + 1) % 3]!, da = d[k]!, db = d[(k + 1) % 3]!;
      if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
        const s = da / (da - db);
        pts.push([a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1]), a[2] + s * (b[2] - a[2])]);
      }
    }
    if (pts.length === 2 && keep(pts[0]!) && keep(pts[1]!)) segs.push([to2d(pts[0]!), to2d(pts[1]!)]);
  }
  return segs;
}

function inside(segs: [P2, P2][], x: number, y: number): boolean {
  let c = false;
  for (const [a, b] of segs) {
    if (a[1] > y !== b[1] > y) {
      const xi = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      if (xi > x) c = !c;
    }
  }
  return c;
}

function distToSegs(segs: [P2, P2][], x: number, y: number): number {
  let best = Infinity;
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const s = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - a[0] - s * dx, y - a[1] - s * dy));
  }
  return best;
}

/** Diameter of the largest circle inside a closed section (grid search, then three refinements). */
export function inscribedDiameter(segs: [P2, P2][]): { d: number; at: P2 } | null {
  if (segs.length < 3) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [a, b] of segs) {
    x0 = Math.min(x0, a[0], b[0]);
    x1 = Math.max(x1, a[0], b[0]);
    y0 = Math.min(y0, a[1], b[1]);
    y1 = Math.max(y1, a[1], b[1]);
  }
  let best = { r: -1, x: 0, y: 0 };
  const scan = (cx0: number, cx1: number, cy0: number, cy1: number, n: number) => {
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const x = cx0 + ((cx1 - cx0) * i) / n, y = cy0 + ((cy1 - cy0) * j) / n;
        if (!inside(segs, x, y)) continue;
        const r = distToSegs(segs, x, y);
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

/** Triangles with any corner satisfying `near`. */
function trianglesNear(bvh: Bvh, near: (x: number, y: number, z: number) => boolean): Uint32Array {
  const out: number[] = [];
  const P = bvh.pos, T = bvh.tri;
  for (let t = 0; t < bvh.n; t++) {
    for (let k = 0; k < 3; k++) {
      const v = T[t * 3 + k]! * 3;
      if (near(P[v]!, P[v + 1]!, P[v + 2]!)) {
        out.push(t);
        break;
      }
    }
  }
  return Uint32Array.from(out);
}

function bandEntry(bvh: Bvh, band: BandDecl, L: CheckLimits): CheckEntry {
  let worst: { d: number; deg: number; p: V3 } | null = null;
  const cand = trianglesNear(bvh, (x, y, z) => Math.abs(y) < band.halfWidth + 0.5 && Math.hypot(x, z) < band.outerRadius + 1);
  for (let deg = 0; deg < 360; deg += 5) {
    const off = Math.min(Math.abs(deg), Math.abs(360 - deg));
    if (off < band.skipTopDeg) continue;
    const a = (deg * Math.PI) / 180;
    const dir: V3 = [Math.sin(a), 0, Math.cos(a)];
    const normal: V3 = [Math.cos(a), 0, -Math.sin(a)];
    const segs = slice(
      bvh,
      normal,
      0,
      (q) => [q[0] * dir[0] + q[2] * dir[2], q[1]],
      (q) => {
        const rho = q[0] * dir[0] + q[2] * dir[2];
        return rho > band.innerRadius - 0.3 && rho < band.outerRadius + 0.6 && Math.abs(q[1]) < band.halfWidth + 0.3;
      },
      cand,
    );
    const ins = inscribedDiameter(segs);
    if (!ins) continue;
    if (!worst || ins.d < worst.d) worst = { d: ins.d, deg, p: [dir[0] * ins.at[0], ins.at[1], dir[2] * ins.at[0]] };
  }
  if (!worst) throw new Error('no section of the band could be measured');
  return {
    id: 'band',
    name: 'Ring band thickness',
    limit: mm(L.band),
    result: worst.d >= L.band ? 'pass' : 'fail',
    measured: mm(worst.d),
    value: r3(worst.d),
    where: { part: 'band', feature: `${worst.deg}° round the band from the top`, point_mm: pt(worst.p), description: `the band's thinnest section, ${worst.deg}° round from the top` },
    method: "the band's cross-section every 5° round the finger (away from the head), measured as the largest circle that fits inside it",
  };
}

function prongEntry(bvh: Bvh, prongs: ProngDecl[], L: CheckLimits): CheckEntry {
  const results: { label: string; value: number; where: Where }[] = [];
  for (const pr of prongs) {
    let worst: { d: number; z: number; at: P2 } | null = null;
    const rad = pr.nominalDiameter / 2 + 0.35;
    const cand = trianglesNear(bvh, (x, y, z) => z > pr.sectionFromZ - 0.5 && z < pr.sectionToZ + 0.5 && Math.hypot(x - pr.axis[0], y - pr.axis[1]) <= rad + 0.3);
    const at = (z: number) => {
      const segs = slice(bvh, [0, 0, 1], z, (q) => [q[0], q[1]], (q) => Math.hypot(q[0] - pr.axis[0], q[1] - pr.axis[1]) <= rad, cand);
      const ins = inscribedDiameter(segs);
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
    method: "each prong's cross-section every 0.1 mm up its column (0.02 mm around the narrowest), measured as the largest circle that fits inside it (the narrowest section, con:minimum-prong-thickness)",
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

function gapEntry(bvh: Bvh, L: CheckLimits): CheckEntry {
  const N = bvh.normal, C = bvh.centroid;
  let best: { d: number; p: V3 } | null = null;
  const reach = Math.max(2, L.gap * 3);
  for (let t = 0; t < bvh.n; t++) {
    const n: V3 = [N[t * 3]!, N[t * 3 + 1]!, N[t * 3 + 2]!];
    const p: V3 = [C[t * 3]! + n[0] * 1e-5, C[t * 3 + 1]! + n[1] * 1e-5, C[t * 3 + 2]! + n[2] * 1e-5];
    const facing = (u: number) => N[u * 3]! * n[0] + N[u * 3 + 1]! * n[1] + N[u * 3 + 2]! * n[2] < -0.9;
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
      method: 'a ray outward from every triangle centroid, to the nearest surface facing back (normals within 25° of opposite)',
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
    method: 'a ray outward from every triangle centroid, to the nearest surface facing back (normals within 25° of opposite)',
  };
}

// --------------------------------------------------------------- surface

/**
 * How far the written facets stand off the intended curved surface: the largest
 * distance from any vertex of a much finer tessellation of the same piece (the
 * reference, built at 0.0015 mm) to the written mesh. Vertices of the reference
 * lie on the intended surface within its own tolerance, so this is the chord
 * deviation the printer would reproduce, measured, not estimated.
 */
function surfaceEntry(bvh: Bvh, L: CheckLimits, ref: ReadMesh, decl: FeatureDecl): CheckEntry {
  const P = ref.positions;
  let worst = { dev: 0, p: [0, 0, 0] as V3 };
  const cap = Math.max(0.2, L.surfaceDeviation * 20);
  for (let i = 0; i < P.length; i += 3) {
    const p: V3 = [P[i]!, P[i + 1]!, P[i + 2]!];
    const d = Math.sqrt(bvh.nearestDistSq(p, cap));
    if (d > worst.dev) worst = { dev: d, p };
  }
  return {
    id: 'surface_deviation',
    name: 'Surface smoothness',
    limit: mm(L.surfaceDeviation),
    result: worst.dev <= L.surfaceDeviation ? 'pass' : 'fail',
    measured: `${mm(worst.dev)} (checked at ${ref.positions.length / 3} points of a 0.0015 mm reference)`,
    value: r3(worst.dev),
    where: whereOf(worst.p, decl, 'the facets stand furthest from the curved surface'),
    method: 'the largest distance from the vertices of a much finer tessellation of the same piece to the written mesh',
  };
}
