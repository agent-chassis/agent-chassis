export {
  applyControlledContractCarrierPatch,
  CARRIER_TARGETS,
  diffControlledContractCarrierContent,
  getControlledContractNodeSpills,
  getControlledContractProjectionSpills,
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
  "controlled-contract-proof-pack-selection.v2";

export const CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_AXES = Object.freeze([
  "registered_routes",
  "selector_partitions",
  "authority_producer_consumer_edges",
  "role_tool_profiles",
  "failure_phases",
  "result_schema_population",
  "persistent_refs_and_state",
  "concurrency_and_interleavings",
  "declared_mutants",
  "prohibited_stubs"
]);

const INTEGRATION_TEST_DESIGN_SHORT_STRING = Object.freeze({
  type: "string", minLength: 1, maxLength: 1024
});
const INTEGRATION_TEST_DESIGN_ID = Object.freeze({
  type: "string", minLength: 1, maxLength: 256
});
const INTEGRATION_TEST_DESIGN_ID_ARRAY = Object.freeze({
  type: "array", maxItems: 4096, items: INTEGRATION_TEST_DESIGN_ID
});
const INTEGRATION_TEST_DESIGN_MEMBER_REF = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["census_id", "member_id"],
  properties: {
    census_id: INTEGRATION_TEST_DESIGN_ID,
    member_id: INTEGRATION_TEST_DESIGN_ID
  }
});
const INTEGRATION_TEST_DESIGN_PROOF_FACET = Object.freeze({
  type: "object", additionalProperties: false, required: ["mode"],
  properties: {
    mode: { enum: ["closed_set", "required", "not_applicable"] },
    items: INTEGRATION_TEST_DESIGN_ID_ARRAY,
    rationale: INTEGRATION_TEST_DESIGN_SHORT_STRING
  }
});
const INTEGRATION_TEST_DESIGN_EVIDENCE_KEYS = Object.freeze([
  "action_id", "boundary_id", "input_id", "dependency_expectation_id",
  "registered_set_id", "returned_set_id", "invoked_set_id", "completed_set_id",
  "failure_injection_id", "expected_result_id", "before_checkpoint_id",
  "after_checkpoint_id", "concurrency_constraint_id", "mutant_case_id",
  "ordinary_discovery_binding_id", "kill_oracle_id", "seam_policy_id"
]);
const INTEGRATION_TEST_DESIGN_EVIDENCE = Object.freeze({
  type: "object", additionalProperties: false,
  properties: Object.freeze(Object.fromEntries(
    INTEGRATION_TEST_DESIGN_EVIDENCE_KEYS.map((key) => [
      key, INTEGRATION_TEST_DESIGN_ID
    ])
  ))
});

