// Tests the actual production auth code (sync.js + views/mentor.js), loaded
// via the same vm harness the rest of the suite uses — see vm-harness.mjs for
// why this is safe without a browser. Covers: sign-out scope regression,
// Account/Advanced UI states, the single-flight refresh lock, and the
// network-vs-genuine-session-invalid distinction — all against real functions,
// with SB mocked (no real Supabase project reachable from a test run).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, describe } from './tiny-test.mjs';
import { loadFrontendContext, getVar, setVar } from './vm-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

describe('sync.js — sign-out scope regression (source-level)');

// A source-text check, not just a behavioral one: this is exactly the class of
// regression that's easy to silently reintroduce (e.g. an unscoped signOut()
// added back "temporarily" while debugging) — catching it at the text level
// means it fails even before any mock/behavioral test would notice.
test('no bare/unscoped SB.auth.signOut() call exists anywhere in the project', () => {
  const files = ['sync.js', 'main.js', 'shell.js', 'utils.js', 'state.js']
    .concat(fs.readdirSync(path.join(root, 'views')).map(f => 'views/' + f));
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const calls = src.match(/SB\.auth\.signOut\([^)]*\)/g) || [];
    for (const call of calls) {
      if (!/\{\s*scope\s*:/.test(call)) offenders.push(f + ': ' + call);
    }
  }
  assert.deepEqual(offenders, []);
});
test('exactly one SB.auth.signOut call exists, and it is scope:local', () => {
  const src = fs.readFileSync(path.join(root, 'sync.js'), 'utf8');
  const calls = src.match(/SB\.auth\.signOut\([^)]*\)/g) || [];
  assert.equal(calls.length, 1);
  assert.ok(/scope\s*:\s*['"]local['"]/.test(calls[0]));
});

describe('mentor.js — refresh lock regression (source-level)');

test('exactly one SB.auth.refreshSession() call exists in the whole project', () => {
  const files = fs.readdirSync(path.join(root, 'views')).map(f => 'views/' + f).concat(['sync.js', 'main.js']);
  let count = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    count += (src.match(/SB\.auth\.refreshSession\(\)/g) || []).length;
  }
  assert.equal(count, 1);
});

describe('Account UI — states (real renderAccountCard/renderAdvancedCloudCard output)');

function loadAuthUiContext() {
  return loadFrontendContext(['utils.js', 'sync.js']);
}

test('LOADING state shows "Restoring session…" and nothing else technical', () => {
  const ctx = loadAuthUiContext();
  const AUTH_STATE = getVar(ctx, 'AUTH_STATE');
  ctx.setAuthState(AUTH_STATE.LOADING);
  const html = ctx.renderAccountCard();
  assert.ok(/Restoring session/i.test(html));
  assert.ok(!/Supabase|anon|Save connection|Sign in & sync/i.test(html));
});

test('SIGNED_OUT state (no CLOUD.anon) shows only Email/Password/Sign In — never Supabase URL/anon key/old buttons', () => {
  const ctx = loadAuthUiContext();
  const AUTH_STATE = getVar(ctx, 'AUTH_STATE');
  const CLOUD = getVar(ctx, 'CLOUD');
  CLOUD.anon = '';
  CLOUD.user = null;
  ctx.setAuthState(AUTH_STATE.SIGNED_OUT);
  const html = ctx.renderAccountCard();
  assert.ok(/Not signed in/.test(html));
  assert.ok(/Email/.test(html) && /Password/.test(html));
  assert.ok(/>Sign In</.test(html));
  assert.ok(/Create an account/i.test(html));
  // The things that must NEVER appear in the normal Account card:
  assert.ok(!/Supabase project URL/i.test(html));
  assert.ok(!/anon\/public key/i.test(html));
  assert.ok(!/Save connection/i.test(html));
  assert.ok(!/Sign in &amp; sync|Sign in & sync/i.test(html));
  assert.ok(!/Connection saved, not signed in yet/i.test(html));
});

