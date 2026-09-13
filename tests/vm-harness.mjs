// Loads the ACTUAL frontend source files (utils.js, shell.js — plain global-
// scope <script> files, not modules) into a sandboxed Node vm context so their
// real, unmodified functions can be tested directly, without needing a browser
// or a build step. Neither file executes any browser API at module load time
// (only inside function bodies, which are just late-bound identifier lookups
// until actually called) — confirmed by grepping for top-level document/
// window/navigator/localStorage use before relying on this. Only a minimal
// placeholder shim is provided, just enough for lazy identifier resolution;
// tests must stick to calling genuinely pure functions.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

export function loadFrontendContext(files) {
  const sandbox = {
    console,
    document: { getElementById: () => null, addEventListener: () => {}, createElement: () => ({}) },
    window: {},
    navigator: { geolocation: undefined, onLine: true, permissions: undefined },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { hash: '' },
    views: {}, // shell.js's render() target — views/mentor.js assigns views.mentor=... at load time
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  context.__vmContext = context; // lets getVar/setVar below reach back in without a second arg
  for (const file of files) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInContext(src, context, { filename: file });
  }
  return context;
}

// Top-level `const`/`let` in a script run via vm.runInContext do NOT attach to
// the context object as properties (only `var`/`function` declarations do) —
// only a plain identifier lookup INSIDE that same context can see them. These
// two helpers bridge that gap for tests that need to read or replace a
// `let`/`const` binding from outside (e.g. sync.js's `let CLOUD`/`let SB`),
// without changing any real source file just to make it more test-friendly.
// Getting an object (e.g. CLOUD) returns the REAL reference — mutating its
// properties from outside (ctx_CLOUD.anon = 'x') is then visible to code
// inside the vm context too, no special helper needed for that part.
export function getVar(context, name) {
  context.__tmp = undefined;
  vm.runInContext(`__tmp = (typeof ${name} !== 'undefined') ? ${name} : undefined;`, context);
  const v = context.__tmp;
  delete context.__tmp;
  return v;
}
export function setVar(context, name, value) {
  context.__tmp = value;
  vm.runInContext(`${name} = __tmp;`, context);
  delete context.__tmp;
}