export const CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_ASSESS_INPUT_SCHEMA =
  Object.freeze({
    type: "object",
    additionalProperties: false,
    required: [
      "unit", "axis_applicability", "declared_integration_tests",
      "integration_scenarios", "interaction_requirements", "review_questions"
    ],
    properties: Object.freeze({
      repo: { type: "string", minLength: 1 },
      unit: { type: "string", pattern: "^WK-[0-9]{4}(?:#SLICE-[0-9]{3,})?$" },
      focus: { type: "string", pattern: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.pattern },
      axis_applicability: {
        type: "array", minItems: 10, maxItems: 10,
        items: {
          type: "object", additionalProperties: false,
          required: ["axis", "status", "rationale"],
          properties: {
            axis: { enum: CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_AXES },
            status: { enum: [
              "required", "not_applicable", "review_only", "unevaluable", "undetermined"
            ] },
            rationale: INTEGRATION_TEST_DESIGN_SHORT_STRING
          }
        }
      },
      declared_integration_tests: {
        type: "array", maxItems: 4096,
        items: {
          type: "object", additionalProperties: false,
          required: ["test_id", "repository_path"],
          properties: {
            test_id: INTEGRATION_TEST_DESIGN_ID,
            repository_path: INTEGRATION_TEST_DESIGN_SHORT_STRING,
            classification_source: INTEGRATION_TEST_DESIGN_SHORT_STRING
          }
        }
      },
      integration_scenarios: {
        type: "array", maxItems: 4096,
        items: {
          type: "object", additionalProperties: false,
          required: [
            "scenario_id", "test_id", "obligation_ids", "inputs", "actions",
            "expected_results", "coverage"
          ],
          properties: {
            scenario_id: INTEGRATION_TEST_DESIGN_ID,
            test_id: { oneOf: [INTEGRATION_TEST_DESIGN_ID, { type: "null" }] },
            candidate_test_reference_ids: INTEGRATION_TEST_DESIGN_ID_ARRAY,
            obligation_ids: INTEGRATION_TEST_DESIGN_ID_ARRAY,
            inputs: {
              type: "array", maxItems: 4096,
              items: { type: "object", additionalProperties: false,
                required: ["input_id"], properties: {
                  input_id: INTEGRATION_TEST_DESIGN_ID
                } }
            },
            actions: {
              type: "array", maxItems: 4096,
              items: { type: "object", additionalProperties: false,
                required: ["action_id", "boundary_id"], properties: {
                  action_id: INTEGRATION_TEST_DESIGN_ID,
                  boundary_id: INTEGRATION_TEST_DESIGN_ID
                } }
            },
            expected_results: {
              type: "array", maxItems: 4096,
              items: { type: "object", additionalProperties: false,
                required: ["result_id"], properties: {
                  result_id: INTEGRATION_TEST_DESIGN_ID,
                  kind: INTEGRATION_TEST_DESIGN_SHORT_STRING
                } }
            },
            coverage: {
              type: "array", maxItems: 4096,
              items: { type: "object", additionalProperties: false,
                required: ["census_id", "member_id", "evidence_design"], properties: {
                  census_id: INTEGRATION_TEST_DESIGN_ID,
                  member_id: INTEGRATION_TEST_DESIGN_ID,
                  evidence_design: INTEGRATION_TEST_DESIGN_EVIDENCE
                } }
            },
            fixture_effects: {
              type: "array", maxItems: 4096,
              items: { type: "object", additionalProperties: false,
                required: ["state_member_id", "effect"], properties: {
                  state_member_id: INTEGRATION_TEST_DESIGN_ID,
                  effect: { enum: ["create", "delete", "mutate", "observe"] }
                } }
            },
            seams: {
              type: "array", maxItems: 4096,
              items: { type: "object", additionalProperties: false,
                required: ["authority_member_id", "mode"], properties: {
                  authority_member_id: INTEGRATION_TEST_DESIGN_ID,
                  mode: { enum: [
                    "observe", "external_simulation", "fault_injection", "replace_result"
                  ] }
                } }
            },
            proof_specification: {
              type: "object", additionalProperties: false,
              required: [
                "public_observations", "forbidden_side_effects", "follow_up",
                "falsifiers", "writable_roots"
              ],
              properties: {
                public_observations: {
                  type: "array", minItems: 1, maxItems: 4096,
                  items: INTEGRATION_TEST_DESIGN_SHORT_STRING
                },
                forbidden_side_effects: INTEGRATION_TEST_DESIGN_PROOF_FACET,
                follow_up: INTEGRATION_TEST_DESIGN_PROOF_FACET,
                falsifiers: INTEGRATION_TEST_DESIGN_PROOF_FACET,
                writable_roots: INTEGRATION_TEST_DESIGN_PROOF_FACET
              }
            }
          }
        }
      },
      interaction_requirements: {
        type: "array", maxItems: 4096,
        items: {
          type: "object", additionalProperties: false,
          required: ["interaction_id", "coverage_mode", "required_population_members"],
          properties: {
            interaction_id: INTEGRATION_TEST_DESIGN_ID,
            coverage_mode: { enum: ["single_scenario", "collective"] },
            required_population_members: {
              type: "array", minItems: 2, maxItems: 4096,
              items: INTEGRATION_TEST_DESIGN_MEMBER_REF
            }
          }
        }
      },
      review_questions: {
        type: "array", maxItems: 4096,
        items: {
          type: "object", additionalProperties: false,
          required: ["question_id", "question"],
          properties: {
            question_id: INTEGRATION_TEST_DESIGN_ID,
            question: INTEGRATION_TEST_DESIGN_SHORT_STRING,
            axis: { enum: CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_AXES },
            resolution_owner: INTEGRATION_TEST_DESIGN_ID,
            related_ids: INTEGRATION_TEST_DESIGN_ID_ARRAY
          }
        }
      }
    })
  });

export const CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_PUBLIC_REQUEST_KEYS =
  Object.freeze(Object.keys(
    CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_ASSESS_INPUT_SCHEMA.properties
  ).sort());
export const CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_AUTHORITY_KEYS = Object.freeze([
  "acceptance_coverage", "acceptance_coverage_current", "acceptance_coverage_digest",
  "assessment_state", "authority", "census_counts", "census_members",
  "census_providers", "completeness", "contract_digest", "contract_generation_id",
  "currentness", "generations", "obligation_source_current", "obligation_source_digest",
  "obligations", "outcomes", "proof_plan_digest", "proof_plan_generation_id",
  "provider_id", "requirements", "subject", "work_record_digest"
]);
export const CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_RESULT_SCHEMA_POPULATIONS =
  Object.freeze(["pass", "fail", "incomplete", "unevaluable", "review_only"]);
