// The chord tolerances the library tessellates to (build.ts says why each is what it is).

/** Per direction: a doubly curved facet (a torus, a domed band) adds both directions' chords, so each is half the 0.01 mm limit, less a margin. */
export const EXPORT_TOL = 0.0045;
export const PREVIEW_TOL = 0.03;
/** The surface check's reference: the same piece, far more finely tessellated (a smooth blend excepted: see ops.ts, smoothUnion). */
export const REFERENCE_TOL = 0.0015;
