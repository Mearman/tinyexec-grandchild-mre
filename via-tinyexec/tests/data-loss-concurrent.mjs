// Data-loss test (concurrent invocations).
//
// lint-staged runs its configured tasks via tinyexec concurrently. When
// the original CI failures hit on Linux Node 22.x, the parent process
// was juggling several tinyexec invocations at once and the event loop
// had real work to do. setImmediate timing in that context behaves
// differently than in a quiet test loop. This variant kicks off K
// concurrent runs per round to reproduce that pressure.

import {x} from 'tinyexec';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'write-many-then-exit.mjs');

const LINES_PER_RUN = Number(process.env.MRE_LINES ?? 5000);
const CONCURRENT = Number(process.env.MRE_CONCURRENT ?? 10);
const ROUNDS = Number(process.env.MRE_ROUNDS ?? 20);

async function oneAwait() {
  const result = await x(process.execPath, [fixture, String(LINES_PER_RUN)]);
  return result.stdout.split('\n').filter((l) => l.length > 0).length;
}

async function oneIterator() {
  let received = 0;
  for await (const _line of x(process.execPath, [fixture, String(LINES_PER_RUN)])) {
    received++;
  }
  return received;
}

const observed = {await: [], iterator: []};

for (let r = 0; r < ROUNDS; r++) {
  const awaitTasks = Array.from({length: CONCURRENT}, () => oneAwait());
  const iterTasks = Array.from({length: CONCURRENT}, () => oneIterator());
  const results = await Promise.all([...awaitTasks, ...iterTasks]);
  for (let i = 0; i < CONCURRENT; i++) {
    observed.await.push(results[i]);
    observed.iterator.push(results[CONCURRENT + i]);
  }
}

function report(mode, list) {
  const losses = list.filter((n) => n < LINES_PER_RUN);
  const worst = losses.length === 0 ? 0 : LINES_PER_RUN - Math.min(...list);
  console.log(
    `mode=${mode} concurrency=${CONCURRENT} rounds=${ROUNDS} total=${list.length} lines/run=${LINES_PER_RUN} losses=${losses.length} worst-loss=${worst}`
  );
  console.log(`  distribution: min=${Math.min(...list)} max=${Math.max(...list)}`);
  return losses.length;
}

const awaitLosses = report('await', observed.await);
const iterLosses = report('iterator', observed.iterator);

process.exit(awaitLosses + iterLosses === 0 ? 0 : 1);