export const CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_ASSESS_TOOL = Object.freeze({
  name: "workspace_controlled_contract_integration_test_design_assess",
  description: "Experimentally assess authored integration-test design sufficiency against server-resolved canonical populations without conferring proof or lifecycle authority.",
  inputSchema: CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_ASSESS_INPUT_SCHEMA
});

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

const ACCEPTANCE_COVERAGE_CRITERION_SELECTOR = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["kind", "criterion_identity"],
  properties: {
    kind: { const: "criterion_identity" },
    criterion_identity: { type: "string", minLength: 1 }
  }
});

const ACCEPTANCE_COVERAGE_QUERY_SELECTOR = Object.freeze({ oneOf: [
  ACCEPTANCE_COVERAGE_CRITERION_SELECTOR,
  { type: "object", additionalProperties: false,
    required: ["kind", "node_id"], properties: {
      kind: { const: "contract_node" },
      node_id: { type: "string", minLength: 1 }
    } }
] });

const ACCEPTANCE_COVERAGE_COMMON_INPUT_PROPERTIES = Object.freeze({
  repo: { type: "string", minLength: 1 },
  unit: { type: "string", pattern: "^WK-[0-9]{4}(?:#SLICE-[0-9]{3,})?$" },
  focus: { type: "string", pattern: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.pattern }
});

const COVERAGE_ROW_SLOT_IDENTITY = Object.freeze({
  type: "string", pattern: "^ccrs_[0-9a-f]{64}$"
});

const COVERAGE_DESCRIBE_SELECTOR = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["kind", "row_slot_identity"], properties: {
    kind: { const: "authoring_row" },
    row_slot_identity: COVERAGE_ROW_SLOT_IDENTITY
  }
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

const ACCEPTANCE_COVERAGE_AUTHORITY_RESULT = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["authoritative", "authors_mappings_only", "grants"],
  properties: {
    authoritative: { const: false },
    authors_mappings_only: { type: "boolean" },
    grants: { type: "array", maxItems: 0 }
  }
});

function coverageMutationNextCallsSchema(queryTool) {
  return Object.freeze({
    type: "array", minItems: 1, maxItems: 1,
    items: {
      type: "object", additionalProperties: false,
      required: ["tool", "arguments"],
      properties: {
        tool: { const: queryTool },
        arguments: {
          type: "object", additionalProperties: false,
          required: ["unit"],
          properties: {
            unit: { type: "string", pattern: "^WK-[0-9]{4}(?:#SLICE-[0-9]{3,})?$" },
            focus: { type: "string", pattern: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.pattern }
          }
        }
      }
    }
  });
}

const ACCEPTANCE_COVERAGE_MUTATION_RESULT = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "carrier_kind", "content_digest", "carrier_identity", "source_identity",
    "changed", "next_calls", "authority"
  ],
  properties: {
    carrier_kind: { const: "controlled-acceptance" },
    content_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    carrier_identity: ACCEPTANCE_COVERAGE_CARRIER_IDENTITY,
    source_identity: ACCEPTANCE_COVERAGE_SOURCE_IDENTITY,
    changed: { type: "boolean" },
    next_calls: coverageMutationNextCallsSchema(
      "workspace_controlled_contract_acceptance_coverage_query"),
    authority: ACCEPTANCE_COVERAGE_AUTHORITY_RESULT
  }
});

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_DESCRIBE_INPUT_SCHEMA =
  Object.freeze({ type: "object", additionalProperties: false,
    required: ["unit"], properties: {
      ...ACCEPTANCE_COVERAGE_COMMON_INPUT_PROPERTIES,
      selector: COVERAGE_DESCRIBE_SELECTOR
    } });

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_CREATE_INPUT_SCHEMA =
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

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_UPSERT_INPUT_SCHEMA =
  Object.freeze({ type: "object", additionalProperties: false,
    required: ["unit", "carrier_identity", "source_identity",
      "expected_content_digest", "criterion_selector", "row"],
    properties: {
      ...ACCEPTANCE_COVERAGE_COMMON_INPUT_PROPERTIES,
      carrier_identity: ACCEPTANCE_COVERAGE_CARRIER_IDENTITY,
      source_identity: ACCEPTANCE_COVERAGE_SOURCE_IDENTITY,
      expected_content_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      criterion_selector: ACCEPTANCE_COVERAGE_CRITERION_SELECTOR,
      row: ACCEPTANCE_COVERAGE_ROW
    } });

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_REMOVE_INPUT_SCHEMA =
  Object.freeze({ type: "object", additionalProperties: false,
    required: ["unit", "carrier_identity", "source_identity",
      "expected_content_digest", "criterion_selector"],
    properties: {
      ...ACCEPTANCE_COVERAGE_COMMON_INPUT_PROPERTIES,
      carrier_identity: ACCEPTANCE_COVERAGE_CARRIER_IDENTITY,
      source_identity: ACCEPTANCE_COVERAGE_SOURCE_IDENTITY,
      expected_content_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      criterion_selector: ACCEPTANCE_COVERAGE_CRITERION_SELECTOR
    } });

