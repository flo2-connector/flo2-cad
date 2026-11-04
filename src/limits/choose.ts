// WHICH LIMITS A PIECE IS HELD TO (req:limits-follow-the-material-process-and-size).
//
// A piece STATES what it is cast in and how, in its own file:
//   · "metal": one of the four metals by its id (sterling_silver_925, gold_14k_yellow,
//     gold_18k_yellow, platinum_950), exactly as before; OR "material": any other material by
//     name ("bronze", "silicon bronze", "copper"). A piece states one of the two, never both;
//   · "process": how it will be cast, "lost_wax" (the first profile's), or any other process in
//     words ("sand casting", "ceramic shell"). Left out, lost wax is assumed, as flo2-cad always
//     assumed, and every check and export says that is what was assumed;
//   · optionally "limits": limits the person supplies, each with its source (supplied.ts).
// Its SIZE is measured from the model: the largest side of its bounding box, in mm, the piece as
// finished (the casting file's, before any shrinkage allowance).
//
// Supplied limits are used whenever a piece carries them. Otherwise the piece is held to the
// profile that covers its material, its process and its size, all three; when none does, there
// is NO VERDICT, and what did not match is named. Another profile's numbers are never borrowed.

import { CallError } from '../errors.js';
import { METAL_IDS, METALS, type Metal, type MetalId } from '../metals.js';
import { DEFAULT_PROCESS, isProcessId, limitValues, PROCESSES, PROFILES, type Limits, type LimitProfile, type ProcessId } from './profiles.js';
import { readSupplied, type Supplied } from './supplied.js';

/** What a piece states about how it is cast, as its file holds it. */
export interface CastStatement {
  metal?: MetalId;
  material?: string;
  process?: string;
  limits?: unknown;
}

/** The piece's metal, when it names one of the four. */
export function metalOf(s: CastStatement): Metal | null {
  return s.metal ? METALS[s.metal] : null;
}

/** What the piece is cast in, in words: "sterling silver 925", or the material as the piece names it. */
export function materialName(s: CastStatement): string {
  return s.metal ? METALS[s.metal].name : (s.material ?? 'an unnamed material');
}

/** The process the piece is checked as: the one it states, or lost wax, assumed. */
export function processOf(s: CastStatement): { id: string; stated: boolean; words: string; known: ProcessId | null } {
  const id = s.process ?? DEFAULT_PROCESS;
  const known = isProcessId(id) ? id : null;
  return { id, stated: s.process !== undefined, words: known ? PROCESSES[known].words : id, known };
}

/** "lost wax", or "lost wax (assumed: the piece states no process ...)". */
export function processWords(s: CastStatement): string {
  const p = processOf(s);
  return p.stated ? p.words : `${p.words} (assumed: the piece states no process; set "process" to say how it will be cast)`;
}

