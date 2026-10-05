// One session = one person working on one design (contract: flo2 starts one
// engine process per person and design). The session holds the piece open in
// this conversation; any call may instead carry a tree, which becomes the open
// piece (contract §3: a new session resumes from the saved <name>.tree.json).

import { CallError } from './errors.js';
import {
  checkPiece,
  describeNumbers,
  describeProgram,
  dimensionLines,
  evaluateProgram,
  placeholderNote,
  preview,
  previewProgram,
  programDimensionLines,
  programSeatLines,
  programSummary,
  seatLine,
  summary,
  type ProgramView,
} from './engine.js';
import { pieceDims } from './library/build.js';
import { METALS, type MetalId } from './metals.js';
import { checkProgramSource, isProgramPiece, programPiece, validatePiece, type Piece, type ProgramPiece } from './piece/program.js';
import { applySet, checkParam, checkStartArgs, getSetting, OP_HELP, OP_PARAMS, OPERATIONS, PARAM_BY_KEY, PARAMS, PARTS, readPiece, treeFromTemplate, validateTree, type PieceTree } from './piece/tree.js';
import { CABOCHON_EXAMPLE, programGuide } from './program/guide.js';
import { ProgramFailed, programLimits, type ProgramLimits } from './program/run.js';
import { treeAsProgram } from './program/from-tree.js';
import type { ViewName } from './render/render.js';
import { MIME, callError, reply, type OutFile, type ToolReply } from './reply.js';
import { DEFAULT_VIEWS, PREVIEW_VIEWS, TOOLS, type ToolName } from './tools.js';

/** The settings a piece written as a program keeps beside its program; everything else is in the program. */
const PROGRAM_PIECE_SETTINGS = ['name', 'metal', 'shrinkage'] as const;

const ALLOWED_ARGS: Readonly<Record<string, ReadonlySet<string>>> = Object.fromEntries(
  TOOLS.map((t) => [t.name, new Set(Object.keys((t.inputSchema.properties ?? {}) as object))]),
);

function fmt(v: unknown): string {
  if (v === undefined) return '(none)';
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'system' in v) {
    const r = v as { system: unknown; size?: unknown };
    return `${String(r.system)} ${String(r.size)}`;
  }
  return JSON.stringify(v);
}

function treeFile(tree: Piece): OutFile {
  return { name: `${tree.name}.tree.json`, mimeType: MIME.json, bytes: Buffer.from(JSON.stringify(tree, null, 2) + '\n', 'utf8') };
}

function treeText(tree: Piece): string {
  return isProgramPiece(tree)
    ? `The piece's file, revision ${tree.revision}, holding its program (saved as ${tree.name}.tree.json; pass it back as "tree" to pick this piece up in a new conversation):\n${JSON.stringify(tree)}`
    : `The piece's tree, revision ${tree.revision} (saved as ${tree.name}.tree.json; pass it back as "tree" to pick this piece up in a new conversation):\n${JSON.stringify(tree)}`;
}

function logText(logs: readonly string[]): string[] {
  return logs.length ? [`The program logged:\n${logs.map((l) => `  ${l}`).join('\n')}`] : [];
}

export class Session {
  #piece: Piece | undefined;
  readonly #limits: ProgramLimits;

  constructor(limits: ProgramLimits = programLimits()) {
    this.#limits = limits;
  }

  /** The tools/call entry point. Malformed calls come back as isError replies naming the field path. */
  async call(name: string, args: Record<string, unknown>): Promise<ToolReply> {
    try {
      const allowed = ALLOWED_ARGS[name]!;
      for (const k of Object.keys(args)) {
        if (!allowed.has(k)) throw new CallError(k, `is not an argument of ${name}; it takes ${[...allowed].join(', ') || 'none'}.`);
      }
      switch (name as ToolName) {
        case 'start_piece':
          return await this.start(args);
        case 'change_piece':
          return await this.change(args);
        case 'preview_piece':
          return await this.preview(args);
        case 'check_piece':
          return await this.check(args);
        case 'export_for_casting':
          return await this.export(args);
        case 'describe_piece':
          return await this.describe(args);
      }
      throw new Error(`no handler for ${name}`);
    } catch (e) {
      if (e instanceof CallError) return callError(e);
      throw e;
    }
  }