const ACCEPTANCE_COVERAGE_PATCH_OPERATION = Object.freeze({ oneOf: [
  { type: "object", additionalProperties: false,
    required: ["op", "criterion_selector", "row"], properties: {
      op: { const: "upsert" },
      criterion_selector: ACCEPTANCE_COVERAGE_CRITERION_SELECTOR,
      row: ACCEPTANCE_COVERAGE_ROW
    } },
  { type: "object", additionalProperties: false,
    required: ["op", "criterion_selector"], properties: {
      op: { const: "remove" },
      criterion_selector: ACCEPTANCE_COVERAGE_CRITERION_SELECTOR
    } },
  { type: "object", additionalProperties: false,
    required: ["op", "row_slot_identity", "row"], properties: {
      op: { const: "upsert" },
      row_slot_identity: COVERAGE_ROW_SLOT_IDENTITY,
      row: { type: "object", additionalProperties: false,
        required: ["node_ids", "axes"], properties: {
          node_ids: ACCEPTANCE_COVERAGE_ROW.properties.node_ids,
          axes: ACCEPTANCE_COVERAGE_ROW.properties.axes
        } }
    } }
] });

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_PATCH_INPUT_SCHEMA =
  Object.freeze({
    type: "object", additionalProperties: false,
    required: [
      "unit", "carrier_identity", "source_identity", "expected_unit_digest",
      "expected_authoring_identity", "expected_content_digest", "operations"
    ],
    properties: {
      ...ACCEPTANCE_COVERAGE_COMMON_INPUT_PROPERTIES,
      carrier_identity: ACCEPTANCE_COVERAGE_CARRIER_IDENTITY,
      source_identity: ACCEPTANCE_COVERAGE_SOURCE_IDENTITY,
      expected_unit_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      expected_authoring_identity: {
        type: "string", pattern: "^sha256:[0-9a-f]{64}$"
      },
      expected_content_digest: {
        type: "string", pattern: "^sha256:[0-9a-f]{64}$"
      },
      operations: { type: "array", minItems: 1,
        items: ACCEPTANCE_COVERAGE_PATCH_OPERATION }
    }
  });

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_QUERY_INPUT_SCHEMA =
  Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["unit"],
    properties: {
      ...ACCEPTANCE_COVERAGE_COMMON_INPUT_PROPERTIES,
      selector: ACCEPTANCE_COVERAGE_QUERY_SELECTOR,
      cursor: { type: "string", minLength: 1 }
    },
    allOf: [{ not: { required: ["selector", "cursor"] } }]
  });

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_RESULT_SCHEMA_POPULATIONS =
  Object.freeze([
    "describe_success", "create_success", "upsert_success", "remove_success",
    "query_success", "missing_source_refusal", "missing_carrier_refusal",
    "invalid_selector_refusal", "stale_currentness_refusal",
    "duplicate_credit_refusal", "oversize_refusal", "busy_refusal",
    "final_compare_refusal"
  ]);

const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_AUTHORING_OUTPUT_SCHEMA =
  Object.freeze({
    type: "object",
    additionalProperties: false,
    required: [
      "unit", "unit_digest", "criterion_identities", "evaluation",
      "projection", "scope_facts", "proof_coverage", "result_facts",
      "criterion_axes", "next_calls"
    ],
    properties: {
      unit: { type: "object", additionalProperties: true },
      unit_digest: { type: "string" },
      criterion_identities: { type: "object", additionalProperties: true },
      evaluation: { type: "object", additionalProperties: true },
      projection: { type: "object", additionalProperties: true },
      scope_facts: { type: "object", additionalProperties: true },
      proof_coverage: { type: "array" },
      result_facts: { type: ["object", "null"] },
      criterion_axes: { type: "array" },
      next_calls: { type: "array" }
    }
  });

