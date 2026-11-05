// The check report's published contract (ifc:check-report), contracts/check-report.schema.json,
// as the tests hold every report to it: the ones the engine makes in a test's own process
// (test/hold-reports.ts, preloaded by `npm test`, watches the engine for them) and the ones
// that come back over MCP or from another process (the tests that read them call this).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

export const SCHEMA_PATH = fileURLToPath(new URL('../../contracts/check-report.schema.json', import.meta.url));

type Validate = ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string; params?: unknown }[] | null };
let validate: Validate | null = null;

function validator(): Validate {
  if (!validate) {
    const ajv = new Ajv2020.default({ strict: true, allErrors: true, strictRequired: false, strictTypes: false });
    validate = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))) as unknown as Validate;
  }
  return validate;
}

/** Every way the report breaks the contract, each by its path; empty when it holds. */
export function reportProblems(report: unknown): string[] {
  const v = validator();
  if (v(report)) return [];
  return (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''} ${e.params ? JSON.stringify(e.params) : ''}`.trim());
}

/** Throws, naming each problem, unless the report holds to contracts/check-report.schema.json. */
export function holdToContract(report: unknown, what = 'the check report'): void {
  const problems = reportProblems(report);
  if (problems.length) throw new Error(`${what} breaks contracts/check-report.schema.json:\n  ${problems.slice(0, 20).join('\n  ')}`);
}
