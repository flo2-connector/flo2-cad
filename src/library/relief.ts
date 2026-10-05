// A RELIEF FROM A PICTURE (cap:a-relief-from-a-picture; option C1 of
// dec:idea-how-flo2-cad-becomes-general-enough-to-model-anything): a grayscale height
// image laid onto a flat patch, or round a band's top as a curved patch, at a stated
// width, height and greatest depth, raised or sunk, as ONE closed solid.
//
// THE SOLID. Over its patch it runs from its BACK, `base` below its surface, to its FACE:
// the surface moved out by depth × the smoothed image (raised) or in by it (sunk). So a
// raised relief laid with its surface on a plate or a band has its back buried in that
// metal and joins it; a sunk relief carves the picture into its own backing, so it is
// the face itself (a signet's plate) or a panel laid on the piece. The checker measures
// it like any other metal: walls, details, gaps, the surface.
//
//  · flat: the patch lies in the xy plane, centred on the origin, the image's top
//    towards +y, its face towards +z. Width runs along x, height along y.
//  · cylinder: the patch wraps round the y axis (a ring's finger axis), its surface at
//    `radius`, centred on the top (+z): width runs round the band (measured along its
//    surface), height along y. Set `radius` to the band's outer radius to lay it on the
//    band's top.
//
// SMOOTHED SO NO FEATURE IS FINER THAN A CASTING HOLDS. The image is blurred, as a
// continuous Gaussian over its pixels (each pixel a small square, the edge pixels held
// out to infinity), with σ = max(smoothing / 2, 0.4 × depth):
//  · smoothing / 2 (0.175 mm at the default, the 0.35 mm casting detail limit) makes the
//    narrowest ridge or hollow that survives about 2.35 σ = 0.41 mm across at half its
//    height, so no detail is finer than the limit;
//  · 0.4 × depth holds every slope to 45° or less: a Gaussian-smoothed picture's slope is
//    at most depth / (σ √(2π)), whatever the picture. The wall check's ball sees two
//    faces as one wall only when they are more than 105° apart, which two 45° slopes
//    never are; so a relief is never read as a thin wall where it is not one.
// The engine does not invent detail. A convincing face comes from a good height image;
// a deeper relief is a softer one, because the slopes are held to 45°.
//
// THE MESH. A regular grid over the patch, its spacing from the casting tolerance and
// the smoothed image's own curvature (at most 0.968 × depth / σ² by the same bound), so
// its facets stand off the smoothed surface by under 0.9 × the tolerance each way, as
// every other curved surface in the library does (tolerances.ts). The reference build
// for the surface check is finer by the same rule, so the check measures the casting
// file against the smoothed surface itself.
//
// THE IMAGE, by its file name, from one folder: FLO2_CAD_IMAGE_DIR, else the engine's
// working directory. On flo2.io that is the design's own folder, mounted read-only at
// /design (the Dockerfile sets it), so a relief names a file the design keeps. A
// program's evaluation child reads no files: the engine reads the images a program names
// and hands it their bytes (src/program/run.ts, useGivenImages).

import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CallError } from '../errors.js';
import type { Kernel, Manifold } from '../kernel/manifold.js';
import type { TreeNode } from '../piece/tree.js';
import { ImageRefused, MAX_IMAGE_BYTES, readHeightPng, type HeightImage } from '../files/png-read.js';
import { lengthMm } from '../units.js';
import type { Arena } from './build.js';

export const RELIEF_MODES = ['raised', 'sunk'] as const;
export const RELIEF_SURFACES = ['flat', 'cylinder'] as const;
export type ReliefMode = (typeof RELIEF_MODES)[number];
export type ReliefSurface = (typeof RELIEF_SURFACES)[number];

/** What the library builds, in mm. */
export const RELIEF_RANGE = {
  size: [1, 100],
  depth: [0.05, 5],
  base: [0.2, 20],
  smoothing: [0.35, 5],
  radius: [3, 100],
} as const;
/** The casting detail limit every metal shares (metals.ts): the default and the least smoothing. */
export const RELIEF_DEFAULT_SMOOTHING_MM = 0.35;
/** The steepest slope a relief keeps, in degrees. */
export const RELIEF_MAX_SLOPE_DEG = 45;
/** The most grid cells one relief may have at the finest tolerance it is built to (its memory and its check time). */
export const RELIEF_MAX_CELLS = 600_000;

