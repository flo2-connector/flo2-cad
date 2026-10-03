// The geometry kernel: manifold-3d 3.5.4, UNMODIFIED (con:manifold-used-unmodified).
//
// Only its two runtime files are shipped, copied byte for byte from the npm
// tarball into vendor/manifold-3d-3.5.4/ (manifold.js and manifold.wasm, with
// its LICENSE and package.json). The package's own dependencies are CAD
// tooling we never load (glTF, a native image library, a bundler), and they
// would put the install over 25 MB (con:install-size-engine). The files'
// provenance is vendor/manifold-3d-3.5.4.source.json; scripts/verify-kernel.mjs
// proves them byte-identical to the published tarball.
//
// The CHECKER never imports this file (con:checker-independent-of-the-kernel).

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ManifoldToplevel } from '../../vendor/manifold-3d-3.5.4/manifold.js';

export type Kernel = ManifoldToplevel;
export type { CrossSection, Manifold, Vec2, Vec3 } from '../../vendor/manifold-3d-3.5.4/manifold.js';

export const KERNEL_DIR_NAME = 'manifold-3d-3.5.4';

/** The vendored kernel's folder, found by walking up from this file (it differs between the tsc build and the bundle). */
export function kernelDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'vendor', KERNEL_DIR_NAME);
    if (existsSync(join(candidate, 'manifold.js'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`the geometry kernel (vendor/${KERNEL_DIR_NAME}/manifold.js) was not found next to the engine`);
}

let loading: Promise<Kernel> | undefined;

/** Loads the kernel once per process. */
export function kernel(): Promise<Kernel> {
  loading ??= (async () => {
    const mod = (await import(pathToFileURL(join(kernelDir(), 'manifold.js')).href)) as { default: () => Promise<Kernel> };
    const k = await mod.default();
    k.setup();
    return k;
  })();
  return loading;
}

/** Segments for a full circle of radius r so the chord sits within `tol` of the arc. */
export function segmentsFor(radius: number, tol: number, min = 12): number {
  if (radius <= tol) return min;
  const half = Math.acos(1 - tol / radius);
  return Math.max(min, Math.ceil(Math.PI / half));
}

/** Segments for a sphere: its subdivided-octahedron facets stand further off than a circle's chords, so it gets 1.6 × as many, in fours. */
export function sphereSegments(radius: number, tol: number): number {
  return Math.ceil(segmentsFor(radius, tol * 0.6, 16) / 4) * 4;
}
