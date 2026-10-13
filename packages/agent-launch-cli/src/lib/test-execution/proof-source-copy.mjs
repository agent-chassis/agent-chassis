

import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { collectRepositorySourceEntries } from "../repository-source-snapshot.mjs";
import { resolveRepositoryGitMetadataProjection } from "../launch-isolation-findings-git-metadata.mjs";
import { SNAPSHOT_EXCLUDED_NAMES } from "../workspace-agent-test-proof-runtime-identity.mjs";
import { verifiedNpmDependencyMappings } from "./dependency-projection.mjs";
import { copySelectedSource, proofCopyFailure } from "./source-copy.mjs";

const SOURCE_EXCLUSIONS = Object.freeze([...SNAPSHOT_EXCLUDED_NAMES]);
const GIT_INCLUSIVE_EXCLUSIONS = Object.freeze(SOURCE_EXCLUSIONS.filter((name) => name !== ".git"));

function collectStrict(root, options) {
  try {
    return collectRepositorySourceEntries(root, options);
  } catch (error) {
    const failedPath = typeof error?.path === "string" ? error.path : error?.detail?.path;
    const source = typeof failedPath === "string"
      ? (path.isAbsolute(failedPath) ? failedPath : path.join(root, failedPath)) : root;
    throw proofCopyFailure(error?.code === "ENOENT" || error?.code === "ENOTDIR"
      ? "proof_source_entry_missing" : "proof_source_entry_unreadable", source, error);
  }
}

