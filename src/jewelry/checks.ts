// THE JEWELRY LAYER'S CHECKS: a stone's setting, measured on the written STL as the general
// checks are (cmp:casting-checker). They were the checker's own until 2026-11-04, and are moved
// here unchanged, so every reading is what it was: each prong's narrowest section, how far each
// prong reaches over the girdle, the bezel's rim, and the bezel's lip (a faceted stone's share of
// its crown, or a declared cabochon's share of its dome). They run only on a piece that declares
// a stone or a setting, through the general checker's CheckLayer, after the band's check and
// before the sheets'. They read the casting limits the piece's profile (or its supplied limits)
// gives, prong and wall, and the setting rules of this layer (rules.ts).
//
// Like the general checker (con:checker-independent-of-the-kernel), this file imports only the
// checker and Node, never the kernel, the library or the exporter; test/jewelry-boundary.test.ts
// holds that.

import type { Bvh } from '../checker/bvh.js';
import {
  clockAt,
  largestCircleIn,
  MAXSPHERE,
  minSample,
  mm,
  pt,
  r3,
  slice,
  trianglesWhere,
  type CheckEntry,
  type CheckLayer,
  type CheckLimits,
  type Part,
  type Region,
  type Sample,
  type Where,
} from '../checker/check.js';
import type { FeatureDecl, P2, ProngDecl } from '../checker/features.js';
import type { V3 } from '../checker/geom.js';

/** The setting rules these checks hold a stone's setting to (rules.ts SETTING). */
export interface SettingRules {
  gripMin: number;
  lipMinOfCrown: number;
  lipMaxOfCrown: number;
  /** A cabochon's bezel lip, as a share of its dome above the girdle: the least it may rise. */
  lipMinOfCabochon: number;
}

/** Whether the piece declares a stone or a setting: the only pieces this layer checks. */
export function declaresSetting(decl: FeatureDecl): boolean {
  return decl.prongs.length > 0 || decl.bezel !== undefined || decl.stone !== undefined;
}

/**
 * The jewelry layer, holding a setting to `R`. Its checks run in this order: each prong's
 * thickness and, round a stone, its grip; then a bezel's wall and lip round a stone.
 */
export function jewelryChecks(R: SettingRules): CheckLayer {
  return {
    applies: declaresSetting,
    partAt: settingPartAt,
    judgesWallAt: onProngColumn,
    checks: ({ bvh, samples, decl, L }) => {
      const out: { id: CheckEntry['id']; name: string; limit: string; run: () => CheckEntry }[] = [];
      if (decl.prongs.length) {
        out.push({ id: 'prong', name: 'Prong thickness', limit: mm(L.prong), run: () => prongEntry(bvh, decl.prongs, L) });
        if (decl.stone) out.push({ id: 'prong_grip', name: 'Prongs grip the stone', limit: `each reaches ${mm(R.gripMin)} over the girdle`, run: () => gripEntry(bvh, decl, R) });
      }
      if (decl.bezel && decl.stone) {
        out.push({ id: 'bezel_wall', name: 'Bezel wall thickness', limit: mm(L.wall), run: () => bezelWallEntry(bvh, samples, decl, L) });
        out.push({
          id: 'bezel_lip',
          name: 'Bezel lip height',
          limit: decl.stone.kind === 'cabochon' ? "at least a third of the cabochon's dome" : `${Math.round(R.lipMinOfCrown * 100)}-${Math.round(R.lipMaxOfCrown * 100)} % of the crown`,
          run: () => bezelLipEntry(bvh, decl, R),
        });
      }
      return out;
    },
  };
}

/** A place on a prong or the bezel: named before any general part (the checker asks the layer first). */
function settingPartAt(p: V3, decl: FeatureDecl): Part | null {
  for (const pr of decl.prongs) {
    if (Math.hypot(p[0] - pr.axis[0], p[1] - pr.axis[1]) <= pr.nominalDiameter / 2 + 0.3 && p[2] >= pr.sectionFromZ - 0.6) {
      return { part: 'head', feature: pr.label, clock: pr.clock };
    }
  }
  if (decl.bezel && inPolygon(decl.bezel.outer, p[0], p[1], 0.2) && p[2] >= decl.bezel.zBottom - 0.1) return { part: 'head', feature: 'bezel', clock: clockAt(p[0], p[1]) };
  return null;
}

/** Whether a point is on a prong's column (above its foot), which the prong check judges by its narrowest section. */
function onProngColumn(p: V3, decl: FeatureDecl): boolean {
  return decl.prongs.some((pr) => p[2] >= pr.sectionFromZ - 0.05 && Math.hypot(p[0] - pr.axis[0], p[1] - pr.axis[1]) <= pr.nominalDiameter / 2 + 0.05);
}

