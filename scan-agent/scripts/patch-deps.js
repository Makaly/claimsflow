#!/usr/bin/env node
// Patch transitive dependencies whose `exports` field defeats pkg's static
// analysis. Without this, the bundled binary throws MODULE_NOT_FOUND at boot
// for files routed via conditional exports that pkg cannot follow.
//
// Idempotent: safe to re-run after every `npm install`.

'use strict';

const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const here = __dirname;
const root = join(here, '..');

// ── es-get-iterator: `exports.default = "./node.js"` is unreachable from the
// pkg snapshot. `index.js` (the `main`) is functionally identical for Node, so
// remove `exports` and let Node fall back to `main`.
function patchEsGetIterator() {
  const modDir = join(root, 'node_modules', 'es-get-iterator');
  const pkgPath = join(modDir, 'package.json');
  if (!existsSync(pkgPath)) return false;
  let changed = false;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.exports) {
    delete pkg.exports;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
    changed = true;
  }

  // The conditional-exports targets (`node.js`, `node.mjs`) are unreachable
  // from a pkg snapshot — even with `exports` removed, Node's resolver can
  // still pick them up via legacy heuristics. Remove them so `main:
  // ./index.js` is the only resolution path. `index.js` is functionally
  // equivalent under Node.
  for (const f of ['node.js', 'node.mjs']) {
    const p = join(modDir, f);
    if (existsSync(p)) {
      require('node:fs').unlinkSync(p);
      changed = true;
    }
  }
  return changed;
}

const patched = [];
if (patchEsGetIterator()) patched.push('es-get-iterator');

if (patched.length > 0) {
  console.log(`[patch-deps] patched: ${patched.join(', ')}`);
}
