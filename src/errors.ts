// A malformed call: the one case that replies with `isError: true` (contract §4).
// Every one names the field path it is about, so the agent can fix exactly that
// field. A refused export or a failed check is NOT a CallError: it is a normal
// reply that says what to thicken and where.

export class CallError extends Error {
  readonly path: string;
  readonly problem: string;

  constructor(path: string, problem: string) {
    super(`${path}: ${problem}`);
    this.name = 'CallError';
    this.path = path;
    this.problem = problem;
  }
}

/** Joins a field path the way the error messages print it: `a.b[2].c`. */
export function at(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return path ? `${path}.${key}` : key;
  return `${path}[${JSON.stringify(key)}]`;
}
