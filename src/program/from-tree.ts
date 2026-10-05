// A template piece written as a program: the same band, stone and setting, by the same
// library calls with the same settings, and every shape the tree adds by op() as it stands.
// describe_piece hands it to the agent, so a piece started from a template can go on as a
// program (change_piece with "program") without being drawn again from nothing.

import { findNode, type PieceTree } from '../piece/tree.js';

const js = (v: unknown) => JSON.stringify(v);
/** The fields of an object literal, without its braces. */
const fields = (o: Record<string, unknown>) => js(o).slice(1, -1).replace(/,"/g, ', "').replace(/":/g, '": ');

export function treeAsProgram(tree: PieceTree): string {
  const band = findNode(tree.root, 'band')!.params!;
  const head = findNode(tree.root, 'head');
  const extras = (tree.root.children ?? []).filter((c) => c.id !== 'band' && c.id !== 'head');
  const lines = [
    `// "${tree.name}", built from the "${tree.template}" template (revision ${tree.revision}), written as a program.`,
    `const band = ringShank({ ${fields({ ring_size: band['ring_size'], band_width: band['width'], band_thickness: band['thickness'], band_profile: band['profile'] })} });`,
  ];
  if (head) {
    const p = head.params!;
    const s = p['stone'] as Record<string, unknown>;
    const ph = (s['placeholder'] as string[] | undefined) ?? [];
    if (ph.length) lines.push(`// The stone's ${ph.join(', ')} ${ph.length === 1 ? 'is a placeholder' : 'are placeholders'}: put in the measured ${s['shape'] === 'round' ? 'diameter and depth' : 'length, width and depth'} from its grading report.`);
    const carat = s['carat'] !== undefined ? { carat: s['carat'] } : {};
    lines.push(
      s['shape'] === 'round'
        ? `const stone = roundStone({ ${fields({ diameter: s['diameter'], depth: s['depth'], ...carat })} });`
        : `const stone = emeraldStone({ ${fields({ length: s['length'], width: s['width'], depth: s['depth'], orientation: s['orientation'], ...carat })} });`,
    );
    const rest = Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'stone'));
    lines.push(`const head = ${head.part === 'bezel' ? 'bezel' : 'prongHead'}({ stone, on: band, ${fields(rest)} });`);
  }
  const all = ['band', ...(head ? ['head'] : []), ...extras.map((e) => `op(${js(e)})`)];
  lines.push(`return union(${all.join(', ')});`);
  return lines.join('\n');
}
