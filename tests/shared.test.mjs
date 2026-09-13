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
  buildProviderOrder,
  isProviderCoolingDown,
  recordProviderCooldown,
  DEFAULT_PROVIDER_COOLDOWN_MS,
  normalizeSourceTier,
  canAdmitToGemini,
  GEMINI_MAX_CONCURRENT,
  GEMINI_TIER_CONCURRENCY_CAP,
  buildGeminiContents,
  toGeminiToolDefinitions,
  parseGeminiResponse,
  fnv1aHash,
  makeCacheKey,
  getCachedResponse,
  setCachedResponse,
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

describe('shared.mjs — provider router (Groq primary + Gemini free-tier fallback, BOTH Mentor and Explore)');

const noConcurrency = { activeTotal: 0, activeBySource: {} };

// ---- Requirement 1-4: Groq success/429 for both Mentor and Explore ----
test('[req 1] Mentor + Groq available: order tries groq (a real callProvider("groq",...) success means Gemini is never called)', () => {
  const order = buildProviderOrder({ hasGroq: true, hasGemini: true, source: 'mentor', cooldowns: {}, now: 1000, geminiConcurrency: noConcurrency });
  assert.equal(order[0], 'groq'); // the router loop (index.ts) stops at the first success, so groq succeeding means gemini is genuinely never attempted
});
test('[req 2] Mentor + Groq cooling down (i.e. Groq just returned 429): order falls back to gemini', () => {
  const order = buildProviderOrder({ hasGroq: true, hasGemini: true, source: 'mentor', cooldowns: { groq: 5000 }, now: 1000, geminiConcurrency: noConcurrency });
  assert.deepEqual(order, ['gemini']);
});
test('[req 3] Explore (user-initiated) + Groq available: order tries groq first, same as Mentor', () => {
  const order = buildProviderOrder({ hasGroq: true, hasGemini: true, source: 'explore', cooldowns: {}, now: 1000, geminiConcurrency: noConcurrency });
  assert.equal(order[0], 'groq');
});
test('[req 4] Explore (user-initiated) + Groq cooling down: order falls back to gemini — Explore DOES get the fallback (the earlier "Explore never gets Gemini" design was wrong and has been replaced)', () => {
  const order = buildProviderOrder({ hasGroq: true, hasGemini: true, source: 'explore', cooldowns: { groq: 5000 }, now: 1000, geminiConcurrency: noConcurrency });
  assert.deepEqual(order, ['gemini']);
});
test('[req 4b] explore-background + Groq cooling down also falls back to gemini when a slot is free', () => {
  const order = buildProviderOrder({ hasGroq: true, hasGemini: true, source: 'explore-background', cooldowns: { groq: 5000 }, now: 1000, geminiConcurrency: noConcurrency });
  assert.deepEqual(order, ['gemini']);
});

// ---- Requirement 5-6: graceful failure, no infinite retry ----
test('[req 5] Groq cooling down + Gemini ALSO cooling down (i.e. Gemini already 429\'d) => empty order => graceful failure, not a retry loop', () => {
  const order = buildProviderOrder({ hasGroq: true, hasGemini: true, source: 'explore', cooldowns: { groq: 5000, gemini: 5000 }, now: 1000, geminiConcurrency: noConcurrency });
  assert.deepEqual(order, []);
});
test('[req 6] both providers cooling down => empty order regardless of source (Mentor, explore, or explore-background)', () => {
  for (const source of ['mentor', 'explore', 'explore-background']) {
    const order = buildProviderOrder({ hasGroq: true, hasGemini: true, source, cooldowns: { groq: 5000, gemini: 5000 }, now: 1000, geminiConcurrency: noConcurrency });
    assert.deepEqual(order, [], `source=${source}`);
  }
});
test('[req 14] the router is structurally bounded to at most 2 providers per request — never an unbounded/infinite retry', () => {
  const order = buildProviderOrder({ hasGroq: true, hasGemini: true, source: 'mentor', cooldowns: {}, now: 1000, geminiConcurrency: noConcurrency });
  assert.ok(order.length <= 2);
});

test('Groq-only: order is just groq when Gemini is not configured', () => {
  const order = buildProviderOrder({ hasGroq: true, hasGemini: false, source: 'mentor', cooldowns: {}, now: 1000 });
  assert.deepEqual(order, ['groq']);
});
test('both configured, Mentor source implied by an absent/undefined source (backward compatible with an older client)', () => {
  const order = buildProviderOrder({ hasGroq: true, hasGemini: true, source: undefined, cooldowns: {}, now: 1000, geminiConcurrency: noConcurrency });
  assert.deepEqual(order, ['groq', 'gemini']);
});
test('a cooldown that has already expired (now past it) no longer excludes the provider', () => {
  const order = buildProviderOrder({ hasGroq: true, hasGemini: false, source: 'mentor', cooldowns: { groq: 500 }, now: 1000 });
  assert.deepEqual(order, ['groq']);
});

