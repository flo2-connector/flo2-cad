// A PNG encoder with no native dependency: node:zlib for deflate and CRC-32.
// The preview renderer draws into an RGB buffer and this turns it into bytes.

import { crc32, deflateSync } from 'node:zlib';

export interface RgbImage {
  readonly width: number;
  readonly height: number;
  /** width × height × 3 bytes, row by row from the top. */
  readonly rgb: Uint8Array;
}

export function newImage(width: number, height: number, background: readonly [number, number, number] = [255, 255, 255]): RgbImage {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = background[0];
    rgb[i * 3 + 1] = background[1];
    rgb[i * 3 + 2] = background[2];
  }
  return { width, height, rgb };
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** Encodes an 8-bit RGB image as PNG (filter 0 on every row; deflate does the work). */
export function encodePng(img: RgbImage): Buffer {
  const { width, height, rgb } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
