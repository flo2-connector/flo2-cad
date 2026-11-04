// What to change, in the person's terms, when a check of a stone's setting fails: a prong too
// thin or reaching too little over the girdle, a bezel rim too thin, a lip too low or too high.
// Moved here unchanged from the engine (2026-11-04), with the setting's own wall advice and the
// rule that a failing prong or bezel needs no second instruction from the wall or detail check.
// For a tree, the advice names its settings ("prong_thickness", "bezel_wall"); for a program,
// the call that makes the part. The casting limits are the piece's (its profile's or its
// supplied ones), `L`; the setting rules are this layer's (rules.ts).

import type { CheckEntry, CheckLimits } from '../checker/check.js';
import { SETTING } from './rules.js';

const r2 = (x: number) => Math.round(x * 100) / 100;

/** The same rounding the engine's general advice uses: past the limit by the shortfall, and 0.1 mm more. */
function suggestThicker(current: number, measured: number, limit: number): number {
  return Math.ceil((current + (limit - measured) + 0.1) * 10) / 10;
}

/** The checks this layer adds, by id: advice for any other is the general engine's. */
const SETTING_CHECKS: ReadonlySet<string> = new Set(['prong', 'prong_grip', 'bezel_wall', 'bezel_lip']);

export function isSettingCheck(e: CheckEntry): boolean {
  return SETTING_CHECKS.has(e.id);
}

/** A tree's head as its settings set it (the piece tree's HeadView). */
export type TreeHead =
  | { kind: 'prong_head'; prongCount: number; prongThicknessMm: number[]; nominalProngMm: number }
  | { kind: 'bezel'; wallMm: number };

/** A program's setting as its library call built it (the library's HeadDims). */
export interface ProgramHead {
  prongs?: { thicknessMm: number }[];
  bezel?: { wallMm: number };
}

/**
 * A cabochon's lip that fails is always too low (its rule has no upper limit): what it
 * needs, in mm, from the check's own limit text, and a lip that clears it, rounded up to
 * 0.1 mm. Null for a faceted stone's lip.
 */
function cabochonLipFix(e: CheckEntry): { dome: number; need: number; to: number } | null {
  const m = /cabochon's ([\d.]+) mm dome \(at least ([\d.]+) mm for this stone/.exec(e.limit);
  if (!m) return null;
  const need = Number(m[2]);
  return { dome: Number(m[1]), need, to: Math.ceil((need + 0.01) * 10) / 10 };
}

const cabochonLipWords = (e: CheckEntry, c: { dome: number; need: number }) =>
  `Raise the bezel lip: it rises ${e.value} mm above the girdle, and a cabochon's bezel must rise at least a third of its ${c.dome} mm dome, ${c.need} mm, to be pushed over the stone and hold it (J. Cogswell, Creative Stonesetting).`;

