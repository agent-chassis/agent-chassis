export {
  CARRIER_TARGETS,
  diffControlledContractCarrierContent,
  getControlledContractNodeSpills,
  getControlledContractProjectionSpills,
  getControlledContractSelectedPopulation,
  projectControlledContractCarrierQuery as queryControlledContractCarrierContent
} from "./controlled-contract-authoring-projections.mjs";

export {
  ACCEPTANCE_COVERAGE_AXES,
  ACCEPTANCE_COVERAGE_STATES,
  deriveControlledContractAcceptanceCoverage,
  queryControlledContractAcceptanceCoverage
} from "./controlled-contract-acceptance-coverage.mjs";

import {
  CARRIER_TARGETS,
} from "./controlled-contract-authoring-projections.mjs";
import {
  ACCEPTANCE_COVERAGE_STATES
} from "./controlled-contract-acceptance-coverage.mjs";
import {
  CONTROLLED_CONTRACT_FOCUS_GRAMMAR,
  ControlledContractToolError,
  assertControlledContractOperationInput as assertControlledContractOperationInputBase,
  controlledContractFocusCause,
  isCanonicalFocusSlug,
} from "./controlled-contract-tool-shared.mjs";

export { CONTROLLED_CONTRACT_FOCUS_GRAMMAR } from
  "./controlled-contract-tool-shared.mjs";

export const CONTROLLED_CONTRACT_CARRIER_QUERY_TARGETS = Object.freeze(
  [...new Set(Object.values(CARRIER_TARGETS).flatMap((targets) => Object.keys(targets)))].sort()
);

export const CONTROLLED_CONTRACT_PROOF_PACK_SELECTION_RESULT_SCHEMA_VERSION =
  "controlled-contract-proof-pack-selection.v4";

const ACCEPTANCE_COVERAGE_CARRIER_IDENTITY = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["carrier_kind", "wk_id", "focus", "selected_unit", "content_digest"],
  properties: {
    carrier_kind: { const: "controlled-acceptance" },
    wk_id: { type: "string", pattern: "^WK-[0-9]{4}$" },
    focus: { oneOf: [
      { type: "null" },
      { type: "string", pattern: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.pattern }
    ] },
    selected_unit: { oneOf: [
      { type: "null" },
      { type: "string", pattern: "^SLICE-[0-9]{3,}$" }
    ] },
    content_digest: { oneOf: [
      { type: "null" },
      { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
    ] }
  }
});

const ACCEPTANCE_COVERAGE_SOURCE_IDENTITY = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["source_kind", "content_digest"],
  properties: {
    source_kind: { const: "obligation-coverage" },
    content_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
  }
});

const ACCEPTANCE_COVERAGE_ROW = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["criterion_identity", "node_ids", "axes"],
  properties: {
    criterion_identity: { type: "string", minLength: 1 },
    node_ids: { type: "array", items: { type: "string", minLength: 1 } },
    axes: { type: "object", additionalProperties: false, required: [
      "authored_contract_coverage", "structural_verification",
      "selected_pack_guarantee_coverage", "implementation_ownership",
      "verification_ownership", "scope_feasibility"
    ], properties: {
      authored_contract_coverage: { enum: ACCEPTANCE_COVERAGE_STATES },
      structural_verification: { enum: ACCEPTANCE_COVERAGE_STATES },
      selected_pack_guarantee_coverage: { enum: ACCEPTANCE_COVERAGE_STATES },
      implementation_ownership: { enum: ACCEPTANCE_COVERAGE_STATES },
      verification_ownership: { enum: ACCEPTANCE_COVERAGE_STATES },
      scope_feasibility: { enum: ACCEPTANCE_COVERAGE_STATES }
    } }
  }
});

const ACCEPTANCE_COVERAGE_COMMON_INPUT_PROPERTIES = Object.freeze({
  repo: { type: "string", minLength: 1 },
  unit: { type: "string", pattern: "^WK-[0-9]{4}(?:#SLICE-[0-9]{3,})?$" },
  focus: { type: "string", pattern: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.pattern }
});

const COVERAGE_ROW_SLOT_IDENTITY = Object.freeze({
  type: "string", pattern: "^ccrs_[0-9a-f]{64}$"
});

const ACCEPTANCE_COVERAGE_AUTHORED_ROW = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["row_slot_identity", "node_ids", "axes"],
  properties: {
    row_slot_identity: COVERAGE_ROW_SLOT_IDENTITY,
    node_ids: ACCEPTANCE_COVERAGE_ROW.properties.node_ids,
    axes: ACCEPTANCE_COVERAGE_ROW.properties.axes
  }
});

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_ROW_AUTHORING_SCHEMA =
  Object.freeze({ type: "object", additionalProperties: false,
    required: ["unit", "carrier_identity", "source_identity",
      "expected_unit_digest", "expected_content_digest"],
    properties: {
      ...ACCEPTANCE_COVERAGE_COMMON_INPUT_PROPERTIES,
      carrier_identity: ACCEPTANCE_COVERAGE_CARRIER_IDENTITY,
      source_identity: ACCEPTANCE_COVERAGE_SOURCE_IDENTITY,
      expected_unit_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      expected_content_digest: { type: "null" },
      rows: { type: "array", items: ACCEPTANCE_COVERAGE_ROW },
      authored_rows: { type: "array", minItems: 1,
        items: ACCEPTANCE_COVERAGE_AUTHORED_ROW }
    },
    oneOf: [
      { required: ["rows"], not: { required: ["authored_rows"] } },
      { required: ["authored_rows"], not: { required: ["rows"] } }
    ] });

