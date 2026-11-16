// HOW A PROGRAM IS RUN, CONFINED (cap:the-agent-writes-a-piece-as-a-program; the model is
// the main session's recommendation, PROPOSED in dec:idea-how-a-program-is-confined and
// not yet the owner's word).
//
// Every evaluation is a SEPARATE, short-lived child process (child.ts), started here:
//   · TIME: a wall-clock limit, enforced twice: inside the child by V8's own watchdog on
//     the program's context (a clean "ran past its time limit"), and here by SIGKILL a
//     moment after it, whatever the child is doing. Both clocks start when the child says
//     READY (its kernel loaded, its program parsed), not when it is spawned: starting Node
//     and the kernel is the engine's time, and has its own bound (STARTUP_SECONDS), past
//     which the evaluation is the ENGINE's failure, never "the program ran too long". A
//     program that does not parse is refused before READY, so never as slow.
//   · MEMORY: the child's V8 heap is capped (--max-old-space-size), the kernel's
//     WebAssembly heap is capped (child.ts, capWasm), and its resident memory is read from
//     /proc every 20 ms and the child is SIGKILLed past the limit. On Linux the child is
//     also first in line for the kernel's out-of-memory killer (oom_score_adj 1000), so a
//     container at its cap loses the child, not the engine.
//   · WHAT IT CAN REACH: an empty environment (no secret of the engine's reaches it); Node's
//     permission model, reading only the engine's own files and the kernel, writing
//     nothing, starting no process or worker, loading no native addon; code generation
//     from strings off. Inside it, the program runs in a context with only the language's
//     built-ins and the library (prelude.ts): no require, import, process, file system,
//     network or timers, and it holds handles, never the engine's objects (library.ts).
//   · WHAT COMES BACK: one frame on stdout, read here, at most MAX_OUTPUT_BYTES: the mesh
//     (vertices and triangles), the declarations the LIBRARY made, the dimensions its parts
//     report, and for a preview the stones. Nothing else. verify.ts rebuilds each of them
//     field by field, and checks that every declaration has metal where it says.
//   · WHERE IT STOPPED: as each library call starts and ends, the child says on stderr where it
//     stands (the call running, the heaviest and the slowest calls so far; child.ts, library.ts
//     Progress), and a refusal at either limit says it, however the evaluation was stopped: by
//     the child itself, or killed from here, when it can say nothing more. On 2026-11-12 a check
//     on flo2.io ran past 20 s in a blend and said only the limit, six times over, and the chat
//     had to guess (fact:root-cause-a-blend-over-a-whole-ring-outgrows-a-programs-limits-2026-11-15).
//   · The CHECKER and the EXPORTER run here, in the engine's process, on what came back:
//     the program cannot touch the check, and "the check runs on the exact file released"
//     holds (engine.ts writes the STL from this mesh, and checks those bytes).
// On flo2.io the helper's container (no network, a memory cap, one CPU, a read-only root)
// stays the security boundary around all of it.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kernelDir } from '../kernel/manifold.js';
import type { ChildRequest, ChildRun, FailKind } from './child.js';
import { PROGRAM_CALLS, PROGRESS_MARK } from './library.js';
import { readRun, type RunOut } from './verify.js';

export const DEFAULT_SECONDS = 20;
export const DEFAULT_MEMORY_MIB = 512;
/**
 * How long the engine may take to START an evaluation (Node, the engine's modules and the
 * kernel loaded, the program parsed) before the program's clock starts. Measured 2026-10-05:
 * 0.15 s on an Intel N95, the same on one CPU, 1.1 s on one CPU shared eight ways.
 */
export const STARTUP_SECONDS = 10;
/** The most a child may write back: far more than any piece's meshes (an openwork ring's export and reference come to about 6 MB). */
export const MAX_OUTPUT_BYTES = 256 * 2 ** 20;

