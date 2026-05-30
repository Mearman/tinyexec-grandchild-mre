// Reproduce the lint-staged hang in an isolated temp git repo. Copies the
// scenario files (eslint config, tsconfig, src) into a fresh tmpdir, links
// node_modules over, inits git, stages an edit, runs lint-staged with a
// hard wall-clock budget. Exits non-zero on hang (timeout) or non-zero
// lint-staged exit.
//
// The MRE is for the deadlock seen in the wild when eslint runs with
// typescript-eslint `projectService: true`: eslint spawns tsserver, eslint
// exits, tsserver lives on holding tinyexec's piped stdout open. tinyexec
// 1.2.2 deadlocks; 1.2.3 added destroy-on-exit which avoids the deadlock
// but introduces a buffer-drain race on Linux. Both bugs are demonstrated
// here depending on the override version of tinyexec.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = Number(process.env.MRE_TIMEOUT_MS ?? 30_000);

function copyTree(src, dst) {
  fs.mkdirSync(dst, {recursive: true});
  for (const entry of fs.readdirSync(src, {withFileTypes: true})) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

function run(cmd, args, cwd, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {cwd, stdio: 'inherit', ...opts});
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited code=${code} signal=${signal}`));
    });
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-staged-mre-'));
console.log(`[mre] tmp dir: ${tmp}`);

try {
  // Copy scenario files
  fs.copyFileSync(path.join(here, 'package.json'), path.join(tmp, 'package.json'));
  fs.copyFileSync(path.join(here, 'eslint.config.js'), path.join(tmp, 'eslint.config.js'));
  fs.copyFileSync(path.join(here, 'tsconfig.json'), path.join(tmp, 'tsconfig.json'));
  copyTree(path.join(here, 'src'), path.join(tmp, 'src'));

  // Link node_modules to avoid a second install. 'junction' works on
  // Windows without admin; the type arg is ignored on Linux/macOS.
  fs.symlinkSync(path.join(here, 'node_modules'), path.join(tmp, 'node_modules'), 'junction');

  // Show the resolved tinyexec version so CI logs make the matrix obvious
  const resolved = JSON.parse(
    fs.readFileSync(path.join(here, 'node_modules', 'tinyexec', 'package.json'), 'utf8')
  );
  console.log(`[mre] resolved tinyexec version: ${resolved.version}`);

  // Init git in temp
  await run('git', ['init', '--initial-branch=main', '-q'], tmp);
  await run('git', ['config', 'user.email', 'mre@example.com'], tmp);
  await run('git', ['config', 'user.name', 'MRE'], tmp);
  await run('git', ['add', '.'], tmp);
  await run('git', ['commit', '-m', 'initial', '-q', '--no-verify'], tmp);

  // Stage an edit so lint-staged has something to act on
  fs.appendFileSync(path.join(tmp, 'src', 'example.ts'), '\nexport const farewell = "bye";\n');
  await run('git', ['add', 'src/example.ts'], tmp);

  // Run lint-staged with a wall-clock budget
  const lintStagedBin = path.join(tmp, 'node_modules', 'lint-staged', 'bin', 'lint-staged.mjs');
  console.log(`[mre] launching lint-staged (timeout ${TIMEOUT_MS}ms)…`);
  const started = Date.now();

  const child = spawn(process.execPath, [lintStagedBin, '--debug'], {
    cwd: tmp,
    stdio: 'inherit'
  });

  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    console.error(`\n[mre] !!! TIMEOUT after ${TIMEOUT_MS}ms — deadlock`);
    try {
      child.kill('SIGKILL');
    } catch {}
  }, TIMEOUT_MS);

  const exit = await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      clearTimeout(killTimer);
      resolve({code, signal});
    });
  });

  const elapsedMs = Date.now() - started;
  console.log(`[mre] lint-staged exited after ${elapsedMs}ms code=${exit.code} signal=${exit.signal}`);

  if (timedOut) process.exit(1);
  process.exit(exit.code ?? 1);
} finally {
  // Best-effort tsserver cleanup so CI doesn't hang on orphaned tsserver
  spawn('pkill', ['-f', 'tsserver'], {stdio: 'ignore'}).on('error', () => {});
  try {
    fs.unlinkSync(path.join(tmp, 'node_modules'));
  } catch {}
  fs.rmSync(tmp, {recursive: true, force: true});
}
