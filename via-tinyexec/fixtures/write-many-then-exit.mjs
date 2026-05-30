// Writes N lines to stdout in a tight loop then exits immediately.
// On 1.2.3 (destroy-on-exit + setImmediate) the buffered tail may be
// dropped before the parent reads it, so the parent receives fewer than N
// lines. N defaults to 2000 and can be overridden via argv[2].
const n = Number(process.argv[2] ?? 2000);
for (let i = 0; i < n; i++) {
  process.stdout.write(`line-${i}\n`);
}
process.exit(0);
