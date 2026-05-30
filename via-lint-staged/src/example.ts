// Type-aware code that triggers typescript-eslint's recommendedTypeChecked
// rules (no-floating-promises, await-thenable etc), which forces eslint to
// consult the projectService and therefore spawn tsserver.

export async function fetchGreeting(): Promise<string> {
  return Promise.resolve('hello');
}

export function main(): void {
  // intentional: floating promise — only detectable with type info
  fetchGreeting();
}
