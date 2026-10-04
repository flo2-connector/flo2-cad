// THICKEN: a thin curved sheet, such as a cupped or curled petal or a leaf, given a
// stated thickness along its surface (req:the-tree-can-give-a-curved-sheet-a-thickness;
// dec:idea-thin-curved-sheet-forms-in-the-tree, option 1). Data, not code: an outline,
// a thickness and one of three simple surfaces, each with named parameters.
//
// THE FORM. The outline is the sheet laid flat, as it would be cut from sheet metal,
// in mm. It is laid on the surface the way a map is laid on a globe, from the origin:
//  · "flat": the XY plane;
//  · "sphere": a cup, tangent to the XY plane at the origin and rising equally every
//    way from it, its radius `radius`. Distances from the origin are kept along the
//    surface (a petal 9 mm long stays 9 mm long however deep the cup); widths across
//    narrow as the cup deepens, by sin θ / θ (96 % at 30° round the sphere, 84 % at
//    60°). The outline stays within a quarter of the way round (90°);
//  · "cylinder": a curl, tangent to the XY plane at the origin, its axis parallel to
//    `axis` ("x" or "y"); it rises across that axis and stays straight along it.
//    Lengths and widths are both kept (a cylinder is developable). The outline stays
//    within 150° of the origin round the cylinder.
// Both surfaces open UPWARD (+z), and the sheet's middle passes through the origin:
// half the thickness lies on each side. Turn or place it with rotate, translate and
// mirror. A curved sheet curves no tighter than 5 times its thickness (radius >= 5 t).
// That is the casting checker's limit, not the geometry's: the wall check grows its
// ball from a point on the rim straight along the rim's normal, and on a more tightly
// curved sheet it meets the sheet's own outer face, curving back, within a millimetre,
// so it reads the rim thinner than it is. Measured on sheets 0.8, 1.0 and 1.5 mm thick:
// at 5 t and above it reads 99.8 % of the thickness on a sphere and a cylinder alike;
// at 4 t, 84-94 % on a sphere; at 3 t, 62-70 %.
//
// WHY IT IS ONE CLEAN SOLID. Every point moves along the surface's NORMAL, never in z
// alone: a point (x, y) of the outline at height z in the flat slab goes to the
// surface point under (x, y), moved by z along the normal there. The two faces are
// therefore exact offsets of each other, the thickness is the same everywhere, and
// the rim is made of normals: square to the surface, with no knife edge. A z-only
// warp, tried outside the engine, thinned the sheet where it sloped and made knife
// edges and self-intersections (dec:idea-thin-curved-sheet-forms-in-the-tree). The
// mapping is one-to-one while the inside radius stays positive (radius >= 5 t keeps
// it at 4.5 t) and the outline stays within the limits above, so the result never
// meets itself.
//
// HOW IT IS MESHED. A flat slab whose faces are a regular grid of right triangles is
// mapped onto the surface FIRST, and then cut to the outline by the mapped prism of
// the outline (a boolean in curved space). Cutting in the flat domain first does not
// work: there the vertices along a straight edge of the outline are redundant, the
// kernel collapses them, and the long edges left behind stand up to 0.013 mm off a
// 4 mm sphere once mapped (measured), over the 0.01 mm surface limit. Cut after
// mapping, every face triangle is a piece of one grid triangle, so it stands off the
// surface no further than that triangle does, and the grid spacing bounds that
// (gridSpacing, below).
//
// The prism's walls become the rim: each wall quad joins two normals of the surface,
// so the rim is made of normals. On a cylinder two such normals are skew lines, and
// the quad's two triangles lean from them by up to about a third of the angle between
// them, so the outline is first divided into pieces no longer than 0.25 mm or 5 % of
// the radius: the rim then leans less than 1° from the normal anywhere. (On a sphere
// every normal meets the centre, and the rim does not lean.)
//
// WHAT IT DECLARES. Each thicken node declares a SHEET to the checker: its node id,
// its nominal thickness, and points on its middle surface with their normals, in the
// piece's coordinates. The checker measures the thickness of the written file square
// to the surface at those points and holds it to the wall minimum, and names the node
// in what to thicken (checker/features.ts SheetDecl).

