// A RELIEF FROM A PICTURE (cap:a-relief-from-a-picture; step 4 of
// epoch:general-cad-program-and-relief):
//   · the PNG decoder reads 8-bit grayscale and RGB(A) by luminance, through every row
//     filter, and refuses anything else plainly;
//   · a synthetic height image (a dome, a ridge, a letter) becomes ONE closed solid at its
//     stated size and depth, flat or round a band, raised or sunk;
//   · a picture finer than a casting holds is smoothed to the detail limit, and a
//     smoothing finer than that limit is refused;
//   · a relief on a signet-style plate on a ring, and one round a band's top, pass every
//     check and export, the image named in the report by its hash;
//   · the check of a ring with a 512 × 512 relief finishes at one CPU well inside flo2's 60 s.
// Written before the relief existed, and seen to fail on main fff1d99.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { before, describe, it } from 'node:test';
import { runChecks } from '../src/checker/check.js';
import { readBinaryStl } from '../src/checker/stl.js';
import { checkPiece, limitsFor } from '../src/engine.js';
import { readHeightPng } from '../src/files/png-read.js';
import { writeBinaryStl } from '../src/files/stl.js';
import { kernel } from '../src/kernel/manifold.js';
import { Arena, pieceDims, polygonsToMesh } from '../src/library/build.js';
import { buildOp } from '../src/library/ops.js';
import { EXPORT_TOL } from '../src/library/tolerances.js';
import { METALS } from '../src/metals.js';
import { programPiece } from '../src/piece/program.js';
import { RELIEF_EXAMPLE } from '../src/program/guide.js';
import { readPiece, treeFromTemplate, validateTree, type PieceTree, type TreeNode } from '../src/piece/tree.js';
import { Session } from '../src/session.js';

// ------------------------------------------------------------- PNG writing (the test's own)

interface PngOpts {
  width: number;
  height: number;
  colour?: 0 | 2 | 3 | 4 | 6;
  depth?: number;
  interlace?: 0 | 1;
  /** Row filters to cycle through (0 none, 1 sub, 2 up, 3 average, 4 Paeth). */
  filters?: number[];
  /** Raw samples, row by row, `channels` a pixel. */
  samples: Uint8Array;
  extra?: Buffer[];
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function encodePng(o: PngOpts): Buffer {
  const colour = o.colour ?? 0, depth = o.depth ?? 8, ch = CHANNELS[colour]!;
  const stride = Math.ceil((o.width * ch * depth) / 8);
  const filters = o.filters ?? [0];
  const raw = Buffer.alloc(o.height * (1 + stride));
  for (let y = 0; y < o.height; y++) {
    const f = filters[y % filters.length]!;
    raw[y * (1 + stride)] = f;
    for (let x = 0; x < stride; x++) {
      const v = o.samples[y * stride + x]!;
      const a = x >= ch ? o.samples[y * stride + x - ch]! : 0;
      const b = y > 0 ? o.samples[(y - 1) * stride + x]! : 0;
      const c = x >= ch && y > 0 ? o.samples[(y - 1) * stride + x - ch]! : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]!;
      raw[y * (1 + stride) + 1 + x] = (v - pred) & 0xff;
    }
  }
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(o.width, 0);
  ih.writeUInt32BE(o.height, 4);
  ih[8] = depth;
  ih[9] = colour;
  ih[12] = o.interlace ?? 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), ...(o.extra ?? []), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** An 8-bit grayscale PNG of f(x, y) in 0..1, x and y from 0 to 1 across the image (y down from its top). */
function grayPng(n: number, f: (x: number, y: number) => number): Buffer {
  const s = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) s[y * n + x] = Math.round(255 * Math.min(1, Math.max(0, f(x / (n - 1), y / (n - 1)))));
  return encodePng({ width: n, height: n, samples: s, filters: [0, 1, 2, 3, 4] });
}

// --------------------------------------------------------------------- the images

