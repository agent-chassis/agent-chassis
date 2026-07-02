import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCanonicalState } from '../lib/wiki.mjs';
import * as lintModule from './lint.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(MODULE_DIR, '../../../..');
const DOCS_DIR_NAME = 'docs';
const BACKLINK_LINE_RE = /^<!--\s*wiki:\s*id=([^\s]+)\s+relation=([^\s]+)\s*-->$/;

function coerceList(value) {
  if (value == null) {
    return [];
  }

  return Array.isArray(value) ? value.filter((entry) => entry != null) : [value];
}

function detectNewline(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function normalizePathForMatching(targetPath) {
  if (typeof targetPath !== 'string') {
    return null;
  }

  const trimmed = targetPath.trim().replace(/\\/g, '/');
  if (!trimmed) {
    return null;
  }

  if (path.posix.isAbsolute(trimmed) || path.isAbsolute(trimmed)) {
    return null;
  }

  const segments = trimmed.split('/');
  if (segments.includes('..')) {
    return null;
  }

  const normalized = path.posix.normalize(trimmed);
  if (
    normalized === '.' ||
    normalized === '' ||
    normalized.startsWith('../') ||
    normalized === '..' ||
    normalized.includes('/../')
  ) {
    return null;
  }

  if (!normalized.startsWith(`${DOCS_DIR_NAME}/`)) {
    return null;
  }

  return normalized;
}

function extractFrontmatterPrefix(content, newline) {
  if (!content.startsWith(`---${newline}`)) {
    return { prefix: '', body: content };
  }

  const lines = content.split(newline);
  if (lines.length < 3) {
    return { prefix: '', body: content };
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      const prefix = lines.slice(0, index + 1).join(newline) + newline;
      const body = lines.slice(index + 1).join(newline);
      return { prefix, body };
    }
  }

  return { prefix: '', body: content };
}

function isWikiBacklinkLine(line) {
  return BACKLINK_LINE_RE.test(line.trim());
}

function parseBacklinkLine(line) {
  const match = line.trim().match(BACKLINK_LINE_RE);
  if (!match) {
    return null;
  }

  return {
    id: match[1],
    relation: match[2],
  };
}

function hasMatchingBacklink(content, backlinkId, relation, backlinkComment) {
  if (content.includes(backlinkComment)) {
    return true;
  }

  const lines = content.split(/\r?\n/);
  return lines.some((line) => {
    const parsed = parseBacklinkLine(line);
    return parsed != null && parsed.id === backlinkId && parsed.relation === relation;
  });
}

function buildUpdatedContent(content, backlinkComment) {
  const newline = detectNewline(content);
  const { prefix, body } = extractFrontmatterPrefix(content, newline);
  const bodyLines = body === '' ? [] : body.split(newline);

  if (hasMatchingBacklink(body, parseBacklinkLine(backlinkComment)?.id ?? '', parseBacklinkLine(backlinkComment)?.relation ?? '', backlinkComment)) {
    return { changed: false, content };
  }

  const bodyStartIndex = bodyLines.findIndex((line) => line.trim() !== '' && !isWikiBacklinkLine(line));
  const insertionIndex = bodyStartIndex === -1 ? bodyLines.length : bodyStartIndex;

  const leadingLines = bodyLines.slice(0, insertionIndex).filter((line) => line.trim() !== '');
  const trailingLines = bodyLines.slice(insertionIndex);

  const prefixLines = prefix ? prefix.replace(/\r?\n$/, '').split(newline) : [];
  const nextLines = [
    ...prefixLines,
    ...(leadingLines.length > 0 ? leadingLines : []),
    backlinkComment,
    '',
    ...trailingLines,
  ];

  while (nextLines.length > 0 && nextLines[0] === '') {
    nextLines.shift();
  }

  return {
    changed: true,
    content: nextLines.join(newline).replace(new RegExp(`${newline}$`), '') + newline,
  };
}

function extractFreshFindings(lintResult) {
  if (Array.isArray(lintResult)) {
    return lintResult;
  }

  if (lintResult && Array.isArray(lintResult.findings)) {
    return lintResult.findings;
  }

  if (lintResult && Array.isArray(lintResult.results)) {
    return lintResult.results;
  }

  if (lintResult && Array.isArray(lintResult.items)) {
    return lintResult.items;
  }

  return [];
}