const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_QUERY_OUTPUT_SCHEMA =
  Object.freeze({
    type: "object",
    additionalProperties: false,
    required: [
      "version", "criterion_identity_digest", "projection_digest", "claim",
      "complete", "warnings", "unknown_mappings", "unmapped_mandatory_node_ids",
      "axes", "selector", "totals", "page", "covered_detail", "next_calls",
      "authority"
    ],
    properties: {
      version: { type: "string" },
      criterion_identity_digest: { type: "string" },
      projection_digest: { type: "string" },
      claim: { enum: ["absent", "present"] },
      complete: { type: "boolean" },
      warnings: { type: "array" },
      unknown_mappings: { type: "array" },
      unmapped_mandatory_node_ids: { type: "array", items: { type: "string" } },
      axes: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["axis", "state", "totals_by_state"], properties: {
          axis: { type: "string" }, state: { type: "string" },
          totals_by_state: { type: "object", additionalProperties: false }
        } } },
      selector: { type: ["object", "null"], additionalProperties: false },
      totals: { type: "object", additionalProperties: false },
      page: { type: "object", additionalProperties: false },
      covered_detail: { type: "object", additionalProperties: false },
      next_calls: { type: "array" },
      authority: ACCEPTANCE_COVERAGE_AUTHORITY_RESULT
    }
  });

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_DESCRIBE_TOOL = Object.freeze({
  name: "workspace_controlled_contract_acceptance_coverage_describe",
  description: "Describe acceptance coverage for authoring. Returns transport-sized row batches with criterion identity/text, shared node/proof choices, field contracts, exact counts, fixed mutation arguments, and callable continuation. Server binding protects integrity, not secrecy or authority.",
  inputSchema: CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_DESCRIBE_INPUT_SCHEMA
});

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_CREATE_TOOL =
  Object.freeze({
    name: "workspace_controlled_contract_acceptance_coverage_create",
    description: "Create absent acceptance coverage from returned one-use row identities and caller-authored fields; the server injects current criterion identities.",
    inputSchema: CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_CREATE_INPUT_SCHEMA,
    outputSchema: ACCEPTANCE_COVERAGE_MUTATION_RESULT
  });

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_UPSERT_TOOL = Object.freeze({
  name: "workspace_controlled_contract_acceptance_coverage_upsert",
  description: "Upsert one typed acceptance-coverage row in the server-resolved carrier.",
  inputSchema: CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_UPSERT_INPUT_SCHEMA,
  outputSchema: ACCEPTANCE_COVERAGE_MUTATION_RESULT
});

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_REMOVE_TOOL = Object.freeze({
  name: "workspace_controlled_contract_acceptance_coverage_remove",
  description: "Remove one typed acceptance-coverage row from the server-resolved carrier.",
  inputSchema: CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_REMOVE_INPUT_SCHEMA,
  outputSchema: ACCEPTANCE_COVERAGE_MUTATION_RESULT
});

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_QUERY_TOOL = Object.freeze({
  name: "workspace_controlled_contract_acceptance_coverage_query",
  description: "Query the server-adapted acceptance-coverage projection by selector or cursor.",
  inputSchema: CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_QUERY_INPUT_SCHEMA,
  outputSchema: CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_QUERY_OUTPUT_SCHEMA
});

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_PATCH_TOOL = Object.freeze({
  name: "workspace_controlled_contract_acceptance_coverage_patch",
  description: "Atomically apply a bounded typed patch to one current acceptance-coverage carrier.",
  inputSchema: CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_PATCH_INPUT_SCHEMA
});

export const CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_TOOL_DEFINITIONS =
  Object.freeze([
    CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_DESCRIBE_TOOL,
    CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_CREATE_TOOL,
    CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_UPSERT_TOOL,
    CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_REMOVE_TOOL,
    CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_QUERY_TOOL
  ]);

const OBLIGATION_COVERAGE_COMMON_INPUT_PROPERTIES = Object.freeze({
  repo: { type: "string", minLength: 1 },
  unit: { type: "string", pattern: "^WK-[0-9]{4}(?:#SLICE-[0-9]{3,})?$" },
  focus: { type: "string", pattern: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.pattern }
});

const OBLIGATION_COVERAGE_CRITERION_SELECTOR = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["kind", "criterion_identity"],
  properties: {
    kind: { const: "criterion_identity" },
    criterion_identity: { type: "string", minLength: 1, maxLength: 4096 }
  }
});

const OBLIGATION_COVERAGE_OBLIGATION_SELECTOR = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["kind", "obligation_id"],
  properties: {
    kind: { const: "obligation_id" },
    obligation_id: { type: "string", pattern: "^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$" }
  }
});

const OBLIGATION_COVERAGE_MECHANISM = Object.freeze({
  type: "object", additionalProperties: false,
  required: ["owner", "kind", "selector"],
  properties: {
    owner: { type: "string", minLength: 1 },
    kind: { enum: [
      "code_symbol", "schema", "test", "configuration", "durable_record",
      "tool_operation"
    ] },
    selector: { type: "string", minLength: 1 }
  }
});

