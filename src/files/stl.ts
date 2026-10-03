// Binary STL writer, in millimetres (dec:casting-file-format-and-units).
// The checker has its OWN parser for these bytes (con:checker-independent-of-the-kernel);
// nothing here is shared with it.

import type { Mesh } from './mesh.js';

/** The 80-byte header. It must not begin with "solid", which some readers take for ASCII STL. */
export function stlHeader(text: string): Buffer {
  const h = Buffer.alloc(80, 0x20);
  h.write(text.replace(/^solid/i, 'Solid-').slice(0, 80), 0, 'ascii');
  return h;
}

export function writeBinaryStl(mesh: Mesh, headerText: string): Buffer {
  const n = mesh.triangles.length / 3;
  const out = Buffer.alloc(84 + 50 * n);
  stlHeader(headerText).copy(out, 0);
  out.writeUInt32LE(n, 80);
  const p = mesh.positions;
  let o = 84;
  for (let t = 0; t < n; t++) {
    const a = mesh.triangles[t * 3]! * 3;
    const b = mesh.triangles[t * 3 + 1]! * 3;
    const c = mesh.triangles[t * 3 + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    out.writeFloatLE(nx, o);
    out.writeFloatLE(ny, o + 4);
    out.writeFloatLE(nz, o + 8);
    o += 12;
    for (const v of [a, b, c]) {
      out.writeFloatLE(p[v]!, o);
      out.writeFloatLE(p[v + 1]!, o + 4);
      out.writeFloatLE(p[v + 2]!, o + 8);
      o += 12;
    }
    out.writeUInt16LE(0, o);
    o += 2;
  }
  return out;
}
