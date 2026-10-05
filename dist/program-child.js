import { createRequire as __flo2CreateRequire } from 'node:module'; const require = __flo2CreateRequire(import.meta.url);

// src/program/child.ts
import vm from "node:vm";

// src/errors.ts
var CallError = class extends Error {
  path;
  problem;
  constructor(path, problem) {
    super(`${path}: ${problem}`);
    this.name = "CallError";
    this.path = path;
    this.problem = problem;
  }
};
function at(path, key) {
  if (typeof key === "number") return `${path}[${key}]`;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return path ? `${path}.${key}` : key;
  return `${path}[${JSON.stringify(key)}]`;
}

// src/kernel/manifold.ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
var KERNEL_DIR_NAME = "manifold-3d-3.5.4";
function readable(p) {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}
function kernelDir() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "vendor", KERNEL_DIR_NAME);
    if (readable(join(candidate, "manifold.js"))) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`the geometry kernel (vendor/${KERNEL_DIR_NAME}/manifold.js) was not found next to the engine`);
}
var loading;
function kernel() {
  loading ??= (async () => {
    const mod = await import(pathToFileURL(join(kernelDir(), "manifold.js")).href);
    const k = await mod.default();
    k.setup();
    return k;
  })();
  return loading;
}
function segmentsFor(radius, tol, min = 12) {
  if (radius <= tol) return min;
  const half = Math.acos(1 - tol / radius);
  return Math.max(min, Math.ceil(Math.PI / half));
}
function sphereSegments(radius, tol) {
  return Math.ceil(segmentsFor(radius, tol * 0.6, 16) / 4) * 4;
}

// src/metals.ts
var METAL_IDS = ["sterling_silver_925", "gold_14k_yellow", "gold_18k_yellow", "platinum_950"];
var SHAPEWAYS_SHRINK = 'Shapeways (silver, gold and platinum pages): "the metal shrinks by approximately 1-1.5%"; finishing takes the overall reduction to about 3%; ring inside diameters stay within \xB10.05-0.10 mm.';
var COMMON = [
  "https://www.materialise.com/en/academy/industrial/design-am/silver and .../gold: walls 0.8 mm (high gloss), ring bands at least 1 mm, details 0.35 mm across and 0.4 mm high, gaps 0.3 mm.",
  "Surface deviation 0.01 mm: con:surface-deviation-tolerance (Formlabs Form 4 50 \xB5m XY and 25 \xB5m layers; Asiga PRO 4K45 32 \xB5m XY).",
  SHAPEWAYS_SHRINK
];
var METALS = {
  sterling_silver_925: {
    id: "sterling_silver_925",
    name: "sterling silver 925",
    density: 10.4,
    limits: { wall: 0.8, band: 1, prong: 1, detail: 0.35, gap: 0.3, surfaceDeviation: 0.01 },
    shrinkagePct: 1.5,
    castingNote: null,
    sources: [
      "https://www.shapeways.com/materials/silver: walls 0.8 mm polished (0.6 mm natural finish); wire 0.8 mm supported, 1.0 mm unsupported; clearance 0.3 mm.",
      ...COMMON,
      "Density 10.40 g/cm\xB3: https://www.stuller.com/articles/view/where-to-find-gravity-of-materials/"
    ]
  },
  gold_14k_yellow: {
    id: "gold_14k_yellow",
    name: "14k yellow gold",
    density: 13.07,
    limits: { wall: 0.8, band: 1, prong: 1, detail: 0.35, gap: 0.3, surfaceDeviation: 0.01 },
    shrinkagePct: 1.5,
    castingNote: null,
    sources: [
      "https://www.shapeways.com/materials/gold: walls 0.8 mm; wire 0.8 mm supported, 1.0 mm unsupported; engraved detail 0.35 mm, embossed 0.4 mm; clearance 0.3 mm.",
      ...COMMON,
      "Density 13.07 g/cm\xB3: https://www.stuller.com/articles/view/where-to-find-gravity-of-materials/"
    ]
  },
  gold_18k_yellow: {
    id: "gold_18k_yellow",
    name: "18k yellow gold",
    density: 15.58,
    limits: { wall: 0.8, band: 1, prong: 1, detail: 0.35, gap: 0.3, surfaceDeviation: 0.01 },
    shrinkagePct: 1.5,
    castingNote: null,
    sources: [
      "https://www.shapeways.com/materials/gold: walls 0.8 mm; wire 0.8 mm supported, 1.0 mm unsupported; engraved detail 0.35 mm, embossed 0.4 mm; clearance 0.3 mm.",
      ...COMMON,
      "Density 15.58 g/cm\xB3: https://www.stuller.com/articles/view/where-to-find-gravity-of-materials/"
    ]
  },
  platinum_950: {
    id: "platinum_950",
    name: "platinum 950 (Pt950/Ru)",
    density: 20.7,
    // The gap is Stuller's 0.8 mm platinum figure, stricter than the 0.3 mm clearance of the services.
    limits: { wall: 0.8, band: 1, prong: 1, detail: 0.35, gap: 0.8, surfaceDeviation: 0.01 },
    shrinkagePct: 1.5,
    castingNote: "Platinum 950 melts at about 1780-1795 \xB0C and is cast at about 1850-2200 \xB0C, with special investment and an induction caster, so this file goes to a SPECIALIST platinum caster, not a home or local silver-and-gold setup.",
    sources: [
      "https://www.shapeways.com/materials/platinum: 95% platinum, 5% ruthenium; walls 0.8 mm; wire 0.8 mm supported, 1.0 mm unsupported; engraved detail 0.35 mm, embossed 0.4 mm; clearance 0.3 mm.",
      'Stuller production standards (http://stuller.scene7.com/is/content/Stuller/DAS/09b4e2e2-e12e-45f8-a2ed-a4f80104aa9f.pdf): "0.8mm minimum DBR [distance between rails] for Platinum and Palladium".',
      ...COMMON,
      "Melting range Pt950/Ru 1780-1795 \xB0C and density 20.7 g/cm\xB3: J. Maerz (PGI), https://www.ganoksin.com/article/platinum-alloys-features-benefits/",
      'Casting at about 1850-2200 \xB0C, "special equipment is needed", phosphate investment: https://products.riogrande.com/content/Instruction-Sheets/How-To-Cast-Platinum-IS.pdf; an induction caster costs about $30,000: http://technical-articles.hooverandstrong.com/wordpress/platinum-casting-in-a-small-shop/'
    ]
  }
};
var STRICTEST = Object.keys(METALS).reduce(
  (acc, id) => {
    const l = METALS[id].limits;
    return {
      wall: Math.max(acc.wall, l.wall),
      band: Math.max(acc.band, l.band),
      prong: Math.max(acc.prong, l.prong),
      detail: Math.max(acc.detail, l.detail),
      gap: Math.max(acc.gap, l.gap),
      surfaceDeviation: Math.min(acc.surfaceDeviation, l.surfaceDeviation)
    };
  },
  { wall: 0, band: 0, prong: 0, detail: 0, gap: 0, surfaceDeviation: Infinity }
);

// src/units.ts
var QUANTITY = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(\S.*?)?\s*$/;
var FOREIGN_LENGTH = {
  in: 25.4,
  inch: 25.4,
  inches: 25.4,
  '"': 25.4,
  "\u2033": 25.4,
  cm: 10,
  m: 1e3,
  um: 1e-3,
  "\xB5m": 1e-3,
  \u03BCm: 1e-3,
  mil: 0.0254,
  thou: 0.0254,
  ft: 304.8
};
var FOREIGN_ANGLE = {
  rad: 180 / Math.PI,
  radian: 180 / Math.PI,
  radians: 180 / Math.PI,
  grad: 0.9,
  turn: 360
};
function round(n, places = 4) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
function split(v, path, example) {
  if (typeof v === "number") {
    throw new CallError(path, `${v} has no unit. Every measurement must say its unit, for example "${example}".`);
  }
  if (typeof v !== "string") {
    throw new CallError(path, `expected a measurement written with its unit, for example "${example}".`);
  }
  const m = QUANTITY.exec(v);
  if (!m) {
    throw new CallError(path, `"${v}" is not a measurement; write a number and its unit, for example "${example}".`);
  }
  const num = Number(m[1]);
  if (!Number.isFinite(num)) {
    throw new CallError(path, `"${v}" is not a finite number.`);
  }
  return { num, unit: m[2], text: v };
}
function lengthMm(v, path) {
  const { num, unit, text } = split(v, path, "1.2 mm");
  if (unit === void 0) {
    throw new CallError(path, `"${text}" has no unit. Write "${num} mm" if you mean millimetres.`);
  }
  if (unit === "mm") return num;
  const f = FOREIGN_LENGTH[unit] ?? FOREIGN_LENGTH[unit.toLowerCase()];
  if (f !== void 0) {
    throw new CallError(
      path,
      `"${text}" is in ${unit}; this engine takes lengths in mm only. Convert it yourself and show the person the conversion: ${num} ${unit} \xD7 ${f} = ${round(num * f)} mm.`
    );
  }
  throw new CallError(path, `"${unit}" is not a length unit this engine takes; write the length in mm, for example "1.2 mm".`);
}
function angleDeg(v, path) {
  const { num, unit, text } = split(v, path, "30 deg");
  if (unit === void 0) {
    throw new CallError(path, `"${text}" has no unit. Write "${num} deg" if you mean degrees.`);
  }
  if (unit === "deg" || unit === "\xB0" || unit === "degrees") return num;
  const f = FOREIGN_ANGLE[unit.toLowerCase()];
  if (f !== void 0) {
    throw new CallError(
      path,
      `"${text}" is in ${unit}; this engine takes angles in deg only. Convert it yourself and show the person the conversion: ${num} ${unit} = ${round(num * f)} deg.`
    );
  }
  throw new CallError(path, `"${unit}" is not an angle unit this engine takes; write the angle in deg, for example "30 deg".`);
}
function percent(v, path) {
  const { num, unit, text } = split(v, path, "1.5 %");
  if (unit !== "%") {
    throw new CallError(path, `"${text}" must be a percentage written with "%", for example "1.5 %".`);
  }
  return num;
}
function looksLikeQuantity(v) {
  return QUANTITY.test(v);
}
function anyQuantity(v, path) {
  if (typeof v === "number") {
    throw new CallError(path, `${v} has no unit. Every measurement must say its unit: "mm" for lengths, "deg" for angles.`);
  }
  if (typeof v !== "string") return;
  const m = QUANTITY.exec(v);
  if (!m) return;
  const unit = m[2];
  if (unit === void 0) {
    throw new CallError(path, `"${v}" has no unit. Every measurement must say its unit: "mm" for lengths, "deg" for angles.`);
  }
  if (unit === "mm" || unit === "deg" || unit === "\xB0" || unit === "%") return;
  if (FOREIGN_LENGTH[unit] !== void 0 || FOREIGN_LENGTH[unit.toLowerCase()] !== void 0) lengthMm(v, path);
  if (FOREIGN_ANGLE[unit.toLowerCase()] !== void 0) angleDeg(v, path);
  throw new CallError(path, `"${unit}" is not a unit this engine takes; lengths are in mm and angles in deg.`);
}
var UK_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function ringInnerDiameterMm(v, path) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new CallError(path, 'a ring size is an object naming its system and size, for example {"system": "US", "size": "7"}.');
  }
  const o = v;
  const system = o["system"];
  if (system === void 0) {
    throw new CallError(`${path}.system`, 'a ring size must name its system: "US", "UK" or "EU". The same number is a different ring in each.');
  }
  if (system !== "US" && system !== "UK" && system !== "EU") {
    throw new CallError(`${path}.system`, `"${String(system)}" is not a ring-size system this engine knows; use "US", "UK" or "EU".`);
  }
  const raw = o["size"];
  if (raw === void 0 || raw === null || raw === "") {
    throw new CallError(`${path}.size`, `give the size in the ${system} system, for example ${system === "UK" ? '"N"' : system === "EU" ? '"54"' : '"7"'}.`);
  }
  for (const k of Object.keys(o)) {
    if (k !== "system" && k !== "size") throw new CallError(`${path}.${k}`, 'a ring size has only "system" and "size".');
  }
  const sizePath = `${path}.size`;
  const text = String(raw).trim();
  if (system === "US") {
    const n = parseFraction(text);
    if (n === null || n < 3 || n > 16 || Math.abs(n * 4 - Math.round(n * 4)) > 1e-9) {
      throw new CallError(sizePath, `"${text}" is not a US ring size; US sizes run from 3 to 16 in quarter sizes, for example "7" or "7.5".`);
    }
    return { size: { system, size: raw }, diameterMm: round(11.63 + 0.8128 * n, 3) };
  }
  if (system === "UK") {
    const m = /^([A-Za-z])\s*(½|1\/2|\.5)?$/.exec(text);
    const i = m ? UK_LETTERS.indexOf(m[1].toUpperCase()) : -1;
    if (!m || i < 0) {
      throw new CallError(sizePath, `"${text}" is not a UK ring size; UK sizes are letters A to Z, with halves, for example "N" or "N\xBD".`);
    }
    const circumference = 37.5 + 1.25 * i + (m[2] ? 0.625 : 0);
    return { size: { system, size: raw }, diameterMm: round(circumference / Math.PI, 3) };
  }
  const c = parseFraction(text);
  if (c === null || c < 38 || c > 76) {
    throw new CallError(sizePath, `"${text}" is not an EU ring size; an EU size is the inner circumference in mm, from 38 to 76, for example "54".`);
  }
  return { size: { system, size: raw }, diameterMm: round(c / Math.PI, 3) };
}
function parseFraction(t) {
  const s = t.replace("\xBD", " 1/2").replace("\xBC", " 1/4").replace("\xBE", " 3/4").trim();
  let m = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d+)\s+(\d)\/(\d)$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  return null;
}
function caratText(v, path) {
  const { num, unit, text } = split(v, path, "2.00 ct");
  if (unit !== "ct") {
    throw new CallError(path, `"${text}" must be a carat weight written with "ct", for example "2.00 ct". It is kept for reference only; the stone is sized from its measured length, width and depth.`);
  }
  if (num <= 0 || num > 50) throw new CallError(path, `${num} ct is not a plausible weight for one stone.`);
  return `${num} ct`;
}

// src/library/thicken.ts
var SURFACES = ["flat", "sphere", "cylinder"];
var SHEET_AXES = ["x", "y"];
var SPHERE_MAX_DEG = 90;
var CYLINDER_MAX_DEG = 150;
var THICKNESS_RANGE_MM = [0.1, 5];
var MIN_RADIUS_PER_THICKNESS = 5;
var RADIUS_MAX_MM = 1e3;
var ROUND_CORNERS_MAX_MM = 5;
var IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function compose(a, b) {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let s = c === 3 ? a[r * 4 + 3] : 0;
      for (let k = 0; k < 3; k++) s += a[r * 4 + k] * b[k * 4 + c];
      o[r * 4 + c] = s;
    }
  }
  return o;
}
var translation = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
function rotation(xd, yd, zd) {
  const rad = Math.PI / 180;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(xd * rad), Math.sin(xd * rad), Math.cos(yd * rad), Math.sin(yd * rad), Math.cos(zd * rad), Math.sin(zd * rad)];
  const rx = [1, 0, 0, 0, 0, cx, -sx, 0, 0, sx, cx, 0];
  const ry = [cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0];
  const rz = [cz, -sz, 0, 0, sz, cz, 0, 0, 0, 0, 1, 0];
  return compose(rz, compose(ry, rx));
}
function reflection(n) {
  const [a, b, c] = n;
  return [1 - 2 * a * a, -2 * a * b, -2 * a * c, 0, -2 * a * b, 1 - 2 * b * b, -2 * b * c, 0, -2 * a * c, -2 * b * c, 1 - 2 * c * c, 0];
}
var applyPoint = (m, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]
];
function applyDirection(m, d) {
  const v = [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[4] * d[0] + m[5] * d[1] + m[6] * d[2], m[8] * d[0] + m[9] * d[1] + m[10] * d[2]];
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function sheetSpec(n) {
  const p = n.params ?? {};
  const surface = p["surface"] ?? "flat";
  return {
    outline: p["outline"].map((pt) => [lengthMm(pt[0], "x"), lengthMm(pt[1], "y")]),
    thickness: lengthMm(p["thickness"], "thickness"),
    surface,
    radius: surface === "flat" ? Infinity : lengthMm(p["radius"], "radius"),
    axis: p["axis"] ?? "x",
    roundCorners: p["round_corners"] === void 0 ? 0 : lengthMm(p["round_corners"], "round_corners")
  };
}
function surfaceMap(s) {
  const R = s.radius;
  if (s.surface === "sphere") {
    return (x, y, z) => {
      const rho = Math.hypot(x, y);
      const th = rho / R;
      const c = rho > 1e-12 ? x / rho : 1, sn = rho > 1e-12 ? y / rho : 0;
      const u = [Math.sin(th) * c, Math.sin(th) * sn, -Math.cos(th)];
      const r = R - z;
      return { p: [r * u[0], r * u[1], R + r * u[2]], n: [-u[0], -u[1], -u[2]] };
    };
  }
  if (s.surface === "cylinder") {
    const alongX = s.axis === "x";
    return (x, y, z) => {
      const across = alongX ? y : x;
      const th = across / R;
      const r = R - z;
      const a = r * Math.sin(th);
      const p = alongX ? [x, a, R - r * Math.cos(th)] : [a, y, R - r * Math.cos(th)];
      const n = alongX ? [0, -Math.sin(th), Math.cos(th)] : [-Math.sin(th), 0, Math.cos(th)];
      return { p, n };
    };
  }
  return (x, y, z) => ({ p: [x, y, z], n: [0, 0, 1] });
}
function reachDeg(outline, s) {
  if (s.surface === "flat") return 0;
  let far = 0;
  for (const [x, y] of outline) far = Math.max(far, s.surface === "sphere" ? Math.hypot(x, y) : Math.abs(s.axis === "x" ? y : x));
  return far / s.radius * (180 / Math.PI);
}
function signedArea2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}
function gridLines(a, b, h) {
  const n = Math.max(1, Math.ceil((b - a) / h));
  return Float64Array.from({ length: n + 1 }, (_, i) => Math.fround(a + (b - a) * i / n));
}
function forEachGridTriangle(nx, ny, fn) {
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      fn([i, j], [i + 1, j], [i + 1, j + 1]);
      fn([i, j], [i + 1, j + 1], [i, j + 1]);
    }
  }
}
function gridSlab(k, xs, ys, zb, zt) {
  const nx = xs.length - 1, ny = ys.length - 1;
  const layer = (nx + 1) * (ny + 1);
  const vert = new Float32Array(layer * 2 * 3);
  for (let top = 0; top < 2; top++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const v = (top * layer + j * (nx + 1) + i) * 3;
        vert[v] = xs[i];
        vert[v + 1] = ys[j];
        vert[v + 2] = top ? zt : zb;
      }
    }
  }
  const id = (i, j, top) => top * layer + j * (nx + 1) + i;
  const tri = [];
  forEachGridTriangle(nx, ny, (a, b, c) => {
    tri.push(id(a[0], a[1], 1), id(b[0], b[1], 1), id(c[0], c[1], 1));
    tri.push(id(a[0], a[1], 0), id(c[0], c[1], 0), id(b[0], b[1], 0));
  });
  const side = (p, q) => tri.push(p, q, q + layer, p, q + layer, p + layer);
  for (let i = 0; i < nx; i++) side(id(i, 0, 0), id(i + 1, 0, 0));
  for (let j = 0; j < ny; j++) side(id(nx, j, 0), id(nx, j + 1, 0));
  for (let i = nx; i > 0; i--) side(id(i, ny, 0), id(i - 1, ny, 0));
  for (let j = ny; j > 0; j--) side(id(0, j, 0), id(0, j - 1, 0));
  return new k.Manifold(new k.Mesh({ numProp: 3, vertProperties: vert, triVerts: Uint32Array.from(tri) }));
}
function gridSpacing(s, tol) {
  const rOut = s.radius + s.thickness / 2;
  return Math.min(1, s.radius * Math.sqrt(8 * 0.9 * tol / rOut));
}
function nearestOnTriangle(a, b, c) {
  const seg = (p, q) => {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const u = l2 > 0 ? Math.max(0, Math.min(1, -(p[0] * d[0] + p[1] * d[1] + p[2] * d[2]) / l2)) : 0;
    return Math.hypot(p[0] + u * d[0], p[1] + u * d[1], p[2] + u * d[2]);
  };
  let best = Math.min(seg(a, b), seg(b, c), seg(c, a));
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const nn = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
  if (nn > 0) {
    const s = (a[0] * n[0] + a[1] * n[1] + a[2] * n[2]) / nn;
    const f = [s * n[0], s * n[1], s * n[2]];
    const side = (p, q) => {
      const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [f[0] - p[0], f[1] - p[1], f[2] - p[2]];
      return (u[1] * w[2] - u[2] * w[1]) * n[0] + (u[2] * w[0] - u[0] * w[2]) * n[1] + (u[0] * w[1] - u[1] * w[0]) * n[2];
    };
    if (side(a, b) >= 0 && side(b, c) >= 0 && side(c, a) >= 0) best = Math.min(best, Math.abs(s) * Math.sqrt(nn));
  }
  return best;
}
function convexSag(s, xs, ys) {
  if (s.surface === "flat") return 0;
  const R = s.radius, map = surfaceMap(s);
  const nx = xs.length - 1;
  const at2 = [];
  for (let j = 0; j < ys.length; j++) {
    for (let i = 0; i <= nx; i++) {
      const p = map(xs[i], ys[j], 0).p;
      at2.push(s.surface === "sphere" ? [p[0], p[1], p[2] - R] : s.axis === "x" ? [0, p[1], p[2] - R] : [p[0], 0, p[2] - R]);
    }
  }
  let fMin = 1;
  forEachGridTriangle(nx, ys.length - 1, (a, b, c) => {
    fMin = Math.min(fMin, nearestOnTriangle(at2[a[1] * (nx + 1) + a[0]], at2[b[1] * (nx + 1) + b[0]], at2[c[1] * (nx + 1) + c[0]]) / R);
  });
  return (R + s.thickness / 2) * (1 / fMin - 1);
}
var FLOAT_ALLOWANCE = 2 ** -22;
function floatAllowance(reach, m, later = 0) {
  return FLOAT_ALLOWANCE * (Math.hypot(m[3], m[7], m[11]) + later + reach);
}
function divide(polys, step) {
  return polys.map((poly) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let j = 0; j < pieces; j++) out.push([a[0] + (b[0] - a[0]) * j / pieces, a[1] + (b[1] - a[1]) * j / pieces]);
    }
    return out;
  });
}
function buildThicken(k, A, n, tol, ctx) {
  const { Manifold, CrossSection } = k;
  const s = sheetSpec(n);
  const t = s.thickness;
  let cs = A.t(new CrossSection([signedArea2(s.outline) < 0 ? [...s.outline].reverse() : s.outline]));
  if (s.roundCorners > 0) {
    const rc = s.roundCorners;
    const seg = segmentsFor(rc, tol, 16);
    cs = A.t(A.t(A.t(A.t(cs.offset(-rc, "Round", 2, seg)).offset(rc, "Round", 2, seg)).offset(rc, "Round", 2, seg)).offset(-rc, "Round", 2, seg));
  }
  if (cs.isEmpty()) {
    throw new CallError(`${n.id}.params.round_corners`, `rounding the corners by ${s.roundCorners} mm leaves nothing of the outline: no part of it is ${2 * s.roundCorners} mm across. Use a smaller round_corners or a wider outline.`);
  }
  if (s.surface !== "flat") cs = A.t(new CrossSection(divide(cs.toPolygons(), Math.min(0.25, 0.05 * s.radius))));
  const bb = cs.bounds();
  const far = Math.max(...[bb.min[0], bb.max[0]].flatMap((x) => [bb.min[1], bb.max[1]].map((y) => Math.hypot(x, y))));
  let solid;
  if (s.surface === "flat") {
    const eps = floatAllowance(far + t, ctx?.m ?? IDENTITY, ctx?.moveReachMm);
    solid = A.t(A.t(Manifold.extrude(cs, t + 2 * eps)).translate([0, 0, -(t / 2 + eps)]));
  } else {
    const map = surfaceMap(s);
    const warp = (v, count) => {
      for (let i = 0; i < count; i++) {
        const q = map(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]).p;
        v[i * 3] = q[0];
        v[i * 3 + 1] = q[1];
        v[i * 3 + 2] = q[2];
      }
    };
    const h = gridSpacing(s, tol);
    const xs = gridLines(bb.min[0] - 1.31 * h, bb.max[0] + 1.27 * h, h), ys = gridLines(bb.min[1] - 1.19 * h, bb.max[1] + 1.43 * h, h);
    const sag = convexSag(s, xs, ys);
    const eps = floatAllowance(far + t + sag, ctx?.m ?? IDENTITY, ctx?.moveReachMm);
    const zb = -(t / 2 + sag + eps), zt = t / 2 + eps;
    const slab = A.t(A.t(gridSlab(k, xs, ys, zb, zt)).warpBatch(warp));
    const m = Math.min(0.3, (s.radius - t / 2) / 2);
    const rOut = s.radius - zb + m;
    const lc = Math.min(1, s.radius * Math.sqrt(m / rOut));
    const prism = A.t(A.t(A.t(A.t(Manifold.extrude(cs, zt - zb + 2 * m)).translate([0, 0, zb - m])).refineToLength(lc)).warpBatch(warp));
    solid = A.t(slab.intersect(prism));
  }
  if (ctx?.sheets) ctx.sheets.push(declareSheet(n.id, s, cs.toPolygons(), ctx.m));
  return solid;
}
function insideContours(polys, x, y) {
  let c = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a[1] > y !== b[1] > y && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
  }
  return c;
}
function distanceToEdges(polys, x, y) {
  let best = Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      const u = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - a[0] - u * dx, y - a[1] - u * dy));
    }
  }
  return best;
}
function insetBoundary(polys, step, inset) {
  const out = [];
  for (const poly of polys) {
    const ccw3 = signedArea2(poly) > 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy);
      if (l < 1e-9) continue;
      const nx = (ccw3 ? -dy : dy) / l * inset, ny = (ccw3 ? dx : -dx) / l * inset;
      const pieces = Math.max(1, Math.ceil(l / step));
      for (let s = 0; s < pieces; s++) {
        const x = a[0] + dx * (s + 0.5) / pieces + nx, y = a[1] + dy * (s + 0.5) / pieces + ny;
        if (insideContours(polys, x, y)) out.push([x, y]);
      }
    }
  }
  return out;
}
function declareSheet(label, s, polys, m) {
  let area = 0;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const poly of polys) {
    area += signedArea2(poly) / 2;
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const spacing = Math.min(1, Math.max(0.25, Math.sqrt(Math.abs(area) / 300)));
  const inset = Math.min(0.05, s.thickness / 4);
  const flat = [];
  for (let y = y0 + spacing / 2; y < y1; y += spacing) {
    for (let x = x0 + spacing / 2; x < x1; x += spacing) if (insideContours(polys, x, y) && distanceToEdges(polys, x, y) >= inset) flat.push([x, y]);
  }
  flat.push(...insetBoundary(polys, spacing / 2, inset));
  const map = surfaceMap(s);
  const points = [], normals = [];
  for (const [x, y] of flat) {
    const q = map(x, y, 0);
    points.push(applyPoint(m, q.p));
    normals.push(applyDirection(m, q.n));
  }
  return { label, nominalThickness: s.thickness, spacing, points, normals };
}

