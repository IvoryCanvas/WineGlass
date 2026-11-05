import { readdir, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { SchemaObject } from 'ajv/dist/2020.js';
import type { ComparisonMetadata } from '../src/types.js';
import { projectRoot } from '../src/paths.js';

const root = projectRoot;
async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', '.runtime', 'node_modules', 'captures', 'dist'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
const paths = await files(root);
for (const path of paths.filter(path => path.endsWith('.py'))) {
  const result = spawnSync('python3', ['-c', 'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || 'Python syntax check failed.');
}
for (const path of paths.filter(path => path.endsWith('.md'))) {
  const text = await readFile(path, 'utf8');
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (!target) continue;
    if (/^(?:https?:|mailto:|data:|#)/i.test(target)) continue;
    const local = decodeURIComponent(target.split('#')[0] ?? '');
    await access(resolve(dirname(path), local)).catch(() => { throw new Error(`Broken local link in ${path}: ${target}`); });
  }
}
const schema: SchemaObject = JSON.parse(await readFile(join(root, 'schema/metadata.schema.json'), 'utf8'));
const sample: unknown = JSON.parse(await readFile(join(root, 'examples/metadata.json'), 'utf8'));
const validate = new Ajv2020({ strict: true, allErrors: true }).compile<ComparisonMetadata>(schema);
assert.ok(validate(sample), JSON.stringify(validate.errors));
console.log('Python syntax, local documentation links and example metadata are valid.');
