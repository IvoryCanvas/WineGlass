import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This module runs from dist/src after the TypeScript build.
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
