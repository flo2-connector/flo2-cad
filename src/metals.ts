// The metals a piece can be cast in, each with its OWN cited casting limits and
// shrinkage (dec:the-casting-limits; dec:the-making-route-and-metals, platinum
// added by Anthony 2026-10-03). Every page was read on 2026-10-03.
//
// Where sources differ, the STRICTER figure is used (owner, round 1, Q4: "casting-ready
// is held to the strictest cited figure"). The ring-band figure (1.0 mm) is
// Materialise's; prongs are Shapeways' "unsupported wire" (joined on one side
// only); details and gaps are Materialise's and Shapeways'.

export type MetalId = 'sterling_silver_925' | 'gold_14k_yellow' | 'gold_18k_yellow' | 'platinum_950';
export const METAL_IDS: readonly MetalId[] = ['sterling_silver_925', 'gold_14k_yellow', 'gold_18k_yellow', 'platinum_950'];

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

export interface Metal {
  id: MetalId;
  name: string;
  /** g/cm³, for the weight estimate. */
  density: number;
  limits: Limits;
  /** The linear shrinkage allowance used when shrinkage is "on", in %. */
  shrinkagePct: number;
  /** What every export in this metal must say about how it is cast. */
  castingNote: string | null;
  sources: string[];
}

const SHAPEWAYS_SHRINK =
  'Shapeways (silver, gold and platinum pages): "the metal shrinks by approximately 1-1.5%"; finishing takes the overall reduction to about 3%; ring inside diameters stay within ±0.05-0.10 mm.';
const COMMON = [
  'https://www.materialise.com/en/academy/industrial/design-am/silver and .../gold: walls 0.8 mm (high gloss), ring bands at least 1 mm, details 0.35 mm across and 0.4 mm high, gaps 0.3 mm.',
  'Surface deviation 0.01 mm: con:surface-deviation-tolerance (Formlabs Form 4 50 µm XY and 25 µm layers; Asiga PRO 4K45 32 µm XY).',
  SHAPEWAYS_SHRINK,
];

export const METALS: Readonly<Record<MetalId, Metal>> = {
  sterling_silver_925: {
    id: 'sterling_silver_925',
    name: 'sterling silver 925',
    density: 10.4,
    limits: { wall: 0.8, band: 1.0, prong: 1.0, detail: 0.35, gap: 0.3, surfaceDeviation: 0.01 },
    shrinkagePct: 1.5,
    castingNote: null,
    sources: [
      'https://www.shapeways.com/materials/silver: walls 0.8 mm polished (0.6 mm natural finish); wire 0.8 mm supported, 1.0 mm unsupported; clearance 0.3 mm.',
      ...COMMON,
      'Density 10.40 g/cm³: https://www.stuller.com/articles/view/where-to-find-gravity-of-materials/',
    ],
  },
  gold_14k_yellow: {
    id: 'gold_14k_yellow',
    name: '14k yellow gold',
    density: 13.07,
    limits: { wall: 0.8, band: 1.0, prong: 1.0, detail: 0.35, gap: 0.3, surfaceDeviation: 0.01 },
    shrinkagePct: 1.5,
    castingNote: null,
    sources: [
      'https://www.shapeways.com/materials/gold: walls 0.8 mm; wire 0.8 mm supported, 1.0 mm unsupported; engraved detail 0.35 mm, embossed 0.4 mm; clearance 0.3 mm.',
      ...COMMON,
      'Density 13.07 g/cm³: https://www.stuller.com/articles/view/where-to-find-gravity-of-materials/',
    ],
  },
  gold_18k_yellow: {
    id: 'gold_18k_yellow',
    name: '18k yellow gold',
    density: 15.58,
    limits: { wall: 0.8, band: 1.0, prong: 1.0, detail: 0.35, gap: 0.3, surfaceDeviation: 0.01 },
    shrinkagePct: 1.5,
    castingNote: null,
    sources: [
      'https://www.shapeways.com/materials/gold: walls 0.8 mm; wire 0.8 mm supported, 1.0 mm unsupported; engraved detail 0.35 mm, embossed 0.4 mm; clearance 0.3 mm.',
      ...COMMON,
      'Density 15.58 g/cm³: https://www.stuller.com/articles/view/where-to-find-gravity-of-materials/',
    ],
  },
  platinum_950: {
    id: 'platinum_950',
    name: 'platinum 950 (Pt950/Ru)',
    density: 20.7,
    // The gap is Stuller's 0.8 mm platinum figure, stricter than the 0.3 mm clearance of the services.
    limits: { wall: 0.8, band: 1.0, prong: 1.0, detail: 0.35, gap: 0.8, surfaceDeviation: 0.01 },
    shrinkagePct: 1.5,
    castingNote:
      'Platinum 950 melts at about 1780-1795 °C and is cast at about 1850-2200 °C, with special investment and an induction caster, so this file goes to a SPECIALIST platinum caster, not a home or local silver-and-gold setup.',
    sources: [
      'https://www.shapeways.com/materials/platinum: 95% platinum, 5% ruthenium; walls 0.8 mm; wire 0.8 mm supported, 1.0 mm unsupported; engraved detail 0.35 mm, embossed 0.4 mm; clearance 0.3 mm.',
      'Stuller production standards (http://stuller.scene7.com/is/content/Stuller/DAS/09b4e2e2-e12e-45f8-a2ed-a4f80104aa9f.pdf): "0.8mm minimum DBR [distance between rails] for Platinum and Palladium".',
      ...COMMON,
      'Melting range Pt950/Ru 1780-1795 °C and density 20.7 g/cm³: J. Maerz (PGI), https://www.ganoksin.com/article/platinum-alloys-features-benefits/',
      'Casting at about 1850-2200 °C, "special equipment is needed", phosphate investment: https://products.riogrande.com/content/Instruction-Sheets/How-To-Cast-Platinum-IS.pdf; an induction caster costs about $30,000: http://technical-articles.hooverandstrong.com/wordpress/platinum-casting-in-a-small-shop/',
    ],
  },
};

/** The limits every library default sits above, whatever the metal: the strictest of them all. */
export const STRICTEST: Limits = (Object.keys(METALS) as MetalId[]).reduce<Limits>(
  (acc, id) => {
    const l = METALS[id].limits;
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

/** Setting rules for how a stone is held (not casting limits; craft standards, cited). */
export const SETTING = {
  /** Prong overlap over the girdle: Stuller production standards, "0.15 into the stone or 15%". */
  gripMin: 0.15,
  /** Bezel lip: "Between 25 percent and 50 percent of the crown should protrude above the bezel" (Revere, JCK 2010). */
  lipMinOfCrown: 0.5,
  lipMaxOfCrown: 0.75,
  sources: [
    'Stuller production standards (prong overlap 0.15 mm, prong dome base flush with the table): http://stuller.scene7.com/is/content/Stuller/DAS/09b4e2e2-e12e-45f8-a2ed-a4f80104aa9f.pdf',
    'A. Revere, "Square Bezel Setting", JCK 2010: https://www.jckonline.com/magazine-article/square-bezel-setting/',
  ],
} as const;
