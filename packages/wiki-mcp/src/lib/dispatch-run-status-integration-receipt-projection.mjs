

import {
  authoredDocumentDigest,
  buildRetainedDocumentRetrieval,
  INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER,
  isObjectRecord,
  serializeRetainedObject
} from "./dispatch-run-status-retained-document-retrieval.mjs";

export const RUN_STATUS_INTEGRATION_RECEIPT_PROJECTION_SCHEMA_VERSION =
  "workspace-agent-run-status-integration-receipt-projection.v1";

export const INTEGRATION_TRANSITION_AUTHORED_RECORD_MEMBER = "record";
export { INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER };

export function readIntegrationTransitionAuthoredRecord(lifecycle) {
  if (!isObjectRecord(lifecycle)) return null;
  const integration = lifecycle.integration;
  if (!isObjectRecord(integration)) return null;
  const transition = integration.transition;
  if (!isObjectRecord(transition)) return null;
  const record = transition[INTEGRATION_TRANSITION_AUTHORED_RECORD_MEMBER];

  if (!isObjectRecord(record)) return null;
  const text = serializeRetainedObject(record);
  if (text === null) return null;
  return { integration, transition, record, text };
}

function omittedRecordIdentity({ record, text }) {
  return Object.freeze({
    member: INTEGRATION_TRANSITION_AUTHORED_RECORD_MEMBER,
    document: "canonical_work_record_written_by_this_integration_transition",
    carrier_member: INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER,
    record_id: typeof record.id === "string" ? record.id : null,
    record_schema_version: typeof record.schema_version === "string" ? record.schema_version : null,

    record_status: typeof record.status === "string" ? record.status : null,
    slice_count: Array.isArray(record.slices) ? record.slices.length : null,
    digest: authoredDocumentDigest(text),
    utf8_bytes: Buffer.byteLength(text, "utf8")
  });
}

function integrationReceiptProjection({ record, text, retention }) {
  const retrieval = buildRetainedDocumentRetrieval(retention, {
    members: [INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER]
  });
  return Object.freeze({
    schema_version: RUN_STATUS_INTEGRATION_RECEIPT_PROJECTION_SCHEMA_VERSION,
    projection_scope: "integration_transition_written_record",
    reason: "authored_record_body_is_not_integration_receipt_state",
    grants_authority: false,
    evidence_class: "historical_attempt_snapshot",

    current_record_read_is_equivalent: false,
    omitted: omittedRecordIdentity({ record, text }),
    retrieval: Object.freeze(retrieval)
  });
}

export function projectPublishedIntegrationReceipt(lifecycle, { retention = null } = {}) {
  const found = readIntegrationTransitionAuthoredRecord(lifecycle);
  if (found === null) return lifecycle;
  const transition = { ...found.transition };
  delete transition[INTEGRATION_TRANSITION_AUTHORED_RECORD_MEMBER];
  transition.written_record = integrationReceiptProjection({
    record: found.record,
    text: found.text,
    retention
  });
  return Object.freeze({
    ...lifecycle,
    integration: Object.freeze({ ...found.integration, transition: Object.freeze(transition) })
  });
}