import { CallError } from '../errors.js';
import type { SheetDecl, P3 } from '../checker/features.js';
import { segmentsFor, type Kernel, type Manifold, type Vec2, type Vec3 } from '../kernel/manifold.js';
import type { TreeNode } from '../piece/tree.js';
import { lengthMm } from '../units.js';
import type { Arena } from './build.js';

export const SURFACES = ['flat', 'sphere', 'cylinder'] as const;
export type Surface = (typeof SURFACES)[number];
export const SHEET_AXES = ['x', 'y'] as const;

/** How far round the surface the outline may reach from the origin. */
export const SPHERE_MAX_DEG = 90;
export const CYLINDER_MAX_DEG = 150;
/** What the library builds; the casting limit (the wall minimum) is the checker's. */
export const THICKNESS_RANGE_MM = [0.1, 5] as const;
/** The tightest curve, as a multiple of the thickness (see THE FORM, above). */
export const MIN_RADIUS_PER_THICKNESS = 5;
export const RADIUS_MAX_MM = 1000;
export const ROUND_CORNERS_MAX_MM = 5;

// ------------------------------------------------------------------ affine maps

/** A 3 × 4 affine map, row-major: [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz]. */
export type Affine = readonly number[];

export const IDENTITY: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** a ∘ b: apply b first, then a. */
export function compose(a: Affine, b: Affine): Affine {
  const o: number[] = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let s = c === 3 ? a[r * 4 + 3]! : 0;
      for (let k = 0; k < 3; k++) s += a[r * 4 + k]! * b[k * 4 + c]!;
      o[r * 4 + c] = s;
    }
  }
  return o;
}

export const translation = (x: number, y: number, z: number): Affine => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];

/** The kernel's rotate([x, y, z]): about X first, then Y, then Z, in degrees. */
export function rotation(xd: number, yd: number, zd: number): Affine {
  const rad = Math.PI / 180;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(xd * rad), Math.sin(xd * rad), Math.cos(yd * rad), Math.sin(yd * rad), Math.cos(zd * rad), Math.sin(zd * rad)];
  const rx: Affine = [1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0];
  const ry: Affine = [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0];
  const rz: Affine = [cz, -sz, 0, 0, sz, cz, 0, 0, 0, 0, 1, 0];
  return compose(rz, compose(ry, rx));
}

/** The kernel's mirror(normal): a reflection through the plane with that unit normal. */
export function reflection(n: Vec3): Affine {
  const [a, b, c] = n;
  return [1 - 2 * a * a, -2 * a * b, -2 * a * c, 0, -2 * a * b, 1 - 2 * b * b, -2 * b * c, 0, -2 * a * c, -2 * b * c, 1 - 2 * c * c, 0];
}

const applyPoint = (m: Affine, p: P3): P3 => [
  m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!,
  m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!,
  m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!,
];

