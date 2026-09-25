# proof.integration.prefix-safety@4.0.0

<!-- Generated from validated package metadata. -->

For one exact captured complete declared integration DAG, one exact complete integration-unit partition, and one exact declared execution-path and required-branch population, the package-owned integration-prefix-census.v1 transformer derives every independently integrable prefix crossed with every declared path and required branch; that exact derived case population is bound into the profile, every case is declared preserved, the aggregate result records that population, and one verification reads the exact sources, census, every case, and aggregate result with a positive non-preservation falsifier.

Profile digest: d5f787bf5a3db86d478030f193cac6efd2b26e903b35c98ce670b89350e7e14a. Parameter digest: 20524d8830de268ea39fb3d3eb410ce3408b368d4b44a5f79a03c8d8b3d1846f.

Admission digest: 9d00f89f8b7c1265c06e7f8a5728deb680c30c13618650c429e25d2560c1dc85.

Roles: 11/11 accounted; 0 owned gaps. Semantic parameters: 0; internal roles: 11.

## Guarantee and exclusions

For one exact captured complete declared integration DAG, one exact complete integration-unit partition, and one exact declared execution-path and required-branch population, the package-owned integration-prefix-census.v1 transformer derives every independently integrable prefix crossed with every declared path and required branch; that exact derived case population is bound into the profile, every case is declared preserved, the aggregate result records that population, and one verification reads the exact sources, census, every case, and aggregate result with a positive non-preservation falsifier.

- caller-supplied-dag-unit-path-and-branch-source-truth-or-authority
- concurrency-rollback-and-rollout-orchestration
- dishonest-authored-preservation-claims-or-reference-grounding
- pack-applicability-evidence-authority-or-cce-consequence
- production-path-or-branch-discovery-outside-captured-sources
- runtime-or-deployment-behavior-outside-captured-artifacts

## Parameters

## Role production and complete constraints

| Role | Producer | Source | Capability gap |
| --- | --- | --- | --- |
| integration_dag | constructor_output |  |  |
| integration_units | constructor_output |  |  |
| execution_paths | constructor_output |  |  |
| prefix_census | constructor_output |  |  |
| prefix_case_population | constructor_output |  |  |
| prefix_cases | constructor_output |  |  |
| preservation_result | constructor_output |  |  |
| preserved_state | constructor_output |  |  |
| verification | constructor_output |  |  |
| case_failure_condition | constructor_output |  |  |
| case_count | constructor_output |  |  |

