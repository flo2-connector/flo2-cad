# flo2-cad: the Agent CAD engine

flo2-cad is an MCP server over stdio. A chat agent drives it to design jewelry that is ready for casting. It runs
in two places:

- flo2.io's tool-server slot, behind the flo2 connector;
- a laptop, beside the person's own agent.

The spec is the flo2-hosted design "Agent CAD engine" (`38eca9450f850bf7`). Build agents start from
[AGENTS.md](AGENTS.md).

> **Status: Phase 1 skeleton.**
> - The tool list, argument schemas and reply shapes below are final for the first increment.
> - The engine behind them is a **stub**. Its geometry is a placeholder (a plain band without the head), and its
>   "checks" compare the settings with the limits instead of measuring a solid.
> - Every stub reply says so, and nothing it makes is ready for casting.

## Tools

| Tool | Class | Arguments | Returns |
|---|---|---|---|
| `start_piece` | write | `template` (`solitaire_ring` \| `plain_band`), `ring_size` `{system: US\|UK\|EU, size}`; optional `name`, `band_width`, `band_thickness`, `band_profile`, `stone_setting`, `stone_diameter`, `prong_count` (4\|6), `prong_thickness`, `shrinkage`, `preview` | summary text, the tree as text, `<name>.preview.png`, `<name>.tree.json` |
| `change_piece` | write | `tree?`, `set?` (the same settings, or `"<part>.<setting>"`), `preview?`; at least one of `tree` or `set` | what changed, the tree as text, `<name>.preview.png`, `<name>.tree.json`; revision + 1 |
| `preview_piece` | read | `tree?`, `views?` (1 to 4 of `three_quarter`, `front`, `side`, `top`, `setting_closeup`) | `<name>.preview.png` |
| `check_piece` | read | `tree?` | pass or fail for each limit, what to thicken and where, `<name>.check.json` |
| `export_for_casting` | write | `tree?` | if every check passes: `<name>.stl`, `<name>.3mf`, `<name>.check.json`. If not: `<name>.check.json` and what to thicken and where (`isError: false`) |
| `describe_piece` | read | `tree?` | summary, every setting with its range, default and limit, and the tree as text |

How the tools take values and report errors:

- **Lengths** are strings with their unit, like `"1.2 mm"`. A bare number, or inches or any other unit, is a
  malformed call: `isError: true`, and the message names the field path, for example
  `set.prong_thickness: 1.2 has no unit`.
- **Files** come back as `{"type":"resource","resource":{"uri":"cadfile:///<name>","mimeType":...,"blob":...}}`,
  with at most 11 MB of raw bytes per reply.
- **The full list**, with its JSON Schemas, comes from `flo2-cad --list-tools`.

## Run

```sh
npm ci && npm run build
node dist/src/main.js            # MCP on stdio
node dist/src/main.js --version  # flo2-cad 0.1.0 (manifold-3d 3.5.4)
npm test

docker build -t flo2-cad .
docker run --rm -i --network none --read-only flo2-cad
```

## Measurements

Phase 2 fills these in, measured on Node 24:

- preview time and peak memory for the solitaire on one CPU;
- export-with-checks time;
- install size, with and without the runtime.