function applyDirection(m: Affine, d: P3): P3 {
  const v: P3 = [m[0]! * d[0] + m[1]! * d[1] + m[2]! * d[2], m[4]! * d[0] + m[5]! * d[1] + m[6]! * d[2], m[8]! * d[0] + m[9]! * d[1] + m[10]! * d[2]];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Where a node is being built: the map from its own frame to the piece's, and where sheets declare themselves (absent inside a cutter). */
export interface OpContext {
  m: Affine;
  sheets?: SheetDecl[];
}

// ------------------------------------------------------------------- the surface

export interface SheetSpec {
  outline: Vec2[];
  thickness: number;
  surface: Surface;
  /** The radius of the sphere or cylinder the sheet's middle lies on (Infinity when flat). */
  radius: number;
  axis: 'x' | 'y';
  roundCorners: number;
}

/** Reads a validated thicken node's settings. */
export function sheetSpec(n: TreeNode): SheetSpec {
  const p = (n.params ?? {}) as Record<string, unknown>;
  const surface = (p['surface'] as Surface | undefined) ?? 'flat';
  return {
    outline: (p['outline'] as unknown[][]).map((pt) => [lengthMm(pt[0], 'x'), lengthMm(pt[1], 'y')] as Vec2),
    thickness: lengthMm(p['thickness'], 'thickness'),
    surface,
    radius: surface === 'flat' ? Infinity : lengthMm(p['radius'], 'radius'),
    axis: (p['axis'] as 'x' | 'y' | undefined) ?? 'x',
    roundCorners: p['round_corners'] === undefined ? 0 : lengthMm(p['round_corners'], 'round_corners'),
  };
}

/**
 * The map from the flat slab to the sheet: (x, y) on the outline, z across the
 * thickness (0 on the middle surface), to the point z along the surface's normal from
 * the surface point under (x, y). Also returns that normal.
 */
export function surfaceMap(s: Pick<SheetSpec, 'surface' | 'radius' | 'axis'>): (x: number, y: number, z: number) => { p: P3; n: P3 } {
  const R = s.radius;
  if (s.surface === 'sphere') {
    return (x, y, z) => {
      const rho = Math.hypot(x, y);
      const th = rho / R;
      const c = rho > 1e-12 ? x / rho : 1, sn = rho > 1e-12 ? y / rho : 0;
      // u: from the sphere's centre (0, 0, R) out through the surface point.
      const u: P3 = [Math.sin(th) * c, Math.sin(th) * sn, -Math.cos(th)];
      const r = R - z;
      return { p: [r * u[0], r * u[1], R + r * u[2]], n: [-u[0], -u[1], -u[2]] };
    };
  }
  if (s.surface === 'cylinder') {
    const alongX = s.axis === 'x';
    return (x, y, z) => {
      const across = alongX ? y : x;
      const th = across / R;
      const r = R - z;
      const a = r * Math.sin(th);
      const p: P3 = alongX ? [x, a, R - r * Math.cos(th)] : [a, y, R - r * Math.cos(th)];
      const n: P3 = alongX ? [0, -Math.sin(th), Math.cos(th)] : [-Math.sin(th), 0, Math.cos(th)];
      return { p, n };
    };
  }
  return (x, y, z) => ({ p: [x, y, z], n: [0, 0, 1] });
}

/** How far round the surface (in degrees) the outline reaches from the origin, for the limits above. */
export function reachDeg(outline: readonly Vec2[], s: Pick<SheetSpec, 'surface' | 'radius' | 'axis'>): number {
  if (s.surface === 'flat') return 0;
  let far = 0;
  for (const [x, y] of outline) far = Math.max(far, s.surface === 'sphere' ? Math.hypot(x, y) : Math.abs(s.axis === 'x' ? y : x));
  return (far / s.radius) * (180 / Math.PI);
}

/** Twice the signed area of a closed polygon (positive when counter-clockwise). */
export function signedArea2(pts: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

// ------------------------------------------------------------------- the build

/** A closed box from x0..x1 × y0..y1 × zb..zt whose top and bottom are a regular grid of right triangles with legs at most h. */
function gridSlab(k: Kernel, x0: number, x1: number, y0: number, y1: number, h: number, zb: number, zt: number): Manifold {
  const nx = Math.max(1, Math.ceil((x1 - x0) / h)), ny = Math.max(1, Math.ceil((y1 - y0) / h));
  const layer = (nx + 1) * (ny + 1);
  const vert = new Float32Array(layer * 2 * 3);
  for (let top = 0; top < 2; top++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const v = (top * layer + j * (nx + 1) + i) * 3;
        vert[v] = x0 + ((x1 - x0) * i) / nx;
        vert[v + 1] = y0 + ((y1 - y0) * j) / ny;
        vert[v + 2] = top ? zt : zb;
      }
    }
  }
  const id = (i: number, j: number, top: number) => top * layer + j * (nx + 1) + i;
  const tri: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = id(i, j, 1), b = id(i + 1, j, 1), c = id(i + 1, j + 1, 1), d = id(i, j + 1, 1);
      tri.push(a, b, c, a, c, d);
      const A = id(i, j, 0), B = id(i + 1, j, 0), C = id(i + 1, j + 1, 0), D = id(i, j + 1, 0);
      tri.push(A, C, B, A, D, C);
    }
  }
  // The four sides, each a strip of quads, wound outward.
  const side = (p: number, q: number) => tri.push(p, q, q + layer, p, q + layer, p + layer);
  for (let i = 0; i < nx; i++) side(id(i, 0, 0), id(i + 1, 0, 0));
  for (let j = 0; j < ny; j++) side(id(nx, j, 0), id(nx, j + 1, 0));
  for (let i = nx; i > 0; i--) side(id(i, ny, 0), id(i - 1, ny, 0));
  for (let j = ny; j > 0; j--) side(id(0, j, 0), id(0, j - 1, 0));
  return new k.Manifold(new k.Mesh({ numProp: 3, vertProperties: vert, triVerts: Uint32Array.from(tri) }));
}

