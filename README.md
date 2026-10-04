# flo2-cad: the Agent CAD engine

flo2-cad is an MCP server that a chat agent drives to design jewelry that is ready for casting. The person talks to
the agent and sees a picture after each change. The engine refuses to release an STL or 3MF until the file, as
written, passes every casting check. It runs in three places:

- on flo2.io, behind the flo2 connector;
- on a laptop, as an MCP server or as a plugin;
- in Docker.

The spec is the flo2-hosted design "Agent CAD engine" (`38eca9450f850bf7`). Build agents start from
[AGENTS.md](AGENTS.md); agents that design jewelry start from
[skills/design-jewelry/SKILL.md](skills/design-jewelry/SKILL.md).

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

## Tools

The seam with flo2 is fixed, so this list is final for the increment. Any change to it is a change to both repos.

| Tool | Class | Arguments | Returns |
|---|---|---|---|
| `start_piece` | write | `template` (`solitaire_ring` \| `plain_band` \| `emerald_bezel_solitaire`), `ring_size` `{system: US\|UK\|EU, size}`; optional settings (below), `name`, `preview` | summary, the tree as text, `<name>.preview.png`, `<name>.tree.json` |
| `change_piece` | write | `tree?`, `set?` (any setting, or `"<part>.<setting>"`), `preview?` | what changed, the tree as text, `<name>.preview.png`, `<name>.tree.json`; revision + 1 |
| `preview_piece` | read | `tree?`, `views?` (1 to 4 of `three_quarter`, `front`, `side`, `top`, `setting_closeup`) | `<name>.preview.png` |
| `check_piece` | read | `tree?` | pass or fail for each limit, what to thicken and where, `<name>.check.json` |
| `export_for_casting` | write | `tree?` | if every check passes: `<name>.stl`, `<name>.3mf` and `<name>.check.json`. If not: `<name>.check.json` and what to thicken and where (`isError: false`) |
| `describe_piece` | read | `tree?` | the piece in jeweler's terms, its weight in each metal, every setting, the tree |

**Settings.** `start_piece` takes these, and so does `change_piece` under `set`:

- `metal`
- `ring_size`
- `band_width`, `band_thickness`, `band_profile` (comfort_fit, half_round, flat, round)
- `stone_setting` (prong_head, bezel, none)
- `stone_shape` (round, emerald)
- `stone_diameter`, `stone_length`, `stone_width`, `stone_depth`, `stone_carat` (for reference only)
- `stone_orientation` (east_west, north_south)
- `prong_count` (4, 6), `prong_thickness`
- `bezel_wall`, `bezel_lip`
- `shrinkage` (`off` \| `on` \| `"1.2 %"`)

**Units and errors:**

- A length is a string with its unit, like `"1.4 mm"`.
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

## What "casting-ready" means here

Every number below has a cited source. The sources are in `src/metals.ts`, in each check report, and on the design.

| Check | Limit | Measured how, on the STL as written |
|---|---|---|
| One watertight solid | manifold edges, no self-intersections, faces outward, exactly one shell | own STL parser, edge pairing, shells, signed volume, triangle crossing tests |
| Walls | ≥ 0.8 mm | largest inscribed sphere at every triangle's centroid, along the surface's direction there: a triangle's own normal, except that a sliver too narrow to have a direction takes it from the surface it was cut from. Only metal's far side stops the sphere: a surface facing more than 105° away, met from more than 105° away, so a crease the sphere reaches from the side does not. A thin place is named by the part holding the sphere's centre: the band only inside its own section, otherwise the added shape by its id |
| Ring band | ≥ 1.0 mm | largest circle in the band's own section, every 5° all the way round: the whole piece is cut, then clipped to the band's inner and outer radius and width, so a head or an added shape is never counted as band |
| Each prong | ≥ 1.0 mm at its narrowest (an unsupported wire) | largest circle in its cross-section (the whole piece cut, clipped to a disc round the prong's axis), every 0.1 mm (0.02 mm near the narrowest) |
| Prong grip | each prong reaches ≥ 0.15 mm over the girdle (Stuller) | metal above the girdle, inside the girdle's outline |
| Bezel wall | ≥ 0.8 mm | largest inscribed sphere on the rim |
| Bezel lip | covers 50-75 % of the crown (Revere, JCK) | top of the bezel less the girdle |
| Details | ≥ 0.35 mm | thinnest feature anywhere, measured as the walls are |
| Gaps | ≥ 0.3 mm (0.8 mm in platinum, Stuller) | facing surfaces, along the surface's direction as for the walls |
| Surface | ≤ 0.01 mm off the intended shape | distance from a 0.0015 mm reference tessellation to the written facets |

How each metal is handled:

- **Limits.** Silver, gold and platinum share the services' figures, except the platinum gap above. Library
  defaults sit above each limit with a margin.
- **Shrinkage.** Each metal's allowance is 1.5 % (Shapeways: metal shrinks about 1-1.5 %). It is off by default, and
  every export says whether it was applied.
- **Platinum** melts at about 1780-1795 °C and is cast at about 1850-2200 °C, so every platinum reply says it goes
  to a specialist caster.
- **The stone** is never in the casting file. It appears in the preview only.

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

## Run it

```sh
node dist/main.js                 # MCP on stdio; needs only Node 24
node dist/main.js --version       # flo2-cad 0.2.0 (manifold-3d 3.5.4)
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
  the written STL with its own parser.
- **Bundle.** The MCP SDK v2 and zod are bundled into `dist/main.js`. Their licences are in
  `dist/THIRD-PARTY-NOTICES.txt`.
- **No native dependencies.** The PNG preview comes from a software rasterizer. The 3MF zip is written with
  `node:zlib`.

```sh
npm ci
npm test          # tsc, bundle, then node:test: units, tree, engine end to end, MCP in both eras, plugin manifests
npm run verify-kernel
npm run measure
```

## Known limits of the first increment

- **Tall heads.** The stone's point sits above the band, so prong heads and bezels stand tall. A low setting that
  sinks the pavilion into the band is not built yet.
- **Emerald-cut proportions** inside the measured depth (crown, pavilion, corners) are modelling assumptions, because
  no primary source gives them. The table and girdle are cited in `src/library/stones.ts`.
- **Prongs** are judged by their narrowest section, as `con:minimum-prong-thickness` says. The inscribed-sphere wall
  check leaves prong columns to that rule, because near a seat notch's sharp edge the sphere reads thinner than the
  section. That reading is the notch's real shape, not its triangles: its two flanks face each other at 105-109°, just
  past the 105° that marks a wall's far side, and it reads 0.71 mm and 0.65 mm at two tessellations, with or without
  the sliver rule.
- **"Plain round band"** in Emily's design is read as a round-wire band (`band_profile: round`, 2.0 × 2.0 mm).
