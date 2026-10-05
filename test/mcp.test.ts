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

  it('an agent can find and use the thicken operation: the tools say how, describe_piece lists its settings, and a petal previews', async () => {
    const { tools } = await client.listTools();
    assert.match(tools.find((t) => t.name === 'change_piece')!.description!, /cupped or curled petal or leaf \("thicken"\)/);
    assert.match(tools.find((t) => t.name === 'check_piece')!.description!, /each thickened sheet .* at least 0\.8 mm, measured square to its surface/);
    const started = await call('start_piece', { template: 'plain_band', ring_size: { system: 'US', size: '7' }, name: 'petal-ring', preview: false });
    const d = await call('describe_piece', {});
    assert.match(texts(d), /- thicken \{outline \(\[x, y\] points in mm\), thickness \(mm\), surface \(a word\), radius \(mm\), axis \(a word\), round_corners \(mm\)\}: a thin sheet/);
    const tree = JSON.parse(bytes(started, 'cadfile:///petal-ring.tree.json').toString('utf8'));
    tree.root.children.push({
      id: 'lift',
      op: 'translate',
      params: { z: '10.2 mm' },
      children: [{ id: 'petal_1', op: 'thicken', params: { outline: [['-1.5 mm', '-2 mm'], ['1.5 mm', '-2 mm'], ['2 mm', '2 mm'], ['0 mm', '4 mm'], ['-2 mm', '2 mm']], thickness: '1.0 mm', surface: 'sphere', radius: '8 mm', round_corners: '0.5 mm' } }],
    });
    const changed = await call('change_piece', { tree });
    assert.equal(changed.isError, false, texts(changed));
    assert.deepEqual(Object.keys(files(changed)).sort(), ['cadfile:///petal-ring.preview.png', 'cadfile:///petal-ring.tree.json']);
    assert.match(texts(changed), /Plus 1 added shape\(s\): "lift"/);
    const tight = await call('change_piece', { set: { 'petal_1.radius': '3 mm' }, preview: false });
    assert.equal(tight.isError, true);
    assert.match(texts(tight), /tree\.root\.children\[1\]\.children\[0\]\.params\.radius: 3 mm curves a 1 mm sheet too tightly/);
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

describe('a piece written as a program, over MCP (cap:the-agent-writes-a-piece-as-a-program)', () => {
  let client: Client;
  before(async () => {
    client = await connect('legacy');
  });
  after(async () => {
    await client.close();
  });
  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Reply;
  const fixture = JSON.parse(readFileSync(`${ROOT}test/fixtures/cabochon-in-bezel.tree.json`, 'utf8')) as { program: string };

  it('start_piece and change_piece take a "program"; the tool list is still the same six names', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), SIX);
    for (const name of ['start_piece', 'change_piece']) {
      const t = tools.find((x) => x.name === name)!;
      assert.equal((t.inputSchema.properties as Record<string, { type: string }>)['program']!.type, 'string', `${name} takes a program`);
    }
  });

  it('a cabochon in a bezel, from its program: kept as the piece file, checked and exported like any piece', async () => {
    const started = await call('start_piece', { program: fixture.program, name: 'moon' });
    assert.equal(started.isError, false, texts(started));
    assert.deepEqual(Object.keys(files(started)).sort(), ['cadfile:///moon.preview.png', 'cadfile:///moon.tree.json']);
    const piece = JSON.parse(bytes(started, 'cadfile:///moon.tree.json').toString('utf8'));
    assert.deepEqual(piece, { format: 'flo2-cad.program/1', name: 'moon', revision: 1, metal: 'sterling_silver_925', shrinkage: 'off', units: 'mm', program: fixture.program });
    assert.match(texts(started), /a full bezel .* holding one 8\.00 × 8\.00 mm cabochon \("moonstone"\)/);
    const exported = await call('export_for_casting', {});
    assert.equal(exported.isError, false);
    assert.deepEqual(Object.keys(files(exported)), ['cadfile:///moon.stl', 'cadfile:///moon.3mf', 'cadfile:///moon.check.json']);
    const report = JSON.parse(bytes(exported, 'cadfile:///moon.check.json').toString('utf8'));
    assert.equal(report.verdict, 'pass');
    assert.equal(report.stone.in_casting_file, false);
  });

  it('the piece file carries a program piece into a fresh session, and describe_piece gives its parts and what a program can call', async () => {
    const other = await connect('modern');
    try {
      const tree = { format: 'flo2-cad.program/1', name: 'moon', revision: 3, metal: 'gold_14k_yellow', shrinkage: 'on', units: 'mm', program: fixture.program };
      const d = (await other.callTool({ name: 'describe_piece', arguments: { tree } })) as Reply;
      assert.equal(d.isError, false, texts(d));
      assert.match(texts(d), /- Bezel \(bezel\): wall 1\.00 mm thick/);
      assert.match(texts(d), /ringShank\(\{ ring_size/);
      assert.match(texts(d), /Limits: \d+ s and \d+ MiB for each evaluation/);
    } finally {
      await other.close();
    }
  });

  it('a program that fails is a malformed call naming "program" and its line, and changes nothing', async () => {
    const r = await call('change_piece', { program: "const band = ringShank({ ring_size: { system: 'US', size: '7' } });\nreturn band.rotate([0, 0, 30]);", preview: false });
    assert.equal(r.isError, true);
    assert.match(texts(r), /^Malformed call\. program: line 2: rotate\(\[0, 0, 30\]\): would move the ring band off the finger's axis/);
    const still = await call('describe_piece', {});
    assert.match(texts(still), /"revision":1/);
  });
});
