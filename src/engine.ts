// The engine behind the tools: build a piece with the library and kernel, draw
// it, and check and export it. A casting file is released ONLY when every check
// passes on the file as written (con:no-casting-export-unless-every-check-passes):
// the STL is written to bytes first, the independent checker reads those bytes
// back, and the very same bytes are what an export releases.

import { createHash } from 'node:crypto';
import { runChecks, type CheckEntry, type CheckLimits } from './checker/check.js';
import { writeBinaryStl } from './files/stl.js';
import { write3mf } from './files/threemf.js';
import { buildPiece, EXPORT_TOL, PREVIEW_TOL, REFERENCE_TOL, type Built } from './library/build.js';
import { METALS, SETTING, type Metal } from './metals.js';
import { readPiece, STONE_DEFAULTS, type PieceTree, type PieceView } from './piece/tree.js';
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
    focusAboveZ: built.layout.girdleBottomZ !== undefined ? v.innerDiameterMm / 2 + v.bandThicknessMm - 1.2 : undefined,
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
    case 'prong_grip':
      return `${(e.failing ?? []).map((f) => `${f.label} at ${f.where.clock} reaches only ${f.value} mm over the girdle`).join('; ')}; each must reach ${SETTING.gripMin} mm to hold the stone. Change: set {"head.prong_grip": "0.2 mm"}.`;
    case 'wall': {
      const part = e.where?.feature ?? e.where?.part ?? 'the piece';
      if (/prong/.test(part) && h?.kind === 'prong_head') return `Thicken ${part}: a wall there is ${e.value} mm and needs ${metal.limits.wall.toFixed(1)} mm. Raise prong_thickness.`;
      if (part === 'bezel' && h?.kind === 'bezel') return `Thicken the bezel rim: a wall there is ${e.value} mm and needs ${metal.limits.wall.toFixed(1)} mm. Raise bezel_wall.`;
      if (e.where?.part === 'band') return `Thicken the band: a wall there is ${e.value} mm (${part}) and needs ${metal.limits.wall.toFixed(1)} mm. Raise band_thickness.`;
      return `Thicken the thinnest wall, ${e.value} mm at ${JSON.stringify(e.where?.point_mm)} mm, to at least ${metal.limits.wall.toFixed(1)} mm.`;
    }
    case 'detail':
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

export async function checkPiece(tree: PieceTree, mode: 'check' | 'export'): Promise<CheckOutcome> {
  const t0 = performance.now();
  const v = readPiece(tree);
  const metal = METALS[v.metal];
  let built: Built | null = null;
  let stl: Buffer | null = null;
  let entries: CheckEntry[];
  let meshInfo = { triangles: 0, vertices: 0, shells: 0, volumeMm3: 0 };
  let tBuild = 0, tCheck = 0;
  try {
    built = await buildPiece(tree, { tol: EXPORT_TOL, applyShrinkage: true });
    tBuild = performance.now() - t0;
    const shrink = v.shrinkagePct > 0 ? `${v.shrinkagePct}%` : 'off';
    stl = writeBinaryStl(built.metal, `${ENGINE_NAME} ${ENGINE_VERSION} ${tree.name} r${tree.revision} ${v.metal} mm shrinkage ${shrink}`);
    // The same piece, far more finely tessellated: what the surface check measures against.
    const ref = await buildPiece(tree, { tol: REFERENCE_TOL, applyShrinkage: true });
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
  for (const e of withFix) {
    if ((e.id === 'wall' || e.id === 'detail') && e.result === 'fail') {
      const f = e.where?.feature;
      if ((f && failingProngs.has(f)) || (f === 'bezel' && bezelFails)) e.fix = null;
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

export async function describeNumbers(tree: PieceTree): Promise<{ volumeMm3: number; size: [number, number, number]; weights: { metal: string; grams: number }[] }> {
  const built = await buildPiece(tree, { tol: PREVIEW_TOL, applyShrinkage: false });
  const size: [number, number, number] = [0, 1, 2].map((k) => r2(built.bbox.max[k]! - built.bbox.min[k]!)) as [number, number, number];
  const weights = Object.values(METALS).map((m) => ({ metal: m.name, grams: r2((built.volumeMm3 / 1000) * m.density) }));
  return { volumeMm3: r2(built.volumeMm3), size, weights };
}
