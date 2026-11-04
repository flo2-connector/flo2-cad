// THE JEWELRY LAYER'S RULES: how a stone is held and seated, each cited. They are craft
// standards for a stone's setting, not casting limits, so they do not change with the metal,
// the process or the size: the casting limits are the limit profiles' (src/limits/). They
// apply only to a piece that declares a stone or a setting (checks.ts), and the rest of the
// engine reaches them only through this layer's boundary, src/jewelry/index.ts.

/** Setting rules for how a stone is held (not casting limits; craft standards, cited). */
export const SETTING = {
  /** Prong overlap over the girdle: Stuller production standards, "0.15 into the stone or 15%". */
  gripMin: 0.15,
  /** Bezel lip on a FACETED stone: "Between 25 percent and 50 percent of the crown should protrude above the bezel" (Revere, JCK 2010). */
  lipMinOfCrown: 0.5,
  lipMaxOfCrown: 0.75,
  /**
   * Bezel lip on a CABOCHON (dec:a-cabochon-bezel-has-its-own-lip-rule-from-a-cited-reference):
   * at least a third of the stone's height, its dome above the girdle. Cogswell gives "a
   * third to a quarter ... depending on the wall thickness", and never less than a quarter;
   * he names no wall thickness that earns the quarter, so the stricter third is used
   * (owner, round 1, Q4). He gives no upper limit, so none is applied.
   */
  lipMinOfCabochon: 1 / 3,
  sources: [
    'Stuller production standards (prong overlap 0.15 mm, prong dome base flush with the table): http://stuller.scene7.com/is/content/Stuller/DAS/09b4e2e2-e12e-45f8-a2ed-a4f80104aa9f.pdf',
    'A. Revere, "Square Bezel Setting", JCK 2010: https://www.jckonline.com/magazine-article/square-bezel-setting/',
    'Cabochon bezel lip: J. Cogswell, Creative Stonesetting (Brynmorgen Press, 2008, ISBN 978-1-929565-22-1), ch. 3 Bezel Settings: "The height of the finished bezel should be approximately a third to a quarter of the height of the stone, depending on the wall thickness. ... Thicker bezels can be slightly shorter than thinner bezels, with greater mass making up for lesser height, [but] even they should never be less than one-fourth the height of the stone." Quoted in full at https://orchid.ganoksin.com/t/selecting-bezel-wire-size/37651 (post 11, 2009-07-25); a cabochon\'s crown, or dome, meets its flat base at the girdle (the book, p. 10). The stricter third is used.',
  ],
} as const;

// ------------------------------------------------------------------- the seat

/** Every seat is cut as the stone's own shape grown by this all round. Under a bezel's lip, the wall stands further off. */
export const SEAT_CLEARANCE = 0.03;
/** A bezel's inner wall stands this far off the girdle all round, so the stone drops in. */
export const BEZEL_CLEARANCE = 0.05;

// ------------------------------------------------------------------ the stones

/**
 * Template stone sizes. They are PLACEHOLDERS until the person gives the stone's
 * measured dimensions, and the preview and replies say so.
 *  · round: 6.5 × 4.0 mm, about a 1.00 ct round brilliant (International Gem
 *    Society chart, https://www.gemsociety.org/article/standard-gem-sizes-chart/;
 *    depth 61 %, between Tolkowsky's 59.3 % and typical graded stones);
 *  · emerald: 8.5 × 6.0 × 4.1 mm, a typical 2.00 ct emerald cut (Stuller's
 *    mm-to-carat chart gives 8.5 × 6 mm for 2.00 ct,
 *    https://blog.stuller.com/wp-content/uploads/2023/12/Millimeter-to-Diamond-Carat-Weight-Conversion-Chart-2.pdf;
 *    depth 4.1 mm, within three GIA-graded 2.00 ct emerald cuts of 3.98-4.33 mm
 *    listed by Blue Nile, e.g. https://www.bluenile.com/diamond-details/19095454).
 */
export const STONE_DEFAULTS = {
  round: { diameter: '6.5 mm', depth: '4.0 mm', carat: '1.00 ct' },
  emerald: { length: '8.5 mm', width: '6.0 mm', depth: '4.1 mm', carat: '2.00 ct' },
} as const;

// ------------------------------------------------------------------ the head

/** A head's own settings when the person gives none. */
export const HEAD_DEFAULTS = {
  /** How far each prong reaches in over the stone's girdle (Stuller: 0.15 mm; the default sits above it). */
  prong_grip: '0.2 mm',
  /** Gap between the stone's culet (its point) and the top of the band. */
  culet_clearance: '0.3 mm',
};
