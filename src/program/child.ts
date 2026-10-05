// THE EVALUATION CHILD: a short-lived Node process that runs ONE program, confined, and
// exits (run.ts starts it and holds its limits; it is never the engine's own process).
//
// stdin: one JSON request { source, runs: [{ tol, scale, blendSurface, reuseBlends,
// positionsOnly, wantStone }], deadline_ms, wasm_cap_bytes }.
// stdout: one frame, [4-byte length][JSON header][binary blobs], and nothing else.
//
// Each run is the program evaluated once, at one tolerance, in a NEW context (a fresh V8
// realm, codeGeneration off, microtasks drained inside the time limit) with only the
// prelude's globals (prelude.ts). The kernel is loaded once, with its WebAssembly memory
// capped (capWasm), and the runs of one request share a smooth blend's level set, as a
// tree's export and reference builds do (build.ts, BuildOptions.blendMeshes).

import vm from 'node:vm';
import type { FeatureDecl } from '../checker/features.js';
import { CallError } from '../errors.js';
import { kernel } from '../kernel/manifold.js';
import { Arena, type MeshOut } from '../library/build.js';
import { useGivenImages } from '../library/relief.js';
import type { BlendMeshes } from '../library/thicken.js';
import { ProgramLibrary, type PartReport } from './library.js';
import { PRELUDE, PRELUDE_FILENAME, PROGRAM_FILENAME } from './prelude.js';

export interface ChildRun {
  tol: number;
  scale: number;
  blendSurface?: boolean;
  reuseBlends?: boolean;
  /** Only the solid's vertices are wanted (the surface check's finer reference). */
  positionsOnly?: boolean;
  wantStone?: boolean;
}

export interface ChildRequest {
  source: string;
  runs: ChildRun[];
  /** Milliseconds from the child's start that every run together may take. */
  deadline_ms: number;
  wasm_cap_bytes: number;
  /** The height images the program names, read by the engine (this process reads no files), base64 by name. */
  images?: Record<string, string>;
}

/** How a program's evaluation can fail, as the child reports it. */
export type FailKind = 'program' | 'time' | 'memory' | 'engine';

let wasmCapHit = false;

/**
 * The kernel's memory ceiling. Its WebAssembly heap grows only through the JS API's
 * Memory.grow (emscripten's growMemory), so a growth past the cap is refused there:
 * the kernel's allocation fails, the call that asked for it fails, and the program gets a
 * plain error, before the process's resident memory reaches the hard limit run.ts holds.
 */
interface WasmMemory {
  buffer: ArrayBuffer;
  grow(pages: number): number;
}

