// One session = one person working on one design (contract: flo2 starts one
// engine process per person and design). The session holds the piece open in
// this conversation; any call may instead carry a tree, which becomes the open
// piece (contract §3: a new session resumes from the saved <name>.tree.json).

import { CallError } from './errors.js';
import { applySet, checkStartArgs, getSetting, PARAMS, readTemplate, treeFromTemplate, validateTree, OPERATIONS, PARTS, type PieceTree, type TemplateView } from './piece/tree.js';
import { MIME, callError, reply, type OutFile, type ToolReply } from './reply.js';
import { STUB_BANNER, stubCheck, stubPreviewPng, type CheckRun } from './stub/engine.js';
import { DEFAULT_VIEWS, PREVIEW_VIEWS, TOOLS, type ToolName } from './tools.js';
import { STUB_ENGINE } from './version.js';

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

export function summary(tree: PieceTree, view: TemplateView): string {
  const profile = view.profile.replace('_', '-');
  const band = `${view.ringSize.system} size ${view.ringSize.size} (inner diameter ${view.innerDiameterMm.toFixed(2)} mm), ${profile} band ${view.bandWidthMm} mm wide and ${view.bandThicknessMm} mm thick`;
  const head = view.head
    ? `, one ${view.head.stoneDiameterMm} mm round stone in a ${view.head.prongCount}-prong head (prongs ${[...new Set(view.head.prongThicknessMm)].join(' / ')} mm thick)`
    : ', no stone (a plain band)';
  const kind = view.head ? 'Solitaire ring' : 'Plain band';
  return `${kind} "${tree.name}", revision ${tree.revision}: ${band}${head}. Shrinkage allowance: ${tree.shrinkage}.`;
}

function treeFile(tree: PieceTree): OutFile {
  return { name: `${tree.name}.tree.json`, mimeType: MIME.json, bytes: Buffer.from(JSON.stringify(tree, null, 2) + '\n', 'utf8') };
}

function treeText(tree: PieceTree): string {
  return `The piece's tree, revision ${tree.revision} (saved as ${tree.name}.tree.json; pass it back as "tree" to pick this piece up in a new conversation):\n${JSON.stringify(tree)}`;
}

function reportFile(run: CheckRun, name: string): OutFile {
  return { name: `${name}.check.json`, mimeType: MIME.json, bytes: Buffer.from(JSON.stringify(run.report, null, 2) + '\n', 'utf8') };
}

export class Session {
  #piece: PieceTree | undefined;

  /** The tools/call entry point. Malformed calls come back as isError replies naming the field path. */
  call(name: string, args: Record<string, unknown>): ToolReply {
    try {
      const allowed = ALLOWED_ARGS[name]!;
      for (const k of Object.keys(args)) {
        if (!allowed.has(k)) throw new CallError(k, `is not an argument of ${name}; it takes ${[...allowed].join(', ') || 'none'}.`);
      }
      switch (name as ToolName) {
        case 'start_piece':
          return this.start(args);
        case 'change_piece':
          return this.change(args);
        case 'preview_piece':
          return this.preview(args);
        case 'check_piece':
          return this.check(args);
        case 'export_for_casting':
          return this.export(args);
        case 'describe_piece':
          return this.describe(args);
      }
      throw new Error(`no handler for ${name}`);
    } catch (e) {
      if (e instanceof CallError) return callError(e);
      throw e;
    }
  }

  #open(args: Record<string, unknown>): PieceTree {
    if (args['tree'] !== undefined) {
      this.#piece = validateTree(args['tree'], 'tree');
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

  #withPiece(tree: PieceTree, lead: string, wantPreview: boolean): ToolReply {
    const view = readTemplate(tree);
    const files: OutFile[] = [];
    if (wantPreview) files.push({ name: `${tree.name}.preview.png`, mimeType: MIME.png, bytes: stubPreviewPng(view) });
    files.push(treeFile(tree));
    const texts = [`${lead} ${summary(tree, view)}`, treeText(tree)];
    if (STUB_ENGINE) texts.unshift(STUB_BANNER);
    return reply(texts, files);
  }

  start(args: Record<string, unknown>): ToolReply {
    const template = checkStartArgs(args);
    const wantPreview = this.#previewFlag(args);
    const tree = treeFromTemplate(template, args);
    validateTree(tree);
    this.#piece = tree;
    return this.#withPiece(tree, 'Started.', wantPreview);
  }

