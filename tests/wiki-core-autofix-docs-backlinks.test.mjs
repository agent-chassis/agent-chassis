import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { test } from 'node:test';

import * as autofixModule from '../packages/wiki-core/src/operations/autofix-docs-backlinks.mjs';
import * as lintModule from '../packages/wiki-core/src/operations/lint.mjs';
import { loadCanonicalState } from '../packages/wiki-core/src/lib/wiki.mjs';

const autofixDocsBacklinks = pickCallable(autofixModule, ['autofixDocsBacklinks']);
const validateDocsTarget = pickCallable(autofixModule, ['validateDocsTarget']);
const lintRepo = pickCallable(lintModule, ['lintRepo']);

const repoSlug = 'agent-chassis/agent-chassis';
const today = '2026-06-17';

function pickCallable(moduleNamespace, names) {
  for (const name of names) {
    const value = moduleNamespace[name];
    if (typeof value === 'function') {
      return value;
    }
  }

  const defaultExport = moduleNamespace.default;
  if (typeof defaultExport === 'function') {
    return defaultExport;
  }

  if (defaultExport && typeof defaultExport === 'object') {
    for (const name of names) {
      const value = defaultExport[name];
      if (typeof value === 'function') {
        return value;
      }
    }
  }

  throw new Error(`Unable to locate callable export: ${names.join(', ')}`);
}

async function withWorkingDirectory(cwd, fn) {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

async function makeFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'wiki-core-autofix-'));
  await mkdir(path.join(repoRoot, 'docs', 'private'), { recursive: true });
  await mkdir(path.join(repoRoot, 'wiki', 'work-records'), { recursive: true });

  await writeFile(
    path.join(repoRoot, 'docs', 'guide.md'),
    '# Guide\n\nBody text that should stay intact.\n',
  );
  await writeFile(path.join(repoRoot, 'outside.md'), 'Outside target must stay untouched.\n');
  await symlink('../outside.md', path.join(repoRoot, 'docs', 'escape.md'));
  await writeFile(
    path.join(repoRoot, 'wiki', 'work-records', 'WK-9000.json'),
    JSON.stringify(
      {
        schema_version: 'work-record.v1',
        id: 'WK-9000',
        repo: repoSlug,
        title: 'Fixture tracking guide docs',
        record_kind: 'work_item',
        work_kind: 'implementation',
        status: 'todo',
        priority: 'medium',
        owner: 'unassigned',
        created: today,
        updated: today,
        read_scope: ['AGENTS.md'],
        repo_paths: ['docs/guide.md'],
        write_scope: ['docs/guide.md'],
        depends_on: [],
        blocks: [],
        related: [],
        dispatch_intent: {
          intended_agent_role: 'worker',
          target_unit: 'slice',
          requires_graph_impact: false,
          requires_escalation: false,
        },
        acceptance: {
          criteria: ['fixture'],
          validation: ['node --test'],
        },
        sections: {
          summary: 'Fixture work record used to trigger missing docs backlink lint.',
          why_it_matters: '',
          scope: {
            items: ['docs/guide.md'],
            out_of_scope: ['docs/private/skip.md'],
          },
          tasks: [],
          references: [],
          agent_notes: '',
          closure: null,
        },
        docs: ['docs/guide.md'],
        children: [],
        slices: [],
      },
      null,
      2,
    ) + '\n',
  );

  return {
    repoRoot,
    guidePath: path.join(repoRoot, 'docs', 'guide.md'),
    skipPath: path.join(repoRoot, 'docs', 'private', 'skip.md'),
    escapePath: path.join(repoRoot, 'docs', 'escape.md'),
    outsidePath: path.join(repoRoot, 'outside.md'),
  };
}

