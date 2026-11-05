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
// And a place is named by the PART whose faces hold it, by the part's own name: the library
// tags each face of the file with the named part it came from (FeatureDecl.faces; ifc:solid-mesh),
// and a reading is named by the faces it is measured from and the metal it meets, never by the
// region round it (named by region, a point on the moonstone ring's openwork was called "the
// bezel": fact:surface-check-named-a-blend-point-the-bezel-2026-10-05). A face from no named part
// is said to be in no named part (placeOf, below). A declaration made without face tags (a
// library build that did not ask for them) is named by region, as before; the engine always asks.
//
// Every entry says, besides its numbers, what is wrong in a maker's words (`problem`) and the
// part it is in (`part`), and carries every list it can, empty when there is nothing in it.
//
// A sheet from the tree's thicken operation (a cupped petal, a leaf) declares its
// middle surface and nominal thickness; the sheet check measures the file square to
// that surface and holds it to the wall minimum, and a thin place on a sheet is
// reported under the sheet's own name (sheets, below).
//
// A check that cannot run is a FAIL (owner, round 1, Q6): any exception inside
// a check becomes result "could_not_run", which blocks the export.
//
// These are the GENERAL checks, whatever the piece is. The checks of a stone's setting
// (prong thickness, prong grip, bezel wall and lip) are a LAYER on them, the jewelry layer
// (src/jewelry/checks.ts), which the engine passes in (CheckLayer, below). The checker imports
// no layer: a layer is applied only to a piece that declares what it checks, and asks the
// checker's own measurements (exported below) for its readings. The limits a check reads are
// the piece's, from its limit profile or supplied with it (src/limits/); the checker holds
// whatever it is given.

import { Bvh, CORNER, EDGE, IN_FACE } from './bvh.js';
import { NO_PART, type AddedDecl, type BandDecl, type FeatureDecl, type P2, type PartDecl, type SheetDecl } from './features.js';
import { segmentCrossesTri, type V3 } from './geom.js';
import { readBinaryStl, type ReadMesh } from './stl.js';
import { surfaceDirections } from './surface.js';

/** The casting limits a check reads, in mm: the piece's limit profile's, or the ones supplied with it. */
export interface CheckLimits {
  wall: number;
  band: number;
  prong: number;
  detail: number;
  gap: number;
  surfaceDeviation: number;
}

export interface Where {
  /** The kind of part: "band", "head" (a stone's setting), "sheet", "added shape", "blend", or "piece" (in no named part). */
  part: string;
  feature?: string;
  clock?: string;
  /** On a sheet: the other sheets that meet it here; empty when none does. */
  meets: string[];
  point_mm: [number, number, number];
  description: string;
  /** The part by its own name (a tree node's id, a program's .named() name, or the library's part); null: in no named part. */
  part_name: string | null;
  /** The other named parts that meet here: the metal measured lies between them, or a gap faces across to them. Empty when the place is within one part. */
  other_parts: string[];
}

/** One failing feature of a check that measures several (each prong, each sheet). `nominal` is what it was declared to be, when it says. */
export interface Failing {
  label: string;
  value: number;
  nominal?: number;
  where: Where;
  /** The part it is in, by its own name (where.part_name). */
  part: string | null;
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
  /** Every failing feature of a check that measures several (e.g. each thin prong); empty when none fails. */
  failing: Failing[];
  method: string;
  /** The part the check's place is in, by its own name (where.part_name); null when it has no place, or the place is in no named part. */
  part: string | null;
  /** What is wrong, in a maker's words, naming the part it is in; null when the check passes. */
  problem: string | null;
}

/** An entry as a check makes it: `failing` defaults to none, and `part` is its place's. */
export type EntryIn = Omit<CheckEntry, 'failing' | 'part' | 'problem'> & { failing?: Failing[]; problem?: string | null };

export function entry(e: EntryIn): CheckEntry {
  return { ...e, failing: e.failing ?? [], part: e.where?.part_name ?? null, problem: e.result === 'pass' ? null : (e.problem ?? null) };
}

/** A check that could not run, which counts as a fail (owner, round 1, Q6). */
export function couldNotRunEntry(id: CheckEntry['id'], name: string, limit: string, measured: string, method: string): CheckEntry {
  return entry({ id, name, limit, result: 'could_not_run', measured, where: null, method, problem: `The ${name === id ? id.replace(/_/g, ' ') : name.toLowerCase()} check could not run (${measured}); a check that cannot run counts as a fail, so nothing is exported until it can.` });
}

