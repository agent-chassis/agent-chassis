import { promises as defaultFs } from 'node:fs';
import path from 'node:path';

const GENERATED_VIEW_RELATIVE_PATHS = new Set([
  'wiki/catalog.md',
  'wiki/now.md',
  'wiki/inbox.md',
  'wiki/backlog.md',
  'wiki/archive.md',
]);

class ApplyFromScratchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ApplyFromScratchError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ApplyFromScratchError(code, message, details);
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid_request', `${label} must be an object`, { field: label });
  }

  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('invalid_request', `${label} must be a non-empty string`, { field: label });
  }

  return value;
}

function toAbsolutePath(value, label) {
  const raw = requireNonEmptyString(value, label);

  if (!path.isAbsolute(raw)) {
    fail('invalid_path', `${label} must be an absolute path`, { field: label, path: raw });
  }

  return path.resolve(raw);
}

function normalizeAbsolutePathList(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    fail('invalid_request', `${label} must be a non-empty array`, { field: label });
  }

  return values.map((value, index) => toAbsolutePath(value, `${label}[${index}]`));
}

function isInsideOrEqual(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function relativeRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

function isGeneratedViewTarget(repoRoot, targetPath) {
  const repoRelative = relativeRepoPath(repoRoot, targetPath);
  return repoRelative.startsWith('wiki/generated/') || GENERATED_VIEW_RELATIVE_PATHS.has(repoRelative);
}

async function canonicalExistingDirectory(fs, absolutePath, label) {
  let stats;

  try {
    stats = await fs.stat(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail('missing_required_path', `${label} does not exist`, { field: label, path: absolutePath });
    }

    throw error;
  }

  if (!stats.isDirectory()) {
    fail('invalid_directory', `${label} must be a directory`, { field: label, path: absolutePath });
  }

  const realPath = await fs.realpath(absolutePath);
  if (realPath !== absolutePath) {
    fail('path_symlink_escape', `${label} must be canonical`, {
      field: label,
      path: absolutePath,
      realPath,
    });
  }

  return realPath;
}

async function canonicalExistingRegularFile(fs, absolutePath, label, missingCode) {
  let stats;

  try {
    stats = await fs.stat(absolutePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail(missingCode, `${label} does not exist`, { field: label, path: absolutePath });
    }

    throw error;
  }

  if (!stats.isFile()) {
    fail('invalid_file', `${label} must be a regular file`, { field: label, path: absolutePath });
  }

  const realPath = await fs.realpath(absolutePath);
  if (realPath !== absolutePath) {
    fail('path_symlink_escape', `${label} must be canonical`, {
      field: label,
      path: absolutePath,
      realPath,
    });
  }

  return realPath;
}

function validateAuthority(authority) {
  const value = requireObject(authority, 'authority');
  const repoRoot = toAbsolutePath(value.repoRoot, 'authority.repoRoot');
  const scratchRoot = toAbsolutePath(value.scratchRoot, 'authority.scratchRoot');
  const allowedTargetPaths = normalizeAbsolutePathList(
    value.allowedTargetPaths,
    'authority.allowedTargetPaths',
  );
  const forbiddenSourceRoots = normalizeAbsolutePathList(
    value.forbiddenSourceRoots,
    'authority.forbiddenSourceRoots',
  );

  if (!forbiddenSourceRoots.includes(repoRoot)) {
    fail('invalid_authority', 'authority.forbiddenSourceRoots must include authority.repoRoot', {
      field: 'authority.forbiddenSourceRoots',
      repoRoot,
    });
  }

  return {
    repoRoot,
    scratchRoot,
    allowedTargetPaths: new Set(allowedTargetPaths),
    forbiddenSourceRoots,
  };
}

function validateRequest(request) {
  const value = requireObject(request, 'request');
  const scratchPath = toAbsolutePath(value.scratchPath, 'request.scratchPath');
  const targetPath = toAbsolutePath(value.targetPath, 'request.targetPath');

  return {
    scratchPath,
    targetPath,
  };
}

function denyGeneratedView(repoRoot, targetPath) {
  if (isGeneratedViewTarget(repoRoot, targetPath)) {
    fail('generated_view_target', 'generated-view destinations are not allowed', {
      path: targetPath,
    });
  }
}

function denyOutsideRepo(repoRoot, targetPath, label) {
  if (!isInsideOrEqual(targetPath, repoRoot)) {
    fail('path_outside_repo', `${label} must be inside the repository`, {
      field: label,
      path: targetPath,
      repoRoot,
    });
  }
}

function denyOutsideLauncherScratchRoot(scratchRoot, scratchPath) {
  if (!isInsideOrEqual(scratchPath, scratchRoot)) {
    fail('scratch_outside_root', 'scratch path must stay under the launcher-owned scratch root', {
      path: scratchPath,
      scratchRoot,
    });
  }
}

function denyInsideRepo(repoRoot, absolutePath, label) {
  if (isInsideOrEqual(absolutePath, repoRoot)) {
    fail('scratch_inside_repo', `${label} must stay outside the repository`, {
      field: label,
      path: absolutePath,
      repoRoot,
    });
  }
}

function denyForbiddenRoots(forbiddenSourceRoots, absolutePath, label) {
  for (const forbiddenRoot of forbiddenSourceRoots) {
    if (isInsideOrEqual(absolutePath, forbiddenRoot)) {
      fail('scratch_in_forbidden_root', `${label} must stay outside the forbidden source roots`, {
        field: label,
        path: absolutePath,
        forbiddenRoot,
      });
    }
  }
}

async function validateTarget(fs, authority, targetPath) {
  denyGeneratedView(authority.repoRoot, targetPath);
  denyOutsideRepo(authority.repoRoot, targetPath, 'request.targetPath');

  if (!authority.allowedTargetPaths.has(targetPath)) {
    fail('target_not_allowed', 'target is not in the launcher-owned exact allowlist', {
      path: targetPath,
    });
  }

  const canonicalTargetPath = await canonicalExistingRegularFile(
    fs,
    targetPath,
    'request.targetPath',
    'target_missing',
  );

  if (canonicalTargetPath !== targetPath) {
    fail('target_symlink_escape', 'target must be an exact canonical path', {
      path: targetPath,
      realPath: canonicalTargetPath,
    });
  }

  let handle;
  try {
    handle = await fs.open(targetPath, 'r+');
  } catch (error) {
    fail('target_unwritable', 'target exists but is not writable in the worker namespace', {
      path: targetPath,
      code: error?.code ?? 'unknown',
    });
  } finally {
    if (handle) {
      await handle.close();
    }
  }

  return canonicalTargetPath;
}

async function validateScratch(fs, authority, scratchPath) {
  const canonicalScratchRoot = await canonicalExistingDirectory(
    fs,
    authority.scratchRoot,
    'authority.scratchRoot',
  );

  denyOutsideLauncherScratchRoot(canonicalScratchRoot, scratchPath);
  denyForbiddenRoots(authority.forbiddenSourceRoots, canonicalScratchRoot, 'authority.scratchRoot');
  denyForbiddenRoots(authority.forbiddenSourceRoots, scratchPath, 'request.scratchPath');
  denyInsideRepo(authority.repoRoot, canonicalScratchRoot, 'authority.scratchRoot');
  denyInsideRepo(authority.repoRoot, scratchPath, 'request.scratchPath');

  const canonicalScratchPath = await canonicalExistingRegularFile(
    fs,
    scratchPath,
    'request.scratchPath',
    'scratch_missing',
  );

  if (canonicalScratchPath !== scratchPath) {
    fail('scratch_symlink_escape', 'scratch source must be an exact canonical path', {
      path: scratchPath,
      realPath: canonicalScratchPath,
    });
  }

  denyForbiddenRoots(authority.forbiddenSourceRoots, canonicalScratchPath, 'request.scratchPath');

  return {
    canonicalScratchRoot,
    canonicalScratchPath,
  };
}

export async function planApplyFromScratch(options = {}) {
  const fs = options.fs ?? defaultFs;
  const authority = validateAuthority(options.authority);
  const request = validateRequest(options.request);

  const scratch = await validateScratch(fs, authority, request.scratchPath);
  const targetPath = await validateTarget(fs, authority, request.targetPath);

  return {
    repoRoot: authority.repoRoot,
    scratchRoot: scratch.canonicalScratchRoot,
    scratchPath: scratch.canonicalScratchPath,
    targetPath,
  };
}

export async function applyFromScratch(options = {}) {
  const fs = options.fs ?? defaultFs;
  const plan = await planApplyFromScratch({ ...options, fs });
  const scratchContent = await fs.readFile(plan.scratchPath);
  const targetHandle = await fs.open(plan.targetPath, 'r+');

  try {
    await targetHandle.truncate(0);
    await targetHandle.writeFile(scratchContent);
  } finally {
    await targetHandle.close();
  }

  return {
    targetPath: plan.targetPath,
    scratchPath: plan.scratchPath,
    bytesWritten: scratchContent.length,
  };
}

export { ApplyFromScratchError };

export default {
  ApplyFromScratchError,
  applyFromScratch,
  planApplyFromScratch,
};
