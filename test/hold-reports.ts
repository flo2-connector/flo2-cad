// Preloaded by `npm test` (node --import): every check report the engine makes in a test's own
// process is held to its published contract, contracts/check-report.schema.json, as it is made
// (src/engine.ts, REPORT_WATCHERS). A report that breaks it throws where it was made, failing the
// test that made it. Reports made in another process (the shipped server, a timed run) are held
// to it by the tests that read them (test/report-contract.ts).

import { REPORT_WATCHERS } from '../src/engine.js';
import { holdToContract } from './report-contract.js';

REPORT_WATCHERS.push((report) => holdToContract(report, `the check report for "${String(report['piece'])}" revision ${String(report['revision'])}`));
