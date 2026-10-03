// The published seam, exercised over real stdio the way flo2's door and a laptop
// agent reach it: tools/list, the reply shapes, and isError only for malformed calls.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

type Block = { type: string; text?: string; resource?: { uri: string; mimeType: string; blob: string } };
type Reply = { content: Block[]; isError?: boolean };

let client: Client;

async function call(name: string, args: Record<string, unknown>): Promise<Reply> {
  return (await client.callTool({ name, arguments: args })) as Reply;
}
const texts = (r: Reply) => r.content.filter((b) => b.type === 'text').map((b) => b.text!).join('\n');
const files = (r: Reply) => Object.fromEntries(r.content.filter((b) => b.type === 'resource').map((b) => [b.resource!.uri, b.resource!]));
const treeOf = (r: Reply) => JSON.parse(Buffer.from(files(r)[Object.keys(files(r)).find((u) => u.endsWith('.tree.json'))!]!.blob, 'base64').toString('utf8'));

before(async () => {
  client = new Client({ name: 'flo2-cad-test', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [MAIN], stderr: 'pipe' }));
});
after(async () => {
  await client.close();
});

describe('the tool list', () => {
  it('publishes exactly the six tools, each classed read or write', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name),
      ['start_piece', 'change_piece', 'preview_piece', 'check_piece', 'export_for_casting', 'describe_piece'],
    );
    const readOnly = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint]));
    assert.deepEqual(readOnly, {
      start_piece: false,
      change_piece: false,
      preview_piece: true,
      check_piece: true,
      export_for_casting: false,
      describe_piece: true,
    });
    for (const t of tools) assert.match(t.name, /^[a-z][a-z0-9_]*$/);
  });

  it('names the versions package.json and the installed kernel carry', async () => {
    const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
    const kernel = JSON.parse(readFileSync(`${ROOT}node_modules/manifold-3d/package.json`, 'utf8'));
    assert.equal(client.getServerVersion()?.version, pkg.version);
    assert.equal(pkg.dependencies['manifold-3d'], '3.5.4');
    assert.equal(kernel.version, '3.5.4');
  });
});

