// ---- Phase 9: minimal, dependency-free test runner ----
// Deliberately not Jest/Mocha/Vitest — this project has no build step and no
// npm dependencies beyond the Supabase CLI, and pulling in a real framework
// just to check a few dozen pure functions would be disproportionate to what's
// actually being tested here. This is ~30 lines, uses only Node's builtin
// `assert`, and runs with plain `node tests/run-all.mjs` — no install step.
import assert from 'node:assert/strict';

let pass = 0;
let fail = 0;
const failures = [];
let currentFile = '';

export function describe(file) { currentFile = file; }

export function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    failures.push({ file: currentFile, name, error: e });
  }
}

export { assert };

export function summarize() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  [${f.file}] ${f.name}`);
      console.log(`    ${f.error.message}`);
    }
  }
  return fail === 0;
}
