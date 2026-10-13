

import { inputContractSourceDigest } from "./tool-discovery-input-guidance-delivery.mjs";

export const CREATE_RECORD_INITIAL_GROUP = "initial";

export const CREATE_RECORD_INITIAL_JOB = Object.freeze({ job: "record_creation",
  purpose: "the complete workspace_create_record initial schema for creating a record of this kind" });

export function createCreateRecordInputExposure({ initialSchemas }) {
  return Object.freeze({ digest: inputContractSourceDigest,
    sources: Object.freeze(Object.fromEntries(Object.entries(initialSchemas).map(([kind, schema]) =>
      [kind, Object.freeze({ schema,
        groups: [{ name: CREATE_RECORD_INITIAL_GROUP, members: Object.keys(schema.properties) }] })]))) });
}
