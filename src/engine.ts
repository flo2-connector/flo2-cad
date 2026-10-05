// The engine behind the tools: build a piece with the library and kernel, draw
// it, and check and export it. A casting file is released ONLY when every check
// passes on the file as written (con:no-casting-export-unless-every-check-passes):
// the STL is written to bytes first, the independent checker reads those bytes
// back, and the very same bytes are what an export releases.

import { createHash } from 'node:crypto';
import { quoteIds, runChecks, type CheckEntry, type CheckLimits } from './checker/check.js';
import type { FeatureDecl } from './checker/features.js';
import { writeBinaryStl } from './files/stl.js';
import { write3mf } from './files/threemf.js';
import { buildPiece, EXPORT_TOL, PREVIEW_TOL, REFERENCE_TOL, type Across, type Built, type MeshOut, type PieceDims } from './library/build.js';
import { METALS, SETTING, type Metal } from './metals.js';
import { isProgramPiece, type Piece, type ProgramPiece } from './piece/program.js';
import { findNode, readPiece, shrinkagePercent, STONE_DEFAULTS, type PieceTree, type PieceView, type TreeNode } from './piece/tree.js';
import type { PartReport } from './program/library.js';
import { ProgramFailed, programLimits, runProgram, type ProgramLimits } from './program/run.js';
import { declarationProblems, type RunOut } from './program/verify.js';
import type { Mesh } from './kernel/manifold.js';
import { lengthMm } from './units.js';
import { reachDeg, sheetSpec } from './library/thicken.js';
import { programImagesReport, reliefImagesOf } from './library/relief.js';
import { renderPreview, type RenderItem, type ViewName } from './render/render.js';
import { ENGINE_NAME, ENGINE_VERSION, KERNEL_NAME, KERNEL_VERSION } from './version.js';

export const METAL_COLOR: Readonly<Record<string, readonly [number, number, number]>> = {
  sterling_silver_925: [200, 202, 208],
  gold_14k_yellow: [232, 186, 96],
  gold_18k_yellow: [240, 192, 92],
  platinum_950: [214, 216, 222],
};
const STONE_COLOR = [200, 228, 250] as const;

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

export const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const r2 = (x: number) => Math.round(x * 100) / 100;

export function limitsFor(metal: Metal): CheckLimits {
  return { ...metal.limits, gripMin: SETTING.gripMin, lipMinOfCrown: SETTING.lipMinOfCrown, lipMaxOfCrown: SETTING.lipMaxOfCrown };
}

// --------------------------------------------------------------- the words

export function stoneWords(v: PieceView): string {
  const h = v.head;
  if (!h) return 'no stone (a plain band)';
  const s = h.stone;
  const dims = s.shape === 'round' ? `${s.lengthMm} mm round brilliant, ${s.depthMm} mm deep` : `${s.lengthMm} × ${s.widthMm} × ${s.depthMm} mm emerald cut, set ${s.orientation.replace('_', '-')}`;
  const carat = s.carat ? ` (${s.carat} on its report)` : '';
  const how =
    h.kind === 'prong_head'
      ? `in a ${h.prongCount}-prong head (prongs ${[...new Set(h.prongThicknessMm)].join(' / ')} mm)`
      : `in a full bezel (rim ${h.wallMm} mm thick, lip ${h.lipMm === 'auto' ? 'auto' : `${h.lipMm} mm`})`;
  return `one ${dims}${carat} ${how}`;
}

export function placeholderNote(v: PieceView): string | null {
  const s = v.head?.stone;
  if (!s || !s.placeholder.length) return null;
  const typical =
    s.shape === 'emerald'
      ? `a typical 2.00 ct emerald cut, ${STONE_DEFAULTS.emerald.length} × ${STONE_DEFAULTS.emerald.width} × ${STONE_DEFAULTS.emerald.depth}`
      : `a typical 1.00 ct round, ${STONE_DEFAULTS.round.diameter} × ${STONE_DEFAULTS.round.depth}`;
  return `The stone's ${s.placeholder.join(', ')} ${s.placeholder.length === 1 ? 'is a placeholder' : 'are placeholders'} (${typical}). Give the measured ${s.shape === 'round' ? 'diameter and depth' : 'length, width and depth'} from the stone's grading report.`;
}

export function summary(tree: PieceTree, v: PieceView = readPiece(tree)): string {
  const metal = METALS[v.metal];
  const band = `${v.ringSize.system} size ${v.ringSize.size} (inner diameter ${v.innerDiameterMm.toFixed(2)} mm), ${v.profile.replace('_', '-')} band ${v.bandWidthMm} mm wide and ${v.bandThicknessMm} mm thick`;
  const kind = !v.head ? 'Plain band' : v.head.kind === 'bezel' ? 'Bezel solitaire' : 'Solitaire ring';
  const extras = v.extras.length ? ` Plus ${v.extras.length} added shape(s): ${v.extras.map((e) => `"${e.id}"`).join(', ')}.` : '';
  return `${kind} "${tree.name}", revision ${tree.revision}, in ${metal.name}: ${band}, ${stoneWords(v)}. Shrinkage allowance: ${tree.shrinkage}.${extras}`;
}

// ----------------------------------------------------- the dimensions

/** A length in mm to 0.01 mm, always with two decimals, so a reader sees the resolution. */
const mm2 = (x: number) => `${r2(x).toFixed(2)} mm`;

/** A size seen from above: "7.60 mm" for a round, "8.60 × 6.10 mm" (length × width) for an emerald cut. */
function acrossText(a: Across, shape: 'round' | 'emerald' | 'custom'): string {
  return shape === 'round' ? mm2(a.lengthMm) : `${r2(a.lengthMm).toFixed(2)} × ${mm2(a.widthMm)}`;
}

