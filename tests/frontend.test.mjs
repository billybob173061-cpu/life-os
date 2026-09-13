// Tests real pure functions from the actual frontend source (utils.js, shell.js)
// loaded via tests/vm-harness.mjs — see that file for why this is safe without a
// browser. Only genuinely pure functions are exercised here (no DOM/network).
import vm from 'node:vm';
import { test, assert, describe } from './tiny-test.mjs';
import { loadFrontendContext } from './vm-harness.mjs';

const utilsCtx = loadFrontendContext(['utils.js']);
const shellCtx = loadFrontendContext(['shell.js']);
// Top-level `const`/`let` in a vm context don't attach to the context object
// (only `function`/`var` declarations do) — promote the few we need to read
// with a tiny follow-up script inside the SAME context, so we're still reading
// shell.js's real, actual values, not a copy re-declared here.
vm.runInContext('var __PROGRESS_ROUTES=PROGRESS_ROUTES, __LIFE_ROUTES=LIFE_ROUTES, __ROUTE_LABELS=ROUTE_LABELS;', shellCtx);
shellCtx.PROGRESS_ROUTES = shellCtx.__PROGRESS_ROUTES;
shellCtx.LIFE_ROUTES = shellCtx.__LIFE_ROUTES;
shellCtx.ROUTE_LABELS = shellCtx.__ROUTE_LABELS;

describe('utils.js — esc() (XSS escaping)');

test('esc escapes angle brackets', () => assert.equal(utilsCtx.esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;'));
test('esc escapes double quotes', () => assert.equal(utilsCtx.esc('a"b'), 'a&quot;b'));
test('esc escapes single quotes', () => assert.equal(utilsCtx.esc("a'b"), 'a&#39;b'));
test('esc escapes ampersands', () => assert.equal(utilsCtx.esc('Ben & Jerry'), 'Ben &amp; Jerry'));
test('esc handles a non-string input without throwing', () => assert.equal(utilsCtx.esc(undefined), ''));
test('esc leaves plain text untouched', () => assert.equal(utilsCtx.esc('Cafe Kitsune'), 'Cafe Kitsune'));

describe('utils.js — mentorSafeUrl (client-side URL gate for the recommendation card)');

test('mentorSafeUrl accepts a real https URL', () => assert.equal(utilsCtx.mentorSafeUrl('https://example.com'), 'https://example.com'));
test('mentorSafeUrl accepts a real http URL', () => assert.equal(utilsCtx.mentorSafeUrl('http://example.com'), 'http://example.com'));
test('mentorSafeUrl rejects javascript: scheme', () => assert.equal(utilsCtx.mentorSafeUrl('javascript:alert(1)'), null));
test('mentorSafeUrl rejects data: scheme', () => assert.equal(utilsCtx.mentorSafeUrl('data:text/html,x'), null));
test('mentorSafeUrl rejects vbscript: scheme', () => assert.equal(utilsCtx.mentorSafeUrl('vbscript:x'), null));
test('mentorSafeUrl rejects undefined/missing', () => assert.equal(utilsCtx.mentorSafeUrl(undefined), null));
test('mentorSafeUrl rejects a bare domain with no scheme', () => assert.equal(utilsCtx.mentorSafeUrl('example.com'), null));

describe('utils.js — mentorRenderRecommendationCard (address/why/actions hierarchy + URL gating)');

test('recommendation card includes the exact address when given', () => {
  const html = utilsCtx.mentorRenderRecommendationCard({ name: 'Cafe Kitsune', address: '151 Elizabeth St', cityState: 'New York, NY' });
  assert.ok(html.includes('151 Elizabeth St'));
  assert.ok(html.includes('Cafe Kitsune'));
});
test('recommendation card never fabricates a "Why" section when none was given', () => {
  const html = utilsCtx.mentorRenderRecommendationCard({ name: 'X' });
  assert.ok(!html.includes('Why this pick'));
});
test('recommendation card renders nothing at all without a name (never a nameless card)', () => {
  assert.equal(utilsCtx.mentorRenderRecommendationCard({ address: '1 Main St' }), '');
  assert.equal(utilsCtx.mentorRenderRecommendationCard(null), '');
});
test('recommendation card escapes an attacker-controlled name (XSS)', () => {
  const html = utilsCtx.mentorRenderRecommendationCard({ name: '<img src=x onerror=alert(1)>' });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});
test('recommendation card omits the Google Maps button when mapUrl is unsafe', () => {
  const html = utilsCtx.mentorRenderRecommendationCard({ name: 'X', mapUrl: 'javascript:alert(1)' });
  assert.ok(!html.includes('View on Google Maps'));
});
test('recommendation card includes a Google Maps button for a safe mapUrl', () => {
  const html = utilsCtx.mentorRenderRecommendationCard({ name: 'X', mapUrl: 'https://maps.google.com/?q=X' });
  assert.ok(html.includes('View on Google Maps'));
  assert.ok(html.includes('https://maps.google.com/?q=X'));
});

describe('utils.js — small pure helpers');

test('ensureNumber parses a numeric string', () => assert.equal(utilsCtx.ensureNumber('42'), 42));
test('ensureNumber falls back to the default for garbage input (never NaN)', () => assert.equal(utilsCtx.ensureNumber('not a number', 7), 7));
test('ensureNumber defaults to 0 when no fallback given', () => assert.equal(utilsCtx.ensureNumber(undefined), 0));
test('uid() produces a unique, prefixed, non-user-controlled id', () => {
  const a = utilsCtx.uid('adventure');
  const b = utilsCtx.uid('adventure');
  assert.ok(a.startsWith('adventure-'));
  assert.notEqual(a, b);
});

describe('shell.js — Progress/Life route grouping (Phase 8 navigation)');

test('every declared route key still resolves to itself outside Progress/Life (no accidental grouping)', () => {
  assert.equal(shellCtx.routeGroup('today'), 'today');
  assert.equal(shellCtx.routeGroup('mentor'), 'mentor');
  assert.equal(shellCtx.routeGroup('explore'), 'explore');
  assert.equal(shellCtx.routeGroup('settings'), 'settings');
});
test('all six Progress routes group correctly', () => {
  for (const r of ['body', 'training', 'nutrition', 'bjj', 'review', 'coach']) {
    assert.equal(shellCtx.routeGroup(r), 'progress', `${r} should group as progress`);
  }
});
test('all three Life routes group correctly', () => {
  for (const r of ['money', 'growth', 'social']) {
    assert.equal(shellCtx.routeGroup(r), 'life', `${r} should group as life`);
  }
});
test('PROGRESS_ROUTES and LIFE_ROUTES never overlap', () => {
  // .filter() on a vm-context array returns a cross-realm array — compare by
  // length/native-array rather than deepEqual against a literal [], which
  // Node's strict assert can flag as unequal across realms despite identical
  // (empty) contents.
  const overlap = Array.from(shellCtx.PROGRESS_ROUTES).filter(r => Array.from(shellCtx.LIFE_ROUTES).includes(r));
  assert.equal(overlap.length, 0);
});
test('every real route key has a nav label', () => {
  const allRoutes = ['today', ...shellCtx.PROGRESS_ROUTES, ...shellCtx.LIFE_ROUTES, 'explore', 'mentor', 'settings'];
  for (const r of allRoutes) assert.ok(shellCtx.ROUTE_LABELS[r], `missing label for ${r}`);
});
