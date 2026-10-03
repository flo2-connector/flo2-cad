import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inflateSync, inflateRawSync } from 'node:zlib';
import { encodePng, newImage } from '../src/files/png.js';
import { writeZip } from '../src/files/zip.js';

describe('the writers, with no native dependency', () => {
  it('the zip writer stores entries a reader finds through the central directory', () => {
    const z = writeZip([{ name: 'a.txt', data: Buffer.from('hello') }, { name: 'd/b.txt', data: Buffer.from('x'.repeat(1000)) }]);
    const end = z.length - 22;
    assert.equal(z.readUInt32LE(end), 0x06054b50);
    let cd = z.readUInt32LE(end + 16);
    const got: Record<string, string> = {};
    for (let i = 0; i < z.readUInt16LE(end + 10); i++) {
      const csize = z.readUInt32LE(cd + 20), nlen = z.readUInt16LE(cd + 28), off = z.readUInt32LE(cd + 42);
      const name = z.subarray(cd + 46, cd + 46 + nlen).toString();
      const lnlen = z.readUInt16LE(off + 26);
      got[name] = inflateRawSync(z.subarray(off + 30 + lnlen, off + 30 + lnlen + csize)).toString();
      cd += 46 + nlen;
    }
    assert.deepEqual(got, { 'a.txt': 'hello', 'd/b.txt': 'x'.repeat(1000) });
  });
  it('the PNG encoder writes a decodable RGB image', () => {
    const img = newImage(3, 2, [10, 20, 30]);
    const png = encodePng(img);
    assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
    const idatLen = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    assert.equal(raw.length, 2 * (1 + 3 * 3));
    assert.deepEqual([...raw.subarray(1, 4)], [10, 20, 30]);
  });
});