function prongEntry(bvh: Bvh, prongs: ProngDecl[], L: CheckLimits): CheckEntry {
  const results: { label: string; value: number; where: Where }[] = [];
  for (const pr of prongs) {
    let worst: { d: number; z: number; at: P2 } | null = null;
    const R = pr.nominalDiameter / 2 + 0.35;
    const [ax, ay] = pr.axis;
    const cand = trianglesWhere(bvh, (lo, hi) => lo[2] <= pr.sectionToZ && hi[2] >= pr.sectionFromZ && lo[1] <= ay + R && hi[1] >= ay - R && hi[0] >= ax - R);
    const region: Region = { box: [ax - R, ax + R, ay - R, ay + R], depth: (x, y) => R - Math.hypot(x - ax, y - ay) };
    const at = (z: number) => {
      const segs = slice(bvh, [0, 0, 1], z, (x, y) => [x, y], cand, (p, q) => Math.max(p[0], q[0]) >= ax - R && Math.max(p[1], q[1]) >= ay - R && Math.min(p[1], q[1]) <= ay + R);
      const ins = largestCircleIn(segs, region);
      if (ins && (!worst || ins.d < worst.d)) worst = { d: ins.d, z, at: ins.at };
    };
    // Every 0.1 mm up the column, then every 0.02 mm around the narrowest.
    const steps = Math.max(8, Math.ceil((pr.sectionToZ - pr.sectionFromZ) / 0.1));
    for (let i = 0; i <= steps; i++) at(pr.sectionFromZ + ((pr.sectionToZ - pr.sectionFromZ) * i) / steps);
    const zc = (worst as { z: number } | null)?.z;
    if (zc !== undefined) for (let dz = -0.1; dz <= 0.1001; dz += 0.02) if (zc + dz >= pr.sectionFromZ && zc + dz <= pr.sectionToZ) at(zc + dz);
    if (!worst) throw new Error(`no section of ${pr.label} could be measured`);
    const w = worst as { d: number; z: number; at: P2 };
    results.push({
      label: pr.label,
      value: r3(w.d),
      where: {
        part: 'head',
        feature: pr.label,
        clock: pr.clock,
        point_mm: pt([w.at[0], w.at[1], w.z]),
        description: `${pr.label}, at ${pr.clock} seen from above with the finger pointing to 12 o'clock, ${r3(w.z)} mm up`,
      },
    });
  }
  const failing = results.filter((r) => r.value < L.prong);
  const thinnest = results.reduce((a, b) => (b.value < a.value ? b : a));
  return {
    id: 'prong',
    name: 'Prong thickness',
    limit: mm(L.prong),
    result: failing.length ? 'fail' : 'pass',
    measured: `${mm(thinnest.value)} (${thinnest.label}); each: ${results.map((r) => `${r.label.split(' of ')[0]} ${r.value}`).join(', ')} mm`,
    value: thinnest.value,
    where: thinnest.where,
    ...(failing.length ? { failing } : {}),
    method: "each prong's cross-section every 0.1 mm up its column (0.02 mm around the narrowest), cut from the whole piece and clipped to a disc round the prong's axis, measured as the largest circle that fits inside it (the narrowest section, con:minimum-prong-thickness)",
  };
}

function gripEntry(bvh: Bvh, decl: FeatureDecl, R: SettingRules): CheckEntry {
  const s = decl.stone!;
  const results: { label: string; value: number; where: Where }[] = [];
  const P = bvh.pos;
  for (const pr of decl.prongs) {
    let reach = -Infinity;
    let at: V3 = [pr.axis[0], pr.axis[1], s.girdleTopZ];
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i]!, y = P[i + 1]!, z = P[i + 2]!;
      if (z < s.girdleTopZ + 0.02 || Math.hypot(x - pr.axis[0], y - pr.axis[1]) > pr.nominalDiameter / 2 + 0.05) continue;
      const inset = signedInset(s.outline, x, y);
      if (inset > reach) {
        reach = inset;
        at = [x, y, z];
      }
    }
    results.push({ label: pr.label, value: r3(Math.max(0, reach)), where: { part: 'head', feature: pr.label, clock: pr.clock, point_mm: pt(at), description: `${pr.label}, at ${pr.clock}` } });
  }
  const failing = results.filter((r) => r.value < R.gripMin);
  const least = results.reduce((a, b) => (b.value < a.value ? b : a));
  return {
    id: 'prong_grip',
    name: 'Prongs grip the stone',
    limit: `each prong reaches at least ${mm(R.gripMin)} in over the girdle`,
    result: failing.length ? 'fail' : 'pass',
    measured: `${mm(least.value)} (${least.label})`,
    value: least.value,
    where: least.where,
    ...(failing.length ? { failing } : {}),
    method: 'how far each prong\'s metal above the girdle reaches inside the girdle outline, from the written STL',
  };
}

