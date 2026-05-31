# tinyexec grandchild-pipe MRE

Two related tinyexec bugs that have been observed in the wild around
lint-staged pre-commit runs:

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

`via-tinyexec/` **reliably reproduces both bugs** at the tinyexec layer:

- The **grandchild-pipe deadlock** is reproduced deterministically on
  Linux and macOS with tinyexec ≤ 1.2.2. A handcrafted child spawns a
  long-running grandchild with `stdio: ['ignore', 1, 'ignore']`, then
  exits. The parent's `await x()` and the async iterator both hang until
  either the grandchild exits or a hard timeout fires. With tinyexec
  1.2.3+ the destroy-on-exit fix unblocks them.
- The **buffer-drain race** in tinyexec 1.2.3 is reproduced by the
  `data-loss-concurrent` test variant (10 in-flight invocations × 20
  rounds), which loses the tail of stdout on Linux. Sequential `await`
  and sequential `for await` consumption never expose it; the race needs
  event-loop pressure from concurrent invocations.

`via-lint-staged/` puts together the user-facing chain (lint-staged +
eslint with `typescript-eslint` `projectService: true`, optionally via
`pnpm exec`, with `eslint-plugin-prettier`, on `eslint.config.ts` loaded
via jiti, with a standalone `lint-staged.config.ts`, with stdin held
open as a pipe). **None of these combinations reproduce the user-facing
hang in this clean synthetic environment.** Every cell of the
via-lint-staged matrix passes.

That gap matters. Earlier drafts of this README asserted that the
lint-staged hangs reported in the wild **are** the tinyexec grandchild
deadlock, with stdin pipe inheritance from the git hook as the trigger.
The MRE does not demonstrate that link. We acknowledged the leap on
[tinylibs/tinyexec#139](https://github.com/tinylibs/tinyexec/issues/139#issuecomment-4586146036)
after
[a maintainer pointed it out](https://github.com/tinylibs/tinyexec/issues/139#issuecomment-4586003503).

## Empirical workaround in real repos

In real-world pre-commit hooks, closing fd 0 before invoking
`pnpm`/`node`/`turbo` fixes the hang:

```sh
# .husky/pre-commit
pnpm exec lint-staged <&-
```

`<&-` closes file descriptor 0 (stdin) before spawning, so no child or
grandchild can read from it. This works empirically. It is consistent
with a hypothesis that some grandchild in the chain inherits stdin from
the git hook's pipe and blocks waiting for EOF, which would in turn
expose the tinyexec deadlock. We have not isolated which subprocess
that is, and the MRE does not reproduce the chain, so treat this as the
fix that works rather than as proof of the mechanism.

## Layout

```
via-tinyexec/      direct tinyexec usage (lower-level repro)
  fixtures/        child + grandchild + write-many scripts
  tests/           deadlock + data-loss (sequential await, sequential iterator,
                   concurrent both) tests
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

# tinyexec direct: reproduces deadlock (≤1.2.2) and buffer-drain race (1.2.3)
(cd via-tinyexec && npm install && npm test)

# lint-staged chain: does not reproduce the user-facing hang in this env
(cd via-lint-staged && npm install && npm test)
```

## Matrix outcomes (observed)

CI matrix is OS × Node × tinyexec version × scenario.

| Scenario / version | tinyexec 1.1.2 | tinyexec 1.2.2 | tinyexec 1.2.3 |
|---|---|---|---|
| via-tinyexec **deadlock** | **HANG/FAIL** (Linux + macOS) | **HANG/FAIL** | pass (destroy fix works) |
| via-tinyexec **data-loss** (sequential `await`) | pass | pass | pass (race doesn't surface without concurrency) |
| via-tinyexec **data-loss-iterator** (sequential `for await`) | pass | pass | pass (same reason) |
| via-tinyexec **data-loss-concurrent** (10 in-flight × 20 rounds) | pass | pass | **FAIL on Linux** (race triggers) |
| via-lint-staged (npm / pnpm task) | pass | pass | pass |

Sample numbers for the buffer-drain race, Ubuntu Node 22 + tinyexec 1.2.3:

```
mode=await    concurrency=10 rounds=20 total=200 lines/run=5000 losses=16 worst-loss=1756
mode=iterator concurrency=10 rounds=20 total=200 lines/run=5000 losses=51 worst-loss=1756
distribution: min=3244 max=5000
```

Loss size is exactly one kernel pipe buffer (1756 lines × 36 bytes ≈ 63 KiB).
The async-iterator path drops data ~3× more often than `await`, matching
the pattern in lint-staged 17.0.5's failing CI (where the broken tests
used `for await (const line of …)` consumption).

The buffer-drain race needs **event loop pressure from concurrent
tinyexec invocations** to surface: sequential calls never expose it.
That's why the original report only showed up in lint-staged (which runs
several tasks in parallel) and not in tinyexec's own tests.

The via-tinyexec deadlock cells pass on Windows because the
pipe-inheritance model differs there.

## Caveat on the SIGKILL signature

`[FAILED] eslint --fix --cache [SIGKILL]` in lint-staged output is
**not** necessarily a hang: it's lint-staged's log line when it
SIGKILLs sibling tasks during its revert phase after another task
failed first. The genuine hang signature is `git commit` returning no
prompt and the post-eslint hook script line never executing.

## What we don't know

The exact trigger for the user-facing lint-staged hang remains
unidentified. Specifically:

- Which subprocess in the lint-staged + eslint + projectService chain
  reads from inherited stdin and blocks, in environments where it does
  hang.
- Whether that subprocess is exposed by tinyexec's grandchild-pipe
  deadlock, the buffer-drain race, both, or a third mechanism.
- Why a minimal synthetic chain (this MRE) with the same tools, configs,
  and a pipe on stdin does not reproduce the hang, while real-world
  monorepos do.

The two tinyexec bugs documented at the top of this README are real and
reproducible at the tinyexec layer. The link from those bugs to the
user-facing lint-staged hang is plausible and consistent with the
working `<&-` mitigation, but it is not what this MRE demonstrates.
