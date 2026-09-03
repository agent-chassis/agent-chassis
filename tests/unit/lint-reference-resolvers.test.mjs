import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import * as lintCoordinationRules from '../../packages/wiki-core/src/operations/lint-coordination-rules.mjs';
import * as lintShared from '../../packages/wiki-core/src/operations/lint-shared.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wk0999Path = path.join(repoRoot, 'wiki/work-records/WK-0999.json');
const wk0999 = JSON.parse(readFileSync(wk0999Path, 'utf8'));

function getExport(module, names) {
  for (const name of names) {
    if (typeof module[name] === 'function') {
      return module[name];
    }
  }
  throw new Error(`Missing export: ${names.join(', ')}`);
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value && typeof value === 'object') {
    if (typeof value.exists === 'boolean') {
      return value.exists;
    }

    if (typeof value.resolved === 'boolean') {
      return value.resolved;
    }

    if (typeof value.ok === 'boolean') {
      return value.ok;
    }

    if (typeof value.skipped === 'boolean') {
      return value.skipped;
    }

    if (typeof value.flagged === 'boolean') {
      return !value.flagged;
    }
  }

  throw new Error(`Resolver did not return a boolean-like result: ${JSON.stringify(value)}`);
}

function callResolver(fn, ref, context) {
  const candidates = [
    () => fn(ref, context),
    () => fn(ref, context.loadedWorkRecordsById, context.pagesById),
    () => fn(ref),
    () => fn({ ...context, ref }),
    () => fn({ ...context, reference: ref }),
    () => fn({ ...context, id: ref }),
    () => fn({ ...context, path: ref }),
    () => fn({ ...context, docsRef: ref }),
  ];

  const errors = [];
  for (const attempt of candidates) {
    try {
      return normalizeBoolean(attempt());
    } catch (error) {
      errors.push(error);
    }
  }

  const detail = errors.at(-1)?.message ?? 'unknown failure';
  throw new Error(`Unable to invoke resolver for ${JSON.stringify(ref)}: ${detail}`);
}

function createRelatedIdContext(record) {
  const wrappedRecord = { record };
  const loadedWorkRecordsById = new Map([[record.id, wrappedRecord]]);
  const pagesById = new Map();
  const loadedWorkRecords = { [record.id]: wrappedRecord };

  return {
    loadedWorkRecordsById,
    pagesById,
    loadedWorkRecords,
    workRecords: loadedWorkRecords,
    records: loadedWorkRecords,
    recordsById: loadedWorkRecordsById,
    workRecordsById: loadedWorkRecordsById,
    canonicalWorkRecordsById: loadedWorkRecordsById,
    pages: {},
  };
}

function createDocsContext() {
  const docsRoot = path.join(repoRoot, 'docs');
  const internalRoot = path.join(repoRoot, 'internal');

  return {
    repoRoot,
    root: repoRoot,
    rootDir: repoRoot,
    baseDir: repoRoot,
    repoRootPath: repoRoot,
    workspaceRootPath: repoRoot,
    cwd: repoRoot,
    workspaceRoot: repoRoot,
    docsRoot,
    docsRootPath: docsRoot,
    internalRoot,
    internalRootPath: internalRoot,
  };
}

const isCanonicalWorkRecordReference = getExport(lintShared, [
  'isCanonicalWorkRecordReference',
  'default',
]);

const readScopeRefExists = getExport(lintCoordinationRules, [
  'readScopeRefExists',
  'default',
]);

const relatedContext = createRelatedIdContext(wk0999);
const docsContext = createDocsContext();

test('related-id resolver exempts cross-repo refs and keeps malformed qualified refs skipped', () => {
  const refs = [
    'node-engine:WK-0365',
    'node-engine:docs/the project documentation',
    'node-engine:GARBAGE',
    'otherrepo:WK-0001',
  ];

  for (const ref of refs) {
    assert.equal(
      callResolver(isCanonicalWorkRecordReference, ref, relatedContext),
      true,
      `expected cross-repo ref to be accepted: ${ref}`,
    );
  }
});

test('related-id resolver accepts existing slice-qualified refs and flags missing slices or bare missing refs', () => {
  assert.equal(
    callResolver(isCanonicalWorkRecordReference, 'WK-0999#SLICE-066', relatedContext),
    true,
    'expected existing same-repo slice-qualified ref to resolve',
  );

  assert.equal(
    callResolver(isCanonicalWorkRecordReference, 'WK-0999#SLICE-999', relatedContext),
    false,
    'expected nonexistent slice-qualified ref to stay flagged',
  );

  assert.equal(
    callResolver(isCanonicalWorkRecordReference, 'WK-0000', relatedContext),
    false,
    'expected missing same-repo WK ref to stay flagged',
  );
});

test('docs-target resolver exempts cross-repo refs and strips anchors before path existence checks', () => {
  const refs = [
    'node-engine:docs/the project documentation',
    'node-engine:docs/does-not-matter.md',
    'node-engine:GARBAGE',
    'otherrepo:WK-0001',
    'the project documentation#anchor',
  ];

  for (const ref of refs) {
    assert.equal(
      callResolver(readScopeRefExists, ref, docsContext),
      true,
      `expected ref to be accepted or skipped: ${ref}`,
    );
  }
});

test('docs-target resolver still flags bare missing same-repo paths', () => {
  assert.equal(
    callResolver(readScopeRefExists, 'docs/does-not-exist.md', docsContext),
    false,
    'expected bare missing docs path to stay flagged',
  );
});
