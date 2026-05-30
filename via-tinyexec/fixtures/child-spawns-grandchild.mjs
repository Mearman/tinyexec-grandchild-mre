// Child writes one line, spawns a grandchild that inherits stdout (fd 1),
// then exits. Mirrors the shape of eslint exiting while tsserver lives on
// holding the piped stdout open.
import {spawn} from 'node:child_process';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const grandchild = path.join(here, 'grandchild-keeper.mjs');

spawn(process.argv[0], [grandchild], {stdio: ['ignore', 1, 'ignore']});

process.stdout.write('expected-output\n');
process.exit(0);
