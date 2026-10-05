// What the engine takes back from a program's evaluation, and how far it trusts it. Runs in
// the ENGINE's process, on the child's answer (run.ts), before anything is drawn, checked
// or exported.
//
// Nothing in the answer is taken as it came: each field is rebuilt here from the numbers it
// should hold, so a field the engine does not know cannot ride along.
//  · The MESH: finite coordinates within reach of the origin, triangles that index real
//    vertices, sizes within bounds. The casting checker then measures it as it measures
//    any file: watertight, walls, details, gaps (checker/), whatever made it.
//  · The DECLARATIONS (a band, a stone, prongs, a bezel, sheets, blends, named shapes):
//    numbers in the library's own ranges, and, before a check, each one must have metal
//    where it says (declarationProblems): a point inside the band all the way round,
//    inside each prong's column, inside the bezel's wall, on a sheet, and a named shape's
//    box must meet the piece. A program that cut a prong away, or an answer that does not
//    match its mesh, fails the check, naming the part.
//  · The DIMENSIONS the parts report are descriptive only (describe_piece); nothing is
//    checked against them.
//
// THE RESIDUAL RISK, said plainly (and in dec:idea-how-a-program-is-confined). In normal
// running a declaration can only come from a library call (library.ts). A program that
// ESCAPED its context and its child's permissions could write any answer, and these checks
// limit, but do not remove, what a forged declaration could do: a prong declared over
// thick metal beside a thin fin would excuse that fin from the 0.8 mm wall check within
// the prong's column (it is still held to the 0.35 mm detail check); a stone's outline
// drawn larger would make prongs seem to reach further over the girdle; a reference mesh
// sent equal to the file would make the surface check pass. The mesh itself is measured
// whole, so a piece with a hole, a shell or a wall under 0.35 mm is refused whatever is
// declared.

import type { AddedDecl, BandDecl, BezelDecl, BlendDecl, FeatureDecl, P2, P3, ProngDecl, SheetDecl, StoneDecl } from '../checker/features.js';
import type { MeshOut } from '../library/build.js';
import type { ChildRun } from './child.js';
import { MAX_REACH_MM, type PartReport } from './library.js';

export interface RunOut {
  metal: MeshOut;
  stone?: MeshOut;
  decl?: FeatureDecl;
  parts?: PartReport[];
}

