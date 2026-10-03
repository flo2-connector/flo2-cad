// ⚠️ PHASE 1 STUB. Contract-shaped replies with PLACEHOLDER geometry, so flo2's
// door can be built against the real tool list and reply shapes while Phase 2
// builds the engine. Nothing here is casting-ready:
//   · the mesh is a plain band (a washer) at the right ring size, without the head;
//   · the "checks" compare the piece's SETTINGS with the casting limits; they
//     measure nothing, and every report and reply says so;
//   · the preview is a schematic front view, not a render.
// Phase 2 replaces this file with the kernel (manifold-3d), the independent
// checker and the software renderer. Its output shapes stay exactly these.

import { createHash } from 'node:crypto';
import type { Mesh } from '../files/mesh.js';
import { encodePng, newImage, type RgbImage } from '../files/png.js';
import { writeBinaryStl } from '../files/stl.js';
import { write3mf } from '../files/threemf.js';
import type { PieceTree, TemplateView } from '../piece/tree.js';
import { ENGINE_NAME, ENGINE_VERSION, KERNEL_NAME, KERNEL_VERSION, STUB_ENGINE } from '../version.js';

export const STUB_BANNER =
  'PHASE 1 STUB ENGINE: placeholder geometry (a plain band without the head), and the checks compare the settings with the casting limits instead of measuring a solid. Nothing from it is casting-ready.';

export const LIMITS_MM = { wall: 0.8, band: 1.0, prong: 1.0, detail: 0.35, gap: 0.3, surface_deviation: 0.01 } as const;

/** A length as the reports print it: "1.0 mm", "0.35 mm". */
export function mm(x: number): string {
  return `${Number.isInteger(x) ? x.toFixed(1) : String(x)} mm`;
}

/** Canonical JSON (keys sorted), so the same tree always has the same sha256. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export function sha256(b: Buffer | string): string {
  return createHash('sha256').update(b).digest('hex');
}

// Frame used by every part of the engine: X across the hand, Y along the finger
// (towards the fingertip), Z up through the stone. Seen from above, the finger
// points to 12 o'clock and prongs are counted clockwise from there.

function scaleFor(view: TemplateView): number {
  return 1 + view.shrinkagePct / 100;
}

/** A closed, outward-facing washer around the Y axis: the band, no head. */
export function stubMesh(view: TemplateView, segments = 96): Mesh {
  const s = scaleFor(view);
  const r = (view.innerDiameterMm / 2) * s;
  const R = r + view.bandThicknessMm * s;
  const h = (view.bandWidthMm * s) / 2;
  const pos = new Float64Array(segments * 4 * 3);
  // per segment i: 0 outer-front, 1 outer-back, 2 inner-front, 3 inner-back
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    const c = Math.cos(a), sn = Math.sin(a);
    const put = (k: number, rad: number, y: number) => pos.set([rad * c, y, rad * sn], (i * 4 + k) * 3);
    put(0, R, h);
    put(1, R, -h);
    put(2, r, h);
    put(3, r, -h);
  }
  const tris: number[] = [];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    const Of = (k: number) => k * 4, Ob = (k: number) => k * 4 + 1, If = (k: number) => k * 4 + 2, Ib = (k: number) => k * 4 + 3;
    tris.push(Ob(i), Of(i), Of(j), Ob(i), Of(j), Ob(j)); // outside
    tris.push(Ib(i), If(j), If(i), Ib(i), Ib(j), If(j)); // inside, facing the finger
    tris.push(If(i), If(j), Of(j), If(i), Of(j), Of(i)); // front edge
    tris.push(Ib(i), Ob(i), Ob(j), Ib(i), Ob(j), Ib(j)); // back edge
  }
  return { positions: pos, triangles: Uint32Array.from(tris) };
}

/** Where prong k (1-based) of n sits, clockwise from 12 o'clock seen from above. */
export function prongPlace(view: TemplateView, k: number): { clock: string; pointMm: [number, number, number] } {
  const head = view.head!;
  const n = head.prongCount;
  const deg = ((k - 0.5) * 360) / n;
  const hours = deg / 30;
  const h = Math.floor(hours) === 0 ? 12 : Math.floor(hours);
  const mins = Math.round((hours - Math.floor(hours)) * 60);
  const rho = head.stoneDiameterMm / 2 + head.prongThicknessMm[k - 1]! / 2;
  const top = view.innerDiameterMm / 2 + view.bandThicknessMm + head.seatHeightMm;
  const rad = (deg * Math.PI) / 180;
  const round = (x: number) => Math.round(x * 100) / 100;
  return { clock: `${h}:${String(mins).padStart(2, '0')}`, pointMm: [round(rho * Math.sin(rad)), round(rho * Math.cos(rad)), round(top)] };
}

// ------------------------------------------------------------------- preview