  change(args: Record<string, unknown>): ToolReply {
    const wantPreview = this.#previewFlag(args);
    const set = args['set'];
    if (args['tree'] === undefined && set === undefined) {
      throw new CallError('set', 'say what to change, e.g. {"prong_count": 6}, or pass an edited "tree".');
    }
    if (set !== undefined && (set === null || typeof set !== 'object' || Array.isArray(set) || Object.keys(set).length === 0)) {
      throw new CallError('set', 'must be an object naming at least one setting, e.g. {"prong_thickness": "1.3 mm"}.');
    }
    const base = this.#open(args);
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

  preview(args: Record<string, unknown>): ToolReply {
    const tree = this.#open(args);
    const views = args['views'] ?? [...DEFAULT_VIEWS];
    if (!Array.isArray(views) || views.length < 1 || views.length > 4) throw new CallError('views', 'a list of 1 to 4 views.');
    views.forEach((v, i) => {
      if (!PREVIEW_VIEWS.includes(v)) throw new CallError(`views[${i}]`, `"${String(v)}" is not a view; the views are ${PREVIEW_VIEWS.join(', ')}.`);
      if (views.indexOf(v) !== i) throw new CallError(`views[${i}]`, `"${v}" is asked for twice.`);
    });
    const view = readTemplate(tree);
    const texts = [`Preview of ${summary(tree, view)} Views: ${views.join(', ')}.`];
    if (STUB_ENGINE) texts.unshift(`${STUB_BANNER} The stub draws one schematic front view whatever views are asked for; prongs under the limit are red.`);
    return reply(texts, [{ name: `${tree.name}.preview.png`, mimeType: MIME.png, bytes: stubPreviewPng(view) }]);
  }

  #verdictText(tree: PieceTree, run: CheckRun): string {
    const r = run.report;
    const lines = r.checks.map((c) => `- ${c.name} (limit ${c.limit}): ${c.result.toUpperCase()}, ${c.measured ?? 'not measured'}`);
    return [`Checks for "${tree.name}" revision ${tree.revision}, on ${r.stl.file} as written (${r.stl.triangles} triangles, sha256 ${r.stl.sha256.slice(0, 12)}…):`, ...lines].join('\n');
  }

  check(args: Record<string, unknown>): ToolReply {
    const tree = this.#open(args);
    const run = stubCheck(tree, readTemplate(tree), 'check');
    const head =
      run.report.verdict === 'pass'
        ? 'Every casting check passes; export_for_casting will release the files.'
        : `It would NOT cast as it is. What to thicken and where:\n${run.fixes.map((f) => `- ${f}`).join('\n')}`;
    const texts = [head, this.#verdictText(tree, run), `Shrinkage allowance: ${run.report.shrinkage.allowance}. Full report: ${tree.name}.check.json.`];
    if (STUB_ENGINE) texts.unshift(STUB_BANNER);
    return reply(texts, [reportFile(run, tree.name)]);
  }

  export(args: Record<string, unknown>): ToolReply {
    const tree = this.#open(args);
    const run = stubCheck(tree, readTemplate(tree), 'export');
    const shrink = `Shrinkage allowance: ${run.report.shrinkage.applied ? `APPLIED, ${run.report.shrinkage.allowance}` : 'not applied (off)'}.`;
    const texts: string[] = [];
    if (STUB_ENGINE) texts.push(STUB_BANNER);
    if (run.report.verdict !== 'pass') {
      texts.push(
        `NOT EXPORTED: "${tree.name}" revision ${tree.revision} fails a casting check, so no casting file was released. What to thicken and where:\n${run.fixes.map((f) => `- ${f}`).join('\n')}`,
        this.#verdictText(tree, run),
        `${shrink} The report is ${tree.name}.check.json.`,
      );
      return reply(texts, [reportFile(run, tree.name)]);
    }
    texts.push(
      `EXPORTED "${tree.name}" revision ${tree.revision}: ${tree.name}.stl (binary STL, millimetres) and ${tree.name}.3mf, with the check report ${tree.name}.check.json. Every check passed on the STL as written.`,
      this.#verdictText(tree, run),
      shrink,
    );
    return reply(texts, [
      { name: `${tree.name}.stl`, mimeType: MIME.stl, bytes: run.stl },
      { name: `${tree.name}.3mf`, mimeType: MIME.threeMf, bytes: run.threeMf },
      reportFile(run, tree.name),
    ]);
  }

  describe(args: Record<string, unknown>): ToolReply {
    const tree = this.#open(args);
    const view = readTemplate(tree);
    const catalog = PARAMS.map((p) => {
      const range = p.min !== undefined ? `, ${p.min} to ${p.max} mm` : p.values ? `, one of ${p.values.map((v) => JSON.stringify(v)).join(' / ')}` : '';
      const dflt = p.default !== undefined ? `, default ${JSON.stringify(p.default)}` : '';
      const limit = p.limit ? `, casting limit ${p.limit}` : '';
      return `- ${p.key} (now ${fmt(getSetting(tree, p.key))}${range}${dflt}${limit}): ${p.help}`;
    });
    const texts = [
      summary(tree, view),
      STUB_ENGINE
        ? 'Overall size, metal volume and weight in sterling silver, 14k and 18k gold: not yet computed (Phase 1 stub engine).'
        : '',
      `Settings change_piece can set:\n${catalog.join('\n')}\nAny part's setting can also be set as "<part>.<setting>": the parts here are ${listParts(tree)}. Head settings beyond the named ones: seat_height (how high the stone sits above the band), prong_grip (how far each prong tip reaches over the stone), prong_overrides (one prong's own thickness, e.g. [{"prong": 2, "thickness": "1.3 mm"}]; prongs are counted clockwise from 12 o'clock seen from above, with the finger pointing to 12).`,
      `A tree's parts: ${PARTS.join(', ')}. Its operations: ${OPERATIONS.join(', ')}.`,
      treeText(tree),
    ].filter(Boolean);
    return reply(texts);
  }
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
