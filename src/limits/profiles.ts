// LIMIT PROFILES (dec:idea-limit-profiles-by-material-process-and-size, accepted 2026-11-04,
// options (a) and (b); req:limits-follow-the-material-process-and-size).
//
// Every limit a piece is checked against follows its material, its casting process and its
// size. A PROFILE is one cited set of them: a material family, a process and a size range,
// carrying every limit the checker reads and the shrinkage allowance, each with its source.
// The engine picks the profile that covers all three of a piece's (choose.ts):
//   · the material the piece states (one of the metals by its id, or any other by name);
//   · the process it states, lost wax when it states none (and the reply says so);
//   · its size, measured from the model: the largest side of its bounding box, in mm, the
//     piece as finished (before any shrinkage allowance).
// No profile covering all three means NO VERDICT. A piece may instead carry limits the person
// supplies, each with its source (supplied.ts). A profile is added only when a real piece needs
// one, with its own sources; none is ever filled in with a plausible number.
//
// The first profile is the limits flo2-cad has held since 2026-10-03 (dec:the-casting-limits;
// dec:the-making-route-and-metals, platinum added by the owner 2026-10-03), unchanged. Where
// sources differ, the STRICTER figure is used (owner, round 1, Q4: "casting-ready is held to the
// strictest cited figure").

import type { MetalId } from '../metals.js';

/** A figure with where it comes from. */
export interface Cited {
  value: number;
  source: string;
}

/** The casting limits the checker reads, in mm. */
export interface Limits {
  /** Thinnest wall anywhere (the max-inscribed-sphere thickness). */
  wall: number;
  /** A ring's band (shank), across its narrowest section. */
  band: number;
  /** A prong (a wire joined at one end only), across its narrowest section. */
  prong: number;
  /** Smallest raised detail. */
  detail: number;
  /** Smallest gap between two parts of the piece. */
  gap: number;
  /** Largest departure of the mesh from the intended surface. */
  surfaceDeviation: number;
}

export const LIMIT_KEYS = ['wall', 'band', 'prong', 'detail', 'gap', 'surfaceDeviation'] as const satisfies readonly (keyof Limits)[];

/** One material's figures within a profile. */
export interface ProfileMaterial {
  limits: { readonly [K in keyof Limits]: Cited };
  /** The linear shrinkage allowance "on" applies, in %. */
  shrinkagePct: Cited;
  /** Every source behind this material's figures, as the check report lists them. */
  sources: readonly string[];
}

export interface LimitProfile {
  id: string;
  name: string;
  /** The family its materials are, in words. */
  family: string;
  materials: Readonly<Partial<Record<MetalId, ProfileMaterial>>>;
  /** The processes it covers, by id (PROCESSES). */
  processes: readonly ProcessId[];
  /** The size it covers: the largest side of the piece's bounding box, in mm. */
  size: { minMm: Cited; maxMm: Cited };
}

// ------------------------------------------------------------------ processes

/** The casting processes a profile can name. A piece may state any other in words; no profile covers it. */
export const PROCESSES = {
  lost_wax: {
    words: 'lost wax',
    detail: 'lost wax (investment) casting, from a pattern printed in castable resin or wax, or carved in wax',
    source:
      'Materialise (silver and gold): "Your model is first printed in wax, placed in a container, and covered in a liquid plaster" and "the wax is burned out, creating a cavity in the now-hardened plaster" (https://www.materialise.com/en/academy/industrial/design-am/silver, .../gold); Shapeways (silver, gold and platinum): process "Lost Wax Casting" (https://www.shapeways.com/materials/silver, .../gold, .../platinum). Pages read 2026-11-04. A pattern printed in castable resin, or carved in wax, is cast the same way.',
  },
} as const;
export type ProcessId = keyof typeof PROCESSES;
/** What a piece that states no process is checked as, and the reply says it was assumed. */
export const DEFAULT_PROCESS: ProcessId = 'lost_wax';

export function isProcessId(v: string): v is ProcessId {
  return Object.hasOwn(PROCESSES, v);
}

// ------------------------------------------------- precious metals, lost wax

