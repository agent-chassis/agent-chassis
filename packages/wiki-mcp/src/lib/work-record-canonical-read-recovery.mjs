

import {
  classifyKindRecordSource,
  loadKindRecordByPath as loadCanonicalKindRecordByPath
} from "@agent-chassis/wiki-core/src/lib/kind-record-store.mjs";
import { buildSelectedRecordMemberCall } from "@agent-chassis/wiki-core/src/lib/work-record-selected-unit-projection.mjs";

const RECOVERABLE_SELECTORS = new Set(["include_body", "member"]);
const PATH_UNSUPPORTED = "selector_path_unsupported";

function recoverableSelector(diagnostics) {
  return Array.isArray(diagnostics) && diagnostics.length === 1 &&
    diagnostics[0].code === PATH_UNSUPPORTED &&
    Array.isArray(diagnostics[0].path) && diagnostics[0].path.length === 1 &&
    RECOVERABLE_SELECTORS.has(diagnostics[0].path[0])
    ? diagnostics[0].path[0]
    : null;
}

async function verifiedCanonicalMemberCall({
  toolFamily, workspaceRepo, workspaceDir, projectionPath, member, loadKindRecordByPath
}) {
  const source = await classifyKindRecordSource(projectionPath);
  if (source.source_classification !== "projection") return null;
  const loaded = await loadKindRecordByPath({
    repoRoot: workspaceDir,
    sourcePath: source.canonical_record_path
  });
  if (loaded?.valid !== true || loaded.record?.id !== source.record_id ||
      typeof loaded.source_digest !== "string") {
    return null;
  }

  const selection = member ?? { path: [] };
  return buildSelectedRecordMemberCall({
    tool: toolFamily,
    repository: workspaceRepo,
    identity: { path: source.canonical_record_path },
    member: Object.hasOwn(selection, "expected_source_digest")
      ? selection
      : { ...selection, expected_source_digest: loaded.source_digest },
    recommended: true
  });
}

export async function canonicalProjectionReadRecoveryCall({
  toolFamily,
  workspaceRepo,
  workspaceDir,
  args,
  diagnostics,
  loadKindRecordByPath = loadCanonicalKindRecordByPath
}) {
  const selector = recoverableSelector(diagnostics);
  if (selector === null || typeof args?.path !== "string") return null;
  return verifiedCanonicalMemberCall({
    toolFamily,
    workspaceRepo,
    workspaceDir,
    projectionPath: args.path,
    member: selector === "member" ? args.member : null,
    loadKindRecordByPath
  });
}

export async function withCanonicalProjectionReadRecovery({
  toolFamily,
  workspaceRepo,
  workspaceDir,
  args,
  loadKindRecordByPath = loadCanonicalKindRecordByPath,
  read
}) {
  try {
    return await read();
  } catch (error) {
    if (error?.name !== "WorkRecordSelectorValidationError") throw error;
    const call = await canonicalProjectionReadRecoveryCall({
      toolFamily,
      workspaceRepo,
      workspaceDir,
      args,
      diagnostics: error.envelope?.diagnostics,
      loadKindRecordByPath
    });
    if (call !== null) error.envelope = { ...error.envelope, next_calls: [call] };
    throw error;
  }
}
