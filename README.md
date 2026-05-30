# tinyexec grandchild-pipe MRE

Minimal reproduction of two related tinyexec bugs that surfaced in lint-staged
in the wild:

1. **Grandchild-pipe deadlock** (tinyexec ≤ 1.2.2). When a child of `x()`
   spawns a grandchild that inherits the piped stdout fd, the grandchild
   keeps the pipe open after the child exits. `await x()` and the async
   iterator both hang. Filed as [tinylibs/tinyexec#138](https://github.com/tinylibs/tinyexec/issues/138)
   / [lint-staged/lint-staged#1800](https://github.com/lint-staged/lint-staged/issues/1800).
2. **Buffer-drain race** (tinyexec 1.2.3, regression from [PR #137](https://github.com/tinylibs/tinyexec/pull/137)).
   The destroy-on-exit fix added in 1.2.3 races with kernel pipe drain on
   Linux, dropping the tail of the child's stdout. Reverted in
   `lint-staged@17.0.6`; tracked in
   [tinylibs/tinyexec#139](https://github.com/tinylibs/tinyexec/issues/139).

The MRE reproduces both, both directly against tinyexec and through
lint-staged. CI runs an OS × Node × tinyexec-version × scenario matrix so
you can see which combinations deadlock or lose data.

## Layout

```
via-tinyexec/      direct tinyexec usage (lower-level repro)
  fixtures/        child / grandchild scripts
  tests/           deadlock + data-loss tests
via-lint-staged/   lint-staged + eslint + projectService (user-facing repro)
  src/             a lintable .ts file
  reproduce.mjs    spins up a temp git repo and runs lint-staged
scripts/
  set-tinyexec-version.mjs   pins the tinyexec version pre-install
.github/workflows/
  ci.yml           the matrix
```

## Local run

Pin to whichever tinyexec version you want to test, then install and run:

```bash
MRE_TINYEXEC_VERSION=1.1.2 node scripts/set-tinyexec-version.mjs

# direct tinyexec scenarios
npm install --prefix via-tinyexec
npm test --prefix via-tinyexec               # runs deadlock + data-loss
npm run test:deadlock --prefix via-tinyexec  # just the deadlock test
npm run test:data-loss --prefix via-tinyexec # just the data-loss test

# lint-staged scenario
npm install --prefix via-lint-staged
npm test --prefix via-lint-staged
```

## Expected matrix outcomes

| tinyexec | deadlock test | data-loss test | lint-staged repro |
|---|---|---|---|
| 1.1.2 (and earlier) | **HANG/FAIL** (no fix) | pass | **HANG/FAIL** |
| 1.2.2 | **HANG/FAIL** (no fix) | pass | **HANG/FAIL** |
| 1.2.3 | pass (destroy fix works) | **FAIL on Linux** (race) | pass on macOS, FAIL on Linux |

The two bugs are not simultaneously fixed by any released version.

## Versions where this was originally hit (in joe's repos)

| Repo | lint-staged | tinyexec (resolved) |
|---|---|---|
| `schema-components` | 17.0.4 | 1.1.2 |
| `infra-cli` | 16.4.0 | 1.1.1 |
| `agent-comms` | 17.0.4 | 1.1.2 |
| `guild` | 16.4.0 | 1.0.4 |

Default of `1.1.2` was chosen because it's the most recent pre-fix
version we hit it on.
