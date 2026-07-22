import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadCanonicalState, resolveContractContext } from "./wiki.mjs";
import {
  SIDECAR_ARTIFACT_SCHEMA_FIELD,
  SIDECAR_ARTIFACT_SCHEMA_VERSION,
  createSidecarResultEnvelope
} from "./sidecar-schema.mjs";
import {
  filterSidecarSourcePaths,
  validateVirtualSidecarPath,
  SidecarPathValidationError
} from "./sidecar-paths.mjs";
import { joinSidecarPathsToCanonicalRecords } from "./sidecar-joins.mjs";
import {
  discoverSidecarGitState,
  getSidecarIndexStatus,
  runSidecarGit
} from "./sidecar-status.mjs";
import { countUtf8Lines } from "./work-record-admission-shared.mjs";
import { REPO_LOC_INVENTORY_DEFAULT_THRESHOLD } from "./repo-loc-inventory.mjs";
import { readSidecarArtifactBytes } from "./sidecar-artifact-bytes.mjs";

export const LARGE_FILE_CONTEXT_LOC_THRESHOLD = REPO_LOC_INVENTORY_DEFAULT_THRESHOLD;

const LARGE_FILE_CONTEXT_TOP_HINT_LIMIT = 5;

const COMPACT_CONTEXT_TOP_HINT_LIMIT = 5;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function asStringList(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string" && entry.trim()).map(String);
  }
  if (typeof value === "string" && value.trim()) {
    return [value];
  }
  return [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

function provenance({ sourceKind = "code_index", evidenceBasis = "unknown" } = {}) {
  return {
    source_kind: sourceKind,
    canonicality: "derived",
    evidence_basis: evidenceBasis
  };
}

function validateImpactPath(inputPath) {
  try {
    const { relativePath } = validateVirtualSidecarPath(inputPath);
    return {
      ok: true,
      input_path: inputPath,
      relative_path: relativePath,
      hint: {
        kind: "sidecar_path_validation",
        input_path: inputPath,
        relative_path: relativePath,
        valid: true,
        provenance: provenance({ evidenceBasis: "path_match" })
      }
    };
  } catch (error) {
    if (!(error instanceof SidecarPathValidationError)) {
      throw error;
    }

    return {
      ok: false,
      input_path: inputPath,
      relative_path: error.relativePath ?? null,
      hint: {
        kind: "sidecar_path_validation",
        input_path: String(inputPath),
        relative_path: error.relativePath ?? null,
        valid: false,
        code: error.code,
        pattern: error.pattern ?? null,
        reason: error.reason ?? error.message,
        message: error.message,
        provenance: provenance({ evidenceBasis: error.pattern ? "path_match" : "unknown" })
      }
    };
  }
}

function pageKindForPath(relativePath) {
  if (relativePath.startsWith("docs/")) {
    return "docs";
  }
  if (relativePath.startsWith("wiki/issues/")) {
    return "issues";
  }
  if (relativePath.startsWith("wiki/initiatives/")) {
    return "initiatives";
  }
  if (relativePath.startsWith("wiki/decisions/")) {
    return "decisions";
  }
  if (relativePath.startsWith("wiki/sources/")) {
    return "sources";
  }
  if (relativePath.startsWith("wiki/areas/")) {
    return "areas";
  }
  if (relativePath.startsWith("wiki/")) {
    return "wiki";
  }
  return "unknown";
}

async function loadCanonicalRecords(targetDir, { profile, extensionNamespaces } = {}) {
  const context = await resolveContractContext(targetDir, {
    profile,
    extensionNamespaces
  });
  const state = await loadCanonicalState(targetDir, {
    extensionNamespaces: context.extensionNamespaces
  });
  const pages = [
    ...state.docs,
    ...state.decisions,
    ...state.areas,
    ...state.issues,
    ...state.initiatives,
    ...state.sources,
    ...state.wikiPages,
    ...state.extensionPages
  ];

  return pages.map((page) => ({
    ...page,
    id: page.frontmatter?.id ?? null,
    pageKind: pageKindForPath(page.relativePath)
  }));
}

function artifactIsCompatible(artifact) {
  return (
    artifact &&
    typeof artifact === "object" &&
    !Array.isArray(artifact) &&
    artifact.cache_metadata?.[SIDECAR_ARTIFACT_SCHEMA_FIELD] === SIDECAR_ARTIFACT_SCHEMA_VERSION &&
    artifact.sources &&
    typeof artifact.sources === "object" &&
    !Array.isArray(artifact.sources)
  );
}

async function readCompatibleArtifact({ repoRoot, status }) {
  if (!status.artifact_exists || status.staleness === "missing") {
    return {
      artifact: null,
      evidence: {
        kind: "sidecar_index_artifact",
        artifact_path: status.artifact_path,
        artifact_available_for_query: false,
        reason: "artifact_missing",
        provenance: provenance({ evidenceBasis: status.index_tree ? "git_tree" : "unknown" })
      }
    };
  }

  if (status.staleness === "rebuild_required") {
    return {
      artifact: null,
      evidence: {
        kind: "sidecar_index_artifact",
        artifact_path: status.artifact_path,
        artifact_available_for_query: false,
        reason: "artifact_schema_incompatible",
        artifact_schema_version: status.artifact_schema_version,
        expected_artifact_schema_version: SIDECAR_ARTIFACT_SCHEMA_VERSION,
        provenance: provenance({ evidenceBasis: status.index_tree ? "git_tree" : "unknown" })
      }
    };
  }

  try {
    const { artifact } = await readSidecarArtifactBytes(
      path.join(repoRoot, status.artifact_path)
    );
    if (!artifactIsCompatible(artifact)) {
      return {
        artifact: null,
        evidence: {
          kind: "sidecar_index_artifact",
          artifact_path: status.artifact_path,
          artifact_available_for_query: false,
          reason: "artifact_format_unusable",
          artifact_schema_version:
            artifact?.cache_metadata?.[SIDECAR_ARTIFACT_SCHEMA_FIELD] ?? null,
          expected_artifact_schema_version: SIDECAR_ARTIFACT_SCHEMA_VERSION,
          provenance: provenance({ evidenceBasis: "unknown" })
        }
      };
    }
    return {
      artifact,
      evidence: {
        kind: "sidecar_index_artifact",
        artifact_path: status.artifact_path,
        artifact_available_for_query: true,
        artifact_schema_version: artifact.cache_metadata[SIDECAR_ARTIFACT_SCHEMA_FIELD],
        source_count: artifact.cache_metadata.source_count ?? null,
        provenance: provenance({ evidenceBasis: "git_tree" })
      }
    };
  } catch (error) {
    return {
      artifact: null,
      evidence: {
        kind: "sidecar_index_artifact",
        artifact_path: status.artifact_path,
        artifact_available_for_query: false,
        reason: "artifact_unreadable",
        read_error: error instanceof Error ? error.message : String(error),
        provenance: provenance({ evidenceBasis: "unknown" })
      }
    };
  }
}

function sourceEntriesFromArtifact(artifact) {
  if (!artifactIsCompatible(artifact)) {
    return [];
  }

  const filesByPath = new Map((artifact.sources.files || []).map((entry) => [entry.path, entry]));
  const symlinksByPath = new Map((artifact.sources.symlinks || []).map((entry) => [entry.path, entry]));
  const gitlinksByPath = new Map((artifact.sources.gitlinks || []).map((entry) => [entry.path, entry]));
  return [
    ...asStringList(artifact.sources.files?.map?.((entry) => entry.path)).map((pathValue) => ({
      kind: "file",
      path: pathValue,
      entry: filesByPath.get(pathValue)
    })),
    ...asStringList(artifact.sources.symlinks?.map?.((entry) => entry.path)).map((pathValue) => ({
      kind: "symlink",
      path: pathValue,
      entry: symlinksByPath.get(pathValue)
    })),
    ...asStringList(artifact.sources.gitlinks?.map?.((entry) => entry.path)).map((pathValue) => ({
      kind: "gitlink",
      path: pathValue,
      entry: gitlinksByPath.get(pathValue)
    }))
  ];
}

function filterArtifactSourceEntries(entries) {
  const sourceFilter = filterSidecarSourcePaths(entries.map((entry) => entry.path));
  const included = new Set(sourceFilter.included);
  const sourceEntries = entries.filter((entry) => included.has(entry.path));
  const sourcePaths = uniqueStrings(sourceEntries.map((entry) => entry.path));
  const evidence =
    sourceFilter.rejected.length > 0
      ? {
          kind: "sidecar_filtered_cached_source_paths",
          rejected_source_count: sourceFilter.rejected.length,
          rejected_source_paths: sourceFilter.rejected.slice(0, 100).map((entry) => ({
            input_path: entry.inputPath,
            relative_path: entry.relativePath ?? null,
            code: entry.code,
            pattern: entry.pattern ?? null,
            reason: entry.reason ?? null
          })),
          provenance: provenance({ evidenceBasis: "git_blob" })
        }
      : null;

  return {
    sourceEntries,
    sourcePaths,
    evidence
  };
}

function splitNulList(text) {
  return String(text || "")
    .split("\0")
    .filter(Boolean);
}

function parseDirtyStatusPath(line) {
  if (line.startsWith("?? ")) {
    return {
      path: line.slice(3),
      state: "untracked"
    };
  }

  const stagedCode = line[0];
  const unstagedCode = line[1];
  const rawPath = line.slice(3).split(" -> ").pop();
  if (!rawPath) {
    return null;
  }

  if (stagedCode === "D" || unstagedCode === "D") {
    return {
      path: rawPath,
      state: "deleted"
    };
  }
  if (stagedCode !== " " && unstagedCode !== " ") {
    return {
      path: rawPath,
      state: "staged_and_unstaged"
    };
  }
  if (stagedCode !== " ") {
    return {
      path: rawPath,
      state: "staged"
    };
  }
  if (unstagedCode !== " ") {
    return {
      path: rawPath,
      state: "unstaged"
    };
  }
  return {
    path: rawPath,
    state: "dirty"
  };
}

function mapDirtyStatusPaths(statusText) {
  const states = new Map();
  for (const line of String(statusText || "").split("\n").filter(Boolean)) {
    const parsed = parseDirtyStatusPath(line);
    if (!parsed) {
      continue;
    }
    states.set(parsed.path, parsed.state);
  }
  return states;
}

function isImpactOverlaySourcePath(relativePath) {
  return !(
    relativePath.startsWith("docs/") ||
    relativePath.startsWith("internal/") ||
    relativePath.startsWith("wiki/")
  );
}

async function collectDirtyWorktreeOverlay({ repoRoot, status }) {
  if (status.dirty_state !== "dirty_worktree") {
    return {
      overlayState: "not_applicable",
      sourcePaths: [],
      sourceEntries: [],
      evidence: null
    };
  }

  try {
    const [candidateText, deletedText, statusText] = await Promise.all([
      runSidecarGit(repoRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]),
      runSidecarGit(repoRoot, ["ls-files", "-z", "--deleted"]),
      runSidecarGit(repoRoot, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none"
      ])
    ]);
    const deletedPaths = new Set(splitNulList(deletedText));
    const dirtyPathStates = mapDirtyStatusPaths(statusText);
    const candidates = splitNulList(candidateText).filter((candidate) => !deletedPaths.has(candidate));
    const sourceFilter = filterSidecarSourcePaths(candidates);
    const sourcePaths = uniqueStrings(sourceFilter.included.filter(isImpactOverlaySourcePath)).sort(
      (left, right) => left.localeCompare(right)
    );
    const dirtyPaths = uniqueStrings([...dirtyPathStates.keys()]).sort((left, right) =>
      left.localeCompare(right)
    );
    const sourcePathSet = new Set(sourcePaths);
    const dirtySourcePaths = dirtyPaths.filter((dirtyPath) => sourcePathSet.has(dirtyPath));

    return {
      overlayState: "included",
      sourcePaths,
      sourceEntries: sourcePaths.map((sourcePath) => ({
        kind: "file",
        path: sourcePath,
        worktree_overlay: true,
        entry: {
          path: sourcePath,
          worktree_overlay: true,
          dirty_state: dirtyPathStates.get(sourcePath) || "unchanged_worktree"
        }
      })),
      evidence: {
        kind: "sidecar_dirty_worktree_overlay",
        overlay_state: "included",
        source_path_count: sourcePaths.length,
        dirty_path_count: dirtyPaths.length,
        dirty_source_path_count: dirtySourcePaths.length,
        dirty_paths: dirtyPaths.slice(0, 100),
        dirty_source_paths: dirtySourcePaths.slice(0, 100),
        rejected_source_count: sourceFilter.rejected.length,
        provenance: provenance({ evidenceBasis: "git_tree" })
      }
    };
  } catch (error) {
    return {
      overlayState: "unavailable",
      sourcePaths: [],
      sourceEntries: [],
      evidence: {
        kind: "sidecar_dirty_worktree_overlay",
        overlay_state: "unavailable",
        reason: error instanceof Error ? error.message : String(error),
        provenance: provenance({ evidenceBasis: "unknown" })
      }
    };
  }
}