/** A file name a relief may read: a plain name ending .png, no folder. */
export const IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,123}\.png$/i;

export interface ReliefSpec {
  image: string;
  width: number;
  height: number;
  depth: number;
  mode: ReliefMode;
  surface: ReliefSurface;
  radius: number;
  base: number;
  smoothing: number;
}

type Params = Record<string, unknown>;
const at = (path: string, k: string) => `${path}.${k}`;

/** A relief node's settings, read with their units and defaults. Validates as it reads, so a tree's check and a build agree. */
export function reliefSpec(p: Params, path: string): ReliefSpec {
  const image = p['image'];
  if (typeof image !== 'string' || !IMAGE_NAME.test(image)) {
    throw new CallError(at(path, 'image'), `the height image's file name, a PNG kept beside the piece, e.g. "lion-face.png" (letters, digits, ".", "_" and "-", no folder); got ${JSON.stringify(image)}.`);
  }
  const len = (k: string, [lo, hi]: readonly [number, number], dflt?: number): number => {
    if (p[k] === undefined) {
      if (dflt === undefined) throw new CallError(at(path, k), `a relief needs "${k}".`);
      return dflt;
    }
    const x = lengthMm(p[k], at(path, k));
    if (!(x >= lo && x <= hi)) throw new CallError(at(path, k), `${x} mm is outside what the library builds (${lo} to ${hi} mm).`);
    return x;
  };
  const word = <T extends string>(k: string, allowed: readonly T[], dflt: T): T => {
    const v = p[k] ?? dflt;
    if (!allowed.includes(v as T)) throw new CallError(at(path, k), `must be ${allowed.map((a) => `"${a}"`).join(' or ')}; got ${JSON.stringify(p[k])}.`);
    return v as T;
  };
  const width = len('width', RELIEF_RANGE.size);
  const height = len('height', RELIEF_RANGE.size);
  const depth = len('depth', RELIEF_RANGE.depth);
  const mode = word('mode', RELIEF_MODES, 'raised');
  const surface = word('surface', RELIEF_SURFACES, 'flat');
  if (p['smoothing'] !== undefined && lengthMm(p['smoothing'], at(path, 'smoothing')) < RELIEF_RANGE.smoothing[0]) {
    throw new CallError(at(path, 'smoothing'), `${lengthMm(p['smoothing'], at(path, 'smoothing'))} mm is finer than a casting holds: the least is the casting detail limit, ${RELIEF_RANGE.smoothing[0]} mm. Leave it out for that.`);
  }
  const smoothing = len('smoothing', RELIEF_RANGE.smoothing, RELIEF_DEFAULT_SMOOTHING_MM);
  const base = len('base', RELIEF_RANGE.base, mode === 'sunk' ? depth + 1 : 1);
  if (mode === 'sunk' && base < depth + 0.1) {
    throw new CallError(at(path, 'base'), `a sunk relief is carved into its own back, so its base (${base} mm) must be more than its depth (${depth} mm): at least ${Math.round((depth + 0.1) * 100) / 100} mm, and the casting needs the wall minimum (0.8 mm) under the deepest place.`);
  }
  let radius = 0;
  if (surface === 'cylinder') {
    radius = len('radius', RELIEF_RANGE.radius);
    if (radius - base < 0.5) throw new CallError(at(path, 'base'), `the back would lie ${Math.round((radius - base) * 100) / 100} mm from the axis; keep base under the radius less 0.5 mm (${Math.round((radius - 0.5) * 100) / 100} mm).`);
    if (width / radius > Math.PI) throw new CallError(at(path, 'width'), `${width} mm reaches more than half way round a radius of ${radius} mm (${Math.round(Math.PI * radius * 100) / 100} mm). Use a narrower relief.`);
  } else if (p['radius'] !== undefined) {
    throw new CallError(at(path, 'radius'), 'a flat relief has no radius; leave it out, or set "surface" to "cylinder".');
  }
  return { image, width, height, depth, mode, surface, radius, base, smoothing };
}

