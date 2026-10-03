#!/usr/bin/env node
// flo2-cad: the Agent CAD engine as an MCP server over stdio.
//   flo2-cad              serve MCP on stdin/stdout (what flo2's slot and a laptop agent run)
//   flo2-cad --version    print the engine and kernel versions (flo2 asks this at start)
//   flo2-cad --list-tools print the published tool list as JSON
// Nothing but MCP messages is ever written to stdout while serving.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { TOOLS, TOOL_ACCESS } from './tools.js';
import { ENGINE_NAME, ENGINE_VERSION, KERNEL_NAME, KERNEL_VERSION } from './version.js';

const arg = process.argv[2];
if (arg === '--version' || arg === '-v') {
  process.stdout.write(`${ENGINE_NAME} ${ENGINE_VERSION} (${KERNEL_NAME} ${KERNEL_VERSION})\n`);
} else if (arg === '--list-tools') {
  const tools = TOOLS.map((t) => ({ ...t, access: TOOL_ACCESS[t.name as keyof typeof TOOL_ACCESS] }));
  process.stdout.write(JSON.stringify(tools, null, 2) + '\n');
} else if (arg === '--help' || arg === '-h') {
  process.stdout.write(`${ENGINE_NAME} ${ENGINE_VERSION}: an MCP server over stdio for designing casting-ready jewelry.\nUsage: ${ENGINE_NAME} [--version | --list-tools | --help]\n`);
} else if (arg !== undefined) {
  process.stderr.write(`${ENGINE_NAME}: unknown option ${arg}; try --help\n`);
  process.exitCode = 2;
} else {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
