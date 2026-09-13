// index.ts is Deno-only (Deno.serve/Deno.env, real fetch calls) and can't be
// imported/run from plain Node the way shared.mjs can (see shared.mjs's own
// top-of-file comment on that split) — its actual request handling is verified
// live once deployed (see README "Provider router") and via the real Deno CLI
// (`deno check` / `deno lint`, run manually — not part of this suite). What
// CAN be verified from Node without a live deploy is that the critical
// structural guarantees are actually present in the real source text, exactly
// once, in the right order — the same proven approach tests/mobile-nav.test.mjs
// and tests/pwa.test.mjs already use for index.html/styles.css. This is a
// regression tripwire: it fails if someone edits index.ts in a way that
// removes/reorders one of these guarantees, even though the logic itself
// lives in Deno-only code no Node test can execute directly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, describe } from './tiny-test.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'supabase/functions/mentor/index.ts'), 'utf8');

function countOccurrences(text, pattern) {
  return (text.match(pattern) || []).length;
}
function indexOfOrThrow(text, needle, label) {
  const i = text.indexOf(needle);
  assert.ok(i !== -1, `expected to find ${label} in index.ts`);
  return i;
}

describe('index.ts — no accidental duplication (the exact concern raised in review)');

test('exactly one callProvider implementation', () => assert.equal(countOccurrences(src, /async function callProvider\(/g), 1));
test('exactly one callLlmWithFallback implementation', () => assert.equal(countOccurrences(src, /async function callLlmWithFallback\(/g), 1));
test('exactly one runMentorTurn implementation', () => assert.equal(countOccurrences(src, /async function runMentorTurn\(/g), 1));
test('exactly one Deno.serve handler', () => assert.equal(countOccurrences(src, /Deno\.serve\(/g), 1));
test('exactly one GEMINI_API_KEY / GEMINI_MODEL / GROQ_API_KEY declaration each', () => {
  assert.equal(countOccurrences(src, /const GEMINI_API_KEY = /g), 1);
  assert.equal(countOccurrences(src, /const GEMINI_MODEL = /g), 1);
  assert.equal(countOccurrences(src, /const GROQ_API_KEY = /g), 1);
});
test('exactly one providerCooldowns / responseCache / inFlightRequests declaration each', () => {
  assert.equal(countOccurrences(src, /providerCooldowns[:\s]*(Record<string, number>)?\s*=\s*\{\}/g), 1);
  assert.equal(countOccurrences(src, /const responseCache = new Map\(\)/g), 1);
  assert.equal(countOccurrences(src, /const inFlightRequests = new Map\(\)/g), 1);
});

describe('index.ts — [req 16] authentication is still required, and required BEFORE anything else runs');

test('supabase.auth.getUser(token) is called exactly once', () => assert.equal(countOccurrences(src, /supabase\.auth\.getUser\(token\)/g), 1));
test('a missing bearer token is rejected before any provider/cache logic runs', () => {
  const tokenCheck = indexOfOrThrow(src, "if (!token) return jsonResponse({ error: 'Sign in required", 'the missing-token 401 check');
  const cacheKeyLine = indexOfOrThrow(src, 'makeCacheKey(userData.user.id', 'the cache-key computation');
  assert.ok(tokenCheck < cacheKeyLine, 'auth must be checked before the cache/provider logic runs');
});
test('an invalid/expired session is rejected before any provider/cache logic runs', () => {
  const authErrorCheck = indexOfOrThrow(src, 'if (authError || !userData || !userData.user)', 'the auth-error check');
  const cacheKeyLine = indexOfOrThrow(src, 'makeCacheKey(userData.user.id', 'the cache-key computation');
  assert.ok(authErrorCheck < cacheKeyLine, 'auth must be checked before the cache/provider logic runs');
});

describe('index.ts — [req 17] CORS is still applied, unchanged mechanism');

test('corsHeadersFor is computed once per request and used on every response path', () => {
  assert.ok(src.includes('const cors = corsHeadersFor(req);'));
  // Every jsonResponse(...) call site in the handler passes `cors` as its last arg —
  // spot-check a representative sample from before AND after the new router/cache code.
  assert.ok(src.includes("jsonResponse({ error: 'Sign in required to use the AI Mentor.' }, 401, cors)"));
  assert.ok(src.includes('return jsonResponse(result.responseBody, result.status, cors);'));
});
test('the exact-origin allowlist mechanism (never a wildcard) is unchanged', () => {
  assert.ok(src.includes("if (/^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/.test(origin)) return true;"));
  assert.ok(src.includes('if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) return true;'));
  assert.ok(!/Access-Control-Allow-Origin['"]?\]?\s*[:=]\s*['"]\*['"]/.test(src), 'CORS must never be widened to a wildcard origin');
});

describe('index.ts — [req 18] no secrets exposed');

test('no console.log/console.error calls exist anywhere (nothing to accidentally leak a key through)', () => {
  assert.equal(countOccurrences(src, /console\.(log|error|warn|info|debug)\(/g), 0);
});
test('GEMINI_API_KEY is only ever used in the outgoing request URL and boolean checks, never returned in a response body', () => {
  const sites = [...src.matchAll(/GEMINI_API_KEY/g)];
  assert.ok(sites.length >= 2);
  // None of the lines containing GEMINI_API_KEY should also contain "responseBody" or "jsonResponse"
  for (const line of src.split('\n')) {
    if (line.includes('GEMINI_API_KEY')) {
      assert.ok(!line.includes('responseBody') && !line.includes('jsonResponse'), `GEMINI_API_KEY must never appear on a response-building line: ${line}`);
    }
  }
});
test('no hardcoded API-key-shaped literal strings were introduced', () => {
  assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(src));
  assert.ok(!/sk-[a-zA-Z0-9]{20,}/.test(src));
});

describe('index.ts — [req 19] tool loop still works (client tools + bounded server-tool loop)');

test('runMentorTurn still bounds its loop by MAX_TOOL_CALLS_PER_REQUEST', () => {
  assert.ok(src.includes('for (let i = 0; i < MAX_TOOL_CALLS_PER_REQUEST + 1; i++)'));
  assert.ok(src.includes('if (toolCallCount > MAX_TOOL_CALLS_PER_REQUEST)'));
});
test('a client-executed tool (runsOn !== "server") is still handed back to the client, not executed here', () => {
  assert.ok(src.includes("if (!def || def.runsOn !== 'server')"));
});

describe("index.ts — [req 20] webSearch/Tavily still works, [req 21] presentRecommendation still works");

test('performWebSearch still calls the real Tavily endpoint with the server-only key', () => {
  assert.ok(src.includes("fetch('https://api.tavily.com/search'"));
  assert.ok(src.includes("'authorization': `Bearer ${TAVILY_API_KEY}`"));
});
test('presentRecommendation still ends the turn immediately via buildRecommendationFromArgs', () => {
  assert.ok(src.includes("parsed.tool === 'presentRecommendation'"));
  assert.ok(src.includes('buildRecommendationFromArgs(parsed.args)'));
});

describe('index.ts — [req 12] no stale error caching, [req 9/10/15] dedup wiring');

test('only a genuine 200 result is ever written to the response cache', () => {
  assert.ok(src.includes('if (result.status === 200) setCachedResponse(responseCache, cacheKey, result, now);'));
  // There is exactly ONE call site for setCachedResponse in the whole handler —
  // no other path writes to the cache, so an error can never be cached by accident.
  assert.equal(countOccurrences(src, /setCachedResponse\(/g), 1);
});
test('an in-flight duplicate (same cache key) awaits and reuses the SAME promise instead of starting a second turn — this is what prevents a duplicate destructive tool call from a double-tap/retry', () => {
  assert.ok(src.includes('if (inFlightRequests.has(cacheKey)) {'));
  assert.ok(src.includes('const result = await inFlightRequests.get(cacheKey);'));
  // The promise is registered BEFORE the await, and always cleaned up in a finally
  // (so a failed turn never permanently blocks retries for that same key).
  const setBefore = indexOfOrThrow(src, 'inFlightRequests.set(cacheKey, turnPromise);', 'in-flight registration');
  const awaitAfter = indexOfOrThrow(src, 'result = await turnPromise;', 'the await of the registered promise');
  assert.ok(setBefore < awaitAfter);
  assert.ok(src.includes('inFlightRequests.delete(cacheKey);'));
});
test('this exact same cache/dedup wrapping applies to BOTH Mentor and Explore — there is only one request-handling path in the whole file, not a separate one per source', () => {
  assert.equal(countOccurrences(src, /const turnPromise = runMentorTurn\(/g), 1);
});