/**
 * The finer reference's vertices, which are all the surface check reads of it: a tree's
 * come as STL bytes and are read by the checker's own parser; a program's come from its
 * evaluation as float32 positions (src/program/run.ts).
 */
export interface ReferencePoints {
  positions: ArrayLike<number>;
}

export interface CheckRunResult {
  entries: CheckEntry[];
  mesh: { triangles: number; vertices: number; shells: number; volumeMm3: number };
  ms: number;
}

/** The part a place belongs to, as a check's `where` names it: its kind (`part`), and `name`, its own name, or null in no named part. */
export interface Part {
  part: string;
  feature?: string;
  clock?: string;
  meets?: string[];
  name: string | null;
}

/** What a layer's checks measure with: the file, its thickness readings, the declarations and the limits. */
export interface LayerContext {
  bvh: Bvh;
  samples: readonly Sample[];
  decl: FeatureDecl;
  L: CheckLimits;
  /** The named part a face of the file came from, or null; undefined when the declaration tags no faces. */
  faceOf(t: number): PartDecl | null | undefined;
}

/** One check a layer adds. It runs guarded, as every check does: one that throws reads could_not_run. */
export interface LayerCheck {
  id: CheckEntry['id'];
  name: string;
  limit: string;
  run(): CheckEntry | CheckEntry[];
}

/**
 * A LAYER of checks on the general ones, for what a piece declares beyond the general parts:
 * the jewelry layer (src/jewelry/checks.ts) checks a stone's setting. The engine passes the
 * layers in; the checker imports none. A layer whose `applies` is false for the piece is not
 * asked anything, so it changes nothing for a piece that declares nothing it checks.
 */
export interface CheckLayer {
  /** Whether the piece declares anything this layer checks. */
  applies(decl: FeatureDecl): boolean;
  /**
   * The layer's part that holds a place, if one does; asked before the general parts are. `face`
   * is the named part the place's face came from, when the declaration tags faces: the layer
   * words its own parts (a prong, the bezel, the stone seat, the head's rail). Without face
   * tags, it may name a place by its own declarations' regions, as before.
   */
  partAt?(p: V3, decl: FeatureDecl, face?: PartDecl): Part | null;
  /** The words for a place on one of the layer's parts: what it is ("the bezel") and where on it ("on the left of the bezel (at 9:00 ...)"). */
  placeWords?(w: Where): { of: string; at: string } | null;
  /** Whether a thickness reading at p is judged by one of the layer's own checks instead of the wall check. */
  judgesWallAt?(p: V3, decl: FeatureDecl): boolean;
  /** The layer's checks, in the order they run. They run after the band's, before the sheets'. */
  checks(ctx: LayerContext): LayerCheck[];
}

export const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const mm = (x: number) => `${r3(x)} mm`;
export const pt = (p: V3): [number, number, number] => [r3(p[0]), r3(p[1]), r3(p[2])];

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
 * (ver:surface-deviation-check). `layers` add their own checks, for a piece that declares
 * what they check (the engine passes the jewelry layer).
 */
