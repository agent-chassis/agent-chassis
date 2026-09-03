import {
  canonicalJsonBytes,
  sha256
} from "./deterministic-projection-primitives.mjs";

const STABLE_OCCURRENCE_IDENTITY_VERSION =
  "controlled-contract.pagination-source-occurrence.v1";

function completeTraversalOccurrenceId(sourceIdentitySha256, sourceOccurrenceId) {
  return `occ-${sha256(canonicalJsonBytes({
    identity_version: STABLE_OCCURRENCE_IDENTITY_VERSION,
    source_grounded_identity_sha256: sourceIdentitySha256,
    source_occurrence_id: sourceOccurrenceId
  }))}`;
}

export {
  STABLE_OCCURRENCE_IDENTITY_VERSION,
  completeTraversalOccurrenceId
};
