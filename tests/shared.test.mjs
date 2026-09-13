// Tests the ACTUAL production Edge Function logic (supabase/functions/mentor/
// shared.mjs) directly — this file is intentionally Deno-free/pure so the exact
// code that ships to production is what gets exercised here, never a
// reimplementation that could quietly drift out of sync with it.
import { test, assert, describe } from './tiny-test.mjs';
import {
  isSafeHttpUrl,
  isGoogleMapsUrl,
  buildGoogleMapsSearchUrl,
  buildRecommendationFromArgs,
  validateToolCall,
  normalizeSearchResults,
  checkRequestLimits,
  MAX_REC_FIELD_LENGTH,
  MAX_SEARCH_RESULTS,
} from '../supabase/functions/mentor/shared.mjs';

describe('shared.mjs — URL safety');

test('isSafeHttpUrl accepts https URLs', () => assert.equal(isSafeHttpUrl('https://example.com/a'), true));
test('isSafeHttpUrl accepts http URLs', () => assert.equal(isSafeHttpUrl('http://example.com'), true));
test('isSafeHttpUrl rejects javascript: scheme', () => assert.equal(isSafeHttpUrl('javascript:alert(1)'), false));
test('isSafeHttpUrl rejects data: scheme', () => assert.equal(isSafeHttpUrl('data:text/html,<script>alert(1)</script>'), false));
test('isSafeHttpUrl rejects vbscript: scheme', () => assert.equal(isSafeHttpUrl('vbscript:msgbox(1)'), false));
test('isSafeHttpUrl rejects non-string input', () => assert.equal(isSafeHttpUrl(null), false));
test('isSafeHttpUrl rejects a URL containing a quote (attribute-breakout attempt)', () => assert.equal(isSafeHttpUrl('https://example.com/"><script>'), false));
test('isSafeHttpUrl rejects empty string', () => assert.equal(isSafeHttpUrl(''), false));
test('isSafeHttpUrl rejects a protocol-relative URL (no scheme)', () => assert.equal(isSafeHttpUrl('//evil.com'), false));

test('isGoogleMapsUrl accepts a real maps.google.com URL', () => assert.equal(isGoogleMapsUrl('https://maps.google.com/?q=foo'), true));
test('isGoogleMapsUrl accepts google.com/maps', () => assert.equal(isGoogleMapsUrl('https://www.google.com/maps/place/foo'), true));
test('isGoogleMapsUrl rejects a lookalike subdomain trick', () => assert.equal(isGoogleMapsUrl('https://maps.google.com.evil.com/?q=foo'), false));
test('isGoogleMapsUrl rejects a non-maps URL', () => assert.equal(isGoogleMapsUrl('https://example.com'), false));
test('isGoogleMapsUrl rejects http (non-https)', () => assert.equal(isGoogleMapsUrl('http://maps.google.com/?q=foo'), false));

describe('shared.mjs — Google Maps URL construction');

test('buildGoogleMapsSearchUrl builds a safe, encoded, deterministic search URL', () => {
  const url = buildGoogleMapsSearchUrl('Cafe Kitsune', '151 Elizabeth St', 'New York, NY');
  assert.ok(url.startsWith('https://www.google.com/maps/search/?api=1&query='));
  assert.ok(url.includes(encodeURIComponent('Cafe Kitsune')));
  assert.ok(!url.includes(' '), 'query must be fully URL-encoded, no raw spaces');
  assert.ok(!/place_id/i.test(url), 'must never fabricate a Place ID');
});
test('buildGoogleMapsSearchUrl returns null when nothing to search for', () => {
  assert.equal(buildGoogleMapsSearchUrl(undefined, undefined, undefined), null);
});
test('buildGoogleMapsSearchUrl works from name alone', () => {
  assert.ok(buildGoogleMapsSearchUrl('Some Place', undefined, undefined).includes('Some+Place') || buildGoogleMapsSearchUrl('Some Place', undefined, undefined).includes('Some%20Place'));
});

describe('shared.mjs — recommendation normalization / address handling');

