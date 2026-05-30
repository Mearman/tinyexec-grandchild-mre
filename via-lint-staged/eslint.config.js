// Flat eslint config using typescript-eslint's recommendedTypeChecked
// rules. These rules need type info, which forces eslint to consult the
// TypeScript projectService — that's the path that spawns tsserver and
// keeps it alive past eslint's own exit, which is the grandchild that
// tinyexec deadlocks on.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
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
