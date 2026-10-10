import {
  prepareControlledAcceptanceProofPostureAmendment
} from "../../lib/work-record-proof-posture.mjs";
import {
  ControlledContractToolError
} from "../../lib/controlled-contract-tools.mjs";
import { today } from "../../lib/wiki-shared.mjs";
import { loadWorkRecordById } from "../../lib/work-record-store.mjs";
import { writeValidatedWorkRecord } from "../work-records-store-io.mjs";

function refusal(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, { changed: false, ...details });
}

function onlyReplaceableProofPostureDiagnostics(loaded) {
  return loaded?.record && typeof loaded.source_digest === "string" &&
    Array.isArray(loaded.diagnostics) && loaded.diagnostics.length > 0 &&
    loaded.diagnostics.every((diagnostic) =>
      diagnostic?.severity === "error" && diagnostic?.code === "invalid_record" &&
      diagnostic?.path === "proof_posture");
}

export async function persistControlledAcceptanceProofPostureOperation({
  repoRoot, wkId, focus = null, disposition, rationale = null, expectedSourceDigest
} = {}, {
  loadRecord = loadWorkRecordById,
  writeRecord = writeValidatedWorkRecord,
  now = today
} = {}) {
  if (focus !== null) refusal(
    "controlled_acceptance_proof_posture_focus_forbidden",
    "the controlled-acceptance disposition is recorded on the parent WK"
  );
  if (typeof expectedSourceDigest !== "string" || expectedSourceDigest.length === 0) {
    refusal("controlled_acceptance_proof_posture_source_identity_invalid",
      "the disposition requires the wrapper-authenticated work-record source digest");
  }
  const loaded = await loadRecord({ dir: repoRoot, id: wkId });
  if ((!loaded?.valid && !onlyReplaceableProofPostureDiagnostics(loaded)) ||
      loaded.record?.id !== wkId || typeof loaded.source_digest !== "string") refusal(
    "controlled_acceptance_proof_posture_record_invalid",
    "the exact canonical work record is unavailable or invalid"
  );
  if (loaded.source_digest !== expectedSourceDigest) refusal(
    "controlled_acceptance_proof_posture_stale",
    "the canonical work record changed after the wrapper issued the continuation",
    { expected_source_digest: expectedSourceDigest,
      current_source_digest: loaded.source_digest ?? null }
  );
  const prepared = prepareControlledAcceptanceProofPostureAmendment({
    record: loaded.record, wkId, disposition, rationale,
    allowCorrection: false,
    allowInvalidReplacement: onlyReplaceableProofPostureDiagnostics(loaded), now
  });
  const record = prepared.record;
  const written = await writeRecord({ dir: repoRoot, record, expectedSourceDigest });
  if (written?.written !== true) {
    const diagnostic = written?.diagnostics?.[0] ?? null;
    refusal(diagnostic?.code === "stale_source_digest"
      ? "controlled_acceptance_proof_posture_stale"
      : "controlled_acceptance_proof_posture_write_failed",
    diagnostic?.message ?? "the controlled-acceptance disposition could not be persisted",
    { diagnostic });
  }
  return Object.freeze({
    schema_version: "controlled-acceptance-proof-posture-receipt.v1",
    wk_id: wkId,
    controlled_acceptance_state: disposition === "required" ? "incomplete" : "opted_out",
    proof_posture: prepared.proofPosture,
    source_digest: written.source_digest,
    written: true
  });
}