/** The Gaussian blur's σ, in mm (see the header). */
export function reliefSigma(s: Pick<ReliefSpec, 'smoothing' | 'depth'>): number {
  return Math.max(s.smoothing / 2, s.depth / (Math.sqrt(2 * Math.PI) * Math.tan((RELIEF_MAX_SLOPE_DEG * Math.PI) / 180)));
}

/** The grid spacing at a tolerance: chords within 0.9 × tol each way over the smoothed surface (and round the cylinder). */
export function reliefSpacing(s: ReliefSpec, tol: number): number {
  const sigma = reliefSigma(s);
  let curvature = (0.968 * s.depth) / (sigma * sigma);
  if (s.surface === 'cylinder') curvature += 1 / (s.radius - s.base);
  return Math.min(sigma / 2, 0.5, Math.sqrt((8 * 0.9 * tol) / curvature));
}

// ------------------------------------------------------------------ the image

let given: ReadonlyMap<string, Uint8Array> | null = null;
const decoded = new Map<string, HeightImage>();

/** The folder images are read from: FLO2_CAD_IMAGE_DIR, else the working directory. */
export function imageFolder(): string {
  return process.env['FLO2_CAD_IMAGE_DIR'] || process.cwd();
}

/** In a program's evaluation child: the only images there are, as the engine read them. */
export function useGivenImages(images: ReadonlyMap<string, Uint8Array>): void {
  given = images;
}

/** An image file's bytes, by its plain name, from the image folder (or what the engine gave a program). */
export function imageBytes(name: string, path: string): Uint8Array {
  if (!IMAGE_NAME.test(name)) throw new CallError(path, `"${name}" is not a plain PNG file name.`);
  if (given) {
    const b = given.get(name);
    if (!b) throw new CallError(path, `no height image called "${name}" was found beside the piece. Write the name exactly as the file is kept, in quotes, so the engine can find it before the program runs.`);
    return b;
  }
  const file = join(imageFolder(), name);
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not a file');
    size = st.size;
  } catch {
    throw new CallError(path, `no height image called "${name}" was found beside the piece${process.env['FLO2_CAD_IMAGE_DIR'] ? '' : ' (the engine reads images from its working folder, or from FLO2_CAD_IMAGE_DIR)'}. On flo2, keep the PNG in the design and give its name as list_my_design_files shows it.`);
  }
  if (size > MAX_IMAGE_BYTES) throw new CallError(path, `"${name}" is ${(size / 2 ** 20).toFixed(1)} MB; a height image may be at most ${MAX_IMAGE_BYTES / 2 ** 20} MB.`);
  return readFileSync(file);
}

