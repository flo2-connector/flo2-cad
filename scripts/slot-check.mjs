#!/usr/bin/env node
// Runs check_piece on one piece file inside the engine's image, confined as flo2's slot
// confines it (one CPU, no network, a read-only root, a memory cap with no swap), and fails
// unless the reply comes within flo2's door (cap:the-casting-check-finishes-in-time-for-any-piece).
// The file is a tree or a program piece; a program is evaluated in its own child process
// inside the container, so this also proves that process starts and runs there.
//   node scripts/slot-check.mjs <image> <tree.json> [door_s=60] [memory=1g] [must-pass]
// With "must-pass", the answer must also be that every casting check passes.
// No dependencies: CI runs it beside the image, before any npm install.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [image, treePath, doorArg = '60', memory = '1g', expect] = process.argv.slice(2);
if (!image || !treePath) {
  console.error('usage: node scripts/slot-check.mjs <image> <tree.json> [door_s] [memory]');
  process.exit(2);
}
const door = Number(doorArg);
const tree = JSON.parse(readFileSync(treePath, 'utf8'));
const name = `flo2-cad-slot-check-${process.pid}`;
const child = spawn('docker', ['run', '--rm', '-i', '--name', name, '--cpus', '1', '--memory', memory, '--memory-swap', memory, '--network', 'none', '--read-only', image], { stdio: ['pipe', 'pipe', 'inherit'] });
const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
let buf = '';
let t0 = 0;
let done = false;
const finish = (code, line) => {
  if (done) return;
  done = true;
  console.log(line);
  spawn('docker', ['rm', '-f', name], { stdio: 'ignore' }).on('close', () => process.exit(code));
};
child.stdout.on('data', (d) => {
  buf += d;
  for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
    const m = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (m.id === 1) {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      t0 = performance.now();
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'check_piece', arguments: { tree } } });
    } else if (m.id === 2) {
      const s = (performance.now() - t0) / 1000;
      const text = m.result?.content?.find((c) => c.type === 'text')?.text ?? '';
      if (m.result?.isError || m.error) finish(1, `check_piece failed after ${s.toFixed(1)} s: ${(m.error?.message ?? text).slice(0, 300)}`);
      else if (expect === 'must-pass' && !/Every casting check passes/.test(text)) finish(1, `check_piece on ${tree.name} answered in ${s.toFixed(1)} s, but not with a pass: ${text.slice(0, 400)}`);
      else finish(s <= door ? 0 : 1, `check_piece on ${tree.name} answered in ${s.toFixed(1)} s (door ${door} s, ${memory}, 1 CPU)`);
    }
  }
});
child.on('close', (code, signal) => finish(1, `the engine exited before answering (code ${code}, signal ${signal}${code === 137 ? ': killed, most likely for memory' : ''}) after ${t0 ? ((performance.now() - t0) / 1000).toFixed(1) : 0} s`));
setTimeout(() => finish(1, `check_piece on ${tree.name} did not answer within ${door} s (1 CPU, ${memory})`), (door + 15) * 1000).unref();
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'slot-check', version: '0' } } });