```json
{
  "roles": [
    {
      "role": "integration_dag",
      "kind": "constructor_output",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/distinct_reference_role_sets/0"
      ],
      "capability": "construction",
      "gap": null,
      "refinement": {
        "role": "integration_dag",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "integration_units",
      "kind": "constructor_output",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/distinct_reference_role_sets/0"
      ],
      "capability": "construction",
      "gap": null,
      "refinement": {
        "role": "integration_units",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "execution_paths",
      "kind": "constructor_output",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/distinct_reference_role_sets/0"
      ],
      "capability": "construction",
      "gap": null,
      "refinement": {
        "role": "execution_paths",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "prefix_census",
      "kind": "constructor_output",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/4",
        "/distinct_reference_role_sets/0"
      ],
      "capability": "construction",
      "gap": null,
      "refinement": {
        "role": "prefix_census",
        "allowed_type_terms": [
          "cc:artifact"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "repository_path",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "prefix_case_population",
      "kind": "constructor_output",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/2",
        "/distinct_reference_role_sets/0",
        "/reference_binding_patterns/0"
      ],
      "capability": "construction",
      "gap": null,
      "refinement": {
        "role": "prefix_case_population",
        "allowed_type_terms": [
          "cc:population"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "prefix_cases",
      "kind": "constructor_output",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/4",
        "/reference_binding_patterns/0",
        "/reference_role_count_bindings/0"
      ],
      "capability": "construction",
      "gap": null,
      "refinement": {
        "role": "prefix_cases",
        "allowed_type_terms": [
          "cc:evidence"
        ],
        "allowed_identity_kinds": [
          "durable_id"
        ],
        "cardinality": "one_or_more"
      }
    },
    {
      "role": "preservation_result",
      "kind": "constructor_output",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/2",
        "/claim_patterns/3",
        "/claim_patterns/4",
        "/claim_patterns/5"
      ],
      "capability": "construction",
      "gap": null,
      "refinement": {
        "role": "preservation_result",
        "allowed_type_terms": [
          "cc:evidence",
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "preserved_state",
      "kind": "constructor_output",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/claim_patterns/3",
        "/claim_patterns/5"
      ],
      "capability": "construction",
      "gap": null,
      "refinement": {
        "role": "preserved_state",
        "allowed_type_terms": [
          "cc:state"
        ],
        "allowed_identity_kinds": [
          "durable_id",
          "runtime_parameter"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "verification",
      "kind": "constructor_output",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/4",
        "/claim_patterns/5",
        "/distinct_reference_role_sets/0"
      ],
      "capability": "construction",
      "gap": null,
      "refinement": {
        "role": "verification",
        "allowed_type_terms": [
          "cc:process",
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "code_symbol",
          "durable_id",
          "repository_path"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "case_failure_condition",
      "kind": "constructor_output",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/5",
        "/distinct_reference_role_sets/0",
        "/falsifier_condition_bindings/0"
      ],
      "capability": "construction",
      "gap": null,
      "refinement": {
        "role": "case_failure_condition",
        "allowed_type_terms": [
          "cc:criterion",
          "cc:state"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "case_count",
      "kind": "constructor_output",
      "parameter": null,
      "inputs": [],
      "rule_refs": [
        "/reference_role_count_bindings/0"
      ],
      "capability": "construction",
      "gap": null,
      "refinement": {
        "role": "case_count",
        "cardinality": "exactly_one",
        "number_type": "integer",
        "minimum": 1
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "integration_dag",
          "integration_units",
          "execution_paths",
          "prefix_census",
          "prefix_case_population",
          "verification",
          "case_failure_condition"
        ]
      }
    },
    {
      "ref": "/reference_binding_patterns/0",
      "constraint": {
        "pattern_id": "complete-prefix-case-population",
        "comparison": "complete_population",
        "roles": [
          "prefix_case_population",
          "prefix_cases"
        ],
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/reference_role_count_bindings/0",
      "constraint": {
        "reference_role": "prefix_cases",
        "number_role": "case_count"
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "census-includes-case-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "prefix_census",
          "operator": "reference:includes",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prefix_case_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "each-prefix-case-preserved",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "for_each": {
          "population_role": "prefix_cases",
          "member_role": "prefix_case"
        },
        "proposition_template": {
          "subject_role": "prefix_case",
          "operator": "reference:has_state",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "preserved_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/2",
      "constraint": {
        "pattern_id": "preservation-result-records-case-population",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "preservation_result",
          "operator": "reference:records",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "prefix_case_population"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/3",
      "constraint": {
        "pattern_id": "all-prefix-cases-preserved",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "preservation_result",
          "operator": "reference:equals",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "preserved_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/4",
      "constraint": {
        "pattern_id": "verification-reads-exact-prefix-census",
        "claim_kind": "evidence",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:reads",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "integration_dag"
            },
            {
              "kind": "reference",
              "role": "integration_units"
            },
            {
              "kind": "reference",
              "role": "execution_paths"
            },
            {
              "kind": "reference",
              "role": "prefix_census"
            },
            {
              "kind": "reference",
              "role": "prefix_cases"
            },
            {
              "kind": "reference",
              "role": "preservation_result"
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/5",
      "constraint": {
        "pattern_id": "verify-all-prefix-cases-preserved",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "verification",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "preservation_result"
            }
          ]
        },
        "verification_methods": [
          "analysis",
          "demonstration",
          "proof",
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "preservation_result",
          "operator": "reference:not_equals",
          "applicability_context": {
            "mode": "when",
            "operand_roles": [
              "case_failure_condition"
            ]
          },
          "operands": [
            {
              "kind": "reference",
              "role": "preserved_state"
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "verification-target-prefix-preservation",
        "role": "verifies",
        "source_claim_pattern_id": "verify-all-prefix-cases-preserved",
        "target_claim_pattern_id": "all-prefix-cases-preserved"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "verification-target-prefix-preservation",
        "applicability_context": {
          "mode": "when",
          "operand_roles": [
            "case_failure_condition"
          ]
        }
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "complete-prefix-case-population"
          },
          {
            "pattern": "census-includes-case-population"
          },
          {
            "pattern": "each-prefix-case-preserved"
          },
          {
            "pattern": "preservation-result-records-case-population"
          },
          {
            "pattern": "all-prefix-cases-preserved"
          },
          {
            "pattern": "verification-reads-exact-prefix-census"
          },
          {
            "pattern": "verify-all-prefix-cases-preserved"
          },
          {
            "pattern": "verification-target-prefix-preservation"
          }
        ]
      }
    }
  ]
}
```