describe('shared.mjs — Gemini concurrency limiter (provider-aware rate protection, not exclusion or unlimited access)');

test('normalizeSourceTier maps recognized values and defaults everything else to mentor', () => {
  assert.equal(normalizeSourceTier('mentor'), 'mentor');
  assert.equal(normalizeSourceTier('explore'), 'explore');
  assert.equal(normalizeSourceTier('explore-background'), 'explore-background');
  assert.equal(normalizeSourceTier(undefined), 'mentor');
  assert.equal(normalizeSourceTier('something-unexpected'), 'mentor');
});

test('canAdmitToGemini admits when no requests are in flight', () => {
  assert.equal(canAdmitToGemini({ source: 'mentor', activeTotal: 0, activeBySource: {} }), true);
  assert.equal(canAdmitToGemini({ source: 'explore', activeTotal: 0, activeBySource: {} }), true);
  assert.equal(canAdmitToGemini({ source: 'explore-background', activeTotal: 0, activeBySource: {} }), true);
});
test('[req 7] Mentor priority: Mentor keeps getting admitted after explore-background has used its one slot (background never starves Mentor)', () => {
  const activeBySource = { 'explore-background': GEMINI_TIER_CONCURRENCY_CAP['explore-background'] };
  const activeTotal = activeBySource['explore-background'];
  assert.equal(canAdmitToGemini({ source: 'mentor', activeTotal, activeBySource }), true);
});
test('[req 7b] Mentor priority: Mentor may use up to the FULL pool even while Explore already holds its own cap', () => {
  const activeBySource = { explore: GEMINI_TIER_CONCURRENCY_CAP.explore };
  const activeTotal = activeBySource.explore;
  assert.equal(canAdmitToGemini({ source: 'mentor', activeTotal, activeBySource }), true);
});
test('[req 8] User Explore priority: a user-initiated Explore request is still admitted after explore-background has used its one slot', () => {
  const activeBySource = { 'explore-background': GEMINI_TIER_CONCURRENCY_CAP['explore-background'] };
  const activeTotal = activeBySource['explore-background'];
  assert.equal(canAdmitToGemini({ source: 'explore', activeTotal, activeBySource }), true);
});
test('[req 8b] explore-background is denied once it has used its own (smallest) slice, even if the global pool has room', () => {
  const activeBySource = { 'explore-background': GEMINI_TIER_CONCURRENCY_CAP['explore-background'] };
  const activeTotal = activeBySource['explore-background'];
  assert.equal(canAdmitToGemini({ source: 'explore-background', activeTotal, activeBySource }), false);
});
test('explore is denied once IT has used its own slice, even while mentor\'s slice is untouched', () => {
  const activeBySource = { explore: GEMINI_TIER_CONCURRENCY_CAP.explore };
  const activeTotal = activeBySource.explore;
  assert.equal(canAdmitToGemini({ source: 'explore', activeTotal, activeBySource }), false);
});
test('nobody is admitted once the GLOBAL pool is full, even mentor', () => {
  assert.equal(canAdmitToGemini({ source: 'mentor', activeTotal: GEMINI_MAX_CONCURRENT, activeBySource: { mentor: GEMINI_MAX_CONCURRENT } }), false);
});
test('buildProviderOrder actually excludes gemini for a tier with no free concurrency slot (not just cooldowns)', () => {
  const activeBySource = { explore: GEMINI_TIER_CONCURRENCY_CAP.explore };
  const order = buildProviderOrder({
    hasGroq: true, hasGemini: true, source: 'explore', cooldowns: { groq: 5000 }, now: 1000,
    geminiConcurrency: { activeTotal: activeBySource.explore, activeBySource },
  });
  assert.deepEqual(order, []); // groq cooling down AND explore's gemini slice already full => graceful failure, no crash, no wait
});
test('buildProviderOrder still lets mentor through gemini when explore\'s (but not mentor\'s) slice is full', () => {
  const activeBySource = { explore: GEMINI_TIER_CONCURRENCY_CAP.explore };
  const order = buildProviderOrder({
    hasGroq: true, hasGemini: true, source: 'mentor', cooldowns: { groq: 5000 }, now: 1000,
    geminiConcurrency: { activeTotal: activeBySource.explore, activeBySource },
  });
  assert.deepEqual(order, ['gemini']);
});