const NAME_TEXT = /^[\p{L}\p{N}][\p{L}\p{N} _.,'()/%+&-]{0,79}$/u;

/** A material named in words; one of the four metals is named by its id, as "metal". */
export function checkMaterial(v: unknown, path: string): string {
  if (typeof v !== 'string' || !NAME_TEXT.test(v.trim()) || v !== v.trim()) {
    throw new CallError(path, 'a material is named in words, 1 to 80 letters, digits, spaces and simple punctuation, for example "bronze" or "silicon bronze".');
  }
  const low = v.toLowerCase();
  const metal = METAL_IDS.find((id) => id === low || METALS[id].name.toLowerCase() === low);
  if (metal) throw new CallError(path, `"${v}" is one of the metals flo2-cad knows by id: give it as {"metal": "${metal}"}, not as a material.`);
  return v;
}

/** A process: "lost_wax", or another named in words. */
export function checkProcess(v: unknown, path: string): string {
  if (typeof v !== 'string' || !NAME_TEXT.test(v.trim()) || v !== v.trim()) {
    throw new CallError(path, `a process is "lost_wax" (${PROCESSES.lost_wax.detail}), or another named in words, for example "sand casting" or "ceramic shell".`);
  }
  return v;
}

/** One profile measured against the piece: which of its material, process and size it covers. */
export interface ProfileMatch {
  profile: LimitProfile;
  material: boolean;
  process: boolean;
  /** Null when the size could not be measured (the piece could not be built). */
  size: boolean | null;
}

export function matchProfile(profile: LimitProfile, s: CastStatement, sizeMm: number | null): ProfileMatch {
  const p = processOf(s);
  return {
    profile,
    material: s.metal !== undefined && profile.materials[s.metal] !== undefined,
    process: p.known !== null && profile.processes.includes(p.known),
    size: sizeMm === null ? null : sizeMm >= profile.size.minMm.value && sizeMm <= profile.size.maxMm.value,
  };
}

/** The piece's size, as measured: its bounding box and its largest side, in mm. */
export interface PieceSize {
  boxMm: [number, number, number];
  largestMm: number;
}

/** Where a piece's limits come from. */
export type LimitsChoice =
  | { kind: 'profile'; profile: LimitProfile; metal: MetalId; limits: Limits; shrinkagePct: number; sources: readonly string[] }
  | { kind: 'supplied'; supplied: Supplied; limits: Limits; shrinkagePct: number }
  | { kind: 'none'; matches: ProfileMatch[] };

/**
 * The limits a piece is held to. `sizeMm` is its largest side, or null when it could not be
 * measured: then a profile covering its material and process is used (no check can run, and a
 * check that cannot run is a fail), and none is borrowed when they do not match.
 */
export function chooseLimits(s: CastStatement, sizeMm: number | null): LimitsChoice {
  if (s.limits !== undefined) {
    const supplied = readSupplied(s.limits, 'tree.limits');
    return { kind: 'supplied', supplied, limits: supplied.limits, shrinkagePct: supplied.shrinkagePct };
  }
  const matches = PROFILES.map((p) => matchProfile(p, s, sizeMm));
  const hit = matches.find((m) => m.material && m.process && m.size !== false);
  if (hit && s.metal) {
    const m = hit.profile.materials[s.metal]!;
    return { kind: 'profile', profile: hit.profile, metal: s.metal, limits: limitValues(m), shrinkagePct: m.shrinkagePct.value, sources: m.sources };
  }
  return { kind: 'none', matches };
}

/**
 * The cited allowance shrinkage "on" applies: the supplied set's, or that of the profile that
 * covers the piece's material and process (whatever its size: a piece no profile covers by size
 * gets no verdict, so nothing is released with it). Null when there is none to cite.
 */
export function citedShrinkage(s: CastStatement): number | null {
  if (s.limits !== undefined) return readSupplied(s.limits, 'tree.limits').shrinkagePct;
  for (const p of PROFILES) {
    const m = matchProfile(p, s, null);
    if (m.material && m.process && s.metal) return p.materials[s.metal]!.shrinkagePct.value;
  }
  return null;
}

// --------------------------------------------------------------- the words

const mmText = (x: number) => `${Math.round(x * 100) / 100} mm`;

/** "precious metals cast by lost wax, at jewelry scale: sterling silver 925, ...; lost wax ...; 2.4 to 88 mm at its largest". */
export function profileWords(p: LimitProfile): string {
  const metals = (Object.keys(p.materials) as MetalId[]).map((id) => `${METALS[id].name} ("${id}")`);
  return `"${p.name}": ${metals.join(', ')}; ${p.processes.map((id) => `${PROCESSES[id].detail} ("${id}")`).join(', ')}; ${mmText(p.size.minMm.value).replace(' mm', '')} to ${mmText(p.size.maxMm.value)} at its largest`;
}

/** Which of the piece's material, process and size a profile does not cover, by name. */
export function unmatched(m: ProfileMatch): ('material' | 'process' | 'size')[] {
  return [...(m.material ? [] : ['material' as const]), ...(m.process ? [] : ['process' as const]), ...(m.size === false ? ['size' as const] : [])];
}

/** Why there is no verdict and how to go on, in the person's terms. */
export function noVerdictWords(s: CastStatement, size: PieceSize | null, matches: readonly ProfileMatch[]): { why: string[]; howToGoOn: string[] } {
  const why: string[] = [];
  const how = new Set<string>();
  for (const m of matches) {
    const p = m.profile;
    const parts: string[] = [];
    if (!m.material) {
      parts.push(`its material, ${materialName(s)}, is not one the profile covers`);
      how.add(`If it will be cast in one of the profile's metals, set "metal" to its id (${(Object.keys(p.materials) as MetalId[]).join(', ')}).`);
    }
    if (!m.process) {
      parts.push(`its process, ${processOf(s).words}, is not one the profile covers`);
      how.add(`If it will be cast by lost wax, set "process" to "lost_wax".`);
    }
    if (m.size === false && size) {
      parts.push(`its size, ${mmText(size.largestMm)} at its largest (${size.boxMm.map((x) => Math.round(x * 100) / 100).join(' × ')} mm), is outside the profile's ${mmText(p.size.minMm.value).replace(' mm', '')} to ${mmText(p.size.maxMm.value)}`);
      how.add(`Or make the piece ${size.largestMm > p.size.maxMm.value ? 'smaller' : 'larger'}, within ${mmText(p.size.minMm.value).replace(' mm', '')} to ${mmText(p.size.maxMm.value)} at its largest, if it can be.`);
    }
    why.push(`The profile ${profileWords(p)}, does not cover it: ${parts.join('; ')}.`);
  }
  return {
    why,
    howToGoOn: [
      'Ask the caster or foundry who will cast it for their limits, and give them as "limits" (change_piece, set), each figure with its source; the piece is then checked against them, and every report names them as yours.',
      ...how,
    ],
  };
}