// src/piece/tree.ts
var OPERATIONS = [
  "union",
  "difference",
  "intersection",
  "smooth_union",
  "translate",
  "rotate",
  "mirror",
  "sweep",
  "revolve",
  "extrude",
  "sphere",
  "cylinder",
  "box",
  "torus",
  "thicken"
];
var BLENDABLE = /* @__PURE__ */ new Set(["sphere", "cylinder", "box", "torus", "sweep", "translate", "rotate", "mirror", "union", "smooth_union"]);
var PARTS = ["ring_shank", "prong_head", "bezel"];
var FEATURES = ["wall", "band", "prong", "seat", "detail"];
var BAND_PROFILES = ["comfort_fit", "half_round", "flat", "round"];
var STONE_SETTINGS = ["prong_head", "bezel", "none"];
var STONE_SHAPES = ["round", "emerald"];
var ORIENTATIONS = ["east_west", "north_south"];
var COUNT_KEYS = /* @__PURE__ */ new Set(["prong_count", "prong", "count", "segments"]);
var NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
var NODE_ID = /^[a-z][a-z0-9_]{0,39}$/;
var STONE_DEFAULTS = {
  round: { diameter: "6.5 mm", depth: "4.0 mm", carat: "1.00 ct" },
  emerald: { length: "8.5 mm", width: "6.0 mm", depth: "4.1 mm", carat: "2.00 ct" }
};
var PARAMS = [
  {
    key: "name",
    kind: "name",
    help: 'A short name for the piece, used to name its files (e.g. "emily-solitaire" gives emily-solitaire.stl). Letters, digits, "-" and "_" only.'
  },
  {
    key: "ring_size",
    kind: "ring_size",
    help: 'The finger size, in a named system: {"system": "US", "size": "7"}, {"system": "UK", "size": "N"} or {"system": "EU", "size": "54"}. A size without its system is refused.'
  },
  {
    key: "metal",
    kind: "enum",
    values: METAL_IDS,
    default: "sterling_silver_925",
    help: "The metal it will be cast in: sterling_silver_925, gold_14k_yellow, gold_18k_yellow or platinum_950. Each has its own cited casting limits and shrinkage; platinum goes to a specialist caster."
  },
  { key: "band_width", kind: "length", min: 1, max: 12, default: "2.2 mm", help: "How wide the band is, measured along the finger." },
  {
    key: "band_thickness",
    kind: "length",
    min: 0.3,
    max: 4,
    default: "1.6 mm",
    limit: "1.0 mm",
    help: "How thick the band metal is, from the inside of the ring to the outside."
  },
  {
    key: "band_profile",
    kind: "enum",
    values: BAND_PROFILES,
    default: "comfort_fit",
    help: "The band's cross-section: comfort_fit (rounded inside and out), half_round (flat inside, domed outside), flat, or round (a round wire; set band_width and band_thickness equal for a true circle)."
  },
  {
    key: "stone_setting",
    kind: "enum",
    values: STONE_SETTINGS,
    default: "prong_head",
    help: "How the stone is held: prong_head (4 or 6 prongs), bezel (a full metal rim around the stone, no prongs), or none for a plain band."
  },
  { key: "stone_shape", kind: "enum", values: STONE_SHAPES, default: "round", help: "round (a round brilliant) or emerald (a rectangular step cut with cut corners)." },
  {
    key: "stone_diameter",
    kind: "length",
    min: 2,
    max: 14,
    default: STONE_DEFAULTS.round.diameter,
    help: "A round stone's diameter, as MEASURED on its grading report (not from a carat chart)."
  },
  { key: "stone_length", kind: "length", min: 3, max: 20, default: STONE_DEFAULTS.emerald.length, help: "An emerald cut's length (its long side), as measured on its grading report." },
  { key: "stone_width", kind: "length", min: 2, max: 15, default: STONE_DEFAULTS.emerald.width, help: "An emerald cut's width (its short side), as measured on its grading report." },
  {
    key: "stone_depth",
    kind: "length",
    min: 1,
    max: 12,
    help: "The stone's total depth, table to culet, as measured on its grading report. Until given, a placeholder: 4.0 mm for the round, 4.1 mm for the emerald cut."
  },
  {
    key: "stone_carat",
    kind: "carat",
    help: 'The carat weight from the grading report, e.g. "2.00 ct". For reference only: the stone is always sized from its measured dimensions.'
  },
  {
    key: "stone_orientation",
    kind: "enum",
    values: ORIENTATIONS,
    default: "east_west",
    help: "Which way an emerald cut's long side runs: east_west (across the finger) or north_south (along the finger)."
  },
  { key: "prong_count", kind: "enum", values: [4, 6], default: 4, help: "How many prongs grip the stone: 4 or 6." },
  {
    key: "prong_thickness",
    kind: "length",
    min: 0.3,
    max: 3,
    default: "1.4 mm",
    limit: "1.0 mm at its narrowest, where the seat is cut (about prong_thickness minus 0.2 mm)",
    help: "How thick each prong is. A thinner prong can be drawn and previewed, but the piece will not export until every prong is at least the limit at its narrowest."
  },
  {
    key: "bezel_wall",
    kind: "length",
    min: 0.3,
    max: 3,
    default: "1.0 mm",
    limit: "0.8 mm",
    help: "How thick the bezel's metal rim around the stone is."
  },
  {
    key: "bezel_lip",
    kind: "lip",
    default: "auto",
    limit: "covers 50 % to 75 % of the crown",
    help: 'How far the bezel rises above the girdle, to be pushed over the stone: "auto" (60 % of the crown height), or a height like "0.7 mm".'
  },
  {
    key: "shrinkage",
    kind: "shrinkage",
    default: "off",
    help: `"off", "on" (the metal's cited allowance, 1.5 %), or an allowance such as "1.2 %" that enlarges the piece so it shrinks back to size in casting. Every export says whether it was applied.`
  }
];
var PARAM_BY_KEY = new Map(PARAMS.map((p) => [p.key, p]));
function checkParam(spec, v, path) {
  switch (spec.kind) {
    case "name":
      if (typeof v !== "string" || !NAME.test(v)) {
        throw new CallError(path, 'a piece name is 1 to 64 letters, digits, "-" or "_", starting with a letter or digit, for example "emily-solitaire".');
      }
      return;
    case "ring_size":
      ringInnerDiameterMm(v, path);
      return;
    case "length": {
      const mm = lengthMm(v, path);
      if (spec.min !== void 0 && mm < spec.min) throw new CallError(path, `${mm} mm is below the smallest the library can build (${spec.min} mm).`);
      if (spec.max !== void 0 && mm > spec.max) throw new CallError(path, `${mm} mm is above the largest the library builds (${spec.max} mm).`);
      return;
    }
    case "enum":
      if (!spec.values.includes(v)) {
        throw new CallError(path, `must be one of ${spec.values.map((x) => JSON.stringify(x)).join(", ")}; got ${JSON.stringify(v)}.`);
      }
      return;
    case "shrinkage":
      shrinkagePercent(v, "sterling_silver_925", path);
      return;
    case "carat":
      caratText(v, path);
      return;
    case "lip":
      if (v === "auto") return;
      {
        const mm = lengthMm(v, path);
        if (mm < 0.1 || mm > 4) throw new CallError(path, `${mm} mm is outside what the library builds (0.1 to 4 mm), or "auto".`);
      }
      return;
  }
}
function shrinkagePercent(v, metal, path) {
  if (v === "off") return 0;
  if (v === "on") return METALS[metal].shrinkagePct;
  const pct = percent(v, path);
  if (pct <= 0 || pct > 5) {
    throw new CallError(path, `a shrinkage allowance is "off", "on", or between 0 and 5 %, for example "1.5 %"; got "${String(v)}".`);
  }
  return pct;
}
var HEAD_DEFAULTS = {
  /** How far each prong reaches in over the stone's girdle (Stuller: 0.15 mm; the default sits above it). */
  prong_grip: "0.2 mm",
  /** Gap between the stone's culet (its point) and the top of the band. */
  culet_clearance: "0.3 mm"
};
function bandDefaults(profile) {
  return profile === "round" ? { width: "2.0 mm", thickness: "2.0 mm" } : { width: PARAM_BY_KEY.get("band_width").default, thickness: PARAM_BY_KEY.get("band_thickness").default };
}
function validateOpNode(v, path) {
  if (v !== null && typeof v === "object" && !Array.isArray(v) && v["part"] !== void 0) {
    throw new CallError(at(path, "part"), "a library part is called as a function in a program (ringShank, prongHead, bezel), not passed to op().");
  }
  validateNode(v, path, /* @__PURE__ */ new Set(), false);
  return v;
}
function validateNode(v, path, ids, inBlend) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new CallError(path, 'a tree node is an object with an "id" and either a "part" or an "op".');
  }
  const n = v;
  const id = n["id"];
  if (typeof id !== "string" || !NODE_ID.test(id)) {
    throw new CallError(at(path, "id"), 'a node id is lower-case letters, digits and "_", starting with a letter, for example "band" or "head".');
  }
  if (ids.has(id)) throw new CallError(at(path, "id"), `"${id}" is used by another node; ids must be unique in a piece.`);
  ids.add(id);
  const hasPart = n["part"] !== void 0;
  const hasOp = n["op"] !== void 0;
  if (hasPart === hasOp) throw new CallError(path, 'a node has exactly one of "part" (a jewelry part) or "op" (an operation).');
  if (hasPart && !PARTS.includes(n["part"])) {
    throw new CallError(at(path, "part"), `"${String(n["part"])}" is not a library part; the parts are ${PARTS.join(", ")}.`);
  }
  if (hasOp && !OPERATIONS.includes(n["op"])) {
    throw new CallError(at(path, "op"), `"${String(n["op"])}" is not an operation; the operations are ${OPERATIONS.join(", ")}.`);
  }
  if (inBlend && (hasPart || !BLENDABLE.has(n["op"]))) {
    throw new CallError(path, `a smooth_union can blend only ${[...BLENDABLE].join(", ")}; "${String(n["part"] ?? n["op"])}" is not one of them.`);
  }
  if (n["feature"] !== void 0 && !FEATURES.includes(n["feature"])) {
    throw new CallError(at(path, "feature"), `must be one of ${FEATURES.join(", ")}.`);
  }
  for (const k of Object.keys(n)) {
    if (!["id", "part", "op", "feature", "params", "children"].includes(k)) throw new CallError(at(path, k), "is not a field of a tree node.");
  }
  const params = n["params"] ?? {};
  if (params === null || typeof params !== "object" || Array.isArray(params)) throw new CallError(at(path, "params"), "must be an object of settings.");
  const pPath = at(path, "params");
  const p = params;
  if (n["part"] === "ring_shank") validateBand(p, pPath);
  else if (n["part"] === "prong_head") validateProngHead(p, pPath);
  else if (n["part"] === "bezel") validateBezel(p, pPath);
  else validateOp(n["op"], p, pPath);
  const children = n["children"];
  if (children !== void 0) {
    if (!Array.isArray(children)) throw new CallError(at(path, "children"), "must be a list of nodes.");
    if (hasPart && children.length) throw new CallError(at(path, "children"), "a library part has no children.");
    children.forEach((c, i) => validateNode(c, at(at(path, "children"), i), ids, inBlend || n["op"] === "smooth_union"));
  }
  const kids = children?.length ?? 0;
  const op = n["op"];
  if (op && ["union", "difference", "intersection", "smooth_union", "translate", "rotate", "mirror"].includes(op) && kids === 0) {
    throw new CallError(at(path, "children"), `a ${op} needs at least one child.`);
  }
  if (op && ["sphere", "cylinder", "box", "torus", "sweep", "revolve", "extrude", "thicken"].includes(op) && kids > 0) {
    throw new CallError(at(path, "children"), `a ${op} is a shape and has no children.`);
  }
}
function only(o, path, keys) {
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw new CallError(at(path, k), `is not a setting of this part; its settings are ${keys.join(", ")}.`);
}
function validateBand(p, path) {
  only(p, path, ["ring_size", "width", "thickness", "profile"]);
  checkParam(PARAM_BY_KEY.get("ring_size"), p["ring_size"], at(path, "ring_size"));
  checkParam(PARAM_BY_KEY.get("band_width"), p["width"], at(path, "width"));
  checkParam(PARAM_BY_KEY.get("band_thickness"), p["thickness"], at(path, "thickness"));
  checkParam(PARAM_BY_KEY.get("band_profile"), p["profile"], at(path, "profile"));
}
function validateStone(s, path) {
  if (s === null || typeof s !== "object" || Array.isArray(s)) {
    throw new CallError(path, 'the stone is {"shape": "round", "diameter": "6.5 mm", "depth": "4.0 mm"} or {"shape": "emerald", "length": "8.5 mm", "width": "6.0 mm", "depth": "4.1 mm", "orientation": "east_west"}.');
  }
  const o = s;
  checkParam(PARAM_BY_KEY.get("stone_shape"), o["shape"], at(path, "shape"));
  if (o["shape"] === "round") {
    only(o, path, ["shape", "diameter", "depth", "carat", "placeholder", "orientation"]);
    checkParam(PARAM_BY_KEY.get("stone_diameter"), o["diameter"], at(path, "diameter"));
  } else {
    only(o, path, ["shape", "length", "width", "depth", "carat", "placeholder", "orientation"]);
    checkParam(PARAM_BY_KEY.get("stone_length"), o["length"], at(path, "length"));
    checkParam(PARAM_BY_KEY.get("stone_width"), o["width"], at(path, "width"));
    if (lengthMm(o["width"], at(path, "width")) > lengthMm(o["length"], at(path, "length"))) {
      throw new CallError(at(path, "width"), "the width is the SHORT side of an emerald cut; it cannot be more than its length.");
    }
    checkParam(PARAM_BY_KEY.get("stone_orientation"), o["orientation"], at(path, "orientation"));
  }
  checkParam(PARAM_BY_KEY.get("stone_depth"), o["depth"], at(path, "depth"));
  if (o["carat"] !== void 0) caratText(o["carat"], at(path, "carat"));
  const ph = o["placeholder"] ?? [];
  if (!Array.isArray(ph) || ph.some((x) => !["diameter", "length", "width", "depth", "carat"].includes(x))) {
    throw new CallError(at(path, "placeholder"), `lists which of the stone's dimensions are still template placeholders, e.g. ["depth"].`);
  }
}
function validateProngHead(p, path) {
  only(p, path, ["stone", "prong_count", "prong_thickness", "prong_grip", "culet_clearance", "prong_overrides"]);
  validateStone(p["stone"], at(path, "stone"));
  checkHeadSettings("prong_head", p, path);
}
function validateBezel(p, path) {
  only(p, path, ["stone", "wall", "lip", "culet_clearance"]);
  validateStone(p["stone"], at(path, "stone"));
  checkHeadSettings("bezel", p, path);
}
function checkHeadSettings(kind, p, path) {
  const cc = lengthMm(p["culet_clearance"], at(path, "culet_clearance"));
  if (cc < 0.1 || cc > 5) throw new CallError(at(path, "culet_clearance"), `${cc} mm is outside what the library builds (0.1 to 5 mm).`);
  if (kind === "bezel") {
    checkParam(PARAM_BY_KEY.get("bezel_wall"), p["wall"], at(path, "wall"));
    checkParam(PARAM_BY_KEY.get("bezel_lip"), p["lip"], at(path, "lip"));
    return;
  }
  checkParam(PARAM_BY_KEY.get("prong_count"), p["prong_count"], at(path, "prong_count"));
  checkParam(PARAM_BY_KEY.get("prong_thickness"), p["prong_thickness"], at(path, "prong_thickness"));
  const grip = lengthMm(p["prong_grip"], at(path, "prong_grip"));
  if (grip < 0.05 || grip > 1) throw new CallError(at(path, "prong_grip"), `${grip} mm is outside what the library builds (0.05 to 1 mm).`);
  const ov = p["prong_overrides"] ?? [];
  if (!Array.isArray(ov)) throw new CallError(at(path, "prong_overrides"), 'a list like [{"prong": 2, "thickness": "0.7 mm"}].');
  const count = p["prong_count"];
  ov.forEach((o, i) => {
    const op = at(at(path, "prong_overrides"), i);
    if (o === null || typeof o !== "object" || Array.isArray(o)) throw new CallError(op, 'each override is {"prong": 2, "thickness": "0.7 mm"}.');
    const r = o;
    only(r, op, ["prong", "thickness"]);
    if (!Number.isInteger(r["prong"]) || r["prong"] < 1 || r["prong"] > count) {
      throw new CallError(at(op, "prong"), `which prong, counted 1 to ${count} clockwise from 12 o'clock seen from above.`);
    }
    checkParam(PARAM_BY_KEY.get("prong_thickness"), r["thickness"], at(op, "thickness"));
  });
}
var OP_PARAMS = {
  union: {},
  difference: {},
  intersection: {},
  smooth_union: { radius: "length" },
  translate: { x: "length", y: "length", z: "length" },
  rotate: { x: "angle", y: "angle", z: "angle" },
  mirror: { plane: "plane" },
  sphere: { radius: "length" },
  cylinder: { radius: "length", height: "length" },
  box: { x: "length", y: "length", z: "length" },
  torus: { major_radius: "length", minor_radius: "length" },
  extrude: { points: "points2", height: "length" },
  revolve: { points: "points2", degrees: "angle" },
  sweep: { radius: "length", path: "points3", closed: "boolean" },
  thicken: { outline: "points2", thickness: "length", surface: "word", radius: "length", axis: "word", round_corners: "length" }
};
var REQUIRED_OP_PARAMS = {
  smooth_union: ["radius"],
  mirror: ["plane"],
  sphere: ["radius"],
  cylinder: ["radius", "height"],
  box: ["x", "y", "z"],
  torus: ["major_radius", "minor_radius"],
  extrude: ["points", "height"],
  revolve: ["points"],
  sweep: ["radius", "path"],
  thicken: ["outline", "thickness"]
};
function validateOp(op, p, path) {
  const spec = OP_PARAMS[op];
  only(p, path, Object.keys(spec));
  for (const k of REQUIRED_OP_PARAMS[op] ?? []) if (p[k] === void 0) throw new CallError(at(path, k), `a ${op} needs "${k}".`);
  for (const [k, kind] of Object.entries(spec)) {
    const v = p[k];
    if (v === void 0) continue;
    const kp = at(path, k);
    if (kind === "length") {
      const mm = lengthMm(v, kp);
      if (mm < 0 && !["x", "y", "z"].includes(k)) throw new CallError(kp, "must not be negative.");
    } else if (kind === "angle") validateUnitsDeep(v, kp, k);
    else if (kind === "plane") {
      if (!["xy", "yz", "xz"].includes(v)) throw new CallError(kp, 'the mirror plane is "xy", "yz" or "xz".');
    } else if (kind === "boolean") {
      if (typeof v !== "boolean") throw new CallError(kp, "must be true or false.");
    } else if (kind === "word") {
      if (typeof v !== "string") throw new CallError(kp, 'must be a word in quotes, such as "sphere".');
    } else {
      const dim = kind === "points2" ? 2 : 3;
      if (!Array.isArray(v) || v.length < 2) throw new CallError(kp, `a list of at least 2 points, each [${dim === 2 ? '"x mm", "y mm"' : '"x mm", "y mm", "z mm"'}].`);
      v.forEach((pt, i) => {
        if (!Array.isArray(pt) || pt.length !== dim) throw new CallError(at(kp, i), `a point is ${dim} lengths, e.g. [${dim === 2 ? '"1 mm", "2 mm"' : '"1 mm", "2 mm", "0 mm"'}].`);
        pt.forEach((c, j) => lengthMm(c, at(at(kp, i), j)));
      });
      if (kind === "points2" && v.length < 3) throw new CallError(kp, "a profile needs at least 3 points.");
    }
  }
  if (op === "thicken") validateThicken(p, path);
}
function validateThicken(p, path) {
  const surface = p["surface"] ?? "flat";
  if (!SURFACES.includes(surface)) {
    throw new CallError(at(path, "surface"), `must be "flat", "sphere" (a cup, curved equally every way) or "cylinder" (a curl, curved one way); got ${JSON.stringify(p["surface"])}.`);
  }
  const t = lengthMm(p["thickness"], at(path, "thickness"));
  const [tMin, tMax] = THICKNESS_RANGE_MM;
  if (t < tMin || t > tMax) {
    throw new CallError(at(path, "thickness"), `${t} mm is outside what the library builds (${tMin} to ${tMax} mm). It is measured square to the surface; a casting needs at least the metal's wall minimum (0.8 mm).`);
  }
  if (surface === "flat") {
    for (const k of ["radius", "axis"]) {
      if (p[k] !== void 0) throw new CallError(at(path, k), `a flat sheet has no ${k}; leave it out, or set "surface" to "sphere" or "cylinder".`);
    }
  } else {
    if (p["radius"] === void 0) throw new CallError(at(path, "radius"), `a ${surface} needs the radius its middle surface curves at, e.g. "8 mm": the smaller the radius, the deeper the ${surface === "sphere" ? "cup" : "curl"}.`);
    const r = lengthMm(p["radius"], at(path, "radius"));
    if (r < MIN_RADIUS_PER_THICKNESS * t - 1e-9) {
      throw new CallError(
        at(path, "radius"),
        `${r} mm curves a ${t} mm sheet too tightly: the radius must be at least ${MIN_RADIUS_PER_THICKNESS} times the thickness (${Math.round(MIN_RADIUS_PER_THICKNESS * t * 1e3) / 1e3} mm here). Use a larger radius, or a thinner sheet. Below that the casting check reads the sheet's edge thinner than it is.`
      );
    }
    if (r > RADIUS_MAX_MM) throw new CallError(at(path, "radius"), `${r} mm is more than the library builds (${RADIUS_MAX_MM} mm); use "surface": "flat" for a sheet this flat.`);
  }
  if (p["axis"] !== void 0) {
    if (surface !== "cylinder") throw new CallError(at(path, "axis"), "only a cylinder has an axis; leave it out.");
    if (!SHEET_AXES.includes(p["axis"])) throw new CallError(at(path, "axis"), `the line the sheet curls round: "x" (it rises as y grows) or "y" (it rises as x grows); got ${JSON.stringify(p["axis"])}.`);
  }
  if (p["round_corners"] !== void 0) {
    const rc = lengthMm(p["round_corners"], at(path, "round_corners"));
    if (rc < 0 || rc > ROUND_CORNERS_MAX_MM) throw new CallError(at(path, "round_corners"), `${rc} mm is outside what the library builds (0 to ${ROUND_CORNERS_MAX_MM} mm).`);
  }
  const outline = p["outline"].map((pt, i) => [lengthMm(pt[0], at(at(at(path, "outline"), i), 0)), lengthMm(pt[1], at(at(at(path, "outline"), i), 1))]);
  if (Math.abs(signedArea2(outline)) / 2 < 0.01) throw new CallError(at(path, "outline"), "the outline encloses no area; give the sheet's edge as a closed loop of points, in order round it.");
  if (surface !== "flat") {
    const r = lengthMm(p["radius"], at(path, "radius"));
    const axis = p["axis"] ?? "x";
    const reach = reachDeg(outline, { surface, radius: r, axis });
    const max = surface === "sphere" ? SPHERE_MAX_DEG : CYLINDER_MAX_DEG;
    if (reach > max + 1e-9) {
      const minR = Math.ceil(reach / max * r * 10) / 10;
      throw new CallError(
        at(path, "outline"),
        surface === "sphere" ? `the outline reaches ${Math.round(reach * Math.PI / 180 * r * 100) / 100} mm from the origin (the bottom of the cup), more than a quarter of the way round a sphere of radius ${r} mm (${SPHERE_MAX_DEG}\xB0). Use a radius of at least ${minR} mm, or a smaller outline.` : `the outline reaches ${Math.round(reach * Math.PI / 180 * r * 100) / 100} mm across the cylinder's axis from the origin, more than ${CYLINDER_MAX_DEG}\xB0 round a cylinder of radius ${r} mm. Use a radius of at least ${minR} mm, or a smaller outline.`
      );
    }
  }
}
function validateUnitsDeep(v, path, key) {
  if (typeof v === "number") {
    if (COUNT_KEYS.has(key) && Number.isInteger(v)) return;
    anyQuantity(v, path);
  } else if (typeof v === "string") {
    if (looksLikeQuantity(v)) anyQuantity(v, path);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => validateUnitsDeep(x, at(path, i), key));
  } else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) validateUnitsDeep(x, at(path, k), k);
  }
}
var SET_ORDER = new Map(PARAMS.map((p, i) => [p.key, i]));
function stoneView(s) {
  const shape = s["shape"];
  const depthMm = lengthMm(s["depth"], "stone.depth");
  const v = shape === "round" ? { shape, lengthMm: lengthMm(s["diameter"], "stone.diameter"), widthMm: lengthMm(s["diameter"], "stone.diameter"), depthMm, orientation: "east_west", placeholder: [] } : {
    shape,
    lengthMm: lengthMm(s["length"], "stone.length"),
    widthMm: lengthMm(s["width"], "stone.width"),
    depthMm,
    orientation: s["orientation"],
    placeholder: []
  };
  if (s["carat"] !== void 0) v.carat = caratText(s["carat"], "stone.carat");
  v.placeholder = [...s["placeholder"] ?? []];
  return v;
}
function headView(kind, hp, stone) {
  if (kind === "prong_head") {
    const count = hp["prong_count"];
    const base = lengthMm(hp["prong_thickness"], "head.prong_thickness");
    const each = Array.from({ length: count }, () => base);
    for (const o of hp["prong_overrides"] ?? []) each[o.prong - 1] = lengthMm(o.thickness, "head.prong_overrides");
    return {
      kind: "prong_head",
      stone,
      prongCount: count,
      prongThicknessMm: each,
      nominalProngMm: base,
      gripMm: lengthMm(hp["prong_grip"], "head.prong_grip"),
      culetClearanceMm: lengthMm(hp["culet_clearance"], "head.culet_clearance")
    };
  }
  return {
    kind: "bezel",
    stone,
    wallMm: lengthMm(hp["wall"], "head.wall"),
    lipMm: hp["lip"] === "auto" ? "auto" : lengthMm(hp["lip"], "head.lip"),
    culetClearanceMm: lengthMm(hp["culet_clearance"], "head.culet_clearance")
  };
}

