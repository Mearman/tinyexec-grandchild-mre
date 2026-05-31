// Run a real `git commit` through a real pre-commit hook and assert
// that git supplied the hook with stdin redirected away from any pipe
// the parent shell handed in. The harness passes `git commit` a piped
// stdin from this process, then reads the hook's probe of fd 0 from a
// known file. The expected result: hook reports isatty=no, the
// spawned node child reports isTTY=false and isCharacterDevice=true
// (i.e. fd 0 is /dev/null), and the commit completes within the
// timeout without hanging.
//
// Background: the original lint-staged-hang diagnosis hypothesised
// that grandchild processes inherited a pipe stdin from the git hook
// shell and blocked on it. Git's hook.c sets cp->no_stdin=1 for
// pre-commit hooks by default, so the hook starts with stdin closed
// (redirected to /dev/null). Anything the hook spawns inherits that
// same /dev/null, not a pipe. This scenario verifies that property
// across platforms and Node versions in CI.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = Number(process.env.MRE_TIMEOUT_MS ?? 15_000);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'via-husky-mre-'));
const probeFile = path.join(tmp, 'probe.txt');
const childProbe = path.join(here, 'child-stdin-probe.mjs');

console.log(`[mre] tmp dir: ${tmp}`);
console.log(`[mre] probe file: ${probeFile}`);
console.log(`[mre] node: ${process.execPath}`);

const run = (cmd, args, cwd, extra = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {cwd, stdio: 'inherit', ...extra});
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited code=${code} signal=${signal}`));
    });
  });

const writeHookScript = () => {
  const hookDir = path.join(tmp, '.husky');
  fs.mkdirSync(hookDir);
  const probeFileEscaped = JSON.stringify(probeFile);
  const childProbeEscaped = JSON.stringify(childProbe);
  const nodeEscaped = JSON.stringify(process.execPath);
  const hookScript = `#!/bin/sh
{
  echo "=== hook ==="
  if [ -t 0 ]; then echo "isatty: yes"; else echo "isatty: no"; fi
  echo "ls -l /dev/fd/0:"
  ls -l /dev/fd/0 2>&1 || true
  echo "stat:"
  stat -f 'macos rdev=%Hr,%Lr' /dev/fd/0 2>/dev/null \\
    || stat -c 'linux device=%t,%T' /dev/fd/0 2>/dev/null \\
    || echo '(stat unavailable)'
} > ${probeFileEscaped} 2>&1

${nodeEscaped} ${childProbeEscaped} >> ${probeFileEscaped} 2>&1
`;
  const hookPath = path.join(hookDir, 'pre-commit');
  fs.writeFileSync(hookPath, hookScript, {mode: 0o755});
};

const captureProbe = () =>
  fs.existsSync(probeFile) ? fs.readFileSync(probeFile, 'utf8') : '(probe file not written)';

try {
  await run('git', ['init', '--initial-branch=main', '-q'], tmp);
  await run('git', ['config', 'user.email', 'mre@example.com'], tmp);
  await run('git', ['config', 'user.name', 'MRE'], tmp);
  await run('git', ['config', 'core.hooksPath', '.husky'], tmp);

  writeHookScript();

  fs.writeFileSync(path.join(tmp, 'file.txt'), 'hello\n');
  await run('git', ['add', 'file.txt'], tmp);

  console.log(`[mre] launching git commit (timeout ${TIMEOUT_MS}ms)…`);
  const started = Date.now();

  // Pass git an open pipe as stdin. If the original hypothesis were
  // correct, this pipe would be inherited by the hook, and anything
  // the hook spawned that reads from fd 0 would block forever.
  const commit = spawn('git', ['commit', '-m', 'mre commit'], {
    cwd: tmp,
    stdio: ['pipe', 'inherit', 'inherit']
  });

  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    console.error(`\n[mre] !!! TIMEOUT after ${TIMEOUT_MS}ms`);
    try {
      commit.kill('SIGKILL');
    } catch {}
  }, TIMEOUT_MS);

  const exit = await new Promise((resolve) => {
    commit.on('exit', (code, signal) => {
      clearTimeout(killer);
      resolve({code, signal});
    });
  });

  const elapsedMs = Date.now() - started;
  console.log(`[mre] git commit finished after ${elapsedMs}ms code=${exit.code} signal=${exit.signal}`);

  const probe = captureProbe();
  console.log('--- probe output ---');
  console.log(probe);
  console.log('--- end probe output ---');

  const sections = {};
  let current = null;
  for (const line of probe.split('\n')) {
    const header = line.match(/^=== (\S+) ===$/);
    if (header) {
      current = header[1];
      sections[current] = '';
    } else if (current) {
      sections[current] += line + '\n';
    }
  }
  const hookSection = sections.hook ?? '';
  const childSection = sections.child ?? '';

  const failures = [];
  if (timedOut) failures.push('git commit timed out (hook hung)');
  if (exit.code !== 0) failures.push(`git commit exited non-zero (code=${exit.code})`);
  if (!/isatty: no\b/.test(hookSection))
    failures.push('hook reported stdin as a TTY (expected no)');
  if (!/isTTY: false\b/.test(childSection))
    failures.push('child reported stdin as a TTY (expected false)');
  if (!/isCharacterDevice: true\b/.test(childSection))
    failures.push('child stdin is not a character device (probably not /dev/null)');
  if (/isFIFO: true\b/.test(childSection))
    failures.push('child stdin is a FIFO/pipe (would falsify the no-pipe claim)');

  if (failures.length === 0) {
    console.log('[mre] PASS: git redirected the hook stdin to /dev/null and the child inherited that.');
    process.exit(0);
  }

  console.error('[mre] FAIL:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
} finally {
  fs.rmSync(tmp, {recursive: true, force: true});
}