const OBLIGATION_COVERAGE_AUTHORED_PROOF = Object.freeze({ oneOf: [
  { type: "object", additionalProperties: false,
    required: ["kind", "requested_intent", "selector", "evaluation_stage"],
    properties: {
      kind: { const: "pack_mapping" },
      requested_intent: { type: "string", minLength: 1 },
      selector: { type: "object", additionalProperties: false,
        required: ["kind", "component_id"], properties: {
          kind: { enum: [
            "reference_binding", "claim", "relation", "collection",
            "resolver_fact", "evidence"
          ] },
          component_id: { type: "string", minLength: 1 }
        } },
      evaluation_stage: { enum: ["pre_dispatch", "post_delivery"] }
    } },
  { type: "object", additionalProperties: false,
    required: ["kind", "gap_kind", "reason"], properties: {
      kind: { const: "explicit_gap" },
      gap_kind: { enum: [
        "catalog_gap", "mechanism_gap", "implementation_not_delivered",
        "existing_mechanism_unextended", "review_only", "no_proof_required"
      ] },
      reason: { type: "string", minLength: 1 }
    } }
] });

const OBLIGATION_COVERAGE_AUTHORED_ROW = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "obligation_id", "statement", "criterion_selector",
    "controlled_contract_node_ids", "mechanism", "proof"
  ],
  properties: {
    obligation_id: {
      type: "string", pattern: "^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$"
    },
    statement: { type: "string", minLength: 1 },
    criterion_selector: OBLIGATION_COVERAGE_CRITERION_SELECTOR,
    controlled_contract_node_ids: {
      type: "array", minItems: 1, uniqueItems: true,
      items: { type: "string", minLength: 1 }
    },
    mechanism: OBLIGATION_COVERAGE_MECHANISM,
    proof: OBLIGATION_COVERAGE_AUTHORED_PROOF
  }
});

const OBLIGATION_COVERAGE_ROW_SLOT_AUTHORED_ROW = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "row_slot_identity", "obligation_id", "statement",
    "controlled_contract_node_ids", "mechanism", "proof"
  ],
  properties: {
    row_slot_identity: COVERAGE_ROW_SLOT_IDENTITY,
    obligation_id: OBLIGATION_COVERAGE_AUTHORED_ROW.properties.obligation_id,
    statement: OBLIGATION_COVERAGE_AUTHORED_ROW.properties.statement,
    controlled_contract_node_ids:
      OBLIGATION_COVERAGE_AUTHORED_ROW.properties.controlled_contract_node_ids,
    mechanism: OBLIGATION_COVERAGE_AUTHORED_ROW.properties.mechanism,
    proof: OBLIGATION_COVERAGE_AUTHORED_ROW.properties.proof
  }
});

const OBLIGATION_COVERAGE_QUERY_SELECTOR = Object.freeze({ oneOf: [
  OBLIGATION_COVERAGE_OBLIGATION_SELECTOR,
  OBLIGATION_COVERAGE_CRITERION_SELECTOR,
  { type: "object", additionalProperties: false,
    required: ["kind", "node_id"], properties: {
      kind: { const: "contract_node" }, node_id: { type: "string", minLength: 1 }
    } },
  { type: "object", additionalProperties: false,
    required: ["kind", "mechanism"], properties: {
      kind: { const: "mechanism" }, mechanism: OBLIGATION_COVERAGE_MECHANISM
    } },
  { type: "object", additionalProperties: false,
    required: ["kind", "proof_kind"], properties: {
      kind: { const: "proof_kind" },
      proof_kind: { enum: ["pack_mapping", "explicit_gap"] }
    } }
] });

const OBLIGATION_COVERAGE_SOURCE_IDENTITY = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "source_kind", "wk_id", "controlled_focus", "selected_unit",
    "locator_digest", "content_digest"
  ],
  properties: {
    source_kind: { const: "obligation-coverage" },
    wk_id: { type: "string", pattern: "^WK-[0-9]{4}$" },
    controlled_focus: { oneOf: [
      { type: "null" },
      { type: "string", pattern: CONTROLLED_CONTRACT_FOCUS_GRAMMAR.pattern }
    ] },
    selected_unit: { oneOf: [
      { type: "null" },
      { type: "string", pattern: "^SLICE-[0-9]{3,}$" }
    ] },
    locator_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    content_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" }
  }
});

