#!/usr/bin/env node
// Proves the vendored kernel is manifold-3d 3.5.4, byte for byte as published.
//   1. Asks the npm registry for manifold-3d@3.5.4's dist.integrity and holds it
//      equal to vendor/manifold-3d-3.5.4.source.json.
//   2. Downloads the tarball and holds its sha512 equal to that integrity.
//   3. Un-gzips and reads the tar, and holds every vendored file byte-identical
//      to package/<file> in it, and its sha256 equal to the source file's.
// Needs the network, so it runs in CI and by hand, never at run time.
// Exit 0 and one "OK" line per file, or exit 1 naming what differs.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(readFileSync(join(root, 'vendor/manifold-3d-3.5.4.source.json'), 'utf8'));
const dir = join(root, 'vendor/manifold-3d-3.5.4');
let failed = false;
const fail = (m) => {
  console.error(`FAIL ${m}`);
  failed = true;
};

const meta = await (await fetch(`https://registry.npmjs.org/${source.package}/${source.version}`)).json();
if (meta.dist.integrity !== source.integrity) fail(`registry integrity ${meta.dist.integrity} != recorded ${source.integrity}`);
else console.log(`OK registry integrity for ${source.package}@${source.version} matches the recorded one`);
if (meta.dist.tarball !== source.tarball) fail(`registry tarball ${meta.dist.tarball} != recorded ${source.tarball}`);

const tgz = Buffer.from(await (await fetch(source.tarball)).arrayBuffer());
const got = `sha512-${createHash('sha512').update(tgz).digest('base64')}`;
if (got !== source.integrity) fail(`tarball sha512 ${got} != ${source.integrity}`);
else console.log('OK tarball sha512 matches the integrity');

const tar = gunzipSync(tgz);
const entries = new Map();
for (let off = 0; off + 512 <= tar.length; ) {
  const header = tar.subarray(off, off + 512);
  if (header.every((b) => b === 0)) break;
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
  const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8);
  const type = String.fromCharCode(header[156] || 48);
  const full = prefix ? `${prefix}/${name}` : name;
  if (type === '0' || type === '\0') entries.set(full, tar.subarray(off + 512, off + 512 + size));
  off += 512 + Math.ceil(size / 512) * 512;
}

for (const [file, sha] of Object.entries(source.files)) {
  const mine = readFileSync(join(dir, file));
  const theirs = entries.get(`package/${file}`);
  if (!theirs) fail(`${file} is not in the tarball`);
  else if (!mine.equals(theirs)) fail(`${file} differs from package/${file} in the tarball`);
  else if (createHash('sha256').update(mine).digest('hex') !== sha) fail(`${file} sha256 differs from the recorded one`);
  else console.log(`OK ${file} is byte-identical to the tarball (sha256 ${sha})`);
}
process.exit(failed ? 1 : 0);