function capWasm(capBytes: number): void {
  const proto = (globalThis as unknown as { WebAssembly: { Memory: { prototype: WasmMemory } } }).WebAssembly.Memory.prototype;
  const grow = proto.grow;
  proto.grow = function (this: WasmMemory, pages: number): number {
    if (this.buffer.byteLength + pages * 65536 > capBytes) {
      wasmCapHit = true;
      throw new RangeError('flo2-cad: the geometry kernel reached its memory limit');
    }
    return grow.call(this, pages);
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function writeFrame(header: unknown, blobs: Buffer[]): Promise<void> {
  const head = Buffer.from(JSON.stringify(header), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(head.length, 0);
  return new Promise((resolve) => process.stdout.write(Buffer.concat([len, head, ...blobs]), () => resolve()));
}

function fail(kind: FailKind, message: string, line: number | null, logs: string[]): Promise<void> {
  return writeFrame({ ok: false, kind, message, line, logs }, []);
}

/** A typed array as one blob of the frame; the header carries its index. */
function blobber(blobs: Buffer[]) {
  return (a: Float32Array | Uint32Array): number => {
    blobs.push(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    return blobs.length - 1;
  };
}

function meshOut(m: MeshOut, blob: (a: Float32Array | Uint32Array) => number, positionsOnly = false) {
  return positionsOnly ? { positions: blob(m.positions) } : { positions: blob(m.positions), triangles: blob(m.triangles) };
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const req = JSON.parse(await readStdin()) as ChildRequest;
  capWasm(req.wasm_cap_bytes);
  const k = await kernel();
  const A = new Arena();
  const kept: Map<string, import('../kernel/manifold.js').Mesh> = new Map();
  const blobs: Buffer[] = [];
  const blob = blobber(blobs);
  const runs: unknown[] = [];
  let logs: string[] = [];
  // The only images there are: what the engine read for this program.
  useGivenImages(new Map(Object.entries(req.images ?? {}).map(([name, b64]) => [name, Buffer.from(b64, 'base64')])));
  for (const run of req.runs) {
    const remaining = Math.floor(req.deadline_ms - (performance.now() - t0));
    if (remaining <= 0) return fail('time', 'the program ran past its time limit', null, logs);
    const blendMeshes: BlendMeshes = { meshes: kept, reuse: !!run.reuseBlends };
    const lib = new ProgramLibrary(k, A, run.tol, blendMeshes);
    const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY, { name: 'flo2-cad program', codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' }) as Record<string, unknown>;
    const setup = new vm.Script(PRELUDE, { filename: PRELUDE_FILENAME }).runInContext(ctx) as (bridge: (n: unknown, a: unknown) => string) => unknown;
    const runner = setup((name: unknown, args: unknown) => lib.call(name as string, args as string));
    let program: unknown;
    try {
      // The source is parsed as a FUNCTION BODY: nothing in it can close the function and
      // run outside it, and its `return` hands back the piece. Strict mode throughout.
      program = vm.compileFunction(`'use strict'; ${req.source}`, [], { parsingContext: ctx as vm.Context, filename: PROGRAM_FILENAME });
    } catch (e) {
      // A SyntaxError from parsing, made by V8 before any of the program has run.
      const stack = String((e as { stack?: unknown } | null)?.stack ?? '');
      const line = /program\.js:(\d+)/.exec(stack)?.[1];
      const what = /^(SyntaxError: .*)$/m.exec(stack)?.[1] ?? String((e as { message?: unknown } | null)?.message ?? e);
      return fail('program', `the program does not parse: ${what}`, line ? Number(line) : null, logs);
    }
    ctx['__flo2_run'] = runner;
    ctx['__flo2_program'] = program;
    let out: unknown;
    const started = performance.now();
    try {
      out = vm.runInContext('__flo2_run(__flo2_program)', ctx as vm.Context, { timeout: remaining, filename: 'flo2-cad-run.js' });
    } catch (e) {
      // What escaped the runner is not read: V8's time-limit error is made in the
      // program's realm, and anything else here is the program's own (reading it could
      // run its code outside its limit). The clock says which it was.
      if (performance.now() - started >= remaining - 25) return fail('time', 'the program ran past its time limit', null, logs);
      if (wasmCapHit) return fail('memory', 'the geometry kernel reached its memory limit', null, logs);
      return fail('engine', e instanceof Error ? `the program's run stopped: ${e.message}` : "the program's run stopped on something the engine does not read", null, logs);
    }
    if (typeof out !== 'string') return fail('engine', 'the program gave no answer', null, logs);
    const r = JSON.parse(out) as { ok?: number; error?: { message?: unknown; line?: unknown }; logs?: unknown };
    logs = Array.isArray(r.logs) ? r.logs.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];
    if (r.error !== undefined) {
      const msg = String(r.error.message ?? 'the program failed');
      return fail(wasmCapHit ? 'memory' : 'program', wasmCapHit ? 'the geometry kernel reached its memory limit' : msg, typeof r.error.line === 'number' ? r.error.line : null, logs);
    }
    try {
      const res = lib.finish(r.ok, run.scale, !!run.blendSurface);
      const decl: FeatureDecl & { blends?: unknown } = res.decl;
      const blends = (res.decl.blends ?? []).map((b) => ({ label: b.label, points: blob(b.points) }));
      runs.push({
        metal: meshOut(res.metal, blob, run.positionsOnly),
        ...(run.wantStone && res.stone ? { stone: meshOut(res.stone, blob) } : {}),
        ...(run.positionsOnly ? {} : { decl: { ...decl, blends }, parts: res.parts satisfies PartReport[] }),
      });
    } catch (e) {
      if (wasmCapHit) return fail('memory', 'the geometry kernel reached its memory limit', null, logs);
      if (e instanceof CallError) return fail('program', `${e.path}: ${e.problem}`, null, logs);
      return fail('engine', `the piece could not be finished: ${e instanceof Error ? e.message : String(e)}`, null, logs);
    }
  }
  await writeFrame({ ok: true, runs, blobs: blobs.map((b) => b.length), logs, ms: Math.round(performance.now() - t0) }, blobs);
}

main().then(
  () => process.exit(0),
  async (e) => {
    try {
      await fail(wasmCapHit ? 'memory' : 'engine', `the evaluation failed: ${e instanceof Error ? e.message : String(e)}`, null, []);
    } finally {
      process.exit(1);
    }
  },
);
