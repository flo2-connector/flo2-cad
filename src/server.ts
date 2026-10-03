// The MCP server over stdio (cmp:agent-tool-surface).
//
// It uses the SDK's low-level `Server`, not `McpServer`, on purpose: the tool
// list is a published seam (ifc:engine-tools-over-mcp), so its JSON Schemas are
// written out exactly in tools.ts rather than generated, and argument checking
// is the engine's own, so every refusal names its field path and says how to
// fix it (contract §4) instead of passing through a schema library's wording.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { Session } from './session.js';
import { TOOLS, TOOL_NAMES } from './tools.js';
import { ENGINE_NAME, ENGINE_VERSION } from './version.js';

export const INSTRUCTIONS = [
  'This engine designs jewelry for casting. Start with start_piece (a solitaire ring or a plain band, in the wearer\'s ring size), then change_piece, and show the person the picture after each change.',
  'Every measurement is in millimetres written with its unit ("1.2 mm"); a ring size names its system (US, UK or EU). If the person gives inches or another unit, convert it yourself and show them the conversion.',
  'export_for_casting releases the STL and 3MF only when every casting check passes on the written file; if it refuses, tell the person what to thicken and where, and offer the change.',
  'Each reply that changes the piece returns its tree; pass it back as "tree" to pick the piece up in a new conversation.',
].join(' ');

export function createServer(): Server {
  const server = new Server({ name: ENGINE_NAME, version: ENGINE_VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  const session = new Session();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    if (!(TOOL_NAMES as readonly string[]).includes(name)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    const args = request.params.arguments ?? {};
    try {
      return session.call(name, args);
    } catch (e) {
      // Not a malformed call (those come back as isError replies): an engine fault.
      throw new McpError(ErrorCode.InternalError, `${ENGINE_NAME} fault in ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return server;
}
