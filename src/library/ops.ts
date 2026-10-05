// The tree's general operations (dec:how-a-piece-is-described: "a structured tree
// of operations and jewelry parts, as data"; req:the-tree-has-sweeps-and-smooth-blends):
// primitives, booleans, transforms, extrude, revolve, a SWEEP of a round wire along
// a path, a SMOOTH BLEND (smooth_union) evaluated as a level set of distance
// functions (Manifold's levelSet; the field and how it is read are in field.ts),
// and THICKEN, a curved sheet given a thickness (thicken.ts). Every one evaluates
// to a closed solid; the kernel guarantees manifold output.
//
// Each call carries where its node sits in the piece (an OpContext: the transforms
// above it), so a sheet can declare itself to the checker in the piece's
// coordinates, and a blend can declare points on its own surface. A shape that is
// cut AWAY (a difference's second child onwards) declares no sheet; a blend there
// still declares its surface, which is the piece's surface where it cuts.

import { segmentsFor, sphereSegments, type Kernel, type Manifold, type Vec2, type Vec3 } from '../kernel/manifold.js';
import { CallError } from '../errors.js';
import type { TreeNode } from '../piece/tree.js';
import { angleDeg, lengthMm } from '../units.js';
import type { Arena } from './build.js';
import { BlendField, holdToSurface, levelSetStep } from './field.js';
import { EXPORT_TOL } from './tolerances.js';
import { buildThicken, compose, IDENTITY, reflection, rotation, translation, type OpContext } from './thicken.js';

type Params = Record<string, unknown>;

const L = (p: Params, k: string, dflt = 0): number => (p[k] === undefined ? dflt : lengthMm(p[k], k));
const D = (p: Params, k: string, dflt = 0): number => (p[k] === undefined ? dflt : angleDeg(p[k], k));
const pts2 = (v: unknown): Vec2[] => (v as unknown[][]).map((pt) => [lengthMm(pt[0], 'x'), lengthMm(pt[1], 'y')] as Vec2);
const pts3 = (v: unknown): Vec3[] => (v as unknown[][]).map((pt) => [lengthMm(pt[0], 'x'), lengthMm(pt[1], 'y'), lengthMm(pt[2], 'z')] as Vec3);

function ccw(pts: Vec2[]): Vec2[] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? [...pts].reverse() : pts;
}

const MIRROR_NORMAL: Readonly<Record<string, Vec3>> = { xy: [0, 0, 1], yz: [1, 0, 0], xz: [0, 1, 0] };