function fillCircle(img: RgbImage, cx: number, cy: number, r0: number, r1: number, color: readonly [number, number, number]): void {
  const x0 = Math.max(0, Math.floor(cx - r1)), x1 = Math.min(img.width - 1, Math.ceil(cx + r1));
  const y0 = Math.max(0, Math.floor(cy - r1)), y1 = Math.min(img.height - 1, Math.ceil(cy + r1));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= r0 && d <= r1) img.rgb.set(color, (y * img.width + x) * 3);
    }
}

function fillRect(img: RgbImage, x0: number, y0: number, x1: number, y1: number, color: readonly [number, number, number]): void {
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(img.height - 1, Math.ceil(y1)); y++)
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(img.width - 1, Math.ceil(x1)); x++) img.rgb.set(color, (y * img.width + x) * 3);
}

/** A schematic front view (looking along the finger), prongs under the limit in red. */
export function stubPreviewPng(view: TemplateView): Buffer {
  const W = 800;
  const img = newImage(W, W, [250, 250, 248]);
  const r = view.innerDiameterMm / 2, R = r + view.bandThicknessMm;
  const head = view.head;
  const top = head ? R + head.seatHeightMm + head.stoneDiameterMm * 0.45 : R;
  const extent = Math.max(2 * R, R + top) * 1.15;
  const px = W / extent;
  const cx = W / 2, cy = W / 2 + ((top - R) * px) / 2;
  fillCircle(img, cx, cy, r * px, R * px, [168, 168, 178]);
  if (head) {
    const zSeat = R + head.seatHeightMm;
    const sr = head.stoneDiameterMm / 2;
    fillCircle(img, cx, cy - zSeat * px, 0, sr * px, [190, 220, 245]);
    head.prongThicknessMm.forEach((t, i) => {
      const place = prongPlace(view, i + 1);
      const x = cx + place.pointMm[0] * px;
      const col: [number, number, number] = t < LIMITS_MM.prong ? [220, 40, 40] : [140, 140, 150];
      fillRect(img, x - (t * px) / 2, cy - (zSeat + head.gripMm + sr * 0.3) * px, x + (t * px) / 2, cy - (R - 0.2) * px, col);
    });
  }
  // A hatched corner marks the picture as a stub.
  for (let y = 0; y < 60; y++) for (let x = 0; x < 60 - y; x++) if ((x + y) % 8 < 4) img.rgb.set([230, 160, 0], (y * W + x) * 3);
  return encodePng(img);
}

// ---------------------------------------------------------------- the checks

export interface CheckEntry {
  id: string;
  name: string;
  limit: string;
  result: 'pass' | 'fail' | 'could_not_run';
  measured: string | null;
  where: Record<string, unknown> | null;
  fix: string | null;
  method: string;
}

export interface CheckReport {
  format: 'flo2-cad.check-report/1';
  piece: string;
  revision: number;
  tree_sha256: string;
  verdict: 'pass' | 'fail';
  export: 'released' | 'refused' | 'not_requested';
  stl: { file: string; sha256: string; bytes: number; triangles: number };
  shrinkage: { applied: boolean; allowance: string };
  checks: CheckEntry[];
  engine: { name: string; version: string; stub: boolean };
  kernel: { name: string; version: string };
  stub_notice?: string;
}

const STUB_METHOD = 'stub: compares the setting with the limit; nothing measured';

export interface CheckRun {
  report: CheckReport;
  stl: Buffer;
  threeMf: Buffer;
  /** One line per failing check: what to thicken and where. */
  fixes: string[];
}

