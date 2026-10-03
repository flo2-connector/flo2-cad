import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { stubMesh } from '../src/stub/engine.js';
import { writeZip } from '../src/files/zip.js';
import { lengthMm, ringInnerDiameterMm } from '../src/units.js';

describe('units', () => {
  it('turns each ring-size system into an inner diameter in mm', () => {
    assert.equal(ringInnerDiameterMm({ system: 'US', size: '7' }, 'x').diameterMm, 17.32);
    assert.equal(ringInnerDiameterMm({ system: 'EU', size: 54 }, 'x').diameterMm, 17.189);
    assert.equal(ringInnerDiameterMm({ system: 'UK', size: 'N' }, 'x').diameterMm, 17.205);
  });
  it('takes mm and refuses everything else', () => {
    assert.equal(lengthMm('1.2 mm', 'x'), 1.2);
    assert.throws(() => lengthMm('1.2', 'p.q'), /p\.q: "1\.2" has no unit/);
    assert.throws(() => lengthMm('0.12 cm', 'p'), /0\.12 cm × 10 = 1\.2 mm/);
  });
});

describe('the placeholder band', () => {
  it('is closed and faces outward (positive signed volume, every edge in two faces)', () => {
    const view = { ringSize: { system: 'US', size: '7' }, innerDiameterMm: 17.32, bandWidthMm: 2, bandThicknessMm: 1.6, profile: 'flat', shrinkagePct: 0 } as const;
    const m = stubMesh({ ...view, ringSize: { ...view.ringSize } });
    const p = m.positions, t = m.triangles;
    let vol = 0;
    const edges = new Map<string, number>();
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i]! * 3, t[i + 1]! * 3, t[i + 2]! * 3];
      vol += (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) / 6;
      for (const [u, v] of [[t[i]!, t[i + 1]!], [t[i + 1]!, t[i + 2]!], [t[i + 2]!, t[i]!]] as const) edges.set(`${u}>${v}`, (edges.get(`${u}>${v}`) ?? 0) + 1);
    }
    const exact = Math.PI * ((8.66 + 1.6) ** 2 - 8.66 ** 2) * 2;
    assert.ok(Math.abs(vol - exact) / exact < 0.01, `volume ${vol} vs ${exact}`);
    for (const [k, n] of edges) {
      const [u, v] = k.split('>');
      assert.equal(n, 1, `directed edge ${k} used ${n} times`);
      assert.equal(edges.get(`${v}>${u}`), 1, `edge ${k} has no opposite`);
    }
  });
});

describe('the zip writer', () => {
  it('writes entries a reader can find through the central directory and inflate', () => {
    const z = writeZip([{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'd/b.txt', data: Buffer.from('x'.repeat(1000)) }]);
    const end = z.length - 22;
    assert.equal(z.readUInt32LE(end), 0x06054b50);
    assert.equal(z.readUInt16LE(end + 10), 2);
    let cd = z.readUInt32LE(end + 16);
    const got: Record<string, string> = {};
    for (let i = 0; i < 2; i++) {
      assert.equal(z.readUInt32LE(cd), 0x02014b50);
      const csize = z.readUInt32LE(cd + 20), nlen = z.readUInt16LE(cd + 28), off = z.readUInt32LE(cd + 42);
      const name = z.subarray(cd + 46, cd + 46 + nlen).toString();
      const lnlen = z.readUInt16LE(off + 26);
      got[name] = inflateRawSync(z.subarray(off + 30 + lnlen, off + 30 + lnlen + csize)).toString();
      cd += 46 + nlen;
    }
    assert.deepEqual(got, { 'a.txt': 'hello', 'd/b.txt': 'x'.repeat(1000) });
  });
});