export function buildOp(k: Kernel, A: Arena, n: TreeNode, tol: number, ctx: OpContext = { m: IDENTITY }): Manifold {
  const { Manifold, CrossSection } = k;
  const p = (n.params ?? {}) as Params;
  // A transform's children sit in its own frame; everything else passes the frame on.
  const inner: OpContext =
    n.op === 'translate'
      ? { ...ctx, m: compose(ctx.m, translation(L(p, 'x'), L(p, 'y'), L(p, 'z'))) }
      : n.op === 'rotate'
        ? { ...ctx, m: compose(ctx.m, rotation(D(p, 'x'), D(p, 'y'), D(p, 'z'))) }
        : n.op === 'mirror'
          ? { ...ctx, m: compose(ctx.m, reflection(MIRROR_NORMAL[p['plane'] as string]!)) }
          : ctx;
  const kids = () => (n.children ?? []).map((ch) => buildOp(k, A, ch, tol, inner));
  const all = (): Manifold => {
    const ms = kids();
    return ms.length === 1 ? ms[0]! : A.t(Manifold.union(ms));
  };
  switch (n.op) {
    case 'sphere': {
      const r = L(p, 'radius');
      return A.t(Manifold.sphere(r, sphereSegments(r, tol)));
    }
    case 'cylinder': {
      const r = L(p, 'radius');
      return A.t(Manifold.cylinder(L(p, 'height'), r, r, segmentsFor(r, tol, 16)));
    }
    case 'box':
      return A.t(Manifold.cube([L(p, 'x'), L(p, 'y'), L(p, 'z')], true));
    case 'torus': {
      const R = L(p, 'major_radius'), r = L(p, 'minor_radius');
      if (r >= R) throw new CallError(`${n.id}.params.minor_radius`, 'must be smaller than major_radius.');
      const n2 = segmentsFor(r, tol, 16);
      const ring = Array.from({ length: n2 }, (_, i) => [R + r * Math.cos((2 * Math.PI * i) / n2), r * Math.sin((2 * Math.PI * i) / n2)] as Vec2);
      return A.t(Manifold.revolve(A.t(new CrossSection([ring])), segmentsFor(R + r, tol, 32)));
    }
    case 'extrude':
      return A.t(Manifold.extrude(A.t(new CrossSection([ccw(pts2(p['points']))])), L(p, 'height')));
    case 'revolve': {
      const prof = ccw(pts2(p['points']));
      const rMax = Math.max(...prof.map((q) => q[0]));
      return A.t(Manifold.revolve(A.t(new CrossSection([prof])), segmentsFor(rMax, tol, 32), D(p, 'degrees', 360)));
    }
    case 'sweep': {
      const r = L(p, 'radius');
      const path = pts3(p['path']);
      const seg = sphereSegments(r, tol);
      // Each segment's end balls are turned a different amount, so where two segments
      // meet their spheres cross instead of coinciding face for face.
      const ball = (q: Vec3, i: number) => A.t(A.t(A.t(Manifold.sphere(r, seg)).rotate([0, 0, 7.31 * i + 3.7])).translate(q));
      const pieces: Manifold[] = [];
      const m = p['closed'] === true ? path.length : path.length - 1;
      for (let i = 0; i < m; i++) pieces.push(A.t(Manifold.hull([ball(path[i]!, i), ball(path[(i + 1) % path.length]!, i)])));
      return pieces.length === 1 ? pieces[0]! : A.t(Manifold.union(pieces));
    }
    case 'union':
      return all();
    case 'difference': {
      const [first, ...rest] = n.children ?? [];
      const keep = buildOp(k, A, first!, tol, inner);
      if (!rest.length) return keep;
      // What is cut away is not metal, so a sheet inside it declares nothing; a blend's
      // surface cut into the piece is the piece's surface, so it still declares itself.
      const cutters = rest.map((ch) => buildOp(k, A, ch, tol, { m: inner.m, ...(inner.blends ? { blends: inner.blends } : {}), ...(inner.blendMeshes ? { blendMeshes: inner.blendMeshes } : {}), ...(inner.moveReachMm ? { moveReachMm: inner.moveReachMm } : {}) }));
      return A.t(keep.subtract(A.t(Manifold.union(cutters))));
    }
    case 'intersection': {
      const ms = kids();
      return ms.length === 1 ? ms[0]! : A.t(Manifold.intersection(ms));
    }
    case 'translate':
      return A.t(all().translate([L(p, 'x'), L(p, 'y'), L(p, 'z')]));
    case 'rotate':
      return A.t(all().rotate([D(p, 'x'), D(p, 'y'), D(p, 'z')]));
    case 'mirror':
      return A.t(all().mirror(MIRROR_NORMAL[p['plane'] as string]!));
    case 'smooth_union':
      return smoothUnion(k, A, n, tol, ctx);
    case 'thicken':
      return buildThicken(k, A, n, tol, ctx);
  }
  throw new CallError(`${n.id}.op`, `"${String(n.op ?? n.part)}" cannot be used here.`);
}

// ------------------------------------------------------------- smooth blend