// src/library/field.ts
var L = (p, k, dflt = 0) => p[k] === void 0 ? dflt : lengthMm(p[k], k);
var D = (p, k, dflt = 0) => p[k] === void 0 ? dflt : angleDeg(p[k], k);
var pts3 = (v) => v.map((pt) => [lengthMm(pt[0], "x"), lengthMm(pt[1], "y"), lengthMm(pt[2], "z")]);
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k / 4;
}
function capsule(x, y, z, a, b, r) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = x - a[0], pay = y - a[1], paz = z - a[2];
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1)));
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}
function rotInverse(xd, yd, zd) {
  const [cx, sx] = [Math.cos(-xd * Math.PI / 180), Math.sin(-xd * Math.PI / 180)];
  const [cy, sy] = [Math.cos(-yd * Math.PI / 180), Math.sin(-yd * Math.PI / 180)];
  const [cz, sz] = [Math.cos(-zd * Math.PI / 180), Math.sin(-zd * Math.PI / 180)];
  return (x, y, z) => {
    let x1 = cz * x - sz * y, y1 = sz * x + cz * y, z1 = z;
    const x2 = cy * x1 + sy * z1, z2 = -sy * x1 + cy * z1;
    x1 = x2;
    z1 = z2;
    const y3 = cx * y1 - sx * z1, z3 = sx * y1 + cx * z1;
    return [x1, y3, z3];
  };
}
var SLACK = 1e-9;
var Leaf = class {
  constructor(f) {
    this.f = f;
  }
  f;
  value(x, y, z) {
    return this.f(x, y, z);
  }
  within(cx, cy, cz) {
    return { node: this, v: this.f(cx, cy, cz) };
  }
};
var Capsule = class {
  constructor(a, b, r) {
    this.a = a;
    this.b = b;
    this.r = r;
  }
  a;
  b;
  r;
  value(x, y, z) {
    return capsule(x, y, z, this.a, this.b, this.r);
  }
  within(cx, cy, cz) {
    return { node: this, v: capsule(cx, cy, cz, this.a, this.b, this.r) };
  }
};
var MinOf = class _MinOf {
  constructor(kids, map) {
    this.kids = kids;
    this.map = map;
  }
  kids;
  map;
  value(x, y, z) {
    if (this.map) [x, y, z] = this.map(x, y, z);
    let m = Infinity;
    for (const k of this.kids) m = Math.min(m, k.value(x, y, z));
    return m;
  }
  within(cx, cy, cz, rho) {
    if (this.map) [cx, cy, cz] = this.map(cx, cy, cz);
    const parts = this.kids.map((k) => k.within(cx, cy, cz, rho));
    let v = Infinity;
    for (const p of parts) v = Math.min(v, p.v);
    const keep = parts.filter((p) => p.v - rho <= v + rho + SLACK);
    const same = keep.length === parts.length && keep.every((p, i) => p.node === this.kids[i]);
    return { node: same ? this : new _MinOf(keep.map((p) => p.node), this.map), v };
  }
};
var SmoothMin = class _SmoothMin {
  constructor(kids, k) {
    this.kids = kids;
    this.k = k;
  }
  kids;
  k;
  value(x, y, z) {
    let m = Infinity;
    for (const kid of this.kids) {
      const f = kid.value(x, y, z);
      m = m === Infinity ? f : smin(m, f, this.k);
    }
    return m;
  }
  within(cx, cy, cz, rho) {
    const parts = this.kids.map((kid) => kid.within(cx, cy, cz, rho));
    const k = this.k;
    let keep = [];
    let m = Infinity;
    for (let i = 0; i < parts.length; i++) {
      const vi = parts[i].v;
      if (m === Infinity) {
        keep = [i];
        m = vi;
        continue;
      }
      if (vi - rho >= m + rho + k + SLACK) {
        m = smin(m, vi, k);
        continue;
      }
      if (m - rho >= vi + rho + k + SLACK) keep = [i];
      else keep.push(i);
      m = smin(m, vi, k);
    }
    const same = keep.length === parts.length && keep.every((j, i) => j === i && parts[i].node === this.kids[i]);
    return { node: same ? this : new _SmoothMin(keep.map((j) => parts[j].node), k), v: m };
  }
};
function compile(n) {
  const p = n.params ?? {};
  const kids = () => (n.children ?? []).map(compile);
  switch (n.op) {
    case "sphere": {
      const r = L(p, "radius");
      return new Leaf((x, y, z) => Math.hypot(x, y, z) - r);
    }
    case "box": {
      const bx = L(p, "x") / 2, by = L(p, "y") / 2, bz = L(p, "z") / 2;
      return new Leaf((x, y, z) => {
        const qx = Math.abs(x) - bx, qy = Math.abs(y) - by, qz = Math.abs(z) - bz;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
      });
    }
    case "cylinder": {
      const r = L(p, "radius"), h = L(p, "height");
      return new Leaf((x, y, z) => {
        const dx = Math.hypot(x, y) - r, dz = Math.abs(z - h / 2) - h / 2;
        return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
      });
    }
    case "torus": {
      const R = L(p, "major_radius"), r = L(p, "minor_radius");
      return new Leaf((x, y, z) => Math.hypot(Math.hypot(x, y) - R, z) - r);
    }
    case "sweep": {
      const r = L(p, "radius");
      const path = pts3(p["path"]);
      const m = p["closed"] === true ? path.length : path.length - 1;
      const caps = [];
      for (let i = 0; i < m; i++) caps.push(new Capsule(path[i], path[(i + 1) % path.length], r));
      return new MinOf(caps, null);
    }
    case "translate": {
      const tx = L(p, "x"), ty = L(p, "y"), tz = L(p, "z");
      return new MinOf(kids(), (x, y, z) => [x - tx, y - ty, z - tz]);
    }
    case "rotate":
      return new MinOf(kids(), rotInverse(D(p, "x"), D(p, "y"), D(p, "z")));
    case "mirror": {
      const pl = p["plane"];
      return new MinOf(kids(), (x, y, z) => [pl === "yz" ? -x : x, pl === "xz" ? -y : y, pl === "xy" ? -z : z]);
    }
    case "union":
      return new MinOf(kids(), null);
    case "smooth_union":
      return new SmoothMin(kids(), L(p, "radius"));
  }
  throw new CallError(`${n.id}.op`, `"${String(n.op)}" cannot be blended.`);
}
function levelSetStep(min, max, edge) {
  let step = 0;
  for (let i = 0; i < 3; i++) {
    const size = max[i] - min[i];
    const n = Math.trunc(size / edge + 1);
    step = Math.max(step, n > 1 ? size / (n - 1) : size);
  }
  return step;
}
var FINE_PER_COARSE = 8;
var BlendField = class {
  #root;
  #o;
  #fine;
  #coarse;
  #n;
  #far;
  #cells;
  constructor(n, box, step) {
    this.#root = compile(n);
    this.#far = 2 * step;
    this.#fine = 2 * step;
    this.#coarse = this.#fine * FINE_PER_COARSE;
    this.#o = [box.min[0] - step, box.min[1] - step, box.min[2] - step];
    this.#n = [0, 1, 2].map((i) => Math.max(1, Math.ceil((box.max[i] + step - this.#o[i]) / this.#coarse)));
    this.#cells = new Array(this.#n[0] * this.#n[1] * this.#n[2]);
  }
  #cell(node, cx, cy, cz, size) {
    const rho = size * Math.sqrt(3) / 2;
    const { node: pruned, v } = node.within(cx, cy, cz, rho);
    const stand = v - rho > this.#far ? v - rho : v + rho < -this.#far ? v + rho : NaN;
    return { node: pruned, stand };
  }
  #find(x, y, z) {
    const o = this.#o, C = this.#coarse;
    const i = Math.floor((x - o[0]) / C), j = Math.floor((y - o[1]) / C), k = Math.floor((z - o[2]) / C);
    if (i < 0 || j < 0 || k < 0 || i >= this.#n[0] || j >= this.#n[1] || k >= this.#n[2]) return null;
    const ci = (i * this.#n[1] + j) * this.#n[2] + k;
    let coarse = this.#cells[ci];
    if (!coarse) {
      coarse = this.#cell(this.#root, o[0] + (i + 0.5) * C, o[1] + (j + 0.5) * C, o[2] + (k + 0.5) * C, C);
      this.#cells[ci] = coarse;
    }
    if (!Number.isNaN(coarse.stand)) return coarse;
    const F = this.#fine;
    const bx = o[0] + i * C, by = o[1] + j * C, bz = o[2] + k * C;
    const fi = Math.max(0, Math.min(FINE_PER_COARSE - 1, Math.floor((x - bx) / F)));
    const fj = Math.max(0, Math.min(FINE_PER_COARSE - 1, Math.floor((y - by) / F)));
    const fk = Math.max(0, Math.min(FINE_PER_COARSE - 1, Math.floor((z - bz) / F)));
    const fine = coarse.fine ??= new Array(FINE_PER_COARSE ** 3);
    const fx = (fi * FINE_PER_COARSE + fj) * FINE_PER_COARSE + fk;
    let cell = fine[fx];
    if (!cell) {
      cell = this.#cell(coarse.node, bx + (fi + 0.5) * F, by + (fj + 0.5) * F, bz + (fk + 0.5) * F, F);
      fine[fx] = cell;
    }
    return cell;
  }
  /** What the level set reads: the exact value, or one of the right sign where only the sign is read. */
  sample(x, y, z) {
    const c = this.#find(x, y, z);
    if (!c) return this.#root.value(x, y, z);
    return Number.isNaN(c.stand) ? c.node.value(x, y, z) : c.stand;
  }
  /** The exact value, everywhere. */
  value(x, y, z) {
    const c = this.#find(x, y, z);
    return c ? c.node.value(x, y, z) : this.#root.value(x, y, z);
  }
};
var SURFACE_REACH_MM = 0.2;
function projectOntoSurface(f, p, d, out, at2) {
  const g = (s) => f(p[0] + s * d[0], p[1] + s * d[1], p[2] + s * d[2]);
  const put = (s) => {
    out[at2] = p[0] + s * d[0];
    out[at2 + 1] = p[1] + s * d[1];
    out[at2 + 2] = p[2] + s * d[2];
  };
  const g0 = g(0);
  if (Math.abs(g0) <= 1e-9) return put(0);
  const toward = -Math.sign(g0);
  let a = 0, ga = g0, b = NaN, gb = NaN;
  for (let step = 1.25 * Math.abs(g0); Number.isNaN(b); step *= 2) {
    const s0 = Math.min(step, SURFACE_REACH_MM);
    for (const s of [toward * s0, -toward * s0]) {
      const gs = g(s);
      if (gs > 0 !== g0 > 0 || gs === 0) {
        b = s;
        gb = gs;
        break;
      }
    }
    if (s0 >= SURFACE_REACH_MM) break;
  }
  if (Number.isNaN(b)) return put(toward * SURFACE_REACH_MM);
  if (gb === 0) return put(b);
  let kept = 0;
  for (let it = 0; it < 100; it++) {
    const s = (a * gb - b * ga) / (gb - ga);
    const gs = g(s);
    if (Math.abs(gs) <= 1e-9 || Math.abs(b - a) <= 1e-12) return put(s);
    if (gs > 0 === gb > 0) {
      b = s;
      gb = gs;
      if (kept === 1) ga /= 2;
      kept = 1;
    } else {
      a = s;
      ga = gs;
      if (kept === -1) gb /= 2;
      kept = -1;
    }
  }
  put(Math.abs(ga) < Math.abs(gb) ? a : b);
}
var HOLD_PASSES = 40;
var HOLD_GENERATIONS = 6;
var HOLD_TURNED_COS = -0.25;
var GRAD_STEP = 1e-6;
var GRAD_FLOOR = 1 / 16;
var CREASE_COS = Math.cos(10 * Math.PI / 180);
var PAIR = 2 ** 26;
function gradient(f, x, y, z) {
  const h = GRAD_STEP;
  const g = [f(x + h, y, z) - f(x - h, y, z), f(x, y + h, z) - f(x, y - h, z), f(x, y, z + h) - f(x, y, z - h)];
  const l = Math.hypot(g[0], g[1], g[2]);
  return l > 0 ? [g[0] / l, g[1] / l, g[2] / l] : [0, 0, 0];
}
function meetOfPlanes(n, at2, p) {
  const G = n.map((u) => n.map((v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  const r = n.map((u, i) => u[0] * (p[0] - at2[i][0]) + u[1] * (p[1] - at2[i][1]) + u[2] * (p[2] - at2[i][2]));
  const l = solveSmall(G, r);
  if (!l) return null;
  const x = [p[0], p[1], p[2]];
  for (let i = 0; i < n.length; i++) for (let c = 0; c < 3; c++) x[c] = x[c] - l[i] * n[i][c];
  return x;
}
function solveSmall(A, b) {
  const k = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let i = c + 1; i < k; i++) if (Math.abs(M[i][c]) > Math.abs(M[piv][c])) piv = i;
    if (Math.abs(M[piv][c]) < 0.03) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let i = 0; i < k; i++) {
      if (i === c) continue;
      const q = M[i][c] / M[c][c];
      for (let j = c; j <= k; j++) M[i][j] = M[i][j] - q * M[c][j];
    }
  }
  return M.map((row, i) => row[k] / row[i]);
}
function segmentThrough(p, q, a, b, c) {
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-18) return false;
  const inv = 1 / det;
  const sx = p[0] - a[0], sy = p[1] - a[1], sz = p[2] - a[2];
  const u = (sx * hx + sy * hy + sz * hz) * inv;
  if (u <= 1e-9 || u >= 1 - 1e-9) return false;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v <= 1e-9 || u + v >= 1 - 1e-9) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-7 && t < 1 - 1e-7;
}
var HASH_CELL = 0.1;
function holdToSurface(V, numProp, triVerts, f, tol) {
  const nv0 = V.length / numProp;
  if (nv0 >= PAIR / 4) throw new Error(`a blend's level set has ${nv0} vertices, more than its refinement indexes`);
  const P = new Array(nv0 * 3);
  for (let i = 0; i < nv0; i++) {
    P[i * 3] = V[i * numProp];
    P[i * 3 + 1] = V[i * numProp + 1];
    P[i * 3 + 2] = V[i * numProp + 2];
  }
  const gen = new Array(nv0).fill(0);
  const T = Array.from(triVerts);
  const alive = new Array(T.length / 3).fill(1);
  const born = new Array(T.length / 3).fill(0);
  const pair = (a, b) => a < b ? a * PAIR + b : b * PAIR + a;
  const at2 = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
  const dist2 = (a, b) => (P[b * 3] - P[a * 3]) ** 2 + (P[b * 3 + 1] - P[a * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[a * 3 + 2]) ** 2;
  const normal = (a, b, c) => {
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    return l > 0 ? [nx / l, ny / l, nz / l] : [0, 0, 0];
  };
  const probe = new Float64Array(3);
  const slope = new Array(nv0).fill(NaN);
  const slopeAt = (i) => {
    let g = slope[i];
    if (Number.isNaN(g)) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], h = GRAD_STEP;
      g = Math.hypot(f(x + h, y, z) - f(x - h, y, z), f(x, y + h, z) - f(x, y - h, z), f(x, y, z + h) - f(x, y, z - h)) / (2 * h);
      slope[i] = g;
    }
    return g;
  };
  const standOffNear = (x, y, z, v, ca, cb, cc) => {
    const a = Math.abs(v);
    if (a > tol || a < tol * GRAD_FLOOR) return a;
    const g = Math.min(1, slopeAt(ca), slopeAt(cb), cc >= 0 ? slopeAt(cc) : 1);
    const first = a / Math.max(g, a / SURFACE_REACH_MM);
    if (first <= tol) return first;
    const h = GRAD_STEP;
    const gx = f(x + h, y, z) - f(x - h, y, z), gy = f(x, y + h, z) - f(x, y - h, z), gz = f(x, y, z + h) - f(x, y, z - h);
    const gl = Math.hypot(gx, gy, gz);
    if (!(gl > 0)) return first;
    projectOntoSurface(f, [x, y, z], [gx / gl, gy / gl, gz / gl], probe, 0);
    const along = Math.hypot(probe[0] - x, probe[1] - y, probe[2] - z);
    return Math.max(a, Math.min(first, along));
  };
  const edgeOff = (a, b) => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const dx = P[b * 3] - ax, dy = P[b * 3 + 1] - ay, dz = P[b * 3 + 2] - az;
    let w = -1, at3 = 0.5, bv = 0;
    for (let i = 1; i <= 3; i++) {
      const s = i / 4, v = f(ax + dx * s, ay + dy * s, az + dz * s);
      if (Math.abs(v) > w) w = Math.abs(v), at3 = s, bv = v;
    }
    return standOffNear(ax + dx * at3, ay + dy * at3, az + dz * at3, bv, a, b, -1);
  };
  const turned = (a, b, c, from) => {
    const n = normal(a, b, c);
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) return true;
    if (n[0] * from[0] + n[1] * from[1] + n[2] * from[2] > 0) return false;
    const g = gradient(f, (P[a * 3] + P[b * 3] + P[c * 3]) / 3, (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3);
    return n[0] * g[0] + n[1] * g[1] + n[2] * g[2] <= HOLD_TURNED_COS;
  };
  const cells = /* @__PURE__ */ new Map();
  const region = /* @__PURE__ */ new Set();
  const cellOf = (x) => Math.floor(x / HASH_CELL) + 1024;
  const keyOf = (i, j, k) => (i * 2048 + j) * 2048 + k;
  const eachCell = (t, fn) => {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const i0 = cellOf(Math.min(P[a], P[b], P[c])), i1 = cellOf(Math.max(P[a], P[b], P[c]));
    const j0 = cellOf(Math.min(P[a + 1], P[b + 1], P[c + 1])), j1 = cellOf(Math.max(P[a + 1], P[b + 1], P[c + 1]));
    const k0 = cellOf(Math.min(P[a + 2], P[b + 2], P[c + 2])), k1 = cellOf(Math.max(P[a + 2], P[b + 2], P[c + 2]));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) fn(keyOf(i, j, k));
  };
  const put = (key, t) => {
    const list = cells.get(key);
    if (list) list.push(t);
    else cells.set(key, [t]);
  };
  const index = (t) => eachCell(t, (key) => region.has(key) && put(key, t));
  const ensure = (keys) => {
    const fresh = /* @__PURE__ */ new Set();
    for (const key of keys) if (!region.has(key)) fresh.add(key);
    if (!fresh.size) return;
    for (const key of fresh) region.add(key);
    const nt = T.length / 3;
    for (let t = 0; t < nt; t++) if (alive[t]) eachCell(t, (key) => fresh.has(key) && put(key, t));
  };
  const crosses = (a, b, c) => {
    const A = at2(a), B = at2(b), C = at2(c);
    const seen = /* @__PURE__ */ new Set();
    let hit = false;
    const lo = [0, 1, 2].map((k) => cellOf(Math.min(A[k], B[k], C[k])));
    const hi = [0, 1, 2].map((k) => cellOf(Math.max(A[k], B[k], C[k])));
    const want = [];
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) if (!region.has(keyOf(i, j, k))) want.push(keyOf(i, j, k));
    if (want.length) ensure(want);
    for (let i = lo[0]; i <= hi[0] && !hit; i++)
      for (let j = lo[1]; j <= hi[1] && !hit; j++)
        for (let k = lo[2]; k <= hi[2] && !hit; k++) {
          for (const u of cells.get((i * 2048 + j) * 2048 + k) ?? []) {
            if (!alive[u] || seen.has(u)) continue;
            seen.add(u);
            const x = T[u * 3], y = T[u * 3 + 1], z = T[u * 3 + 2];
            if (x === a || x === b || x === c || y === a || y === b || y === c || z === a || z === b || z === c) continue;
            const X = at2(x), Y = at2(y), Z = at2(z);
            if (segmentThrough(A, B, X, Y, Z) || segmentThrough(B, C, X, Y, Z) || segmentThrough(C, A, X, Y, Z) || segmentThrough(X, Y, A, B, C) || segmentThrough(Y, Z, A, B, C) || segmentThrough(Z, X, A, B, C)) {
              hit = true;
              break;
            }
          }
        }
    return hit;
  };
  const stuck = /* @__PURE__ */ new Set();
  let deferred = /* @__PURE__ */ new Set();
  const vborn = new Array(nv0).fill(-1);
  const out = new Float64Array(3);
  let split2 = 0, notFound = 0, leaned = 0, crossed = 0, deep = 0, passes = 0;
  for (; passes < HOLD_PASSES; passes++) {
    const nt = T.length / 3;
    const marked = /* @__PURE__ */ new Map();
    const measured = /* @__PURE__ */ new Set();
    for (let t = 0; t < nt; t++) {
      if (!alive[t] || born[t] !== passes) continue;
      for (let e = 0; e < 3; e++) {
        const a = T[t * 3 + e], b = T[t * 3 + (e + 1) % 3];
        const k = pair(a, b);
        if (stuck.has(k)) continue;
        if (passes === 0) {
          if (a > b) continue;
        } else {
          if (vborn[a] !== passes - 1 && vborn[b] !== passes - 1 && !deferred.has(k)) continue;
          if (measured.has(k)) continue;
          measured.add(k);
        }
        if (Math.max(gen[a], gen[b]) >= HOLD_GENERATIONS) {
          stuck.add(k);
          deep++;
          continue;
        }
        const w = edgeOff(a, b);
        if (w > tol) marked.set(k, w);
      }
    }
    for (let t = 0; t < nt; t++) {
      if (!alive[t] || born[t] !== passes) continue;
      const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
      if (marked.has(pair(a, b)) || marked.has(pair(b, c)) || marked.has(pair(c, a))) continue;
      const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
      const w = standOffNear(cx, cy, cz, f(cx, cy, cz), a, b, c);
      if (w <= tol) continue;
      let k = -1, longest = -1;
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const kk = pair(p, q), l = dist2(p, q);
        if (!stuck.has(kk) && Math.max(gen[p], gen[q]) < HOLD_GENERATIONS && l > longest) k = kk, longest = l;
      }
      if (k >= 0) marked.set(k, w);
    }
    if (!marked.size) break;
    const near = /* @__PURE__ */ new Set();
    for (const k of marked.keys()) {
      const a = Math.floor(k / PAIR), b = k - a * PAIR;
      const r = 2 + Math.ceil(Math.sqrt(dist2(a, b)) / HASH_CELL);
      const ci = cellOf((P[a * 3] + P[b * 3]) / 2), cj = cellOf((P[a * 3 + 1] + P[b * 3 + 1]) / 2), ck = cellOf((P[a * 3 + 2] + P[b * 3 + 2]) / 2);
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let kk = ck - r; kk <= ck + r; kk++) near.add(keyOf(i, j, kk));
    }
    ensure(near);
    const besideOf = (a, b) => {
      const list = [];
      const key = keyOf(cellOf((P[a * 3] + P[b * 3]) / 2), cellOf((P[a * 3 + 1] + P[b * 3 + 1]) / 2), cellOf((P[a * 3 + 2] + P[b * 3 + 2]) / 2));
      for (const t of cells.get(key) ?? []) {
        if (!alive[t]) continue;
        for (let e = 0; e < 3; e++) {
          const p = T[t * 3 + e], q = T[t * 3 + (e + 1) % 3];
          if (p === a && q === b || p === b && q === a) list.push([t, p, q, T[t * 3 + (e + 2) % 3]]);
        }
      }
      return list;
    };
    let made = 0;
    const waiting = /* @__PURE__ */ new Set();
    for (const [k, w] of [...marked].sort((x, y) => y[1] - x[1])) {
      const ka = Math.floor(k / PAIR);
      const side = besideOf(ka, k - ka * PAIR);
      if (side.length !== 2 || side.some(([t]) => born[t] === passes + 1)) {
        waiting.add(k);
        continue;
      }
      const [, a, b] = side[0];
      const mid = [(P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2];
      const len = Math.sqrt(dist2(a, b));
      const limit = Math.min(len, 8 * w);
      const from = side.map(([t]) => normal(T[t * 3], T[t * 3 + 1], T[t * 3 + 2]));
      const mean = [0, 0, 0];
      for (const n of from) mean[0] += n[0], mean[1] += n[1], mean[2] += n[2];
      let on = false, found = false, turnedOver = false;
      const tryFrom = (start, d) => {
        if (on || !start || Math.hypot(start[0] - mid[0], start[1] - mid[1], start[2] - mid[2]) > limit) return;
        const dl = Math.hypot(d[0], d[1], d[2]);
        if (!(dl > 1e-9)) return;
        projectOntoSurface(f, start, [d[0] / dl, d[1] / dl, d[2] / dl], out, 0);
        for (let i = 0; i < 3; i++) out[i] = Math.fround(out[i]);
        if (Math.abs(f(out[0], out[1], out[2])) > 1e-5 || Math.hypot(out[0] - mid[0], out[1] - mid[1], out[2] - mid[2]) > limit) return;
        found = true;
        const da = Math.hypot(out[0] - P[a * 3], out[1] - P[a * 3 + 1], out[2] - P[a * 3 + 2]);
        const db = Math.hypot(out[0] - P[b * 3], out[1] - P[b * 3 + 1], out[2] - P[b * 3 + 2]);
        if (da < 0.1 * len || db < 0.1 * len) return;
        const m2 = P.length / 3;
        P.push(out[0], out[1], out[2]);
        if (side.some(([, p, q, r], i) => turned(p, m2, r, from[i]) || turned(m2, q, r, from[i]))) turnedOver = true;
        else {
          for (const [t] of side) alive[t] = 0;
          on = !side.some(([, p, q, r]) => crosses(p, m2, r) || crosses(m2, q, r));
          for (const [t] of side) alive[t] = 1;
          if (!on) turnedOver = false;
        }
        P.length = m2 * 3;
      };
      const na = gradient(f, P[a * 3], P[a * 3 + 1], P[a * 3 + 2]), nb = gradient(f, P[b * 3], P[b * 3 + 1], P[b * 3 + 2]);
      let crossing = false;
      const attempt = (start, d) => {
        const before = found;
        tryFrom(start, d);
        if (!on && found && !before && !turnedOver) crossing = true;
      };
      if (na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] < CREASE_COS) {
        attempt(meetOfPlanes([na, nb], [at2(a), at2(b)], mid), mean);
        for (const [, , , r] of side) attempt(meetOfPlanes([na, nb, gradient(f, P[r * 3], P[r * 3 + 1], P[r * 3 + 2])], [at2(a), at2(b), at2(r)], mid), mean);
      }
      attempt(mid, mean);
      attempt(mid, gradient(f, mid[0], mid[1], mid[2]));
      if (!on) {
        if (!found) notFound++;
        else if (crossing) crossed++;
        else leaned++;
        stuck.add(k);
        continue;
      }
      const m = P.length / 3;
      P.push(out[0], out[1], out[2]);
      gen[m] = Math.max(gen[a], gen[b]) + 1;
      slope[m] = NaN;
      vborn[m] = passes;
      for (const [t, p, q, r] of side) {
        alive[t] = 0;
        const u = T.length / 3;
        T.push(p, m, r, m, q, r);
        alive.push(1, 1);
        born.push(passes + 1, passes + 1);
        index(u);
        index(u + 1);
      }
      made++;
    }
    split2 += made;
    if (!made) break;
    deferred = waiting;
  }
  if (!split2) return null;
  const tv = [];
  for (let t = 0; t < T.length / 3; t++) if (alive[t]) tv.push(T[t * 3], T[t * 3 + 1], T[t * 3 + 2]);
  return { positions: Float32Array.from(P), triVerts: Uint32Array.from(tv), split: split2, passes, kept: notFound + leaned + crossed + deep, notFound, leaned, crossed, deep };
}