/** How far (x, y) lies INSIDE a convex outline (positive inside). */
function signedInset(poly: P2[], x: number, y: number): number {
  let best = Infinity;
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sign = area >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const l = Math.hypot(ex, ey) || 1;
    // Distance to the edge's line, positive on the inner side.
    const d = (sign * (ex * (y - a[1]) - ey * (x - a[0]))) / l;
    best = Math.min(best, d);
  }
  return best;
}

function inPolygon(poly: P2[], x: number, y: number, grow = 0): boolean {
  if (grow > 0) return signedInset(poly, x, y) > -grow;
  return signedInset(poly, x, y) >= 0;
}

function bezelWallEntry(_bvh: Bvh, samples: readonly Sample[], decl: FeatureDecl, L: CheckLimits): CheckEntry {
  const bz = decl.bezel!, st = decl.stone!;
  const inBezel = (s: Sample) => s.p[2] > st.girdleBottomZ - 0.5 && inPolygon(bz.outer, s.p[0], s.p[1], 0.1) && signedInset(st.outline, s.p[0], s.p[1]) < 0.3;
  const m = minSample(samples, inBezel);
  if (!m) throw new Error('no point on the bezel could be measured');
  return {
    id: 'bezel_wall',
    name: 'Bezel wall thickness',
    limit: mm(L.wall),
    result: m.thickness >= L.wall ? 'pass' : 'fail',
    measured: mm(m.thickness),
    value: r3(m.thickness),
    where: { part: 'head', feature: 'bezel', clock: clockAt(m.p[0], m.p[1]), point_mm: pt(m.p), description: `the bezel rim at ${clockAt(m.p[0], m.p[1])} seen from above, ${r3(m.p[2] - st.girdleTopZ)} mm above the girdle` },
    method: MAXSPHERE + ', on the bezel rim around and above the girdle',
  };
}

function bezelLipEntry(bvh: Bvh, decl: FeatureDecl, R: SettingRules): CheckEntry {
  const bz = decl.bezel!, st = decl.stone!;
  const P = bvh.pos;
  let top = -Infinity;
  let at: V3 = [0, 0, 0];
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i]!, y = P[i + 1]!, z = P[i + 2]!;
    if (!inPolygon(bz.outer, x, y, 0.05)) continue;
    if (z > top) {
      top = z;
      at = [x, y, z];
    }
  }
  const lip = top - st.girdleTopZ;
  const share = lip / st.crownHeight;
  if (st.kind === 'cabochon') {
    // A cabochon declared so is held to its own rule, the least share of its dome the bezel
    // must rise to be pushed over it (rules.ts SETTING, from Cogswell), with no upper limit.
    const need = R.lipMinOfCabochon * st.crownHeight;
    return {
      id: 'bezel_lip',
      name: 'Bezel lip height',
      limit: `at least a third of the cabochon's ${mm(st.crownHeight)} dome (at least ${mm(need)} for this stone; J. Cogswell, Creative Stonesetting)`,
      result: share >= R.lipMinOfCabochon - 1e-6 ? 'pass' : 'fail',
      measured: `${mm(lip)} above the girdle, ${Math.round(share * 100)} % of the ${mm(st.crownHeight)} dome`,
      value: r3(lip),
      where: { part: 'head', feature: 'bezel', point_mm: pt(at), description: 'the top of the bezel, measured from the top of the girdle' },
      method: "the highest point of the bezel in the written STL, less the girdle's top; the stone was declared a cabochon, so the lip is held to a share of its dome (its height above the girdle), the cabochon's rule, not the faceted stone's crown rule",
    };
  }
  const ok = share >= R.lipMinOfCrown - 1e-6 && share <= R.lipMaxOfCrown + 1e-6;
  return {
    id: 'bezel_lip',
    name: 'Bezel lip height',
    limit: `${Math.round(R.lipMinOfCrown * 100)}-${Math.round(R.lipMaxOfCrown * 100)} % of the crown (${mm(R.lipMinOfCrown * st.crownHeight)} to ${mm(R.lipMaxOfCrown * st.crownHeight)} for this stone)`,
    result: ok ? 'pass' : 'fail',
    measured: `${mm(lip)} above the girdle, ${Math.round(share * 100)} % of the ${mm(st.crownHeight)} crown`,
    value: r3(lip),
    where: { part: 'head', feature: 'bezel', point_mm: pt(at), description: 'the top of the bezel, measured from the top of the girdle' },
    method: "the highest point of the bezel in the written STL, less the girdle's top; the crown height comes from the stone's measured depth",
  };
}
