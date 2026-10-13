

import {
  CONTROLLED_CONTRACT_REQUIREMENT_FIELD_GUIDANCE,
  CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE as OWNER
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { RECORD_AUTHORING_LABEL_PATTERN, workItemRequirementBatchSchema } from
  "@agent-chassis/wiki-core/src/lib/record-authoring-schema.mjs";
import { REQUIREMENT_SOURCE_FIELD, REQUIREMENT_SOURCE_LOCATION_UNIT } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/contract-requirement-source-links.mjs";
import { RECORD_AUTHORING_REQUIREMENT_MEMBERS } from "@agent-chassis/wiki-core/src/operations/record-authoring-plan.mjs";
import { selectCelDefinition } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/contract-requirement-vocabulary.mjs";

import { CONTRACT_ASSESSMENT_ROUTE as ASSESS_TOOL } from "./controlled-contract-query-context.mjs";
import { authoredFalsificationFacts, familyAuthoringFacts } from "./proof-discovery-response.mjs";
import { AUTHORING_VOCABULARY_TOPIC, CASE_FAMILY_TOPIC, caseFamilySelections,
  deriveAuthoringJobVocabulary, deriveCaseFamilyGuidance } from "./requirement-authoring-job-guidance.mjs";
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
  `${READ_TOOL} ${JSON.stringify({ subject: { ...REQUIREMENT_GUIDANCE_SUBJECT, topic: [AUTHORING_VOCABULARY_TOPIC] } })}`;

const OWNER_MEMBERS = Object.freeze(["required_object_shapes", "conditional_verification_requirements",
  "runtime_test_authoring", "vocabulary", "observation_vocabulary", "native_runtime_test_vocabulary", "case_authoring"]);

const mandatoryVerification = OWNER.conditional_verification_requirements
  .find((rule) => rule.requires.includes("verification"));
const { requirement: requirementShape, verification: verificationShape } = OWNER.required_object_shapes;
const BATCH = "changes.requirements";
const requirementField = (member) => `${BATCH}.requirements[].${member}`;
const obligationField = (member) => `changes.obligations[].${member}`;
const REMOVE_REQUIREMENTS = "changes.remove.requirements";
const REMOVE_REQUIREMENT_ROWS = "changes.remove.requirement_rows";

const batchSchema = workItemRequirementBatchSchema();
const statementRow = batchSchema.$defs.requirement;
const membershipRow = batchSchema.$defs.membership_requirement;
const ROW_SELECTORS = Object.freeze(["key", "row_id", "id"]);
const requirementRowRequired = statementRow.required;

const { requirement_rebinding: ownerRebinding, requirement_retirement: ownerRetirement,
  ...ownerShapes } = OWNER.required_object_shapes;
const REQUIRED_OBJECT_SHAPES = Object.freeze({
  ...ownerShapes,
  requirement: Object.freeze({
    required_fields: Object.freeze([...requirementRowRequired]),
    optional_fields: Object.freeze(Object.keys(statementRow.properties).filter((member) => !requirementRowRequired.includes(member))),
    field_shapes: Object.freeze({ ...requirementShape.field_shapes, subject: "entity id" })
  }),

  referent: Object.freeze({
    form: "<entity id>",
    declared_under: `${BATCH}.entities`,
    declaration: Object.freeze({ by_type: "{<entity id>: <type term>} declares the entity identified by the term its id spells",
      by_identity: "{<entity id>: {type_term, identity}} declares an entity identified another way" }),
    rule: "A statement, a closed membership and a verification name an entity by its id; none selects or declares a " +
      "referent in place. A type may be left out only where the relations using the entity admit exactly one; " +
      "otherwise the entity's type is unfinished and every row naming it is saved incomplete. An entity a saved " +
      "requirement row already binds keeps that binding: a declaration that agrees is accepted and one that differs is refused."
  }),
  closed_membership: Object.freeze({
    required_fields: Object.freeze([...membershipRow.required]),
    optional_fields: Object.freeze(Object.keys(membershipRow.properties).filter((member) => !membershipRow.required.includes(member))),
    meaning: "For one population and applicability: every MUST member is required, a MAY member is permitted and not " +
      "required, and every member not listed is forbidden. It emits a canonical constraint and no native claim, so it " +
      "takes no verification and no obligation claim."
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
      `${requirementField("id")} or authored by a ${BATCH} row in the same save. A save carries ` +
      `${BATCH}, ${REMOVE_REQUIREMENTS} or both, and a supplied list is never empty. A claim that is one of several ` +
      `a saved requirement row emits together is retired with its whole row through ${REMOVE_REQUIREMENT_ROWS}.`,
    dependent_uses: "A parent or slice obligation whose explicit links and case support only retired requirements " +
      "is deleted. An affected obligation that also supports a remaining requirement, or that the same save amends, " +
      `is refused with its unit, obligation, case and identities; amend its ${obligationField("claims")} or case in ` +
      "the same save to keep the remaining meaning. Obligations with no retired link or case are unchanged.",
    bounds: Object.freeze({ ...ownerRetirement.bounds,
      answer_census: `each ${BATCH}.requirements row plus each ${REMOVE_REQUIREMENTS} entry, counted together; ${REMOVE_REQUIREMENT_ROWS} entries are bounded on their own` })
  })
});

const REQUIREMENT_BATCH = Object.freeze({
  field: BATCH,
  members: Object.freeze(Object.keys(batchSchema.properties)),
  entities: REQUIRED_OBJECT_SHAPES.referent.rule,
  requirements: `1-${batchSchema.properties.requirements.maxItems} rows, each one statement (subject, behavior, and its strength) or one closed membership ` +
    "(subject, membership). A modality, a relation's objects, an applicability its relation needs or an entity type left " +
    "out, and a number or boolean stated as {\"pending\": true}, save the row as incomplete: it keeps everything it says, " +
    "has no identity and no generated expression, and is completed by restating it with its row_id.",
  collections: "Groups of requirement rows. A member is \"$key\" of a row in this request or a saved row's row_id. A closed set " +
    "has no order; an ordered sequence keeps the order given and takes no row stored as several statements.",
  unresolved: "Meaning no relation carries, word for word, with or without a reason. Supplied, it replaces the saved list; " +
    "omitted, the saved list stays. It keeps the saved meaning incomplete and is never compiled.",
  row_addressing: Object.freeze({ selectors: ROW_SELECTORS, rule: "A row carries at most one of them.",
    key: "A new row, labelled for this request.",
    row_id: "A saved requirement row as a whole: its meaning, or only its source passage, is restated.",
    id: "One saved requirement claim to correct, as before. A claim that is one of several its row emits is corrected through row_id." }),
  emitted_identities: "A complete statement row emits one canonical constraint and one native claim per object where its relation is a " +
    "set of pairs, otherwise one of each. A closed membership emits one constraint and no claim. An incomplete row emits none. " +
    "A save answer's requirement_rows and bindings.requirement state row_id, state, constraint_ids and claim_ids as full arrays. " +
    "\"$key\" in changes.obligations[].claims is every claim the row emits; a row that emits none is refused there.",
  correction: "Restating a row keeps every claim both declarations emit, with its links; a claim only the old declaration " +
    "emitted retires under the retirement rules, and a claim only the new one emits is new. Nothing is rebound from an old " +
    "member to a new one.",
  source_link: Object.freeze({ members: Object.freeze(["user_requirement", "user_requirement_occurrence"]),
    source: `the work item's ${REQUIREMENT_SOURCE_FIELD} as this same save leaves it`,
    matching: "The passage is compared exactly: no trimming, case folding or normalization. Occurrences are counted from 1, " +
      "left to right, overlapping occurrences included.",
    occurrence: "A passage that occurs once needs no occurrence. One that occurs more than once needs " +
      "user_requirement_occurrence; none is guessed. A passage that is not found, or an occurrence out of range, refuses the whole save.",
    stored: `The passage, the chosen occurrence, the digest of the source text and the location in ${REQUIREMENT_SOURCE_LOCATION_UNIT}, ` +
      "linked to every constraint and claim the row emits.",
    currentness: "A link is current while the source text is unchanged. After the text changes it is reported stale, as saved, " +
      "until the row is restated with user_requirement. Omitting user_requirement keeps a saved link and creates none.",
    meaning: "Provenance only. It changes no identity and no generated expression, and does not establish that the passage " +
      "and the compiled meaning say the same thing." }),
  generated: "Canonical constraints, renderings, generated CEL and its typed bindings are derived from the saved rows. No member " +
    "takes an expression, and saving evaluates none.",
  tier: Object.freeze({ members: Object.freeze(RECORD_AUTHORING_REQUIREMENT_MEMBERS.map((member) => `changes.${member}`)),
    rule: "These members compile, restate or retire controlled requirements and are provided by the paid tier only. The tier is " +
      "the serving host's own configuration; no request member states it. Every other member saves at any tier." }),
  remove_rows: Object.freeze({ field: REMOVE_REQUIREMENT_ROWS,
    rule: "Removes whole saved requirement rows, or saved collections, by the row identity a save issued. A claim only a removed " +
      "row emitted retires under the retirement rules; a collection that still lists a removed row refuses the save." })
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
      "or cases. A proof-backed obligation states changes.obligations[].claims, case.id and criteria, restates " +
      "neither changes.requirements nor a case body, and selects the proof that saved case verifies in " +
      "changes.obligations[].proof.name. An obligation that selects no proof stays saved as an undecided draft " +
      "and covers no criterion.",
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
  { from: "changes.obligations[].claims", to: `${requirementField("key")}, or a saved requirement's claim_id`,
    meaning: "The obligation supports each requirement claim it names; a row label names every claim its row emits. " +
      association.eligible },
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
  { from: "changes.obligations[].case.verification", to: requirementField("verification.key"),
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
    "owner issued, never to the row's text. A saved answer's bindings map every key to that identity; a " +
    "requirement row's key maps to its row_id with the full constraint_ids and claim_ids it emits.",
  requirement_batch: REQUIREMENT_BATCH,
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
    "changes.obligations[].case.verification", "changes.dispositions[].entry.id", `${BATCH}.collections[].members[]`]),
  associations: ASSOCIATIONS,
  slice_coverage: SLICE_COVERAGE,
  not_authored_here: `Requirement notes and residue are not authored through ${SAVE_TOOL}: changes has no ` +
    `member for either. Meaning no relation carries is authored under ${BATCH}.unresolved and is kept with the unit's requirement rows.`
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
  shapes: "required_object_shapes holds each named shape; authoring_vocabulary states every behavior, fails_when and observes relation with its exact allowed positions and complete definitions."
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

export const REQUIREMENT_BATCH_SCHEMA_TOPIC = "requirement_batch_schema";
const REQUIREMENT_BATCH_SCHEMA = workItemRequirementBatchSchema("birth");

export const REQUIREMENT_AUTHORING_GUIDANCE = Object.freeze({
  schema_version: "requirement-authoring-guidance.v1",
  overview: `Author contract requirements through ${SAVE_TOOL} ${BATCH}, one batch of entities, requirement rows, ` +
    "collections and unresolved meaning; save_record_inputs.requirement_batch states its members, row addressing and " +
    `exact source links. ${CONTROLLED_CONTRACT_REQUIREMENT_FIELD_GUIDANCE} Select one topic at a time: fields explains subject, ` +
    "behavior, observes and fails_when; required_object_shapes holds the referent, statement and verification " +
    "shapes; authoring_vocabulary holds the complete job vocabulary, sharing signatures and stating their allowed " +
    "behavior, fails_when and observes positions, including observation-only reference:covers. vocabulary and " +
    "observation_vocabulary answer the separate position questions. cel_definitions indexes pinned CEL " +
    "language, CEL Java extension and local application definitions for selected reads; save_record_inputs states which " +
    "changes member takes each saved identity and how an obligation's claims, criteria, proof and case associate; " +
    "case_authoring holds the complete general test-case guidance; ['case_authoring','family',<chosen family>] " +
    "holds common semantics and the complete explicitly chosen family's instructions. Proof discovery offers that call " +
    "when target_family is explicit. unresolved_coverage explains what to author when a proof, " +
    "family or falsifier is missing, which is never a reason to leave controlled authoring; " +
    `${REQUIREMENT_BATCH_SCHEMA_TOPIC} is the complete declaration of a new record's requirement batch. Reading guidance ` +
    "and saving execute no proof and establish no readiness.",
  save_record_inputs: SAVE_RECORD_INPUTS,
  [AUTHORING_VOCABULARY_TOPIC]: deriveAuthoringJobVocabulary({ behavior: OWNER.vocabulary,
    fails_when: OWNER.vocabulary, observes: OWNER.observation_vocabulary }),
  fields: FIELDS,
  cel_definitions: Object.freeze({ ...OWNER.cel_definitions,
    read: "Select ['cel_definitions','operations',<returned key>] or ['cel_definitions','relations',<returned term>] with this reference, or request that exact topic to obtain its selected context.",
    next_calls: Object.freeze([
      guidanceRead("cel_definitions", "operations", "cel.eq"),
      guidanceRead("cel_definitions", "relations", "reference:supports")
    ]) }),
  unresolved_coverage: UNRESOLVED_COVERAGE,
  [REQUIREMENT_BATCH_SCHEMA_TOPIC]: REQUIREMENT_BATCH_SCHEMA,
  ...Object.fromEntries(OWNER_MEMBERS.map((member) => [member, member === "required_object_shapes"
    ? REQUIRED_OBJECT_SHAPES : member === "case_authoring" ? CASE_AUTHORING : OWNER[member]]))
});

export const REQUIREMENT_AUTHORING_GUIDANCE_TOPICS = Object.freeze(Object.keys(REQUIREMENT_AUTHORING_GUIDANCE)
  .filter((member) => !["schema_version", "overview"].includes(member)).map((member) => Object.freeze([member])));

export const REQUIREMENT_BATCH_SCHEMA_ENTRY_STATEMENT =
  `${READ_TOOL} ${JSON.stringify({ subject: { ...REQUIREMENT_GUIDANCE_SUBJECT, topic: [REQUIREMENT_BATCH_SCHEMA_TOPIC] } })}`;

export const REQUIREMENT_AUTHORING_GUIDANCE_REVISION = inputContractSourceDigest(REQUIREMENT_AUTHORING_GUIDANCE);

export function requirementCaseFamilySelections(path) {
  return path[0] === "case_authoring" ? caseFamilySelections(CASE_AUTHORING)
    .filter(selection => JSON.stringify(selection.guidance) !== JSON.stringify(path)) : [];
}

export function resolveRequirementAuthoringGuidance(path) {
  if (path[0] === "case_authoring" && path[1] === CASE_FAMILY_TOPIC) {
    const family = path[2];
    if (path.length !== 3 || !Object.hasOwn(CASE_AUTHORING.families, family)) return { ok: false,
      code: "case_guidance_family_not_supported", segment_index: 2, resolved_path: path.slice(0, 2),
      expected: `one explicit supported family: ${Object.keys(CASE_AUTHORING.families).join(", ")}` };
    return { ok: true, value: deriveCaseFamilyGuidance(CASE_AUTHORING, family,
      familyAuthoringFacts(CASE_AUTHORING, family)) };
  }
  if (path[0] === "cel_definitions" && path.length >= 3) {
    const [, group, key, ...rest] = path;
    const index = OWNER.cel_definitions;
    if (!["operations", "relations"].includes(group)) return { ok: false,
      code: "cel_definition_selection_not_found", segment_index: 1, resolved_path: ["cel_definitions"],
      expected: `operations or relations; missing ${JSON.stringify(group)}` };
    const exists = group === "operations" ? Object.hasOwn(index.operations, key)
      : group === "relations" && index.relations.includes(key);
    if (!exists) return { ok: false, code: "cel_definition_selection_not_found", segment_index: 2,
      resolved_path: path.slice(0, 2), expected: `a ${group} key returned by the cel_definitions index; missing ${JSON.stringify(key)}` };
    const value = selectCelDefinition([group, key]);
    const links = value.prerequisites ?? value.cel_operations;
    const result = resolveToolInputGuidancePath({ ...value,
      next_calls: (links.length ? links : [[]]).map(selection => guidanceRead("cel_definitions", ...selection)) }, rest);
    return result.ok ? result : { ...result, segment_index: result.segment_index + 3,
      resolved_path: [...path.slice(0, 3), ...result.resolved_path] };
  }
  return resolveToolInputGuidancePath(REQUIREMENT_AUTHORING_GUIDANCE, path);
}

export function requirementGuidanceRecoveryCall(ownerPath) {

  if (!Array.isArray(ownerPath) || ![...OWNER_MEMBERS, AUTHORING_VOCABULARY_TOPIC, "unresolved_coverage", "save_record_inputs"].includes(ownerPath[0]) ||
      !resolveRequirementAuthoringGuidance(ownerPath).ok) return null;
  return buildNextCall({ tool: READ_TOOL, recommended: true,
    arguments: { subject: { ...REQUIREMENT_GUIDANCE_SUBJECT, topic: [...ownerPath] } } });
}
