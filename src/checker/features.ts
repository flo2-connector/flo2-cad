// What the jewelry library DECLARES about a piece, so the checker knows where
// its prongs, band and bezel are (ifc:solid-mesh: "each face tagged by the part
// feature it came from"). Declarations are plain data: regions and nominal
// planes, in the WRITTEN file's coordinates (shrinkage already applied). The
// checker MEASURES everything from the STL bytes it reads back; it takes no
// geometry from the kernel.

export type P2 = [number, number];
export type P3 = [number, number, number];

export interface BandDecl {
  /**
   * The band runs around the Y axis. Its own section, between these radii and
   * within halfWidth of the middle, is what the band check measures, all the way
   * round: metal outside it (a head, an added shape) is never counted as band.
   */
  innerRadius: number;
  outerRadius: number;
  halfWidth: number;
}

export interface ProngDecl {
  /** "prong 2 of 4" */
  label: string;
  /** Its place seen from above, the finger pointing to 12 o'clock. */
  clock: string;
  /** The prong's vertical axis (x, y). */
  axis: P2;
  nominalDiameter: number;
  /** Cross-sections are measured between these heights (the column, not its foot or dome). */
  sectionFromZ: number;
  sectionToZ: number;
}

export interface StoneDecl {
  /** The girdle outline, in XY. */
  outline: P2[];
  girdleBottomZ: number;
  girdleTopZ: number;
  /** Above the girdle's top. On a cabochon, its dome. */
  crownHeight: number;
  /**
   * 'cabochon' when the stone was DECLARED one (the library's cabochon(), or a program's
   * stone(..., { kind: 'cabochon' })); the checker never guesses it from the shape. A
   * cabochon's bezel lip is held to the cabochon's own rule, any other stone's to the
   * faceted stone's crown rule (dec:a-cabochon-bezel-has-its-own-lip-rule-from-a-cited-reference).
   */
  kind?: 'cabochon';
}

export interface BezelDecl {
  /** Outer outline of the rim in XY (a region: everything inside it and outside the girdle belongs to the bezel). */
  outer: P2[];
  zBottom: number;
  nominalWall: number;
}

/**
 * A thin sheet given a thickness by the tree's thicken operation (a cupped petal, a
 * leaf). It declares what it was MEANT to be: its middle surface, sampled as points
 * with the surface's normal at each, and its nominal thickness. The checker measures
 * the written file square to the surface at those points and holds what it reads to
 * the wall minimum.
 */
export interface SheetDecl {
  /** The thicken node's id, which is also how change_piece reaches its settings ("<id>.thickness"). */
  label: string;
  nominalThickness: number;
  /** How far apart the points are, so a point of the file can be told to lie on this sheet. */
  spacing: number;
  points: P3[];
  /** Unit normals, one per point. */
  normals: P3[];
}

/**
 * A smooth blend (the tree's smooth_union) declares points on its OWN surface, its
 * distance field's zero level, over every facet the file has from it: each facet's
 * corners, edge midpoints and centroid, moved onto the surface along the facet's
 * normal. The surface check measures how far the written facets stand off them, as
 * it does the finer reference's vertices.
 */
export interface BlendDecl {
  /** The smooth_union node's id. */
  label: string;
  /** x, y, z of each point in turn, in the written file's coordinates (float32, as the file and the reference hold them). */
  points: Float32Array;
}

export interface AddedDecl {
  /** The id of a shape the tree adds beside the library's parts (a child of the root), as the piece's summary names it. */
  id: string;
  /** Its bounds. The checker names a thin place by the added shape whose bounds hold it, once the band's own section does not. */
  min: P3;
  max: P3;
}

export interface FeatureDecl {
  band?: BandDecl;
  prongs: ProngDecl[];
  stone?: StoneDecl;
  bezel?: BezelDecl;
  /** Sheets from thicken operations, if any. */
  sheets?: SheetDecl[];
  /** Smooth blends, if any, with points on their own surfaces. */
  blends?: BlendDecl[];
  /** The shapes the tree adds beside the band and head, each by its id. */
  added?: AddedDecl[];
  /** The uniform scale applied for shrinkage (1 when off). */
  scale: number;
}