function normalizeFilterTokens(value, mapper = (entry) => entry) {
  return new Set(coerceList(value).map((entry) => mapper(entry)).filter((entry) => entry != null && entry !== ''));
}

function buildCallerFilters(options) {
  const pathFilters = normalizeFilterTokens(options.paths, (entry) => normalizePathForMatching(entry));
  const idFilters = normalizeFilterTokens(options.ids);
  const commentFilters = normalizeFilterTokens(options.comments);
  const findingFilters = coerceList(options.findings);

  for (const finding of findingFilters) {
    if (typeof finding === 'string') {
      const normalizedPath = normalizePathForMatching(finding);
      if (normalizedPath) {
        pathFilters.add(normalizedPath);
      } else {
        idFilters.add(finding);
      }
      continue;
    }

    if (finding && typeof finding === 'object') {
      const normalizedPath = normalizePathForMatching(finding.path ?? finding.relativePath);
      if (normalizedPath) {
        pathFilters.add(normalizedPath);
      }

      if (finding.backlink_id != null) {
        idFilters.add(String(finding.backlink_id));
      }

      if (finding.backlink_comment != null) {
        commentFilters.add(String(finding.backlink_comment));
      }
    }
  }

  return {
    pathFilters,
    idFilters,
    commentFilters,
  };
}

function matchesCallerFilters(finding, filters) {
  if (filters.pathFilters.size > 0) {
    const normalizedPath = normalizePathForMatching(finding.path ?? finding.relativePath);
    if (!normalizedPath || !filters.pathFilters.has(normalizedPath)) {
      return false;
    }
  }

  if (filters.idFilters.size > 0) {
    const backlinkId = finding.backlink_id == null ? null : String(finding.backlink_id);
    if (!backlinkId || !filters.idFilters.has(backlinkId)) {
      return false;
    }
  }

  if (filters.commentFilters.size > 0) {
    const backlinkComment = finding.backlink_comment == null ? null : String(finding.backlink_comment);
    if (!backlinkComment || !filters.commentFilters.has(backlinkComment)) {
      return false;
    }
  }

  return true;
}

function resolveLintRepo() {
  const lintRepo = lintModule.lintRepo ?? lintModule.default ?? lintModule.run;
  if (typeof lintRepo !== 'function') {
    throw new TypeError('lint.mjs does not export a callable lintRepo function.');
  }

  return lintRepo;
}

async function readDocsRootRealpath(repoRoot) {
  const docsRoot = path.join(repoRoot, DOCS_DIR_NAME);
  const real = await fs.realpath(docsRoot);
  return { docsRoot, docsRootReal: real };
}

export async function validateDocsTarget(repoRoot, docsRootReal, docsByPath, rawTargetPath) {
  const normalized = normalizePathForMatching(rawTargetPath);
  if (!normalized) {
    return { ok: false, reason: 'invalid_target_path' };
  }

  if (!(docsByPath instanceof Map) || !docsByPath.has(normalized)) {
    return {
      ok: false,
      reason: 'non_canonical_docs_target',
      normalized,
    };
  }

  const absolutePath = path.resolve(repoRoot, normalized);
  let targetRealpath;

  try {
    targetRealpath = await fs.realpath(absolutePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { ok: false, reason: 'missing_target_file', normalized, absolutePath };
    }

    return {
      ok: false,
      reason: 'unreadable_target_file',
      normalized,
      absolutePath,
      error,
    };
  }

  if (
    targetRealpath !== docsRootReal &&
    !targetRealpath.startsWith(`${docsRootReal}${path.sep}`)
  ) {
    return {
      ok: false,
      reason: 'symlink_escape',
      normalized,
      absolutePath,
      targetRealpath,
    };
  }

  return {
    ok: true,
    normalized,
    absolutePath,
    targetRealpath,
  };
}