const OBLIGATION_COVERAGE_PATCH_OPERATION = Object.freeze({ oneOf: [
  { type: "object", additionalProperties: false,
    required: ["op", "obligation_selector", "row"], properties: {
      op: { const: "upsert" },
      obligation_selector: OBLIGATION_COVERAGE_OBLIGATION_SELECTOR,
      row: OBLIGATION_COVERAGE_AUTHORED_ROW
    } },
  { type: "object", additionalProperties: false,
    required: ["op", "obligation_selector"], properties: {
      op: { const: "remove" },
      obligation_selector: OBLIGATION_COVERAGE_OBLIGATION_SELECTOR
    } },
  { type: "object", additionalProperties: false,
    required: ["op", "obligation_selector", "row_slot_identity", "row"],
    properties: {
      op: { const: "upsert" },
      obligation_selector: OBLIGATION_COVERAGE_OBLIGATION_SELECTOR,
      row_slot_identity: COVERAGE_ROW_SLOT_IDENTITY,
      row: { type: "object", additionalProperties: false,
        required: [
          "obligation_id", "statement", "controlled_contract_node_ids",
          "mechanism", "proof"
        ], properties: {
          obligation_id: OBLIGATION_COVERAGE_AUTHORED_ROW.properties.obligation_id,
          statement: OBLIGATION_COVERAGE_AUTHORED_ROW.properties.statement,
          controlled_contract_node_ids:
            OBLIGATION_COVERAGE_AUTHORED_ROW.properties.controlled_contract_node_ids,
          mechanism: OBLIGATION_COVERAGE_AUTHORED_ROW.properties.mechanism,
          proof: OBLIGATION_COVERAGE_AUTHORED_ROW.properties.proof
        } }
    } }
] });

export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_PATCH_INPUT_SCHEMA =
  Object.freeze({
    type: "object", additionalProperties: false,
    required: [
      "unit", "source_identity", "expected_authoring_identity",
      "expected_content_digest", "operations"
    ],
    properties: {
      ...OBLIGATION_COVERAGE_COMMON_INPUT_PROPERTIES,
      source_identity: OBLIGATION_COVERAGE_SOURCE_IDENTITY,
      expected_authoring_identity: {
        type: "string", pattern: "^sha256:[0-9a-f]{64}$"
      },
      expected_content_digest: {
        type: "string", pattern: "^sha256:[0-9a-f]{64}$"
      },
      operations: { type: "array", minItems: 1,
        items: OBLIGATION_COVERAGE_PATCH_OPERATION }
    }
  });

export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_DESCRIBE_INPUT_SCHEMA =
  Object.freeze({ type: "object", additionalProperties: false,
    required: ["unit"], properties: {
      ...OBLIGATION_COVERAGE_COMMON_INPUT_PROPERTIES,
      selector: COVERAGE_DESCRIBE_SELECTOR
    } });

export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_CREATE_INPUT_SCHEMA =
  Object.freeze({ type: "object", additionalProperties: false,
    required: ["unit", "expected_authoring_identity", "expected_content_digest"],
    properties: {
      ...OBLIGATION_COVERAGE_COMMON_INPUT_PROPERTIES,
      expected_authoring_identity: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      expected_content_digest: { type: "null" },
      rows: { type: "array", maxItems: 4097, items: OBLIGATION_COVERAGE_AUTHORED_ROW },
      authored_rows: { type: "array", minItems: 1, maxItems: 4097,
        items: OBLIGATION_COVERAGE_ROW_SLOT_AUTHORED_ROW }
    },
    oneOf: [
      { required: ["rows"], not: { required: ["authored_rows"] } },
      { required: ["authored_rows"], not: { required: ["rows"] } }
    ] });

export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA =
  Object.freeze({ type: "object", additionalProperties: false,
    required: ["unit", "expected_content_digest", "obligation_selector", "row"],
    properties: {
      ...OBLIGATION_COVERAGE_COMMON_INPUT_PROPERTIES,
      expected_content_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      obligation_selector: OBLIGATION_COVERAGE_OBLIGATION_SELECTOR,
      row: OBLIGATION_COVERAGE_AUTHORED_ROW
    } });

export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_REMOVE_INPUT_SCHEMA =
  Object.freeze({ type: "object", additionalProperties: false,
    required: ["unit", "expected_content_digest", "obligation_selector"],
    properties: {
      ...OBLIGATION_COVERAGE_COMMON_INPUT_PROPERTIES,
      expected_content_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      obligation_selector: OBLIGATION_COVERAGE_OBLIGATION_SELECTOR
    } });

export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_INPUT_SCHEMA =
  Object.freeze({ type: "object", additionalProperties: false,
    required: ["unit"], properties: {
      ...OBLIGATION_COVERAGE_COMMON_INPUT_PROPERTIES,
      selector: OBLIGATION_COVERAGE_QUERY_SELECTOR,
      cursor: { type: "string", minLength: 1, maxLength: 8192 }
    }, allOf: [{ not: { required: ["selector", "cursor"] } }] });