const MATERIALISE = 'https://www.materialise.com/en/academy/industrial/design-am/silver and .../gold';
const SHAPEWAYS_SHRINK =
  'Shapeways (silver, gold and platinum pages): "the metal shrinks by approximately 1-1.5%"; finishing takes the overall reduction to about 3%; ring inside diameters stay within ±0.05-0.10 mm.';
const COMMON = [
  `${MATERIALISE}: walls 0.8 mm (high gloss), ring bands at least 1 mm, details 0.35 mm across and 0.4 mm high, gaps 0.3 mm.`,
  'Surface deviation 0.01 mm: con:surface-deviation-tolerance (Formlabs Form 4 50 µm XY and 25 µm layers; Asiga PRO 4K45 32 µm XY).',
  SHAPEWAYS_SHRINK,
];

/** The figures every metal of the profile shares; `page` is the metal's own Shapeways page. */
function shared(page: string, gap: Cited): ProfileMaterial['limits'] {
  return {
    wall: { value: 0.8, source: `${MATERIALISE}: walls 0.8 mm for a high-gloss finish; ${page}: walls 0.8 mm.` },
    band: { value: 1.0, source: `${MATERIALISE}: "when making something small such as the band of a ring, the wall thickness should be at least 1 mm".` },
    prong: { value: 1.0, source: `${page}: wire 1.0 mm unsupported (joined on one side only; 0.8 mm supported).` },
    detail: { value: 0.35, source: `${MATERIALISE}: "The smallest features in your design should be at least 0.35 mm in diameter and 0.4 mm in height".` },
    gap,
    surfaceDeviation: { value: 0.01, source: 'con:surface-deviation-tolerance (Formlabs Form 4 50 µm XY and 25 µm layers; Asiga PRO 4K45 32 µm XY).' },
  };
}

const CLEARANCE: Cited = { value: 0.3, source: `${MATERIALISE}: "we advise a minimum gap of 0.3 mm"; Shapeways: clearance 0.3 mm.` };
const SHRINK: Cited = { value: 1.5, source: SHAPEWAYS_SHRINK };

/**
 * The first profile: sterling silver 925, 14k and 18k yellow gold and platinum 950, cast by lost
 * wax from a printed castable resin or a carved wax, at jewelry scale. Its size range is what the
 * cited services cast in these metals, read by the piece's largest side (the bounds below say how).
 */