/**
 * The dimensions a check or a decision rests on, as the build makes them (pieceDims in
 * the library): the band, and the stone's seat, the bezel or each prong, and the room
 * under the stone. describe_piece reports them, so a fit or a weight is worked from the
 * engine's own numbers, never an assumed one.
 */
export function dimensionLines(d: PieceDims): string[] {
  const b = d.band;
  const lines = [`- Band: inner diameter ${mm2(b.innerDiameterMm)}, outer diameter ${mm2(b.outerDiameterMm)}, ${mm2(b.widthMm)} wide, ${mm2(b.thicknessMm)} thick.`];
  const h = d.head;
  if (!h) return lines;
  const stone = acrossText(h.stone, h.shape);
  const seat = `${acrossText(h.seat, h.shape)} across`;
  if (h.bezel) {
    const z = h.bezel;
    lines.push(`- Seat: ${seat} inside the bezel at the girdle, for the ${stone} stone, so ${mm2(h.seat.clearanceMm)} clearance a side.`);
    lines.push(
      `- Bezel: wall ${mm2(z.wallMm)} thick and ${acrossText(h.outside, h.shape)} across outside; its lip rises ${mm2(z.lipMm)} above the girdle (${z.lipAuto ? 'auto' : 'set'}: ${Math.round((z.lipMm / h.stone.crownMm) * 100)} % of the stone's ${mm2(h.stone.crownMm)} crown); it stands ${mm2(z.heightAboveBandMm)} above the top of the band.`,
    );
  } else if (h.prongs) {
    const ps = h.prongs;
    lines.push(`- Seat: ${seat} at the girdle, cut for the ${stone} stone, so ${mm2(h.seat.clearanceMm)} clearance a side.`);
    const same = new Set(ps.map((p) => `${r2(p.thicknessMm)}/${r2(p.narrowestMm)}`)).size === 1;
    const reaches = [...new Set(ps.map((p) => r2(p.reachMm)))].sort((a, c) => a - c);
    const reach = reaches.length === 1 ? `each reaches ${mm2(reaches[0]!)} in over the girdle` : `they reach ${mm2(reaches[0]!)} to ${mm2(reaches[reaches.length - 1]!)} in over the girdle`;
    const each = same
      ? `${ps.length}, each ${mm2(ps[0]!.thicknessMm)} thick and ${mm2(ps[0]!.narrowestMm)} at its narrowest, where the seat is cut`
      : `${ps.length}, each narrowest where the seat is cut: ${ps.map((p) => `${p.label.split(' of ')[0]} at ${p.clock} is ${mm2(p.thicknessMm)} thick and ${mm2(p.narrowestMm)} at its narrowest`).join('; ')}`;
    lines.push(`- Prongs: ${each}; ${reach}. The head is ${acrossText(h.outside, h.shape)} across at its widest, at its rail.`);
  }
  lines.push(`- Culet clearance: ${mm2(h.culetClearanceMm)} from the stone's point down to the top of the band.`);
  return lines;
}

/** One short line for start_piece and change_piece: the seat and the head's outside. Null for a plain band. */
export function seatLine(d: PieceDims): string | null {
  const h = d.head;
  if (!h) return null;
  const seat = `Seat ${acrossText(h.seat, h.shape)} across, ${mm2(h.seat.clearanceMm)} clearance a side`;
  if (h.bezel) return `${seat}; bezel ${acrossText(h.outside, h.shape)} across outside, lip ${mm2(h.bezel.lipMm)} above the girdle.`;
  const thinnest = Math.min(...(h.prongs ?? []).map((p) => p.narrowestMm));
  return `${seat}; head ${acrossText(h.outside, h.shape)} across at its widest; prongs ${mm2(thinnest)} at their narrowest.`;
}

// --------------------------------------------------------------- preview

export async function preview(tree: PieceTree, views: ViewName[]): Promise<{ png: Buffer; built: Built; ms: number }> {
  const t0 = performance.now();
  const built = await buildPiece(tree, { tol: PREVIEW_TOL, applyShrinkage: false });
  const v = built.view;
  const items: RenderItem[] = [{ ...built.metal, kind: 'metal', color: METAL_COLOR[v.metal] ?? [200, 200, 200] }];
  if (built.stone) items.push({ ...built.stone, kind: 'stone', color: STONE_COLOR });
  const head = `${tree.name} rev ${tree.revision} - ${METALS[v.metal].name} - ${v.ringSize.system} ${v.ringSize.size} (${v.innerDiameterMm.toFixed(2)} mm inside)`;
  const s = v.head?.stone;
  const stoneLine = !v.head
    ? 'plain band'
    : `${s!.shape === 'round' ? `${s!.lengthMm} mm round` : `${s!.lengthMm} x ${s!.widthMm} mm emerald cut ${s!.orientation.replace('_', '-')}`}, ${s!.depthMm} mm deep, in a ${v.head.kind === 'bezel' ? 'full bezel' : `${v.head.prongCount}-prong head`}`;
  const warnings: string[] = [];
  const ph = placeholderNote(v);
  if (ph) warnings.push(`PLACEHOLDER STONE SIZE: ${ph}`);
  const png = renderPreview(items, views, {
    header: [head, stoneLine],
    warnings,
    focusAboveZ: built.dims.head ? built.dims.band.outerDiameterMm / 2 - 1.2 : undefined,
  });
  return { png, built, ms: performance.now() - t0 };
}

// ------------------------------------------------------- check and export

export interface CheckOutcome {
  verdict: 'pass' | 'fail';
  report: Record<string, unknown>;
  entries: (CheckEntry & { fix: string | null })[];
  fixes: string[];
  stl: Buffer | null;
  threeMf: Buffer | null;
  ms: { build: number; check: number; total: number };
}

function suggestThicker(current: number, measured: number, limit: number): number {
  return Math.ceil((current + (limit - measured) + 0.1) * 10) / 10;
}

