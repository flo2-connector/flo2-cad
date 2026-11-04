// JEWELRY IS A LAYER ON THE GENERAL ENGINE, BEHIND ONE BOUNDARY
// (req:flo2-cad-designs-any-cast-piece; dec:idea-limit-profiles-by-material-process-and-size).
//
// The stone, setting and seat rules (the setting rules' cited figures, the seat clearances, the
// stones' placeholder sizes) and the checks of a stone's setting (prong thickness, prong grip,
// bezel wall, bezel lip, a faceted stone's and a cabochon's) live in src/jewelry/. The general
// engine reaches them only through src/jewelry/index.ts; the general checker and the limit
// profiles import nothing of them; and the layer is applied only to a piece that declares a stone
// or a setting. Behaviour is unchanged: test/limit-profiles.test.ts replays main 362c473's replies.
// Observed failing on main 362c473 before the change: src/jewelry/ did not exist.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const SRC = join(ROOT, 'src');
const JEWELRY = join(SRC, 'jewelry');
const BOUNDARY = join(JEWELRY, 'index.ts');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Every module a source file imports, as an absolute .ts path (a relative specifier) or as written (a package or node:). */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:import|export)\s[^'";]*?from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g)].map((m) => {
    const spec = (m[1] ?? m[2])!;
    return spec.startsWith('.') ? resolve(dirname(file), spec).replace(/\.js$/, '.ts') : spec;
  });
}

const rel = (p: string) => relative(ROOT, p);

describe('the jewelry layer sits behind one boundary', () => {
  it('src/jewelry/index.ts is the boundary, and nothing outside src/jewelry/ imports any other file of it', () => {
    assert.ok(existsSync(BOUNDARY), 'src/jewelry/index.ts, the jewelry layer\'s boundary, does not exist');
    const users: string[] = [];
    for (const f of tsFiles(SRC)) {
      if (f.startsWith(JEWELRY + '/')) continue;
      for (const m of importsOf(f)) {
        if (!m.startsWith(JEWELRY + '/')) continue;
        assert.equal(m, BOUNDARY, `${rel(f)} imports ${rel(m)}: outside src/jewelry/, only src/jewelry/index.ts is imported`);
        users.push(rel(f));
      }
    }
    // The general engine, the ring's tree and the library reach it, each through the boundary.
    for (const f of ['src/engine.ts', 'src/piece/tree.ts', 'src/library/build.ts']) assert.ok(users.includes(f), `${f} does not reach the jewelry layer through its boundary`);
  });

  it('the general checker and the limit profiles import nothing of it', () => {
    for (const dir of ['checker', 'limits']) {
      assert.ok(existsSync(join(SRC, dir)), `src/${dir}/ does not exist`);
      for (const f of tsFiles(join(SRC, dir))) for (const m of importsOf(f)) assert.ok(!m.startsWith(JEWELRY), `${rel(f)} imports ${rel(m)}`);
    }
  });

  it("its checks are the checker's own kind: they reach neither the kernel, the library nor the exporter", () => {
    const checks = join(JEWELRY, 'checks.ts');
    assert.ok(existsSync(checks), 'src/jewelry/checks.ts does not exist');
    for (const m of importsOf(checks)) {
      assert.ok(m.startsWith('node:') || m.startsWith(JEWELRY + '/') || m.startsWith(join(SRC, 'checker') + '/'), `src/jewelry/checks.ts imports ${m.startsWith('/') ? rel(m) : m}`);
    }
  });

  it('the stone, setting and seat rules are the layer\'s, no longer the metals\' or the library\'s', async () => {
    const J = await import(new URL('../src/jewelry/index.js', import.meta.url).href).catch((e: Error) => assert.fail(`the boundary does not load: ${e.message}`));
    assert.equal(J.SETTING.gripMin, 0.15);
    assert.deepEqual([J.SETTING.lipMinOfCrown, J.SETTING.lipMaxOfCrown, J.SETTING.lipMinOfCabochon], [0.5, 0.75, 1 / 3]);
    assert.equal(J.SEAT_CLEARANCE, 0.03);
    assert.equal(J.BEZEL_CLEARANCE, 0.05);
    assert.equal(J.STONE_DEFAULTS.round.diameter, '6.5 mm');
    const metals = await import(new URL('../src/metals.js', import.meta.url).href);
    assert.equal('SETTING' in metals, false, 'src/metals.ts still holds the setting rules');
    const build = await import(new URL('../src/library/build.js', import.meta.url).href);
    assert.equal('SEAT_CLEARANCE' in build, false, 'src/library/build.ts still holds the seat clearance');
  });

  it('the layer applies only to a piece that declares a stone or a setting, and a plain band reads the same without it', async () => {
    const J = await import(new URL('../src/jewelry/index.js', import.meta.url).href).catch((e: Error) => assert.fail(`the boundary does not load: ${e.message}`));
    const C = await import(new URL('../src/checker/check.js', import.meta.url).href);
    const B = await import(new URL('../src/library/build.js', import.meta.url).href);
    const { treeFromTemplate } = await import(new URL('../src/piece/tree.js', import.meta.url).href);
    const { writeBinaryStl } = await import(new URL('../src/files/stl.js', import.meta.url).href);
    const { limitsFor } = await import(new URL('../src/engine.js', import.meta.url).href);
    const { METALS } = await import(new URL('../src/metals.js', import.meta.url).href);
    const layer = J.JEWELRY_CHECKS;
    assert.equal(layer.applies({ prongs: [], scale: 1 }), false);
    const L = limitsFor(METALS.sterling_silver_925);
    const run = async (template: string, layers: unknown[]) => {
      const built = await B.buildPiece(treeFromTemplate(template, { ring_size: { system: 'US', size: '7' }, name: 'b' }), { tol: B.EXPORT_TOL, applyShrinkage: false });
      const stl = writeBinaryStl(built.metal, 'x');
      return { decl: built.decl, entries: C.runChecks(stl, built.decl, L, stl, layers).entries.map((e: { id: string; result: string; value?: number; where: unknown }) => [e.id, e.result, e.value, e.where]) };
    };
    const band = [await run('plain_band', []), await run('plain_band', [layer])];
    assert.equal(layer.applies(band[0]!.decl), false);
    assert.deepEqual(band[1]!.entries, band[0]!.entries);
    const sol = [await run('solitaire_ring', []), await run('solitaire_ring', [layer])];
    assert.equal(layer.applies(sol[0]!.decl), true);
    const ids = (x: { entries: unknown[][] }) => x.entries.map((e) => e[0]);
    assert.deepEqual(ids(sol[1]!), ['watertight', 'wall', 'detail', 'band', 'prong', 'prong_grip', 'gap', 'surface_deviation']);
    assert.ok(!ids(sol[0]!).includes('prong') && !ids(sol[0]!).includes('prong_grip'), 'the setting checks come only with the layer');
  });
});
