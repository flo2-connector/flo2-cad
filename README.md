# flo2-cad: the Agent CAD engine

flo2-cad is an MCP server that a chat agent drives to design cast pieces that are ready for casting: rings and other
jewelry first, and any shape at all written as a program. The person talks to the agent and sees a picture after each
change. The engine refuses to release an STL or 3MF until the file, as written, passes every casting check against
limits that fit the piece's material, process and size, each cited. It is a general engine: jewelry is its first
**limit profile** and a **layer** on it (`src/jewelry/`), not the whole of it. It runs in three places:

- on flo2.io, behind the flo2 connector;
- on a laptop, as an MCP server or as a plugin;
- in Docker.

The spec is the flo2-hosted design "Agent CAD engine" (`38eca9450f850bf7`). Build agents start from
[AGENTS.md](AGENTS.md); agents that design jewelry start from
[skills/design-jewelry/SKILL.md](skills/design-jewelry/SKILL.md). On flo2.io, a piece made end to end (planned in the
person's design, its numbers from calc records, built, checked, recorded and handed off) starts from flo2's own skill
design-a-physical-piece, which this skill points to since 0.4.1.

**Limits follow the material, the process and the size** (0.3.0; see
[Limits: named profiles, no verdict, or your own](#limits-named-profiles-no-verdict-or-your-own)). A piece states what it
is cast in and how; its size is measured. It is checked against the named profile that covers all three, or against
limits the person supplies with their sources. With neither, the answer is **no verdict**, never another profile's
numbers.

**First increment: one solitaire ring, end to end.**

- **Band:** in a named ring size (US, UK or EU), with one of four profiles.
- **Head:** a 4- or 6-prong head, or a full bezel.
- **Stone:** round or emerald cut, sized from its measured dimensions on its grading report.
- **Metal:** sterling silver, 14k or 18k gold, or platinum 950.
- **The loop:** preview, check, export.
- **Refusals:** a deliberately too-thin prong, or a too-thin bezel wall, is refused, and the refusal says what to
  thicken and where.
- **Emily's design is a template.** `emerald_bezel_solitaire` is a 2 ct emerald cut in a full Pt950 bezel, set
  east-west, on a plain round band. Its stone size is a placeholder (a typical 2.00 ct, 8.5 × 6.0 × 4.1 mm) until
  her stone's measurements are given. The replies and the picture both say so.

**Third increment, general CAD (in progress):** the agent can write a piece as a short JavaScript **program** over
the kernel and the jewelry library, which the engine runs confined and keeps as the piece's file. See
[A piece written as a program](#a-piece-written-as-a-program). How a program is confined is PROPOSED in the design
(`dec:idea-how-a-program-is-confined`) and waits for the owner's word.

## Tools

The seam with flo2 is fixed, so this list is final for the increment. Any change to it is a change to both repos.

| Tool | Class | Arguments | Returns |
|---|---|---|---|
| `start_piece` | write | `template` (`solitaire_ring` \| `plain_band` \| `emerald_bezel_solitaire`), `ring_size` `{system: US\|UK\|EU, size}`; optional settings (below), `name`, `preview`. Or, instead of a template: `program` (with `name`, `metal`, `shrinkage`) | summary (with the seat and the head's outside size), the tree as text, `<name>.preview.png`, `<name>.tree.json` |
| `change_piece` | write | `tree?`, `set?` (any setting, or `"<part>.<setting>"`), `program?` (the whole piece as a program; a template piece goes on as one), `preview?` | what changed, the summary, the tree as text, `<name>.preview.png`, `<name>.tree.json`; revision + 1 |
| `preview_piece` | read | `tree?`, `views?` (1 to 4 of `three_quarter`, `front`, `side`, `top`, `setting_closeup`) | `<name>.preview.png` |
| `check_piece` | read | `tree?` | pass or fail for each limit, what is wrong and the part it is in, what to thicken and where, and where the limits came from; or no verdict, what did not match and how to go on; `<name>.check.json` |
| `export_for_casting` | write | `tree?` | if every check passes: `<name>.stl`, `<name>.3mf` and `<name>.check.json`. If not, or with no verdict: `<name>.check.json` and what to change (`isError: false`) |
| `describe_piece` | read | `tree?` | the piece in jeweler's terms, the dimensions it is built to (below), its weight in each metal, every setting, the tree |

**Settings.** `start_piece` takes these, and so does `change_piece` under `set`:

- `metal` (one of the four), or `material` (any other, by name, e.g. `"bronze"`)
- `process` (`lost_wax`, or another in words; left out, lost wax is assumed)
- `limits` (the caster's own, each with its source; below)
- `ring_size`
- `band_width`, `band_thickness`, `band_profile` (comfort_fit, half_round, flat, round)
- `stone_setting` (prong_head, bezel, none)
- `stone_shape` (round, emerald)
- `stone_diameter`, `stone_length`, `stone_width`, `stone_depth`, `stone_carat` (for reference only)
- `stone_orientation` (east_west, north_south)
- `prong_count` (4, 6), `prong_thickness`
- `bezel_wall`, `bezel_lip`
- `shrinkage` (`off` \| `on` \| `"1.2 %"`)

**Shapes of your own.** Pass an edited `tree` to `change_piece` with operation nodes added beside the band:
primitives, booleans, transforms, `extrude`, `revolve`, `sweep`, `smooth_union`, and `thicken`, which gives a thin
sheet, such as a cupped or curled petal or a leaf, a stated thickness along a sphere, a cylinder or a plane, its edges
square to the surface. `describe_piece` lists every operation with its settings, and the design-jewelry skill walks
through a five-petal flower.

**A stated thickness means what it says.** A thickened sheet is built at least as thick as stated, measured square to
its surface, at any thickness, radius and size. The flat facets of a curved sheet's convex face would cut into it by up
to their chord sagitta, so that face is built further out by exactly the largest sagitta its own facets have, computed
from the facets actually built. Both faces also move out by a float32 allowance of 2.4 × 10⁻⁷ of the piece's size, so
the STL as written holds the bound too. A sheet comes out at most the sagitta plus that allowance over: under twice the
chord tolerance, 0.009 mm in a casting file (about 0.008 mm on a sphere and 0.004 mm on a cylinder). `src/library/thicken.ts`
(AT LEAST THE STATED THICKNESS) gives the proof, and `test/thicken.test.ts` reads every face triangle of ring petals
and of a 100 mm sculpture leaf, 0.5 to 5 mm thick, to hold it.

**The dimensions a check or a decision rests on.** `describe_piece` reports, in mm, the figures the build itself
uses: the band's inner and outer diameter, width and thickness; the seat's size across at the girdle and its clearance
a side; a bezel's wall, outside size, the lip height it works out ("auto" is 60 % of the crown) and its height above
the band; each prong's thickness, its narrowest section where the seat is cut, and its reach over the girdle; and the
culet clearance. `start_piece` and `change_piece` add one line with the seat and the head's outside size. One function,
`pieceDims` in `src/library/build.ts`, works these out, and the build makes its geometry from the same numbers, so
what is reported is what is built. A seat is the stone grown by 0.03 mm all round, and a bezel's inner wall stands
0.05 mm off the girdle. For a 7.5 mm round, 4 mm deep, in a bezel with a 1.0 mm wall:

```
- Seat: 7.60 mm across inside the bezel at the girdle, for the 7.50 mm stone, so 0.05 mm clearance a side.
- Bezel: wall 1.00 mm thick and 9.60 mm across outside; its lip rises 0.63 mm above the girdle (auto: 60 % of the
  stone's 1.05 mm crown); it stands 3.88 mm above the top of the band.
- Culet clearance: 0.30 mm from the stone's point down to the top of the band.
```

`test/dimensions.test.ts` holds each figure to the piece as built: measured by rays on the built metal and stone, or
by the independent checker on the written file.

**Units and errors:**

- A length is a string with its unit, like `"1.4 mm"`. In a program, a bare number is a length in mm (an angle in
  degrees), as its file states (`"units": "mm"`); a string there still carries its unit.
- A bare number, inches or any other unit is a malformed call. It comes back with `isError: true`, and the message
  names the field path and the conversion, for example `set.stone_diameter: "0.25 in" … 0.25 in × 25.4 = 6.35 mm`.

**Files** come back inside the reply:
`{"type":"resource","resource":{"uri":"cadfile:///<name>","mimeType":...,"blob":...}}`. One reply carries at most
11 MB of raw bytes. `flo2-cad --list-tools` prints the full JSON Schemas.

**Protocol eras.** The server speaks both MCP eras from one entry point (`@modelcontextprotocol/server` 2.3.0):

- the 2025 `initialize` handshake, which is what flo2's tool-server plug speaks;
- the 2026-07-28 revision with `server/discover`.

Moving from the v1 SDK changed nothing in the tool list, its schemas or the replies. A test lists the same six tools
in both eras.

## A piece written as a program

For any shape the templates and operations do not make (a cabochon, a signet's crest, a ship's hull), the agent
writes the piece as a short JavaScript program (`dec:idea-how-flo2-cad-becomes-general-enough-to-model-anything`,
option A, settled 2026-10-05). Nothing is added to the engine per shape.

**The interface.** One new argument, `program`, on `start_piece` (instead of `template`) and on `change_piece` (the
next version, or a template piece going on as a program). There is no new tool: flo2's door allowlists tool names
and passes arguments through, so the same six names serve both kinds of piece. The program is kept as the piece's
file, `<name>.tree.json`, which flo2 already versions and passes back as `tree`; it is told apart by its format:

```json
{"format": "flo2-cad.program/1", "name": "moon", "revision": 1, "metal": "sterling_silver_925",
 "shrinkage": "off", "units": "mm", "program": "const band = ringShank({ ... }); ... return union(band, setting);"}
```

`preview_piece`, `check_piece`, `export_for_casting` and `describe_piece` take it as they take a tree. `set` on a
program piece takes only `name`, `metal` (or `material`), `process`, `shrinkage` and `limits`; everything else is in
the program. `describe_piece` of a
template piece shows it written as a program (the same piece, by the same calls), and lists what a program can call.
`describe_piece` of a program piece lists, beside its library parts, every shape the program names that the piece
holds, one line each (`- Shape "cup"` for a `.named()` shape or an `op` node's id, `- Smooth blend "stem_join"` for a
named `smoothUnion`), and the summary every reply leads with says them (since 0.4.2). These are the names a check
report names a place by, so a part can be mapped to a component by them. A named cutter is listed too: the cut's
faces carry its name.

**A library part keeps the metal it declares.** `ringShank` declares a whole band, `prongHead` each prong's column,
`bezel` its wall and `thicken` its sheet, and a check measures each part there. A program that cuts that metal away is
refused by `start_piece` and `change_piece` in the words a check would use, and nothing changes (since 0.4.3; before,
the piece was kept and drawn, and only its check said so, with every check reading `COULD_NOT_RUN`). A band you cut
into (openwork, an open shank) is built from the kernel instead: revolve its section round the Y axis, and leave
`on` out of its setting. A cut that leaves the declared metal whole (a groove, a channel) is no cut of it. A check
still tests a piece brought back in a file, and its report then gives the casting file's real triangles.

**What a program calls** (`src/program/library.ts`; `describe_piece` prints the full list):

- the **library**, today's parts as functions: `ringShank`, `roundStone`, `emeraldStone`, `cabochon` (from its
  measured base and dome height), `stone` (a stone of the program's own shape, `kind: 'cabochon'` to declare a domed
  one), `prongHead`, `bezel`, `thicken`, and `op` (any operation node a tree can hold). Each takes
  `start_piece`'s settings and defaults, checked by the tree's own checks, is sized by `pieceDims` and built by
  `buildBand` and `buildHead`, so a program-built ring is the template ring (a test holds every reading equal). Each
  returns its solid with the checker declarations it makes (band, seat, prongs, bezel rim, sheets), and reads back
  its dimensions as `.dims`;
- the **kernel**: `sphere`, `cylinder`, `box`, `torus`, `sweep` (built by the tree's own `buildOp`); 2D `circle`,
  `rect`, `polygon` with `.offset`; `extrude`, `revolve`, `hull`, `hullPoints`; `union`, `difference`,
  `intersection`, `smoothUnion`; on a solid `.translate`, `.rotate`, `.mirror`, `.scale`, `.named`, `.bounds`,
  `.volume`, `.slice`, `.project`, `.trim`; and `segments(r)`, a circle's segment count at the build's tolerance.

A declaration follows its solid through a move only if the checker can still measure it: a band only turns about Y,
a setting moves anywhere and turns only about Z. Anything else, and `scale` or `hull` of a solid holding a part, is
refused, naming the part. A piece holds one band and one stone setting from the library, as a tree does.

**A cabochon in a bezel**, from a program alone (`test/fixtures/cabochon-in-bezel.tree.json`; it passes every
check in silver and exports):

```js
const band = ringShank({ ring_size: { system: 'US', size: '7' }, band_width: 2.2, band_thickness: 1.6 });
const r = 4, h = 2.6, n = Math.ceil(segments(r) / 4);
const profile = [[0, 0]];
for (let i = 0; i <= n; i++) {
  const a = (i / n) * Math.PI / 2;
  profile.push([r * Math.cos(a), h * Math.sin(a)]);
}
const moonstone = stone(revolve(polygon(profile)), { name: 'moonstone', kind: 'cabochon' });
return union(band, bezel({ stone: moonstone, on: band, wall: 1.0 }));
```

`kind: 'cabochon'` declares the stone a cabochon, so its bezel lip is held to the cabochon's own rule: it rises at
least a third of the dome (J. Cogswell, *Creative Stonesetting*, `src/jewelry/rules.ts`). `cabochon({ diameter: 8, height:
2.6 })` makes the same stone from the person's own measurements, round or oval. The engine never guesses a cabochon
from its shape: undeclared, a stone is checked as faceted.

**Limits.** Each evaluation gets **20 s** and **512 MiB** by default; `FLO2_CAD_PROGRAM_SECONDS` and
`FLO2_CAD_PROGRAM_MEMORY_MIB` change them for a host's slot. A check runs the program twice in one evaluation (the
casting file's tolerance and the finer reference), so the limit covers both. Each run frees the kernel's objects
before the next starts (since 0.4.3), so a check needs the memory of its larger run, not of both together: measured on
an openwork ring, 179 MiB for the casting file and 436 MiB for the reference, and 441 MiB for the check, which before
needed 538 MiB and stopped at 512. Both runs are finer than a picture's (89 MiB for that ring), so a piece near the
limit can draw and still not check. The clock starts when the evaluation's
process is ready (Node and the kernel loaded, about 0.15 s), not when it is started, and a program that does not parse
is refused before then, so a busy machine's slow start is never counted as the program's; the start has its own
bound (10 s), past which the engine says it could not start. Hitting a limit is a plain refusal: "the
program ran past its time limit (20 s)", "the program used more than its memory limit (512 MiB)", or the line and
message that failed ("program: line 3: rotate([20, 0, 0]): would tip the stone setting off upright ...").

### How a program is confined

PROPOSED (`dec:idea-how-a-program-is-confined`), built to the recommendation, waiting for the owner's word:

1. **A separate, short-lived process per evaluation** (`dist/program-child.js`, started by `src/program/run.ts`):
   - a **wall-clock limit**, enforced inside by V8's own watchdog on the program's context and outside by SIGKILL;
   - a **memory limit**: the V8 heap capped (`--max-old-space-size`, half the limit), the kernel's WebAssembly heap
     capped (its growth refused past the limit less 128 MiB), and the process's resident memory read from `/proc`
     every 20 ms and SIGKILLed past the limit; on Linux it is also first for the OOM killer (`oom_score_adj` 1000),
     so a container at its cap loses the child, not the engine;
   - an **empty environment**, and **Node's permission model**: it may read only the engine's own files and the
     kernel, and may write nothing, start no process or worker, and load no native addon. Code generation from
     strings is off.
2. **Inside it, a fresh V8 context** with only the language's built-ins and the library's globals: no `require`,
   `import`, `process`, file system, network or timers, and no code from strings. The program holds **handles**: every
   solid and every declaration stays in the engine's table, and the program's calls cross as a name and JSON text, so
   no object, function or error of the engine's realm ever reaches it. A declaration can come only from a library
   call.
3. **Only a mesh and declarations come back**: vertices and triangles, the declarations the library made, the parts'
   dimensions, and for a picture the stones. The engine rebuilds each field itself, refuses anything out of range,
   and before a check confirms that every declaration has metal where it says (a point inside the band all the way
   round, inside each prong's column, inside the bezel wall, on a sheet).
4. **The checker and the exporter run in the engine's process**, on that mesh: the STL is written there, read back
   by the independent checker, and released only if every check passes on those bytes. Nothing a program does can
   touch the check.
5. **On flo2.io** the helper's container (no network, a memory cap, one CPU, a read-only root) stays the security
   boundary around all of it.

Tests (`test/program.test.ts`) hold each of these: an endless loop, an endless promise chain and memory bombs in
JavaScript, in typed arrays and in the kernel are stopped and refused plainly; `require`, `process`, `fetch`, timers,
`import()`, `eval` and every constructor chain out of the context fail; no function of the engine's appears on the
program's stack; a program that rewrites its own `Math`, `JSON`, `Array` and `Object` gets the same readings.

**The residual risk, plainly.** `node:vm` is not a security boundary on its own, and Node's permission model is a
seat belt, not a sandbox (and in Node 24 does not restrict the network). A program that escaped the context through
an unknown V8 or Node flaw would run as the child, with its permissions, and could write any answer. The engine still
measures the mesh it sends in full (a hole, a second shell, or a wall or detail under 0.35 mm is refused whatever is
declared), but a forged declaration could weaken a jewelry-specific check: a prong declared over thick metal beside a
thin fin would excuse that fin from the 0.8 mm wall check within the prong's column; a stone's outline drawn larger
would make prongs seem to reach further; a reference sent equal to the file would pass the surface check. On flo2.io
the container bounds what an escape reaches; on a laptop, the child runs as the person, and the network is open to
it. Where there is no `/proc` (macOS, Windows) the resident-memory watch is off: the heap and kernel caps and the time
limit still hold, but memory a program takes in typed arrays is bounded only by the time limit.

## Limits: named profiles, no verdict, or your own

`dec:idea-limit-profiles-by-material-process-and-size` (accepted 2026-11-04, options (a) and (b)), serving
`req:limits-follow-the-material-process-and-size` and `req:flo2-cad-designs-any-cast-piece`.

**A piece states its material and its process; its size is measured.**

- **Material.** `"metal"` names one of the four metals by its id, exactly as before (`sterling_silver_925`,
  `gold_14k_yellow`, `gold_18k_yellow`, `platinum_950`). Any other material is named in words as `"material"`
  (`"bronze"`, `"silicon bronze"`, `"copper"`). A piece states one or the other, never both; a material spelled as one of
  the four metals is refused with its id.
- **Process.** `"process"` is `"lost_wax"` (lost wax casting from a pattern printed in castable resin or wax, or carved
  in wax), or another process in words (`"sand casting"`, `"ceramic shell"`). A piece that states none is checked as
  lost wax, as every piece was before, and every check and export reply says that is what was assumed.
- **Size** is the largest side of the piece's bounding box, in mm, as finished (the casting file before any shrinkage
  allowance).

All three are kept in the piece's own file, beside its name and shrinkage. A piece that states none of the new fields
has the same file as before.

**A profile** is one cited set of limits for a material family, a process and a size range: every limit the checker
reads (walls, a ring band, prongs, details, gaps, surface) and the shrinkage allowance, each with its source
(`src/limits/profiles.ts`). The engine picks the profile that covers all three of the piece's. There is one so far:

| Profile | Materials | Process | Size (largest side) |
|---|---|---|---|
| precious metals cast by lost wax, at jewelry scale | sterling silver 925, 14k and 18k yellow gold, platinum 950 | lost wax, from a printed castable resin or wax, or a carved wax | 2.4 to 88 mm |

Its limits are the ones below, unchanged: rings check exactly as before, and a test replays main 362c473's replies
and reports for eight ring pieces to hold that. Its **size range** is cited from the services its limits come from
(pages read 2026-11-04):

- **88 mm at most.** Materialise's silver and gold pages give "Maximum part dimensions" of "88 x 88 x 125 mm";
  Shapeways' silver, gold and platinum pages give a "Maximum Bounding Box 89 × 89 × 100 mm". A piece is read by its
  largest side alone, so the bound is the largest side that fits both boxes whatever the other two sides are: 88 mm.
  A piece up to 100 mm long but slim may still fit Shapeways' box lengthwise; it gets no verdict here.
- **2.4 mm at least.** Shapeways: "Minimum Bounding Box 2.4 × 2.4 × 0.6 mm" and "Your model must be within the
  minimum and maximum bounding box sizes". Materialise gives no smallest part.

**No matching profile means no verdict.** A bronze piece, a silver piece sand cast, or a 300 mm silver bowl gets this
answer from `check_piece`: there are no cited casting limits for its material, process and size together, so it is not
judged; which of the three did not match; and how to go on (the caster's own limits, or a metal, process or size the
profile covers). No check runs, nothing is measured against another profile's numbers, and `export_for_casting`
refuses, as it refuses a failed check. The report says `"verdict": "no_verdict"`. Shrinkage `"on"`, which applies the
cited allowance, is refused where there is none to cite: give a percentage, or supply limits.

**Limits you supply.** A piece may carry its caster's or foundry's limits as `"limits"`: every limit the checker reads
and the shrinkage allowance, each a value with its unit and its source.

```json
"limits": {
  "wall":              { "value": "1.5 mm",  "source": "the foundry's design guide, rev. 3, 2026-10-01" },
  "band":              { "value": "1.8 mm",  "source": "..." },
  "prong":             { "value": "1.6 mm",  "source": "..." },
  "detail":            { "value": "0.5 mm",  "source": "..." },
  "gap":               { "value": "0.6 mm",  "source": "..." },
  "surface_deviation": { "value": "0.01 mm", "source": "..." },
  "shrinkage":         { "value": "1.4 %",   "source": "..." }
}
```

`band` and `prong` are checked only where the piece has a ring band or prongs. The set is kept in the piece's file and
used in place of any profile's, whatever the material, process and size; every check report and export names them as
the person's, with their sources (`"limits_from": {"kind": "supplied", ...}`). A set missing a limit, a unit or a source
is refused, naming the field path (`limits.gap.source`). `set {"limits": null}` removes them.

**Every report says where its limits came from**: `"limits_from"` gives the profile (its id and name, the material,
the process and whether it was stated or assumed, the size measured and the range, and each limit with its source), the
supplied set, or why there are none. The reply's checks line names the profile, and one line says what covered the piece.

**The jewelry layer.** The stone, setting and seat rules (prong grip, a faceted stone's and a cabochon's bezel lip,
the seat clearances, the template stones' placeholder sizes) and the checks of a stone's setting (prong thickness and
grip, bezel wall and lip) live in `src/jewelry/`, behind one boundary, `src/jewelry/index.ts`. They apply only to a piece
that declares a stone or a setting. The general checker and the limit profiles import nothing of the layer, and the rest
of the engine reaches it only through its boundary; `test/jewelry-boundary.test.ts` holds both. The setting rules are
craft standards, not casting limits, so they do not change with a profile or with supplied limits.

## What "casting-ready" means here

Every number below has a cited source. These are the first profile's figures (`src/limits/profiles.ts`) and the
jewelry layer's setting rules (`src/jewelry/rules.ts`); the sources are there, in each check report, and on the design.

| Check | Limit | Measured how, on the STL as written |
|---|---|---|
| One watertight solid | manifold edges, no self-intersections, faces outward, exactly one shell | own STL parser, edge pairing, shells, signed volume, triangle crossing tests |
| Walls | ≥ 0.8 mm | largest inscribed sphere at every triangle's centroid, along the surface's direction there: a triangle's own normal, except that a sliver too narrow to have a direction takes it from the surface it was cut from. Only metal's far side stops the sphere: a surface facing more than 105° away, met square-on and from more than 105° away, so a crease the sphere reaches from the side, or through a face it has passed, does not. A thin place is named by the part its faces came from (below), with any other named part the sphere meets |
| Ring band | ≥ 1.0 mm | largest circle in the band's own section, every 5° all the way round: the whole piece is cut, then clipped to the band's inner and outer radius and width, so a head or an added shape is never counted as band |
| Each prong | ≥ 1.0 mm at its narrowest (an unsupported wire) | largest circle in its cross-section (the whole piece cut, clipped to a disc round the prong's axis), every 0.1 mm (0.02 mm near the narrowest) |
| Prong grip | each prong reaches ≥ 0.15 mm over the girdle (Stuller) | metal above the girdle, inside the girdle's outline |
| Bezel wall | ≥ 0.8 mm | largest inscribed sphere on the rim |
| Bezel lip | covers 50-75 % of a faceted stone's crown (Revere, JCK); on a declared cabochon, at least a third of its dome (Cogswell, *Creative Stonesetting*) | top of the bezel less the girdle |
| Sheets (`thicken`) | ≥ 0.8 mm, the wall minimum | square to the surface: from each point the sheet declares on its middle surface, a ray each way along the normal to the first face, where both faces face along the rays (the sheet's own) |
| Details | ≥ 0.35 mm | thinnest feature anywhere, measured as the walls are |
| Gaps | ≥ 0.3 mm (0.8 mm in platinum, Stuller) | facing surfaces, along the surface's direction as for the walls |
| Surface | ≤ 0.01 mm off the intended shape | distance from a 0.0015 mm reference tessellation to the written facets; for a `smooth_union`, whose intended surface is its distance field's zero level, from points on that surface at the corners, edge midpoints and centroid of every facet the file has from it. The build holds a blend's facets to that surface, its creases (a wire's bend, a box's edge) included: a level set alone cut across them |

How each metal of the first profile is handled:

- **Limits.** Silver, gold and platinum share the services' figures, except the platinum gap above. Library
  defaults sit above each limit with a margin.
- **Shrinkage.** Each metal's allowance is 1.5 % (Shapeways: metal shrinks about 1-1.5 %). It is off by default, and
  every export says whether it was applied.
- **Platinum** melts at about 1780-1795 °C and is cast at about 1850-2200 °C, so every platinum reply says it goes
  to a specialist caster.
- **The stone** is never in the casting file. It appears in the preview only.
- **Both casting files hold the same vertices**, the float32 numbers the checker reads back from the STL; the 3MF
  writes each as the shortest decimal that reads back as that float32. Before writing, the build moves every vertex
  to that float32 inside the kernel, and the kernel collapses any edge that became zero-length. The kernel works in
  double precision and keeps vertices 1e-10 mm apart, which a float32 file would merge into one point (a round
  stone in a bezel did this until 2026-10-05). Rounding moves nothing the file would not move anyway, less than
  1e-6 mm on a ring.

## What the replies and files say: the three contracts

flo2-cad publishes three contracts (`dec:how-interfaces-are-encoded`): its tools, the casting file, and the check
report that travels with it. Each is written down in `contracts/`, and a test fails on any change the file does not
declare.

| Contract | File | What its test compares |
|---|---|---|
| The tools | `contracts/tools.json` | each tool's name, annotations and argument shape (the prose for the agent left out), against what `dist/main.js` lists in both protocol eras. After a deliberate change, `npm run contracts` rewrites it; that is a change to flo2's door too |
| The check report | `contracts/check-report.schema.json` | a JSON Schema. Every report the test suite makes is held to it as it is made, the no-verdict and supplied-limits reports included |
| The casting file | `contracts/casting-file.json` | what the STL's 80-byte header and the 3MF's metadata say, read back from files the engine wrote |

**What a check report carries.** Every report keeps each field it had in 0.3.0, with its meaning, and adds three things.

- **The part each place is in, by its own name.** Each check carries `part`, and each place (`where`) carries
  `part_name`: a tree node's id, a program shape's `.named("...")` name, or the library's part (`band`, `head`, `bezel`,
  `prong 2 of 4`, `stone seat`). The library tags each face of the casting file with the part it came from, and the
  checker names a place by the faces it measured there, never by the region round it. A reading at the stone seat is
  named by the metal the seat is cut into. Where the faces come from no named part, `part` is `null` and the words say
  "in no named part". `other_parts` lists any other named part that meets there.
- **The problem in a maker's words.** Each failing check carries `problem`, for example "The bezel wall is 0.62 mm at
  its thinnest, on the left of the bezel (at 9:00 seen from above, the finger pointing to 12); it must be at least 0.8
  mm." A refusal lists the problems first, then what to change.
- **Every list, empty when there is nothing in it.** `checks`, each check's `failing`, each place's `meets` and
  `other_parts`, the limits' `sources`, `limits_from.unmatched` and a size's `bounding_box_mm` are always there. A list
  left out never means none.

**What a casting file says about itself.** The STL's header reads, for example,
`flo2-cad 0.4.3 manifold-3d 3.5.4 mm r3 shrink=off Au585Y lost_wax moonstone-ope~`: the engine and the kernel with their
versions, the units, the revision, the shrinkage allowance, the metal by its fineness mark (Ag925, Au585Y, Au750Y,
Pt950) or the material by name, the process and the piece. In 80 bytes the material, the process and the name may be
cut, marked `~`. The 3MF says each in full as metadata of its own (`flo2:engine`, `flo2:kernel`, `flo2:piece`,
`flo2:revision`, `flo2:metal`, `flo2:material`, `flo2:process`, `flo2:process_assumed`, `flo2:shrinkage`,
`flo2:units`, `flo2:check_report`), beside its Title, Application and Description.

## Measurements

These were measured 2026-10-03 on Node 24.21.0 against the shipped server (`dist/main.js`) over stdio MCP. The
`measurements/` folder has the raw files, and `npm run measure` repeats them.

| What | One CPU (taskset) | flo2 slot shape (Docker `--cpus 1 --memory 1g --network none --read-only`) | Limit |
|---|---|---|---|
| Preview, typical ring (solitaire, round, 6 prongs), 4 views at 512 × 512, cold (kernel loads) | 2.09 s | 3.02 s | ≤ 5 s |
| Preview, same, warm | 1.27 s | 1.86 s | |
| Casting export with all checks, the typical ring | 8.66 s | 8.74 s | measured, no limit yet |
| Casting export with all checks, Emily's emerald bezel in Pt950 | 9.50 s | 8.92 s | measured |
| Peak memory of the session (VmHWM) | 188.8 MiB | 189.6 MiB | ≤ 1024 MiB |
| Install, engine without the runtime (`npm pack`, unpacked, 18 files) | 1.78 MB | 1.78 MB | ≤ 25 MB |
| Install, with the Node 24 runtime (node binary 126.6 MB) | 128.4 MB | 128.4 MB | ≤ 150 MB |

The Docker image (node:24-slim with the engine) is 232 MB as `docker images` reports it. Most of that is the base
image.

**A general piece: wires and a blend.** Measured 2026-10-05 on this box (Intel N95), with the tree flo2.io kept for
`moonstone-openwork-ring` revision 3 (the bezel template plus four sweeps of 72 points under a 0.4 mm `smooth_union`;
`test/fixtures/moonstone-openwork-ring.tree.json`), `check_piece` alone:

| Where | Time | Peak memory |
|---|---|---|
| One CPU (taskset), in process | 36 s | 553 MiB (VmHWM) |
| Docker `--cpus 1 --memory 1g --memory-swap 1g` | 40.1 s | within 1 GiB |
| Docker `--cpus 1 --memory 768m --memory-swap 768m`, flo2's cad slot | 40.6 s | within 768 MiB |
| Docker `--cpus 1 --memory 384m --memory-swap 384m`, flo2's cad slot until 2026-10-05 | 46.3 s | within 384 MiB |

Before 2026-10-05 the same check took 352 s at one CPU and peaked at 1.37 GB, and flo2's slot killed it for memory.
Holding the blend's facets to its own surface (the Surface row above) costs about 2.5 to 3.5 s of that: on the same
box the same day, c678b62 took 33.5 s in process (550 MiB), 37.1 s at 768 MiB and 42.9 s at 384 MiB.
`test/check-time.test.ts` holds it to 45 s at one CPU and 1 GiB; CI's image job holds it to flo2's 60 s door.

**A piece written as a program.** Measured 2026-10-05 on this box, with the cabochon in a bezel
(`test/fixtures/cabochon-in-bezel.tree.json`):

| What | Time | Peak memory of the evaluation child |
|---|---|---|
| Starting the child and the kernel (`return sphere(1)`) | 0.13-0.18 s | 57 MiB |
| Preview evaluation | 0.33 s | 76 MiB |
| `check_piece`, in process: the evaluation (the casting file and its finer reference) then the checks | 2.0 s (0.8 s evaluating) | 117 MiB |
| `check_piece` in Docker `--cpus 1 --memory 768m --memory-swap 768m --network none --read-only` | 3.5 s | |

The program-built solitaire is the template's mesh: the same triangle count, volume and readings.

## Run it

```sh
node dist/main.js                 # MCP on stdio; needs only Node 24
node dist/main.js --version       # flo2-cad 0.4.3 (manifold-3d 3.5.4)
node dist/main.js --list-tools    # the published tool list as JSON

docker build -t flo2-cad .
docker run --rm -i --network none --read-only flo2-cad
```

**As a plugin.** The repo root is both an
[Agent Plugins 1.0.0](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) plugin (`plugin.json`,
`mcp.json`) and a Claude Code plugin (`.claude-plugin/plugin.json`, `.mcp.json`). Grok Build reads Claude's format
as is. Both formats share the `skills/design-jewelry` skill and launch `node <plugin root>/dist/main.js`. Installing
from the repo needs no build step:

- `dist/main.js` is committed;
- CI rebuilds it and fails if the committed file differs.

## How it is built

- **Kernel.** manifold-3d **3.5.4**, used unmodified.
  - Only its runtime files are shipped, in `vendor/manifold-3d-3.5.4/`. The package's own dependencies are CAD
    tooling, a native image library among them, and would put the install over 25 MB.
  - `vendor/manifold-3d-3.5.4.source.json` records the npm tarball, its sha512 integrity and each file's sha256.
  - `scripts/verify-kernel.mjs`, run in CI, downloads the tarball, checks it against the registry and compares every
    vendored file byte for byte.
- **Checker.** `src/checker/` never imports the kernel, the library or the exporter, and a test holds that. It reads
  the written STL with its own parser. Its checks are the general ones; the checks of a stone's setting are the
  jewelry layer's (`src/jewelry/checks.ts`), which the engine passes in as a layer and which, like the checker, import
  only the checker and Node.
- **Limits.** `src/limits/`: the named profiles with their sources (`profiles.ts`), how a piece's material, process
  and size pick one or none (`choose.ts`), and limits a person supplies (`supplied.ts`).
- **Bundle.** The MCP SDK v2 and zod are bundled into `dist/main.js`. Their licences are in
  `dist/THIRD-PARTY-NOTICES.txt`. `dist/program-child.js` beside it is the process a program is evaluated in; it
  bundles only the engine's own library and kernel loader. No sandbox library is added: the confinement is Node's own
  (`node:vm`, `node:child_process`, the permission model).
- **No native dependencies.** The PNG preview comes from a software rasterizer. The 3MF zip is written with
  `node:zlib`.

```sh
npm ci
npm test          # tsc, bundle, then node:test: units, tree, engine end to end, MCP in both eras, plugin manifests
npm run verify-kernel
npm run measure
```

## Known limits of the first increment

- **One limit profile.** Only the four metals cast by lost wax, 2.4 to 88 mm at the largest, have cited limits. A
  profile is added only when a real piece needs one, with its own sources. Until then any other material, process or
  size gets no verdict unless the piece carries its caster's limits. Scale rules inside a profile, hollow casting and
  sectioning a large figure are for later (options (c) and (d) of the decision).
- **Size is the largest side.** A piece is read by the largest side of its bounding box, as the decision states, not
  by all three sides against each service's box, so the profile stops at 88 mm.
- **Tall heads.** The stone's point sits above the band, so prong heads and bezels stand tall. A low setting that
  sinks the pavilion into the band is not built yet.
- **Emerald-cut proportions** inside the measured depth (crown, pavilion, corners) are modelling assumptions, because
  no primary source gives them. The table and girdle are cited in `src/library/stones.ts`.
- **Prongs** are judged by their narrowest section, as `con:minimum-prong-thickness` says. The inscribed-sphere wall
  check leaves prong columns to that rule, because near a seat notch's sharp edge the sphere reads thinner than the
  section. That reading is the notch's real shape, not its triangles: its two flanks face each other at 105-109°, just
  past the 105° that marks a wall's far side, and it read 0.71 mm and 0.65 mm at two tessellations, with or without
  the sliver rule. Since the sphere must meet a crease square-on, it reads 0.96 mm and 0.89 mm there (0.85-0.99 mm
  over five tessellations), still thinner than the 1.17 mm section, so the exclusion stays: where a curved far side
  crosses the 105° line, the reading still moves with the tessellation.
- **The checker reads back the STL only.** The 3MF carries the same float32 vertices and triangles, and a test holds
  that, but the checker does not parse the 3MF itself. (A round stone in a bezel now exports. Its file used to fail
  the watertight check, `fact:a-round-stone-in-a-bezel-fails-the-watertight-check-2026-10-05`; the cause and the fix
  are in "Both casting files hold the same vertices" above.)
- **"Plain round band"** in Emily's design is read as a round-wire band (`band_profile: round`, 2.0 × 2.0 mm).
- **Programs** (in progress): one band and one stone setting from the library per piece, as the checker measures
  one of each; a band stays round the Y axis and a setting upright. A cabochon's lip rule has no upper limit, since
  its source gives none. A stone of the program's own shape is read at
  each build's fineness: its girdle is where its slices are widest, which a curve drawn with `segments()` keeps the
  same at every tolerance.
- **Curved sheets** (`thicken`) curve no tighter than 5 times their thickness. The limit is the wall check's: it grows
  its sphere from the rim straight along the rim's normal, and on a tighter curve meets the sheet's own outer face
  curving back, so it reads the rim thinner than it is (measured: 99.8 % of the thickness at 5 times, 84-94 % at 4
  times on a sphere, 62-70 % at 3 times). On a sphere, widths narrow by sin θ / θ as the cup deepens; lengths from
  the origin are kept.