describe('shared.mjs — provider cooldowns');

test('isProviderCoolingDown is true while now < cooldown-until', () => assert.equal(isProviderCoolingDown({ groq: 2000 }, 'groq', 1000), true));
test('isProviderCoolingDown is false once now has passed the cooldown-until', () => assert.equal(isProviderCoolingDown({ groq: 500 }, 'groq', 1000), false));
test('isProviderCoolingDown is false for a provider with no recorded cooldown at all', () => assert.equal(isProviderCoolingDown({}, 'groq', 1000), false));

test('[req 13] recordProviderCooldown uses the provider-supplied Retry-After (retryAfterSeconds) when valid', () => {
  const c = recordProviderCooldown({}, 'groq', 10, 1000);
  assert.equal(c.groq, 1000 + 10000);
});
test('recordProviderCooldown falls back to the default cooldown when no retryAfterSeconds is given', () => {
  const c = recordProviderCooldown({}, 'groq', null, 1000);
  assert.equal(c.groq, 1000 + DEFAULT_PROVIDER_COOLDOWN_MS);
});
test('recordProviderCooldown never mutates the cooldowns object passed in', () => {
  const original = { gemini: 42 };
  const c = recordProviderCooldown(original, 'groq', 5, 1000);
  assert.equal(original.groq, undefined);
  assert.equal(c.gemini, 42); // untouched providers are preserved in the new object
});
test('[req 13b] Gemini gets its OWN independent cooldown, recorded separately from Groq\'s', () => {
  let cooldowns = recordProviderCooldown({}, 'groq', 10, 1000);
  cooldowns = recordProviderCooldown(cooldowns, 'gemini', 20, 1000);
  assert.equal(cooldowns.groq, 11000);
  assert.equal(cooldowns.gemini, 21000);
  // Groq's cooldown expiring independently returns it to the order, per the
  // "return to Groq when its cooldown expires" requirement — this is exactly
  // isProviderCoolingDown's job, exercised again here for the two-provider case.
  assert.equal(isProviderCoolingDown(cooldowns, 'groq', 11001), false);
  assert.equal(isProviderCoolingDown(cooldowns, 'gemini', 11001), true);
});

describe('shared.mjs — Gemini request/response shape');

test('buildGeminiContents maps history roles to user/model (not assistant)', () => {
  const contents = buildGeminiContents({ message: 'hi', history: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }] });
  assert.equal(contents[0].role, 'user');
  assert.equal(contents[1].role, 'model');
  assert.equal(contents[1].parts[0].text, 'b');
});
test('buildGeminiContents appends the current message as the final user turn', () => {
  const contents = buildGeminiContents({ message: 'current question', history: [] });
  assert.equal(contents[contents.length - 1].role, 'user');
  assert.equal(contents[contents.length - 1].parts[0].text, 'current question');
});
test('buildGeminiContents turns a toolExchange into a model functionCall + function functionResponse pair', () => {
  const contents = buildGeminiContents({ message: 'hi', history: [], toolExchanges: [{ tool: 'getTodayPlan', args: {}, callId: 'x', result: 'the plan' }] });
  const callTurn = contents.find(c => c.parts[0] && c.parts[0].functionCall);
  const resultTurn = contents.find(c => c.parts[0] && c.parts[0].functionResponse);
  assert.equal(callTurn.role, 'model');
  assert.equal(callTurn.parts[0].functionCall.name, 'getTodayPlan');
  assert.equal(resultTurn.role, 'function');
  assert.equal(resultTurn.parts[0].functionResponse.response.result, 'the plan');
});

test('toGeminiToolDefinitions wraps every tool in one functionDeclarations array', () => {
  const defs = toGeminiToolDefinitions([{ name: 'a', description: 'd', schema: { type: 'object', properties: {}, required: [] } }]);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].functionDeclarations[0].name, 'a');
  assert.equal(defs[0].functionDeclarations[0].parameters.type, 'object');
});

test('parseGeminiResponse returns a final text answer when no functionCall part is present', () => {
  const out = parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'hello there' }] } }] });
  assert.equal(out.type, 'final');
  assert.equal(out.text, 'hello there');
});
test('parseGeminiResponse returns a tool_call for a valid, approved tool with a synthesized string callId', () => {
  const out = parseGeminiResponse({ candidates: [{ content: { parts: [{ functionCall: { name: 'getTodayPlan', args: {} } }] } } ] });
  assert.equal(out.type, 'tool_call');
  assert.equal(out.tool, 'getTodayPlan');
  assert.equal(typeof out.callId, 'string');
  assert.ok(out.callId.length > 0);
});
test('parseGeminiResponse rejects a functionCall naming an unapproved tool (never a raw pass-through)', () => {
  const out = parseGeminiResponse({ candidates: [{ content: { parts: [{ functionCall: { name: 'dropAllTables', args: {} } }] } } ] });
  assert.equal(out.type, 'final');
  assert.ok(/tried to use a tool incorrectly/i.test(out.text));
});
test('parseGeminiResponse handles a missing/malformed response without throwing', () => {
  const out = parseGeminiResponse({});
  assert.equal(out.type, 'final');
  assert.ok(out.text);
});

