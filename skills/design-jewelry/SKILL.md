---
name: design-jewelry
description: Design a casting-ready ring with someone who makes jewelry, using the flo2-cad tools. Use when a person wants to design, resize, preview, check or export a ring, a solitaire, a bezel or prong setting, a band, a ring with petals, leaves or a flower on it, or any other shape (a cabochon, a signet, a sculpted piece) written as a program, or a picture laid on as a relief (a lion's face on a signet), for printing and casting. It covers what to ask, units, stone sizes from a grading report, adding shapes such as cupped petals, writing a piece as a program, refusals and what to thicken, and platinum.
compatibility: Needs the flo2-cad MCP server, which provides start_piece, change_piece, preview_piece, check_piece, export_for_casting and describe_piece.
---

# Design a ring with a jeweler

Work in the person's terms. Talk about the band, the head, prongs, the bezel, the stone, the girdle and crown, the
ring size, the metal and the caster. Say "the picture", not "the render", and "the ring's recipe", not "the tree".
The tools do the geometry, and your job is the conversation.

## The loop

1. **Find out what they want before you start.**
   - The **ring size and its system**: US, UK or EU. Never guess the system, because "7" is a different ring in each.
   - The **stone**: its shape (round or emerald cut) and its **measured size from its grading report**. A round
     needs its diameter and depth. An emerald cut needs its length, width and depth. The carat weight alone is not
     enough.
   - The **setting**: prongs (4 or 6) or a full bezel.
   - The **metal**: sterling silver, 14k or 18k gold, or platinum 950.
   - The **band**: its profile (comfort fit, half round, flat or round wire), width and thickness.

   You do not need everything first. The tools fill safe defaults and say what is a placeholder.

2. **Start the piece.** Call `start_piece` with a template and the ring size.
   - `solitaire_ring` is a round stone in prongs.
   - `plain_band` is a band with no stone.
   - `emerald_bezel_solitaire` is Emily's design: an emerald cut in a full platinum 950 bezel, set east-west (its long
     side across the finger), on a plain round band.

   Anything else they told you goes in the same call.
3. **Show the picture every time.**
   - `start_piece` and `change_piece` return a preview picture. Show it, and say in a sentence what changed.
   - If the reply says a stone size is a PLACEHOLDER, tell them, and ask for the grading report's numbers.
4. **Change it** with `change_piece` and `set`. Name only what changes, for example
   `{"stone_length": "8.21 mm", "stone_width": "6.02 mm", "stone_depth": "4.05 mm"}`, `{"prong_count": 6}`,
   `{"stone_setting": "bezel"}`, `{"metal": "gold_18k_yellow"}`, or `{"ring_size": {"system": "UK", "size": "N"}}`.
5. **Check it** with `check_piece` when they think it is done, or before you export.
6. **Export it** with `export_for_casting`.
   - You get the STL, a 3MF and the check report. These are the files they send to a caster or print in castable
     resin.
   - The stone is never in the files.

## When they will act on the answer

Some questions are decisions, not chat: will the stone fit, what will it weigh or cost, will this wall cast, does it
fit the budget. The person will buy, cut or cast on your answer, so handle it as a decision.

1. **Record it as a decision** in their design, if a design tool is connected. Say what was asked and what was chosen.
2. **Work the numbers with a calculator**, if a calculator such as flo2-calc is connected, rather than in your head.
3. **Give every number its source.**
   - The piece's sizes come from `describe_piece`, exactly as it reports them: the seat across at the girdle and its
     clearance a side, the bezel's wall, lip and outside size, each prong at its narrowest, the band's inner and outer
     diameter, the room under the stone, and the weight in each metal.
   - The stone's sizes come from its grading report. A price, a budget or a deadline comes from the person, with its
     date.
   - Never an assumed or remembered value. If a number is missing, ask for it.
4. **Link the kept computation to the decision**, and quote its result there.

With no calculator, still record the decision if you can, name each number's source, and show the person the sum.