export interface ProgramLimits {
  /** Wall-clock seconds one evaluation (every run of one request together) may take, from the moment its child is ready. */
  seconds: number;
  /** The child's resident memory limit, in MiB. */
  memoryMiB: number;
  /** Seconds the engine may take to START an evaluation, before the program's clock starts (default STARTUP_SECONDS). The engine's own bound, not the program's. */
  startupSeconds?: number;
}

/** The limits, from FLO2_CAD_PROGRAM_SECONDS and FLO2_CAD_PROGRAM_MEMORY_MIB when set (a host sizes them to its slot), else the defaults. */
export function programLimits(env: NodeJS.ProcessEnv = process.env): ProgramLimits {
  const s = Number(env['FLO2_CAD_PROGRAM_SECONDS'] ?? DEFAULT_SECONDS);
  const m = Number(env['FLO2_CAD_PROGRAM_MEMORY_MIB'] ?? DEFAULT_MEMORY_MIB);
  return {
    seconds: Number.isFinite(s) && s > 0 && s <= 600 ? s : DEFAULT_SECONDS,
    memoryMiB: Number.isFinite(m) && m >= 128 && m <= 65536 ? m : DEFAULT_MEMORY_MIB,
  };
}

/** Where an evaluation stopped at a limit: the library call it was in (null: the program's own code), and the calls that cost the most before it. */
export interface StoppedAt {
  call: string | null;
  /** The calls named as the heaviest (memory) or the slowest (time), the most first. */
  costliest: string[];
}

/** A program that could not be evaluated: what stopped it, in plain words, and the line when there is one. */
export class ProgramFailed extends Error {
  readonly kind: FailKind | 'output';
  readonly line: number | null;
  readonly logs: string[];
  /** For a refusal at the time or the memory limit: where it stopped. */
  readonly stopped: StoppedAt | null;
  constructor(kind: FailKind | 'output', line: number | null, message: string, logs: string[] = [], stopped: StoppedAt | null = null) {
    super(message);
    this.name = 'ProgramFailed';
    this.kind = kind;
    this.line = line;
    this.logs = logs;
    this.stopped = stopped;
  }
  /** "line 7: ...", or the limit that was hit. */
  get plain(): string {
    return this.line !== null ? `line ${this.line}: ${this.message}` : this.message;
  }
}

export interface ProgramRun {
  runs: RunOut[];
  /** What the program wrote with console.log, at most 50 lines. */
  logs: string[];
  ms: number;
  /** The child's largest resident memory seen, in MiB (Linux only). */
  peakRssMiB: number | null;
}

/** The child's script and what it may read: the engine's own files (built or bundled), its package.json, and the kernel. */
export function childEntry(): { entry: string; read: string[] } {
  const here = fileURLToPath(import.meta.url);
  // Built by tsc: build/src/program/run.js beside child.js. Bundled: dist/main.js beside dist/program-child.js.
  const built = basename(here) === 'run.js' && existsSync(join(dirname(here), 'child.js'));
  const entry = built ? join(dirname(here), 'child.js') : join(dirname(here), 'program-child.js');
  const codeRoot = built ? dirname(dirname(here)) : dirname(here);
  const read = [codeRoot, kernelDir()];
  // The nearest package.json says the engine's .js files are ES modules.
  let dir = dirname(entry);
  for (let i = 0; i < 6; i++) {
    const pj = join(dir, 'package.json');
    if (existsSync(pj)) {
      read.push(pj);
      break;
    }
    dir = dirname(dir);
  }
  return { entry, read };
}

/**
 * What the child last said of where it stood (child.ts, its progress lines), read field by field:
 * only a known call's name and whole counts are kept, so nothing else the child might write is
 * ever said as one.
 */
interface Said {
  run: number;
  /** How many calls had started: a new call, even of the same kind, starts its own clock. */
  started: number;
  in: string | null;
  /** When the engine read that the call running now had started (performance.now()). */
  since: number;
  /** The program had returned, and its piece's mesh was being made. */
  finishing: boolean;
  heaviest: { call: string; calls: number; triangles: number }[];
  slowest: { call: string; calls: number; ms: number }[];
}

