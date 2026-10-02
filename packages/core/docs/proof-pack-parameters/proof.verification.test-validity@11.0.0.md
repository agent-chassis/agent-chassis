# proof.verification.test-validity@11.0.0

<!-- Generated from validated package metadata. -->

For one exact test_execution proof instance, complete launcher-authenticated runtime evidence bound to the exact candidate or source snapshot, controlled-contract generation, obligation, proof-plan entry, declared target, test-proof binding, admitted profile, certification, guarantee, and evaluator satisfies the guarantee only when the candidate passes, the one test the binding's declarative test selector names is discovered, executed, and not skipped, every declared falsifier is present, every falsifier the provider could apply is detected, every required traversal is present and proven, and no prohibited shortcut is observed. A falsifier the provider could not apply is an authenticated capability limitation: it earns no detection credit, is not counterevidence, and never excuses a surviving sibling. A supported, isolated, actually observed mutation that leaves the selected test passing falsifies the guarantee; for a passing candidate, an incomplete falsifier population or a supported falsifier that is neither detected nor such a survivor is not executable, and a failed candidate gains no mutation counterevidence from its falsifier rows. No authored baseline inventory participates, and sibling tests observed in the same run neither earn nor withhold credit. Complete valid negative inventory or execution facts falsify the guarantee; missing evidence or an unavailable exact evaluator is not executable; malformed, unauthenticated, stale, ambiguous, cross-bound, contradictory, or digest-mismatched evidence is refused.

Profile digest: 00b85715c61e2463a78d872792a059c672db449e13ba745cb89de720a6c4af40. Parameter digest: d20d36c2ad90007146ee6707d67934f151468c9e7a1eb05fa7d4100c9af17804.

Admission digest: 08395afdc02a10e6dcce143981c8a18a723462d456f01788cf5822a7261f6dcc.

Roles: 2/2 accounted; 0 owned gaps. Semantic parameters: 2; internal roles: 2.

## Guarantee and exclusions

For one exact test_execution proof instance, complete launcher-authenticated runtime evidence bound to the exact candidate or source snapshot, controlled-contract generation, obligation, proof-plan entry, declared target, test-proof binding, admitted profile, certification, guarantee, and evaluator satisfies the guarantee only when the candidate passes, the one test the binding's declarative test selector names is discovered, executed, and not skipped, every declared falsifier is present, every falsifier the provider could apply is detected, every required traversal is present and proven, and no prohibited shortcut is observed. A falsifier the provider could not apply is an authenticated capability limitation: it earns no detection credit, is not counterevidence, and never excuses a surviving sibling. A supported, isolated, actually observed mutation that leaves the selected test passing falsifies the guarantee; for a passing candidate, an incomplete falsifier population or a supported falsifier that is neither detected nor such a survivor is not executable, and a failed candidate gains no mutation counterevidence from its falsifier rows. No authored baseline inventory participates, and sibling tests observed in the same run neither earn nor withhold credit. Complete valid negative inventory or execution facts falsify the guarantee; missing evidence or an unavailable exact evaluator is not executable; malformed, unauthenticated, stale, ambiguous, cross-bound, contradictory, or digest-mismatched evidence is refused.

- authority-grant
- coordinator-semantic-judgment
- durable-receipt-retention
- lifecycle-admission
- provider-support-invention

## Parameters

### component

Declare component for proof.verification.test-validity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: typed_referent.

```json
{
  "source": {
    "policy": "canonical",
    "mapping": "canonical-source"
  },
  "refinements": [
    {
      "ref": "/reference_roles/0",
      "value": {
        "role": "component",
        "allowed_type_terms": [
          "cc:runtime_component"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "profile_term"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/0",
      "value": {
        "pattern_id": "component-exists",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "component",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "suite-covers-component",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "suite",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "component"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "component",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": false
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "component",
          "suite"
        ]
      }
    }
  ]
}
```

### suite

Declare suite for proof.verification.test-validity. Preserve every linked refinement and applicability; this identifies a semantic referent, not an observed truth or generated graph ID.

Kind: test_assertion_selector.

```json
{
  "source": {
    "policy": "canonical",
    "mapping": "canonical-source"
  },
  "refinements": [
    {
      "ref": "/reference_roles/1",
      "value": {
        "role": "suite",
        "allowed_type_terms": [
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "profile_term"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/claim_patterns/1",
      "value": {
        "pattern_id": "suite-covers-component",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "suite",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "component"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "component",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": false
            }
          ]
        }
      }
    },
    {
      "ref": "/distinct_reference_role_sets/0",
      "value": {
        "roles": [
          "component",
          "suite"
        ]
      }
    }
  ]
}
```

## Role production and complete constraints

| Role | Producer | Source | Capability gap |
| --- | --- | --- | --- |
| component | canonical_relationship | component |  |
| suite | canonical_relationship | suite |  |