/** A thicken node among the piece's added shapes, by id. */
function sheetNode(v: PieceView, id: string): TreeNode | undefined {
  for (const e of v.extras) {
    const n = findNode(e, id);
    if (n?.op === 'thicken') return n;
  }
  return undefined;
}

/** A sheet's thickness as the tree sets it (before any shrinkage allowance). */
function sheetThickness(v: PieceView, id: string): number | undefined {
  const n = sheetNode(v, id);
  return n ? lengthMm(n.params?.['thickness'], `${id}.thickness`) : undefined;
}

/**
 * The round_corners that leaves no part of a sheet narrower than `across` mm on its
 * surface. Rounding the outline by r leaves nothing narrower than 2r in the outline;
 * laid on a sphere, widths narrow by sin θ / θ at θ round from the origin, so r is
 * taken at the outline's farthest reach.
 */
function roundingFor(n: TreeNode | undefined, across: number): number {
  let narrowing = 1;
  if (n) {
    const s = sheetSpec(n);
    const th = (reachDeg(s.outline, s) * Math.PI) / 180;
    if (s.surface === 'sphere' && th > 1e-6) narrowing = Math.sin(th) / th;
  }
  return Math.ceil(((across / 2 + 0.05) / narrowing) * 20) / 20;
}

/** What to thicken and where, in the person's terms, for one failing check. */
function fixFor(e: CheckEntry, v: PieceView, metal: Metal): string | null {
  if (e.result === 'pass') return null;
  if (e.result === 'could_not_run') return `A check could not run (${e.name}: ${e.measured}). A check that cannot run counts as a fail, so nothing is exported until it can.`;
  const h = v.head;
  switch (e.id) {
    case 'prong': {
      if (!h || h.kind !== 'prong_head') return null;
      const lines = (e.failing ?? []).map((f) => {
        const k = Number(/prong (\d+)/.exec(f.label)?.[1] ?? 0);
        const cur = h.prongThicknessMm[k - 1] ?? h.nominalProngMm;
        return `Thicken ${f.label} at ${f.where.clock}: its narrowest section is ${f.value} mm, where the seat for the stone is cut, and it needs ${metal.limits.prong.toFixed(1)} mm. Make that prong at least ${suggestThicker(cur, f.value, metal.limits.prong)} mm thick.`;
      });
      const all = (e.failing ?? []).length === h.prongCount;
      const worst = Math.min(...(e.failing ?? []).map((f) => f.value));
      const suggestion = suggestThicker(h.nominalProngMm, worst, metal.limits.prong);
      return `${lines.join(' ')} ${all ? `Change: set {"prong_thickness": "${Math.max(suggestion, 1.4)} mm"}.` : `Change: set {"head.prong_overrides": []} to give every prong the head's prong_thickness, or set that prong's own thickness in "head.prong_overrides".`} A prong is joined at one end only, so it needs more metal than a wall.`;
    }
    case 'band':
      return `Thicken the band: its thinnest section is ${e.value} mm (${e.where?.feature}), and a band needs ${metal.limits.band.toFixed(1)} mm. Change: set {"band_thickness": "${Math.max(1.6, suggestThicker(v.bandThicknessMm, e.value ?? 0, metal.limits.band))} mm"}.`;
    case 'bezel_wall':
      if (!h || h.kind !== 'bezel') return null;
      return `Thicken the bezel rim: it is ${e.value} mm at ${e.where?.clock} seen from above, and a wall needs ${metal.limits.wall.toFixed(1)} mm. Change: set {"bezel_wall": "${Math.max(1.0, suggestThicker(h.wallMm, e.value ?? 0, metal.limits.wall))} mm"}.`;
    case 'bezel_lip': {
      if (!h || h.kind !== 'bezel') return null;
      const m = /\(([\d.]+) mm to ([\d.]+) mm/.exec(e.limit);
      const lo = Number(m?.[1] ?? 0), hi = Number(m?.[2] ?? 0);
      return (e.value ?? 0) < lo
        ? `Raise the bezel lip: it rises ${e.value} mm above the girdle, too little to be pushed over the stone. Change: set {"bezel_lip": "${r2((lo + hi) / 2)} mm"} (or "auto").`
        : `Lower the bezel lip: it rises ${e.value} mm above the girdle and would cover too much of the stone. Change: set {"bezel_lip": "${r2((lo + hi) / 2)} mm"} (or "auto").`;
    }
    case 'sheet': {
      const each = (e.failing ?? []).map((f) => {
        const cur = sheetThickness(v, f.label) ?? f.nominal ?? f.value;
        return { f, cur, to: Math.max(1.0, suggestThicker(cur, f.value, metal.limits.wall)) };
      });
      const lines = each.map(({ f, cur }) => `Thicken the sheet "${f.label}": measured square to its surface it is ${f.value} mm (its thickness is set to ${cur} mm), and a wall needs ${metal.limits.wall.toFixed(1)} mm.`);
      const set = each.map(({ f, to }) => `"${f.label}.thickness": "${to} mm"`).join(', ');
      return `${lines.join(' ')} Change: set {${set}}.`;
    }
    case 'prong_grip':
      return `${(e.failing ?? []).map((f) => `${f.label} at ${f.where.clock} reaches only ${f.value} mm over the girdle`).join('; ')}; each must reach ${SETTING.gripMin} mm to hold the stone. Change: set {"head.prong_grip": "0.2 mm"}.`;
    case 'wall': {
      const part = e.where?.feature ?? e.where?.part ?? 'the piece';
      if (/prong/.test(part) && h?.kind === 'prong_head') return `Thicken ${part}: a wall there is ${e.value} mm and needs ${metal.limits.wall.toFixed(1)} mm. Raise prong_thickness.`;
      if (part === 'bezel' && h?.kind === 'bezel') return `Thicken the bezel rim: a wall there is ${e.value} mm and needs ${metal.limits.wall.toFixed(1)} mm. Raise bezel_wall.`;
      if (e.where?.part === 'band') return `Thicken the band: a wall there is ${e.value} mm (${part}) and needs ${metal.limits.wall.toFixed(1)} mm. Raise band_thickness.`;
      if (e.where?.part === 'sheet' && e.where.meets?.length) {
        const names = [part, ...e.where.meets].map((x) => `"${x}"`).join(' and ');
        return `Where the sheets ${names} meet, at ${JSON.stringify(e.where.point_mm)} mm, the metal between them is ${e.value} mm across, and a wall needs ${metal.limits.wall.toFixed(1)} mm. Move or turn them so they either stay apart there or overlap squarely, with no thin wedge between them.`;
      }
      if (e.where?.part === 'sheet' && sheetNode(v, part)) {
        // The sheet itself is thick enough (the sheet check says so, or this advice is
        // dropped), so the metal is thin some other way here: across a narrow part of
        // the outline, or in a wedge where the sheet joins other metal.
        const rc = roundingFor(sheetNode(v, part), metal.limits.wall);
        return `The metal at the sheet "${part}" is only ${e.value} mm at ${JSON.stringify(e.where.point_mm)} mm, and a wall needs ${metal.limits.wall.toFixed(1)} mm. The sheet itself is thick enough square to its surface, so the thin place is either a narrow part of its outline (a pointed tip or a thin neck: widen it, or set {"${part}.round_corners": "${rc} mm"}, which leaves no part of the sheet narrower than ${(metal.limits.wall + 0.1).toFixed(1)} mm) or a thin wedge where it joins other metal (move it so it meets that metal squarely, or bury its edge deeper).`;
      }
      if (e.where?.part === 'added shape' && reliefAmong(v, part)) {
        return `The relief ${quoteIds(part)} is only ${e.value} mm thick at ${JSON.stringify(e.where.point_mm)} mm, and a wall needs ${metal.limits.wall.toFixed(1)} mm. Give it more metal under its face: raise its "base" (a sunk relief's floor is its base less its depth), or lay it on thicker metal; a lower "depth" or a larger "smoothing" makes its slopes gentler.`;
      }
      if (e.where?.part === 'added shape') {
        return `Thicken the added shape ${quoteIds(part)}: a wall in it is ${e.value} mm at ${JSON.stringify(e.where.point_mm)} mm and needs ${metal.limits.wall.toFixed(1)} mm. Change that shape's own settings ("<node id>.<setting>"); the thin metal lies outside the band's own section, so band_thickness does not reach it.`;
      }
      return `Thicken the thinnest wall, ${e.value} mm at ${JSON.stringify(e.where?.point_mm)} mm, to at least ${metal.limits.wall.toFixed(1)} mm.`;
    }
    case 'detail':
      if (e.where?.part === 'sheet' && e.where.feature && e.where.meets?.length) {
        const names = [e.where.feature, ...e.where.meets].map((x) => `"${x}"`).join(' and ');
        return `Where the sheets ${names} meet, at ${JSON.stringify(e.where.point_mm)} mm, the metal between them is only ${e.value} mm across (the finest detail must be ${metal.limits.detail} mm). Move or turn them so they either stay apart there or overlap squarely, with no thin wedge between them.`;
      }
      if (e.where?.part === 'sheet' && e.where.feature && sheetNode(v, e.where.feature)) {
        return `The finest detail, ${e.value} mm across, is at the sheet "${e.where.feature}", at ${JSON.stringify(e.where.point_mm)} mm; it must be at least ${metal.limits.detail} mm. Widen or round that part of its outline (set {"${e.where.feature}.round_corners": "${roundingFor(sheetNode(v, e.where.feature), metal.limits.wall)} mm"}), or, if it is a wedge where the sheet joins other metal, move the sheet so it meets that metal squarely.`;
      }
      return `The finest detail is ${e.value} mm across at ${JSON.stringify(e.where?.point_mm)}; make it at least ${metal.limits.detail} mm, or remove it.`;
    case 'gap':
      return `Two surfaces are only ${e.value} mm apart at ${JSON.stringify(e.where?.point_mm)} mm; open the gap to at least ${metal.limits.gap} mm in ${metal.name}, or close it completely.`;
    case 'watertight':
      return `The piece is not one closed solid (${e.measured}). Join any added shape to the ring, or remove it.`;
    case 'surface_deviation':
      return `The casting file's facets stand ${e.value} mm off the curved surface, over the ${metal.limits.surfaceDeviation} mm limit. This is an engine fault, not the design: report it.`;
  }
  return null;
}

/** Whether the added shape(s) a thin place is named by hold a relief (by the ids the checker names, "a, b"). */
function reliefAmong(v: PieceView, ids: string): boolean {
  const holds = (n: TreeNode | undefined): boolean => !!n && (n.op === 'relief' || (n.children ?? []).some(holds));
  return ids.split(', ').some((id) => v.extras.some((x) => holds(findNode(x as TreeNode, id))));
}

/** The height images a tree's reliefs read, with their hashes, for the check report: the casting file's provenance. */
function treeImages(tree: PieceTree): ReturnType<typeof reliefImagesOf> {
  try {
    return reliefImagesOf(tree.root);
  } catch {
    return [];
  }
}

function couldNotRun(msg: string): CheckEntry[] {
  return (['watertight', 'wall', 'band', 'detail', 'gap', 'surface_deviation'] as const).map((id) => ({
    id,
    name: id,
    limit: '-',
    result: 'could_not_run' as const,
    measured: msg,
    where: null,
    method: 'the piece could not be built, so the check could not run',
  }));
}

export async function checkPiece(piece: Piece, mode: 'check' | 'export', limits: ProgramLimits = programLimits()): Promise<CheckOutcome> {
  if (isProgramPiece(piece)) return checkProgram(piece, mode, limits);
  const tree = piece;
  const t0 = performance.now();
  const v = readPiece(tree);
  const metal = METALS[v.metal];
  let built: Built | null = null;
  let stl: Buffer | null = null;
  let entries: CheckEntry[];
  let meshInfo = { triangles: 0, vertices: 0, shells: 0, volumeMm3: 0 };
  let tBuild = 0, tCheck = 0;
  try {
    // Each blend's level set, built once for the casting file and taken again by the reference build.
    const meshes = new Map<string, Mesh>();
    built = await buildPiece(tree, { tol: EXPORT_TOL, applyShrinkage: true, blendSurface: true, blendMeshes: { meshes, reuse: false } });
    tBuild = performance.now() - t0;
    const shrink = v.shrinkagePct > 0 ? `${v.shrinkagePct}%` : 'off';
    stl = writeBinaryStl(built.metal, `${ENGINE_NAME} ${ENGINE_VERSION} ${tree.name} r${tree.revision} ${v.metal} mm shrinkage ${shrink}`);
    // The same piece, far more finely tessellated: what the surface check measures against.
    const ref = await buildPiece(tree, { tol: REFERENCE_TOL, applyShrinkage: true, blendMeshes: { meshes, reuse: true } });
    const refStl = writeBinaryStl(ref.metal, 'flo2-cad reference');
    tBuild = performance.now() - t0;
    const run = runChecks(stl, built.decl, limitsFor(metal), refStl);
    entries = run.entries;
    meshInfo = run.mesh;
    tCheck = run.ms;
  } catch (err) {
    entries = couldNotRun(`the piece could not be built: ${err instanceof Error ? err.message : String(err)}`);
  }
  const withFix = entries.map((e) => ({ ...e, fix: fixFor(e, v, metal) }));
  // One fix per place: when a prong or the bezel fails its own check, the wall and
  // detail checks that tripped on the same feature need no second instruction.
  const failingProngs = new Set((withFix.find((e) => e.id === 'prong' && e.result === 'fail')?.failing ?? []).map((f) => f.label));
  const bezelFails = withFix.some((e) => e.id === 'bezel_wall' && e.result === 'fail');
  const failingSheets = new Set((withFix.find((e) => e.id === 'sheet' && e.result === 'fail')?.failing ?? []).map((f) => f.label));
  for (const e of withFix) {
    if ((e.id === 'wall' || e.id === 'detail') && e.result === 'fail') {
      const f = e.where?.feature;
      if ((f && failingProngs.has(f)) || (f === 'bezel' && bezelFails) || (e.where?.part === 'sheet' && f && failingSheets.has(f))) e.fix = null;
    }
  }
  const verdict = withFix.every((e) => e.result === 'pass') ? 'pass' : 'fail';
  const fixes = withFix.filter((e) => e.fix).map((e) => e.fix!);
  const shrinkApplied = v.shrinkagePct > 0;
  const s = v.head?.stone;
  const report: Record<string, unknown> = {
    format: 'flo2-cad.check-report/1',
    piece: tree.name,
    revision: tree.revision,
    tree_sha256: sha256(canonicalJson(tree)),
    verdict,
    export: mode === 'check' ? 'not_requested' : verdict === 'pass' ? 'released' : 'refused',
    metal: { id: metal.id, name: metal.name, density_g_cm3: metal.density, casting_note: metal.castingNote },
    stl: stl ? { file: `${tree.name}.stl`, sha256: sha256(stl), bytes: stl.length, triangles: meshInfo.triangles, units: 'mm' } : null,
    shrinkage: { applied: shrinkApplied, allowance: shrinkApplied ? `${v.shrinkagePct} %` : 'off' },
    stone: s
      ? {
          in_casting_file: false,
          shape: s.shape,
          measured_mm: s.shape === 'round' ? { diameter: s.lengthMm, depth: s.depthMm } : { length: s.lengthMm, width: s.widthMm, depth: s.depthMm },
          orientation: s.shape === 'emerald' ? s.orientation : null,
          carat_for_reference: s.carat ?? null,
          placeholder: s.placeholder,
        }
      : null,
    volume_mm3: r2(meshInfo.volumeMm3),
    weight_g: r2((meshInfo.volumeMm3 / 1000) * metal.density),
    checks: withFix,
    limits: { ...limitsFor(metal), units: 'mm', sources: [...metal.sources, ...SETTING.sources] },
    engine: { name: ENGINE_NAME, version: ENGINE_VERSION },
    kernel: { name: KERNEL_NAME, version: KERNEL_VERSION, unmodified: true },
    timing_ms: { build: Math.round(tBuild), check: Math.round(tCheck), total: Math.round(performance.now() - t0) },
  };
  const images = treeImages(tree);
  if (images.length) report['images'] = images;
  let threeMf: Buffer | null = null;
  if (built && stl && verdict === 'pass' && mode === 'export') {
    threeMf = write3mf(built.metal, {
      Title: tree.name,
      Application: `${ENGINE_NAME} ${ENGINE_VERSION} (${KERNEL_NAME} ${KERNEL_VERSION})`,
      Description: `revision ${tree.revision}; ${metal.name}; shrinkage ${shrinkApplied ? `${v.shrinkagePct} % applied` : 'not applied'}; stone not included`,
    });
  }
  return { verdict, report, entries: withFix, fixes, stl, threeMf, ms: { build: tBuild, check: tCheck, total: performance.now() - t0 } };
}

// --------------------------------------------------------------- describe

export async function describeNumbers(tree: PieceTree): Promise<{ volumeMm3: number; size: [number, number, number]; weights: { metal: string; grams: number }[]; dims: PieceDims }> {
  const built = await buildPiece(tree, { tol: PREVIEW_TOL, applyShrinkage: false });
  const size: [number, number, number] = [0, 1, 2].map((k) => r2(built.bbox.max[k]! - built.bbox.min[k]!)) as [number, number, number];
  const weights = Object.values(METALS).map((m) => ({ metal: m.name, grams: r2((built.volumeMm3 / 1000) * m.density) }));
  return { volumeMm3: r2(built.volumeMm3), size, weights, dims: built.dims };
}

// ------------------------------------------------------------ program pieces
//
// A piece written as a program (cap:the-agent-writes-a-piece-as-a-program) is evaluated
// in a confined child process (src/program/run.ts) at the tolerance each step needs:
// preview's for a picture or a description, and for a check or an export, the casting
// file's and the finer reference's, with the shrinkage allowance applied in the child as a
// tree's build applies it. What comes back is a mesh and the declarations its library calls
// made; from there the steps are the tree's own: the STL is written HERE from that mesh,
// read back by the independent checker, measured against the same limits, and released
// only when every check passes on those very bytes.

/** A program piece evaluated for a picture or a description. */
export interface ProgramView {
  run: RunOut;
  logs: string[];
  ms: number;
  peakRssMiB: number | null;
}

/** Evaluates a program piece at the preview tolerance, confined. Rejects with ProgramFailed. */
export async function evaluateProgram(p: ProgramPiece, limits: ProgramLimits = programLimits()): Promise<ProgramView> {
  const r = await runProgram(p.program, [{ tol: PREVIEW_TOL, scale: 1, wantStone: true }], limits);
  return { run: r.runs[0]!, logs: r.logs, ms: r.ms, peakRssMiB: r.peakRssMiB };
}

/** A closed mesh's volume (the divergence theorem over its triangles), in mm³. */
export function meshVolume(m: MeshOut): number {
  const P = m.positions, T = m.triangles;
  let v = 0;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t]! * 3, b = T[t + 1]! * 3, c = T[t + 2]! * 3;
    v += P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) - P[a + 1]! * (P[b]! * P[c + 2]! - P[b + 2]! * P[c]!) + P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!);
  }
  return v / 6;
}