function normalizeFindings(result) {
  if (Array.isArray(result)) {
    return result;
  }
  if (result && typeof result === 'object') {
    for (const key of ['findings', 'issues', 'results']) {
      const value = result[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
  }
  return [];
}

function normalizeSummary(result) {
  if (result && typeof result === 'object') {
    return {
      found: result.found ?? result.found_count ?? result.total ?? 0,
      fixed: result.fixed ?? result.fixed_count ?? 0,
      skipped: result.skipped ?? result.skipped_count ?? 0,
      rejected: result.rejected ?? result.rejected_count ?? 0,
      changed: result.changed ?? result.changed_count ?? result.updated ?? result.updated_count ?? 0,
    };
  }
  return {
    found: 0,
    fixed: 0,
    skipped: 0,
    rejected: 0,
    changed: 0,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runLint(repoRoot) {
  return lintRepo({ dir: repoRoot, includeAllFindings: true });
}

async function runAutofix(repoRoot, extra = {}) {
  return autofixDocsBacklinks({ dir: repoRoot, ...extra });
}

test('autofix inserts the exact docs backlink comment and stays idempotent', async (t) => {
  const fixture = await makeFixture();
  const sandboxCwd = await mkdtemp(path.join(os.tmpdir(), 'wiki-core-autofix-cwd-'));
  const originalGuide = await readFile(fixture.guidePath, 'utf8');

  try {
    const lintResult = await withWorkingDirectory(sandboxCwd, async () => runLint(fixture.repoRoot));
    const findings = normalizeFindings(lintResult).filter((finding) => finding?.code === 'missing_docs_backlink');

    assert.ok(findings.length > 0, 'expected at least one missing_docs_backlink finding');

    const finding = findings.find((entry) => entry?.backlink_comment) ?? findings[0];
    assert.equal(typeof finding.source_id, 'string');
    assert.equal(typeof finding.backlink_id, 'string');
    assert.equal(finding.relation, 'tracks');
    assert.equal(
      finding.backlink_comment,
      `<!-- wiki: id=${finding.backlink_id} relation=${finding.relation} -->`,
    );

    const firstRun = await withWorkingDirectory(sandboxCwd, async () =>
      runAutofix(fixture.repoRoot, {
        findings,
        includeAllFindings: true,
      }),
    );

    const firstSummary = normalizeSummary(firstRun);
    const firstGuide = await readFile(fixture.guidePath, 'utf8');
    const expectedComment = finding.backlink_comment;

    assert.notEqual(firstGuide, originalGuide);
    const firstGuideMatches = firstGuide.match(new RegExp(escapeRegExp(expectedComment), 'g')) ?? [];
    assert.equal(firstGuideMatches.length, 1);
    assert.equal(
      firstGuide.replace(new RegExp(`^${escapeRegExp(expectedComment)}\\n(?:\\n)?`), ''),
      originalGuide,
    );
    assert.ok(
      firstSummary.fixed >= 1 || firstSummary.found >= 1 || firstSummary.changed >= 1,
      'expected autofix to report a changed docs page',
    );

    const secondRun = await withWorkingDirectory(sandboxCwd, async () =>
      runAutofix(fixture.repoRoot, {
        findings,
        includeAllFindings: true,
      }),
    );

    const secondSummary = normalizeSummary(secondRun);
    const secondGuide = await readFile(fixture.guidePath, 'utf8');

    assert.equal(secondGuide, firstGuide);
    assert.equal(secondSummary.fixed, 0);
    assert.equal(secondSummary.rejected, 0);
    assert.equal(secondSummary.skipped, 0);
    assert.equal(secondSummary.changed, 0);
  } finally {
    await rm(fixture.repoRoot, { recursive: true, force: true });
    await rm(sandboxCwd, { recursive: true, force: true });
  }
});

test('target validation rejects non-canonical docs targets and realpath escapes', async () => {
  const fixture = await makeFixture();
  const sandboxCwd = await mkdtemp(path.join(os.tmpdir(), 'wiki-core-autofix-cwd-'));
  const outsideBefore = await readFile(fixture.outsidePath, 'utf8');
  const canonicalState = await loadCanonicalState(fixture.repoRoot);
  const docsByPath = new Map(canonicalState.docs.map((doc) => [doc.relativePath, doc]));
  const docsRootReal = await realpath(path.join(fixture.repoRoot, 'docs'));
  docsByPath.set('docs/escape.md', { relativePath: 'docs/escape.md' });

  try {
    await withWorkingDirectory(sandboxCwd, async () => {
      const canonical = await validateDocsTarget(
        fixture.repoRoot,
        docsRootReal,
        docsByPath,
        'docs/guide.md',
      );
      assert.equal(canonical.ok, true);

      const nonCanonical = await validateDocsTarget(
        fixture.repoRoot,
        docsRootReal,
        docsByPath,
        'docs/private/skip.md',
      );
      assert.equal(nonCanonical.ok, false);
      assert.equal(nonCanonical.reason, 'non_canonical_docs_target');

      const escapeTarget = await validateDocsTarget(
        fixture.repoRoot,
        docsRootReal,
        docsByPath,
        'docs/escape.md',
      );
      assert.equal(escapeTarget.ok, false);
      assert.equal(escapeTarget.reason, 'symlink_escape');
    });

    const outsideAfter = await readFile(fixture.outsidePath, 'utf8');
    assert.equal(outsideAfter, outsideBefore);
  } finally {
    await rm(fixture.repoRoot, { recursive: true, force: true });
    await rm(sandboxCwd, { recursive: true, force: true });
  }
});