export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_RESULT_SCHEMA_POPULATIONS =
  Object.freeze([
    "describe_absent_success", "describe_current_success", "describe_stale_success",
    "create_success", "upsert_success", "upsert_unchanged_success", "remove_success",
    "query_success", "missing_source_refusal", "malformed_request_refusal",
    "duplicate_obligation_refusal", "duplicate_credit_refusal",
    "admission_absence_refusal", "admission_digest_refusal",
    "admission_identity_refusal", "stale_currentness_refusal",
    "invalid_criterion_refusal", "invalid_node_refusal", "invalid_pack_refusal",
    "invalid_selector_refusal", "busy_refusal", "final_compare_refusal",
    "row_bound_refusal", "byte_bound_refusal", "stale_cursor_refusal"
  ]);

const OBLIGATION_COVERAGE_MUTATION_OUTPUT_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false,
  required: [
    "schema_version", "source_kind", "content_digest", "row_count",
    "byte_length", "changed", "next_calls", "authority"
  ],
  properties: {
    schema_version: { const: "controlled-contract-obligation-coverage-mutation.v1" },
    source_kind: { const: "obligation-coverage" },
    content_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    row_count: { type: "integer", minimum: 0, maximum: 4096 },
    byte_length: { type: "integer", minimum: 1, maximum: 1048576 },
    changed: { type: "boolean" },
    next_calls: coverageMutationNextCallsSchema(
      "workspace_controlled_contract_obligation_coverage_query"),
    authority: { type: "object", additionalProperties: true }
  }
});

export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_DESCRIBE_TOOL = Object.freeze({
  name: "workspace_controlled_contract_obligation_coverage_describe",
  description: "Describe obligation coverage for authoring. Returns transport-sized row batches with criterion identity/text, shared node/proof choices, field contracts, exact counts, fixed mutation arguments, and callable continuation. Server binding protects integrity, not secrecy or authority.",
  inputSchema: CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_DESCRIBE_INPUT_SCHEMA
});
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_CREATE_TOOL = Object.freeze({
  name: "workspace_controlled_contract_obligation_coverage_create",
  description: "Create absent obligation coverage from returned one-use row identities and caller-authored fields; the server injects current criterion identities.",
  inputSchema: CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_CREATE_INPUT_SCHEMA,
  outputSchema: OBLIGATION_COVERAGE_MUTATION_OUTPUT_SCHEMA
});
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_TOOL = Object.freeze({
  name: "workspace_controlled_contract_obligation_coverage_upsert",
  description: "Digest-CAS upsert one typed row in the current canonical obligation source.",
  inputSchema: CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA,
  outputSchema: OBLIGATION_COVERAGE_MUTATION_OUTPUT_SCHEMA
});
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_REMOVE_TOOL = Object.freeze({
  name: "workspace_controlled_contract_obligation_coverage_remove",
  description: "Digest-CAS remove one selected row from the current canonical obligation source.",
  inputSchema: CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_REMOVE_INPUT_SCHEMA,
  outputSchema: OBLIGATION_COVERAGE_MUTATION_OUTPUT_SCHEMA
});
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_TOOL = Object.freeze({
  name: "workspace_controlled_contract_obligation_coverage_query",
  description: "Query the canonical obligation source with bounded gap-first digest-bound pagination.",
  inputSchema: CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_INPUT_SCHEMA
});
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_PATCH_TOOL = Object.freeze({
  name: "workspace_controlled_contract_obligation_coverage_patch",
  description: "Atomically apply a bounded typed patch to one current obligation source.",
  inputSchema: CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_PATCH_INPUT_SCHEMA
});
export const CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_TOOL_DEFINITIONS = Object.freeze([
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_DESCRIBE_TOOL,
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_CREATE_TOOL,
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_TOOL,
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_REMOVE_TOOL,
  CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_QUERY_TOOL
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
    replacement_call: Object.freeze({
      tool: "workspace_controlled_contract_carrier_query",
      arguments: Object.freeze({
        wk_id: wkId,
        ...(focus === null || focus === undefined ? {} : { focus }),
        carrier_kind: carrierKind,
        ...(profileId === undefined ? {} : { profile_id: profileId }),
        ...(profileVersion === undefined ? {} : { profile_version: profileVersion }),
        ...(validTargets.length === 0 ? {} : { target: validTargets[0] })
      })
    })
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
  writeControlledContractProofPlanFile,
  composeProofPlanRequestEvaluationInputPaths,
  composeProofPlanRequestPatchEvaluationInputPaths,
  readControlledContractAssessmentArtifactFile
} from "./controlled-contract-proof-authoring-tools.mjs";