test('SIGNED_OUT with CLOUD.anon already configured shows the same clean form (no technical fields either)', () => {
  const ctx = loadAuthUiContext();
  const AUTH_STATE = getVar(ctx, 'AUTH_STATE');
  const CLOUD = getVar(ctx, 'CLOUD');
  CLOUD.anon = 'fake-anon-key';
  CLOUD.user = null;
  ctx.setAuthState(AUTH_STATE.SIGNED_OUT);
  const html = ctx.renderAccountCard();
  assert.ok(!/Supabase project URL/i.test(html));
  assert.ok(!/id="cloud_url"|id="cloud_anon"/.test(html));
});

test('SIGNING_IN state disables the button and shows "Signing in…"', () => {
  const ctx = loadAuthUiContext();
  const AUTH_STATE = getVar(ctx, 'AUTH_STATE');
  const CLOUD = getVar(ctx, 'CLOUD');
  CLOUD.anon = 'fake-anon-key';
  ctx.setAuthState(AUTH_STATE.SIGNING_IN);
  const html = ctx.renderAccountCard();
  assert.ok(/Signing in…/.test(html));
  assert.ok(/disabled/.test(html));
});

test('SIGNED_IN state shows email, Cloud Sync status, last synced, and Sign Out — never technical fields', () => {
  const ctx = loadAuthUiContext();
  const AUTH_STATE = getVar(ctx, 'AUTH_STATE');
  const CLOUD = getVar(ctx, 'CLOUD');
  setVar(ctx, 'SB', {});
  CLOUD.user = { email: 'test@example.com' };
  ctx.setAuthState(AUTH_STATE.SIGNED_IN);
  const html = ctx.renderAccountCard();
  assert.ok(html.includes('test@example.com'));
  assert.ok(/Cloud Sync:/.test(html));
  assert.ok(/Last synced:/.test(html));
  assert.ok(/>Sign Out</.test(html));
  assert.ok(!/Supabase project URL|anon\/public key/i.test(html));
});

