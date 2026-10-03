// The published seam over real stdio, against the SHIPPED bundle (dist/main.js),
// the way flo2's door and a laptop agent reach it: both protocol eras list the
// same six tools; files come back as cadfile:/// resources; isError only for a
// malformed call, naming the field path; a tree carries a piece across sessions.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAIN = `${ROOT}dist/main.js`;
const SIX = ['start_piece', 'change_piece', 'preview_piece', 'check_piece', 'export_for_casting', 'describe_piece'];

type Block = { type: string; text?: string; resource?: { uri: string; mimeType: string; blob: string } };
type Reply = { content: Block[]; isError?: boolean };

async function connect(mode: 'legacy' | 'modern'): Promise<Client> {
  const client =
    mode === 'legacy'
      ? new Client({ name: 'flo2-cad-test', version: '0' })
      : new Client({ name: 'flo2-cad-test', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [MAIN], stderr: 'pipe' }));
  return client;
}

const texts = (r: Reply) => r.content.filter((b) => b.type === 'text').map((b) => b.text!).join('\n');
const files = (r: Reply) => Object.fromEntries(r.content.filter((b) => b.type === 'resource').map((b) => [b.resource!.uri, b.resource!]));
const bytes = (r: Reply, uri: string) => Buffer.from(files(r)[uri]!.blob, 'base64');

describe('both protocol eras', () => {
  for (const mode of ['legacy', 'modern'] as const) {
    it(`${mode === 'legacy' ? 'the 2025 initialize handshake' : 'the 2026-07-28 era'} lists the same six tools, each classed read or write`, async () => {
      const client = await connect(mode);
      try {
        assert.equal(client.getProtocolEra(), mode);
        const { tools } = await client.listTools();
        assert.deepEqual(
          tools.map((t) => t.name),
          SIX,
        );
        assert.deepEqual(
          Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint])),
          { start_piece: false, change_piece: false, preview_piece: true, check_piece: true, export_for_casting: false, describe_piece: true },
        );
        const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
        assert.equal(client.getServerVersion()?.version, pkg.version);
      } finally {
        await client.close();
      }
    });
  }
});

describe('reply shapes over MCP (contract §1, §3, §4)', () => {
  let client: Client;
  before(async () => {
    client = await connect('legacy');
  });
  after(async () => {
    await client.close();
  });
  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Reply;

  it('start_piece returns a preview PNG and the tree as cadfile:/// resources, and the tree as text', async () => {
    const r = await call('start_piece', { template: 'emerald_bezel_solitaire', ring_size: { system: 'US', size: '6.5' }, name: 'emily-ring' });
    assert.equal(r.isError, false);
    assert.deepEqual(Object.keys(files(r)).sort(), ['cadfile:///emily-ring.preview.png', 'cadfile:///emily-ring.tree.json']);
    assert.equal(files(r)['cadfile:///emily-ring.preview.png']!.mimeType, 'image/png');
    assert.deepEqual([...bytes(r, 'cadfile:///emily-ring.preview.png').subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.match(texts(r), /PLACEHOLDER/);
    assert.match(texts(r), /SPECIALIST platinum caster/);
  });

  it('export_for_casting releases STL, 3MF and the check report when every check passes', async () => {
    const r = await call('export_for_casting', {});
    assert.equal(r.isError, false);
    assert.deepEqual(Object.keys(files(r)), ['cadfile:///emily-ring.stl', 'cadfile:///emily-ring.3mf', 'cadfile:///emily-ring.check.json']);
    assert.equal(files(r)['cadfile:///emily-ring.stl']!.mimeType, 'model/stl');
    assert.equal(files(r)['cadfile:///emily-ring.3mf']!.mimeType, 'model/3mf');
    const report = JSON.parse(bytes(r, 'cadfile:///emily-ring.check.json').toString('utf8'));
    assert.equal(report.verdict, 'pass');
    assert.equal(report.kernel.version, '3.5.4');
    assert.equal(report.shrinkage.applied, false);
  });

  it('a too-thin bezel is refused as a NORMAL reply that says what to thicken and where', async () => {
    const changed = await call('change_piece', { set: { bezel_wall: '0.6 mm' }, preview: false });
    assert.equal(changed.isError, false);
    const r = await call('export_for_casting', {});
    assert.equal(r.isError, false);
    assert.deepEqual(Object.keys(files(r)), ['cadfile:///emily-ring.check.json']);
    assert.match(texts(r), /NOT EXPORTED/);
    assert.match(texts(r), /Thicken the bezel rim: it is 0\.\d+ mm at \d+:\d\d seen from above/);
  });

  it('a tree carries the piece into a fresh session', async () => {
    const started = await call('start_piece', { template: 'solitaire_ring', ring_size: { system: 'UK', size: 'N' }, name: 'trip', prong_count: 6, preview: false });
    const tree = JSON.parse(bytes(started, 'cadfile:///trip.tree.json').toString('utf8'));
    const other = await connect('modern');
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

  it('malformed calls are isError and name the field path', async () => {
    const noUnit = await call('change_piece', { set: { prong_thickness: 1.4 } });
    assert.equal(noUnit.isError, true);
    assert.match(texts(noUnit), /set\.prong_thickness: 1\.4 has no unit/);
    const inches = await call('change_piece', { set: { stone_diameter: '0.25 in' } });
    assert.equal(inches.isError, true);
    assert.match(texts(inches), /set\.stone_diameter: .*0\.25 in × 25\.4 = 6\.35 mm/);
    const noSystem = await call('start_piece', { template: 'plain_band', ring_size: { size: '7' } });
    assert.equal(noSystem.isError, true);
    assert.match(texts(noSystem), /ring_size\.system: a ring size must name its system/);
  });
});
