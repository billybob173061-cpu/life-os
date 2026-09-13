// Runs every *.test.mjs file in this directory. Usage: node tests/run-all.mjs
// No dependencies, no build step, no watch mode — matches the rest of this
// project's vanilla-JS, no-framework architecture.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { summarize } from './tiny-test.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.mjs')).sort();

for (const f of files) {
  await import(pathToFileURL(path.join(__dirname, f)));
}

const ok = summarize();
process.exit(ok ? 0 : 1);