```json
{
  "roles": [
    {
      "role": "component",
      "kind": "canonical_relationship",
      "parameter": "component",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/0",
        "/claim_patterns/1",
        "/distinct_reference_role_sets/0"
      ],
      "capability": "canonical-source",
      "gap": null,
      "refinement": {
        "role": "component",
        "allowed_type_terms": [
          "cc:runtime_component"
        ],
        "allowed_identity_kinds": [
          "repository_path",
          "profile_term"
        ],
        "cardinality": "exactly_one"
      }
    },
    {
      "role": "suite",
      "kind": "canonical_relationship",
      "parameter": "suite",
      "inputs": [],
      "rule_refs": [
        "/claim_patterns/1",
        "/distinct_reference_role_sets/0"
      ],
      "capability": "canonical-source",
      "gap": null,
      "refinement": {
        "role": "suite",
        "allowed_type_terms": [
          "cc:test"
        ],
        "allowed_identity_kinds": [
          "profile_term"
        ],
        "cardinality": "exactly_one"
      }
    }
  ],
  "constraints": [
    {
      "ref": "/distinct_reference_role_sets/0",
      "constraint": {
        "roles": [
          "component",
          "suite"
        ]
      }
    },
    {
      "ref": "/claim_patterns/0",
      "constraint": {
        "pattern_id": "component-exists",
        "claim_kind": "behavior",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "component",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": true
            }
          ]
        }
      }
    },
    {
      "ref": "/claim_patterns/1",
      "constraint": {
        "pattern_id": "suite-covers-component",
        "claim_kind": "verification",
        "allowed_modalities": [
          "MUST"
        ],
        "proposition_template": {
          "subject_role": "suite",
          "operator": "reference:covers",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "reference",
              "role": "component"
            }
          ]
        },
        "verification_methods": [
          "test_execution"
        ],
        "falsifying_proposition_template": {
          "subject_role": "component",
          "operator": "boolean:exists",
          "applicability_context": {
            "mode": "unconditional",
            "operand_roles": []
          },
          "operands": [
            {
              "kind": "boolean",
              "value": false
            }
          ]
        }
      }
    },
    {
      "ref": "/relation_patterns/0",
      "constraint": {
        "pattern_id": "suite-verifies-component",
        "role": "verifies",
        "source_claim_pattern_id": "suite-covers-component",
        "target_claim_pattern_id": "component-exists"
      }
    },
    {
      "ref": "/falsifier_condition_bindings/0",
      "constraint": {
        "relation_pattern_id": "suite-verifies-component",
        "applicability_context": {
          "mode": "unconditional",
          "operand_roles": []
        }
      }
    },
    {
      "ref": "/stable_capabilities",
      "constraint": {
        "semantic_mechanisms": [],
        "test_validity": "provider_bound_test_validity.v1"
      }
    },
    {
      "ref": "/satisfaction_expression",
      "constraint": {
        "all_of": [
          {
            "pattern": "component-exists"
          },
          {
            "pattern": "suite-covers-component"
          },
          {
            "pattern": "suite-verifies-component"
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
    "semantic_inputs": [
      "component",
      "suite"
    ],
    "declaration_outputs": [],
    "required_observations": [],
    "canonical_inputs": []
  },
  "dependencies": {
    "state": "unresolved",
    "gap": {
      "owner": "@agent-chassis/controlled-contract",
      "missing": "No authored exact inter-pack dependency recipe for proof.verification.test-validity.",
      "source": "lib/proof-authoring-skeleton.mjs",
      "consequence": "Do not infer independent construction or supporting packs; work record must retain this unresolved construction fact."
    }
  },
  "capabilities": [
    {
      "id": "construction",
      "kind": "constructor",
      "state": "unavailable",
      "identity": null,
      "evidence": "lib/proof-authoring-skeleton.mjs: general binding assistance requires an existing populated native contract.",
      "evidence_kind": "static",
      "gap": {
        "owner": "@agent-chassis/controlled-contract",
        "missing": "No named proof.verification.test-validity constructor maps semantic inputs to the complete native graph.",
        "source": "lib/proof-authoring-skeleton.mjs",
        "consequence": "work record must report unavailable construction; binding by compatible type does not establish a source mapping."
      },
      "implementation_version": null
    },
    {
      "id": "canonical-source",
      "kind": "canonical_resolver",
      "state": "declared_requirement",
      "identity": null,
      "evidence": "work record canonical test declaration and work-record-test-proof-bindings.mjs own the test target and exact selector.",
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
        "missing": "No general observation acquisition mapping for proof.verification.test-validity.",
        "source": "lib/verification-profile-runtime.mjs",
        "consequence": "Required observations remain unavailable until their actual owner supplies acquired evidence."
      },
      "implementation_version": null
    },
    {
      "id": "evaluation",
      "kind": "evaluation",
      "state": "implemented",
      "identity": "@agent-chassis/controlled-contract#resolveExactProofEvaluator",
      "evidence": "lib/proof-evaluator-registry.mjs: exact definition and execution evaluators are distinct.",
      "evidence_kind": "static",
      "gap": null,
      "implementation_version": "1.0.0"
    }
  ]
}
```

Metadata is a declaration. It does not acquire observations or certify implementation truth.