describe('reply shapes (contract §1, §3, §4)', () => {
  it('start_piece returns a preview PNG and the tree as cadfile resources, and the tree as text', async () => {
    const r = await call('start_piece', { template: 'solitaire_ring', ring_size: { system: 'US', size: '7' }, name: 'test-ring' });
    assert.equal(r.isError, false);
    const f = files(r);
    assert.deepEqual(Object.keys(f).sort(), ['cadfile:///test-ring.preview.png', 'cadfile:///test-ring.tree.json']);
    assert.equal(f['cadfile:///test-ring.preview.png']!.mimeType, 'image/png');
    assert.deepEqual([...Buffer.from(f['cadfile:///test-ring.preview.png']!.blob, 'base64').subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    for (const uri of Object.keys(f)) assert.match(uri, /^cadfile:\/\/\/[A-Za-z0-9._-]+$/);
    const tree = treeOf(r);
    assert.equal(tree.format, 'flo2-cad.tree/1');
    assert.equal(tree.revision, 1);
    assert.match(texts(r), /US size 7 \(inner diameter 17\.32 mm\)/);
  });

  it('a too-thin prong is drawn, then refused at export as a NORMAL reply that says what to thicken and where', async () => {
    const changed = await call('change_piece', { set: { prong_thickness: '0.7 mm' } });
    assert.equal(changed.isError, false);
    assert.equal(treeOf(changed).revision, 2);
    const r = await call('export_for_casting', {});
    assert.equal(r.isError, false);
    const f = files(r);
    assert.deepEqual(Object.keys(f), ['cadfile:///test-ring.check.json']);
    assert.match(texts(r), /NOT EXPORTED/);
    assert.match(texts(r), /Thicken all 4 prongs to at least 1\.0 mm/);
    const report = JSON.parse(Buffer.from(f['cadfile:///test-ring.check.json']!.blob, 'base64').toString('utf8'));
    assert.equal(report.verdict, 'fail');
    assert.equal(report.export, 'refused');
    const prong = report.checks.find((c: { id: string }) => c.id === 'prong');
    assert.equal(prong.result, 'fail');
    assert.equal(prong.where.part, 'head');
    assert.match(prong.where.clock, /^\d+:\d\d$/);
  });

  it('a piece that passes exports STL, 3MF and the check report, and the report names the written STL', async () => {
    await call('change_piece', { set: { prong_thickness: '1.2 mm', prong_count: 6 } });
    const r = await call('export_for_casting', {});
    assert.equal(r.isError, false);
    const f = files(r);
    assert.deepEqual(Object.keys(f), ['cadfile:///test-ring.stl', 'cadfile:///test-ring.3mf', 'cadfile:///test-ring.check.json']);
    assert.equal(f['cadfile:///test-ring.stl']!.mimeType, 'model/stl');
    assert.equal(f['cadfile:///test-ring.3mf']!.mimeType, 'model/3mf');
    const stl = Buffer.from(f['cadfile:///test-ring.stl']!.blob, 'base64');
    assert.equal(stl.length, 84 + 50 * stl.readUInt32LE(80));
    const report = JSON.parse(Buffer.from(f['cadfile:///test-ring.check.json']!.blob, 'base64').toString('utf8'));
    const { createHash } = await import('node:crypto');
    assert.equal(report.stl.sha256, createHash('sha256').update(stl).digest('hex'));
    assert.equal(report.shrinkage.applied, false);
    assert.equal(report.kernel.version, '3.5.4');
    assert.equal(Buffer.from(f['cadfile:///test-ring.3mf']!.blob, 'base64').readUInt32LE(0), 0x04034b50);
  });

  it('a tree round-trips: passed back in a fresh session, it describes the same piece', async () => {
    const started = await call('start_piece', { template: 'solitaire_ring', ring_size: { system: 'UK', size: 'N' }, name: 'round-trip', prong_count: 6 });
    const tree = treeOf(started);
    const other = new Client({ name: 'flo2-cad-test-2', version: '0' });
    await other.connect(new StdioClientTransport({ command: process.execPath, args: [MAIN], stderr: 'pipe' }));
    try {
      const d = (await other.callTool({ name: 'describe_piece', arguments: { tree } })) as Reply;
      assert.equal(d.isError, false);
      assert.match(texts(d), /UK size N/);
      const echoed = JSON.parse(texts(d).split('\n').find((l) => l.startsWith('{"format"'))!);
      assert.deepEqual(echoed, tree);
    } finally {
      await other.close();
    }
  });
});

describe('malformed calls are isError and name the field path (contract §4)', () => {
  it('refuses a number with no unit', async () => {
    const r = await call('change_piece', { set: { prong_thickness: 1.2 } });
    assert.equal(r.isError, true);
    assert.match(texts(r), /set\.prong_thickness: 1\.2 has no unit/);
  });
  it('refuses a foreign unit and shows the conversion', async () => {
    const r = await call('change_piece', { set: { stone_diameter: '0.25 in' } });
    assert.equal(r.isError, true);
    assert.match(texts(r), /set\.stone_diameter: .*0\.25 in × 25\.4 = 6\.35 mm/);
  });
  it('refuses a ring size with no system', async () => {
    const r = await call('start_piece', { template: 'plain_band', ring_size: { size: '7' } });
    assert.equal(r.isError, true);
    assert.match(texts(r), /ring_size\.system: a ring size must name its system/);
  });
  it('refuses a unitless number deep inside a passed tree, naming its path', async () => {
    const started = await call('start_piece', { template: 'solitaire_ring', ring_size: { system: 'EU', size: 54 }, preview: false });
    const tree = treeOf(started);
    tree.root.children[1].params.stone.diameter = 6.5;
    const r = await call('check_piece', { tree });
    assert.equal(r.isError, true);
    assert.match(texts(r), /tree\.root\.children\[1\]\.params\.stone\.diameter: 6\.5 has no unit/);
  });
});
