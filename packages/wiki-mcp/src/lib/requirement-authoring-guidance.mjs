

import {
  CONTROLLED_CONTRACT_REQUIREMENT_FIELD_GUIDANCE,
  CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE as OWNER
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { RECORD_AUTHORING_LABEL_PATTERN, recordAuthoringChangeSchema } from
  "@agent-chassis/wiki-core/src/lib/record-authoring-schema.mjs";

import { CONTRACT_ASSESSMENT_ROUTE as ASSESS_TOOL } from "./controlled-contract-query-context.mjs";
import { authoredFalsificationFacts, authoringSchemaMembers } from "./proof-discovery-response.mjs";
import { inputContractSourceDigest, resolveToolInputGuidancePath } from
  "./tool-discovery-input-guidance-delivery.mjs";

const READ_TOOL = "workspace_read_wiki";
const SAVE_TOOL = "save_record";
const FIND_TOOL = "workspace_find_proofs";
const SLICE_UNIT = "<WK-NNNN#SLICE-NNN>";

export const REQUIREMENT_GUIDANCE_SUBJECT = Object.freeze({ requirement_guidance: true });

export const REQUIREMENT_GUIDANCE_ENTRY_STATEMENT =
  `${READ_TOOL} ${JSON.stringify({ subject: REQUIREMENT_GUIDANCE_SUBJECT })}`;

export const REQUIREMENT_VOCABULARY_ENTRY_STATEMENT =
  `${READ_TOOL} ${JSON.stringify({ subject: { ...REQUIREMENT_GUIDANCE_SUBJECT, topic: ["vocabulary"] } })}`;

const OWNER_MEMBERS = Object.freeze(["required_object_shapes", "conditional_verification_requirements",
  "runtime_test_authoring", "vocabulary", "native_runtime_test_vocabulary", "case_authoring"]);

const mandatoryVerification = OWNER.conditional_verification_requirements
  .find((rule) => rule.requires.includes("verification"));
const { requirement: requirementShape, verification: verificationShape } = OWNER.required_object_shapes;
const requirementField = (member) => `changes.requirements[].${member}`;
const obligationField = (member) => `changes.obligations[].${member}`;
const REMOVE_REQUIREMENTS = "changes.remove.requirements";

const requirementRow = authoringSchemaMembers(recordAuthoringChangeSchema("work_item")).requirements;
const requirementRowRequired = requirementRow.variants.find(({ identity }) => identity.includes("key")).required;

const { requirement_rebinding: ownerRebinding, requirement_retirement: ownerRetirement,
  ...ownerShapes } = OWNER.required_object_shapes;
const REQUIRED_OBJECT_SHAPES = Object.freeze({
  ...ownerShapes,
  requirement: Object.freeze({
    required_fields: Object.freeze([...requirementRowRequired]),
    optional_fields: Object.freeze([...new Set(requirementRow.variants.flatMap(({ identity }) => identity)),
      ...requirementRow.members.filter((member) => !requirementRowRequired.includes(member))]),
    field_shapes: requirementShape.field_shapes
  }),
  requirement_rebinding: Object.freeze({
    ...ownerRebinding,
    field: requirementField("rebind_case_ids"),
    requires: Object.freeze([requirementField("id")])
  }),
  requirement_retirement: Object.freeze({
    ...ownerRetirement,
    field: REMOVE_REQUIREMENTS,
    selection: "Each entry is a current non-verification requirement claim, listed once and not also named by a " +
      `${requirementField("id")} or authored by a changes.requirements row in the same save. A save carries ` +
      `changes.requirements, ${REMOVE_REQUIREMENTS} or both, and a supplied list is never empty.`,
    dependent_uses: "A parent or slice obligation whose explicit links and case support only retired requirements " +
      "is deleted. An affected obligation that also supports a remaining requirement, or that the same save amends, " +
      `is refused with its unit, obligation, case and identities; amend its ${obligationField("claims")} or case in ` +
      "the same save to keep the remaining meaning. Obligations with no retired link or case are unchanged.",
    bounds: Object.freeze({ ...ownerRetirement.bounds,
      answer_census: `each changes.requirements row plus each ${REMOVE_REQUIREMENTS} entry` })
  })
});

const SLICE_COVERAGE = Object.freeze({
  steps: Object.freeze([
    "A slice needs its own criterion-to-obligation associations: a parent's obligations, criterion labels and " +
      "coverage transfer none to it, and a slice is covered only by obligations saved on that slice unit.",
    `Read the slice's criterion identities and its current revision: ${READ_TOOL} {subject:${SLICE_UNIT}} returns the ` +
      "revision and a reference, and that reference's {contract:\"criteria\"} selection returns each criterion's identity.",
    "Reuse an applicable saved parent requirement claim and case.id: the parent's {contract:\"requirements\"} " +
      "selection returns claim_id and its {contract:\"cases\"} selection returns case_id. Name them only where the " +
      "author judges that the parent requirement and its test apply to the slice criterion.",
    `Save the slice-local obligations on the slice unit at the slice's revision, without duplicating requirements ` +
      "or cases. An obligation takes exactly one of two arms. Proof-backed: it states " +
      "changes.obligations[].claims, case.id and criteria, restates neither changes.requirements nor a case " +
      "body, and selects the proof that saved case verifies in changes.obligations[].proof.name. Opted out: it " +
      "states changes.obligations[].proof_opt_out: true with its claims and criteria, and names no case and no " +
      "proof selection; a save that combines an opt-out with either is refused. An opt-out accounts for the " +
      "obligation's meaning as valid and grants no verification credit. An obligation with neither arm covers " +
      "no criterion.",
    `Assess that exact slice: ${ASSESS_TOOL} {unit:${SLICE_UNIT}} reports the slice's own criterion coverage. ` +
      "Reading, saving and assessing execute no proof and grant no credit."
  ])
});

const { verification_association: ownerAssociation, falsification: ownerFalsification } = OWNER.case_authoring;
const association = Object.freeze({
  ...ownerAssociation,
  field: `changes.${ownerAssociation.authoring.field}`,
  eligible: "One test_execution verification claim_id the SAME obligation makes eligible: a verification claim " +
    `it lists in its own ${obligationField("claims")}, or one an explicit verifies relationship ties to a ` +
    "requirement claim it lists there. A requirement already records which verification verifies it, so linking " +
    "only the requirement claim is enough and the verification identity is not repeated. Eligibility reads these " +
    "semantic facts alone; whether an executable binding exists never changes it.",
  correction: `List the requirement claim, or the verification claim_id itself, in ${obligationField("claims")}, ` +
    `and name an eligible claim_id in ${obligationField("case.verification")} when several are eligible. ` +
    "Replacing the verification a saved case names is the same amendment.",
  omission: "A case may omit case.verification. A saved case that names an eligible verification keeps it. " +
    "Otherwise exactly one eligible, selectable verification is adopted. With none or several the save still " +
    "commits and the case stays an unresolved draft that names no verification: nothing is chosen for the " +
    "author, and the draft cannot be executed."
});

const FALSIFICATION = Object.freeze(Object.fromEntries(Object.entries(ownerFalsification).map(([mechanism, facts]) =>
  [mechanism, authoredFalsificationFacts(facts)])));
const CASE_AUTHORING = Object.freeze(Object.fromEntries(Object.entries(OWNER.case_authoring).map(([member, value]) =>
  [member, member === "verification_association" ? association : member === "falsification" ? FALSIFICATION : value])));
const ASSOCIATIONS = Object.freeze([
  { from: "changes.obligations[].claims", to: "changes.requirements[].key, or a saved requirement's claim_id",
    meaning: "The obligation supports each requirement claim it names. " + association.eligible },
  { from: "changes.obligations[].criteria", to: "changes.criteria[].key, or a saved criterion's identity",
    meaning: "The obligation covers each criterion it names. A unit's criterion is covered only by an obligation " +
      "saved on that same unit." },
  { from: "changes.obligations[].proof.name", to: `a proof ${FIND_TOOL} lists`,
    meaning: "Selects the checking route of the obligation: " +
      `${OWNER.unresolved_coverage.record.obligation_fields.proof_name}. The selected proof's own authoring ` +
      "answer states whether it requires a case and which inputs remain the author's." },
  { from: "changes.obligations[].case", to: "the requirement's verification",
    meaning: "Supplies the test details when the selected proof requires them, and is omitted for a proof that " +
      "requires no case. The case is the test of the verification its obligation makes eligible. " +
      association.omission },
  { from: "changes.obligations[].case.verification", to: "changes.requirements[].verification.key",
    meaning: "Authored only to choose between several eligible verifications: " +
      `${association.authoring.choose_when}. Omit it when ${association.authoring.omit_when}.` },
  { from: "changes.obligations[].case.id", to: "a saved case's case_id",
    meaning: "Reuses a saved case for the same test without restating its members. " + association.cardinality }
].map((row) => Object.freeze(row)));

const SAVE_RECORD_INPUTS = Object.freeze({
  request: `${SAVE_TOOL} {unit, revision, changes}. revision is the unit's current revision: the revision of ` +
    `${READ_TOOL} {subject:<unit>} or of a prior save answer. Omitted changes members are preserved.`,
  labels: `A new row states key, a label matching ${RECORD_AUTHORING_LABEL_PATTERN}; an existing row states id. ` +
    "Only the label_references members name a new row as $<key>; the reference resolves to the identity its " +
    "owner issued, never to the row's text. A saved answer's bindings map every key to that identity.",
  criterion_text: "changes.criteria[].text is a readable criterion of the selected unit, and its key is the only " +
    "criterion label. slices[].acceptance.criteria and ready_slices[].acceptance.criteria are the slice's own " +
    "readable outcomes: a string there is saved as literal text, and an object states text beside " +
    "verification_method, evidence_target or facet_provenance. A parent criterion label copies no text and " +
    "transfers no coverage to a slice; author a slice's criteria and their obligations on that slice unit.",
  members_meaning: `owner_field is the member the unit's ${READ_TOOL} {contract:"obligations"} or ` +
    "{contract:\"cases\"} selection returns for a saved row, read and never authored; save_record_field is the " +
    "changes member that takes that value. A parenthesized owner_field is a new row, which has no saved identity.",
  members: Object.freeze([
    ["(new requirement label)", requirementField("key")],
    ["(new verification label)", requirementField("verification.key")],
    ["(new criterion label)", "changes.criteria[].key"],
    ["obligations[].obligation_id", `${obligationField("id")}, or key for a new obligation`],
    ["obligations[].controlled_contract_node_ids", obligationField("claims")],
    ["obligations[].acceptance_criteria", obligationField("criteria")],
    ["obligations[].selection.proof_name", obligationField("proof.name")],
    ["cases[].case_id", `${obligationField("case.id")}, or key for a new case`],
    ["cases[].verification_id", obligationField("case.verification")]
  ].map(([owner_field, save_record_field]) => Object.freeze({ owner_field, save_record_field }))),
  label_references: Object.freeze(["changes.obligations[].claims[]", "changes.obligations[].criteria[]",
    "changes.obligations[].case.verification", "changes.dispositions[].entry.id"]),
  associations: ASSOCIATIONS,
  slice_coverage: SLICE_COVERAGE,
  not_authored_here: `Requirement notes and residue are not authored through ${SAVE_TOOL}: changes has no ` +
    "member for either."
});

const FIELDS = Object.freeze({
  meaning: CONTROLLED_CONTRACT_REQUIREMENT_FIELD_GUIDANCE,
  verification_guidance: mandatoryVerification.guidance,
  required_when: mandatoryVerification.when,
  subject: Object.freeze({ save_record_field: requirementField("subject"),
    shape: requirementShape.field_shapes.subject }),
  behavior: Object.freeze({ save_record_field: requirementField("behavior"),
    shape: requirementShape.field_shapes.behavior }),
  verifier: Object.freeze({ save_record_field: requirementField("verification.verifier"),
    shape: verificationShape.field_shapes.verifier }),
  observes: Object.freeze({ save_record_field: requirementField("verification.observes"),
    shape: verificationShape.field_shapes.observes }),
  fails_when: Object.freeze({ save_record_field: requirementField("verification.fails_when"),
    shape: verificationShape.field_shapes.fails_when }),
  shapes: "required_object_shapes holds each named shape; vocabulary holds the terms a shape accepts."
});

const { next_calls: _ownerNavigation, record: ownerRecord, ...unresolvedCoverage } = OWNER.unresolved_coverage;
const ownerObligationFields = ownerRecord.obligation_fields;
const guidanceRead = (...topic) => buildNextCall({ tool: READ_TOOL,
  arguments: { subject: { ...REQUIREMENT_GUIDANCE_SUBJECT, topic } } });
const UNRESOLVED_COVERAGE = Object.freeze({
  applies_when: unresolvedCoverage.applies_when,

  record: Object.freeze({ controlled_acceptance: ownerRecord.controlled_acceptance,
    obligation_fields: Object.freeze({ statement: ownerObligationFields.statement,
      claims: ownerObligationFields.controlled_contract_node_ids, mechanism: ownerObligationFields.mechanism,
      "proof.name": ownerObligationFields.proof_name }) }),
  gap_kinds: unresolvedCoverage.gap_kinds,
  distinctions: unresolvedCoverage.distinctions,
  next_calls: Object.freeze({
    case_authoring: guidanceRead("case_authoring"),
    save_record_inputs: guidanceRead("save_record_inputs")
  }),
  proof_discovery: Object.freeze({ tool: FIND_TOOL, missing_inputs: Object.freeze(["query"]),
    query: OWNER.unresolved_coverage.next_calls.discover.arguments.query })
});

export const REQUIREMENT_AUTHORING_GUIDANCE = Object.freeze({
  schema_version: "requirement-authoring-guidance.v1",
  overview: `Author contract requirements through ${SAVE_TOOL} changes.requirements. ` +
    `${CONTROLLED_CONTRACT_REQUIREMENT_FIELD_GUIDANCE} Select one topic at a time: fields explains subject, ` +
    "behavior, observes and fails_when; required_object_shapes holds the referent, statement and verification " +
    "shapes; vocabulary holds every accepted term with its relation signatures; save_record_inputs states which " +
    "changes member takes each saved identity and how an obligation's claims, criteria, proof and case associate; " +
    "case_authoring holds the test-case members; unresolved_coverage explains what to author when a proof, " +
    "family or falsifier is missing, which is never a reason to leave controlled authoring. Reading guidance " +
    "and saving execute no proof and establish no readiness.",
  save_record_inputs: SAVE_RECORD_INPUTS,
  fields: FIELDS,
  unresolved_coverage: UNRESOLVED_COVERAGE,
  ...Object.fromEntries(OWNER_MEMBERS.map((member) => [member, member === "required_object_shapes"
    ? REQUIRED_OBJECT_SHAPES : member === "case_authoring" ? CASE_AUTHORING : OWNER[member]]))
});

export const REQUIREMENT_AUTHORING_GUIDANCE_TOPICS = Object.freeze(Object.keys(REQUIREMENT_AUTHORING_GUIDANCE)
  .filter((member) => !["schema_version", "overview"].includes(member)).map((member) => Object.freeze([member])));

export const REQUIREMENT_AUTHORING_GUIDANCE_REVISION = inputContractSourceDigest(REQUIREMENT_AUTHORING_GUIDANCE);

export const resolveRequirementAuthoringGuidance = (path) =>
  resolveToolInputGuidancePath(REQUIREMENT_AUTHORING_GUIDANCE, path);

export function requirementGuidanceRecoveryCall(ownerPath) {
  if (!Array.isArray(ownerPath) || ![...OWNER_MEMBERS, "unresolved_coverage"].includes(ownerPath[0]) ||
      !resolveRequirementAuthoringGuidance(ownerPath).ok) return null;
  return buildNextCall({ tool: READ_TOOL, recommended: true,
    arguments: { subject: { ...REQUIREMENT_GUIDANCE_SUBJECT, topic: [...ownerPath] } } });
}