const MAX_TRIANGLES = 6_000_000;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
function fin(v: unknown, what: string, lo = -Infinity, hi = Infinity): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${what} is not a number in range`);
  return v;
}
function str(v: unknown, what: string, max = 80): string {
  if (typeof v !== 'string' || v.length > max) throw new Error(`${what} is not a short text`);
  return v;
}
function arr(v: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new Error(`${what} is not a list of at most ${max}`);
  return v;
}
const p2 = (v: unknown, what: string): P2 => {
  const a = arr(v, what, 2);
  return [fin(a[0], what, -MAX_REACH_MM * 2, MAX_REACH_MM * 2), fin(a[1], what, -MAX_REACH_MM * 2, MAX_REACH_MM * 2)];
};
const p3 = (v: unknown, what: string): P3 => {
  const a = arr(v, what, 3);
  return [fin(a[0], what, -MAX_REACH_MM * 2, MAX_REACH_MM * 2), fin(a[1], what, -MAX_REACH_MM * 2, MAX_REACH_MM * 2), fin(a[2], what, -MAX_REACH_MM * 2, MAX_REACH_MM * 2)];
};

function blobOf(blobs: Buffer[], i: unknown, what: string, kind: 'f32' | 'u32'): Float32Array | Uint32Array {
  if (!Number.isInteger(i) || (i as number) < 0 || (i as number) >= blobs.length) throw new Error(`${what} names no data`);
  const b = blobs[i as number]!;
  if (b.length % 4) throw new Error(`${what} is not whole numbers`);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  return kind === 'f32' ? new Float32Array(ab) : new Uint32Array(ab);
}

function readMesh(v: unknown, blobs: Buffer[], what: string, scale: number, positionsOnly: boolean): MeshOut {
  if (!isObj(v)) throw new Error(`${what} is missing`);
  const positions = blobOf(blobs, v['positions'], `${what} vertices`, 'f32') as Float32Array;
  if (positions.length % 3) throw new Error(`${what} vertices are not in threes`);
  const reach = MAX_REACH_MM * Math.max(1, scale) + 1;
  for (const x of positions) if (!(Math.abs(x) <= reach)) throw new Error(`${what} has a vertex out of reach (${x})`);
  if (positionsOnly) return { positions, triangles: new Uint32Array(0) };
  const triangles = blobOf(blobs, v['triangles'], `${what} triangles`, 'u32') as Uint32Array;
  if (triangles.length % 3 || triangles.length / 3 > MAX_TRIANGLES) throw new Error(`${what} triangles are not in threes, or too many`);
  const nv = positions.length / 3;
  for (const t of triangles) if (t >= nv) throw new Error(`${what} has a triangle naming no vertex`);
  return { positions, triangles };
}

const LABEL = /^prong \d{1,2} of \d{1,2}$/;
const ID = /^[a-z][a-z0-9_]{0,39}$/;

/** The declarations, rebuilt field by field, with every number in the range the library builds (times the shrinkage scale). */
function readDecl(v: unknown, blobs: Buffer[], scale: number): FeatureDecl {
  if (!isObj(v)) throw new Error('the declarations are missing');
  const s = Math.max(1, scale);
  const d: FeatureDecl = { prongs: [], scale: fin(v['scale'], 'the scale', 1, 1.05 + 1e-9) };
  if (Math.abs(d.scale - scale) > 1e-9) throw new Error('the declarations are at another scale than asked');
  if (v['band'] !== undefined) {
    const b = v['band'];
    if (!isObj(b)) throw new Error('the band is malformed');
    const band: BandDecl = { innerRadius: fin(b['innerRadius'], 'the band', 1, 60 * s), outerRadius: fin(b['outerRadius'], 'the band', 1, 70 * s), halfWidth: fin(b['halfWidth'], 'the band', 0.25, 6 * s) };
    if (!(band.outerRadius > band.innerRadius)) throw new Error('the band is inside out');
    d.band = band;
  }
  for (const [i, p] of arr(v['prongs'], 'the prongs', 12).entries()) {
    if (!isObj(p)) throw new Error('a prong is malformed');
    const pr: ProngDecl = {
      label: str(p['label'], 'a prong'),
      clock: str(p['clock'], 'a prong', 8),
      axis: p2(p['axis'], 'a prong'),
      nominalDiameter: fin(p['nominalDiameter'], `prong ${i + 1}`, 0.3 - 1e-9, 3 * s + 1e-9),
      sectionFromZ: fin(p['sectionFromZ'], 'a prong', -MAX_REACH_MM * s, MAX_REACH_MM * s),
      sectionToZ: fin(p['sectionToZ'], 'a prong', -MAX_REACH_MM * s, MAX_REACH_MM * s),
    };
    if (!LABEL.test(pr.label) || !(pr.sectionToZ > pr.sectionFromZ) || pr.sectionToZ - pr.sectionFromZ > 40 * s) throw new Error(`${pr.label} is malformed`);
    d.prongs.push(pr);
  }
  if (v['stone'] !== undefined) {
    const st = v['stone'];
    if (!isObj(st)) throw new Error('the stone is malformed');
    const stone: StoneDecl = {
      outline: arr(st['outline'], 'the stone', 4096).map((q) => p2(q, 'the stone')),
      girdleBottomZ: fin(st['girdleBottomZ'], 'the stone', -MAX_REACH_MM * s, MAX_REACH_MM * s),
      girdleTopZ: fin(st['girdleTopZ'], 'the stone', -MAX_REACH_MM * s, MAX_REACH_MM * s),
      crownHeight: fin(st['crownHeight'], 'the stone', 0.01, 20 * s),
    };
    const xs = stone.outline.map((q) => q[0]), ys = stone.outline.map((q) => q[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (stone.outline.length < 3 || !(span >= 0.9 && span <= 31 * s) || stone.girdleTopZ < stone.girdleBottomZ) throw new Error('the stone is out of the range the library sets');
    d.stone = stone;
  }
  if (v['bezel'] !== undefined) {
    const bz = v['bezel'];
    if (!isObj(bz) || !d.stone) throw new Error('the bezel is malformed, or holds no stone');
    const bezel: BezelDecl = { outer: arr(bz['outer'], 'the bezel', 8192).map((q) => p2(q, 'the bezel')), zBottom: fin(bz['zBottom'], 'the bezel', -MAX_REACH_MM * s, MAX_REACH_MM * s), nominalWall: fin(bz['nominalWall'], 'the bezel', 0.3 - 1e-9, 3 * s + 1e-9) };
    if (bezel.outer.length < 3) throw new Error('the bezel has no outline');
    d.bezel = bezel;
  }
  if (d.prongs.length && !d.stone) throw new Error('prongs hold no stone');
  if (v['sheets'] !== undefined) {
    d.sheets = arr(v['sheets'], 'the sheets', 256).map((x): SheetDecl => {
      if (!isObj(x)) throw new Error('a sheet is malformed');
      const points = arr(x['points'], 'a sheet', 2_000_000).map((q) => p3(q, 'a sheet'));
      const normals = arr(x['normals'], 'a sheet', 2_000_000).map((q) => p3(q, 'a sheet'));
      if (points.length !== normals.length) throw new Error('a sheet has points without normals');
      const label = str(x['label'], 'a sheet', 40);
      if (!ID.test(label)) throw new Error('a sheet has no proper name');
      return { label, nominalThickness: fin(x['nominalThickness'], 'a sheet', 0.1 - 1e-9, 5 * s + 1e-9), spacing: fin(x['spacing'], 'a sheet', 1e-6, 10 * s), points, normals };
    });
  }
  if (v['blends'] !== undefined) {
    d.blends = arr(v['blends'], 'the blends', 256).map((x): BlendDecl => {
      if (!isObj(x)) throw new Error('a blend is malformed');
      const label = str(x['label'], 'a blend', 40);
      if (!ID.test(label)) throw new Error('a blend has no proper name');
      const points = blobOf(blobs, x['points'], 'a blend', 'f32') as Float32Array;
      if (points.length % 3) throw new Error('a blend\'s points are not in threes');
      for (const q of points) if (!Number.isFinite(q)) throw new Error('a blend has a point that is not a number');
      return { label, points };
    });
  }
  if (v['added'] !== undefined) {
    d.added = arr(v['added'], 'the named shapes', 4096).map((x): AddedDecl => {
      if (!isObj(x)) throw new Error('a named shape is malformed');
      const id = str(x['id'], 'a named shape', 40);
      if (!ID.test(id)) throw new Error('a named shape has no proper name');
      return { id, min: p3(x['min'], 'a named shape'), max: p3(x['max'], 'a named shape') };
    });
  }
  return d;
}

/** The parts' dimensions, kept only as plain numbers and short words: what describe_piece prints. */
function readParts(v: unknown): PartReport[] {
  const clean = (x: unknown, depth: number): unknown => {
    if (depth > 6) throw new Error('a part report is nested too deep');
    if (typeof x === 'number') return fin(x, 'a dimension');
    if (typeof x === 'string') return str(x, 'a word', 40);
    if (typeof x === 'boolean' || x === null) return x;
    if (Array.isArray(x)) return arr(x, 'a part report', 64).map((y) => clean(y, depth + 1));
    if (isObj(x)) return Object.fromEntries(Object.entries(x).slice(0, 64).map(([k, y]) => [str(k, 'a key', 40), clean(y, depth + 1)]));
    throw new Error('a part report holds something that is not a number or a word');
  };
  return arr(v ?? [], 'the parts', 64).map((p) => {
    const c = clean(p, 0);
    if (!isObj(c) || !['ringShank', 'prongHead', 'bezel'].includes(c['call'] as string)) throw new Error('a part report names no part');
    return c as unknown as PartReport;
  });
}

/** One run of the child's answer, rebuilt and checked (run.ts). */
export function readRun(v: unknown, blobs: Buffer[], spec: ChildRun): RunOut {
  if (!isObj(v)) throw new Error('a run is missing');
  const metal = readMesh(v['metal'], blobs, 'the piece', spec.scale, !!spec.positionsOnly);
  if (spec.positionsOnly) return { metal };
  const out: RunOut = { metal, decl: readDecl(v['decl'], blobs, spec.scale), parts: readParts(v['parts']) };
  if (spec.wantStone && v['stone'] !== undefined) out.stone = readMesh(v['stone'], blobs, 'the stone', spec.scale, false);
  return out;
}

// ------------------------------------------------- does the metal match?

/** Whether p is inside the mesh: two of three rays (along x, y and z, nudged off the grid) cross its surface an odd number of times. */
export function insideMesh(m: MeshOut, p: P3): boolean {
  const P = m.positions, T = m.triangles;
  let votes = 0;
  for (const axis of [0, 1, 2] as const) {
    const u = (axis + 1) % 3, w = (axis + 2) % 3;
    const pu = p[u]! + 1.3e-6 * (axis + 1), pw = p[w]! + 0.7e-6 * (axis + 2);
    let crossings = 0;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t]! * 3, b = T[t + 1]! * 3, c = T[t + 2]! * 3;
      const au = P[a + u]!, aw = P[a + w]!, bu = P[b + u]!, bw = P[b + w]!, cu = P[c + u]!, cw = P[c + w]!;
      if ((pu < au && pu < bu && pu < cu) || (pu > au && pu > bu && pu > cu) || (pw < aw && pw < bw && pw < cw) || (pw > aw && pw > bw && pw > cw)) continue;
      const det = (bu - au) * (cw - aw) - (cu - au) * (bw - aw);
      if (Math.abs(det) < 1e-18) continue;
      const s1 = ((pu - au) * (cw - aw) - (cu - au) * (pw - aw)) / det;
      const s2 = ((bu - au) * (pw - aw) - (pu - au) * (bw - aw)) / det;
      if (s1 < 0 || s2 < 0 || s1 + s2 > 1) continue;
      const along = P[a + axis]! + s1 * (P[b + axis]! - P[a + axis]!) + s2 * (P[c + axis]! - P[a + axis]!);
      if (along > p[axis]!) crossings++;
    }
    if (crossings % 2 === 1) votes++;
  }
  return votes >= 2;
}

/**
 * Every declaration that has no metal where it says, in plain words. Empty when the
 * declarations match the piece. A check of a program's piece runs only when this is empty.
 */
export function declarationProblems(m: MeshOut, d: FeatureDecl): string[] {
  const problems: string[] = [];
  if (d.band) {
    const r = (d.band.innerRadius + d.band.outerRadius) / 2;
    for (let deg = 0; deg < 360; deg += 45) {
      const a = (deg * Math.PI) / 180;
      if (!insideMesh(m, [Math.sin(a) * r, 0, Math.cos(a) * r])) {
        problems.push(`the ring band (ringShank) has no metal ${deg}° round from the top: something cut it there. A band that is open or cut away is built with your own shapes, not ringShank.`);
        break;
      }
    }
  }
  for (const p of d.prongs) {
    const z = p.sectionFromZ + Math.min(0.1, (p.sectionToZ - p.sectionFromZ) / 4);
    if (!insideMesh(m, [p.axis[0], p.axis[1], z])) problems.push(`${p.label} (prongHead) at ${p.clock} has no metal in its column: something cut it away.`);
  }
  if (d.bezel && d.stone) {
    const o = d.bezel.outer;
    const cx = o.reduce((s, q) => s + q[0], 0) / o.length, cy = o.reduce((s, q) => s + q[1], 0) / o.length;
    const half = d.bezel.nominalWall / 2;
    for (let k = 0; k < 8; k++) {
      const q = o[Math.floor((k * o.length) / 8)]!;
      const l = Math.hypot(cx - q[0], cy - q[1]) || 1;
      if (!insideMesh(m, [q[0] + ((cx - q[0]) * half) / l, q[1] + ((cy - q[1]) * half) / l, d.stone.girdleTopZ])) {
        problems.push('the bezel (bezel) has no metal in its wall at the girdle: something cut it away.');
        break;
      }
    }
  }
  for (const sh of d.sheets ?? []) {
    const n = sh.points.length;
    const step = Math.max(1, Math.floor(n / 16));
    let any = false;
    for (let i = 0; i < n && !any; i += step) any = insideMesh(m, sh.points[i]!);
    if (!any) problems.push(`the sheet "${sh.label}" (thicken) has no metal where it was made: something cut it away.`);
  }
  if (d.added?.length) {
    const P = m.positions;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, P[i + k]!);
      hi[k] = Math.max(hi[k]!, P[i + k]!);
    }
    for (const a of d.added) {
      if ([0, 1, 2].some((k) => a.max[k]! < lo[k]! - 0.01 || a.min[k]! > hi[k]! + 0.01)) problems.push(`the shape named "${a.id}" lies outside the piece.`);
    }
  }
  return problems;
}
