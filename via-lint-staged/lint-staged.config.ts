// Separate TS lint-staged config (loaded by lint-staged via jiti). The
// matching shape in the wild repos — all the known-hanging repos have a
// standalone lint-staged.config.ts, not inline package.json config.
//
// MRE_LINT_STAGED_CMD is substituted into the task command at test time
// by reproduce.mjs (it rewrites this file in the tmp dir), so the matrix
// can switch between `eslint --cache --fix` and `pnpm exec eslint ...`.
export default {
  "*.ts": "eslint --cache --fix"
};
