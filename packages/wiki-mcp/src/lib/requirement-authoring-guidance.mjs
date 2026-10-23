import { DEFAULT_EXCEPTION_PUBLICATION } from "@agent-chassis/wiki-core/src/lib/controlled-acceptance-publication-config.mjs";
import { REQUIREMENT_SCHEMA_TOPIC, REQUIREMENT_SCHEMA_METADATA, requirementSchemaDetail, requirementSchemaIdentity, requirementSchemaBranch } from "./requirement-authoring-schema-guidance.mjs";
import { COMPACT_RECORD_PATTERN, PLANNED_OPERATION_PATTERN } from './requirement-authoring-patterns.mjs';
import { recordAuthoringAvailability } from "@agent-chassis/wiki-core/src/lib/record-authoring-availability.mjs";

import {
  CONTROLLED_CONTRACT_REQUIREMENT_FIELD_GUIDANCE,
  CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE as OWNER
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { RECORD_AUTHORING_LABEL_PATTERN, workItemRequirementBatchSchema } from
  "@agent-chassis/wiki-core/src/lib/record-authoring-schema.mjs";
import { RECORD_AUTHORING_REQUIREMENT_MEMBERS } from "@agent-chassis/wiki-core/src/lib/record-authoring-availability.mjs";
import { selectCelDefinition } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/contract-requirement-vocabulary.mjs";

import { CONTRACT_ASSESSMENT_ROUTE as ASSESS_TOOL } from "./controlled-contract-query-context.mjs";
import { authoredFalsificationFacts, familyAuthoringFacts, familyChoiceFacts } from "./proof-discovery-response.mjs";
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
  `${READ_TOOL} ${JSON.stringify({ reads: [{ subject: REQUIREMENT_GUIDANCE_SUBJECT }] })}`;

export const REQUIREMENT_VOCABULARY_ENTRY_STATEMENT =
  `${READ_TOOL} ${JSON.stringify({ reads: [{ subject: { ...REQUIREMENT_GUIDANCE_SUBJECT, topic: [AUTHORING_VOCABULARY_TOPIC] } }] })}`;

const OWNER_MEMBERS = Object.freeze(["required_object_shapes", "conditional_verification_requirements",
  "runtime_test_authoring", "vocabulary", "observation_vocabulary", "native_runtime_test_vocabulary", "case_authoring"]);

const mandatoryVerification = OWNER.conditional_verification_requirements
  .find((rule) => rule.requires.includes("verification"));
const { requirement: requirementShape, verification: verificationShape } = OWNER.required_object_shapes;
const BATCH = "changes.requirements";
const requirementField = (member) => `${BATCH}.requirements[].${member}`;
const obligationField = (member) => `changes.obligations[].${member}`;
const REMOVE_REQUIREMENTS = "changes.remove.requirements";

const batchSchema = workItemRequirementBatchSchema();
const statementRow = batchSchema.$defs.requirement;
const membershipRow = batchSchema.$defs.membership_requirement;
const ROW_SELECTORS = Object.freeze(["key", "target"]);
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
      "requirement row already binds keeps that binding without redeclaration: a declaration that agrees is accepted and one that differs is refused. " +
      "For verifier-only aliases not held by a saved row, include a matching declaration in each batch using them, including its type and identity; no extra save is needed."
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
    requires: Object.freeze([requirementField("target")])
  }),
  requirement_retirement: Object.freeze({
    ...ownerRetirement,
    field: REMOVE_REQUIREMENTS,
    selection: 'Select each saved requirement or behavioral part by authored meaning, once. A grouped declaration must be removed as a whole unless its existing integrity rules permit the narrower correction. A supplied list is never empty.',
    dependent_uses: "For explicit removal only, a parent or slice obligation whose explicit links and case support only retired requirements " +
      "is deleted. An affected obligation that also supports a remaining requirement, or that the same save amends, " +
      `is refused with its unit, obligation, case and identities; amend its ${obligationField("claims")} or case in ` +
      "the same save to keep the remaining meaning. Obligations with no retired link or case are unchanged.",
    bounds: Object.freeze({ ...ownerRetirement.bounds,
      answer_census: 'Submitted declarations and individual assertion removals share the existing batch bound; whole-declaration and collection removals retain their separate bounds.' })
  })
});

