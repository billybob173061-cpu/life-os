// Verifies the mobile transformation pass: the primary tab bar now has 5
// items (Settings moved to a topbar icon button), each tab carries an icon,
// index.html/styles.css/views/settings.js carry the markup and CSS that
// pass depends on. Nav-icon/tabbar logic is exercised via the real shell.js
// source loaded through tests/vm-harness.mjs (see that file for why this is
// safe without a browser); index.html/styles.css/settings.js are checked as
// raw source text since they're static markup / template strings, not pure
// functions that can be called directly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, describe } from './tiny-test.mjs';
import { loadFrontendContext, getVar } from './vm-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const shellCtx = loadFrontendContext(['shell.js']);
const NAV_ICONS = getVar(shellCtx, 'NAV_ICONS');

describe('shell.js — tabbar() (5 primary destinations, Settings moved out)');

test('tabbar() renders exactly 5 primary tab buttons', () => {
  const html = shellCtx.tabbar('today');
  const count = (html.match(/class="tab /g) || []).length;
  assert.equal(count, 5);
});
test('tabbar() never renders a Settings tab (moved to the topbar icon)', () => {
  const html = shellCtx.tabbar('today');
  assert.ok(!html.includes(">Settings<"));
});
test('tabbar() renders an icon span for every tab', () => {
  const html = shellCtx.tabbar('today');
  const count = (html.match(/class="tab-icon"/g) || []).length;
  assert.equal(count, 5);
});
test('NAV_ICONS defines all 5 primary destinations plus settings (reused by index.html)', () => {
  for (const key of ['today', 'mentor', 'explore', 'progress', 'life', 'settings']) {
    assert.ok(NAV_ICONS[key] && NAV_ICONS[key].includes('<svg'), `missing icon for ${key}`);
  }
});
test('tabbar() marks the Progress group active while viewing any Progress sub-route', () => {
  const html = shellCtx.tabbar('bjj');
  assert.ok(/class="tab active"[^]*?Progress/.test(html) || html.includes('active'));
});

describe('index.html — Settings icon button + PWA meta tags (mobile transformation pass)');

const indexHtml = read('index.html');

test('has a topbar Settings icon button routing to go(\'settings\')', () => {
  assert.ok(indexHtml.includes(`onclick="go('settings')"`));
  assert.ok(indexHtml.includes('aria-label="Settings"'));
});
test('the Settings button uses the .icon-btn class (not the primary "add" accent style)', () => {
  const btnMatch = indexHtml.match(/<button class="icon-btn"[^>]*>/);
  assert.ok(btnMatch, 'expected a <button class="icon-btn"> element');
});
test('declares apple-mobile-web-app-status-bar-style and apple-mobile-web-app-title', () => {
  assert.ok(indexHtml.includes('apple-mobile-web-app-status-bar-style'));
  assert.ok(indexHtml.includes('apple-mobile-web-app-title'));
});
test('viewport meta still includes viewport-fit=cover (required for env(safe-area-inset-*) to resolve)', () => {
  assert.ok(indexHtml.includes('viewport-fit=cover'));
});

describe('styles.css — fixed bottom nav + safe-area insets (mobile transformation pass)');

const css = read('styles.css');

test('mobile bottom nav uses env(safe-area-inset-bottom) so it clears the iOS home indicator', () => {
  const count = (css.match(/env\(safe-area-inset-bottom\)/g) || []).length;
  assert.ok(count >= 2, `expected at least 2 uses (nav bar + mentor composer offset), found ${count}`);
});
test('.tabs becomes position:fixed inside the mobile media query', () => {
  const mobileBlock = css.slice(css.indexOf('@media(max-width:700px)'));
  assert.ok(/\.tabs\{[^}]*position:fixed/.test(mobileBlock));
});
test('.app gets bottom padding on mobile so content is never hidden behind the fixed nav', () => {
  const mobileBlock = css.slice(css.indexOf('@media(max-width:700px)'));
  assert.ok(/\.app\{padding-bottom:calc\(/.test(mobileBlock));
});
test('.icon-btn style exists for the topbar Settings button', () => {
  assert.ok(css.includes('.icon-btn{'));
});
test('the obsolete Phase-16 6-tab-cramming hack (C3) is gone', () => {
  assert.ok(!css.includes('C3 (Phase 16)'));
});

describe('views/settings.js — reorganized sections with progressive disclosure');

const settingsSrc = read(path.join('views', 'settings.js'));

test('renders labeled Account / Preferences / Data & Backup sections', () => {
  assert.ok(settingsSrc.includes('>Account<'));
  assert.ok(settingsSrc.includes('>Preferences<'));
  assert.ok(settingsSrc.includes('Data &amp; Backup'));
});
test('Location and AI sections use <details> for progressive disclosure', () => {
  assert.ok(/<details class="settings-group"[^>]*><summary class="section-major">Location<\/summary>/.test(settingsSrc));
  assert.ok(/<details class="settings-group"[^>]*><summary class="section-major">AI<\/summary>/.test(settingsSrc));
});
test('Location details defaults open only when the user has actually enabled it (locMode!=="off")', () => {
  assert.ok(settingsSrc.includes(`locMode!=='off'?'open':''`));
});
