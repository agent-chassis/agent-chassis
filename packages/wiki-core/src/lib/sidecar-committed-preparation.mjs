import { ensureSidecarIndex } from "./sidecar-ensure.mjs";
import { SidecarGraphIndexUnbuildableError } from "./sidecar-graph-impact-artifact.mjs";
import { resolveSidecarRepositoryIdentity } from "./sidecar-repository-identity.mjs";
import { runSidecarGit } from "./sidecar-status.mjs";
import { validateVirtualSidecarPath } from "./sidecar-paths.mjs";

export async function captureCommittedSourceContext({ dir = "." } = {}) {
  const repoRoot = await resolveSidecarRepositoryIdentity({ dir });
  const repository_commit = await runSidecarGit(repoRoot, ["--no-replace-objects", "rev-parse", "HEAD^{commit}"]);
  const repository_tree = await runSidecarGit(repoRoot, ["--no-replace-objects", "rev-parse", `${repository_commit}^{tree}`]);
  return { repoRoot, repository_commit, repository_tree };
}

export async function readCommittedSourceDescriptors(context, paths) {
  const wanted = [...new Set(paths)];
  for (const filePath of wanted) validateVirtualSidecarPath(filePath);
  if (!wanted.length) return new Map();
  const output = await runSidecarGit(context.repoRoot, ["--no-replace-objects", "--literal-pathspecs", "ls-tree", "-z",
    context.repository_commit, "--", ...wanted], { maxBuffer: 16 * 1024 * 1024 });
  const descriptors = new Map();
  for (const record of output.split("\0").filter(Boolean)) {
    const match = record.match(/^(\d{6}) (blob|tree|commit) ([0-9a-f]+)\t([\s\S]+)$/u);
    if (!match) throw new TypeError("committed source descriptor output is malformed");
    if (wanted.includes(match[4])) descriptors.set(match[4], { path: match[4], mode: match[1], blob_oid: match[3] });
  }
  return descriptors;
}

export function unavailableCommittedSnapshot(outcome, status) {
  return new SidecarGraphIndexUnbuildableError(
    `repo code index snapshot is unavailable: ${outcome}`,
    { code: outcome, status }
  );
}

export function sameGraphSnapshot(publication, snapshot) {
  return publication?.store_incarnation === snapshot?.store_incarnation &&
    publication?.sequence === snapshot?.publication_sequence &&
    publication?.repository_commit === snapshot?.repository_commit &&
    publication?.repository_tree === snapshot?.repository_tree &&
    publication?.generator_identity === snapshot?.generator_identity;
}

export async function resolveCommittedSidecarSnapshot({
  dir = ".",
  cacheDir = undefined,
  signal = null,
  dirtyState = false,
  ensureIndex = ensureSidecarIndex
} = {}) {
  const ensured = await ensureIndex({ dir, cacheDir, signal, dirtyState });
  const status = ensured.status;
  const repoRoot = await resolveSidecarRepositoryIdentity({ dir: status.repo_root ?? dir });
  const snapshot = status.graph_snapshot;
  if (!snapshot || snapshot.repository_commit !== ensured.captured_head ||
      snapshot.repository_tree !== status.index_tree ||
      status.graph_state?.graph_available !== true) {
    return { available: false, outcome: "base_store_incompatible", status };
  }
  return {
    available: true,
    outcome: "available",
    repoRoot,
    status,
    graph_snapshot: structuredClone(snapshot),
    build: ensured.build,
    action: ensured.action ?? null,
    ...(ensured.publication_outcome === undefined ? {}
      : { publication_outcome: ensured.publication_outcome }),
    ...(ensured.changed === undefined ? {} : { changed: ensured.changed })
  };
}