import { PROOF_AUTHORING_FIELD_SCHEMAS } from
  "@agent-chassis/controlled-contract/proof-contract";
import { CASE_COMPONENT_FIELD, CASE_VERIFICATION_ASSOCIATION_FIELD, NATIVE_TEST_CASE_AMENDMENT_SCHEMA,
  NATIVE_TEST_CASE_AUTHORING_GUIDANCE } from
  "@agent-chassis/controlled-contract/native-test-cases";
import { STABLE_TEST_PROOF_AUTHORING_LIMITS, VERIFICATION_BUNDLE_VOCABULARY } from
  "@agent-chassis/controlled-contract/test-proof";
import { OBLIGATION_COVERAGE_GAP_KINDS, OBLIGATION_DRAFT_SCHEMA } from
  "@agent-chassis/controlled-contract/obligation-coverage";
import { NATIVE_CONTRACT_SCHEMA_V1 } from
  "@agent-chassis/controlled-contract/native-contract";
import { DEFAULT_MANDATORY_MODALITIES } from
  "@agent-chassis/controlled-contract/native-contract-dag";
import {
  CONTROLLED_CONTRACT_REQUIREMENT_INPUT_SHAPES,
  CONTROLLED_CONTRACT_REQUIREMENT_LIMITS,
  deriveControlledContractAuthoringVocabulary,
  projectControlledContractAuthoringVocabulary,
  publishAuthoringVocabularyForGuidance
} from "../operations/controlled-contract/contract-requirement-vocabulary.mjs";
const OBLIGATION_COVERAGE_COMMON_INPUT_PROPERTIES = {
  repo: { type: "string", minLength: 1 },
  unit: { type: "string", pattern: "^WK-[0-9]{4,}(?:#SLICE-[0-9]{3,})?$" },
  focus: { type: "string", pattern: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.pattern,
    description: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.accepted_form }
};
const draftRequest = (fields, required = []) => Object.freeze({
  type: "object", additionalProperties: false, required: ["unit", ...required],
  $defs: OBLIGATION_DRAFT_SCHEMA.$defs,
  properties: { ...OBLIGATION_COVERAGE_COMMON_INPUT_PROPERTIES, ...fields }
});
const obligationId = OBLIGATION_DRAFT_SCHEMA.$defs.obligation_id;
const sourceCAS = { anyOf: [OBLIGATION_DRAFT_SCHEMA.$defs.sha256, { type: "null" }] };
const semanticString = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const typedRequirementIdentity = { oneOf: [
  { type: 'object', additionalProperties: false,
    required: ['kind', 'repository', 'path'], properties: {
      kind: semanticString(64), repository: semanticString(256), path: semanticString(1024) } },
  { type: 'object', additionalProperties: false,
    required: ['kind', 'repository', 'path', 'symbol'], properties: {
      kind: semanticString(64), repository: semanticString(256), path: semanticString(1024),
      symbol: semanticString(512), scip_symbol: semanticString(1024) } },
  { type: 'object', additionalProperties: false,
    required: ['kind', 'domain', 'value'], properties: {
      kind: semanticString(64), domain: semanticString(256), value: semanticString(512) } },
  { type: 'object', additionalProperties: false,
    required: ['kind', 'name'], properties: {
      kind: semanticString(64), name: semanticString(512) } },
  { type: 'object', additionalProperties: false,
    required: ['kind', 'term'], properties: {
      kind: semanticString(64), term: semanticString(512) } }
] };
const requirementReferent = { oneOf: [
  { type: 'object', additionalProperties: false, required: ['select'],
    properties: { select: { type: 'string', pattern: '^ref-[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 256 } } },
  { type: 'object', additionalProperties: false, required: ['declare'], properties: {
    declare: { type: 'object', additionalProperties: false, required: ['type_term', 'identity'],
      properties: { type_term: semanticString(128), identity: typedRequirementIdentity } } } }
] };
const requirementObject = { oneOf: [
  { type: 'object', additionalProperties: false, required: ['referent'], properties: { referent: requirementReferent } },
  { type: 'object', additionalProperties: false, required: ['boolean'], properties: { boolean: { type: 'boolean' } } },
  { type: 'object', additionalProperties: false, required: ['number'], properties: { number: { type: 'number' } } },
  { type: 'object', additionalProperties: false, required: ['range'], properties: {
    range: { type: 'object', additionalProperties: false, properties: {
      minimum: { type: 'number' }, maximum: { type: 'number' } } } } }
] };
const requirementStatement = { type: 'object', additionalProperties: false,
  required: ['relation', 'objects'], properties: {
    relation: semanticString(256),
    applies: { type: 'object', additionalProperties: false, required: ['mode'], properties: {
      mode: semanticString(64), context: { type: 'array', maxItems: 4, items: requirementReferent } } },
    objects: { type: 'array', minItems: 1, items: requirementObject }
  } };
const runtimeTest = { type: 'object', additionalProperties: false,
  required: ['boundary', 'observable', 'falsifier', 'selector'], properties: {
    boundary: { type: 'object', additionalProperties: false, required: ['subjects'], properties: {
      kind: semanticString(64), subjects: { type: 'array', minItems: 1, maxItems: 8, items: requirementReferent },
      module_path: semanticString(1024) } },
    observable: { type: 'object', additionalProperties: false, required: ['kind'],
      properties: { kind: semanticString(64) } },
    falsifier: { type: 'object', additionalProperties: false, required: ['module_path'], properties: {
      strategy: semanticString(64), module_path: semanticString(1024), entry_export: semanticString(256),
      operation: { type: 'object', additionalProperties: false, properties: {
        module_path: semanticString(1024), export_name: semanticString(256) } } } },
    selector: { type: 'object', additionalProperties: false, required: ['name', 'nesting'], properties: {
      name: semanticString(512), nesting: { type: 'integer', minimum: 0, maximum: 64 } } }
  } };
const requirementClaimId = { type: 'string', pattern: '^claim-[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 256 };

const contractRequirements = { type: 'object', additionalProperties: false,
  properties: {
    retire_claim_ids: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: { ...requirementClaimId } },
    requirements: { type: 'array', minItems: 1, maxItems: 8, items: {
      type: 'object', additionalProperties: false,
      required: ['modality', 'subject', 'behavior'], properties: {
        replace_claim_id: requirementClaimId,
        rebind_case_ids: { type: 'array', minItems: 1,
          maxItems: STABLE_TEST_PROOF_AUTHORING_LIMITS.replacement_operations, uniqueItems: true,
          items: NATIVE_TEST_CASE_AMENDMENT_SCHEMA.properties.case_id },
        nature: semanticString(64), modality: semanticString(32), subject: requirementReferent,
        behavior: requirementStatement,
        verification: { type: 'object', additionalProperties: false,
          required: ['method', 'verifier', 'observes', 'fails_when'], properties: {
            method: semanticString(64), verifier: requirementReferent,
            observes: requirementStatement, fails_when: requirementStatement,
            runtime_test: runtimeTest } }
      } } },
    unrepresentable_meaning: { type: 'array', maxItems: 8, items: {
      type: 'object', additionalProperties: false, required: ['reason', 'text'], properties: {
        reason: semanticString(64), text: semanticString(4096), candidate_concept: semanticString(256) } } },
    notes: { type: 'array', maxItems: 8, items: {
      type: 'object', additionalProperties: false, required: ['kind', 'text'], properties: {
        kind: semanticString(64), text: semanticString(4096) } } }
  } };

const requirementVocabulary = publishAuthoringVocabularyForGuidance(
  projectControlledContractAuthoringVocabulary(
    deriveControlledContractAuthoringVocabulary(NATIVE_CONTRACT_SCHEMA_V1)
  )
);
const exampleReferent = (typeTerm, identity) => Object.freeze({
  declare: Object.freeze({ type_term: typeTerm, identity: Object.freeze(identity) })
});
const exampleParser = exampleReferent("cc:operation", {
  kind: "profile_term", term: "action-pinning configuration parser"
});
const exampleInvalidLevel = exampleReferent("cc:configuration", {
  kind: "profile_term", term: "configuration with an unknown action-pinning level"
});
const exampleVerifier = exampleReferent("cc:test", {
  kind: "repository_path", repository: "example/go-actionlint",
  path: "core/action_pin_test.go"
});

const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_TOOL_NAME =
  "workspace_controlled_contract_obligation_coverage_upsert";
const upsertDescribeRequest = (argumentsValue) => Object.freeze({
  tool: "workspace_tools_describe",
  arguments: Object.freeze({
    tool_name: CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_TOOL_NAME,
    ...argumentsValue
  })
});
const upsertGuidanceRequest = (...path) => upsertDescribeRequest({
  input_contract: Object.freeze({ kind: "guidance", path: Object.freeze(path) })
});
export const CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE = Object.freeze({
  schema_version: "controlled-contract-requirement-input-guidance.v1",
  overview: "Author a unit's contract requirements, controlled-acceptance disposition and " +
    "obligations. First call workspace_controlled_contract_obligation_coverage_query for the " +
    "unit and focus: it returns the combined content_digest this upsert takes as " +
    "expected_content_digest, the existing claim, verification, obligation and case " +
    "identities, and the selected unit's acceptance_criteria[].identity values. " +
    "obligations[].acceptance_criteria takes those exact identities, never criterion text, " +
    "positions or invented labels; omission preserves, [] clears and an unknown identity " +
    "refuses. expected_content_digest is the current combined content_digest for the same " +
    "unit and focus, from that query or a successful save receipt that no later work-record " +
    "or coverage mutation has superseded; it is never a work-record or tool-guidance source_digest, and null " +
    "only asserts that no combined state exists. A digest already held and still current " +
    "needs no re-query. A slice may reuse a parent case as case:{case_id} where that case's " +
    "meaning applies. Parent coverage never transfers: the slice needs its own obligations " +
    "bound to its own criterion identities, never matched by AC label, position or similar " +
    "wording. Each queried requirement lists every linked verification in " +
    "meaning.verifications, ordered by claim_id; an upsert requirement restates ONE " +
    "verification, so copy the method, verifier, observes, fails_when and runtime_test of the " +
    "entry being restated into its verification. Save at least one of contract_requirements, controlled_acceptance or " +
    "obligations; supplied items replace those items and omission preserves the others. " +
    "contract_requirements carries requirements, retire_claim_ids or both: " +
    `${CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.requirements_per_answer} entries at most across ` +
    "the two, at least one, and a supplied list is never empty. Its notes and " +
    "unrepresentable_meaning only supplement those entries and are never saved alone. " +
    "contract_requirements.retire_claim_ids explicitly retires stored requirements with no " +
    "replacement and reconciles their dependent obligations, cases and test targets. " +
    "A behavioral requirement names a subject and an observable behavior. Its verification " +
    "names a verifier, what it observes, and a fails_when statement describing the contrary " +
    "result, so the check can tell the two apart. The declared inputSchema is compact; this " +
    "tool's verbose describe is its complete enforced structure. Accepted values are selected " +
    "guidance: pass one member name as input_contract.path to read only it -- vocabulary, " +
    "required_object_shapes, behavioral_example, native_runtime_test_vocabulary, " +
    "case_authoring or unresolved_coverage -- or [] for every member. After saving, query reads the saved " +
    "authoring, workspace_validate_proof diagnoses saved inputs, and workspace_verify_proof " +
    "executes saved proofs when execution is intended. Neither this guidance nor a successful " +
    "save establishes lifecycle readiness. For an obligation verified by test_execution, " +
    "case_authoring gives each listed family's exact provider identity, node_id form and " +
    "falsification fields, which verification a case may name, how a second test of one " +
    "requirement adds its own verification, and component constraints. When no catalog proof of the obligation has been identified, keep " +
    "controlled_acceptance required and use unresolved_coverage to distinguish route support " +
    "from genuinely missing requirement or verification meaning. What can run a selected " +
    "proof today is not an authoring input and is never recorded here: workspace_verify_proof " +
    "reports execution capability at verify time.",
  authored_path_root: "$.contract_requirements",
  authority: Object.freeze({
    structural_contract: upsertDescribeRequest({ verbose: true }),
    accepted_values: upsertGuidanceRequest("vocabulary"),
    complete_relation_catalog: upsertGuidanceRequest("vocabulary", "relation_details"),
    case_authoring: upsertGuidanceRequest("case_authoring"),
    unresolved_coverage: upsertGuidanceRequest("unresolved_coverage")
  }),
  case_authoring: NATIVE_TEST_CASE_AUTHORING_GUIDANCE,
  unresolved_coverage: Object.freeze({
    applies_when: "Verification meaning is missing or contradictory. Missing catalog or " +
      "execution support is route readiness and is not an authored field.",
    record: Object.freeze({
      controlled_acceptance: Object.freeze({ disposition: "required" }),
      obligation_fields: Object.freeze({
        statement: "author the property that must hold",
        controlled_contract_node_ids: "link the current requirement and verification claims",
        mechanism: "optional {owner, kind, selector} naming the intended check",
        proof_name: "optional exact executable route; absence does not erase complete meaning"
      })
    }),
    gap_kinds: OBLIGATION_COVERAGE_GAP_KINDS,
    distinctions: Object.freeze([
      "The authored gap field and all former gap kinds are retired. A supplied gap is refused; " +
        "an existing source retaining one stays invalid until the author explicitly preserves " +
        "its evidence while writing the actual missing requirement or verification meaning.",
      "Execution capability is not authored meaning. Author the complete verification meaning; " +
        "when an executable route is intentionally selected, author that route's required inputs " +
        "and leave execution to workspace_verify_proof, which reports incapacity with its own cause. A " +
        "refused request shape, an unknown provider identity or a provider version the catalog " +
        "does not list is a request defect to correct, not a gap.",
      "Implementation, execution, inspection, or review being unfinished grants no proof credit " +
        "but does not itself make otherwise-complete authored meaning incomplete.",
      "opted_out is the explicit controlled-acceptance exemption; its rationale is authored " +
        "meaning that is neither inferred nor classified. Discovery misses, unread pages, " +
        "unsupported targets and missing authoring inputs are not evidence for it.",
      "Saving an opt-out records the caller's authored rationale and reports it as authored: no " +
        "operation here assesses whether that rationale is true, so a saved exemption is never a " +
        "verified conclusion that the obligation does not apply."
    ]),
    next_calls: Object.freeze({
      discover: Object.freeze({ tool: "workspace_controlled_proof_intents_discover",
        arguments: Object.freeze({ query: "<property the obligation establishes>" }) }),
      case_authoring: upsertGuidanceRequest("case_authoring")
    })
  }),
  required_object_shapes: Object.freeze({
    requirement: Object.freeze({
      required_fields: Object.freeze(["modality", "subject", "behavior"]),
      optional_fields: Object.freeze(["replace_claim_id", "rebind_case_ids", "nature",
        "verification"]),
      field_shapes: Object.freeze({ subject: "referent", behavior: "statement",
        verification: "verification" })
    }),
    referent: CONTROLLED_CONTRACT_REQUIREMENT_INPUT_SHAPES.referent,
    statement: CONTROLLED_CONTRACT_REQUIREMENT_INPUT_SHAPES.statement,
    statement_object: Object.freeze({
      one_of: Object.freeze([
        Object.freeze({ referent: "<referent>" }),
        Object.freeze({ boolean: "<boolean>" }),
        Object.freeze({ number: "<number>" }),
        Object.freeze({ range: Object.freeze({ minimum: "<optional number>",
          maximum: "<optional number>" }) })
      ])
    }),
    verification: Object.freeze({
      required_fields: Object.freeze(["method", "verifier", "observes", "fails_when"]),
      field_shapes: Object.freeze({ verifier: "referent", observes: "statement",
        fails_when: "statement", runtime_test: "conditional runtime-test object" })
    }),
    requirement_rebinding: Object.freeze({
      field: "requirements[].rebind_case_ids",
      requires: Object.freeze(["replace_claim_id"]),
      purpose: "Keep existing authored cases while replacing a requirement. The compiler generates the replacement's requirement and verification identities; each listed case keeps its meaning and adopts the replacement test_execution verification in the same save.",
      complete_case_population: "List every existing case whose verification the replacement retires, including cases no obligation uses. Query shows each requirement's verification_claim_ids and each case's verification_id.",
      surviving_verification: "A listed case whose verification survives the replacement is accepted unchanged and still counts toward the case operation bound.",
      runtime_meaning: "After same-batch case amendments, the authored runtime_test must agree with each retained case and its derived system-under-test boundary: boundary subjects, kind and module_path; observable kind; selector; falsifier strategy, module_path, entry_export and operation. Only fields present on both sides are compared.",
      live_links: "Obligation links to the replaced requirement, or to a retired verification the replacement maps, are updated in the root and every slice source. Work-record validation declarations keep their target, order and owning unit; only the owning unit may change them.",
      omission: "Without rebind_case_ids, a replacement that retires a verification a case still uses is refused before effects.",
      bounds: Object.freeze({
        requirements_per_answer: CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.requirements_per_answer,
        case_operations: STABLE_TEST_PROOF_AUTHORING_LIMITS.replacement_operations,
        case_operation_census: "each obligation case amendment plus each listed rebind_case_ids entry"
      }),
      refusal_codes: Object.freeze([
        "obligation_coverage_request_invalid",
        "obligation_coverage_case_unknown",
        "obligation_coverage_case_selector_invalid",
        "obligation_coverage_case_rebinding_incomplete",
        "obligation_coverage_case_rebinding_verification_incompatible",
        "obligation_coverage_case_shared_identity_conflict",
        "obligation_coverage_case_verification_conflict",
        "obligation_coverage_case_population_too_large",
        "obligation_coverage_case_selector_cross_unit",
        "obligation_coverage_case_target_invalid",
        "obligation_coverage_source_invalid",
        "controlled_contract_requirement_correction_shared_verification"
      ])
    }),
    requirement_retirement: Object.freeze({
      field: "retire_claim_ids",
      purpose: "Retire stored requirements with no replacement. List the requirement claim_id values query returns; the server derives and settles every dependent change in the same save. Omitting a requirement never retires it.",
      selection: "Each entry is a current non-verification requirement claim, listed once and not also named by a replace_claim_id or compiled by a requirement in the same answer. contract_requirements carries requirements, retire_claim_ids or both; a supplied list is never empty, and notes or unrepresentable_meaning alone are refused.",
      native_effects: "The requirement and its verifies edges retire. A verification retires only when no remaining requirement still uses it, together with its test proof and newly unused propositions and references. Shared verifications, residue and notes remain.",
      dependent_uses: "A parent or slice obligation whose explicit links and case support only retired requirements is deleted. An affected obligation that also supports a remaining requirement, or that the same save amends, is refused with its unit, obligation, case and identities; amend its controlled_contract_node_ids or case in the same save to keep the remaining meaning. Obligations with no retired link or case are unchanged.",
      cases_and_targets: "Cases bound to a retired verification are deleted once their uses retire; other cases, including unfinished ones, remain. node_test declarations drop retired verification IDs, keeping target, order, notes and other IDs, and are changed only through their owning unit.",
      semantic_dependencies: "A retained non-verifies relation or collection that still names a retired claim is refused; retained relationships are never rewritten or deleted to make retirement pass.",
      receipt: "requirement_retirements lists each selection's retired and surviving verification IDs with retired obligation and case counts. Query reads the complete current state.",
      bounds: Object.freeze({
        requirements_per_answer: CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.requirements_per_answer,
        answer_census: "each requirements entry plus each retire_claim_ids entry",
        case_operations: STABLE_TEST_PROOF_AUTHORING_LIMITS.replacement_operations,
        case_operation_census: "each obligation case amendment, rebind_case_ids entry and retired case"
      }),
      refusal_codes: Object.freeze([
        "obligation_coverage_request_invalid",
        "controlled_contract_requirement_invalid",
        "controlled_contract_requirement_correction_target_invalid",
        "controlled_contract_requirement_correction_conflicting",
        "controlled_contract_requirement_retirement_dependency_conflict",
        "obligation_coverage_requirement_retirement_use_conflict",
        "obligation_coverage_case_selector_cross_unit",
        "obligation_coverage_case_population_too_large",
        "obligation_coverage_source_invalid"
      ])
    })
  }),
  conditional_verification_requirements: Object.freeze([
    Object.freeze({
      when: Object.freeze({ nature: "behavior",
        modality_in: DEFAULT_MANDATORY_MODALITIES }),
      requires: Object.freeze(["verification"]),
      guidance: "Use a verifier and observations specific to the behavior. fails_when describes a concrete contradictory behavior of the requirement subject."
    }),
    Object.freeze({
      when: Object.freeze({
        "verification.method":
          VERIFICATION_BUNDLE_VOCABULARY.verification_claim.verification_method,
        "verification.runtime_test": "supplied"
      }),
      requires: Object.freeze(["verification.runtime_test"]),
      guidance: "A supplied runtime_test must be complete. Omitting it saves the verification meaning with no executable binding, which workspace_verify_proof then refuses to execute. Other admitted verification methods do not force test_execution."
    })
  ]),
  behavioral_example: Object.freeze({
    purpose: "The parser MUST reject an unknown action-pinning level. The named test covers that parser and input, and accepting the invalid level falsifies the requirement.",
    contract_requirements: Object.freeze({ requirements: Object.freeze([
      Object.freeze({
        nature: "behavior",
        modality: "MUST",
        subject: exampleParser,
        behavior: Object.freeze({ relation: "reference:rejects",
          objects: Object.freeze([Object.freeze({ referent: exampleInvalidLevel })]) }),
        verification: Object.freeze({
          method: "analysis",
          verifier: exampleVerifier,
          observes: Object.freeze({ relation: "reference:covers",
            objects: Object.freeze([
              Object.freeze({ referent: exampleParser }),
              Object.freeze({ referent: exampleInvalidLevel })
            ]) }),
          fails_when: Object.freeze({ relation: "reference:accepts",
            objects: Object.freeze([Object.freeze({ referent: exampleInvalidLevel })]) })
        })
      })
    ]) })
  }),
  runtime_test_authoring: "verification.runtime_test optionally binds a " +
    "test_execution verification (see conditional_verification_requirements). It describes the test that " +
    "runs: boundary.subjects are the referents under test; observable.kind is the result the " +
    "test inspects; selector.name and selector.nesting identify the exact test; falsifier " +
    "states how the test is shown to fail when the behavior is contrary. Which boundary and " +
    "falsifier fields are required, open or bound depends on the falsifier strategy, and the " +
    "published schema's per-strategy variants are authoritative. The default " +
    "dependency_failure strategy may be omitted and its falsifier takes module_path only; " +
    "forced_invocation requires strategy, module_path, entry_export and operation. A module " +
    "boundary requires its open boundary.module_path. Fields the proof owner binds are not " +
    "authored. Accepted kinds and strategies are in native_runtime_test_vocabulary.",
  vocabulary: requirementVocabulary,
  native_runtime_test_vocabulary: Object.freeze({
    schema_version: "controlled-contract-requirement-runtime-test-vocabulary.v1",
    required_for_verification_method:
      VERIFICATION_BUNDLE_VOCABULARY.verification_claim.verification_method,
    boundary_kinds:
      VERIFICATION_BUNDLE_VOCABULARY.target_types.system_under_test_boundary_kind,
    observable_kinds:
      VERIFICATION_BUNDLE_VOCABULARY.target_types.observable_result_kind,
    falsifier_strategies:
      VERIFICATION_BUNDLE_VOCABULARY.target_types.falsifier_strategy,
    provider_bound_boundary_kinds:
      VERIFICATION_BUNDLE_VOCABULARY.providers.boundary_traversal.boundary_kinds,
    selector: VERIFICATION_BUNDLE_VOCABULARY.target_types.test_selector,
    native_case_target: Object.freeze({
      owner: "authored_case",
      selector: VERIFICATION_BUNDLE_VOCABULARY.target_types.native_test_selector,
      providers: VERIFICATION_BUNDLE_VOCABULARY.native_providers
    })
  })
});

function requirementGuidanceMember(...path) {
  let current = CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE;
  for (const segment of path) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      throw new Error(
        `controlled-contract requirement guidance has no member ${JSON.stringify(path)}`
      );
    }
    current = current[segment];
  }
  return Object.freeze([...path]);
}

function conditionalRequirementMember(required) {
  const index = CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE
    .conditional_verification_requirements
    .findIndex((rule) => rule.requires.includes(required));
  if (index === -1) {
    throw new Error(`controlled-contract requirement guidance has no rule requiring ${required}`);
  }
  return requirementGuidanceMember("conditional_verification_requirements", String(index));
}

export const CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS = Object.freeze({
  claim_natures: requirementGuidanceMember("vocabulary", "claim_natures"),
  modalities: requirementGuidanceMember("vocabulary", "modalities"),
  verification_methods: requirementGuidanceMember("vocabulary", "verification_methods"),
  type_terms: requirementGuidanceMember("vocabulary", "type_terms"),
  identity_kinds: requirementGuidanceMember("vocabulary", "identity_kinds"),
  relations: requirementGuidanceMember("vocabulary", "relation_details"),
  applicability_modes: requirementGuidanceMember("vocabulary", "applicability_modes"),
  residue_reasons: requirementGuidanceMember("vocabulary", "residue_reasons"),
  note_kinds: requirementGuidanceMember("vocabulary", "note_kinds"),
  mandatory_verification: conditionalRequirementMember("verification"),
  runtime_test: conditionalRequirementMember("verification.runtime_test"),
  runtime_test_vocabulary: requirementGuidanceMember("native_runtime_test_vocabulary"),
  requirement_rebinding: requirementGuidanceMember("required_object_shapes", "requirement_rebinding"),
  requirement_retirement: requirementGuidanceMember("required_object_shapes", "requirement_retirement"),
  case_verification_association: requirementGuidanceMember("case_authoring", "verification_association"),
  case_additional_verification: requirementGuidanceMember("case_authoring", "verification_association",
    "additional_verification"),
  case_component: requirementGuidanceMember("case_authoring", "component"),
  runtime_test_fields: Object.freeze({
    "boundary.kind": requirementGuidanceMember(
      "native_runtime_test_vocabulary", "provider_bound_boundary_kinds"),
    "observable.kind": requirementGuidanceMember(
      "native_runtime_test_vocabulary", "observable_kinds"),
    "falsifier.strategy": requirementGuidanceMember(
      "native_runtime_test_vocabulary", "falsifier_strategies"),
    "selector.name": requirementGuidanceMember("native_runtime_test_vocabulary", "selector"),
    "selector.nesting": requirementGuidanceMember("native_runtime_test_vocabulary", "selector")
  })
});

export { CASE_VERIFICATION_ASSOCIATION_FIELD };
export const CASE_VERIFICATION_ASSOCIATION_REQUEST_PATH = Object.freeze(
  CASE_VERIFICATION_ASSOCIATION_FIELD.replace("[]", ".[]").split("."));
export const CASE_VERIFICATION_ASSOCIATION_FIELD_PATH =
  `$.${CASE_VERIFICATION_ASSOCIATION_FIELD}`;
export { CASE_COMPONENT_FIELD };
export const CASE_COMPONENT_REQUEST_PATH = Object.freeze(
  CASE_COMPONENT_FIELD.replace("[]", ".[]").split("."));
export const CASE_COMPONENT_FIELD_PATH = `$.${CASE_COMPONENT_FIELD}`;
const requirementItem = ["contract_requirements", "requirements", "[]"];
const requirementVerification = [...requirementItem, "verification"];
const locations = CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS;
export const CONTROLLED_CONTRACT_REQUIREMENT_REQUEST_GUIDANCE_LOCATIONS = Object.freeze([
  [["contract_requirements", "requirements"], locations.requirement_retirement],
  [["contract_requirements", "retire_claim_ids"], locations.requirement_retirement],
  [requirementItem, requirementGuidanceMember("required_object_shapes", "requirement")],
  [[...requirementItem, "nature"], locations.claim_natures],
  [[...requirementItem, "modality"], locations.modalities],
  [[...requirementItem, "subject"], requirementGuidanceMember("required_object_shapes", "referent")],
  [[...requirementItem, "behavior"], requirementGuidanceMember("required_object_shapes", "statement")],
  [[...requirementItem, "rebind_case_ids"], locations.requirement_rebinding],
  [requirementVerification, requirementGuidanceMember("required_object_shapes", "verification")],
  [[...requirementVerification, "method"], locations.verification_methods],
  [[...requirementVerification, "verifier"], requirementGuidanceMember("required_object_shapes", "referent")],
  [[...requirementVerification, "observes"], requirementGuidanceMember("required_object_shapes", "statement")],
  [[...requirementVerification, "fails_when"], requirementGuidanceMember("required_object_shapes", "statement")],
  [[...requirementVerification, "runtime_test"], requirementGuidanceMember("runtime_test_authoring")],
  [CASE_VERIFICATION_ASSOCIATION_REQUEST_PATH, locations.case_verification_association],
  [CASE_COMPONENT_REQUEST_PATH, locations.case_component],
  [["contract_requirements", "notes", "[]", "kind"], locations.note_kinds],
  [["contract_requirements", "unrepresentable_meaning", "[]", "reason"], locations.residue_reasons]
].map(([path, guidancePath]) => Object.freeze({ path: Object.freeze(path), guidance_path: guidancePath })));
const controlledAcceptanceInput = { oneOf: [
  { type: 'object', additionalProperties: false, required: ['disposition'],
    properties: { disposition: { const: 'required' } } },
  { type: 'object', additionalProperties: false, required: ['disposition', 'rationale'],
    properties: { disposition: { const: 'opted_out' }, rationale: {
      type: 'string', minLength: 1, maxLength: 8192, pattern: '^\\S(?:[\\s\\S]*\\S)?$' } } }
] };
const queryFields = { obligation_id: obligationId,
  parameter_detail: { type: "boolean", description: "Add each returned obligation's exact saved " +
    "proof-pin parameter contract, or its factual unselected, unpinned or stale state; never refreshes a pin." },
  inventory: { type: "boolean", description: "Obligation inventory view: one row per obligation " +
    "with its complete authored statement and proof, case and gap indicators, plus a contract-input " +
    "summary instead of requirement and reference bodies. Refused with obligation_id, " +
    "parameter_detail or view:\"complete\"." },
  view: { type: "string", enum: ["compact", "complete"], description: "compact (default) returns the " +
    "whole result when it fits one frame, otherwise identity, authorized counts and the call that starts " +
    "complete retrieval; complete starts that retrieval at once. Neither needs an inventory first." } };
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA = draftRequest({
  expected_content_digest: sourceCAS,
  contract_requirements: contractRequirements,
  controlled_acceptance: controlledAcceptanceInput,
  obligations: { type: 'array', minItems: 1, items: {
    type: 'object', additionalProperties: false, required: ['obligation_id'],
    properties: { obligation_id: obligationId, ...PROOF_AUTHORING_FIELD_SCHEMAS, case: NATIVE_TEST_CASE_AMENDMENT_SCHEMA }
  } }
}, ['expected_content_digest']);
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_REMOVE_INPUT_SCHEMA = draftRequest({
  obligation_id: obligationId,
  removal_scope: { type: "string", enum: ["selection", "obligation"] },
  expected_content_digest: sourceCAS
}, ["obligation_id", "removal_scope", "expected_content_digest"]);
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_INPUT_SCHEMA = draftRequest(queryFields);
export const VALIDATE_PROOF_INPUT_SCHEMA = draftRequest({ obligation_id: obligationId,
  diagnostic_group_id: { type: 'string', pattern: '^diagnostic-group-[0-9a-f]{64}$' } });
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_RESULT_SCHEMA_POPULATIONS = Object.freeze([
  "saved", "deleted", "no_op", "source_absent", "source_present", "valid", "invalid", "post_commit_failure", "mechanical_failure"
]);
const proofTool = (name, description, inputSchema) => Object.freeze({ name, description, inputSchema });
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_TOOL = proofTool(
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_TOOL_NAME,
  "Save contract requirements, controlled-acceptance applicability, obligation meaning, proof selections and shared authored cases under one combined revision CAS; omission preserves. obligations[].acceptance_criteria takes exact query acceptance_criteria[].identity values, never criterion text, positions or invented labels. expected_content_digest is the current combined content_digest for the same unit/focus from query or a still-current save receipt, never a work-record or tool-guidance source_digest. In case.falsification, null clears only fields listed by verbose discovery. Quiet receipt; query returns saved meaning.",
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA);
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_REMOVE_TOOL = proofTool(
  "workspace_controlled_contract_obligation_coverage_remove",
  "Remove one proof selection or a whole obligation row under combined CAS; removal_scope selects which. Requirements, shared cases and history remain.",
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_REMOVE_INPUT_SCHEMA);
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_TOOL = proofTool(
  "workspace_controlled_contract_obligation_coverage_query",
  "Saved requirements with every linked verification, deduplicated references, applicability, obligations, shared cases, notes and exact pins at one revision. Compact by default; view:\"complete\" or detail retrieves the whole result in bounded pages. obligation_id reads one obligation directly; parameter_detail reports pins; inventory lists statements.",
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_INPUT_SCHEMA);
export const VALIDATE_PROOF_TOOL = proofTool("workspace_validate_proof",
  "Explicitly validate saved design inputs against the exact selected proof route. The compact default assesses authored validity, route stages and zero execution credit, and indexes the blocking and actionable issues with each one's diagnostic_group_id call; diagnostic_group_id or obligation_id returns that selection's subjects, typed failed fields, corrections and addressed correction call. Does not execute providers, assess dispatch, change authored values or grant readiness.", VALIDATE_PROOF_INPUT_SCHEMA);
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_TOOL_DEFINITIONS = Object.freeze([
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_TOOL,
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_REMOVE_TOOL,
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_TOOL,
  VALIDATE_PROOF_TOOL
]);

export function controlledContractCarrierTargetCause({
  carrierKind,
  target,
  wkId,
  focus = null,
  profileId,
  profileVersion
}) {
  const validTargets = Object.keys(CARRIER_TARGETS[carrierKind] ?? {}).sort();
  return Object.freeze({
    field: "target",
    cause: "controlled_contract_query_target_invalid",
    rejected_value: typeof target === "string" && Buffer.byteLength(target, "utf8") <= 128
      ? target
      : "[bounded-invalid-target]",
    carrier_kind: carrierKind,
    valid_targets: Object.freeze(validTargets),
    recovery: null
  });
}

export function isControlledContractFocus(value) {
  if (value === undefined || value === null) return true;
  return isCanonicalFocusSlug(value);
}

export { controlledContractFocusCause } from
  "./controlled-contract-tool-shared.mjs";

export function assertControlledContractOperationInput(value, allowedKeys) {
  if (allowedKeys.includes("focus") && !isControlledContractFocus(value.focus)) {
    const cause = controlledContractFocusCause(value.focus);
    throw new ControlledContractToolError(
      cause.cause,
      CONTROLLED_CONTRACT_FOCUS_GRAMMAR.accepted_form,
      cause
    );
  }
  assertControlledContractOperationInputBase(value, allowedKeys);
  return value;
}

export {
  CONTROLLED_CONTRACT_CARRIER_KINDS,
  CONTROLLED_CONTRACT_WRITABLE_CARRIER_KINDS,
  CONTROLLED_CONTRACT_AUTHORABLE_CARRIER_KINDS,
  CONTROLLED_CONTRACT_PATCH_LIMITS,
  CONTROLLED_CONTRACT_ARTIFACT_FILES,
  CONTROLLED_CONTRACT_MAX_JSON_BYTES,
  CONTROLLED_CONTRACT_MAX_ARTIFACT_BYTES,
  CONTROLLED_CONTRACT_RECOVERY_REASON_CODES,
  ControlledContractToolError,
  normalizeControlledContractIdentity,
  controlledContractCarrierFilename,
  normalizeControlledContractPackIdentity,
  controlledContractPackCarrierFilename,
  classifyControlledContractCarrierBasename,
  classifyControlledContractRepositoryPath,
  classifyControlledContractGenerationBasename,
  classifyControlledContractGenerationRepositoryPath,
  controlledContractContentDigest,
  assertControlledContractAuthorableCarrierKind,
  resolveControlledContractRepository,
  inspectCarrierFile,
  readControlledContractGeneration,
  controlledContractGenerationDigest,
  validateControlledContractAttachmentGenerationDescriptors,
  validateControlledContractGenerationDescriptors,
  resolveControlledContractAttachmentGeneration,
  resolveControlledContractGeneration
} from "./controlled-contract-tool-shared.mjs";

export {
  resolveControlledContractEvaluationInputBinding,
  readControlledContractCarrierFile,
  resolveCanonicalControlledContractCarrierSet,
  readControlledContractAuthoringCarriers,
  rememberControlledContractAuthoringContinuation,
  updateControlledContractAuthoringProofGraphContinuation,
  getControlledContractAuthoringContinuation,
  clearControlledContractAuthoringContinuationsForTest,
  deriveControlledContractProofPlanBinding,
  deriveCanonicalControlledContractAuthoringState,
  resolveControlledContractAuthoringContinuationMutation,
  assertControlledContractCarrierExpectedDigest,
  withCanonicalControlledContractSourceLease,
  readControlledContractCarrierSetManifestDigest,
  writeControlledContractCarrierSet,
  validateControlledContractCarrierSetManifest,
  writeControlledContractCarrierFile,
  readCanonicalProofPlanInputs,
  assertBoundedStringArray
} from "./controlled-contract-carrier-set-tools.mjs";

export {
  getControlledContractRefactorContinuation,
  rememberControlledContractRefactorContinuation,
  updateControlledContractRefactorContinuation
} from "./controlled-contract-authoring-continuations.mjs";

export {
  prepareControlledContractRefactorCarrierSettlement,
  settleControlledContractRefactorTransaction
} from "./controlled-contract-carrier-set-publication.mjs";

export {
  describeControlledContractTestProofAuthoring,
  queryControlledContractTestProofBindings,
  resolveControlledContractTestProofRuntimeBindings,
  patchControlledContractTestProofBindings,
  patchControlledContractVerificationBundles,
  prepareControlledContractVerificationBundlePatch,
  validateControlledContractVerificationBundlePreparation,
  commitControlledContractVerificationBundlePatch,
  CONTROLLED_CONTRACT_VERIFICATION_BUNDLE_PREPARATION_SCHEMA,
  writeControlledContractProofPlanFile,
  composeProofPlanRequestEvaluationInputPaths,
  composeProofPlanRequestPatchEvaluationInputPaths,
  readControlledContractAssessmentArtifactFile
} from "./controlled-contract-proof-authoring-tools.mjs";
