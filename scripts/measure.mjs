#!/usr/bin/env node
// Measures what the design asks to be measured, against the SHIPPED server
// (dist/main.js) over real stdio MCP:
//   · preview time for the typical ring (a solitaire, round stone, 6 prongs),
//     4 views at 512 × 512 px, cold (the kernel loads inside it) and warm
//     (con:preview-time, ver:preview-time-check);
//   · the casting export's own time, with every check at 0.01 mm
//     (ver:export-time-measured), for the solitaire and for Emily's piece;
//   · the session's peak memory, the server process's VmHWM (con:session-memory-in-flo2s-slot);
//   · install size without and with the Node runtime (con:install-size-engine,
//     con:install-size-with-runtime): the npm package's unpacked size, plus the node binary.
// Run it on one CPU: `taskset -c 0 node scripts/measure.mjs`, or in the slot's
// shape: MEASURE_IMAGE=flo2-cad node scripts/measure.mjs docker-slot. Writes measurements/<where>.json.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const where = process.argv[2] ?? 'local';

// MEASURE_IMAGE=<tag> runs the server inside that Docker image in the slot's shape
// (one CPU, 1 GB, no network, read-only root) instead of dist/main.js on this box.
const image = process.env.MEASURE_IMAGE;
const container = `flo2-cad-measure-${process.pid}`;
const transport = image
  ? new StdioClientTransport({ command: 'docker', args: ['run', '--rm', '-i', '--name', container, '--cpus', '1', '--memory', '1g', '--network', 'none', '--read-only', image], stderr: 'pipe' })
  : new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist/main.js')], stderr: 'pipe' });
const client = new Client({ name: 'flo2-cad-measure', version: '0' });
await client.connect(transport);
const pid = transport.pid;

const timed = async (name, args) => {
  const t0 = performance.now();
  const r = await client.callTool({ name, arguments: args });
  const s = (performance.now() - t0) / 1000;
  if (r.isError) throw new Error(`${name}: ${r.content[0]?.text}`);
  return { s: Math.round(s * 1000) / 1000, r };
};
const files = (r) => r.content.filter((b) => b.type === 'resource').map((b) => b.resource.uri.replace('cadfile:///', ''));

const typical = { template: 'solitaire_ring', ring_size: { system: 'US', size: '7' }, name: 'typical', prong_count: 6, preview: false };
const views = ['three_quarter', 'front', 'side', 'setting_closeup'];
await timed('start_piece', typical);
const cold = await timed('preview_piece', { views });
await timed('change_piece', { set: { ring_size: { system: 'US', size: '7.5' } }, preview: false });
const warm = await timed('preview_piece', { views });
await timed('change_piece', { set: { ring_size: { system: 'US', size: '7' } }, preview: false });
const exportTypical = await timed('export_for_casting', {});
if (!files(exportTypical.r).includes('typical.stl')) throw new Error('the typical ring did not export');
await timed('start_piece', { template: 'emerald_bezel_solitaire', ring_size: { system: 'US', size: '7' }, name: 'emily', preview: false });
const exportEmily = await timed('export_for_casting', {});
if (!files(exportEmily.r).includes('emily.stl')) throw new Error("Emily's piece did not export");

let peakMiB = null;
try {
  const status = image ? execFileSync('docker', ['exec', container, 'cat', '/proc/1/status'], { encoding: 'utf8' }) : readFileSync(`/proc/${pid}/status`, 'utf8');
  peakMiB = Math.round((Number(/VmHWM:\s+(\d+)\s+kB/.exec(status)?.[1]) / 1024) * 10) / 10;
} catch {
  /* not Linux */
}
await client.close();

// Install size: what `npm pack` would ship, unpacked, and the Node binary beside it.
const pack = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }))[0];
const engineMB = Math.round((pack.unpackedSize / 1e6) * 100) / 100;
const nodeMB = Math.round((statSync(process.execPath).size / 1e6) * 10) / 10;

const result = {
  measured_at: new Date().toISOString(),
  where,
  server: image ? `docker image ${image}: --cpus 1 --memory 1g --network none --read-only` : `${process.execPath} dist/main.js`,
  node: image ? execFileSync('docker', ['run', '--rm', '--entrypoint', 'node', image, '--version'], { encoding: 'utf8' }).trim() : process.version,
  cpus_visible: cpus().length,
  affinity: (() => {
    try {
      return execFileSync('taskset', ['-p', String(process.pid)], { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  })(),
  preview_4_views_512px_s: { cold_with_kernel_load: cold.s, warm: warm.s, limit: 5 },
  export_with_checks_s: { typical_solitaire_6_prongs: exportTypical.s, emerald_bezel_platinum: exportEmily.s },
  peak_memory_MiB: { value: peakMiB, limit: 1024 },
  install_MB: { engine_without_runtime: engineMB, files: pack.entryCount, node_binary: nodeMB, with_runtime: Math.round((engineMB + nodeMB) * 100) / 100, limits: { without: 25, with: 150 } },
};
writeFileSync(join(root, 'measurements', `${where}.json`), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