const DIR = mkdtempSync(join(tmpdir(), 'flo2-cad-relief-'));
const IMAGES: Record<string, Buffer> = {
  // A dome: highest in the middle, falling to nothing at 40 % of the way out.
  'dome.png': grayPng(256, (x, y) => Math.max(0, 1 - ((x - 0.5) ** 2 + (y - 0.5) ** 2) / 0.16)),
  // A ridge down the image: a raised cosine half the width wide.
  'ridge.png': grayPng(256, (x) => (Math.abs(x - 0.5) < 0.25 ? Math.cos((Math.PI * (x - 0.5)) / 0.5) ** 2 : 0)),
  // A block letter H.
  'letter.png': grayPng(256, (x, y) => (((x > 0.2 && x < 0.37) || (x > 0.63 && x < 0.8)) && y > 0.15 && y < 0.85) || (x >= 0.37 && x <= 0.63 && y > 0.43 && y < 0.57) ? 1 : 0),
  // Finer than any casting holds: a one-pixel checkerboard, and a one-pixel line.
  'checker.png': grayPng(512, (x, y) => (Math.round(x * 511) + Math.round(y * 511)) % 2),
  'hairline.png': grayPng(512, (x) => (Math.round(x * 511) === 256 ? 1 : 0)),
  // A 512 × 512 picture with detail everywhere: rings and spokes, like a face's folds.
  'rosette.png': grayPng(512, (x, y) => {
    const r = Math.hypot(x - 0.5, y - 0.5), a = Math.atan2(y - 0.5, x - 0.5);
    return r > 0.48 ? 0 : 0.5 + 0.25 * Math.cos(40 * r) + 0.25 * Math.cos(9 * a) * (1 - 2 * r);
  }),
};

// The skill's worked example names lion-face.png; the rosette stands in for a lion here.
IMAGES['lion-face.png'] = IMAGES['rosette.png']!;

before(() => {
  for (const [name, bytes] of Object.entries(IMAGES)) writeFileSync(join(DIR, name), bytes);
  process.env['FLO2_CAD_IMAGE_DIR'] = DIR;
});

// -------------------------------------------------------------------------- helpers

const LIMITS = limitsFor(METALS.sterling_silver_925);

async function buildRelief(params: Record<string, unknown>, tol = EXPORT_TOL) {
  const k = await kernel();
  const A = new Arena();
  try {
    const m = buildOp(k, A, { id: 'relief', op: 'relief', params } as TreeNode, tol);
    const bb = m.boundingBox();
    return { mesh: polygonsToMesh(m), min: [...bb.min], max: [...bb.max], genus: m.genus(), volume: m.volume() };
  } finally {
    A.free();
  }
}

/** The independent checker's own reading of a written mesh: watertight, and its thinnest wall and detail. */
function checked(mesh: ReturnType<typeof polygonsToMesh>) {
  const stl = writeBinaryStl(mesh, 'relief test');
  const r = runChecks(stl, { prongs: [], scale: 1 }, LIMITS);
  const by = (id: string) => r.entries.find((e) => e.id === id)!;
  return { watertight: by('watertight'), wall: by('wall'), detail: by('detail'), gap: by('gap'), shells: r.mesh.shells };
}

/** The face's height above the surface at the top of a flat relief: z of the highest and lowest vertex with z above the back. */
function faceRange(mesh: ReturnType<typeof polygonsToMesh>, base: number): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < mesh.positions.length; i += 3) {
    const z = mesh.positions[i]!;
    if (z > -base + 1e-4) {
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
  }
  return [lo, hi];
}

const signetBand = () => treeFromTemplate('plain_band', { ring_size: { system: 'US', size: '7' }, name: 'signet' });

/** A signet ring: a band, a plate on top cut clear of the finger, and a relief on the plate. */
function signet(relief: Record<string, unknown>, plateTop = 11.5): PieceTree {
  const tree = signetBand();
  const rin = pieceDims(readPiece(tree)).band.innerDiameterMm / 2;
  tree.root.children!.push(
    {
      id: 'signet_head',
      op: 'difference',
      children: [
        { id: 'plate_at', op: 'translate', params: { z: `${plateTop - 2} mm` }, children: [{ id: 'plate', op: 'box', params: { x: '12 mm', y: '10 mm', z: '4 mm' } }] },
        { id: 'finger_turn', op: 'rotate', params: { x: '90 deg' }, children: [{ id: 'finger_at', op: 'translate', params: { z: '-15 mm' }, children: [{ id: 'finger', op: 'cylinder', params: { radius: `${rin} mm`, height: '30 mm' } }] }] },
      ],
    },
    { id: 'lion_at', op: 'translate', params: { z: `${plateTop} mm` }, children: [{ id: 'lion', op: 'relief', params: relief }] },
  );
  return validateTree(tree);
}