function mergeSourceEntries(baseEntries, overlayEntries) {
  const byPath = new Map();
  for (const entry of baseEntries) {
    byPath.set(entry.path, cloneJson(entry));
  }
  for (const overlayEntry of overlayEntries) {
    const existing = byPath.get(overlayEntry.path);
    if (existing) {
      byPath.set(overlayEntry.path, {
        ...existing,
        worktree_overlay: true,
        entry: {
          ...(existing.entry || {}),
          worktree_overlay: true,
          dirty_state: overlayEntry.entry?.dirty_state || "unchanged_worktree"
        }
      });
      continue;
    }
    byPath.set(overlayEntry.path, cloneJson(overlayEntry));
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function pathStem(relativePath) {
  const basename = path.posix.basename(relativePath);
  return basename.replace(/(?:\.test|\.spec)?\.[^.]+$/, "");
}

function defaultTestCandidates(relativePath) {
  const parsed = relativePath.match(/^(?<dir>.*\/)?(?<base>[^/.]+)\.[^.]+$/);
  if (!parsed?.groups?.base) {
    return [];
  }
  const directory = parsed.groups.dir || "";
  const basename = parsed.groups.base;
  return uniqueStrings([
    `${directory}${basename}.test.mjs`,
    `${directory}${basename}.test.js`,
    `${directory}${basename}.spec.mjs`,
    `${directory}${basename}.spec.js`,
    `tests/${basename}.test.mjs`,
    `tests/${basename}.test.js`
  ]);
}

function inferLikelyTests(inputPath, sourcePaths) {
  const candidates = new Set(defaultTestCandidates(inputPath));
  const stem = pathStem(inputPath);
  for (const sourcePath of sourcePaths) {
    const basename = path.posix.basename(sourcePath);
    if (
      sourcePath !== inputPath &&
      (sourcePath.startsWith("tests/") || /\.test\.|\.spec\./.test(basename)) &&
      pathStem(sourcePath) === stem
    ) {
      candidates.add(sourcePath);
    }
  }
  return [...candidates].filter((candidate) => sourcePaths.includes(candidate));
}

function inferRelatedCodePaths(inputPath, sourcePaths, likelyTests) {
  const inputDirectory = path.posix.dirname(inputPath);
  const likelyTestSet = new Set(likelyTests);
  return sourcePaths
    .filter((candidate) => candidate !== inputPath)
    .filter((candidate) => !likelyTestSet.has(candidate))
    .filter((candidate) => path.posix.dirname(candidate) === inputDirectory)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 20);
}

function makeStatusHints(status) {
  const hints = [];
  if (status.staleness !== "fresh") {
    hints.push({
      kind: "sidecar_status_hint",
      dimension: "staleness",
      state: status.staleness,
      message: `sidecar index staleness is ${status.staleness}`,
      provenance: provenance({ evidenceBasis: status.index_tree ? "git_tree" : "unknown" })
    });
  }
  if (status.dirty_state !== "clean") {
    hints.push({
      kind: "sidecar_status_hint",
      dimension: "dirty_state",
      state: status.dirty_state,
      message: `repository dirty state is ${status.dirty_state}`,
      provenance: provenance({ evidenceBasis: status.index_tree ? "git_tree" : "unknown" })
    });
  }
  return hints;
}

function queryEvidence({ queryKind, inputPaths, includeSuppressed }) {
  return {
    kind: "sidecar_impact_query",
    query_kind: queryKind,
    input_paths: inputPaths,
    include_suppressed: includeSuppressed,
    provenance: provenance({ evidenceBasis: "path_match" })
  };
}

async function buildImpactEnvelope({
  dir,
  cacheDir,
  paths,
  queryKind,
  includeSuppressed = false,
  profile = null,
  extensionNamespaces = null
}) {
  const targetDir = path.resolve(String(dir || "."));
  const status = await getSidecarIndexStatus({ dir: targetDir, cacheDir });
  const gitState = await discoverSidecarGitState(targetDir);
  const artifactRead = await readCompatibleArtifact({
    repoRoot: gitState.repoRoot,
    status
  });
  const overlay = await collectDirtyWorktreeOverlay({
    repoRoot: gitState.repoRoot,
    status
  });
  const artifactSources = filterArtifactSourceEntries(sourceEntriesFromArtifact(artifactRead.artifact));
  const artifactSourcePaths = artifactSources.sourcePaths;
  const sourceEntries = mergeSourceEntries(
    artifactSources.sourceEntries,
    overlay.sourceEntries
  );
  const sourcePaths = uniqueStrings([
    ...artifactSourcePaths,
    ...overlay.sourcePaths
  ]).sort((left, right) => left.localeCompare(right));
  const knownExistingPaths =
    overlay.overlayState === "included"
      ? overlay.sourcePaths
      : status.staleness === "fresh"
        ? artifactSourcePaths
        : null;
  const validations = paths.map(validateImpactPath);
  const validPaths = uniqueStrings(
    validations.filter((entry) => entry.ok).map((entry) => entry.relative_path)
  );
  const validationHints = validations.map((entry) => entry.hint);
  const statusHints = makeStatusHints(status);
  const likelyTestsByPath = Object.fromEntries(
    validPaths.map((relativePath) => [relativePath, inferLikelyTests(relativePath, sourcePaths)])
  );
  const relatedCodePathsByPath = Object.fromEntries(
    validPaths.map((relativePath) => [
      relativePath,
      inferRelatedCodePaths(relativePath, sourcePaths, likelyTestsByPath[relativePath] || [])
    ])
  );

  let joined = createSidecarResultEnvelope({
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "path_match",
    index_head: status.index_head,
    index_tree: status.index_tree,
    dirty_state: status.dirty_state,
    dirty_details: status.dirty_details,
    staleness: status.staleness
  });

  if (validPaths.length > 0) {
    const canonicalRecords = await loadCanonicalRecords(targetDir, {
      profile,
      extensionNamespaces
    });
    joined = joinSidecarPathsToCanonicalRecords({
      paths: validPaths,
      canonicalRecords,
      knownExistingPaths,
      testAdjacency: likelyTestsByPath,
      includeSuppressed,
      envelope: {
        index_head: status.index_head,
        index_tree: status.index_tree,
        dirty_state: status.dirty_state,
        dirty_details: status.dirty_details,
        staleness: status.staleness
      }
    });
  }

  const relatedCodePaths = uniqueStrings(Object.values(relatedCodePathsByPath).flat()).sort(
    (left, right) => left.localeCompare(right)
  );
  const likelyTests = uniqueStrings(Object.values(likelyTestsByPath).flat()).sort((left, right) =>
    left.localeCompare(right)
  );

  return createSidecarResultEnvelope({
    ...joined,
    index_head: status.index_head,
    index_tree: status.index_tree,
    dirty_state: status.dirty_state,
    dirty_details: status.dirty_details,
    staleness: status.staleness,
    derived_evidence: [
      ...status.derived_evidence.map(cloneJson),
      artifactRead.evidence,
      ...(artifactSources.evidence ? [artifactSources.evidence] : []),
      ...(overlay.evidence ? [overlay.evidence] : []),
      queryEvidence({ queryKind, inputPaths: validPaths, includeSuppressed }),
      ...joined.derived_evidence.map(cloneJson),
      ...statusHints,
      ...validationHints
    ],
    cache_path: status.cache_path,
    artifact_path: status.artifact_path,
    artifact_exists: status.artifact_exists,
    artifact_schema_version: status.artifact_schema_version,
    expected_artifact_schema_version: status.expected_artifact_schema_version,
    status_reason: status.status_reason,
    query_kind: queryKind,
    overlay_state: overlay.overlayState,
    overlay_source_count: overlay.sourcePaths.length,
    input_paths: paths,
    validated_paths: validPaths,
    invalid_paths: validations.filter((entry) => !entry.ok).map((entry) => entry.input_path),
    validation_hints: validationHints,
    related_code_paths: relatedCodePaths,
    related_code_paths_by_path: relatedCodePathsByPath,
    likely_tests: likelyTests,
    likely_tests_by_path: likelyTestsByPath,
    source_entries: sourceEntries
  });
}

export async function getSidecarImpactPaths({
  dir = ".",
  paths = [],
  cacheDir = undefined,
  includeSuppressed = false,
  profile = null,
  extensionNamespaces = null
} = {}) {
  const inputPaths = asStringList(paths);
  if (inputPaths.length === 0) {
    throw new Error("impact_paths requires at least one path");
  }

  return buildImpactEnvelope({
    dir,
    cacheDir,
    paths: inputPaths,
    queryKind: "impact_paths",
    includeSuppressed,
    profile,
    extensionNamespaces
  });
}

async function readContextTargetLineCount(targetDir, relativePath) {
  if (!relativePath) {
    return null;
  }
  try {
    return countUtf8Lines(await readFile(path.join(targetDir, relativePath), "utf8"));
  } catch {

    return null;
  }
}

function createLargeFileContextGuard({ envelope, relativePath, loc, threshold }) {
  const relatedCodePaths = Array.isArray(envelope.related_code_paths_by_path?.[relativePath])
    ? envelope.related_code_paths_by_path[relativePath]
    : [];
  const likelyTests = Array.isArray(envelope.likely_tests_by_path?.[relativePath])
    ? envelope.likely_tests_by_path[relativePath]
    : [];
  const canonicalRefCount = Array.isArray(envelope.canonical_refs)
    ? envelope.canonical_refs.length
    : 0;
  const sourceEntryCount = Array.isArray(envelope.source_entries)
    ? envelope.source_entries.filter((entry) => entry.path === relativePath).length
    : 0;

  return createSidecarResultEnvelope({
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "path_match",
    index_head: envelope.index_head ?? null,
    index_tree: envelope.index_tree ?? null,
    dirty_state: envelope.dirty_state ?? "unknown",
    dirty_details: envelope.dirty_details,
    staleness: envelope.staleness ?? "unknown",
    canonical_refs: [],
    derived_evidence: [],
    query_kind: "context_for_path",
    path: relativePath,
    loc,
    large_file: true,
    large_file_loc_threshold: threshold,
    context_available: "degraded",
    reason:
      `context_for_path is degraded for ${relativePath}: ${loc} LOC exceeds the ${threshold} ` +
      "LOC code-index large-file context threshold; full code-index context is suppressed by " +
      "default to protect the agent context budget",
    related_code_path_count: relatedCodePaths.length,
    likely_test_count: likelyTests.length,
    canonical_ref_count: canonicalRefCount,
    source_entry_count: sourceEntryCount,
    top_related_code_paths: relatedCodePaths.slice(0, LARGE_FILE_CONTEXT_TOP_HINT_LIMIT),
    top_likely_tests: likelyTests.slice(0, LARGE_FILE_CONTEXT_TOP_HINT_LIMIT),
    recommended_narrower_tools: [
      "request a narrower symbol-, route-, or line-range-scoped context for this file",
      "split the work into a smaller unit whose write_scope stays below the large-file threshold",
      "use workspace_code_index_impact_paths for compact path-level impact instead of full context"
    ],
    next_action:
      "Request a narrower symbol/route/line-range context for this file, or split the work into " +
      "a smaller unit. Full context is available only through an explicit verbose opt-in where the " +
      "surface exposes it.",
    context: {
      path: relativePath,
      large_file: true,
      context_available: "degraded",
      loc,
      large_file_loc_threshold: threshold
    }
  });
}

function compactContextCanonicalRef(ref) {
  return {
    id: ref?.id ?? null,
    title: ref?.title ?? null,
    path: ref?.path ?? null,
    source_kind: ref?.source_kind ?? null,
    status: ref?.status ?? null,
    match_types: Array.isArray(ref?.match_types) ? ref.match_types : [],
    score: ref?.score ?? null,
    rank: ref?.rank ?? null
  };
}

function createCompactContextResponse({ envelope, relativePath, loc }) {
  const canonicalRefs = Array.isArray(envelope.canonical_refs) ? envelope.canonical_refs : [];
  const relatedCodePaths =
    relativePath && Array.isArray(envelope.related_code_paths_by_path?.[relativePath])
      ? envelope.related_code_paths_by_path[relativePath]
      : [];
  const likelyTests =
    relativePath && Array.isArray(envelope.likely_tests_by_path?.[relativePath])
      ? envelope.likely_tests_by_path[relativePath]
      : [];
  const invalidPaths = Array.isArray(envelope.invalid_paths) ? envelope.invalid_paths : [];
  const validationHints = Array.isArray(envelope.validation_hints) ? envelope.validation_hints : [];
  const noValidatedPath = !relativePath;

  return createSidecarResultEnvelope({
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "path_match",
    index_head: envelope.index_head ?? null,
    index_tree: envelope.index_tree ?? null,
    dirty_state: envelope.dirty_state ?? "unknown",
    staleness: envelope.staleness ?? "unknown",
    canonical_refs: [],
    derived_evidence: [],
    query_kind: "context_for_path",
    path: relativePath,
    ...(typeof loc === "number" ? { loc } : {}),
    context_available: "compact",
    canonical_ref_count: canonicalRefs.length,
    related_code_path_count: relatedCodePaths.length,
    likely_test_count: likelyTests.length,
    invalid_path_count: invalidPaths.length,
    validation_hint_count: validationHints.length,
    ...(noValidatedPath
      ? {
          invalid_paths: invalidPaths,
          validation_hints: validationHints
        }
      : {}),
    top_canonical_refs: canonicalRefs
      .slice(0, COMPACT_CONTEXT_TOP_HINT_LIMIT)
      .map(compactContextCanonicalRef),
    top_related_code_paths: relatedCodePaths.slice(0, COMPACT_CONTEXT_TOP_HINT_LIMIT),
    top_likely_tests: likelyTests.slice(0, COMPACT_CONTEXT_TOP_HINT_LIMIT),
    next_action:
      "Default context_for_path is a compact routing hint. Pass verbose:true for the full " +
      "canonical refs, match explanations, derived evidence, and source entries, or use " +
      "workspace_code_index_impact_paths for compact path-level impact.",
    context: {
      path: relativePath,
      context_available: "compact",
      ...(noValidatedPath
        ? {
            invalid_paths: invalidPaths,
            validation_hints: validationHints
          }
        : {})
    }
  });
}

export async function getSidecarContextForPath({
  dir = ".",
  path: inputPath,
  cacheDir = undefined,
  includeSuppressed = false,
  verbose = false,
  profile = null,
  extensionNamespaces = null
} = {}) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error("context_for_path requires path");
  }

  const targetDir = path.resolve(String(dir || "."));
  const envelope = await buildImpactEnvelope({
    dir,
    cacheDir,
    paths: [inputPath],
    queryKind: "context_for_path",
    includeSuppressed,
    profile,
    extensionNamespaces
  });
  const relativePath = envelope.validated_paths[0] ?? null;

  const loc = await readContextTargetLineCount(targetDir, relativePath);
  if (
    !verbose &&
    relativePath &&
    typeof loc === "number" &&
    loc > LARGE_FILE_CONTEXT_LOC_THRESHOLD
  ) {
    return createLargeFileContextGuard({
      envelope,
      relativePath,
      loc,
      threshold: LARGE_FILE_CONTEXT_LOC_THRESHOLD
    });
  }

  if (!verbose) {
    return createCompactContextResponse({ envelope, relativePath, loc });
  }

  const sourceEntries = relativePath
    ? envelope.source_entries.filter((entry) => entry.path === relativePath)
    : [];

  return createSidecarResultEnvelope({
    ...envelope,
    source_entries: sourceEntries,
    context: {
      path: relativePath,
      source_entries: sourceEntries,
      canonical_refs: envelope.canonical_refs,
      related_code_paths: relativePath
        ? envelope.related_code_paths_by_path[relativePath] || []
        : [],
      likely_tests: relativePath ? envelope.likely_tests_by_path[relativePath] || [] : [],
      validation_hints: envelope.validation_hints
    }
  });
}

export {
  SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS,
  getSidecarGraphImpactDiff,
  getSidecarGraphImpactPaths
} from "./sidecar-graph-impact.mjs";