// src/library/tolerances.ts
var EXPORT_TOL = 45e-4;
var PREVIEW_TOL = 0.03;

// src/library/ops.ts
var L2 = (p, k, dflt = 0) => p[k] === void 0 ? dflt : lengthMm(p[k], k);
var D2 = (p, k, dflt = 0) => p[k] === void 0 ? dflt : angleDeg(p[k], k);
var pts2 = (v) => v.map((pt) => [lengthMm(pt[0], "x"), lengthMm(pt[1], "y")]);
var pts32 = (v) => v.map((pt) => [lengthMm(pt[0], "x"), lengthMm(pt[1], "y"), lengthMm(pt[2], "z")]);
function ccw(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? [...pts].reverse() : pts;
}
var MIRROR_NORMAL = { xy: [0, 0, 1], yz: [1, 0, 0], xz: [0, 1, 0] };
function buildOp(k, A, n, tol, ctx = { m: IDENTITY }) {
  const { Manifold, CrossSection } = k;
  const p = n.params ?? {};
  const inner = n.op === "translate" ? { ...ctx, m: compose(ctx.m, translation(L2(p, "x"), L2(p, "y"), L2(p, "z"))) } : n.op === "rotate" ? { ...ctx, m: compose(ctx.m, rotation(D2(p, "x"), D2(p, "y"), D2(p, "z"))) } : n.op === "mirror" ? { ...ctx, m: compose(ctx.m, reflection(MIRROR_NORMAL[p["plane"]])) } : ctx;
  const kids = () => (n.children ?? []).map((ch) => buildOp(k, A, ch, tol, inner));
  const all = () => {
    const ms = kids();
    return ms.length === 1 ? ms[0] : A.t(Manifold.union(ms));
  };
  switch (n.op) {
    case "sphere": {
      const r = L2(p, "radius");
      return A.t(Manifold.sphere(r, sphereSegments(r, tol)));
    }
    case "cylinder": {
      const r = L2(p, "radius");
      return A.t(Manifold.cylinder(L2(p, "height"), r, r, segmentsFor(r, tol, 16)));
    }
    case "box":
      return A.t(Manifold.cube([L2(p, "x"), L2(p, "y"), L2(p, "z")], true));
    case "torus": {
      const R = L2(p, "major_radius"), r = L2(p, "minor_radius");
      if (r >= R) throw new CallError(`${n.id}.params.minor_radius`, "must be smaller than major_radius.");
      const n2 = segmentsFor(r, tol, 16);
      const ring = Array.from({ length: n2 }, (_, i) => [R + r * Math.cos(2 * Math.PI * i / n2), r * Math.sin(2 * Math.PI * i / n2)]);
      return A.t(Manifold.revolve(A.t(new CrossSection([ring])), segmentsFor(R + r, tol, 32)));
    }
    case "extrude":
      return A.t(Manifold.extrude(A.t(new CrossSection([ccw(pts2(p["points"]))])), L2(p, "height")));
    case "revolve": {
      const prof = ccw(pts2(p["points"]));
      const rMax = Math.max(...prof.map((q) => q[0]));
      return A.t(Manifold.revolve(A.t(new CrossSection([prof])), segmentsFor(rMax, tol, 32), D2(p, "degrees", 360)));
    }
    case "sweep": {
      const r = L2(p, "radius");
      const path = pts32(p["path"]);
      const seg = sphereSegments(r, tol);
      const ball = (q, i) => A.t(A.t(A.t(Manifold.sphere(r, seg)).rotate([0, 0, 7.31 * i + 3.7])).translate(q));
      const pieces = [];
      const m = p["closed"] === true ? path.length : path.length - 1;
      for (let i = 0; i < m; i++) pieces.push(A.t(Manifold.hull([ball(path[i], i), ball(path[(i + 1) % path.length], i)])));
      return pieces.length === 1 ? pieces[0] : A.t(Manifold.union(pieces));
    }
    case "union":
      return all();
    case "difference": {
      const [first, ...rest] = n.children ?? [];
      const keep = buildOp(k, A, first, tol, inner);
      if (!rest.length) return keep;
      const cutters = rest.map((ch) => buildOp(k, A, ch, tol, { m: inner.m, ...inner.blends ? { blends: inner.blends } : {}, ...inner.blendMeshes ? { blendMeshes: inner.blendMeshes } : {}, ...inner.moveReachMm ? { moveReachMm: inner.moveReachMm } : {} }));
      return A.t(keep.subtract(A.t(Manifold.union(cutters))));
    }
    case "intersection": {
      const ms = kids();
      return ms.length === 1 ? ms[0] : A.t(Manifold.intersection(ms));
    }
    case "translate":
      return A.t(all().translate([L2(p, "x"), L2(p, "y"), L2(p, "z")]));
    case "rotate":
      return A.t(all().rotate([D2(p, "x"), D2(p, "y"), D2(p, "z")]));
    case "mirror":
      return A.t(all().mirror(MIRROR_NORMAL[p["plane"]]));
    case "smooth_union":
      return smoothUnion(k, A, n, tol, ctx);
    case "thicken":
      return buildThicken(k, A, n, tol, ctx);
  }
  throw new CallError(`${n.id}.op`, `"${String(n.op ?? n.part)}" cannot be used here.`);
}
function smoothUnion(k, A, n, tol, ctx) {
  const { Manifold } = k;
  const p = n.params ?? {};
  const blend = L2(p, "radius");
  const gtol = Math.max(tol, EXPORT_TOL);
  const key = `${gtol} ${JSON.stringify(n)}`;
  const kept = ctx.blendMeshes?.reuse ? ctx.blendMeshes.meshes.get(key) : void 0;
  if (kept) return A.t(new Manifold(kept));
  const plain = A.t(Manifold.union((n.children ?? []).map((c) => buildOp(k, A, c, Math.max(tol, 0.05)))));
  const bb = plain.boundingBox();
  const g = blend + 0.3;
  const edge = Math.min(0.25, Math.max(0.03, Math.sqrt(8 * Math.max(blend, 0.2) * gtol)));
  const min = [bb.min[0] - g, bb.min[1] - g, bb.min[2] - g];
  const max = [bb.max[0] + g, bb.max[1] + g, bb.max[2] + g];
  const field = new BlendField(n, { min, max }, levelSetStep(min, max, edge));
  const raw = Manifold.levelSet((q) => -field.sample(q[0], q[1], q[2]), { min, max }, edge, 0, gtol / 2);
  const out = A.t(heldToSurface(k, raw, field, gtol));
  if (ctx.blendMeshes && !ctx.blendMeshes.reuse) ctx.blendMeshes.meshes.set(key, out.getMesh());
  ctx.blends?.push({ label: n.id, originalID: out.originalID(), m: ctx.m, field });
  return out;
}
function heldToSurface(k, raw, field, tol) {
  const mesh = raw.getMesh();
  const held = holdToSurface(mesh.vertProperties, mesh.numProp, mesh.triVerts, (x, y, z) => field.value(x, y, z), tol);
  if (!held) return raw;
  const rawTolerance = raw.tolerance();
  raw.delete();
  const made = new k.Manifold(new k.Mesh({ numProp: 3, vertProperties: held.positions, triVerts: held.triVerts }));
  if (made.status() !== "NoError") {
    const status = made.status();
    made.delete();
    throw new Error(`engine bug: a smooth blend held to its surface is not a closed solid (${status})`);
  }
  const original = made.asOriginal();
  made.delete();
  const out = original.setTolerance(rawTolerance);
  original.delete();
  return out;
}

