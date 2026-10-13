

import { RECORD_AUTHORING_SLICE_CONTEXT, WORK_ITEM_ORDINARY_MEMBERS, WORK_ITEM_SLICE_CONTRACT_MEMBERS } from
  "@agent-chassis/wiki-core/src/lib/record-authoring-schema.mjs";
import { resolveRequirementAuthoringGuidance } from "./requirement-authoring-guidance.mjs";
import { inputContractSourceDigest } from "./tool-discovery-input-guidance-delivery.mjs";

export const SAVE_RECORD_INPUT_EXPOSURE_CODES = Object.freeze({
  MEMBER_NOT_IN_SOURCE: "save_record_input_exposure_member_not_in_source",
  ORDINARY_MEMBER_UNASSIGNED: "save_record_input_exposure_ordinary_member_unassigned",
  GUIDANCE_TOPIC_UNKNOWN: "save_record_input_exposure_guidance_topic_unknown",
  VARIANT_SOURCE_MISSING: "save_record_input_exposure_variant_source_missing"
});

export const SAVE_RECORD_WORK_ITEM_GROUPS = Object.freeze([
  ["content", ["title", "summary", "user_requirements", "why_it_matters", "notes", "tags", "scope_items",
    "scope_out_of_scope", "references", "material_refs"]],
  ["planning", ["priority", "owner", "base_branch", "read_scope", "write_scope", "repo_paths", "depends_on", "related",
    "blocks", "initiative", "retained_graph_evidence", "validation"]],
  ["tasks", ["tasks"]],
  ["review_evidence", ["entries", "dispositions"]],
  ["acceptance", ["criteria", "requirements", "obligations", "controlled_acceptance"]],
  ["slice_shaping", ["slices", "ready_slices"]],
  ["slice_assignment", WORK_ITEM_SLICE_CONTRACT_MEMBERS],
  ["lifecycle", ["status", "closure"]],
  ["removal", ["remove"]]
].map(([name, members]) => Object.freeze({ name, members: Object.freeze([...members]) })));

export const SAVE_RECORD_WHOLE_RECORD_GROUP = "record";

export const SAVE_RECORD_WORK_ITEM_JOBS = Object.freeze([
  { job: "record_editing", purpose: "the complete save_record schema for editing this record's content, planning, " +
      "tasks, review evidence, lifecycle and removals",
    groups: ["content", "planning", "tasks", "review_evidence", "lifecycle", "removal"] },
  { job: "acceptance_work", purpose: "the complete save_record schema for criteria, requirements, obligations and " +
      "controlled acceptance",
    groups: ["acceptance"] },
  { job: "slice_planning", purpose: "the complete save_record schema for shaping slices and, on a slice unit, its assignment",
    groups: ["slice_shaping", "slice_assignment"] }
].map((job) => Object.freeze({ ...job, groups: Object.freeze(job.groups) })));
export const SAVE_RECORD_WHOLE_RECORD_JOB = Object.freeze({ job: "record_editing",
  purpose: "the complete save_record schema for this record", groups: Object.freeze([SAVE_RECORD_WHOLE_RECORD_GROUP]) });

export const SAVE_RECORD_MEMBER_GUIDANCE = Object.freeze({
  requirements: [["required_object_shapes"], ["conditional_verification_requirements"], ["runtime_test_authoring"],
    ["authoring_vocabulary"]],
  obligations: [["save_record_inputs"], ["unresolved_coverage"], ["case_authoring"]]
});

function refuse(code, message) {
  throw Object.assign(new TypeError(`${code}: ${message}`), { code });
}

function workItemGroups(name, schema, sliceUnit) {
  const declared = (member) => Object.hasOwn(schema.properties, member);
  return SAVE_RECORD_WORK_ITEM_GROUPS.map((group) => {
    const members = group.members.filter((member) => {
      if (declared(member)) return true;
      if (!sliceUnit && WORK_ITEM_SLICE_CONTRACT_MEMBERS.includes(member)) return false;
      return refuse(SAVE_RECORD_INPUT_EXPOSURE_CODES.MEMBER_NOT_IN_SOURCE,
        `${name} declares no ${member}, which the ${group.name} group names`);
    });
    return { name: group.name, members };
  }).filter((group) => group.members.length > 0);
}

export function createSaveRecordInputExposure({ changeSchemas, variants }) {
  const homes = new Set(SAVE_RECORD_WORK_ITEM_GROUPS.flatMap((group) => group.members));
  for (const { member } of WORK_ITEM_ORDINARY_MEMBERS) {
    if (!homes.has(member)) {
      refuse(SAVE_RECORD_INPUT_EXPOSURE_CODES.ORDINARY_MEMBER_UNASSIGNED, `the ordinary member ${member} has no group`);
    }
  }
  for (const topics of Object.values(SAVE_RECORD_MEMBER_GUIDANCE)) {
    for (const topic of topics) {
      if (!resolveRequirementAuthoringGuidance(topic).ok) {
        refuse(SAVE_RECORD_INPUT_EXPOSURE_CODES.GUIDANCE_TOPIC_UNKNOWN,
          `${topic.join(".")} is not a published requirement guidance topic`);
      }
    }
  }
  return Object.freeze({ digest: inputContractSourceDigest,
    sources: Object.freeze(Object.fromEntries(variants.map(({ name, kind, context }) => {
      const schema = changeSchemas[name];
      if (schema === undefined) {
        refuse(SAVE_RECORD_INPUT_EXPOSURE_CODES.VARIANT_SOURCE_MISSING, `no source schema for the ${name} variant`);
      }
      return [name, Object.freeze(kind === "work_item"
        ? { schema, groups: workItemGroups(name, schema, context === RECORD_AUTHORING_SLICE_CONTEXT),
          guidance: SAVE_RECORD_MEMBER_GUIDANCE }
        : { schema, groups: [{ name: SAVE_RECORD_WHOLE_RECORD_GROUP, members: Object.keys(schema.properties) }] })];
    }))) });
}
