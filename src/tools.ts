// THE TOOL LIST: the published seam ifc:engine-tools-over-mcp. flo2's door
// offers only the names on its own fail-closed allowlist, so ANY change here
// (a name, an argument, a reply shape) is a change to BOTH repos (contract §5).
//
// Each tool is classed read or write for that allowlist; `readOnlyHint` says
// which. The descriptions are written for a CHAT agent working for someone who
// makes jewelry, not for an engineer.

import type { JSONObject, Tool } from '@modelcontextprotocol/server';
import { PROGRAM_FORMAT, PROGRAM_MAX_CHARS, PROGRAM_UNITS } from './piece/program.js';
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

type JsonSchema = JSONObject;

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
      return { type: 'string', description, examples: ['off', 'on', '1.5 %'] };
    case 'carat':
      return { type: 'string', description, examples: ['2.00 ct'] };
    case 'lip':
      return { type: 'string', description: `${description} Write a height with its unit, e.g. "0.7 mm", or "auto".`, examples: ['auto', '0.7 mm'] };
  }
}

const PIECE_PROPERTIES: Record<string, JsonSchema> = Object.fromEntries(PARAMS.map((p) => [p.key, paramSchema(p)]));

const TREE: JsonSchema = {
  type: 'object',
  description: `The piece's file, exactly as an earlier reply or the person's saved <name>.tree.json gave it: a tree (format "${TREE_FORMAT}", built from a template's parts and operations) or a program piece (format "${PROGRAM_FORMAT}", holding the JavaScript that builds it). Pass it to pick a piece up in a new conversation, or to work on a different piece; leave it out to work on the piece already open in this conversation. Every measurement in a tree carries its unit; a program's bare numbers are millimetres.`,
  required: ['format', 'name', 'revision'],
  properties: {
    format: { type: 'string', enum: [TREE_FORMAT, PROGRAM_FORMAT] },
    name: { type: 'string' },
    revision: { type: 'integer', minimum: 1 },
    template: { type: 'string', enum: [...TEMPLATES], description: 'A tree only: the template it was started from.' },
    metal: { type: 'string' },
    shrinkage: { type: 'string' },
    root: {
      type: 'object',
      description:
        'A tree only. The top node: {"id", "op" or "part", "feature", "params", "children"}. describe_piece lists the parts and every operation with its settings, among them "thicken", which gives a petal or leaf outline laid on a curved surface a stated thickness.',
    },
    units: { const: PROGRAM_UNITS, description: 'A program piece only: its bare numbers are millimetres (and degrees for angles).' },
    program: { type: 'string', description: 'A program piece only: the JavaScript that builds it.' },
  },
};

