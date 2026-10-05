// What a program can call, in the words an agent reads (describe_piece prints it; the
// skill and the README say the same). Kept beside library.ts, which is what it describes.

import type { ProgramLimits } from './run.js';

export const PROGRAM_RULES = [
  'A program is JavaScript (strict mode) that builds the piece and ends with `return <solid>;`. Every bare number is a length in mm, or an angle in degrees where an angle is asked for; a string carries its unit ("1.2 mm"), and inches or any other unit are refused: convert them yourself.',
  'It runs confined, in a separate process with a time and memory limit, and can reach nothing but the calls below: no require or import, no process, files, network or timers. It cannot wait for anything (no await). console.log lines come back with the reply. It is run once for a picture and twice for a check, so it must build the same piece every time; Math.random is seeded the same on every run.',
  'Frame: X across the hand, Y along the finger, Z up through the stone. A ring shank stands round the Y axis through the origin, and a stone setting stands upright on top of it at +Z. The checker measures them there, so a band may only turn about Y, and a setting may move anywhere and turn only about Z: anything else is refused, naming the part. scale() and hull() refuse a solid holding a library part.',
  'A piece holds at most one ring shank and one stone setting; build anything beyond that from the kernel. A stone is never metal and never in a casting file.',
];

export const PROGRAM_CALLS_GUIDE = [
  'LIBRARY (today\'s parts; each takes start_piece\'s settings and its defaults, checked the same way, and reads back its dimensions as `.dims`):',
  '- ringShank({ ring_size: {system: "US", size: "7"}, band_width, band_thickness, band_profile }) -> the band; .dims has innerDiameterMm, outerDiameterMm, widthMm, thicknessMm.',
  '- roundStone({ diameter, depth, carat? }), emeraldStone({ length, width, depth, orientation?, carat? }) -> a stone, sized from its MEASURED dimensions.',
  '- cabochon({ diameter, height, name? }) or cabochon({ length, width, height, orientation?, name? }) -> a cabochon from its MEASURED flat base (round or oval) and dome height, base to top. A bezel round it is checked by the cabochon\'s lip rule: it rises at least a third of the dome (J. Cogswell, Creative Stonesetting).',
  '- stone(solid, { name?, kind? }) -> a stone of your own shape (a cabochon, a pear): its girdle is where it is widest; it is never metal. kind: "cabochon" declares a domed stone, checked by the cabochon\'s lip rule; left out, the stone is faceted and its lip covers 50-75 % of its crown. The engine never guesses which from the shape.',
  '- prongHead({ stone, on: band, prong_count, prong_thickness, prong_grip, culet_clearance, prong_overrides }) and bezel({ stone, on: band, wall, lip, culet_clearance }) -> the setting round the stone, on top of the band (leave out `on` for a setting standing on the XY plane, as on a pendant). .dims has the seat, the outside, the bezel or each prong, and the culet clearance, as describe_piece reports them.',
  '- thicken({ id, outline: [[x, y], ...], thickness, surface: "flat" | "sphere" | "cylinder", radius, axis, round_corners }) -> a curved sheet (a petal, a leaf), checked square to its surface.',
  '- relief({ id, image: "lion.png", width, height, depth, mode: "raised" | "sunk", surface: "flat" | "cylinder", radius, base, smoothing }) -> a grayscale height image (a PNG kept beside the piece, named in quotes; white highest) as one solid: from its back, base below its surface (default 1 mm), to its face, raised up to depth or sunk that deep. Flat lies in XY facing +Z, centred; cylinder wraps round the Y axis at radius (the band\'s outer radius lays it on the band\'s top). Smoothed so no ridge or hollow is finer than smoothing (default and least 0.35 mm) and no slope is steeper than 45°. The check names it by its id.',
  '- op(node) -> any operation node of a tree, as JSON with units (describe_piece of a tree lists them): what a tree can hold, a program can hold.',
  'KERNEL (general shapes, numbers in mm and degrees):',
  '- sphere(r), cylinder(r, h, { top, center }), box(x, y, z) (centred), torus(R, r), sweep(r, [[x, y, z], ...], { closed }) (a round wire).',
  '- circle(r), rect(x, y, { center }), polygon([[x, y], ...]) -> 2D profiles, with .offset(d, { join: "round" | "square" | "miter" }), .add, .subtract, .intersect, .translate([x, y]), .rotate(deg), .scale(f), .mirror([x, y]), .hull(), .bounds(), .area().',
  '- extrude(profile, h, { twist, scale_top, center }), revolve(profile, { degrees }) (x is the distance from the Z axis, y the height).',
  '- union(a, b, ...), difference(a, b, ...), intersection(a, b, ...), hull(a, b, ...), hullPoints([[x, y, z], ...]), smoothUnion(radius, a, b, ..., { name }) (a fillet; it blends spheres, cylinders, boxes, tori, sweeps, their moves and unions).',
  '- on a solid: .translate([x, y, z]), .rotate([x, y, z]), .mirror("xy" | "yz" | "xz" | [x, y, z]), .scale(f | [x, y, z]), .add(b), .subtract(b), .intersect(b), .named("flange") (the check names a thin place by it), .bounds(), .volume(), .slice(z) and .project() (2D profiles), .trim([x, y, z], offset).',
  '- segments(r): how many straight pieces a circle of radius r gets at this build\'s fineness. Draw curves you compute yourself with it, so the casting file is as smooth as the check asks.',
];