/** Writes the casting file in memory, reads its count and checksum back, and "checks" the settings. */
export function stubCheck(tree: PieceTree, view: TemplateView, mode: 'check' | 'export'): CheckRun {
  const mesh = stubMesh(view);
  const shrink = view.shrinkagePct > 0;
  const header = `${ENGINE_NAME} ${ENGINE_VERSION} ${tree.name} r${tree.revision} binary STL mm shrinkage ${shrink ? `${view.shrinkagePct}%` : 'off'}`;
  const stl = writeBinaryStl(mesh, header);
  // Read back what was written: the report names THAT file's bytes.
  const triangles = stl.readUInt32LE(80);
  const checks: CheckEntry[] = [];
  const fixes: string[] = [];
  const add = (c: Omit<CheckEntry, 'method'>) => checks.push({ ...c, method: STUB_METHOD });

  add({ id: 'watertight', name: 'One watertight solid', limit: 'manifold edges, no self-intersections, faces outward, exactly one shell', result: 'pass', measured: 'stub band only', where: null, fix: null });
  add({
    id: 'band',
    name: 'Ring band thickness',
    limit: `${mm(LIMITS_MM.band)}`,
    result: view.bandThicknessMm >= LIMITS_MM.band ? 'pass' : 'fail',
    measured: `${view.bandThicknessMm} mm`,
    where: { part: 'band', description: 'the band, all the way round' },
    fix: view.bandThicknessMm >= LIMITS_MM.band ? null : `Thicken the band to at least ${mm(LIMITS_MM.band)} (the library default is 1.6 mm): change_piece set {"band_thickness": "1.6 mm"}.`,
  });
  add({
    id: 'wall',
    name: 'Wall thickness',
    limit: `${mm(LIMITS_MM.wall)}`,
    result: view.bandThicknessMm >= LIMITS_MM.wall ? 'pass' : 'fail',
    measured: `${view.bandThicknessMm} mm`,
    where: { part: 'band' },
    fix: view.bandThicknessMm >= LIMITS_MM.wall ? null : `Thicken the band to at least ${mm(LIMITS_MM.wall)}.`,
  });
  if (view.head) {
    const head = view.head;
    const thin = head.prongThicknessMm.map((t, i) => ({ t, k: i + 1 })).filter((p) => p.t < LIMITS_MM.prong);
    const thinnest = head.prongThicknessMm.reduce((a, b) => Math.min(a, b), Infinity);
    const worst = head.prongThicknessMm.indexOf(thinnest) + 1;
    const place = prongPlace(view, worst);
    const where = {
      part: 'head',
      feature: `prong ${worst} of ${head.prongCount}`,
      clock: place.clock,
      point_mm: place.pointMm,
      description: `prong ${worst} of ${head.prongCount}, at ${place.clock} seen from above with the finger pointing to 12 o'clock`,
    };
    let fix: string | null = null;
    if (thin.length > 0) {
      const which = thin.length === head.prongCount ? `all ${head.prongCount} prongs` : thin.map((p) => `prong ${p.k} (at ${prongPlace(view, p.k).clock})`).join(', ');
      fix = `Thicken ${which} to at least ${mm(LIMITS_MM.prong)}; the library default is 1.2 mm. A prong is joined at one end only, so it needs more metal than a wall. Change: ${
        thin.length === head.prongCount ? 'set {"prong_thickness": "1.2 mm"}' : 'set {"head.prong_overrides": []} (or "prong_thickness": "1.2 mm")'
      }.`;
      fixes.push(fix);
    }
    add({ id: 'prong', name: 'Prong thickness', limit: `${mm(LIMITS_MM.prong)}`, result: thin.length ? 'fail' : 'pass', measured: `${thinnest} mm`, where, fix });
    add({ id: 'detail', name: 'Smallest detail', limit: `${mm(LIMITS_MM.detail)}`, result: thinnest >= LIMITS_MM.detail ? 'pass' : 'fail', measured: `${thinnest} mm`, where, fix: null });
  } else {
    add({ id: 'prong', name: 'Prong thickness', limit: `${mm(LIMITS_MM.prong)}`, result: 'pass', measured: 'no prongs (plain band)', where: null, fix: null });
    add({ id: 'detail', name: 'Smallest detail', limit: `${mm(LIMITS_MM.detail)}`, result: 'pass', measured: `${view.bandThicknessMm} mm`, where: null, fix: null });
  }
  if (view.bandThicknessMm < LIMITS_MM.band) fixes.unshift(checks.find((c) => c.id === 'band')!.fix!);
  add({ id: 'gap', name: 'Smallest gap', limit: `${mm(LIMITS_MM.gap)}`, result: 'pass', measured: 'no gaps in this template', where: null, fix: null });
  add({ id: 'surface_deviation', name: 'Surface smoothness', limit: `${mm(LIMITS_MM.surface_deviation)}`, result: 'pass', measured: 'stub', where: null, fix: null });

  const verdict = checks.every((c) => c.result === 'pass') ? 'pass' : 'fail';
  const report: CheckReport = {
    format: 'flo2-cad.check-report/1',
    piece: tree.name,
    revision: tree.revision,
    tree_sha256: sha256(canonicalJson(tree)),
    verdict,
    export: mode === 'check' ? 'not_requested' : verdict === 'pass' ? 'released' : 'refused',
    stl: { file: `${tree.name}.stl`, sha256: sha256(stl), bytes: stl.length, triangles },
    shrinkage: { applied: shrink, allowance: shrink ? `${view.shrinkagePct} %` : 'off' },
    checks,
    engine: { name: ENGINE_NAME, version: ENGINE_VERSION, stub: STUB_ENGINE },
    kernel: { name: KERNEL_NAME, version: KERNEL_VERSION },
  };
  if (STUB_ENGINE) report.stub_notice = STUB_BANNER;
  const threeMf = write3mf(mesh, {
    Title: tree.name,
    Application: `${ENGINE_NAME} ${ENGINE_VERSION}`,
    Designer: 'flo2-cad',
    Description: `revision ${tree.revision}; shrinkage ${report.shrinkage.allowance}`,
  });
  return { report, stl, threeMf, fixes };
}
