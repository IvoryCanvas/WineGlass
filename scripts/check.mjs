import { readdir, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', '.runtime', 'node_modules', 'captures'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
const paths = await files(root);
for (const path of paths.filter(path => path.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
for (const path of paths.filter(path => path.endsWith('.py'))) {
  const result = spawnSync('python3', ['-c', 'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
for (const path of paths.filter(path => path.endsWith('.md'))) {
  const text = await readFile(path, 'utf8');
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|data:|#)/i.test(target)) continue;
    const local = decodeURIComponent(target.split('#')[0]);
    await access(resolve(dirname(path), local)).catch(() => { throw new Error(`Broken local link in ${path}: ${target}`); });
  }
}
const schema = JSON.parse(await readFile(join(root, 'schema/metadata.schema.json'), 'utf8'));
const sample = JSON.parse(await readFile(join(root, 'examples/metadata.json'), 'utf8'));
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
assert.ok(validate(sample), JSON.stringify(validate.errors));
console.log('Source syntax, local documentation links and example metadata are valid.');