/**
 * The grid spacing h. Mapped, a grid triangle's legs are at most h · r_out / R long on
 * the outer face (radius r_out = R + t/2, the most stretched), and each leg's chord
 * stands off its curve by leg² / (8 r_out). Each direction is held to 0.9 × tol, the
 * library's per-direction convention (EXPORT_TOL: a doubly curved facet adds both
 * directions), so a facet stands off by at most 1.8 × tol: 0.0081 mm in a casting
 * file, inside the 0.01 mm limit.
 */
export function gridSpacing(s: Pick<SheetSpec, 'radius' | 'thickness'>, tol: number): number {
  const rOut = s.radius + s.thickness / 2;
  return Math.min(1, s.radius * Math.sqrt((8 * 0.9 * tol) / rOut));
}

/** Each contour divided into pieces no longer than `step` (the kernel keeps the points it is given). */
function divide(polys: Vec2[][], step: number): Vec2[][] {
  return polys.map((poly) => {
    const out: Vec2[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let j = 0; j < pieces; j++) out.push([a[0] + ((b[0] - a[0]) * j) / pieces, a[1] + ((b[1] - a[1]) * j) / pieces]);
    }
    return out;
  });
}

export function buildThicken(k: Kernel, A: Arena, n: TreeNode, tol: number, ctx?: OpContext): Manifold {
  const { Manifold, CrossSection } = k;
  const s = sheetSpec(n);
  const t = s.thickness;
  let cs = A.t(new CrossSection([signedArea2(s.outline) < 0 ? [...s.outline].reverse() : s.outline]));
  if (s.roundCorners > 0) {
    // Opening, then closing: every convex corner and every notch rounded to the radius,
    // so no part of the outline is narrower than twice it.
    const rc = s.roundCorners;
    const seg = segmentsFor(rc, tol, 16);
    cs = A.t(A.t(A.t(A.t(cs.offset(-rc, 'Round', 2, seg)).offset(rc, 'Round', 2, seg)).offset(rc, 'Round', 2, seg)).offset(-rc, 'Round', 2, seg));
  }
  if (cs.isEmpty()) {
    throw new CallError(`${n.id}.params.round_corners`, `rounding the corners by ${s.roundCorners} mm leaves nothing of the outline: no part of it is ${2 * s.roundCorners} mm across. Use a smaller round_corners or a wider outline.`);
  }
  if (s.surface !== 'flat') cs = A.t(new CrossSection(divide(cs.toPolygons() as Vec2[][], Math.min(0.25, 0.05 * s.radius))));
  let solid: Manifold;
  if (s.surface === 'flat') {
    solid = A.t(A.t(Manifold.extrude(cs, t)).translate([0, 0, -t / 2]));
  } else {
    const map = surfaceMap(s);
    const warp = (v: Float64Array, count: number) => {
      for (let i = 0; i < count; i++) {
        const q = map(v[i * 3]!, v[i * 3 + 1]!, v[i * 3 + 2]!).p;
        v[i * 3] = q[0];
        v[i * 3 + 1] = q[1];
        v[i * 3 + 2] = q[2];
      }
    };
    const h = gridSpacing(s, tol);
    const bb = cs.bounds();
    // The grid's lines are offset by odd fractions of h, so none runs along a straight edge of the outline.
    const slab = A.t(A.t(gridSlab(k, bb.min[0] - 1.31 * h, bb.max[0] + 1.27 * h, bb.min[1] - 1.19 * h, bb.max[1] + 1.43 * h, h, -t / 2, t / 2)).warpBatch(warp));
    // The cutter reaches m past each face. Its own faces lie outside the sheet, and are
    // refined only enough that, mapped, their chords sag less than m / 2 towards it.
    const m = Math.min(0.3, (s.radius - t / 2) / 2);
    const rOut = s.radius + t / 2 + m;
    const lc = Math.min(1, s.radius * Math.sqrt(m / rOut));
    const prism = A.t(A.t(A.t(A.t(Manifold.extrude(cs, t + 2 * m)).translate([0, 0, -(t / 2 + m)])).refineToLength(lc)).warpBatch(warp));
    solid = A.t(slab.intersect(prism));
  }
  if (ctx?.sheets) ctx.sheets.push(declareSheet(n.id, s, cs.toPolygons() as Vec2[][], ctx.m));
  return solid;
}

