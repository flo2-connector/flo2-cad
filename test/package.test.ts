// The package itself: the vendored kernel is byte-identical to what was recorded
// from the npm tarball (scripts/verify-kernel.mjs proves it against the registry
// in CI); the checker never reaches the kernel; the versions agree; and the
// plugin manifests validate against Agent Plugins 1.0.0 (schemas copied in, as
// the spec forbids fetching them) and keep every path inside the plugin root.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { ENGINE_VERSION, KERNEL_VERSION } from '../src/version.js';

const ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const json = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

describe('the kernel', () => {
  it('is manifold-3d 3.5.4, every vendored file matching its recorded sha256', () => {
    const src = json('vendor/manifold-3d-3.5.4.source.json');
    assert.equal(src.version, KERNEL_VERSION);
    assert.equal(json('vendor/manifold-3d-3.5.4/package.json').version, '3.5.4');
    for (const [file, sha] of Object.entries(src.files as Record<string, string>)) {
      const got = createHash('sha256').update(readFileSync(join(ROOT, 'vendor/manifold-3d-3.5.4', file))).digest('hex');
      assert.equal(got, sha, file);
    }
    assert.deepEqual(readdirSync(join(ROOT, 'vendor/manifold-3d-3.5.4')).sort(), Object.keys(src.files).sort());
  });
  it('is never imported by the checker (con:checker-independent-of-the-kernel)', () => {
    const dir = join(ROOT, 'src/checker');
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const m of text.matchAll(/from\s+'([^']+)'/g)) {
        const spec = m[1]!;
        assert.ok(spec.startsWith('./') || spec.startsWith('node:'), `${f} imports ${spec}: the checker may import only its own files and Node`);
      }
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.doesNotMatch(code, /manifold-3d|kernel\/|library\/|files\/|import\(/, `${f} reaches the kernel, the library or the exporter`);
    }
  });
  it('versions agree across package.json, the engine and the plugin manifests', () => {
    assert.equal(json('package.json').version, ENGINE_VERSION);
    assert.equal(json('plugin.json').version, ENGINE_VERSION);
    assert.equal(json('.claude-plugin/plugin.json').version, ENGINE_VERSION);
  });
});

describe('the plugin package', () => {
  const ajv = new Ajv2020.default({ strict: false, allErrors: true });
  const schema = (n: string) => json(`test/fixtures/agent-plugins-1.0.0/${n}.schema.json`);

  it('plugin.json validates against Agent Plugins 1.0.0', () => {
    const ok = ajv.validate(schema('plugin'), json('plugin.json'));
    assert.ok(ok, JSON.stringify(ajv.errors));
    assert.equal(json('plugin.json').$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  });

  it('mcp.json validates, runs one stdio server, and keeps every path inside the plugin root', () => {
    const mcp = json('mcp.json');
    const valid = ajv.validate(schema('mcp'), json('mcp.json'));
    assert.ok(valid, JSON.stringify(ajv.errors));
    assert.deepEqual(Object.keys(mcp).sort(), ['$schema', 'mcpServers']);
    const servers = Object.values(mcp.mcpServers as Record<string, { type: string; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }>);
    assert.equal(servers.length, 1);
    for (const s of servers) {
      assert.equal(s.type, 'stdio');
      // §7.2.1: one token, a bare executable name or a plugin-relative path.
      assert.ok(/^[A-Za-z0-9._-]+$/.test(s.command) || s.command.startsWith('./'), s.command);
      assert.ok(!/\s/.test(s.command));
      for (const a of s.args ?? []) {
        if (!a.includes('${PLUGIN_ROOT}')) continue;
        const p = resolve(ROOT, a.replace('${PLUGIN_ROOT}', ROOT).replace(ROOT, '.'));
        assert.ok(realpathSync(p).startsWith(ROOT + '/'), `${a} leaves the plugin root`);
        assert.ok(existsSync(p), `${a} does not exist: build and commit dist/`);
      }
      assert.equal(s.env, undefined, 'no environment, so no secrets');
      assert.equal(s.cwd, undefined);
    }
  });

  it("Claude Code's manifest and .mcp.json point at the same bundle", () => {
    const cp = json('.claude-plugin/plugin.json');
    assert.equal(cp.name, 'flo2-cad');
    const cm = json('.mcp.json');
    const s = cm.mcpServers['flo2-cad'];
    assert.equal(s.command, 'node');
    assert.deepEqual(s.args, ['${CLAUDE_PLUGIN_ROOT}/dist/main.js']);
  });

  it('every skill follows Agent Skills: a name matching its folder, and a description', () => {
    for (const dir of readdirSync(join(ROOT, 'skills'))) {
      const text = readFileSync(join(ROOT, 'skills', dir, 'SKILL.md'), 'utf8');
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
      assert.ok(fm, `${dir}/SKILL.md has no frontmatter`);
      const name = /^name:\s*(.+)$/m.exec(fm[1]!)?.[1]?.trim();
      const description = /^description:\s*(.+)$/m.exec(fm[1]!)?.[1]?.trim();
      assert.equal(name, dir);
      assert.match(name!, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(description && description.length > 0 && description.length <= 1024);
    }
  });
});