const guidanceRead = (...topic) => buildNextCall({ tool: READ_TOOL,
  arguments: { reads: [{ subject: { ...REQUIREMENT_GUIDANCE_SUBJECT, topic } }] } });

const REQUIREMENT_BATCH = Object.freeze({
  field: BATCH,
  compact_pattern_read: guidanceRead("compact_record_comparison"),
  compact_pattern_applicability: COMPACT_RECORD_PATTERN.applicability,
  schema_read: guidanceRead(REQUIREMENT_SCHEMA_TOPIC, "existing"),
  schema_selection: REQUIREMENT_SCHEMA_METADATA.selection,
  batching: "Append new declarations with optional request-local key. Restate saved meaning with target. Preserve applicability, observation boundaries, source links and unresolved meaning. Include declarations used by this batch; existing entity bindings cannot be retyped.",
  members: Object.freeze(Object.keys(batchSchema.properties)),
  entities: REQUIRED_OBJECT_SHAPES.referent.rule,
  requirements: "Statements, typed definitions and closed memberships retain every supplied field. Missing required meaning remains an incomplete draft. Target that draft by its known authored meaning when completing it.",
  collections: "A member is a request-local $key or a whole requirement selector. A closed set is unordered; ordered_sequence preserves the authored order. Target a saved collection by its kind, purpose or semantically selected members.",
  unresolved: "Meaning the grammar cannot carry stays explicit. Supplied: replaces the saved list. Omitted: retains it.",
  row_addressing: Object.freeze({ selectors: ROW_SELECTORS, rule: "Use at most one of key and target.",
    key: "A new declaration, labelled only within this request.",
    target: "Select one saved declaration by its authored meaning and restate it completely. A requirement target selects the whole declaration, including drafts and grouped assertions. A claim target selects one behavioral part and preserves grouped-correction restrictions. Ambiguity requires a narrower public target; unresolved targets never create." }),
  associations: "Use requirement, claim or verification selectors in obligations[].claims. A whole requirement selects all its assertions, without adding its verifications. Use an explicit verification selector when intended. Same-request $key associations are resolved by the server. Receipts contain only necessary new public identities; later saves reuse semantic targets.",
  correction: "A restatement preserves unchanged assertions. Changed assertions require explicit compatible dependency amendments under the existing integrity rules. Select saved requirements/verifications by authored meaning and saved cases/obligations by public identity. No association or proof credit is inferred. Source and revision movement never silently retargets an amendment.",
  source_link: Object.freeze({ members: Object.freeze(["user_requirement", "user_requirement_occurrence"]),
    source: "the work item's sections.user_requirements as this save leaves it",
    matching: "Compare exact literal passages without trimming or case folding; count overlapping occurrences from one.",
    occurrence: "Choose user_requirement_occurrence when the exact passage repeats. Missing passages and out-of-range occurrences refuse the coherent save.",
    currentness: "A saved source link becomes stale when source text changes. Restate it with the intended passage to repair it; omission preserves the saved link.",
    repair: Object.freeze({
      intent: "Target the saved whole declaration and preserve its complete behavior, applicability, verification and intended associations while changing the source link.",
      read: "If meaning is missing, request requirements with include:[verifications,dependencies] and all affected obligations together in workspace_read_wiki reads. Use the known semantic target and request for_changes for the writable unit. Do not acquire internal addresses.",
      payload: "Reuse the requested authored meaning and declared entity identities. The caller chooses the new exact user_requirement passage and any repeated occurrence; a case target never substitutes for verification meaning.",
      save: "Save the full declaration with target at the returned current revision. Reconcile a stale revision. Successful correction can finish; inspection and reassessment are conditional on the requested task.",
      limit: "If required saved meaning is unavailable, preserve that specific failure and stop the dependent edit. Do not guess or omit a missing verification."
    }) }),
  authorization: Object.freeze({ members: Object.freeze(RECORD_AUTHORING_REQUIREMENT_MEMBERS.map(member => "changes." + member)),
    rule: "The serving host authorizes requirement authoring and removal; availability grants no permission." }),
  remove_rows: Object.freeze({ field: REMOVE_REQUIREMENTS,
    collections_field: "changes.remove.collections",
    rule: "Remove a whole requirement or one permitted behavioral part by semantic selector; remove a collection with its collection selector. Existing dependency and grouped-assertion integrity remains enforced. A surviving collection cannot retain a removed member." })
});

