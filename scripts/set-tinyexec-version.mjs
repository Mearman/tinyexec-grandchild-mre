// Sets the tinyexec version pinned in both scenarios. Reads the desired
// version from MRE_TINYEXEC_VERSION (env), defaulting to 1.1.2 if unset
// (the most common version where the original deadlock was hit in the
// wild). Run before `npm install` in each scenario.
import fs from 'node:fs';
import path from 'node:path';

const version = process.env.MRE_TINYEXEC_VERSION ?? '1.1.2';
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const targets = [
  {file: path.join(repoRoot, 'via-tinyexec', 'package.json'), key: 'dependencies'},
  {file: path.join(repoRoot, 'via-lint-staged', 'package.json'), key: 'overrides'}
];

for (const {file, key} of targets) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!pkg[key]) pkg[key] = {};
  pkg[key].tinyexec = version;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`set ${path.relative(repoRoot, file)} ${key}.tinyexec = ${version}`);
}