function sameInventory(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function supportEntries(sourcePath) {
  let stat;
  try {
    stat = lstatSync(sourcePath);
  } catch (error) {
    throw proofCopyFailure(error?.code === "ENOENT" || error?.code === "ENOTDIR"
      ? "proof_source_entry_missing" : "proof_source_entry_unreadable", sourcePath, error);
  }
  const basename = path.basename(sourcePath);
  if (stat.isDirectory()) {
    return [{ path: basename, kind: "directory", mode: stat.mode & 0o777 },
      ...collectStrict(sourcePath, {}).map((entry) => ({ ...entry, path: `${basename}/${entry.path}` }))];
  }
  if (!stat.isFile()) throw proofCopyFailure("proof_source_entry_unsupported", sourcePath);
  let digest;
  try {
    digest = `sha256:${createHash("sha256").update(readFileSync(sourcePath)).digest("hex")}`;
  } catch (error) {
    throw proofCopyFailure("proof_source_entry_unreadable", sourcePath, error);
  }
  return [{ path: basename, kind: "file", mode: stat.mode & 0o777, digest }];
}

function inside(candidate, parent) {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function projectDestination(plan, destinationRoot) {
  return plan.gitTopology.kind === "pointer"
    ? path.join(destinationRoot, path.relative(path.parse(plan.sourceRoot).root, plan.sourceRoot))
    : destinationRoot;
}

function gitEntries(root, kind, mappedDependencies = null) {
  return collectStrict(root, { excludedTopLevelNames: [...GIT_INCLUSIVE_EXCLUSIONS], mappedDependencies })
    .filter(({ path: relative }) => relative === ".git" ||
      (kind === "directory" && relative.startsWith(".git/")));
}

function sourceWalk(plan) {
  return { excludedTopLevelNames: [...SOURCE_EXCLUSIONS], mappedDependencies: plan.mappedDependencies };
}

export function planProofSourceCopy(sourceRoot, { repositoryRoot = null } = {}) {
  const root = path.resolve(sourceRoot);
  const mappedDependencies = repositoryRoot === null ? null
    : verifiedNpmDependencyMappings({ repositoryRoot, checkoutRoot: root });
  const entries = collectStrict(root, { excludedTopLevelNames: [...SOURCE_EXCLUSIONS], mappedDependencies });
  let gitEntry;
  try {
    gitEntry = lstatSync(path.join(root, ".git"));
  } catch (error) {
    throw proofCopyFailure(error?.code === "ENOENT" || error?.code === "ENOTDIR"
      ? "proof_source_entry_missing" : "proof_source_entry_unreadable", path.join(root, ".git"), error);
  }
  const gitTopology = gitEntry.isDirectory()
    ? Object.freeze({ kind: "directory",
      entries: Object.freeze(gitEntries(root, "directory", mappedDependencies)) })
    : pointerTopology(root, gitEntries(root, "pointer", mappedDependencies));
  return Object.freeze({ sourceRoot: root, entries: Object.freeze(entries), gitTopology, mappedDependencies });
}

function pointerTopology(root, entries) {
  let metadata;
  try {
    metadata = resolveRepositoryGitMetadataProjection({ repoReal: root });
  } catch (error) {
    const failedPath = error?.detail?.path ?? path.join(root, ".git");
    throw proofCopyFailure("proof_source_entry_unreadable", failedPath, error);
  }
  if (metadata === null) throw proofCopyFailure("proof_source_entry_missing", path.join(root, ".git"));
  const supportPaths = metadata.readOnlyBinds.map(({ src }) => src)
    .filter((sourcePath) => sourcePath !== metadata.gitPointerFile && !inside(sourcePath, root))
    .sort((left, right) => left.length - right.length);
  const populations = [];
  for (const sourcePath of supportPaths) {
    if (inside(root, sourcePath)) throw proofCopyFailure("proof_source_entry_unsupported", sourcePath);
    if (populations.some(({ sourcePath: included }) => inside(sourcePath, included))) continue;
    populations.push(Object.freeze({ sourcePath, entries: Object.freeze(supportEntries(sourcePath)) }));
  }
  return Object.freeze({ kind: "pointer", metadata, entries: Object.freeze(entries),
    populations: Object.freeze(populations),
    requiredDirectories: Object.freeze([metadata.worktreeGitDir,
      metadata.commonGitDir, ...metadata.objectDirectories].map((sourcePath) => Object.freeze({ sourcePath,
      relativeFromProject: path.relative(root, sourcePath).split(path.sep).join("/") }))) });
}

export function copyProofSource({ plan, destinationRoot }) {
  const current = collectStrict(plan.sourceRoot, sourceWalk(plan));
  if (!sameInventory(plan.entries, current)) throw proofCopyFailure(
    "proof_source_entry_changed", plan.sourceRoot);
  if (!sameInventory(plan.gitTopology.entries,
    gitEntries(plan.sourceRoot, plan.gitTopology.kind, plan.mappedDependencies))) {
    throw proofCopyFailure("proof_source_entry_changed", path.join(plan.sourceRoot, ".git"));
  }
  const ownedRoot = path.resolve(destinationRoot);
  const projectRoot = projectDestination(plan, ownedRoot);
  copySelectedSource({ from: plan.sourceRoot, to: projectRoot,
    entries: [...plan.entries, ...plan.gitTopology.entries], strict: true });
  if (plan.gitTopology.kind === "pointer") {
    for (const directory of plan.gitTopology.metadata?.namespaceDirectories ?? []) {
      const target = path.join(ownedRoot, path.relative(path.parse(directory).root, directory));
      try {
        mkdirSync(target, { recursive: true });
      } catch (error) {
        throw proofCopyFailure("proof_source_entry_copy_failed", target, error);
      }
    }
    for (const { sourcePath, entries } of plan.gitTopology.populations) {
      const parent = path.dirname(sourcePath);
      const targetParent = path.join(ownedRoot, path.relative(path.parse(parent).root, parent));
      if (!sameInventory(entries, supportEntries(sourcePath))) {
        throw proofCopyFailure("proof_source_entry_changed", sourcePath);
      }
      copySelectedSource({ from: parent, to: targetParent, entries, strict: true });
    }
  }
  const sourceAfterCopy = collectStrict(plan.sourceRoot, sourceWalk(plan));
  const copied = collectStrict(projectRoot, { excludedTopLevelNames: [...SOURCE_EXCLUSIONS] });
  if (!sameInventory(plan.entries, sourceAfterCopy)) throw proofCopyFailure(
    "proof_source_entry_changed", plan.sourceRoot);
  if (!sameInventory(plan.gitTopology.entries,
    gitEntries(plan.sourceRoot, plan.gitTopology.kind, plan.mappedDependencies))) {
    throw proofCopyFailure("proof_source_entry_changed", path.join(plan.sourceRoot, ".git"));
  }
  if (!sameInventory(current, copied)) throw proofCopyFailure("proof_source_copy_parity_failed", projectRoot);
  if (!sameInventory(plan.gitTopology.entries, gitEntries(projectRoot, plan.gitTopology.kind))) {
    throw proofCopyFailure("proof_source_copy_parity_failed", path.join(projectRoot, ".git"));
  }
  if (plan.gitTopology.kind === "pointer") {
    for (const { sourcePath, entries } of plan.gitTopology.populations) {
      const target = path.join(ownedRoot, path.relative(path.parse(sourcePath).root, sourcePath));
      if (!sameInventory(entries, supportEntries(sourcePath))) {
        throw proofCopyFailure("proof_source_entry_changed", sourcePath);
      }
      const copiedSupport = supportEntries(target);
      if (!sameInventory(entries, copiedSupport)) {
        throw proofCopyFailure("proof_source_copy_parity_failed", target);
      }
    }
  }
  return Object.freeze({ sourceRoot: plan.sourceRoot, destinationRoot: projectRoot,
    gitTopology: plan.gitTopology });
}
