// An indexed triangle mesh in millimetres: what the kernel hands the exporter,
// and what the checker rebuilds from the STL bytes it reads back.

export interface Mesh {
  /** x, y, z per vertex, in mm. */
  readonly positions: Float32Array | Float64Array;
  /** Three vertex indices per triangle, counter-clockwise seen from outside. */
  readonly triangles: Uint32Array;
}

export function triangleCount(m: Mesh): number {
  return m.triangles.length / 3;
}