/** What to change for a failing check of a tree's setting, in its settings' names. Null when the head is not the kind the check is about. */
export function treeSettingFix(e: CheckEntry, h: TreeHead | undefined, L: CheckLimits): string | null {
  switch (e.id) {
    case 'prong': {
      if (!h || h.kind !== 'prong_head') return null;
      const lines = (e.failing ?? []).map((f) => {
        const k = Number(/prong (\d+)/.exec(f.label)?.[1] ?? 0);
        const cur = h.prongThicknessMm[k - 1] ?? h.nominalProngMm;
        return `Thicken ${f.label} at ${f.where.clock}: its narrowest section is ${f.value} mm, where the seat for the stone is cut, and it needs ${L.prong.toFixed(1)} mm. Make that prong at least ${suggestThicker(cur, f.value, L.prong)} mm thick.`;
      });
      const all = (e.failing ?? []).length === h.prongCount;
      const worst = Math.min(...(e.failing ?? []).map((f) => f.value));
      const suggestion = suggestThicker(h.nominalProngMm, worst, L.prong);
      return `${lines.join(' ')} ${all ? `Change: set {"prong_thickness": "${Math.max(suggestion, 1.4)} mm"}.` : `Change: set {"head.prong_overrides": []} to give every prong the head's prong_thickness, or set that prong's own thickness in "head.prong_overrides".`} A prong is joined at one end only, so it needs more metal than a wall.`;
    }
    case 'bezel_wall':
      if (!h || h.kind !== 'bezel') return null;
      return `Thicken the bezel rim: it is ${e.value} mm at ${e.where?.clock} seen from above, and a wall needs ${L.wall.toFixed(1)} mm. Change: set {"bezel_wall": "${Math.max(1.0, suggestThicker(h.wallMm, e.value ?? 0, L.wall))} mm"}.`;
    case 'bezel_lip': {
      if (!h || h.kind !== 'bezel') return null;
      const cab = cabochonLipFix(e);
      if (cab) return `${cabochonLipWords(e, cab)} Change: set {"bezel_lip": "${cab.to} mm"} (or "auto").`;
      const m = /\(([\d.]+) mm to ([\d.]+) mm/.exec(e.limit);
      const lo = Number(m?.[1] ?? 0), hi = Number(m?.[2] ?? 0);
      return (e.value ?? 0) < lo
        ? `Raise the bezel lip: it rises ${e.value} mm above the girdle, too little to be pushed over the stone. Change: set {"bezel_lip": "${r2((lo + hi) / 2)} mm"} (or "auto").`
        : `Lower the bezel lip: it rises ${e.value} mm above the girdle and would cover too much of the stone. Change: set {"bezel_lip": "${r2((lo + hi) / 2)} mm"} (or "auto").`;
    }
    case 'prong_grip':
      return `${(e.failing ?? []).map((f) => `${f.label} at ${f.where.clock} reaches only ${f.value} mm over the girdle`).join('; ')}; each must reach ${SETTING.gripMin} mm to hold the stone. Change: set {"head.prong_grip": "0.2 mm"}.`;
  }
  return null;
}

/** The wall check's advice when its thin place is on a tree's setting; undefined when the place is not on one. */
export function treeSettingWallFix(e: CheckEntry, h: TreeHead | undefined, L: CheckLimits): string | undefined {
  const part = e.where?.feature ?? e.where?.part ?? 'the piece';
  if (/prong/.test(part) && h?.kind === 'prong_head') return `Thicken ${part}: a wall there is ${e.value} mm and needs ${L.wall.toFixed(1)} mm. Raise prong_thickness.`;
  if (part === 'bezel' && h?.kind === 'bezel') return `Thicken the bezel rim: a wall there is ${e.value} mm and needs ${L.wall.toFixed(1)} mm. Raise bezel_wall.`;
  return undefined;
}

/** What to change for a failing check of a program's setting, in the terms of the call that makes it. */
export function programSettingFix(e: CheckEntry, head: ProgramHead | undefined, L: CheckLimits): string | null {
  switch (e.id) {
    case 'prong': {
      const lines = (e.failing ?? []).map((f) => {
        const k = Number(/prong (\d+)/.exec(f.label)?.[1] ?? 0);
        const cur = head?.prongs?.[k - 1]?.thicknessMm ?? L.prong;
        return `Thicken ${f.label} at ${f.where.clock}: its narrowest section is ${f.value} mm and it needs ${L.prong.toFixed(1)} mm; make it at least ${suggestThicker(cur, f.value, L.prong)} mm thick.`;
      });
      return `${lines.join(' ')} In the program, raise prong_thickness in its prongHead call (or that prong's own thickness in prong_overrides).`;
    }
    case 'bezel_wall':
      return `Thicken the bezel rim: it is ${e.value} mm at ${e.where?.clock} seen from above, and a wall needs ${L.wall.toFixed(1)} mm. In the program, set wall in its bezel call to at least ${Math.max(1.0, suggestThicker(head?.bezel?.wallMm ?? L.wall, e.value ?? 0, L.wall))} mm.`;
    case 'bezel_lip': {
      const cab = cabochonLipFix(e);
      if (cab) return `${cabochonLipWords(e, cab)} In the program, set lip in its bezel call to ${cab.to} mm or more (or "auto").`;
      const m = /\(([\d.]+) mm to ([\d.]+) mm/.exec(e.limit);
      const lo = Number(m?.[1] ?? 0), hi = Number(m?.[2] ?? 0);
      return `${(e.value ?? 0) < lo ? 'Raise' : 'Lower'} the bezel lip: it rises ${e.value} mm above the girdle. In the program, set lip in its bezel call to ${r2((lo + hi) / 2)} mm (or "auto").`;
    }
    case 'prong_grip':
      return `${(e.failing ?? []).map((f) => `${f.label} at ${f.where.clock} reaches only ${f.value} mm over the girdle`).join('; ')}; each must reach ${SETTING.gripMin} mm to hold the stone. In the program, set prong_grip in its prongHead call to 0.2 mm or more.`;
  }
  return null;
}

/**
 * The features whose own setting check failed: each failing prong by its label, and "bezel"
 * when the bezel's rim does. A wall or detail check that tripped on one of them needs no
 * second instruction (one fix per place).
 */
export function failingSettingFeatures(entries: readonly CheckEntry[]): Set<string> {
  const out = new Set((entries.find((e) => e.id === 'prong' && e.result === 'fail')?.failing ?? []).map((f) => f.label));
  if (entries.some((e) => e.id === 'bezel_wall' && e.result === 'fail')) out.add('bezel');
  return out;
}
