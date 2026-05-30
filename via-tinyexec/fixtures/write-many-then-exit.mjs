// Writes N lines to stdout then exits naturally.
//
// IMPORTANT: do NOT call process.exit() here. process.exit forces an
// immediate teardown that abandons Node's own writable-stream buffer,
// which can drop the trailing writes — but that's a child-side Node
// behaviour, not a tinyexec bug. To test tinyexec's parent-side
// destroy-vs-pipe-drain race we let the child exit cleanly after stdout
// flushes, and then check whether the parent's PassThrough lost any
// lines because tinyexec destroyed it before the kernel pipe drained.
const n = Number(process.argv[2] ?? 2000);
for (let i = 0; i < n; i++) {
  process.stdout.write(`line-${i}\n`);
}
