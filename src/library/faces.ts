// WHICH NAMED PART EACH FACE CAME FROM (ifc:solid-mesh: "each face tagged by the part feature it
// came from"; the checker's side is FacesDecl in checker/features.ts).
//
// The kernel keeps, for every triangle of a solid, the ORIGINAL solid it came from: each
// primitive, extrusion, revolution and level set is an original with its own id, and every
// union, cut and move carries its faces' ids along (a cut's faces carry the cutter's). So a part
// is named by the ids of the originals its faces come from:
//   · a part of the library's (the band, a prong head's rail and each prong, a bezel, the stone's
//     seat) names the originals it is built from as it is built (`own`): each is a primitive,
//     extrusion, revolution or hull made for that part alone, so its faces are its alone. The
//     solid is not made an original again (the kernel's asOriginal), because that also merges
//     its coplanar faces and so changes the casting file: measured, a cabochon's bezel lost 8 of
//     its 9098 triangles;
//   · a shape a tree adds beside the band and head, or a program's .named("...") shape, CLAIMS
//     every id in it that no part has yet (`claim`): what it holds that is already named (a band,
//     a shape named inside it) keeps its own name, the innermost. Its ids are claimed, never
//     replaced, because a smooth blend's points are found by its level set's id (build.ts,
//     blendSurface).
// A face whose id no part holds came from no named part (a program's unnamed shape), and the
// checker says so rather than guess. An id two separate shapes claim (one handle used in two
// named shapes) cannot tell them apart, so its faces are said to be in no named part too.

import { NO_PART, type FacesDecl, type PartDecl } from '../checker/features.js';
import type { Manifold, Mesh } from '../kernel/manifold.js';

/** One part may be named this many times over; past that, a face is in no named part. */
const MAX_PARTS = NO_PART - 1;

export class FaceNames {
  readonly #parts: PartDecl[] = [];
  /** The kernel's original id, to the part its faces are named by, or -1 when two shapes claimed it. */
  readonly #byId = new Map<number, number>();

  #index(part: PartDecl): number {
    const i = this.#parts.findIndex((p) => p.name === part.name && p.kind === part.kind && !!p.cut === !!part.cut);
    if (i >= 0) return i;
    if (this.#parts.length >= MAX_PARTS) return -1;
    this.#parts.push({ name: part.name, kind: part.kind, ...(part.cut ? { cut: true } : {}) });
    return this.#parts.length - 1;
  }

  /** A part of the library's, just built from originals of its own: every face of `m` is named `part`. */
  own(m: Manifold, part: PartDecl): void {
    const i = this.#index(part);
    for (const id of new Set(m.getMesh().runOriginalID)) this.#byId.set(id, i);
  }

  /**
   * Names every face of `m` that no part has named yet `part`: a shape the tree adds, or a
   * program's .named("...") shape. `inner` are the names of the shapes named inside `m`, which
   * keep their own; a face already claimed by any other shape is one handle in two named shapes,
   * and is left in no named part.
   */
  claim(m: Manifold, part: PartDecl, inner: ReadonlySet<string> = new Set()): void {
    const i = this.#index(part);
    for (const id of new Set(m.getMesh().runOriginalID)) {
      const had = this.#byId.get(id);
      if (had === undefined) this.#byId.set(id, i);
      else if (had >= 0 && had !== i) {
        const p = this.#parts[had]!;
        if (p.kind === 'shape' && !inner.has(p.name)) this.#byId.set(id, -1);
      }
    }
  }

  /** The part of each triangle of a finished solid's mesh, in its order: the casting file's. */
  faces(mesh: Mesh): FacesDecl {
    const of = new Uint16Array(mesh.triVerts.length / 3).fill(NO_PART);
    for (let r = 0; r < mesh.runOriginalID.length; r++) {
      const i = this.#byId.get(mesh.runOriginalID[r]!);
      if (i === undefined || i < 0) continue;
      of.fill(i, mesh.runIndex[r]! / 3, mesh.runIndex[r + 1]! / 3);
    }
    return { parts: this.#parts.map((p) => ({ ...p })), of };
  }
}
