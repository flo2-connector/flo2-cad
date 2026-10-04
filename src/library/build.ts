// The jewelry library (cmp:jewelry-part-library) over the kernel
// (cmp:geometry-kernel): turns a validated piece tree into one closed metal solid,
// the stone (for the preview only), and the feature declarations the checker
// measures against.
//
// Frame: X across the hand, Y along the finger (towards the fingertip), Z up
// through the stone. Seen from above, the finger points to 12 o'clock.
//
// Tessellation follows a chord tolerance: 0.0045 mm in each direction for a
// casting file (inside the 0.01 mm surface limit, con:surface-deviation-tolerance,
// even where a surface curves both ways) and coarser for a preview, which may be
// coarser (owner, round 2, Q2).

import { kernel, segmentsFor, type CrossSection, type Kernel, type Manifold, type Vec2, type Vec3 } from '../kernel/manifold.js';
import type { BandDecl, BezelDecl, FeatureDecl, P2, ProngDecl, SheetDecl, StoneDecl } from '../checker/features.js';
import type { PieceTree, PieceView, TreeNode } from '../piece/tree.js';
import { readPiece } from '../piece/tree.js';
import { buildOp } from './ops.js';
import { IDENTITY } from './thicken.js';
import { stoneShape, type StoneSpec } from './stones.js';

/** Per direction: a doubly curved facet (a torus, a domed band) adds both directions' chords, so each is half the 0.01 mm limit, less a margin. */
export const EXPORT_TOL = 0.0045;
export const PREVIEW_TOL = 0.03;
/** The surface check's reference: the same piece, far more finely tessellated. */
export const REFERENCE_TOL = 0.0015;

export interface MeshOut {
  positions: Float32Array;
  triangles: Uint32Array;
}

export interface Built {
  view: PieceView;
  metal: MeshOut;
  /** The stone, NEVER in the casting file: preview only. */
  stone?: MeshOut;
  decl: FeatureDecl;
  volumeMm3: number;
  bbox: { min: Vec3; max: Vec3 };
  /** Where things sit, for the summary and the placeholder notice. */
  layout: { girdleBottomZ?: number; crownMm?: number; lipMm?: number; tableZ?: number };
}

/** Frees every kernel object it was handed when the build ends. */
export class Arena {
  #items: { delete(): void }[] = [];
  t<T extends { delete(): void }>(x: T): T {
    this.#items.push(x);
    return x;
  }
  free(): void {
    for (const x of this.#items.splice(0)) {
      try {
        x.delete();
      } catch {
        /* already freed */
      }
    }
  }
}

// -------------------------------------------------------------------- band

/** Edge thickness of a domed profile: the dome never thins an edge below about 0.95 mm when the band can afford it. */
function domeOf(t: number): number {
  return Math.min(0.35 * t, Math.max(0, t - 0.95));
}

/** Points along a parametric curve from u0 up to (not including) u1, split until every chord is within tol of the curve. */
function adaptive(f: (u: number) => Vec2, u0: number, u1: number, tol: number, depth = 0): Vec2[] {
  const a = f(u0), b = f(u1);
  let worst = 0;
  for (const s of [0.25, 0.5, 0.75]) {
    const m = f(u0 + (u1 - u0) * s);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1e-30;
    const k = Math.max(0, Math.min(1, ((m[0] - a[0]) * dx + (m[1] - a[1]) * dy) / l2));
    worst = Math.max(worst, Math.hypot(m[0] - a[0] - k * dx, m[1] - a[1] - k * dy));
  }
  if (worst > tol && depth < 18) {
    const um = (u0 + u1) / 2;
    return [...adaptive(f, u0, um, tol, depth + 1), ...adaptive(f, um, u1, tol, depth + 1)];
  }
  return [a];
}

