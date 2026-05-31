# tinyexec grandchild-pipe MRE

Two related tinyexec bugs that surface as lint-staged pre-commit hangs:

1. **Grandchild-pipe deadlock** (tinyexec ≤ 1.2.2). When a child of `x()`
   spawns a grandchild that inherits the piped stdio fds, the grandchild
   keeps the pipe open after the child exits. `await x()` and the async
   iterator both hang. Filed as
   [tinylibs/tinyexec#138](https://github.com/tinylibs/tinyexec/issues/138)
   / [lint-staged/lint-staged#1800](https://github.com/lint-staged/lint-staged/issues/1800),
   merged as
   [tinylibs/tinyexec#137](https://github.com/tinylibs/tinyexec/pull/137).
2. **Buffer-drain race** (tinyexec 1.2.3, regression from PR #137). The
   destroy-on-exit fix races with kernel pipe drain on Linux, dropping
   the tail of the child's stdout. Reverted in `lint-staged@17.0.6`;
   tracked in
   [tinylibs/tinyexec#139](https://github.com/tinylibs/tinyexec/issues/139).

## What this MRE proves

`via-tinyexec/` reproduces bug #1 **deterministically** across the
matrix. A handcrafted child spawns a long-running grandchild with
`stdio: ['ignore', 1, 'ignore']`, then exits. The parent's `await x()`
and the async iterator both hang until either the grandchild exits or a
hard timeout fires. With tinyexec 1.2.3+ the destroy-on-exit fix
unblocks them.

`via-lint-staged/` puts together the user-facing chain (lint-staged →
eslint with `typescript-eslint` `projectService: true`, optionally via
`pnpm exec`, with `eslint-plugin-prettier`, on `eslint.config.ts` loaded
via jiti, with a standalone `lint-staged.config.ts`, with stdin held
open as a pipe). In a clean MRE environment, **none of these
combinations reproduce the user-facing hang**, because the trigger isn't
any one of those pieces — it's a specific grandchild that reads from
inherited stdin, which a minimal eslint config doesn't spawn.

## Root cause

The deadlock is caused by **child processes inheriting stdin from the
git hook's shell pipe**. When eslint's TypeScript `projectService` (or
`turbo`/`pnpm`/another tool further down the chain) spawns its own child
process, that grandchild inherits stdin. If stdin is a pipe from git
(not a terminal), the grandchild reads from it and never sees EOF —
holding the stdio handles open. tinyexec ≤ 1.2.2 waits for the piped
stdio to close. Deadlock.

The workaround in real pre-commit hooks is to close fd 0 explicitly on
every `pnpm`/`node`/`turbo` invocation:

```sh
# .husky/pre-commit
pnpm exec lint-staged <&-
```

`<&-` closes file descriptor 0 (stdin) before spawning, so no child or
grandchild can read from it.

## Layout

```
via-tinyexec/      direct tinyexec usage (lower-level repro — reliable)
  fixtures/        child + grandchild scripts
  tests/           deadlock + data-loss tests
via-lint-staged/   lint-staged + eslint + projectService (chain test)
  src/             a lintable .ts file
  eslint.config.ts flat config with prettier + recommendedTypeChecked
  lint-staged.config.ts
  reproduce.mjs    spins up a temp git repo, opens stdin as a pipe, runs lint-staged
scripts/
  set-tinyexec-version.mjs   pins the tinyexec version pre-install
.github/workflows/ci.yml
```

## Local run

```bash
MRE_TINYEXEC_VERSION=1.1.2 node scripts/set-tinyexec-version.mjs

# tinyexec direct (definitive reproducer for the deadlock bug)
(cd via-tinyexec && npm install && npm test)

# lint-staged chain (does not reproduce in this env — see note above)
(cd via-lint-staged && npm install && npm test)
```

## Matrix outcomes (observed)

CI matrix is OS × Node × tinyexec version × task variant.

| Scenario / version | tinyexec 1.1.2 | tinyexec 1.2.2 | tinyexec 1.2.3 |
|---|---|---|---|
| via-tinyexec **deadlock** test | **HANG/FAIL** (Linux + macOS) | **HANG/FAIL** | pass (destroy fix works) |
| via-tinyexec **data-loss** test | pass | pass | pass (race didn't surface in pinned-N fixture) |
| via-lint-staged (npm task) | pass | pass | pass |
| via-lint-staged (pnpm exec task) | pass | pass | pass |

The via-tinyexec deadlock cells pass on Windows because the
pipe-inheritance model differs there. The bug is real on Unix-like
systems; tinyexec/lint-staged maintainers have confirmed the Linux CI
failures referenced in issue #139.

## Caveat on the SIGKILL signature

`[FAILED] eslint --fix --cache [SIGKILL]` in lint-staged output is
**not** necessarily a hang — it's lint-staged's log line when it
SIGKILLs sibling tasks during its revert phase after another task
failed first. The genuine hang signature is `git commit` returning no
prompt and the post-eslint hook script line never executing.
