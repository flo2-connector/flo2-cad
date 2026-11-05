#!/usr/bin/env node
// Writes contracts/tools.json, the published contract ifc:engine-tools-over-mcp in a form a
// test can compare: each of the engine's tools by its name, its annotations (flo2's door
// classes each tool read or write by readOnlyHint) and the SHAPE of its arguments (types,
// required fields, enums, bounds), without the prose that guides the agent, which may be
// reworded freely. test/contracts.test.ts lists the tools the shipped server (dist/main.js)
// serves, in both protocol eras, and fails when they differ from this file: a change to the
// tool surface is made on purpose, by running `npm run contracts` and committing the file,
// and it is a change to flo2's door too (AGENTS.md, the seam, point 4).
//
// Run after `npm run build` (it reads the built tool list): `npm run contracts`.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TOOLS_CONTRACT = join(root, 'contracts/tools.json');

/** Words for the agent, not shape: dropped from the contract. */
const PROSE = new Set(['description', 'examples']);

/** A schema's shape: every key but the prose, keys sorted, so the file reads the same however the code orders them. */
function shape(v) {
  if (Array.isArray(v)) return v.map(shape);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .filter((k) => !PROSE.has(k))
        .sort()
        .map((k) => [k, shape(v[k])]),
    );
  }
  return v;
}

/** The contract for a tool list, as tools/list serves it. */
export function toolContract(tools) {
  return {
    format: 'flo2-cad.tools-contract/1',
    interface: 'ifc:engine-tools-over-mcp',
    note: "The engine's tools as tools/list serves them: name, annotations and the shape of the arguments (the prose that guides the agent is left out). Written by scripts/contracts.mjs (npm run contracts); test/contracts.test.ts compares it with what dist/main.js lists in both protocol eras. flo2's door allowlists exactly these names, so a change here is a change to both repos.",
    tools: tools.map((t) => ({ name: t.name, annotations: shape(t.annotations ?? {}), inputSchema: shape(t.inputSchema) })),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { TOOLS } = await import(pathToFileURL(join(root, 'build/src/tools.js')).href);
  writeFileSync(TOOLS_CONTRACT, JSON.stringify(toolContract(TOOLS), null, 2) + '\n');
  console.log(`wrote contracts/tools.json: ${TOOLS.map((t) => t.name).join(', ')}`);
}
