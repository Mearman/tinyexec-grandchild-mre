// Flat eslint config with typescript-eslint and projectService enabled.
// projectService spawns the TypeScript language server (tsserver) as a
// child of eslint. tsserver inherits eslint's piped stdio. When eslint
// exits, tsserver lives on holding the pipe — that's the grandchild that
// deadlocks tinyexec.
import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['**/*.ts'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname
    }
  }
});
