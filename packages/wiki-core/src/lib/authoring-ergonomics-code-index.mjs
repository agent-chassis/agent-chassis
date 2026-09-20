import { ensureSidecarIndex } from "./sidecar-ensure.mjs";

function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

function faultDetail(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function loadAuthoringErgonomicsCodeIndexEvidence({ dir }, {
  ensureIndex = ensureSidecarIndex
} = {}) {
  let ensured;
  try {
    ensured = await ensureIndex({ dir, dirtyState: true });
  } catch (error) {
    return freezeDeep({
      route: "code_index",
      state: "unavailable",
      required_for_authority: false,
      degradation_reason: "code_index_rebuild_failed",
      detail: `the committed code index could not be ensured: ${faultDetail(error)}`,
      freshness: "unknown",
      artifact_exists: null,
      dirty_state: null,
      ensure_failure: structuredClone(error?.envelope ?? {
        code: error?.code ?? null, cause_message: error?.message ?? String(error)
      })
    });
  }
  const status = ensured.status;
  return freezeDeep({
    route: "code_index",
    state: "complete",
    required_for_authority: false,
    degradation_reason: null,
    detail: null,
    freshness: status.staleness,
    artifact_exists: status?.artifact_exists ?? null,
    dirty_state: status?.dirty_state ?? null,
    ensure_action: ensured.action,
    captured_head: ensured.captured_head
  });
}