const KNOWN = new Set<string>(PROGRAM_CALLS);
const known = (v: unknown): v is string => typeof v === 'string' && KNOWN.has(v);
const whole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

function readSaid(line: string, before: Said | null, now: number): Said | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return before;
  }
  if (!o || typeof o !== 'object' || !whole(o['run']) || !whole(o['started'])) return before;
  const inCall = known(o['in']) ? o['in'] : null;
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 3).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && known((x as Record<string, unknown>)['call']) && whole((x as Record<string, unknown>)['calls'])) : []);
  return {
    run: o['run'] as number,
    started: o['started'] as number,
    in: inCall,
    finishing: o['finishing'] === true,
    // The call still running (a failed call stays it until the next starts) keeps the time it started.
    since: before && before.in === inCall && before.run === o['run'] && before.started === o['started'] ? before.since : now,
    // A line that leaves the tallies out has not changed them in substance.
    heaviest: 'heaviest' in o ? list(o['heaviest']).filter((x) => whole(x['triangles'])).map((x) => ({ call: x['call'] as string, calls: x['calls'] as number, triangles: x['triangles'] as number })) : before && before.run === o['run'] ? before.heaviest : [],
    slowest: 'slowest' in o ? list(o['slowest']).filter((x) => whole(x['ms'])).map((x) => ({ call: x['call'] as string, calls: x['calls'] as number, ms: x['ms'] as number })) : before && before.run === o['run'] ? before.slowest : [],
  };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Where an evaluation stopped at a limit, in words, after the limit it met: "; it was in a
 * smoothUnion call (for 14.2 s), in build 1 of 2; its slowest calls: smoothUnion (1 call,
 * 14.2 s so far), sweep (2 calls, 2.4 s)" for time, "; it ran out in a sweep call; its heaviest
 * calls before it stopped: sweep (2 calls, 181,568 triangles)" for memory. Said whichever way
 * the evaluation was stopped: by the child itself, or killed from here, when it could say
 * nothing more.
 */
function stoppedText(kind: 'time' | 'memory', said: Said | null, runs: number, now: number): { text: string; stopped: StoppedAt } {
  const call = said?.in ?? null;
  const where = said?.finishing
    ? kind === 'time'
      ? '; the program had returned, and it was making the mesh of the piece it returned'
      : '; the program had returned, and it ran out making the mesh of the piece it returned'
    : kind === 'time'
      ? call
        ? `; it was in a ${call} call (for ${seconds(now - said!.since)})`
        : "; it was in the program's own code, between library calls"
      : call
        ? `; it ran out in a ${call} call`
        : "; it ran out in the program's own code, between library calls";
  const build = said && runs > 1 ? `, in build ${said.run + 1} of ${runs}` : '';
  let costly: string[] = [];
  let list = '';
  if (kind === 'time') {
    // The call running now counts too, for the time it has taken so far.
    const rows = (said?.slowest ?? []).map((x) => ({ ...x, now: false }));
    if (call && !said?.finishing) {
      const row = rows.find((x) => x.call === call);
      const ms = now - said!.since;
      if (row) Object.assign(row, { calls: row.calls + 1, ms: row.ms + ms, now: true });
      else rows.push({ call, calls: 1, ms, now: true });
    }
    rows.sort((a, b) => b.ms - a.ms);
    const top = rows.slice(0, 3);
    costly = top.map((x) => x.call);
    if (top.length) list = `; its slowest calls: ${top.map((x) => `${x.call} (${x.calls} call${x.calls === 1 ? '' : 's'}, ${seconds(x.ms)}${x.now ? ' so far' : ''})`).join(', ')}`;
  } else {
    const top = said?.heaviest ?? [];
    costly = top.map((x) => x.call);
    if (top.length) list = `; its heaviest calls before it stopped: ${top.map((x) => `${x.call} (${x.calls} call${x.calls === 1 ? '' : 's'}, ${x.triangles.toLocaleString('en-US')} triangles)`).join(', ')}`;
  }
  return { text: `${where}${build}${list}`, stopped: { call, costliest: costly } };
}