For example, "will my 7.5 mm stone fit this bezel?" `describe_piece` says the seat is 7.60 mm across, with 0.05 mm
clearance a side. The fit is 7.5 mm (the stone's report) in 7.60 mm (the engine), not 7.5 mm in a seat you assumed.

**A new piece starts in a new design.** If a design tool is connected, start a new design for a new piece, or ask the
person which design it belongs in. Never pick an existing design for them: a new ring once went into an unrelated
design that way.

## Units: always millimetres, always written with the unit

- Every measurement you send is a string with its unit: `"1.4 mm"`, never `1.4`, and never inches.
- If the person gives inches or centimetres, convert the number yourself and show them the conversion before you
  send it. For example: "0.25 in × 25.4 = 6.35 mm, so I'll use 6.35 mm."
- A ring size is always `{"system": "US" | "UK" | "EU", "size": ...}`.
- A carat weight is written like `"2.00 ct"`. It is kept for reference only.
- If a call comes back as a malformed call, the message names the exact field and how to fix it. Fix that field and
  call again.
- In a **program** (below), a bare number is a length in millimetres (or an angle in degrees); the piece file says
  `"units": "mm"`. A string still carries its unit, and inches are still refused: convert them yourself.

## Stones are sized from what was measured

- Use the numbers on the stone's **grading report** (GIA, IGI and so on): length × width × depth in mm. A round has
  diameter and depth.
- Do not size a stone from a carat chart. Two 2-carat emerald cuts can differ by half a millimetre, and the seat must
  fit this stone.
- Until the real numbers are in, the stone size is a placeholder:
  - the template's typical stone is 6.5 × 4.0 mm for a 1 ct round, or 8.5 × 6.0 × 4.1 mm for a 2 ct emerald cut;
  - every reply and the picture say "placeholder";
  - the checks are only as true as the stone size, so say so.
- The **orientation** of an emerald cut: `east_west` puts its long side across the finger, and `north_south` puts it
  along the finger.

## When the export is refused

A refusal is a normal answer, not an error. The engine refuses to release a file that would not cast. Each limit has
a cited source, and every check runs on the exact file it would have sent.

- The reply says **what to thicken and where**. For example: "Thicken prong 2 of 4 at 4:30: its narrowest section
  is 0.47 mm, where the seat for the stone is cut, and it needs 1.0 mm."
- Positions are clock positions seen from above, with the finger pointing to 12 o'clock.
- Tell the person plainly and offer the change the reply suggests. Make it with `change_piece`, show the new
  picture, and check again.

The limits, so you can explain them:

| Limit | Value |
|---|---|
| Walls (and the bezel rim) | at least 0.8 mm |
| Ring band | at least 1.0 mm thick |
| Each prong at its narrowest | at least 1.0 mm, because a prong is held at one end only |
| Details | at least 0.35 mm |
| Gaps | at least 0.3 mm, or 0.8 mm in platinum |
| The surface | within 0.01 mm of the intended shape |
| A bezel lip | covers 50 % to 75 % of a faceted stone's crown; on a cabochon, rises at least a third of its dome (J. Cogswell, Creative Stonesetting) |
| Each prong's reach over the girdle | at least 0.15 mm |
| A petal or leaf (a thickened sheet) | at least 0.8 mm, measured square to its surface |

A **too-thin prong or bezel can still be drawn and previewed**. It just will not export. Previews are never refused.

## Petals, leaves and other shapes of your own

The templates make bands and solitaires. Anything else, such as a flower on a ring, is added to the ring's recipe as
shapes. `describe_piece` lists every shape and operation with its settings.

- **How.** Add nodes to the recipe's top node (its `root`) `children`, beside the band, and pass the whole edited
  recipe as `tree` to `change_piece`. A node is `{"id": "petal_1", "op": "thicken", "params": {...}}`. Ids are
  lower-case letters, digits and `_`, unique in the piece.
- **Where.** X runs across the hand, Y along the finger, and Z up through the top of the ring. The top of the band is
  at z = half the band's outer diameter, which `describe_piece` gives (half the inner diameter + the band thickness).
  Every shape starts at the origin; place it with `translate` and `rotate`.
- **Name the parts so you can talk about them.** A refusal names a shape by its id ("the sheet "petal_3""), and
  `set` reaches its settings as `"<id>.<setting>"`, for example `{"petal_3.thickness": "1.0 mm"}`.

### Cupped and curled petals and leaves: `thicken`

`thicken` makes a thin sheet with a stated thickness that follows a curved surface, like a petal domed from sheet
metal. Its edges stay square to the surface, so nothing thins to a knife edge.

- `outline`: the petal laid flat, as you would cut it from sheet, as `[["x mm", "y mm"], ...]` round its edge. Put its
  base near the origin and its tip along +y.
- `thickness`: measured square to the surface. Use at least 0.8 mm for casting, and 1.0 mm to be comfortable.
- `surface`:
  - `"sphere"`: a cup, curved the same every way. Good for cupped petals.
  - `"cylinder"`: a curl, curved one way round `axis`. With `"axis": "x"` the petal curls up along its length. With
    `"axis": "y"` it is fluted, with a channel down its middle.
  - `"flat"`.
- `radius`: how tightly it curves. Smaller is deeper. It must be at least 5 times the thickness, so 5 mm or more for a
  1.0 mm petal; 7 to 10 mm makes a gentle cup.
- `round_corners` (optional): rounds every corner of the outline, so no tip is sharp. About 0.5 mm suits a petal.

The surface touches the origin there and rises away from it, upward, and the sheet's middle lies on it. Lengths
along the petal are kept, so a 7 mm petal stays 7 mm long however much it is cupped. On a sphere its width narrows a
little as it curves away: 84 % at 60° round. The outline must stay within 90° round a sphere (a quarter of the way)
and 150° round a cylinder; the refusal says what radius would do.

**A flower on a ring.** Five cupped petals round a centre disc, on a post from the top of a US 7 band 1.8 mm thick
(its top at z = 10.46 mm). Tilt each petal about its own base, then move it out, then turn it into place. Bury the
petal bases in the disc, and keep the petals clear of each other, or the gap check refuses the crevice between them.

```json
{"id": "post", "op": "translate", "params": {"z": "9.86 mm"}, "children": [
  {"id": "post_rod", "op": "cylinder", "params": {"radius": "1.2 mm", "height": "2.6 mm"}}]},
{"id": "flower", "op": "translate", "params": {"z": "12.46 mm"}, "children": [
  {"id": "disc_lift", "op": "translate", "params": {"z": "-1.2 mm"}, "children": [
    {"id": "disc", "op": "cylinder", "params": {"radius": "2.6 mm", "height": "2.4 mm"}}]},
  {"id": "petal_1_turn", "op": "rotate", "params": {"z": "0 deg"}, "children": [
    {"id": "petal_1_place", "op": "translate", "params": {"y": "1.8 mm"}, "children": [
      {"id": "petal_1_tilt", "op": "rotate", "params": {"x": "20 deg"}, "children": [
        {"id": "petal_1", "op": "thicken", "params": {
          "outline": [["0.5 mm", "0 mm"], ["1.05 mm", "0.88 mm"], ["1.53 mm", "1.75 mm"], ["1.91 mm", "2.63 mm"],
                      ["2.14 mm", "3.5 mm"], ["2.2 mm", "4.38 mm"], ["2.08 mm", "5.25 mm"], ["1.73 mm", "6.13 mm"],
                      ["0.5 mm", "7 mm"], ["-0.5 mm", "7 mm"], ["-1.73 mm", "6.13 mm"], ["-2.08 mm", "5.25 mm"],
                      ["-2.2 mm", "4.38 mm"], ["-2.14 mm", "3.5 mm"], ["-1.91 mm", "2.63 mm"], ["-1.53 mm", "1.75 mm"],
                      ["-1.05 mm", "0.88 mm"], ["-0.5 mm", "0 mm"]],
          "thickness": "1.0 mm", "surface": "sphere", "radius": "7 mm", "round_corners": "0.5 mm"}}]}]}]}]}
```

Add `petal_2` to `petal_5` the same way, turned 72, 144, 216 and 288 deg. That flower passes every casting check in
silver and exports.

**When a petal is refused**, the reply names it and says what to set:

- "Thicken the sheet "petal_1": measured square to its surface it is 0.6 mm ... Change: set
  {"petal_1.thickness": "1 mm"}."
- A thin place across a petal that is thick enough means a pointed tip or a thin neck in its outline, or a thin wedge
  where it meets other metal. Round the outline (the reply gives a `round_corners`), or move the petal so it meets
  the other metal squarely.
- Where two petals meet in a thin wedge, the reply names both. Move or turn them apart, or overlap them squarely.

## Any other shape: write the piece as a program

The templates, parts and operations above cover bands, solitaires and petals. For anything else (a cabochon, a
signet, a lion's face, a ship) do not wait for a new feature: write the piece as a short JavaScript program. The
engine runs it confined, keeps it as the piece's file, and previews, checks and exports it like any piece.

- **How.** `start_piece` with `"program"` (and `"name"`, `"metal"`, `"shrinkage"` if you like) instead of a
  template. `change_piece` with the whole edited `"program"` makes the next version. A template piece can go on as a
  program: `describe_piece` shows it written as one, ready to edit.
- **What it can call.** `describe_piece` lists everything, with settings. In short:
  - the **library**, today's parts: `ringShank`, `roundStone`, `emeraldStone`, `cabochon`, `stone` (a stone of your
    own shape), `prongHead`, `bezel`, `thicken`, `relief` (a picture as a relief, below), and `op` (any operation node
    a tree can hold). They take the same settings and defaults as `start_piece`, and each reads back its dimensions as
    `.dims` (the seat, the bezel, each prong, the band), so a fit is worked from the engine's numbers;
  - the **kernel**: `sphere`, `cylinder`, `box`, `torus`, `sweep`; `circle`, `rect` and `polygon` (2D, with
    `.offset`); `extrude`, `revolve`, `hull`; `union`, `difference`, `intersection`, `smoothUnion` (a fillet); and on
    a solid `.translate`, `.rotate`, `.mirror`, `.scale`, `.named("...")`, `.bounds()`, `.volume()`. `segments(r)`
    says how finely to draw a curve you compute, so the casting file is smooth enough.
- **Rules.** End with `return <the piece>;`. The ring's frame is fixed: the band stands round the Y axis through the
  origin, and the setting upright on top of it at +Z. The checker measures them there, so the band only turns about
  Y and the setting only moves or turns about Z. A piece holds one band and one setting from the library; build
  anything more from the kernel. A stone is never metal.
- **When it fails**, the reply names the line and what to fix ("program: line 3: rotate([20, 0, 0]): would tip the
  stone setting off upright"), and nothing changes. A program that runs too long or uses too much memory is stopped
  and refused, with the limit it hit. `console.log` lines come back with the reply.
- **Name the shapes you add** (`.named("crest")`), so a refusal can say "the shape named "crest"".
- **A cabochon**: `cabochon({ diameter, height })`, or `{ length, width, height }` for an oval, with the base size and
  the dome's height (flat base to top) from the person's own measurement of their stone, never a chart. A domed stone
  you draw yourself is declared with `stone(shape, { kind: 'cabochon' })`; either way its bezel is checked by the
  cabochon's lip rule (at least a third of the dome), which the engine never guesses from the shape.

**A worked example: a cabochon in a bezel**, its stone drawn in a few lines (`cabochon({ diameter: 8, height: 2.6 })`
makes the same stone in one call).

```js
// An 8 mm round cabochon moonstone, 2.6 mm high, in a bezel on a US 7 band.
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
return union(band, setting);
```

It passes every casting check in silver and exports. `stone()` reads the girdle where the dome is widest (its flat
base), so its dome is its full 2.6 mm height. `kind: 'cabochon'` declares it a cabochon, so its bezel lip is held to
the cabochon's rule: it rises at least a third of the dome, 0.87 mm here (J. Cogswell, Creative Stonesetting). The
auto lip rises 1.56 mm (60 %); a lower bezel, down to that third, passes too. Left undeclared, a dome is checked as a
faceted stone, by 50 % to 75 % of its crown.

## A picture as a relief: `relief`

For a sculpted face that no program draws well by numbers (a lion's head on a signet, a rose, a crest), lay a
**height image** onto the piece. White is the highest point, black the lowest; colour is read by its brightness, and
a transparent pixel is the lowest.

- **The image.** A PNG kept beside the piece: on flo2, a file the design keeps, named as `list_my_design_files` gives
  it (the person uploads it, or another tool makes it). It is 8-bit grayscale (RGB and RGBA are read by brightness), at
  most 2048 pixels a side. Name it in quotes in the program, exactly as kept, so the engine can find it before the
  program runs.
- **Where it goes.** `relief({ id, image, width, height, depth, mode, surface, radius, base, smoothing })`, or an
  `"op": "relief"` node in a tree.
  - `"surface": "flat"` (the default) lies in the XY plane, centred on the origin and facing +Z, with the image's top
    towards +Y. Move it onto a plate with `.translate`.
  - `"surface": "cylinder"` wraps it round the band, its surface at `radius`, centred on the top. Set `radius` to the
    band's outer radius (`band.dims.outerDiameterMm / 2`). Then `width` runs round the band and `height` along the
    finger.
- **Raised or sunk.** `"raised"` (the default) stands up to `depth` above its surface. Its `base` (default 1 mm) is a
  back that sinks into the metal under it, so it joins that metal.

  `"sunk"` carves the picture up to `depth` into its own back, so make the relief the face itself: a signet's plate,
  or a panel laid on the band. Its base must be more than its depth, and the floor (base less depth) needs the 0.8 mm
  wall.
- **Smoothing.** The picture is smoothed so that no ridge or hollow is finer than `smoothing` and no slope is steeper
  than 45°.
  - The default for `smoothing`, and the least it may be, is 0.35 mm, the casting detail limit.
  - A deeper relief is therefore a softer one. For crisper detail, use less depth.
  - A picture finer than that is smoothed, never refused. Tell the person when the fine detail will not survive.
- **The check** measures it like any other metal (walls, details, gaps and the surface) and names a thin place by the
  relief's id. The check report names each image by its file and sha256, so the casting file's source is on record.

**A worked example: a lion's face on a signet.**

```js
// A signet ring, US 8, with a lion's face raised 0.8 mm on its plate, from the
// height image lion-face.png kept beside the piece (white is highest).
const band = ringShank({ ring_size: { system: 'US', size: '8' }, band_width: 3, band_thickness: 1.8 });
const rin = band.dims.innerDiameterMm / 2, rout = band.dims.outerDiameterMm / 2;

// The plate: a 12 x 10 mm block on top of the band, its underside cut clear of the finger.
const top = rout + 1.5;
const plate = difference(box(12, 10, 4).translate([0, 0, top - 2]), cylinder(rin, 30, { center: true }).rotate([90, 0, 0]));

// The face, 10 x 8 mm, 0.8 mm at its highest; its 0.5 mm back sinks into the plate.
const lion = relief({ id: 'lion', image: 'lion-face.png', width: 10, height: 8, depth: 0.8, base: 0.5 }).translate([0, 0, top]);
return union(band, plate, lion);
```

**The honest limit.** The engine lays the picture it is given. It does not invent one.

- A convincing lion's face comes from a good height image: a depth map of a sculpt or a photo, or a grayscale drawing
  where brightness means height.
- An ordinary photo is not a height map. Its shadows and colours would become bumps.
- If the person has only a photo, say so plainly, and ask for a height image made from it (by an artist, or by a
  depth-estimation tool) rather than carving the photo as it is.

## Platinum

- Platinum 950 melts at about 1780 to 1795 °C and is cast at about 1850 to 2200 °C, with special investment and an
  induction caster.
- So a platinum piece goes to a **specialist platinum caster**, not a home or local silver-and-gold setup. Every
  platinum reply says so, and you should say it too before they order.
- Silver and gold can be cast at home or locally (castable resin or lost wax).

## Shrinkage

- Metal shrinks about 1 to 1.5 % in casting.
- The allowance is per piece and off by default: `"shrinkage": "on"` uses the metal's figure (1.5 %), or give one
  such as `"1.2 %"`.
- Every export says whether it was applied. Ask the caster before turning it on: many casters compensate themselves.

## Picking up later

- Each change returns the ring's recipe (its tree), and flo2 keeps every version as `<name>.tree.json`. A piece
  written as a program is kept the same way: its file holds the program.
- To continue in a new conversation, pass that file as `tree` to any tool.
- `describe_piece` reads the piece back in jeweler's terms: its size, weight in each metal, the dimensions it is built
  to (the seat, the bezel or prongs, the band), and every setting you can change.