test('a raw HTML-injection attempt in the signed-in email is escaped, not rendered', () => {
  const ctx = loadAuthUiContext();
  const AUTH_STATE = getVar(ctx, 'AUTH_STATE');
  const CLOUD = getVar(ctx, 'CLOUD');
  setVar(ctx, 'SB', {});
  CLOUD.user = { email: '<img src=x onerror=alert(1)>' };
  ctx.setAuthState(AUTH_STATE.SIGNED_IN);
  const html = ctx.renderAccountCard();
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

describe('Advanced card — collapsed technical configuration, separate from Account');

test('Advanced card is collapsed by default and does not show input fields until opened', () => {
  const ctx = loadAuthUiContext();
  setVar(ctx, 'settingsAdvancedCloudOpen', false);
  const html = ctx.renderAdvancedCloudCard();
  assert.ok(/Advanced/.test(html));
  assert.ok(!/id="adv_cloud_url"/.test(html));
});
test('Advanced card shows Supabase URL/anon key fields once opened', () => {
  const ctx = loadAuthUiContext();
  setVar(ctx, 'settingsAdvancedCloudOpen', true);
  const html = ctx.renderAdvancedCloudCard();
  assert.ok(/id="adv_cloud_url"/.test(html));
  assert.ok(/id="adv_cloud_anon"/.test(html));
  assert.ok(/Save configuration/.test(html));
});

describe('sync.js — app-level Supabase URL default (never overwrites a saved value)');

test('CLOUD.url defaults to the known production project when nothing was saved', () => {
  const ctx = loadAuthUiContext();
  const CLOUD = getVar(ctx, 'CLOUD');
  const PRODUCTION_SUPABASE_URL = getVar(ctx, 'PRODUCTION_SUPABASE_URL');
  assert.equal(CLOUD.url, PRODUCTION_SUPABASE_URL);
  assert.ok(/^https:\/\/ubmntbusoooucbdkeqzp\.supabase\.co$/.test(PRODUCTION_SUPABASE_URL));
});

describe('mentor.js — single-flight refresh lock + error classification (mocked SB, no real network)');

function loadMentorAuthContext() {
  return loadFrontendContext(['utils.js', 'sync.js', 'views/mentor.js']);
}

// This is the test that actually matters for "safe for persistent ChatGPT-
// style auth": it doesn't just count refreshSession() calls, it PROVES every
// one of the 5 concurrent callers gets back the token value the mock returns
// for a SUCCESSFUL refresh ('new-refreshed-token') and never the stale
// starting value ('stale-old-token') — i.e. nobody silently kept using an
// about-to-expire token, and nobody got a different/wrong token than anyone
// else. If the single-flight lock were broken (e.g. a second independent
// refreshSession() call racing the first), this would either fail the call
// count assertion or — more subtly — some callers could resolve before the
// real refresh finishes and get an undefined/stale token; both are checked.
test('5 concurrent getFreshMentorAccessToken() calls near expiry: exactly 1 refreshSession() call, and ALL 5 receive the NEW refreshed token', async () => {
  const ctx = loadMentorAuthContext();
  let refreshCallCount = 0;
  const nowSec = Math.floor(Date.now() / 1000);
  setVar(ctx, 'SB', {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'stale-old-token', expires_at: nowSec + 30 } } }),
      refreshSession: async () => {
        refreshCallCount++;
        await new Promise(r => setTimeout(r, 50)); // simulate real network latency so the 5 calls genuinely overlap
        return { data: { session: { access_token: 'new-refreshed-token', expires_at: nowSec + 3600 } }, error: null };
      },
    },
  });
  const results = await Promise.all(Array.from({ length: 5 }, () => ctx.getFreshMentorAccessToken()));
  assert.equal(refreshCallCount, 1, 'expected exactly one real refreshSession() call for 5 concurrent requests');
  for (let i = 0; i < results.length; i++) {
    assert.equal(results[i].token, 'new-refreshed-token', `caller #${i} did not receive the refreshed token`);
    assert.equal(results[i].reason, null, `caller #${i} unexpectedly had a non-null reason`);
  }
});

test('a retryable network error during refresh returns reason "network-error", not "session-expired"', async () => {
  const ctx = loadMentorAuthContext();
  const nowSec = Math.floor(Date.now() / 1000);
  setVar(ctx, 'SB', {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'old', expires_at: nowSec + 10 } } }),
      refreshSession: async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'fetch failed' } }),
    },
  });
  const result = await ctx.getFreshMentorAccessToken();
  assert.equal(result.token, null);
  assert.equal(result.reason, 'network-error');
});

test('a genuine AuthApiError (invalid/expired refresh token) returns reason "session-expired"', async () => {
  const ctx = loadMentorAuthContext();
  const nowSec = Math.floor(Date.now() / 1000);
  setVar(ctx, 'SB', {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'old', expires_at: nowSec + 10 } } }),
      refreshSession: async () => ({ data: { session: null }, error: { name: 'AuthApiError', message: 'Invalid Refresh Token: Already Used' } }),
    },
  });
  const result = await ctx.getFreshMentorAccessToken();
  assert.equal(result.token, null);
  assert.equal(result.reason, 'session-expired');
});

