// A piece written as a PROGRAM (cap:the-agent-writes-a-piece-as-a-program; settled in
// dec:idea-how-flo2-cad-becomes-general-enough-to-model-anything, option A): a short
// JavaScript program over the kernel's general operations and the jewelry library,
// which flo2-cad runs confined (src/program/) and keeps as the piece's file.
//
// The file travels exactly as a tree does (contract §3): every tool that changes the
// piece returns it as `<name>.tree.json`, flo2 keeps each version, and any call may pass
// it back as "tree". It is a different SHAPE of that file, told apart by its format:
//
//   { "format": "flo2-cad.program/1", "name", "revision", "metal", "shrinkage",
//     "units": "mm", "program": "<the JavaScript source>" }
//
// The program is the piece's whole source: its band, stone and setting are calls in it,
// so the named settings of a template (band_width, prong_thickness, ...) are changed in
// the program, not with `set`. The metal, the name and the shrinkage allowance are the
// piece's own, as on a tree.
//
// UNITS (con:no-number-without-its-unit). The file states its unit, "mm", once: inside the
// program a bare number is a length in millimetres, or an angle in degrees where an angle
// is asked for. A string must carry its unit ("1.2 mm"), and a foreign unit ("0.05 in") is
// refused with the conversion, exactly as on a tree.

import { CallError, at } from '../errors.js';
import { METAL_IDS, type MetalId } from '../metals.js';
import { shrinkagePercent, TREE_FORMAT, validateTree, type PieceTree } from './tree.js';

export const PROGRAM_FORMAT = 'flo2-cad.program/1';
/** The unit a program's bare numbers are in. */
export const PROGRAM_UNITS = 'mm';
/** A program longer than this is not a short program for one piece. */
export const PROGRAM_MAX_CHARS = 100_000;

export interface ProgramPiece {
  format: typeof PROGRAM_FORMAT;
  name: string;
  revision: number;
  metal: MetalId;
  /** "off" (the default), "on" (the metal's cited allowance) or an allowance such as "1.5 %". */
  shrinkage: string;
  units: typeof PROGRAM_UNITS;
  program: string;
}

/** Any piece: a tree of the library's parts and operations, or a program. */
export type Piece = PieceTree | ProgramPiece;

export function isProgramPiece(p: Piece): p is ProgramPiece {
  return (p as { format: string }).format === PROGRAM_FORMAT;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FIELDS = ['format', 'name', 'revision', 'metal', 'shrinkage', 'units', 'program'] as const;

/** A program's source, as an argument or in a piece file: non-empty text of bounded length. */
export function checkProgramSource(v: unknown, path: string): string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new CallError(path, 'a program is JavaScript text that builds the piece and returns it, for example "const band = ringShank({ ring_size: { system: \\"US\\", size: \\"7\\" } }); return band;". describe_piece lists what a program can call.');
  }
  if (v.length > PROGRAM_MAX_CHARS) throw new CallError(path, `the program is ${v.length} characters; a piece's program may be at most ${PROGRAM_MAX_CHARS}. Use loops and functions rather than long lists of numbers.`);
  return v;
}

/** Validates a program piece an agent or flo2 passed in, returning it typed. Every refusal names its path. */
export function validateProgramPiece(v: unknown, path = 'tree'): ProgramPiece {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new CallError(path, `a piece file is a JSON object with its "format", as a previous reply or the saved <name>.tree.json gave it.`);
  const t = v as Record<string, unknown>;
  if (t['format'] !== PROGRAM_FORMAT) throw new CallError(at(path, 'format'), `must be "${PROGRAM_FORMAT}"; got ${JSON.stringify(t['format'])}.`);
  for (const k of Object.keys(t)) if (!(FIELDS as readonly string[]).includes(k)) throw new CallError(at(path, k), `is not a field of a program piece; its fields are ${FIELDS.join(', ')}.`);
  if (typeof t['name'] !== 'string' || !NAME.test(t['name'])) {
    throw new CallError(at(path, 'name'), 'a piece name is 1 to 64 letters, digits, "-" or "_", starting with a letter or digit, for example "moon-cabochon".');
  }
  if (!Number.isInteger(t['revision']) || (t['revision'] as number) < 1) throw new CallError(at(path, 'revision'), 'must be a whole number, 1 or more (it counts the changes, so it has no unit).');
  if (!(METAL_IDS as readonly unknown[]).includes(t['metal'])) throw new CallError(at(path, 'metal'), `must be one of ${METAL_IDS.join(', ')}.`);
  shrinkagePercent(t['shrinkage'], t['metal'] as MetalId, at(path, 'shrinkage'));
  if (t['units'] !== PROGRAM_UNITS) throw new CallError(at(path, 'units'), `must be "${PROGRAM_UNITS}": a program's bare numbers are millimetres (and degrees where an angle is asked for).`);
  checkProgramSource(t['program'], at(path, 'program'));
  return v as ProgramPiece;
}

/** A new program piece at revision 1. */
export function programPiece(program: string, o: { name?: string; metal?: MetalId; shrinkage?: string }): ProgramPiece {
  return {
    format: PROGRAM_FORMAT,
    name: o.name ?? 'piece',
    revision: 1,
    metal: o.metal ?? 'sterling_silver_925',
    shrinkage: o.shrinkage ?? 'off',
    units: PROGRAM_UNITS,
    program,
  };
}

/** Validates a piece file an agent or flo2 passed in as "tree": a tree or a program piece, told apart by its format. */
export function validatePiece(v: unknown, path = 'tree'): Piece {
  const format = v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>)['format'] : undefined;
  if (format === PROGRAM_FORMAT) return validateProgramPiece(v, path);
  if (format !== undefined && format !== TREE_FORMAT) {
    throw new CallError(at(path, 'format'), `must be "${TREE_FORMAT}" (a piece built from a template) or "${PROGRAM_FORMAT}" (a piece written as a program); got ${JSON.stringify(format)}.`);
  }
  return validateTree(v, path);
}
