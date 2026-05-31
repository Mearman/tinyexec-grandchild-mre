// Runs both scenarios serially and reports a combined exit status.
// Each scenario already has its own pass/fail semantics; this just
// ensures both run and the worst result decides the overall status.

import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const scenarios = [
  ['deadlock', path.join(here, 'deadlock.mjs')],
  ['data-loss', path.join(here, 'data-loss.mjs')],
  ['data-loss-iterator', path.join(here, 'data-loss-iterator.mjs')]
];

let failed = 0;
for (const [name, file] of scenarios) {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(process.execPath, [file], {stdio: 'inherit'});
  if (result.status !== 0) {
    failed++;
    console.log(`=== ${name} FAILED (exit ${result.status}) ===`);
  } else {
    console.log(`=== ${name} ok ===`);
  }
}

process.exit(failed === 0 ? 0 : 1);