// src/library/stones.ts
var CROWN_SHARE = 16.2 / (16.2 + 43.1);
function roundOutline(r, segments) {
  const out = [];
  for (let i = 0; i < segments; i++) {
    const a = 2 * Math.PI * i / segments;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}
function emeraldOutline(L3, W, corner) {
  const x = L3 / 2, y = W / 2, c = corner;
  return [
    [x, -y + c],
    [x, y - c],
    [x - c, y],
    [-x + c, y],
    [-x, y - c],
    [-x, -y + c],
    [-x + c, -y],
    [x - c, -y]
  ];
}
function rotateToOrientation(pts, o) {
  return o === "east_west" ? pts : pts.map(([x, y]) => [-y, x]);
}
function stoneShape(spec, tol) {
  const minor = Math.min(spec.lengthMm, spec.widthMm);
  const girdle = Math.max(0.08, 0.02 * minor);
  const rest = Math.max(0.2, spec.depthMm - girdle);
  const crown = rest * CROWN_SHARE;
  const pavilion = rest - crown;
  if (spec.shape === "round") {
    const r = spec.lengthMm / 2;
    const n = Math.max(24, Math.ceil(Math.PI / Math.acos(1 - Math.min(tol, r / 4) / r)));
    const outline2 = roundOutline(r, n);
    return {
      outline: outline2,
      girdle,
      crown,
      pavilion,
      points(c) {
        const pts = [];
        const rr = r + c;
        for (const [x, y] of roundOutline(rr, n)) {
          pts.push([x, y, -c * 0.5]);
          pts.push([x, y, girdle + c * 0.5]);
        }
        for (const [x, y] of roundOutline(r * 0.53 + c, Math.max(16, n / 2))) pts.push([x, y, girdle + crown + c]);
        pts.push([0, 0, -pavilion - c]);
        return pts;
      },
      outsideGirdle(c, x, y) {
        return Math.hypot(x, y) - (r + c);
      }
    };
  }
  const L3 = spec.lengthMm, W = spec.widthMm;
  const corner = 0.15 * W;
  const base = emeraldOutline(L3, W, corner);
  const outline = rotateToOrientation(base, spec.orientation);
  const grownGirdle = (c) => rotateToOrientation(emeraldOutline(L3 + 2 * c, W + 2 * c, corner + c * 0.4142), spec.orientation);
  return {
    outline,
    girdle,
    crown,
    pavilion,
    outsideGirdle(c, x, y) {
      return outsideConvex(grownGirdle(c), x, y);
    },
    points(c) {
      const pts = [];
      for (const [x, y] of grownGirdle(c)) {
        pts.push([x, y, -c * 0.5]);
        pts.push([x, y, girdle + c * 0.5]);
      }
      const inset = W * (1 - 0.65) / 2;
      const table = emeraldOutline(L3 - 2 * inset + 2 * c, W - 2 * inset + 2 * c, corner * 0.65);
      for (const [x, y] of rotateToOrientation(table, spec.orientation)) pts.push([x, y, girdle + crown + c]);
      const keel = (L3 - W) / 2;
      for (const [x, y] of rotateToOrientation(
        [
          [keel + 0.05, 0.05],
          [keel + 0.05, -0.05],
          [-keel - 0.05, 0.05],
          [-keel - 0.05, -0.05]
        ],
        spec.orientation
      ))
        pts.push([x, y, -pavilion - c]);
      return pts;
    }
  };
}
function outsideConvex(poly, x, y) {
  const n = poly.length;
  let inset = Infinity, nearest = Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const l2 = ex * ex + ey * ey || 1e-30;
    inset = Math.min(inset, (ex * (y - a[1]) - ey * (x - a[0])) / Math.sqrt(l2));
    const s = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2));
    nearest = Math.min(nearest, Math.hypot(x - a[0] - s * ex, y - a[1] - s * ey));
  }
  return inset >= 0 ? -inset : nearest;
}

// src/library/build.ts
var Arena = class {
  #items = [];
  t(x) {
    this.#items.push(x);
    return x;
  }
  free() {
    for (const x of this.#items.splice(0)) {
      try {
        x.delete();
      } catch {
      }
    }
  }
};
function domeOf(t) {
  return Math.min(0.35 * t, Math.max(0, t - 0.95));
}
function adaptive(f, u0, u1, tol, depth = 0) {
  const a = f(u0), b = f(u1);
  let worst = 0;
  for (const s of [0.25, 0.5, 0.75]) {
    const m = f(u0 + (u1 - u0) * s);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1e-30;
    const k = Math.max(0, Math.min(1, ((m[0] - a[0]) * dx + (m[1] - a[1]) * dy) / l2));
    worst = Math.max(worst, Math.hypot(m[0] - a[0] - k * dx, m[1] - a[1] - k * dy));
  }
  if (worst > tol && depth < 18) {
    const um = (u0 + u1) / 2;
    return [...adaptive(f, u0, um, tol, depth + 1), ...adaptive(f, um, u1, tol, depth + 1)];
  }
  return [a];
}
function bandProfile(profile, rIn, t, w, tol) {
  const hw = w / 2;
  if (profile === "flat") {
    return [
      [rIn, -hw],
      [rIn + t, -hw],
      [rIn + t, hw],
      [rIn, hw]
    ];
  }
  if (profile === "round") {
    const a = t / 2;
    const ell = (phi) => [rIn + a + a * Math.cos(phi), hw * Math.sin(phi)];
    return dedupe([...adaptive(ell, -Math.PI / 2, Math.PI / 2, tol), ...adaptive(ell, Math.PI / 2, 3 * Math.PI / 2, tol)]);
  }
  const d = domeOf(t);
  const dIn = profile === "comfort_fit" ? d * 0.35 : 0;
  const dOut = profile === "comfort_fit" ? d * 0.65 : d;
  const inner = (phi) => [rIn + dIn * (1 - Math.cos(phi)), hw * Math.sin(phi)];
  const outer = (phi) => [rIn + t - dOut * (1 - Math.cos(phi)), hw * Math.sin(phi)];
  const pts = [...adaptive(inner, Math.PI / 2, -Math.PI / 2, tol), inner(-Math.PI / 2), ...adaptive(outer, -Math.PI / 2, Math.PI / 2, tol), outer(Math.PI / 2)];
  return dedupe(pts);
}
function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) out.push(p);
  }
  if (out.length > 2) {
    const f = out[0], l = out[out.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= 1e-9) out.pop();
  }
  return out;
}
function edgeNormal(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}
function clockOf(x, y) {
  let deg = Math.atan2(x, y) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  const totalMin = Math.round(deg / 30 * 60);
  let h = Math.floor(totalMin / 60) % 12;
  const m = totalMin % 60;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")}`;
}
function prongPlaces(stone, outline, count) {
  if (stone.shape === "round") {
    const r = stone.lengthMm / 2;
    return Array.from({ length: count }, (_, i) => {
      const a = (i + 0.5) * 360 / count * (Math.PI / 180);
      const dir = [Math.sin(a), Math.cos(a)];
      return { at: [dir[0] * r, dir[1] * r], out: dir };
    });
  }
  const n = outline.length;
  const mids = outline.map((p, i) => {
    const q = outline[(i + 1) % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return { at: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], out: edgeNormal(p, q), len };
  });
  const corners = mids.filter((m) => Math.abs(m.out[0]) > 0.2 && Math.abs(m.out[1]) > 0.2);
  let places = corners;
  if (count === 6) {
    const sides = mids.filter((m) => !(Math.abs(m.out[0]) > 0.2 && Math.abs(m.out[1]) > 0.2));
    const longest = Math.max(...sides.map((s) => s.len));
    places = [...corners, ...sides.filter((s) => s.len >= longest - 1e-6)];
  }
  const angle = (p) => {
    const a = Math.atan2(p[0], p[1]);
    return a < 0 ? a + 2 * Math.PI : a;
  };
  return places.map(({ at: at2, out }) => ({ at: at2, out })).sort((a, b) => angle(a.at) - angle(b.at));
}
function prongPlacesAround(outline, count) {
  const n = outline.length;
  return Array.from({ length: count }, (_, i) => {
    const a = (i + 0.5) * 360 / count * (Math.PI / 180);
    const dir = [Math.sin(a), Math.cos(a)];
    let best = { s: 0, out: dir };
    for (let j = 0; j < n; j++) {
      const p = outline[j], q = outline[(j + 1) % n];
      const ex = q[0] - p[0], ey = q[1] - p[1];
      const det = dir[0] * -ey - dir[1] * -ex;
      if (Math.abs(det) < 1e-12) continue;
      const s = (p[0] * -ey - p[1] * -ex) / det;
      const u = (dir[0] * p[1] - dir[1] * p[0]) / det;
      if (s > best.s && u >= -1e-9 && u <= 1 + 1e-9) best = { s, out: edgeNormal(p, q) };
    }
    return { at: [dir[0] * best.s, dir[1] * best.s], out: best.out };
  });
}
var SEAT_CLEARANCE = 0.03;
var BEZEL_CLEARANCE = 0.05;
function stoneSpec(sv) {
  if (sv.shape === "custom") throw new Error("engine bug: a stone of its own shape has no round or emerald-cut spec");
  return { shape: sv.shape, lengthMm: sv.lengthMm, widthMm: sv.widthMm, depthMm: sv.depthMm, orientation: sv.orientation };
}
function narrowestSection(p, r, outside) {
  let best = { v: -Infinity, x: p[0], y: p[1] };
  const scan = (cx, cy, span2, n) => {
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const x = cx - span2 + 2 * span2 * i / n, y = cy - span2 + 2 * span2 * j / n;
        const v = Math.min(r - Math.hypot(x - p[0], y - p[1]), outside(x, y));
        if (v > best.v) best = { v, x, y };
      }
  };
  scan(p[0], p[1], r, 24);
  let span = r / 12;
  for (let k = 0; k < 10; k++) {
    scan(best.x, best.y, span, 8);
    span /= 3;
  }
  return Math.max(0, 2 * best.v);
}
function pieceDims(v, custom) {
  const rIn = v.innerDiameterMm / 2;
  const t = v.bandThicknessMm;
  const rOut = rIn + t;
  const dims = { band: { innerDiameterMm: v.innerDiameterMm, outerDiameterMm: 2 * rOut, widthMm: v.bandWidthMm, thicknessMm: t } };
  if (!v.head) return dims;
  const sv = v.head.stone;
  const shape = custom ?? stoneShape(stoneSpec(sv), PREVIEW_TOL);
  const culetZ = rOut + v.head.culetClearanceMm;
  const zGb = culetZ + shape.pavilion;
  const zGt = zGb + shape.girdle;
  const zTable = zGt + shape.crown;
  const grownBy = (d) => ({ lengthMm: sv.lengthMm + 2 * d, widthMm: sv.widthMm + 2 * d });
  const head = {
    kind: v.head.kind,
    shape: sv.shape,
    stone: { lengthMm: sv.lengthMm, widthMm: sv.widthMm, depthMm: sv.depthMm, girdleMm: shape.girdle, crownMm: shape.crown, pavilionMm: shape.pavilion },
    culetZ,
    girdleBottomZ: zGb,
    girdleTopZ: zGt,
    tableZ: zTable,
    culetClearanceMm: culetZ - rOut,
    seat: { ...grownBy(SEAT_CLEARANCE), clearanceMm: SEAT_CLEARANCE },
    outside: grownBy(0)
  };
  if (v.head.kind === "bezel") {
    const hv = v.head;
    const lip = hv.lipMm === "auto" ? Math.round(0.6 * shape.crown * 100) / 100 : hv.lipMm;
    head.seat = { ...grownBy(BEZEL_CLEARANCE), clearanceMm: BEZEL_CLEARANCE };
    head.outside = grownBy(BEZEL_CLEARANCE + hv.wallMm);
    head.bezel = { wallMm: hv.wallMm, lipMm: lip, lipAuto: hv.lipMm === "auto", topZ: zGt + lip, heightAboveBandMm: zGt + lip - rOut };
  } else {
    const hv = v.head;
    const rail = { offMm: hv.nominalProngMm / 2 - hv.gripMm, widthMm: Math.max(hv.nominalProngMm, 1.2) + 0.3, heightMm: Math.max(hv.nominalProngMm, 1.2) + 0.2 };
    head.rail = rail;
    const places = custom ? prongPlacesAround(shape.outline, hv.prongCount) : prongPlaces(stoneSpec(sv), shape.outline, hv.prongCount);
    const prongs = places.map((pl, i) => {
      const tk = hv.prongThicknessMm[i];
      const off = tk / 2 - hv.gripMm;
      const axis = [pl.at[0] + pl.out[0] * off, pl.at[1] + pl.out[1] * off];
      return {
        label: `prong ${i + 1} of ${hv.prongCount}`,
        clock: clockOf(axis[0], axis[1]),
        axis,
        thicknessMm: tk,
        narrowestMm: Math.min(tk, narrowestSection(axis, tk / 2, (x, y) => shape.outsideGirdle(SEAT_CLEARANCE, x, y))),
        reachMm: tk / 2 - off
      };
    });
    head.prongs = prongs;
    const railHalf = grownBy(rail.offMm + rail.widthMm / 2);
    let halfL = railHalf.lengthMm / 2, halfW = railHalf.widthMm / 2;
    for (const p of prongs) {
      const r = p.thicknessMm / 2;
      if (sv.shape === "round") {
        halfL = halfW = Math.max(halfL, Math.hypot(p.axis[0], p.axis[1]) + r);
      } else {
        const [along, across] = sv.orientation === "east_west" ? p.axis : [p.axis[1], p.axis[0]];
        halfL = Math.max(halfL, Math.abs(along) + r);
        halfW = Math.max(halfW, Math.abs(across) + r);
      }
    }
    head.outside = { lengthMm: 2 * halfL, widthMm: 2 * halfW };
  }
  dims.head = head;
  return dims;
}
function polygonsToMesh(m) {
  return meshOut(m.getMesh());
}
function meshOut(mesh) {
  const np = mesh.numProp;
  const nv = mesh.vertProperties.length / np;
  const positions = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    positions[i * 3] = mesh.vertProperties[i * np];
    positions[i * 3 + 1] = mesh.vertProperties[i * np + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * np + 2];
  }
  return { positions, triangles: new Uint32Array(mesh.triVerts) };
}
function buildBand(k, A, dims, profileName, tol) {
  const { Manifold, CrossSection } = k;
  const rIn = dims.band.innerDiameterMm / 2;
  const t = dims.band.thicknessMm;
  const rOut = dims.band.outerDiameterMm / 2;
  const w = dims.band.widthMm;
  const profile = bandProfile(profileName, rIn, t, w, tol);
  const nBand = segmentsFor(rOut, tol, 48);
  const band = A.t(A.t(Manifold.revolve(A.t(new CrossSection([profile])), nBand)).rotate([90, 0, 0]));
  return { band, decl: { innerRadius: rIn, outerRadius: rOut, halfWidth: w / 2 } };
}
function buildHead(k, A, v, dims, tol, shape, onBand) {
  const { Manifold, CrossSection } = k;
  if (!v.head || !dims.head) throw new Error("engine bug: a head was asked for a piece with none");
  const rIn = dims.band.innerDiameterMm / 2;
  const rOut = dims.band.outerDiameterMm / 2;
  const w = dims.band.widthMm;
  const hd = dims.head;
  const sv = v.head.stone;
  const zGb = hd.girdleBottomZ;
  const zGt = hd.girdleTopZ;
  const zTable = hd.tableZ;
  const decl = { stone: { outline: shape.outline, girdleBottomZ: zGb, girdleTopZ: zGt, crownHeight: hd.stone.crownMm }, prongs: [] };
  const stone = A.t(A.t(Manifold.hull(shape.points(0))).translate([0, 0, zGb]));
  const seatCut = A.t(A.t(Manifold.hull(shape.points(SEAT_CLEARANCE))).translate([0, 0, zGb]));
  let head;
  if (v.head.kind === "prong_head" && hd.prongs && hd.rail) {
    const railW = hd.rail.widthMm;
    const railH = hd.rail.heightMm;
    const railOff = hd.rail.offMm;
    const girdleCs = A.t(new CrossSection([shape.outline]));
    const ringSeg = segmentsFor(Math.max(sv.lengthMm, sv.widthMm) / 2 + railOff + railW, tol, 48);
    const railOuter = A.t(girdleCs.offset(railOff + railW / 2, "Round", 2, ringSeg));
    const railInner = A.t(girdleCs.offset(railOff - railW / 2, "Round", 2, ringSeg));
    const railCs = A.t(railOuter.subtract(railInner));
    const railMid = A.t(girdleCs.offset(railOff, "Round", 2, ringSeg)).toPolygons()[0];
    const xCross = Math.max(...crossingsX(railMid, w / 2));
    const zRail = Math.sqrt(Math.max(0, rOut * rOut - xCross * xCross));
    const parts = [A.t(A.t(Manifold.extrude(railCs, railH)).translate([0, 0, zRail - railH / 2]))];
    hd.prongs.forEach((pd) => {
      const tk = pd.thicknessMm;
      const [cx, cy] = pd.axis;
      const r = tk / 2;
      const colH = zTable - zRail;
      const arc = (u) => [r * Math.cos(u), colH + r * Math.sin(u)];
      const prof = [[0, 0], [r, 0], ...adaptive(arc, 0, Math.PI / 2, tol), [0, colH + r]];
      const col = A.t(Manifold.revolve(A.t(new CrossSection([dedupe(prof)])), segmentsFor(r, tol, 16)));
      parts.push(A.t(col.translate([cx, cy, zRail])));
      const prong = {
        label: pd.label,
        clock: pd.clock,
        axis: [cx, cy],
        nominalDiameter: tk,
        sectionFromZ: zRail + railH / 2 + 0.1,
        sectionToZ: zTable - 0.02
      };
      decl.prongs.push(prong);
    });
    head = A.t(A.t(Manifold.union(parts)).subtract(seatCut));
  } else if (v.head.kind === "bezel" && hd.bezel) {
    const c = hd.seat.clearanceMm;
    const zTop = hd.bezel.topZ;
    const girdleCs = A.t(new CrossSection([shape.outline]));
    const seg = segmentsFor(c + hd.bezel.wallMm, tol, 32);
    const outerCs = A.t(girdleCs.offset(c + hd.bezel.wallMm, "Round", 2, seg));
    const innerCs = A.t(girdleCs.offset(c, "Round", 2, segmentsFor(Math.max(c, 0.05), tol, 16)));
    const ledge = Math.min(0.4, 0.25 * Math.min(sv.lengthMm, sv.widthMm));
    const holeCs = A.t(girdleCs.offset(-ledge, "Round", 2, seg));
    const outerPts = outerCs.toPolygons()[0];
    const xExt = Math.max(...crossingsX(outerPts, w / 2), 0);
    const zBottom = Math.sqrt(Math.max(0, rOut * rOut - xExt * xExt)) - 0.3;
    const tube = A.t(A.t(Manifold.extrude(outerCs, zTop - zBottom)).translate([0, 0, zBottom]));
    const lipHole = A.t(A.t(Manifold.extrude(innerCs, zTop - zGb + 1)).translate([0, 0, zGb]));
    const backHole = A.t(A.t(Manifold.extrude(holeCs, zGb - zBottom + 2)).translate([0, 0, zBottom - 1]));
    head = A.t(A.t(A.t(tube.subtract(lipHole)).subtract(backHole)).subtract(seatCut));
    decl.bezel = { outer: outerPts, zBottom, nominalWall: hd.bezel.wallMm };
  } else {
    throw new Error(`engine bug: the head's dimensions do not match its kind (${v.head.kind})`);
  }
  if (onBand) {
    const nBand = segmentsFor(rOut, tol, 48);
    const finger = A.t(A.t(A.t(Manifold.cylinder(w + 40, rIn + 0.02, rIn + 0.02, nBand, true)).rotate([90, 0, 0])));
    head = A.t(head.subtract(finger));
  }
  return { head, stone, decl };
}
function finishMetal(A, solid, decl, blends, scale, withBlendSurface) {
  let metal = solid;
  if (scale !== 1) {
    metal = A.t(metal.scale(scale));
    scaleDecl(decl, scale);
  }
  decl.scale = scale;
  metal = atFilePrecision(A, metal);
  const status = metal.status();
  if (status !== "NoError") throw new Error(`the kernel reported ${status} while building the piece`);
  const bb = metal.boundingBox();
  const mesh = metal.getMesh();
  if (withBlendSurface && blends.length) decl.blends = blendSurface(mesh, blends, scale);
  return { mesh: meshOut(mesh), volumeMm3: metal.volume(), bbox: { min: [...bb.min], max: [...bb.max] } };
}
function atFilePrecision(A, m) {
  const snapped = A.t(
    m.warpBatch((v, count) => {
      for (let i = 0; i < count * 3; i++) v[i] = Math.fround(v[i]);
    })
  );
  return A.t(snapped.simplify());
}
function blendSurface(mesh, blends, scale) {
  const np = mesh.numProp, V = mesh.vertProperties, T = mesh.triVerts;
  const nv = V.length / np;
  const out = [];
  for (const b of blends) {
    const tris = [];
    for (let r = 0; r < mesh.runOriginalID.length; r++) {
      if (mesh.runOriginalID[r] !== b.originalID) continue;
      for (let t = mesh.runIndex[r] / 3; t < mesh.runIndex[r + 1] / 3; t++) tris.push(t);
    }
    if (!tris.length) continue;
    const m = b.m;
    const toLocal = (x, y, z) => {
      const dx = x / scale - m[3], dy = y / scale - m[7], dz = z / scale - m[11];
      return [m[0] * dx + m[4] * dy + m[8] * dz, m[1] * dx + m[5] * dy + m[9] * dz, m[2] * dx + m[6] * dy + m[10] * dz];
    };
    const dirLocal = (x, y, z) => [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
    const f = (x, y, z) => b.field.value(x, y, z);
    const seenVert = new Uint8Array(nv);
    const seenEdge = /* @__PURE__ */ new Set();
    const pts = new Float32Array(3 * 7 * tris.length);
    let n = 0;
    const at2 = (i) => [V[i * np], V[i * np + 1], V[i * np + 2]];
    const on = new Float64Array(3);
    const add = (x, y, z, nrm) => {
      projectOntoSurface(f, toLocal(x, y, z), nrm, on, 0);
      const q0 = on[0], q1 = on[1], q2 = on[2];
      pts[n * 3] = (m[0] * q0 + m[1] * q1 + m[2] * q2 + m[3]) * scale;
      pts[n * 3 + 1] = (m[4] * q0 + m[5] * q1 + m[6] * q2 + m[7]) * scale;
      pts[n * 3 + 2] = (m[8] * q0 + m[9] * q1 + m[10] * q2 + m[11]) * scale;
      n++;
    };
    for (const t of tris) {
      const ia = T[t * 3], ib = T[t * 3 + 1], ic = T[t * 3 + 2];
      const a = at2(ia), bb = at2(ib), c = at2(ic);
      const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (!(l > 0)) continue;
      const nrm = dirLocal(nx / l, ny / l, nz / l);
      for (const i of [ia, ib, ic]) {
        if (seenVert[i]) continue;
        seenVert[i] = 1;
        const p = at2(i);
        add(p[0], p[1], p[2], nrm);
      }
      for (const [i, j] of [
        [ia, ib],
        [ib, ic],
        [ic, ia]
      ]) {
        const lo = Math.min(i, j), hi = Math.max(i, j);
        const key = lo * nv + hi;
        if (seenEdge.has(key)) continue;
        seenEdge.add(key);
        const p = at2(lo), q = at2(hi);
        add((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, nrm);
      }
      add((a[0] + bb[0] + c[0]) / 3, (a[1] + bb[1] + c[1]) / 3, (a[2] + bb[2] + c[2]) / 3, nrm);
    }
    out.push({ label: b.label, points: pts.slice(0, n * 3) });
  }
  return out;
}
function crossingsX(poly, halfWidth) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    for (const yy of [-halfWidth, 0, halfWidth]) {
      if ((a[1] - yy) * (b[1] - yy) <= 0 && a[1] !== b[1]) {
        const s = (yy - a[1]) / (b[1] - a[1]);
        xs.push(Math.abs(a[0] + s * (b[0] - a[0])));
      }
    }
    if (Math.abs(a[1]) <= halfWidth) xs.push(Math.abs(a[0]));
  }
  return xs.length ? xs : [0];
}
function scaleDecl(d, s) {
  if (d.band) {
    d.band.innerRadius *= s;
    d.band.outerRadius *= s;
    d.band.halfWidth *= s;
  }
  for (const p of d.prongs) {
    p.axis = [p.axis[0] * s, p.axis[1] * s];
    p.nominalDiameter *= s;
    p.sectionFromZ *= s;
    p.sectionToZ *= s;
  }
  if (d.stone) {
    d.stone.outline = d.stone.outline.map(([x, y]) => [x * s, y * s]);
    d.stone.girdleBottomZ *= s;
    d.stone.girdleTopZ *= s;
    d.stone.crownHeight *= s;
  }
  if (d.bezel) {
    d.bezel.outer = d.bezel.outer.map(([x, y]) => [x * s, y * s]);
    d.bezel.zBottom *= s;
    d.bezel.nominalWall *= s;
  }
  for (const a of d.added ?? []) {
    a.min = [a.min[0] * s, a.min[1] * s, a.min[2] * s];
    a.max = [a.max[0] * s, a.max[1] * s, a.max[2] * s];
  }
  for (const sh of d.sheets ?? []) {
    sh.points = sh.points.map(([x, y, z]) => [x * s, y * s, z * s]);
    sh.nominalThickness *= s;
    sh.spacing *= s;
  }
}

