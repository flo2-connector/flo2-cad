#!/usr/bin/env node
// Bundles the engine and the MCP SDK into ONE file, dist/main.js, so the engine
// runs with nothing installed but Node 24: from a plugin folder, a git checkout
// or the Docker image. The kernel is NOT bundled: it stays as the unmodified
// vendor/manifold-3d-3.5.4/ files, loaded at run time.
//
// dist/main.js is committed (a plugin is installed from the repo, with no build
// step), and CI rebuilds it and fails if the committed file differs.
// dist/THIRD-PARTY-NOTICES.txt carries the licence of every bundled package.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist'), { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src/main.ts')],
  outfile: join(root, 'dist/main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  minify: false,
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
  banner: { js: "import { createRequire as __flo2CreateRequire } from 'node:module'; const require = __flo2CreateRequire(import.meta.url);" },
});

// The licence of every package that went into the bundle.
const pkgs = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (!m) continue;
  const name = m[1];
  if (pkgs.has(name)) continue;
  const dir = join(root, 'node_modules', name);
  const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const lic = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE'].map((f) => join(dir, f)).find((f) => existsSync(f));
  pkgs.set(name, { version: pj.version, license: pj.license, text: lic ? readFileSync(lic, 'utf8').trim() : `(${pj.license}; no licence file in the package)` });
}
const notices = [
  'dist/main.js bundles the following packages. Their licences follow.',
  'The geometry kernel, manifold-3d 3.5.4 (Apache-2.0), is not bundled: see vendor/manifold-3d-3.5.4/LICENSE.',
  '',
  ...[...pkgs.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, p]) => [`=== ${name} ${p.version} (${p.license}) ===`, p.text, '']),
].join('\n');
writeFileSync(join(root, 'dist/THIRD-PARTY-NOTICES.txt'), notices);
console.log(`dist/main.js bundled ${pkgs.size} packages: ${[...pkgs.keys()].sort().join(', ')}`);