export const PRECIOUS_METALS_LOST_WAX_JEWELRY: LimitProfile = {
  id: 'precious-metals-lost-wax-jewelry-scale',
  name: 'precious metals cast by lost wax, at jewelry scale',
  family: 'precious metals',
  processes: ['lost_wax'],
  size: {
    minMm: {
      value: 2.4,
      source:
        'Shapeways (silver, gold and platinum): "Minimum Bounding Box 2.4 × 2.4 × 0.6 mm" and "Your model must be within the minimum and maximum bounding box sizes" (https://www.shapeways.com/materials/silver, .../gold, .../platinum, read 2026-11-04). A piece under 2.4 mm at its largest is below it. Materialise gives no smallest part.',
    },
    maxMm: {
      value: 88,
      source:
        'Materialise (silver and gold): "Maximum part dimensions" "88 x 88 x 125 mm" (https://www.materialise.com/en/academy/industrial/design-am/silver, .../gold); Shapeways (silver, gold and platinum): "Maximum Bounding Box 89 × 89 × 100 mm" (https://www.shapeways.com/materials/silver, .../gold, .../platinum). Pages read 2026-11-04. The piece is read by its largest side alone, so the bound is the largest side that fits both services\' boxes whatever its other two sides are: the smaller box side, 88 mm. A piece longer than that may still fit one box lengthwise; it gets no verdict here.',
    },
  },
  materials: {
    sterling_silver_925: {
      limits: shared('https://www.shapeways.com/materials/silver', CLEARANCE),
      shrinkagePct: SHRINK,
      sources: [
        'https://www.shapeways.com/materials/silver: walls 0.8 mm polished (0.6 mm natural finish); wire 0.8 mm supported, 1.0 mm unsupported; clearance 0.3 mm.',
        ...COMMON,
        'Density 10.40 g/cm³: https://www.stuller.com/articles/view/where-to-find-gravity-of-materials/',
      ],
    },
    gold_14k_yellow: {
      limits: shared('https://www.shapeways.com/materials/gold', CLEARANCE),
      shrinkagePct: SHRINK,
      sources: [
        'https://www.shapeways.com/materials/gold: walls 0.8 mm; wire 0.8 mm supported, 1.0 mm unsupported; engraved detail 0.35 mm, embossed 0.4 mm; clearance 0.3 mm.',
        ...COMMON,
        'Density 13.07 g/cm³: https://www.stuller.com/articles/view/where-to-find-gravity-of-materials/',
      ],
    },
    gold_18k_yellow: {
      limits: shared('https://www.shapeways.com/materials/gold', CLEARANCE),
      shrinkagePct: SHRINK,
      sources: [
        'https://www.shapeways.com/materials/gold: walls 0.8 mm; wire 0.8 mm supported, 1.0 mm unsupported; engraved detail 0.35 mm, embossed 0.4 mm; clearance 0.3 mm.',
        ...COMMON,
        'Density 15.58 g/cm³: https://www.stuller.com/articles/view/where-to-find-gravity-of-materials/',
      ],
    },
    platinum_950: {
      // The gap is Stuller's 0.8 mm platinum figure, stricter than the 0.3 mm clearance of the services.
      limits: shared('https://www.shapeways.com/materials/platinum', {
        value: 0.8,
        source: 'Stuller production standards (http://stuller.scene7.com/is/content/Stuller/DAS/09b4e2e2-e12e-45f8-a2ed-a4f80104aa9f.pdf): "0.8mm minimum DBR [distance between rails] for Platinum and Palladium".',
      }),
      shrinkagePct: SHRINK,
      sources: [
        'https://www.shapeways.com/materials/platinum: 95% platinum, 5% ruthenium; walls 0.8 mm; wire 0.8 mm supported, 1.0 mm unsupported; engraved detail 0.35 mm, embossed 0.4 mm; clearance 0.3 mm.',
        'Stuller production standards (http://stuller.scene7.com/is/content/Stuller/DAS/09b4e2e2-e12e-45f8-a2ed-a4f80104aa9f.pdf): "0.8mm minimum DBR [distance between rails] for Platinum and Palladium".',
        ...COMMON,
        'Melting range Pt950/Ru 1780-1795 °C and density 20.7 g/cm³: J. Maerz (PGI), https://www.ganoksin.com/article/platinum-alloys-features-benefits/',
        'Casting at about 1850-2200 °C, "special equipment is needed", phosphate investment: https://products.riogrande.com/content/Instruction-Sheets/How-To-Cast-Platinum-IS.pdf; an induction caster costs about $30,000: http://technical-articles.hooverandstrong.com/wordpress/platinum-casting-in-a-small-shop/',
      ],
    },
  },
};

/** Every profile flo2-cad has, the first first. */
export const PROFILES: readonly LimitProfile[] = [PRECIOUS_METALS_LOST_WAX_JEWELRY];

/** A profile material's limits as the checker reads them: the numbers alone. */
export function limitValues(m: ProfileMaterial): Limits {
  return Object.fromEntries(LIMIT_KEYS.map((k) => [k, m.limits[k].value])) as unknown as Limits;
}

/** The limits every library default sits above, whatever the metal (con:library-defaults-above-the-limits): the strictest of the first profile's. */
export const STRICTEST: Limits = Object.values(PRECIOUS_METALS_LOST_WAX_JEWELRY.materials).reduce<Limits>(
  (acc, m) => {
    const l = limitValues(m);
    return {
      wall: Math.max(acc.wall, l.wall),
      band: Math.max(acc.band, l.band),
      prong: Math.max(acc.prong, l.prong),
      detail: Math.max(acc.detail, l.detail),
      gap: Math.max(acc.gap, l.gap),
      surfaceDeviation: Math.min(acc.surfaceDeviation, l.surfaceDeviation),
    };
  },
  { wall: 0, band: 0, prong: 0, detail: 0, gap: 0, surfaceDeviation: Infinity },
);