// src/program/library.ts
var MAX_REACH_MM = 1e3;
var PROGRAM_CALLS = [
  // kernel: solids
  "sphere",
  "cylinder",
  "box",
  "torus",
  "sweep",
  "extrude",
  "revolve",
  "hull",
  "hullPoints",
  "union",
  "difference",
  "intersection",
  "smoothUnion",
  "op",
  "segments",
  // kernel: 2D profiles
  "circle",
  "rect",
  "polygon",
  // library
  "ringShank",
  "roundStone",
  "emeraldStone",
  "stone",
  "prongHead",
  "bezel",
  "thicken",
  // methods of a solid
  "translate",
  "rotate",
  "mirror",
  "scale",
  "named",
  "bounds",
  "volume",
  "slice",
  "project",
  "trim",
  // methods of a profile
  "p_offset",
  "p_add",
  "p_subtract",
  "p_intersect",
  "p_translate",
  "p_rotate",
  "p_scale",
  "p_mirror",
  "p_hull",
  "p_bounds",
  "p_area"
];
var emptyDecls = () => ({ prongs: [], sheets: [], blends: [], added: [] });
var NAME_ID = /^[a-z][a-z0-9_]{0,39}$/;
function fixed(x) {
  const s = x.toFixed(9).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}
var mmText = (x) => `${fixed(x)} mm`;
var degText = (x) => `${fixed(x)} deg`;
var applyPoint2 = (m, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]
];
var applyDir = (m, d) => [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[4] * d[0] + m[5] * d[1] + m[6] * d[2], m[8] * d[0] + m[9] * d[1] + m[10] * d[2]];
var tiny = (x) => Math.abs(x) < 1e-9;
var keepsUpright = (m) => tiny(m[2]) && tiny(m[6]) && tiny(m[8]) && tiny(m[9]) && Math.abs(m[10] - 1) < 1e-9;
var keepsFingerAxis = (m) => tiny(m[1]) && tiny(m[4]) && tiny(m[6]) && tiny(m[9]) && tiny(m[3]) && tiny(m[7]) && tiny(m[11]);
function ccw2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? [...pts].reverse() : pts;
}
var ProgramLibrary = class {
  #k;
  #A;
  #tol;
  #blendMeshes;
  #recs = [];
  #nextId = 0;
  constructor(k, A, tol, blendMeshes) {
    this.#k = k;
    this.#A = A;
    this.#tol = tol;
    this.#blendMeshes = blendMeshes;
  }
  /**
   * THE BRIDGE: a call by name, its arguments as JSON text; the answer as JSON text,
   * {"ok": value} or {"error": "what went wrong"}. It never throws, so no error object of
   * this realm can reach the program.
   */
  call(name, argsJson) {
    try {
      if (typeof name !== "string" || !PROGRAM_CALLS.includes(name)) throw new CallError(String(name), "is not something a program can call.");
      if (typeof argsJson !== "string" || argsJson.length > 2e7) throw new CallError(name, "its arguments are too large.");
      const args = JSON.parse(argsJson);
      if (!Array.isArray(args)) throw new CallError(name, "takes a list of arguments.");
      const out = this.#dispatch(name, args);
      return JSON.stringify({ ok: this.#encode(out) });
    } catch (e) {
      return JSON.stringify({ error: messageOf(e) });
    }
  }
  /** The solid a program returned, finished as a casting file would hold it. */
  finish(id, scale, withBlendSurface) {
    const rec = typeof id === "number" ? this.#recs[id] : void 0;
    if (!rec || rec.kind !== "solid") throw new CallError("program", 'must end by returning the piece: one solid, for example "return union(band, head);".');
    const d = rec.d;
    const decl = {
      prongs: d.prongs.map((p) => ({ ...p, axis: [...p.axis] })),
      scale: 1,
      ...d.band ? { band: { ...d.band } } : {},
      ...d.stone ? { stone: { ...d.stone, outline: d.stone.outline.map((q) => [...q]) } } : {},
      ...d.bezel ? { bezel: { ...d.bezel, outer: d.bezel.outer.map((q) => [...q]) } } : {},
      ...d.sheets.length ? { sheets: d.sheets.map((s) => ({ ...s, points: s.points.map((q) => [...q]), normals: s.normals.map((q) => [...q]) })) } : {},
      ...d.added.length ? { added: d.added.map((a) => ({ ...a, min: [...a.min], max: [...a.max] })) } : {}
    };
    const done = finishMetal(this.#A, rec.m, decl, d.blends, scale, withBlendSurface);
    for (const p of done.mesh.positions) {
      if (!(Math.abs(p) <= MAX_REACH_MM * Math.max(1, scale))) throw new CallError("program", `the piece reaches ${Math.round(Math.abs(p))} mm from the origin; a piece stays within ${MAX_REACH_MM} mm of it.`);
    }
    let stone;
    if (rec.stones.length) {
      const all = rec.stones.length === 1 ? rec.stones[0] : this.#A.t(this.#k.Manifold.union(rec.stones));
      stone = polygonsToMesh(scale !== 1 ? this.#A.t(all.scale(scale)) : all);
    }
    return { metal: done.mesh, ...stone ? { stone } : {}, decl, parts: rec.parts };
  }
  // ------------------------------------------------------------------ handles
  #add(r) {
    this.#recs.push(r);
    return this.#recs.length - 1;
  }
  #encode(v) {
    if (v && typeof v === "object" && "kind" in v) {
      const r = v;
      const id = this.#add(r);
      if (r.kind === "solid") return { $solid: id, ...r.dims !== void 0 ? { dims: r.dims } : {} };
      if (r.kind === "stone") return { $stone: id, dims: stoneDimsOf(r) };
      return { $profile: id };
    }
    return v;
  }
  #ref(v, path) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return void 0;
    const o = v;
    const id = o["$solid"] ?? o["$stone"] ?? o["$profile"];
    if (typeof id !== "number" || !Number.isInteger(id)) return void 0;
    const r = this.#recs[id];
    if (!r) throw new CallError(path, "is not something this program made.");
    return r;
  }
  #solid(v, path) {
    const r = this.#ref(v, path);
    if (r?.kind === "solid") return r;
    if (r?.kind === "stone") throw new CallError(path, "is a stone. A stone is never metal: hold it with prongHead or bezel.");
    if (r?.kind === "profile") throw new CallError(path, "is a 2D profile; make it a solid with extrude or revolve first.");
    throw new CallError(path, "must be a solid (a shape made by sphere, extrude, ringShank and so on).");
  }
  #profile(v, path) {
    const r = this.#ref(v, path);
    if (r?.kind === "profile") return r;
    throw new CallError(path, "must be a 2D profile (made by circle, rect or polygon).");
  }
  #stone(v, path) {
    const r = this.#ref(v, path);
    if (r?.kind === "stone") return r;
    throw new CallError(path, "must be a stone, made by roundStone, emeraldStone or stone().");
  }
  #id(prefix) {
    this.#nextId++;
    return `${prefix}_${this.#nextId}`;
  }
  #len(v, path, opts = {}) {
    const x = typeof v === "number" ? v : lengthMm(v, path);
    if (!Number.isFinite(x)) throw new CallError(path, "must be a finite number of millimetres.");
    if (Math.abs(x) > MAX_REACH_MM) throw new CallError(path, `${x} mm is more than a piece can be (${MAX_REACH_MM} mm).`);
    if (opts.positive && !(x > 0)) throw new CallError(path, "must be more than 0 mm.");
    if (opts.min !== void 0 && x < opts.min) throw new CallError(path, `must be at least ${opts.min} mm.`);
    return x;
  }
  #deg(v, path) {
    const x = typeof v === "number" ? v : angleDeg(v, path);
    if (!Number.isFinite(x)) throw new CallError(path, "must be a finite number of degrees.");
    return x;
  }
  /** A length as a tree takes it: a bare number is mm; a string keeps its own unit, to be read (and a foreign one refused) by the tree's checks. */
  #lenText(v, path) {
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new CallError(path, "must be a finite number of millimetres.");
      return mmText(v);
    }
    return v;
  }
  #vec3(v, path, unit = "mm") {
    if (!Array.isArray(v) || v.length !== 3) throw new CallError(path, `must be [x, y, z]${unit === "deg" ? " in degrees" : " in mm"}.`);
    return v.map((c, i) => unit === "deg" ? this.#deg(c, at(path, i)) : this.#len(c, at(path, i)));
  }
  /** [x, y, z] as one array, or as three numbers. */
  #vecArgs(args, from, path, unit = "mm") {
    const a = args[from];
    if (Array.isArray(a)) return this.#vec3(a, path, unit);
    const xyz = [args[from] ?? 0, args[from + 1] ?? 0, args[from + 2] ?? 0];
    return this.#vec3(xyz, path, unit);
  }
  #pts2(v, path, min = 3) {
    if (!Array.isArray(v) || v.length < min) throw new CallError(path, `a list of at least ${min} points, each [x, y] in mm.`);
    if (v.length > 2e5) throw new CallError(path, "has more points than a profile can.");
    return v.map((p, i) => {
      if (!Array.isArray(p) || p.length !== 2) throw new CallError(at(path, i), "a point is [x, y] in mm.");
      return [this.#len(p[0], at(at(path, i), 0)), this.#len(p[1], at(at(path, i), 1))];
    });
  }
  #pts3(v, path, min = 2) {
    if (!Array.isArray(v) || v.length < min) throw new CallError(path, `a list of at least ${min} points, each [x, y, z] in mm.`);
    if (v.length > 2e5) throw new CallError(path, "has more points than a path can.");
    return v.map((p, i) => this.#vec3(p, at(path, i)));
  }
  #opts(v, path, keys) {
    if (v === void 0) return {};
    if (v === null || typeof v !== "object" || Array.isArray(v) || this.#ref(v, path)) throw new CallError(path, `must be an object of settings: ${keys.join(", ")}.`);
    const o = v;
    for (const k of Object.keys(o)) if (!keys.includes(k)) throw new CallError(at(path, k), `is not a setting here; the settings are ${keys.join(", ")}.`);
    return o;
  }
  #newSolid(m, d = emptyDecls(), extra = {}) {
    return { kind: "solid", m: this.#A.t(m), d, stones: extra.stones ?? [], parts: extra.parts ?? [], ...extra.dims !== void 0 ? { dims: extra.dims } : {}, ...extra.node ? { node: extra.node } : {} };
  }
  /** A tree operation node, built by the tree's own buildOp, with the sheets and blends it declares. */
  #fromNode(node, path, addedAs) {
    validateOpNode(node, path);
    const sheets = [];
    const blends = [];
    const ctx = { m: IDENTITY, sheets, blends, moveReachMm: MAX_REACH_MM, ...this.#blendMeshes ? { blendMeshes: this.#blendMeshes } : {} };
    const m = buildOp(this.#k, this.#A, node, this.#tol, ctx);
    const d = emptyDecls();
    d.sheets = sheets;
    d.blends = blends;
    if (addedAs) {
      const bb = m.boundingBox();
      d.added.push({ id: addedAs, min: [...bb.min], max: [...bb.max] });
    }
    return this.#newSolid(m, d, { node });
  }
  // --------------------------------------------------------------- dispatch
  #dispatch(name, a) {
    const { Manifold, CrossSection } = this.#k;
    const A = this.#A;
    const tol = this.#tol;
    switch (name) {
      // ---------------------------------------------------------- solids
      case "sphere":
        return this.#fromNode({ id: this.#id("sphere"), op: "sphere", params: { radius: mmText(this.#len(a[0], "sphere.radius", { positive: true })) } }, "sphere");
      case "cylinder": {
        const r = this.#len(a[0], "cylinder.radius", { positive: true });
        const h = this.#len(a[1], "cylinder.height", { positive: true });
        const o = this.#opts(a[2], "cylinder.options", ["top", "center"]);
        const top = o["top"] === void 0 ? r : this.#len(o["top"], "cylinder.options.top", { min: 0 });
        const center = o["center"] === true;
        if (top !== r) {
          return this.#newSolid(Manifold.cylinder(h, r, top, segmentsFor(Math.max(r, top), tol, 16), center));
        }
        const node = { id: this.#id("cylinder"), op: "cylinder", params: { radius: mmText(r), height: mmText(h) } };
        return this.#fromNode(center ? { id: this.#id("move"), op: "translate", params: { z: mmText(-h / 2) }, children: [node] } : node, "cylinder");
      }
      case "box": {
        const v = this.#vecArgs(a, 0, "box");
        if (!v.every((x) => x > 0)) throw new CallError("box", "each side must be more than 0 mm.");
        return this.#fromNode({ id: this.#id("box"), op: "box", params: { x: mmText(v[0]), y: mmText(v[1]), z: mmText(v[2]) } }, "box");
      }
      case "torus": {
        const R = this.#len(a[0], "torus.major_radius", { positive: true });
        const r = this.#len(a[1], "torus.minor_radius", { positive: true });
        return this.#fromNode({ id: this.#id("torus"), op: "torus", params: { major_radius: mmText(R), minor_radius: mmText(r) } }, "torus");
      }
      case "sweep": {
        const r = this.#len(a[0], "sweep.radius", { positive: true });
        const path = this.#pts3(a[1], "sweep.path");
        const o = this.#opts(a[2], "sweep.options", ["closed"]);
        return this.#fromNode(
          { id: this.#id("wire"), op: "sweep", params: { radius: mmText(r), path: path.map((p) => p.map(mmText)), ...o["closed"] === true ? { closed: true } : {} } },
          "sweep"
        );
      }
      case "extrude": {
        const p = this.#profile(a[0], "extrude.profile");
        const h = this.#len(a[1], "extrude.height", { positive: true });
        const o = this.#opts(a[2], "extrude.options", ["twist", "scale_top", "center"]);
        const twist = o["twist"] === void 0 ? 0 : this.#deg(o["twist"], "extrude.options.twist");
        const top = o["scale_top"] === void 0 ? void 0 : typeof o["scale_top"] === "number" ? o["scale_top"] : (() => {
          throw new CallError("extrude.options.scale_top", "a number, how much the top is scaled (1 keeps it).");
        })();
        if (top !== void 0 && !(top >= 0 && top <= 100)) throw new CallError("extrude.options.scale_top", "between 0 and 100.");
        const bb = p.cs.bounds();
        const rMax = Math.max(...[bb.min[0], bb.max[0]].flatMap((x) => [bb.min[1], bb.max[1]].map((y) => Math.hypot(x, y))));
        const div = twist ? Math.max(1, Math.ceil(Math.abs(twist) / 360 * segmentsFor(rMax, tol, 16))) : 0;
        return this.#newSolid(Manifold.extrude(p.cs, h, div, twist, top, o["center"] === true));
      }
      case "revolve": {
        const p = this.#profile(a[0], "revolve.profile");
        const o = this.#opts(a[1], "revolve.options", ["degrees"]);
        const deg = o["degrees"] === void 0 ? 360 : this.#deg(o["degrees"], "revolve.options.degrees");
        const bb = p.cs.bounds();
        if (bb.min[0] < -1e-9) throw new CallError("revolve.profile", `reaches x = ${fixed(bb.min[0])} mm; a revolved profile lies at x >= 0 (x is the distance from the z axis, y the height).`);
        return this.#newSolid(Manifold.revolve(p.cs, segmentsFor(Math.max(bb.max[0], tol), tol, 32), deg));
      }
      case "hull": {
        if (!a.length) throw new CallError("hull", "give the solids to wrap, e.g. hull(a, b).");
        const ms = a.map((s, i) => this.#plain(this.#solid(s, at("hull", i)), "hull", "wrap it in one convex shape").m);
        return this.#newSolid(Manifold.hull(ms));
      }
      case "hullPoints": {
        const pts = this.#pts3(a[0], "hullPoints.points", 4);
        return this.#newSolid(Manifold.hull(pts));
      }
      case "union":
      case "intersection": {
        if (!a.length) throw new CallError(name, "give at least one solid.");
        const rs = a.map((s, i) => this.#solid(s, at(name, i)));
        if (rs.length === 1) return rs[0];
        const m = name === "union" ? Manifold.union(rs.map((r) => r.m)) : Manifold.intersection(rs.map((r) => r.m));
        const d = mergeDecls(rs.map((r) => r.d), name);
        const node = name === "union" && rs.every((r) => r.node) ? { id: this.#id("union"), op: "union", children: rs.map((r) => r.node) } : void 0;
        return this.#newSolid(m, d, { stones: rs.flatMap((r) => r.stones), parts: rs.flatMap((r) => r.parts), ...node ? { node } : {} });
      }
      case "difference": {
        if (!a.length) throw new CallError("difference", "give the solid to cut from, then the solids to cut away.");
        const keep = this.#solid(a[0], "difference[0]");
        const cut = a.slice(1).map((s, i) => this.#solid(s, at("difference", i + 1)));
        if (!cut.length) return keep;
        const cutter = cut.length === 1 ? cut[0].m : A.t(Manifold.union(cut.map((r) => r.m)));
        const d = { ...keep.d, prongs: [...keep.d.prongs], sheets: [...keep.d.sheets], added: [...keep.d.added], blends: [...keep.d.blends, ...cut.flatMap((r) => r.d.blends)] };
        return this.#newSolid(keep.m.subtract(cutter), d, { stones: keep.stones, parts: keep.parts });
      }
      case "smoothUnion": {
        const radius = this.#len(a[0], "smoothUnion.radius", { positive: true });
        let rest = a.slice(1);
        let label;
        const last = rest[rest.length - 1];
        if (last && typeof last === "object" && !Array.isArray(last) && !this.#ref(last, "smoothUnion")) {
          const o = this.#opts(last, "smoothUnion.options", ["name"]);
          if (o["name"] !== void 0) label = nameId(o["name"], "smoothUnion.options.name");
          rest = rest.slice(0, -1);
        }
        if (rest.length < 1) throw new CallError("smoothUnion", "give the radius, then the solids to blend.");
        const rs = rest.map((s, i) => this.#solid(s, at("smoothUnion", i + 1)));
        rs.forEach((r, i) => {
          if (!r.node) {
            throw new CallError(at("smoothUnion", i + 1), "a smooth blend takes spheres, cylinders, boxes, tori, swept wires, their moves and unions, and other blends: shapes with a distance from their surface. Blend those, then add or cut the rest.");
          }
        });
        const node = { id: label ?? this.#id("blend"), op: "smooth_union", params: { radius: mmText(radius) }, children: rs.map((r) => r.node) };
        return this.#fromNode(node, "smoothUnion");
      }
      case "op": {
        const node = validateOpNode(a[0], "op");
        return this.#fromNode(node, "op", node.id);
      }
      case "segments":
        return segmentsFor(this.#len(a[0], "segments.radius", { positive: true }), tol, 12);
      // ------------------------------------------------------- 2D profiles
      case "circle": {
        const r = this.#len(a[0], "circle.radius", { positive: true });
        return { kind: "profile", cs: A.t(CrossSection.circle(r, segmentsFor(r, tol, 16))) };
      }
      case "rect": {
        const x = this.#len(a[0], "rect.x", { positive: true });
        const y = this.#len(a[1], "rect.y", { positive: true });
        const o = this.#opts(a[2], "rect.options", ["center"]);
        return { kind: "profile", cs: A.t(CrossSection.square([x, y], o["center"] !== false)) };
      }
      case "polygon":
        return { kind: "profile", cs: A.t(new CrossSection([ccw2(this.#pts2(a[0], "polygon.points"))])) };
      case "p_offset": {
        const p = this.#profile(a[0], "offset");
        const d = this.#len(a[1], "offset.distance");
        const o = this.#opts(a[2], "offset.options", ["join"]);
        const join2 = o["join"] ?? "round";
        const J = { round: "Round", square: "Square", miter: "Miter" };
        if (!(typeof join2 === "string" && join2 in J)) throw new CallError("offset.options.join", 'is "round", "square" or "miter".');
        return { kind: "profile", cs: A.t(p.cs.offset(d, J[join2], 2, segmentsFor(Math.max(Math.abs(d), tol), tol, 16))) };
      }
      case "p_add":
      case "p_subtract":
      case "p_intersect": {
        const p = this.#profile(a[0], name.slice(2));
        const q = this.#profile(a[1], `${name.slice(2)}[1]`);
        const cs = name === "p_add" ? p.cs.add(q.cs) : name === "p_subtract" ? p.cs.subtract(q.cs) : p.cs.intersect(q.cs);
        return { kind: "profile", cs: A.t(cs) };
      }
      case "p_translate": {
        const p = this.#profile(a[0], "translate");
        const v = Array.isArray(a[1]) ? a[1] : [a[1] ?? 0, a[2] ?? 0];
        if (v.length !== 2) throw new CallError("translate", "a 2D profile moves by [x, y] in mm.");
        return { kind: "profile", cs: A.t(p.cs.translate([this.#len(v[0], "translate.x"), this.#len(v[1], "translate.y")])) };
      }
      case "p_rotate":
        return { kind: "profile", cs: A.t(this.#profile(a[0], "rotate").cs.rotate(this.#deg(a[1], "rotate.degrees"))) };
      case "p_scale": {
        const p = this.#profile(a[0], "scale");
        const s = Array.isArray(a[1]) ? a[1] : [a[1], a[1]];
        if (s.length !== 2 || !s.every((x) => typeof x === "number" && Number.isFinite(x) && x > 0 && x < 1e3)) throw new CallError("scale", "a factor, or [x, y] factors, each more than 0.");
        return { kind: "profile", cs: A.t(p.cs.scale(s)) };
      }
      case "p_mirror": {
        const p = this.#profile(a[0], "mirror");
        const n = a[1];
        if (!Array.isArray(n) || n.length !== 2 || !n.every((x) => typeof x === "number" && Number.isFinite(x)) || Math.hypot(n[0], n[1]) < 1e-9) throw new CallError("mirror", "a 2D profile mirrors across the line square to [x, y].");
        return { kind: "profile", cs: A.t(p.cs.mirror(n)) };
      }
      case "p_hull":
        return { kind: "profile", cs: A.t(this.#profile(a[0], "hull").cs.hull()) };
      case "p_bounds": {
        const b = this.#profile(a[0], "bounds").cs.bounds();
        return { min: [b.min[0], b.min[1]], max: [b.max[0], b.max[1]] };
      }
      case "p_area":
        return this.#profile(a[0], "area").cs.area();
      // ---------------------------------------------------- moves and reads
      case "translate": {
        const r = this.#solid(a[0], "translate");
        const v = this.#vecArgs(a, 1, "translate");
        return this.#moved(r, translation(v[0], v[1], v[2]), `translate([${v.map(fixed).join(", ")}])`, (m) => m.translate(v), (n) => ({ id: this.#id("move"), op: "translate", params: { x: mmText(v[0]), y: mmText(v[1]), z: mmText(v[2]) }, children: [n] }));
      }
      case "rotate": {
        const r = this.#solid(a[0], "rotate");
        const v = this.#vecArgs(a, 1, "rotate", "deg");
        return this.#moved(r, rotation(v[0], v[1], v[2]), `rotate([${v.map(fixed).join(", ")}])`, (m) => m.rotate(v), (n) => ({ id: this.#id("turn"), op: "rotate", params: { x: degText(v[0]), y: degText(v[1]), z: degText(v[2]) }, children: [n] }));
      }
      case "mirror": {
        const r = this.#solid(a[0], "mirror");
        const PLANES = { xy: [0, 0, 1], yz: [1, 0, 0], xz: [0, 1, 0] };
        let plane;
        let n;
        if (typeof a[1] === "string") {
          plane = a[1];
          if (!(plane in PLANES)) throw new CallError("mirror", 'reflects through the plane "xy", "yz" or "xz", or the plane square to [x, y, z].');
          n = PLANES[plane];
        } else {
          const v = this.#vec3(a[1], "mirror.normal");
          const l = Math.hypot(...v);
          if (l < 1e-9) throw new CallError("mirror.normal", "must not be [0, 0, 0].");
          n = [v[0] / l, v[1] / l, v[2] / l];
        }
        return this.#moved(r, reflection(n), plane ? `mirror("${plane}")` : "mirror", (m) => m.mirror(n), plane ? (c) => ({ id: this.#id("mirror"), op: "mirror", params: { plane }, children: [c] }) : void 0);
      }
      case "scale": {
        const r = this.#solid(a[0], "scale");
        const s = Array.isArray(a[1]) ? a[1] : [a[1], a[1], a[1]];
        if (s.length !== 3 || !s.every((x) => typeof x === "number" && Number.isFinite(x) && x > 0 && x < 1e3)) throw new CallError("scale", "a factor, or [x, y, z] factors, each more than 0.");
        this.#plain(r, "scale", "change the size it was built to and is checked against; build it at the size you want instead", true);
        const d = { ...emptyDecls(), added: r.d.added.map((b) => boxThrough(b, [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0])) };
        return this.#newSolid(r.m.scale(s), d);
      }
      case "named": {
        const r = this.#solid(a[0], "named");
        const id = nameId(a[1], "named.name");
        const bb = r.m.boundingBox();
        return { ...r, d: { ...r.d, added: [...r.d.added, { id, min: [...bb.min], max: [...bb.max] }] } };
      }
      case "bounds": {
        const b = this.#solid(a[0], "bounds").m.boundingBox();
        return { min: [...b.min], max: [...b.max] };
      }
      case "volume":
        return this.#solid(a[0], "volume").m.volume();
      case "slice":
        return { kind: "profile", cs: A.t(this.#solid(a[0], "slice").m.slice(this.#len(a[1], "slice.height"))) };
      case "project":
        return { kind: "profile", cs: A.t(this.#solid(a[0], "project").m.project()) };
      case "trim": {
        const r = this.#solid(a[0], "trim");
        const n = this.#vec3(a[1], "trim.normal");
        if (Math.hypot(...n) < 1e-9) throw new CallError("trim.normal", "must not be [0, 0, 0].");
        const off = this.#len(a[2] ?? 0, "trim.offset");
        return { ...r, node: void 0, m: A.t(r.m.trimByPlane(n, off)) };
      }
      // --------------------------------------------------------- the library
      case "ringShank":
        return this.#ringShank(a[0]);
      case "roundStone":
      case "emeraldStone":
        return this.#cutStone(name, a[0]);
      case "stone":
        return this.#ownStone(a[0], a[1]);
      case "prongHead":
      case "bezel":
        return this.#head(name, a[0]);
      case "thicken": {
        const o = this.#opts(a[0], "thicken", ["id", "outline", "thickness", "surface", "radius", "axis", "round_corners"]);
        const id = o["id"] === void 0 ? this.#id("sheet") : nameId(o["id"], "thicken.id");
        const outline = this.#pts2(o["outline"], "thicken.outline");
        const params = { outline: outline.map((p) => p.map(mmText)), thickness: this.#lenText(o["thickness"], "thicken.thickness") };
        for (const k of ["radius", "round_corners"]) if (o[k] !== void 0) params[k] = this.#lenText(o[k], `thicken.${k}`);
        for (const k of ["surface", "axis"]) if (o[k] !== void 0) params[k] = o[k];
        return this.#fromNode({ id, op: "thicken", params }, "thicken", id);
      }
    }
  }
  /** Refuses a solid that carries a part's declarations (or a stone) for an operation that would undo them. */
  #plain(r, what, why, allowAdded = false) {
    const d = r.d;
    const parts = [d.band && "a ring band (ringShank)", (d.stone || d.prongs.length || d.bezel) && "a stone setting (prongHead or bezel)", d.sheets.length && `a sheet (thicken "${d.sheets[0].label}")`, d.blends.length && `a smooth blend ("${d.blends[0].label}")`, !allowAdded && d.added.length && `the named shape "${d.added[0].id}"`].filter(Boolean);
    if (parts.length) throw new CallError(what, `this solid holds ${parts.join(" and ")}; ${what} would ${why}. Do the ${what} on plain shapes, then join the parts to them.`);
    return r;
  }
  /** A rigid move (translate, rotate, mirror) of a solid and everything it declares, or a refusal naming the part it would carry out of the checker's frame. */
  #moved(r, M, how, kernelMove, wrap) {
    const d = r.d;
    if (d.band && !keepsFingerAxis(M)) {
      throw new CallError(how, "would move the ring band off the finger's axis (the y axis through the origin), where the casting checker measures a band from ringShank. Turn it only about y, or move the other shapes to the ring instead.");
    }
    if ((d.stone || d.prongs.length || d.bezel) && !keepsUpright(M)) {
      throw new CallError(how, "would tip the stone setting off upright. The casting checker measures prongs, a bezel and a stone's seat upright (along z): move the setting anywhere, and turn it only about z.");
    }
    const det = M[0] * M[5] - M[1] * M[4];
    const xy = (p) => [M[0] * p[0] + M[1] * p[1] + M[3], M[4] * p[0] + M[5] * p[1] + M[7]];
    const ring = (pts) => {
      const out = pts.map(xy);
      return det < 0 ? out.reverse() : out;
    };
    const tz = M[11];
    const nd = {
      ...d.band ? { band: { ...d.band } } : {},
      ...d.stone ? { stone: { ...d.stone, outline: ring(d.stone.outline), girdleBottomZ: d.stone.girdleBottomZ + tz, girdleTopZ: d.stone.girdleTopZ + tz } } : {},
      prongs: d.prongs.map((p) => {
        const axis = xy(p.axis);
        return { ...p, axis, clock: clockOf(axis[0], axis[1]), sectionFromZ: p.sectionFromZ + tz, sectionToZ: p.sectionToZ + tz };
      }),
      ...d.bezel ? { bezel: { ...d.bezel, outer: ring(d.bezel.outer), zBottom: d.bezel.zBottom + tz } } : {},
      sheets: d.sheets.map((s) => ({ ...s, points: s.points.map((p) => applyPoint2(M, p)), normals: s.normals.map((n) => applyDir(M, n)) })),
      blends: d.blends.map((b) => ({ ...b, m: compose(M, b.m) })),
      added: d.added.map((b) => boxThrough(b, M))
    };
    const A = this.#A;
    return {
      kind: "solid",
      m: A.t(kernelMove(r.m)),
      d: nd,
      stones: r.stones.map((s) => A.t(kernelMove(s))),
      parts: r.parts,
      ...r.dims !== void 0 ? { dims: r.dims } : {},
      ...r.node && wrap ? { node: wrap(r.node) } : {}
    };
  }
  // --------------------------------------------------------------- the parts
  #ringShank(arg) {
    const o = this.#opts(arg, "ringShank", ["ring_size", "band_width", "band_thickness", "band_profile"]);
    if (o["ring_size"] === void 0) throw new CallError("ringShank.ring_size", 'give the finger size with its system, for example {"system": "US", "size": "7"}.');
    const profile = o["band_profile"] ?? PARAM_BY_KEY.get("band_profile").default;
    checkParam(PARAM_BY_KEY.get("band_profile"), profile, "ringShank.band_profile");
    const dflt = bandDefaults(profile);
    const width = this.#lenText(o["band_width"] ?? dflt.width, "ringShank.band_width");
    const thickness = this.#lenText(o["band_thickness"] ?? dflt.thickness, "ringShank.band_thickness");
    checkParam(PARAM_BY_KEY.get("ring_size"), o["ring_size"], "ringShank.ring_size");
    checkParam(PARAM_BY_KEY.get("band_width"), width, "ringShank.band_width");
    checkParam(PARAM_BY_KEY.get("band_thickness"), thickness, "ringShank.band_thickness");
    const { size, diameterMm } = ringInnerDiameterMm(o["ring_size"], "ringShank.ring_size");
    const v = {
      ringSize: size,
      innerDiameterMm: diameterMm,
      bandWidthMm: lengthMm(width, "ringShank.band_width"),
      bandThicknessMm: lengthMm(thickness, "ringShank.band_thickness"),
      profile,
      metal: "sterling_silver_925",
      shrinkagePct: 0,
      extras: []
    };
    const dims = pieceDims(v);
    const b = buildBand(this.#k, this.#A, dims, profile, this.#tol);
    const d = emptyDecls();
    d.band = b.decl;
    const ringSize = { system: size.system, size: String(size.size) };
    return this.#newSolid(b.band, d, { parts: [{ call: "ringShank", ringSize, band: dims.band }], dims: { ...dims.band, ringSize } });
  }
  #cutStone(name, arg) {
    const round2 = name === "roundStone";
    const o = this.#opts(arg, name, round2 ? ["diameter", "depth", "carat"] : ["length", "width", "depth", "orientation", "carat"]);
    const need = round2 ? ["diameter", "depth"] : ["length", "width", "depth"];
    for (const k of need) if (o[k] === void 0) throw new CallError(at(name, k), `give the stone's measured ${k} from its grading report, e.g. "${k === "depth" ? "4.0" : "6.5"} mm".`);
    const s = { shape: round2 ? "round" : "emerald" };
    for (const k of need) s[k] = this.#lenText(o[k], at(name, k));
    if (round2) checkParam(PARAM_BY_KEY.get("stone_diameter"), s["diameter"], at(name, "diameter"));
    else {
      checkParam(PARAM_BY_KEY.get("stone_length"), s["length"], at(name, "length"));
      checkParam(PARAM_BY_KEY.get("stone_width"), s["width"], at(name, "width"));
      if (lengthMm(s["width"], "width") > lengthMm(s["length"], "length")) throw new CallError(at(name, "width"), "the width is the SHORT side of an emerald cut; it cannot be more than its length.");
      s["orientation"] = o["orientation"] ?? "east_west";
      checkParam(PARAM_BY_KEY.get("stone_orientation"), s["orientation"], at(name, "orientation"));
    }
    checkParam(PARAM_BY_KEY.get("stone_depth"), s["depth"], at(name, "depth"));
    if (o["carat"] !== void 0) s["carat"] = caratText(o["carat"], at(name, "carat"));
    const view = stoneView(s);
    const shape = stoneShape({ shape: view.shape, lengthMm: view.lengthMm, widthMm: view.widthMm, depthMm: view.depthMm, orientation: view.orientation }, this.#tol);
    return { kind: "stone", view, shape, custom: false };
  }
  /**
   * A stone of the program's own shape (a cabochon, a pear): never metal. Seen from above,
   * its girdle is the convex hull of its outline; the girdle runs where its slices are
   * widest, the crown above and the pavilion below. It is
   * moved so its outline is centred on the z axis and its girdle's bottom is at z = 0,
   * as the library's own stones are, and a setting places it from there.
   */
  #ownStone(solidArg, optsArg) {
    const r = this.#plain(this.#solid(solidArg, "stone"), "stone", "turn metal into a stone");
    const o = this.#opts(optsArg, "stone.options", ["name"]);
    const name = o["name"] === void 0 ? void 0 : nameId(o["name"], "stone.options.name");
    const A = this.#A;
    const bb = r.m.boundingBox();
    const zMin = bb.min[2], zMax = bb.max[2];
    if (!(zMax - zMin > 0.2)) throw new CallError("stone", "the stone is less than 0.2 mm deep.");
    const proj = A.t(A.t(r.m.project()).hull());
    const polys = proj.toPolygons();
    const outline0 = polys.sort((p, q) => Math.abs(area2(q)) - Math.abs(area2(p)))[0];
    if (!outline0 || outline0.length < 3) throw new CallError("stone", "the stone has no outline seen from above.");
    const ob = proj.bounds();
    const cx = (ob.min[0] + ob.max[0]) / 2, cy = (ob.min[1] + ob.max[1]) / 2;
    const L3 = ob.max[0] - ob.min[0], W = ob.max[1] - ob.min[1];
    if (Math.min(L3, W) < 1 || Math.max(L3, W) > 30) throw new CallError("stone", `the stone is ${fixed(L3)} \xD7 ${fixed(W)} mm seen from above; the library sets stones 1 to 30 mm across.`);
    const outline = ccw2(outline0.map(([x, y]) => [x - cx, y - cy]));
    const N = 96;
    const areas = Array.from({ length: N }, (_, i) => {
      const z = zMin + (i + 0.5) * (zMax - zMin) / N;
      return A.t(r.m.slice(z)).area();
    });
    const amax = Math.max(...areas);
    const wide = areas.map((x, i) => x >= (1 - 1e-4) * amax ? i : -1).filter((i) => i >= 0);
    const lo = wide[0], hi = wide[wide.length - 1];
    const at2 = (i) => i === 0 ? zMin : i === N - 1 ? zMax : zMin + (i + 0.5) * (zMax - zMin) / N;
    const zGb = at2(lo);
    const zGt = lo === hi ? zGb : at2(hi);
    const pavilion = zGb - zMin, girdle = zGt - zGb, crown = zMax - zGt;
    if (!(crown > 0.05)) throw new CallError("stone", "the stone has no crown above its widest place; a setting holds a stone over its crown.");
    const mesh = A.t(r.m.hull()).getMesh();
    const verts = [];
    for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) verts.push([mesh.vertProperties[i] - cx, mesh.vertProperties[i + 1] - cy, mesh.vertProperties[i + 2] - zGb]);
    const mid = [0, 0, (zMax + zMin) / 2 - zGb];
    const grown = /* @__PURE__ */ new Map();
    const grownOutline = (c) => {
      let g = grown.get(c);
      if (!g) {
        const cs = A.t(A.t(new this.#k.CrossSection([outline])).offset(c, "Round", 2, segmentsFor(Math.max(c, 0.01), this.#tol, 16)));
        g = ccw2(cs.toPolygons()[0] ?? outline);
        grown.set(c, g);
      }
      return g;
    };
    const shape = {
      outline,
      girdle,
      crown,
      pavilion,
      points(c) {
        if (c === 0) return verts;
        return verts.map((p) => {
          const dx = p[0] - mid[0], dy = p[1] - mid[1], dz = p[2] - mid[2];
          const l = Math.hypot(dx, dy, dz) || 1;
          return [p[0] + c * dx / l, p[1] + c * dy / l, p[2] + c * dz / l];
        });
      },
      outsideGirdle(c, x, y) {
        return outsideConvex(grownOutline(c), x, y);
      }
    };
    const view = { shape: "custom", lengthMm: L3, widthMm: W, depthMm: zMax - zMin, orientation: "east_west", placeholder: [] };
    return { kind: "stone", view, shape, custom: true, ...name ? { name } : {} };
  }
  #head(name, arg) {
    const kind = name === "prongHead" ? "prong_head" : "bezel";
    const keys = kind === "prong_head" ? ["stone", "on", "prong_count", "prong_thickness", "prong_grip", "culet_clearance", "prong_overrides"] : ["stone", "on", "wall", "lip", "culet_clearance"];
    const o = this.#opts(arg, name, keys);
    if (o["stone"] === void 0) throw new CallError(at(name, "stone"), "give the stone it holds: roundStone({...}), emeraldStone({...}) or stone(yourShape).");
    const st = this.#stone(o["stone"], at(name, "stone"));
    let band = null;
    let ringSize = { system: "US", size: "7" };
    if (o["on"] !== void 0) {
      const on = this.#solid(o["on"], at(name, "on"));
      const shank = on.parts.find((p2) => p2.call === "ringShank");
      if (!shank || !on.d.band) throw new CallError(at(name, "on"), "is the ring shank the setting sits on: a solid from ringShank (or one holding it).");
      band = shank.band;
      ringSize = { system: shank.ringSize.system, size: shank.ringSize.size };
    }
    const p = { culet_clearance: this.#lenText(o["culet_clearance"] ?? HEAD_DEFAULTS.culet_clearance, at(name, "culet_clearance")) };
    if (kind === "prong_head") {
      p["prong_count"] = o["prong_count"] ?? PARAM_BY_KEY.get("prong_count").default;
      p["prong_thickness"] = this.#lenText(o["prong_thickness"] ?? PARAM_BY_KEY.get("prong_thickness").default, at(name, "prong_thickness"));
      p["prong_grip"] = this.#lenText(o["prong_grip"] ?? HEAD_DEFAULTS.prong_grip, at(name, "prong_grip"));
      const ov = o["prong_overrides"] ?? [];
      p["prong_overrides"] = Array.isArray(ov) ? ov.map((x, i) => x && typeof x === "object" && !Array.isArray(x) ? { ...x, ..."thickness" in x ? { thickness: this.#lenText(x["thickness"], at(at(at(name, "prong_overrides"), i), "thickness")) } : {} } : x) : ov;
    } else {
      p["wall"] = this.#lenText(o["wall"] ?? PARAM_BY_KEY.get("bezel_wall").default, at(name, "wall"));
      p["lip"] = o["lip"] === void 0 || o["lip"] === "auto" ? "auto" : this.#lenText(o["lip"], at(name, "lip"));
    }
    checkHeadSettings(kind, p, name);
    const v = {
      ringSize,
      innerDiameterMm: band ? band.innerDiameterMm : 0,
      bandWidthMm: band ? band.widthMm : 0,
      bandThicknessMm: band ? band.thicknessMm : 0,
      profile: "flat",
      metal: "sterling_silver_925",
      shrinkagePct: 0,
      extras: [],
      head: headView(kind, p, st.view)
    };
    const dims = pieceDims(v, st.custom ? st.shape : void 0);
    const h = buildHead(this.#k, this.#A, v, dims, this.#tol, st.shape, band !== null);
    const d = emptyDecls();
    d.stone = h.decl.stone;
    d.prongs = h.decl.prongs;
    if (h.decl.bezel) d.bezel = h.decl.bezel;
    const report = { call: name, onBand: band, head: dims.head, stone: { shape: st.view.shape, ...st.name ? { name: st.name } : {} } };
    return this.#newSolid(h.head, d, { stones: [this.#A.t(h.stone)], parts: [report], dims: dims.head });
  }
};
function area2(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i], r = p[(i + 1) % p.length];
    a += q[0] * r[1] - r[0] * q[1];
  }
  return a;
}
function nameId(v, path) {
  if (typeof v !== "string" || !NAME_ID.test(v)) throw new CallError(path, 'a name is lower-case letters, digits and "_", starting with a letter, for example "petal_1".');
  return v;
}
function stoneDimsOf(r) {
  return { shape: r.view.shape, lengthMm: r.view.lengthMm, widthMm: r.view.widthMm, depthMm: r.view.depthMm, girdleMm: r.shape.girdle, crownMm: r.shape.crown, pavilionMm: r.shape.pavilion };
}
function boxThrough(b, M) {
  const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => applyPoint2(M, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]));
  return { id: b.id, min: [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))), max: [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]))) };
}
function mergeDecls(ds, how) {
  const out = emptyDecls();
  for (const d of ds) {
    if (d.band) {
      if (out.band) throw new CallError(how, "two of these solids each hold a ring band from ringShank. A piece has one band the checker measures; build any second band yourself (revolve a profile).");
      out.band = d.band;
    }
    if (d.stone) {
      if (out.stone) throw new CallError(how, "two of these solids each hold a stone setting (prongHead or bezel). The casting checker measures one stone setting a piece for now; build any other setting yourself from the kernel.");
      out.stone = d.stone;
      if (d.bezel) out.bezel = d.bezel;
    }
    out.prongs.push(...d.prongs);
    out.sheets.push(...d.sheets);
    out.blends.push(...d.blends);
    out.added.push(...d.added);
  }
  return out;
}
function messageOf(e) {
  if (e instanceof CallError) return `${e.path}: ${e.problem}`;
  if (e instanceof RangeError && /call stack/i.test(e.message)) return "the program called too deeply (the stack ran out).";
  if (e instanceof Error) {
    if (/abort|out of memory|memory access out of bounds|OOM/i.test(e.message)) return `the geometry kernel failed (${e.message.slice(0, 200)}); most often it ran out of memory.`;
    return e.message.slice(0, 500);
  }
  return String(e).slice(0, 500);
}

// src/program/prelude.ts
var PRELUDE_FILENAME = "flo2-cad-library.js";
var PROGRAM_FILENAME = "program.js";
var PRELUDE = String.raw`(function (bridge) {
  'use strict';
  const G = globalThis;
  const stringify = JSON.stringify, parse = JSON.parse;
  const freeze = Object.freeze, keys = Object.keys, define = Object.defineProperty, isArray = Array.isArray;
  const apply = Reflect.apply, ErrorCtor = Error, StringCtor = String;
  const handles = new WeakMap();
  const wmGet = WeakMap.prototype.get, wmSet = WeakMap.prototype.set;
  const handleOf = (o) => apply(wmGet, handles, [o]);
  const logs = [];

  function encode(v, depth) {
    if (depth > 64) throw new ErrorCtor('an argument is nested more than 64 deep');
    if (v === null || v === undefined) return null;
    const t = typeof v;
    if (t === 'number' || t === 'string' || t === 'boolean') return v;
    if (t === 'object') {
      const h = handleOf(v);
      if (h) return h.t === 'solid' ? { $solid: h.id } : h.t === 'stone' ? { $stone: h.id } : { $profile: h.id };
      if (isArray(v)) {
        const out = [];
        for (let i = 0; i < v.length; i++) out.push(encode(v[i], depth + 1));
        return out;
      }
      const out = {};
      for (const k of keys(v)) if (v[k] !== undefined) define(out, k, { value: encode(v[k], depth + 1), enumerable: true });
      return out;
    }
    throw new ErrorCtor('an argument is a ' + t + '; a call takes numbers, text, lists, objects of settings, and what the library made');
  }

  function make(C, t, id, dims) {
    const o = new C();
    apply(wmSet, handles, [o, freeze({ t, id })]);
    if (dims !== undefined) define(o, 'dims', { value: deepFreeze(dims), enumerable: true });
    return freeze(o);
  }
  function deepFreeze(v) {
    if (v && typeof v === 'object') {
      for (const k of keys(v)) deepFreeze(v[k]);
      freeze(v);
    }
    return v;
  }
  function decode(v) {
    if (v && typeof v === 'object' && !isArray(v)) {
      if (typeof v.$solid === 'number') return make(Solid, 'solid', v.$solid, v.dims);
      if (typeof v.$stone === 'number') return make(Stone, 'stone', v.$stone, v.dims);
      if (typeof v.$profile === 'number') return make(Profile, 'profile', v.$profile);
    }
    return v;
  }

  function call(name, args) {
    while (args.length && args[args.length - 1] === undefined) args.length--;
    const text = stringify(encode(args, 0));
    let out;
    try {
      out = bridge(name, text);
    } catch {
      throw new ErrorCtor(name + ': the engine could not finish this call (the program may have called too deeply)');
    }
    if (typeof out !== 'string') throw new ErrorCtor(name + ': the engine gave no answer');
    const r = parse(out);
    if (r.error !== undefined) throw new ErrorCtor(StringCtor(r.error));
    return decode(r.ok);
  }

  class Solid {
    translate(...a) { return call('translate', [this, ...a]); }
    rotate(...a) { return call('rotate', [this, ...a]); }
    mirror(plane) { return call('mirror', [this, plane]); }
    scale(f) { return call('scale', [this, f]); }
    add(...o) { return call('union', [this, ...o]); }
    subtract(...o) { return call('difference', [this, ...o]); }
    intersect(...o) { return call('intersection', [this, ...o]); }
    named(name) { return call('named', [this, name]); }
    bounds() { return call('bounds', [this]); }
    volume() { return call('volume', [this]); }
    slice(z) { return call('slice', [this, z]); }
    project() { return call('project', [this]); }
    trim(normal, offset) { return call('trim', [this, normal, offset]); }
  }
  class Profile {
    offset(d, o) { return call('p_offset', [this, d, o]); }
    add(q) { return call('p_add', [this, q]); }
    subtract(q) { return call('p_subtract', [this, q]); }
    intersect(q) { return call('p_intersect', [this, q]); }
    translate(...a) { return call('p_translate', [this, ...a]); }
    rotate(deg) { return call('p_rotate', [this, deg]); }
    scale(f) { return call('p_scale', [this, f]); }
    mirror(n) { return call('p_mirror', [this, n]); }
    hull() { return call('p_hull', [this]); }
    bounds() { return call('p_bounds', [this]); }
    area() { return call('p_area', [this]); }
  }
  class Stone {}
  for (const C of [Solid, Profile, Stone]) { freeze(C.prototype); freeze(C); }

  const api = {
    sphere: (r) => call('sphere', [r]),
    cylinder: (r, h, o) => call('cylinder', [r, h, o]),
    box: (...a) => call('box', a),
    torus: (R, r) => call('torus', [R, r]),
    sweep: (r, path, o) => call('sweep', [r, path, o]),
    extrude: (p, h, o) => call('extrude', [p, h, o]),
    revolve: (p, o) => call('revolve', [p, o]),
    hull: (...s) => call('hull', s),
    hullPoints: (pts) => call('hullPoints', [pts]),
    union: (...s) => call('union', s),
    difference: (...s) => call('difference', s),
    intersection: (...s) => call('intersection', s),
    smoothUnion: (r, ...s) => call('smoothUnion', [r, ...s]),
    op: (node) => call('op', [node]),
    segments: (r) => call('segments', [r]),
    circle: (r) => call('circle', [r]),
    rect: (x, y, o) => call('rect', [x, y, o]),
    polygon: (pts) => call('polygon', [pts]),
    ringShank: (o) => call('ringShank', [o]),
    roundStone: (o) => call('roundStone', [o]),
    emeraldStone: (o) => call('emeraldStone', [o]),
    stone: (s, o) => call('stone', [s, o]),
    prongHead: (o) => call('prongHead', [o]),
    bezel: (o) => call('bezel', [o]),
    thicken: (o) => call('thicken', [o]),
    translate: (s, ...a) => call('translate', [s, ...a]),
    rotate: (s, ...a) => call('rotate', [s, ...a]),
    mirror: (s, p) => call('mirror', [s, p]),
    scale: (s, f) => call('scale', [s, f]),
  };
  const say = (...a) => {
    if (logs.length < 50) logs.push(a.map((x) => { try { return typeof x === 'string' ? x : stringify(x); } catch { return '?'; } }).join(' ').slice(0, 300));
  };
  api.console = freeze({ log: say, info: say, warn: say, error: say });
  for (const k of keys(api)) define(G, k, { value: freeze(api[k]), writable: false, enumerable: false, configurable: false });
  delete G.WebAssembly;
  // The same piece every time: a check runs the program twice (the casting file and its finer
  // reference), so Math.random is a fixed-seed generator (mulberry32), not the system's.
  let seed = 0x5eed1e55;
  define(Math, 'random', { value: function random() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }, writable: true, configurable: true });

  function describe(e) {
    let message = 'the program threw something that is not an error';
    let line = null;
    try { message = e instanceof ErrorCtor ? StringCtor(e.message) : StringCtor(e); } catch {}
    try {
      const m = /program\.js:(\d+)/.exec(e instanceof ErrorCtor ? StringCtor(e.stack) : '');
      if (m) line = +m[1];
    } catch {}
    return { message: message.slice(0, 1000), line };
  }
  function kindOf(v) {
    if (v === undefined) return 'nothing (is "return" missing?)';
    if (v === null) return 'null';
    return typeof v === 'object' ? (handleOf(v) ? 'a ' + handleOf(v).t : 'an object') : 'a ' + typeof v;
  }

  return function run(program) {
    let v;
    try {
      v = program();
    } catch (e) {
      return stringify({ error: describe(e), logs });
    }
    try {
      if (v !== null && typeof v === 'object' && typeof v.then === 'function') {
        return stringify({ error: { message: 'the program returned a promise; a program builds the piece and returns it at once (no await, no timers).', line: null }, logs });
      }
    } catch (e) {
      return stringify({ error: describe(e), logs });
    }
    const h = v !== null && typeof v === 'object' ? handleOf(v) : undefined;
    if (!h || h.t !== 'solid') return stringify({ error: { message: 'the program must end by returning the piece, one solid, for example "return union(band, head);". It returned ' + kindOf(v) + '.', line: null }, logs });
    return stringify({ ok: h.id, logs });
  };
})`;

// src/program/child.ts
var wasmCapHit = false;
function capWasm(capBytes) {
  const proto = globalThis.WebAssembly.Memory.prototype;
  const grow = proto.grow;
  proto.grow = function(pages) {
    if (this.buffer.byteLength + pages * 65536 > capBytes) {
      wasmCapHit = true;
      throw new RangeError("flo2-cad: the geometry kernel reached its memory limit");
    }
    return grow.call(this, pages);
  };
}
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
function writeFrame(header, blobs) {
  const head = Buffer.from(JSON.stringify(header), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(head.length, 0);
  return new Promise((resolve) => process.stdout.write(Buffer.concat([len, head, ...blobs]), () => resolve()));
}
function fail(kind, message, line, logs) {
  return writeFrame({ ok: false, kind, message, line, logs }, []);
}
function blobber(blobs) {
  return (a) => {
    blobs.push(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    return blobs.length - 1;
  };
}
function meshOut2(m, blob, positionsOnly = false) {
  return positionsOnly ? { positions: blob(m.positions) } : { positions: blob(m.positions), triangles: blob(m.triangles) };
}
async function main() {
  const t0 = performance.now();
  const req = JSON.parse(await readStdin());
  capWasm(req.wasm_cap_bytes);
  const k = await kernel();
  const A = new Arena();
  const kept = /* @__PURE__ */ new Map();
  const blobs = [];
  const blob = blobber(blobs);
  const runs = [];
  let logs = [];
  for (const run of req.runs) {
    const remaining = Math.floor(req.deadline_ms - (performance.now() - t0));
    if (remaining <= 0) return fail("time", "the program ran past its time limit", null, logs);
    const blendMeshes = { meshes: kept, reuse: !!run.reuseBlends };
    const lib = new ProgramLibrary(k, A, run.tol, blendMeshes);
    const ctx = vm.createContext(vm.constants.DONT_CONTEXTIFY, { name: "flo2-cad program", codeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate" });
    const setup = new vm.Script(PRELUDE, { filename: PRELUDE_FILENAME }).runInContext(ctx);
    const runner = setup((name, args) => lib.call(name, args));
    let program;
    try {
      program = vm.compileFunction(`'use strict'; ${req.source}`, [], { parsingContext: ctx, filename: PROGRAM_FILENAME });
    } catch (e) {
      const stack = String(e?.stack ?? "");
      const line = /program\.js:(\d+)/.exec(stack)?.[1];
      const what = /^(SyntaxError: .*)$/m.exec(stack)?.[1] ?? String(e?.message ?? e);
      return fail("program", `the program does not parse: ${what}`, line ? Number(line) : null, logs);
    }
    ctx["__flo2_run"] = runner;
    ctx["__flo2_program"] = program;
    let out;
    const started = performance.now();
    try {
      out = vm.runInContext("__flo2_run(__flo2_program)", ctx, { timeout: remaining, filename: "flo2-cad-run.js" });
    } catch (e) {
      if (performance.now() - started >= remaining - 25) return fail("time", "the program ran past its time limit", null, logs);
      if (wasmCapHit) return fail("memory", "the geometry kernel reached its memory limit", null, logs);
      return fail("engine", e instanceof Error ? `the program's run stopped: ${e.message}` : "the program's run stopped on something the engine does not read", null, logs);
    }
    if (typeof out !== "string") return fail("engine", "the program gave no answer", null, logs);
    const r = JSON.parse(out);
    logs = Array.isArray(r.logs) ? r.logs.filter((x) => typeof x === "string").slice(0, 50) : [];
    if (r.error !== void 0) {
      const msg = String(r.error.message ?? "the program failed");
      return fail(wasmCapHit ? "memory" : "program", wasmCapHit ? "the geometry kernel reached its memory limit" : msg, typeof r.error.line === "number" ? r.error.line : null, logs);
    }
    try {
      const res = lib.finish(r.ok, run.scale, !!run.blendSurface);
      const decl = res.decl;
      const blends = (res.decl.blends ?? []).map((b) => ({ label: b.label, points: blob(b.points) }));
      runs.push({
        metal: meshOut2(res.metal, blob, run.positionsOnly),
        ...run.wantStone && res.stone ? { stone: meshOut2(res.stone, blob) } : {},
        ...run.positionsOnly ? {} : { decl: { ...decl, blends }, parts: res.parts }
      });
    } catch (e) {
      if (wasmCapHit) return fail("memory", "the geometry kernel reached its memory limit", null, logs);
      if (e instanceof CallError) return fail("program", `${e.path}: ${e.problem}`, null, logs);
      return fail("engine", `the piece could not be finished: ${e instanceof Error ? e.message : String(e)}`, null, logs);
    }
  }
  await writeFrame({ ok: true, runs, blobs: blobs.map((b) => b.length), logs, ms: Math.round(performance.now() - t0) }, blobs);
}
main().then(
  () => process.exit(0),
  async (e) => {
    try {
      await fail(wasmCapHit ? "memory" : "engine", `the evaluation failed: ${e instanceof Error ? e.message : String(e)}`, null, []);
    } finally {
      process.exit(1);
    }
  }
);
