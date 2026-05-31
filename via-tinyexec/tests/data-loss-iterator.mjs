// Data-loss test (async iterator path).
//
// Same child as data-loss.mjs (writes N lines, exits naturally) but
// consumed via the async iterator: `for await (const line of x())`.
// This is the exact pattern that broke lint-staged 17.0.5 on Linux Node
// 22.x — the iterator hands lines to the consumer one at a time, and if
// tinyexec destroys the underlying PassThrough before the kernel pipe
// has drained the iterator yields fewer lines than the child wrote.

import {x} from 'tinyexec';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'write-many-then-exit.mjs');

const LINES_PER_RUN = Number(process.env.MRE_LINES ?? 20000);
const ITERATIONS = Number(process.env.MRE_ITERATIONS ?? 50);

async function oneRun() {
  let received = 0;
  for await (const _line of x(process.execPath, [fixture, String(LINES_PER_RUN)])) {
    received++;
  }
  return received;
}

const observed = [];
for (let i = 0; i < ITERATIONS; i++) {
  observed.push(await oneRun());
}

const losses = observed.filter((n) => n < LINES_PER_RUN);
const worstLoss = losses.length === 0 ? 0 : LINES_PER_RUN - Math.min(...observed);

console.log(
  `mode=iterator iterations=${ITERATIONS} lines/run=${LINES_PER_RUN} losses=${losses.length} worst-loss=${worstLoss}`
);
console.log(`distribution: min=${Math.min(...observed)} max=${Math.max(...observed)}`);

process.exit(losses.length === 0 ? 0 : 1);
