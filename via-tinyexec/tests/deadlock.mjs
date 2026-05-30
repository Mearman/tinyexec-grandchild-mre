// Deadlock test. Uses tinyexec to spawn a child that itself spawns a
// long-running grandchild inheriting stdout, then exits. With no fix
// (1.2.2 and earlier), tinyexec's `await x()` and async iterator both
// hang until the grandchild exits (30s here). With the destroy fix
// (1.2.3+), they should resolve quickly.
//
// The test imposes a 10s wall-clock budget. If tinyexec doesn't return
// within that window, we exit non-zero and report a deadlock.

import {x} from 'tinyexec';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, '..', 'fixtures', 'child-spawns-grandchild.mjs');
const BUDGET_MS = 10_000;

function withBudget(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`DEADLOCK: ${label} did not resolve in ${BUDGET_MS}ms`)),
      BUDGET_MS
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runAwait() {
  const started = Date.now();
  const result = await withBudget(x(process.execPath, [fixture]), 'await x()');
  const elapsed = Date.now() - started;
  if (result.stdout.trim() !== 'expected-output') {
    throw new Error(`stdout mismatch: ${JSON.stringify(result.stdout)}`);
  }
  return elapsed;
}

async function runIterator() {
  const started = Date.now();
  const lines = [];
  const iter = (async () => {
    for await (const line of x(process.execPath, [fixture])) {
      lines.push(line);
    }
  })();
  await withBudget(iter, 'iterator x()');
  const elapsed = Date.now() - started;
  if (lines.join('\n').trim() !== 'expected-output') {
    throw new Error(`iterator output mismatch: ${JSON.stringify(lines)}`);
  }
  return elapsed;
}

const results = [];

for (const [name, fn] of [
  ['await', runAwait],
  ['iterator', runIterator]
]) {
  try {
    const ms = await fn();
    results.push({name, status: 'pass', ms});
    console.log(`pass  ${name.padEnd(8)} ${ms}ms`);
  } catch (err) {
    results.push({name, status: 'fail', error: err.message});
    console.log(`FAIL  ${name.padEnd(8)} ${err.message}`);
  }
}

// Best-effort cleanup so the GitHub Actions runner doesn't hang on the
// detached grandchild process keeping the job alive.
const {spawn} = await import('node:child_process');
spawn('pkill', ['-f', 'grandchild-keeper.mjs'], {stdio: 'ignore'}).on('error', () => {});

const failed = results.filter((r) => r.status === 'fail');
process.exit(failed.length === 0 ? 0 : 1);