const SLICE_COVERAGE = Object.freeze({
  steps: Object.freeze([
    "A slice needs its own criterion-to-obligation associations: a parent's obligations, criterion labels and " +
      "coverage transfer none to it, and a slice is covered only by obligations saved on that slice unit.",
    'Read the slice criteria and all needed parent requirement/case meaning together in workspace_read_wiki reads. Request for_changes for the writable slice to obtain its current revision.',
    'Select parent requirements by known authored meaning and cases by public case identity only where the author judges that they apply. The server resolves associations; no compiler-identity acquisition is needed.',
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
  field: `changes.${ownerAssociation.authoring.field}`,
  cardinality: ownerAssociation.cardinality,
  authoring: { choose_when: 'Several eligible verifications require an explicit semantic choice.',
    omit_when: 'The established case association already identifies its eligible verification.' },
  eligible: 'A test_execution verification associated with the same obligation, explicitly or through a selected requirement. Executability grants no additional association.',
  correction: 'Use semantic selectors or same-request keys in obligations[].claims. Choose among eligible verifications with case.verification; the server resolves its internal binding.',
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
  { from: "changes.obligations[].claims", to: 'A semantic requirement, claim or verification selector, or a same-request $key',
    meaning: "The obligation supports each requirement claim it names; a row label names every claim its row emits. " +
      association.eligible },
  { from: "changes.obligations[].criteria", to: "changes.criteria[].key, or a saved criterion's semantic selector",
    meaning: "The obligation covers each criterion it names. A unit's criterion is covered only by an obligation " +
      "saved on that same unit." },
  { from: "changes.obligations[].proof.name", to: `a proof ${FIND_TOOL} lists`,
    meaning: "Selects the checking route of the obligation: " +
      `${OWNER.unresolved_coverage.record.obligation_fields.proof_name}. The selected proof's own authoring ` +
      "answer separates selection inputs from the complete case needed for execution. Omit an " +
      "unknown case rather than supply an incomplete one; supplied case defects remain authoring defects." },
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
    `${READ_TOOL} reads with for_changes or of a prior save answer. Omitted changes members are preserved.`,
  labels: 'A new declaration may carry key for same-request associations. A saved requirement or collection uses target with its complete authored meaning. Saved obligations use id; shared cases use case.id. Receipts expose only newly issued public identities. Later saves reuse semantic selectors, without acquiring internal bindings.',
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
    ["Semantic requirement/claim/verification selection", obligationField("claims")],
    ["obligations[].acceptance_criteria", obligationField("criteria")],
    ["obligations[].selection.proof_name", obligationField("proof.name")],
    ["cases[].case_id", `${obligationField("case.id")}, or key for a new case`],
    ["Semantic verification selection", obligationField("case.verification")]
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
  shapes: "required_object_shapes holds each named shape; authoring_vocabulary supplies the selected relation signatures and their exact allowed positions; follow its shared selected-definition route for canonical meaning."
});

const { next_calls: _ownerNavigation, record: ownerRecord, ...unresolvedCoverage } = OWNER.unresolved_coverage;
const ownerObligationFields = ownerRecord.obligation_fields;

const UNRESOLVED_COVERAGE = Object.freeze({
  applies_when: unresolvedCoverage.applies_when,

  record: Object.freeze({ controlled_acceptance: ownerRecord.controlled_acceptance,
    obligation_fields: Object.freeze({ statement: ownerObligationFields.statement + " Use a faithful trimmed single-line statement: no surrounding whitespace, CR or LF. Leave user_requirements and exact source links unchanged.",
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

function withRelationDefinitionReads(vocabulary) {
  return Object.freeze({ ...vocabulary,
    relation_definition_read: guidanceRead("cel_definitions"),
    relation_definition_selection: "Use the returned reference with select:{guidance:['cel_definitions','relations',row.term]} to read the selected row's complete canonical definition, semantic references, observations and lowering." });
}

export const REQUIREMENT_AUTHORING_GUIDANCE = Object.freeze({
  schema_version: "requirement-authoring-guidance.v1",
  overview: `Author contract requirements through ${SAVE_TOOL} ${BATCH}, one batch of entities, requirement rows, ` +
    "collections and unresolved meaning. Select compact_record_comparison.planned_operation for typed result relationships; compact_record_comparison projects only protected fields with shared applicability and observation boundaries. save_record_inputs.requirement_batch states its members, row addressing and " +
    `exact source links. ${CONTROLLED_CONTRACT_REQUIREMENT_FIELD_GUIDANCE} Combine needed topics in one bulk read: fields explains subject, ` +
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
    "['requirement_schema','birth'] is the complete declaration of a new record's requirement batch. Reading guidance " +
    "and saving execute no proof and establish no readiness.",
  save_record_inputs: SAVE_RECORD_INPUTS,
  compact_record_comparison: COMPACT_RECORD_PATTERN,
  [REQUIREMENT_SCHEMA_TOPIC]: { kind: "index", contexts: ["existing", "birth"], read: "Select [requirement_schema, context] for one complete batch, or append a definition name for its complete transitive closure." },
  [AUTHORING_VOCABULARY_TOPIC]: withRelationDefinitionReads(deriveAuthoringJobVocabulary({ behavior: OWNER.vocabulary,
    fails_when: OWNER.vocabulary, observes: OWNER.observation_vocabulary })),
  fields: FIELDS,
  cel_definitions: Object.freeze({ ...OWNER.cel_definitions,
    read: "Select ['cel_definitions','operations',<returned key>] or ['cel_definitions','relations',<returned term>] with this reference, or request that exact topic to obtain its selected context.",
    next_calls: Object.freeze([
      guidanceRead("cel_definitions", "operations", "cel.eq"),
      guidanceRead("cel_definitions", "relations", "reference:supports")
    ]) }),
  unresolved_coverage: UNRESOLVED_COVERAGE,
  ...Object.fromEntries(OWNER_MEMBERS.map((member) => [member, member === "required_object_shapes"
    ? REQUIRED_OBJECT_SHAPES : member === "case_authoring" ? CASE_AUTHORING
      : ["vocabulary", "observation_vocabulary"].includes(member)
        ? withRelationDefinitionReads(OWNER[member]) : OWNER[member]]))
});

export const REQUIREMENT_AUTHORING_GUIDANCE_TOPICS = Object.freeze(Object.keys(REQUIREMENT_AUTHORING_GUIDANCE)
  .filter((member) => !["schema_version", "overview"].includes(member)).map((member) => Object.freeze([member])));

const TOPIC_CHOICES = Object.freeze({
  save_record_inputs: ['Save member addressing, labels and associations.', 'Mapping authored changes to saved meaning.', 'Object shapes describe values; this topic explains their save bindings.'],
  compact_record_comparison: ['Protected-field comparison patterns and their observation boundaries.', 'Expressing preservation or a planned result relationship.', 'Reuses typed vocabulary and schemas; not a general case or grammar inventory.'],
  requirement_schema: ['Complete requirement-batch schemas for existing or new records, including reachable definitions.', 'Needing exact batch grammar; existing and birth are direct choices.', 'For multiple save/create members use that known unit/kind’s input_contract; semantic guidance is separate.'],
  authoring_vocabulary: ['Combined relation signatures with behavior, fails_when and observes permissions.', 'Choosing terms across statement positions; capability subsets are direct choices.', 'Includes vocabulary and observation_vocabulary signatures once; reading those as well repeats meaning.'],
  fields: ['Meaning of subject, behavior, verifier, observes and fails_when.', 'Deciding which statement field carries the intended meaning.', 'Shapes supply structures; vocabulary supplies accepted terms.'],
  cel_definitions: ['Complete index of canonical relation and CEL definitions with selected-definition reads.', 'Needing a term’s semantics or upstream language definition.', 'Vocabulary already supplies signatures and allowed positions, not these full definitions.'],
  unresolved_coverage: ['What remains to author when a proof, family or falsifier is missing.', 'Recording unfinished controlled meaning without inventing coverage.', 'Links to case and save guidance; does not supply a chosen family or waive required work.'],
  required_object_shapes: ['Referent, statement and verification structures and dependency rules.', 'Constructing authored values; capability subsets are direct choices.', 'Schemas supply exact grammar; fields explain intent; vocabulary supplies terms.'],
  conditional_verification_requirements: ['Rules for when a statement requires verification.', 'Deciding whether verification must be authored.', 'Fields includes its main verification rule; this is the complete conditional-rule inventory.'],
  runtime_test_authoring: ['Runtime-test declaration and association rules.', 'Authoring saved runtime-test meaning.', 'Native runtime vocabulary lists values; chosen case-family guidance supplies executable case instructions.'],
  vocabulary: ['Accepted behavior/fails_when terms and signatures.', 'Only needing those statement positions.', 'The combined authoring_vocabulary includes these and observation signatures; capability subsets narrow that combined view.'],
  observation_vocabulary: ['Accepted observation terms and signatures.', 'Only needing observes-position vocabulary.', 'Included in combined authoring_vocabulary; avoid both for the same term population.'],
  native_runtime_test_vocabulary: ['Accepted native runtime-test values.', 'Choosing values for a runtime-test declaration.', 'Runtime-test authoring supplies rules; case-family guidance supplies target and falsifier instructions.'],
  case_authoring: ['Complete shared case rules, all families, target variants and falsifiers.', 'Comparing families or explicitly needing the full inventory.', 'A family selection already includes shared rules and that family’s complete target/falsifier instructions; general is unnecessary for one chosen family.'],
  ordinary_authoring: ['Ordinary prose, criteria, validation, scope and slice authoring routes.', 'Authoring in a session without requirement compilation.', 'Saved contract meaning remains readable; this guidance supplies no compilation capability or exemption.']
});

export function requirementGuidanceDiscovery(registeredTier, exceptionPublication = DEFAULT_EXCEPTION_PUBLICATION) {
  const guidance = sessionRequirementAuthoringGuidance(registeredTier, exceptionPublication);
  const topics = Object.keys(guidance).filter(member => !['schema_version', 'overview'].includes(member));
  const selections = topics.map(topic => ({ guidance: [topic] }));
  const meaning = { topics: Object.fromEntries(topics.map(topic => {
    const description = TOPIC_CHOICES[topic];
    if (!description) throw new Error(`requirement_guidance_choice_description_missing: ${topic}`);
    const [supplies, when, overlap] = description;
    return [topic, { supplies, when, overlap }];
  })) };
  if (recordAuthoringAvailability(registeredTier).compile_requirements) {
    selections.push(...caseFamilySelections(CASE_AUTHORING),
      ...['authoring_vocabulary', 'required_object_shapes'].flatMap(topic => REQUIREMENT_SCHEMA_METADATA.presets
        .map(scope => ({ guidance: [topic, 'capabilities', ...scope] }))),
      ...guidance.requirement_schema.contexts.map(context => ({ guidance: [REQUIREMENT_SCHEMA_TOPIC, context] })));
    meaning.families = Object.fromEntries(familyChoiceFacts(CASE_AUTHORING).map(({ family_id, ...facts }) => {
      const family = CASE_AUTHORING.families[family_id];
      return [family_id, { ...facts, languages: family.languages, ...(family.provider ? { provider: family.provider } : {}) }];
    }));
    meaning.family_scope = 'Choose the intended family explicitly. Its selection includes shared case rules and only that family’s complete instructions; no general-case read is required.';
    meaning.capabilities = REQUIREMENT_SCHEMA_METADATA.capabilities;
    meaning.capability_topics = ['authoring_vocabulary', 'required_object_shapes'];
    meaning.capability_binding = 'Choose topic from capability_topics and nonempty distinct keys from capabilities; call {reads:[{reference,select:{guidance:[topic,"capabilities",...keys]}},...]} with this reference unchanged. The listed selections include common scopes; this same form accepts the explicitly chosen union.';
    meaning.capability_scope = 'Capability selections narrow both shapes and combined vocabulary. Choose the union of known needs; whole-topic selections retain every capability, including typed values. No capability is inferred.';
  }
  return { selections, meaning };
}

export const REQUIREMENT_BIRTH_SCHEMA_ENTRY_STATEMENT =
  `${READ_TOOL} ${JSON.stringify({ reads: [{ subject: { ...REQUIREMENT_GUIDANCE_SUBJECT, topic: [REQUIREMENT_SCHEMA_TOPIC, 'birth'] } }] })}`;

export const REQUIREMENT_AUTHORING_GUIDANCE_REVISION = requirementGuidanceRevision();
export function requirementGuidanceRevision(registeredTier = "paid_cce", detail = requirementSchemaIdentity(), exceptionPublication = DEFAULT_EXCEPTION_PUBLICATION) {
  return inputContractSourceDigest({ instructions: sessionRequirementAuthoringGuidance(registeredTier, exceptionPublication),
    discovery: requirementGuidanceDiscovery(registeredTier, exceptionPublication),
    ...(recordAuthoringAvailability(registeredTier).compile_requirements ? { detail, planned_operation: PLANNED_OPERATION_PATTERN } : {}) });
}

export function requirementCaseFamilySelections(path) {
  return path[0] === "case_authoring" ? caseFamilySelections(CASE_AUTHORING)
    .filter(selection => JSON.stringify(selection.guidance) !== JSON.stringify(path)) : [];
}

export function resolveRequirementAuthoringGuidance(path, registeredTier = "paid_cce", exceptionPublication = DEFAULT_EXCEPTION_PUBLICATION) {
  if (!recordAuthoringAvailability(registeredTier).compile_requirements) {
    const selected = resolveToolInputGuidancePath(sessionRequirementAuthoringGuidance(registeredTier, exceptionPublication), path);
    if (!selected.ok && Object.hasOwn(REQUIREMENT_AUTHORING_GUIDANCE, path[0])) return {
      ok: false, code: "record_authoring_operation_unavailable", operation: "compile_requirements", changed: false };
    return selected;
  }
  if (path[0] === 'compact_record_comparison' && path[1] === 'planned_operation') {
    return resolveToolInputGuidancePath({ compact_record_comparison: { planned_operation: PLANNED_OPERATION_PATTERN } }, path);
  }
  if (path[0] === REQUIREMENT_SCHEMA_TOPIC && path.length > 1) return requirementSchemaDetail(path.slice(1));
  if (path[0] === 'required_object_shapes' && path[1] === 'capabilities') {
    const projection = resolveRequirementAuthoringGuidance([AUTHORING_VOCABULARY_TOPIC, ...path.slice(1)], registeredTier, exceptionPublication);
    if (!projection.ok) return projection;
    if (!projection.value.scope) return { ok: true, value: REQUIRED_OBJECT_SHAPES };
    const schema = workItemRequirementBatchSchema('existing', path.slice(2));
    const shapes = Object.fromEntries(Object.entries(REQUIRED_OBJECT_SHAPES).map(([name, value]) => {
      const definition = schema.$defs[name === 'closed_membership' ? 'membership_requirement' : name];
      if (!definition?.properties || !value.optional_fields) return [name, value];
      return [name, { ...value, optional_fields: value.optional_fields.filter(field => Object.hasOwn(definition.properties, field)) }];
    }));
    return { ok: true, value: { ...shapes, scope: projection.value.scope } };
  }
  if (path[0] === AUTHORING_VOCABULARY_TOPIC && path[1] === "capabilities") {
    const requested = path.slice(2);
    let projection;
    try {
      projection = requirementSchemaBranch("existing").select({ properties: { requirements: {} } }, requested);
    } catch (error) {
      if (error.code !== 'requirements_capability_selection_invalid') throw error;
      return { ok: false, code: error.code, resolved_path: [AUTHORING_VOCABULARY_TOPIC], segment_index: 2,
        expected: 'nonempty distinct published requirement capability keys' };
    }
    const scoped = projection.scope;
    const vocabulary = REQUIREMENT_AUTHORING_GUIDANCE[AUTHORING_VOCABULARY_TOPIC];
    if (scoped === null) return { ok: true, value: vocabulary };
    const allowed = new Set(projection.terms);
    const rows = vocabulary.relation_details.filter(row => allowed.has(row.term));
    const accounting = Object.fromEntries(vocabulary.positions.map(position => {
      const count = rows.filter(row => row.positions.includes(position)).length;
      return [position, { ...vocabulary.relation_accounting[position], total: count, returned: count }];
    }));
    return { ok: true, value: { ...vocabulary, scope: scoped, relation_accounting: accounting, relation_details: rows } };
  }
  if (path[0] === "case_authoring" && path[1] === CASE_FAMILY_TOPIC) {
    const family = path[2];
    if (path.length !== 3 || !Object.hasOwn(CASE_AUTHORING.families, family)) return { ok: false,
      code: "case_guidance_family_not_supported", segment_index: 2, resolved_path: path.slice(0, 2),
      expected: `one explicit supported family: ${Object.keys(CASE_AUTHORING.families).join(", ")}` };
    return { ok: true, value: deriveCaseFamilyGuidance(CASE_AUTHORING, family,
      familyAuthoringFacts(CASE_AUTHORING, family)) };
  }
  if (path[0] === "cel_definitions" && path.length >= 3 && ["operations", "relations"].includes(path[1])) {
    const [, group, key, ...rest] = path;
    const index = OWNER.cel_definitions;
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
  const resolved = resolveToolInputGuidancePath(REQUIREMENT_AUTHORING_GUIDANCE, path);
  if (!resolved.ok || path[0] !== 'save_record_inputs') return resolved;

  const immediateBatch = batch => {
    const { correction: _correction, source_link: sourceLink, ...common } = batch;
    const { repair: _repair, ...source } = sourceLink;
    return { ...common, source_link: source };
  };
  if (path.length === 1) {
    const { slice_coverage: _slice, ...common } = resolved.value;
    return { ...resolved, value: { ...common, requirement_batch: immediateBatch(common.requirement_batch) } };
  }
  if (path.length === 2 && path[1] === 'requirement_batch') return { ...resolved, value: immediateBatch(resolved.value) };
  return resolved;
}

export function requirementGuidanceRecoveryCall(ownerPath, registeredTier = "paid_cce", exceptionPublication = DEFAULT_EXCEPTION_PUBLICATION) {
  if (!recordAuthoringAvailability(registeredTier).compile_requirements) return null;

  if (!Array.isArray(ownerPath) || ![...OWNER_MEMBERS, REQUIREMENT_SCHEMA_TOPIC, AUTHORING_VOCABULARY_TOPIC, "unresolved_coverage", "save_record_inputs", "compact_record_comparison"].includes(ownerPath[0]) ||
      !resolveRequirementAuthoringGuidance(ownerPath, registeredTier, exceptionPublication).ok) return null;
  return buildNextCall({ tool: READ_TOOL, recommended: true,
    arguments: { reads: [{ subject: { ...REQUIREMENT_GUIDANCE_SUBJECT, topic: [...ownerPath] } }] } });
}

export function sessionRequirementAuthoringGuidance(registeredTier, exceptionPublication = DEFAULT_EXCEPTION_PUBLICATION) {
  if (recordAuthoringAvailability(registeredTier).compile_requirements) return REQUIREMENT_AUTHORING_GUIDANCE;
  return Object.freeze({ schema_version: REQUIREMENT_AUTHORING_GUIDANCE.schema_version,
    overview: "Preserve the full user request as user_requirements prose. Author criteria, validation, exact scopes and slices through save_record. Reading and saving establish no implementation readiness or proof credit.",
    ordinary_authoring: Object.freeze({
      request: "save_record {unit, revision, changes}. When grammar is missing, read the known unit directly with workspace_read_wiki {reads:[{subject:<unit>,select:{input_contract:{tool:'save_record',members:[...needed members]}}}]}. Request for_changes on the Read only when a current write revision is needed.",
      members: ["user_requirements", "criteria", "validation", "read_scope", "write_scope", "repo_paths", "slices", "ready_slices"],
      required_work: "Required controlled acceptance retains its full meaning and required disposition when compilation is unavailable; record the limitation and do not describe it as ready.",
      applicability: exceptionPublication.applicability("The author independently chooses whether controlled acceptance applies. A deliberate opt-out states a nonempty unassessed rationale, earns zero proof credit and waives no native tests, review or repository policy. Missing capability never chooses exemption."),
      saved_meaning: "Read saved requirements, obligations and cases through the unit's saved contract selections. Unavailable compilation does not remove or censor saved meaning."
    }) });
}

export function requirementGuidanceDetailNavigation(path) {
  if (path[0] === "save_record_inputs") return [
    { selection: { guidance: ["compact_record_comparison"] }, recommended: true },
    { selection: { guidance: [REQUIREMENT_SCHEMA_TOPIC, "existing"] }, recommended: path.length > 1 },
    ...((path.length === 1 || path.length === 2 && path[1] === 'requirement_batch') ? [
      { selection: { guidance: ['save_record_inputs', 'requirement_batch', 'correction'] },
        information: 'Correct saved requirement meaning and migrate existing verification, case and obligation dependencies explicitly.' },
      { selection: { guidance: ['save_record_inputs', 'requirement_batch', 'source_link', 'repair'] },
        information: 'Repair a saved source link through complete authored-row and verification reads; preserve the saved meaning.' },
      { selection: { guidance: ['save_record_inputs', 'slice_coverage'] },
        information: 'Author slice-local coverage using an applicable saved parent requirement and case; no coverage is inherited.' }
    ] : [])];
  return [];
}
