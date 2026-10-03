// Units are ENFORCED at the tool surface (design rule rule:units-of-this-design,
// constraint con:no-number-without-its-unit; owner, round 1, Q8):
//   · every quantity is written with its unit: length "mm", angle "deg" (or "°"),
//     and a shrinkage allowance in "%";
//   · a number with no unit is refused, and so is a foreign unit (in, cm, rad...):
//     the agent converts explicitly and shows the person the conversion;
//   · a ring size names its system (US, UK or EU) and is turned into an inner
//     diameter in mm here, once.
// Every refusal is a CallError naming the field path.

import { CallError } from './errors.js';

const QUANTITY = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(\S.*?)?\s*$/;

/** Factors to mm for units the engine refuses but can tell the agent how to convert. */
const FOREIGN_LENGTH: Readonly<Record<string, number>> = {
  in: 25.4,
  inch: 25.4,
  inches: 25.4,
  '"': 25.4,
  '″': 25.4,
  cm: 10,
  m: 1000,
  um: 0.001,
  'µm': 0.001,
  μm: 0.001,
  mil: 0.0254,
  thou: 0.0254,
  ft: 304.8,
};

const FOREIGN_ANGLE: Readonly<Record<string, number>> = {
  rad: 180 / Math.PI,
  radian: 180 / Math.PI,
  radians: 180 / Math.PI,
  grad: 0.9,
  turn: 360,
};