/** Resident memory of a process in bytes, from /proc (Linux); null where there is none. */
function rssOf(pid: number): number | null {
  try {
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

/** For tests only: a look at the child the moment it is started (test/program.test.ts stalls its start-up with it). */
export interface RunHooks {
  started?: (child: ChildProcess) => void;
}

/** Evaluates a program, once per run, in one confined child. Resolves with what came back, verified; rejects with ProgramFailed. */
export async function runProgram(source: string, runs: ChildRun[], limits: ProgramLimits = programLimits(), hooks: RunHooks = {}): Promise<ProgramRun> {
  const t0 = performance.now();
  const { entry, read } = childEntry();
  const heapMiB = Math.max(64, Math.floor(limits.memoryMiB / 2));
  const wasmCap = Math.max(96, limits.memoryMiB - 128) * 2 ** 20;
  const limitBytes = limits.memoryMiB * 2 ** 20;
  const args = [`--max-old-space-size=${heapMiB}`, '--disallow-code-generation-from-strings', '--permission', ...read.map((p) => `--allow-fs-read=${p}`), entry];
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'], env: {}, windowsHide: true });
  const pid = child.pid;
  hooks.started?.(child);
  if (pid !== undefined) {
    try {
      writeFileSync(`/proc/${pid}/oom_score_adj`, '1000');
    } catch {
      /* not Linux, or not allowed: the other limits still hold */
    }
  }
  const request: ChildRequest = { source, runs, deadline_ms: limits.seconds * 1000, wasm_cap_bytes: wasmCap };

  return new Promise<ProgramRun>((resolve, reject) => {
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = '';
    let stopped: ProgramFailed | null = null;
    let peak: number | null = null;
    // What the child last said of where it stood (its progress lines on stderr).
    let said: Said | null = null;
    let errLine = '';
    /** A refusal at the time or the memory limit, saying where the evaluation stopped. */
    const atLimit = (kind: 'time' | 'memory', message: string, line: number | null = null, logs: string[] = []) => {
      const now = performance.now();
      const { text, stopped: at } = stoppedText(kind, said, runs.length, now);
      return new ProgramFailed(kind, line, `${message}${text}`, logs, at);
    };
    const stop = (f: ProgramFailed) => {
      if (stopped) return;
      stopped = f;
      child.kill('SIGKILL');
    };
    // Until the child says READY, only the engine's start-up bound runs; then the program's backstop.
    const startupSeconds = limits.startupSeconds ?? STARTUP_SECONDS;
    const startup = setTimeout(
      () => stop(new ProgramFailed('engine', null, `the engine could not start the program's evaluation within ${startupSeconds} s (the machine is too busy); none of the program ran, so try again`)),
      startupSeconds * 1000,
    );
    let hard: ReturnType<typeof setTimeout> | undefined;
    let head = Buffer.alloc(0);
    const ready = () => {
      clearTimeout(startup);
      hard = setTimeout(() => stop(atLimit('time', `the program ran past its time limit (${limits.seconds} s) and was stopped`)), limits.seconds * 1000 + 1500);
    };
    const watch = setInterval(() => {
      if (pid === undefined) return;
      const rss = rssOf(pid);
      if (rss === null) return;
      peak = Math.max(peak ?? 0, rss);
      if (rss > limitBytes) stop(atLimit('memory', `the program used more than its memory limit (${limits.memoryMiB} MiB) and was stopped`));
    }, 20);
    child.stdout.on('data', (c: Buffer) => {
      // The first frame's length: 0 is READY.
      if (head.length < 4) {
        head = Buffer.concat([head, c.subarray(0, 4 - head.length)]);
        if (head.length === 4 && head.readUInt32LE(0) === 0) ready();
      }
      outBytes += c.length;
      if (outBytes > MAX_OUTPUT_BYTES) stop(new ProgramFailed('output', null, `the program's piece came to more than ${MAX_OUTPUT_BYTES / 2 ** 20} MiB of mesh; make it simpler`));
      else out.push(c);
    });
    child.stderr.on('data', (c: Buffer) => {
      // Whole lines: a progress line is read for where the evaluation stands (only the last one
      // matters); anything else is a diagnostic, kept up to 64 KiB.
      const lines = (errLine + c.toString('utf8')).split('\n');
      errLine = lines.pop() ?? '';
      if (errLine.length > 65536) errLine = '';
      for (const l of lines) {
        if (l.startsWith(PROGRESS_MARK)) said = readSaid(l.slice(PROGRESS_MARK.length), said, performance.now());
        else if (err.length < 65536) err += `${l}\n`;
      }
    });
    child.stdin.on('error', () => {
      /* the child may die before reading it all; its exit says why */
    });
    child.stdin.end(JSON.stringify(request));
    child.on('error', (e) => stop(new ProgramFailed('engine', null, `the program could not be started: ${e.message}`)));
    child.on('close', (code, signal) => {
      clearTimeout(startup);
      clearTimeout(hard);
      clearInterval(watch);
      const ms = performance.now() - t0;
      const peakMiB = peak === null ? null : Math.round((peak as number) / 2 ** 20);
      if (stopped) return reject(stopped);
      const all = Buffer.concat(out);
      const buf = all.length >= 4 && all.readUInt32LE(0) === 0 ? all.subarray(4) : all;
      if (buf.length < 4) {
        if (/heap out of memory|Reached heap limit|Allocation failed/i.test(err)) return reject(atLimit('memory', `the program used more than its memory limit (${heapMiB} MiB of JavaScript heap) and was stopped`));
        if (signal === 'SIGKILL') return reject(atLimit('memory', `the program was stopped by the system, most likely for memory (its limit is ${limits.memoryMiB} MiB)`));
        return reject(new ProgramFailed('engine', null, `the program's evaluation ended with no answer (exit ${code ?? signal}): ${err.trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'no message'}`));
      }
      try {
        const len = buf.readUInt32LE(0);
        if (len > buf.length - 4 || len > 64 * 2 ** 20) throw new Error('its answer is malformed');
        const header = JSON.parse(buf.subarray(4, 4 + len).toString('utf8')) as Record<string, unknown>;
        const logs = Array.isArray(header['logs']) ? (header['logs'] as unknown[]).filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 300)).slice(0, 50) : [];
        if (header['ok'] !== true) {
          const kind = (['program', 'time', 'memory', 'engine'] as const).find((k) => k === header['kind']) ?? 'engine';
          const line = typeof header['line'] === 'number' && Number.isInteger(header['line']) ? (header['line'] as number) : null;
          const msg = String(header['message'] ?? 'the program failed').slice(0, 1000);
          if (kind === 'time') return reject(atLimit('time', `${msg} (${limits.seconds} s)`, line, logs));
          if (kind === 'memory') return reject(atLimit('memory', `${msg} (${limits.memoryMiB} MiB)`, line, logs));
          return reject(new ProgramFailed(kind, line, msg, logs));
        }
        // The blobs, in order, each copied out so it is aligned for its typed array.
        const sizes = header['blobs'];
        if (!Array.isArray(sizes) || sizes.length > 10_000) throw new Error('its answer lists no files');
        const blobs: Buffer[] = [];
        let off = 4 + len;
        for (const n of sizes) {
          if (!Number.isInteger(n) || n < 0 || off + (n as number) > buf.length) throw new Error('its answer is cut short');
          blobs.push(Buffer.from(buf.subarray(off, off + (n as number))));
          off += n as number;
        }
        const raw = header['runs'];
        if (!Array.isArray(raw) || raw.length !== runs.length) throw new Error('its answer has the wrong number of runs');
        const done = raw.map((r, i) => readRun(r, blobs, runs[i]!));
        resolve({ runs: done, logs, ms, peakRssMiB: peakMiB });
      } catch (e) {
        reject(new ProgramFailed('engine', null, `the program's answer could not be read: ${e instanceof Error ? e.message : String(e)}`));
      }
    });
  });
}
