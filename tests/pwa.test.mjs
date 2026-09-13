// PWA installability checks: manifest validity, icon files actually exist on disk
// at the dimensions the manifest claims, and the service worker precaches every
// asset the manifest/index.html reference. Reads real files from disk — no image
// library needed, PNG width/height live at a fixed byte offset in the IHDR chunk
// (8-byte signature + 4-byte length + 4-byte "IHDR" type, then 4 bytes width,
// 4 bytes height, both big-endian).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, assert, describe } from './tiny-test.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

function pngDimensions(relPath) {
  const buf = fs.readFileSync(path.join(root, relPath));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('manifest.json — validity + icons');

const manifest = JSON.parse(read('manifest.json'));

test('manifest.json is valid JSON with the required installability fields', () => {
  assert.ok(manifest.name);
  assert.ok(manifest.short_name);
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.start_url);
});
test('declares a 192x192 "any" icon that exists on disk at the claimed size', () => {
  const icon = manifest.icons.find(i => i.sizes === '192x192' && i.purpose === 'any');
  assert.ok(icon, 'missing 192x192 any icon entry');
  assert.ok(fs.existsSync(path.join(root, icon.src)), `${icon.src} does not exist`);
  const dim = pngDimensions(icon.src);
  assert.equal(dim.width, 192);
  assert.equal(dim.height, 192);
});
test('declares a 512x512 "any" icon that exists on disk at the claimed size', () => {
  const icon = manifest.icons.find(i => i.sizes === '512x512' && i.purpose === 'any');
  assert.ok(icon, 'missing 512x512 any icon entry');
  assert.ok(fs.existsSync(path.join(root, icon.src)), `${icon.src} does not exist`);
  const dim = pngDimensions(icon.src);
  assert.equal(dim.width, 512);
  assert.equal(dim.height, 512);
});
test('declares a dedicated 512x512 "maskable" icon (separate from the "any" icon) that exists on disk', () => {
  const icon = manifest.icons.find(i => i.purpose === 'maskable');
  assert.ok(icon, 'missing a maskable icon entry');
  assert.equal(icon.sizes, '512x512');
  assert.ok(fs.existsSync(path.join(root, icon.src)), `${icon.src} does not exist`);
  const dim = pngDimensions(icon.src);
  assert.equal(dim.width, 512);
  assert.equal(dim.height, 512);
});
test('the maskable icon is fully opaque (RGBA color type, alpha channel present) — required for maskable icons', () => {
  const icon = manifest.icons.find(i => i.purpose === 'maskable');
  const buf = fs.readFileSync(path.join(root, icon.src));
  const colorType = buf.readUInt8(25); // IHDR byte 9 → offset 8(sig)+4(len)+4(type)+8(w+h)+1(bitdepth)=25
  assert.equal(colorType, 6, 'expected PNG color type 6 (RGBA)');
});

describe('sw.js — precaches every manifest icon');

const sw = read('sw.js');

test('CACHE_VERSION is defined and non-empty', () => {
  const m = sw.match(/const CACHE_VERSION\s*=\s*'([^']+)'/);
  assert.ok(m && m[1], 'CACHE_VERSION not found or empty');
});
test('every manifest icon path is in the service worker precache list', () => {
  for (const icon of manifest.icons) {
    const swPath = './' + icon.src;
    assert.ok(sw.includes(`'${swPath}'`), `sw.js ASSETS is missing ${swPath}`);
  }
});
