// 3MF (ISO/IEC 25422:2025) writer: the core-spec package, unit millimetre,
// one object, written through our own ZIP writer over node:zlib.

import type { Mesh } from './mesh.js';
import { writeZip } from './zip.js';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A coordinate as the 3MF schema's ST_Number (plain decimal, no exponent): the shortest one
 * that reads back as the very float32 the STL holds, so both casting files carry the same
 * vertices, the ones the checker read back from the STL. Six fixed decimals, as before, are
 * coarser than float32 below 8 mm and merged vertices the STL kept apart: the moonstone's
 * 3MF would have collapsed 114 triangles
 * (fact:a-round-stone-in-a-bezel-fails-the-watertight-check-2026-10-05).
 */
export function float32Text(v: number): string {
  const f = Math.fround(v);
  if (f === 0) return '0';
  // Nine significant digits name every float32; most need fewer.
  for (let p = 1; p < 9; p++) {
    const s = f.toPrecision(p);
    if (Math.fround(Number(s)) === f) return plainDecimal(s);
  }
  return plainDecimal(f.toPrecision(9));
}

/** A number written out without an exponent, and without trailing zeros after its point. */
function plainDecimal(s: string): string {
  let out = s;
  const e = s.search(/e/i);
  if (e >= 0) {
    // toPrecision uses an exponent for very small or large values: write the same digits out in full.
    const decimals = Math.max(0, (s.slice(0, e).split('.')[1]?.length ?? 0) - Number(s.slice(e + 1)));
    out = Number(s).toFixed(decimals);
  }
  return out.includes('.') ? out.replace(/0+$/, '').replace(/\.$/, '') : out;
}

export function write3mf(mesh: Mesh, metadata: Readonly<Record<string, string>>): Buffer {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  parts.push('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n');
  for (const [k, v] of Object.entries(metadata)) parts.push(`  <metadata name="${xmlEscape(k)}">${xmlEscape(v)}</metadata>\n`);
  parts.push('  <resources>\n    <object id="1" type="model">\n      <mesh>\n        <vertices>\n');
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) parts.push(`          <vertex x="${float32Text(p[i]!)}" y="${float32Text(p[i + 1]!)}" z="${float32Text(p[i + 2]!)}"/>\n`);
  parts.push('        </vertices>\n        <triangles>\n');
  const t = mesh.triangles;
  for (let i = 0; i < t.length; i += 3) parts.push(`          <triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>\n`);
  parts.push('        </triangles>\n      </mesh>\n    </object>\n  </resources>\n  <build>\n    <item objectid="1"/>\n  </build>\n</model>\n');
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(RELS, 'utf8') },
    { name: '3D/3dmodel.model', data: Buffer.from(parts.join(''), 'utf8') },
  ]);
}
