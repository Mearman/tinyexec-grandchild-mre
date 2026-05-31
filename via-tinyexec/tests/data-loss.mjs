// Data-loss test (await x()).
//
// The child writes N lines (each ~64 bytes including newline) and then
// exits naturally. On 1.2.2 the streams aren't destroyed on exit so the
// parent reads everything via natural pipe drain + 'close'. On 1.2.3
// the streams are destroyed via setImmediate(...) after 'exit', which
// on Linux can fire before the kernel pipe buffer has fully drained,
// truncating the tail.
//
// The race is timing-sensitive. We run many iterations and report the
// distribution; any single iteration with fewer than N lines received
// counts as a loss.

import {x} from 'tinyexec';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'write-many-then-exit.mjs');

const LINES_PER_RUN = Number(process.env.MRE_LINES ?? 20000);
const ITERATIONS = Number(process.env.MRE_ITERATIONS ?? 50);

async function oneRun() {
  const result = await x(process.execPath, [fixture, String(LINES_PER_RUN)]);
  const lines = result.stdout.split('\n').filter((l) => l.length > 0);
  return lines.length;
}

const observed = [];
for (let i = 0; i < ITERATIONS; i++) {
  observed.push(await oneRun());
}

const losses = observed.filter((n) => n < LINES_PER_RUN);
const worstLoss = losses.length === 0 ? 0 : LINES_PER_RUN - Math.min(...observed);

console.log(
  `mode=await iterations=${ITERATIONS} lines/run=${LINES_PER_RUN} losses=${losses.length} worst-loss=${worstLoss}`
);
console.log(`distribution: min=${Math.min(...observed)} max=${Math.max(...observed)}`);

process.exit(losses.length === 0 ? 0 : 1);