const failing = (r: Awaited<ReturnType<typeof checkPiece>>) => r.entries.filter((e) => e.result !== 'pass').map((e) => `${e.id}: ${e.measured}`);

// ----------------------------------------------------------------------------- tests

describe('the PNG decoder reads a height image, and refuses anything else plainly', () => {
  it('reads 8-bit grayscale through all five row filters', () => {
    const s = Uint8Array.from({ length: 7 * 5 }, (_, i) => (i * 37) % 256);
    const img = readHeightPng(encodePng({ width: 7, height: 5, samples: s, filters: [0, 1, 2, 3, 4] }));
    assert.equal(img.width, 7);
    assert.equal(img.height, 5);
    assert.deepEqual([...img.values].map((v) => Math.round(v * 255)), [...s]);
  });
  it('reads RGB by luminance (Rec. 709), and RGBA and gray-with-alpha with alpha multiplying', () => {
    const rgb = readHeightPng(encodePng({ width: 4, height: 2, colour: 2, filters: [4, 1], samples: Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 51, 51, 51, 10, 20, 30, 128, 128, 128]) }));
    const want = [0.2126, 0.7152, 0.0722, 1, 0, 0.2, (0.2126 * 10 + 0.7152 * 20 + 0.0722 * 30) / 255, 128 / 255];
    rgb.values.forEach((v, i) => assert.ok(Math.abs(v - want[i]!) < 1e-6, `pixel ${i}: ${v} against ${want[i]}`));
    const rgba = readHeightPng(encodePng({ width: 2, height: 2, colour: 6, filters: [3], samples: Uint8Array.from([255, 255, 255, 128, 255, 255, 255, 255, 0, 255, 0, 255, 255, 255, 255, 0]) }));
    assert.deepEqual([...rgba.values].map((v) => Math.round(v * 1e4) / 1e4), [Math.round((128 / 255) * 1e4) / 1e4, 1, 0.7152, 0]);
    const ga = readHeightPng(encodePng({ width: 2, height: 2, colour: 4, filters: [2], samples: Uint8Array.from([200, 0, 200, 255, 255, 51, 0, 255]) }));
    assert.deepEqual([...ga.values].map((v) => Math.round(v * 1e4) / 1e4), [0, Math.round((200 / 255) * 1e4) / 1e4, 0.2, 0]);
  });
  const refusals: [string, () => Buffer, RegExp][] = [
    ['a palette PNG', () => encodePng({ width: 2, height: 2, colour: 3, samples: new Uint8Array(4), extra: [chunk('PLTE', Buffer.alloc(3))] }), /palette \(indexed-colour\) PNG\. Save it as an 8-bit grayscale PNG/],
    ['16 bits a channel', () => encodePng({ width: 2, height: 2, depth: 16, samples: new Uint8Array(8) }), /16 bits a channel; this engine reads 8/],
    ['4 bits a channel', () => encodePng({ width: 4, height: 2, depth: 4, samples: new Uint8Array(4) }), /4 bits a channel/],
    ['an interlaced PNG', () => encodePng({ width: 2, height: 2, interlace: 1, samples: new Uint8Array(4) }), /interlaced \(Adam7\)/],
    ['a JPEG', () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]), /not a PNG file/],
    ['a damaged chunk', () => { const b = grayPng(8, () => 0.5); b[b.length - 20]! ^= 0xff; return b; }, /fails its checksum/],
    ['a file cut short', () => grayPng(8, () => 0.5).subarray(0, 40), /cut short/],
    ['too large an image', () => encodePng({ width: 3000, height: 2, samples: new Uint8Array(6000) }), /3000 × 2 pixels; a height image may be at most 2048 pixels a side/],
  ];
  for (const [what, png, why] of refusals) {
    it(`refuses ${what}, saying why`, () => {
      assert.throws(() => readHeightPng(png()), (e: Error) => e.name === 'ImageRefused' && why.test(e.message));
    });
  }
});

