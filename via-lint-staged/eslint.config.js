// Flat eslint config using typescript-eslint's recommendedTypeChecked rules
// plus eslint-plugin-prettier's recommended preset. The prettier plugin
// instantiates a synckit worker via `node:worker_threads`, which inherits the
// parent's piped stdio fds. The hypothesis under test: that worker is the
// grandchild that hangs tinyexec ≤ 1.2.2.
import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  prettierRecommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  }
);
