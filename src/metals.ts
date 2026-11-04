// The metals a piece can name by id, with what is known of each as a material: its name, its
// density for a weight, and what every export in it must say about how it is cast
// (dec:the-making-route-and-metals, platinum added by the owner 2026-10-03). Their cited casting
// limits and shrinkage are the first LIMIT PROFILE's, "precious metals cast by lost wax, at
// jewelry scale" (src/limits/profiles.ts, with their sources), and apply only where that
// profile also covers the piece's process and size. A piece in any other material names it in
// words ("material": "bronze"): no profile covers it, so it gets no verdict unless it carries
// limits the person supplies, with their sources. The setting rules (prong grip, bezel lip,
// seat clearance) are the jewelry layer's (src/jewelry/).

export type MetalId = 'sterling_silver_925' | 'gold_14k_yellow' | 'gold_18k_yellow' | 'platinum_950';
export const METAL_IDS: readonly MetalId[] = ['sterling_silver_925', 'gold_14k_yellow', 'gold_18k_yellow', 'platinum_950'];

export interface Metal {
  id: MetalId;
  name: string;
  /** g/cm³, for the weight estimate (its source is in the profile's list for the metal). */
  density: number;
  /** What every export in this metal must say about how it is cast. */
  castingNote: string | null;
}

export const METALS: Readonly<Record<MetalId, Metal>> = {
  sterling_silver_925: {
    id: 'sterling_silver_925',
    name: 'sterling silver 925',
    density: 10.4,
    castingNote: null,
  },
  gold_14k_yellow: {
    id: 'gold_14k_yellow',
    name: '14k yellow gold',
    density: 13.07,
    castingNote: null,
  },
  gold_18k_yellow: {
    id: 'gold_18k_yellow',
    name: '18k yellow gold',
    density: 15.58,
    castingNote: null,
  },
  platinum_950: {
    id: 'platinum_950',
    name: 'platinum 950 (Pt950/Ru)',
    density: 20.7,
    castingNote:
      'Platinum 950 melts at about 1780-1795 °C and is cast at about 1850-2200 °C, with special investment and an induction caster, so this file goes to a SPECIALIST platinum caster, not a home or local silver-and-gold setup.',
  },
};