/** The band's cross-section in (radius, height-along-finger), counter-clockwise, every chord within tol of the intended curve. */
export function bandProfile(profile: string, rIn: number, t: number, w: number, tol: number): Vec2[] {
  const hw = w / 2;
  if (profile === 'flat') {
    return [
      [rIn, -hw],
      [rIn + t, -hw],
      [rIn + t, hw],
      [rIn, hw],
    ];
  }
  if (profile === 'round') {
    const a = t / 2;
    const ell = (phi: number): Vec2 => [rIn + a + a * Math.cos(phi), hw * Math.sin(phi)];
    return dedupe([...adaptive(ell, -Math.PI / 2, Math.PI / 2, tol), ...adaptive(ell, Math.PI / 2, (3 * Math.PI) / 2, tol)]);
  }
  const d = domeOf(t);
  const dIn = profile === 'comfort_fit' ? d * 0.35 : 0;
  const dOut = profile === 'comfort_fit' ? d * 0.65 : d;
  // Inside surface, from +hw down to -hw (it bulges towards the finger by dIn at the centre).
  const inner = (phi: number): Vec2 => [rIn + dIn * (1 - Math.cos(phi)), hw * Math.sin(phi)];
  // Outside surface, from -hw up to +hw.
  const outer = (phi: number): Vec2 => [rIn + t - dOut * (1 - Math.cos(phi)), hw * Math.sin(phi)];
  const pts: Vec2[] = [...adaptive(inner, Math.PI / 2, -Math.PI / 2, tol), inner(-Math.PI / 2), ...adaptive(outer, -Math.PI / 2, Math.PI / 2, tol), outer(Math.PI / 2)];
  // Counter-clockwise in (r, h): the inside run goes down, the outside up.
  return dedupe(pts);
}

function dedupe(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) out.push(p);
  }
  if (out.length > 2) {
    const f = out[0]!, l = out[out.length - 1]!;
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= 1e-9) out.pop();
  }
  return out;
}

// ------------------------------------------------------------------- outlines

/** Offsets a convex counter-clockwise polygon outward by d, mitring the corners. */
export function offsetConvex(pts: P2[], d: number): P2[] {
  const n = pts.length;
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n]!, b = pts[i]!, c = pts[(i + 1) % n]!;
    const n1 = edgeNormal(a, b), n2 = edgeNormal(b, c);
    const m: P2 = [n1[0] + n2[0], n1[1] + n2[1]];
    const ml = Math.hypot(m[0], m[1]) || 1;
    const cosHalf = (m[0] * n1[0] + m[1] * n1[1]) / ml;
    const k = d / Math.max(cosHalf, 0.2);
    out.push([b[0] + (m[0] / ml) * k, b[1] + (m[1] / ml) * k]);
  }
  return out;
}

function edgeNormal(a: P2, b: P2): P2 {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}

