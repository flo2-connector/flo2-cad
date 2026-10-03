// What the jewelry library DECLARES about a piece, so the checker knows where
// its prongs, band and bezel are (ifc:solid-mesh: "each face tagged by the part
// feature it came from"). Declarations are plain data: regions and nominal
// planes, in the WRITTEN file's coordinates (shrinkage already applied). The
// checker MEASURES everything from the STL bytes it reads back; it takes no
// geometry from the kernel.

export type P2 = [number, number];
export type P3 = [number, number, number];

export interface BandDecl {
  /** The band runs around the Y axis. */
  innerRadius: number;
  outerRadius: number;
  halfWidth: number;
  /** Sections within this angle of straight up (+Z) are skipped: the head sits there. */
  skipTopDeg: number;
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
  crownHeight: number;
}

export interface BezelDecl {
  /** Outer outline of the rim in XY (a region: everything inside it and outside the girdle belongs to the bezel). */
  outer: P2[];
  zBottom: number;
  nominalWall: number;
}

export interface FeatureDecl {
  band?: BandDecl;
  prongs: ProngDecl[];
  stone?: StoneDecl;
  bezel?: BezelDecl;
  /** The uniform scale applied for shrinkage (1 when off). */
  scale: number;
}