describe('shared.mjs — response cache / dedup');

test('fnv1aHash is deterministic for the same input', () => assert.equal(fnv1aHash('abc'), fnv1aHash('abc')));
test('fnv1aHash differs for different input', () => assert.notEqual(fnv1aHash('abc'), fnv1aHash('abd')));

test('makeCacheKey is identical for the same user/source/message/toolExchanges', () => {
  const k1 = makeCacheKey('user1', 'mentor', { message: 'hi', toolExchanges: [] });
  const k2 = makeCacheKey('user1', 'mentor', { message: 'hi', toolExchanges: [] });
  assert.equal(k1, k2);
});
test('makeCacheKey differs across different users (no cross-user cache collisions)', () => {
  const k1 = makeCacheKey('user1', 'mentor', { message: 'hi' });
  const k2 = makeCacheKey('user2', 'mentor', { message: 'hi' });
  assert.notEqual(k1, k2);
});
test('makeCacheKey differs once toolExchanges grows (a later round of the same turn is never treated as a duplicate)', () => {
  const k1 = makeCacheKey('user1', 'mentor', { message: 'hi', toolExchanges: [] });
  const k2 = makeCacheKey('user1', 'mentor', { message: 'hi', toolExchanges: [{ tool: 'x', args: {}, callId: 'c', result: 'r' }] });
  assert.notEqual(k1, k2);
});
test('makeCacheKey differs between Mentor and Explore for the identical message', () => {
  const k1 = makeCacheKey('user1', 'mentor', { message: 'same text' });
  const k2 = makeCacheKey('user1', 'explore', { message: 'same text' });
  assert.notEqual(k1, k2);
});
test('[req 9] two duplicate Mentor requests (same user, same message, same turn state) produce the identical cache key, so index.ts\'s in-flight Map correctly treats them as one turn', () => {
  const body = { message: 'what should I do tonight', toolExchanges: [] };
  assert.equal(makeCacheKey('user1', 'mentor', body), makeCacheKey('user1', 'mentor', body));
});
test('[req 10] two duplicate Explore requests (same user, same prompt) also collide onto one cache key, same as Mentor', () => {
  const body = { message: 'something fun tonight', toolExchanges: [] };
  assert.equal(makeCacheKey('user1', 'explore', body), makeCacheKey('user1', 'explore', body));
});
test('[req 11] cache isolation: two DIFFERENT users asking the identical question never collide onto the same key', () => {
  const body = { message: 'what should I do tonight', toolExchanges: [] };
  assert.notEqual(makeCacheKey('user-a', 'mentor', body), makeCacheKey('user-b', 'mentor', body));
});

test('getCachedResponse returns null for a key that was never set', () => {
  assert.equal(getCachedResponse(new Map(), 'nope', 1000), null);
});
test('setCachedResponse then getCachedResponse round-trips the exact value within the TTL', () => {
  const cache = new Map();
  setCachedResponse(cache, 'k', { hello: 'world' }, 1000, 20000, 200);
  const out = getCachedResponse(cache, 'k', 1000 + 5000);
  assert.deepEqual(out, { hello: 'world' });
});
test('getCachedResponse returns null (and evicts) once the TTL has passed', () => {
  const cache = new Map();
  setCachedResponse(cache, 'k', { hello: 'world' }, 1000, 20000, 200);
  const out = getCachedResponse(cache, 'k', 1000 + 20001);
  assert.equal(out, null);
  assert.equal(cache.has('k'), false);
});
test('setCachedResponse evicts the oldest entry once maxEntries is exceeded (bounded memory)', () => {
  const cache = new Map();
  setCachedResponse(cache, 'first', 1, 1000, 20000, 2);
  setCachedResponse(cache, 'second', 2, 1000, 20000, 2);
  setCachedResponse(cache, 'third', 3, 1000, 20000, 2);
  assert.equal(cache.size, 2);
  assert.equal(cache.has('first'), false); // oldest was evicted
  assert.equal(cache.has('third'), true);
});
