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

/** Numbers as the 3MF schema's ST_Number: plain decimal, no exponent. */
function num(v: number): string {
  return (Math.round(v * 1e6) / 1e6).toFixed(6).replace(/\.?0+$/, '');
}

export function write3mf(mesh: Mesh, metadata: Readonly<Record<string, string>>): Buffer {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  parts.push('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n');
  for (const [k, v] of Object.entries(metadata)) parts.push(`  <metadata name="${xmlEscape(k)}">${xmlEscape(v)}</metadata>\n`);
  parts.push('  <resources>\n    <object id="1" type="model">\n      <mesh>\n        <vertices>\n');
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) parts.push(`          <vertex x="${num(p[i]!)}" y="${num(p[i + 1]!)}" z="${num(p[i + 2]!)}"/>\n`);
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
