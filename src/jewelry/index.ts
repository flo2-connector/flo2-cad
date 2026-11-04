// THE JEWELRY LAYER'S BOUNDARY (req:flo2-cad-designs-any-cast-piece: jewelry was flo2-cad's
// first use, not its only one). flo2-cad is a general engine for cast pieces; jewelry is a layer
// on it, and this file is the only way in. Nothing outside src/jewelry/ imports any other file
// of it, and the general checker (src/checker/) and the limit profiles (src/limits/) import
// nothing of it at all (test/jewelry-boundary.test.ts holds both).
//
// What the layer holds:
//   · its RULES (rules.ts): how a stone is held and seated, each cited: a prong's grip over the
//     girdle, a bezel's lip over a faceted stone's crown or a cabochon's dome, the seat's
//     clearance, the template stones' placeholder sizes and a head's defaults;
//   · its CHECKS (checks.ts): each prong's thickness and grip, a bezel's wall and lip, run by the
//     general checker as a CheckLayer only on a piece that declares a stone or a setting;
//   · its ADVICE (fixes.ts): what to change when one of those fails, for a tree or a program.
// The jewelry PARTS the library builds (the ring shank, the prong head, the bezel, the stones'
// shapes) are still the library's, src/library/, built by the kernel.

import { jewelryChecks } from './checks.js';
import { SETTING } from './rules.js';

export { BEZEL_CLEARANCE, HEAD_DEFAULTS, SEAT_CLEARANCE, SETTING, STONE_DEFAULTS } from './rules.js';
export { declaresSetting, type SettingRules } from './checks.js';
export { failingSettingFeatures, isSettingCheck, programSettingFix, treeSettingFix, treeSettingWallFix, type ProgramHead, type TreeHead } from './fixes.js';

/** The jewelry layer as the general checker runs it, holding a setting to the layer's cited rules. */
export const JEWELRY_CHECKS = /* @__PURE__ */ jewelryChecks(SETTING);