function meshSize(m: MeshOut): [number, number, number] {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k]!, m.positions[i + k]!);
    hi[k] = Math.max(hi[k]!, m.positions[i + k]!);
  }
  return [0, 1, 2].map((k) => (m.positions.length ? r2(hi[k]! - lo[k]!) : 0)) as [number, number, number];
}

const NO_BAND: PieceDims['band'] = { innerDiameterMm: 0, outerDiameterMm: 0, widthMm: 0, thicknessMm: 0 };

function stoneOfPart(part: Extract<PartReport, { call: 'prongHead' | 'bezel' }>): string {
  const s = part.head.stone;
  const own = part.stone.shape === 'custom' ? ` stone of its own shape${part.stone.name ? ` ("${part.stone.name}")` : ''}` : part.stone.shape === 'round' ? ' round brilliant' : ' emerald cut';
  return `${part.stone.shape === 'round' ? `${mm2(s.lengthMm)}` : `${r2(s.lengthMm).toFixed(2)} × ${mm2(s.widthMm)}`}${own}, ${mm2(s.depthMm)} deep`;
}

/** The parts a program's piece holds, in a jeweler's words. */
export function programPartsWords(parts: readonly PartReport[]): string {
  const words = parts.map((part) => {
    if (part.call === 'ringShank') return `a ring shank, ${part.ringSize.system} size ${part.ringSize.size} (inner diameter ${part.band.innerDiameterMm.toFixed(2)} mm), ${part.band.widthMm} mm wide and ${part.band.thicknessMm} mm thick`;
    const how = part.call === 'bezel' ? `a full bezel (wall ${mm2(part.head.bezel!.wallMm)}, lip ${mm2(part.head.bezel!.lipMm)} above the girdle)` : `a ${part.head.prongs!.length}-prong head`;
    return `${how} holding one ${stoneOfPart(part)}`;
  });
  return words.length ? words.join('; ') : 'shapes of its own (no library part)';
}

