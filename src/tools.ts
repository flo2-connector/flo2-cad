// THE TOOL LIST: the published seam ifc:engine-tools-over-mcp. flo2's door
// offers only the names on its own fail-closed allowlist, so ANY change here
// (a name, an argument, a reply shape) is a change to BOTH repos (contract §5).
//
// Each tool is classed read or write for that allowlist; `readOnlyHint` says
// which. The descriptions are written for a CHAT agent working for someone who
// makes jewelry, not for an engineer.

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { PARAMS, TEMPLATES, TREE_FORMAT, type ParamSpec } from './piece/tree.js';

export const TOOL_NAMES = ['start_piece', 'change_piece', 'preview_piece', 'check_piece', 'export_for_casting', 'describe_piece'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** read: never changes the piece. write: makes a new revision of the piece, or files that are kept as the design's. */
export const TOOL_ACCESS: Readonly<Record<ToolName, 'read' | 'write'>> = {
  start_piece: 'write',
  change_piece: 'write',
  preview_piece: 'read',
  check_piece: 'read',
  export_for_casting: 'write',
  describe_piece: 'read',
};

export const PREVIEW_VIEWS = ['three_quarter', 'front', 'side', 'top', 'setting_closeup'] as const;
export const DEFAULT_VIEWS = ['three_quarter', 'side', 'setting_closeup'] as const;

type JsonSchema = Record<string, unknown>;

function paramSchema(p: ParamSpec): JsonSchema {
  const extra = [p.default !== undefined ? `Default ${JSON.stringify(p.default)}.` : '', p.limit ? `Casting limit ${p.limit}.` : '']
    .filter(Boolean)
    .join(' ');
  const description = extra ? `${p.help} ${extra}` : p.help;
  switch (p.kind) {
    case 'name':
      return { type: 'string', description, examples: ['emily-solitaire'] };
    case 'ring_size':
      return {
        type: 'object',
        description,
        required: ['system', 'size'],
        additionalProperties: false,
        properties: {
          system: { type: 'string', enum: ['US', 'UK', 'EU'], description: 'Which ring-size system the size is in. Always required: the same number is a different ring in each system.' },
          size: {
            type: ['string', 'number'],
            description: 'The size in that system. US: 3 to 16 in quarter sizes, e.g. "7" or "7.5". UK: a letter A to Z, halves allowed, e.g. "N" or "N½". EU: the inner circumference in mm, 38 to 76, e.g. "54".',
          },
        },
        examples: [{ system: 'US', size: '7' }],
      };
    case 'length':
      return {
        type: 'string',
        description: `${description} Write it in millimetres WITH the unit, e.g. "${p.default ?? '1.2 mm'}". A number with no unit, or inches or any other unit, is refused: convert it yourself and show the person the conversion. The library builds ${p.min} to ${p.max} mm.`,
        examples: [p.default ?? '1.2 mm'],
      };
    case 'enum':
      return typeof p.values![0] === 'number'
        ? { type: 'integer', enum: [...p.values!], description }
        : { type: 'string', enum: [...p.values!], description };
    case 'shrinkage':
      return { type: 'string', description, examples: ['off', '1.5 %'] };
  }
}

const PIECE_PROPERTIES: Record<string, JsonSchema> = Object.fromEntries(PARAMS.map((p) => [p.key, paramSchema(p)]));

const TREE: JsonSchema = {
  type: 'object',
  description: `The piece's tree (format "${TREE_FORMAT}"): the saved recipe for one piece, exactly as an earlier reply or the person's saved <name>.tree.json file gave it. Pass it to pick a piece up in a new conversation, or to work on a different piece; leave it out to work on the piece already open in this conversation. Every measurement in it carries its unit.`,
  required: ['format', 'name', 'revision', 'template', 'shrinkage', 'root'],
  properties: {
    format: { const: TREE_FORMAT },
    name: { type: 'string' },
    revision: { type: 'integer', minimum: 1 },
    template: { type: 'string', enum: [...TEMPLATES] },
    shrinkage: { type: 'string' },
    root: { type: 'object', description: 'The top node: {"id", "op" or "part", "feature", "params", "children"}. describe_piece explains the parts and operations.' },
  },
};

const PREVIEW_FLAG: JsonSchema = {
  type: 'boolean',
  default: true,
  description: 'Also return a picture of the piece (the default). Set false only to save time when making several changes in a row.',
};

function annotations(name: ToolName, title: string): Tool['annotations'] {
  const read = TOOL_ACCESS[name] === 'read';
  return { title, readOnlyHint: read, destructiveHint: false, idempotentHint: read, openWorldHint: false };
}

export const TOOLS: Tool[] = [
  {
    name: 'start_piece',
    title: 'Start a piece',
    description: [
      'Start a new piece of jewelry from a ready-made design, sized to the wearer.',
      '"solitaire_ring" is a band with one round stone held in a 4- or 6-prong head; "plain_band" is the band alone.',
      'Only the template and the ring size are needed; everything you leave out gets a safe default that sits comfortably above the casting limits.',
      'Every measurement is in millimetres and must be written with its unit ("1.6 mm"). A ring size must name its system: US, UK or EU.',
      'Returns a picture of the piece, a plain-language summary, and the piece\'s tree: its saved recipe, kept as <name>.tree.json.',
      'Starting a piece replaces the one open in this conversation (the old one is still saved).',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['template', 'ring_size'],
      additionalProperties: false,
      properties: {
        template: { type: 'string', enum: [...TEMPLATES], description: 'The starting design: "solitaire_ring" (a band and one round stone in prongs) or "plain_band".' },
        ...PIECE_PROPERTIES,
        preview: PREVIEW_FLAG,
      },
    },
    annotations: annotations('start_piece', 'Start a piece'),
  },
  {
    name: 'change_piece',
    title: 'Change the piece',
    description: [
      'Change the piece: resize it, switch the head between 4 and 6 prongs, thicken the prongs, change the stone size or the band, rename it, turn it into a plain band, or set a shrinkage allowance.',
      'Put only what changes in `set`; everything else stays as it was. For a setting the named ones do not cover, use "<part>.<setting>", e.g. {"head.seat_height": "3 mm"} or {"head.prong_overrides": [{"prong": 2, "thickness": "1.3 mm"}]}; describe_piece lists every part and setting.',
      'Or pass a whole edited `tree`, with or without `set`.',
      'Measurements need their unit ("1.2 mm"). Values below a casting limit are accepted so the person can see them, but such a piece will not export.',
      'Returns the new picture, what changed, and the updated tree; the piece\'s revision number goes up by one.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tree: TREE,
        set: {
          type: 'object',
          description: 'The settings to change, by name, each in the same form start_piece takes it. Keys of the form "<part>.<setting>" reach any setting of any part.',
          minProperties: 1,
          properties: PIECE_PROPERTIES,
          patternProperties: { '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$': { description: 'A setting of one part, by its id.' } },
          additionalProperties: false,
        },
        preview: PREVIEW_FLAG,
      },
    },
    annotations: annotations('change_piece', 'Change the piece'),
  },
  {
    name: 'preview_piece',
    title: 'Show the piece',
    description: [
      'Draw the piece so the person can see it: one picture with up to four views, large enough to judge a prong on a phone.',
      'Views: "three_quarter" (the usual jeweler\'s angle), "front", "side", "top", and "setting_closeup" (the stone and prongs, close).',
      'A preview is quick and is never refused, even for a piece that would not pass the casting checks; it may be a little less smooth than the casting file.',
      'Returns the picture as <name>.preview.png.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tree: TREE,
        views: {
          type: 'array',
          items: { type: 'string', enum: [...PREVIEW_VIEWS] },
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
          default: [...DEFAULT_VIEWS],
          description: `Which views to draw, 1 to 4. Default ${JSON.stringify(DEFAULT_VIEWS)}.`,
        },
      },
    },
    annotations: annotations('preview_piece', 'Show the piece'),
  },
  {
    name: 'check_piece',
    title: 'Check it will cast',
    description: [
      'Check whether the piece will print and cast, without exporting it.',
      'It writes the casting file in memory exactly as an export would, reads that file back, and measures it against every casting limit: one watertight solid; walls at least 0.8 mm; the band at least 1.0 mm; prongs at least 1.0 mm; details at least 0.35 mm; gaps at least 0.3 mm; the surface within 0.01 mm of the intended shape.',
      'Returns pass or fail for each limit with the thinnest place found, and for anything that fails, what to thicken and where on the piece. The full report comes back as <name>.check.json.',
      'A failed check is a normal answer, not an error: tell the person what to change.',
    ].join(' '),
    inputSchema: { type: 'object', additionalProperties: false, properties: { tree: TREE } },
    annotations: annotations('check_piece', 'Check it will cast'),
  },
  {
    name: 'export_for_casting',
    title: 'Make the casting files',
    description: [
      'Make the files to send to a printer or caster: <name>.stl (binary STL, millimetres) with <name>.3mf beside it, and <name>.check.json, the check report the caster reads.',
      'The files are released ONLY if every casting check passes on the file as written. Otherwise nothing is exported, and the reply says what to thicken and where; that is a normal answer, not an error, so tell the person and offer the change.',
      'The report says whether a shrinkage allowance was applied.',
    ].join(' '),
    inputSchema: { type: 'object', additionalProperties: false, properties: { tree: TREE } },
    annotations: annotations('export_for_casting', 'Make the casting files'),
  },
  {
    name: 'describe_piece',
    title: 'Describe the piece',
    description: [
      'Read back what the piece is now, in a jeweler\'s terms: the ring size (with its system and the inner diameter in mm), the band\'s width, thickness and profile, the stone and its setting, the overall size, the metal volume, and the estimated weight in sterling silver and in 14k and 18k gold.',
      'Also lists every part and every setting change_piece can change, with its allowed range, its default and its casting limit, and includes the piece\'s tree.',
      'Changes nothing and makes no files.',
    ].join(' '),
    inputSchema: { type: 'object', additionalProperties: false, properties: { tree: TREE } },
    annotations: annotations('describe_piece', 'Describe the piece'),
  },
];