/** Clock position (seen from above, 12 o'clock along +Y) of a point. */
export function clockOf(x: number, y: number): string {
  let deg = (Math.atan2(x, y) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const totalMin = Math.round((deg / 30) * 60);
  let h = Math.floor(totalMin / 60) % 12;
  const m = totalMin % 60;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Where each prong stands: a point on the girdle outline and its outward direction. */
export function prongPlaces(stone: StoneSpec, outline: P2[], count: number): { at: P2; out: P2 }[] {
  if (stone.shape === 'round') {
    const r = stone.lengthMm / 2;
    return Array.from({ length: count }, (_, i) => {
      const a = (((i + 0.5) * 360) / count) * (Math.PI / 180);
      const dir: P2 = [Math.sin(a), Math.cos(a)];
      return { at: [dir[0] * r, dir[1] * r], out: dir };
    });
  }
  // Emerald: the 4 cut corners, then (6 prongs) the middles of the long sides.
  const n = outline.length;
  const mids = outline.map((p, i) => {
    const q = outline[(i + 1) % n]!;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return { at: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as P2, out: edgeNormal(p, q), len };
  });
  const corners = mids.filter((m) => Math.abs(m.out[0]) > 0.2 && Math.abs(m.out[1]) > 0.2);
  let places = corners;
  if (count === 6) {
    const sides = mids.filter((m) => !(Math.abs(m.out[0]) > 0.2 && Math.abs(m.out[1]) > 0.2));
    const longest = Math.max(...sides.map((s) => s.len));
    places = [...corners, ...sides.filter((s) => s.len >= longest - 1e-6)];
  }
  const angle = (p: P2) => {
    const a = Math.atan2(p[0], p[1]);
    return a < 0 ? a + 2 * Math.PI : a;
  };
  return places.map(({ at, out }) => ({ at, out })).sort((a, b) => angle(a.at) - angle(b.at));
}

// --------------------------------------------------------------------- build

export async function buildPiece(tree: PieceTree, opts: { tol: number; applyShrinkage: boolean }): Promise<Built> {
  const k = await kernel();
  const A = new Arena();
  try {
    return buildWith(k, A, tree, opts);
  } finally {
    A.free();
  }
}

export function polygonsToMesh(m: Manifold): MeshOut {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const nv = mesh.vertProperties.length / np;
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    positions[i * 3] = mesh.vertProperties[i * np]!;
    positions[i * 3 + 1] = mesh.vertProperties[i * np + 1]!;
    positions[i * 3 + 2] = mesh.vertProperties[i * np + 2]!;
  }
  return { positions, triangles: new Uint32Array(mesh.triVerts) };
}

function buildWith(k: Kernel, A: Arena, tree: PieceTree, opts: { tol: number; applyShrinkage: boolean }): Built {
  const { Manifold, CrossSection } = k;
  const tol = opts.tol;
  const v = readPiece(tree);
  const rIn = v.innerDiameterMm / 2;
  const t = v.bandThicknessMm;
  const rOut = rIn + t;
  const w = v.bandWidthMm;

  // The band: its cross-section revolved around the finger.
  const profile = bandProfile(v.profile, rIn, t, w, tol);
  const nBand = segmentsFor(rOut, tol, 48);
  const band = A.t(A.t(Manifold.revolve(A.t(new CrossSection([profile])), nBand)).rotate([90, 0, 0]));
  const decl: FeatureDecl = { prongs: [], scale: 1 };
  const bandDecl: BandDecl = { innerRadius: rIn, outerRadius: rOut, halfWidth: w / 2 };
  decl.band = bandDecl;
  const layout: Built['layout'] = {};

  let metal: Manifold = band;
  let stoneSolid: Manifold | undefined;

  if (v.head) {
    const sv = v.head.stone;
    const spec: StoneSpec = { shape: sv.shape, lengthMm: sv.lengthMm, widthMm: sv.widthMm, depthMm: sv.depthMm, orientation: sv.orientation };
    const shape = stoneShape(spec, tol);
    const zGb = rOut + v.head.culetClearanceMm + shape.pavilion;
    const zGt = zGb + shape.girdle;
    const zTable = zGt + shape.crown;
    layout.girdleBottomZ = zGb;
    layout.crownMm = shape.crown;
    layout.tableZ = zTable;
    const stoneDecl: StoneDecl = { outline: shape.outline, girdleBottomZ: zGb, girdleTopZ: zGt, crownHeight: shape.crown };
    decl.stone = stoneDecl;
    stoneSolid = A.t(A.t(Manifold.hull(shape.points(0))).translate([0, 0, zGb]));
    const seatCut = A.t(A.t(Manifold.hull(shape.points(0.03))).translate([0, 0, zGb]));

    let head: Manifold;
    if (v.head.kind === 'prong_head') {
      const hv = v.head;
      const places = prongPlaces(spec, shape.outline, hv.prongCount);
      // The rail (gallery): a flat ring through the prongs' feet, wider and taller than a
      // prong so each foot sits wholly inside it, its middle on the band's surface where
      // it crosses the band. Built as one extruded ring, so no two shapes share a face.
      const railW = Math.max(hv.nominalProngMm, 1.2) + 0.3;
      const railH = Math.max(hv.nominalProngMm, 1.2) + 0.2;
      const railOff = hv.nominalProngMm / 2 - hv.gripMm;
      const girdleCs = A.t(new CrossSection([shape.outline]));
      const ringSeg = segmentsFor(Math.max(sv.lengthMm, sv.widthMm) / 2 + railOff + railW, tol, 48);
      const railOuter = A.t(girdleCs.offset(railOff + railW / 2, 'Round', 2, ringSeg));
      const railInner = A.t(girdleCs.offset(railOff - railW / 2, 'Round', 2, ringSeg));
      const railCs = A.t(railOuter.subtract(railInner));
      const railMid = A.t(girdleCs.offset(railOff, 'Round', 2, ringSeg)).toPolygons()[0] as P2[];
      const xCross = Math.max(...crossingsX(railMid, w / 2));
      const zRail = Math.sqrt(Math.max(0, rOut * rOut - xCross * xCross));
      const parts: Manifold[] = [A.t(A.t(Manifold.extrude(railCs, railH)).translate([0, 0, zRail - railH / 2]))];
      places.forEach((pl, i) => {
        const tk = hv.prongThicknessMm[i]!;
        const off = tk / 2 - hv.gripMm;
        const cx = pl.at[0] + pl.out[0] * off, cy = pl.at[1] + pl.out[1] * off;
        // One solid of revolution: a round column from inside the rail up to the table's
        // height, with a domed tip (Stuller: the dome's base flush with the table).
        const r = tk / 2;
        const colH = zTable - zRail;
        const arc = (u: number): Vec2 => [r * Math.cos(u), colH + r * Math.sin(u)];
        const prof: Vec2[] = [[0, 0], [r, 0], ...adaptive(arc, 0, Math.PI / 2, tol), [0, colH + r]];
        const col = A.t(Manifold.revolve(A.t(new CrossSection([dedupe(prof)])), segmentsFor(r, tol, 16)));
        parts.push(A.t(col.translate([cx, cy, zRail])));
        const prong: ProngDecl = {
          label: `prong ${i + 1} of ${hv.prongCount}`,
          clock: clockOf(cx, cy),
          axis: [cx, cy],
          nominalDiameter: tk,
          sectionFromZ: zRail + railH / 2 + 0.1,
          sectionToZ: zTable - 0.02,
        };
        decl.prongs.push(prong);
      });
      head = A.t(A.t(Manifold.union(parts)).subtract(seatCut));
    } else {
      const hv = v.head;
      const c = 0.05;
      const lip = hv.lipMm === 'auto' ? Math.round(0.6 * shape.crown * 100) / 100 : hv.lipMm;
      layout.lipMm = lip;
      const zTop = zGt + lip;
      const girdleCs = A.t(new CrossSection([shape.outline]));
      const seg = segmentsFor(c + hv.wallMm, tol, 32);
      const outerCs = A.t(girdleCs.offset(c + hv.wallMm, 'Round', 2, seg));
      const innerCs = A.t(girdleCs.offset(c, 'Round', 2, segmentsFor(Math.max(c, 0.05), tol, 16)));
      const ledge = Math.min(0.4, 0.25 * Math.min(sv.lengthMm, sv.widthMm));
      const holeCs = A.t(girdleCs.offset(-ledge, 'Round', 2, seg));
      const outerPts = outerCs.toPolygons()[0] as P2[];
      const xExt = Math.max(...crossingsX(outerPts, w / 2), 0);
      const zBottom = Math.sqrt(Math.max(0, rOut * rOut - xExt * xExt)) - 0.3;
      const tube = A.t(A.t(Manifold.extrude(outerCs, zTop - zBottom)).translate([0, 0, zBottom]));
      const lipHole = A.t(A.t(Manifold.extrude(innerCs, zTop - zGb + 1)).translate([0, 0, zGb]));
      const backHole = A.t(A.t(Manifold.extrude(holeCs, zGb - zBottom + 2)).translate([0, 0, zBottom - 1]));
      head = A.t(A.t(A.t(tube.subtract(lipHole)).subtract(backHole)).subtract(seatCut));
      const bezelDecl: BezelDecl = { outer: outerPts, zBottom, nominalWall: hv.wallMm };
      decl.bezel = bezelDecl;
    }
    // Trim the head clear of the finger hole, then join it to the band.
    const finger = A.t(A.t(A.t(Manifold.cylinder(w + 40, rIn + 0.02, rIn + 0.02, nBand, true)).rotate([90, 0, 0])));
    metal = A.t(A.t(head.subtract(finger)).add(band));
  }

  // Any operations the agent added beside the band and head, each declared by its id and
  // bounds, so the checker can name the added shape a thin place is in. A thickened sheet
  // among them also declares itself (its nominal thickness and middle surface).
  const sheets: SheetDecl[] = [];
  for (const extra of v.extras) {
    const shape = A.t(buildOp(k, A, extra as TreeNode, tol, { m: IDENTITY, sheets }));
    const bb = shape.boundingBox();
    (decl.added ??= []).push({ id: extra.id, min: [...bb.min] as Vec3, max: [...bb.max] as Vec3 });
    metal = A.t(metal.add(shape));
  }
  if (sheets.length) decl.sheets = sheets;

  const scale = opts.applyShrinkage ? 1 + v.shrinkagePct / 100 : 1;
  if (scale !== 1) {
    metal = A.t(metal.scale(scale));
    scaleDecl(decl, scale);
  }
  decl.scale = scale;
  const status = metal.status();
  if (status !== 'NoError') throw new Error(`the kernel reported ${status} while building the piece`);
  const bb = metal.boundingBox();
  return {
    view: v,
    metal: polygonsToMesh(metal),
    ...(stoneSolid ? { stone: polygonsToMesh(scale !== 1 ? A.t(stoneSolid.scale(scale)) : stoneSolid) } : {}),
    decl,
    volumeMm3: metal.volume(),
    bbox: { min: [...bb.min] as Vec3, max: [...bb.max] as Vec3 },
    layout,
  };
}

function circlePts(r: number, n: number, cx: number, cy: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Vec2;
  });
}