export function programSummary(p: ProgramPiece, view?: ProgramView): string {
  const parts = view?.run.parts;
  return `Piece "${p.name}", revision ${p.revision}, written as a program, in ${METALS[p.metal].name}${parts ? `: ${programPartsWords(parts)}` : ''}. Shrinkage allowance: ${p.shrinkage}.`;
}

/** The dimensions each library part in a program reports, as describe_piece prints a tree's. */
export function programDimensionLines(parts: readonly PartReport[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (part.call === 'ringShank') {
      out.push(...dimensionLines({ band: part.band }).map((l) => l.replace('- Band:', '- Band (ringShank):')));
      continue;
    }
    const lines = dimensionLines({ band: part.onBand ?? NO_BAND, head: part.head }).slice(1);
    out.push(...lines.map((l) => (part.onBand ? l : l.replace('down to the top of the band', 'down to the base it stands on')).replace(/^- (\w+):/, `- $1 (${part.call}):`)));
  }
  return out;
}

/** One short line per setting in a program, for start_piece and change_piece. */
export function programSeatLines(parts: readonly PartReport[]): string[] {
  return parts.flatMap((part) => (part.call === 'ringShank' ? [] : [seatLine({ band: part.onBand ?? NO_BAND, head: part.head })].filter((x): x is string => !!x)));
}