async function applyBacklinkComment({
  repoRoot,
  docsRootReal,
  docsByPath,
  finding,
  backlinkComment,
}) {
  const validation = await validateDocsTarget(
    repoRoot,
    docsRootReal,
    docsByPath,
    finding.path ?? finding.relativePath,
  );
  if (!validation.ok) {
    return {
      status: 'skipped',
      reason: validation.reason,
      finding,
      validation,
    };
  }

  const current = await fs.readFile(validation.absolutePath, 'utf8');
  const backlinkId = finding.backlink_id == null ? null : String(finding.backlink_id);
  const relation = finding.relation == null ? null : String(finding.relation);
  if (backlinkId == null || relation == null) {
    return {
      status: 'skipped',
      reason: 'missing_structured_fields',
      finding,
      validation,
    };
  }

  if (hasMatchingBacklink(current, backlinkId, relation, backlinkComment)) {
    return {
      status: 'skipped',
      reason: 'already_present',
      finding,
      validation,
    };
  }

  const proposed = buildUpdatedContent(current, backlinkComment);
  if (!proposed.changed) {
    return {
      status: 'skipped',
      reason: 'no_change_required',
      finding,
      validation,
    };
  }

  const beforeWrite = await fs.readFile(validation.absolutePath, 'utf8');
  if (hasMatchingBacklink(beforeWrite, backlinkId, relation, backlinkComment)) {
    return {
      status: 'skipped',
      reason: 'concurrent_update_already_applied',
      finding,
      validation,
    };
  }

  const latest = buildUpdatedContent(beforeWrite, backlinkComment);
  if (!latest.changed) {
    return {
      status: 'skipped',
      reason: 'concurrent_update_no_longer_needed',
      finding,
      validation,
    };
  }

  await fs.writeFile(validation.absolutePath, latest.content, 'utf8');

  return {
    status: 'fixed',
    reason: null,
    finding,
    validation,
  };
}

export async function autofixDocsBacklinks(options = {}) {
  const repoRoot = path.resolve(options.dir ?? options.repoRoot ?? options.root ?? DEFAULT_REPO_ROOT);
  const lintRepo = resolveLintRepo();
  const lintResult = await lintRepo({
    dir: repoRoot,
    includeAllFindings: true,
  });
  const freshFindings = extractFreshFindings(lintResult);
  const callerFilters = buildCallerFilters(options);
  const canonicalState = await loadCanonicalState(repoRoot);
  const docsByPath = new Map(canonicalState.docs.map((doc) => [doc.relativePath, doc]));

  const relevantFindings = freshFindings.filter((finding) => {
    if (!finding || typeof finding !== 'object') {
      return false;
    }

    if (finding.code !== 'missing_docs_backlink') {
      return false;
    }

    if (String(finding.relation ?? '') !== 'tracks') {
      return false;
    }

    const backlinkComment = finding.backlink_comment == null ? '' : String(finding.backlink_comment);
    if (!backlinkComment) {
      return false;
    }

    return matchesCallerFilters(finding, callerFilters);
  });

  const result = {
    foundCount: relevantFindings.length,
    fixedCount: 0,
    skippedCount: 0,
    found: relevantFindings.length,
    fixed: 0,
    skipped: 0,
    counts: {
      found: relevantFindings.length,
      fixed: 0,
      skipped: 0,
    },
    skipReasons: Object.create(null),
    actions: [],
  };

  if (relevantFindings.length === 0) {
    return result;
  }

  const { docsRootReal } = await readDocsRootRealpath(repoRoot);

  for (const finding of relevantFindings) {
    const backlinkComment = String(finding.backlink_comment);
    const action = await applyBacklinkComment({
      repoRoot,
      docsRootReal,
      docsByPath,
      finding,
      backlinkComment,
    });

    result.actions.push({
      path: finding.path ?? finding.relativePath ?? null,
      backlink_id: finding.backlink_id ?? null,
      relation: finding.relation ?? null,
      status: action.status,
      reason: action.reason,
    });

    if (action.status === 'fixed') {
      result.fixedCount += 1;
      result.counts.fixed += 1;
      result.fixed += 1;
      continue;
    }

    result.skippedCount += 1;
    result.counts.skipped += 1;
    result.skipped += 1;
    const reason = action.reason ?? 'unknown_skip';
    result.skipReasons[reason] = (result.skipReasons[reason] ?? 0) + 1;
  }

  return result;
}

export default autofixDocsBacklinks;
