#!/usr/bin/env node
/**
 * Self-check for the `@local/dsh-workspace-archive` bundle.
 *
 * Zero third-party dependencies: `node:` builtins only, so the check runs in a
 * clean checkout with no install step. It answers one question — "would this
 * package load?" — by verifying the manifest, the bundle patch, the locale
 * dictionaries, and the two module bodies that the Loader will actually parse.
 *
 * Run from the package root: `node scripts/check.mjs`
 * Exit code 0 = every check passed; 1 = at least one check failed (each FAIL
 * line names the file, the expectation, and what was found instead).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root, resolved from this script's own location. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Collected results, printed in declaration order at the end. */
const results = [];

/**
 * Record one check outcome.
 * @param ok - whether the check passed.
 * @param label - what was checked.
 * @param note - evidence: the observed value, or the failure reason.
 */
function record(ok, label, note) {
  results.push({ ok, label, note: note === undefined ? '' : note });
}

/**
 * Run one check body, turning a thrown assertion into a FAIL line.
 * @param label - what is being checked.
 * @param body - check body; return a short evidence string, throw to fail.
 */
function check(label, body) {
  try {
    const note = body();
    record(true, label, typeof note === 'string' ? note : '');
  } catch (error) {
    record(false, label, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Assert one expectation.
 * @param condition - expected to be truthy.
 * @param message - failure reason, shown verbatim in the FAIL line.
 */
function assertThat(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Read a package-relative file as UTF-8 text.
 * @param relative - path relative to the package root.
 * @returns the file text.
 */
function readText(relative) {
  const absolute = join(ROOT, relative);
  if (!existsSync(absolute)) throw new Error(`${relative} is missing`);
  return readFileSync(absolute, 'utf8');
}

/**
 * Read and parse a package-relative JSON file.
 * @param relative - path relative to the package root.
 * @returns the parsed value.
 */
function readJson(relative) {
  const text = readText(relative);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${relative} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* ---------------------------------------------------------------------- *
 * 1. Syntax: the Loader parses these two bodies; `node --check` must agree
 * ---------------------------------------------------------------------- */

for (const relative of ['index.js', 'client.js']) {
  check(`node --check ${relative}`, () => {
    if (!existsSync(join(ROOT, relative))) throw new Error(`${relative} is missing`);
    const proc = spawnSync(process.execPath, ['--check', relative], { cwd: ROOT, encoding: 'utf8' });
    if (proc.error) throw new Error(`could not run node --check: ${proc.error.message}`);
    if (proc.status !== 0) {
      const detail = String(proc.stderr || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' / ');
      throw new Error(`node --check exited ${proc.status}: ${detail || 'no stderr output'}`);
    }
    return 'syntax OK';
  });
}

/* ---------------------------------------------------------------------- *
 * 2. Manifest: identity, module wiring, and the files it points at
 * ---------------------------------------------------------------------- */

let pkg = null;
let pkgReadError = '';
try {
  pkg = readJson('package.json');
} catch (error) {
  pkgReadError = error instanceof Error ? error.message : String(error);
}

/**
 * Run a manifest check, failing early when package.json itself is unreadable.
 * @param label - what is being checked.
 * @param body - receives the parsed manifest.
 */
function checkManifest(label, body) {
  check(label, () => {
    if (pkg === null) throw new Error(`package.json is unusable: ${pkgReadError}`);
    return body(pkg);
  });
}

checkManifest('package.json: name === "@local/dsh-workspace-archive"', (manifest) => {
  assertThat(
    manifest.name === '@local/dsh-workspace-archive',
    `expected "@local/dsh-workspace-archive", found ${JSON.stringify(manifest.name)}`,
  );
  return manifest.name;
});

checkManifest('package.json: type === "module"', (manifest) => {
  assertThat(manifest.type === 'module', `expected "module", found ${JSON.stringify(manifest.type)}`);
  return manifest.type;
});

checkManifest('package.json: exports["./client"] === "./client.js" and the file exists', (manifest) => {
  const target = manifest.exports === undefined || manifest.exports === null ? undefined : manifest.exports['./client'];
  assertThat(target === './client.js', `expected "./client.js", found ${JSON.stringify(target)}`);
  assertThat(existsSync(join(ROOT, 'client.js')), 'client.js does not exist on disk');
  return 'client.js present';
});

checkManifest('package.json: dsh.bundle.patch === "./cordis.patch.yml" and the file exists', (manifest) => {
  const target = manifest.dsh?.bundle?.patch;
  assertThat(target === './cordis.patch.yml', `expected "./cordis.patch.yml", found ${JSON.stringify(target)}`);
  assertThat(existsSync(join(ROOT, 'cordis.patch.yml')), 'cordis.patch.yml does not exist on disk');
  return 'cordis.patch.yml present';
});

checkManifest('package.json: dsh.client.platform === "web"', (manifest) => {
  const platform = manifest.dsh?.client?.platform;
  assertThat(platform === 'web', `expected "web", found ${JSON.stringify(platform)}`);
  return platform;
});

checkManifest('package.json: icon points at an existing file', (manifest) => {
  const icon = manifest.icon;
  assertThat(typeof icon === 'string' && icon !== '', `expected a non-empty icon path, found ${JSON.stringify(icon)}`);
  const relative = icon.startsWith('./') ? icon.slice(2) : icon;
  assertThat(existsSync(join(ROOT, relative)), `icon target ${JSON.stringify(icon)} does not exist`);
  return icon;
});

for (const language of ['en', 'zh']) {
  check(`locale/${language}.json: parses and carries non-empty title/description`, () => {
    const dictionary = readJson(`locale/${language}.json`);
    assertThat(
      dictionary !== null && typeof dictionary === 'object' && !Array.isArray(dictionary),
      `expected a JSON object, found ${Array.isArray(dictionary) ? 'array' : typeof dictionary}`,
    );
    for (const key of ['title', 'description']) {
      const value = dictionary[key];
      assertThat(
        typeof value === 'string' && value.trim() !== '',
        `"${key}" must be a non-empty string, found ${JSON.stringify(value)}`,
      );
    }
    return `title=${JSON.stringify(dictionary.title)}`;
  });
}

/* ---------------------------------------------------------------------- *
 * 3. Bundle patch: the roster row the manifest promises (text scan only —
 *    a full YAML parser would drag in a dependency for one row)
 * ---------------------------------------------------------------------- */

check('cordis.patch.yml: contains an `insert:` mapping key', () => {
  const text = readText('cordis.patch.yml');
  assertThat(/^\s*(?:-\s*)?insert\s*:/m.test(text), 'no uncommented `insert:` key found');
  return 'insert: found';
});

check('cordis.patch.yml: contains `id: workspace-archive`', () => {
  const text = readText('cordis.patch.yml');
  assertThat(/^\s*(?:-\s*)?id:\s*['"]?workspace-archive['"]?\s*$/m.test(text), 'no `id: workspace-archive` row found');
  return 'id: workspace-archive';
});

check("cordis.patch.yml: contains `name: '@local/dsh-workspace-archive'`", () => {
  const text = readText('cordis.patch.yml');
  assertThat(
    /^\s*(?:-\s*)?name:\s*['"]?@local\/dsh-workspace-archive['"]?\s*$/m.test(text),
    "no `name: '@local/dsh-workspace-archive'` row found",
  );
  return "name: '@local/dsh-workspace-archive'";
});

/* ---------------------------------------------------------------------- *
 * 4. Client body: the browser module table only carries React, and the
 *    Client half must not reach for the DOM document directly
 * ---------------------------------------------------------------------- */

check("client.js: requires only 'react' (no '@deepseek-ai/*' requests)", () => {
  const source = readText('client.js');
  const forbidden = [
    [/require\(\s*['"]@deepseek-ai\//g, "require('@deepseek-ai/"],
    [/from\s+['"]@deepseek-ai\//g, "from '@deepseek-ai/"],
  ];
  const hits = [];
  for (const [pattern, label] of forbidden) {
    const found = source.match(pattern);
    if (found !== null && found.length > 0) hits.push(`${label}… x${found.length}`);
  }
  assertThat(hits.length === 0, `forbidden import(s) found: ${hits.join(', ')}`);
  const requested = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
  const unexpected = [...new Set(requested)].filter((id) => id !== 'react');
  assertThat(unexpected.length === 0, `unexpected module request(s): ${unexpected.join(', ')}`);
  assertThat(requested.includes('react'), "no require('react') found; the Client half must import React");
  return `require targets: ${[...new Set(requested)].join(', ')}`;
});

check('client.js: does not mention `document.body`', () => {
  const source = readText('client.js');
  assertThat(!source.includes('document.body'), 'forbidden literal `document.body` found');
  return '0 hits';
});

/* The pin set is the one thing this plugin persists. The shipped Client store
   persists to localStorage under a name key, so the same mechanism is fine —
   but an unguarded or unnamespaced write would be a defect, not a style
   question: private mode throws on access and a bare key would collide. */

check('client.js: pins persist under the namespaced key `dsh.workspace-archive.pinned-workspaces`', () => {
  const source = readText('client.js');
  assertThat(
    source.includes("'dsh.workspace-archive.pinned-workspaces'"),
    'no namespaced pin storage key literal found',
  );
  const accesses = source.match(/localStorage\./g) ?? [];
  const guards = source.match(/typeof localStorage === 'undefined'/g) ?? [];
  assertThat(accesses.length > 0, 'the pin set must be persisted; no localStorage member access found at all');
  assertThat(
    guards.length >= accesses.length,
    `each storage accessor needs its own \`typeof localStorage === 'undefined'\` guard: ` +
      `${accesses.length} member access(es) against ${guards.length} guard(s)`,
  );
  return `${accesses.length} guarded access(es), ${guards.length} guard(s)`;
});

check('client.js: pin writes go through the declared `workspaces` service, feature-detected', () => {
  const source = readText('client.js');
  assertThat(
    /workspacesService\.insertBefore\(/.test(source),
    'no `workspacesService.insertBefore(` call found; the pin must use the service the fiber declares',
  );
  assertThat(
    source.includes("typeof workspacesService.insertBefore === 'function'"),
    'the reorder verb must be feature-detected: a build without it has to degrade, not throw',
  );
  return 'insertBefore probed and used through the declared service';
});

check('client.js: the pin menu row carries its own package-namespaced slot id', () => {
  const source = readText('client.js');
  const ids = [...source.matchAll(/const\s+(?:PIN_)?MENU_ID\s*=\s*'([^']+)'/g)].map((match) => match[1]);
  assertThat(ids.length === 2, `expected the archive row AND the pin row ids, found ${ids.length}`);
  assertThat(ids[0] !== ids[1], `the two menu rows must not share a slot id: ${ids.join(' vs ')}`);
  for (const id of ids) {
    assertThat(id.startsWith('workspace-archive.'), `${id} must carry the package namespace`);
  }
  return ids.join(', ');
});

/* ---------------------------------------------------------------------- *
 * 5. Service resolution: Cordis gates `ctx.<service>` on the fiber's
 *    `inject` declaration, and an undeclared read THROWS. Inside a React
 *    event handler that throw is swallowed, so the control just looks dead.
 *    This check is the regression guard for exactly that failure.
 * ---------------------------------------------------------------------- */

/** Core Context verbs and helpers: framework surface, never a declared service. */
const CONTEXT_VERBS = new Set([
  'acc',
  'bail',
  'effect',
  'emit',
  'get',
  'inject',
  'interval',
  'isolate',
  'on',
  'once',
  'parallel',
  'plugin',
  'provide',
  'reflect',
  'serial',
  'set',
  'start',
  'stop',
  'timeout',
  'waterfall',
]);

/**
 * Extract the module-level `inject` array from the Client half.
 * @param source - client.js text.
 * @returns the declared service names.
 */
function declaredServices(source) {
  const match = /const\s+inject\s*=\s*\[([^\]]*)\]/.exec(source);
  if (match === null) throw new Error('no `const inject = [...]` declaration found in client.js');
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
}

check('client.js: every `ctx.<service>` read is declared in `inject`', () => {
  const source = readText('client.js');
  const declared = new Set(declaredServices(source));
  const observed = new Set();
  for (const match of source.matchAll(/\bctx\.([A-Za-z][A-Za-z0-9]*)/g)) {
    const name = match[1];
    if (!CONTEXT_VERBS.has(name)) observed.add(name);
  }
  const undeclared = [...observed].filter((name) => !declared.has(name));
  assertThat(
    undeclared.length === 0,
    `ctx.${undeclared.join(', ctx.')} read but not declared — Cordis throws ` +
      `"cannot get property \\"<name>\\" without inject", which a click handler swallows silently. ` +
      `Declared: ${[...declared].join(', ')}`,
  );
  return `declared: ${[...declared].join(', ')} | used: ${[...observed].join(', ')}`;
});

check('client.js: `workspaces` and `sessions` are hard dependencies', () => {
  const declared = declaredServices(readText('client.js'));
  for (const name of ['workspaces', 'sessions']) {
    assertThat(
      declared.includes(name),
      `"${name}" is not declared in \`inject\` — resolving it throws at the first read`,
    );
  }
  return 'workspaces + sessions declared';
});

/* ---------------------------------------------------------------------- *
 * Report
 * ---------------------------------------------------------------------- */

const failures = results.filter((result) => !result.ok);
for (const result of results) {
  const line = `${result.ok ? 'PASS' : 'FAIL'}  ${result.label}${result.note === '' ? '' : ` — ${result.note}`}`;
  if (result.ok) console.log(line);
  else console.error(line);
}

if (failures.length === 0) {
  console.log(`\nPASS  dsh-workspace-archive self-check — ${results.length}/${results.length} checks passed`);
  process.exitCode = 0;
} else {
  console.error(
    `\nFAIL  dsh-workspace-archive self-check — ${failures.length} of ${results.length} checks failed:` +
      failures.map((failure) => `\n  - ${failure.label} — ${failure.note}`).join(''),
  );
  process.exitCode = 1;
}
