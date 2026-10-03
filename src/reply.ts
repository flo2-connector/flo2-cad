// Reply shapes, exactly as the seam fixes them (contract §1, §4):
//   · each file the engine produces is an embedded-resource block
//     { type: "resource", resource: { uri: "cadfile:///<name>", mimeType, blob } };
//   · <name> is a plain file name, [A-Za-z0-9._-] only;
//   · at most 11 MB of raw file bytes in one reply (so the base64 stays under
//     flo2's 16 MB), refused, never truncated, when larger;
//   · isError: true ONLY for a malformed call, its text naming the field path.

import { CallError } from './errors.js';

export const MAX_FILE_BYTES_PER_REPLY = 11_000_000;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ResourceBlock {
  type: 'resource';
  resource: { uri: string; mimeType: string; blob: string };
}
export type Block = TextBlock | ResourceBlock;

export interface ToolReply {
  [k: string]: unknown;
  content: Block[];
  isError?: boolean;
}

export interface OutFile {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Buffer;
}

export const MIME = {
  png: 'image/png',
  stl: 'model/stl',
  threeMf: 'model/3mf',
  json: 'application/json',
} as const;

export function text(t: string): TextBlock {
  return { type: 'text', text: t };
}

export function fileBlock(f: OutFile): ResourceBlock {
  if (!FILE_NAME.test(f.name) || f.name.includes('..')) {
    throw new Error(`engine bug: file name ${JSON.stringify(f.name)} is not a plain [A-Za-z0-9._-] name`);
  }
  return { type: 'resource', resource: { uri: `cadfile:///${f.name}`, mimeType: f.mimeType, blob: f.bytes.toString('base64') } };
}

/** A normal reply: text blocks first, then the files. Refuses (normally) when the files are too big together. */
export function reply(texts: string[], files: OutFile[] = []): ToolReply {
  const total = files.reduce((n, f) => n + f.bytes.length, 0);
  if (total > MAX_FILE_BYTES_PER_REPLY) {
    const list = files.map((f) => `${f.name} ${(f.bytes.length / 1e6).toFixed(2)} MB`).join(', ');
    return {
      content: [
        text(
          `Not sent: the files for this reply come to ${(total / 1e6).toFixed(2)} MB (${list}), over the ${MAX_FILE_BYTES_PER_REPLY / 1e6} MB a reply may carry. Nothing was cut short. Ask for fewer preview views, or tell the person the piece is too detailed to send in one reply.`,
        ),
      ],
      isError: false,
    };
  }
  return { content: [...texts.map(text), ...files.map(fileBlock)], isError: false };
}

/** The one error shape: a malformed call, naming the field path. */
export function callError(e: CallError): ToolReply {
  return { content: [text(`Malformed call. ${e.path}: ${e.problem}`)], isError: true };
}
