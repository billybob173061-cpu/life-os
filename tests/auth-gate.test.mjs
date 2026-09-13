// Regression tripwire for the critical privacy fix: render() must never call a
// personalized view function (views[v]) unless authState is actually
// AUTH_STATE.SIGNED_IN. The real behavior was already verified live in a
// browser (fresh signed-out state, seeded personal data in localStorage,
// direct hash routes, and the live sign-in/sign-out toggle all confirmed
// correct) — this test exists so a future edit can't silently reintroduce the
// bug without a test failing. Structural (reads the real source text), the
// same proven approach as tests/edge-function-integrity.test.mjs, because
// fully exercising render() needs a real DOM (see the browser verification
// instead of a heavier mocked-DOM unit test here).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, describe } from './tiny-test.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'shell.js'), 'utf8');

describe('shell.js — critical privacy fix: render() gates all personalized views behind SIGNED_IN');

test('render() checks authState before deciding what to show', () => {
  assert.ok(src.includes('const authState=(typeof getAuthState==='));
});
test('render() has an explicit branch for "not signed in" that does NOT call views[v]()', () => {
  const notSignedInBranch = src.match(/if\(authState!==AUTH_STATE\.SIGNED_IN\)\{[\s\S]*?\n  \}/);
  assert.ok(notSignedInBranch, 'expected an `if(authState!==AUTH_STATE.SIGNED_IN)` branch in render()');
  assert.ok(!notSignedInBranch[0].includes('views['), 'the not-signed-in branch must never reference views[v]');
  assert.ok(notSignedInBranch[0].includes('renderSignedOutShell'));
});
test('the personalized branch (views[v]) is reached only after the SIGNED_IN gate, never before it', () => {
  const gateIndex = src.indexOf('if(authState!==AUTH_STATE.SIGNED_IN)');
  const viewsCallIndex = src.indexOf('views[v]?views[v]()');
  assert.ok(gateIndex !== -1 && viewsCallIndex !== -1);
  assert.ok(gateIndex < viewsCallIndex, 'the auth gate must appear before the personalized view is ever called');
});
test('the not-signed-in branch ignores the requested route entirely (direct navigation to any hash cannot bypass it)', () => {
  // The gate's own branch body must not read `v` to decide what to render —
  // it always renders the same signed-out shell regardless of route.
  const notSignedInBranch = src.match(/if\(authState!==AUTH_STATE\.SIGNED_IN\)\{[\s\S]*?\n  \}/)[0];
  assert.ok(!/views\[v\]|titles\[v\]/.test(notSignedInBranch));
});
test('renderSignedOutShell reuses the existing, already-tested sign-in form (renderAccountCard) rather than a second/divergent one', () => {
  assert.ok(src.includes('${renderAccountCard()}'));
});
test('a LOADING auth state also never reaches the personalized view', () => {
  const loadingBranch = src.match(/if\(authState===AUTH_STATE\.LOADING\)\{[\s\S]*?\n  \}/);
  assert.ok(loadingBranch);
  assert.ok(!loadingBranch[0].includes('views['));
});
test('exactly one render() function exists (no duplicate gate to fall out of sync)', () => {
  assert.equal((src.match(/function render\(/g) || []).length, 1);
});
