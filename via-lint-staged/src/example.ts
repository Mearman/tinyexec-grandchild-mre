// Type-aware code that exercises typescript-eslint's recommendedTypeChecked
// rules (it needs to actually CONSULT the projectService for type info even
// though no rule will fire). Lint-clean so a failure of the test reflects a
// real deadlock or other unexpected behaviour, not a lint error.

export async function fetchGreeting(): Promise<string> {
  return Promise.resolve('hello');
}

export async function main(): Promise<void> {
  const greeting = await fetchGreeting();
  console.log(greeting);
}