/** The image decoded to one height per pixel, kept by its bytes' hash. */
export function heightImage(name: string, path: string): { image: HeightImage; sha256: string } {
  const bytes = imageBytes(name, path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let image = decoded.get(sha256);
  if (!image) {
    try {
      image = readHeightPng(bytes);
    } catch (e) {
      if (e instanceof ImageRefused) throw new CallError(path, `"${name}" cannot be read as a height image: ${e.message}`);
      throw e;
    }
    if (decoded.size >= 8) decoded.delete(decoded.keys().next().value!);
    decoded.set(sha256, image);
  }
  return { image, sha256 };
}

// -------------------------------------------------------------- the smoothing

/** Φ, the standard normal distribution (Abramowitz and Stegun 7.1.26, error under 1.5e-7). */
function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Each sample's weights over the cells of one image axis: the Gaussian's mass over each
 * cell, the first and last cells held out to infinity, normalised.
 */
function axisWeights(at: Float64Array, edges: Float64Array, sigma: number): { from: Int32Array; k: number; w: Float64Array } {
  const n = edges.length - 1;
  const reach = 4 * sigma;
  const lo = (x: number) => {
    let a = 0, b = n - 1;
    while (a < b) {
      const m = (a + b) >> 1;
      if (edges[m + 1]! < x) a = m + 1;
      else b = m;
    }
    return a;
  };
  const from = new Int32Array(at.length);
  let k = 1;
  const spans: [number, number][] = [];
  for (let i = 0; i < at.length; i++) {
    const c0 = lo(at[i]! - reach), c1 = lo(at[i]! + reach);
    spans.push([c0, c1]);
    from[i] = c0;
    k = Math.max(k, c1 - c0 + 1);
  }
  const w = new Float64Array(at.length * k);
  for (let i = 0; i < at.length; i++) {
    const x = at[i]!;
    const [c0, c1] = spans[i]!;
    let sum = 0;
    for (let c = c0; c <= c1; c++) {
      const hi = c === n - 1 ? 1 : phi((edges[c + 1]! - x) / sigma);
      const lo2 = c === 0 ? 0 : phi((edges[c]! - x) / sigma);
      const v = Math.max(0, hi - lo2);
      w[i * k + (c - c0)] = v;
      sum += v;
    }
    if (sum > 0) for (let c = c0; c <= c1; c++) w[i * k + (c - c0)]! /= sum;
  }
  return { from, k, w };
}

/** Block-averages the image so a σ spans at least two of its cells (the blur is the same to well within a tolerance; the work is bounded). */
function coarsen(img: HeightImage, f: number): { cols: number; rows: number; values: Float64Array; colEdges: number[]; rowEdges: number[] } {
  const cols = Math.ceil(img.width / f), rows = Math.ceil(img.height / f);
  const values = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let s = 0, n = 0;
      for (let y = r * f; y < Math.min(img.height, (r + 1) * f); y++) {
        for (let x = c * f; x < Math.min(img.width, (c + 1) * f); x++) {
          s += img.values[y * img.width + x]!;
          n++;
        }
      }
      values[r * cols + c] = s / n;
    }
  }
  const colEdges = Array.from({ length: cols + 1 }, (_, c) => Math.min(img.width, c * f));
  const rowEdges = Array.from({ length: rows + 1 }, (_, r) => Math.min(img.height, r * f));
  return { cols, rows, values, colEdges, rowEdges };
}

/**
 * The smoothed image, 0 to 1, at every grid point (u_i, v_j) of the patch: row-major in j
 * (v from the patch's bottom edge up), then i (u from its left edge). u and v are in mm
 * from the patch's centre.
 */
export function smoothedGrid(img: HeightImage, width: number, height: number, sigma: number, us: Float64Array, vs: Float64Array): Float32Array {
  const px = width / img.width, py = height / img.height;
  const f = Math.max(1, Math.floor(sigma / (2 * Math.max(px, py))));
  const g = coarsen(img, f);
  // Image x runs from the patch's left edge; image y from its TOP edge down.
  const colEdges = Float64Array.from(g.colEdges, (c) => -width / 2 + c * px);
  const rowEdges = Float64Array.from(g.rowEdges, (r) => r * py);
  const wx = axisWeights(us, colEdges, sigma);
  const vDown = Float64Array.from(vs, (v) => height / 2 - v);
  const wy = axisWeights(vDown, rowEdges, sigma);
  // Along each image row first, then down the columns.
  const nu = us.length, nv = vs.length;
  const rowsAtU = new Float64Array(g.rows * nu);
  for (let r = 0; r < g.rows; r++) {
    const row = r * g.cols;
    for (let i = 0; i < nu; i++) {
      const c0 = wx.from[i]!;
      let s = 0;
      for (let t = 0; t < wx.k; t++) {
        const c = c0 + t;
        if (c >= g.cols) break;
        s += wx.w[i * wx.k + t]! * g.values[row + c]!;
      }
      rowsAtU[r * nu + i] = s;
    }
  }
  const out = new Float32Array(nu * nv);
  for (let j = 0; j < nv; j++) {
    const r0 = wy.from[j]!;
    for (let i = 0; i < nu; i++) {
      let s = 0;
      for (let t = 0; t < wy.k; t++) {
        const r = r0 + t;
        if (r >= g.rows) break;
        s += wy.w[j * wy.k + t]! * rowsAtU[r * nu + i]!;
      }
      out[j * nu + i] = Math.min(1, Math.max(0, s));
    }
  }
  return out;
}

