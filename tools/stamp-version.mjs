#!/usr/bin/env node
/**
 * Stamp the version and release date into every source file's leading comment.
 *
 * Driven entirely from package.json, so a release is one command rather than 38
 * hand edits that inevitably drift apart. Idempotent: running it twice leaves the
 * tree unchanged.
 *
 * Usage: npm run stamp
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const STAMP = ` * @version ${pkg.version} — ${pkg.releaseDate}`;
const STAMP_RE = /^ \* @version .*$/m;

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

let changed = 0;
let stamped = 0;

for (const file of walk(join(ROOT, 'src'))) {
  const source = readFileSync(file, 'utf8');

  // Only touch files that open with a block comment, which is all of them; a file
  // without one gets left alone rather than having a header invented for it.
  if (!source.startsWith('/**')) {
    console.warn(`  skip ${relative(ROOT, file)} — no leading block comment`);
    continue;
  }
  const end = source.indexOf('*/');
  if (end < 0) {
    console.warn(`  skip ${relative(ROOT, file)} — unterminated leading comment`);
    continue;
  }

  const head = source.slice(0, end);
  const tail = source.slice(end);
  let nextHead;

  if (STAMP_RE.test(head)) {
    nextHead = head.replace(STAMP_RE, STAMP);
  } else {
    // Append as the comment's last line, after a blank comment line so it reads as
    // metadata rather than as part of the prose above it.
    nextHead = `${head.replace(/\s*$/, '')}\n *\n${STAMP}\n `;
  }

  const next = nextHead + tail;
  stamped += 1;
  if (next !== source) {
    writeFileSync(file, next);
    changed += 1;
  }
}

console.log(`stamped v${pkg.version} (${pkg.releaseDate}) into ${stamped} files, ${changed} changed`);
