// The checker's OWN binary STL parser (con:checker-independent-of-the-kernel;
// owner round 2, Q5: "the checker independent in code and its own STL parser").
// It reads the bytes that were written, which is the file a caster gets.

export interface ReadMesh {
  /** Welded vertex positions (x, y, z), as float32 values from the file. */
  positions: Float64Array;
  /** Three vertex indices per triangle, in file order and winding. */
  triangles: Uint32Array;
  /** Triangles in the file. */
  count: number;
}

export class StlError extends Error {}

export function readBinaryStl(bytes: Uint8Array): ReadMesh {
  if (bytes.length < 84) throw new StlError(`the file is ${bytes.length} bytes, shorter than a binary STL header`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (bytes.length !== 84 + 50 * count) {
    throw new StlError(`the header says ${count} triangles (${84 + 50 * count} bytes) but the file is ${bytes.length} bytes`);
  }
  // Weld identical float32 positions: the exporter writes shared vertices bit for bit.
  const index = new Map<string, number>();
  const pos: number[] = [];
  const tris = new Uint32Array(count * 3);
  const f32 = new Float32Array(3);
  const u32 = new Uint32Array(f32.buffer);
  for (let t = 0; t < count; t++) {
    const base = 84 + 50 * t + 12;
    for (let v = 0; v < 3; v++) {
      for (let c = 0; c < 3; c++) f32[c] = view.getFloat32(base + v * 12 + c * 4, true);
      if (!Number.isFinite(f32[0]!) || !Number.isFinite(f32[1]!) || !Number.isFinite(f32[2]!)) {
        throw new StlError(`triangle ${t} has a vertex that is not a finite number`);
      }
      const key = `${u32[0]},${u32[1]},${u32[2]}`;
      let i = index.get(key);
      if (i === undefined) {
        i = pos.length / 3;
        index.set(key, i);
        pos.push(f32[0]!, f32[1]!, f32[2]!);
      }
      tris[t * 3 + v] = i;
    }
  }
  return { positions: Float64Array.from(pos), triangles: tris, count };
}
