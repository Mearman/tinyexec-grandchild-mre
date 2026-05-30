// Long-running grandchild that holds whichever file descriptors it inherits.
// Simulates tsserver, which eslint spawns and which outlives eslint's exit.
// 30s is long enough to comfortably exceed any reasonable test timeout.
setTimeout(() => {}, 30_000);