// Explicitly proves the lock is released in BOTH failure cases, not just on
// success — a failed refresh must never leave mentorTokenRefreshPromise stuck
// forever, which would silently block every future request from ever
// refreshing again.
test('the refresh lock releases after a network-error failure, letting a later call actually retry', async () => {
  const ctx = loadMentorAuthContext();
  const nowSec = Math.floor(Date.now() / 1000);
  let refreshCallCount = 0;
  setVar(ctx, 'SB', {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'old', expires_at: nowSec + 10 } } }),
      refreshSession: async () => {
        refreshCallCount++;
        if (refreshCallCount === 1) return { data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'fetch failed' } };
        return { data: { session: { access_token: 'new-after-retry', expires_at: nowSec + 3600 } }, error: null };
      },
    },
  });
  const first = await ctx.getFreshMentorAccessToken();
  assert.equal(first.reason, 'network-error');
  const second = await ctx.getFreshMentorAccessToken();
  assert.equal(second.token, 'new-after-retry');
  assert.equal(refreshCallCount, 2); // proves the lock was NOT stuck — a real second attempt happened
});
test('the refresh lock releases after a session-expired failure, letting a later call actually retry', async () => {
  const ctx = loadMentorAuthContext();
  const nowSec = Math.floor(Date.now() / 1000);
  let refreshCallCount = 0;
  setVar(ctx, 'SB', {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'old', expires_at: nowSec + 10 } } }),
      refreshSession: async () => {
        refreshCallCount++;
        if (refreshCallCount === 1) return { data: { session: null }, error: { name: 'AuthApiError', message: 'Invalid Refresh Token' } };
        return { data: { session: { access_token: 'new-after-retry-2', expires_at: nowSec + 3600 } }, error: null };
      },
    },
  });
  const first = await ctx.getFreshMentorAccessToken();
  assert.equal(first.reason, 'session-expired');
  const second = await ctx.getFreshMentorAccessToken();
  assert.equal(second.token, 'new-after-retry-2');
  assert.equal(refreshCallCount, 2);
});

test('a plain "not signed in" (no session at all) never attempts a refresh', async () => {
  const ctx = loadMentorAuthContext();
  let refreshCalled = false;
  setVar(ctx, 'SB', {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      refreshSession: async () => { refreshCalled = true; return { data: { session: null }, error: null }; },
    },
  });
  const result = await ctx.getFreshMentorAccessToken();
  assert.equal(result.token, null);
  assert.equal(result.reason, 'not-signed-in');
  assert.equal(refreshCalled, false);
});

test('a token with >=60s remaining is returned as-is, no refresh attempted', async () => {
  const ctx = loadMentorAuthContext();
  let refreshCalled = false;
  const nowSec = Math.floor(Date.now() / 1000);
  setVar(ctx, 'SB', {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'still-good', expires_at: nowSec + 120 } } }),
      refreshSession: async () => { refreshCalled = true; return { data: { session: null }, error: null }; },
    },
  });
  const result = await ctx.getFreshMentorAccessToken();
  assert.equal(result.token, 'still-good');
  assert.equal(refreshCalled, false);
});

describe('sync.js — auth listener event-awareness (mocked onAuthStateChange)');

test('TOKEN_REFRESHED and USER_UPDATED never clear CLOUD.user; only SIGNED_OUT does', () => {
  const ctx = loadAuthUiContext();
  const AUTH_STATE = getVar(ctx, 'AUTH_STATE');
  const CLOUD = getVar(ctx, 'CLOUD');
  let captured = null;
  let renderCallCount = 0;
  ctx.render = () => { renderCallCount++; }; // stub: shell.js's render() isn't loaded in this minimal context
  setVar(ctx, 'authListenerAttached', false);
  setVar(ctx, 'SB', { auth: { onAuthStateChange: (cb) => { captured = cb; } } });
  ctx.attachAuthListener();

  CLOUD.user = { email: 'keep@example.com' };
  ctx.setAuthState(AUTH_STATE.SIGNED_IN);
  captured('TOKEN_REFRESHED', { user: { email: 'keep@example.com' } });
  assert.ok(CLOUD.user !== null);
  assert.equal(ctx.getAuthState(), AUTH_STATE.SIGNED_IN);

  captured('USER_UPDATED', { user: { email: 'keep@example.com' } });
  assert.ok(CLOUD.user !== null);

  captured('SIGNED_OUT', null);
  const CLOUD2 = getVar(ctx, 'CLOUD'); // re-fetch: the listener reassigns CLOUD.user, not the CLOUD object itself, but re-read for clarity
  assert.equal(CLOUD2.user, null);
  assert.equal(ctx.getAuthState(), AUTH_STATE.SIGNED_OUT);
});
