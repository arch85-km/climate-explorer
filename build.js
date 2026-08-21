#!/usr/bin/env node
/**
 * Dependency-free build: concatenates src/**.js (ES modules) plus styles.css
 * into a single self-contained HTML file at dist/epw-visualiser.html.
 *
 * Source authoring rules enforced by this bundler:
 *   - imports must be single-line: `import { a, b } from './x.js';`
 *     or `import * as ns from './x.js';`
 *   - exports must be `export function|const|let|class Name ...` or
 *     `export { a, b };`  — no default exports.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** './parse.js' imported from 'epw/fields' -> 'epw/parse' */
function resolveSpec(fromId, spec) {
  const base = posix.dirname(fromId);
  const joined = posix.normalize(posix.join(base, spec));
  return joined.replace(/\.js$/, '');
}

const IMPORT_NAMED = /^\s*import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"];?\s*$/;
const IMPORT_STAR = /^\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"];?\s*$/;
const EXPORT_DECL = /^(\s*)export\s+(function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const EXPORT_LIST = /^\s*export\s+\{([^}]*)\};?\s*$/;

/** Collapse multi-line `import { a, b } from './x.js';` into one line. */
function collapseImports(source) {
  return source.replace(/^[ \t]*import\s*\{[^{}]*\}\s*from\s*['"][^'"]+['"];?/gm,
    (match) => match.replace(/\s*\n\s*/g, ' ').replace(/\{\s+/, '{ ').replace(/\s+\}/, ' }'));
}

function transform(id, source) {
  const exported = new Set();
  const lines = collapseImports(source).split('\n').map((line) => {
    let m;
    if ((m = line.match(IMPORT_NAMED))) {
      // `a as b` is import syntax; the destructuring equivalent is `a: b`.
      const bindings = m[1].split(',').map((part) => {
        const alias = part.trim().match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
        return alias ? `${alias[1]}: ${alias[2]}` : part.trim();
      }).filter(Boolean).join(', ');
      return `const { ${bindings} } = __req(${JSON.stringify(resolveSpec(id, m[2]))});`;
    }
    if ((m = line.match(IMPORT_STAR))) {
      return `const ${m[1]} = __req(${JSON.stringify(resolveSpec(id, m[2]))});`;
    }
    if ((m = line.match(EXPORT_LIST))) {
      for (const part of m[1].split(',')) {
        const name = part.trim();
        if (!name) continue;
        if (/\sas\s/.test(name)) throw new Error(`${id}: aliased export not supported -> ${name}`);
        exported.add(name);
      }
      return '';
    }
    if ((m = line.match(EXPORT_DECL))) {
      exported.add(m[3]);
      return line.replace(/^(\s*)export\s+/, '$1');
    }
    if (/^\s*export\s/.test(line)) {
      throw new Error(`${id}: unsupported export form -> ${line.trim()}`);
    }
    if (/^\s*import\s/.test(line)) {
      throw new Error(`${id}: unsupported import form -> ${line.trim()}`);
    }
    return line;
  });
  if (exported.size) {
    lines.push(`Object.assign(__exports, {${[...exported].join(', ')}});`);
  }
  return lines.join('\n');
}

/**
 * Embed the bundled example EPW into src/data/sample.js.
 *
 * The file is gzipped and base64-encoded here rather than committed pre-encoded, so
 * the repository holds the readable .epw and version control never carries the blob.
 */
function embedSample(code) {
  const match = code.match(/const SAMPLE_SOURCE = '([^']+)'/);
  if (!match) throw new Error('src/data/sample.js: SAMPLE_SOURCE not found');
  const epwPath = join(ROOT, 'assets', match[1]);
  if (!existsSync(epwPath)) {
    console.warn(`  ! ${match[1]} not found in assets/ — building without a bundled sample`);
    return { code, bytes: 0 };
  }
  const gz = gzipSync(readFileSync(epwPath), { level: 9 });
  const b64 = gz.toString('base64');
  const out = code.replace(
    /const SAMPLE_GZIP_B64 = '';/,
    `const SAMPLE_GZIP_B64 = '${b64}';`,
  );
  if (out === code) throw new Error('src/data/sample.js: SAMPLE_GZIP_B64 placeholder not found');
  return { code: out, bytes: gz.length, raw: readFileSync(epwPath).length };
}

const files = walk(SRC);
if (!files.length) throw new Error('no source modules found');

let sampleInfo = { bytes: 0 };
const modules = files.map((file) => {
  const id = relative(SRC, file).split(/[\\/]/).join('/').replace(/\.js$/, '');
  let source = readFileSync(file, 'utf8');
  if (id === 'data/sample') {
    sampleInfo = embedSample(source);
    source = sampleInfo.code;
  }
  return { id, code: transform(id, source) };
});
if (!modules.some((m) => m.id === 'main')) throw new Error('src/main.js is required');

const runtime = `
(function () {
  "use strict";
  var __defs = {}, __cache = {};
  function __def(id, fn) { __defs[id] = fn; }
  function __req(id) {
    if (__cache[id]) return __cache[id];
    var fn = __defs[id];
    if (!fn) throw new Error("module not found: " + id);
    var e = (__cache[id] = {});
    fn(e, __req);
    return e;
  }
`;

const body = modules
  .map((m) => `__def(${JSON.stringify(m.id)}, function (__exports, __req) {\n${m.code}\n});`)
  .join('\n\n');

const bundle = `${runtime}\n${body}\n\n  __req("main");\n})();`;

const css = readFileSync(join(SRC, 'styles.css'), 'utf8');
const shell = readFileSync(join(SRC, 'shell.html'), 'utf8');

const html = shell
  .replace('/*INJECT:css*/', () => css)
  .replace('//INJECT:js', () => bundle);

if (html.includes('INJECT:')) throw new Error('shell.html injection markers not consumed');

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const outPath = join(ROOT, 'dist', 'epw-visualiser.html');
writeFileSync(outPath, html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
const sample = sampleInfo.bytes
  ? `, sample ${(sampleInfo.raw / 1024).toFixed(0)} KB -> ${(sampleInfo.bytes * 4 / 3 / 1024).toFixed(0)} KB embedded`
  : ', no sample embedded';
console.log(`built ${relative(ROOT, outPath)}  (${modules.length} modules, ${kb} KB${sample})`);