/** |x| where a closed polygon's edges cross the band's width (|y| <= halfWidth). */
function crossingsX(poly: P2[], halfWidth: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    for (const yy of [-halfWidth, 0, halfWidth]) {
      if ((a[1] - yy) * (b[1] - yy) <= 0 && a[1] !== b[1]) {
        const s = (yy - a[1]) / (b[1] - a[1]);
        xs.push(Math.abs(a[0] + s * (b[0] - a[0])));
      }
    }
    if (Math.abs(a[1]) <= halfWidth) xs.push(Math.abs(a[0]));
  }
  return xs.length ? xs : [0];
}

function scaleDecl(d: FeatureDecl, s: number): void {
  if (d.band) {
    d.band.innerRadius *= s;
    d.band.outerRadius *= s;
    d.band.halfWidth *= s;
  }
  for (const p of d.prongs) {
    p.axis = [p.axis[0] * s, p.axis[1] * s];
    p.nominalDiameter *= s;
    p.sectionFromZ *= s;
    p.sectionToZ *= s;
  }
  if (d.stone) {
    d.stone.outline = d.stone.outline.map(([x, y]) => [x * s, y * s]);
    d.stone.girdleBottomZ *= s;
    d.stone.girdleTopZ *= s;
    d.stone.crownHeight *= s;
  }
  if (d.bezel) {
    d.bezel.outer = d.bezel.outer.map(([x, y]) => [x * s, y * s]);
    d.bezel.zBottom *= s;
    d.bezel.nominalWall *= s;
  }
  for (const a of d.added ?? []) {
    a.min = [a.min[0] * s, a.min[1] * s, a.min[2] * s];
    a.max = [a.max[0] * s, a.max[1] * s, a.max[2] * s];
  }
  for (const sh of d.sheets ?? []) {
    sh.points = sh.points.map(([x, y, z]) => [x * s, y * s, z * s]);
    sh.nominalThickness *= s;
    sh.spacing *= s;
  }
}

export type { CrossSection };
