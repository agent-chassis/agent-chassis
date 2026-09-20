import { filterSidecarSourcePaths } from "./sidecar-paths.mjs";
import { runSidecarGit } from "./sidecar-status.mjs";

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

export async function collectDirtyWorktreeOverlay({ repoRoot, status }) {
  if (status.dirty_state !== "dirty_worktree") {
    return {
      overlayState: "not_applicable",
      sourcePaths: [],
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
      evidence: {
        kind: "sidecar_dirty_worktree_overlay",
        overlay_state: "unavailable",
        reason: error instanceof Error ? error.message : String(error),
        provenance: provenance({ evidenceBasis: "unknown" })
      }
    };
  }
}

export {
  SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS,
  getSidecarGraphImpactPaths
} from "./sidecar-graph-impact.mjs";
