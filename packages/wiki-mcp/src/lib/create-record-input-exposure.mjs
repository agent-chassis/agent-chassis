import { SAVE_RECORD_MEMBER_GUIDANCE, readySliceSchemaBranch } from "./save-record-input-exposure.mjs";
import { requirementSchemaBranch } from "./requirement-authoring-schema-guidance.mjs";
import { sessionAuthoringSchema } from "./record-authoring-session-exposure.mjs";

import { inputContractSourceDigest } from "./tool-discovery-input-guidance-delivery.mjs";

export const CREATE_RECORD_INITIAL_GROUP = "initial";

export const CREATE_RECORD_INITIAL_JOB = Object.freeze({ job: "record_creation",
  purpose: "owner schema choices or the complete workspace_create_record initial schema for creating a record of this kind" });

export function createCreateRecordInputExposure({ initialSchemas, registeredTier = null }) {
  return Object.freeze({ digest: inputContractSourceDigest,
    sources: Object.freeze(Object.fromEntries(Object.entries(initialSchemas).map(([kind, source]) => {
      const schema = sessionAuthoringSchema(source, registeredTier);
      return [kind, Object.freeze({ schema, ...(schema.properties.ready_slices ? { branches: { ready_slices: readySliceSchemaBranch("birth"),
        ...(schema.properties.requirements ? { requirements: requirementSchemaBranch("birth") } : {}) } } : {}),
        ...(schema.properties.requirements ? { guidance: { requirements: SAVE_RECORD_MEMBER_GUIDANCE.requirements } } : {}),
        groups: [{ name: CREATE_RECORD_INITIAL_GROUP, members: Object.keys(schema.properties) }] })]; }))) });
}