// ------------------------------------------------------------------- the solid

/** n + 1 evenly spaced values from a to b. */
function lines(a: number, b: number, n: number): Float64Array {
  return Float64Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

/** The cells a relief would have at a tolerance, for a refusal before anything is built. */
export function reliefCells(s: ReliefSpec, tol: number): { nx: number; ny: number } {
  const h = reliefSpacing(s, tol);
  return { nx: Math.max(2, Math.ceil(s.width / h)), ny: Math.max(2, Math.ceil(s.height / h)) };
}

/** Builds the relief node `n` as one closed solid (see the header). */
export function buildRelief(k: Kernel, A: Arena, n: TreeNode, tol: number): Manifold {
  const path = `${n.id}.params`;
  const s = reliefSpec((n.params ?? {}) as Params, path);
  const { nx, ny } = reliefCells(s, tol);
  if (nx * ny > RELIEF_MAX_CELLS) {
    throw new CallError(path, `a ${s.width} × ${s.height} mm relief ${s.depth} mm deep needs ${nx * ny} grid cells at the casting tolerance, more than the ${RELIEF_MAX_CELLS} one relief may have. Make it smaller, shallower, or smoother (a larger "smoothing").`);
  }
  const { image } = heightImage(s.image, `${path}.image`);
  const sigma = reliefSigma(s);
  const us = lines(-s.width / 2, s.width / 2, nx), vs = lines(-s.height / 2, s.height / 2, ny);
  const field = smoothedGrid(image, s.width, s.height, sigma, us, vs);
  const sign = s.mode === 'raised' ? 1 : -1;

  // Local (u, v, w): w is the height above the surface. Flat: (u, v, w) is (x, y, z).
  // Cylinder: round the y axis, u measured along the surface at `radius`, w outward.
  const put = (out: Float32Array, o: number, u: number, v: number, w: number) => {
    if (s.surface === 'flat') {
      out[o] = Math.fround(u);
      out[o + 1] = Math.fround(v);
      out[o + 2] = Math.fround(w);
    } else {
      const th = u / s.radius, r = s.radius + w;
      out[o] = Math.fround(r * Math.sin(th));
      out[o + 1] = Math.fround(v);
      out[o + 2] = Math.fround(r * Math.cos(th));
    }
  };

  const top = (nx + 1) * (ny + 1);
  const T = (i: number, j: number) => j * (nx + 1) + i;
  // The back's vertices: one under each edge vertex of the face, then the centres of the two end strips.
  const ring: [number, number][] = [];
  for (let i = 0; i <= nx; i++) ring.push([i, 0]);
  for (let j = 1; j <= ny; j++) ring.push([nx, j]);
  for (let i = nx - 1; i >= 0; i--) ring.push([i, ny]);
  for (let j = ny - 1; j >= 1; j--) ring.push([0, j]);
  const backIndex = new Map<number, number>();
  ring.forEach(([i, j], q) => backIndex.set(T(i, j), top + q));
  const B = (i: number, j: number) => backIndex.get(T(i, j))!;
  const centres = top + ring.length;
  const vert = new Float32Array((centres + 2) * 3);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) put(vert, T(i, j) * 3, us[i]!, vs[j]!, sign * s.depth * field[j * (nx + 1) + i]!);
  ring.forEach(([i, j], q) => put(vert, (top + q) * 3, us[i]!, vs[j]!, -s.base));
  put(vert, centres * 3, (us[0]! + us[1]!) / 2, 0, -s.base);
  put(vert, (centres + 1) * 3, (us[nx - 1]! + us[nx]!) / 2, 0, -s.base);

  const tri: number[] = [];
  // The face, wound outward (+w).
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      tri.push(T(i, j), T(i + 1, j), T(i + 1, j + 1));
      tri.push(T(i, j), T(i + 1, j + 1), T(i, j + 1));
    }
  }
  // The four sides, each a strip of quads from the face's edge down to the back.
  const side = (a: [number, number], b: [number, number]) => {
    const [ta, tb, ba, bb] = [T(...a), T(...b), B(...a), B(...b)];
    tri.push(ba, bb, tb, ba, tb, ta);
  };
  for (let i = 0; i < nx; i++) side([i, 0], [i + 1, 0]);
  for (let j = 0; j < ny; j++) side([nx, j], [nx, j + 1]);
  for (let i = nx; i > 0; i--) side([i, ny], [i - 1, ny]);
  for (let j = ny; j > 0; j--) side([0, j], [0, j - 1]);
  // The back, wound outward (−w): a strip between each two columns, each flat; the two end
  // strips, which hold every vertex down the side, as fans from their centres.
  for (let i = 0; i < nx; i++) {
    const loop: number[] = [B(i, 0), B(i + 1, 0)];
    if (i + 1 === nx) for (let j = 1; j < ny; j++) loop.push(B(nx, j));
    loop.push(B(i + 1, ny), B(i, ny));
    if (i === 0) for (let j = ny - 1; j >= 1; j--) loop.push(B(0, j));
    if (loop.length === 4) {
      tri.push(loop[0]!, loop[2]!, loop[1]!, loop[0]!, loop[3]!, loop[2]!);
    } else {
      const c = i === 0 ? centres : centres + 1;
      for (let q = 0; q < loop.length; q++) tri.push(c, loop[(q + 1) % loop.length]!, loop[q]!);
    }
  }
  // nx ≥ 2 always, so the end strips are distinct and each centre is used once.
  const made = A.t(new k.Manifold(new k.Mesh({ numProp: 3, vertProperties: vert, triVerts: Uint32Array.from(tri) })));
  const status = made.status();
  if (status !== 'NoError') throw new Error(`engine bug: the relief "${n.id}" is not a closed solid (${status})`);
  // The grid is fine everywhere, for the most curved place; where the face is flat or
  // gently curved, the kernel takes out the vertices it does not need. Every vertex it
  // keeps is one of the grid's, on the smoothed surface, and nothing moves by more than a
  // tenth of the tolerance (measured on a 16 mm dome: 124,000 triangles to 30,000).
  return A.t(made.simplify(0.1 * tol));
}