export async function previewProgram(p: ProgramPiece, views: ViewName[], view?: ProgramView, limits: ProgramLimits = programLimits()): Promise<{ png: Buffer; view: ProgramView }> {
  const v = view ?? (await evaluateProgram(p, limits));
  const items: RenderItem[] = [{ positions: v.run.metal.positions, triangles: v.run.metal.triangles, kind: 'metal', color: METAL_COLOR[p.metal] ?? [200, 200, 200] }];
  if (v.run.stone) items.push({ positions: v.run.stone.positions, triangles: v.run.stone.triangles, kind: 'stone', color: STONE_COLOR });
  const parts = v.run.parts ?? [];
  const shank = parts.find((x): x is Extract<PartReport, { call: 'ringShank' }> => x.call === 'ringShank');
  const setting = parts.some((x) => x.call !== 'ringShank');
  const png = renderPreview(items, views, {
    header: [`${p.name} rev ${p.revision} - ${METALS[p.metal].name} - written as a program`, parts.length ? programPartsWords(parts).replace(/×/g, 'x') : 'shapes of its own'],
    warnings: [],
    focusAboveZ: shank && setting ? shank.band.outerDiameterMm / 2 - 1.2 : undefined,
  });
  return { png, view: v };
}

export async function describeProgram(p: ProgramPiece, view: ProgramView): Promise<{ volumeMm3: number; size: [number, number, number]; weights: { metal: string; grams: number }[] }> {
  const volumeMm3 = meshVolume(view.run.metal);
  return { volumeMm3: r2(volumeMm3), size: meshSize(view.run.metal), weights: Object.values(METALS).map((m) => ({ metal: m.name, grams: r2((volumeMm3 / 1000) * m.density) })) };
}