## Construction, dependencies and capabilities

```json
{
  "construction": {
    "capability": "construction",
    "semantic_inputs": [],
    "declaration_outputs": [
      "integration_dag",
      "integration_units",
      "execution_paths",
      "prefix_census",
      "prefix_case_population",
      "prefix_cases",
      "preservation_result",
      "preserved_state",
      "verification",
      "case_failure_condition",
      "case_count"
    ],
    "required_observations": [],
    "canonical_inputs": [
      {
        "owner": "work record canonical work-record resolver",
        "source": "work-record slices",
        "requirement": "The complete canonical slice DAG for the selected WK and focus."
      },
      {
        "owner": "@agent-chassis/controlled-contract#buildIntegrationPrefixSourceMap",
        "source": "lib/proof-authoring-skeleton.mjs",
        "requirement": "One complete typed ownership/path mapping for all canonical integration units and execution paths."
      }
    ]
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.integration.prefix-safety.",
      "source": "lib/proof-authoring-skeleton.mjs",
      "consequence": "The existing builder requires canonical slices and their complete typed ownership/path mapping; helper imports establish no supporting-pack dependency."
    }
  },
  "capabilities": [
    {
      "id": "construction",
      "kind": "constructor",
      "state": "implemented",
      "identity": "@agent-chassis/controlled-contract#buildProofAuthoringSkeleton",
      "evidence": "lib/proof-authoring-skeleton.mjs#buildIntegrationPrefixAuthoring: canonical record slices and complete typed ownership/path source map produce the integration graph and evaluation bindings.",
      "evidence_kind": "static",
      "gap": null,
      "implementation_version": "1.0.0"
    },
    {
      "id": "canonical-source",
      "kind": "canonical_resolver",
      "state": "declared_requirement",
      "identity": null,
      "evidence": "work record owns canonical instance source resolution; metadata does not resolve a WK.",
      "evidence_kind": "requirement",
      "gap": null,
      "implementation_version": null
    },
    {
      "id": "observation",
      "kind": "observation_acquisition",
      "state": "unavailable",
      "identity": null,
      "evidence": "lib/verification-profile-runtime.mjs validates bound declarations; it is not a general observation acquisition provider.",
      "evidence_kind": "static",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "No general observation acquisition mapping for proof.integration.prefix-safety.",
        "source": "lib/verification-profile-runtime.mjs",
        "consequence": "Required observations remain unavailable until their actual owner supplies acquired evidence."
      },
      "implementation_version": null
    },
    {
      "id": "evaluation",
      "kind": "evaluation",
      "state": "implemented",
      "identity": "@agent-chassis/controlled-contract#evaluateVerificationProfileV1",
      "evidence": "lib/verification-profile-v1.mjs: incumbent exact profile evaluation; certification is distinct from implementation truth.",
      "evidence_kind": "static",
      "gap": null,
      "implementation_version": "1.0.0"
    }
  ]
}
```

Metadata is a declaration. It does not acquire observations or certify implementation truth.