/** The images a tree's relief nodes name, each with its hash and size, for the check report. */
export function reliefImagesOf(root: TreeNode): { node: string; image: string; sha256: string; pixels: [number, number] }[] {
  const out: { node: string; image: string; sha256: string; pixels: [number, number] }[] = [];
  const walk = (n: TreeNode) => {
    if (n.op === 'relief') {
      const name = String((n.params ?? {})['image']);
      const { image, sha256 } = heightImage(name, `${n.id}.params.image`);
      out.push({ node: n.id, image: name, sha256, pixels: [image.width, image.height] });
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  return out;
}

/** The most images one program may name. */
export const MAX_PROGRAM_IMAGES = 8;

/** The plain .png names a program's source quotes: the images the engine reads for it before it runs. */
export function imagesNamedIn(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/["'`]([A-Za-z0-9][A-Za-z0-9._-]{0,123}\.png)["'`]/gi)) names.add(m[1]!);
  return [...names];
}

/**
 * The images a program names that are there to read, as base64, for its evaluation child
 * (which reads no files). A name with no file is left out, and relief() says so when the
 * program asks for it.
 */
export function imagesForProgram(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of imagesNamedIn(source).slice(0, MAX_PROGRAM_IMAGES)) {
    try {
      out[name] = Buffer.from(imageBytes(name, 'image')).toString('base64');
    } catch {
      /* not there: relief() refuses it by name, with its line */
    }
  }
  return out;
}

/** The images a program names that are there, with their hashes and sizes, for the check report. */
export function programImagesReport(source: string): { image: string; sha256: string; pixels: [number, number] }[] {
  const out: { image: string; sha256: string; pixels: [number, number] }[] = [];
  for (const name of imagesNamedIn(source).slice(0, MAX_PROGRAM_IMAGES)) {
    try {
      const { image, sha256 } = heightImage(name, 'image');
      out.push({ image: name, sha256, pixels: [image.width, image.height] });
    } catch {
      /* not there, or not readable: the program's run says so */
    }
  }
  return out;
}
