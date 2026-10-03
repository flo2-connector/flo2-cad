// The preview renderer (cmp:preview-renderer): a small software rasterizer to a
// PNG, with no native or GPU dependency. Up to four orthographic views, each a
// 512 × 512 panel drawn at 2× and averaged down, so a prong can be judged on a
// phone. The stone is drawn here and nowhere else: it is never in a casting file.

import { encodePng } from '../files/png.js';
import { drawText, wrap } from './font.js';

export type ViewName = 'three_quarter' | 'front' | 'side' | 'top' | 'setting_closeup';
type Rgb = readonly [number, number, number];

export interface RenderItem {
  positions: Float32Array;
  triangles: Uint32Array;
  kind: 'metal' | 'stone';
  color: Rgb;
}

export interface RenderOptions {
  /** Lines across the top of the picture: what it is and anything the person must know. */
  header: string[];
  /** Notes printed in red (placeholders, warnings). */
  warnings: string[];
  /** For the close-up: only geometry above this height is framed. */
  focusAboveZ?: number;
}

const PANEL = 512;
const SS = 2;
const VIEWS: Readonly<Record<ViewName, { eye: [number, number, number]; up: [number, number, number]; label: string }>> = {
  three_quarter: { eye: [0.62, 0.55, 0.56], up: [0, 0, 1], label: 'three-quarter' },
  front: { eye: [0, 1, 0], up: [0, 0, 1], label: 'front (along the finger)' },
  side: { eye: [1, 0, 0], up: [0, 0, 1], label: 'side' },
  top: { eye: [0, 0, 1], up: [0, 1, 0], label: 'top (finger points up)' },
  setting_closeup: { eye: [0.62, 0.55, 0.56], up: [0, 0, 1], label: 'setting, close up' },
};

function norm(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

interface Camera {
  eye: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
}

function camera(name: ViewName): Camera {
  const v = VIEWS[name];
  const eye = norm(v.eye);
  const right = norm(cross([-eye[0], -eye[1], -eye[2]], v.up));
  const up = norm(cross(right, [-eye[0], -eye[1], -eye[2]]));
  return { eye, right, up };
}

/** A nice scale-bar length near a quarter of the panel. */
function niceBar(mmPerPanel: number): number {
  const target = mmPerPanel / 4;
  for (const c of [0.5, 1, 2, 5, 10, 20]) if (c >= target * 0.6) return c;
  return 20;
}

function renderPanel(items: RenderItem[], view: ViewName, focusAboveZ: number | undefined): { rgb: Uint8Array; mmPerPx: number } {
  const W = PANEL * SS;
  const cam = camera(view);
  // Frame the geometry (only the head, for the close-up).
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const it of items) {
    const p = it.positions;
    for (let i = 0; i < p.length; i += 3) {
      if (view === 'setting_closeup' && focusAboveZ !== undefined && p[i + 2]! < focusAboveZ) continue;
      const sx = p[i]! * cam.right[0] + p[i + 1]! * cam.right[1] + p[i + 2]! * cam.right[2];
      const sy = p[i]! * cam.up[0] + p[i + 1]! * cam.up[1] + p[i + 2]! * cam.up[2];
      x0 = Math.min(x0, sx);
      x1 = Math.max(x1, sx);
      y0 = Math.min(y0, sy);
      y1 = Math.max(y1, sy);
    }
  }
  if (!Number.isFinite(x0)) ((x0 = -1), (x1 = 1), (y0 = -1), (y1 = 1));
  const span = Math.max(x1 - x0, y1 - y0) * 1.12;
  const scale = W / span; // px per mm
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rgb = new Uint8Array(W * W * 3);
  for (let y = 0; y < W; y++) {
    const g = 248 - Math.round((14 * y) / W);
    for (let x = 0; x < W; x++) rgb.set([g, g, g - 3], (y * W + x) * 3);
  }
  const depth = new Float32Array(W * W).fill(-Infinity);
  const L1 = norm([-0.45 * cam.right[0] + 0.7 * cam.up[0] + 0.6 * cam.eye[0], -0.45 * cam.right[1] + 0.7 * cam.up[1] + 0.6 * cam.eye[1], -0.45 * cam.right[2] + 0.7 * cam.up[2] + 0.6 * cam.eye[2]]);
  const L2 = norm([0.7 * cam.right[0] - 0.2 * cam.up[0] + 0.5 * cam.eye[0], 0.7 * cam.right[1] - 0.2 * cam.up[1] + 0.5 * cam.eye[1], 0.7 * cam.right[2] - 0.2 * cam.up[2] + 0.5 * cam.eye[2]]);
  const H = norm([L1[0] + cam.eye[0], L1[1] + cam.eye[1], L1[2] + cam.eye[2]]);
  for (const it of items) {
    const p = it.positions, tri = it.triangles;
    const sx = new Float32Array(p.length / 3), sy = new Float32Array(p.length / 3), sz = new Float32Array(p.length / 3);
    for (let i = 0, v = 0; i < p.length; i += 3, v++) {
      const X = p[i]!, Y = p[i + 1]!, Z = p[i + 2]!;
      sx[v] = (X * cam.right[0] + Y * cam.right[1] + Z * cam.right[2] - cx) * scale + W / 2;
      sy[v] = W / 2 - (X * cam.up[0] + Y * cam.up[1] + Z * cam.up[2] - cy) * scale;
      sz[v] = X * cam.eye[0] + Y * cam.eye[1] + Z * cam.eye[2];
    }
    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t]!, b = tri[t + 1]!, c = tri[t + 2]!;
      const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
      const n = norm(cross([p[b * 3]! - ax, p[b * 3 + 1]! - ay, p[b * 3 + 2]! - az], [p[c * 3]! - ax, p[c * 3 + 1]! - ay, p[c * 3 + 2]! - az]));
      const facing = n[0] * cam.eye[0] + n[1] * cam.eye[1] + n[2] * cam.eye[2];
      if (facing <= 0) continue;
      const d1 = Math.max(0, n[0] * L1[0] + n[1] * L1[1] + n[2] * L1[2]);
      const d2 = Math.max(0, n[0] * L2[0] + n[1] * L2[1] + n[2] * L2[2]);
      const sp = Math.pow(Math.max(0, n[0] * H[0] + n[1] * H[1] + n[2] * H[2]), it.kind === 'metal' ? 36 : 60);
      const k = it.kind === 'metal' ? [0.4 + 0.55 * d1 + 0.22 * d2, 0.6 * sp] : [0.55 + 0.35 * d1 + 0.1 * d2, 0.5 * sp];
      const col = [0, 1, 2].map((ch) => Math.min(255, Math.round(it.color[ch]! * k[0]! + 255 * k[1]!))) as [number, number, number];
      // Rasterize with edge functions over the triangle's box.
      const X0 = sx[a]!, Y0 = sy[a]!, X1 = sx[b]!, Y1 = sy[b]!, X2 = sx[c]!, Y2 = sy[c]!;
      const area = (X1 - X0) * (Y2 - Y0) - (X2 - X0) * (Y1 - Y0);
      if (Math.abs(area) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(X0, X1, X2))), maxX = Math.min(W - 1, Math.ceil(Math.max(X0, X1, X2)));
      const minY = Math.max(0, Math.floor(Math.min(Y0, Y1, Y2))), maxY = Math.min(W - 1, Math.ceil(Math.max(Y0, Y1, Y2)));
      const Z0 = sz[a]!, Z1 = sz[b]!, Z2 = sz[c]!;
      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5;
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5;
          const w0 = ((X1 - px) * (Y2 - py) - (X2 - px) * (Y1 - py)) / area;
          const w1 = ((X2 - px) * (Y0 - py) - (X0 - px) * (Y2 - py)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * Z0 + w1 * Z1 + w2 * Z2;
          const idx = y * W + x;
          if (z <= depth[idx]!) continue;
          depth[idx] = z;
          rgb[idx * 3] = col[0];
          rgb[idx * 3 + 1] = col[1];
          rgb[idx * 3 + 2] = col[2];
        }
      }
    }
  }
  // Average 2 × 2 down to the panel size.
  const out = new Uint8Array(PANEL * PANEL * 3);
  for (let y = 0; y < PANEL; y++)
    for (let x = 0; x < PANEL; x++)
      for (let ch = 0; ch < 3; ch++) {
        let s = 0;
        for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += rgb[((y * SS + dy) * W + x * SS + dx) * 3 + ch]!;
        out[(y * PANEL + x) * 3 + ch] = Math.round(s / (SS * SS));
      }
  return { rgb: out, mmPerPx: span / PANEL };
}