export function programGuide(limits: ProgramLimits): string {
  return [...PROGRAM_RULES, `Limits: ${limits.seconds} s and ${limits.memoryMiB} MiB for each evaluation.`, ...PROGRAM_CALLS_GUIDE].join('\n');
}

/** A worked example: a picture raised on a signet's plate (skills/design-jewelry/SKILL.md quotes it; test/relief.test.ts checks it). */
export const RELIEF_EXAMPLE = String.raw`// A signet ring, US 8, with a lion's face raised 0.8 mm on its plate, from the
// height image lion-face.png kept beside the piece (white is highest).
const band = ringShank({ ring_size: { system: 'US', size: '8' }, band_width: 3, band_thickness: 1.8 });
const rin = band.dims.innerDiameterMm / 2, rout = band.dims.outerDiameterMm / 2;

// The plate: a 12 x 10 mm block on top of the band, its underside cut clear of the finger.
const top = rout + 1.5;
const plate = difference(box(12, 10, 4).translate([0, 0, top - 2]), cylinder(rin, 30, { center: true }).rotate([90, 0, 0]));

// The face, 10 x 8 mm, 0.8 mm at its highest; its 0.5 mm back sinks into the plate.
const lion = relief({ id: 'lion', image: 'lion-face.png', width: 10, height: 8, depth: 0.8, base: 0.5 }).translate([0, 0, top]);
return union(band, plate, lion);`;

/** A worked example: a cabochon in a bezel on a band, with no feature of its own in the engine. */
export const CABOCHON_EXAMPLE = String.raw`// An 8 mm round cabochon moonstone, 2.6 mm high, in a bezel on a US 7 band.
const band = ringShank({ ring_size: { system: 'US', size: '7' }, band_width: 2.2, band_thickness: 1.6 });

// The cabochon: a quarter ellipse from its edge up to its top, turned round the Z axis.
const r = 4, h = 2.6, n = Math.ceil(segments(r) / 4);
const profile = [[0, 0]];
for (let i = 0; i <= n; i++) {
  const a = (i / n) * Math.PI / 2;
  profile.push([r * Math.cos(a), h * Math.sin(a)]);
}
const moonstone = stone(revolve(polygon(profile)), { name: 'moonstone', kind: 'cabochon' });

// The bezel seats it on a flat ledge and rises over its curve.
const setting = bezel({ stone: moonstone, on: band, wall: 1.0 });
return union(band, setting);`;