describe('a height image becomes one closed solid at its stated size and depth', () => {
  for (const image of ['dome.png', 'ridge.png', 'letter.png']) {
    it(`${image}, flat and raised, 12 × 9 mm, 0.8 mm deep on a 1 mm back`, async () => {
      const r = await buildRelief({ image, width: '12 mm', height: '9 mm', depth: '0.8 mm' });
      assert.equal(r.genus, 0);
      const c = checked(r.mesh);
      assert.equal(c.watertight.result, 'pass', c.watertight.measured!);
      assert.equal(c.shells, 1);
      // The stated size, exactly; the back 1 mm under the surface; the face at most the depth, and within 5 % of it at the
      // picture's highest (the smoothing rounds a crest a little: 0.5 % on the dome, 3 % on the ridge's).
      assert.deepEqual(r.min.map((x) => Math.round(x * 1e4) / 1e4), [-6, -4.5, -1]);
      assert.deepEqual(r.max.slice(0, 2).map((x) => Math.round(x * 1e4) / 1e4), [6, 4.5]);
      assert.ok(r.max[2]! <= 0.8 + 1e-6 && r.max[2]! >= 0.8 * 0.95, `the face reaches ${r.max[2]} mm`);
    });
  }
  it('sunk: the picture carved into its own back, down to the depth, its floor still metal', async () => {
    const r = await buildRelief({ image: 'letter.png', width: '12 mm', height: '9 mm', depth: '0.6 mm', mode: 'sunk' });
    assert.equal(checked(r.mesh).watertight.result, 'pass');
    assert.deepEqual([r.min[2], r.max[2]].map((x) => Math.round(x! * 1e4) / 1e4 + 0), [-1.6, 0], 'the back at depth + 1 mm, the surface at 0');
    const [lo] = faceRange(r.mesh, 1.6);
    assert.ok(lo >= -0.6 - 1e-6 && lo <= -0.6 * 0.97, `carved to ${lo} mm`);
  });
  it('round a band: wrapped on a 10.3 mm radius, its width measured round the band, its height along the finger', async () => {
    const R = 10.3;
    const r = await buildRelief({ image: 'dome.png', width: '14 mm', height: '5 mm', depth: '0.5 mm', surface: 'cylinder', radius: `${R} mm`, base: '0.6 mm' });
    assert.equal(checked(r.mesh).watertight.result, 'pass');
    const th = 14 / (2 * R);
    assert.ok(Math.abs(r.max[0]! - R * Math.sin(th)) < 0.02, `reaches x = ${r.max[0]}`);
    assert.deepEqual([r.min[1], r.max[1]].map((x) => Math.round(x! * 1e4) / 1e4), [-2.5, 2.5]);
    assert.ok(r.max[2]! <= R + 0.5 + 1e-5 && r.max[2]! >= R + 0.5 * 0.97, `the face's top at ${r.max[2]} mm from the finger's axis`);
  });
  it('a relief that cannot be built is refused, naming the setting', () => {
    const tree = signetBand();
    const bad = (params: Record<string, unknown>) => () => validateTree({ ...tree, root: { ...tree.root, children: [...tree.root.children!, { id: 'r', op: 'relief', params }] } });
    const base = { image: 'dome.png', width: '10 mm', height: '8 mm', depth: '0.6 mm' };
    assert.throws(bad({ ...base, image: '../etc/passwd' }), /tree\.root\.children\[\d+\]\.params\.image: the height image's file name/);
    assert.throws(bad({ ...base, mode: 'sunk', base: '0.6 mm' }), /params\.base: a sunk relief is carved into its own back/);
    assert.throws(bad({ ...base, surface: 'cylinder' }), /params\.radius: a relief needs "radius"/);
    assert.throws(bad({ ...base, depth: '0.6' }), /params\.depth: "0\.6" has no unit/);
  });
  it('a missing image is refused by name, and the piece changes nothing', async () => {
    const s = new Session();
    await s.call('start_piece', { template: 'plain_band', ring_size: { system: 'US', size: '7' }, name: 'signet', preview: false });
    const r = await s.call('change_piece', { tree: signet({ image: 'no-such-lion.png', width: '10 mm', height: '8 mm', depth: '0.6 mm', base: '0.5 mm' }), preview: true });
    assert.equal(r.isError, true);
    assert.match(r.content[0]!.type === 'text' ? r.content[0]!.text : '', /lion\.params\.image: no height image called "no-such-lion\.png" was found beside the piece/);
  });
});

describe('a picture finer than a casting holds is smoothed to the detail limit, or refused', () => {
  for (const image of ['checker.png', 'hairline.png']) {
    it(`${image} at 0.02 mm a pixel is smoothed nearly flat, and every wall and detail reads at least the limits`, async () => {
      const r = await buildRelief({ image, width: '10 mm', height: '10 mm', depth: '0.8 mm', base: '1 mm' });
      const [lo, hi] = faceRange(r.mesh, 1);
      assert.ok(hi - lo < 0.06 * 0.8, `the face spans ${lo} to ${hi} mm: a one-pixel feature survives at most a few percent of the depth`);
      const c = checked(r.mesh);
      assert.equal(c.watertight.result, 'pass');
      assert.ok(c.detail.value! >= LIMITS.detail, `detail ${c.detail.measured}`);
      assert.ok(c.wall.value! >= LIMITS.wall, `wall ${c.wall.measured}`);
    });
  }
  it('a smoothing finer than the casting detail limit is refused plainly', () => {
    const tree = signetBand();
    assert.throws(
      () => validateTree({ ...tree, root: { ...tree.root, children: [...tree.root.children!, { id: 'r', op: 'relief', params: { image: 'dome.png', width: '10 mm', height: '8 mm', depth: '0.6 mm', smoothing: '0.2 mm' } }] } }),
      /params\.smoothing: 0\.2 mm is finer than a casting holds: the least is the casting detail limit, 0\.35 mm/,
    );
  });
  it('a deep relief of a busy picture keeps every slope to 45° or less, so no wall reads thin', async () => {
    const r = await buildRelief({ image: 'rosette.png', width: '10 mm', height: '10 mm', depth: '1.5 mm', base: '1 mm' });
    const c = checked(r.mesh);
    assert.equal(c.watertight.result, 'pass');
    assert.ok(c.wall.value! >= LIMITS.wall && c.detail.value! >= LIMITS.detail, `wall ${c.wall.measured}, detail ${c.detail.measured}`);
    assert.equal(c.gap.result, 'pass', c.gap.measured!);
  });
});

describe('a relief on a ring passes every check and exports, measured like any metal', () => {
  it('a raised letter on a signet-style plate: released, with the image named by its hash in the report', async () => {
    const r = await checkPiece(signet({ image: 'letter.png', width: '10 mm', height: '8 mm', depth: '1 mm', base: '0.5 mm' }), 'export');
    assert.deepEqual(failing(r), []);
    assert.equal(r.report['export'], 'released');
    assert.ok(r.stl && r.threeMf);
    const images = r.report['images'] as { node: string; image: string; sha256: string; pixels: number[] }[];
    assert.equal(images.length, 1);
    assert.equal(images[0]!.image, 'letter.png');
    assert.match(images[0]!.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(images[0]!.pixels, [256, 256]);
    // The letter stands on the plate: above the plate's top inside a stroke, not between them.
    const m = readBinaryStl(r.stl);
    let top = -Infinity;
    for (let i = 2; i < m.positions.length; i += 3) top = Math.max(top, m.positions[i]!);
    assert.ok(top > 11.5 + 0.95 && top <= 11.5 + 1 + 1e-4, `the letter's top at ${top} mm`);
  });
  it('a sunk letter as the signet\'s face: the plate is the relief itself, and its floor holds the wall minimum', async () => {
    const tree = signetBand();
    const rin = pieceDims(readPiece(tree)).band.innerDiameterMm / 2;
    tree.root.children!.push(
      {
        id: 'signet_head',
        op: 'difference',
        children: [
          { id: 'plate_at', op: 'translate', params: { z: '9 mm' }, children: [{ id: 'plate', op: 'box', params: { x: '12 mm', y: '10 mm', z: '3 mm' } }] },
          { id: 'finger_turn', op: 'rotate', params: { x: '90 deg' }, children: [{ id: 'finger_at', op: 'translate', params: { z: '-15 mm' }, children: [{ id: 'finger', op: 'cylinder', params: { radius: `${rin} mm`, height: '30 mm' } }] }] },
        ],
      },
      { id: 'seal', op: 'translate', params: { z: '11.5 mm' }, children: [{ id: 'seal_face', op: 'relief', params: { image: 'letter.png', width: '12 mm', height: '10 mm', depth: '0.6 mm', mode: 'sunk', base: '2 mm' } }] },
    );
    const r = await checkPiece(validateTree(tree), 'export');
    assert.deepEqual(failing(r), []);
    assert.equal(r.report['export'], 'released');
  });
  it('a program lays a picture round a band\'s top, and it is checked and exported like any piece', async () => {
    const p = programPiece(
      `const band = ringShank({ ring_size: { system: 'US', size: '7' }, band_width: 6, band_thickness: 1.8 });
       const lion = relief({ id: 'lion', image: 'dome.png', surface: 'cylinder', radius: band.dims.outerDiameterMm / 2, width: 14, height: 5, depth: 0.5, base: 0.6 });
       return union(band, lion);`,
      { name: 'band' },
    );
    const r = await checkPiece(p, 'export');
    assert.deepEqual(failing(r), []);
    assert.equal(r.report['export'], 'released');
    assert.deepEqual((r.report['images'] as { image: string }[]).map((i) => i.image), ['dome.png']);
  });
  it('a program that builds an image\'s name at run time is told to write it in quotes', async () => {
    const p = programPiece(
      `const name = 'do' + 'me.png';
       return relief({ image: name, width: 10, height: 8, depth: 0.5 });`,
      { name: 'x' },
    );
    const r = await checkPiece(p, 'check');
    assert.equal(r.verdict, 'fail');
    assert.match(r.entries[0]!.measured!, /line 2: .*no height image called "dome\.png" was found beside the piece\. Write the name exactly as the file is kept, in quotes/);
  });
  it("the skill's worked example, a lion's face on a signet, is quoted word for word, passes every check and exports", async () => {
    const skill = readFileSync(new URL('../../skills/design-jewelry/SKILL.md', import.meta.url), 'utf8');
    assert.ok(skill.includes(RELIEF_EXAMPLE), 'skills/design-jewelry/SKILL.md quotes RELIEF_EXAMPLE exactly');
    const r = await checkPiece(programPiece(RELIEF_EXAMPLE, { name: 'lion-signet' }), 'export');
    assert.deepEqual(failing(r), []);
    assert.equal(r.report['export'], 'released');
  });
  it('describe_piece lists the relief operation and the relief() call', async () => {
    const s = new Session();
    await s.call('start_piece', { template: 'plain_band', ring_size: { system: 'US', size: '7' }, name: 'b', preview: false });
    const d = await s.call('describe_piece', {});
    const text = d.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
    assert.match(text, /- relief \{image .*smoothing \(mm\)\}: a picture laid onto the piece as a relief/);
    assert.match(text, /- relief\(\{ id, image: "lion\.png", width, height, depth, mode: "raised" \| "sunk"/);
  });
});

describe('the check of a ring with a 512 × 512 relief finishes at one CPU well inside flo2\'s 60 s', () => {
  it("the skill's lion signet, its picture 512 × 512, written as a program, at one CPU", (t) => {
    const ENGINE = new URL('../src/engine.js', import.meta.url).href;
    const PROGRAM = new URL('../src/piece/program.js', import.meta.url).href;
    const script = `
      const { checkPiece } = await import(${JSON.stringify(ENGINE)});
      const { programPiece } = await import(${JSON.stringify(PROGRAM)});
      const p = programPiece(${JSON.stringify(RELIEF_EXAMPLE)}, { name: 'lion-signet' });
      const t0 = performance.now();
      const r = await checkPiece(p, 'check');
      process.stdout.write(JSON.stringify({ ms: performance.now() - t0, verdict: r.verdict, failing: r.entries.filter((e) => e.result !== 'pass').map((e) => e.id + ': ' + e.measured), evaluated: r.report.program.evaluated, triangles: r.report.stl && r.report.stl.triangles }));
    `;
    const node = [process.execPath, '--input-type=module', '-e', script];
    const pinned = existsSync('/usr/bin/taskset') ? ['/usr/bin/taskset', '-c', '0', ...node] : node;
    const run = spawnSync(pinned[0]!, pinned.slice(1), { encoding: 'utf8', timeout: 50_000, killSignal: 'SIGKILL', env: { ...process.env, FLO2_CAD_IMAGE_DIR: DIR }, maxBuffer: 1 << 24 });
    assert.equal(run.signal, null, 'the check did not finish within 50 s at one CPU');
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout) as { ms: number; verdict: string; failing: string[]; evaluated: { ms: number; peak_memory_mib: number }; triangles: number };
    t.diagnostic(`512 × 512 relief on a signet, one CPU: check_piece ${Math.round(out.ms)} ms (the program's evaluation ${out.evaluated.ms} ms at ${out.evaluated.peak_memory_mib} MiB), ${out.triangles} triangles`);
    assert.deepEqual(out.failing, []);
    assert.ok(out.ms < 30_000, `${Math.round(out.ms)} ms: half of flo2's 60 s door is the budget`);
  });
});