// ---------------------------------------------------------------- the declaration

/** Even-odd inside test over every contour (holes included). */
function insideContours(polys: Vec2[][], x: number, y: number): boolean {
  let c = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!, b = poly[j]!;
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
  }
  return c;
}

/** How far (x, y) lies from the nearest edge of any contour. */
function distanceToEdges(polys: Vec2[][], x: number, y: number): number {
  let best = Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      const u = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - a[0] - u * dx, y - a[1] - u * dy));
    }
  }
  return best;
}

/** Points along each contour, at most `step` apart, each moved `inset` inwards (towards its own left, the inside of a counter-clockwise contour). */
function insetBoundary(polys: Vec2[][], step: number, inset: number): Vec2[] {
  const out: Vec2[] = [];
  for (const poly of polys) {
    const ccw = signedArea2(poly) > 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy);
      if (l < 1e-9) continue;
      // The inside of an outer (counter-clockwise) contour is on its left; a hole's is on its right.
      const nx = ((ccw ? -dy : dy) / l) * inset, ny = ((ccw ? dx : -dx) / l) * inset;
      const pieces = Math.max(1, Math.ceil(l / step));
      for (let s = 0; s < pieces; s++) {
        const x = a[0] + (dx * (s + 0.5)) / pieces + nx, y = a[1] + (dy * (s + 0.5)) / pieces + ny;
        if (insideContours(polys, x, y)) out.push([x, y]);
      }
    }
  }
  return out;
}

/**
 * The sheet as the checker is told it: points on its middle surface (a grid over the
 * outline, and a row just inside its edge, so the edges are measured too) with the
 * surface's normal at each, in the piece's coordinates.
 */
function declareSheet(label: string, s: SheetSpec, polys: Vec2[][], m: Affine): SheetDecl {
  let area = 0;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const poly of polys) {
    area += signedArea2(poly) / 2;
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  // About 300 interior points, never closer than 0.25 mm nor further apart than 1 mm.
  const spacing = Math.min(1, Math.max(0.25, Math.sqrt(Math.abs(area) / 300)));
  // Every point at least `inset` inside the edge: a ray along the normal from nearer the
  // rim could graze it.
  const inset = Math.min(0.05, s.thickness / 4);
  const flat: Vec2[] = [];
  for (let y = y0 + spacing / 2; y < y1; y += spacing) {
    for (let x = x0 + spacing / 2; x < x1; x += spacing) if (insideContours(polys, x, y) && distanceToEdges(polys, x, y) >= inset) flat.push([x, y]);
  }
  flat.push(...insetBoundary(polys, spacing / 2, inset));
  const map = surfaceMap(s);
  const points: P3[] = [], normals: P3[] = [];
  for (const [x, y] of flat) {
    const q = map(x, y, 0);
    points.push(applyPoint(m, q.p));
    normals.push(applyDirection(m, q.n));
  }
  return { label, nominalThickness: s.thickness, spacing, points, normals };
}