const INK: Rgb = [40, 40, 46];
const RED: Rgb = [190, 30, 30];

export function renderPreview(items: RenderItem[], views: ViewName[], opts: RenderOptions): Buffer {
  const cols = views.length === 1 ? 1 : 2;
  const rows = Math.ceil(views.length / cols);
  const width = cols * PANEL;
  const maxChars = Math.floor((width - 24) / 12);
  const headLines = opts.header.flatMap((h) => wrap(h, maxChars));
  const warnLines = opts.warnings.flatMap((h) => wrap(h, maxChars));
  const headH = 14 + (headLines.length + warnLines.length) * 20;
  const height = headH + rows * PANEL;
  const img = new Uint8Array(width * height * 3).fill(255);
  let y = 10;
  for (const l of headLines) {
    drawText(img, width, height, 12, y, l, 2, INK);
    y += 20;
  }
  for (const l of warnLines) {
    drawText(img, width, height, 12, y, l, 2, RED);
    y += 20;
  }
  views.forEach((view, i) => {
    const { rgb, mmPerPx } = renderPanel(items, view, opts.focusAboveZ);
    const ox = (i % cols) * PANEL, oy = headH + Math.floor(i / cols) * PANEL;
    for (let r = 0; r < PANEL; r++) img.set(rgb.subarray(r * PANEL * 3, (r + 1) * PANEL * 3), ((oy + r) * width + ox) * 3);
    // Panel frame, label and scale bar.
    for (let k = 0; k < PANEL; k++) {
      img.set([200, 200, 200], ((oy) * width + ox + k) * 3);
      img.set([200, 200, 200], ((oy + k) * width + ox) * 3);
    }
    drawText(img, width, height, ox + 10, oy + 10, VIEWS[view].label, 2, INK);
    const bar = niceBar(mmPerPx * PANEL);
    const px = Math.round(bar / mmPerPx);
    const by = oy + PANEL - 22;
    for (let k = 0; k < px; k++) for (let t = 0; t < 4; t++) img.set(INK, ((by + t) * width + ox + 12 + k) * 3);
    drawText(img, width, height, ox + 18 + px, by - 4, `${bar} mm`, 2, INK);
  });
  return encodePng({ width, height, rgb: img });
}