  #open(args: Record<string, unknown>): Piece {
    if (args['tree'] !== undefined) {
      this.#piece = validatePiece(args['tree'], 'tree');
      return this.#piece;
    }
    if (!this.#piece) {
      throw new CallError('tree', 'no piece is open in this conversation. Call start_piece, or pass the piece\'s tree (from its saved <name>.tree.json) as "tree".');
    }
    return this.#piece;
  }

  #previewFlag(args: Record<string, unknown>): boolean {
    const p = args['preview'];
    if (p !== undefined && typeof p !== 'boolean') throw new CallError('preview', 'must be true or false.');
    return p !== false;
  }

  async #withPiece(tree: PieceTree, lead: string, wantPreview: boolean): Promise<ToolReply> {
    const v = readPiece(tree);
    const files: OutFile[] = [];
    if (wantPreview) {
      const { png } = await preview(tree, [...DEFAULT_VIEWS]);
      files.push({ name: `${tree.name}.preview.png`, mimeType: MIME.png, bytes: png });
    }
    files.push(treeFile(tree));
    const texts = [`${lead} ${summary(tree, v)}`];
    const seat = seatLine(pieceDims(v));
    if (seat) texts[0] += ` ${seat}`;
    const ph = placeholderNote(v);
    if (ph) texts.push(`PLACEHOLDER: ${ph} The picture says so too.`);
    const note = METALS[v.metal].castingNote;
    if (note) texts.push(note);
    texts.push(treeText(tree));
    return reply(texts, files);
  }

  /** A program piece evaluated for a picture or a description; a program that cannot run is a malformed call naming `path`. */
  async #evaluate(p: ProgramPiece, path: string): Promise<ProgramView> {
    try {
      return await evaluateProgram(p, this.#limits);
    } catch (e) {
      if (e instanceof ProgramFailed) {
        const logs = e.logs.length ? ` It logged: ${e.logs.join(' | ')}` : '';
        throw new CallError(path, `${e.plain.replace(/\.$/, '')}. Nothing was changed.${logs}`);
      }
      throw e;
    }
  }

  async #withProgram(p: ProgramPiece, lead: string, wantPreview: boolean, view: ProgramView): Promise<ToolReply> {
    const files: OutFile[] = [];
    if (wantPreview) {
      const { png } = await previewProgram(p, [...DEFAULT_VIEWS], view, this.#limits);
      files.push({ name: `${p.name}.preview.png`, mimeType: MIME.png, bytes: png });
    }
    files.push(treeFile(p));
    const parts = view.run.parts ?? [];
    const texts = [`${lead} ${programSummary(p, view)}`, ...programSeatLines(parts), ...logText(view.logs)];
    const note = METALS[p.metal].castingNote;
    if (note) texts.push(note);
    texts.push(treeText(p));
    return reply(texts, files);
  }

  async start(args: Record<string, unknown>): Promise<ToolReply> {
    if (args['program'] !== undefined) return this.#startProgram(args);
    const template = checkStartArgs(args);
    const wantPreview = this.#previewFlag(args);
    const tree = treeFromTemplate(template, args);
    validateTree(tree);
    this.#piece = tree;
    return this.#withPiece(tree, 'Started.', wantPreview);
  }

  async #startProgram(args: Record<string, unknown>): Promise<ToolReply> {
    for (const k of Object.keys(args)) {
      if (k === 'program' || k === 'preview' || (PROGRAM_PIECE_SETTINGS as readonly string[]).includes(k)) continue;
      throw new CallError(
        k,
        k === 'template'
          ? 'start_piece takes a template or a program, not both. To start from a template and go on as a program, start the template, then pass "program" to change_piece (describe_piece shows the template as a program).'
          : 'a piece written as a program sets its band, stone and setting in the program (ringShank, prongHead, bezel ...); start_piece takes only "program", "name", "metal" and "shrinkage" with it.',
      );
    }
    for (const k of PROGRAM_PIECE_SETTINGS) if (args[k] !== undefined) checkParam(PARAM_BY_KEY.get(k)!, args[k], k);
    const wantPreview = this.#previewFlag(args);
    const p = programPiece(checkProgramSource(args['program'], 'program'), {
      ...(args['name'] !== undefined ? { name: args['name'] as string } : {}),
      ...(args['metal'] !== undefined ? { metal: args['metal'] as MetalId } : {}),
      ...(args['shrinkage'] !== undefined ? { shrinkage: args['shrinkage'] as string } : {}),
    });
    const view = await this.#evaluate(p, 'program');
    this.#piece = p;
    return this.#withProgram(p, 'Started.', wantPreview, view);
  }

  async change(args: Record<string, unknown>): Promise<ToolReply> {
    const wantPreview = this.#previewFlag(args);
    const set = args['set'];
    const program = args['program'];
    if (args['tree'] === undefined && set === undefined && program === undefined) {
      throw new CallError('set', 'say what to change, e.g. {"prong_count": 6}, or pass an edited "tree", or a new "program".');
    }
    if (set !== undefined && (set === null || typeof set !== 'object' || Array.isArray(set) || Object.keys(set).length === 0)) {
      throw new CallError('set', 'must be an object naming at least one setting, e.g. {"prong_thickness": "1.5 mm"}.');
    }
    const base = this.#open(args);
    if (program !== undefined || isProgramPiece(base)) return this.#changeProgram(base, program, set as Record<string, unknown> | undefined, wantPreview);
    let next: PieceTree;
    let lines: string[];
    if (set) {
      const r = applySet(base, set as Record<string, unknown>);
      next = r.tree;
      lines = r.changed.map((k) => `${k}: ${fmt(getSetting(base, k))} → ${fmt(getSetting(next, k))}`);
    } else {
      next = structuredClone(base);
      next.revision = base.revision + 1;
      lines = ['the whole tree, as passed'];
    }
    this.#piece = next;
    return this.#withPiece(next, `Changed ${lines.join('; ')}.`, wantPreview);
  }

  /** A change to a piece written as a program, or a template piece going on as a program: its program, and its name, metal or shrinkage. */
  async #changeProgram(base: Piece, program: unknown, set: Record<string, unknown> | undefined, wantPreview: boolean): Promise<ToolReply> {
    const lines: string[] = [];
    let next: ProgramPiece;
    if (program !== undefined) {
      const src = checkProgramSource(program, 'program');
      if (isProgramPiece(base)) {
        next = { ...base, program: src, revision: base.revision + 1 };
        lines.push(src === base.program ? 'nothing in the program (it is the same)' : 'the program');
      } else {
        next = { ...programPiece(src, { name: base.name, metal: base.metal, shrinkage: base.shrinkage }), revision: base.revision + 1 };
        lines.push(`the piece: it is now written as a program (it was built from the "${base.template}" template)`);
      }
    } else {
      next = { ...(base as ProgramPiece), revision: base.revision + 1 };
      if (!set) lines.push('the whole piece, as passed');
    }
    for (const [k, v] of Object.entries(set ?? {})) {
      if (!(PROGRAM_PIECE_SETTINGS as readonly string[]).includes(k)) {
        throw new CallError(
          `set.${k}`,
          PARAM_BY_KEY.has(k) || /\./.test(k)
            ? `this piece is written as a program, so "${k}" is changed in its program (the call that makes that part); pass the edited program as "program". set takes only ${PROGRAM_PIECE_SETTINGS.join(', ')} here.`
            : `"${k}" is not a setting; a piece written as a program takes ${PROGRAM_PIECE_SETTINGS.join(', ')} in set, and everything else in its program.`,
        );
      }
      checkParam(PARAM_BY_KEY.get(k)!, v, `set.${k}`);
      const before = (next as unknown as Record<string, unknown>)[k];
      (next as unknown as Record<string, unknown>)[k] = v;
      lines.push(`${k}: ${fmt(before)} → ${fmt(v)}`);
    }
    // The shrinkage allowance is read against the metal it is for.
    validatePiece(next, 'tree');
    const view = await this.#evaluate(next, program !== undefined ? 'program' : 'tree.program');
    this.#piece = next;
    return this.#withProgram(next, `Changed ${lines.join('; ')}.`, wantPreview, view);
  }

  async preview(args: Record<string, unknown>): Promise<ToolReply> {
    const tree = this.#open(args);
    const views = args['views'] ?? [...DEFAULT_VIEWS];
    if (!Array.isArray(views) || views.length < 1 || views.length > 4) throw new CallError('views', 'a list of 1 to 4 views.');
    views.forEach((v, i) => {
      if (!PREVIEW_VIEWS.includes(v)) throw new CallError(`views[${i}]`, `"${String(v)}" is not a view; the views are ${PREVIEW_VIEWS.join(', ')}.`);
      if (views.indexOf(v) !== i) throw new CallError(`views[${i}]`, `"${v}" is asked for twice.`);
    });
    if (isProgramPiece(tree)) {
      const view = await this.#evaluate(tree, 'tree.program');
      const { png } = await previewProgram(tree, views as ViewName[], view, this.#limits);
      const texts = [`Preview of ${programSummary(tree, view)} Views: ${views.join(', ')}. Any stone is drawn for the picture only; it is never part of a casting file.`, ...logText(view.logs)];
      return reply(texts, [{ name: `${tree.name}.preview.png`, mimeType: MIME.png, bytes: png }]);
    }
    const { png } = await preview(tree, views as ViewName[]);
    const v = readPiece(tree);
    const texts = [`Preview of ${summary(tree, v)} Views: ${views.join(', ')}. The stone is drawn for the picture only; it is never part of a casting file.`];
    const ph = placeholderNote(v);
    if (ph) texts.push(`PLACEHOLDER: ${ph}`);
    return reply(texts, [{ name: `${tree.name}.preview.png`, mimeType: MIME.png, bytes: png }]);
  }

  #verdictText(tree: Piece, r: Awaited<ReturnType<typeof checkPiece>>): string {
    const stl = r.report['stl'] as { file: string; sha256: string; triangles: number } | null;
    const lines = r.entries.map((c) => `- ${c.name} (limit ${c.limit}): ${c.result.toUpperCase()}, ${c.measured ?? 'not measured'}${c.where ? ` [${c.where.description}]` : ''}`);
    const head = stl
      ? `Checks for "${tree.name}" revision ${tree.revision}, on ${stl.file} as written (${stl.triangles} triangles, sha256 ${stl.sha256.slice(0, 12)}...), in ${(r.report['metal'] as { name: string }).name}:`
      : `Checks for "${tree.name}" revision ${tree.revision}: the casting file could not be made, so no check could run.`;
    return [head, ...lines].join('\n');
  }

  async check(args: Record<string, unknown>): Promise<ToolReply> {
    const tree = this.#open(args);
    const r = await checkPiece(tree, 'check', this.#limits);
    const head =
      r.verdict === 'pass'
        ? 'Every casting check passes on the file as an export would write it; export_for_casting will release it.'
        : `It would NOT cast as it is. What to thicken and where:\n${r.fixes.map((f) => `- ${f}`).join('\n')}`;
    const texts = [head, this.#verdictText(tree, r), `Shrinkage allowance: ${(r.report['shrinkage'] as { allowance: string }).allowance}. The stone is not part of the casting file. Full report: ${tree.name}.check.json.`];
    const ph = isProgramPiece(tree) ? null : placeholderNote(readPiece(tree));
    if (ph) texts.push(`PLACEHOLDER: ${ph} The checks are only as true as the stone's size.`);
    return reply(texts, [{ name: `${tree.name}.check.json`, mimeType: MIME.json, bytes: Buffer.from(JSON.stringify(r.report, null, 2) + '\n', 'utf8') }]);
  }

  async export(args: Record<string, unknown>): Promise<ToolReply> {
    const tree = this.#open(args);
    const r = await checkPiece(tree, 'export', this.#limits);
    const report: OutFile = { name: `${tree.name}.check.json`, mimeType: MIME.json, bytes: Buffer.from(JSON.stringify(r.report, null, 2) + '\n', 'utf8') };
    const sh = r.report['shrinkage'] as { applied: boolean; allowance: string };
    const shrink = `Shrinkage allowance: ${sh.applied ? `APPLIED, ${sh.allowance}` : 'not applied (off)'}.`;
    const note = METALS[tree.metal].castingNote;
    const ph = isProgramPiece(tree) ? null : placeholderNote(readPiece(tree));
    if (r.verdict !== 'pass' || !r.stl || !r.threeMf) {
      const texts = [
        `NOT EXPORTED: "${tree.name}" revision ${tree.revision} fails a casting check, so no casting file was released. What to thicken and where:\n${r.fixes.map((f) => `- ${f}`).join('\n')}`,
        this.#verdictText(tree, r),
        `${shrink} The report is ${tree.name}.check.json. A preview is still available with preview_piece.`,
      ];
      return reply(texts, [report]);
    }
    const texts = [
      `EXPORTED "${tree.name}" revision ${tree.revision} in ${METALS[tree.metal].name}: ${tree.name}.stl (binary STL, millimetres) and ${tree.name}.3mf, with the check report ${tree.name}.check.json. Every check passed on the STL as written. The stone is not in the files.`,
      this.#verdictText(tree, r),
      shrink,
    ];
    if (note) texts.push(note);
    if (ph) texts.push(`PLACEHOLDER: ${ph} Do not cast this until the stone's real size is in.`);
    return reply(texts, [
      { name: `${tree.name}.stl`, mimeType: MIME.stl, bytes: r.stl },
      { name: `${tree.name}.3mf`, mimeType: MIME.threeMf, bytes: r.threeMf },
      report,
    ]);
  }

  async describe(args: Record<string, unknown>): Promise<ToolReply> {
    const tree = this.#open(args);
    if (isProgramPiece(tree)) return this.#describeProgram(tree);
    const v = readPiece(tree);
    const n = await describeNumbers(tree);
    const catalog = PARAMS.map((p) => {
      const range = p.min !== undefined ? `, ${p.min} to ${p.max} mm` : p.values ? `, one of ${p.values.map((x) => JSON.stringify(x)).join(' / ')}` : '';
      const dflt = p.default !== undefined ? `, default ${JSON.stringify(p.default)}` : '';
      const limit = p.limit ? `, limit ${p.limit}` : '';
      return `- ${p.key} (now ${fmt(getSetting(tree, p.key))}${range}${dflt}${limit}): ${p.help}`;
    });
    const metal = METALS[v.metal];
    const texts = [
      summary(tree, v),
      `Dimensions as built (the finished piece, before any shrinkage allowance), each in mm. Work a fit, a weight or a cost from these, never from an assumed size:\n${dimensionLines(n.dims).join('\n')}`,
      `Overall size ${n.size[0]} × ${n.size[1]} × ${n.size[2]} mm (across the hand × along the finger × height). Metal volume about ${n.volumeMm3} mm³ (the stone excluded). Estimated weight: ${n.weights.map((w) => `${w.grams} g in ${w.metal}`).join('; ')}.`,
      `Casting limits in ${metal.name}: walls ${metal.limits.wall} mm, band ${metal.limits.band} mm, prongs ${metal.limits.prong} mm at their narrowest, details ${metal.limits.detail} mm, gaps ${metal.limits.gap} mm, surface within ${metal.limits.surfaceDeviation} mm.${metal.castingNote ? ` ${metal.castingNote}` : ''}`,
      `Settings change_piece can set:\n${catalog.join('\n')}\nAny part's setting can also be set as "<part>.<setting>": the parts here are ${listParts(tree)}. Head settings beyond the named ones: head.prong_grip (how far each prong reaches over the girdle), head.culet_clearance (room under the stone's point), head.prong_overrides (one prong's own thickness, e.g. [{"prong": 2, "thickness": "1.5 mm"}]; prongs are counted clockwise from 12 o'clock seen from above, the finger pointing to 12).`,
      `A tree's parts: ${PARTS.join(', ')}. To add a shape of your own, add a node {"id", "op", "params", "children"} to the root's children (ids are lower-case letters, digits and "_", unique in the piece) and pass the edited tree to change_piece. The operations, with their settings:\n${operationGuide()}`,
      `A shape the parts and operations above cannot make (a cabochon, a lion's face, a ship's hull) is written as a PROGRAM: pass "program" to change_piece and the piece goes on as a program. This piece, written as one (the same piece):\n${treeAsProgram(tree)}\nWhat a program can call:\n${programGuide(this.#limits)}`,
      treeText(tree),
    ];
    const ph = placeholderNote(v);
    if (ph) texts.splice(1, 0, `PLACEHOLDER: ${ph}`);
    return reply(texts);
  }

  async #describeProgram(p: ProgramPiece): Promise<ToolReply> {
    const view = await this.#evaluate(p, 'tree.program');
    const n = await describeProgram(p, view);
    const parts = view.run.parts ?? [];
    const metal = METALS[p.metal];
    const dims = programDimensionLines(parts);
    const texts = [
      programSummary(p, view),
      ...(dims.length ? [`Dimensions as built by its library parts (the finished piece, before any shrinkage allowance), each in mm. Work a fit, a weight or a cost from these, never from an assumed size:\n${dims.join('\n')}`] : []),
      `Overall size ${n.size[0]} × ${n.size[1]} × ${n.size[2]} mm (across the hand × along the finger × height). Metal volume about ${n.volumeMm3} mm³ (any stone excluded). Estimated weight: ${n.weights.map((w) => `${w.grams} g in ${w.metal}`).join('; ')}.`,
      `Casting limits in ${metal.name}: walls ${metal.limits.wall} mm, band ${metal.limits.band} mm, prongs ${metal.limits.prong} mm at their narrowest, details ${metal.limits.detail} mm, gaps ${metal.limits.gap} mm, surface within ${metal.limits.surfaceDeviation} mm.${metal.castingNote ? ` ${metal.castingNote}` : ''}`,
      `This piece is written as a program. Change it by passing the whole edited program as "program" to change_piece; set takes only ${PROGRAM_PIECE_SETTINGS.join(', ')}. What a program can call:\n${programGuide(this.#limits)}\nAn example, a cabochon in a bezel:\n${CABOCHON_EXAMPLE}`,
      ...logText(view.logs),
      treeText(p),
    ];
    return reply(texts);
  }
}

const UNIT_OF: Readonly<Record<string, string>> = { length: 'mm', angle: 'deg', points2: '[x, y] points in mm', points3: '[x, y, z] points in mm', plane: '"xy" | "yz" | "xz"', boolean: 'true | false', word: 'a word' };

/** Every operation, its settings with their units, and what it makes. */
function operationGuide(): string {
  return OPERATIONS.map((op) => {
    const settings = Object.entries(OP_PARAMS[op]).map(([k, kind]) => `${k} (${UNIT_OF[kind]})`);
    return `- ${op}${settings.length ? ` {${settings.join(', ')}}` : ''}: ${OP_HELP[op]}`;
  }).join('\n');
}

function listParts(tree: PieceTree): string {
  const out: string[] = [];
  const walk = (n: PieceTree['root']) => {
    if (n.part) out.push(`"${n.id}" (${n.part})`);
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree.root);
  return out.join(', ');
}