const PROGRAM: JsonSchema = {
  type: 'string',
  maxLength: PROGRAM_MAX_CHARS,
  description: [
    'The piece written as a short JavaScript program, for any shape the templates and operations do not make (a cabochon, a lion\'s face, a ship\'s hull): it builds the piece from the kernel\'s general shapes (sphere, cylinder, box, extrude, revolve, sweep, hull, union, difference, smoothUnion ...) and the jewelry library (ringShank, roundStone, emeraldStone, cabochon, stone, prongHead, bezel, thicken, op), and ends with "return <the piece>;". describe_piece lists every call with its settings, and shows any template piece written as a program.',
    'Bare numbers are millimetres (degrees for angles); a string carries its unit. A ring shank stands round the Y axis through the origin, a stone setting upright on top of it at +Z.',
    'It runs confined, in its own process with a time and memory limit, reaching nothing but the library: no require, files, network or timers. A program that fails is refused with the line and the reason, and nothing changes.',
    'The program is kept as the piece\'s file (<name>.tree.json), every version, and checked and exported exactly like any piece. Example: "const band = ringShank({ ring_size: { system: \'US\', size: \'7\' } }); const head = prongHead({ on: band, stone: roundStone({ diameter: 6.5, depth: 4.0 }) }); return union(band, head);"',
  ].join(' '),
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
      'Start a new piece of jewelry from a ready-made design, sized to the wearer, or from a program you write (pass "program" instead of "template": any shape at all, see below).',
      '"solitaire_ring" is a band with one round stone in a 4- or 6-prong head; "plain_band" is the band alone; "emerald_bezel_solitaire" is Emily\'s design: an emerald-cut stone in a full platinum 950 bezel, set east-west, on a plain round band.',
      'The head (prong_head or bezel), the stone (round or emerald cut), the metal (silver, 14k or 18k gold, platinum 950) and every size are settings, so any template can become any of these.',
      'Size the stone from its MEASURED dimensions on its grading report (length, width and depth in mm, or diameter and depth for a round), never from a carat chart. Until you give them, the stone\'s size is a placeholder and the replies and picture say so.',
      'Only the template and the ring size are needed; everything you leave out gets a safe default that sits comfortably above the casting limits.',
      'Every measurement is in millimetres and must be written with its unit ("1.6 mm"). A ring size must name its system: US, UK or EU.',
      'Returns a picture of the piece, a plain-language summary, and the piece\'s tree: its saved recipe, kept as <name>.tree.json.',
      'Starting a piece replaces the one open in this conversation (the old one is still saved).',
      'Give EITHER "template" with "ring_size" (and any settings), OR "program" (with "name", "metal" and "shrinkage" if you like; the program sets everything else).',
    ].join(' '),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        template: {
          type: 'string',
          enum: [...TEMPLATES],
          description: 'The starting design: "solitaire_ring" (a band and one round stone in prongs), "plain_band", or "emerald_bezel_solitaire" (Emily\'s design: an emerald cut in a full platinum bezel, east-west, on a round band). Needed unless you pass "program".',
        },
        ...PIECE_PROPERTIES,
        program: PROGRAM,
        preview: PREVIEW_FLAG,
      },
    },
    annotations: annotations('start_piece', 'Start a piece'),
  },
  {
    name: 'change_piece',
    title: 'Change the piece',
    description: [
      'Change the piece: resize it, give the stone\'s measured size, switch between a prong head and a full bezel or between 4 and 6 prongs, thicken the prongs or the bezel, change the band or the metal, turn the stone east-west or north-south, rename it, make it a plain band, or set a shrinkage allowance.',
      'Put only what changes in `set`; everything else stays as it was. For a setting the named ones do not cover, use "<part>.<setting>", e.g. {"head.seat_height": "3 mm"} or {"head.prong_overrides": [{"prong": 2, "thickness": "1.3 mm"}]}; describe_piece lists every part and setting.',
      'Or pass a whole edited `tree`, with or without `set`. That is how you add shapes of your own: add operation nodes to the root\'s children, such as a cupped or curled petal or leaf ("thicken"), a wire ("sweep") or a fillet ("smooth_union"); describe_piece lists every operation and its settings. Then "<id>.<setting>" in `set` reaches any of them, e.g. {"petal_1.thickness": "1.0 mm"}.',
      'Measurements need their unit ("1.2 mm"). Values below a casting limit are accepted so the person can see them, but such a piece will not export.',
      'Or pass "program": the whole piece written as a program, for any shape the settings and operations cannot make. A template piece then goes on as a program (describe_piece shows it written as one), and a piece already written as a program takes its next version this way; its set takes only name, metal and shrinkage.',
      'Returns the new picture, what changed, and the updated tree; the piece\'s revision number goes up by one.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tree: TREE,
        program: PROGRAM,
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
      'It writes the casting file in memory exactly as an export would, reads that file back, and measures it against every casting limit of the piece\'s metal: one watertight solid; walls at least 0.8 mm; the band at least 1.0 mm; each prong at least 1.0 mm at its narrowest; a bezel rim at least 0.8 mm, with a lip covering 50-75 % of a faceted stone\'s crown, or rising at least a third of a declared cabochon\'s dome; prongs reaching over the girdle; each thickened sheet (a petal or leaf made with "thicken") at least 0.8 mm, measured square to its surface; details at least 0.35 mm; gaps at least 0.3 mm (0.8 mm in platinum); the surface within 0.01 mm of the intended shape.',
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
      'The stone is never in the casting files. The report says whether a shrinkage allowance was applied. A platinum piece goes to a SPECIALIST platinum caster (it is cast at about 1850-2200 °C), and the reply says so.',
    ].join(' '),
    inputSchema: { type: 'object', additionalProperties: false, properties: { tree: TREE } },
    annotations: annotations('export_for_casting', 'Make the casting files'),
  },
  {
    name: 'describe_piece',
    title: 'Describe the piece',
    description: [
      'Read back what the piece is now, in a jeweler\'s terms: the ring size (with its system and the inner diameter in mm), the band\'s width, thickness and profile, the stone (its measured size, and which sizes are still placeholders) and its setting, the metal and its casting limits, the overall size, the metal volume, and the estimated weight in sterling silver, 14k and 18k gold and platinum 950.',
      'It also gives the dimensions the piece is built to, in mm, each the figure the engine itself uses: the band\'s inner and outer diameter, width and thickness; the stone\'s seat (its size across at the girdle and the clearance a side); a bezel\'s wall, its outside size, the lip height it works out, and how far it stands above the band; each prong\'s thickness, its narrowest section where the seat is cut, and how far it reaches over the girdle; and the room under the stone\'s point. Work a fit, a weight or a cost from these, never from an assumed size.',
      'Also lists every part and every setting change_piece can change, with its allowed range, its default and its casting limit, and includes the piece\'s tree. It also lists what a program can call, and shows a template piece written as a program, ready to change. For a piece written as a program, it gives the dimensions each library part in it was built to.',
      'Changes nothing and makes no files.',
    ].join(' '),
    inputSchema: { type: 'object', additionalProperties: false, properties: { tree: TREE } },
    annotations: annotations('describe_piece', 'Describe the piece'),
  },
];