function round(n: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function split(v: unknown, path: string, example: string): { num: number; unit: string | undefined; text: string } {
  if (typeof v === 'number') {
    throw new CallError(path, `${v} has no unit. Every measurement must say its unit, for example "${example}".`);
  }
  if (typeof v !== 'string') {
    throw new CallError(path, `expected a measurement written with its unit, for example "${example}".`);
  }
  const m = QUANTITY.exec(v);
  if (!m) {
    throw new CallError(path, `"${v}" is not a measurement; write a number and its unit, for example "${example}".`);
  }
  const num = Number(m[1]);
  if (!Number.isFinite(num)) {
    throw new CallError(path, `"${v}" is not a finite number.`);
  }
  return { num, unit: m[2], text: v };
}

/** A length in mm. Refuses a bare number and any unit but mm. */
export function lengthMm(v: unknown, path: string): number {
  const { num, unit, text } = split(v, path, '1.2 mm');
  if (unit === undefined) {
    throw new CallError(path, `"${text}" has no unit. Write "${num} mm" if you mean millimetres.`);
  }
  if (unit === 'mm') return num;
  const f = FOREIGN_LENGTH[unit] ?? FOREIGN_LENGTH[unit.toLowerCase()];
  if (f !== undefined) {
    throw new CallError(
      path,
      `"${text}" is in ${unit}; this engine takes lengths in mm only. Convert it yourself and show the person the conversion: ${num} ${unit} × ${f} = ${round(num * f)} mm.`,
    );
  }
  throw new CallError(path, `"${unit}" is not a length unit this engine takes; write the length in mm, for example "1.2 mm".`);
}

/** An angle in degrees ("deg" or "°"). */
export function angleDeg(v: unknown, path: string): number {
  const { num, unit, text } = split(v, path, '30 deg');
  if (unit === undefined) {
    throw new CallError(path, `"${text}" has no unit. Write "${num} deg" if you mean degrees.`);
  }
  if (unit === 'deg' || unit === '°' || unit === 'degrees') return num;
  const f = FOREIGN_ANGLE[unit.toLowerCase()];
  if (f !== undefined) {
    throw new CallError(
      path,
      `"${text}" is in ${unit}; this engine takes angles in deg only. Convert it yourself and show the person the conversion: ${num} ${unit} = ${round(num * f)} deg.`,
    );
  }
  throw new CallError(path, `"${unit}" is not an angle unit this engine takes; write the angle in deg, for example "30 deg".`);
}

/** A percentage ("1.5 %"), used only for the shrinkage allowance. */
export function percent(v: unknown, path: string): number {
  const { num, unit, text } = split(v, path, '1.5 %');
  if (unit !== '%') {
    throw new CallError(path, `"${text}" must be a percentage written with "%", for example "1.5 %".`);
  }
  return num;
}

/** True when a string reads as a number with or without a unit, e.g. "1.2", "1.2 mm", "3 in". */
export function looksLikeQuantity(v: string): boolean {
  return QUANTITY.test(v);
}

/** Checks a quantity of any accepted unit, for operation parameters the engine does not know by name. */
export function anyQuantity(v: unknown, path: string): void {
  if (typeof v === 'number') {
    throw new CallError(path, `${v} has no unit. Every measurement must say its unit: "mm" for lengths, "deg" for angles.`);
  }
  if (typeof v !== 'string') return;
  const m = QUANTITY.exec(v);
  if (!m) return; // a word, not a number: some other kind of setting
  const unit = m[2];
  if (unit === undefined) {
    throw new CallError(path, `"${v}" has no unit. Every measurement must say its unit: "mm" for lengths, "deg" for angles.`);
  }
  if (unit === 'mm' || unit === 'deg' || unit === '°' || unit === '%') return;
  if (FOREIGN_LENGTH[unit] !== undefined || FOREIGN_LENGTH[unit.toLowerCase()] !== undefined) lengthMm(v, path);
  if (FOREIGN_ANGLE[unit.toLowerCase()] !== undefined) angleDeg(v, path);
  throw new CallError(path, `"${unit}" is not a unit this engine takes; lengths are in mm and angles in deg.`);
}

// ---------------------------------------------------------------- ring sizes

export type RingSystem = 'US' | 'UK' | 'EU';
export interface RingSize {
  readonly system: RingSystem;
  readonly size: string | number;
}

const UK_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * A ring size, in its named system, as the inner diameter in mm.
 * - US: diameter = 11.63 mm + 0.8128 mm per size (quarter sizes allowed), US 3 to 16.
 * - UK (BS 6820:1987): letters A to Z, half sizes allowed; inner circumference
 *   40.0 mm at C and 1.25 mm per letter, so 37.5 mm at A (Goldsmiths' chart: N = 53.8 mm).
 * - EU (ISO 8653): the size IS the inner circumference in mm, EU 38 to 76.
 * Sources: https://en.wikipedia.org/wiki/Ring_size (US formula; BS 6820; ISO 8653),
 * https://www.goldsmiths.co.uk/i/know-your-ring-size (read 2026-10-03).
 */
export function ringInnerDiameterMm(v: unknown, path: string): { size: RingSize; diameterMm: number } {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new CallError(path, 'a ring size is an object naming its system and size, for example {"system": "US", "size": "7"}.');
  }
  const o = v as Record<string, unknown>;
  const system = o['system'];
  if (system === undefined) {
    throw new CallError(`${path}.system`, 'a ring size must name its system: "US", "UK" or "EU". The same number is a different ring in each.');
  }
  if (system !== 'US' && system !== 'UK' && system !== 'EU') {
    throw new CallError(`${path}.system`, `"${String(system)}" is not a ring-size system this engine knows; use "US", "UK" or "EU".`);
  }
  const raw = o['size'];
  if (raw === undefined || raw === null || raw === '') {
    throw new CallError(`${path}.size`, `give the size in the ${system} system, for example ${system === 'UK' ? '"N"' : system === 'EU' ? '"54"' : '"7"'}.`);
  }
  for (const k of Object.keys(o)) {
    if (k !== 'system' && k !== 'size') throw new CallError(`${path}.${k}`, 'a ring size has only "system" and "size".');
  }
  const sizePath = `${path}.size`;
  const text = String(raw).trim();
  if (system === 'US') {
    const n = parseFraction(text);
    if (n === null || n < 3 || n > 16 || Math.abs(n * 4 - Math.round(n * 4)) > 1e-9) {
      throw new CallError(sizePath, `"${text}" is not a US ring size; US sizes run from 3 to 16 in quarter sizes, for example "7" or "7.5".`);
    }
    return { size: { system, size: raw as string | number }, diameterMm: round(11.63 + 0.8128 * n, 3) };
  }
  if (system === 'UK') {
    const m = /^([A-Za-z])\s*(½|1\/2|\.5)?$/.exec(text);
    const i = m ? UK_LETTERS.indexOf(m[1]!.toUpperCase()) : -1;
    if (!m || i < 0) {
      throw new CallError(sizePath, `"${text}" is not a UK ring size; UK sizes are letters A to Z, with halves, for example "N" or "N½".`);
    }
    const circumference = 37.5 + 1.25 * i + (m[2] ? 0.625 : 0);
    return { size: { system, size: raw as string | number }, diameterMm: round(circumference / Math.PI, 3) };
  }
  const c = parseFraction(text);
  if (c === null || c < 38 || c > 76) {
    throw new CallError(sizePath, `"${text}" is not an EU ring size; an EU size is the inner circumference in mm, from 38 to 76, for example "54".`);
  }
  return { size: { system, size: raw as string | number }, diameterMm: round(c / Math.PI, 3) };
}

function parseFraction(t: string): number | null {
  const s = t.replace('½', ' 1/2').replace('¼', ' 1/4').replace('¾', ' 3/4').trim();
  let m = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d+)\s+(\d)\/(\d)$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  return null;
}

/** A stone's carat weight as a grading report states it ("2.00 ct"). Informational only: it never sizes anything. */
export function caratText(v: unknown, path: string): string {
  const { num, unit, text } = split(v, path, '2.00 ct');
  if (unit !== 'ct') {
    throw new CallError(path, `"${text}" must be a carat weight written with "ct", for example "2.00 ct". It is kept for reference only; the stone is sized from its measured length, width and depth.`);
  }
  if (num <= 0 || num > 50) throw new CallError(path, `${num} ct is not a plausible weight for one stone.`);
  return `${num} ct`;
}
