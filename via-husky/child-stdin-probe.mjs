// Spawned by the pre-commit hook. Writes its own fd 0 characteristics
// to stdout so the harness can verify that processes started from
// inside a hook also see the closed stdin git imposes on the hook.
import fs from 'node:fs';

console.log('=== child ===');
console.log(`isTTY: ${process.stdin.isTTY ? 'true' : 'false'}`);

try {
  const stats = fs.fstatSync(0);
  console.log(`mode: 0${stats.mode.toString(8)}`);
  console.log(`size: ${stats.size}`);
  console.log(`isFile: ${stats.isFile()}`);
  console.log(`isFIFO: ${stats.isFIFO()}`);
  console.log(`isSocket: ${stats.isSocket()}`);
  console.log(`isCharacterDevice: ${stats.isCharacterDevice()}`);
} catch (e) {
  console.log(`fstat error: ${e.message}`);
}

try {
  const link = fs.readlinkSync('/dev/fd/0');
  console.log(`readlink /dev/fd/0: ${link}`);
} catch (e) {
  console.log(`readlink /dev/fd/0 error: ${e.code}`);
}