export function runChecks(stl: Uint8Array, decl: FeatureDecl, L: CheckLimits, reference?: Uint8Array | ReferencePoints, layers: readonly CheckLayer[] = []): CheckRunResult {
  const t0 = performance.now();
  let mesh: ReadMesh;
  try {
    mesh = readBinaryStl(stl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const ids: CheckEntry['id'][] = ['watertight', 'wall', 'band', 'detail', 'gap', 'surface_deviation'];
    return {
      entries: ids.map((id) => couldNotRunEntry(id, id, '-', `the STL could not be read back: ${msg}`, 'read-back')),
      mesh: { triangles: 0, vertices: 0, shells: 0, volumeMm3: 0 },
      ms: performance.now() - t0,
    };
  }
  const bvh = new Bvh(mesh.positions, mesh.triangles);
  const on = layers.filter((l) => l.applies(decl));
  const entries: CheckEntry[] = [];
  const guard = (id: CheckEntry['id'], name: string, limit: string, fn: () => CheckEntry | CheckEntry[]) => {
    try {
      const r = fn();
      entries.push(...(Array.isArray(r) ? r : [r]));
    } catch (e) {
      entries.push(couldNotRunEntry(id, name, limit, `the check could not run: ${e instanceof Error ? e.message : String(e)}`, 'error'));
    }
  };

  let shells = 0, volume = 0;
  guard('watertight', 'One watertight solid', 'manifold edges, no self-intersections, faces outward, exactly one shell', () => {
    const w = watertight(mesh, bvh, decl, on);
    shells = w.shells;
    volume = w.volume;
    return w.entry;
  });

  // The surface's direction at each triangle: its own normal, except that a sliver takes the surface's it was cut from (surface.ts).
  const surface = surfaceDirections(bvh, L.surfaceDeviation).normal;
  const samples = sampleThickness(bvh, surface);
  guard('wall', 'Wall thickness', mm(L.wall), () => wallEntry(bvh, samples, L, decl, on));
  guard('detail', 'Smallest detail', mm(L.detail), () => detailEntry(bvh, samples, L, decl, on));
  if (decl.band) guard('band', 'Ring band thickness', mm(L.band), () => bandEntry(bvh, decl.band!, L, decl));
  for (const layer of on) for (const c of layer.checks({ bvh, samples, decl, L, faceOf: (t) => faceOf(decl, t) })) guard(c.id, c.name, c.limit, c.run);
  if (decl.sheets?.length) guard('sheet', 'Sheet thickness', `${mm(L.wall)}, square to the surface`, () => sheetEntry(bvh, surface, decl.sheets!, L));
  guard('gap', 'Smallest gap', mm(L.gap), () => gapEntry(bvh, surface, L, decl, on));
  guard('surface_deviation', 'Surface smoothness', mm(L.surfaceDeviation), () => {
    if (!reference) throw new Error('no finer reference tessellation was supplied');
    return surfaceEntry(bvh, L, reference instanceof Uint8Array ? readBinaryStl(reference) : reference, decl, on);
  });
  return { entries, mesh: { triangles: mesh.count, vertices: mesh.positions.length / 3, shells, volumeMm3: volume }, ms: performance.now() - t0 };
}

// ------------------------------------------------------------- watertight

function watertight(mesh: ReadMesh, bvh: Bvh, decl: FeatureDecl, layers: readonly CheckLayer[]): { entry: CheckEntry; shells: number; volume: number } {
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
  let crossTris: [number, number] = [-1, -1];
  bvh.forEachOverlap((a, b) => {
    const ta = [tri[a * 3]!, tri[a * 3 + 1]!, tri[a * 3 + 2]!], tb = [tri[b * 3]!, tri[b * 3 + 1]!, tri[b * 3 + 2]!];
    if (ta.some((x) => tb.includes(x))) return;
    const A = [bvh.vertex(a, 0), bvh.vertex(a, 1), bvh.vertex(a, 2)] as const;
    const B = [bvh.vertex(b, 0), bvh.vertex(b, 1), bvh.vertex(b, 2)] as const;
    for (let k = 0; k < 3; k++) {
      if (segmentCrossesTri(A[k]!, A[(k + 1) % 3]!, B[0], B[1], B[2]) || segmentCrossesTri(B[k]!, B[(k + 1) % 3]!, A[0], A[1], A[2])) {
        crossings++;
        if (!firstCross) crossTris = [a, b];
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
  // The first self-intersection is named by the parts of the two faces that cross there.
  const own = cross ? faceOf(decl, crossTris[0]) : undefined;
  const across = cross ? faceOf(decl, crossTris[1]) : undefined;
  const where = cross
    ? own === undefined
      ? placeAt({ part: 'piece', name: null }, cross, 'the first self-intersection found')
      : placeOf(cross, decl, layers, 'the first self-intersection found', own, across ? [across] : [])
    : null;
  const at = where ? placeWords(where, layers, decl) : null;
  return {
    entry: entry({
      id: 'watertight',
      name: 'One watertight solid',
      limit: 'manifold edges, no self-intersections, faces outward, exactly one shell',
      result: problems.length ? 'fail' : 'pass',
      measured: problems.length ? problems.join('; ') : `closed and manifold, ${shells} shell, consistently wound, no self-intersection, volume ${r3(vol)} mm³`,
      where,
      method: 'read back from the written STL: edge pairing, union-find shells, signed volume, triangle-triangle crossing tests',
      problem: `The piece is not one closed solid: ${problems.join('; ')}${at ? `; the first self-intersection is ${at.of ? `in ${at.of}, ` : 'in no named part, '}${at.at}` : ''}.`,
    }),
    shells,
    volume: vol,
  };
}

// --------------------------------------------------------------- thickness

export interface Sample {
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

export function minSample(samples: readonly Sample[], keep: (s: Sample) => boolean = () => true): Sample | null {
  let best: Sample | null = null;
  for (const s of samples) if (keep(s) && (!best || s.thickness < best.thickness)) best = s;
  return best;
}

/**
 * Which part a place belongs to, BY REGION, for a declaration that tags no faces (a library
 * build that did not ask for them; the engine always asks, and placeOf then names the part by
 * the faces). `p` is the place on the surface; `centre`, for a thickness reading, is the middle
 * of the metal the reading is about, and it decides between the band and a shape the tree
 * added: the band only when it lies inside the band's own declared section (the band check's
 * region), otherwise the added shape whose bounds hold it. Labelling by the band's envelope
 * instead, 0.3 mm round it, called a thin overhang beside the band "the band" and advised a
 * thicker band, which does not reach it (fact:wall-check-reads-overhang-beside-band-edge). A
 * sheet from the thicken operation is named before the added shape round it: the place lies
 * within half its thickness of the sheet's middle surface, and every sheet that close is named
 * (where two meet).
 */
function partByRegion(p: V3, decl: FeatureDecl, layers: readonly CheckLayer[], centre?: V3): Part {
  for (const l of layers) {
    const own = l.partAt?.(p, decl);
    if (own) return own;
  }
  const sheet = sheetPart(centre ?? p, decl);
  if (centre) {
    const b = decl.band;
    if (b) {
      const rho = Math.hypot(centre[0], centre[2]);
      if (rho >= b.innerRadius && rho <= b.outerRadius && Math.abs(centre[1]) <= b.halfWidth) return bandAt(p);
    }
    if (sheet) return sheet;
    const holding = (decl.added ?? []).filter((a) => inBox(a, centre));
    if (holding.length) return { part: 'added shape', feature: holding.map((a) => a.id).join(', '), name: holding.length === 1 ? holding[0]!.id : null };
    return { part: 'piece', name: null };
  }
  if (sheet) return sheet;
  if (decl.band) {
    const rho = Math.hypot(p[0], p[2]);
    if (rho <= decl.band.outerRadius + 0.3 && Math.abs(p[1]) <= decl.band.halfWidth + 0.3) return bandAt(p);
  }
  return { part: 'piece', name: null };
}

/** A place on the band, by how far round from the top it is. */
function bandAt(p: V3): Part {
  return { part: 'band', feature: `${Math.round(((Math.atan2(p[0], p[2]) * 180) / Math.PI + 360) % 360)}° round the band from the top`, name: 'band' };
}

/** The sheet a point lies within (and the others that meet it there), by the sheets' own declarations. */
function sheetPart(q: V3, decl: FeatureDecl): Part | null {
  const [sheet, ...others] = sheetsAt(q, decl);
  return sheet ? { part: 'sheet', feature: sheet.label, ...(others.length ? { meets: others.map((o) => o.label) } : {}), name: sheet.label } : null;
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

// ------------------------------------------------------- naming a place by its faces

/** The named part a face of the file came from: null for none, undefined when the declaration tags no faces. */
export function faceOf(decl: FeatureDecl, t: number): PartDecl | null | undefined {
  const f = decl.faces;
  if (!f) return undefined;
  const i = f.of[t];
  return i === undefined || i === NO_PART ? null : (f.parts[i] ?? null);
}

/** The named parts whose faces the ball of a thickness reading touches: the metal it measures lies between them. */
function partsMet(bvh: Bvh, decl: FeatureDecl, s: Sample): PartDecl[] {
  const f = decl.faces;
  if (!f) return [];
  const seen = new Set<number>();
  bvh.forEachWithin(s.centre[0], s.centre[1], s.centre[2], (s.thickness / 2) * 1.01 + 0.002, (t) => {
    const i = f.of[t]!;
    if (i !== NO_PART) seen.add(i);
  });
  return [...seen].map((i) => f.parts[i]!);
}

/**
 * Which named part a reading is in, from the face it is measured from (`own`) and the faces
 * its ball or ray meets (`met`): the face's own part, except that a cut (the stone's seat) is
 * no metal of its own, so a reading at its faces is in the metal it is cut into, when it meets
 * that metal. A face from no named part leaves the reading in no named part, whatever it meets:
 * the other parts it meets are said, never taken for it. `others`: the named parts it meets
 * besides.
 */
function nameReading(own: PartDecl | null, met: readonly PartDecl[]): { name: PartDecl | null; others: string[] } {
  let name = own;
  if (own?.cut) {
    const into = met.filter((m) => !m.cut).sort((a, b) => Number(b.kind === 'setting') - Number(a.kind === 'setting'));
    if (into.length) name = into[0]!;
  }
  const others = [...new Set(met.map((m) => m.name))].filter((n) => n !== name?.name);
  return { name, others };
}

/** A part, as a reading's sentence names it: "the band", "the bezel", "prong 2 of 4", "\"fin\"". */
export function partWords(name: string, kind: PartDecl['kind'] | 'sheet' | 'blend'): string {
  if (kind === 'shape') return `"${name}"`;
  if (kind === 'sheet') return `the sheet "${name}"`;
  if (kind === 'blend') return `the smooth blend "${name}"`;
  return /\d/.test(name) ? name : `the ${name}`;
}

/** A part by its name, in words, its kind as the declaration's faces say it (a shape's, when they do not say). */
export function partWordsIn(decl: FeatureDecl | undefined, name: string): string {
  return partWords(name, decl?.faces?.parts.find((p) => p.name === name)?.kind ?? (name === 'band' ? 'band' : 'shape'));
}

/** "the band and "fin"": the other parts a place meets, in words. */
function othersWords(decl: FeatureDecl, others: readonly string[]): string {
  const w = others.map((n) => partWordsIn(decl, n));
  return w.length <= 1 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
}

/** A full place: the part it is in (as the layers word their own) and the others it meets. */
export function placeAt(part: Part, p: V3, description: string, others: readonly string[] = []): Where {
  return {
    part: part.part,
    ...(part.feature ? { feature: part.feature } : {}),
    ...(part.clock ? { clock: part.clock } : {}),
    meets: part.meets ?? [],
    point_mm: pt(p),
    description,
    part_name: part.name,
    other_parts: [...others],
  };
}

/** How a place's description says the part (as the report has always said it), and the others it meets. */
function describe(a: Part, what: string, decl: FeatureDecl, others: readonly string[]): string {
  const meets = others.length ? `, where it meets ${othersWords(decl, others)}` : '';
  if (a.part === 'added shape') return `${what} in the added shape ${quoteIds(a.feature!)}${meets}`;
  if (a.part === 'sheet') return `${what} on the sheet "${a.feature}"${a.meets?.length ? `, where it meets ${a.meets.map((m) => `"${m}"`).join(' and ')}` : ''}${meets}`;
  if (a.part === 'piece' && a.name === null && decl.faces) return `${what} in no named part${meets}`;
  const at = a.feature ? `${a.feature}${a.clock && a.part === 'head' ? ` (at ${a.clock} seen from above, the finger pointing to 12)` : ''}` : a.part;
  return `${what} on the ${a.part === 'head' ? 'head' : a.part}: ${at}${meets}`;
}

/**
 * A place, named by the part whose faces hold it: `own` is the part of the face the reading is
 * measured from, `met` the parts its ball or ray meets. A sheet's own declaration names a place
 * within its thickness first, and says which other sheets meet it there. Without face tags,
 * by region (partByRegion).
 */
function placeOf(p: V3, decl: FeatureDecl, layers: readonly CheckLayer[], what: string, own: PartDecl | null | undefined, met: readonly PartDecl[] = [], centre?: V3): Where {
  if (own === undefined) {
    const a = partByRegion(p, decl, layers, centre);
    return placeAt(a, p, describe(a, what, decl, []));
  }
  const sheet = sheetPart(centre ?? p, decl);
  const { name, others } = nameReading(own, met);
  let a: Part;
  if (sheet) a = sheet;
  else if (!name) a = { part: 'piece', name: null };
  else if (name.kind === 'band') a = { ...bandAt(p), name: name.name };
  else if (name.kind === 'setting') a = layers.map((l) => l.partAt?.(p, decl, name)).find((x): x is Part => !!x) ?? { part: 'head', feature: name.name, clock: clockAt(p[0], p[1]), name: name.name };
  else a = { part: 'added shape', feature: name.name, name: name.name };
  const besides = others.filter((o) => o !== a.name && !(a.meets ?? []).includes(o) && !(sheet && o === own?.name));
  return placeAt(a, p, describe(a, what, decl, besides), besides);
}

/** A place on a thickness reading's surface, named by its face and the parts its ball meets. */
function readingPlace(bvh: Bvh, decl: FeatureDecl, layers: readonly CheckLayer[], s: Sample, what: string): Where {
  return placeOf(s.p, decl, layers, what, faceOf(decl, s.t), partsMet(bvh, decl, s), s.centre);
}

/**
 * A place on a smooth blend's own surface, named by the blend. It is one of the points the
 * blend declares on its surface, so which part it lies on is known, not guessed from the
 * region round it: named by region, the moonstone ring's rail under its bezel's open back
 * was called "the bezel", and the bezel was suspected of an engine fault it did not have
 * (fact:a-blends-level-set-chamfers-the-creases-of-its-own-field-2026-10-05). Its part's name
 * is its face's (the shape that holds the blend), or the blend's own without face tags.
 */
function onBlend(p: V3, label: string, what: string, face: PartDecl | null | undefined): Where {
  const clock = clockAt(p[0], p[1]);
  return placeAt({ part: 'blend', feature: label, clock, name: face === undefined ? label : (face?.name ?? null) }, p, `${what} on the smooth blend "${label}" (at ${clock} seen from above, the finger pointing to 12)`);
}

// --------------------------------------------------------- a problem in words

/** Where on the piece a place is, in words: on a part of a layer's, as the layer says it; on the band, how far round; otherwise its point. */
export function placeWords(w: Where, layers: readonly CheckLayer[], decl: FeatureDecl): { of: string | null; at: string } {
  const meets = w.other_parts.length ? `where it meets ${othersWords(decl, w.other_parts)}, ` : '';
  const point = `at ${JSON.stringify(w.point_mm)} mm`;
  for (const l of layers) {
    const own = l.placeWords?.(w);
    if (own) return { of: own.of, at: `${meets}${own.at}` };
  }
  if (w.part === 'band') return { of: 'the band', at: `${meets}${w.feature}` };
  if (w.part === 'sheet') return { of: partWords(w.feature!, 'sheet'), at: `${w.meets.length ? `where it meets ${w.meets.map((m) => `"${m}"`).join(' and ')}, ` : ''}${meets}${point}` };
  if (w.part === 'blend') return { of: w.part_name ? partWords(w.part_name, 'shape') : null, at: `${meets}on the smooth blend "${w.feature}", ${point}` };
  if (w.part_name) return { of: partWords(w.part_name, 'shape'), at: `${meets}${point}` };
  return { of: null, at: `${meets}${point}` };
}

/** "The wall of the band is 0.62 mm at its thinnest, ...": a thickness reading's problem, in words. */
function thinWords(e: { value?: number; where: Where | null }, layers: readonly CheckLayer[], decl: FeatureDecl, what: 'wall' | 'detail', limit: number): string {
  const v = r3(e.value ?? 0);
  const { of, at } = e.where ? placeWords(e.where, layers, decl) : { of: null, at: 'somewhere on the piece' };
  if (what === 'wall') return of ? `The wall of ${of} is ${v} mm at its thinnest, ${at}; it must be at least ${r3(limit)} mm.` : `The wall is ${v} mm at its thinnest, in no named part, ${at}; it must be at least ${r3(limit)} mm.`;
  return of ? `The finest detail, in ${of}, is ${v} mm across, ${at}; it must be at least ${r3(limit)} mm.` : `The finest detail is ${v} mm across, in no named part, ${at}; it must be at least ${r3(limit)} mm.`;
}

export const MAXSPHERE = "largest inscribed sphere at every triangle centroid of the written STL, grown along the surface's direction there (a triangle's own normal, except that a sliver too narrow to have a direction takes the direction of the surface it was cut from), only surfaces facing back (more than 105° away) bounding it, and a crease or corner only when the sphere meets it square-on (no face meeting there lies nearer the sphere's centre) and from more than 105° away; the place is named by the part its face came from (a cut, the stone's seat, by the metal it is cut into), with the other named parts the sphere meets";

function wallEntry(bvh: Bvh, samples: Sample[], L: CheckLimits, decl: FeatureDecl, layers: readonly CheckLayer[]): CheckEntry {
  const m = minSample(samples, (s) => !layers.some((l) => l.judgesWallAt?.(s.p, decl)));
  if (!m) throw new Error('no thickness could be measured');
  const where = readingPlace(bvh, decl, layers, m, 'thinnest wall');
  return entry({
    id: 'wall',
    name: 'Wall thickness',
    limit: mm(L.wall),
    result: m.thickness >= L.wall ? 'pass' : 'fail',
    measured: mm(m.thickness),
    value: r3(m.thickness),
    where,
    method: `${MAXSPHERE}; prong columns are judged by the prong check's narrowest section instead`,
    problem: thinWords({ value: m.thickness, where }, layers, decl, 'wall', L.wall),
  });
}

function detailEntry(bvh: Bvh, samples: Sample[], L: CheckLimits, decl: FeatureDecl, layers: readonly CheckLayer[]): CheckEntry {
  const m = minSample(samples);
  if (!m) throw new Error('no thickness could be measured');
  const where = readingPlace(bvh, decl, layers, m, 'the thinnest feature');
  return entry({
    id: 'detail',
    name: 'Smallest detail',
    limit: mm(L.detail),
    result: m.thickness >= L.detail ? 'pass' : 'fail',
    measured: `${mm(m.thickness)} (the thinnest feature anywhere)`,
    value: r3(m.thickness),
    where,
    method: MAXSPHERE,
    problem: thinWords({ value: m.thickness, where }, layers, decl, 'detail', L.detail),
  });
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
      where: placeAt({ part: 'sheet', feature: sh.label, name: sh.label }, w.p, `the sheet "${sh.label}", its thinnest place measured square to its surface`),
    });
  }
  const failing = results.filter((r) => r.value < L.wall);
  const thinnest = results.reduce((a, b) => (b.value < a.value ? b : a));
  return entry({
    id: 'sheet',
    name: 'Sheet thickness',
    limit: `${mm(L.wall)}, square to the surface`,
    result: failing.length ? 'fail' : 'pass',
    measured: `${mm(thinnest.value)} ("${thinnest.label}"); each, measured (declared): ${results.map((r) => `${r.label} ${r.value} (${r.nominal})`).join(', ')} mm`,
    value: thinnest.value,
    where: thinnest.where,
    failing: failing.map(({ label, value, nominal, where }) => ({ label, value, nominal, where, part: where.part_name })),
    method: `each sheet made by the thicken operation, measured square to its surface at the points on its middle surface it declares (${results.map((r) => `${r.measured} on ${r.label}`).join(', ')}): a ray each way along the surface's normal to the first face of the written STL, the two distances summed, where both faces face along the rays within 45° (the sheet's own faces); points cut away, or beside a rim or a slanting cut, are skipped and left to the wall check`,
    problem: failing.map((f) => `The sheet "${f.label}" is ${f.value} mm thick at its thinnest, measured square to its surface, at ${JSON.stringify(f.where.point_mm)} mm; it must be at least ${r3(L.wall)} mm.`).join(' '),
  });
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

export type Seg = [P2, P2];

/** Where a plane (normal · p = offset) cuts the candidate triangles, in the plane's 2D coordinates; `want` drops segments that cannot matter. */
export function slice(bvh: Bvh, normal: V3, offset: number, to2d: (x: number, y: number, z: number) => P2, candidates: Uint32Array, want: (a: P2, b: P2) => boolean): Seg[] {
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
export interface Region {
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
export function trianglesWhere(bvh: Bvh, keep: (lo: V3, hi: V3, rhoMax: number) => boolean): Uint32Array {
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

function bandEntry(bvh: Bvh, band: BandDecl, L: CheckLimits, decl: FeatureDecl): CheckEntry {
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
  // The band's own section is the band, by its declaration: named by its part's name.
  const name = decl.faces?.parts.find((p) => p.kind === 'band')?.name ?? 'band';
  return entry({
    id: 'band',
    name: 'Ring band thickness',
    limit: mm(L.band),
    result: worst!.d >= L.band ? 'pass' : 'fail',
    measured: mm(worst!.d),
    value: r3(worst!.d),
    where: placeAt({ part: 'band', feature: `${worst!.deg}° round the band from the top`, name }, worst!.p, `the band's thinnest section, ${worst!.deg}° round from the top`),
    method: "the band's cross-section every 5° all the way round, cut from the whole piece and then clipped to the band's own section (its inner and outer radius and its width), measured as the largest circle that fits inside it; metal outside the band's own section, a head or an added shape, is not counted as band",
    problem: `The band is ${r3(worst!.d)} mm thick at its thinnest section, ${worst!.deg}° round the band from the top; it must be at least ${r3(L.band)} mm.`,
  });
}

// ------------------------------------------------------------------- gaps

function gapEntry(bvh: Bvh, S: Float64Array, L: CheckLimits, decl: FeatureDecl, layers: readonly CheckLayer[]): CheckEntry {
  // Along the surface's direction, and facing judged by it, for the same reason as the
  // thickness: two slivers leaning opposite ways looked like walls 0.001 mm apart.
  const C = bvh.centroid;
  let best: { d: number; p: V3; t: number; across: number } | null = null;
  const reach = Math.max(2, L.gap * 3);
  for (let t = 0; t < bvh.n; t++) {
    const n: V3 = [S[t * 3]!, S[t * 3 + 1]!, S[t * 3 + 2]!];
    const p: V3 = [C[t * 3]! + n[0] * 1e-5, C[t * 3 + 1]! + n[1] * 1e-5, C[t * 3 + 2]! + n[2] * 1e-5];
    const facing = (u: number) => S[u * 3]! * n[0] + S[u * 3 + 1]! * n[1] + S[u * 3 + 2]! * n[2] < -0.9;
    const hit = bvh.ray(p, n, reach, facing);
    if (hit && (!best || hit.dist < best.d)) best = { d: hit.dist, p, t, across: hit.t };
  }
  if (!best) {
    return entry({
      id: 'gap',
      name: 'Smallest gap',
      limit: mm(L.gap),
      result: 'pass',
      measured: `no gap narrower than ${mm(reach)} between facing surfaces`,
      where: null,
      method: "a ray outward from every triangle centroid along the surface's direction there (a sliver's taken from the surface it was cut from), to the nearest surface facing back (within 25° of opposite)",
    });
  }
  // The gap is named by the part of the face it opens from, and the part it faces across to, when that is another.
  const own = faceOf(decl, best.t);
  const across = faceOf(decl, best.across);
  const what = 'the narrowest gap between two facing surfaces';
  const where = own === undefined ? placeAt({ part: 'piece', name: null }, best.p, what) : placeOf(best.p, decl, layers, what, own, across ? [across] : []);
  const v = r3(best.d);
  const { of, at } = placeWords({ ...where, other_parts: [] }, layers, decl);
  const problem =
    own === undefined
      ? `A gap is only ${v} mm across, ${at}; it must be at least ${r3(L.gap)} mm, or closed.`
      : !of
        ? `A gap is only ${v} mm across, in no named part${where.other_parts.length ? `, facing ${othersWords(decl, where.other_parts)}` : ''}, ${at}; it must be at least ${r3(L.gap)} mm, or closed.`
        : where.other_parts.length
          ? `The gap between ${of} and ${othersWords(decl, where.other_parts)} is only ${v} mm across, ${at}; it must be at least ${r3(L.gap)} mm, or closed.`
          : `A gap in ${of} is only ${v} mm across, ${at}; it must be at least ${r3(L.gap)} mm, or closed.`;
  return entry({
    id: 'gap',
    name: 'Smallest gap',
    limit: mm(L.gap),
    result: best.d >= L.gap ? 'pass' : 'fail',
    measured: mm(best.d),
    value: v,
    where,
    method: "a ray outward from every triangle centroid along the surface's direction there (a sliver's taken from the surface it was cut from), to the nearest surface facing back (within 25° of opposite); the gap is named by the part of the face it opens from, and the part it faces across to",
    problem,
  });
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
function surfaceEntry(bvh: Bvh, L: CheckLimits, ref: ReferencePoints, decl: FeatureDecl, layers: readonly CheckLayer[]): CheckEntry {
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
  // The place is named by the part of the written face nearest the point that stands furthest off it.
  const face = decl.faces ? faceOf(decl, bvh.nearestTriangle(worst.p, cap)) : undefined;
  const what = 'the facets stand furthest from the curved surface';
  const where = worst.blend !== undefined ? onBlend(worst.p, worst.blend, what, face) : placeOf(worst.p, decl, layers, what, face);
  const { of, at } = placeWords(where, layers, decl);
  return entry({
    id: 'surface_deviation',
    name: 'Surface smoothness',
    limit: mm(L.surfaceDeviation),
    result: worst.dev <= L.surfaceDeviation ? 'pass' : 'fail',
    measured: `${mm(worst.dev)} (checked at ${ref.positions.length / 3} points of a 0.0015 mm reference${onBlends ? ` and ${onBlends} points on the smooth blends' own surfaces` : ''})`,
    value: r3(worst.dev),
    where,
    method: `the largest distance from the vertices of a much finer tessellation of the same piece to the written mesh${onBlends ? "; and, for each smooth blend, from points on its own surface (its distance field's zero level) at the corners, edge midpoints and centroid of every facet the file has from it" : ''}`,
    problem: `The casting file's facets stand ${r3(worst.dev)} mm off the curved surface${of ? ` of ${of}` : ', in no named part'}, ${at}; they may stand at most ${r3(L.surfaceDeviation)} mm off it.`,
  });
}
