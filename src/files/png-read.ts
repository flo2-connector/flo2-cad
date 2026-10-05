// READING A HEIGHT IMAGE (cap:a-relief-from-a-picture): a PNG decoded in plain JavaScript
// over Node's own zlib, so a relief adds no native dependency (in the spirit of
// con:no-native-dependency-for-export, which the writers beside this file keep).
//
// What it takes, and why only that. A height image is one number per pixel, so it reads:
//  · 8-bit grayscale, and grayscale with alpha;
//  · 8-bit RGB and RGBA, by luminance (Rec. 709 luma of the stored values: a height image's
//    numbers are heights, not light, so no gamma is undone).
// Alpha multiplies: a transparent pixel is height 0, so a cut-out picture lies flat where
// it is clear. White is the top of the range, black the bottom.
//
// Everything else is refused plainly, naming what to save instead: a palette (indexed)
// PNG, 16 bits a channel, 1, 2 or 4 bits, an interlaced PNG, and anything that is not a
// whole, well-formed PNG (a wrong signature, a chunk whose CRC does not match, image data
// that inflates to more or less than its size says). The inflate is bounded by the size
// the header states, so a small file cannot unpack into a large one.

import { crc32, inflateSync } from 'node:zlib';

/** One height per pixel, 0 (lowest) to 1 (highest), row 0 the image's top. */
export interface HeightImage {
  width: number;
  height: number;
  values: Float32Array;
}

/** The largest image side accepted, in pixels: PROVISIONAL until the owner says (dec:idea-a-photo-becomes-a-height-image). */
export const MAX_IMAGE_SIDE = 2048;
/** The largest PNG file read, in bytes. */
export const MAX_IMAGE_BYTES = 16 * 2 ** 20;

/** A PNG that is not a height image this engine reads: the message says what it is and what to save instead. */
export class ImageRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageRefused';
  }
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const SAVE_AS = 'Save it as an 8-bit grayscale PNG (or 8-bit RGB or RGBA), not interlaced.';
const COLOUR: Readonly<Record<number, { name: string; channels: number }>> = {
  0: { name: 'grayscale', channels: 1 },
  2: { name: 'RGB', channels: 3 },
  4: { name: 'grayscale with alpha', channels: 2 },
  6: { name: 'RGBA', channels: 4 },
};

/** Decodes a PNG into one height per pixel. Throws ImageRefused, in plain words, for anything it does not read. */
export function readHeightPng(bytes: Uint8Array): HeightImage {
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageRefused(`the file is ${(bytes.length / 2 ** 20).toFixed(1)} MB; a height image may be at most ${MAX_IMAGE_BYTES / 2 ** 20} MB.`);
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) throw new ImageRefused(`it is not a PNG file (its first bytes are not a PNG's signature). ${SAVE_AS}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  let header: { width: number; height: number; depth: number; colour: number; interlace: number } | null = null;
  const idat: Uint8Array[] = [];
  let ended = false;
  while (off < bytes.length) {
    if (off + 12 > bytes.length) throw new ImageRefused('the file is cut short (a chunk runs past its end).');
    const len = view.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new ImageRefused('the file is damaged (a chunk has no readable name).');
    if (off + 12 + len > bytes.length) throw new ImageRefused(`the file is cut short (its ${type} chunk runs past its end).`);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (crc32(bytes.subarray(off + 4, off + 8 + len)) !== view.getUint32(off + 8 + len)) throw new ImageRefused(`the file is damaged (its ${type} chunk fails its checksum).`);
    off += 12 + len;
    if (type === 'IHDR') {
      if (header || len !== 13) throw new ImageRefused('the file is damaged (its header chunk is not one 13-byte IHDR).');
      const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
      header = { width: d.getUint32(0), height: d.getUint32(4), depth: data[8]!, colour: data[9]!, interlace: data[12]! };
      if (data[10] !== 0 || data[11] !== 0) throw new ImageRefused('the file uses a compression or filter method PNG does not define.');
    } else if (!header) {
      throw new ImageRefused('the file is damaged (its first chunk is not its header).');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      ended = true;
      break;
    } else if (type !== 'PLTE' && (type.charCodeAt(0) & 0x20) === 0) {
      throw new ImageRefused(`the file holds a ${type} chunk, which this engine does not read. ${SAVE_AS}`);
    }
  }
  if (!header) throw new ImageRefused('the file has no header chunk.');
  if (!ended) throw new ImageRefused('the file is cut short (it has no end chunk).');
  const { width, height, depth, colour, interlace } = header;
  if (colour === 3) throw new ImageRefused(`it is a palette (indexed-colour) PNG. ${SAVE_AS}`);
  const kind = COLOUR[colour];
  if (!kind) throw new ImageRefused(`its colour type (${colour}) is not one PNG defines.`);
  if (depth !== 8) throw new ImageRefused(`it has ${depth} bits a channel; this engine reads 8. ${SAVE_AS}`);
  if (interlace !== 0) throw new ImageRefused(`it is interlaced (Adam7). ${SAVE_AS}`);
  if (width < 2 || height < 2) throw new ImageRefused(`it is ${width} × ${height} pixels; a height image needs at least 2 × 2.`);
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) throw new ImageRefused(`it is ${width} × ${height} pixels; a height image may be at most ${MAX_IMAGE_SIDE} pixels a side. Scale it down.`);
  if (!idat.length) throw new ImageRefused('the file holds no image data.');

  const ch = kind.channels;
  const stride = width * ch;
  const expected = height * (1 + stride);
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
  } catch (e) {
    throw new ImageRefused(`its image data does not unpack${/maxOutputLength|larger than/i.test(String(e)) ? ' to the size its header states' : ''} (the file is damaged).`);
  }
  if (raw.length !== expected) throw new ImageRefused(`its image data unpacks to ${raw.length} bytes, not the ${expected} its header states (the file is damaged).`);

  // Undo each row's filter in place (PNG's five: none, sub, up, average, Paeth).
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (1 + stride)]!;
    const src = y * (1 + stride) + 1;
    const row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch]! : 0;
      const b = y > 0 ? px[prev + x]! : 0;
      const c = x >= ch && y > 0 ? px[prev + x - ch]! : 0;
      let pred: number;
      switch (f) {
        case 0: pred = 0; break;
        case 1: pred = a; break;
        case 2: pred = b; break;
        case 3: pred = (a + b) >> 1; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          throw new ImageRefused(`row ${y + 1} uses filter ${f}, which PNG does not define (the file is damaged).`);
      }
      px[row + x] = (raw[src + x]! + pred) & 0xff;
    }
  }

  const values = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * ch;
    const lum = ch <= 2 ? px[p]! : 0.2126 * px[p]! + 0.7152 * px[p + 1]! + 0.0722 * px[p + 2]!;
    const alpha = ch === 2 ? px[p + 1]! / 255 : ch === 4 ? px[p + 3]! / 255 : 1;
    values[i] = (lum / 255) * alpha;
  }
  return { width, height, values };
}
