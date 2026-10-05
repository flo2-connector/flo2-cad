// A bounding-volume hierarchy over the read-back mesh's triangles, for the
// distance and ray queries the thickness, gap and self-intersection checks make.

import { rayTri, type V3 } from './geom.js';

/**
 * Where on a triangle its nearest point lies (Bvh.nearestOn): inside the face, at one of
 * its corners (CORNER + k, k = 0, 1, 2 in the triangle's own order), or on one of its
 * edges (EDGE + k, the edge from corner k to corner k + 1, mod 3).
 */
export const IN_FACE = 0;
export const CORNER = 1;
export const EDGE = 4;

export class Bvh {
  readonly pos: Float64Array;
  readonly tri: Uint32Array;
  readonly n: number;
  /** Per triangle: unit normal and centroid. */
  readonly normal: Float64Array;
  readonly centroid: Float64Array;
  readonly area: Float64Array;
  // Flat nodes: bbox (6), left/first, right/count, leaf flag.
  #bmin: Float64Array;
  #bmax: Float64Array;
  #left: Int32Array;
  #right: Int32Array;
  #first: Int32Array;
  #count: Int32Array;
  #order: Uint32Array;
  #nodes = 0;
  #triMin: Float64Array;
  #triMax: Float64Array;
  /** Scratch for the nearest point found by distSq and anyWithin. */
  #q = new Float64Array(3);

  constructor(pos: Float64Array, tri: Uint32Array) {
    this.pos = pos;
    this.tri = tri;
    this.n = tri.length / 3;
    const n = this.n;
    this.normal = new Float64Array(n * 3);
    this.centroid = new Float64Array(n * 3);
    this.area = new Float64Array(n);
    this.#triMin = new Float64Array(n * 3);
    this.#triMax = new Float64Array(n * 3);
    for (let t = 0; t < n; t++) {
      const a = tri[t * 3]! * 3, b = tri[t * 3 + 1]! * 3, c = tri[t * 3 + 2]! * 3;
      const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
      const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      this.area[t] = l / 2;
      this.normal[t * 3] = l ? nx / l : 0;
      this.normal[t * 3 + 1] = l ? ny / l : 0;
      this.normal[t * 3 + 2] = l ? nz / l : 0;
      for (let k = 0; k < 3; k++) {
        const pa = pos[a + k]!, pb = pos[b + k]!, pc = pos[c + k]!;
        this.centroid[t * 3 + k] = (pa + pb + pc) / 3;
        this.#triMin[t * 3 + k] = Math.min(pa, pb, pc);
        this.#triMax[t * 3 + k] = Math.max(pa, pb, pc);
      }
    }
    const cap = Math.max(1, 2 * n);
    this.#bmin = new Float64Array(cap * 3);
    this.#bmax = new Float64Array(cap * 3);
    this.#left = new Int32Array(cap);
    this.#right = new Int32Array(cap);
    this.#first = new Int32Array(cap);
    this.#count = new Int32Array(cap);
    this.#order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.#order[i] = i;
    if (n > 0) this.#build(0, n);
  }

