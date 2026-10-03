// The MCP server over stdio (cmp:agent-tool-surface), on the v2 TypeScript SDK
// (@modelcontextprotocol/server 2.3.0), serving BOTH protocol eras from one
// factory: the 2025 "legacy" era opened by `initialize` (what flo2's tool-server
// plug speaks today) and the 2026-07-28 "modern" era opened by `server/discover`
// (the MCP revision the hub's standards requirement names).
//
// It uses the SDK's low-level `Server`, not `McpServer`, on purpose: the tool
// list is a published seam (ifc:engine-tools-over-mcp), so its JSON Schemas are
// written out exactly in tools.ts rather than derived, and argument checking is
// the engine's own, so every refusal names its field path and says how to fix
// it (contract §4).

import { ProtocolError, ProtocolErrorCode, Server } from '@modelcontextprotocol/server';
import { Session } from './session.js';
import { TOOLS, TOOL_NAMES } from './tools.js';
import { ENGINE_NAME, ENGINE_VERSION } from './version.js';

export const INSTRUCTIONS = [
  'This engine designs jewelry for casting. Start with start_piece (a solitaire ring, a plain band, or the emerald-cut bezel solitaire, in the wearer\'s ring size), then change_piece, and show the person the picture after each change.',
  'Every measurement is in millimetres written with its unit ("1.2 mm"); a ring size names its system (US, UK or EU). If the person gives inches or another unit, convert it yourself and show them the conversion.',
  'Size a stone from its MEASURED dimensions on its grading report, never from a carat chart; until then its size is a placeholder.',
  'export_for_casting releases the STL and 3MF only when every casting check passes on the written file; if it refuses, tell the person what to thicken and where, and offer the change. Platinum goes to a specialist caster.',
  'Each reply that changes the piece returns its tree; pass it back as "tree" to pick the piece up in a new conversation.',
].join(' ');

/** One server per connection: the session (the open piece) belongs to that connection. */
export function createServer(): Server {
  const server = new Server({ name: ENGINE_NAME, version: ENGINE_VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  const session = new Session();
  server.setRequestHandler('tools/list', async () => ({ tools: TOOLS }));
  server.setRequestHandler('tools/call', async (request) => {
    const name = request.params.name;
    if (!(TOOL_NAMES as readonly string[]).includes(name)) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      return await session.call(name, args);
    } catch (e) {
      // Not a malformed call (those come back as isError replies): an engine fault.
      throw new ProtocolError(ProtocolErrorCode.InternalError, `${ENGINE_NAME} fault in ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return server;
}
