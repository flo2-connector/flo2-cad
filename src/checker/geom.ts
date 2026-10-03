// Small 3D helpers for the checker. The checker is INDEPENDENT of the kernel
// (con:checker-independent-of-the-kernel): nothing under src/checker imports
// manifold-3d, the library or the exporter. test/package.test.ts holds that.

export type V3 = [number, number, number];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Ray (origin o, unit direction d) against triangle abc (Möller–Trumbore); distance or -1. */
export function rayTri(o: V3, d: V3, a: V3, b: V3, c: V3): number {
  const e1 = sub(b, a), e2 = sub(c, a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-14) return -1;
  const inv = 1 / det;
  const t = sub(o, a);
  const u = dot(t, p) * inv;
  if (u < 0 || u > 1) return -1;
  const q = cross(t, e1);
  const v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return -1;
  const dist = dot(e2, q) * inv;
  return dist > 0 ? dist : -1;
}

/** Whether segment pq crosses the interior of triangle abc (strictly between its ends). */
export function segmentCrossesTri(p: V3, q: V3, a: V3, b: V3, c: V3): boolean {
  const d = sub(q, p);
  const l = len(d);
  if (l === 0) return false;
  const dir = scale(d, 1 / l);
  const e1 = sub(b, a), e2 = sub(c, a);
  const h = cross(dir, e2);
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  const s = sub(p, a);
  const u = dot(s, h) * inv;
  const eps = 1e-9;
  if (u <= eps || u >= 1 - eps) return false;
  const qv = cross(s, e1);
  const v = dot(dir, qv) * inv;
  if (v <= eps || u + v >= 1 - eps) return false;
  const t = dot(e2, qv) * inv;
  return t > l * 1e-7 && t < l * (1 - 1e-7);
}