  #build(start: number, end: number): number {
    const node = this.#nodes++;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const cmn = [Infinity, Infinity, Infinity], cmx = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = this.#order[i]!;
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k]!, this.#triMin[t * 3 + k]!);
        mx[k] = Math.max(mx[k]!, this.#triMax[t * 3 + k]!);
        const c = this.centroid[t * 3 + k]!;
        cmn[k] = Math.min(cmn[k]!, c);
        cmx[k] = Math.max(cmx[k]!, c);
      }
    }
    for (let k = 0; k < 3; k++) {
      this.#bmin[node * 3 + k] = mn[k]!;
      this.#bmax[node * 3 + k] = mx[k]!;
    }
    const count = end - start;
    if (count <= 6) {
      this.#first[node] = start;
      this.#count[node] = count;
      this.#left[node] = -1;
      this.#right[node] = -1;
      return node;
    }
    let axis = 0;
    let ext = -1;
    for (let k = 0; k < 3; k++) if (cmx[k]! - cmn[k]! > ext) ((ext = cmx[k]! - cmn[k]!), (axis = k));
    const sub = this.#order.subarray(start, end);
    const cen = this.centroid;
    sub.sort((p, q) => cen[p * 3 + axis]! - cen[q * 3 + axis]!);
    const mid = start + (count >> 1);
    this.#count[node] = 0;
    this.#left[node] = this.#build(start, mid);
    this.#right[node] = this.#build(mid, end);
    return node;
  }

  /**
   * The point of triangle t nearest (px, py, pz) (Ericson 5.1.5), written into `out`, allocation-free.
   * Returns true when it lies inside the face, false when it lies on an edge or at a corner.
   */
  closestPoint(px: number, py: number, pz: number, t: number, out: Float64Array): boolean {
    return this.nearestOn(px, py, pz, t, out) === IN_FACE;
  }

  /** As closestPoint, and says where on the triangle the point lies: IN_FACE, CORNER + k or EDGE + k. */
  nearestOn(px: number, py: number, pz: number, t: number, out: Float64Array): number {
    const P = this.pos, T = this.tri;
    const a = T[t * 3]! * 3, b = T[t * 3 + 1]! * 3, c = T[t * 3 + 2]! * 3;
    const ax = P[a]!, ay = P[a + 1]!, az = P[a + 2]!;
    const abx = P[b]! - ax, aby = P[b + 1]! - ay, abz = P[b + 2]! - az;
    const acx = P[c]! - ax, acy = P[c + 1]! - ay, acz = P[c + 2]! - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let qx: number, qy: number, qz: number;
    let where: number;
    if (d1 <= 0 && d2 <= 0) {
      qx = ax; qy = ay; qz = az;
      where = CORNER;
    } else {
      const bpx = px - P[b]!, bpy = py - P[b + 1]!, bpz = pz - P[b + 2]!;
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      const cpx = px - P[c]!, cpy = py - P[c + 1]!, cpz = pz - P[c + 2]!;
      const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
      const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
      if (d3 >= 0 && d4 <= d3) {
        qx = P[b]!; qy = P[b + 1]!; qz = P[b + 2]!;
        where = CORNER + 1;
      } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v;
        where = EDGE;
      } else if (d6 >= 0 && d5 <= d6) {
        qx = P[c]!; qy = P[c + 1]!; qz = P[c + 2]!;
        where = CORNER + 2;
      } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w;
        where = EDGE + 2;
      } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        qx = P[b]! + (P[c]! - P[b]!) * w; qy = P[b + 1]! + (P[c + 1]! - P[b + 1]!) * w; qz = P[b + 2]! + (P[c + 2]! - P[b + 2]!) * w;
        where = EDGE + 1;
      } else {
        const den = 1 / (va + vb + vc);
        const v = vb * den, w = vc * den;
        qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
        where = IN_FACE;
      }
    }
    out[0] = qx;
    out[1] = qy;
    out[2] = qz;
    return where;
  }

  /** Squared distance from (px, py, pz) to triangle t, allocation-free. */
  distSq(px: number, py: number, pz: number, t: number): number {
    const q = this.#q;
    this.closestPoint(px, py, pz, t, q);
    const dx = px - q[0]!, dy = py - q[1]!, dz = pz - q[2]!;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Squared distance from p to the nearest triangle, searching no further than maxDist. */
  nearestDistSq(p: V3, maxDist: number): number {
    let best = maxDist * maxDist;
    if (this.n === 0) return best;
    const stack = [0];
    while (stack.length) {
      const node = stack.pop()!;
      if (this.#boxDistSq(node, p) >= best) continue;
      if (this.#left[node]! < 0) {
        const s = this.#first[node]!, e = s + this.#count[node]!;
        for (let i = s; i < e; i++) {
          const d = this.distSq(p[0], p[1], p[2], this.#order[i]!);
          if (d < best) best = d;
        }
      } else {
        const l = this.#left[node]!, r = this.#right[node]!;
        const dl = this.#boxDistSq(l, p), dr = this.#boxDistSq(r, p);
        if (dl < dr) stack.push(r, l);
        else stack.push(l, r);
      }
    }
    return best;
  }

  vertex(t: number, k: number): V3 {
    const v = this.tri[t * 3 + k]! * 3;
    return [this.pos[v]!, this.pos[v + 1]!, this.pos[v + 2]!];
  }

  #boxDistSq(node: number, p: V3): number {
    let d = 0;
    for (let k = 0; k < 3; k++) {
      const lo = this.#bmin[node * 3 + k]!, hi = this.#bmax[node * 3 + k]!;
      const v = p[k]! < lo ? lo - p[k]! : p[k]! > hi ? p[k]! - hi : 0;
      d += v * v;
    }
    return d;
  }

  /**
   * Whether some triangle that passes `keep` lies closer than r to p and, when `meets` is
   * given, passes it too: it is handed the triangle's point nearest p, whether that point
   * lies inside its face (false on an edge or at a corner), and where on the triangle it
   * lies (IN_FACE, CORNER + k or EDGE + k, as nearestOn says).
   */
  anyWithin(p: V3, r: number, keep: (t: number) => boolean, meets?: (t: number, q: Float64Array, inFace: boolean, where: number) => boolean): boolean {
    if (this.n === 0) return false;
    const r2 = r * r;
    const q = this.#q;
    const stack = [0];
    while (stack.length) {
      const node = stack.pop()!;
      if (this.#boxDistSq(node, p) >= r2) continue;
      if (this.#left[node]! < 0) {
        const s = this.#first[node]!, e = s + this.#count[node]!;
        for (let i = s; i < e; i++) {
          const t = this.#order[i]!;
          if (!keep(t)) continue;
          const where = this.nearestOn(p[0], p[1], p[2], t, q);
          const dx = p[0] - q[0]!, dy = p[1] - q[1]!, dz = p[2] - q[2]!;
          if (dx * dx + dy * dy + dz * dz < r2 && (!meets || meets(t, q, where === IN_FACE, where))) return true;
        }
      } else {
        stack.push(this.#left[node]!, this.#right[node]!);
      }
    }
    return false;
  }

  /** Calls fn for every triangle closer than r to (px, py, pz). */
  forEachWithin(px: number, py: number, pz: number, r: number, fn: (t: number) => void): void {
    if (this.n === 0) return;
    const r2 = r * r;
    const p: V3 = [px, py, pz];
    const stack = [0];
    while (stack.length) {
      const node = stack.pop()!;
      if (this.#boxDistSq(node, p) >= r2) continue;
      if (this.#left[node]! < 0) {
        const s = this.#first[node]!, e = s + this.#count[node]!;
        for (let i = s; i < e; i++) {
          const t = this.#order[i]!;
          if (this.distSq(px, py, pz, t) < r2) fn(t);
        }
      } else {
        stack.push(this.#left[node]!, this.#right[node]!);
      }
    }
  }

  /** The nearest hit along a ray from o in unit direction d, among triangles that pass `keep`. */
  ray(o: V3, d: V3, maxDist: number, keep: (t: number) => boolean): { t: number; dist: number } | null {
    if (this.n === 0) return null;
    let best: { t: number; dist: number } | null = null;
    let limit = maxDist;
    const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
    const stack = [0];
    while (stack.length) {
      const node = stack.pop()!;
      let tmin = 0, tmax = limit;
      for (let k = 0; k < 3; k++) {
        const t1 = (this.#bmin[node * 3 + k]! - o[k]!) * inv[k]!, t2 = (this.#bmax[node * 3 + k]! - o[k]!) * inv[k]!;
        tmin = Math.max(tmin, Math.min(t1, t2));
        tmax = Math.min(tmax, Math.max(t1, t2));
      }
      if (tmin > tmax) continue;
      if (this.#left[node]! < 0) {
        const s = this.#first[node]!, e = s + this.#count[node]!;
        for (let i = s; i < e; i++) {
          const t = this.#order[i]!;
          if (!keep(t)) continue;
          const dist = rayTri(o, d, this.vertex(t, 0), this.vertex(t, 1), this.vertex(t, 2));
          if (dist > 1e-7 && dist < limit) {
            limit = dist;
            best = { t, dist };
          }
        }
      } else {
        stack.push(this.#left[node]!, this.#right[node]!);
      }
    }
    return best;
  }

  /** Every pair of triangles whose boxes overlap (each pair once). */
  forEachOverlap(fn: (a: number, b: number) => void): void {
    for (let a = 0; a < this.n; a++) {
      const stack = [0];
      while (stack.length) {
        const node = stack.pop()!;
        let hit = true;
        for (let k = 0; k < 3; k++) {
          if (this.#bmax[node * 3 + k]! < this.#triMin[a * 3 + k]! - 1e-9 || this.#bmin[node * 3 + k]! > this.#triMax[a * 3 + k]! + 1e-9) {
            hit = false;
            break;
          }
        }
        if (!hit) continue;
        if (this.#left[node]! < 0) {
          const s = this.#first[node]!, e = s + this.#count[node]!;
          for (let i = s; i < e; i++) {
            const b = this.#order[i]!;
            if (b <= a) continue;
            let overlap = true;
            for (let k = 0; k < 3; k++) {
              if (this.#triMax[b * 3 + k]! < this.#triMin[a * 3 + k]! - 1e-9 || this.#triMin[b * 3 + k]! > this.#triMax[a * 3 + k]! + 1e-9) {
                overlap = false;
                break;
              }
            }
            if (overlap) fn(a, b);
          }
        } else stack.push(this.#left[node]!, this.#right[node]!);
      }
    }
  }
}