test('buildRecommendationFromArgs keeps a verified address', () => {
  const rec = buildRecommendationFromArgs({ name: 'Cafe Kitsune', address: '151 Elizabeth St', cityState: 'New York, NY' });
  assert.equal(rec.address, '151 Elizabeth St');
  assert.equal(rec.name, 'Cafe Kitsune');
});
test('buildRecommendationFromArgs never invents an address when none was given', () => {
  const rec = buildRecommendationFromArgs({ name: 'Some Place' });
  assert.equal('address' in rec, false);
});
test('buildRecommendationFromArgs falls back to a deterministic Maps search URL when no verified Maps link is given', () => {
  const rec = buildRecommendationFromArgs({ name: 'Cafe Kitsune', address: '151 Elizabeth St' });
  assert.ok(rec.mapUrl.startsWith('https://www.google.com/maps/search/'));
});
test('buildRecommendationFromArgs trusts a genuine Maps URL the model copied from search', () => {
  const rec = buildRecommendationFromArgs({ name: 'X', mapUrl: 'https://maps.google.com/?q=X' });
  assert.equal(rec.mapUrl, 'https://maps.google.com/?q=X');
});
test('buildRecommendationFromArgs ignores an unsafe mapUrl and falls back to the safe deterministic one instead', () => {
  const rec = buildRecommendationFromArgs({ name: 'X', address: '1 Main St', mapUrl: 'javascript:alert(1)' });
  assert.ok(rec.mapUrl.startsWith('https://www.google.com/maps/search/'));
});
test('buildRecommendationFromArgs ignores a non-Maps https URL for mapUrl (still falls back deterministically)', () => {
  const rec = buildRecommendationFromArgs({ name: 'X', address: '1 Main St', mapUrl: 'https://example.com/not-maps' });
  assert.ok(rec.mapUrl.startsWith('https://www.google.com/maps/search/'));
});
test('buildRecommendationFromArgs drops an unsafe websiteUrl entirely rather than sanitizing it', () => {
  const rec = buildRecommendationFromArgs({ name: 'X', websiteUrl: 'javascript:alert(1)' });
  assert.equal('websiteUrl' in rec, false);
});
test('buildRecommendationFromArgs keeps a safe websiteUrl', () => {
  const rec = buildRecommendationFromArgs({ name: 'X', websiteUrl: 'https://example.com' });
  assert.equal(rec.websiteUrl, 'https://example.com');
});
test('buildRecommendationFromArgs bounds an overlong field rather than storing it unbounded', () => {
  const rec = buildRecommendationFromArgs({ name: 'X', why: 'a'.repeat(5000) });
  assert.ok(rec.why.length <= MAX_REC_FIELD_LENGTH);
});
test('buildRecommendationFromArgs drops a field the model never actually provided (no empty-string fabrication)', () => {
  const rec = buildRecommendationFromArgs({ name: 'X' });
  assert.equal('why' in rec, false);
  assert.equal('hours' in rec, false);
});

describe('shared.mjs — tool call validation');

test('validateToolCall rejects an unknown tool name', () => assert.equal(validateToolCall('deleteEverything', {}).ok, false));
test('validateToolCall rejects non-object args', () => assert.equal(validateToolCall('getTodayPlan', null).ok, false));
test('validateToolCall rejects an array as args', () => assert.equal(validateToolCall('getTodayPlan', []).ok, false));
test('validateToolCall accepts a zero-arg tool called with empty args', () => assert.equal(validateToolCall('getTodayPlan', {}).ok, true));
test('validateToolCall rejects a tool needing real args called with none', () => assert.equal(validateToolCall('logFood', {}).ok, false));
test('validateToolCall rejects an unsafe mapUrl on presentRecommendation', () => {
  const r = validateToolCall('presentRecommendation', { message: 'hi', name: 'X', mapUrl: 'javascript:alert(1)' });
  assert.equal(r.ok, false);
});
// Zero-argument tools (getTodayPlan etc.) deliberately TOLERATE a stray key —
// some models emit a placeholder arg even for genuinely zero-arg calls, and
// there's no dangerous side effect from ignoring it. A tool with a real schema
// must still reject anything outside it, which this checks instead.
test('validateToolCall tolerates a stray key on a genuinely zero-argument tool', () => {
  const r = validateToolCall('getTodayPlan', { placeholder: '' });
  assert.equal(r.ok, true);
});
test('validateToolCall rejects an unexpected argument not in a real tool schema', () => {
  const r = validateToolCall('logBJJSession', { duration: 30, rm: '-rf /' });
  assert.equal(r.ok, false);
});
test('validateToolCall rejects a wrong-typed argument', () => {
  const r = validateToolCall('logBJJSession', { duration: 'a lot' });
  assert.equal(r.ok, false);
});

describe('shared.mjs — search result normalization (untrusted web content)');

test('normalizeSearchResults bounds the result count to the server cap regardless of what is requested', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ title: `Result ${i}`, url: `https://example.com/${i}`, content: 'x' }));
  const out = normalizeSearchResults(many, 999);
  assert.ok(out.length <= MAX_SEARCH_RESULTS);
});
test('normalizeSearchResults only keeps the fixed known fields — extra/malicious fields are dropped by construction', () => {
  const out = normalizeSearchResults([{ title: 'T', url: 'https://example.com', content: 'C', maliciousField: '<script>x</script>' }], 5);
  assert.equal('maliciousField' in out[0], false);
  assert.deepEqual(Object.keys(out[0]).sort(), ['snippet', 'source', 'title', 'url']);
});
test('normalizeSearchResults drops a result with an unsafe URL entirely rather than surfacing it', () => {
  const out = normalizeSearchResults([{ title: 'Bad', url: 'javascript:alert(1)', content: 'x' }], 5);
  assert.equal(out.length, 0);
});
test('normalizeSearchResults derives a clean source hostname from the URL', () => {
  const out = normalizeSearchResults([{ title: 'T', url: 'https://www.example.com/page', content: 'x' }], 5);
  assert.equal(out[0].source, 'example.com');
});

describe('shared.mjs — request limits');

test('checkRequestLimits rejects a missing message', () => assert.equal(checkRequestLimits({}).ok, false));
test('checkRequestLimits rejects a non-object body', () => assert.equal(checkRequestLimits(null).ok, false));
test('checkRequestLimits rejects an oversized message', () => assert.equal(checkRequestLimits({ message: 'a'.repeat(100000) }).ok, false));
test('checkRequestLimits accepts a normal request', () => assert.equal(checkRequestLimits({ message: 'hello' }).ok, true));