/**
 * A smooth blend: the level set of its distance field (field.ts), on a grid set by the
 * casting tolerance, then held to the field's surface: every facet that stands off it by
 * more than the tolerance (across a crease of the field, or sagging on a tight fillet) is
 * split, its new corners on the surface, until none does (field.ts, holdToSurface;
 * fact:a-blends-level-set-chamfers-the-creases-of-its-own-field-2026-10-05). A finer
 * tolerance (the surface check's reference build) does NOT make the grid finer: the
 * blend's facets are already held to its surface, and the check measures how far the
 * true surface stands off them from points it declares on that surface over every
 * facet the file has from the blend (build.ts, blendSurface). A second level set 1.7
 * times finer had cost 5 times the samples and, by Manifold's own sizing, 687 MiB of
 * grid for one openwork ring: more than flo2's whole slot
 * (fact:check-time-is-the-blend-field-and-the-wall-ball).
 */
function smoothUnion(k: Kernel, A: Arena, n: TreeNode, tol: number, ctx: OpContext): Manifold {
  const { Manifold } = k;
  const p = (n.params ?? {}) as Params;
  const blend = L(p, 'radius');
  const gtol = Math.max(tol, EXPORT_TOL);
  // The reference build takes the export build's level set (the same grid's) as kept.
  const key = `${gtol} ${JSON.stringify(n)}`;
  const kept = ctx.blendMeshes?.reuse ? ctx.blendMeshes.meshes.get(key) : undefined;
  if (kept) return A.t(new Manifold(kept));
  // The plain union's bounding box, grown by the blend, bounds the blended solid.
  const plain = A.t(Manifold.union((n.children ?? []).map((c) => buildOp(k, A, c, Math.max(tol, 0.05)))));
  const bb = plain.boundingBox();
  const g = blend + 0.3;
  const edge = Math.min(0.25, Math.max(0.03, Math.sqrt(8 * Math.max(blend, 0.2) * gtol)));
  const min: Vec3 = [bb.min[0] - g, bb.min[1] - g, bb.min[2] - g];
  const max: Vec3 = [bb.max[0] + g, bb.max[1] + g, bb.max[2] + g];
  const field = new BlendField(n, { min, max }, levelSetStep(min, max, edge));
  const raw = Manifold.levelSet((q: Vec3) => -field.sample(q[0], q[1], q[2]), { min, max }, edge, 0, gtol / 2);
  const out = A.t(heldToSurface(k, raw, field, gtol));
  if (ctx.blendMeshes && !ctx.blendMeshes.reuse) ctx.blendMeshes.meshes.set(key, out.getMesh());
  ctx.blends?.push({ label: n.id, originalID: out.originalID(), m: ctx.m, field });
  return out;
}

/**
 * The level set with every facet held within `tol` of the blend's own surface (field.ts,
 * holdToSurface). It takes `raw` and returns a solid the caller owns; the kernel's copies made
 * on the way are freed at once, so the slot's memory holds one blend at a time.
 */
function heldToSurface(k: Kernel, raw: Manifold, field: BlendField, tol: number): Manifold {
  const mesh = raw.getMesh();
  const held = holdToSurface(mesh.vertProperties, mesh.numProp, mesh.triVerts, (x, y, z) => field.value(x, y, z), tol);
  if (!held) return raw;
  const rawTolerance = raw.tolerance();
  raw.delete();
  const made = new k.Manifold(new k.Mesh({ numProp: 3, vertProperties: held.positions, triVerts: held.triVerts }));
  // Every split is matched on both sides of its edge, so this cannot happen unless the refinement is wrong.
  if (made.status() !== 'NoError') {
    const status = made.status();
    made.delete();
    throw new Error(`engine bug: a smooth blend held to its surface is not a closed solid (${status})`);
  }
  // A solid made from a mesh is no original of its own, so build.ts (blendSurface) could not
  // find the blend's facets by its id; and it takes its float32 corners' tolerance (1.4e-6 mm
  // on the moonstone's rails), at which the casting file's simplify (build.ts,
  // atFilePrecision) would collapse 800 triangles the level set's own tolerance keeps.
  const original = made.asOriginal();
  made.delete();
  const out = original.setTolerance(rawTolerance);
  original.delete();
  return out;
}