type HeadPart = Extract<PartReport, { call: 'prongHead' | 'bezel' }>;

/** What to thicken and where, for a program's piece: in the terms of the call in the program that makes that place. */
function programFixFor(e: CheckEntry, metal: Metal, parts: readonly PartReport[]): string | null {
  if (e.result === 'pass') return null;
  if (e.result === 'could_not_run') return `A check could not run (${e.name}: ${e.measured}). A check that cannot run counts as a fail, so nothing is exported until it can.`;
  const head = parts.find((x): x is HeadPart => x.call !== 'ringShank');
  const shank = parts.find((x): x is Extract<PartReport, { call: 'ringShank' }> => x.call === 'ringShank');
  const at = (p?: [number, number, number]) => (p ? ` at ${JSON.stringify(p)} mm` : '');
  switch (e.id) {
    case 'prong': {
      const lines = (e.failing ?? []).map((f) => {
        const k = Number(/prong (\d+)/.exec(f.label)?.[1] ?? 0);
        const cur = head?.head.prongs?.[k - 1]?.thicknessMm ?? metal.limits.prong;
        return `Thicken ${f.label} at ${f.where.clock}: its narrowest section is ${f.value} mm and it needs ${metal.limits.prong.toFixed(1)} mm; make it at least ${suggestThicker(cur, f.value, metal.limits.prong)} mm thick.`;
      });
      return `${lines.join(' ')} In the program, raise prong_thickness in its prongHead call (or that prong's own thickness in prong_overrides).`;
    }
    case 'band':
      return `Thicken the band: its thinnest section is ${e.value} mm (${e.where?.feature}), and a band needs ${metal.limits.band.toFixed(1)} mm. In the program, set band_thickness in its ringShank call to at least ${Math.max(1.6, suggestThicker(shank?.band.thicknessMm ?? metal.limits.band, e.value ?? 0, metal.limits.band))} mm.`;
    case 'bezel_wall':
      return `Thicken the bezel rim: it is ${e.value} mm at ${e.where?.clock} seen from above, and a wall needs ${metal.limits.wall.toFixed(1)} mm. In the program, set wall in its bezel call to at least ${Math.max(1.0, suggestThicker(head?.head.bezel?.wallMm ?? metal.limits.wall, e.value ?? 0, metal.limits.wall))} mm.`;
    case 'bezel_lip': {
      const m = /\(([\d.]+) mm to ([\d.]+) mm/.exec(e.limit);
      const lo = Number(m?.[1] ?? 0), hi = Number(m?.[2] ?? 0);
      return `${(e.value ?? 0) < lo ? 'Raise' : 'Lower'} the bezel lip: it rises ${e.value} mm above the girdle. In the program, set lip in its bezel call to ${r2((lo + hi) / 2)} mm (or "auto").`;
    }
    case 'sheet':
      return `${(e.failing ?? []).map((f) => `The sheet "${f.label}" is ${f.value} mm measured square to its surface; a wall needs ${metal.limits.wall.toFixed(1)} mm. In the program, set thickness in the thicken call named "${f.label}" to at least ${Math.max(1.0, suggestThicker(f.nominal ?? f.value, f.value, metal.limits.wall))} mm.`).join(' ')}`;
    case 'prong_grip':
      return `${(e.failing ?? []).map((f) => `${f.label} at ${f.where.clock} reaches only ${f.value} mm over the girdle`).join('; ')}; each must reach ${SETTING.gripMin} mm to hold the stone. In the program, set prong_grip in its prongHead call to 0.2 mm or more.`;
    case 'wall':
    case 'detail': {
      const limit = e.id === 'wall' ? metal.limits.wall : metal.limits.detail;
      const where = e.where?.part === 'added shape' ? ` in the shape named ${quoteIds(e.where.feature!)}` : e.where?.part === 'sheet' ? ` on the sheet "${e.where.feature}"` : e.where?.part === 'band' ? ' in the band' : e.where?.part === 'head' ? ` in the setting (${e.where.feature})` : '';
      return `The metal${where} is only ${e.value} mm${at(e.where?.point_mm)}, and ${e.id === 'wall' ? 'a wall' : 'the finest detail'} needs ${limit} mm. In the program, make the shape that makes that place thicker, or move the shapes so they meet squarely with no thin wedge between them. (Name a shape with .named("...") and the check names it too.)`;
    }
    case 'gap':
      return `Two surfaces are only ${e.value} mm apart${at(e.where?.point_mm)}; open the gap to at least ${metal.limits.gap} mm in ${metal.name}, or close it completely.`;
    case 'watertight':
      return `The piece is not one closed solid (${e.measured}). Join every shape to the rest (union them so they overlap), or remove the loose one.`;
    case 'surface_deviation':
      return `The casting file's facets stand ${e.value} mm off the program's finer surface, over the ${metal.limits.surfaceDeviation} mm limit. Draw curves the program computes itself with segments(radius) points a circle, so a finer build makes a finer curve.`;
  }
  return null;
}

async function checkProgram(p: ProgramPiece, mode: 'check' | 'export', limits: ProgramLimits): Promise<CheckOutcome> {
  const t0 = performance.now();
  const metal = METALS[p.metal];
  const pct = shrinkagePercent(p.shrinkage, p.metal, 'tree.shrinkage');
  const scale = 1 + pct / 100;
  let stl: Buffer | null = null;
  let mesh: MeshOut | null = null;
  let decl: FeatureDecl | undefined;
  let parts: PartReport[] = [];
  let entries: CheckEntry[];
  let meshInfo = { triangles: 0, vertices: 0, shells: 0, volumeMm3: 0 };
  let tBuild = 0, tCheck = 0;
  let evaluated: { ms: number; peak_memory_mib: number | null } | null = null;
  try {
    const r = await runProgram(p.program, [{ tol: EXPORT_TOL, scale, blendSurface: true }, { tol: REFERENCE_TOL, scale, reuseBlends: true, positionsOnly: true }], limits);
    tBuild = performance.now() - t0;
    evaluated = { ms: Math.round(r.ms), peak_memory_mib: r.peakRssMiB };
    const exp = r.runs[0]!;
    mesh = exp.metal;
    decl = exp.decl!;
    parts = exp.parts ?? [];
    stl = writeBinaryStl(mesh, `${ENGINE_NAME} ${ENGINE_VERSION} ${p.name} r${p.revision} ${p.metal} mm shrinkage ${pct > 0 ? `${pct}%` : 'off'} program`);
    const problems = declarationProblems(mesh, decl);
    if (problems.length) {
      entries = couldNotRun(`the piece does not hold what its library parts declared: ${problems.join(' ')}`);
    } else {
      const run = runChecks(stl, decl, limitsFor(metal), { positions: r.runs[1]!.metal.positions });
      entries = run.entries;
      meshInfo = run.mesh;
      tCheck = run.ms;
    }
  } catch (err) {
    entries = couldNotRun(err instanceof ProgramFailed ? `the program could not run: ${err.plain}` : `the piece could not be built: ${err instanceof Error ? err.message : String(err)}`);
  }
  const withFix = entries.map((e) => ({ ...e, fix: programFixFor(e, metal, parts) }));
  const failingProngs = new Set((withFix.find((e) => e.id === 'prong' && e.result === 'fail')?.failing ?? []).map((f) => f.label));
  const bezelFails = withFix.some((e) => e.id === 'bezel_wall' && e.result === 'fail');
  const failingSheets = new Set((withFix.find((e) => e.id === 'sheet' && e.result === 'fail')?.failing ?? []).map((f) => f.label));
  for (const e of withFix) {
    if ((e.id === 'wall' || e.id === 'detail') && e.result === 'fail') {
      const f = e.where?.feature;
      if ((f && failingProngs.has(f)) || (f === 'bezel' && bezelFails) || (e.where?.part === 'sheet' && f && failingSheets.has(f))) e.fix = null;
    }
  }
  const verdict = withFix.every((e) => e.result === 'pass') ? 'pass' : 'fail';
  const fixes = withFix.filter((e) => e.fix).map((e) => e.fix!);
  const headPart = parts.find((x): x is HeadPart => x.call !== 'ringShank');
  const hs = headPart?.head.stone;
  const report: Record<string, unknown> = {
    format: 'flo2-cad.check-report/1',
    piece: p.name,
    revision: p.revision,
    tree_sha256: sha256(canonicalJson(p)),
    program: { sha256: sha256(p.program), lines: p.program.split('\n').length, evaluated: evaluated ?? 'did not run' },
    verdict,
    export: mode === 'check' ? 'not_requested' : verdict === 'pass' ? 'released' : 'refused',
    metal: { id: metal.id, name: metal.name, density_g_cm3: metal.density, casting_note: metal.castingNote },
    stl: stl ? { file: `${p.name}.stl`, sha256: sha256(stl), bytes: stl.length, triangles: meshInfo.triangles, units: 'mm' } : null,
    shrinkage: { applied: pct > 0, allowance: pct > 0 ? `${pct} %` : 'off' },
    stone:
      headPart && hs
        ? {
            in_casting_file: false,
            shape: headPart.stone.shape,
            measured_mm: headPart.stone.shape === 'round' ? { diameter: hs.lengthMm, depth: hs.depthMm } : { length: hs.lengthMm, width: hs.widthMm, depth: hs.depthMm },
            orientation: null,
            carat_for_reference: null,
            placeholder: [],
          }
        : null,
    volume_mm3: r2(meshInfo.volumeMm3),
    weight_g: r2((meshInfo.volumeMm3 / 1000) * metal.density),
    checks: withFix,
    limits: { ...limitsFor(metal), units: 'mm', sources: [...metal.sources, ...SETTING.sources] },
    engine: { name: ENGINE_NAME, version: ENGINE_VERSION },
    kernel: { name: KERNEL_NAME, version: KERNEL_VERSION, unmodified: true },
    timing_ms: { build: Math.round(tBuild), check: Math.round(tCheck), total: Math.round(performance.now() - t0) },
  };
  const images = programImagesReport(p.program);
  if (images.length) report['images'] = images;
  let threeMf: Buffer | null = null;
  if (mesh && stl && verdict === 'pass' && mode === 'export') {
    threeMf = write3mf(mesh, {
      Title: p.name,
      Application: `${ENGINE_NAME} ${ENGINE_VERSION} (${KERNEL_NAME} ${KERNEL_VERSION})`,
      Description: `revision ${p.revision}; ${metal.name}; shrinkage ${pct > 0 ? `${pct} % applied` : 'not applied'}; stone not included; written as a program`,
    });
  }
  return { verdict, report, entries: withFix, fixes, stl, threeMf, ms: { build: tBuild, check: tCheck, total: performance.now() - t0 } };
}
